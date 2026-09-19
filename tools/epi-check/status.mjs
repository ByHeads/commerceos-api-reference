// Order status derived from transactions. Mirrors the CommerceOS payment order status at the
// contract commit named in run.mjs.

/**
 * Parses a decimal string into integer minor units at the given scale.
 * "100.5" at scale 2 is 10050. Never a float.
 */
export function toMinor(amount, scale) {
    const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(amount));
    if (!match) throw new Error(`Not a decimal string: ${JSON.stringify(amount)}`);
    const [, sign, whole, fraction = ""] = match;
    if (fraction.length > scale) throw new Error(`More decimals than scale ${scale}: ${amount}`);
    const digits = whole + fraction.padEnd(scale, "0");
    const value = BigInt(digits);
    return sign ? -value : value;
}

/** The number of decimals needed to hold every amount exactly. */
export function scaleOf(amounts) {
    let scale = 0;
    for (const amount of amounts) {
        const fraction = /\.(\d+)$/.exec(String(amount));
        if (fraction) scale = Math.max(scale, fraction[1].length);
    }
    return scale;
}

/*
 * Status computation, PaymentOrder.ts lines 191-215:
 *
 *   result = []; total = 0
 *   if authorizedAmount > 0: push "Authorized"; total += authorizedAmount   (lines 196-199)
 *   if annulledAmount   > 0: push "Annulled";   total += annulledAmount     (lines 200-203)
 *   if debitedAmount    > 0: push "Debited";    total += debitedAmount      (lines 204-207)
 *   if creditedAmount   > 0: push "Credited";   total += creditedAmount     (lines 208-211)
 *   if total < limitAmount:  push "New"                                     (lines 212-214)
 *
 * The four amounts are measures of currency instances that moved between three accounts,
 * lines 310-347 (PaymentOrder.ts) and lines 277-296 (PaymentRecord.ts, the moves per action):
 *
 *   account     owner   role
 *   source      payer   the money the payer gives
 *   transit     payee   money in flight
 *   destination payee   money the payee holds
 *
 *   Authorize   move transit     -> destination   (PaymentRecord.ts 277-281)
 *   Annul       move destination -> transit       (PaymentRecord.ts 282-286)
 *   Debit       move source      -> transit       (PaymentRecord.ts 287-291)
 *   Credit      move destination -> source        (PaymentRecord.ts 292-296)
 *
 *   annulledInstance   = probe(destination -> transit)                       (lines 325-331)
 *   debitedInstance    = probe(source -> transit)                            (lines 333-339)
 *   creditedInstance   = probe(destination -> source)                        (lines 341-347)
 *   authorizedInstance = probe(transit -> destination)
 *                        minus union(annulled, debited, credited)            (lines 310-323)
 *
 * The union is a set of currency instances, and a credited instance is always a debited
 * instance (creditableInstance = debitedInstance, lines 369-372). So in amounts:
 *   authorizedAmount = everAuthorized - annulledAmount - debitedAmount.
 * `total` in the status sums debited and credited separately, which is why a refunded sale
 * reads ["Credited", "Debited"] without "New".
 *
 * What each action may take (PaymentOrder.ts 349-372), checked by PaymentRecord.post:
 *   authorizable = limit - everAuthorized   (annulled money is not authorizable again, 349-359)
 *   annullable   = authorized               (361-363)
 *   debitable    = authorized               (365-367)
 *   creditable   = debited, or nothing once credited equals debited (369-372)
 * The last rule is a set comparison in the source. This model uses debited - credited, the
 * amount reading of it. The reference, section 9 *Status and action values*, records that choice.
 *
 * A record applies its actions in the fixed order Authorize, Annul, Debit, Credit
 * in CommerceOS, whatever the order in the `actions` array.
 */
export function deriveStatus({ limitAmount, transactions = [] }) {
    const scale = scaleOf([limitAmount, ...transactions.map(t => t.amount)]);
    const limit = toMinor(limitAmount, scale);
    let everAuthorized = 0n, annulled = 0n, debited = 0n, credited = 0n;
    const authorized = () => everAuthorized - annulled - debited;

    for (const [index, transaction] of transactions.entries()) {
        const amount = toMinor(transaction.amount, scale);
        if (amount <= 0n) throw new Error(`Transaction ${index}: amount must be positive.`);
        const actions = new Set(transaction.actions);
        for (const action of actions) {
            if (!["Authorize", "Annul", "Debit", "Credit"].includes(action)) throw new Error(`Transaction ${index}: bad payment action ${JSON.stringify(action)}.`);
        }
        if (actions.has("Authorize")) {
            if (amount > limit - everAuthorized) throw new Error(`Transaction ${index}: designated amount is not authorizable.`);
            everAuthorized += amount;
        }
        if (actions.has("Annul")) {
            if (amount > authorized()) throw new Error(`Transaction ${index}: designated amount is not annullable.`);
            annulled += amount;
        }
        if (actions.has("Debit")) {
            if (amount > authorized()) throw new Error(`Transaction ${index}: designated amount is not debitable.`);
            debited += amount;
        }
        if (actions.has("Credit")) {
            if (amount > debited - credited) throw new Error(`Transaction ${index}: designated amount is not creditable.`);
            credited += amount;
        }
    }

    const result = [];
    let total = 0n;
    if (authorized() > 0n) { result.push("Authorized"); total += authorized(); }
    if (annulled > 0n) { result.push("Annulled"); total += annulled; }
    if (debited > 0n) { result.push("Debited"); total += debited; }
    if (credited > 0n) { result.push("Credited"); total += credited; }
    if (total < limit) result.push("New");
    return result.sort();
}
