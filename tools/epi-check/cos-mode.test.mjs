// COS mode (scenario C1) against a stub CommerceOS API. The stub plays a healthy integration
// and one that answers 500 on `assignedTerminals` (D1), with the error body shape of
// commerceos-api/src/errors.ts:69-85.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { run, parseArgs } from "./run.mjs";
import { createCosClient, runCosScenario, COS_SCENARIO } from "./cos.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "epi-check-cos-"));
const NOW = "2026-01-01T00:00:00Z";
const KEY = "opensesame";
const AUTH = `Basic ${Buffer.from(":" + KEY).toString("base64")}`;

// The stub. `integrations` maps a name to how it behaves:
//   status, configurations, methods  -> the first GET
//   tests                            -> configurationTests of the POST
//   terminals: "ok" | "d1"           -> the second GET
const integrations = {
    Mock: { status: "Active", configurations: 1, methods: 2, tests: { Veddesta: "success" }, terminals: "ok" },
    Broken: { status: "Active", configurations: 1, methods: 1, tests: { Veddesta: "success" }, terminals: "d1" },
    Inactive: { status: "Inactive", configurations: 0, methods: 0, tests: {}, terminals: "ok" },
    Flaky: { status: "Active", configurations: 2, methods: 1, tests: { Veddesta: "success", Kungsängen: "fail" }, terminals: "ok" },
};
const seen = [];

function send(response, status, body) {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
}

const stub = createServer((request, response) => {
    let body = "";
    request.on("data", chunk => { body += chunk; });
    request.on("end", () => {
        seen.push({ method: request.method, url: request.url, authorization: request.headers.authorization, body });
        if (request.headers.authorization !== AUTH) return send(response, 401, { info: "Unauthorized" });
        const url = new URL(request.url, "http://stub");
        const match = /^\/api\/v1\/payment-integrations\/name=([^/]+)(\/test)?$/.exec(url.pathname);
        if (!match) return send(response, 404, { info: "Not found" });
        const name = decodeURIComponent(match[1]);
        const isTest = Boolean(match[2]);
        const integration = integrations[name];
        if (!integration) return send(response, 404, { info: `No payment integration named ${name}` });
        const fields = url.searchParams.get("fields");
        if (request.method === "GET" && !isTest && fields === "identifiers,status,baseUrl,configurations,methods") {
            return send(response, 200, {
                identifiers: { key: `key-${name}`, name },
                status: integration.status,
                baseUrl: "internal://mock",
                configurations: Array.from({ length: integration.configurations }, (_, i) => ({ node: { identifiers: { key: `node-${i}` } } })),
                methods: Array.from({ length: integration.methods }, (_, i) => ({ identifiers: { key: `method-${i}` } })),
            });
        }
        if (request.method === "POST" && isTest) {
            if (JSON.parse(body) !== true) return send(response, 400, { info: "Expected the boolean parameter true" });
            return send(response, 200, { integrationName: name, configurationTests: integration.tests });
        }
        if (request.method === "GET" && !isTest && fields === "assignedTerminals") {
            if (integration.terminals === "d1") return send(response, 500, { info: "An unknown error has occured", details: "TypeError: items is not iterable" });
            return send(response, 200, { assignedTerminals: [{ node: { identifiers: { key: "node-0" } }, terminals: [{ terminalId: "T1" }] }] });
        }
        return send(response, 404, { info: `Unhandled ${request.method} ${request.url}` });
    });
});
await new Promise(resolve => stub.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${stub.address().port}/`;

test("parseArgs: --cos needs --key and --integration, and excludes the other modes", () => {
    const options = parseArgs(["--cos", "http://localhost:5000", "--key", KEY, "--integration", "Mock"]);
    assert.deepEqual(options, { cos: "http://localhost:5000", key: KEY, integration: "Mock", timeout: 10000 });
    assert.throws(() => parseArgs(["--cos", "http://localhost:5000"]), /--cos needs --key/);
    assert.throws(() => parseArgs(["--cos", "http://localhost:5000", "--key", KEY]), /--cos needs --key/);
    assert.throws(() => parseArgs(["--cos", "http://localhost:5000", "--key", KEY, "--integration", "Mock", "--reference"]), /exactly one/);
    assert.throws(() => parseArgs(["--reference", "--key", KEY]), /need --cos/);
});

test("C1 passes on a healthy integration: three calls, three sub-steps, Basic auth with an empty user", async () => {
    seen.length = 0;
    const client = createCosClient({ baseUrl, key: KEY, timeoutMs: 2000 });
    const outcome = await runCosScenario({ client, integration: "Mock" });
    assert.equal(outcome.id, "C1");
    assert.equal(outcome.result, "pass");
    assert.deepEqual(outcome.failures, []);
    assert.deepEqual(outcome.steps.map(s => s.result), ["pass", "pass", "pass"]);
    assert.deepEqual(outcome.calls.map(c => `${c.method} ${c.path} → ${c.status}`), [
        "GET /payment-integrations/name=Mock?fields=identifiers,status,baseUrl,configurations,methods → 200",
        "POST /payment-integrations/name=Mock/test → 200",
        "GET /payment-integrations/name=Mock?fields=assignedTerminals → 200",
    ]);
    assert.equal(seen.length, 3);
    for (const request of seen) assert.equal(request.authorization, AUTH);
    assert.equal(seen[1].body, "true");
    // Only these three calls: nothing is created, installed, or configured.
    assert.deepEqual(seen.map(r => r.method), ["GET", "POST", "GET"]);
});

test("C1 fails with D1 when assignedTerminals answers 500, and records the details string", async () => {
    const client = createCosClient({ baseUrl, key: KEY, timeoutMs: 2000 });
    const outcome = await runCosScenario({ client, integration: "Broken" });
    assert.equal(outcome.result, "fail");
    assert.deepEqual(outcome.steps, [
        { label: "step 1 integration", result: "pass" },
        { label: "step 2 test", result: "pass" },
        { label: "step 3 assignedTerminals", result: "fail" },
    ]);
    assert.equal(outcome.failures.length, 1);
    assert.equal(outcome.failures[0].step, "step 3 assignedTerminals");
    assert.equal(outcome.failures[0].path, "D1");
    assert.match(outcome.failures[0].message, /^D1: expected 200, got 500 — details: TypeError: items is not iterable$/);
});

test("C1 stops at the first failing sub-step and names what is wrong", async () => {
    const client = createCosClient({ baseUrl, key: KEY, timeoutMs: 2000 });
    const inactive = await runCosScenario({ client, integration: "Inactive" });
    assert.equal(inactive.result, "fail");
    assert.deepEqual(inactive.steps.map(s => s.result), ["fail", "skip", "skip"]);
    assert.deepEqual(inactive.failures.map(f => f.path), ["status", "configurations", "methods"]);
    assert.match(inactive.failures[0].message, /expected "Active", got "Inactive"/);
    assert.equal(inactive.calls.length, 1);

    const flaky = await runCosScenario({ client: createCosClient({ baseUrl, key: KEY, timeoutMs: 2000 }), integration: "Flaky" });
    assert.deepEqual(flaky.steps.map(s => s.result), ["pass", "fail", "skip"]);
    assert.deepEqual(flaky.failures, [{ step: "step 2 test", path: "configurationTests.Kungsängen", message: 'expected "success", got "fail"' }]);

    const wrongKey = await runCosScenario({ client: createCosClient({ baseUrl, key: "nope", timeoutMs: 2000 }), integration: "Mock" });
    assert.deepEqual(wrongKey.steps.map(s => s.result), ["fail", "skip", "skip"]);
    assert.match(wrongKey.failures[0].message, /expected 200, got 401/);

    const missing = await runCosScenario({ client: createCosClient({ baseUrl, key: KEY, timeoutMs: 2000 }), integration: "Nope" });
    assert.match(missing.failures[0].message, /expected 200, got 404 — body: .*No payment integration named Nope/);
});

test("run --cos writes report.json and report.md with C1 and its sub-steps through report.mjs", async () => {
    const out = join(scratch, "cos-mock");
    const result = await run({ cos: baseUrl, key: KEY, integration: "Mock", now: NOW, out, timeout: 2000 });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.report.scenarios.map(s => s.id), ["C1"]);
    assert.deepEqual(result.report.summary, { pass: 1, fail: 0, skip: 0 });
    const json = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
    assert.deepEqual(Object.keys(json.scenarios[0]), ["calls", "failures", "id", "result", "steps", "title"]);
    assert.deepEqual(json.scenarios[0].steps.map(s => s.result), ["pass", "pass", "pass"]);
    const md = readFileSync(join(out, "report.md"), "utf8");
    assert.match(md, new RegExp(`^\\| C1 \\| pass \\| ${COS_SCENARIO.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\|`, "m"));
    assert.match(md, /## Sub-steps\n\n### C1 — .*\n\n- step 1 integration: pass\n- step 2 test: pass\n- step 3 assignedTerminals: pass/);
    const meta = JSON.parse(readFileSync(join(out, "meta.json"), "utf8"));
    assert.equal(meta.target, baseUrl);
    assert.equal(meta.generatedAt, NOW);

    const broken = await run({ cos: baseUrl, key: KEY, integration: "Broken", now: NOW, out: join(scratch, "cos-broken"), timeout: 2000 });
    assert.equal(broken.exitCode, 1);
    const brokenMd = readFileSync(join(scratch, "cos-broken", "report.md"), "utf8");
    assert.match(brokenMd, /\| C1 \| FAIL \|/);
    assert.match(brokenMd, /- step 3 assignedTerminals: `D1` — D1: expected 200, got 500 — details: TypeError: items is not iterable/);
    assert.ok(existsSync(join(scratch, "cos-broken", "report.json")));
});

test("the CLI runs COS mode end to end", async () => {
    const out = join(scratch, "cli");
    // Asynchronous, so the stub in this process can answer the child.
    const { stdout } = await promisify(execFile)(process.execPath, [join(here, "run.mjs"), "--cos", baseUrl, "--key", KEY, "--integration", "Mock", "--now", NOW, "--out", out], { encoding: "utf8" });
    assert.match(stdout, /1 pass, 0 fail, 0 skip/);
    assert.match(stdout, /Written to /);
});

test.after(async () => {
    stub.closeAllConnections();
    await new Promise(resolve => stub.close(resolve));
    rmSync(scratch, { recursive: true, force: true });
});
