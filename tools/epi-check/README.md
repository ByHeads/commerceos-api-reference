# epi-check

A dependency-free Node 22 tool that acts as CommerceOS and calls your payment integration at a base
URL. It runs the same twenty scenarios that Heads runs before an integration goes live, and
reports pass or fail per scenario. It ships with a reference server, so it tests itself. The contract it checks: [Payment EPI reference](../../guide/examples/payment-epi/reference.md).

## What it proves

| Area | Passes when |
|---|---|
| Lifecycle | `POST /install` accepts the handshake. `POST /test` returns `true`. `GET /config-schema` returns a form description with `members`. `GET /methods` returns at least one method with a unique `methodId`. `GET /terminals` returns a list, and each terminal is readable at `/terminals/{id}` |
| Payment stream | `PUT /payments/{key}` answers a 200 `text/event-stream`, with zero or more intermediate steps and exactly one final step, which is the last event. A `Complete` result echoes `methodId`, `amount` and `currencyCode`, and each transaction echoes the request `token` and carries only known actions. Every request from a till carries `debitSynchronously: true`, so every Payment scenario but the two reservation-flow ones (P2, P3) sends it, and a `Complete` under it must capture, with a `Debit` action; CommerceOS refuses the answer otherwise. A Payout under it completes with `["Authorize","Debit"]` |
| Resume and repeats | The identical `PUT` for a completed key answers the same `processorsId` and the same transactions, no new charge. The identical `Credit` request answers the same transaction. A `processorsId` that a later scenario repeats fails it: CommerceOS refuses a reused id |
| Transactions | `POST /payments/{key}/transactions` for capture, release and refund returns a transaction with `transactionId` and `timestamp`. The order status derived from all transactions equals the expected set. For a key that never completed it answers 404 with an error body |
| Cancel | After a `Cancellable` step, a `Wait` or `ShowImage` step follows (the POS shows the cancel button there; `Cancellable` alone shows nothing), `POST /payments/{cancellationToken}/cancel` returns 2xx and the stream ends with `Cancel` |
| Decline | A `Decline` carries a `reason`. One outside the ten codes the POS translates passes with a warning: the cashier reads the raw code |
| Errors | A bad request on any route but the stream yields a non-2xx status with `{ "errors": [ { "message": ... } ] }`. On the stream route a request the integration cannot take, for example an unknown `methodId`, is a 200 stream with one `Fail` step: CommerceOS discards the body of a non-2xx there and the cashier sees nothing |
| Headers | A contextful call without the `X-EPI-*` headers answers 400 with an error body |

Expect 20 pass, 0 fail, 0 skip. The scenario list with what each one proves is in
[scenarios/README.md](../../guide/examples/payment-epi/scenarios/README.md). Every payment key and token of a
run carries a run id (`pay-<runId>-P1`), so running the tool twice against the same integration never repeats a
key that your integration stored; `--now <iso>` pins the id, and two pinned runs write byte-identical reports.

The tool also plays the CommerceOS side. The install payload of `L1` points at a stand-in that the tool
starts for the run: it answers the token endpoint for the fixture's client, serves the configuration of
the profile's `configuration` key (default `{}`) as `GET /v1/context/config/{configId}` under the context
hash of the fixture, and keeps a key-value store. So `L2` tests a `/test` that reads its configuration:
give the tool the values your schema needs, or `L2` reports the `false` your integration answers.

## Run it against your integration

```
node tools/epi-check/run.mjs --base https://your-host.example/cos/payment --profile partner.json
```

The profile is not optional. Without it every request carries the fixture method id
`com.epicheck.reference`, and every payment scenario fails with the `Fail` step that only `E2` should get:
a dozen failures that look like a bug in your integration. Write the profile first, see the next section.

**Never point the tool at the process that a CommerceOS installed.** Scenario `L1` sends the tool's
own install payload, and a correct integration stores it: after the run the integration holds the
client `epi-check` and a `cosBaseUrl` on a port the tool has closed, and every call back to
CommerceOS fails. Run the tool against a second instance of your integration, or the same code with a
separate state file, and install on CommerceOS afterwards.

Try it first against the Piggy Bank sample: start `node guide/examples/payment-epi/sample/server.mjs`
in one terminal, then in another run
`node tools/epi-check/run.mjs --base http://localhost:8787/piggy --profile tools/epi-check/piggy-profile.json`.
The profile names the sample's method id, see the next section.
`--reference` runs the twenty scenarios against the bundled server instead, and exits 0.
`--reference-defect <name>` switches one defect on in that server, to see what the tool reports for it;
the names are listed in `reference-server.mjs` (for example `authorize-only-under-flag`: P1 answers
`["Authorize"]` although the request carried `debitSynchronously: true`).
`--timeout <ms>` bounds every call (default 10000). A `Wait` window longer than that fails `P9`, the
wait-then-complete scenario, with `This operation was aborted`: run your integration with a short
window while the tool runs, or raise the timeout. `--out <dir>` chooses the report folder.
`--cos <cosBaseUrl> --key <apiKey> --integration <name>` runs the one CommerceOS-side scenario instead:
it reads the installed integration through the API and checks that it is `Active` and that `test` succeeds per node.
Its third step, `assignedTerminals`, answers 500 on every current CommerceOS (known platform defect D1, owned by
Heads): the tool records that as a warning and the run exits 0; any other failure of the step is a real one.

## The profile file

Every run against a partner uses a profile, given with `--profile partner.json`. Two keys matter for
everyone: `methodId`, your method id, and `configuration`, the values your `/test` reads through
`GET /v1/context/config/{configId}`. The default configuration is `{}`, so a `/test` that checks
anything, as the go-live checklist demands, answers `false` and `L2` fails until you fill it in.
The cents of the amount select the outcome, see the tutorial
[section 6](../../guide/examples/payment-epi.md#6-test-amounts); if your sandbox selects outcomes
another way, `amounts` overrides them per scenario. A method that requires a terminal names one in
`terminalId`. The keys and an example are in [scenarios/README.md](../../guide/examples/payment-epi/scenarios/README.md) § Profile file.

## How to read the report

The tool prints one table row per scenario and lists each failure under it: the step that
failed, the JSON path in the response, and what was expected. The first failing step ends the
scenario. A warning, listed under its own heading, marks the row `pass (warn)` and does not fail
the run: the contract allows it, but the cashier will notice. The run exits 0 only when every
scenario passes. The same report goes to `--out`, default `./epi-check-reports/<date>-<host>/`:

| File | Holds |
|---|---|
| `report.md` | The printed table |
| `report.json` | Per scenario: `id`, `title`, `result`, `failures`, `warnings`, `calls`. Two runs with the same `--now` are byte-identical |
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
After each attempt it starts the integration, runs the twenty scenarios against it, and hands the
report back as `FEEDBACK.md`. The agent also writes `NOTES.md`: what the documents left unclear and
what it assumed. Read that file after every run; each line is a documentation fix or a question
for Heads. The run needs the `claude` CLI and Python 3, costs a few dollars per attempt, and
writes everything under `epi-check-reports/trial-<date>/`. Run it after any change to the
documents that a partner reads. Result on 2026-09-22, on the sixteen scenarios of that day: pass on the
first attempt, 15 of 15 runnable scenarios, 404 lines of Python, fifteen notes, of which twelve became document fixes in
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
