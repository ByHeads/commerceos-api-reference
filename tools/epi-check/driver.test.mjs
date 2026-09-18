import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createDriver, EpiCheckError, DRIVER_CALLS } from "./driver.mjs";
import { startReferenceServer, METHOD_ID } from "./reference-server.mjs";

const context = { configId: "AB12", configHash: "hash-1", debugInfo: { nodeName: "Veddesta", baseUrl: "http://epi", name: "Reference" } };
const server = await startReferenceServer();
after(() => server.close());

const recorded = [];
const recordingFetch = (url, init) => { recorded.push({ url: String(url), init }); return globalThis.fetch(url, init); };
const driver = createDriver({ baseUrl: server.url, context, fetch: recordingFetch });

function paymentInit(amount) {
    return {
        methodId: METHOD_ID, amount, currencyCode: "SEK", direction: "Payment", locale: "sv-SE",
        payer: { key: "payer-1", type: "Person" }, payee: { key: "payee-1", type: "Organization" },
        token: "tok-1", specification: [],
    };
}

test("install, uninstall and configSchema are bare calls with no context headers", async () => {
    recorded.length = 0;
    assert.equal(await driver.install({ cosBaseUrl: "http://cos", tokenUrl: "http://cos/t", clientId: "c", clientSecret: "s", scope: "epi" }), undefined);
    assert.equal(await driver.uninstall(), undefined);
    const schema = await driver.configSchema();
    assert.equal(typeof schema.members, "object");
    assert.equal(recorded.length, 3);
    for (const call of recorded) {
        const names = Object.keys(call.init.headers).map(h => h.toLowerCase());
        assert.equal(names.some(h => h.startsWith("x-epi-")), false, call.url);
    }
    assert.equal(recorded[0].init.method, "POST");
    assert.equal(recorded[0].init.headers["content-type"], "application/json");
    assert.equal(recorded[2].init.method, "GET");
    assert.equal(recorded[2].init.headers.accept, "application/json");
});

test("contextful calls carry the three X-EPI headers as EpiIntegration builds them", async () => {
    recorded.length = 0;
    assert.equal(await driver.test(), true);
    const [call] = recorded;
    assert.equal(call.init.headers.accept, "application/json");
    assert.equal(call.init.headers["X-EPI-Context-Config-Id"], "AB12");
    assert.equal(call.init.headers["X-EPI-Context-Config-Hash"], "hash-1");
    assert.equal(call.init.headers["X-EPI-Debug-Info"], JSON.stringify({ nodeName: "Veddesta", baseUrl: "http://epi", name: "Reference" }));
    assert.equal(call.init.body, undefined);
});

test("methods, terminals, terminal, transaction and cancel", async () => {
    const methods = await driver.methods();
    assert.equal(methods[0].methodId, METHOD_ID);
    const terminals = await driver.terminals();
    assert.deepEqual(terminals.map(t => t.terminalId), ["T-01", "T-02"]);
    const one = await driver.terminal("T-02");
    assert.deepEqual(one, terminals[1]);
    const transaction = await driver.transaction("pay-x", { actions: ["Debit"], token: "tok-1", amount: "100.05", currencyCode: "SEK", methodId: METHOD_ID });
    assert.deepEqual(transaction.actions, ["Debit"]);
    assert.match(transaction.transactionId, /^REF-/);
    await assert.rejects(driver.cancel("unknown", { isLocalTerminal: false }), error => error instanceof EpiCheckError && error.status === 404);
});

test("startPayment iterates the SSE steps of a .00 payment", async () => {
    recorded.length = 0;
    const steps = [];
    for await (const step of driver.startPayment("pay-00", paymentInit("100.00"))) steps.push(step);
    assert.deepEqual(steps.map(s => s.type), ["Complete"]);
    assert.deepEqual(steps[0].result.transactions[0].actions, ["Authorize", "Debit"]);
    assert.equal(recorded[0].init.method, "PUT");
    assert.equal(recorded[0].init.headers.accept, "text/event-stream");
    assert.equal(recorded[0].init.headers["X-EPI-Context-Config-Id"], "AB12");
});

test("startPayment on a .03 payment yields Cancellable, and Cancel after driver.cancel", async () => {
    const steps = [];
    for await (const step of driver.startPayment("pay-03", paymentInit("100.03"))) {
        steps.push(step);
        if (step.type === "Cancellable") {
            assert.deepEqual(await driver.cancel(step.cancellationToken, { isLocalTerminal: false }), {});
        }
    }
    assert.deepEqual(steps.map(s => s.type), ["Cancellable", "Cancel"]);
});

test("a 400 throws EpiCheckError with status, path and the parsed errors", async () => {
    const bad = { ...paymentInit("100.00"), methodId: "com.other" };
    await assert.rejects(async () => { for await (const _ of driver.startPayment("pay-bad", bad)) { /* never */ } }, error => {
        assert.ok(error instanceof EpiCheckError);
        assert.equal(error.status, 400);
        assert.equal(error.path, "/payments/pay-bad");
        assert.deepEqual(error.errors, [{ message: "Unknown method" }]);
        return true;
    });
    const strippingFetch = (url, init) => {
        const headers = Object.fromEntries(Object.entries(init.headers).filter(([name]) => !name.startsWith("X-EPI-")));
        return globalThis.fetch(url, { ...init, headers });
    };
    const withoutContext = createDriver({ baseUrl: server.url, context, fetch: strippingFetch });
    await assert.rejects(withoutContext.methods(), error => error.status === 400 && Array.isArray(error.errors));
});

test("every call lands in driver.log with method, path, status and ms", async () => {
    const fresh = createDriver({ baseUrl: server.url, context });
    await fresh.configSchema();
    await fresh.methods();
    await assert.rejects(fresh.terminal("T-99"));
    assert.deepEqual(fresh.log.map(({ method, path, status }) => ({ method, path, status })), [
        { method: "GET", path: "/config-schema", status: 200 },
        { method: "GET", path: "/methods", status: 200 },
        { method: "GET", path: "/terminals/T-99", status: 404 },
    ]);
    for (const entry of fresh.log) assert.equal(typeof entry.ms, "number");
});

test("a server that never answers times out through the AbortController", async () => {
    const silent = createServer(() => { /* never answers */ });
    await new Promise(resolve => silent.listen(0, "127.0.0.1", resolve));
    try {
        const slow = createDriver({ baseUrl: `http://127.0.0.1:${silent.address().port}`, context, timeoutMs: 100 });
        const started = performance.now();
        await assert.rejects(slow.methods(), error => error instanceof EpiCheckError && error.status === 0 && /Timeout after 100 ms/.test(error.message));
        assert.ok(performance.now() - started < 2000);
        assert.deepEqual(slow.log.map(e => e.status), [0]);
    } finally {
        silent.closeAllConnections();
        await new Promise(resolve => silent.close(resolve));
    }
});

test("a trailing slash on baseUrl does not double the slash", async () => {
    const slashed = createDriver({ baseUrl: server.url + "/", context, fetch: recordingFetch });
    recorded.length = 0;
    await slashed.methods();
    assert.equal(recorded[0].url, `${server.url}/methods`);
});

test("DRIVER_CALLS names every method on the driver", () => {
    for (const name of DRIVER_CALLS) assert.equal(typeof driver[name], "function", name);
});
