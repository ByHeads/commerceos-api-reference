// A stand-in CommerceOS, for local mode (`run.mjs --local`) and for the tests of the tool.
//
// It plays both halves of CommerceOS on one URL. The four read routes the tool uses (the integration
// record, `test`, `assignedTerminals`, the EPI configuration list) are answered here, under Basic auth
// with the key; everything else, which is what an installed integration calls back (the token endpoint,
// `GET /api/v1/context/config/{id}`, the key-value store, payment-order completion), is forwarded to the
// sample's CommerceOS stand-in (guide/examples/payment-epi/sample/cos.mjs). The tool imports that file
// instead of keeping a copy: the sample folder must stay self-contained for a partner who copies it.
//
// So `run.mjs` reads this stand-in exactly as it reads a real CommerceOS. Local mode adds one thing,
// `startLocalCos`: it plays the administrator against the partner's base URL, as the tutorial's section 5
// does, and then the run proceeds as `--cos <stand-in> --key <key> --integration Local`, the same code path.
//
// `integrations` maps a name to how it behaves; every key has a default:
//   status            "Active"
//   baseUrl           the integration's base URL, where the tool sends every other scenario
//   nodes             [{ name, key, contextConfigId, configurationHash, listed }]; `listed: false` keeps the
//                     node out of the EPI configuration list, as a configuration CommerceOS lost would be
//   methods           [methodId], first one is what the tool uses
//   tests             configurationTests of the POST, default "success" per node; "live" calls the
//                     integration's POST /test with each node's context, as CommerceOS does
//   terminals         "ok" | "d1" | "500": assignedTerminals 200, the known D1 500, or a 500 with another cause
//   installError      the record answers 502 with this as `details`: the install the administrator ran failed
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { startCosStandIn } from "../../guide/examples/payment-epi/sample/cos.mjs";

export const KEY = "opensesame";
export const CLIENT = { clientId: "epi-check", clientSecret: "epi-check-secret", scope: "me geo:read orders.sales:write orders.payments:write payment-records:write kv" };
export const HASH = "v5EXNSP";
/** An EPI configuration of another integration, always in the list: the tool must filter by integration name. */
const NOISE = { identifiers: { key: "2dc0", contextConfigId: "HgI1" }, node: { identifiers: { key: "node-shade" }, name: "Shade AB" }, integration: { identifiers: { key: "221c", name: "Voucher" }, status: "Active" } };

function normalize(name, spec) {
    const nodes = (spec.nodes ?? [{ name: "Shade AB" }]).map((node, index) => ({ key: `node-${index}`, contextConfigId: `CF${index}${index}`, configurationHash: HASH, listed: true, configuration: { merchantId: "M-0001" }, ...node }));
    return {
        status: "Active", baseUrl: "internal://mock", methods: [], terminals: "ok", ...spec, nodes,
        tests: spec.tests ?? Object.fromEntries(nodes.map(node => [node.name, "success"])),
        key: `key-${name}`,
    };
}

function send(response, status, body) {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
}

/** The three X-EPI headers CommerceOS sends an integration for one configured node. */
export function contextHeaders({ contextConfigId, configurationHash, name }, record, integration) {
    return {
        "X-EPI-Context-Config-Id": contextConfigId,
        "X-EPI-Context-Config-Hash": configurationHash,
        "X-EPI-Debug-Info": JSON.stringify({ nodeName: name, baseUrl: record.baseUrl, name: integration }),
    };
}

async function liveTest(record, name, node, timeoutMs) {
    try {
        const response = await fetch(`${record.baseUrl.replace(/\/+$/, "")}/test`, { method: "POST", headers: { accept: "application/json", ...contextHeaders(node, record, name) }, signal: AbortSignal.timeout(timeoutMs) });
        return response.ok && (await response.json().catch(() => undefined)) === true ? "success" : "fail";
    } catch {
        return "fail";
    }
}

/**
 * Starts the stand-in. Returns `{ url, key, seen, callbacks, define, close }`: `seen` holds every API request the
 * tool made (`{ method, url, authorization, body }`), `callbacks` the stand-in's log lines for what the integration
 * called back, `define(name, spec)` adds or replaces an integration record. `client` is the OAuth2 client the token
 * endpoint accepts; `configuration` and `configurationHash` are what it answers behind every context id.
 */
export async function startCosStub({ key = KEY, integrations = {}, client = CLIENT, configuration = { merchantId: "M-0001" }, configurationHash = HASH, timeoutMs = 10000 } = {}) {
    const records = Object.fromEntries(Object.entries(integrations).map(([name, spec]) => [name, normalize(name, { methods: ["com.epicheck.reference"], ...spec })]));
    const auth = `Basic ${Buffer.from(":" + key).toString("base64")}`;
    const seen = [];
    const callbacks = [];
    const standIn = await startCosStandIn({ clientId: client.clientId, clientSecret: client.clientSecret, configuration, configurationHash, log: line => callbacks.push(line) });

    const server = createServer((request, response) => {
        let body = "";
        request.on("data", chunk => { body += chunk; });
        request.on("end", async () => {
            const url = new URL(request.url, "http://stub");
            const element = /^\/api\/v1\/payment-integrations\/name=([^/]+)(\/test)?$/.exec(url.pathname);
            const list = url.pathname === "/api/v1/epi-configurations";
            if (!element && !list) {
                // The other half of CommerceOS: what the installed integration calls back.
                const headers = {};
                for (const name of ["authorization", "content-type", "accept"]) if (request.headers[name]) headers[name] = request.headers[name];
                const answer = await fetch(`${standIn.url}${request.url}`, { method: request.method, headers, body: body || undefined });
                response.writeHead(answer.status, { "content-type": "application/json" });
                return response.end(await answer.text());
            }
            seen.push({ method: request.method, url: request.url, authorization: request.headers.authorization, body });
            if (request.headers.authorization !== auth) return send(response, 401, { info: "Unauthorized" });
            const fields = url.searchParams.get("fields");
            if (list) {
                if (request.method !== "GET" || fields !== "identifiers,node,integration") return send(response, 404, { info: `Unhandled ${request.method} ${request.url}` });
                const listed = Object.entries(records).flatMap(([name, record]) => record.nodes.filter(node => node.listed).map(node => ({
                    identifiers: { key: `${record.key}-${node.key}`, contextConfigId: node.contextConfigId },
                    node: { identifiers: { key: node.key }, name: node.name },
                    integration: { identifiers: { key: record.key, name }, status: record.status },
                })));
                return send(response, 200, [NOISE, ...listed]);
            }
            const name = decodeURIComponent(element[1]);
            const record = records[name];
            if (!record) return send(response, 404, { info: `No payment integration named ${name}` });
            if (record.installError !== undefined) return send(response, 502, { info: "The install of this integration failed", details: record.installError });
            if (request.method === "GET" && !element[2] && fields === "identifiers,status,baseUrl,configurations,methods") {
                return send(response, 200, {
                    identifiers: { key: record.key, name },
                    status: record.status,
                    baseUrl: record.baseUrl,
                    configurations: record.nodes.map(node => ({ node: { identifiers: { key: node.key }, name: node.name }, configuration: node.configuration, configurationHash: node.configurationHash })),
                    methods: record.methods.map((methodId, index) => ({ identifiers: { key: `${record.key}-m${index}`, methodId }, name: methodId })),
                });
            }
            if (request.method === "POST" && element[2]) {
                if (JSON.parse(body) !== true) return send(response, 400, { info: "Expected the boolean parameter true" });
                const tests = record.tests === "live"
                    ? Object.fromEntries(await Promise.all(record.nodes.map(async node => [node.name, await liveTest(record, name, node, timeoutMs)])))
                    : record.tests;
                return send(response, 200, { integrationName: name, configurationTests: tests });
            }
            if (request.method === "GET" && !element[2] && fields === "assignedTerminals") {
                if (record.terminals === "d1") return send(response, 500, { info: "An unknown error has occured", details: "TypeError: this.sourceIterator.next is not a function" });
                if (record.terminals === "500") return send(response, 500, { info: "An unknown error has occured", details: "TypeError: Cannot read properties of undefined (reading 'terminals')" });
                return send(response, 200, { assignedTerminals: record.nodes.map(node => ({ node: { identifiers: { key: node.key } }, terminals: [] })) });
            }
            return send(response, 404, { info: `Unhandled ${request.method} ${request.url}` });
        });
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    return {
        url, seen, callbacks, key,
        define: (name, spec) => { records[name] = normalize(name, spec); },
        close: async () => {
            server.closeAllConnections();
            await new Promise(resolve => server.close(resolve));
            await standIn.close();
        },
    };
}

/** Installs an integration the way CommerceOS does: POST /install with the client and the CommerceOS URL. */
export async function install(baseUrl, cosBaseUrl, client = CLIENT, timeoutMs = 10000) {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/install`, { method: "POST", body: JSON.stringify({ cosBaseUrl, tokenUrl: `${cosBaseUrl}/oauth2/v1/token`, ...client }), signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`POST /install answered ${response.status}${await response.text().then(text => (text ? `: ${text.slice(0, 300)}` : ""), () => "")}`);
}

export const LOCAL = { integration: "Local", node: "Local", contextConfigId: "Loc1" };
export const LOCAL_TITLE = "Local stand-in: installed, test success per node, methods, context of the node read";

/**
 * Local mode: starts the stand-in and plays the administrator against `baseUrl`, in the tutorial's order.
 * Creates the integration record, a generated OAuth2 client, runs `POST /install` with the stand-in's token URL,
 * configures the node `Local` with `configuration` under a context id and a hash, and reads `GET /methods` with
 * that context to create the method records. A failed install stays on the record, so C1 fails with it.
 * Returns the stand-in plus `integration`: run the tool with `--cos url --key key --integration integration`.
 */
export async function startLocalCos({ baseUrl, configuration = {}, timeoutMs = 10000 }) {
    const client = { ...CLIENT, clientId: "epi-check-local", clientSecret: randomBytes(12).toString("hex") };
    const configurationHash = `${LOCAL.contextConfigId}${createHash("sha256").update(JSON.stringify(configuration)).digest("base64url").slice(0, 3)}`;
    const stub = await startCosStub({ client, configuration, configurationHash, timeoutMs });
    const node = { name: LOCAL.node, key: "node-local", contextConfigId: LOCAL.contextConfigId, configurationHash, configuration };
    const spec = { baseUrl, status: "Inactive", nodes: [node], methods: [], tests: "live" };
    try {
        await install(baseUrl, stub.url, client, timeoutMs);
        spec.status = "Active";
    } catch (error) {
        spec.installError = `POST ${baseUrl.replace(/\/+$/, "")}/install failed: ${error.cause?.message ?? error.message}`;
    }
    if (spec.status === "Active") {
        // CommerceOS creates one method record per method the integration lists. A failure leaves none, and C1 says so.
        try {
            const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/methods`, { headers: { accept: "application/json", ...contextHeaders(node, spec, LOCAL.integration) }, signal: AbortSignal.timeout(timeoutMs) });
            const methods = response.ok ? await response.json() : [];
            spec.methods = Array.isArray(methods) ? methods.map(method => method?.methodId).filter(id => typeof id === "string") : [];
        } catch { /* no methods */ }
    }
    stub.define(LOCAL.integration, spec);
    return { ...stub, integration: LOCAL.integration };
}
