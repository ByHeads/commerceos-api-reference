# epi-check

A dependency-free Node 22 tool that acts as CommerceOS and calls your payment integration at a base
URL. It runs the same sixteen scenarios that Heads runs before an integration goes live, and
reports pass or fail per scenario. It ships with a reference server, so it tests itself. The contract it checks: [Payment EPI reference](../../guide/examples/payment-epi/reference.md).

## What it proves

| Area | Passes when |
|---|---|
| Lifecycle | `POST /install` accepts the handshake. `POST /test` returns `true`. `GET /config-schema` returns a form description with `members`. `GET /methods` returns at least one method with a unique `methodId`. `GET /terminals` returns a list, and each terminal is readable at `/terminals/{id}` |
| Payment stream | `PUT /payments/{key}` answers `text/event-stream`, with zero or more intermediate steps and exactly one final step. A `Complete` result echoes `methodId`, `amount` and `currencyCode`, and each transaction echoes the request `token` and carries only known actions |
| Transactions | `POST /payments/{key}/transactions` for capture, release and refund returns a transaction with `transactionId` and `timestamp`. The order status derived from all transactions equals the expected set |
| Cancel | After a `Cancellable` step, `POST /payments/{cancellationToken}/cancel` returns 2xx and the stream ends with `Cancel`. A `Wait` step in between is allowed, and the POS needs one to show the cancel button |
| Errors | A bad request yields a 4xx status with `{ "errors": [ { "message": ... } ] }` |

The header scenario `H1` strips the headers on purpose, so it runs only against the bundled
reference server and is skipped against your integration. Expect 15 pass, 0 fail, 1 skip.

The tool also plays the CommerceOS side. The install payload of `L1` points at a stand-in that the tool
starts for the run: it answers the token endpoint for the fixture's client, serves the configuration of
the profile's `configuration` key (default `{}`) as `GET /v1/context/config/{configId}` under the context
hash of the fixture, and keeps a key-value store. So `L2` tests a `/test` that reads its configuration:
give the tool the values your schema needs, or `L2` reports the `false` your integration answers.

## Run it against your integration

```
node tools/epi-check/run.mjs --base https://your-host.example/cos/payment
```

Try it first against the Piggy Bank sample: start `node guide/examples/payment-epi/sample/server.mjs`
in one terminal, then in another run
`node tools/epi-check/run.mjs --base http://localhost:8787/piggy --profile tools/epi-check/piggy-profile.json`.
The profile names the sample's method id, see the next section.
`--reference` runs the sixteen scenarios against the bundled server instead, and exits 0.
`--timeout <ms>` bounds every call (default 10000). `--out <dir>` chooses the report folder.
`--cos <cosBaseUrl> --key <apiKey> --integration <name>` runs the one CommerceOS-side scenario instead:
it reads the installed integration through the API and checks that it is `Active` and that `test` succeeds per node.

## The profile file

The cents of the amount select the outcome, see the tutorial
[section 6](../../guide/examples/payment-epi.md#6-test-amounts). If your sandbox selects outcomes another way, give the tool a profile with `--profile partner.json`:
it names your method id, the configuration your `/test` expects to read, amounts per scenario, and a
terminal id. The keys and an example are in [scenarios/README.md](../../guide/examples/payment-epi/scenarios/README.md) § Profile file.

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

## The documentation trial

The acceptance test of the documents themselves: can a coding agent build a payment integration
from the published documents alone, and does the tool pass it?

```
node tools/epi-check/trial.mjs --attempts 3
```

The trial stages the tutorial, the reference, the flows, the two OpenAPI documents and the
scenarios into an empty folder, without the Piggy Bank sample or this tool's source, and asks the
agent for a do-nothing integration in Python on the standard library, method `com.example.trial`.
After each attempt it starts the integration, runs the sixteen scenarios against it, and hands the
report back as `FEEDBACK.md`. The agent also writes `NOTES.md`: what the documents left unclear and
what it assumed. Read that file after every run; each line is a documentation fix or a question
for Heads. The run needs the `claude` CLI and Python 3, costs a few dollars per attempt, and
writes everything under `epi-check-reports/trial-<date>/`. Run it after any change to the
documents that a partner reads. Result on 2026-09-22: pass on the first attempt, 15 of 15
runnable scenarios, 404 lines of Python, fifteen notes, of which twelve became document fixes in
the same change.

## Test the tool itself

```
node --test 'tools/epi-check/*.test.mjs'
```

The scenarios live in `guide/examples/payment-epi/scenarios/`, one JSON file each, next to the
reference that quotes them. `run.mjs` names the folder in one constant.

`openapi.mjs` writes the two OpenAPI 3.1 documents under `guide/examples/payment-epi/`: `epi-openapi.yaml`
(the ten routes the integration serves) and `commerceos-openapi.yaml` (the calls it makes back), from
`contract/dto.schema.json` and two route tables in the script. Every field description lives in the
schema, so a contract fact has one home. `--check` exits 1 when a file on disk is stale. Run it after
any change to the schema.
