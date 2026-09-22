import { test } from "node:test";
import assert from "node:assert/strict";
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
