// A CommerceOS stand-in for the calls that a payment integration makes back (contract reference, section 8):
// the token endpoint, the configuration behind a context id, the integration's key-value store under
// /api/v1/context/{store}/{key}, and the completion of a payment order. In memory, node:http only, no
// install. It is not CommerceOS: it answers the shapes of the reference so that both directions run on one laptop.
//
//   node cos.mjs                        # at http://localhost:8790 (COS_PORT to change)
//   node play.mjs 10.04 --cos           # starts it in-process and installs the bank against it
//
// Every call except the token call needs `Authorization: Bearer <token>` from this stand-in's own
// token endpoint, else 401. One log line per call: method, path, status.
import { createServer } from "node:http";
import { createHash } from "node:crypto";

export const CLIENT = { clientId: "play", clientSecret: "play-secret" };
const CONFIG = {
    configuration: { merchantId: "M-0001", environment: "TEST" },
    configurationType: "piggy configuration",
    // The same named types as CONFIG_SCHEMA in server.mjs: what the bank's GET /config-schema answered when
    // the administrator opened the form. Copied, not imported, so that this file runs on its own.
    schema: { "piggy configuration": { description: "Merchant account at Piggy Bank", members: { merchantId: { type: "string", title: "Merchant id" }, environment: { type: "'TEST' or 'LIVE'", title: "Environment", description: "TEST until go-live" } } } },
};

/** The configuration hash as CommerceOS computes it: SHA-256 of the JSON of the stored values, URL-safe base64, 43 characters. */
const hashOf = configuration => createHash("sha256").update(JSON.stringify(configuration)).digest("base64url");

/** Reference section 9: the status flags of an order, derived from the actions of its records. */
export function orderStatus(records) {
    const status = new Set();
    for (const { actions = [] } of records) {
        if (actions.includes("Debit")) status.add("Debited");
        else if (actions.includes("Authorize")) status.add("Authorized");
        if (actions.includes("Annul")) status.add("Annulled");
        if (actions.includes("Credit")) status.add("Credited");
    }
    return [...status];
}

function readBody(request) {
    return new Promise((resolve, reject) => {
        let text = "";
        request.on("data", chunk => { text += chunk; });
        request.on("end", () => resolve(text));
        request.on("error", reject);
    });
}

/**
 * Starts the stand-in. `clientId` and `clientSecret` are the OAuth2 client of the install payload;
 * `configuration`, `configurationHash`, `configurationType` and `schema` are what GET /api/v1/context/config/{id}
 * answers for every id. The hash defaults to the real one, SHA-256 of the configuration's JSON in URL-safe base64,
 * which is also what CommerceOS sends in X-EPI-Context-Config-Hash.
 * Returns `{ url, store, close }`: `store` maps "store/key" to the stored JSON.
 */
export function startCosStandIn({ port = 0, clientId = CLIENT.clientId, clientSecret = CLIENT.clientSecret, configuration = CONFIG.configuration, configurationHash = hashOf(configuration), configurationType = CONFIG.configurationType, schema = CONFIG.schema, log = () => {} } = {}) {
    const tokens = new Set();
    const store = new Map();
    const orders = new Map();
    let tokenCount = 0;

    const server = createServer(async (request, response) => {
        const url = new URL(request.url, "http://localhost");
        const route = `${request.method} ${url.pathname}`;
        let status = 404;
        let body = { errors: [{ message: `No route ${route}` }] };
        const answer = (code, value) => { status = code; body = value; };
        const text = await readBody(request);
        let match;

        try {
            if (route === "POST /oauth2/v1/token") {
                const form = new URLSearchParams(text);
                if (form.get("grant_type") === "client_credentials" && form.get("client_id") === clientId && form.get("client_secret") === clientSecret) {
                    const token = `cos-token-${++tokenCount}`;
                    tokens.add(token);
                    answer(200, { access_token: token, expires_in: 3600, token_type: "Bearer", scope: form.get("scope") ?? "" });
                } else {
                    answer(401, { errors: [{ message: "Unknown client" }] });
                }
            } else if (!tokens.has(/^Bearer (.+)$/.exec(request.headers.authorization ?? "")?.[1])) {
                answer(401, { errors: [{ message: "A bearer token from POST /oauth2/v1/token is required" }] });
            } else if (/^GET \/api\/v1\/context\/config\/[^/]+$/.test(route)) {
                answer(200, { "@type": "EPI configuration assignment", configuration, configurationHash, configurationType, schema });
            // A store name has three dot-separated parts (com.example.piggy), so it never collides with `config`.
            } else if (/^GET \/api\/v1\/context\/[^/]+\.[^/]+$/.test(route)) {
                answer(200, {}); // like CommerceOS: a store never lists its keys
            } else if ((match = /^(GET|PUT|PATCH|DELETE) \/api\/v1\/context\/([^/]+\.[^/]+)\/([^/]+)$/.exec(route))) {
                const id = `${match[2]}/${decodeURIComponent(match[3])}`;
                if (match[1] === "DELETE") { store.delete(id); answer(200, { deletedCount: 1, info: "Deleted 1 items" }); }
                // Like CommerceOS: a key never written, or deleted, answers 200 with null, not 404.
                else if (match[1] === "GET") answer(200, store.has(id) ? store.get(id) : null);
                else {
                    // PUT and PATCH both replace what is at the path, nothing merges; the body is echoed.
                    // A null body removes the key, the same as a DELETE.
                    const value = JSON.parse(text);
                    if (value === null) store.delete(id); else store.set(id, value);
                    answer(200, value);
                }
            } else if ((match = /^PATCH \/api\/v1\/payment-orders\/([^/]+)$/.exec(route))) {
                const key = decodeURIComponent(match[1]);
                const records = orders.get(key) ?? [];
                // A record is identified by its method and transaction id. A second copy is ignored.
                for (const record of JSON.parse(text)?.records ?? []) {
                    const id = `${record.identifiers?.transactionId?.method?.identifiers?.methodId}/${record.identifiers?.transactionId?.id}`;
                    if (!records.some(existing => existing.id === id)) records.push({ id, ...record });
                }
                orders.set(key, records);
                answer(200, { identifiers: { key }, status: orderStatus(records), records: records.map(({ id, ...record }) => record) });
            }

        } catch (error) {
            answer(400, { errors: [{ message: error.message }] }); // a malformed body, as server.mjs answers it
        }
        log(`${route} ${status}`);
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(body));
    });

    return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => resolve({
            url: `http://localhost:${server.address().port}`,
            store,
            close: () => new Promise(done => server.close(done)),
        }));
    });
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    const server = await startCosStandIn({ port: Number(process.env.COS_PORT ?? 8790), log: line => console.log(`[cos] ${line}`) });
    console.log(`CommerceOS stand-in at ${server.url} (token endpoint ${server.url}/oauth2/v1/token, client ${CLIENT.clientId})`);
}
