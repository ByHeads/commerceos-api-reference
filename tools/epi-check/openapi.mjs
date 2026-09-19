// Writes guide/examples/payment-epi/epi-openapi.yaml: the OpenAPI 3.1 document of the ten routes
// that a payment EPI serves, with the DTOs of contract/dto.schema.json under components/schemas.
// The route table below is the table of the tutorial, section 3. Generation is deterministic.
//
//   node tools/epi-check/openapi.mjs            # writes the file
//   node tools/epi-check/openapi.mjs --check    # exit 1 when the file on disk differs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const SCHEMA_PATH = join(here, "contract", "dto.schema.json");
export const OUTPUT_PATH = join(here, "..", "..", "guide", "examples", "payment-epi", "epi-openapi.yaml");

const CONTEXT = ["ConfigId", "ConfigHash", "DebugInfo"];
const STEPS = "Create, Cancellable, Wait, ShowImage, VisitPage, RenderView (intermediate); Complete, Decline, Cancel, Fail (final)";

/** The ten routes of the tutorial, section 3. `request` and `response` name a schema, or a literal shape. */
const ROUTES = [
    { method: "post", path: "/install", contextful: false, summary: "Install: receive the OAuth2 client for the calls back to CommerceOS", request: "InstallPayload", response: "none" },
    { method: "post", path: "/uninstall", contextful: false, summary: "Uninstall", response: "none" },
    { method: "get", path: "/config-schema", contextful: false, summary: "The form that an administrator fills in per organization node", response: "configSchema" },
    { method: "post", path: "/test", contextful: true, summary: "Test the configuration of the context", response: "boolean" },
    { method: "get", path: "/methods", contextful: true, summary: "The payment methods that this configuration offers", response: "MethodDto[]" },
    { method: "get", path: "/terminals", contextful: true, summary: "The terminals that this configuration knows", response: "TerminalDto[]" },
    { method: "get", path: "/terminals/{terminalId}", contextful: true, summary: "One terminal", response: "TerminalDto" },
    { method: "put", path: "/payments/{paymentKey}", contextful: true, summary: "Start a payment: a stream of steps", request: "PaymentInitDto", response: "stream",
      description: `The response is a Server-Sent-Events stream (one \`event:\` line, one \`data:\` line, a blank line per step). Step types: ${STEPS}. A stream holds zero or more intermediate steps and exactly one final step. The data of each step is the schema of the same name, prefixed with Step: StepWait, StepComplete, and so on, or PaymentStep for any of them.` },
    { method: "post", path: "/payments/{paymentKey}/transactions", contextful: true, summary: "Capture, release or refund", request: "TransactionInitDto", response: "TransactionDto" },
    { method: "post", path: "/payments/{cancellationToken}/cancel", contextful: true, summary: "Cancel a payment that sent a Cancellable step", request: "CancelDto", response: "none" },
];

const ref = name => ({ $ref: `#/components/schemas/${name}` });
const json = schema => ({ "application/json": { schema } });

function responseOf(kind) {
    if (kind === "none") return { "2XX": { description: "Accepted. The body is ignored." } };
    if (kind === "boolean") return { "200": { description: "The configuration works.", content: json({ type: "boolean", const: true }) } };
    if (kind === "configSchema") return { "200": { description: "A form description: { title?, description?, members: { <key>: { type, title?, description?, members? } } }. See the reference, section 4.", content: json({ type: "object", additionalProperties: true }) } };
    if (kind === "stream") return { "200": { description: `A stream of steps. Step types: ${STEPS}.`, content: { "text/event-stream": { schema: { type: "string" } } } } };
    if (kind.endsWith("[]")) return { "200": { description: "OK", content: json({ type: "array", items: ref(kind.slice(0, -2)) }) } };
    return { "200": { description: "OK", content: json(ref(kind)) } };
}

function operation(route) {
    const parameters = [...(route.path.match(/\{(\w+)\}/g) ?? []).map(name => ({ name: name.slice(1, -1), in: "path", required: true, schema: { type: "string" } }))];
    if (route.contextful) parameters.push(...CONTEXT.map(name => ({ $ref: `#/components/parameters/${name}` })));
    const operation = { summary: route.summary, ...(route.description ? { description: route.description } : {}), ...(parameters.length ? { parameters } : {}) };
    if (route.request) operation.requestBody = { required: true, content: json(ref(route.request)) };
    operation.responses = { ...responseOf(route.response), "4XX": { description: "A failed call. The error body is the ErrorBody schema.", content: json(ref("ErrorBody")) } };
    return operation;
}

/** Rewrites `#/$defs/X` to `#/components/schemas/X` throughout a schema. */
function rewriteRefs(value) {
    if (Array.isArray(value)) return value.map(rewriteRefs);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k === "$ref" && typeof v === "string" ? v.replace("#/$defs/", "#/components/schemas/") : rewriteRefs(v)]));
    return value;
}

export function buildDocument(schemaDoc = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"))) {
    const paths = {};
    for (const route of ROUTES) (paths[route.path] ??= {})[route.method] = operation(route);
    const header = (name, description) => ({ name, in: "header", required: true, schema: { type: "string" }, description });
    return {
        openapi: "3.1.0",
        info: {
            title: "Payment EPI (the service you implement)",
            version: "1.0.0",
            description: "The ten routes that CommerceOS calls on a payment EPI (External Partner Interface), under the base URL of the payment integration record. Bare routes carry no context headers. Contextful routes carry the three X-EPI-Context headers. Generated from the conformance tool's contract; the contract reference explains every field.",
        },
        servers: [{ url: "{baseUrl}", variables: { baseUrl: { default: "https://piggy.example.com/piggy", description: "The baseUrl of the payment integration record in CommerceOS" } } }],
        paths,
        components: {
            parameters: {
                ConfigId: header("X-EPI-Context-Config-Id", "The four-character id of the EPI configuration"),
                ConfigHash: header("X-EPI-Context-Config-Hash", "A hash of the configuration values. A changed configuration has a new hash"),
                DebugInfo: header("X-EPI-Debug-Info", "JSON with nodeName, baseUrl and name. Logging only"),
            },
            schemas: rewriteRefs(schemaDoc.$defs),
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
        return value.map(item => Array.isArray(item) || (item && typeof item === "object")
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

export function render(schemaDoc) {
    return `# Generated by tools/epi-check/openapi.mjs from tools/epi-check/contract/dto.schema.json. Do not edit by hand.\n${toYaml(buildDocument(schemaDoc))}`;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    const text = render();
    if (process.argv.includes("--check")) {
        let onDisk = null;
        try { onDisk = readFileSync(OUTPUT_PATH, "utf8"); } catch { /* missing counts as different */ }
        if (onDisk === text) { console.log(`${OUTPUT_PATH} is up to date`); process.exit(0); }
        console.error(`${OUTPUT_PATH} differs from the generated document. Run node tools/epi-check/openapi.mjs`);
        process.exit(1);
    }
    writeFileSync(OUTPUT_PATH, text);
    console.log(`wrote ${OUTPUT_PATH} (${text.split("\n").length - 1} lines)`);
}
