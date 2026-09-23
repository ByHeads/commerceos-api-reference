# Payment EPI reference

The payment EPI (External Partner Interface) is the contract between CommerceOS and a payment
integration: the HTTP service that you build so that CommerceOS can take, capture, release and
refund payments through your provider. The tutorial [Build a payment integration](../payment-epi.md) gets you started.

The contract is published as two OpenAPI 3.1 documents. They carry every route, every field and
its meaning, and when CommerceOS makes each call. Read them in an OpenAPI viewer, or generate a
server stub and a client from them.

| Document | Direction | Holds |
|---|---|---|
| [`epi-openapi.yaml`](./epi-openapi.yaml) | CommerceOS calls your integration | the ten routes under your `baseUrl`, the context headers, the config-schema format, every step of the payment stream, every DTO |
| [`commerceos-openapi.yaml`](./commerceos-openapi.yaml) | your integration calls CommerceOS | the token endpoint, the configuration behind a context id, the key-value store, the payment-order completion, and the OAuth2 scope each call needs |

Open them in any OpenAPI viewer (`npx @redocly/cli preview-docs guide/examples/payment-epi/epi-openapi.yaml`),
or generate a server stub from the first and a client from the second.

This page holds what a schema cannot: the order of calls, what the cashier sees, the ledger effect
of each action, and what CommerceOS does when a stream drops. A JSON example under an HTML comment
is a fixture of the conformance tool `epi-check` that Heads runs against your endpoint; the comment
names its file in [`scenarios/`](./scenarios/), and `{{name}}` is filled at run time.

**Base URL of the CommerceOS API:** `https://example.app.heads.com/api/v1`. The calls in section 8
carry the bearer token of your integration's OAuth2 client.

## 1. The two directions

CommerceOS calls `{baseUrl}` plus a fixed path with JSON bodies, and one call answers with a
stream (section 5). Those calls carry no credential, only the three context headers of section 3.
Your integration calls `{cosBaseUrl}/api/v1/...` with the OAuth2 client that it receives in the
install payload (section 2). That client is the only credential of your integration: it holds no
API key. Section 8 lists what the client can do.

## 2. Lifecycle endpoints

CommerceOS calls these endpoints outside a payment. *Bare* calls carry no context headers, because they run before any configuration exists. *Contextful* calls carry the headers of section 3.

| Call | Headers | Request body | Response | When |
|---|---|---|---|---|
| `POST {baseUrl}/install` | bare | install payload, below | any 2xx | the `install` action on the integration. On success the status becomes `Active`. A later install can carry a different client: store the new one and drop any cached token |
| `POST {baseUrl}/uninstall` | bare | empty | any 2xx. A failure is logged and ignored | the `uninstall` action. The status becomes `Inactive` |
| `GET {baseUrl}/config-schema` | bare | none | form description, section 4 | an administrator opens the configuration form |
| `POST {baseUrl}/test` | contextful | none | JSON `true` | the `test` method, once per configured node |
| `GET {baseUrl}/methods` | contextful | none | `MethodDto[]` | the `configure` action on a configuration |
| `GET {baseUrl}/terminals` | contextful | none | `TerminalDto[]` | an administrator lists the terminals of a configuration |
| `GET {baseUrl}/terminals/{terminalId}` | contextful | none | `TerminalDto` | CommerceOS reads one terminal to create its own record of it |

The answer of `GET {baseUrl}/methods` for one method as the Piggy Bank sample sends it (`MethodDto` in `epi-openapi.yaml`), then the install payload:

```json
[ { "methodId": "com.example.piggy", "name": "Piggy Bank",
    "supports": { "incoming": true, "outgoing": true, "reversal": true },
    "requires": { "terminal": false, "specification": false } } ]
```
```json
{ "cosBaseUrl": "https://example.app.heads.com", "tokenUrl": "https://example.app.heads.com/oauth2/v1/token",
  "clientId": "epi-check", "clientSecret": "epi-check-secret", "scope": "me geo:read orders.sales:write orders.payments:write payment-records:write kv" }
```

`scope` is the space-separated scope list of the OAuth2 client, as CommerceOS holds it. A client that
the back office creates for an integration has `me geo:read orders.sales:write orders.payments:write payment-records:write kv`. The order of the scopes in
the string is not fixed: read it as a set.
Send it, or the subset section 8 names, as `scope` in the token request. The `test` method on the API answers
`{ integrationName, configurationTests: { "<node name>": "success" | "fail" } }`. A non-2xx or a thrown error is `fail`.

**The payment method record.** `configure` creates one payment method per item of your `GET /methods`
answer and, on every later `configure`, overwrites ten fields from the DTO: `name`, the three
`supports`, the two `requires`, and the four `allows`. An omitted `allows` block resets those four to
`true`, `false`, `false`, `false`. Everything else on the method is set by a Heads administrator in the
back office, is never touched by `configure`, and your integration cannot read it. What it does to
your calls:

| Administrator setting | Effect on your integration |
|---|---|
| Requires customer | The POS refuses to start the payment until the sale has a customer. Your integration is not called |
| Requires credit approval | As above, and the customer must be approved for credit |
| Currency rules, *rounding increment* | A typed amount that is not a multiple is refused before your integration is called. A plain Pay rounds the balance, so the `amount` you receive is the rounded one |
| Currency rules, *maximum overpayment amount* | A tender that exceeds the balance by more than this is refused before your integration is called |
| Currency rules, *minimum and maximum payment amount*, *minimum overpayment* | Stored and shown, not enforced at pay time |
| A currency with no rule row | No limits. Nothing restricts which currencies reach you: check `currencyCode` yourself and answer `Fail` for one you do not take |
| Customer friendly title and description | Not read by the POS |
| Available in POS, and the POS profile | Both gate the button on the pay screen. `availableInPos` is yours; the profile's allowed methods are the administrator's |

**What goes wrong at setup, and what the administrator sees.** A non-2xx from `POST /install`
leaves the integration `Inactive` and shows `Install error: Could not install integration '<name>'.
<status text>`; the error body is not read on this route. `configure` does not validate the
`GET /methods` answer: two items with the same `methodId` write the same record twice and the last
wins, and an item without `supports` stops the run after the items before it were written. `POST /test`
must answer the JSON literal `true`; any other body, `"ok"` or `{}` for example, reads as a failed test
with no message. Whenever the test fails for a reason you can name, an invalid value or a configuration read that
failed for example, answer a non-2xx with an error body: the administrator then sees
`<code>: <message>` next to the failed status. `false` shows nothing, so use it only when you have
nothing to say. An unknown id on `GET /terminals/{terminalId}` is answered with `404` and an error body.

Two DTO flags have consequences the names do not show. `allows.fullAmountFinishesReceipt`: when the
cashier tenders more than the balance with your method, the POS pays the change back through a
second call to your integration, a `Payout` on the same method; set it only when `supports.outgoing`
is `true`. And the POS classifies methods as cash, card or mobile by a fixed list of `methodId`
values that Heads maintains, which steers refund and void handling; a new `methodId` is none of
the three until Heads adds it. Ask Heads if your method should count as one of them.

## 3. Context headers

Every contextful call carries three headers; CommerceOS always sends all three. Check at least `X-EPI-Context-Config-Id` and reject a call without it with a 400 and an error body (section 7). CommerceOS finds the EPI configuration for the organization node of the call, and a configuration on a parent node applies to the nodes below it.

| Header | Value | Use |
|---|---|---|
| `X-EPI-Context-Config-Id` | the four-character id of the configuration | look the configuration up (section 4) |
| `X-EPI-Context-Config-Hash` | the configuration id followed by three characters of a hash of the configuration values, for example `tWBlI--` | cache key. A changed configuration has a new value |
| `X-EPI-Debug-Info` | JSON with `nodeName`, `baseUrl`, `name` | logging only. `nodeName` is the node of the call, for example the store of the till. The configuration can sit on a parent of that node |

CommerceOS sends this context; the conformance tool reads the same values from the EPI configuration
on your CommerceOS and sends them. `debugInfo` is the value of the third header:
```json
{ "configId": "v5EX", "configHash": "v5EXNSP",
  "debugInfo": { "nodeName": "Shade AB", "baseUrl": "https://piggy.example.com/piggy", "name": "Piggy" } }
```


## 4. Configuration

`GET {baseUrl}/config-schema` answers a *form description*: the fields that a Heads administrator
fills in for your integration on an organization node, for example a merchant id and an
environment. It is not a JSON Schema. It is written in the same format as the type declarations of
the CommerceOS API: an object with `title`, `description` and `members`, where each member has a
`type` written as a short string. The formal shape is `ConfigSchema` in [`epi-openapi.yaml`](./epi-openapi.yaml).

```json
{ "title": { "en-US": "Piggy Bank", "sv-SE": "Piggy Bank" },
  "description": { "en-US": "Merchant account at Piggy Bank" },
  "members": {
    "merchantId":  { "type": "string",           "title": { "en-US": "Merchant id" } },
    "environment": { "type": "'TEST' or 'LIVE'", "title": { "en-US": "Environment" }, "description": { "en-US": "TEST until go-live" } },
    "timeoutSeconds": { "type": "number?" },
    "terminal": { "type": "object", "title": { "en-US": "Terminal" },
                  "members": { "host": { "type": "string" }, "port": { "type": "number" } } } } }
```

**The `type` string.** One base type, an optional union of quoted values, and an optional `?`.

| Write | Meaning | The administrator gets |
|---|---|---|
| `string`, `number`, `boolean` | a scalar | a text field, a number field, a checkbox |
| `'TEST' or 'LIVE'` | one of the quoted values. Two or more, joined by ` or ` | a text field whose placeholder lists the values. The value is checked on save |
| `object` with `members` | a nested group of fields | the nested fields, as a group |
| `object` without `members`, `string[]`, `number[]`, `object[]` | free-form JSON | a JSON text editor |
| any of the above plus a trailing `?` | optional. Without `?` a field is required, and the form shows *Required* until it has a value | |

Nothing else is accepted: no named types, no `(read-only)`, no ` and `. The CommerceOS API uses the
same notation in its own type declarations with a larger grammar; a config schema uses this subset.

**`title` and `description`** are a string or a map from locale to string, for example
`{ "en-US": "The API key", "sv-SE": "API-nyckeln" }`. The back office picks the exact locale, then
the same language, then `en-US`, then the first value. When a member has a `description`, it is
the field label and `title` becomes the placeholder. Answer `"members": {}` when your integration
needs no configuration: the Mock integration that Heads hosts does exactly that.

**What happens with the values.** They are stored as an *EPI configuration* on the organization node,
as a plain object keyed like `members`. Read them back per section 8, cache by
`X-EPI-Context-Config-Hash`, and validate them in `POST /test`: that is the administrator's check
that the configuration works against your provider. The Piggy Bank sample does exactly this: its
`/test` reads the configuration through the context id, caches it by hash, and answers `422` with an error body that
names the problem when `merchantId` is empty or `environment` is not `TEST` or `LIVE`. The conformance tool plays the CommerceOS
side of that read, serving the configuration named in its profile.

## 5. The payment stream

A payment starts with `PUT {baseUrl}/payments/{paymentKey}` and a `PaymentInitDto` body. The `paymentKey`
is the key of the payment order that CommerceOS allocates before the call. The organization node of the call is the payee for `direction: "Payment"` and the payer for `Payout`.

<!-- fixture: scenarios/P1.json#/steps/0/args -->
```json
{ "methodId": "{{methodId}}", "amount": "{{amount}}", "currencyCode": "{{currencyCode}}",
  "direction": "Payment",
  "debitSynchronously": true, "payer": "{{payer}}", "payee": "{{payee}}",
  "token": "{{token}}", "locale": "{{locale}}", "specification": "{{specification}}" }
```

`debitSynchronously: true` is on every request a till sends, `Payment` and `Payout` alike. A
`Complete` under it must capture: `["Authorize","Debit"]` in one transaction, or a `Debit`
transaction after the `Authorize`. CommerceOS refuses an Authorize-only `Complete` under the flag,
so never answer a reservation on a till. The request carries no flag only on API-driven flows that
reserve first and capture later through the transactions route (scenarios `P2`, `P3`).

`token` names the currency instance of the request. CommerceOS makes a new one for every distinct
request, so two partial refunds of the same amount on one order carry two different tokens; only
a retry of the same request repeats the token. That is what makes the idempotency key of section
11 safe. In that key, compare `actions` as a set: the order of the array carries no meaning.

Some fields arrive empty from a till, and your integration must accept them: `redirectUrls` are all
`https://heads.com`, a sale without a customer carries a `payer` of type `Person` with an empty
`fullName`, `specification[].identifier` can be `""`, and `reversalArgs.terminalId` is `""` for a method
that requires no terminal.

`specification` lists what the payment is for, and the total amounts sum to `amount`:
<!-- fixture: scenarios/fixtures.json#/specification -->
```json
[
  { "identifier": "ART-0001", "description": "Reference article A", "quantity": "1", "unit": "pcs",
    "totalAmount": "{{half}}", "vatPercentage": "25", "currencyCode": "{{currencyCode}}" },
  { "identifier": "ART-0002", "description": "Reference article B", "quantity": "1", "unit": "pcs",
    "totalAmount": "{{remainder}}", "vatPercentage": "25", "currencyCode": "{{currencyCode}}" }
]
```

The response has `Content-Type: text/event-stream`. Each step is one SSE message: a line
`event: <type>`, a line `data: <JSON>`, then a blank line. Write exactly one space after each colon:
CommerceOS strips a fixed number of characters. It splits messages at `\n\n`, joins several `data:`
lines with a newline, ignores `id:`, `retry:` and comment lines, and adds `type` from the `event:` line
unless the JSON carries its own `type`. A stream holds zero or more intermediate steps and exactly one final step.

| Step | Kind | Fields | Meaning |
|---|---|---|---|
| `Create` | intermediate | `result: PaymentDto` | a session exists at the provider. More steps follow |
| `Cancellable` | intermediate | `cancellationToken` | CommerceOS can now cancel (section 6). Send a `Wait` or `ShowImage` step after it: the cancel button sits on that dialog, and `Cancellable` alone shows nothing |
| `Wait` | intermediate | `message?`, `element?`, `translationKey?`, `params?` | show a waiting message |
| `ShowImage` | intermediate | `url`, `audience?` | show an image, for example a QR code |
| `VisitPage` | intermediate | `url`, `audience?` | open a web page |
| `RenderView` | intermediate | `path`, `config`, `audience?` | render a view |
| `Complete` | final | `result: PaymentDto`, `issuedWalletKey?` | success. CommerceOS creates one payment record per `result.transactions[]` item. Amounts are positive for both directions: CommerceOS stores and shows a `Payout` amount negative |
| `Decline` | final | `reason`, `params?` | a normal negative outcome. `reason` is a code such as `InsufficientFunds` |
| `Cancel` | final | none | the payment was cancelled |
| `Fail` | final | `errors[]` | an error. The cashier sees `Payment failed: <text>` from `errors[0]` (section 7) |

The first final step wins: CommerceOS closes the stream on it and never reads a second one. A step
whose `type` is not in the table is ignored, and the POS keeps waiting for the next step.

`audience` is `merchant`, `customer` or `all`. A `Complete` result echoes `methodId`, `amount` and
`currencyCode`, and each transaction echoes the request `token` and `specification`. CommerceOS stores
the transaction's `specification` verbatim as the item rows of the payment record; a transaction without
it gives a record with no items in the back office.

## 6. Transactions, cancel, and reversal arguments

A `paymentKey` whose stream ended in `Decline`, `Cancel` or `Fail` has no payment order: treat a new `PUT` for it as a new payment, and answer a transactions call for it with `404` and an error body. An administrator who reads `GET /v1/payment-orders/key=<key>` for such a key gets `200` with the body `null`, the same as for an unknown key, never a 404.

**When a refund reaches this route.** The POS makes the `Credit` call only from the *Refund*
action under the cart, on a return whose original sale your method paid, and only when your method
declares `supports.reversal` and the amount fits the original order. When the cashier instead opens
the pay screen and picks your method for the negative balance, the POS starts a new payment with
`direction: "Payout"` through `PUT {baseUrl}/payments/{paymentKey}` whenever `supports.outgoing` is
`true`, and tries the `Credit` path there only for a method with `supports.outgoing` `false`. A
method that declares both flags, as the sample does, is refunded by `Payout` from the pay screen
and by `Credit` from the *Refund* action. Nothing else in CommerceOS makes this call: no
back-office action and no API route.

Capture, release and refund go to `POST {baseUrl}/payments/{paymentKey}/transactions` with a
`TransactionInitDto`. The answer is a `TransactionDto`: the same fields plus `transactionId` and
`timestamp`. `amount` is always positive. A refund carries `reversalArgs`, so that the provider reverses the original transaction:

<!-- fixture: scenarios/P4.json#/steps/1/args -->
```json
{ "actions": ["Credit"], "token": "{{token}}", "amount": "{{amount}}",
  "currencyCode": "{{currencyCode}}", "methodId": "{{methodId}}", "specification": "{{specification}}",
  "reversalArgs": { "originalTransactionId": "{{lastTransaction.transactionId}}",
                    "originalTimestamp": "{{lastTransaction.timestamp}}" } }
```

A cancel goes to `POST {baseUrl}/payments/{cancellationToken}/cancel` with a `CancelDto`, whose four
fields carry the local-terminal context so that a provider can route the cancel to the right terminal.
Answer any 2xx, then end the stream with `Cancel`. The cancel call runs beside the stream, so it can
arrive after the stream ended: answer 2xx and do nothing. An unknown token is answered with `404` and an
error body, which the cashier sees as `Cancel failed: <code>: <message>`.
<!-- fixture: scenarios/fixtures.json#/cancel -->
```json
{ "isLocalTerminal": false }
```

**`means`: what paid.** Set it on every transaction; `TransactionDto.means` in the OpenAPI document says
what CommerceOS shows for it. Two warnings the schema has no room for: do not send `Card` without a
real card, because CommerceOS creates a card record per transaction and a `token` joins an index shared
by every provider; and do not send `Wallet` unless CommerceOS holds the wallet's balance.

## 7. Errors

One rule decides where an error goes. On every route except the stream, a failed call answers a
non-2xx status with the body `{ "errors": [ ... ] }`, and CommerceOS reads it. On the stream,
`PUT /payments/{paymentKey}`, CommerceOS discards the body of a non-2xx: the cashier sees the raw
dialog `¿Error: Request failed: <status>.?`, the sale stays open, and the next attempt reuses the same
`paymentKey` (verified on a till 2026-09-22). After a final `Decline`, `Fail` or `Cancel` step the
next attempt carries a new `paymentKey`. So a request that your integration cannot take on that
route, an unknown `methodId` for example, is answered as a 200 stream with one `Fail` step. The
conformance scenario `E2` checks it, and the tool fails any scenario in which the stream route
answered a non-2xx. Each error item has:

| Field | Required | Meaning |
|---|---|---|
| `message` | yes | a human-readable description |
| `code` | no | a provider-defined code. On a `Fail` step the POS shows the translation of the code when it has one (key `ErrorCondition:<code>`), else `message`, never both. On an error body the cashier sees `<code>: <message>` verbatim |
| `params` | no | positional parameters for a translated message |

A non-2xx answer without that body shows `Request failed: <status>.`, followed by a parse note when
the body is not JSON.

## 8. Calls from your integration to CommerceOS

Every call goes to `{cosBaseUrl}/api{path}` with `Authorization: Bearer <token>`,
`content-type: application/json` and `accept: application/json`. The routes and their request and
response shapes are in [`commerceos-openapi.yaml`](./commerceos-openapi.yaml). `cosBaseUrl`, `tokenUrl`,
`clientId` and `clientSecret` come from the install payload (section 2). The token is a
client-credentials token for that client. The scopes of the client limit it to the calls in this
table. Other resources, such as payment integrations and payment terminals, are not available to
the client.

| Call | Scope | Use |
|---|---|---|
| `POST {tokenUrl}` | — | client-credentials token. Cache it until `expires_in` |
| `GET /v1/context/config/{configId}` | `me` | the configuration for a context id (section 4) |
| `GET`, `PUT`, `DELETE /v1/kv/{container}/{key}` | `kv` | a key-value store for your own state. `container` is a namespaced key such as `com.example.payments`. No route lists the keys of a container: `GET /v1/kv/{container}` answers 200 with an empty `kvp set`, whatever it holds. Keep your own index if you need one |
| `PATCH /v1/payment-orders/{paymentKey}` with `{ "records": [ ... ] }` | `orders.payments:write` | complete an asynchronous payment, for example from a callback of your provider |

```bash
# Token
curl -X POST "https://example.app.heads.com/oauth2/v1/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=<client id>&client_secret=<client secret>&scope=me%20kv%20orders.payments:write"
# → { "access_token": "...", "expires_in": 3600, ... }

# The configuration for the context id of an incoming call
curl -X GET -H "Authorization: Bearer <access token>" "https://example.app.heads.com/api/v1/context/config/EPI1"
# → { "configuration": { ... }, "configurationHash": "..." }

# Key-value store: write, read, delete
curl -X PUT -H "Authorization: Bearer <access token>" "https://example.app.heads.com/api/v1/kv/com.example.payments/session-pay-P1" \
  -H "Content-Type: application/json" -d '{ "providerSessionId": "S-123", "state": "pending" }'
curl -X GET -H "Authorization: Bearer <access token>" "https://example.app.heads.com/api/v1/kv/com.example.payments/session-pay-P1"
curl -X DELETE -H "Authorization: Bearer <access token>" "https://example.app.heads.com/api/v1/kv/com.example.payments/session-pay-P1"
```

Complete an asynchronous payment. `paymentKey` is the key from `PUT {baseUrl}/payments/{paymentKey}`:

```bash
curl -X PATCH -H "Authorization: Bearer <access token>" "https://example.app.heads.com/api/v1/payment-orders/pay-P1" \
  -H "Content-Type: application/json" \
  -d '{ "records": [ {
        "identifiers": { "transactionId": { "method": { "identifiers": { "methodId": "com.example.card" } }, "id": "T-0001" } },
        "currency": { "identifiers": { "currencyCode": "SEK" } },
        "timestamp": "2026-09-18T09:00:00Z", "amount": "100.00",
        "actions": ["Authorize", "Debit"], "token": "tok-P1", "specification": []
      } ] }'
```

The shape of the record, which members are required, and what CommerceOS does with a duplicate
`transactionId` are in [`commerceos-openapi.yaml`](./commerceos-openapi.yaml), `PaymentOrderRecord`.
Without `token`, CommerceOS takes the available money for the first action.

## 9. Status, actions and decline reasons

`status` on a payment order is a set of flags, recomputed from four running amounts whenever a record is added, so an order can carry several values. The order of the values carries no meaning.

| `status` value | Meaning |
|---|---|
| `New` | part of the order amount is not yet authorized, annulled, debited or credited |
| `Authorized` | an amount is reserved and not yet captured |
| `Annulled` | a reserved amount was released without capture |
| `Debited` | an amount was captured |
| `Credited` | a captured amount was refunded |

`actions` on a payment record lists what one transaction did. Most transactions carry one action. A
provider that does not separate authorization from capture answers `["Authorize","Debit"]`. The ledger
has three accounts: `source` is the payer's side, `destination` the payee's side, `transit` the payee's money that is reserved or in flight.

| `actions` value | Ledger move | Verb |
|---|---|---|
| `Authorize` | transit to destination | reserve |
| `Annul` | destination to transit | release, the cancel of a reservation |
| `Debit` | source to transit | capture |
| `Credit` | destination to source | refund |

Typical `status` sets on an order: a one-step sale `["Debited"]`, a reservation `["Authorized"]`,
a released reservation `["Annulled"]`, a refunded sale `["Credited","Debited"]`.

**Decline reasons the POS translates.** The `reason` of a `Decline` step selects a sentence in the cashier's language, and `params` fill `{0}`, `{1}`. English below; Swedish and Norwegian exist for the same codes.

| `reason` | Cashier text in English |
|---|---|
| `InsufficientFunds` | `Payment declined: Insufficient funds. Available balance is {0}, requested amount is {1}.` Send two `params`. They are inserted as text, so format them for the request's `locale`, for example `"0,00 SEK"` for `sv-SE` |
| `CardNotActive` | `Payment declined: Card is not active.` |
| `CardExpired` | `Payment declined: Card has expired.` |
| `CardNotFound` | `Payment declined: Card not found.` |
| `CardCancelled` | `Payment declined: Card has been cancelled.` |
| `CardFullyRedeemed` | `Payment declined: Card has been fully redeemed.` |
| `CardBlocked` | `Card blocked` |
| `InvalidPin` | `Payment declined: Invalid PIN.` |
| `InvalidCode` | `Payment declined: Invalid card code.` |
| `Timeout` | `Payment timed out` |
| any other code | `Payment declined: <your code>`, untranslated, in every language |

**`Fail` codes the POS translates.** A `Fail` step shows `Payment failed:` plus the translation of
`errors[0].code` when there is one, else `errors[0].message`. Translated codes, with the English text:
`Aborted` (Payment was aborted), `Busy` (Terminal is busy), `DeviceOut` (Terminal is out of order),
`InProgress` (A transaction is already in progress), `InsertedCard` (Please remove the card),
`InvalidCard` (The card is invalid), `LoggedOut` (Terminal is logged out), `MessageFormat`
(Communication error with the terminal), `NotAllowed` (This operation is not allowed), `NotFound`
(Transaction not found), `PaymentRestriction` (Payment is restricted), `Refusal` (Payment was
refused), `UnavailableDevice` (Terminal is unavailable), `UnavailableService` (Payment service is
unavailable), `UnreachableHost` (Cannot reach the payment service), `WrongPIN` (Incorrect PIN
entered), `NoResponse` (No response from the terminal), `TerminalRequired` (A payment terminal is
required), `UnknownState` (An unknown error occurred). Any other code shows `message`.

## 10. Test amounts

The cents of the amount select the outcome: [Build a payment integration](../payment-epi.md#6-test-amounts).

## 11. What CommerceOS does on your side

| Situation | What CommerceOS does | What you must do |
|---|---|---|
| The stream sends no step for a long time | Sets no timeout of its own. The HTTP runtime closes a stream with no bytes after about five minutes. That limit is the runtime's, not a contract value | Send a final step within minutes, or a `Wait` step at intervals while you wait for the provider |
| The stream closes cleanly with no final step | Shows nothing. No dialog, no payment line, the sale stays open. Verified on a till 2026-09-22 | Never close a stream without a final step. On an exception, send `Fail` first |
| A `Complete` that CommerceOS refuses (an Authorize-only answer under `debitSynchronously`, or a transaction it cannot record) | The raw dialog `¿Error: Payment was requested to be synchronously debited, but it was not.?`, no payment order, and the next attempt reuses the same `paymentKey`, so a resume repeats the refused answer and the cashier is stuck. A platform fix that turns this into a `Fail` step is proposed; with it the next attempt is a new key | Never send such a `Complete`. The tool refuses a non-capturing `Complete` under the flag |
| The connection drops before a final step | Shows the raw dialog `¿TypeError: terminated?`. The payment order is not marked failed. On the cashier's next attempt with direction `Payment`: no order yet, same `paymentKey` again; an order `Debited` for the tender amount, attached without a new call; an order `Debited` for another amount, attached and the cashier told to tender the rest; a non-debited order, a fresh key | Treat a second `PUT` with a known `paymentKey` as a resume: answer the same `processorsId` and the same transactions, never a second charge. The conformance scenario `P10` checks it. When the session behind the key still waits for the customer, continue that session on the new stream, with `Wait` steps, and never open a second session |
| A stream call or a transactions call fails (network error, non-2xx) | Makes no retry. The cashier sees the error and starts the payment again by hand. Data after a final step is ignored | Make every call idempotent on its request: the same `paymentKey`, `token`, `actions` and `amount` answer the same transaction. Send exactly one final step, then close |
| A repeated `records` item in `PATCH /v1/payment-orders/{key}` (same `transactionId.id` on the same order) | A repeat of the identical record is a no-op. A record that reuses the id with any field changed is refused | Repeat a callback with the same body, or not at all. Give every distinct transaction its own id |
| A `records` item after the order is `Debited` | Has no state guard. A late `Debit` or `Authorize` beyond the remaining amount answers 400 (`Amount must agree with designated instance.`, or with a `token`, `Designated instance must be a subset of available instance.`). A `Credit` up to the debited amount is accepted and adds `Credited` | Post the completion once. Do not post a `Debit` for a sale that the stream already completed |
| A `Complete` whose `processorsId` equals that of an earlier payment order of the same method | Refuses it. The cashier sees `Error: Payment order '<id>' already exists.` and no payment record is created | Make `processorsId` unique per method for all time. A counter that restarts with your process collides with the orders it created before the restart |
| The cashier presses cancel | Calls `POST /payments/{cancellationToken}/cancel` once. A non-2xx shows `Cancel failed: <code>: <message>` from your error body and the stream keeps running | Answer 2xx, then end the stream with `Cancel` |

## 12. Where every field is defined

Every DTO, every step of the stream and every CommerceOS-side type is defined with a description
per field in the two OpenAPI documents named at the top of this page. `?` in this page marks an
optional field. A decimal is a string, never a JSON number; CommerceOS sends a whole amount as `"15"`, not `"15.00"`, so compare numerically. A timestamp is ISO 8601.
