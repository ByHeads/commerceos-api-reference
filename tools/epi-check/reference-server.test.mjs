import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startReferenceServer, METHOD_ID, DEFECTS, DEFECT_SCENARIO } from "./reference-server.mjs";
import { collectEvents, parseEvents } from "./sse.mjs";
import { startCosStandIn, CLIENT } from "../../guide/examples/payment-epi/sample/cos.mjs";

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

test("once installed, test reads the configuration behind the context id through CommerceOS and compares the hash", async () => {
    const lines = [];
    const cos = await startCosStandIn({ configurationHash: "hash-1", log: line => lines.push(line) });
    const own = await startReferenceServer();
    try {
        const call = hash => fetch(`${own.url}/test`, { method: "POST", headers: { ...jsonHeaders, "x-epi-context-config-hash": hash } }).then(r => r.json());
        await fetch(`${own.url}/install`, { method: "POST", body: JSON.stringify({ cosBaseUrl: cos.url, tokenUrl: `${cos.url}/oauth2/v1/token`, ...CLIENT, scope: "kv" }) });
        assert.equal(await call("hash-1"), true);
        assert.deepEqual(lines, ["POST /oauth2/v1/token 200", "GET /api/v1/context/config/AB12 200"]);
        assert.equal(await call("hash-2"), false, "the hash CommerceOS answers is not the one in the header");
        await fetch(`${own.url}/install`, { method: "POST", body: JSON.stringify({ cosBaseUrl: cos.url, tokenUrl: `${cos.url}/oauth2/v1/token`, clientId: "nobody", clientSecret: "x", scope: "kv" }) });
        assert.equal(await call("hash-1"), false, "no token, no configuration");
        await fetch(`${own.url}/install`, { method: "POST", body: JSON.stringify({ cosBaseUrl: "http://127.0.0.1:1", tokenUrl: "http://127.0.0.1:1/oauth2/v1/token", ...CLIENT, scope: "kv" }) });
        assert.equal(await call("hash-1"), false, "an unreachable CommerceOS");
        await fetch(`${own.url}/uninstall`, { method: "POST" });
        assert.equal(await call("hash-1"), true, "nothing to read before an install");
    } finally {
        await own.close();
        await cos.close();
    }
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
    assert.deepEqual(events, [{ type: "Decline", reason: "InsufficientFunds", params: ["0.00", "100.01"] }]);
});

test(".02 fails with one error", async () => {
    const events = await collectEvents((await startPayment(server, "pay-02", "100.02")).body);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "Fail");
    assert.equal(events[0].errors.length, 1);
    assert.equal(typeof events[0].errors[0].message, "string");
});

test(".03 is Cancellable with the payment key as token, then Wait for the cancel button, then Cancel after the cancel call", async () => {
    const response = await startPayment(server, "pay-03", "100.03");
    const events = [];
    const reader = (async () => { for await (const event of parseEvents(response.body)) events.push(event); })();
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.deepEqual(events[0], { type: "Cancellable", cancellationToken: "pay-03" });
    assert.equal(events[1]?.type, "Wait", "the POS shows the cancel button on the Wait step");
    const cancel = await fetch(`${server.url}/payments/pay-03/cancel`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ isLocalTerminal: false }) });
    assert.equal(cancel.status, 200);
    await reader;
    assert.deepEqual(events.map(e => e.type), ["Cancellable", "Wait", "Cancel"]);
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

test("debitSynchronously captures whatever the cents say: .05 gives Authorize and Debit under the flag", async () => {
    const flagged = await collectEvents((await startPayment(server, "pay-05-flag", "100.05", { debitSynchronously: true })).body);
    assert.deepEqual(flagged[0].result.transactions[0].actions, ["Authorize", "Debit"]);
    const defective = await startReferenceServer({ defect: "authorize-only-under-flag" });
    try {
        const p1 = await collectEvents((await startPayment(defective, "pay-x-P1", "100.00", { debitSynchronously: true })).body);
        assert.deepEqual(p1[0].result.transactions[0].actions, ["Authorize"]);
        const other = await collectEvents((await startPayment(defective, "pay-x-P4", "100.00", { debitSynchronously: true })).body);
        assert.deepEqual(other[0].result.transactions[0].actions, ["Authorize", "Debit"]);
    } finally {
        await defective.close();
    }
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

test("an unknown methodId on the stream is a 200 stream with one Fail step, never a status", async () => {
    // CommerceOS reads no non-2xx body on this route (reference section 7).
    const payment = await startPayment(server, "pay-bad", "100.00", { methodId: "com.other" });
    assert.equal(payment.status, 200);
    const events = await collectEvents(payment.body);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "Fail");
    assert.deepEqual(events[0].errors, [{ code: "UnknownMethod", message: "Unknown method com.other" }]);
    const amount = await collectEvents((await startPayment(server, "pay-bad-amount", "1,00")).body);
    assert.deepEqual(amount.map(e => `${e.type} ${e.errors?.[0].code}`), ["Fail BadAmount"]);
});

test("transactions for a key that never completed is 404 with errors; an unknown method on a completed key is 400", async () => {
    const unknown = await fetch(`${server.url}/payments/pay-never/transactions`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ methodId: METHOD_ID, actions: ["Debit"] }) });
    assert.equal(unknown.status, 404);
    assert.deepEqual(await unknown.json(), { errors: [{ message: "No completed payment pay-never" }] });
    // A declined key has no payment either (reference section 6).
    await collectEvents((await startPayment(server, "pay-declined", "100.01")).body);
    assert.equal((await fetch(`${server.url}/payments/pay-declined/transactions`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ methodId: METHOD_ID, actions: ["Debit"] }) })).status, 404);
    const transaction = await fetch(`${server.url}/payments/pay-00/transactions`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ methodId: "com.other", actions: ["Debit"] }) });
    assert.equal(transaction.status, 400);
    assert.deepEqual(await transaction.json(), { errors: [{ message: "Unknown method" }] });
});

test("a repeated PUT for a completed key is a resume: the same body, no new transaction", async () => {
    const first = await (await startPayment(server, "pay-resume", "100.00")).text();
    const second = await (await startPayment(server, "pay-resume", "100.00")).text();
    assert.equal(second, first);
    assert.match(first, /"processorsId": ?"proc-pay-resume"/);
});

test("a repeated transactions request answers the same transaction; a different body gets a new one", async () => {
    await collectEvents((await startPayment(server, "pay-twice", "100.00")).body);
    const body = JSON.stringify({ actions: ["Credit"], token: "tok-1", amount: "100.00", currencyCode: "SEK", methodId: METHOD_ID, reversalArgs: { originalTransactionId: "REF-000001", originalTimestamp: "2026-01-01T00:00:00.000Z" } });
    const post = b => fetch(`${server.url}/payments/pay-twice/transactions`, { method: "POST", headers: jsonHeaders, body: b }).then(r => r.json());
    const first = await post(body);
    assert.deepEqual(await post(body), first);
    const other = await post(JSON.stringify({ ...JSON.parse(body), amount: "50.00" }));
    assert.notEqual(other.transactionId, first.transactionId);
});

test("a scenario-bound defect hits only the key that ends in its scenario id", async () => {
    assert.deepEqual(DEFECTS, ["drop-token", "non-2xx-on-stream", ...Object.keys(DEFECT_SCENARIO)]);
    assert.equal(DEFECT_SCENARIO["no-final-step"], "P9");
    const defective = await startReferenceServer({ defect: "no-final-step" });
    try {
        assert.deepEqual((await collectEvents((await startPayment(defective, "pay-x-P9", "100.04")).body)).map(e => e.type), ["Wait"]);
        assert.deepEqual((await collectEvents((await startPayment(defective, "pay-x-P1", "100.04")).body)).map(e => e.type), ["Wait", "Complete"]);
    } finally {
        await defective.close();
    }
    const refusing = await startReferenceServer({ defect: "non-2xx-on-stream" });
    try {
        const response = await startPayment(refusing, "pay-x-E2", "100.00", { methodId: "com.other" });
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { errors: [{ message: "Unknown method com.other" }] });
    } finally {
        await refusing.close();
    }
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
