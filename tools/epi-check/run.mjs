#!/usr/bin/env node
// The epi-check CLI. Runs every scenario in scenarios/ against a payment integration and writes
// report.json, report.md and meta.json. Exit 0 only when every scenario passes.
//
//   node tools/epi-check/run.mjs --base <yourEpiBaseUrl> --profile p.json
//   node tools/epi-check/run.mjs --reference                       # self-test on the bundled server
//   node tools/epi-check/run.mjs --cos https://<instance> --key <apiKey> --integration <name>
//
// Options: --base <baseUrl> | --reference | --cos <baseUrl>, --profile <file>, --out <dir>,
// --now <iso>, --timeout <ms>, --reference-defect <name> (self-test only: prove the tool catches
// a defect). COS mode needs --key <apiKey> and --integration <name>, and runs only scenario C1.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDriver, EpiCheckError, DRIVER_CALLS } from "./driver.mjs";
import { startReferenceServer } from "./reference-server.mjs";
import { createCosClient, runCosScenario } from "./cos.mjs";
import { validate } from "./validate.mjs";
import { deriveStatus, toMinor, scaleOf } from "./status.mjs";
import { buildReport, buildMeta, reportJson, reportMarkdown } from "./report.mjs";

const here = dirname(fileURLToPath(import.meta.url));
// The scenarios live next to the tutorial, so the guide and the tool read the same files.
const SCENARIOS_DIR = resolve(here, "..", "..", "guide", "examples", "payment-epi", "scenarios");
// The CommerceOS commit that contract/dto.schema.json and the scenarios were copied from.
const CONTRACT_COMMIT = "e70578427aa3dcfecd73780b9d06043aa520da23";

export const ORDER = ["L1", "L2", "L3", "L4", "L5", "P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "E1", "H1"];

export function parseArgs(args) {
    const options = { timeout: 10000 };
    const valued = { "--base": "target", "--profile": "profile", "--out": "out", "--now": "now", "--timeout": "timeout", "--reference-defect": "referenceDefect", "--cos": "cos", "--key": "key", "--integration": "integration" };
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--help") return { help: true };
        if (arg === "--reference") { options.reference = true; continue; }
        if (!Object.hasOwn(valued, arg)) throw new Error(`Unknown argument: ${arg}`);
        if (args[i + 1] === undefined || args[i + 1].startsWith("--")) throw new Error(`Missing value for ${arg}`);
        options[valued[arg]] = args[++i];
    }
    const modes = [options.target, options.reference, options.cos].filter(Boolean).length;
    if (modes !== 1) throw new Error("Give exactly one of --base <baseUrl>, --reference or --cos <baseUrl>.");
    if (options.referenceDefect && !options.reference) throw new Error("--reference-defect needs --reference.");
    if (options.cos && (options.key === undefined || !options.integration)) throw new Error("--cos needs --key <apiKey> and --integration <name>.");
    if (!options.cos && (options.key !== undefined || options.integration)) throw new Error("--key and --integration need --cos.");
    options.timeout = Number(options.timeout);
    if (!Number.isFinite(options.timeout) || options.timeout <= 0) throw new Error("--timeout must be a positive number of milliseconds.");
    if (options.now !== undefined && Number.isNaN(Date.parse(options.now))) throw new Error("--now must be an ISO date.");
    return options;
}

export function loadScenarios() {
    return ORDER.map(id => JSON.parse(readFileSync(join(SCENARIOS_DIR, `${id}.json`), "utf8")));
}

export function loadFixtures() {
    return JSON.parse(readFileSync(join(SCENARIOS_DIR, "fixtures.json"), "utf8"));
}

// ── Placeholders ─────────────────────────────────────────────────────────────

function lookup(vars, name) {
    let value = vars;
    for (const part of name.split(".")) {
        if (value === undefined || value === null) return undefined;
        value = value[part];
    }
    return value;
}

/** Replaces `{{name}}` placeholders. A string that is exactly one placeholder takes the value's type. */
export function resolvePlaceholders(value, vars, depth = 0) {
    if (depth > 10) throw new Error("Placeholder nesting too deep");
    if (typeof value === "string") {
        const whole = /^\{\{([\w.]+)\}\}$/.exec(value);
        if (whole) {
            const found = lookup(vars, whole[1]);
            if (found === undefined) throw new Error(`Unknown placeholder {{${whole[1]}}}`);
            return resolvePlaceholders(found, vars, depth + 1);
        }
        return value.replace(/\{\{([\w.]+)\}\}/g, (_, name) => {
            const found = lookup(vars, name);
            if (found === undefined) throw new Error(`Unknown placeholder {{${name}}}`);
            return String(resolvePlaceholders(found, vars, depth + 1));
        });
    }
    if (Array.isArray(value)) return value.map(item => resolvePlaceholders(item, vars, depth));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolvePlaceholders(item, vars, depth)]));
    return value;
}

function splitAmount(amount) {
    const scale = scaleOf([amount]);
    const total = toMinor(amount, scale);
    const half = total / 2n;
    const format = minor => {
        const digits = minor.toString().padStart(scale + 1, "0");
        return scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
    };
    return { half: format(half), remainder: format(total - half) };
}

function scenarioVars(scenario, fixtures, profile, baseUrl) {
    const amount = profile.amounts?.[scenario.id] ?? scenario.amount;
    const vars = {
        ...fixtures,
        id: scenario.id,
        baseUrl,
        currencyCode: profile.currencyCode ?? fixtures.currencyCode,
        methodId: profile.methodId ?? fixtures.methodId,
        amount,
        ...(amount !== undefined ? splitAmount(amount) : {}),
    };
    return vars;
}

// ── Checks ───────────────────────────────────────────────────────────────────

function statusMatches(expected, actual) {
    if (typeof expected === "number") return expected === actual;
    const match = /^([1-5])xx$/.exec(String(expected));
    if (!match) throw new Error(`Bad status expectation: ${expected}`);
    return Math.floor(actual / 100) === Number(match[1]);
}

function sameJson(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

function checkStep({ step, label, expect, status, subject, events, args, key, transactionsOfStep, state, schemaDoc, fail }) {
    if (expect.status !== undefined && !statusMatches(expect.status, status)) fail(label, "status", `expected ${expect.status}, got ${status}`);

    if (events) {
        events.forEach((event, index) => {
            for (const error of validate(schemaDoc, "PaymentStep", event)) fail(label, `events[${index}]${error.path ? "." + error.path : ""}`, error.message);
        });
        // A Wait step between the expected steps is the integration's choice (contract section 5), so the
        // comparison ignores Wait unless the expectation names it.
        const types = events.map(e => e.type).filter(type => type !== "Wait" || expect.events?.includes("Wait"));
        if (expect.events && !sameJson(types, expect.events)) fail(label, "events", `expected [${expect.events.join(", ")}], got [${events.map(e => e.type).join(", ")}]`);
    }

    if (expect.schema) {
        if (expect.each) {
            if (!Array.isArray(subject)) fail(label, "", `expected an array, got ${typeof subject}`);
            else subject.forEach((item, index) => { for (const error of validate(schemaDoc, expect.schema, item)) fail(label, `[${index}]${error.path ? "." + error.path : ""}`, error.message); });
        } else if (subject === undefined) {
            fail(label, "", `expected a ${expect.schema} body, got none`);
        } else {
            for (const error of validate(schemaDoc, expect.schema, subject)) fail(label, error.path, error.message);
        }
    }
    if (expect.minItems !== undefined && (!Array.isArray(subject) || subject.length < expect.minItems)) fail(label, "", `expected at least ${expect.minItems} items, got ${Array.isArray(subject) ? subject.length : "no array"}`);
    if (expect.unique && Array.isArray(subject)) {
        const seen = new Set();
        subject.forEach((item, index) => {
            const value = item?.[expect.unique];
            if (seen.has(value)) fail(label, `[${index}].${expect.unique}`, `duplicate ${expect.unique} ${JSON.stringify(value)}`);
            seen.add(value);
        });
    }
    for (const name of expect.keys ?? []) {
        if (!subject || typeof subject !== "object" || !(name in subject)) fail(label, name, "expected key is missing");
    }
    if (expect.equals !== undefined && !sameJson(subject, expect.equals)) fail(label, "", `expected ${JSON.stringify(expect.equals)}, got ${JSON.stringify(subject)}`);

    if (expect.actions) {
        if (transactionsOfStep.length !== expect.actions.length) fail(label, "transactions", `expected ${expect.actions.length} transaction(s), got ${transactionsOfStep.length}`);
        expect.actions.forEach((actions, index) => {
            const actual = transactionsOfStep[index]?.actions;
            if (actual !== undefined && !sameJson(actual, actions)) fail(label, `transactions[${index}].actions`, `expected [${actions.join(", ")}], got [${actual.join(", ")}]`);
        });
    }

    if (expect.echo) {
        const expected = field => (args && typeof args === "object" ? args[field] : key);
        const result = step.call === "startPayment" ? subject?.result : subject;
        for (const field of expect.echo) {
            const want = expected(field);
            if (want === undefined) continue;
            if (step.call === "startPayment") {
                // `token` is not on PaymentDto, so the result is checked only for the fields it carries.
                if (result && typeof result === "object" && field in result && !sameJson(result[field], want)) fail(label, `result.${field}`, `expected ${JSON.stringify(want)}, got ${JSON.stringify(result[field])}`);
                transactionsOfStep.forEach((transaction, index) => {
                    if (!sameJson(transaction[field], want)) fail(label, `transactions[${index}].${field}`, `expected ${JSON.stringify(want)}, got ${JSON.stringify(transaction[field])}`);
                });
            } else if (!sameJson(subject?.[field], want)) fail(label, field, `expected ${JSON.stringify(want)}, got ${JSON.stringify(subject?.[field])}`);
        }
    }

    if (expect.derivedStatus) {
        try {
            const derived = deriveStatus({ limitAmount: state.amount, transactions: state.transactions });
            if (!sameJson(derived, [...expect.derivedStatus].sort())) fail(label, "derivedStatus", `expected [${expect.derivedStatus.join(", ")}], got [${derived.join(", ")}]`);
        } catch (error) {
            fail(label, "derivedStatus", error.message);
        }
    }
}

// ── Scenario runner ──────────────────────────────────────────────────────────

async function runStep(step, label, vars, context) {
    const { driver, strippedDriver, schemaDoc, state, failures, profile } = context;
    const fail = (stepLabel, path, message) => failures.push({ step: stepLabel, path, message });
    const d = step.stripContext ? strippedDriver : driver;
    if (!DRIVER_CALLS.includes(step.call)) { fail(label, "call", `unknown driver call ${step.call}`); return; }

    let args, key;
    try {
        args = step.args === undefined ? undefined : resolvePlaceholders(step.args, vars);
        key = step.key === undefined ? undefined : resolvePlaceholders(step.key, vars);
    } catch (error) {
        fail(label, "args", error.message);
        return;
    }
    if (profile.terminalId && args && typeof args === "object" && (step.call === "startPayment" || step.call === "cancel")) args.terminalId = profile.terminalId;

    let status = 0, subject, events, transactionsOfStep = [];
    const logIndex = d.log.length; // a `react` sub-call logs after this call, so `at(-1)` would read the wrong one
    try {
        if (step.call === "startPayment") {
            events = [];
            for await (const event of d.startPayment(key, args)) {
                events.push(event);
                const reaction = step.react?.[event.type];
                if (reaction) await runStep(reaction, `${label} on ${event.type}`, { ...vars, event }, context);
            }
            subject = events.at(-1);
            transactionsOfStep = Array.isArray(subject?.result?.transactions) ? subject.result.transactions : [];
        } else {
            const positional = [...(key !== undefined ? [key] : []), ...(args !== undefined ? [args] : [])];
            subject = await d[step.call](...positional);
            if (step.call === "transaction" && subject && typeof subject === "object") transactionsOfStep = [subject];
        }
        status = d.log[logIndex]?.status ?? 0;
    } catch (error) {
        if (!(error instanceof EpiCheckError)) { fail(label, "", error.message); return; }
        status = error.status;
        subject = error.errors ? { errors: error.errors } : undefined;
        if (status === 0) fail(label, "", error.message);
    }

    state.transactions.push(...transactionsOfStep);
    if (transactionsOfStep.length > 0) state.lastTransaction = transactionsOfStep.at(-1);
    state.results[step.call] = subject;

    checkStep({ step, label, expect: step.expect ?? {}, status, subject, events, args, key, transactionsOfStep, state, schemaDoc, fail });
}

export async function runScenario(scenario, { driver, strippedDriver, schemaDoc, fixtures, profile, baseUrl, reference }) {
    const outcome = { id: scenario.id, title: scenario.title, result: "pass", failures: [], calls: [] };
    if (scenario.referenceOnly && !reference) { outcome.result = "skip"; return outcome; }
    const baseVars = scenarioVars(scenario, fixtures, profile, baseUrl);
    const state = { amount: baseVars.amount, transactions: [], results: {} };
    const context = { driver, strippedDriver, schemaDoc, state, failures: outcome.failures, profile };
    const logStart = { driver: driver.log.length, stripped: strippedDriver.log.length };

    for (const [index, step] of scenario.steps.entries()) {
        const label = `step ${index + 1} ${step.call}`;
        const vars = { ...baseVars, lastTransaction: state.lastTransaction };
        if (step.forEach) {
            const items = state.results[step.forEach];
            if (!Array.isArray(items)) { outcome.failures.push({ step: label, path: "forEach", message: `no array result from ${step.forEach}` }); break; }
            for (const [itemIndex, item] of items.entries()) await runStep(step, `${label}[${itemIndex}]`, { ...vars, item }, context);
        } else {
            await runStep(step, label, vars, context);
        }
        if (outcome.failures.length > 0) break;
    }
    if (outcome.failures.length > 0) outcome.result = "fail";
    // The driver logs a call when its response arrives, so a cancel sent during a stream
    // lands after the PUT that opened the stream.
    outcome.calls = [...driver.log.slice(logStart.driver), ...strippedDriver.log.slice(logStart.stripped)];
    return outcome;
}

// ── Whole run ────────────────────────────────────────────────────────────────

function stripContextFetch(fetchImpl = globalThis.fetch) {
    return (url, init = {}) => {
        const headers = Object.fromEntries(Object.entries(init.headers ?? {}).filter(([name]) => !/^x-epi-/i.test(name)));
        return fetchImpl(url, { ...init, headers });
    };
}

function defaultOut(target, generatedAt) {
    const date = generatedAt.slice(0, 10);
    const host = target === "reference" ? "reference" : new URL(target).hostname;
    return join(process.cwd(), "epi-check-reports", `${date}-${host}`);
}

/** Runs every scenario and writes the three files. Returns `{ report, meta, outDir, exitCode }`. */
export async function run(options) {
    const started = performance.now();
    const generatedAt = options.now ?? new Date().toISOString();
    const schemaDoc = JSON.parse(readFileSync(join(here, "contract", "dto.schema.json"), "utf8"));
    const fixtures = loadFixtures();
    const profile = options.profile ? JSON.parse(readFileSync(resolve(options.profile), "utf8")) : {};
    const scenarios = loadScenarios();

    let server;
    let baseUrl = options.target;
    if (options.reference) {
        const clock = options.now ? new Date(options.now) : undefined;
        server = await startReferenceServer({ ...(clock ? { now: () => clock } : {}), defect: options.referenceDefect });
        baseUrl = server.url;
    }
    const targetLabel = options.reference ? "reference" : (options.cos ?? options.target);
    const outDir = resolve(options.out ?? defaultOut(targetLabel, generatedAt));

    try {
        const outcomes = [];
        if (options.cos) {
            // COS mode: the CommerceOS side only. The integration scenarios need a partner URL.
            const client = createCosClient({ baseUrl: options.cos, key: options.key, timeoutMs: options.timeout });
            const outcome = await runCosScenario({ client, integration: options.integration });
            outcomes.push(outcome);
        } else {
            const context = resolvePlaceholders(fixtures.context, { baseUrl });
            const driver = createDriver({ baseUrl, context, timeoutMs: options.timeout });
            const strippedDriver = createDriver({ baseUrl, context, timeoutMs: options.timeout, fetch: stripContextFetch() });
            for (const scenario of scenarios) {
                const outcome = await runScenario(scenario, { driver, strippedDriver, schemaDoc, fixtures, profile, baseUrl, reference: Boolean(options.reference) });
                outcomes.push(outcome);
            }
        }
        const report = buildReport(outcomes);
        const meta = buildMeta({ target: targetLabel, generatedAt, contractCommit: CONTRACT_COMMIT, durationMs: Math.round(performance.now() - started) });
        mkdirSync(outDir, { recursive: true });
        writeFileSync(join(outDir, "report.json"), reportJson(report));
        writeFileSync(join(outDir, "report.md"), reportMarkdown(report, { target: targetLabel }));
        writeFileSync(join(outDir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
        return { report, meta, outDir, exitCode: report.summary.fail === 0 ? 0 : 1 };
    } finally {
        await server?.close();
    }
}

const usage = `Usage: node tools/epi-check/run.mjs (--base <baseUrl> | --reference | --cos <baseUrl> --key <apiKey> --integration <name>) [--profile <file>] [--out <dir>] [--now <iso>] [--timeout <ms>] [--reference-defect <name>]`;

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    let options;
    try {
        options = parseArgs(process.argv.slice(2));
    } catch (error) {
        console.error(error.message);
        console.error(usage);
        process.exit(2);
    }
    if (options.help) { console.log(usage); process.exit(0); }
    const { report, meta, outDir, exitCode } = await run(options);
    process.stdout.write(reportMarkdown(report, { target: meta.target }));
    console.log(`Written to ${outDir}`);
    process.exit(exitCode);
}
