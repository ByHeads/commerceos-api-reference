// The whole run: C1 through the stub CommerceOS, then every scenario against the reference server that
// the stub lists as installed. cos-stub.mjs starts both and installs the reference server on the stub.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { Readable } from "node:stream";
import { DEFECT_SCENARIO, METHOD_ID } from "./reference-server.mjs";
import { startLab, startCosStub, CLIENT } from "./cos-stub.mjs";
import { run, parseArgs, resolvePlaceholders, runIdFor, ORDER, ONE_MODE, STREAM_NON_2XX, CANCELLABLE_ALONE, NOT_CAPTURED_UNDER_FLAG, TRANSLATED_DECLINE_REASONS } from "./run.mjs";
import { validate } from "./validate.mjs";
import { buildReport, buildMeta, reportJson, reportMarkdown, sortKeys } from "./report.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const schemaDoc = JSON.parse(readFileSync(join(here, "contract", "dto.schema.json"), "utf8"));
const scratch = mkdtempSync(join(tmpdir(), "epi-check-"));
const NOW = "2026-01-01T00:00:00Z";
const RUN_ID = runIdFor(NOW);
const byId = (result, id) => result.report.scenarios.find(s => s.id === id);
const EPI_IDS = ORDER.slice(1);

/** Runs `fn(lab)` on a fresh lab and closes it. `options` go to startLab. */
async function withLab(options, fn) {
    const lab = await startLab({ now: NOW, ...options });
    try { return await fn(lab); } finally { await lab.close(); }
}
const runOn = (lab, extra = {}) => run({ cos: lab.cos, key: lab.key, integration: lab.integration, now: NOW, timeout: 30000, ...extra });

test("validate: the JSON Schema subset", () => {
    const ok = { methodId: "m", amount: "100.00", currencyCode: "SEK", processorsId: "p", transactions: [] };
    assert.deepEqual(validate(schemaDoc, "PaymentDto", ok), []);
    const missing = validate(schemaDoc, "PaymentDto", { methodId: "m" });
    assert.deepEqual(missing.map(e => e.path).sort(), ["amount", "currencyCode", "processorsId", "transactions"]);
    assert.match(validate(schemaDoc, "DecimalDto", "1,50")[0].message, /does not match/);
    assert.match(validate(schemaDoc, "PaymentDirection", "Sideways")[0].message, /expected one of/);
    assert.match(validate(schemaDoc, "StepCancel", { type: "Cancel!" })[0].message, /constant/);
    assert.match(validate(schemaDoc, "MethodDto", "text")[0].message, /expected object/);
    // oneOf: a person, an organization, and something that is neither.
    assert.deepEqual(validate(schemaDoc, "AgentDto", { key: "k", type: "Person" }), []);
    assert.deepEqual(validate(schemaDoc, "AgentDto", { key: "k", type: "Organization" }), []);
    const neither = validate(schemaDoc, "AgentDto", { key: "k", type: "Robot" });
    assert.equal(neither.length, 1);
    assert.equal(neither[0].path, "type");
    assert.match(neither[0].message, /closest of oneOf \[PersonDto, OrganizationDto\]/);
    // items and nested paths.
    const nested = validate(schemaDoc, "SpecificationDto", [{ description: "d", quantity: "1", unit: "pcs", totalAmount: "x", currencyCode: "SEK" }]);
    assert.deepEqual(nested.map(e => e.path), ["[0].totalAmount"]);
    // additionalProperties on an ad-hoc schema.
    const strict = { $defs: { S: { type: "object", properties: { a: { type: "string" } }, additionalProperties: false } } };
    assert.deepEqual(validate(strict, "S", { a: "x", b: 1 }).map(e => e.path), ["b"]);
    assert.throws(() => validate(schemaDoc, "Nope", {}), /Unknown definition/);
});

test("report: sorted keys, no timestamps, markdown rows, the skip reason, the meta fields", () => {
    const report = buildReport([
        { id: "C1", title: "CommerceOS side", result: "pass", failures: [], calls: [{ method: "GET", path: "/payment-integrations/name=X", status: 200, ms: 3 }], steps: [{ label: "step 1 integration", result: "pass" }] },
        { id: "P1", title: "Sale", result: "fail", failures: [{ step: "step 1", path: "x", message: "bad" }], calls: [] },
        { id: "P6", title: "Decline", result: "pass", failures: [], warnings: [{ step: "step 1", path: "reason", message: "odd" }], calls: [] },
        { id: "H1", title: "Headers", result: "skip", reason: "C1 failed at step 1 integration (status): expected \"Active\", got \"Inactive\"", failures: [], calls: [] },
    ]);
    const text = reportJson(report);
    assert.equal(text.includes("ms"), false);
    assert.deepEqual(Object.keys(JSON.parse(text)), ["scenarios", "summary"]);
    assert.deepEqual(Object.keys(JSON.parse(text).scenarios[0]), ["calls", "failures", "id", "result", "steps", "title", "warnings"]);
    assert.deepEqual(Object.keys(JSON.parse(text).scenarios[3]), ["calls", "failures", "id", "reason", "result", "title", "warnings"]);
    assert.deepEqual(JSON.parse(text).scenarios[0].warnings, []);
    assert.deepEqual(sortKeys({ b: [{ z: 1, a: 2 }], a: null }), { a: null, b: [{ a: 2, z: 1 }] });
    const md = reportMarkdown(report, { target: "X on http://cos" });
    assert.match(md, /^# epi-check report — X on http:\/\/cos$/m);
    assert.match(md, /^\| C1 \| pass \| CommerceOS side \| GET \/payment-integrations\/name=X → 200 \|$/m);
    assert.match(md, /^\| P1 \| FAIL \| Sale \|  \|$/m);
    assert.match(md, /^\| P6 \| pass \(warn\) \| Decline \|  \|$/m);
    assert.match(md, /^\| H1 \| skip \| Headers \|  \|$/m);
    assert.match(md, /2 pass, 1 fail, 1 skip, 1 with warnings/);
    assert.match(md, /## Failures\n\n### P1 — Sale\n\n- step 1: `x` — bad/);
    assert.match(md, /## Warnings\n\n### P6 — Decline\n\n- step 1: `reason` — odd/);
    assert.match(md, /## Skipped\n\nH1: C1 failed at step 1 integration \(status\): expected "Active", got "Inactive"\n$/);
    assert.doesNotMatch(reportMarkdown(buildReport([{ id: "C1", title: "x", result: "pass", failures: [], calls: [] }])), /Warnings|with warnings|Skipped/);
    const meta = buildMeta({ cosBaseUrl: "http://cos", integration: "X", node: "Shade AB", methodId: "m", baseUrl: "http://epi", generatedAt: NOW, contractCommit: "c", durationMs: 1 });
    assert.deepEqual(Object.keys(meta), ["baseUrl", "contractCommit", "cosBaseUrl", "durationMs", "generatedAt", "integration", "methodId", "node"]);
});

test("runIdFor: eight hex characters, the same for the same --now, random without one", () => {
    assert.match(RUN_ID, /^[0-9a-f]{8}$/);
    assert.equal(runIdFor(NOW), RUN_ID);
    assert.notEqual(runIdFor("2026-01-02T00:00:00Z"), RUN_ID);
    const random = runIdFor(undefined);
    assert.match(random, /^[0-9a-f]{8}$/);
    assert.notEqual(runIdFor(undefined), random);
});

test("parseArgs: the one mode needs --cos, --key and --integration; the removed flags name it; placeholders", () => {
    assert.deepEqual(parseArgs(["--cos", "http://localhost:5000", "--key", "k", "--integration", "X", "--now", NOW]), { cos: "http://localhost:5000", key: "k", integration: "X", now: NOW, timeout: 30000 });
    assert.equal(parseArgs(["--cos", "http://x", "--key", "", "--integration", "X", "--timeout", "500", "--node", "Shade AB"]).node, "Shade AB");
    assert.equal(parseArgs(["--cos", "http://x", "--key", "", "--integration", "X", "--timeout", "500"]).timeout, 500);
    assert.throws(() => parseArgs([]), /Missing --cos\. epi-check has one mode/);
    assert.throws(() => parseArgs(["--cos", "http://x"]), /Missing --key\. epi-check has one mode/);
    assert.throws(() => parseArgs(["--cos", "http://x", "--key", "k"]), /Missing --integration\. epi-check has one mode/);
    for (const flag of ["--base", "--reference", "--reference-defect"]) assert.throws(() => parseArgs([flag, "x", "--cos", "http://x", "--key", "k", "--integration", "X"]), new RegExp(`${flag} is gone\\. ${ONE_MODE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.throws(() => parseArgs(["--cos", "http://x", "--key", "k", "--integration", "X", "--bogus"]), /Unknown argument/);
    assert.throws(() => parseArgs(["--cos", "http://x", "--key", "k", "--integration", "X", "--now", "yesterday"]), /ISO date/);
    const vars = { id: "P1", amount: "100.05", token: "tok-{{id}}", payer: { key: "k" } };
    assert.equal(resolvePlaceholders("{{token}}", vars), "tok-P1");
    assert.deepEqual(resolvePlaceholders({ a: "{{payer}}", b: "x-{{id}}" }, vars), { a: { key: "k" }, b: "x-P1" });
    assert.throws(() => resolvePlaceholders("{{nope}}", vars), /Unknown placeholder/);
});

test("a healthy reference integration through the stub passes every scenario, C1 first, in the fixed order", async () => {
    await withLab({}, async lab => {
        const out = join(scratch, "healthy");
        const result = await runOn(lab, { out });
        assert.equal(result.exitCode, 0);
        assert.deepEqual(result.report.scenarios.map(s => s.id), ORDER);
        assert.deepEqual(result.report.summary, { pass: 20, fail: 0, skip: 0 });
        for (const scenario of result.report.scenarios) assert.deepEqual(scenario.warnings, [], scenario.id);
        for (const name of ["report.json", "report.md", "meta.json"]) assert.ok(existsSync(join(out, name)), name);
        const meta = JSON.parse(readFileSync(join(out, "meta.json"), "utf8"));
        assert.equal(meta.cosBaseUrl, lab.cos);
        assert.equal(meta.integration, "Reference");
        assert.equal(meta.node, "Shade AB");
        assert.equal(meta.methodId, METHOD_ID);
        assert.equal(meta.baseUrl, lab.server.url);
        assert.equal(meta.generatedAt, NOW);
        assert.match(meta.contractCommit, /^[0-9a-f]{40}$/);
        assert.equal(typeof meta.durationMs, "number");
        // C1 read CommerceOS only; the tool sent no install and no configuration.
        assert.deepEqual(byId(result, "C1").steps.map(s => s.result), ["pass", "pass", "pass", "pass"]);
        assert.deepEqual(lab.stub.seen.map(r => r.method), ["GET", "POST", "GET", "GET"]);
        // L2 was real: the reference server read its configuration through the stub with the installed client.
        assert.deepEqual(lab.stub.callbacks, ["POST /oauth2/v1/token 200", "GET /api/v1/context/config/CF00 200"]);
        // P7 shows the cancel call once, after the PUT that opened the stream. Every key carries the run id.
        assert.deepEqual(byId(result, "P7").calls.map(c => `${c.method} ${c.path}`), [`PUT /payments/pay-${RUN_ID}-P7`, `POST /payments/pay-${RUN_ID}-P7/cancel`]);
        // E1 posts to a key no stream ever used; E2 gets its Fail as a 200 stream; H1 strips the headers.
        assert.deepEqual(byId(result, "E1").calls.map(c => `${c.method} ${c.path} ${c.status}`), [`POST /payments/pay-${RUN_ID}-E1/transactions 404`]);
        assert.deepEqual(byId(result, "E2").calls.map(c => c.status), [200]);
        assert.deepEqual(byId(result, "H1").calls.map(c => `${c.method} ${c.path} ${c.status}`), ["GET /methods 400"]);
        assert.deepEqual(byId(result, "P12").calls.map(c => c.status), [200, 200, 200]);
        const md = readFileSync(join(out, "report.md"), "utf8");
        assert.match(md, /^# epi-check report — Reference on http:\/\/127\.0\.0\.1:\d+$/m);
        assert.match(md, /20 pass, 0 fail, 0 skip\./);
        assert.match(md, /## Sub-steps\n\n### C1 — .*\n\n- step 1 integration: pass\n- step 2 test: pass\n- step 3 assignedTerminals: pass\n- step 4 context: pass/);
    });
});

test("two runs with the same --now produce byte-identical reports; a second run without --now passes because its keys are new", async () => {
    // Fresh integration state for each pinned run: the same keys against the same state would be resumes, not new payments.
    const first = join(scratch, "det-a");
    const second = join(scratch, "det-b");
    await withLab({}, lab => runOn(lab, { out: first }));
    await new Promise(resolve => setTimeout(resolve, 5));
    await withLab({}, lab => runOn(lab, { out: second }));
    assert.equal(readFileSync(join(first, "report.json"), "utf8"), readFileSync(join(second, "report.json"), "utf8"));
    // report.md differs only in the header that names the target (the stub's port changes between labs).
    const body = dir => readFileSync(join(dir, "report.md"), "utf8").split("\n").slice(1).join("\n");
    assert.equal(body(first), body(second));
    await withLab({}, async lab => {
        assert.equal((await runOn(lab, { out: join(scratch, "det-c") })).exitCode, 0);
        const again = await run({ cos: lab.cos, key: lab.key, integration: lab.integration, out: join(scratch, "det-d"), timeout: 30000 });
        assert.equal(again.exitCode, 0, "the second run against the same installed integration passes: every key carries a new run id");
        assert.notEqual(byId(again, "P1").calls[0].path, `/payments/pay-${RUN_ID}-P1`);
    });
});

// Each defect fails exactly the scenario it is bound to, with the message that names the contract fact.
const DEFECT_MESSAGE = {
    "no-final-step": [/the stream ended without a final step/],
    "two-final-steps": [/exactly one final step, and it is the last event/],
    "no-space-after-colon": [/one space after "data:"/],
    "processorsId-reused": [new RegExp(`processorsId proc-pay-${RUN_ID}-P1 was already used by P1: CommerceOS refuses a reused processorsId`)],
    "resume-new-transaction": [/expected the same transactionIds .*a resume answers the same transactions, never a second charge/],
    "cancel-refuses": [/expected 2xx, got 409/],
    "credit-refuses": [/expected 200, got 500/],
    "credit-not-idempotent": [/the same request answers the same transaction, never a second one/],
    "cancellable-without-wait": [new RegExp(CANCELLABLE_ALONE)],
    "authorize-only-under-flag": [new RegExp(NOT_CAPTURED_UNDER_FLAG), /expected \[Authorize, Debit\], got \[Authorize\]/],
};
for (const [defect, scenario] of Object.entries(DEFECT_SCENARIO)) {
    test(`defect ${defect} fails ${scenario} and nothing else`, async () => {
        await withLab({ defect }, async lab => {
            const result = await runOn(lab, { out: join(scratch, `defect-${defect}`) });
            assert.equal(result.exitCode, 1);
            assert.deepEqual(result.report.scenarios.filter(s => s.result !== "pass").map(s => s.id), [scenario]);
            const failed = byId(result, scenario);
            for (const pattern of DEFECT_MESSAGE[defect]) assert.ok(failed.failures.some(f => pattern.test(f.message)), `${defect}: ${JSON.stringify(failed.failures)}`);
        });
    });
}

test("defect non-2xx-on-stream fails E2 with the stream-route message and nothing else", async () => {
    await withLab({ defect: "non-2xx-on-stream" }, async lab => {
        const result = await runOn(lab, { out: join(scratch, "defect-non-2xx") });
        assert.equal(result.exitCode, 1);
        assert.deepEqual(result.report.scenarios.filter(s => s.result !== "pass").map(s => s.id), ["E2"]);
        const e2 = byId(result, "E2");
        assert.deepEqual(e2.calls.map(c => c.status), [400]);
        assert.deepEqual(e2.failures.map(f => f.message).slice(0, 2), ["expected 200, got 400", STREAM_NON_2XX]);
    });
});

test("defect drop-token makes P1 fail on transactions[0].token", async () => {
    await withLab({ defect: "drop-token" }, async lab => {
        const result = await runOn(lab, { out: join(scratch, "defect-drop-token") });
        assert.equal(result.exitCode, 1);
        const p1 = byId(result, "P1");
        assert.equal(p1.result, "fail");
        assert.ok(p1.failures.some(f => f.path.endsWith("transactions[0].token")), JSON.stringify(p1.failures));
        // Scenarios without a transaction are untouched by the defect.
        for (const id of ["C1", "L2", "L3", "L4", "L5", "P6", "P7", "P8", "E1", "E2", "H1"]) assert.equal(byId(result, id).result, "pass", id);
    });
});

test("the processorsId register is one per run: a fresh run may reuse the ids of the previous one", async () => {
    // The reference server derives its ids from the keys, and the keys carry the run id, so two pinned runs
    // answer the same ids. Neither run fails: the register does not outlive the run.
    for (const out of ["register-a", "register-b"]) await withLab({}, async lab => assert.equal((await runOn(lab, { out: join(scratch, out) })).exitCode, 0));
});

test("C1 gates the run: an integration that is not Active fails C1 and skips the other nineteen with the reason", async () => {
    await withLab({ integration: { status: "Inactive" } }, async lab => {
        const out = join(scratch, "inactive");
        const result = await runOn(lab, { out });
        assert.equal(result.exitCode, 1);
        assert.deepEqual(result.report.summary, { pass: 0, fail: 1, skip: 19 });
        assert.deepEqual(result.report.scenarios.map(s => s.id), ORDER);
        const reason = 'C1 failed at step 1 integration (status): expected "Active", got "Inactive"';
        for (const id of EPI_IDS) {
            const scenario = byId(result, id);
            assert.equal(scenario.result, "skip", id);
            assert.equal(scenario.reason, reason, id);
            assert.deepEqual(scenario.calls, [], id);
        }
        assert.equal(byId(result, "C1").reason, undefined);
        // Nothing reached the integration.
        assert.deepEqual(lab.stub.callbacks, []);
        const md = readFileSync(join(out, "report.md"), "utf8");
        assert.match(md, /\| C1 \| FAIL \|/);
        assert.match(md, /\| H1 \| skip \|/);
        assert.match(md, /0 pass, 1 fail, 19 skip\./);
        assert.match(md, new RegExp(`## Skipped\\n\\n${EPI_IDS.join(", ")}: ${reason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n$`));
        const meta = JSON.parse(readFileSync(join(out, "meta.json"), "utf8"));
        assert.equal(meta.node, null);
        assert.equal(meta.methodId, METHOD_ID, "what the record said, even though the run stopped");
    });
});

test("the known D1 500 on assignedTerminals is a warning: C1 passes (warn), every scenario runs, the run exits 0", async () => {
    await withLab({ integration: { terminals: "d1" } }, async lab => {
        const out = join(scratch, "d1");
        const result = await runOn(lab, { out });
        assert.equal(result.exitCode, 0);
        assert.deepEqual(result.report.summary, { pass: 20, fail: 0, skip: 0 });
        assert.deepEqual(byId(result, "C1").warnings.map(w => w.path), ["D1"]);
        const md = readFileSync(join(out, "report.md"), "utf8");
        assert.match(md, /\| C1 \| pass \(warn\) \| CommerceOS side: Active, test success per node, assignedTerminals 500, known defect D1, warning, context of the node read \|/);
        assert.match(md, /20 pass, 0 fail, 0 skip, 1 with warnings\./);
        assert.match(md, /## Warnings\n\n### C1 — .*\n\n- step 3 assignedTerminals: `D1` — known platform defect D1: assignedTerminals answers 500 on every instance; Heads owns the fix — details: TypeError: this.sourceIterator.next is not a function/);
    });
    // Any other 500 there is a real failure, and the gate closes.
    await withLab({ integration: { terminals: "500" } }, async lab => {
        const result = await runOn(lab, { out: join(scratch, "crashed") });
        assert.equal(result.exitCode, 1);
        assert.deepEqual(result.report.summary, { pass: 0, fail: 1, skip: 19 });
    });
});

test("--node picks the named configuration, and the integration is called with that node's context", async () => {
    const nodes = [{ name: "First", contextConfigId: "AAAA" }, { name: "Second", contextConfigId: "BBBB" }];
    await withLab({ integration: { nodes } }, async lab => {
        const result = await runOn(lab, { out: join(scratch, "node-second"), node: "Second" });
        assert.equal(result.exitCode, 0);
        assert.equal(result.meta.node, "Second");
        // The reference server's /test read the configuration behind the context id the tool sent.
        assert.deepEqual(lab.stub.callbacks, ["POST /oauth2/v1/token 200", "GET /api/v1/context/config/BBBB 200"]);
    });
    await withLab({ integration: { nodes } }, async lab => {
        const result = await runOn(lab, { out: join(scratch, "node-first") });
        assert.equal(result.meta.node, "First");
        assert.deepEqual(lab.stub.callbacks, ["POST /oauth2/v1/token 200", "GET /api/v1/context/config/AAAA 200"]);
    });
    await withLab({ integration: { nodes } }, async lab => {
        const result = await runOn(lab, { out: join(scratch, "node-third"), node: "Third" });
        assert.equal(result.exitCode, 1);
        assert.deepEqual(result.report.summary, { pass: 0, fail: 1, skip: 19 });
        assert.match(byId(result, "L2").reason, /C1 failed at step 4 context \(node\): Reference is not configured on node "Third"; configured nodes: "First", "Second"/);
    });
});

test("the method id comes from the record, and the profile's methodId overrides it", async () => {
    await withLab({ integration: { methods: ["com.other.method", METHOD_ID] } }, async lab => {
        const bare = await runOn(lab, { out: join(scratch, "method-record") });
        assert.equal(bare.meta.methodId, "com.other.method");
        // The reference server refuses every payment for a method it does not have: the Fail that only E2 expects.
        assert.equal(bare.exitCode, 1);
        assert.equal(byId(bare, "P1").result, "fail");
        assert.match(byId(bare, "P1").failures[0].message, /expected \[Complete\], got \[Fail\]/);
        for (const id of ["C1", "L2", "L3", "L4", "L5", "E2", "H1"]) assert.equal(byId(bare, id).result, "pass", id);
        const profile = join(scratch, "method-profile.json");
        writeFileSync(profile, JSON.stringify({ methodId: METHOD_ID }));
        const overridden = await runOn(lab, { out: join(scratch, "method-profile"), profile, now: "2026-01-02T00:00:00Z" });
        assert.equal(overridden.meta.methodId, METHOD_ID);
        assert.equal(overridden.exitCode, 0);
    });
});

test("L2 is real: a /test that cannot read its configuration through CommerceOS fails L2 and nothing else", async () => {
    // Installed with a client the stub does not know: the token call answers 401, /test answers false.
    await withLab({ client: { ...CLIENT, clientSecret: "wrong" } }, async lab => {
        const result = await runOn(lab, { out: join(scratch, "l2-client") });
        assert.equal(result.exitCode, 1);
        assert.deepEqual(result.report.scenarios.filter(s => s.result !== "pass").map(s => s.id), ["L2"]);
        assert.deepEqual(byId(result, "L2").failures, [{ step: "step 1 test", path: "", message: "expected true, got false" }]);
        assert.deepEqual(lab.stub.callbacks, ["POST /oauth2/v1/token 401"]);
    });
    // CommerceOS answers another hash than the one on the record: the configuration the integration reads is not the one the tool names.
    await withLab({ stub: { configurationHash: "another" } }, async lab => {
        const result = await runOn(lab, { out: join(scratch, "l2-hash") });
        assert.deepEqual(result.report.scenarios.filter(s => s.result !== "pass").map(s => s.id), ["L2"]);
    });
});

test("a profile overrides amounts and currency", async () => {
    const profile = join(scratch, "profile.json");
    writeFileSync(profile, JSON.stringify({ currencyCode: "EUR", amounts: { P1: "20.00", P6: "10.01" } }));
    await withLab({}, async lab => assert.equal((await runOn(lab, { profile, out: join(scratch, "profile-run") })).exitCode, 0));
    const shifted = join(scratch, "profile-shift.json");
    writeFileSync(shifted, JSON.stringify({ amounts: { P6: "10.00" } }));
    await withLab({}, async lab => {
        const broken = await runOn(lab, { profile: shifted, out: join(scratch, "profile-shift-run") });
        const p6 = byId(broken, "P6");
        assert.equal(p6.result, "fail");
        assert.match(p6.failures[0].message, /expected \[Decline\], got \[Complete\]/);
    });
});

test("an installed integration that answers 500 everywhere passes C1, fails from L2 on, and still writes the report", async () => {
    const angry = createServer((request, response) => {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ errors: [{ message: "boom" }] }));
    });
    await new Promise(resolve => angry.listen(0, "127.0.0.1", resolve));
    const stub = await startCosStub({ integrations: { Angry: { baseUrl: `http://127.0.0.1:${angry.address().port}` } } });
    const out = join(scratch, "angry");
    try {
        const result = await run({ cos: stub.url, key: stub.key, integration: "Angry", now: NOW, out, timeout: 2000 });
        assert.equal(result.exitCode, 1);
        assert.equal(byId(result, "C1").result, "pass");
        const l2 = byId(result, "L2");
        assert.equal(l2.result, "fail");
        assert.deepEqual(l2.failures.map(f => f.path), ["status", ""], "the status, and the body that is not the `true` L2 expects");
        assert.match(l2.failures[0].message, /expected 200, got 500/);
        // H1 expects a 400 for the stripped call; a 500 is not it.
        const h1 = byId(result, "H1");
        assert.equal(h1.result, "fail");
        assert.match(h1.failures[0].message, /expected 400, got 500/);
        // The stream route names the platform fact on top of the status mismatch.
        const p1 = byId(result, "P1");
        assert.deepEqual(p1.failures.map(f => f.message).slice(0, 2), ["expected 200, got 500", STREAM_NON_2XX]);
        assert.ok(existsSync(join(out, "report.json")));
        assert.match(readFileSync(join(out, "report.md"), "utf8"), /\| L2 \| FAIL \|/);
    } finally {
        await stub.close();
        angry.closeAllConnections();
        await new Promise(resolve => angry.close(resolve));
    }
});

test("the status of a stream step is the PUT's, not a react sub-call's; a plain-call echo mismatch is reported once; an untranslated reason warns", async () => {
    // A proxy in front of the reference server, listed as the integration's baseUrl: cancel answers 201 (any 2xx
    // passes), one terminal comes back under another id (exactly one failure, on `terminalId`), and P6 declines
    // with a reason the POS does not translate (a warning, not a failure).
    await withLab({}, async lab => {
        const proxy = createServer(async (request, response) => {
            const chunks = [];
            for await (const chunk of request) chunks.push(chunk);
            const body = Buffer.concat(chunks);
            const headers = { ...request.headers };
            delete headers.host;
            const answer = await fetch(`${lab.server.url}${request.url}`, { method: request.method, headers, body: body.length ? body : undefined });
            const responseHeaders = Object.fromEntries([...answer.headers].filter(([name]) => !["content-length", "transfer-encoding"].includes(name)));
            if (request.url.endsWith("/cancel")) { response.writeHead(201, responseHeaders); response.end(await answer.text()); return; }
            if (request.url.endsWith("/terminals/T-01")) { response.writeHead(200, responseHeaders); response.end((await answer.text()).replace('"T-01"', '"T-99"')); return; }
            if (request.url.endsWith("-P6")) { response.writeHead(200, responseHeaders); response.end((await answer.text()).replace('"InsufficientFunds"', '"PiggyEmpty"')); return; }
            response.writeHead(answer.status, responseHeaders);
            Readable.fromWeb(answer.body).pipe(response);
        });
        await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
        const stub = await startCosStub({ integrations: { Proxied: { baseUrl: `http://127.0.0.1:${proxy.address().port}` } } });
        try {
            const result = await run({ cos: stub.url, key: stub.key, integration: "Proxied", now: NOW, out: join(scratch, "proxy"), timeout: 30000 });
            const p7 = byId(result, "P7");
            assert.equal(p7.result, "pass", JSON.stringify(p7.failures));
            const l5 = byId(result, "L5");
            assert.deepEqual(l5.failures.map(f => f.path), ["terminalId"]);
            const p6 = byId(result, "P6");
            assert.equal(p6.result, "pass");
            assert.deepEqual(p6.warnings.map(w => w.path), ["reason"]);
            assert.match(p6.warnings[0].message, new RegExp(`"PiggyEmpty" is not one of the ${TRANSLATED_DECLINE_REASONS.length} reasons the POS translates`));
            assert.match(readFileSync(join(scratch, "proxy", "report.md"), "utf8"), /\| P6 \| pass \(warn\) \|[\s\S]*## Warnings/);
        } finally {
            await stub.close();
            proxy.closeAllConnections();
            await new Promise(resolve => proxy.close(resolve));
        }
    });
});

test("the CLI runs the one mode end to end, exits 0, and exits 2 on a removed flag or a bad argument", async () => {
    await withLab({}, async lab => {
        const out = join(scratch, "cli");
        // Asynchronous, so the lab in this process can answer the child.
        const { stdout } = await promisify(execFile)(process.execPath, [join(here, "run.mjs"), "--cos", lab.cos, "--key", lab.key, "--integration", lab.integration, "--now", NOW, "--out", out], { encoding: "utf8" });
        assert.match(stdout, /20 pass, 0 fail, 0 skip/);
        assert.match(stdout, /Written to /);
    });
    const gone = spawnSync(process.execPath, [join(here, "run.mjs"), "--base", "http://x"], { encoding: "utf8" });
    assert.equal(gone.status, 2);
    assert.match(gone.stderr, /--base is gone\. epi-check has one mode: it tests the integration that a CommerceOS has installed, through that CommerceOS\./);
    const bad = spawnSync(process.execPath, [join(here, "run.mjs"), "--nope"], { encoding: "utf8" });
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /Unknown argument/);
});

test.after(() => rmSync(scratch, { recursive: true, force: true }));
