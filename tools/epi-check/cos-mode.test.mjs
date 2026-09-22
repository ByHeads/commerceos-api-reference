// Scenario C1 against the stub CommerceOS: the four read calls, the sub-steps, the D1 warning, and the
// context of the node the run uses. The whole run is tested in run.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCosClient, runCosScenario, COS_SCENARIO, D1_WARNING } from "./cos.mjs";
import { startCosStub, KEY } from "./cos-stub.mjs";

const AUTH = `Basic ${Buffer.from(":" + KEY).toString("base64")}`;
const stub = await startCosStub({
    integrations: {
        Mock: { baseUrl: "http://epi.example/cos", nodes: [{ name: "Shade AB", key: "node-shade", contextConfigId: "v5EX" }], methods: ["com.mock.one", "com.mock.two"] },
        Broken: { terminals: "d1" },
        Crashed: { terminals: "500" },
        Inactive: { status: "Inactive", nodes: [], methods: [] },
        Flaky: { nodes: [{ name: "Veddesta" }, { name: "Kungsängen" }], tests: { Veddesta: "success", Kungsängen: "fail" } },
        TwoNodes: { nodes: [{ name: "First", contextConfigId: "AAAA", configurationHash: "hash-first" }, { name: "Second", contextConfigId: "BBBB", configurationHash: "hash-second" }] },
        Unlisted: { nodes: [{ name: "Shade AB", listed: false }] },
        NoHash: { nodes: [{ name: "Shade AB", configurationHash: "" }] },
    },
});
const client = () => createCosClient({ baseUrl: stub.url, key: KEY, timeoutMs: 2000 });

test("C1 passes on a healthy integration: four read calls, four sub-steps, Basic auth with an empty user, the context of the first node", async () => {
    stub.seen.length = 0;
    const outcome = await runCosScenario({ client: client(), integration: "Mock" });
    assert.equal(outcome.id, "C1");
    assert.equal(outcome.result, "pass");
    assert.deepEqual(outcome.failures, []);
    assert.deepEqual(outcome.steps.map(s => s.result), ["pass", "pass", "pass", "pass"]);
    assert.deepEqual(outcome.calls.map(c => `${c.method} ${c.path} → ${c.status}`), [
        "GET /payment-integrations/name=Mock?fields=identifiers,status,baseUrl,configurations,methods → 200",
        "POST /payment-integrations/name=Mock/test → 200",
        "GET /payment-integrations/name=Mock?fields=assignedTerminals → 200",
        "GET /epi-configurations?fields=identifiers,node,integration → 200",
    ]);
    assert.equal(stub.seen.length, 4);
    for (const request of stub.seen) assert.equal(request.authorization, AUTH);
    assert.equal(stub.seen[1].body, "true");
    // Only reads: nothing is created, installed, or configured.
    assert.deepEqual(stub.seen.map(r => r.method), ["GET", "POST", "GET", "GET"]);
    // What the run needs: the record, the node, and the context CommerceOS sends that node's integration.
    assert.equal(outcome.record.baseUrl, "http://epi.example/cos");
    assert.equal(outcome.record.methods[0].identifiers.methodId, "com.mock.one");
    assert.equal(outcome.node, "Shade AB");
    assert.deepEqual(outcome.context, { configId: "v5EX", configHash: "v5EXNSP", debugInfo: { nodeName: "Shade AB", baseUrl: "http://epi.example/cos", name: "Mock" } });
});

test("C1 passes with a D1 warning when assignedTerminals answers the known 500, and fails on any other 500", async () => {
    const outcome = await runCosScenario({ client: client(), integration: "Broken" });
    assert.equal(outcome.result, "pass");
    assert.deepEqual(outcome.failures, []);
    assert.deepEqual(outcome.steps.map(s => s.result), ["pass", "pass", "pass", "pass"]);
    assert.deepEqual(outcome.warnings, [{ step: "step 3 assignedTerminals", path: "D1", message: `${D1_WARNING} — details: TypeError: this.sourceIterator.next is not a function` }]);
    assert.equal(outcome.title, "CommerceOS side: Active, test success per node, assignedTerminals 500, known defect D1, warning, context of the node read");
    assert.ok(outcome.context, "the context is still read after the warning");
    // Heads owns D1; a 500 with another cause is the partner's problem, or a new defect.
    const crashed = await runCosScenario({ client: client(), integration: "Crashed" });
    assert.equal(crashed.result, "fail");
    assert.deepEqual(crashed.warnings, []);
    assert.deepEqual(crashed.steps.map(s => s.result), ["pass", "pass", "fail", "skip"]);
    assert.deepEqual(crashed.failures, [{ step: "step 3 assignedTerminals", path: "status", message: "expected 200, got 500 — details: TypeError: Cannot read properties of undefined (reading 'terminals')" }]);
    assert.equal(crashed.context, undefined);
});

test("C1 stops at the first failing sub-step and names what is wrong", async () => {
    const inactive = await runCosScenario({ client: client(), integration: "Inactive" });
    assert.equal(inactive.result, "fail");
    assert.deepEqual(inactive.steps.map(s => s.result), ["fail", "skip", "skip", "skip"]);
    assert.deepEqual(inactive.failures.map(f => f.path), ["status", "configurations", "methods"]);
    assert.match(inactive.failures[0].message, /expected "Active", got "Inactive"/);
    assert.equal(inactive.calls.length, 1);

    const flaky = await runCosScenario({ client: client(), integration: "Flaky" });
    assert.deepEqual(flaky.steps.map(s => s.result), ["pass", "fail", "skip", "skip"]);
    assert.deepEqual(flaky.failures, [{ step: "step 2 test", path: "configurationTests.Kungsängen", message: 'expected "success", got "fail"' }]);

    const wrongKey = await runCosScenario({ client: createCosClient({ baseUrl: stub.url, key: "nope", timeoutMs: 2000 }), integration: "Mock" });
    assert.deepEqual(wrongKey.steps.map(s => s.result), ["fail", "skip", "skip", "skip"]);
    assert.match(wrongKey.failures[0].message, /expected 200, got 401/);

    const missing = await runCosScenario({ client: client(), integration: "Nope" });
    assert.match(missing.failures[0].message, /expected 200, got 404 — body: .*No payment integration named Nope/);
});

test("C1 step 4: --node picks the named configuration, an unknown node fails and lists the configured ones, a lost or hashless configuration fails", async () => {
    const first = await runCosScenario({ client: client(), integration: "TwoNodes" });
    assert.equal(first.node, "First");
    assert.equal(first.context.configId, "AAAA");
    assert.equal(first.context.configHash, "hash-first");
    const second = await runCosScenario({ client: client(), integration: "TwoNodes", node: "Second" });
    assert.equal(second.result, "pass");
    assert.equal(second.node, "Second");
    assert.deepEqual(second.context, { configId: "BBBB", configHash: "hash-second", debugInfo: { nodeName: "Second", baseUrl: "internal://mock", name: "TwoNodes" } });

    const unknown = await runCosScenario({ client: client(), integration: "TwoNodes", node: "Third" });
    assert.equal(unknown.result, "fail");
    assert.deepEqual(unknown.steps.map(s => s.result), ["pass", "pass", "pass", "fail"]);
    assert.deepEqual(unknown.failures, [{ step: "step 4 context", path: "node", message: 'TwoNodes is not configured on node "Third"; configured nodes: "First", "Second"' }]);
    assert.equal(unknown.calls.length, 3, "the list is not read when the node is not on the record");

    const unlisted = await runCosScenario({ client: client(), integration: "Unlisted" });
    assert.deepEqual(unlisted.failures, [{ step: "step 4 context", path: "contextConfigId", message: 'no EPI configuration of Unlisted on node "Shade AB" in GET /epi-configurations' }]);
    const noHash = await runCosScenario({ client: client(), integration: "NoHash" });
    assert.deepEqual(noHash.failures.map(f => f.path), ["configurationHash"]);
    assert.equal(noHash.calls.length, 3);
});

test("COS_SCENARIO names C1 and its title reads as the first row of every report", () => {
    assert.equal(COS_SCENARIO.id, "C1");
    assert.match(COS_SCENARIO.title, /^CommerceOS side: /);
});

test.after(() => stub.close());
