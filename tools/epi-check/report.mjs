// report.json (sorted keys, no wall-clock value), report.md (one row per scenario) and meta.json.
// The self-test runs the tool twice with the same --now and compares report.json byte for byte, so
// nothing time-dependent may enter it beyond the run id that --now pins. Durations and the run time
// go to meta.json.

/** Deep-sorts object keys. Arrays keep their order. */
export function sortKeys(value) {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortKeys(value[key])]));
    }
    return value;
}

/**
 * Builds the report object from scenario outcomes:
 * `[{ id, title, result: "pass" | "fail" | "skip", failures: [{ step, path, message }], warnings: [same shape], calls: [{ method, path, status }] }]`.
 * A warning is something the cashier will notice but the contract allows; it never fails a scenario.
 * An outcome with `steps` (`[{ label, result }]`, the COS scenario) keeps them, one per sub-step.
 */
export function buildReport(outcomes) {
    return sortKeys({
        scenarios: outcomes.map(outcome => ({
            id: outcome.id,
            title: outcome.title,
            result: outcome.result,
            failures: outcome.failures.map(({ step, path, message }) => ({ step, path, message })),
            warnings: (outcome.warnings ?? []).map(({ step, path, message }) => ({ step, path, message })),
            calls: outcome.calls.map(({ method, path, status }) => ({ method, path, status })),
            ...(outcome.steps ? { steps: outcome.steps.map(({ label, result }) => ({ label, result })) } : {}),
        })),
        summary: {
            pass: outcomes.filter(o => o.result === "pass").length,
            fail: outcomes.filter(o => o.result === "fail").length,
            skip: outcomes.filter(o => o.result === "skip").length,
        },
    });
}

export function reportJson(report) {
    return JSON.stringify(report, null, 2) + "\n";
}

export function buildMeta({ target, generatedAt, contractCommit, durationMs }) {
    return sortKeys({ target, generatedAt, contractCommit, durationMs });
}

const marks = { pass: "pass", fail: "FAIL", skip: "skip" };
const mark = scenario => (scenario.result === "pass" && scenario.warnings?.length > 0 ? "pass (warn)" : marks[scenario.result]);

/** Lists `{ step, path, message }` items under one heading per scenario. */
function listUnder(lines, heading, scenarios, field) {
    const listed = scenarios.filter(scenario => scenario[field]?.length > 0);
    if (listed.length === 0) return;
    lines.push("", `## ${heading}`);
    for (const scenario of listed) {
        lines.push("", `### ${scenario.id} — ${scenario.title}`, "");
        for (const item of scenario[field]) lines.push(`- ${item.step}: \`${item.path || "(root)"}\` — ${item.message}`);
    }
}

/** One table row per scenario, failures and warnings listed under the table. */
export function reportMarkdown(report, { target } = {}) {
    const lines = [];
    lines.push(`# epi-check report${target ? ` — ${target}` : ""}`, "");
    lines.push("| Id | Result | Scenario | Calls |", "|---|---|---|---|");
    for (const scenario of report.scenarios) {
        const calls = scenario.calls.map(call => `${call.method} ${call.path} → ${call.status}`).join("<br>");
        lines.push(`| ${scenario.id} | ${mark(scenario)} | ${scenario.title} | ${calls} |`);
    }
    const warned = report.scenarios.filter(scenario => scenario.warnings?.length > 0).length;
    lines.push("", `**${report.summary.pass} pass, ${report.summary.fail} fail, ${report.summary.skip} skip${warned > 0 ? `, ${warned} with warnings` : ""}.**`);
    const stepped = report.scenarios.filter(scenario => scenario.steps);
    if (stepped.length > 0) {
        lines.push("", "## Sub-steps");
        for (const scenario of stepped) {
            lines.push("", `### ${scenario.id} — ${scenario.title}`, "");
            for (const step of scenario.steps) lines.push(`- ${step.label}: ${marks[step.result]}`);
        }
    }
    listUnder(lines, "Failures", report.scenarios, "failures");
    listUnder(lines, "Warnings", report.scenarios, "warnings");
    return lines.join("\n") + "\n";
}
