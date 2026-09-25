import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, stageDocs, TASK, CONFIGURATION, checkAttempt, feedback } from "./trial.mjs";

test("parseArgs: defaults and the four options; no CommerceOS needed", () => {
    assert.deepEqual(parseArgs([]), { attempts: 3, agent: "claude", keep: false });
    assert.equal(parseArgs(["--attempts", "1", "--keep"]).keep, true);
    assert.throws(() => parseArgs(["--attempts", "0"]), /positive integer/);
    assert.throws(() => parseArgs(["--cos", "http://x"]), /Unknown argument/);
    assert.throws(() => parseArgs(["--nope"]), /Unknown argument/);
});

test("the staged workspace holds the published documents and not the sample; the task describes local mode and the configuration", () => {
    const workspace = mkdtempSync(join(tmpdir(), "epi-trial-test-"));
    try {
        const docs = stageDocs(workspace);
        assert.deepEqual(readdirSync(join(docs, "payment-epi")).sort(), ["commerceos-openapi.yaml", "epi-openapi.yaml", "flows.md", "reference.md", "scenarios"]);
        assert.ok(existsSync(join(docs, "payment-epi.md")));
        assert.equal(existsSync(join(docs, "payment-epi", "sample")), false);
        assert.match(TASK, /server\.py/);
        assert.match(TASK, /NOTES\.md/);
        assert.match(TASK, /local mode/);
        assert.match(TASK, new RegExp(CONFIGURATION.merchantId));
        assert.doesNotMatch(TASK, /INTEGRATION\.txt|API key/);
    } finally {
        rmSync(workspace, { recursive: true, force: true });
    }
});

test("checkAttempt: a missing server and a server that never answers both give feedback, not a crash", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "epi-trial-test-"));
    try {
        const missing = await checkAttempt(workspace, workspace);
        assert.equal(missing.exitCode, 1);
        assert.match(feedback(missing), /No `server.py`/);
        writeFileSync(join(workspace, "server.py"), "import time\ntime.sleep(30)\n");
        const silent = await checkAttempt(workspace, workspace);
        assert.equal(silent.exitCode, 1);
        assert.equal(silent.report, null);
        assert.match(feedback(silent), /did not start or did not answer/);
    } finally {
        rmSync(workspace, { recursive: true, force: true });
    }
});
