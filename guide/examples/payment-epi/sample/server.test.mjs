import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { startPiggyServer, METHOD_ID } from "./server.mjs";

const clock = () => new Date("2026-01-01T00:00:00Z");
const context = { "X-EPI-Context-Config-Id": "EPI1", "X-EPI-Context-Config-Hash": "h", "content-type": "application/json" };
const init = amount => ({
    methodId: METHOD_ID, amount, currencyCode: "SEK", direction: "Payment", token: "tok-1", locale: "sv-SE",
    payer: { type: "Person", key: "p" }, payee: { type: "Organization", key: "o" }, specification: [],
});

/** Reads a whole SSE stream into `[{ type, ...data }]`. */
async function events(response) {
    const text = await response.text();
    return text.trim().split("\n\n").map(record => {
        const type = /^event: (.*)$/m.exec(record)[1];
        const data = /^data: (.*)$/m.exec(record)?.[1];
        return { type, ...(data ? JSON.parse(data) : {}) };
    });
}

/** A stub CommerceOS: a token endpoint and a key-value store that records every PUT. */
function startStubCos() {
    const writes = [];
    const server = createServer((request, response) => {
        let body = "";
        request.on("data", chunk => { body += chunk; });
        request.on("end", () => {
            if (request.url === "/oauth/token") {
                response.writeHead(200, { "content-type": "application/json" });
                return response.end(JSON.stringify({ access_token: "stub-token", expires_in: 3600 }));
            }
            writes.push({ url: request.url, authorization: request.headers.authorization, body: JSON.parse(body) });
            response.writeHead(200, { "content-type": "application/json" });
            response.end("{}");
        });
    });
    return new Promise(resolve => server.listen(0, "127.0.0.1", () => {
        const url = `http://127.0.0.1:${server.address().port}`;
        resolve({ url, writes, close: () => new Promise(done => { server.closeAllConnections(); server.close(done); }) });
    }));
}

test("a contextful call without the config id header answers 400 with an error body", async () => {
    const piggy = await startPiggyServer({ now: clock });
    try {
        const response = await fetch(`${piggy.url}/methods`);
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { errors: [{ message: "Missing X-EPI-Context-Config-Id header" }] });
    } finally {
        await piggy.close();
    }
});

test("a .04 payment records its session in the key-value store with a bearer token, then completes", async () => {
    const cos = await startStubCos();
    const piggy = await startPiggyServer({ now: clock, waitMs: 200 });
    try {
        const install = { cosBaseUrl: cos.url, tokenUrl: `${cos.url}/oauth/token`, clientId: "c", clientSecret: "s", scope: "kv" };
        await fetch(`${piggy.url}/install`, { method: "POST", headers: context, body: JSON.stringify(install) });
        const response = await fetch(`${piggy.url}/payments/pay-9`, { method: "PUT", headers: context, body: JSON.stringify(init("10.04")) });
        const steps = await events(response);
        assert.deepEqual(steps.map(s => s.type), ["Wait", "Complete"]);
        assert.deepEqual(steps[1].result.transactions[0].actions, ["Authorize", "Debit"]);
        await new Promise(resolve => setTimeout(resolve, 100));
        assert.deepEqual(cos.writes.map(w => [w.url, w.authorization, w.body.state]), [
            ["/api/v1/kv/com.example.piggy/pay-9", "Bearer stub-token", "waiting"],
            ["/api/v1/kv/com.example.piggy/pay-9", "Bearer stub-token", "settled"],
        ]);
        assert.equal(cos.writes[0].body.sessionId, "PB-1");
    } finally {
        await piggy.close();
        await cos.close();
    }
});

test("a .03 payment ends with Cancel after the cancel call, and the bank keeps no money", async () => {
    const piggy = await startPiggyServer({ now: clock, waitMs: 2000 });
    try {
        const stream = fetch(`${piggy.url}/payments/pay-7`, { method: "PUT", headers: context, body: JSON.stringify(init("10.03")) });
        await new Promise(resolve => setTimeout(resolve, 100));
        const cancel = await fetch(`${piggy.url}/payments/pay-7/cancel`, { method: "POST", headers: context, body: "{}" });
        assert.equal(cancel.status, 200);
        assert.deepEqual((await events(await stream)).map(s => s.type), ["Cancellable", "Cancel"]);
        assert.deepEqual(piggy.bank.ledger, []);
        assert.equal(piggy.bank.session("PB-1").state, "cancelled");
    } finally {
        await piggy.close();
    }
});
