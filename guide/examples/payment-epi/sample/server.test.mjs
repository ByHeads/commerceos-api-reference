import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startPiggyServer, METHOD_ID } from "./server.mjs";
import { readEvents } from "./play.mjs";
import { startCosStandIn } from "./cos.mjs";

const clock = () => new Date("2026-01-01T00:00:00Z");
const context = { "X-EPI-Context-Config-Id": "EPI1", "X-EPI-Context-Config-Hash": "h", "content-type": "application/json" };
const init = amount => ({
    methodId: METHOD_ID, amount, currencyCode: "SEK", direction: "Payment", token: "tok-1", locale: "sv-SE",
    payer: { type: "Person", key: "p" }, payee: { type: "Organization", key: "o" }, specification: [],
});

const events = response => Array.fromAsync(readEvents(response.body));

test("a contextful call without the config id header answers 400 with an error body", async () => {
    const piggy = await startPiggyServer({ idPrefix: "PB-", now: clock });
    try {
        const response = await fetch(`${piggy.url}/methods`);
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { errors: [{ message: "Missing X-EPI-Context-Config-Id header" }] });
    } finally {
        await piggy.close();
    }
});

test("a .04 payment records its session in the key-value store with a bearer token, then completes", async () => {
    const lines = [];
    const cos = await startCosStandIn({ clientId: "c", clientSecret: "s", log: line => lines.push(line) });
    const piggy = await startPiggyServer({ idPrefix: "PB-", now: clock, waitMs: 200 });
    try {
        const install = { cosBaseUrl: cos.url, tokenUrl: `${cos.url}/oauth2/v1/token`, clientId: "c", clientSecret: "s", scope: "kv" };
        await fetch(`${piggy.url}/install`, { method: "POST", headers: context, body: JSON.stringify(install) });
        const response = await fetch(`${piggy.url}/payments/pay-9`, { method: "PUT", headers: context, body: JSON.stringify(init("10.04")) });
        const steps = await events(response);
        assert.deepEqual(steps.map(s => s.type), ["Wait", "Complete"]);
        assert.deepEqual(steps[1].result.transactions[0].actions, ["Authorize", "Debit"]);
        await new Promise(resolve => setTimeout(resolve, 100));
        // The stand-in answers 200 only with its own bearer token, so two 200 lines prove the token flow.
        assert.deepEqual(lines.filter(line => line.startsWith("PUT ")), ["PUT /api/v1/kv/com.example.piggy/pay-9 200", "PUT /api/v1/kv/com.example.piggy/pay-9 200"]);
        assert.deepEqual(cos.kv.get("com.example.piggy/pay-9"), { sessionId: "PB-1", state: "settled" });
    } finally {
        await piggy.close();
        await cos.close();
    }
});

test("POST /test reads the configuration through the context id, caches it by hash, and checks it", async () => {
    const lines = [];
    const cos = await startCosStandIn({ clientId: "c", clientSecret: "s", configuration: { merchantId: "M-1", mode: "TEST" }, configurationHash: "h", log: line => lines.push(line) });
    const bad = await startCosStandIn({ clientId: "c", clientSecret: "s", configuration: { merchantId: "", mode: "LIVE" }, configurationHash: "h2" });
    const piggy = await startPiggyServer({ idPrefix: "PB-", now: clock });
    try {
        const install = { tokenUrl: `${cos.url}/oauth2/v1/token`, clientId: "c", clientSecret: "s", scope: "me" };
        assert.equal((await fetch(`${piggy.url}/test`, { method: "POST", headers: context })).status, 400, "not installed");
        await fetch(`${piggy.url}/install`, { method: "POST", headers: context, body: JSON.stringify({ ...install, cosBaseUrl: cos.url }) });
        assert.equal(await (await fetch(`${piggy.url}/test`, { method: "POST", headers: context })).json(), true);
        assert.equal(await (await fetch(`${piggy.url}/test`, { method: "POST", headers: context })).json(), true);
        assert.equal(lines.filter(line => line.startsWith("GET /api/v1/context/config/EPI1")).length, 1, "the second call is served from the hash cache");
        await fetch(`${piggy.url}/install`, { method: "POST", headers: context, body: JSON.stringify({ ...install, cosBaseUrl: bad.url, tokenUrl: `${bad.url}/oauth2/v1/token` }) });
        const headers = { ...context, "X-EPI-Context-Config-Hash": "h2" };
        assert.equal(await (await fetch(`${piggy.url}/test`, { method: "POST", headers })).json(), false, "an empty merchantId fails the node");
    } finally {
        await piggy.close();
        await cos.close();
        await bad.close();
    }
});

test("a .03 payment ends with Cancel after the cancel call, and the bank keeps no money", async () => {
    const piggy = await startPiggyServer({ idPrefix: "PB-", now: clock, waitMs: 2000 });
    try {
        const stream = fetch(`${piggy.url}/payments/pay-7`, { method: "PUT", headers: context, body: JSON.stringify(init("10.03")) });
        await new Promise(resolve => setTimeout(resolve, 100));
        const cancel = await fetch(`${piggy.url}/payments/pay-7/cancel`, { method: "POST", headers: context, body: "{}" });
        assert.equal(cancel.status, 200);
        assert.deepEqual((await events(await stream)).map(s => s.type), ["Cancellable", "Wait", "Cancel"]);
        assert.deepEqual(piggy.bank.ledger, []);
        assert.equal(piggy.bank.session("PB-1").state, "cancelled");
    } finally {
        await piggy.close();
    }
});

test("a repeated PUT for a completed payment key replays the same result, and a declined key starts over", async () => {
    const piggy = await startPiggyServer({ idPrefix: "PB-", now: clock });
    try {
        const first = await events(await fetch(`${piggy.url}/payments/pay-again`, { method: "PUT", headers: context, body: JSON.stringify(init("10.00")) }));
        const second = await events(await fetch(`${piggy.url}/payments/pay-again`, { method: "PUT", headers: context, body: JSON.stringify(init("10.00")) }));
        assert.deepEqual(second, first, "same processorsId, same transaction");
        assert.equal(piggy.bank.ledger.length, 1, "no second charge");
        const declined = await events(await fetch(`${piggy.url}/payments/pay-declined`, { method: "PUT", headers: context, body: JSON.stringify(init("10.01")) }));
        assert.equal(declined[0].type, "Decline");
        const retry = await events(await fetch(`${piggy.url}/payments/pay-declined`, { method: "PUT", headers: context, body: JSON.stringify(init("10.00")) }));
        assert.equal(retry[0].type, "Complete", "a retry after a decline is a new payment");
    } finally {
        await piggy.close();
    }
});

test("a request the bank cannot take is a 200 stream with one Fail step, because CommerceOS reads no non-2xx body on the stream route", async () => {
    const piggy = await startPiggyServer({ idPrefix: "PB-", now: clock });
    try {
        for (const [dto, code] of [[{ ...init("10.00"), methodId: "com.other" }, "UnknownMethod"], [init("ten"), "BadAmount"], [{ ...init("10.00"), direction: "Sideways" }, "BadDirection"]]) {
            const response = await fetch(`${piggy.url}/payments/pay-refused`, { method: "PUT", headers: context, body: JSON.stringify(dto) });
            assert.equal(response.status, 200);
            const steps = await events(response);
            assert.deepEqual(steps.map(s => `${s.type} ${s.errors?.[0].code}`), [`Fail ${code}`]);
        }
        assert.deepEqual(piggy.bank.ledger, [], "nothing was charged");
    } finally {
        await piggy.close();
    }
});

test("debitSynchronously: true, as a till sends it, captures on every amount and direction", async () => {
    const piggy = await startPiggyServer({ idPrefix: "PB-", now: clock });
    try {
        for (const [key, dto] of [["pay-f05", { ...init("10.05"), debitSynchronously: true }], ["pay-fout", { ...init("10.00"), direction: "Payout", debitSynchronously: true }]]) {
            const [complete] = await events(await fetch(`${piggy.url}/payments/${key}`, { method: "PUT", headers: context, body: JSON.stringify(dto) }));
            assert.deepEqual(complete.result.transactions[0].actions, ["Authorize", "Debit"], key);
        }
        const [plain] = await events(await fetch(`${piggy.url}/payments/pay-05`, { method: "PUT", headers: context, body: JSON.stringify(init("10.05")) }));
        assert.deepEqual(plain.result.transactions[0].actions, ["Authorize"], "without the flag .05 still reserves only");
    } finally {
        await piggy.close();
    }
});

test("the identical transactions request answers the same transaction, and a different one gets a new id", async () => {
    const piggy = await startPiggyServer({ idPrefix: "PB-", now: clock });
    try {
        const [sale] = await events(await fetch(`${piggy.url}/payments/pay-refund`, { method: "PUT", headers: context, body: JSON.stringify(init("10.00")) }));
        const credit = { actions: ["Credit"], token: "tok-1", amount: "10.00", currencyCode: "SEK", methodId: METHOD_ID, reversalArgs: { originalTransactionId: sale.result.transactions[0].transactionId, originalTimestamp: sale.result.transactions[0].timestamp } };
        const post = body => fetch(`${piggy.url}/payments/pay-refund/transactions`, { method: "POST", headers: context, body: JSON.stringify(body) }).then(r => r.json());
        const first = await post(credit);
        assert.deepEqual(await post(credit), first);
        assert.equal(piggy.bank.ledger.length, 2, "the sale and one refund");
        assert.notEqual((await post({ ...credit, amount: "5.00" })).transactionId, first.transactionId);
    } finally {
        await piggy.close();
    }
});

test("PIGGY_STATE: a restarted bank resumes its payments from the file, and two files share nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "piggy-state-"));
    const stateFile = join(dir, "a.json");
    try {
        const first = await startPiggyServer({ now: clock, stateFile });
        const [before] = await events(await fetch(`${first.url}/payments/pay-kept`, { method: "PUT", headers: context, body: JSON.stringify(init("10.00")) }));
        await first.close();
        assert.ok(existsSync(stateFile));

        const second = await startPiggyServer({ now: clock, stateFile });
        const other = await startPiggyServer({ now: clock, stateFile: join(dir, "b.json") });
        try {
            const [after] = await events(await fetch(`${second.url}/payments/pay-kept`, { method: "PUT", headers: context, body: JSON.stringify(init("10.00")) }));
            assert.deepEqual(after, before, "the same processorsId and transaction: a resume, not a second charge");
            assert.equal(second.bank.ledger.length, 1);
            // The counter continues, so a new payment never reuses an id from before the restart.
            const [fresh] = await events(await fetch(`${second.url}/payments/pay-new`, { method: "PUT", headers: context, body: JSON.stringify(init("10.00")) }));
            assert.notEqual(fresh.result.processorsId, before.result.processorsId);
            assert.ok(fresh.result.processorsId.startsWith(before.result.processorsId.replace(/\d+$/, "")), "same prefix, higher counter");
            // The other instance knows nothing of pay-kept: a transactions call for it is 404.
            const foreign = await fetch(`${other.url}/payments/pay-kept/transactions`, { method: "POST", headers: context, body: JSON.stringify({ actions: ["Credit"], token: "tok-1", amount: "10.00", currencyCode: "SEK", methodId: METHOD_ID }) });
            assert.equal(foreign.status, 404);
        } finally {
            await second.close();
            await other.close();
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
