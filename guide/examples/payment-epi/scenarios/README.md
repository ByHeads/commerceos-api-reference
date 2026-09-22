# Scenarios

One JSON file per scenario of the conformance tool [`epi-check`](../../../../tools/epi-check/README.md), which runs them with
`node tools/epi-check/run.mjs --base <your integration base url>` in the fixed order L1 to L5, P1 to P12, E1, E2, H1. The JSON examples in [`../reference.md`](../reference.md)
quote these files, so a fixture and its example never drift apart.

| Id | Proves |
|---|---|
| L1 | `POST /install` accepts the handshake payload |
| L2 | `POST /test` answers `true` under the profile's configuration |
| L3 | `GET /config-schema` answers a form description with `members` |
| L4 | `GET /methods` answers at least one method with a unique `methodId` |
| L5 | `GET /terminals` answers a list, and each terminal is readable at `/terminals/{id}` |
| P1 | One-step sale: `Complete` with `["Authorize","Debit"]` |
| P2 | Two-step sale: `Authorize`, then `Debit` through `POST /transactions` |
| P3 | `Authorize`, then release with `Annul` |
| P4 | Sale, then refund with `Credit` and `reversalArgs` |
| P5 | Payout: `Complete` with `["Authorize"]` |
| P6 | Decline with a reason. A reason outside the ten the POS translates is a warning |
| P7 | `Cancellable`, a `Wait` for the cancel button, then `Cancel` after the cancel call |
| P8 | `Fail` with errors |
| P9 | `Wait`, then `Complete` |
| P10 | Resume: the identical `PUT` for a completed key answers the same `processorsId` and transactions, no new charge |
| P11 | Payout with `debitSynchronously: true`, as every till sends it: `["Authorize","Debit"]` |
| P12 | Refund twice: the identical `Credit` request answers the same transaction |
| E1 | `POST /transactions` for a key that never completed: 404 with an error body |
| E2 | Unknown `methodId` on the stream: a 200 stream with one `Fail` step, never a non-2xx |
| H1 | A contextful call without the context headers: 400 with an error body |

Three checks run on every stream whatever the scenario expects: the stream holds exactly one final step and it is
the last event; a non-2xx status fails, because CommerceOS discards the body on this route and the cashier sees
nothing; and a `Cancellable` step is followed by a `Wait` or `ShowImage` step before the final step, because that
is where the POS shows the cancel button. Across the run, a `processorsId` that a later scenario repeats fails
that scenario: CommerceOS refuses a reused id.

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
| `call` | A driver method: `install`, `uninstall`, `configSchema`, `test`, `methods`, `terminals`, `terminal`, `cancel`, `transaction`, `startPayment` |
| `key` | The first positional argument: the payment key, the cancellation token, or the terminal id |
| `args` | The request body: a `PaymentInitDto`, `TransactionInitDto`, `CancelDto` or `InstallPayload`, built from `fixtures.json` |
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
| `idempotent` | The step repeats the scenario's previous call of the same kind with the same body (reference section 11). For `startPayment` the final `Complete` carries the same `result.processorsId` and the same set of `transactionId`s as the earlier one: a resume, never a second charge (P10). For `transaction` the `transactionId` is the earlier one (P12). The answer is not collected a second time |
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
| `{{token}}`, `{{paymentKey}}`, `{{methodId}}`, `{{currencyCode}}`, `{{locale}}`, `{{payer}}`, `{{payee}}`, `{{specification}}`, `{{install}}`, `{{cancel}}` | The fixture of that name, with `<runId>` and `<id>` filled in: the key is `pay-<runId>-<id>`, the token `tok-<runId>-<id>` |
| `{{baseUrl}}` | The target base URL, for the debug header |
| `{{cosBaseUrl}}` | The URL of the tool's CommerceOS stand-in, for the install payload |
| `{{event.<field>}}` | Inside `react`: a field of the event that fired |
| `{{item.<field>}}` | Inside `forEach`: a field of the current item |
| `{{lastTransaction.<field>}}` | A field of the last transaction the scenario collected |
| `{{transactions.<n>.<field>}}` | A field of the n-th transaction the scenario collected, counted from 0. P12 names the sale's transaction in both `Credit` requests, so they are identical |

## Profile file

Every partner runs the tool with a profile file, given with `--profile`. It overrides the fixtures,
and `methodId` is the reason it is never omitted: the fixture id is not yours:

```json
{
    "currencyCode": "EUR",
    "methodId": "com.partner.card",
    "configuration": { "apiKey": "test-key", "environment": "TEST" },
    "amounts": { "P6": "10.01", "P8": "10.02" },
    "terminalId": "TERM-1"
}
```

| Key | Effect |
|---|---|
| `currencyCode` | Replaces the fixture currency in every request |
| `methodId` | Replaces the fixture method id in every request except E2, which keeps its unknown id. Without it every payment scenario gets the `Fail` that only E2 expects |
| `configuration` | What the tool's CommerceOS stand-in answers for `GET /v1/context/config/{configId}`: the values your `/test` reads and checks. Default `{}`, which makes L2 fail for a `/test` that checks anything |
| `amounts` | Per scenario id, replaces `amount` |
| `terminalId` | Added to every `PaymentInitDto` and `CancelDto`, for a method that requires a terminal |

## Adding a scenario

Heads owns the scenario set. If your provider needs a scenario that is missing, describe it to
Heads: the amount, the calls in order, and what must hold after each one.
