# Piggy Bank: a sample payment EPI

Piggy Bank is the smallest payment provider that CommerceOS can talk to. It is a payment EPI
(External Partner Interface) in three files: `bank.mjs`, an in-memory bank with sessions and a
ledger; `server.mjs`, the seven contract endpoints on `node:http`; `play.mjs`, a script that acts as
CommerceOS. Node 22, no dependencies, no install. The contract is in `../reference.md`.

## Run it

```bash
node server.mjs                 # the bank, at http://localhost:8787/piggy (PORT to change)
node play.mjs 10.00             # in a second terminal: install, read the methods, pay 10.00
node play.mjs 10.04             # a payment that waits for the customer's phone
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
`PIGGY_WAIT_MS=60000` before `node server.mjs` to tap or cancel by hand.

The tap, with the session id that the `Wait` step prints:

```bash
curl -X POST http://localhost:8787/piggy/tap/PB-1
```

## Test it

```bash
node --test '*.test.mjs'
```

The sample passes the `epi-check` conformance suite that Heads runs against every partner EPI.
