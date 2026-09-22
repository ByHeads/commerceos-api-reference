#!/usr/bin/env node
// The documentation trial: can a coding agent build a payment integration from the published
// documents alone, and does the conformance tool pass it? This is the acceptance test of the
// documentation. The agent sees the tutorial, the reference, the flows, the two OpenAPI documents
// and the scenarios. It does not see the Piggy Bank sample, the conformance tool's source, or
// CommerceOS. After each attempt the harness starts the integration, runs epi-check against it,
// and hands the report back. The agent's own notes on what the documents left unclear are the
// second output: they name the next documentation fix.
//
//   node tools/epi-check/trial.mjs [--attempts 3] [--out <dir>] [--agent claude] [--model <model>] [--keep]
//
// Needs the `claude` CLI on PATH and Python 3 (the integration is written in Python on the
// standard library, so that the Node sample cannot be copied). Each attempt costs agent time and
// money; the report folder records every attempt.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { run } from "./run.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const DOCS = resolve(here, "..", "..", "guide", "examples");
const METHOD_ID = "com.example.trial";
const BASE_PATH = "/epi";

export function parseArgs(args) {
    const options = { attempts: 3, agent: "claude", keep: false };
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--keep") { options.keep = true; continue; }
        if (!["--attempts", "--out", "--agent", "--model"].includes(arg)) throw new Error(`Unknown argument: ${arg}`);
        if (args[i + 1] === undefined) throw new Error(`Missing value for ${arg}`);
        options[arg.slice(2)] = args[++i];
    }
    options.attempts = Number(options.attempts);
    if (!Number.isInteger(options.attempts) || options.attempts < 1) throw new Error("--attempts must be a positive integer");
    return options;
}

/** Copies the published documents into `workspace/docs`. The sample and the images stay out. */
export function stageDocs(workspace) {
    const docs = join(workspace, "docs");
    mkdirSync(join(docs, "payment-epi"), { recursive: true });
    cpSync(join(DOCS, "payment-epi.md"), join(docs, "payment-epi.md"));
    for (const name of ["reference.md", "flows.md", "epi-openapi.yaml", "commerceos-openapi.yaml"]) cpSync(join(DOCS, "payment-epi", name), join(docs, "payment-epi", name));
    cpSync(join(DOCS, "payment-epi", "scenarios"), join(docs, "payment-epi", "scenarios"), { recursive: true });
    return docs;
}

export const TASK = `# Task: build a payment integration for CommerceOS

You are a developer at a payment provider. Heads, the vendor of CommerceOS, sent you the documents
under \`docs/\`. Build the smallest payment integration that follows the payment EPI they describe:
it talks to no real provider, keeps its state in memory, and answers every call the way the
documents say. You have no access to CommerceOS, to Heads, or to the internet. The documents are
all you get.

Rules:

1. Write it in Python 3, standard library only, in one file: \`server.py\`. It reads the port from
   the environment variable \`PORT\` and serves the routes under the base path \`${BASE_PATH}\`, so
   the base URL is \`http://127.0.0.1:$PORT${BASE_PATH}\`.
2. The single payment method has the id \`${METHOD_ID}\` and requires no terminal. Answer an empty
   terminal list.
3. Follow the test amounts of the tutorial (the cents of the amount select the outcome). Heads
   runs their conformance tool against your endpoint; that tool is your acceptance test.
4. Do not invent behavior that the documents do not state. When the documents leave something
   open or contradict each other, choose the reading that makes the conformance scenarios pass,
   and write the question down.
5. Keep a file \`NOTES.md\` with two lists: *Unclear* (what the documents did not say or said
   twice differently, with the file and section) and *Assumed* (what you decided). Heads reads
   this file to improve the documents. Be concrete and short.

You may start your server and probe it with curl or Python. When a file \`FEEDBACK.md\` exists,
it holds the report of the conformance tool from your previous attempt: read it first and fix
what failed. Stop when \`server.py\` and \`NOTES.md\` are written.
`;

function agentCommand(options, workspace, prompt, sessionId) {
    if (options.agent !== "claude") throw new Error(`Unknown agent: ${options.agent}`);
    const args = ["-p", prompt, "--output-format", "json", "--dangerously-skip-permissions", "--max-turns", "60"];
    if (options.model) args.push("--model", options.model);
    if (sessionId) args.push("--resume", sessionId);
    return { command: "claude", args, env: { ...process.env, CLAUDECODE: undefined, CLAUDE_CODE_ENTRYPOINT: undefined } };
}

function runAgent(options, workspace, prompt, sessionId) {
    const { command, args, env } = agentCommand(options, workspace, prompt, sessionId);
    const started = performance.now();
    const result = spawnSync(command, args, { cwd: workspace, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 30 * 60 * 1000 });
    let parsed = null;
    try { parsed = JSON.parse(result.stdout); } catch { /* the CLI printed no JSON: keep the raw output */ }
    return { exitCode: result.status, durationMs: Math.round(performance.now() - started), sessionId: parsed?.session_id ?? sessionId, costUsd: parsed?.total_cost_usd ?? null, result: parsed?.result ?? result.stdout, stderr: result.stderr };
}

async function waitFor(url, timeoutMs) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
        try { const response = await fetch(url); if (response.status < 500) return true; } catch { /* not up yet */ }
        await new Promise(next => setTimeout(next, 200));
    }
    return false;
}

/** Starts `server.py`, runs epi-check against it, stops it. Returns the run result and the server log. */
export async function checkAttempt(workspace, outDir) {
    if (!existsSync(join(workspace, "server.py"))) return { exitCode: 1, missing: true, report: null, log: "server.py was not written" };
    const port = 20000 + Math.floor(Math.random() * 20000);
    const server = spawn("python3", ["server.py"], { cwd: workspace, env: { ...process.env, PORT: String(port), PYTHONUNBUFFERED: "1" } });
    let log = "";
    server.stdout.on("data", chunk => { log += chunk; });
    server.stderr.on("data", chunk => { log += chunk; });
    const baseUrl = `http://127.0.0.1:${port}${BASE_PATH}`;
    try {
        if (!(await waitFor(`${baseUrl}/config-schema`, 10000))) return { exitCode: 1, report: null, log: `The server did not answer GET ${baseUrl}/config-schema within 10 s.\n${log}` };
        const profile = join(outDir, "profile.json");
        writeFileSync(profile, JSON.stringify({ methodId: METHOD_ID }, null, 4) + "\n");
        const result = await run({ target: baseUrl, profile, out: join(outDir, "epi-check"), timeout: 10000 });
        return { exitCode: result.exitCode, report: result.report, reportMarkdown: readFileSync(join(outDir, "epi-check", "report.md"), "utf8"), log };
    } finally {
        server.kill("SIGTERM");
        await new Promise(resolve => { server.once("exit", resolve); setTimeout(resolve, 2000); });
    }
}

export function feedback(check) {
    if (check.missing) return "# Feedback from the conformance tool\n\nNo `server.py` was found. Write it.\n";
    if (!check.report) return `# Feedback from the conformance tool\n\nThe tool could not run: your server did not start or did not answer.\n\n\`\`\`\n${check.log.slice(-4000)}\n\`\`\`\n`;
    return `# Feedback from the conformance tool\n\n${check.reportMarkdown}\n\n## Your server's log during the run\n\n\`\`\`\n${check.log.slice(-4000)}\n\`\`\`\n`;
}

export async function trial(options) {
    const outDir = resolve(options.out ?? join("epi-check-reports", `trial-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`));
    mkdirSync(outDir, { recursive: true });
    const workspace = mkdtempSync(join(tmpdir(), "epi-trial-"));
    stageDocs(workspace);
    writeFileSync(join(workspace, "TASK.md"), TASK);
    const attempts = [];
    let sessionId;
    let passed = false;
    try {
        for (let n = 1; n <= options.attempts && !passed; n++) {
            const attemptDir = join(outDir, `attempt-${n}`);
            mkdirSync(attemptDir, { recursive: true });
            const prompt = n === 1 ? "Read TASK.md in this directory and do what it says." : "FEEDBACK.md holds the conformance report of your last attempt. Fix server.py so that every scenario passes, and update NOTES.md.";
            console.log(`attempt ${n}: agent working in ${workspace}`);
            const agent = runAgent(options, workspace, prompt, sessionId);
            sessionId = agent.sessionId;
            writeFileSync(join(attemptDir, "agent.json"), JSON.stringify({ exitCode: agent.exitCode, durationMs: agent.durationMs, costUsd: agent.costUsd, sessionId: agent.sessionId, stderr: agent.stderr }, null, 2) + "\n");
            writeFileSync(join(attemptDir, "agent-result.md"), typeof agent.result === "string" ? agent.result : JSON.stringify(agent.result, null, 2));
            for (const name of ["server.py", "NOTES.md"]) if (existsSync(join(workspace, name))) cpSync(join(workspace, name), join(attemptDir, name));
            const check = await checkAttempt(workspace, attemptDir);
            passed = check.exitCode === 0;
            const summary = check.report?.summary ?? null;
            attempts.push({ attempt: n, agentExitCode: agent.exitCode, agentDurationMs: agent.durationMs, costUsd: agent.costUsd, summary, passed });
            console.log(`attempt ${n}: ${summary ? `${summary.pass} pass, ${summary.fail} fail, ${summary.skip} skip` : "the tool could not run"}`);
            writeFileSync(join(workspace, "FEEDBACK.md"), feedback(check));
            cpSync(join(workspace, "FEEDBACK.md"), join(attemptDir, "FEEDBACK.md"));
        }
    } finally {
        if (options.keep) console.log(`workspace kept at ${workspace}`); else rmSync(workspace, { recursive: true, force: true });
    }
    const result = { passed, attempts, notes: attempts.length && existsSync(join(outDir, `attempt-${attempts.length}`, "NOTES.md")) ? readFileSync(join(outDir, `attempt-${attempts.length}`, "NOTES.md"), "utf8") : null, generatedAt: new Date().toISOString(), outDir };
    writeFileSync(join(outDir, "trial.json"), JSON.stringify({ ...result, notes: undefined }, null, 2) + "\n");
    return result;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    let options;
    try { options = parseArgs(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exit(2); }
    const result = await trial(options);
    console.log(result.passed ? `PASS after ${result.attempts.length} attempt(s)` : `FAIL after ${result.attempts.length} attempt(s)`);
    console.log(`Written to ${result.outDir}`);
    if (result.notes) console.log(`\n${result.notes}`);
    process.exit(result.passed ? 0 : 1);
}
