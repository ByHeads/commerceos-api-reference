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
// a defect; the names are in reference-server.mjs). COS mode needs --key <apiKey> and
// --integration <name>, and runs only scenario C1.
//
// Every payment key and token of a run carries a run id (fixtures.json: pay-{{runId}}-{{id}}), because
// an integration stores them and CommerceOS never sends a payment key twice for a new payment. The id
// is derived from --now when given, so a pinned run stays byte-identical, and random otherwise.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDriver, EpiCheckError, DRIVER_CALLS } from "./driver.mjs";
import { startReferenceServer } from "./reference-server.mjs";
import { startCosStandIn } from "../../guide/examples/payment-epi/sample/cos.mjs";
import { createCosClient, runCosScenario } from "./cos.mjs";
import { validate } from "./validate.mjs";
import { deriveStatus, toMinor, scaleOf } from "./status.mjs";
import { buildReport, buildMeta, reportJson, reportMarkdown } from "./report.mjs";

const here = dirname(fileURLToPath(import.meta.url));
// The scenarios live next to the reference that quotes them, so the guide and the tool read the same files.
const SCENARIOS_DIR = resolve(here, "..", "..", "guide", "examples", "payment-epi", "scenarios");
// The CommerceOS commit that contract/dto.schema.json and the scenarios were copied from.
const CONTRACT_COMMIT = "e70578427aa3dcfecd73780b9d06043aa520da23";

export const ORDER = ["L1", "L2", "L3", "L4", "L5", "P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10", "P11", "P12", "E1", "E2", "H1"];

/** Eight hex characters: from `--now` when given (deterministic), else random. */
export function runIdFor(now) {
    return now === undefined ? randomBytes(4).toString("hex") : createHash("sha256").update(String(now)).digest("hex").slice(0, 8);
}

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

function scenarioVars(scenario, fixtures, profile, baseUrl, cosBaseUrl, runId) {
    const amount = profile.amounts?.[scenario.id] ?? scenario.amount;
    const vars = {
        ...fixtures,
        id: scenario.id,
        runId,
        baseUrl,
        cosBaseUrl,
        currencyCode: profile.currencyCode ?? fixtures.currencyCode,
        methodId: profile.methodId ?? fixtures.methodId,
        amount,
        ...(amount !== undefined ? splitAmount(amount) : {}),
    };
    return vars;
}

// ── Checks ───────────────────────────────────────────────────────────────────

/** The final step types (reference section 5): a stream holds exactly one, and it is the last event. */
const FINAL_STEPS = ["Complete", "Decline", "Cancel", "Fail"];
/** The steps that carry the cancel button. The POS shows it on this dialog after `Cancellable`, never on `Cancellable` itself. */
const CANCEL_DIALOG_STEPS = ["Wait", "ShowImage"];
/** The Decline reasons the POS translates (reference section 9). Any other code is shown untranslated in every language. */
export const TRANSLATED_DECLINE_REASONS = ["InsufficientFunds", "CardNotActive", "CardExpired", "CardNotFound", "CardCancelled", "CardFullyRedeemed", "CardBlocked", "InvalidPin", "InvalidCode", "Timeout"];
/** On the stream route CommerceOS never reads a non-2xx body: the error escapes the POS task and the cashier sees no dialog (reference section 7). */
export const STREAM_NON_2XX = "CommerceOS discards the body of a non-2xx on this route and shows the cashier nothing: answer a 200 stream with a Fail step";
export const CANCELLABLE_ALONE = "the POS shows the cancel button on the Wait or ShowImage step after Cancellable; Cancellable alone shows nothing";
/** A till sends `debitSynchronously: true` on every request, Payment and Payout alike, and CommerceOS refuses a Complete under it whose transactions do not leave the order Debited (PaymentMethod.ts:343-349). */
export const NOT_CAPTURED_UNDER_FLAG = "the request carried debitSynchronously: true and the Complete did not capture: CommerceOS refuses this answer and the cashier sees an error";

function statusMatches(expected, actual) {
    if (typeof expected === "number") return expected === actual;
    const match = /^([1-5])xx$/.exec(String(expected));
    if (!match) throw new Error(`Bad status expectation: ${expected}`);
    return Math.floor(actual / 100) === Number(match[1]);
}

function sameJson(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

const isStream = step => step.call === "startPayment";
const is2xx = status => status >= 200 && status < 300;
const transactionIds = result => (Array.isArray(result?.transactions) ? result.transactions.map(t => t?.transactionId) : []).sort();

/** The checks on every stream, whatever the scenario expects. */
function checkStream({ label, events, fail }) {
    const types = events.map(e => e.type);
    const finals = types.map((type, index) => [type, index]).filter(([type]) => FINAL_STEPS.includes(type));
    if (finals.length === 0) fail(label, "events", `the stream ended without a final step (${FINAL_STEPS.join(", ")}), got [${types.join(", ")}]`);
    else if (finals.length > 1 || finals[0][1] !== events.length - 1) fail(label, "events", `a stream holds exactly one final step, and it is the last event; got [${types.join(", ")}]`);
    const cancellable = types.indexOf("Cancellable");
    if (cancellable !== -1 && !types.slice(cancellable + 1, -1).some(type => CANCEL_DIALOG_STEPS.includes(type))) fail(label, "events", CANCELLABLE_ALONE);
}

/**
 * `expect.idempotent` (reference section 11): the step repeats the scenario's previous call of the same kind with
 * the same body, so the answer must be the same. A repeated PUT for a completed key is a resume: the same
 * `processorsId` and the same transactions, never a second charge. A repeated transaction is the same transaction.
 */
function checkIdempotent({ step, label, subject, previous, fail }) {
    if (isStream(step)) {
        const before = previous?.type === "Complete" ? previous.result : undefined;
        const after = subject?.type === "Complete" ? subject.result : undefined;
        if (!before) { fail(label, "", "idempotent needs an earlier Complete in the scenario to compare with"); return; }
        if (!after) { fail(label, "", `expected the earlier Complete again, got ${subject?.type}: a repeated PUT for a completed key is a resume`); return; }
        if (!sameJson(after.processorsId, before.processorsId)) fail(label, "result.processorsId", `expected ${JSON.stringify(before.processorsId)} again, got ${JSON.stringify(after.processorsId)}: a repeated PUT for a completed key is a resume, never a new payment`);
        if (!sameJson(transactionIds(after), transactionIds(before))) fail(label, "result.transactions", `expected the same transactionIds [${transactionIds(before).join(", ")}], got [${transactionIds(after).join(", ")}]: a resume answers the same transactions, never a second charge`);
        return;
    }
    if (!previous || typeof previous !== "object") { fail(label, "", "idempotent needs an earlier transaction in the scenario to compare with"); return; }
    if (!sameJson(subject?.transactionId, previous.transactionId)) fail(label, "transactionId", `expected ${JSON.stringify(previous.transactionId)} again, got ${JSON.stringify(subject?.transactionId)}: the same request answers the same transaction, never a second one`);
}

function checkStep({ step, label, expect, status, subject, previous, events, args, key, transactionsOfStep, state, schemaDoc, fail, warn }) {
    if (expect.status !== undefined && !statusMatches(expect.status, status)) fail(label, "status", `expected ${expect.status}, got ${status}`);
    if (isStream(step) && status !== 0 && !is2xx(status)) fail(label, "status", STREAM_NON_2XX);

    if (events) {
        events.forEach((event, index) => {
            for (const error of validate(schemaDoc, "PaymentStep", event)) fail(label, `events[${index}]${error.path ? "." + error.path : ""}`, error.message);
        });
        // A Wait step between the expected steps is the integration's choice (contract section 5), so the
        // comparison ignores Wait unless the expectation names it.
        const types = events.map(e => e.type).filter(type => type !== "Wait" || expect.events?.includes("Wait"));
        if (expect.events && !sameJson(types, expect.events)) fail(label, "events", `expected [${expect.events.join(", ")}], got [${events.map(e => e.type).join(", ")}]`);
        checkStream({ label, events, fail });
        if (args?.debitSynchronously === true && subject?.type === "Complete") {
            const captured = (Array.isArray(subject.result?.transactions) ? subject.result.transactions : []).some(t => Array.isArray(t?.actions) && t.actions.includes("Debit"));
            if (!captured) fail(label, "result.transactions", NOT_CAPTURED_UNDER_FLAG);
        }
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
        const result = isStream(step) ? subject?.result : subject;
        for (const field of expect.echo) {
            const want = expected(field);
            if (want === undefined) continue;
            if (isStream(step)) {
                // `token` is not on PaymentDto, so the result is checked only for the fields it carries.
                if (result && typeof result === "object" && field in result && !sameJson(result[field], want)) fail(label, `result.${field}`, `expected ${JSON.stringify(want)}, got ${JSON.stringify(result[field])}`);
                transactionsOfStep.forEach((transaction, index) => {
                    if (!sameJson(transaction[field], want)) fail(label, `transactions[${index}].${field}`, `expected ${JSON.stringify(want)}, got ${JSON.stringify(transaction[field])}`);
                });
            } else if (!sameJson(subject?.[field], want)) fail(label, field, `expected ${JSON.stringify(want)}, got ${JSON.stringify(subject?.[field])}`);
        }
    }

    if (expect.idempotent) checkIdempotent({ step, label, subject, previous, fail });

    // A reason outside the translated set is not a contract breach: the cashier reads the raw code.
    if (expect.translatedReason && subject?.type === "Decline" && !TRANSLATED_DECLINE_REASONS.includes(subject.reason)) {
        warn(label, "reason", `${JSON.stringify(subject.reason)} is not one of the ${TRANSLATED_DECLINE_REASONS.length} reasons the POS translates (${TRANSLATED_DECLINE_REASONS.join(", ")}): the cashier sees "Payment declined: ${subject.reason}" untranslated in every language`);
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
    const { driver, strippedDriver, schemaDoc, state, failures, warnings, profile, scenarioId, processorsIds } = context;
    const fail = (stepLabel, path, message) => failures.push({ step: stepLabel, path, message });
    const warn = (stepLabel, path, message) => warnings.push({ step: stepLabel, path, message });
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
        // A non-2xx on the stream route opened no stream: there are no events to check, and CommerceOS
        // would not have read the body either.
        if (isStream(step)) { events = undefined; subject = undefined; }
    }

    const expect = step.expect ?? {};
    const previous = state.results[step.call];
    // An idempotent repeat answers what the scenario already collected, so it is not collected twice.
    if (!expect.idempotent) {
        state.transactions.push(...transactionsOfStep);
        if (transactionsOfStep.length > 0) state.lastTransaction = transactionsOfStep.at(-1);
    }
    state.results[step.call] = subject;

    // CommerceOS refuses a Complete whose processorsId an earlier payment order of the method already
    // carries (reference section 11). A scenario may repeat its own id: that is the resume of P10.
    if (isStream(step) && subject?.type === "Complete" && subject.result?.processorsId !== undefined) {
        const id = subject.result.processorsId;
        const owner = processorsIds.get(id);
        if (owner !== undefined && owner !== scenarioId) fail(label, "result.processorsId", `processorsId ${id} was already used by ${owner}: CommerceOS refuses a reused processorsId`);
        else processorsIds.set(id, scenarioId);
    }

    checkStep({ step, label, expect, status, subject, previous, events, args, key, transactionsOfStep, state, schemaDoc, fail, warn });
}

/**
 * Runs one scenario. `runId` goes into every payment key and token; `processorsIds` (a Map of
 * processorsId to scenario id) is shared by the whole run, so a reuse across scenarios is caught.
 */
export async function runScenario(scenario, { driver, strippedDriver, schemaDoc, fixtures, profile, baseUrl, cosBaseUrl, runId, processorsIds = new Map() }) {
    const outcome = { id: scenario.id, title: scenario.title, result: "pass", failures: [], warnings: [], calls: [] };
    const baseVars = scenarioVars(scenario, fixtures, profile, baseUrl, cosBaseUrl, runId);
    const state = { amount: baseVars.amount, transactions: [], results: {} };
    const context = { driver, strippedDriver, schemaDoc, state, failures: outcome.failures, warnings: outcome.warnings, profile, scenarioId: scenario.id, processorsIds };
    const logStart = { driver: driver.log.length, stripped: strippedDriver.log.length };

    for (const [index, step] of scenario.steps.entries()) {
        const label = `step ${index + 1} ${step.call}`;
        const vars = { ...baseVars, lastTransaction: state.lastTransaction, transactions: state.transactions };
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
    const runId = runIdFor(options.now);
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
    // The CommerceOS side of the install payload: a stand-in that answers the token endpoint for the
    // fixture's client, the configuration of the profile under the context hash of the fixture, and the
    // key-value store. It makes L2 a real test of a /test that reads its configuration.
    const standIn = options.cos ? null : await startCosStandIn({ clientId: fixtures.install.clientId, clientSecret: fixtures.install.clientSecret, configuration: profile.configuration ?? {}, configurationHash: fixtures.context.configHash });
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
            const processorsIds = new Map();
            for (const scenario of scenarios) {
                const outcome = await runScenario(scenario, { driver, strippedDriver, schemaDoc, fixtures, profile, baseUrl, cosBaseUrl: standIn.url, runId, processorsIds });
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
        await standIn?.close();
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
