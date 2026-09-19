import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startReferenceServer, METHOD_ID } from "./reference-server.mjs";
import { collectEvents, parseEvents } from "./sse.mjs";

const context = { "x-epi-context-config-id": "AB12", "x-epi-context-config-hash": "hash-1" };
const jsonHeaders = { ...context, "content-type": "application/json", accept: "application/json" };

function paymentInit(amount, extra = {}) {
    return {
        methodId: METHOD_ID, amount, currencyCode: "SEK", direction: "Payment", locale: "sv-SE",
        payer: { key: "payer-1", type: "Person" }, payee: { key: "payee-1", type: "Organization" },
        token: "tok-1", specification: [], ...extra,
    };
}

async function startPayment(server, key, amount, extra) {
    const response = await fetch(`${server.url}/payments/${key}`, {
        method: "PUT", headers: { ...context, "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify(paymentInit(amount, extra)),
    });
    return response;
}

const server = await startReferenceServer();
after(() => server.close());

test("install stores the payload, uninstall clears it, both without headers", async () => {
    const payload = { cosBaseUrl: "http://cos", tokenUrl: "http://cos/token", clientId: "c", clientSecret: "s", scope: "epi" };
    const installed = await fetch(`${server.url}/install`, { method: "POST", body: JSON.stringify(payload) });
    assert.equal(installed.status, 200);
    assert.deepEqual(server.installation, payload);
    const removed = await fetch(`${server.url}/uninstall`, { method: "POST" });
    assert.equal(removed.status, 200);
    assert.equal(server.installation, null);
});

test("config-schema is a form description with members, no headers needed", async () => {
    const response = await fetch(`${server.url}/config-schema`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        title: "Reference",
        members: { merchantId: { type: "string" }, mode: { type: "'TEST' or 'LIVE'" } },
    });
});

test("test returns JSON true", async () => {
    const response = await fetch(`${server.url}/test`, { method: "POST", headers: jsonHeaders });
    assert.equal(response.status, 200);
    assert.equal(await response.json(), true);
});

test("methods returns the one reference method", async () => {
    const response = await fetch(`${server.url}/methods`, { headers: jsonHeaders });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [{
        methodId: "com.epicheck.reference", name: "Reference",
        supports: { incoming: true, outgoing: true, reversal: true },
        requires: { terminal: false, specification: false },
    }]);
});

test("terminals lists T-01 and T-02, each readable by id, unknown id is 404 with errors", async () => {
    const list = await (await fetch(`${server.url}/terminals`, { headers: jsonHeaders })).json();
    assert.deepEqual(list.map(t => t.terminalId), ["T-01", "T-02"]);
    for (const terminal of list) {
        const one = await fetch(`${server.url}/terminals/${terminal.terminalId}`, { headers: jsonHeaders });
        assert.equal(one.status, 200);
        assert.deepEqual(await one.json(), terminal);
    }
    const missing = await fetch(`${server.url}/terminals/T-99`, { headers: jsonHeaders });
    assert.equal(missing.status, 404);
    const body = await missing.json();
    assert.equal(typeof body.errors[0].message, "string");
});

test("a contextful call without the context headers is 400 with an errors body", async () => {
    for (const [method, path] of [["POST", "/test"], ["GET", "/methods"], ["GET", "/terminals"], ["PUT", "/payments/x"], ["POST", "/payments/x/transactions"], ["POST", "/payments/x/cancel"]]) {
        const response = await fetch(`${server.url}${path}`, { method, headers: { "content-type": "application/json" }, body: method === "GET" ? undefined : "{}" });
        assert.equal(response.status, 400, `${method} ${path}`);
        const body = await response.json();
        assert.match(body.errors[0].message, /x-epi-context-config/);
    }
    const onlyId = await fetch(`${server.url}/methods`, { headers: { "x-epi-context-config-id": "AB12" } });
    assert.equal(onlyId.status, 400);
});

test(".00 completes with Authorize and Debit, echoing the request", async () => {
    const response = await startPayment(server, "pay-00", "100.00");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^text\/event-stream/);
    const events = await collectEvents(response.body);
    assert.equal(events.length, 1);
    const [complete] = events;
    assert.equal(complete.type, "Complete");
    assert.equal(complete.result.methodId, METHOD_ID);
    assert.equal(complete.result.amount, "100.00");
    assert.equal(complete.result.currencyCode, "SEK");
    const [transaction] = complete.result.transactions;
    assert.deepEqual(transaction.actions, ["Authorize", "Debit"]);
    assert.equal(transaction.token, "tok-1");
    assert.equal(transaction.methodId, METHOD_ID);
    assert.deepEqual(transaction.specification, []);
    assert.match(transaction.transactionId, /^REF-\d{6}$/);
    assert.equal(transaction.timestamp, "2026-01-01T00:00:00.000Z");
});

test(".05 completes with Authorize only", async () => {
    const events = await collectEvents((await startPayment(server, "pay-05", "100.05")).body);
    assert.deepEqual(events.map(e => e.type), ["Complete"]);
    assert.deepEqual(events[0].result.transactions[0].actions, ["Authorize"]);
});

test(".01 declines with InsufficientFunds", async () => {
    const events = await collectEvents((await startPayment(server, "pay-01", "100.01")).body);
    assert.deepEqual(events, [{ type: "Decline", reason: "InsufficientFunds" }]);
});

test(".02 fails with one error", async () => {
    const events = await collectEvents((await startPayment(server, "pay-02", "100.02")).body);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "Fail");
    assert.equal(events[0].errors.length, 1);
    assert.equal(typeof events[0].errors[0].message, "string");
});

test(".03 is Cancellable with the payment key as token, then Cancel after the cancel call", async () => {
    const response = await startPayment(server, "pay-03", "100.03");
    const events = [];
    const reader = (async () => { for await (const event of parseEvents(response.body)) events.push(event); })();
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.deepEqual(events, [{ type: "Cancellable", cancellationToken: "pay-03" }]);
    const cancel = await fetch(`${server.url}/payments/pay-03/cancel`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ isLocalTerminal: false }) });
    assert.equal(cancel.status, 200);
    await reader;
    assert.deepEqual(events.map(e => e.type), ["Cancellable", "Cancel"]);
});

test("a cancel for an unknown token is 404 with errors", async () => {
    const cancel = await fetch(`${server.url}/payments/nope/cancel`, { method: "POST", headers: jsonHeaders, body: "{}" });
    assert.equal(cancel.status, 404);
    assert.equal((await cancel.json()).errors.length, 1);
});

test(".04 waits, then completes", async () => {
    const events = await collectEvents((await startPayment(server, "pay-04", "100.04")).body);
    assert.deepEqual(events.map(e => e.type), ["Wait", "Complete"]);
    assert.deepEqual(events[1].result.transactions[0].actions, ["Authorize", "Debit"]);
});

test("Payout gives Authorize only, or Authorize and Debit with debitSynchronously", async () => {
    const plain = await collectEvents((await startPayment(server, "pay-out", "50.00", { direction: "Payout" })).body);
    assert.deepEqual(plain[0].result.transactions[0].actions, ["Authorize"]);
    const sync = await collectEvents((await startPayment(server, "pay-out-sync", "50.00", { direction: "Payout", debitSynchronously: true })).body);
    assert.deepEqual(sync[0].result.transactions[0].actions, ["Authorize", "Debit"]);
});

test("transactions echoes the TransactionInitDto and adds id and timestamp", async () => {
    const init = { actions: ["Debit"], token: "tok-2", amount: "100.05", currencyCode: "SEK", methodId: METHOD_ID, specification: [{ description: "x", quantity: "1", unit: "pcs", totalAmount: "100.05", currencyCode: "SEK" }] };
    const response = await fetch(`${server.url}/payments/pay-05/transactions`, { method: "POST", headers: jsonHeaders, body: JSON.stringify(init) });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.transactionId, /^REF-\d{6}$/);
    assert.equal(body.timestamp, "2026-01-01T00:00:00.000Z");
    delete body.transactionId; delete body.timestamp;
    assert.deepEqual(body, init);
});

test("an unknown methodId is 400 Unknown method on payments and transactions", async () => {
    const payment = await startPayment(server, "pay-bad", "100.00", { methodId: "com.other" });
    assert.equal(payment.status, 400);
    assert.deepEqual(await payment.json(), { errors: [{ message: "Unknown method" }] });
    const transaction = await fetch(`${server.url}/payments/pay-bad/transactions`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ methodId: "com.other", actions: ["Debit"] }) });
    assert.equal(transaction.status, 400);
    assert.deepEqual(await transaction.json(), { errors: [{ message: "Unknown method" }] });
});

test("a prefix is honored, and a path outside it is 404", async () => {
    const prefixed = await startReferenceServer({ prefix: "/reference" });
    try {
        assert.match(prefixed.url, /\/reference$/);
        assert.equal((await fetch(`${prefixed.url}/config-schema`)).status, 200);
        const bare = new URL(prefixed.url); bare.pathname = "/config-schema";
        assert.equal((await fetch(bare)).status, 404);
    } finally {
        await prefixed.close();
    }
});

test("the drop-token defect omits token from every transaction", async () => {
    const defective = await startReferenceServer({ defect: "drop-token" });
    try {
        const events = await collectEvents((await startPayment(defective, "pay-00", "100.00")).body);
        assert.equal("token" in events[0].result.transactions[0], false);
    } finally {
        await defective.close();
    }
    assert.throws(() => startReferenceServer({ defect: "nope" }), /Unknown reference defect/);
});

test("two servers given the same inputs produce identical bodies", async () => {
    const bodies = [];
    for (let i = 0; i < 2; i++) {
        const fresh = await startReferenceServer();
        try {
            const complete = await (await startPayment(fresh, "pay-00", "100.00")).text();
            const transaction = await (await fetch(`${fresh.url}/payments/pay-00/transactions`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ actions: ["Credit"], token: "tok-1", amount: "100.00", currencyCode: "SEK", methodId: METHOD_ID }) })).text();
            bodies.push(complete + transaction);
        } finally {
            await fresh.close();
        }
    }
    assert.equal(bodies[0], bodies[1]);
    assert.match(bodies[0], /REF-000001/);
    assert.match(bodies[0], /REF-000002/);
});
