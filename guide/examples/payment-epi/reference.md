# Payment EPI reference

The contract between CommerceOS and a payment EPI (External Partner Interface): the HTTP service
that you build so that CommerceOS can take, capture, release and refund payments through your
provider. The tutorial [Build a payment EPI](../payment-epi.md) gets you started. Every JSON
example is a fixture of the conformance tool `epi-check` that Heads runs against your endpoint. An
HTML comment names its file in [`scenarios/`](./scenarios/), and `{{name}}` is filled at run time.

**Base URL of the CommerceOS API:** `https://example.app.heads.com/api/v1`
**Credential in the examples:** `-u ":banana"` (Basic auth, empty user name). In production your integration sends the OAuth2 bearer token of section 8.

## 1. The two directions

CommerceOS calls `{baseUrl}` plus a fixed path with JSON bodies, and one call answers with a
stream (section 5). Those calls carry no credential, only the three context headers of section 3.
Your integration calls `{cosBaseUrl}/api/v1/...` with the OAuth2 client from the install (section 8).

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

The answer of `GET {baseUrl}/methods` for one method as the Piggy Bank sample sends it (fields in section 12), then the install payload:

```json
[ { "methodId": "com.example.piggy", "name": "Piggy Bank",
    "supports": { "incoming": true, "outgoing": true, "reversal": true },
    "requires": { "terminal": false, "specification": false } } ]
```
<!-- fixture: scenarios/fixtures.json#/install -->
```json
{ "cosBaseUrl": "http://localhost:5000", "tokenUrl": "http://localhost:5000/oauth/token",
  "clientId": "epi-check", "clientSecret": "epi-check-secret", "scope": "epi" }
```

`scope` is the space-separated scope list of the OAuth2 client. The `test` method on the API answers
`{ integrationName, configurationTests: { "<node name>": "success" | "fail" } }`. A non-2xx or a thrown error is `fail`.

## 3. Context headers

Every contextful call carries three headers. CommerceOS finds the EPI configuration for the organization node of the call, and a configuration on a parent node applies to the nodes below it.

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

Reject a contextful call without the headers: the tool expects a 4xx status and an error body (section 7).

## 4. Configuration

`GET {baseUrl}/config-schema` returns a form description, not a JSON Schema. CommerceOS renders one
form field per member when an administrator edits the configuration. The shape is
`{ title?, description?, members: { <key>: { type, title?, description?, members? } } }`. `title` and
`description` are a string or a map from locale to string, for example `{ "en-US": "The API key", "sv-SE": "API-nyckeln" }`.

| `type` | Meaning |
|---|---|
| `string`, `number`, `boolean` | a required scalar |
| `string?` | a trailing `?` makes any type optional |
| `'TEST' or 'LIVE'` | one of the quoted values, two or three alternatives |
| `string[]`, `number[]`, `object[]` | a list |
| `object` | a nested object. Give it `members` to describe the nested fields |

The configuration values, for example merchant ids or acquirer keys per store, live in CommerceOS
as an *EPI configuration* on an organization node. Your integration reads them with the OAuth2
client from the install payload: `POST {tokenUrl}` for a token (section 8), then
`GET {cosBaseUrl}/api/v1/context/config/{configId}` with `Authorization: Bearer <token>`. The answer
is `{ "configuration": { ... }, "configurationHash": "..." }`. The `me` scope grants it.

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
`event: <type>`, a line `data: <JSON>`, then a blank line. CommerceOS reads the JSON and adds `type`.
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
| `Fail` | final | `errors[]` | an error, shown to the operator (section 7) |

`audience` is `merchant`, `customer` or `all`. A `Complete` result echoes `methodId`, `amount` and
`currencyCode`, and each transaction echoes the request `token`.

## 6. Transactions, cancel, and reversal arguments

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

## 7. Errors

A failed call answers a non-2xx status with the body `{ "errors": [ ... ] }`. Each item has:

| Field | Required | Meaning |
|---|---|---|
| `message` | yes | a human-readable description |
| `code` | no | a provider-defined code. CommerceOS shows `<code>: <message>` |
| `params` | no | positional parameters for a translated message |

A non-2xx answer without that body fails with `Request failed: <status>`, and so does a failed
stream call, because CommerceOS reads no body from it.

## 8. Calls from your integration to CommerceOS

Every call goes to `{cosBaseUrl}/api{path}` with `Authorization: Bearer <token>`,
`content-type: application/json` and `accept: application/json`. `cosBaseUrl` and `tokenUrl` come
from the install payload (section 2). The examples use `-u ":banana"` in place of the bearer header, so that you can try them with an API key.

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
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/context/config/EPI1"
# → { "configuration": { ... }, "configurationHash": "..." }

# Key-value store: write, read, delete
curl -X PUT -u ":banana" "https://example.app.heads.com/api/v1/kv/com.example.payments/session-pay-P1" \
  -H "Content-Type: application/json" -d '{ "providerSessionId": "S-123", "state": "pending" }'
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/kv/com.example.payments/session-pay-P1"
curl -X DELETE -u ":banana" "https://example.app.heads.com/api/v1/kv/com.example.payments/session-pay-P1"
```

Complete an asynchronous payment. `paymentKey` is the key from `PUT {baseUrl}/payments/{paymentKey}`:

```bash
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/payment-orders/pay-P1" \
  -H "Content-Type: application/json" \
  -d '{ "records": [ {
        "identifiers": { "transactionId": { "method": { "identifiers": { "methodId": "com.example.card" } }, "id": "T-0001" } },
        "currency": { "identifiers": { "currencyCode": "SEK" } },
        "timestamp": "2026-09-18T09:00:00Z", "amount": "100.00",
        "actions": ["Authorize", "Debit"], "token": "tok-P1", "specification": []
      } ] }'
```

A record needs these members, and CommerceOS rejects a record with a missing one.

| Member | Meaning |
|---|---|
| `identifiers.transactionId.id` | your transaction id. `identifiers.transactionId.method.identifiers.methodId` names the method |
| `amount` | a finite, non-zero decimal |
| `currency.identifiers.currencyCode` | the payment currency |
| `actions` | one or more of the four actions (section 9) |
| `timestamp` | ISO 8601 |
| `token` | the request `token`. Without it, CommerceOS takes the available money for the first action |
| `specification`, `means`, `rawData`, `consumerPrintout`, `merchantPrintout` | optional |

## 9. Status and action values

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
| `InsufficientFunds` | `Payment declined: Insufficient funds. Available balance is {0}, requested amount is {1}.` Send two `params` |
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

## 10. Test amounts

The cents of the amount select the outcome: [Build a payment EPI](../payment-epi.md#6-test-amounts).

## 11. What CommerceOS does on your side

| Situation | What CommerceOS does | What you must do |
|---|---|---|
| The stream sends no step for a long time | Sets no timeout of its own. The HTTP runtime closes a stream with no bytes after about five minutes. That limit is the runtime's, not a contract value | Send a final step within minutes, or a `Wait` step at intervals while you wait for the provider |
| The stream drops before a final step | Shows the cashier the transport error in a dialog. The payment order is not marked failed. The cashier's next attempt reuses the same `paymentKey` when no order exists yet, or a fresh key when a non-debited order exists | Treat a second `PUT` with a known `paymentKey` as a resume, not a second charge |
| A stream call or a transactions call fails (network error, non-2xx) | Makes no retry. The cashier sees the error and starts the payment again by hand. Data after a final step is ignored | Make every call idempotent on `paymentKey`, `token` and `transactionId`. Send exactly one final step, then close |
| A duplicate `records` item in `PATCH /v1/payment-orders/{key}` (same `methodId` and `transactionId.id`) | Ignores it: no second record, no error, also when the amount differs. The lookup is per method across all orders, not per order | Give every transaction an id that is unique within your method |
| A `records` item after the order is `Debited` | Has no state guard. A late `Debit` or `Authorize` beyond the remaining amount answers 400. A `Credit` up to the debited amount is accepted and adds `Credited` | Post the completion once. Do not post a `Debit` for a sale that the stream already completed |
| The cashier presses cancel | Calls `POST /payments/{cancellationToken}/cancel` once. A non-2xx shows `Cancel failed: <message>` and the stream keeps running | Answer 2xx, then end the stream with `Cancel` |

## 12. Field appendix

`?` marks an optional field. A decimal is a string such as `"100.00"`. A timestamp is ISO 8601. The same fields as an OpenAPI 3.1 document, for a server stub: [`epi-openapi.yaml`](./epi-openapi.yaml). **Install payload:** `cosBaseUrl`, `tokenUrl`, `clientId`, `clientSecret`, `scope`. All strings, all required.

**MethodDto**

| Field | Meaning |
|---|---|
| `methodId` | unique id of the method within the integration |
| `name` | display name |
| `requires.terminal`, `requires.specification` | booleans: the method needs a terminal, or a specification |
| `supports.incoming`, `supports.outgoing`, `supports.reversal` | booleans: payments in, payouts out, annul and credit |
| `allows?.availableInPos?`, `openCashBoxOnUse?`, `openCashBoxOnReturn?`, `fullAmountFinishesReceipt?` | booleans. Defaults: `true`, `false`, `false`, `false` |

**TerminalDto:** `terminalId`, `methodId`, `name?`, `directUrl?` (how to reach the terminal directly).

**PaymentInitDto**

| Field | Meaning |
|---|---|
| `methodId`, `amount`, `currencyCode` | the method, the decimal amount, the ISO 4217 code |
| `direction` | `Payment` (customer pays) or `Payout` (customer is paid) |
| `payer`, `payee` | `AgentDto` |
| `token` | opaque id of the money this payment is about. Echo it on every transaction |
| `locale` | for example `sv-SE` |
| `specification` | `SpecificationItemDto[]` |
| `debitSynchronously?` | `true` when a payout must be captured in the same call |
| `redirectUrls?` | `completed`, `failed`, `cancelled`: `https://` URLs for a web flow |
| `termsUrl?` | the legal terms of the sale |
| `terminalId?`, `terminalDirectUrl?`, `localProxy?`, `isLocalTerminal?` | the terminal and the local-network route to it |
| `walletCode?`, `walletPin?` | wallet payments such as gift cards |
| `cardAcquisitionReference?` | `poiTransactionId`, `timestamp`: reuse an earlier card tap |

**PaymentDto:** `methodId`, `amount`, `currencyCode`, `processorsId` (the provider's id),
`transactions: TransactionDto[]`, `issuedWalletKey?`.

**TransactionInitDto**

| Field | Meaning |
|---|---|
| `actions` | one or more of `Authorize`, `Annul`, `Debit`, `Credit` |
| `token` | the request token |
| `amount`, `currencyCode`, `methodId` | positive decimal, the payment currency, the method |
| `specification?` | the items. Their total amounts sum to `amount` |
| `walletCode?`, `isLocalTerminal?`, `terminalDirectUrl?`, `localProxy?` | as in `PaymentInitDto` |
| `reversalArgs?` | `ReversalDto` |

**TransactionDto:** `TransactionInitDto` plus `transactionId`, `timestamp`, `means?`, `token?`,
`consumerPrintout?`, `merchantPrintout?`, `rawData?` (any JSON object).

**ReversalDto:** `originalTransactionId?`, `originalTimestamp?`, `terminalId?`.

**CancelDto:** `terminalId?`, `terminalDirectUrl?`, `isLocalTerminal?`, `localProxy?`.

**LocalProxyDto:** `hostname` (reach the proxy at `https://<hostname>/proxy`), `secret` (send as
`Proxy-Authorization: Bearer <secret>`).

**SpecificationItemDto:** `identifier?`, `description`, `quantity`, `unit`, `totalAmount`,
`vatPercentage?`, `currencyCode`.

**AgentDto** is a `PersonDto` or an `OrganizationDto`, told apart by `type`.

| Field | Meaning |
|---|---|
| `type` | `Person` or `Organization` |
| `key` | the CommerceOS key of the agent |
| `fullName?`, `nationalId?`, `email?`, `landlinePhone?`, `mobilePhone?` | contact data. Some providers need `email` |
| `invoiceAddress?`, `deliveryAddress?` | `AddressDto` |
| `givenName?`, `familyName?`, `phoneNumber?` | `Person` only |

**AddressDto:** `lines?` (string list), `postalCode?`, `cityName?`, `regionName?`, `countryCode?` (ISO 3166-1 alpha-2).

**PaymentMeansDto** is one of three shapes, told apart by `type`.

| `type` | Fields |
|---|---|
| `Card` | `scheme?`, `issuer?`, `maskedPan?`, `token?`, `validFrom?`, `validTo?` |
| `Singleton` | `id` |
| `Wallet` | `walletId?`, `providerId?`, `provider?`, `maskedCode?`, `remainingBalance?`, `refillable?`, `validFrom?`, `validTo?` |

**EpiErrorDetail:** `message`, `code?`, `params?` (section 7). **Config schema:** section 4.
