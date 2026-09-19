# Scenarios

One JSON file per scenario of the conformance tool [`epi-check`](../../../../tools/epi-check/README.md), which runs them with
`node tools/epi-check/run.mjs --base <your EPI base url>` in the fixed order L1, L2, L3, L4, L5, P1 to P9, E1, H1. The JSON examples in [`../reference.md`](../reference.md)
quote these files, so a fixture and its example never drift apart.

## File shape

```json
{
    "id": "P2",
    "title": "Two-step sale: Authorize, then Debit through POST /transactions",
    "amount": "100.05",
    "referenceOnly": false,
    "steps": [ { "call": "...", "key": "...", "args": { }, "expect": { } } ]
}
```

| Key | Meaning |
|---|---|
| `id` | The scenario id. It names the file, and the profile overrides amounts by it |
| `title` | One line for the report |
| `amount` | The payment amount. The cents select the outcome, see the tutorial section *Test amounts* |
| `referenceOnly` | `true` marks a scenario that runs only with `--reference`. H1 needs to strip headers, which proves nothing against a partner |
| `steps` | Run in order. The first failure ends the scenario |

## Step shape

| Key | Meaning |
|---|---|
| `call` | A driver method: `install`, `uninstall`, `configSchema`, `test`, `methods`, `terminals`, `terminal`, `cancel`, `transaction`, `startPayment` |
| `key` | The first positional argument: the payment key, the cancellation token, or the terminal id |
| `args` | The request body: a `PaymentInitDto`, `TransactionInitDto`, `CancelDto` or `InstallPayload`, built from `fixtures.json` |
| `forEach` | Repeat this step once per item of the named earlier step's result. `{{item.<field>}}` reads the item |
| `react` | For `startPayment`: a nested step per event type. When that event arrives, the nested step runs before the stream continues. P7 cancels on `Cancellable` |
| `stripContext` | Send the call without the three `X-EPI-*` headers (H1 only) |
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

## Placeholders

A string that is exactly `{{name}}` is replaced by the value, whatever its type. A placeholder
inside a longer string is replaced by its text.

| Placeholder | Value |
|---|---|
| `{{id}}` | The scenario id |
| `{{amount}}` | The scenario amount, after the profile override |
| `{{half}}`, `{{remainder}}` | Two parts that sum to `{{amount}}`, for the two specification items |
| `{{token}}`, `{{paymentKey}}`, `{{methodId}}`, `{{currencyCode}}`, `{{locale}}`, `{{payer}}`, `{{payee}}`, `{{specification}}`, `{{install}}`, `{{cancel}}` | The fixture of that name, with `<id>` filled in |
| `{{baseUrl}}` | The target base URL, for the debug header |
| `{{event.<field>}}` | Inside `react`: a field of the event that fired |
| `{{item.<field>}}` | Inside `forEach`: a field of the current item |
| `{{lastTransaction.<field>}}` | A field of the last transaction the scenario collected |

## Profile file

A partner sandbox scripts outcomes its own way. A profile file, given with `--profile`, overrides
the fixtures:

```json
{
    "currencyCode": "EUR",
    "methodId": "com.partner.card",
    "amounts": { "P6": "10.01", "P8": "10.02" },
    "terminalId": "TERM-1"
}
```

| Key | Effect |
|---|---|
| `currencyCode` | Replaces the fixture currency in every request |
| `methodId` | Replaces the fixture method id in every request except E1, which keeps its unknown id |
| `amounts` | Per scenario id, replaces `amount` |
| `terminalId` | Added to every `PaymentInitDto` and `CancelDto`, for a method that requires a terminal |

## Adding a scenario

Heads owns the scenario set. If your provider needs a scenario that is missing, describe it to
Heads: the amount, the calls in order, and what must hold after each one.
