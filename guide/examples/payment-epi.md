# Build a payment integration

A payment integration is the HTTP service that you build so that CommerceOS can take, capture,
release and refund payments through your provider. It follows the payment EPI (External Partner
Interface), which is the Heads specification of the calls between CommerceOS and your service.
This page gets you from nothing to a working integration in one sitting. The contract is in
[Payment EPI reference](./payment-epi/reference.md).

**Base URL:** `https://example.app.heads.com/api/v1`
**API Key:** `banana` (passed via Basic Auth with empty username: `-u ":banana"`)

> **See also:** [Examples Index](../examples.md) | [Configuration](./configuration.md) § EPI Integrations

---

## 1. The picture

One sale, paid with a phone tap, from the cashier to the receipt.

```mermaid
sequenceDiagram
    participant Cashier
    participant POS
    participant CommerceOS
    participant Integration as Your integration
    participant Bank as Piggy Bank
    Cashier->>POS: Pay 10.04 with Piggy Bank
    POS->>CommerceOS: Start the payment
    CommerceOS->>Integration: PUT /payments/{key} (context headers, PaymentInitDto)
    Integration->>Bank: Open a session
    Integration-->>CommerceOS: stream step Wait ("Waiting for the customer's phone")
    CommerceOS-->>POS: Show the waiting message
    Cashier->>Bank: The customer taps the phone
    Bank-->>Integration: Session paid
    Integration-->>CommerceOS: stream step Complete (PaymentDto, one transaction)
    CommerceOS->>CommerceOS: Create the payment record
    CommerceOS-->>POS: Payment done
    POS-->>Cashier: Receipt
```

CommerceOS starts every payment with one HTTP call to your integration. The response is not one JSON body.
It is a stream of steps, one per line of progress. A `Wait` step tells the cashier what happens. A
`Complete` step ends the stream with the money that moved. CommerceOS turns each transaction of that
step into a payment record on the payment order. The receipt then closes. Your integration never calls the
POS, and the POS never calls your integration. Everything goes through CommerceOS, and your integration talks to your own provider in between. Four more flows: [flows](./payment-epi/flows.md).

## 2. Ten minutes

Piggy Bank is a sample integration in four files, Node 22, no dependencies. Clone the repository and
start it.

```bash
git clone https://github.com/ByHeads/commerceos-api-reference.git
cd commerceos-api-reference/guide/examples/payment-epi/sample
node server.mjs
# Piggy Bank integration at http://127.0.0.1:8787/piggy (tap and cancel window 3000 ms)
```

In a second terminal, play the CommerceOS side. The play script installs the integration, reads the
methods, and starts one payment. It prints every step of the stream.

```bash
node play.mjs 10.00
# Method com.example.piggy (Piggy Bank)
# → Complete {"result":{"processorsId":"PB-mucmciak-1","methodId":"com.example.piggy","amount":"10.00","currencyCode":"SEK","transactions":[{"transactionId":"PB-mucmciak-2","actions":["Authorize","Debit"],"amount":"10.00","currencyCode":"SEK","methodId":"com.example.piggy","token":"tok-10.00","specification":[{"identifier":"ART-0001","description":"Sample article","quantity":"1","unit":"pcs","totalAmount":"10.00","vatPercentage":"25","currencyCode":"SEK"}],"timestamp":"2026-09-22T11:56:50.454Z","means":{"type":"Singleton","id":"Piggy Bank"}}]}}
# transactionId  actions          amount  currencyCode  token      timestamp
# -------------  ---------------  ------  ------------  ---------  ------------------------
# PB-mucmciak-2  Authorize+Debit  10.00   SEK           tok-10.00  2026-09-22T11:56:50.454Z
```

Every id the bank hands out starts with a prefix that changes on each start, because CommerceOS
requires a `processorsId` to be unique per method for all time. Now the sale from the picture. An
amount that ends in `.04` waits for the customer's phone. Start the server with a longer window, so
that you can tap by hand.

```bash
PIGGY_WAIT_MS=60000 node server.mjs      # first terminal
node play.mjs 10.04                      # second terminal
# Method com.example.piggy (Piggy Bank)
# → Wait {"message":"Waiting for the customer's phone","params":["PB-mucmciak-3"]}
#   tap:    curl -X POST http://127.0.0.1:8787/piggy/tap/PB-mucmciak-3
```

Run the tap command from a third terminal. The stream completes.

```bash
curl -X POST http://127.0.0.1:8787/piggy/tap/PB-mucmciak-3
# → Complete {"result":{"processorsId":"PB-mucmciak-3","methodId":"com.example.piggy","amount":"10.04","currencyCode":"SEK","transactions":[{"transactionId":"PB-mucmciak-4","actions":["Authorize","Debit"],"amount":"10.04","currencyCode":"SEK","methodId":"com.example.piggy","token":"tok-10.04","specification":[{"identifier":"ART-0001","description":"Sample article","quantity":"1","unit":"pcs","totalAmount":"10.04","vatPercentage":"25","currencyCode":"SEK"}],"timestamp":"2026-09-22T11:56:53.521Z","means":{"type":"Singleton","id":"Piggy Bank"}}]}}
# transactionId  actions          amount  currencyCode  token      timestamp
# -------------  ---------------  ------  ------------  ---------  ------------------------
# PB-mucmciak-4  Authorize+Debit  10.04   SEK           tok-10.04  2026-09-22T11:56:53.521Z
```

The server log adds `kv pay-... not written`: the bank records the waiting session in the CommerceOS
key-value store, and no CommerceOS runs on your machine. `--cos` starts a stand-in for that side. It
answers the token endpoint, the configuration behind a context id and the key-value store, and every
call to it shows as a `[cos]` line:

```bash
node play.mjs 10.04 --cos
# [cos] POST /oauth2/v1/token 200
# [cos] GET /api/v1/context/config/EPI1 200
# Test: true
# Method com.example.piggy (Piggy Bank)
# [cos] POST /oauth2/v1/token 200
# → Wait {"message":"Waiting for the customer's phone","params":["PB-mucmppuu-1"]}
#   tap:    curl -X POST http://127.0.0.1:8787/piggy/tap/PB-mucmppuu-1
# [cos] PUT /api/v1/kv/com.example.piggy/pay-1790078826817 200
# → Complete {...}
# [cos] POST /oauth2/v1/token 200
# [cos] PUT /api/v1/kv/com.example.piggy/pay-1790078826817 200
```

The first three lines are the configuration round trip: the bank fetches a token with the client it
received at install, reads the configuration behind the context id, checks it against its own
`config-schema`, and answers `true` to `/test`.

## 3. What you build

Ten routes under one base URL. CommerceOS holds that base URL on a *payment integration* record
and appends a fixed path per call. A *bare* call carries no context headers. A *contextful* call
carries the three context headers of the reference, section 3. Reject one that arrives without them.
The contract is two OpenAPI 3.1 documents: [`epi-openapi.yaml`](./payment-epi/epi-openapi.yaml) for these ten routes, with every field described and
each operation saying when CommerceOS calls it, and [`commerceos-openapi.yaml`](./payment-epi/commerceos-openapi.yaml) for the calls your integration
makes back. Generate a server stub from the first and a client from the second with your OpenAPI generator.

| Route | Kind | Answers |
|---|---|---|
| `POST /install` | bare | any 2xx. The body holds the OAuth2 client that your integration uses to call CommerceOS back |
| `POST /uninstall` | bare | any 2xx |
| `GET /config-schema` | bare | a form description: the fields that an administrator fills in per store |
| `POST /test` | contextful | JSON `true` |
| `GET /methods` | contextful | the payment methods that you offer, `MethodDto[]`. `configure` copies them into method records; the administrator adds the rest (reference, section 2) |
| `GET /terminals` | contextful | the terminals that this configuration knows, `TerminalDto[]` |
| `GET /terminals/{terminalId}` | contextful | one `TerminalDto` |
| `PUT /payments/{paymentKey}` | contextful | a stream of steps that ends in `Complete`, `Decline`, `Cancel` or `Fail` |
| `POST /payments/{paymentKey}/transactions` | contextful | one `TransactionDto`: a capture, a release or a refund |
| `POST /payments/{cancellationToken}/cancel` | contextful | any 2xx. The stream then ends with `Cancel` |

Calls go in two directions, and each direction has its own authentication.

**Your integration calls CommerceOS with an OAuth2 client.** Your integration holds no API key. A
Heads administrator creates a confidential OAuth2 client for the integration and then runs
`install`. CommerceOS sends `cosBaseUrl`, `tokenUrl`, `clientId`, `clientSecret` and `scope` in the
body of `POST /install`. Store them. Your integration gets a client-credentials token from
`tokenUrl` and sends it as a bearer token on every call to CommerceOS. The client is limited to
what an integration needs: the configuration behind a context id, a key-value store for your own
state, and payment orders and payment records, for example to complete a payment that ends
asynchronously (reference, section 8). A second install sends the same client again.

**CommerceOS calls your integration without a credential.** CommerceOS calls your integration for
everything in the table. The three context headers identify the configuration, and nothing
identifies the caller. Protect the endpoint at the network level. How you do that is your choice.

## 4. A tour of the sample

| File | Role |
|---|---|
| `sample/bank.mjs` | the in-memory bank: sessions, a ledger, and `tap(sessionId)` for the customer's phone |
| `sample/server.mjs` | the integration: the ten routes, the header check, the configuration read behind `/test`, the stream, transactions and cancel |
| `sample/play.mjs` | the CommerceOS side: install, methods, one payment, every step printed |
| `sample/cos.mjs` | a stand-in for the calls back: token, the configuration behind a context id, key-value store, payment-order completion |

The header check. Every route below this line is contextful, so one test covers them all.

```js
// Section 3: every call below is contextful. Section 7 gives the error shape.
if (typeof request.headers["x-epi-context-config-id"] !== "string") {
    return json(response, 400, errorBody("Missing X-EPI-Context-Config-Id header"));
}
```

The configuration round trip. `GET /config-schema` declares two fields, `merchantId` and `environment`. An
administrator fills them in, and `POST /test` reads them back through the context id and checks them.
The same helper serves a payment route that needs the merchant id.

```js
async function readConfig(request) {
    const id = request.headers["x-epi-context-config-id"];
    const hash = request.headers["x-epi-context-config-hash"];
    if (hash && configByHash.has(hash)) return configByHash.get(hash);
    const response = await fetch(cosApi(`/context/config/${encodeURIComponent(id)}`), { headers: { authorization: await bearer(), accept: "application/json" }, signal: AbortSignal.timeout(2000) });
    if (!response.ok) throw new Error(`config ${response.status}`);
    const { configuration = {}, configurationHash } = await response.json();
    configByHash.set(configurationHash ?? hash, configuration);
    return configuration;
}
// ...
const configProblems = configuration => [
    ...(typeof configuration.merchantId === "string" && configuration.merchantId !== "" ? [] : ["merchantId is missing"]),
    ...(["TEST", "LIVE"].includes(configuration.environment) ? [] : ["environment must be TEST or LIVE"]),
];
```

One step written to the stream: one `event:` line, one `data:` line, a blank line. The response stays open until the final step.

```js
const formatEvent = (type, data) => `event: ${type}\n${data == null ? "" : `data: ${JSON.stringify(data)}\n`}\n`;
// ...
response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
const send = (type, data) => response.write(formatEvent(type, data));
const complete = actions => {
    const { methodId, amount, currencyCode } = dto;
    resultsByKey.set(paymentKey, { processorsId: sessionId, methodId, amount, currencyCode, transactions: [bank.settle(sessionId, actions)] });
    send("Complete", { result: resultsByKey.get(paymentKey) });
};
// ...
send("Wait", { message: "Waiting for the customer's phone", params: [sessionId] });
```

The transactions endpoint. A refund carries `reversalArgs`, so the bank credits the original
session instead of opening a new one.

```js
if ((match = /^POST \/payments\/([^/]+)\/transactions$/.exec(route))) {
    const dto = await readJson(request);
    const sessionId = sessionsByKey.get(decodeURIComponent(match[1]));
    if (!sessionId || bank.session(sessionId).state !== "settled") return json(response, 404, errorBody(`No completed payment ${match[1]}`));
    if (dto?.methodId !== METHOD_ID) return json(response, 400, errorBody(`Unknown method ${dto?.methodId}`));
    const transaction = { ...bank.record(sessionId, dto.reversalArgs ? ["Credit"] : dto.actions, dto.amount), ...(dto.specification ? { specification: dto.specification } : {}) };
    return json(response, 200, transaction);
}
```

## 5. Connect it to CommerceOS

A Heads administrator does these seven steps, with an administrator key. You do not run them
against a Heads environment: send Heads the public URL of your integration, and Heads installs
it. They are shown here so that you know which calls reach your integration and when, and so
that you can run them on a CommerceOS of your own. Each step is one curl, and the order is
load-bearing: step 3 fails without step 2, and step 7 is what puts your method on the till.
Replace `https://piggy.example.com/piggy` with the public URL of your integration.

```bash
# 1) Create the payment integration. name and baseUrl are required.
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/payment-integrations" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"name": "Piggy"},
    "baseUrl": "https://piggy.example.com/piggy"
  }'
```

```bash
# 2) Create a user for the integration, with one confidential OAuth2 client. install fails
#    without it, because install hands this client to your integration: it is the only
#    credential that your integration gets. The agent is the integration's database key:
#   curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/payment-integrations/name=Piggy/identifiers/key"
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/users" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.userId": "user-piggy-integration"},
    "agent": {"identifiers": {"key": "<integration key>"}},
    "oauth2Clients": [{
      "identifiers": {"clientID": "piggy-integration-client"},
      "scopes": ["me", "geo:read", "orders.sales:write", "orders.payments:write", "payment-records:write", "kv"],
      "secret": "<a secret you generate>",
      "accessTokenLifetimeSeconds": 3600,
      "refreshTokenLifetimeSeconds": 2592000,
      "grants": ["client_credentials"],
      "isConfidential": true,
      "node": {"identifiers": {"com.heads.seedID": "ourcompany"}}
    }]
  }'
```

```bash
# 3) Install. CommerceOS calls POST {baseUrl}/install. On success the status becomes Active.
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/payment-integrations/name=Piggy" \
  -H "Content-Type: application/json" \
  -d '{"install": true}'
```

```bash
# 4) Create the EPI configuration on an organization node. Both references need database keys:
#   curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/payment-integrations/name=Piggy/identifiers/key"
#   curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/companies/com.heads.seedID=ourcompany/identifiers/key"
# The configuration object holds the fields that your /config-schema describes. The answer
# carries contextConfigId, a four-character id that CommerceOS generates: it is the value of
# X-EPI-Context-Config-Id on every later contextful call for this node.
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/epi-configurations" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.configId": "company-piggy-config"},
    "integration": {"identifiers": {"key": "<integration key>"}},
    "node": {"identifiers": {"key": "<node key>"}},
    "configuration": {"merchantId": "M-0001", "environment": "TEST"}
  }'
```

```bash
# 5) Configure. CommerceOS calls GET {baseUrl}/methods with the context of this node and
#    creates one payment method per item.
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/epi-configurations/com.myapp.configId=company-piggy-config" \
  -H "Content-Type: application/json" \
  -d '{"configure": true}'
```

```bash
# 6) Test. CommerceOS calls POST {baseUrl}/test once per configured node.
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/payment-integrations/name=Piggy/test" \
  -H "Content-Type: application/json" \
  -d 'true'
# → { "integrationName": "Piggy", "configurationTests": { "Our Company": "success" } }
```

```bash
# 7) Allow the method on the POS profile. A method that configure created is not on the pay
#    screen until the profile of the till allows it. Without this step the integration tests
#    green and the cashier never sees the button.
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/pos-profiles/posProfileId=default/allowedPaymentMethods" \
  -H "Content-Type: application/json" \
  -d '{"identifiers": {"methodId": "com.example.piggy"}}'
```

**Before the first payment on a till.** Two more things are administrator work, and both block
the first real payment. First the device: in the back office, *Kassa* → *Enheter* (`/cos/devices`),
pick the store in the organization tree that the page shows first, open the device that a POS
terminal is assigned to, and press *Associera*. The button then reads *Avassociera*: that is success.
It binds **the browser that pressed it** to the device, so press it from the browser that will run
the till, not from your own. Then the till: *Kassa* → *Kassa* (`/cos/pos/terminal`). The first visit asks for POS mode,
*Aktivera POS-läge*, which ends the back-office session in that browser, and then asks the cashier to
start the till for the day. To pay with your method: add an article, press *Payments*, then *Pay*
(`F4`), type the amount before you pick a method, and pick yours from the list. Your method is in
that list, not on a tile, until an administrator gives it one. A `Decline`, `Fail` or `Cancel`
closes the pay screen, so the next attempt starts again from *Pay*; `Wait` and `Complete` keep the
sale on screen with the remaining balance.

**Terminals.** A payment method that requires a terminal reaches the POS through a chain of four
records. The arrows show which record points at which.

```mermaid
flowchart LR
    POS[POS terminal] -->|assignedDevice| Device
    PT[Payment terminal] -->|connectedDevice| Device
    PT -->|method| PM[Payment method]
    PI[Payment integration] -->|methods| PM
```

A POS terminal and a payment terminal meet only through the same device. There is no direct link
from a payment terminal to its integration: the link goes through the payment method. Each record in
the chain has an API resource, see [POS examples](./pos.md). A Heads administrator creates
these records: ask for a payment terminal when your method requires one. CommerceOS reads `GET /terminals/{terminalId}` on your integration when it creates its record. `assignedTerminals`
on the payment integration does not list terminals: it lists the organization nodes that hold a configuration, and each node carries a `terminals` member that calls your integration.

## 6. Test amounts

The conformance tool `epi-check` that Heads runs against your endpoint expects the cents of the
amount to select the outcome. The sample follows the same table.

| Cents | Outcome |
|---|---|
| `.00`, and every cents value not listed below | `Complete`, actions `["Authorize","Debit"]`. A `Payout` without `debitSynchronously` gets `["Authorize"]` alone, see below |
| `.01` | `Decline`, reason `InsufficientFunds` |
| `.02` | `Fail`, one error |
| `.03` | `Cancellable`, then `Wait`, then `Cancel` after the cancel call. The `Wait` step puts the cancel button on the cashier's dialog. Without a cancel call, end the stream when your own window runs out: the sample completes |
| `.04` | exactly `Wait`, then `Complete`. No `Create` step: the tool checks the step list as given |
| `.05` | `Complete`, actions `["Authorize"]` only |

On a till every request carries `debitSynchronously: true`, `Payment` and `Payout` alike, so a
`Payout` that completes on a till answers `["Authorize","Debit"]`: the money leaves in the same
call. Only a `Payout` request without `debitSynchronously` gets `["Authorize"]` alone. Answer the
`amount` of a `Payout` positive: CommerceOS stores and shows it negative. A return that the
cashier pays out with your method from the pay screen reaches you as such a `Payout`. Only the
*Refund* action under the cart makes the refund transaction, see
[four more flows](./payment-epi/flows.md) section 3.

Heads runs the tool with a profile file that names your method id and, if your sandbox selects outcomes another way, which amount produces each outcome. Tell Heads both.

## 7. Go live

- [ ] Your endpoint passes [`epi-check`](../../tools/epi-check/README.md), every scenario. Run it yourself: `node tools/epi-check/run.mjs --base <your integration base url> --profile <your profile>`. The profile names your method id and the configuration your `/test` reads; without it every payment scenario fails. Run it against a short wait window: the tool times out a call after ten seconds. **Run it against a second instance of your integration, or a separate state file, never against the process that a CommerceOS installed:** the tool's own `install` replaces the stored client and `cosBaseUrl`. So give your server a
switch for its port and its state file, and start the second instance with both.
- [ ] A contextful call without the three context headers gets a 4xx and an error body.
- [ ] A request your integration cannot take on the stream route is a 200 stream with one `Fail` step, never a non-2xx: CommerceOS discards the body there (reference, section 7).
- [ ] A repeated `PUT` for a completed `paymentKey` answers the same `processorsId` and the same transactions, and `processorsId` is unique for all time.
- [ ] `POST /test` answers per node: it reads the configuration of the context id and checks it.
- [ ] State lives in the CommerceOS key-value store or in your database, never only in memory.
- [ ] `POST /payments/{paymentKey}/transactions` is idempotent: the same request (`paymentKey`, `token`, `actions`, `amount`) answers the same transaction, so a retry from your own infrastructure does not capture twice.
- [ ] Every stream ends with exactly one final step, also on an exception. A stream that closes without one shows the cashier nothing at all.
- [ ] Every call to your provider has a timeout, and a timeout ends the stream with `Fail`.
- [ ] You log the `X-EPI-Debug-Info` header on every contextful call.
- [ ] The base URL is `https://`, and the endpoint is protected at the network level (section 3).
- [ ] Your `Decline` reasons are in the translated list (reference § 9), or you accept the generic text.

## 8. One family, two paths

A payment integration is one kind of EPI integration. Shipment, loyalty and wallet integrations are
the others, and they share the same base: a `baseUrl`, `install`, `uninstall`, and configurations on
organization nodes. The API exposes the family at `/v1/epi-integrations` and each kind at its own
path. A payment integration read through either path returns the same record.
`/v1/payment-integrations` adds the members that only a payment integration has, such as `methods`
and `assignedTerminals`. `install`, `uninstall` and `test` belong to the family and work on both
paths. Use `/v1/payment-integrations` for a payment provider, and `/v1/epi-integrations` only to list every kind at once.

## 9. Glossary

| Term | Meaning |
|---|---|
| EPI | External Partner Interface: the Heads specification of the HTTP calls between CommerceOS and an integration. You build an integration that follows it |
| payment integration | the CommerceOS record of one provider: a name, a `baseUrl`, a status, and its payment methods |
| EPI configuration | the values of one integration on one organization node, for example a merchant id. The form comes from `/config-schema` |
| context | the three headers on a contextful call. They name the configuration that the call runs under |
| organization node | a company, a store or another level of the organization tree. A configuration on a node applies to the nodes below it |
| payment order | what CommerceOS wants paid: an amount, a currency, a payer and a payee. Its key is the `paymentKey` of the stream call |
| payment record | one transaction on a payment order, created from one item of a `Complete` result or one `TransactionDto` |
| payment method | one way to pay that an integration offers, from `GET /methods`. The POS shows it as a button |
| payment terminal | the CommerceOS record of a physical or virtual terminal, linked to a payment method and a device |
