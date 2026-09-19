// The CommerceOS side of the payment EPI: every outbound call, with the headers CommerceOS sends.
// It mirrors the CommerceOS EPI client at the contract commit named in run.mjs:
//   JSON calls            accept: application/json, a non-2xx status becomes an EpiCheckError
//   event-stream calls    accept: text/event-stream, the SSE steps become the payment result
//   contextful calls      carry the three X-EPI-* headers
//   GET /config-schema    a bare GET, no context headers
// Paths per call: PUT /payments/{key}, POST /payments/{key}/transactions,
// POST /payments/{token}/cancel, and /methods, /terminals, /test, /install, /uninstall.
//
// CommerceOS joins baseUrl and path with a file-path join, which turns `http://` into `http:/`.
// The URL parser repairs that, so the driver joins the plain way.
import { parseEvents } from "./sse.mjs";

export class EpiCheckError extends Error {
    constructor(message, { status, path, errors, cause } = {}) {
        super(message, cause ? { cause } : undefined);
        this.name = "EpiCheckError";
        this.status = status;
        this.path = path;
        this.errors = errors;
    }
}

function joinUrl(baseUrl, path) {
    return baseUrl.replace(/\/+$/, "") + (path.startsWith("/") ? path : "/" + path);
}

/**
 * Creates a driver bound to one EPI base URL and one configuration context.
 * `context` is `{ configId, configHash, debugInfo: { nodeName, baseUrl, name } }`, the same
 * three values `fetchContextfulResponse` reads from the EpiConfiguration.
 */
export function createDriver({ baseUrl, context, timeoutMs = 10000, fetch = globalThis.fetch }) {
    if (!baseUrl) throw new Error("createDriver needs a baseUrl");
    if (!context) throw new Error("createDriver needs a context");
    const log = [];

    const contextHeaders = () => ({
        "X-EPI-Context-Config-Id": context.configId,
        "X-EPI-Context-Config-Hash": context.configHash,
        "X-EPI-Debug-Info": JSON.stringify(context.debugInfo),
    });

    // One HTTP exchange. `contextful` adds the three headers, `accept` is the negotiated
    // response type, and the caller reads the response. Every exchange lands in `log`.
    async function exchange(method, path, { body, contextful, accept }) {
        const url = joinUrl(baseUrl, path);
        const headers = { ...(accept ? { accept } : {}), ...(contextful ? contextHeaders() : {}) };
        if (body !== undefined) headers["content-type"] = "application/json";
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const started = performance.now();
        let response;
        try {
            response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
        } catch (error) {
            clearTimeout(timer);
            log.push({ method, path, status: 0, ms: Math.round(performance.now() - started) });
            const timedOut = error?.name === "AbortError";
            throw new EpiCheckError(timedOut ? `Timeout after ${timeoutMs} ms: ${method} ${path}` : `Request failed: ${method} ${path}: ${error.message}`, { status: 0, path, cause: error });
        }
        log.push({ method, path, status: response.status, ms: Math.round(performance.now() - started) });
        if (!response.ok) {
            clearTimeout(timer);
            let errors;
            try {
                const json = await response.json();
                if (json && typeof json === "object" && "errors" in json) errors = json.errors;
            } catch { /* not JSON: as fetchJSON, the status alone describes it */ }
            throw new EpiCheckError(`Request failed: ${response.status}. ${method} ${path}`, { status: response.status, path, errors });
        }
        return { response, done: () => clearTimeout(timer) };
    }

    async function json(method, path, body, contextful) {
        const { response, done } = await exchange(method, path, { body, contextful, accept: "application/json" });
        try {
            const text = await response.text();
            return text ? JSON.parse(text) : undefined;
        } finally {
            done();
        }
    }

    const bare = (method, path, body) => json(method, path, body, false);
    const contextfulJson = (method, path, body) => json(method, path, body, true);

    return {
        log,
        // Bare calls: they run before any configuration exists (plan § 7).
        install: payload => bare("POST", "/install", payload),
        uninstall: () => bare("POST", "/uninstall"),
        configSchema: () => bare("GET", "/config-schema"),
        // Contextful JSON calls.
        test: () => contextfulJson("POST", "/test"),
        methods: () => contextfulJson("GET", "/methods"),
        terminals: () => contextfulJson("GET", "/terminals"),
        terminal: id => contextfulJson("GET", `/terminals/${encodeURIComponent(id)}`),
        cancel: (token, cancelDto) => contextfulJson("POST", `/payments/${encodeURIComponent(token)}/cancel`, cancelDto),
        transaction: (paymentKey, initDto) => contextfulJson("POST", `/payments/${encodeURIComponent(paymentKey)}/transactions`, initDto),
        // The payment stream: an async iterator of steps.
        async *startPayment(paymentKey, initDto) {
            const { response, done } = await exchange("PUT", `/payments/${encodeURIComponent(paymentKey)}`, { body: initDto, contextful: true, accept: "text/event-stream" });
            try {
                yield* parseEvents(response.body);
            } finally {
                done();
            }
        },
    };
}

/** The driver methods a scenario step may name. */
export const DRIVER_CALLS = ["install", "uninstall", "configSchema", "test", "methods", "terminals", "terminal", "cancel", "transaction", "startPayment"];
