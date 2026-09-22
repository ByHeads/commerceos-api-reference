// A stub CommerceOS for the tests of the tool. Not a test file, not runtime code: run.mjs never imports it.
//
// It plays both halves of CommerceOS on one URL. The four read routes the tool uses (the integration
// record, `test`, `assignedTerminals`, the EPI configuration list) are answered here, under Basic auth
// with the key; everything else, which is what an installed integration calls back (the token endpoint,
// `GET /api/v1/context/config/{id}`, the key-value store, payment-order completion), is forwarded to the
// sample's CommerceOS stand-in, so the reference server can read its configuration through this stub
// as a partner's integration reads its configuration through a real CommerceOS.
//
// `integrations` maps a name to how it behaves; every key has a default:
//   status            "Active"
//   baseUrl           the integration's base URL, where the tool sends every other scenario
//   nodes             [{ name, key, contextConfigId, configurationHash, listed }]; `listed: false` keeps the
//                     node out of the EPI configuration list, as a configuration CommerceOS lost would be
//   methods           [methodId], first one is what the tool uses
//   tests             configurationTests of the POST, default "success" per node
//   terminals         "ok" | "d1" | "500": assignedTerminals 200, the known D1 500, or a 500 with another cause
import { createServer } from "node:http";
import { startCosStandIn } from "../../guide/examples/payment-epi/sample/cos.mjs";
import { startReferenceServer, METHOD_ID } from "./reference-server.mjs";

export const KEY = "opensesame";
export const CLIENT = { clientId: "epi-check", clientSecret: "epi-check-secret", scope: "me geo:read orders.sales:write orders.payments:write payment-records:write kv" };
export const HASH = "v5EXNSP";
/** An EPI configuration of another integration, always in the list: the tool must filter by integration name. */
const NOISE = { identifiers: { key: "2dc0", contextConfigId: "HgI1" }, node: { identifiers: { key: "node-shade" }, name: "Shade AB" }, integration: { identifiers: { key: "221c", name: "Voucher" }, status: "Active" } };

function normalize(name, spec) {
    const nodes = (spec.nodes ?? [{ name: "Shade AB" }]).map((node, index) => ({ key: `node-${index}`, contextConfigId: `CF${index}${index}`, configurationHash: HASH, listed: true, configuration: { merchantId: "M-0001" }, ...node }));
    return {
        status: "Active", baseUrl: "internal://mock", methods: [METHOD_ID], terminals: "ok", ...spec, nodes,
        tests: spec.tests ?? Object.fromEntries(nodes.map(node => [node.name, "success"])),
        key: `key-${name}`,
    };
}

function send(response, status, body) {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
}

/**
 * Starts the stub. Returns `{ url, seen, callbacks, close }`: `seen` holds every API request the tool made
 * (`{ method, url, authorization, body }`), `callbacks` the stand-in's log lines for what the integration
 * called back. `configurationHash` is what the stand-in answers behind every context id: give it the hash of
 * the node under test, or another one to make the integration's `/test` answer false.
 */
export async function startCosStub({ key = KEY, integrations = {}, client = CLIENT, configuration = { merchantId: "M-0001" }, configurationHash = HASH } = {}) {
    const records = Object.fromEntries(Object.entries(integrations).map(([name, spec]) => [name, normalize(name, spec)]));
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
                return send(response, 200, { integrationName: name, configurationTests: record.tests });
            }
            if (request.method === "GET" && !element[2] && fields === "assignedTerminals") {
                if (record.terminals === "d1") return send(response, 500, { info: "An unknown error has occured", details: "TypeError: this.sourceIterator.next is not a function" });
                if (record.terminals === "500") return send(response, 500, { info: "An unknown error has occured", details: "TypeError: Cannot read properties of undefined (reading 'terminals')" });
                return send(response, 200, { assignedTerminals: record.nodes.map(node => ({ node: { identifiers: { key: node.key } }, terminals: [{ terminalId: "T1" }] })) });
            }
            return send(response, 404, { info: `Unhandled ${request.method} ${request.url}` });
        });
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    return {
        url, seen, callbacks, key,
        close: async () => {
            server.closeAllConnections();
            await new Promise(resolve => server.close(resolve));
            await standIn.close();
        },
    };
}

/** Installs an integration the way CommerceOS does: POST /install with the client and the CommerceOS URL. */
export async function install(baseUrl, cosBaseUrl, client = CLIENT) {
    const response = await fetch(`${baseUrl}/install`, { method: "POST", body: JSON.stringify({ cosBaseUrl, tokenUrl: `${cosBaseUrl}/oauth2/v1/token`, ...client }) });
    if (!response.ok) throw new Error(`install answered ${response.status}`);
}

/**
 * The self-test set-up: a reference server (with `defect` switched on, if any), installed on a stub
 * CommerceOS that lists it as `Reference` on node `Shade AB`. `integration` overrides the record, `stub`
 * the stub's other options, `client` the client the reference server is installed with (a wrong one
 * makes its `/test` answer false). Returns `{ cos, key, integration, stub, server, close }`.
 */
export async function startLab({ defect, now, integration = {}, stub: stubOptions = {}, client = CLIENT } = {}) {
    const server = await startReferenceServer({ ...(now ? { now: () => new Date(now) } : {}), defect });
    const stub = await startCosStub({ ...stubOptions, integrations: { Reference: { baseUrl: server.url, ...integration }, ...(stubOptions.integrations ?? {}) } });
    await install(server.url, stub.url, client);
    return {
        cos: stub.url, key: stub.key, integration: "Reference", stub, server,
        close: async () => { await stub.close(); await server.close(); },
    };
}
