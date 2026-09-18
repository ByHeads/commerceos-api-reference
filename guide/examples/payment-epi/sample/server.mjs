// Piggy Bank: a complete payment EPI on node:http, backed by the in-memory bank in bank.mjs.
// Every endpoint names its section in the contract reference (guide/examples/payment-epi/reference.md).
//
// The cents of `amount` select the outcome (guide section 10):
//   .00 Complete ["Authorize","Debit"]   .01 Decline   .02 Fail
//   .03 Cancellable, then Cancel         .04 Wait, then Complete   .05 Complete ["Authorize"]
// Direction "Payout" gives ["Authorize"] unless `debitSynchronously` is true.
//
// A `.03` payment waits WAIT_MS for the cancel call and completes when none arrives. A `.04`
// payment waits WAIT_MS for the customer's phone (`POST /tap/{sessionId}`, the id travels in the
// Wait step's `params`) and the phone taps by itself when the window closes. Set PIGGY_WAIT_MS to
// play by hand. Set PORT to pick the port.
import { createServer } from "node:http";
import { createBank } from "./bank.mjs";

export const METHOD_ID = "com.example.piggy";
export const BASE_PATH = "/piggy";
export const KV_CONTAINER = "com.example.piggy";

const METHOD = {
    methodId: METHOD_ID,
    name: "Piggy Bank",
    supports: { incoming: true, outgoing: true, reversal: true },
    requires: { terminal: false, specification: false },
};
const TERMINALS = [
    { terminalId: "PB-T1", methodId: METHOD_ID, name: "Piggy Bank terminal 1" },
    { terminalId: "PB-T2", methodId: METHOD_ID, name: "Piggy Bank terminal 2" },
];
const CONFIG_SCHEMA = { title: "Piggy Bank", members: { merchantId: { type: "string" }, mode: { type: "'TEST' or 'LIVE'" } } };

const errorBody = message => ({ errors: [{ message }] });

/** The two cents digits of a decimal string, or null when the string is not a decimal. */
export function cents(amount) {
    const match = /^-?\d+(?:\.(\d+))?$/.exec(String(amount));
    return match ? (match[1] ?? "").padEnd(2, "0").slice(0, 2) : null;
}

/** One SSE message, the shape CommerceOS parses: `event:`, `data:`, blank line (section 5). */
const formatEvent = (type, data) => `event: ${type}\n${data == null ? "" : `data: ${JSON.stringify(data)}\n`}\n`;

const readJson = request => new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        try { resolve(text ? JSON.parse(text) : undefined); } catch (error) { reject(error); }
    });
    request.on("error", reject);
});

/** A resolved-or-timed-out wait: `promise` resolves true on `release()`, false after `ms`. */
function window_(ms) {
    let release;
    const promise = new Promise(resolve => {
        const timer = setTimeout(() => resolve(false), ms);
        release = () => { clearTimeout(timer); resolve(true); };
    });
    return { promise, release };
}

/**
 * Starts the Piggy Bank EPI. `url` is the base URL, path included, that CommerceOS points at.
 * `now` is the clock for every timestamp, `waitMs` the tap and cancel window, `log` the sink for
 * the one-line log of every CommerceOS callback.
 */
export function startPiggyServer({ port = 0, now = () => new Date(), waitMs = 3000, log = () => {} } = {}) {
    const bank = createBank({ now });
    const sessionsByKey = new Map(); // paymentKey -> sessionId
    const pendingCancels = new Map(); // cancellationToken -> release()
    let installation = null;

    const json = (response, status, body) => {
        const text = body === undefined ? "" : JSON.stringify(body, null, 2);
        response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
        response.end(text);
    };

    const paymentResult = (sessionId, transactions) => {
        const { methodId, amount, currencyCode } = bank.session(sessionId);
        return { processorsId: sessionId, methodId, amount, currencyCode, transactions };
    };

    // Section 8: a client-credentials token from the install payload, then a key-value write.
    // The write records the waiting session under the payment key. A failure is logged only.
    async function writeState(paymentKey, state) {
        if (!installation?.cosBaseUrl) return;
        const { cosBaseUrl, tokenUrl, clientId, clientSecret, scope } = installation;
        try {
            const form = new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret, scope });
            const tokenResponse = await fetch(tokenUrl, { method: "POST", body: form, signal: AbortSignal.timeout(2000) });
            if (!tokenResponse.ok) throw new Error(`token ${tokenResponse.status}`);
            const { access_token: token } = await tokenResponse.json();
            const url = `${cosBaseUrl.replace(/\/+$/, "")}/api/v1/kv/${KV_CONTAINER}/${encodeURIComponent(paymentKey)}`;
            const headers = { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" };
            const response = await fetch(url, { method: "PUT", headers, body: JSON.stringify(state), signal: AbortSignal.timeout(2000) });
            log(`kv ${paymentKey} ${response.status}`);
        } catch (error) {
            log(`kv ${paymentKey} not written: ${error.message} from ${tokenUrl}`);
        }
    }

    // Section 5: the payment stream. One session per payment key, and one final step per stream.
    async function streamPayment(response, paymentKey, dto) {
        const { sessionId } = bank.createSession({ amount: dto.amount, currencyCode: dto.currencyCode, methodId: dto.methodId, token: dto.token });
        sessionsByKey.set(paymentKey, sessionId);
        response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        const send = (type, data) => response.write(formatEvent(type, data));
        const complete = actions => send("Complete", { result: paymentResult(sessionId, [bank.settle(sessionId, actions)]) });
        const saleActions = dto.direction === "Payout"
            ? (dto.debitSynchronously ? ["Authorize", "Debit"] : ["Authorize"])
            : (cents(dto.amount) === "05" ? ["Authorize"] : ["Authorize", "Debit"]);

        switch (cents(dto.amount)) {
            case "01":
                bank.close(sessionId, "declined");
                send("Decline", { reason: "InsufficientFunds" });
                break;
            case "02":
                bank.close(sessionId, "failed");
                send("Fail", { errors: [{ code: "PiggyJammed", message: "The coin slot is jammed (amount ends in .02)" }] });
                break;
            case "03": {
                const cancel = window_(waitMs);
                pendingCancels.set(paymentKey, cancel.release);
                send("Cancellable", { cancellationToken: paymentKey });
                const cancelled = await cancel.promise;
                pendingCancels.delete(paymentKey);
                if (cancelled) { bank.close(sessionId, "cancelled"); send("Cancel"); } else complete(saleActions);
                break;
            }
            case "04": {
                send("Wait", { message: "Waiting for the customer's phone", params: [sessionId] });
                writeState(paymentKey, { sessionId, state: "waiting" });
                const tap = window_(waitMs);
                const tapped = await Promise.race([bank.waitForTap(sessionId), tap.promise]);
                tap.release();
                log(`session ${sessionId} ${tapped ? "tapped" : "tapped by itself"}`);
                complete(saleActions);
                writeState(paymentKey, { sessionId, state: "settled" });
                break;
            }
            default:
                complete(saleActions);
        }
        response.end();
    }

    async function handle(request, response) {
        const url = new URL(request.url, "http://localhost");
        if (url.pathname !== BASE_PATH && !url.pathname.startsWith(`${BASE_PATH}/`)) return json(response, 404, errorBody("Not found"));
        const route = `${request.method} ${url.pathname.slice(BASE_PATH.length)}`;
        let match;

        // Section 2, bare calls: install stores the handshake, uninstall forgets it.
        if (route === "POST /install") { installation = await readJson(request); return json(response, 200); }
        if (route === "POST /uninstall") { installation = null; return json(response, 200); }
        // Section 4: the configuration form, not a JSON Schema.
        if (route === "GET /config-schema") return json(response, 200, CONFIG_SCHEMA);
        // The customer's phone taps a waiting session. Not part of the contract: it is the Piggy Bank's own door.
        if ((match = /^POST \/tap\/([^/]+)$/.exec(route))) {
            const known = bank.tap(decodeURIComponent(match[1]));
            return known ? json(response, 200, {}) : json(response, 404, errorBody(`Unknown session ${match[1]}`));
        }

        // Section 3: every call below is contextful. Section 7 gives the error shape.
        if (typeof request.headers["x-epi-context-config-id"] !== "string") {
            return json(response, 400, errorBody("Missing X-EPI-Context-Config-Id header"));
        }

        // Section 2, contextful calls.
        if (route === "POST /test") return json(response, 200, true);
        if (route === "GET /methods") return json(response, 200, [METHOD]);
        if (route === "GET /terminals") return json(response, 200, TERMINALS);
        if ((match = /^GET \/terminals\/([^/]+)$/.exec(route))) {
            const terminal = TERMINALS.find(t => t.terminalId === decodeURIComponent(match[1]));
            return terminal ? json(response, 200, terminal) : json(response, 404, errorBody(`Unknown terminal ${match[1]}`));
        }
        // Section 5: the payment stream.
        if ((match = /^PUT \/payments\/([^/]+)$/.exec(route))) {
            const dto = await readJson(request);
            if (dto?.methodId !== METHOD_ID) return json(response, 400, errorBody(`Unknown method ${dto?.methodId}`));
            if (cents(dto.amount) === null) return json(response, 400, errorBody("Amount is not a decimal string"));
            if (!["Payment", "Payout"].includes(dto.direction)) return json(response, 400, errorBody("Direction must be Payment or Payout"));
            return streamPayment(response, decodeURIComponent(match[1]), dto);
        }
        // Section 6: capture, release and refund. A refund carries reversalArgs and credits the session.
        if ((match = /^POST \/payments\/([^/]+)\/transactions$/.exec(route))) {
            const dto = await readJson(request);
            const sessionId = sessionsByKey.get(decodeURIComponent(match[1]));
            if (!sessionId) return json(response, 404, errorBody(`No payment ${match[1]}`));
            if (dto?.methodId !== METHOD_ID) return json(response, 400, errorBody(`Unknown method ${dto?.methodId}`));
            const transaction = dto.reversalArgs ? bank.credit(sessionId, dto.amount) : bank.record(sessionId, dto.actions, dto.amount);
            return json(response, 200, transaction);
        }
        // Section 6: cancel a Cancellable payment by its token. The stream then ends with Cancel.
        if ((match = /^POST \/payments\/([^/]+)\/cancel$/.exec(route))) {
            await readJson(request);
            const release = pendingCancels.get(decodeURIComponent(match[1]));
            if (!release) return json(response, 404, errorBody("No cancellable payment with that token"));
            release();
            return json(response, 200, {});
        }
        return json(response, 404, errorBody(`No route ${route}`));
    }

    const server = createServer((request, response) => {
        handle(request, response).catch(error => {
            if (!response.headersSent) json(response, 400, errorBody(error.message));
            else response.end();
        });
    });

    return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
            resolve({
                url: `http://127.0.0.1:${server.address().port}${BASE_PATH}`,
                bank,
                get installation() { return installation; },
                close: () => new Promise(done => {
                    for (const release of pendingCancels.values()) release();
                    server.closeAllConnections();
                    server.close(() => done());
                }),
            });
        });
    });
}

// `node server.mjs` runs the bank on PORT (default 8787).
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    const waitMs = Number(process.env.PIGGY_WAIT_MS ?? 3000);
    const server = await startPiggyServer({ port: Number(process.env.PORT ?? 8787), waitMs, log: line => console.log(`[piggy] ${line}`) });
    console.log(`Piggy Bank EPI at ${server.url} (tap and cancel window ${waitMs} ms)`);
}
