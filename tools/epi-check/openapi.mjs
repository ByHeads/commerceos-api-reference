// Writes the two OpenAPI 3.1 documents of the payment EPI from contract/dto.schema.json:
//
//   guide/examples/payment-epi/epi-openapi.yaml         the ten routes that a payment integration serves
//   guide/examples/payment-epi/commerceos-openapi.yaml  the CommerceOS routes that the integration calls back
//
// Every field description comes from the schema, so the schema is the one place a contract fact lives.
// The route tables below carry what a route is for and when CommerceOS calls it. Generation is deterministic.
//
//   node tools/epi-check/openapi.mjs            # writes both files
//   node tools/epi-check/openapi.mjs --check    # exit 1 when a file on disk differs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const SCHEMA_PATH = join(here, "contract", "dto.schema.json");
const DOCS_DIR = join(here, "..", "..", "guide", "examples", "payment-epi");
export const OUTPUT_PATHS = { epi: join(DOCS_DIR, "epi-openapi.yaml"), cos: join(DOCS_DIR, "commerceos-openapi.yaml") };
/** @deprecated The EPI document. Tests and older callers read it. */
export const OUTPUT_PATH = OUTPUT_PATHS.epi;

const CONTEXT = ["ConfigId", "ConfigHash", "DebugInfo"];
const STEPS = "Create, Cancellable, Wait, ShowImage, VisitPage, RenderView (intermediate); Complete, Decline, Cancel, Fail (final)";

/**
 * The ten routes of the tutorial, section 3. `request` and `response` name a schema, or a literal
 * shape. `when` says what makes CommerceOS call the route; it becomes the operation description.
 */
const EPI_ROUTES = [
    { method: "post", path: "/install", tag: "Lifecycle", contextful: false, summary: "Install: receive the OAuth2 client for the calls back to CommerceOS", request: "InstallPayload", response: "none",
      when: "A Heads administrator runs the install action on the payment integration record. Store the body: it is the only credential your integration gets. The request carries no Content-Type header, so parse the body unconditionally. On any 2xx the integration becomes Active." },
    { method: "post", path: "/uninstall", tag: "Lifecycle", contextful: false, summary: "Uninstall: the integration becomes Inactive", response: "none",
      when: "The administrator runs the uninstall action. Forget the stored client. A failure is logged and ignored." },
    { method: "get", path: "/config-schema", tag: "Lifecycle", contextful: false, summary: "The form that an administrator fills in per organization node", response: "ConfigSchema",
      when: "An administrator opens the configuration form of your integration on an organization node. The back office renders one field per member and stores the values; your integration reads them back through GET /v1/context/config/{configId} on the CommerceOS side. Answer members: {} when you need no configuration." },
    { method: "post", path: "/test", tag: "Lifecycle", contextful: true, summary: "Test the configuration of the context", response: "boolean",
      when: "The administrator runs the test method on the integration: one call per configured node. Read the configuration behind the context id, check it against your provider, and answer true. false, an empty body or a non-2xx counts as fail for that node." },
    { method: "get", path: "/methods", tag: "Lifecycle", contextful: true, summary: "The payment methods that this configuration offers", response: "MethodDto[]",
      when: "The administrator runs configure on a configuration. CommerceOS creates one payment method record per item. A method reaches the POS pay screen once it is added to the POS profile." },
    { method: "get", path: "/terminals", tag: "Lifecycle", contextful: true, summary: "The terminals that this configuration knows", response: "TerminalDto[]",
      when: "An administrator lists the terminals of a configuration. Answer [] when no method of yours requires a terminal." },
    { method: "get", path: "/terminals/{terminalId}", tag: "Lifecycle", contextful: true, summary: "One terminal", response: "TerminalDto",
      when: "CommerceOS creates its own payment terminal record for one of your terminals and reads it first." },
    { method: "put", path: "/payments/{paymentKey}", tag: "Payment", contextful: true, summary: "Start a payment: a stream of steps", request: "PaymentInitDto", response: "stream",
      when: `The cashier chooses your method on the POS. CommerceOS allocates a key, paymentKey, and calls this route; the payment order itself exists after your first Create or Complete step. The response is a Server-Sent-Events stream: per step one line \`event: <type>\`, one line \`data: <JSON>\`, a blank line. Step types: ${STEPS}. A stream holds zero or more intermediate steps and exactly one final step. The \`data:\` JSON, with the type added, matches the schema Step<Type>, or PaymentStep for any of them. A step with no fields, such as Cancel, can omit the \`data:\` line. CommerceOS sets no timeout of its own and makes no retry: a dropped stream is a transport error to the cashier, and the next attempt reuses the same paymentKey when no order exists yet, so answer a repeated PUT for a completed key with the same result.` },
    { method: "post", path: "/payments/{paymentKey}/transactions", tag: "Payment", contextful: true, summary: "Capture, release or refund", request: "TransactionInitDto", response: "TransactionDto",
      when: "The cashier captures a reservation, releases it, or refunds a completed sale. CommerceOS adds one payment record from the answer. It calls once and does not retry. Make the route idempotent on its request: the same paymentKey, token, actions and amount answer the same transaction. A key whose stream did not end in Complete has no payment: answer 404 with an error body." },
    { method: "post", path: "/payments/{cancellationToken}/cancel", tag: "Payment", contextful: true, summary: "Cancel a payment that sent a Cancellable step", request: "CancelDto", response: "none",
      when: "The cashier presses Cancel on the waiting dialog, after your stream sent Cancellable and then Wait. CommerceOS calls once, in parallel with the open stream. Answer 2xx, then end the stream with a Cancel step: the final step closes the payment, not this call. A non-2xx shows 'Cancel failed: <code>: <message>' from your error body (without '<code>: ' when the error has no code) and leaves the stream running." },
];

/** What the integration calls on CommerceOS, with the OAuth2 scope each call needs. */
const COS_ROUTES = [
    { method: "post", path: "/oauth2/v1/token", tag: "Token", summary: "A client-credentials token", scope: null,
      servers: [{ url: "{oauth2Origin}", variables: { oauth2Origin: { default: "https://example.app.heads.com", description: "The origin of tokenUrl from the install payload: tokenUrl is this origin plus the path below. Call tokenUrl as the install payload gives it" } } }],
      form: "TokenRequest", response: "TokenResponse",
      when: "Before the first call and after expires_in seconds. Send the form with grant_type client_credentials and the client from the install payload." },
    { method: "get", path: "/v1/context/config/{configId}", tag: "Configuration", summary: "The configuration behind a context id", scope: "me", response: "ContextConfig",
      when: "On a contextful call whose X-EPI-Context-Config-Hash you have not seen: read the values an administrator saved against your config schema, and cache them by configurationHash." },
    { method: "get", path: "/v1/kv/{container}/{key}", tag: "Key-value store", summary: "Read a value", scope: "kv", response: "any",
      when: "Your own state, for example a provider session behind a paymentKey, so that a restart of your integration loses nothing. container is a namespaced key such as com.example.payments. A missing entry answers 200 with null, not 404. A sub-path of a stored document is addressable on its own: /v1/kv/{container}/{key}/state." },
    { method: "put", path: "/v1/kv/{container}/{key}", tag: "Key-value store", summary: "Write a value", scope: "kv", request: "any", response: "any",
      when: "Any JSON value. The answer echoes it." },
    { method: "delete", path: "/v1/kv/{container}/{key}", tag: "Key-value store", summary: "Delete a value", scope: "kv", response: "deleted",
      when: "After the payment is settled and you no longer need the state." },
    { method: "patch", path: "/v1/payment-orders/{paymentKey}", tag: "Payment orders", summary: "Add payment records: complete a payment asynchronously", scope: "orders.payments:write", request: "PaymentOrderPatch", response: "PaymentOrder",
      when: "Your provider confirms a payment after the stream dropped, for example through a callback. The order exists once your stream sent Create or Complete; for a key that saw neither, the answer is 400 with details 'Payment order not found.'. A repeat of the identical record on the same order is a no-op, so a repeated callback with the same body is safe; a record that reuses a transactionId with any field changed is refused. When the cashier pays again, CommerceOS finds the order Debited for the amount and attaches it without a new call to your integration." },
];

const ref = name => ({ $ref: `#/components/schemas/${name}` });
const json = schema => ({ "application/json": { schema } });
const ERROR_RESPONSE = { description: "A failed call: a non-2xx status with an error body. Read on every route except the stream, whose body CommerceOS discards.", content: json(ref("ErrorBody")) };
const COS_ERROR_RESPONSE = { description: "A failed call: a non-2xx status with a CommerceOS error body; the reason is in details.", content: json(ref("CosErrorBody")) };

function responseOf(kind) {
    if (kind === "none") return { "2XX": { description: "Accepted. The body is ignored, and an empty body is fine." } };
    if (kind === "boolean") return { "200": { description: "true: the configuration works. false: it does not; the node is reported as fail.", content: json({ type: "boolean" }) } };
    if (kind === "deleted") return { "200": { description: "Deleted." } };
    if (kind === "any") return { "200": { description: "The stored JSON value.", content: json({}) } };
    if (kind === "stream") return { "200": { description: "One SSE message per step, see the operation description. Each data line, with the event type added as type, is a PaymentStep.", content: { "text/event-stream": { schema: ref("PaymentStep") } } } };
    if (kind.endsWith("[]")) return { "200": { description: "OK", content: json({ type: "array", items: ref(kind.slice(0, -2)) }) } };
    return { "200": { description: "OK", content: json(ref(kind)) } };
}

function pathParameters(path) {
    return (path.match(/\{(\w+)\}/g) ?? []).map(name => ({ name: name.slice(1, -1), in: "path", required: true, schema: { type: "string" } }));
}

function epiOperation(route) {
    const parameters = pathParameters(route.path);
    if (route.contextful) parameters.push(...CONTEXT.map(name => ({ $ref: `#/components/parameters/${name}` })));
    const operation = { tags: [route.tag], summary: route.summary, description: route.when, ...(parameters.length ? { parameters } : {}) };
    if (route.request) operation.requestBody = { required: true, content: json(ref(route.request)) };
    operation.responses = { ...responseOf(route.response), "4XX": ERROR_RESPONSE };
    return operation;
}

function cosOperation(route) {
    const parameters = pathParameters(route.path);
    const operation = { tags: [route.tag], summary: route.summary, description: route.when, ...(route.servers ? { servers: route.servers } : {}), ...(parameters.length ? { parameters } : {}) };
    if (route.form) operation.requestBody = { required: true, content: { "application/x-www-form-urlencoded": { schema: ref(route.form) } } };
    if (route.request) operation.requestBody = { required: true, content: json(route.request === "any" ? {} : ref(route.request)) };
    operation.security = route.scope === null ? [] : [{ oauth2: [route.scope] }];
    operation.responses = { ...responseOf(route.response), "4XX": COS_ERROR_RESPONSE };
    return operation;
}

/** Rewrites `#/$defs/X` to `#/components/schemas/X` throughout a schema. */
function rewriteRefs(value) {
    if (Array.isArray(value)) return value.map(rewriteRefs);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k === "$ref" && typeof v === "string" ? v.replace("#/$defs/", "#/components/schemas/") : rewriteRefs(v)]));
    return value;
}

/** The schema names that `value` references, directly or through other schemas, in schema order. */
function reachable(defs, value, found = new Set()) {
    const visit = node => {
        if (Array.isArray(node)) node.forEach(visit);
        else if (node && typeof node === "object") {
            for (const [k, v] of Object.entries(node)) {
                if (k === "$ref" && typeof v === "string") {
                    const name = v.replace(/^#\/(\$defs|components\/schemas)\//, "");
                    if (!found.has(name)) { found.add(name); visit(defs[name]); }
                } else visit(v);
            }
        }
    };
    visit(value);
    return Object.fromEntries(Object.keys(defs).filter(name => found.has(name)).map(name => [name, rewriteRefs(defs[name])]));
}

function loadSchema() {
    return JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
}

/** The document of the routes that the integration serves. */
export function buildDocument(schemaDoc = loadSchema()) {
    const paths = {};
    for (const route of EPI_ROUTES) (paths[route.path] ??= {})[route.method] = epiOperation(route);
    const header = (name, description) => ({ name, in: "header", required: true, schema: { type: "string" }, description });
    const parameters = {
        ConfigId: header("X-EPI-Context-Config-Id", "The four-character id of the EPI configuration that this call runs under. Look the values up with GET /v1/context/config/{configId} on CommerceOS."),
        ConfigHash: header("X-EPI-Context-Config-Hash", "The configuration id followed by three characters of a hash of the configuration values, for example tWBlI--. A changed configuration has a new value, so it is your cache key."),
        DebugInfo: header("X-EPI-Debug-Info", "JSON with nodeName, baseUrl and name. Logging only. CommerceOS always sends all three headers; check at least X-EPI-Context-Config-Id."),
    };
    const schemas = reachable(schemaDoc.$defs, { paths, parameters, extra: ["ErrorBody", "PaymentStep"].map(ref) });
    return {
        openapi: "3.1.0",
        info: {
            title: "Payment EPI: the routes that your integration serves",
            version: "1.0.0",
            description: "The ten routes that CommerceOS calls on a payment integration, as the payment EPI (External Partner Interface) specifies them, under the baseUrl of the payment integration record. Bare routes carry no context headers, because they run before any configuration exists. Contextful routes carry the three X-EPI-Context headers, and nothing else identifies the caller: protect the endpoint at the network level. Each operation says when CommerceOS calls it; each schema field says what it means. The calls in the other direction are in commerceos-openapi.yaml. Behavior that a schema cannot state, such as what the cashier sees and the ledger effect of each action, is in reference.md.",
        },
        tags: [{ name: "Lifecycle", description: "Outside a payment: install, configuration, methods, terminals." }, { name: "Payment", description: "One payment: the stream, later transactions, cancel." }],
        servers: [{ url: "{baseUrl}", variables: { baseUrl: { default: "https://piggy.example.com/piggy", description: "The baseUrl of the payment integration record in CommerceOS" } } }],
        paths,
        components: { parameters, schemas },
    };
}

/** The document of the CommerceOS routes that the integration calls. */
export function buildCosDocument(schemaDoc = loadSchema()) {
    const paths = {};
    for (const route of COS_ROUTES) (paths[route.path] ??= {})[route.method] = cosOperation(route);
    const schemas = reachable(schemaDoc.$defs, { paths, extra: [ref("CosErrorBody")] });
    return {
        openapi: "3.1.0",
        info: {
            title: "CommerceOS for payment integrations: the routes that your integration calls",
            version: "1.0.0",
            description: "The four things a payment integration does on CommerceOS, with the OAuth2 client it received in the install payload: get a token, read the configuration behind a context id, keep its own state in the key-value store, and complete a payment asynchronously. Every call carries Authorization: Bearer <token>, content-type application/json and accept application/json. The scopes of the client bound what it can do; a client created in the back office for an integration has me geo:read orders.sales:write orders.payments:write payment-records:write kv (a seeded one also payment-means:read), and these routes need me, kv and orders.payments:write. Other resources, such as payment integrations and payment terminals, are not available to the client. The full CommerceOS API is documented at {cosBaseUrl}/api-docs.",
        },
        tags: [{ name: "Token" }, { name: "Configuration" }, { name: "Key-value store" }, { name: "Payment orders" }],
        servers: [{ url: "{cosBaseUrl}/api", variables: { cosBaseUrl: { default: "https://example.app.heads.com", description: "cosBaseUrl from the install payload" } } }],
        paths,
        components: {
            securitySchemes: {
                oauth2: {
                    type: "oauth2",
                    description: "Client credentials of the OAuth2 client from the install payload. Request the token at the tokenUrl of the install payload; the URL below is the example instance.",
                    flows: { clientCredentials: { tokenUrl: "https://example.app.heads.com/oauth2/v1/token", scopes: {
                        me: "Read the configuration behind a context id (and the integration's own user).",
                        kv: "Read, write and delete values in the key-value store.",
                        "orders.payments:write": "Add payment records to a payment order.",
                        "geo:read": "In the default client. Not needed by these routes.",
                        "orders.sales:write": "In the default client. Not needed by these routes.",
                        "payment-records:write": "In the default client. Not needed by these routes.",
                    } } },
                },
            },
            schemas,
        },
    };
}

const BARE_KEY = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const scalar = value => typeof value === "string" ? JSON.stringify(value) : String(value);
const key = name => BARE_KEY.test(name) ? name : JSON.stringify(name);

/** A deterministic YAML writer for JSON values: block mappings and sequences, double-quoted strings. */
export function toYaml(value, indent = 0) {
    const pad = " ".repeat(indent);
    if (Array.isArray(value)) {
        if (value.length === 0) return `${pad}[]\n`;
        return value.map(item => item && typeof item === "object"
            ? Object.keys(item).length === 0 ? `${pad}- ${Array.isArray(item) ? "[]" : "{}"}\n` : `${pad}- ${toYaml(item, indent + 2).slice(indent + 2)}`
            : `${pad}- ${scalar(item)}\n`).join("");
    }
    if (value && typeof value === "object") {
        const entries = Object.entries(value);
        if (entries.length === 0) return `${pad}{}\n`;
        return entries.map(([name, item]) => {
            const nested = Array.isArray(item) ? item.length > 0 : item && typeof item === "object" && Object.keys(item).length > 0;
            return nested ? `${pad}${key(name)}:\n${toYaml(item, indent + 2)}` : `${pad}${key(name)}: ${Array.isArray(item) ? "[]" : item && typeof item === "object" ? "{}" : scalar(item)}\n`;
        }).join("");
    }
    return `${pad}${scalar(value)}\n`;
}

const HEADER = "# Generated by tools/epi-check/openapi.mjs from tools/epi-check/contract/dto.schema.json. Do not edit by hand.\n";

/** Both documents as YAML text, keyed as OUTPUT_PATHS. */
export function renderAll(schemaDoc = loadSchema()) {
    return { epi: HEADER + toYaml(buildDocument(schemaDoc)), cos: HEADER + toYaml(buildCosDocument(schemaDoc)) };
}

/** The EPI document as YAML text. */
export function render(schemaDoc = loadSchema()) {
    return renderAll(schemaDoc).epi;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    const texts = renderAll();
    if (process.argv.includes("--check")) {
        let stale = false;
        for (const [name, path] of Object.entries(OUTPUT_PATHS)) {
            let onDisk = null;
            try { onDisk = readFileSync(path, "utf8"); } catch { /* missing counts as different */ }
            if (onDisk === texts[name]) console.log(`${path} is up to date`);
            else { console.error(`${path} differs from the generated document. Run node tools/epi-check/openapi.mjs`); stale = true; }
        }
        process.exit(stale ? 1 : 0);
    }
    for (const [name, path] of Object.entries(OUTPUT_PATHS)) {
        writeFileSync(path, texts[name]);
        console.log(`wrote ${path} (${texts[name].split("\n").length - 1} lines)`);
    }
}
