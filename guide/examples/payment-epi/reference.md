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

This page holds what a schema cannot: the order of calls, what the cashier sees, the ledger effect
of each action, and what CommerceOS does when a stream drops. Every JSON example is a fixture of
the conformance tool `epi-check` that Heads runs against your endpoint. An HTML comment names its
file in [`scenarios/`](./scenarios/), and `{{name}}` is filled at run time.

**Base URL of the CommerceOS API:** `https://example.app.heads.com/api/v1`
**Credential in the examples:** `-u ":banana"` (Basic auth, empty user name). In production your integration sends the OAuth2 bearer token of section 8.

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
| `POST {baseUrl}/install` | bare | install payload, below | any 2xx | the `install` action on the integration. On success the status becomes `Active` |
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
<!-- fixture: scenarios/fixtures.json#/install -->
```json
{ "cosBaseUrl": "http://localhost:5000", "tokenUrl": "http://localhost:5000/oauth2/v1/token",
  "clientId": "epi-check", "clientSecret": "epi-check-secret", "scope": "epi" }
```

`scope` is the space-separated scope list of the OAuth2 client, as CommerceOS holds it. A client that
the back office creates for an integration has `me geo:read orders.sales:write orders.payments:write payment-records:write kv`.
Send the string as `scope` in the token request; section 8 names the three scopes these calls need. The `test` method on the API answers
`{ integrationName, configurationTests: { "<node name>": "success" | "fail" } }`. A non-2xx or a thrown error is `fail`.

## 3. Context headers

Every contextful call carries three headers; CommerceOS always sends all three. Check at least `X-EPI-Context-Config-Id` and reject a call without it. CommerceOS finds the EPI configuration for the organization node of the call, and a configuration on a parent node applies to the nodes below it.

| Header | Value | Use |
|---|---|---|
| `X-EPI-Context-Config-Id` | the four-character id of the configuration | look the configuration up (section 4) |
| `X-EPI-Context-Config-Hash` | a hash of the configuration values | cache key. A changed configuration has a new hash |
| `X-EPI-Debug-Info` | JSON with `nodeName`, `baseUrl`, `name` | logging only |

The conformance tool sends this context. `debugInfo` is the value of the third header:
<!-- fixture: scenarios/fixtures.json#/context -->
```json
{ "configId": "EPI1", "configHash": "epi-check-config-hash-0001",
  "debugInfo": { "nodeName": "epi-check", "baseUrl": "{{baseUrl}}", "name": "epi-check" } }
```

Reject a contextful call without the headers with a 4xx status and an error body (section 7). The conformance tool checks this only against its own reference server, not against your integration.

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

**What happens with the values.** The administrator's input is stored as an *EPI configuration* on
the organization node, as a plain object keyed like `members`. A configuration on a parent node
applies to the nodes below it. Every contextful call then carries the id of that configuration in
`X-EPI-Context-Config-Id`. Your integration reads the values with the OAuth2 client from the
install payload: `POST {tokenUrl}` for a token (section 8), then `GET {cosBaseUrl}/api/v1/context/config/{configId}`
with `Authorization: Bearer <token>`. The answer is `{ "configuration": { ... }, "configurationHash": "..." }`,
and `configurationHash` equals the `X-EPI-Context-Config-Hash` header of the call, so cache by it.
The `me` scope grants the read. Validate the values in `POST /test`, once per node, and answer
`true`: that is the administrator's check that the configuration works against your provider.

## 5. The payment stream

A payment starts with `PUT {baseUrl}/payments/{paymentKey}` and a `PaymentInitDto` body. The `paymentKey`
is the key of the payment order that CommerceOS allocates before the call. The organization node of the call is the payee for `direction: "Payment"` and the payer for `Payout`.

<!-- fixture: scenarios/P1.json#/steps/0/args -->
```json
{ "methodId": "{{methodId}}", "amount": "{{amount}}", "currencyCode": "{{currencyCode}}",
  "direction": "Payment", "payer": "{{payer}}", "payee": "{{payee}}",
  "token": "{{token}}", "locale": "{{locale}}", "specification": "{{specification}}" }
```

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
`event: <type>`, a line `data: <JSON>`, then a blank line. A step with no fields, such as `Cancel`, can omit the `data:` line. CommerceOS reads the JSON and adds `type`.
It splits messages at `\n\n`, joins several `data:` lines with a newline, ignores `id:`, `retry:` and
comment lines, and assumes one space after each colon. A stream holds zero or more intermediate steps and exactly one final step.

| Step | Kind | Fields | Meaning |
|---|---|---|---|
| `Create` | intermediate | `result: PaymentDto` | a session exists at the provider. More steps follow |
| `Cancellable` | intermediate | `cancellationToken` | CommerceOS can now cancel (section 6). Send a `Wait` step after it: the POS shows the cancel button on the waiting dialog, and nothing on `Cancellable` alone |
| `Wait` | intermediate | `message?`, `element?`, `translationKey?`, `params?` | show a waiting message |
| `ShowImage` | intermediate | `url`, `audience?` | show an image, for example a QR code |
| `VisitPage` | intermediate | `url`, `audience?` | open a web page |
| `RenderView` | intermediate | `path`, `config`, `audience?` | render a view |
| `Complete` | final | `result: PaymentDto`, `issuedWalletKey?` | success. CommerceOS creates one payment record per `result.transactions[]` item |
| `Decline` | final | `reason`, `params?` | a normal negative outcome. `reason` is a code such as `InsufficientFunds` |
| `Cancel` | final | none | the payment was cancelled |
| `Fail` | final | `errors[]` | an error. The cashier sees `Payment failed: <text>` from `errors[0]` (section 7) |

`audience` is `merchant`, `customer` or `all`. A `Complete` result echoes `methodId`, `amount` and
`currencyCode`, and each transaction echoes the request `token`.

## 6. Transactions, cancel, and reversal arguments

A `paymentKey` whose stream ended in `Decline`, `Cancel` or `Fail` has no payment order, so a new `PUT` for it is a new payment, and a transactions call for it is answered `404` with an error body.

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

A cancel goes to `POST {baseUrl}/payments/{cancellationToken}/cancel` with a `CancelDto`. The token
is the one from the `Cancellable` step. The answer is any 2xx, and the stream then ends with `Cancel`.
The four fields of `CancelDto` carry the local-terminal context, so that a provider can route the cancel to the right terminal.
<!-- fixture: scenarios/fixtures.json#/cancel -->
```json
{ "isLocalTerminal": false }
```

**`means`: what paid.** Set it on every transaction you return. The receipt prints it instead of the
method name, the back office shows it in the *Payment means* column, and the sales reports group by
it. Without it the receipt falls back to the method name, the column stays hidden and the reports
bucket the payment under `--`. A card terminal sends `{ "type": "Card", "scheme": "Visa", "maskedPan": "************1234" }`.
A provider without card data sends its brand as a singleton, the same id on every transaction,
written as the cashier should read it: `{ "type": "Singleton", "id": "Piggy Bank" }`. Do not send
`Card` without a real card: CommerceOS creates a card record per transaction, and a `token` joins an
index shared by every provider. Do not send `Wallet` unless CommerceOS holds the wallet's balance.

## 7. Errors

A failed call answers a non-2xx status with the body `{ "errors": [ ... ] }`. Each item has:

| Field | Required | Meaning |
|---|---|---|
| `message` | yes | a human-readable description |
| `code` | no | a provider-defined code. On a `Fail` step the POS shows the translation of the code when it has one, else `message`. Never `<code>: <message>` |
| `params` | no | positional parameters for a translated message |

A non-2xx answer without that body fails with `Request failed: <status>`, and so does a failed
stream call, because CommerceOS reads no body from it.

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
| `GET`, `PUT`, `DELETE /v1/kv/{container}/{key}` | `kv` | a key-value store for your own state. `container` is a namespaced key such as `com.example.payments` |
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

`status` on a payment order is a set of flags, recomputed from four running amounts on every read, so an order can carry several values.

| `status` value | Meaning |
|---|---|
| `New` | part of the order amount is not yet authorized, annulled, debited or credited |
| `Authorized` | an amount is reserved and not yet captured |
| `Annulled` | a reserved amount was released without capture |
| `Debited` | an amount was captured |
| `Credited` | a captured amount was refunded |

`actions` on a payment record lists what one transaction did. Most transactions carry one action. A
provider that does not separate authorization from capture answers `["Authorize","Debit"]`. The ledger
has three accounts: `source` is the payer's side, `destination` the payee's side, `transit` the money between them at the provider.

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
| `InsufficientFunds` | `Payment declined: Insufficient funds. Available balance is {0}, requested amount is {1}.` Send two `params`. They are inserted as text, so write them as the cashier should read them, for example `"0.00 SEK"` |
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
| The stream drops before a final step | Shows the cashier the transport error in a dialog. The payment order is not marked failed. The cashier's next attempt reuses the same `paymentKey` when no order exists yet, attaches an order that is already `Debited` for the amount without a new call, or takes a fresh key when a non-debited order exists | Treat a second `PUT` with a known `paymentKey` as a resume: answer the same `processorsId` and the same transactions, never a second charge |
| A stream call or a transactions call fails (network error, non-2xx) | Makes no retry. The cashier sees the error and starts the payment again by hand. Data after a final step is ignored | Make every call idempotent on its request: the same `paymentKey`, `token`, `actions` and `amount` answer the same transaction. Send exactly one final step, then close |
| A duplicate `records` item in `PATCH /v1/payment-orders/{key}` (same `methodId` and `transactionId.id`) | Ignores it: no second record, no error, also when the amount differs. The lookup is per method across all orders, not per order | Give every transaction an id that is unique within your method |
| A `records` item after the order is `Debited` | Has no state guard. A late `Debit` or `Authorize` beyond the remaining amount answers 400. A `Credit` up to the debited amount is accepted and adds `Credited` | Post the completion once. Do not post a `Debit` for a sale that the stream already completed |
| A `Complete` whose `processorsId` equals that of an earlier payment order of the same method | Refuses it. The cashier sees `Error: Payment order '<id>' already exists.` and no payment record is created | Make `processorsId` unique per method for all time. A counter that restarts with your process collides with the orders it created before the restart |
| The cashier presses cancel | Calls `POST /payments/{cancellationToken}/cancel` once. A non-2xx shows `Cancel failed: <message>` and the stream keeps running | Answer 2xx, then end the stream with `Cancel` |

## 12. Where every field is defined

Every DTO, every step of the stream and every CommerceOS-side type is defined with a description
per field in the two OpenAPI documents named at the top of this page. `?` in this page marks an
optional field. A decimal is a string such as `"100.00"`. A timestamp is ISO 8601. To read the
documents as pages, open them in any OpenAPI viewer, for example
`npx @redocly/cli preview-docs guide/examples/payment-epi/epi-openapi.yaml`. To start from code,
generate a server stub from `epi-openapi.yaml` and a client from `commerceos-openapi.yaml` with
your OpenAPI generator.
