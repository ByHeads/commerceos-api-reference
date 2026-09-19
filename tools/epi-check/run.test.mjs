import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { startReferenceServer } from "./reference-server.mjs";
import { run, parseArgs, resolvePlaceholders, ORDER } from "./run.mjs";
import { validate } from "./validate.mjs";
import { buildReport, reportJson, reportMarkdown, sortKeys } from "./report.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const schemaDoc = JSON.parse(readFileSync(join(here, "contract", "dto.schema.json"), "utf8"));
const scratch = mkdtempSync(join(tmpdir(), "epi-check-"));
const NOW = "2026-01-01T00:00:00Z";

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

test("report: sorted keys, no timestamps, markdown rows", () => {
    const report = buildReport([
        { id: "L1", title: "Install", result: "pass", failures: [], calls: [{ method: "POST", path: "/install", status: 200, ms: 3 }] },
        { id: "P1", title: "Sale", result: "fail", failures: [{ step: "step 1", path: "x", message: "bad" }], calls: [] },
        { id: "H1", title: "Headers", result: "skip", failures: [], calls: [] },
    ]);
    const text = reportJson(report);
    assert.equal(text.includes("ms"), false);
    assert.deepEqual(Object.keys(JSON.parse(text)), ["scenarios", "summary"]);
    assert.deepEqual(Object.keys(JSON.parse(text).scenarios[0]), ["calls", "failures", "id", "result", "title"]);
    assert.deepEqual(sortKeys({ b: [{ z: 1, a: 2 }], a: null }), { a: null, b: [{ a: 2, z: 1 }] });
    const md = reportMarkdown(report, { target: "reference" });
    assert.match(md, /^\| L1 \| pass \| Install \| POST \/install → 200 \|$/m);
    assert.match(md, /^\| P1 \| FAIL \| Sale \|  \|$/m);
    assert.match(md, /1 pass, 1 fail, 1 skip/);
    assert.match(md, /- step 1: `x` — bad/);
});

test("parseArgs and placeholders", () => {
    assert.deepEqual(parseArgs(["--reference", "--now", NOW]), { reference: true, now: NOW, timeout: 10000 });
    assert.equal(parseArgs(["--base", "http://x", "--timeout", "500"]).timeout, 500);
    assert.throws(() => parseArgs([]), /exactly one/);
    assert.throws(() => parseArgs(["--reference", "--base", "http://x"]), /exactly one/);
    assert.throws(() => parseArgs(["--base", "http://x", "--reference-defect", "drop-token"]), /needs --reference/);
    assert.throws(() => parseArgs(["--reference", "--bogus"]), /Unknown argument/);
    const vars = { id: "P1", amount: "100.05", token: "tok-{{id}}", payer: { key: "k" } };
    assert.equal(resolvePlaceholders("{{token}}", vars), "tok-P1");
    assert.deepEqual(resolvePlaceholders({ a: "{{payer}}", b: "x-{{id}}" }, vars), { a: { key: "k" }, b: "x-P1" });
    assert.throws(() => resolvePlaceholders("{{nope}}", vars), /Unknown placeholder/);
});

test("--reference passes every scenario, in the fixed order", async () => {
    const out = join(scratch, "ref-1");
    const result = await run({ reference: true, now: NOW, out, timeout: 10000 });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.report.scenarios.map(s => s.id), ORDER);
    assert.deepEqual(result.report.scenarios.map(s => s.result), ORDER.map(() => "pass"));
    for (const name of ["report.json", "report.md", "meta.json"]) assert.ok(existsSync(join(out, name)), name);
    const meta = JSON.parse(readFileSync(join(out, "meta.json"), "utf8"));
    assert.equal(meta.target, "reference");
    assert.equal(meta.generatedAt, NOW);
    assert.match(meta.contractCommit, /^[0-9a-f]{40}$/);
    assert.equal(typeof meta.durationMs, "number");
    // P7 shows the cancel call once, after the PUT that opened the stream.
    const p7 = result.report.scenarios.find(s => s.id === "P7");
    assert.deepEqual(p7.calls.map(c => `${c.method} ${c.path}`), ["PUT /payments/pay-P7", "POST /payments/pay-P7/cancel"]);
});

test("two --reference runs produce byte-identical report.json", async () => {
    const first = join(scratch, "ref-a");
    const second = join(scratch, "ref-b");
    await run({ reference: true, out: first, timeout: 10000 });
    await new Promise(resolve => setTimeout(resolve, 5));
    await run({ reference: true, out: second, timeout: 10000 });
    assert.equal(readFileSync(join(first, "report.json"), "utf8"), readFileSync(join(second, "report.json"), "utf8"));
    assert.equal(readFileSync(join(first, "report.md"), "utf8"), readFileSync(join(second, "report.md"), "utf8"));
});

test("--reference-defect drop-token makes P1 fail on transactions[0].token", async () => {
    const result = await run({ reference: true, referenceDefect: "drop-token", now: NOW, out: join(scratch, "defect"), timeout: 10000 });
    assert.equal(result.exitCode, 1);
    const p1 = result.report.scenarios.find(s => s.id === "P1");
    assert.equal(p1.result, "fail");
    assert.ok(p1.failures.some(f => f.path.endsWith("transactions[0].token")), JSON.stringify(p1.failures));
    // Scenarios without a transaction are untouched by the defect.
    for (const id of ["L1", "L2", "L3", "L4", "L5", "P6", "P7", "P8", "E1", "H1"]) assert.equal(result.report.scenarios.find(s => s.id === id).result, "pass", id);
});

test("a profile overrides amounts, currency and method", async () => {
    const profile = join(scratch, "profile.json");
    writeFileSync(profile, JSON.stringify({ currencyCode: "EUR", amounts: { P1: "20.00", P6: "10.01" } }));
    const result = await run({ reference: true, now: NOW, profile, out: join(scratch, "profile-run"), timeout: 10000 });
    assert.equal(result.exitCode, 0);
    const shifted = join(scratch, "profile-shift.json");
    writeFileSync(shifted, JSON.stringify({ amounts: { P6: "10.00" } }));
    const broken = await run({ reference: true, now: NOW, profile: shifted, out: join(scratch, "profile-shift-run"), timeout: 10000 });
    const p6 = broken.report.scenarios.find(s => s.id === "P6");
    assert.equal(p6.result, "fail");
    assert.match(p6.failures[0].message, /expected \[Decline\], got \[Complete\]/);
});

test("--base against a server that answers 500 everywhere fails L1 and still writes the report", async () => {
    const angry = createServer((request, response) => {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ errors: [{ message: "boom" }] }));
    });
    await new Promise(resolve => angry.listen(0, "127.0.0.1", resolve));
    const out = join(scratch, "angry");
    try {
        const result = await run({ target: `http://127.0.0.1:${angry.address().port}`, now: NOW, out, timeout: 2000 });
        assert.equal(result.exitCode, 1);
        const l1 = result.report.scenarios.find(s => s.id === "L1");
        assert.equal(l1.result, "fail");
        assert.deepEqual(l1.failures.map(f => f.path), ["status"]);
        assert.match(l1.failures[0].message, /expected 2xx, got 500/);
        assert.equal(result.report.scenarios.find(s => s.id === "H1").result, "skip");
        assert.ok(existsSync(join(out, "report.json")));
        assert.match(readFileSync(join(out, "report.md"), "utf8"), /\| L1 \| FAIL \|/);
    } finally {
        angry.closeAllConnections();
        await new Promise(resolve => angry.close(resolve));
    }
});

test("the status of a stream step is the PUT's, not a react sub-call's; a plain-call echo mismatch is reported once", async () => {
    // A proxy in front of the reference server: cancel answers 201 (any 2xx passes), and one terminal
    // comes back under another id (exactly one failure, on `terminalId`).
    const upstream = await startReferenceServer({ now: () => new Date(NOW) });
    const proxy = createServer(async (request, response) => {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        const headers = { ...request.headers };
        delete headers.host;
        const answer = await fetch(`${upstream.url}${request.url}`, { method: request.method, headers, body: body.length ? body : undefined });
        const responseHeaders = Object.fromEntries([...answer.headers].filter(([name]) => !["content-length", "transfer-encoding"].includes(name)));
        if (request.url.endsWith("/cancel")) { response.writeHead(201, responseHeaders); response.end(await answer.text()); return; }
        if (request.url.endsWith("/terminals/T-01")) { response.writeHead(200, responseHeaders); response.end((await answer.text()).replace('"T-01"', '"T-99"')); return; }
        response.writeHead(answer.status, responseHeaders);
        Readable.fromWeb(answer.body).pipe(response);
    });
    await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
    try {
        const result = await run({ target: `http://127.0.0.1:${proxy.address().port}`, now: NOW, out: join(scratch, "proxy"), timeout: 10000 });
        const p7 = result.report.scenarios.find(s => s.id === "P7");
        assert.equal(p7.result, "pass", JSON.stringify(p7.failures));
        const l5 = result.report.scenarios.find(s => s.id === "L5");
        assert.deepEqual(l5.failures.map(f => f.path), ["terminalId"]);
    } finally {
        proxy.closeAllConnections();
        await new Promise(resolve => proxy.close(resolve));
        await upstream.close();
    }
});

test("the CLI exits 0 on --reference and 2 on a bad argument", () => {
    const out = join(scratch, "cli");
    const stdout = execFileSync(process.execPath, [join(here, "run.mjs"), "--reference", "--now", NOW, "--out", out], { encoding: "utf8" });
    assert.match(stdout, /16 pass, 0 fail, 0 skip/);
    assert.match(stdout, /Written to /);
    const bad = spawnSync(process.execPath, [join(here, "run.mjs"), "--nope"], { encoding: "utf8" });
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /Unknown argument/);
});

test.after(() => rmSync(scratch, { recursive: true, force: true }));
