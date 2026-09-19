# Piggy Bank: a sample payment EPI

Piggy Bank is the smallest payment provider that CommerceOS can talk to: a payment EPI (External
Partner Interface) in three files. `bank.mjs` is an in-memory bank with sessions and a ledger,
`server.mjs` the ten contract routes on `node:http`, `play.mjs` a script that acts as CommerceOS.
`cos.mjs` stands in for the calls back to CommerceOS. Node 22, no dependencies, no install. The contract is in `../reference.md`.

## Run it

```bash
node server.mjs                 # the bank, at http://localhost:8787/piggy (PORT to change)
node play.mjs 10.00             # in a second terminal: install, read the methods, pay 10.00
node play.mjs 10.04             # a payment that waits for the customer's phone
node play.mjs 10.04 --cos       # the same, with the CommerceOS stand-in started in-process
```
The cents of the amount select the outcome. Every other amount completes.

| Amount | What the bank does |
|---|---|
| `10.00` | `Complete`, one transaction with actions `["Authorize","Debit"]` |
| `10.01` | `Decline`, reason `InsufficientFunds` |
| `10.02` | `Fail`, one error: the coin slot is jammed |
| `10.03` | `Cancellable`. The play script prints the cancel command. Without a cancel, the payment completes after the window |
| `10.04` | `Wait`, then `Complete` when the customer's phone taps. The phone taps by itself after the window |
| `10.05` | `Complete` with `["Authorize"]` only: a reservation, captured later through `/transactions` |

`--payout` sends the money the other way and gives `["Authorize"]`. The window is 3 seconds. Set
`PIGGY_WAIT_MS=60000` before `node server.mjs` to tap or cancel by hand. The tap, with the session id that the `Wait` step prints: `curl -X POST http://localhost:8787/piggy/tap/PB-1`

## Both directions on one laptop

The bank records a waiting `.04` session in the CommerceOS key-value store (reference, section 8).
Without CommerceOS that write fails, and the server logs `kv pay-... not written`. `--cos` starts
`cos.mjs` inside the play script and installs the bank against it: a token endpoint, the configuration
behind a context id, the key-value store, and `PATCH /api/v1/payment-orders/{key}`, all in memory.
Every call shows as a `[cos]` line in the play output. For an EPI of your own: `node play.mjs 10.04 --base <your EPI base url> --cos`
plays CommerceOS against it, and `node cos.mjs` runs the stand-in alone on port 8790 (`COS_PORT` to change): `cosBaseUrl` `http://localhost:8790`, `tokenUrl` `http://localhost:8790/oauth2/v1/token`, client `play` / `play-secret`.

## Test it

```bash
node --test '*.test.mjs'
```
The sample passes the `epi-check` conformance suite that Heads runs against every partner EPI: 15 pass,
0 fail, 1 skip (the header scenario runs only against the tool's own server, `server.test.mjs` covers it here).
