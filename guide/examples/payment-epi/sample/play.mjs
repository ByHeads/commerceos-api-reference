// Plays CommerceOS against the Piggy Bank: install, read the methods, start one payment, and
// print every step of the stream as it arrives. The request bodies and headers are the ones the
// contract reference describes (guide/examples/payment-epi/reference.md, sections 2, 3 and 5).
//
//   node play.mjs <amount> [--base http://localhost:8787/piggy] [--payout]
//
// Exit 0 when the stream ends with a final step, 1 on a transport error.

const DEFAULT_BASE = "http://localhost:8787/piggy";

/** The install payload CommerceOS hands over. The bank logs a failed callback and carries on. */
const INSTALL = { cosBaseUrl: "http://localhost:5000", tokenUrl: "http://localhost:5000/oauth/token", clientId: "play", clientSecret: "play-secret", scope: "kv" };

const customer = { type: "Person", key: "person-0001", givenName: "Anna", familyName: "Lindqvist", fullName: "Anna Lindqvist", email: "anna.lindqvist@example.com" };
const store = { type: "Organization", key: "org-0001", fullName: "Sample Store AB" };

/** Section 3: the three context headers of every contextful call. */
const contextHeaders = base => ({
    "X-EPI-Context-Config-Id": "EPI1",
    "X-EPI-Context-Config-Hash": "play",
    "X-EPI-Debug-Info": JSON.stringify({ nodeName: "play", baseUrl: base, name: "play" }),
});

/** Section 5: a PaymentInitDto for one line, paid by the customer to the store. */
export function paymentInit({ methodId, amount, payout }) {
    return {
        methodId,
        amount,
        currencyCode: "SEK",
        direction: payout ? "Payout" : "Payment",
        payer: payout ? store : customer,
        payee: payout ? customer : store,
        token: `tok-${amount}`,
        locale: "sv-SE",
        specification: [{ identifier: "ART-0001", description: "Sample article", quantity: "1", unit: "pcs", totalAmount: amount, vatPercentage: "25", currencyCode: "SEK" }],
    };
}

/** Yields `{ type, ...data }` per SSE message: `event:` and `data:` lines, records end at a blank line. */
export async function* readEvents(body) {
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of body) {
        buffer += decoder.decode(chunk, { stream: true });
        let end;
        while ((end = buffer.indexOf("\n\n")) !== -1) {
            const record = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const type = /^event: (.*)$/m.exec(record)?.[1];
            const data = record.split("\n").filter(line => line.startsWith("data: ")).map(line => line.slice(6)).join("\n");
            yield { type, ...(data ? JSON.parse(data) : {}) };
        }
    }
}

const FINAL = new Set(["Complete", "Decline", "Cancel", "Fail"]);

/** A fixed-width table of the transactions of a Complete result. */
export function transactionTable(transactions) {
    const columns = ["transactionId", "actions", "amount", "currencyCode", "token", "timestamp"];
    const rows = transactions.map(t => columns.map(c => Array.isArray(t[c]) ? t[c].join("+") : String(t[c] ?? "")));
    const widths = columns.map((c, i) => Math.max(c.length, ...rows.map(r => r[i].length)));
    const line = cells => cells.map((cell, i) => cell.padEnd(widths[i])).join("  ").trimEnd();
    return [line(columns), line(widths.map(w => "-".repeat(w))), ...rows.map(line)].join("\n");
}

/**
 * Plays one payment. `print` receives every output line. Returns the final step. Throws on a
 * transport error or a stream that ends without a final step.
 */
export async function play({ amount, base = DEFAULT_BASE, payout = false, print = console.log, install = INSTALL }) {
    const headers = { ...contextHeaders(base), "content-type": "application/json" };
    const call = async (method, path, body, contextful = true) => {
        const response = await fetch(`${base}${path}`, { method, headers: contextful ? headers : { "content-type": "application/json" }, body: body && JSON.stringify(body) });
        if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}: ${await response.text()}`);
        return response;
    };

    await call("POST", "/install", install, false);
    const [method] = await (await call("GET", "/methods")).json();
    print(`Method ${method.methodId} (${method.name})`);

    const paymentKey = `pay-${Date.now()}`;
    const response = await call("PUT", `/payments/${paymentKey}`, paymentInit({ methodId: method.methodId, amount, payout }));
    if (!response.headers.get("content-type")?.startsWith("text/event-stream")) throw new Error(`PUT /payments answered ${response.headers.get("content-type")}, not an event stream`);

    let final;
    for await (const event of readEvents(response.body)) {
        const { type, ...data } = event;
        print(`→ ${type} ${JSON.stringify(data)}`);
        if (type === "Wait" && data.params?.[0]) print(`  tap:    curl -X POST ${base}/tap/${data.params[0]}`);
        if (type === "Cancellable") print(`  cancel: curl -X POST ${base}/payments/${data.cancellationToken}/cancel -H 'X-EPI-Context-Config-Id: EPI1' -d '{}'`);
        if (type === "Complete") print(transactionTable(data.result.transactions));
        if (FINAL.has(type)) final = event;
    }
    if (!final) throw new Error("The stream ended without a final step");
    return final;
}

// `node play.mjs <amount> [--base <url>] [--payout]`
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    const args = process.argv.slice(2);
    const amount = args.find(arg => /^\d+\.\d{2}$/.test(arg));
    const baseIndex = args.indexOf("--base");
    if (!amount) { console.error("Usage: node play.mjs <amount, for example 10.00> [--base <url>] [--payout]"); process.exit(1); }
    try {
        await play({ amount, base: baseIndex === -1 ? DEFAULT_BASE : args[baseIndex + 1], payout: args.includes("--payout") });
    } catch (error) {
        console.error(`Transport error: ${error.message}`);
        process.exit(1);
    }
}
