# Scenarios

One JSON file per scenario of the conformance tool [`epi-check`](../../../../tools/epi-check/README.md), which runs them with
`node tools/epi-check/run.mjs --cos <cosBaseUrl> --key <apiKey> --integration <name>` (or `--local <integrationBaseUrl>` on a laptop) in the fixed order C1, L2 to L5, P1 to P12, E1, E2, H1. C1 is the
CommerceOS-side scenario and has no file: the tool's `cos.mjs` runs it first, and when it fails the others are skipped with its reason.
The JSON examples in [`../reference.md`](../reference.md) quote these files, so a fixture and its example never drift apart.

| Id | Proves |
|---|---|
| C1 | CommerceOS shows the integration as `Active` with a configured node and a method, its `test` reports `success` for every configured node, `assignedTerminals` answers 200 (the known 500 of platform defect D1 is a warning), and the EPI configuration of the node gives the context the other scenarios send |
| L2 | `POST /test` answers `true` under the node's real configuration, read through the real CommerceOS |
| L3 | `GET /config-schema` answers a form description with `members` |
| L4 | `GET /methods` answers at least one method with a unique `methodId` |
| L5 | `GET /terminals` answers a list, and each terminal is readable at `/terminals/{id}` |
| P1 | One-step sale: `Complete` with `["Authorize","Debit"]` |
| P2 | Two-step sale without `debitSynchronously`: `Authorize`, then `Debit` through `POST /transactions` |
| P3 | Two-step sale without `debitSynchronously`: `Authorize`, then release with `Annul` |
| P4 | Sale, then refund with `Credit` and `reversalArgs` |
| P5 | Payout: `Complete` with `["Authorize"]` |
| P6 | Decline with a reason. A reason outside the ten the POS translates is a warning |
| P7 | `Cancellable`, a `Wait` for the cancel button, then `Cancel` after the cancel call |
| P8 | `Fail` with errors |
| P9 | `Wait`, then `Complete` |
| P10 | Resume: the identical `PUT` for a completed key answers the same `processorsId` and transactions, no new charge |
| P11 | Payout with `debitSynchronously: true`: `["Authorize","Debit"]` |
| P12 | Refund twice: two identical partial `Credit` requests (40.00 each, same token) are two refunds, each with its own `transactionId` |
| E1 | `POST /transactions` for a key that never completed: 404 with an error body |
| E2 | Unknown `methodId` on the stream: a 200 stream with one `Fail` step, never a non-2xx |
| H1 | A contextful call without the context headers: 400 with an error body |

There is no install scenario: install is administrator work, done once on CommerceOS, and C1 proves its
result. In local mode the tool's stand-in CommerceOS does that work before C1, and a failed install fails C1. The tool sends every scenario after C1 to the `baseUrl` on the integration record, with the context
headers CommerceOS sends for the node: the `contextConfigId` of the node's EPI configuration, the
`configurationHash` of the assignment, and the debug info `{ nodeName, baseUrl, name }`.

**`debitSynchronously: true` on every till request.** A till sends the flag on every `PaymentInitDto`, Payment and
Payout alike, and CommerceOS refuses a `Complete` under it whose transactions do not leave the order Debited
(the error "Payment was requested to be synchronously debited, but it was not."). So every
Payment scenario that starts a stream sends the flag, as P11 does for a Payout, and the tool checks that the
`Complete` captured: a `Debit` action, in the same transaction as `Authorize` or in a separate one. The two
exceptions are P2 and P3, the only Payment scenarios without the flag: they cover the API-driven reservation
flow, `Authorize` first and `Debit` or `Annul` later through the transactions route, which a till never
starts. P5 is the Authorize-only Payout, also without the flag.

Four checks run on every stream whatever the scenario expects: the stream holds exactly one final step and it is
the last event; a non-2xx status fails, because CommerceOS discards the body on this route and the cashier sees
nothing; a `Cancellable` step is followed by a `Wait` or `ShowImage` step before the final step, because that
is where the POS shows the cancel button; and a `Complete` under `debitSynchronously: true` captured. Across
the run, a `processorsId` that a later scenario repeats fails that scenario: CommerceOS refuses a reused id.

## File shape

```json
{
    "id": "P2",
    "title": "Two-step sale: Authorize, then Debit through POST /transactions",
    "amount": "100.05",
    "steps": [ { "call": "...", "key": "...", "args": { }, "expect": { } } ]
}
```

| Key | Meaning |
|---|---|
| `id` | The scenario id. It names the file, and the profile overrides amounts by it |
| `title` | One line for the report |
| `amount` | The payment amount. The cents select the outcome, see the tutorial section *Test amounts* |
| `steps` | Run in order. The first failure ends the scenario; a warning does not |

## Step shape

| Key | Meaning |
|---|---|
| `call` | A driver method: `configSchema`, `test`, `methods`, `terminals`, `terminal`, `cancel`, `transaction`, `startPayment`. The driver also has `install` and `uninstall`, the two calls CommerceOS makes at the administrator's request; no scenario sends them |
| `key` | The first positional argument: the payment key, the cancellation token, or the terminal id |
| `args` | The request body: a `PaymentInitDto`, `TransactionInitDto` or `CancelDto`, built from `fixtures.json` |
| `forEach` | Repeat this step once per item of the named earlier step's result. `{{item.<field>}}` reads the item |
| `react` | For `startPayment`: a nested step per event type. When that event arrives, the nested step runs before the stream continues. P7 cancels on `Cancellable` |
| `stripContext` | Send the call without the three `X-EPI-*` headers (H1 only). Every integration must answer 400, so H1 runs against partners too |
| `expect` | What must hold. See below |

### `expect`

| Key | Checks |
|---|---|
| `status` | The HTTP status. A number is exact. `"2xx"`, `"4xx"` or `"5xx"` is a class |
| `schema` | The name of a contract type, for example `TransactionDto`. For `startPayment` it is the final event's step. Every event is also validated against `PaymentStep` |
| `each` | Validate every item of an array response against `schema` |
| `minItems` | The array response has at least this many items |
| `unique` | The named field is unique across the array response |
| `keys` | The response object has these keys |
| `equals` | The response equals this JSON value |
| `events` | For `startPayment`: the ordered list of event types. `Wait` steps are ignored unless listed, so a waiting message during P1 still passes |
| `actions` | Per transaction, in order: the exact `actions` array |
| `echo` | Field names that must equal the request. Checked on the response, on `result`, and on every transaction |
| `derivedStatus` | The sorted status set (reference section 9), computed over every transaction the scenario collected so far, with `amount` as the limit |
| `idempotent` | The step repeats the scenario's previous call of the same kind with the same body (reference section 11). For `startPayment` the final `Complete` carries the same `result.processorsId` and the same set of `transactionId`s as the earlier one: a resume, never a second charge (P10). Used for `startPayment` only. The answer is not collected a second time |
| `distinct` | The step repeats the scenario's previous `transaction` with the same body, and it is a second transaction: its `transactionId` differs from the earlier one (P12, reference section 6) |
| `translatedReason` | For a `Decline` final step: a `reason` outside the ten codes the POS translates (reference section 9) adds a warning to the scenario, not a failure. The report shows `pass (warn)` and lists it under *Warnings* (P6) |

## Placeholders

A string that is exactly `{{name}}` is replaced by the value, whatever its type. A placeholder
inside a longer string is replaced by its text.

| Placeholder | Value |
|---|---|
| `{{id}}` | The scenario id |
| `{{runId}}` | Eight hex characters that change with every run, derived from `--now` when given (so a pinned run is reproducible) and random otherwise. Every payment key and token carries it, so a second run against the same integration never reuses a key it stored |
| `{{amount}}` | The scenario amount, after the profile override |
| `{{half}}`, `{{remainder}}` | Two parts that sum to `{{amount}}`, for the two specification items |
| `{{methodId}}` | The first method on the integration record in CommerceOS, or the profile's `methodId`. E2 keeps its own unknown id |
| `{{currencyCode}}` | The fixture currency, or the profile's `currencyCode` |
| `{{token}}`, `{{paymentKey}}`, `{{locale}}`, `{{payer}}`, `{{payee}}`, `{{specification}}`, `{{cancel}}` | The fixture of that name, with `<runId>` and `<id>` filled in: the key is `pay-<runId>-<id>`, the token `tok-<runId>-<id>` |
| `{{baseUrl}}` | The integration's base URL from the record |
| `{{event.<field>}}` | Inside `react`: a field of the event that fired |
| `{{item.<field>}}` | Inside `forEach`: a field of the current item |
| `{{lastTransaction.<field>}}` | A field of the last transaction the scenario collected |
| `{{transactions.<n>.<field>}}` | A field of the n-th transaction the scenario collected, counted from 0. P12 names the sale's transaction in both `Credit` requests, so they are identical |

## Profile file

Optional, given with `--profile`. It holds what your sandbox needs on top of the fixtures:

```json
{
    "methodId": "com.partner.card",
    "amounts": { "P6": "10.01", "P8": "10.02" },
    "terminalId": "TERM-1",
    "currencyCode": "EUR",
    "configuration": { "merchantId": "M-0001", "environment": "TEST" }
}
```

| Key | Effect |
|---|---|
| `methodId` | Replaces the method id from the integration record in every request except E2, which keeps its unknown id. Needed only when the integration has several methods and the first one is not the one to test |
| `amounts` | Per scenario id, replaces `amount`, for a sandbox that selects outcomes by other amounts than the tutorial's cents |
| `terminalId` | Added to every `PaymentInitDto` and `CancelDto`, for a method that requires a terminal |
| `currencyCode` | Replaces the fixture currency in every request |
| `configuration` | Local mode only: the values the stand-in saves on node `Local`, which your `/test` reads. Default `{}`. With `--cos` the tool refuses a profile that carries it: the configuration lives on CommerceOS, entered by the administrator |

## Adding a scenario

Heads owns the scenario set. If your provider needs a scenario that is missing, describe it to
Heads: the amount, the calls in order, and what must hold after each one.
