// Piggy Bank: a complete payment integration on node:http, backed by the in-memory bank in bank.mjs.
// Every endpoint names its section in the contract reference (guide/examples/payment-epi/reference.md).
//
// The cents of `amount` select the outcome (tutorial section 6):
//   .00 Complete ["Authorize","Debit"]   .01 Decline   .02 Fail
//   .03 Cancellable, then Cancel         .04 Wait, then Complete   .05 Complete ["Authorize"]
// Direction "Payout" gives ["Authorize"] unless `debitSynchronously` is true.
//
// A `.03` payment waits WAIT_MS for the cancel call and completes when none arrives. A `.04`
// payment waits WAIT_MS for the customer's phone (`POST /tap/{sessionId}`, the id travels in the
// Wait step's `params`) and the phone taps by itself when the window closes. Set PIGGY_WAIT_MS to
// play by hand. Set PORT to pick the port. Set PIGGY_STATE to a file to keep the bank and the payments
// across restarts (default: in memory); two samples with two files share nothing.
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
    const { promise, resolve } = Promise.withResolvers();
    const timer = setTimeout(() => resolve(false), ms);
    return { promise, release: () => { clearTimeout(timer); resolve(true); } };
}

/**
 * Starts the Piggy Bank integration. `url` is the base URL, path included, that CommerceOS points at.
 * `now` is the clock for every timestamp, `waitMs` the tap and cancel window, `log` the sink for
 * the one-line log of every CommerceOS callback. `stateFile` keeps the bank and the payments in a
 * JSON file, written after every change and read back on start, so a restart resumes them.
 */
export function startPiggyServer({ port = 0, now = () => new Date(), waitMs = 3000, log = () => {}, idPrefix, stateFile } = {}) {
    const saved = stateFile && existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : undefined;
    const bank = createBank({ now, ...(idPrefix !== undefined ? { idPrefix } : {}), ...(saved ? { snapshot: saved.bank } : {}) });
    const sessionsByKey = new Map(saved?.sessionsByKey); // paymentKey -> sessionId
    const resultsByKey = new Map(saved?.resultsByKey); // paymentKey -> the Complete result, replayed on a repeated PUT
    const transactionsByRequest = new Map(saved?.transactionsByRequest); // paymentKey + body -> the transaction, replayed on a repeated call
    const pendingCancels = new Map(); // cancellationToken -> release()
    let installation = null;
    const configByHash = new Map(); // X-EPI-Context-Config-Hash -> the configuration behind it
    const save = () => {
        if (!stateFile) return;
        writeFileSync(stateFile, JSON.stringify({ bank: bank.snapshot(), sessionsByKey: [...sessionsByKey], resultsByKey: [...resultsByKey], transactionsByRequest: [...transactionsByRequest] }, null, 2));
    };

    const json = (response, status, body) => {
        const text = body === undefined ? "" : JSON.stringify(body, null, 2);
        response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
        response.end(text);
    };

    // Section 8: a client-credentials token from the install payload, for every call back to CommerceOS.
    async function bearer() {
        const { tokenUrl, clientId, clientSecret, scope } = installation;
        const form = new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret, scope });
        const response = await fetch(tokenUrl, { method: "POST", body: form, signal: AbortSignal.timeout(2000) });
        if (!response.ok) throw new Error(`token ${response.status}`);
        return `Bearer ${(await response.json()).access_token}`;
    }

    const cosApi = path => `${installation.cosBaseUrl.replace(/\/+$/, "")}/api/v1${path}`;

    // Section 4: the configuration an administrator saved for the node of this call, read through the
    // context id and cached by the context hash, which changes whenever the administrator saves.
    async function readConfig(request) {
        const id = request.headers["x-epi-context-config-id"];
        const hash = request.headers["x-epi-context-config-hash"];
        if (hash && configByHash.has(hash)) return configByHash.get(hash);
        const response = await fetch(cosApi(`/context/config/${encodeURIComponent(id)}`), { headers: { authorization: await bearer(), accept: "application/json" }, signal: AbortSignal.timeout(2000) });
        if (!response.ok) throw new Error(`config ${response.status}`);
        const { configuration = {}, configurationHash } = await response.json();
        configByHash.set(configurationHash ?? hash, configuration);
        return configuration;
    }

    /** The checks behind POST /test: the fields of CONFIG_SCHEMA, as an administrator typed them. */
    const configProblems = configuration => [
        ...(typeof configuration.merchantId === "string" && configuration.merchantId !== "" ? [] : ["merchantId is missing"]),
        ...(["TEST", "LIVE"].includes(configuration.mode) ? [] : ["mode must be TEST or LIVE"]),
    ];

    // Section 8: a key-value write that records the waiting session under the payment key. A failure is logged only.
    async function writeState(paymentKey, state) {
        if (!installation?.cosBaseUrl) return;
        try {
            const headers = { authorization: await bearer(), "content-type": "application/json", accept: "application/json" };
            const response = await fetch(cosApi(`/kv/${KV_CONTAINER}/${encodeURIComponent(paymentKey)}`), { method: "PUT", headers, body: JSON.stringify(state), signal: AbortSignal.timeout(2000) });
            log(`kv ${paymentKey} ${response.status}`);
        } catch (error) {
            log(`kv ${paymentKey} not written: ${error.message} from ${installation.tokenUrl}`);
        }
    }

    /** What is wrong with a PaymentInitDto, or undefined. Section 7: on the stream route a refusal is a Fail step, never a status. */
    const refusal = dto => {
        if (dto?.methodId !== METHOD_ID) return { code: "UnknownMethod", message: `Unknown method ${dto?.methodId}` };
        if (cents(dto.amount) === null) return { code: "BadAmount", message: "Amount is not a decimal string" };
        if (!["Payment", "Payout"].includes(dto.direction)) return { code: "BadDirection", message: "Direction must be Payment or Payout" };
        return undefined;
    };

    // Section 5: the payment stream. One session per payment key, and one final step per stream.
    // A repeated PUT for a key is a resume (reference section 11): a settled payment is replayed
    // with the same processorsId, a payment still in progress is refused, and a declined,
    // cancelled or failed one starts over.
    async function streamPayment(response, paymentKey, dto) {
        response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        const send = (type, data) => response.write(formatEvent(type, data));
        const refused = refusal(dto);
        if (refused) { send("Fail", { errors: [refused] }); return response.end(); }
        if (resultsByKey.has(paymentKey)) { send("Complete", { result: resultsByKey.get(paymentKey) }); return response.end(); }
        if (sessionsByKey.has(paymentKey) && bank.session(sessionsByKey.get(paymentKey)).state === "open") {
            send("Fail", { errors: [{ code: "InProgress", message: `Payment ${paymentKey} is still in progress` }] });
            return response.end();
        }
        const { sessionId } = bank.createSession({ amount: dto.amount, currencyCode: dto.currencyCode, methodId: dto.methodId, token: dto.token, specification: dto.specification });
        sessionsByKey.set(paymentKey, sessionId);
        save();
        const close = state => { bank.close(sessionId, state); save(); };
        const complete = actions => {
            const { methodId, amount, currencyCode } = dto;
            resultsByKey.set(paymentKey, { processorsId: sessionId, methodId, amount, currencyCode, transactions: [bank.settle(sessionId, actions)] });
            save();
            send("Complete", { result: resultsByKey.get(paymentKey) });
        };
        const outcome = cents(dto.amount);
        const saleActions = dto.direction === "Payout"
            ? (dto.debitSynchronously ? ["Authorize", "Debit"] : ["Authorize"])
            : (outcome === "05" ? ["Authorize"] : ["Authorize", "Debit"]);

        switch (outcome) {
            case "01":
                close("declined");
                // The POS sentence for this reason takes two params: the balance and the requested amount.
                send("Decline", { reason: "InsufficientFunds", params: ["0.00", dto.amount] });
                break;
            case "02":
                close("failed");
                send("Fail", { errors: [{ code: "PiggyJammed", message: "The coin slot is jammed (amount ends in .02)" }] });
                break;
            case "03": {
                const cancel = window_(waitMs);
                pendingCancels.set(paymentKey, cancel.release);
                send("Cancellable", { cancellationToken: paymentKey });
                // The POS shows the cancel button on the waiting dialog only: a Cancellable step
                // alone shows the cashier nothing.
                send("Wait", { message: "Waiting for the bank. Cancel from the till to stop." });
                const cancelled = await cancel.promise;
                pendingCancels.delete(paymentKey);
                if (cancelled) { close("cancelled"); send("Cancel"); } else complete(saleActions);
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

        // Sections 2 and 4: test reads the configuration behind the context id and checks it against
        // CONFIG_SCHEMA. false is a legitimate answer: the administrator sees "fail" for this node.
        if (route === "POST /test") {
            if (!installation?.cosBaseUrl) return json(response, 400, errorBody("Not installed: no CommerceOS to read the configuration from"));
            let configuration;
            try { configuration = await readConfig(request); } catch (error) { return json(response, 400, errorBody(`Cannot read the configuration: ${error.message}`)); }
            const problems = configProblems(configuration);
            log(`test ${request.headers["x-epi-context-config-id"]}: ${problems.length ? problems.join(", ") : `ok, merchant ${configuration.merchantId} in ${configuration.mode}`}`);
            return json(response, 200, problems.length === 0);
        }
        // Section 2, the other contextful calls.
        if (route === "GET /methods") return json(response, 200, [METHOD]);
        if (route === "GET /terminals") return json(response, 200, TERMINALS);
        if ((match = /^GET \/terminals\/([^/]+)$/.exec(route))) {
            const terminal = TERMINALS.find(t => t.terminalId === decodeURIComponent(match[1]));
            return terminal ? json(response, 200, terminal) : json(response, 404, errorBody(`Unknown terminal ${match[1]}`));
        }
        // Section 5: the payment stream.
        if ((match = /^PUT \/payments\/([^/]+)$/.exec(route))) {
            return streamPayment(response, decodeURIComponent(match[1]), await readJson(request));
        }
        // Section 6: capture, release and refund. A refund carries reversalArgs and credits the session.
        // Section 11: CommerceOS does not retry, but a cashier may; the same request answers the same transaction.
        if ((match = /^POST \/payments\/([^/]+)\/transactions$/.exec(route))) {
            const dto = await readJson(request);
            const paymentKey = decodeURIComponent(match[1]);
            const sessionId = sessionsByKey.get(paymentKey);
            if (!sessionId || bank.session(sessionId).state !== "settled") return json(response, 404, errorBody(`No completed payment ${paymentKey}`));
            if (dto?.methodId !== METHOD_ID) return json(response, 400, errorBody(`Unknown method ${dto?.methodId}`));
            const requestKey = `${paymentKey}\n${JSON.stringify(dto)}`;
            if (transactionsByRequest.has(requestKey)) return json(response, 200, transactionsByRequest.get(requestKey));
            const transaction = { ...bank.record(sessionId, dto.reversalArgs ? ["Credit"] : dto.actions, dto.amount), ...(dto.specification ? { specification: dto.specification } : {}) };
            transactionsByRequest.set(requestKey, transaction);
            save();
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
    const stateFile = process.env.PIGGY_STATE || undefined;
    const server = await startPiggyServer({ port: Number(process.env.PORT ?? 8787), waitMs, stateFile, log: line => console.log(`[piggy] ${line}`) });
    console.log(`Piggy Bank integration at ${server.url} (tap and cancel window ${waitMs} ms${stateFile ? `, state in ${stateFile}` : ", state in memory"})`);
}
