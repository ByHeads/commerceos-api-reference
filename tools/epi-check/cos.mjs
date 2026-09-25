// The CommerceOS side of the payment EPI (scenario C1): after a partner is installed and configured,
// CommerceOS must show the integration as Active, its `test` method must report `success` for every
// configured node, and `assignedTerminals` must answer 200. C1 also reads what the other scenarios
// need to call the integration as CommerceOS does: its `baseUrl`, its first method, and the context
// of one configured node (the `contextConfigId` of the EPI configuration and the `configurationHash`
// of the assignment), so the run tests the installed instance with its real configuration.
//
// Four read-side calls against `<baseUrl>/api/v1/`, Basic auth with an empty user. No create, no
// install, no configuration write. Response shapes at e70578427aa3dcfecd73780b9d06043aa520da23,
// commerceos-api/src/v1/resources/config/epi-integration.ts:
//   integration       baseUrl, methods[].identifiers.methodId, configurations[] with node.name,
//                     node.identifiers.key, configuration and configurationHash. The record does not
//                     carry the context config id.
//   test              lines 213-228   { integrationName, configurationTests: { "<node>": "success" | "fail" } }
//                                     invoked as POST <element>/test with the boolean parameter as the body,
//                                     the method-endpoint route (a PATCH of `{ test: true }` on the element
//                                     runs the method too, but answers with the element, not the result)
//   assignedTerminals lines 265-287   [ { node, terminals } ]  (500 today: D1, the plan's first defect)
//   epi-configurations  every EPI configuration with identifiers.contextConfigId, node and integration.
//                     No server-side filter narrows it to one integration, so the tool filters the list.
// A 500 carries `{ info, details }` (commerceos-api/src/errors.ts:69-85), and `details` names the cause.

export const COS_SCENARIO = { id: "C1", title: "CommerceOS side: Active, test success per node, assignedTerminals 200, context of the node read" };

/**
 * Known platform defect D1: `assignedTerminals` answers 500 on every current CommerceOS, because the
 * `terminals` member hands the read pipeline a Promise (epi-integration.ts:281-286; unify.ts:196-201).
 * `details` names that refusal. Heads owns the fix, so the tool warns instead of failing the partner,
 * and the warning carries "D1" in `path`. A 500 with any other cause is a real failure.
 */
const D1_STATUS = 500;
const D1_DETAILS = /sourceIterator\.next is not a function|items is not iterable/;
export const D1_WARNING = "known platform defect D1: assignedTerminals answers 500 on every instance; Heads owns the fix";

function joinUrl(baseUrl, path) {
    return baseUrl.replace(/\/+$/, "") + "/api/v1" + (path.startsWith("/") ? path : "/" + path);
}

/**
 * Creates the CommerceOS client. `log` holds `{ method, path, status, ms }` per exchange, as the
 * EPI driver does, so the report treats both the same way.
 */
export function createCosClient({ baseUrl, key, timeoutMs = 30000, fetch = globalThis.fetch }) {
    if (!baseUrl) throw new Error("createCosClient needs a baseUrl");
    if (key === undefined) throw new Error("createCosClient needs an API key");
    const log = [];
    const authorization = `Basic ${Buffer.from(":" + key).toString("base64")}`;

    // One exchange. Returns `{ status, body }` for every HTTP status; throws only when no
    // response arrived (timeout, refused connection).
    async function exchange(method, path, body) {
        const headers = { accept: "application/json", authorization };
        if (body !== undefined) headers["content-type"] = "application/json";
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const started = performance.now();
        try {
            const response = await fetch(joinUrl(baseUrl, path), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
            log.push({ method, path, status: response.status, ms: Math.round(performance.now() - started) });
            const text = await response.text();
            let parsed;
            try { parsed = text ? JSON.parse(text) : undefined; } catch { parsed = text; }
            return { status: response.status, body: parsed };
        } catch (error) {
            log.push({ method, path, status: 0, ms: Math.round(performance.now() - started) });
            const timedOut = error?.name === "AbortError";
            throw new Error(timedOut ? `Timeout after ${timeoutMs} ms: ${method} ${path}` : `Request failed: ${method} ${path}: ${error.message}`, { cause: error });
        } finally {
            clearTimeout(timer);
        }
    }

    const element = name => `/payment-integrations/name=${encodeURIComponent(name)}`;
    return {
        log,
        integration: name => exchange("GET", `${element(name)}?fields=identifiers,status,baseUrl,configurations,methods`),
        test: name => exchange("POST", `${element(name)}/test`, true),
        assignedTerminals: name => exchange("GET", `${element(name)}?fields=assignedTerminals`),
        epiConfigurations: () => exchange("GET", "/epi-configurations?fields=identifiers,node,integration"),
    };
}

const isArray = value => Array.isArray(value);

/**
 * Runs C1 against one integration. Returns the same outcome shape as `runScenario`, plus `steps`:
 * `[{ label, result: "pass" | "fail" | "skip" }]`, one per sub-step. The first failing sub-step
 * ends the scenario, as in every other scenario. On success the outcome also carries `record` (the
 * integration as CommerceOS answered it), `node` (the name of the configured node the run uses) and
 * `context` (`{ configId, configHash, debugInfo }`, what the driver sends in the three X-EPI headers).
 * `node` names the configured node to use; without it the first configuration on the record is used.
 * `title` replaces the row title (local mode says it checked a stand-in).
 */
export async function runCosScenario({ client, integration, node, title = COS_SCENARIO.title }) {
    const outcome = { id: COS_SCENARIO.id, title, result: "pass", failures: [], warnings: [], calls: [], steps: [] };
    const fail = (step, path, message) => outcome.failures.push({ step, path, message });
    const warn = (step, path, message) => outcome.warnings.push({ step, path, message });
    const subSteps = [
        ["step 1 integration", async label => {
            const { status, body } = await client.integration(integration);
            if (status !== 200) { fail(label, "status", `expected 200, got ${status}${describe(body)}`); return; }
            if (!body || typeof body !== "object" || isArray(body)) { fail(label, "", `expected one payment integration, got ${JSON.stringify(body)}`); return; }
            outcome.record = body;
            if (body.status !== "Active") fail(label, "status", `expected "Active", got ${JSON.stringify(body.status)}`);
            if (typeof body.baseUrl !== "string" || body.baseUrl === "") fail(label, "baseUrl", `expected the integration's base URL, got ${JSON.stringify(body.baseUrl)}`);
            if (!isArray(body.configurations) || body.configurations.length < 1) fail(label, "configurations", `expected at least 1 configured node, got ${isArray(body.configurations) ? body.configurations.length : "no array"}`);
            if (!isArray(body.methods) || body.methods.length < 1) fail(label, "methods", `expected at least 1 method, got ${isArray(body.methods) ? body.methods.length : "no array"}`);
            else if (typeof body.methods[0]?.identifiers?.methodId !== "string") fail(label, "methods[0].identifiers.methodId", `expected a method id, got ${JSON.stringify(body.methods[0]?.identifiers?.methodId)}`);
        }],
        ["step 2 test", async label => {
            const { status, body } = await client.test(integration);
            if (status < 200 || status >= 300) { fail(label, "status", `expected 2xx, got ${status}${describe(body)}`); return; }
            const tests = body?.configurationTests;
            if (!tests || typeof tests !== "object" || isArray(tests)) { fail(label, "configurationTests", `expected an object of node results, got ${JSON.stringify(body)}`); return; }
            const nodes = Object.keys(tests);
            if (nodes.length === 0) { fail(label, "configurationTests", "expected at least one configured node, got none"); return; }
            for (const node of nodes) {
                if (tests[node] !== "success") fail(label, `configurationTests.${node}`, `expected "success", got ${JSON.stringify(tests[node])}`);
            }
        }],
        ["step 3 assignedTerminals", async label => {
            const { status, body } = await client.assignedTerminals(integration);
            if (status === 200) {
                if (!isArray(body?.assignedTerminals ?? body)) fail(label, "assignedTerminals", `expected an array, got ${JSON.stringify(body)}`);
                return;
            }
            const details = typeof body?.details === "string" ? body.details : undefined;
            if (status === D1_STATUS && details !== undefined && D1_DETAILS.test(details)) {
                warn(label, "D1", `${D1_WARNING} — details: ${details}`);
                outcome.title = COS_SCENARIO.title.replace("assignedTerminals 200", `assignedTerminals ${status}, known defect D1, warning`);
                return;
            }
            fail(label, "status", `expected 200, got ${status}${details !== undefined ? ` — details: ${details}` : describe(body)}`);
        }],
        // The context CommerceOS sends the integration for one configured node: the assignment on the
        // record gives the hash and the node, the EPI configuration list gives the context config id.
        ["step 4 context", async label => {
            const configurations = outcome.record.configurations;
            const names = configurations.map(c => c?.node?.name);
            const assignment = node === undefined ? configurations[0] : configurations.find(c => c?.node?.name === node);
            if (!assignment) { fail(label, "node", `${integration} is not configured on node ${JSON.stringify(node)}; configured nodes: ${names.map(n => JSON.stringify(n)).join(", ")}`); return; }
            const nodeName = assignment.node?.name;
            const nodeKey = assignment.node?.identifiers?.key;
            if (typeof assignment.configurationHash !== "string" || assignment.configurationHash === "") { fail(label, "configurationHash", `expected the configuration hash of node ${JSON.stringify(nodeName)}, got ${JSON.stringify(assignment.configurationHash)}`); return; }
            const { status, body } = await client.epiConfigurations();
            if (status !== 200) { fail(label, "status", `expected 200, got ${status}${describe(body)}`); return; }
            if (!isArray(body)) { fail(label, "", `expected the list of EPI configurations, got ${JSON.stringify(body)}`); return; }
            const sameNode = c => (nodeKey !== undefined ? c?.node?.identifiers?.key === nodeKey : c?.node?.name === nodeName);
            const configuration = body.find(c => c?.integration?.identifiers?.name === integration && sameNode(c));
            const configId = configuration?.identifiers?.contextConfigId;
            if (typeof configId !== "string" || configId === "") { fail(label, "contextConfigId", `no EPI configuration of ${integration} on node ${JSON.stringify(nodeName)} in GET /epi-configurations`); return; }
            outcome.node = nodeName;
            outcome.context = { configId, configHash: assignment.configurationHash, debugInfo: { nodeName, baseUrl: outcome.record.baseUrl, name: integration } };
        }],
    ];

    for (const [label, step] of subSteps) {
        if (outcome.failures.length > 0) { outcome.steps.push({ label, result: "skip" }); continue; }
        const before = outcome.failures.length;
        try {
            await step(label);
        } catch (error) {
            fail(label, "", error.message);
        }
        outcome.steps.push({ label, result: outcome.failures.length === before ? "pass" : "fail" });
    }
    if (outcome.failures.length > 0) outcome.result = "fail";
    outcome.calls = [...client.log];
    return outcome;
}

function describe(body) {
    if (body === undefined) return "";
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return ` — body: ${text.length > 300 ? text.slice(0, 300) + "…" : text}`;
}
