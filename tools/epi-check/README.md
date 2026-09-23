# epi-check

A dependency-free Node 22 tool that tests a payment integration through a CommerceOS. It reads the
integration from the CommerceOS API, checks the CommerceOS side, then calls the integration at the
`baseUrl` the record names, with the context headers CommerceOS sends for one configured node, and runs
the same scenarios that Heads runs before an integration goes live. It reports pass or fail per scenario.
It has two modes and one scenario path:

| Mode | For | What is the CommerceOS |
|---|---|---|
| `--cos` | certification: Heads, or a partner with access to a Heads instance | the real CommerceOS that installed the integration. The tool creates, installs and configures nothing |
| `--local` | a partner building on a laptop with no CommerceOS | a stand-in the tool starts. It plays the administrator: installs the integration with its own client, saves the profile's configuration on a node `Local`, reads the methods. Then the run is exactly the `--cos` run against the stand-in |

The contract it checks: [Payment EPI reference](../../guide/examples/payment-epi/reference.md).

## What it proves

| Area | Passes when |
|---|---|
| Lifecycle | CommerceOS shows the integration as `Active` with at least one configured node and one method, its `test` reports `success` for every configured node, `assignedTerminals` answers 200 (see the D1 note below), and the EPI configuration of the node gives the context the run sends (C1). Then, at the integration with that context: `POST /test` returns `true`, so the integration reads its real configuration through the real CommerceOS. `GET /config-schema` returns a form description with `members`. `GET /methods` returns at least one method with a unique `methodId`. `GET /terminals` returns a list, and each terminal is readable at `/terminals/{id}` |
| Payment stream | `PUT /payments/{key}` answers a 200 `text/event-stream`, with zero or more intermediate steps and exactly one final step, which is the last event. A `Complete` result echoes `methodId`, `amount` and `currencyCode`, and each transaction echoes the request `token` and carries only known actions. Every request from a till carries `debitSynchronously: true`, so every Payment scenario but the two reservation-flow ones (P2, P3) sends it, and a `Complete` under it must capture, with a `Debit` action; CommerceOS refuses the answer otherwise. A Payout under it completes with `["Authorize","Debit"]` |
| Resume and repeats | The identical `PUT` for a completed key answers the same `processorsId` and the same transactions, no new charge. Every `Credit` call is a new transaction, also when its body equals an earlier one: P12 sends two equal partial refunds and expects two different `transactionId`s. A `processorsId` that a later scenario repeats fails it: CommerceOS refuses a reused id |
| Transactions | `POST /payments/{key}/transactions` for capture, release and refund returns a transaction with `transactionId` and `timestamp`. The order status derived from all transactions equals the expected set. For a key that never completed it answers 404 with an error body |
| Cancel | After a `Cancellable` step, a `Wait` or `ShowImage` step follows (the POS shows the cancel button there; `Cancellable` alone shows nothing), `POST /payments/{cancellationToken}/cancel` returns 2xx and the stream ends with `Cancel` |
| Decline | A `Decline` carries a `reason`. One outside the ten codes the POS translates passes with a warning: the cashier reads the raw code |
| Errors | A bad request on any route but the stream yields a non-2xx status with `{ "errors": [ { "message": ... } ] }`. On the stream route a request the integration cannot take, for example an unknown `methodId`, is a 200 stream with one `Fail` step: CommerceOS discards the body of a non-2xx there and the cashier sees nothing |
| Headers | A contextful call without the `X-EPI-*` headers answers 400 with an error body |

Expect 20 pass, 0 fail, 0 skip (a `--cos` run adds "1 with warnings" while the `assignedTerminals` defect below lasts): C1, the CommerceOS-side scenario, then nineteen against the integration.
The scenario list with what each one proves is in
[scenarios/README.md](../../guide/examples/payment-epi/scenarios/README.md). C1 gates the run: when it
fails, the other nineteen are skipped with its reason and the run exits 1. Every payment key and token of
a run carries a run id (`pay-<runId>-P1`), so running the tool twice against the same integration never
repeats a key that your integration stored; `--now <iso>` pins the id, and two pinned runs against the
same integration state write byte-identical reports. The tool does not delete anything: a `--cos` run
leaves the key-value entries that your integration wrote for its scenario keys, one per payment
scenario. Delete them, or let your integration expire them. The tool calls your integration directly, so a
run creates no payment order, payment record or receipt on the CommerceOS.

## Run it against a CommerceOS (`--cos`)

```
node tools/epi-check/run.mjs --cos https://<instance>.app.heads.com --key <apiKey> --integration <name>
```

`--cos` is the CommerceOS base URL, `--key` an API key of that CommerceOS (Basic auth with an empty
user, as every call in the tutorial), `--integration` the name of the payment integration record. The
integration must be installed and configured on a node the way the tutorial's section 5 describes,
because that is what the tool reads:

| From the CommerceOS API | Used for |
|---|---|
| `baseUrl` of the record | where every scenario after C1 is sent |
| the first method of the record | `methodId` in every request, unless the profile names another |
| the configuration assignment of the node (`--node <nodeName>`, default the first on the record) and its EPI configuration | the three `X-EPI-*` context headers: the configuration id, the configuration hash, and the debug info `{ nodeName, baseUrl, name }` |

Point it at the instance that CommerceOS installed, the one a till uses. There is no second instance to
set up and no install payload from the tool: the integration keeps the client and `cosBaseUrl` that the
administrator's install gave it, and `L2` proves that its `/test` reads the configuration the administrator
entered, through the CommerceOS that holds it.

## Run it on a laptop (`--local`)

```
node tools/epi-check/run.mjs --local http://127.0.0.1:8787/piggy --profile partner.json
```

`--local` takes the integration's base URL. `--key`, `--integration` and `--node` are refused with it,
and it excludes `--cos`. The stand-in sends `POST /install` with its own token URL and a generated
client, creates an EPI configuration on node `Local` with the profile's `configuration` (default `{}`),
a context id and a hash, and reads `GET /methods` under that context to create the method records. If
the install fails, C1 fails with the install error and the rest is skipped. `report.md` opens with the
line "Local run against a stand-in CommerceOS: this is not a certification. Heads certifies with --cos
against the installed instance.", and the C1 row reads "Local stand-in: …".

**Point `--local` at a laptop instance, never at the instance that a CommerceOS installed.** The
stand-in's install replaces the client and `cosBaseUrl` that the integration stored, and every call back
to the real CommerceOS fails after the run. Certification does not need that instance twice: `--cos`
tests it without installing anything.

Try it against the Piggy Bank sample: start `node guide/examples/payment-epi/sample/server.mjs`, then
run `--local http://127.0.0.1:8787/piggy` with a profile holding
`{ "configuration": { "merchantId": "M-0001", "environment": "TEST" } }`: 20 pass, twice in a row.

`--timeout <ms>` bounds every call (default 30000). A `Wait` window longer than that fails `P9`, the
wait-then-complete scenario, with `This operation was aborted`: give it at least your longest wait window. `--out <dir>` chooses the report folder, default
`./epi-check-reports/<date>-<cos host>-<integration>/`. `--profile <file>` is described below.

C1's third step, `assignedTerminals`, answers 500 on every current CommerceOS (known platform defect D1,
owned by Heads): the tool records that as a warning, C1 passes, and the run exits 0. Any other failure of
the step is a real one, and it closes the gate.

## The profile file

Optional. What the integration's sandbox needs on top of the fixtures: `methodId` when the integration
has several methods and the first one is not the one to test; `amounts` when the sandbox selects outcomes
by other amounts than the cents of the tutorial's [section 6](../../guide/examples/payment-epi.md#6-test-amounts);
`terminalId` for a method that requires a terminal; `currencyCode` for a sandbox that does not take SEK.
In local mode also `configuration`, the values the stand-in saves on node `Local` and your `/test` reads.
With `--cos` a profile that carries `configuration` is refused: there the configuration lives on
CommerceOS, entered by the administrator. The keys and an example are in
[scenarios/README.md](../../guide/examples/payment-epi/scenarios/README.md) § Profile file.

## How to read the report

The tool prints one table row per scenario and lists each failure under it: the step that
failed, the JSON path in the response, and what was expected. The first failing step ends the
scenario. A warning, listed under its own heading, marks the row `pass (warn)` and does not fail
the run: the contract allows it, but the cashier will notice. Skipped rows share one line under
*Skipped* that names why C1 failed. The run exits 0 only when every scenario passes. The same report
goes to `--out`:

| File | Holds |
|---|---|
| `report.md` | The printed table |
| `report.json` | `mode` (`cos` or `local`), and per scenario: `id`, `title`, `result`, `failures`, `warnings`, `calls`; C1 also `steps`, a skipped scenario also `reason`. Two runs with the same `--now` are byte-identical |
| `meta.json` | `mode`, `cosBaseUrl` (the stand-in's URL in local mode), `integration`, `node`, `methodId`, `baseUrl`, `generatedAt`, `contractCommit`, `durationMs` |

Send `report.md` to Heads with a question about a failure. The `path` column names the field.

## The documentation trial

The acceptance test of the documents themselves: can a coding agent build a payment integration
from the published documents alone, and does the tool pass it?

```
node tools/epi-check/trial.mjs --attempts 3
```

The trial stages the tutorial, the reference, the flows, the two OpenAPI documents and the
scenarios into an empty folder, without the Piggy Bank sample or this tool's source, and asks the
agent for a do-nothing integration in Python on the standard library, method `com.example.trial`,
with a configuration of `merchantId` and `environment`. After each attempt it starts the integration,
runs the tool in local mode against it with `merchantId` `TRIAL-0001` and `environment` `TEST`, and
hands the report back as `FEEDBACK.md`. The agent also writes `NOTES.md`: what the documents left
unclear and what it assumed. Read that file after every run; each line is a documentation fix or a
question for Heads. The run needs the `claude` CLI and Python 3, no CommerceOS, costs a few dollars
per attempt, and writes everything under `epi-check-reports/trial-<date>/`. Run it after any change
to the documents that a partner reads. Result on 2026-09-22, on the sixteen scenarios of that day:
pass on the first attempt, 15 of 15 runnable scenarios, 404 lines of Python, fifteen notes, of which
twelve became document fixes in the same change.

## Test the tool itself

```
node --test 'tools/epi-check/*.test.mjs'
```

The tests use the same stand-in as local mode (`cos-stub.mjs`): the four API routes the tool reads,
under Basic auth, plus what an installed integration calls back (the token endpoint, the configuration
behind a context id, the key-value store), answered by the sample's `cos.mjs` behind it, which the tool
imports rather than copies so the sample folder stays self-contained. The installed integration is the
reference server (`reference-server.mjs`), a complete integration on `node:http` with switchable
defects; installed, it reads its configuration through the CommerceOS that installed it, so `L2` is real
in the self-test too. `test-lab.mjs` installs it on a stand-in with canned records for the `--cos` tests;
`local-mode.test.mjs` runs `--local` against it and against the Piggy Bank sample. The tests prove that
a healthy reference integration gives 20 pass in both modes and the sample 20 pass twice in local mode,
that each defect fails exactly its scenario in both modes, that a failed C1 or a refused install skips
the rest with the reason, that D1 warns and exits 0, that `--node` and the profile's `methodId` pick what
they name, and that the flag rules hold.

The scenarios live in `guide/examples/payment-epi/scenarios/`, one JSON file each, next to the
reference that quotes them. `run.mjs` names the folder in one constant.

`openapi.mjs` writes the two OpenAPI 3.1 documents under `guide/examples/payment-epi/`: `epi-openapi.yaml`
(the ten routes the integration serves) and `commerceos-openapi.yaml` (the calls it makes back), from
`contract/dto.schema.json` and two route tables in the script. Every field description lives in the
schema, so a contract fact has one home. `--check` exits 1 when a file on disk is stale. Run it after
any change to the schema.
