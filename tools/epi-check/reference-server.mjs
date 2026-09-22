// A complete payment integration with scripted outcomes, on node:http only. It mirrors the Mock payment
// integration that Heads hosts, at the contract commit named in run.mjs, and adds what the Mock leaves
// out: terminals, cancel, decline, fail, wait, resume, and the context header check that every hosted
// integration performs.
//
// The cents of `amount` select the outcome (README, *Amount convention*):
//   .00 Complete ["Authorize","Debit"]   .01 Decline   .02 Fail
//   .03 Cancellable, Wait, then Cancel   .04 Wait, then Complete   .05 Complete ["Authorize"]
// Direction "Payout" gives ["Authorize"] unless `debitSynchronously` is true (Mock lines 60-66).
//
// Contract facts it honors beyond the outcomes:
//   - a request it cannot take (unknown methodId, a non-decimal amount) is a 200 stream with one Fail
//     step, because CommerceOS reads no non-2xx body on the stream route (reference section 7)
//   - a transactions call for a key that never completed is 404 with an error body (section 6)
//   - a repeated PUT for a completed key is a resume: same processorsId, same transactions (section 11)
//   - a repeated transactions call with the same body answers the same transaction (section 11)
//   - Cancellable is followed by a Wait step, which is where the POS shows the cancel button (section 5)
//
// Deterministic: transaction ids come from a per-server counter, timestamps from the injected
// clock, and the response bodies never carry a wall-clock value.
import { createServer } from "node:http";
import { formatEvent } from "./sse.mjs";
import { cents } from "../../guide/examples/payment-epi/sample/server.mjs";

export const METHOD_ID = "com.epicheck.reference";
export const CANCEL_WAIT_MS = 2000;

const CONFIG_SCHEMA = {
    title: "Reference",
    members: {
        merchantId: { type: "string" },
        mode: { type: "'TEST' or 'LIVE'" },
    },
};

const TERMINALS = [
    { terminalId: "T-01", methodId: METHOD_ID, name: "Reference terminal 1" },
    { terminalId: "T-02", methodId: METHOD_ID, name: "Reference terminal 2" },
];

/**
 * The defects a test can switch on, so the runner proves that it catches each one. A defect that
 * names a scenario applies to the payment whose key ends in that scenario id (fixtures.json gives
 * every key the shape `pay-<runId>-<id>`), so exactly that scenario fails.
 */
export const DEFECT_SCENARIO = {
    "no-final-step": "P9",              // the stream ends after Wait
    "two-final-steps": "P1",            // Complete, then Fail
    "no-space-after-colon": "P1",       // `data:{...}`: CommerceOS drops the first character
    "processorsId-reused": "P2",        // P2 answers P1's processorsId
    "resume-new-transaction": "P10",    // the repeated PUT mints a new transaction
    "cancel-refuses": "P7",             // the cancel call answers 409 with a body
    "credit-refuses": "P4",             // the Credit answers 500 with a body
    "credit-not-idempotent": "P12",     // the repeated Credit gets a new transactionId
    "cancellable-without-wait": "P7",   // no Wait after Cancellable
};
/** `drop-token` omits `token` from every transaction; `non-2xx-on-stream` answers an unknown method with 400 (E2). */
export const DEFECTS = ["drop-token", "non-2xx-on-stream", ...Object.keys(DEFECT_SCENARIO)];

function errorBody(message) {
    return { errors: [{ message }] };
}

/** The scenario id at the end of a payment key: `pay-<runId>-<id>`. */
const scenarioOf = key => key.slice(key.lastIndexOf("-") + 1);

/**
 * Starts the reference server. `url` is the base URL, prefix included, that a driver points at.
 * `close` stops the server and releases every pending cancellable payment.
 */
export function startReferenceServer({ port = 0, now = () => new Date("2026-01-01T00:00:00Z"), prefix = "", defect } = {}) {
    if (defect !== undefined && !DEFECTS.includes(defect)) throw new Error(`Unknown reference defect: ${defect}`);
    let installation = null;
    let counter = 0;
    let firstProcessorsId;
    const pendingCancels = new Map();
    const results = new Map();               // paymentKey -> the Complete result, replayed on a repeated PUT
    const transactionsByRequest = new Map(); // paymentKey + body -> the transaction, replayed on a repeated call

    const defective = (name, key) => defect === name && scenarioOf(key) === DEFECT_SCENARIO[name];
    const nextTransactionId = () => `REF-${String(++counter).padStart(6, "0")}`;

    const transaction = (dto, actions) => {
        const result = {
            transactionId: nextTransactionId(),
            actions,
            amount: dto.amount,
            currencyCode: dto.currencyCode,
            methodId: dto.methodId,
            token: dto.token,
            timestamp: now().toISOString(),
            specification: dto.specification,
        };
        if (defect === "drop-token") delete result.token;
        return result;
    };

    // processorsId is unique per method for all time: one per key, and a key completes once.
    const paymentResult = (key, dto, actions) => {
        const processorsId = defective("processorsId-reused", key) && firstProcessorsId !== undefined ? firstProcessorsId : `proc-${key}`;
        firstProcessorsId ??= processorsId;
        return { processorsId, methodId: dto.methodId, amount: dto.amount, currencyCode: dto.currencyCode, transactions: [transaction(dto, actions)] };
    };

    const readJson = request => new Promise((resolve, reject) => {
        const chunks = [];
        request.on("data", chunk => chunks.push(chunk));
        request.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            try { resolve(text ? JSON.parse(text) : undefined); } catch (error) { reject(error); }
        });
        request.on("error", reject);
    });

    const json = (response, status, body) => {
        const text = body === undefined ? "" : JSON.stringify(body, null, 4);
        response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
        response.end(text);
    };

    const contextMissing = request =>
        typeof request.headers["x-epi-context-config-id"] !== "string" ||
        typeof request.headers["x-epi-context-config-hash"] !== "string";

    /** What is wrong with a PaymentInitDto, or undefined. Reported as a Fail step, never as a status. */
    const refusal = dto => {
        if (dto?.methodId !== METHOD_ID) return { code: "UnknownMethod", message: `Unknown method ${dto?.methodId}` };
        if (cents(dto.amount) === null) return { code: "BadAmount", message: "Amount is not a decimal string" };
        return undefined;
    };

    async function streamPayment(response, key, dto) {
        response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        const send = (type, data) => response.write(defective("no-space-after-colon", key) ? formatEvent(type, data).replace("data: ", "data:") : formatEvent(type, data));
        const refused = refusal(dto);
        if (refused) { send("Fail", { errors: [refused] }); return response.end(); }
        // Section 11: a completed key is resumed, never charged again.
        if (results.has(key) && !defective("resume-new-transaction", key)) { send("Complete", { result: results.get(key) }); return response.end(); }

        const completeActions = dto.direction === "Payout"
            ? (dto.debitSynchronously ? ["Authorize", "Debit"] : ["Authorize"])
            : (cents(dto.amount) === "05" ? ["Authorize"] : ["Authorize", "Debit"]);
        const complete = () => {
            const result = paymentResult(key, dto, completeActions);
            results.set(key, result);
            send("Complete", { result });
            if (defective("two-final-steps", key)) send("Fail", { errors: [{ code: "Scripted", message: "A second final step" }] });
        };

        switch (cents(dto.amount)) {
            case "01":
                send("Decline", { reason: "InsufficientFunds", params: ["0.00", dto.amount] });
                break;
            case "02":
                send("Fail", { errors: [{ code: "ScriptedFailure", message: "Scripted failure for amount ending in .02" }] });
                break;
            case "03": {
                send("Cancellable", { cancellationToken: key });
                // Section 5: the cancel button sits on the Wait dialog. Cancellable alone shows nothing.
                if (!defective("cancellable-without-wait", key)) send("Wait", { message: "Waiting for the provider. Cancel from the till to stop." });
                const cancelled = await new Promise(resolve => {
                    const timer = setTimeout(() => { pendingCancels.delete(key); resolve(false); }, CANCEL_WAIT_MS);
                    pendingCancels.set(key, () => { clearTimeout(timer); pendingCancels.delete(key); resolve(true); });
                });
                if (cancelled) send("Cancel");
                else send("Fail", { errors: [{ code: "CancelTimeout", message: "No cancel arrived within 2 seconds" }] });
                break;
            }
            case "04":
                send("Wait", { message: "Waiting for the customer" });
                if (!defective("no-final-step", key)) complete();
                break;
            default:
                complete();
        }
        response.end();
    }

    async function handle(request, response) {
        const url = new URL(request.url, "http://localhost");
        if (prefix && !url.pathname.startsWith(prefix)) return json(response, 404, errorBody("Not found"));
        const path = url.pathname.slice(prefix.length);
        const route = `${request.method} ${path}`;

        if (route === "POST /install") { installation = await readJson(request); return json(response, 200); }
        if (route === "POST /uninstall") { installation = null; return json(response, 200); }
        if (route === "GET /config-schema") return json(response, 200, CONFIG_SCHEMA);

        if (contextMissing(request)) return json(response, 400, errorBody("Missing or invalid EPI context config ID or hash. Expected 'x-epi-context-config-id' and 'x-epi-context-config-hash' headers in request."));

        if (route === "POST /test") return json(response, 200, true);
        if (route === "GET /methods") {
            return json(response, 200, [{
                methodId: METHOD_ID,
                name: "Reference",
                supports: { incoming: true, outgoing: true, reversal: true },
                requires: { terminal: false, specification: false },
            }]);
        }
        if (route === "GET /terminals") return json(response, 200, TERMINALS);

        let match;
        if ((match = /^GET \/terminals\/([^/]+)$/.exec(route))) {
            const terminal = TERMINALS.find(t => t.terminalId === decodeURIComponent(match[1]));
            return terminal ? json(response, 200, terminal) : json(response, 404, errorBody(`Unknown terminal ${match[1]}`));
        }
        if ((match = /^PUT \/payments\/([^/]+)$/.exec(route))) {
            const dto = await readJson(request);
            // The defect the tool must catch: a refusal as a status, which CommerceOS shows as nothing.
            if (defect === "non-2xx-on-stream" && refusal(dto)) return json(response, 400, errorBody(refusal(dto).message));
            return streamPayment(response, decodeURIComponent(match[1]), dto);
        }
        if ((match = /^POST \/payments\/([^/]+)\/transactions$/.exec(route))) {
            const dto = await readJson(request);
            const key = decodeURIComponent(match[1]);
            // Section 6: only a completed payment has transactions. Any other key is 404 with an error body.
            if (!results.has(key)) return json(response, 404, errorBody(`No completed payment ${key}`));
            if (dto?.methodId !== METHOD_ID) return json(response, 400, errorBody("Unknown method"));
            if (defective("credit-refuses", key) && dto.actions?.includes("Credit")) return json(response, 500, errorBody("Credit refused"));
            // Section 11: the same request answers the same transaction.
            const requestKey = `${key}\n${JSON.stringify(dto)}`;
            if (transactionsByRequest.has(requestKey) && !defective("credit-not-idempotent", key)) return json(response, 200, transactionsByRequest.get(requestKey));
            const result = transaction(dto, dto.actions);
            transactionsByRequest.set(requestKey, result);
            return json(response, 200, result);
        }
        if ((match = /^POST \/payments\/([^/]+)\/cancel$/.exec(route))) {
            await readJson(request);
            const token = decodeURIComponent(match[1]);
            if (defective("cancel-refuses", token)) return json(response, 409, errorBody("Cancel refused"));
            const release = pendingCancels.get(token);
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
            const url = `http://127.0.0.1:${server.address().port}${prefix}`;
            resolve({
                url,
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

// `node reference-server.mjs [port] [--defect <name>]` runs the server on its own.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    const args = process.argv.slice(2);
    const defectIndex = args.indexOf("--defect");
    const defect = defectIndex === -1 ? undefined : args[defectIndex + 1];
    const port = Number(args.find(arg => /^\d+$/.test(arg)) ?? 0);
    const server = await startReferenceServer({ port, defect });
    console.log(server.url);
}
