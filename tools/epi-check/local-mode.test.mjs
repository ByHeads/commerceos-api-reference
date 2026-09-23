// Local mode: the tool starts a stand-in CommerceOS, the stand-in installs and configures the integration as an
// administrator would, and the run then takes the same path as --cos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { startReferenceServer, DEFECT_SCENARIO, METHOD_ID } from "./reference-server.mjs";
import { startPiggyServer, METHOD_ID as PIGGY_METHOD } from "../../guide/examples/payment-epi/sample/server.mjs";
import { run, parseArgs, runIdFor, ORDER, STREAM_NON_2XX } from "./run.mjs";
import { LOCAL_TITLE } from "./cos-stub.mjs";
import { LOCAL_NOTICE } from "./report.mjs";
import { defectMessages } from "./test-lab.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "epi-check-local-"));
const NOW = "2026-01-01T00:00:00Z";
const DEFECT_MESSAGE = defectMessages(runIdFor(NOW));
const byId = (result, id) => result.report.scenarios.find(s => s.id === id);
const local = (url, extra = {}) => run({ local: url, now: NOW, timeout: 10000, ...extra });

async function withReference(options, fn) {
    const server = await startReferenceServer({ now: () => new Date(NOW), ...options });
    try { return await fn(server); } finally { await server.close(); }
}

test("parseArgs: --local and --cos exclude each other; --key, --integration and --node are refused with --local", () => {
    assert.deepEqual(parseArgs(["--local", "http://127.0.0.1:8787/piggy"]), { local: "http://127.0.0.1:8787/piggy", timeout: 30000 });
    assert.throws(() => parseArgs(["--local", "http://x", "--cos", "http://y", "--key", "k", "--integration", "X"]), /--cos and --local exclude each other/);
    for (const flag of ["--key", "--integration", "--node"]) assert.throws(() => parseArgs(["--local", "http://x", flag, "v"]), new RegExp(`${flag} is for --cos`));
});

test("--local against the reference server: 20 pass, 0 fail, 0 skip; mode local in report and meta; the notice opens report.md", async () => {
    await withReference({}, async server => {
        const out = join(scratch, "reference");
        const result = await local(server.url, { out });
        assert.equal(result.exitCode, 0);
        assert.deepEqual(result.report.summary, { pass: 20, fail: 0, skip: 0 });
        assert.deepEqual(result.report.scenarios.map(s => s.id), ORDER);
        assert.equal(byId(result, "C1").title, LOCAL_TITLE);
        assert.equal(result.report.mode, "local");
        const meta = JSON.parse(readFileSync(join(out, "meta.json"), "utf8"));
        assert.equal(meta.mode, "local");
        assert.equal(meta.integration, "Local");
        assert.equal(meta.node, "Local");
        assert.equal(meta.baseUrl, server.url);
        assert.equal(meta.methodId, METHOD_ID, "the method the integration listed on GET /methods");
        const md = readFileSync(join(out, "report.md"), "utf8");
        assert.equal(md.split("\n")[0], LOCAL_NOTICE);
        assert.equal(LOCAL_NOTICE, "Local run against a stand-in CommerceOS: this is not a certification. Heads certifies with --cos against the installed instance.");
        assert.match(md, /^# epi-check report — local stand-in, http:\/\/127\.0\.0\.1:\d+$/m);
        // The stand-in installed its own client on the reference server, and /test read the configuration through it.
        assert.equal(server.installation.clientId, "epi-check-local");
        assert.match(server.installation.tokenUrl, /^http:\/\/127\.0\.0\.1:\d+\/oauth2\/v1\/token$/);
    });
});

test("--local against the Piggy Bank sample with its method id and configuration: 20 of 20, twice in a row", async () => {
    const piggy = await startPiggyServer({ idPrefix: "PB-", waitMs: 200 });
    const profile = join(scratch, "piggy.json");
    writeFileSync(profile, JSON.stringify({ methodId: PIGGY_METHOD, configuration: { merchantId: "M-0001", environment: "TEST" } }));
    try {
        for (const n of [1, 2]) {
            const result = await run({ local: piggy.url, profile, out: join(scratch, `piggy-${n}`), timeout: 10000 });
            assert.deepEqual(result.report.summary, { pass: 20, fail: 0, skip: 0 }, `run ${n}: ${JSON.stringify(result.report.scenarios.filter(s => s.result !== "pass"))}`);
        }
        // Without the configuration the sample's /test answers false: L2 and C1's test are real in local mode too.
        const bare = await run({ local: piggy.url, out: join(scratch, "piggy-bare"), timeout: 10000 });
        assert.equal(bare.exitCode, 1);
        assert.deepEqual(byId(bare, "C1").failures.map(f => f.path), ["configurationTests.Local"]);
        assert.equal(bare.report.summary.skip, 19);
    } finally {
        await piggy.close();
    }
});

for (const [defect, scenario] of Object.entries(DEFECT_SCENARIO)) {
    test(`--local: defect ${defect} fails ${scenario} and nothing else`, async () => {
        await withReference({ defect }, async server => {
            const result = await local(server.url, { out: join(scratch, `defect-${defect}`) });
            assert.equal(result.exitCode, 1);
            assert.deepEqual(result.report.scenarios.filter(s => s.result !== "pass").map(s => s.id), [scenario]);
            const failed = byId(result, scenario);
            for (const pattern of DEFECT_MESSAGE[defect]) assert.ok(failed.failures.some(f => pattern.test(f.message)), `${defect}: ${JSON.stringify(failed.failures)}`);
        });
    });
}

test("--local: defect non-2xx-on-stream fails E2 and nothing else", async () => {
    await withReference({ defect: "non-2xx-on-stream" }, async server => {
        const result = await local(server.url, { out: join(scratch, "defect-non-2xx") });
        assert.deepEqual(result.report.scenarios.filter(s => s.result !== "pass").map(s => s.id), ["E2"]);
        assert.deepEqual(byId(result, "E2").failures.map(f => f.message).slice(0, 2), ["expected 200, got 400", STREAM_NON_2XX]);
    });
});

test("--local: an install the integration refuses fails C1 with the install error and skips the other 19", async () => {
    const refusing = createServer((request, response) => {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ errors: [{ message: "install refused" }] }));
    });
    await new Promise(resolve => refusing.listen(0, "127.0.0.1", resolve));
    try {
        const url = `http://127.0.0.1:${refusing.address().port}/epi`;
        const result = await local(url, { out: join(scratch, "refused") });
        assert.equal(result.exitCode, 1);
        assert.deepEqual(result.report.summary, { pass: 0, fail: 1, skip: 19 });
        const c1 = byId(result, "C1");
        assert.equal(c1.failures[0].step, "step 1 integration");
        assert.match(c1.failures[0].message, new RegExp(`POST ${url.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}/install failed: POST /install answered 500: .*install refused`));
        assert.match(byId(result, "H1").reason, /^C1 failed at step 1 integration \(status\): expected 200, got 502/);
        // Nothing listening at all: the connection error is the install error.
        const closed = createServer();
        await new Promise(resolve => closed.listen(0, "127.0.0.1", resolve));
        const port = closed.address().port;
        await new Promise(resolve => closed.close(resolve));
        const gone = await local(`http://127.0.0.1:${port}/epi`, { out: join(scratch, "unreachable") });
        assert.match(byId(gone, "C1").failures[0].message, /\/install failed: .*ECONNREFUSED/);
    } finally {
        refusing.closeAllConnections();
        await new Promise(resolve => refusing.close(resolve));
    }
});

test("a profile with configuration is refused in --cos mode, with the reason; in --local it is the node's configuration", async () => {
    const profile = join(scratch, "with-config.json");
    writeFileSync(profile, JSON.stringify({ configuration: { merchantId: "M-0001" } }));
    await assert.rejects(run({ cos: "http://127.0.0.1:1", key: "k", integration: "X", profile, now: NOW, out: join(scratch, "cos-config") }), /carries "configuration", which only --local uses: with --cos the configuration lives on CommerceOS/);
    const cli = spawnSync(process.execPath, [join(here, "run.mjs"), "--cos", "http://127.0.0.1:1", "--key", "k", "--integration", "X", "--profile", profile], { encoding: "utf8" });
    assert.equal(cli.status, 2);
    assert.match(cli.stderr, /the configuration lives on CommerceOS/);
    await withReference({}, async server => assert.equal((await local(server.url, { profile, out: join(scratch, "local-config") })).exitCode, 0));
});

test("the CLI runs --local end to end", async () => {
    await withReference({}, async server => {
        const { stdout } = await promisify(execFile)(process.execPath, [join(here, "run.mjs"), "--local", server.url, "--now", NOW, "--out", join(scratch, "cli")], { encoding: "utf8" });
        assert.equal(stdout.split("\n")[0], LOCAL_NOTICE);
        assert.match(stdout, /20 pass, 0 fail, 0 skip/);
    });
});

test.after(() => rmSync(scratch, { recursive: true, force: true }));
