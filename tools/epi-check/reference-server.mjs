// A complete payment integration with scripted outcomes, on node:http only. It mirrors the Mock payment
// integration that Heads hosts, at the contract commit named in run.mjs, and adds what the Mock leaves
// out: terminals, cancel, decline, fail, wait, and the context header check that every hosted
// integration performs.
//
// The cents of `amount` select the outcome (README, *Amount convention*):
//   .00 Complete ["Authorize","Debit"]   .01 Decline   .02 Fail
//   .03 Cancellable, then Cancel         .04 Wait, then Complete   .05 Complete ["Authorize"]
// Direction "Payout" gives ["Authorize"] unless `debitSynchronously` is true (Mock lines 60-66).
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

/** The defects a test can switch on, so the runner proves that it catches them. */
export const DEFECTS = ["drop-token"];

function errorBody(message) {
    return { errors: [{ message }] };
}

/**
 * Starts the reference server. `url` is the base URL, prefix included, that a driver points at.
 * `close` stops the server and releases every pending cancellable payment.
 */
export function startReferenceServer({ port = 0, now = () => new Date("2026-01-01T00:00:00Z"), prefix = "", defect } = {}) {
    if (defect !== undefined && !DEFECTS.includes(defect)) throw new Error(`Unknown reference defect: ${defect}`);
    let installation = null;
    let counter = 0;
    const pendingCancels = new Map();

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

    const paymentResult = (key, dto, actions) => ({
        processorsId: `proc-${key}`,
        methodId: dto.methodId,
        amount: dto.amount,
        currencyCode: dto.currencyCode,
        transactions: [transaction(dto, actions)],
    });

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

    async function streamPayment(response, key, dto) {
        response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        const send = (type, data) => response.write(formatEvent(type, data));
        const completeActions = dto.direction === "Payout"
            ? (dto.debitSynchronously ? ["Authorize", "Debit"] : ["Authorize"])
            : (cents(dto.amount) === "05" ? ["Authorize"] : ["Authorize", "Debit"]);

        switch (cents(dto.amount)) {
            case "01":
                send("Decline", { reason: "InsufficientFunds" });
                break;
            case "02":
                send("Fail", { errors: [{ code: "ScriptedFailure", message: "Scripted failure for amount ending in .02" }] });
                break;
            case "03": {
                send("Cancellable", { cancellationToken: key });
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
                send("Complete", { result: paymentResult(key, dto, completeActions) });
                break;
            default:
                send("Complete", { result: paymentResult(key, dto, completeActions) });
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
            if (dto?.methodId !== METHOD_ID) return json(response, 400, errorBody("Unknown method"));
            if (cents(dto.amount) === null) return json(response, 400, errorBody("Amount is not a decimal string"));
            return streamPayment(response, decodeURIComponent(match[1]), dto);
        }
        if ((match = /^POST \/payments\/([^/]+)\/transactions$/.exec(route))) {
            const dto = await readJson(request);
            if (dto?.methodId !== METHOD_ID) return json(response, 400, errorBody("Unknown method"));
            return json(response, 200, transaction(dto, dto.actions));
        }
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
