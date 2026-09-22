import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, stageDocs, task, checkAttempt, feedback, INTEGRATION_FILE } from "./trial.mjs";

const COS = ["--cos", "http://127.0.0.1:1", "--key", "k"];
// No CommerceOS answers here: the checks below stop before the tool is run.
const check = { cos: "http://127.0.0.1:1", key: "k", port: 20000 + Math.floor(Math.random() * 20000) };

test("parseArgs: the CommerceOS and its key are required, the rest has defaults", () => {
    assert.deepEqual(parseArgs(COS), { cos: "http://127.0.0.1:1", key: "k", attempts: 3, agent: "claude", keep: false });
    assert.equal(parseArgs([...COS, "--attempts", "1", "--keep"]).keep, true);
    assert.throws(() => parseArgs([]), /needs --cos <cosBaseUrl> and --key <apiKey>/);
    assert.throws(() => parseArgs(["--cos", "http://127.0.0.1:1"]), /needs --cos <cosBaseUrl> and --key <apiKey>/);
    assert.throws(() => parseArgs([...COS, "--attempts", "0"]), /positive integer/);
    assert.throws(() => parseArgs([...COS, "--nope"]), /Unknown argument/);
});

test("the staged workspace holds the published documents and not the sample; the task names the CommerceOS, the port and the integration", () => {
    const workspace = mkdtempSync(join(tmpdir(), "epi-trial-test-"));
    try {
        const docs = stageDocs(workspace);
        assert.deepEqual(readdirSync(join(docs, "payment-epi")).sort(), ["commerceos-openapi.yaml", "epi-openapi.yaml", "flows.md", "reference.md", "scenarios"]);
        assert.ok(existsSync(join(docs, "payment-epi.md")));
        assert.equal(existsSync(join(docs, "payment-epi", "sample")), false);
        const text = task({ cos: "http://cos.example", key: "banana", port: 23456, integration: "Trial-abc" });
        assert.match(text, /server\.py/);
        assert.match(text, /NOTES\.md/);
        assert.match(text, /http:\/\/cos\.example/);
        assert.match(text, /API key `banana`/);
        assert.match(text, /http:\/\/127\.0\.0\.1:23456\/epi/);
        assert.match(text, /name `Trial-abc`/);
        assert.match(text, new RegExp(`to \`${INTEGRATION_FILE}\``));
        assert.match(text, /section 5/);
        assert.doesNotMatch(text, /stand-in/);
    } finally {
        rmSync(workspace, { recursive: true, force: true });
    }
});

test("checkAttempt: a missing server, a missing integration name and a server that never answers all give feedback, not a crash", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "epi-trial-test-"));
    try {
        const missing = await checkAttempt(workspace, workspace, check);
        assert.equal(missing.exitCode, 1);
        assert.match(feedback(missing), /No `server.py`/);
        writeFileSync(join(workspace, "server.py"), "import time\ntime.sleep(30)\n");
        const unnamed = await checkAttempt(workspace, workspace, check);
        assert.equal(unnamed.exitCode, 1);
        assert.match(feedback(unnamed), new RegExp(`No \`${INTEGRATION_FILE}\``));
        writeFileSync(join(workspace, INTEGRATION_FILE), "Trial-test\n");
        const silent = await checkAttempt(workspace, workspace, check);
        assert.equal(silent.exitCode, 1);
        assert.equal(silent.report, null);
        assert.match(feedback(silent), /did not start or did not answer/);
    } finally {
        rmSync(workspace, { recursive: true, force: true });
    }
});
