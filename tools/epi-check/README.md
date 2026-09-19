# epi-check

A dependency-free Node 22 tool that acts as CommerceOS and calls your payment EPI (External
Partner Interface) at a base URL. It runs the same sixteen scenarios that Heads runs before an
EPI goes live, and reports pass or fail per scenario. It ships with a reference EPI server, so
it tests itself. The contract it checks: [Payment EPI reference](../../guide/examples/payment-epi/reference.md).

## What it proves

| Area | Passes when |
|---|---|
| Lifecycle | `POST /install` accepts the handshake. `POST /test` returns `true`. `GET /config-schema` returns a form description with `members`. `GET /methods` returns at least one method with a unique `methodId`. `GET /terminals` returns a list, and each terminal is readable at `/terminals/{id}` |
| Payment stream | `PUT /payments/{key}` answers `text/event-stream`, with zero or more intermediate steps and exactly one final step. A `Complete` result echoes `methodId`, `amount` and `currencyCode`, and each transaction echoes the request `token` and carries only known actions |
| Transactions | `POST /payments/{key}/transactions` for capture, release and refund returns a transaction with `transactionId` and `timestamp`. The order status derived from all transactions equals the expected set |
| Cancel | After a `Cancellable` step, `POST /payments/{cancellationToken}/cancel` returns 2xx and the stream ends with `Cancel`. A `Wait` step in between is allowed, and the POS needs one to show the cancel button |
| Errors | A bad request yields a non-2xx status with `{ "errors": [ { "message": ... } ] }` |
| Headers | Contextful calls carry `X-EPI-Context-Config-Id`, `X-EPI-Context-Config-Hash` and `X-EPI-Debug-Info`. Bare calls (`/install`, `/uninstall`, `/config-schema`) carry none |

The header scenario `H1` strips the headers on purpose, so it runs only against the bundled
reference server and is skipped against your EPI. Expect 15 pass, 0 fail, 1 skip.

## Run it against your EPI

```
node tools/epi-check/run.mjs --base https://your-host.example/cos/payment
```

Try it first against the Piggy Bank sample: start `node guide/examples/payment-epi/sample/server.mjs`
in one terminal, then in another run
`node tools/epi-check/run.mjs --base http://localhost:8787/piggy --profile tools/epi-check/piggy-profile.json`.
The profile names the sample's method id, see the next section.
`--reference` runs the sixteen scenarios against the bundled server instead, and exits 0.
`--timeout <ms>` bounds every call (default 10000). `--out <dir>` chooses the report folder.

## The profile file

The cents of the amount select the outcome (`.00` complete, `.01` decline, `.02` fail, `.03`
cancellable, `.04` wait, `.05` authorize only, see the reference, section 10). If your sandbox
selects outcomes another way, give the tool a profile with `--profile partner.json`. Every key
is optional:

```json
{
    "currencyCode": "EUR",
    "methodId": "com.partner.card",
    "amounts": { "P6": "10.01", "P8": "10.02" },
    "terminalId": "TERM-1"
}
```

`amounts` gives a scenario the amount that scripts its outcome in your sandbox. `terminalId` is
added to every payment and cancel request, for a method that requires a terminal. The full key
list is in [scenarios/README.md](../../guide/examples/payment-epi/scenarios/README.md).

## How to read the report

The tool prints one table row per scenario and lists each failure under it: the step that
failed, the JSON path in the response, and what was expected. The first failing step ends the
scenario. The run exits 0 only when every scenario passes. The same report goes to `--out`,
default `./epi-check-reports/<date>-<host>/`:

| File | Holds |
|---|---|
| `report.md` | The printed table |
| `report.json` | Per scenario: `id`, `title`, `result`, `failures`, `calls`. Two runs with the same inputs are byte-identical |
| `meta.json` | `target`, `generatedAt`, `contractCommit`, `durationMs` |

Send `report.md` to Heads with a question about a failure. The `path` column names the field.

## Test the tool itself

```
node --test 'tools/epi-check/*.test.mjs'
```

The scenarios live in `guide/examples/payment-epi/scenarios/`, one JSON file each, next to the
tutorial that quotes them. `run.mjs` names the folder in one constant.

`openapi.mjs` writes `guide/examples/payment-epi/epi-openapi.yaml`, the OpenAPI 3.1 document of the
ten routes, from `contract/dto.schema.json` and a route table in the script. `--check` exits 1 when
the file on disk is stale. Run it after any change to the contract schema.
