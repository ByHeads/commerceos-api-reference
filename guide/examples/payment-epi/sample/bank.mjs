// Piggy Bank: the in-memory bank behind the sample integration. It holds payment sessions and a
// ledger of transactions, and nothing else. A session waits until the customer's phone taps
// it (`tap`). The clock is injected, so tests and the conformance run get the same output.
//
// Ids are `<prefix><counter>`: sessions and transactions share one counter. CommerceOS requires a
// processorsId to be unique per payment method for all time, so a prefix that changes on every
// start (the default) keeps a restarted bank from colliding with orders it created earlier.

/**
 * Creates a bank. `now` returns the Date used for every timestamp; `idPrefix` starts every id.
 * `snapshot` restores a bank saved with `snapshot()`: the prefix and counter continue, so the ids
 * stay unique across the restart; a session that was open when the snapshot was taken is lost with
 * the process that held it, and becomes `failed`.
 */
export function createBank({ now = () => new Date(), idPrefix = `PB-${Date.now().toString(36)}-`, snapshot } = {}) {
    const prefix = snapshot?.idPrefix ?? idPrefix;
    let counter = snapshot?.counter ?? 0;
    const sessions = new Map();
    const ledger = [...(snapshot?.ledger ?? [])];
    const nextId = () => `${prefix}${++counter}`;
    for (const saved of snapshot?.sessions ?? []) {
        const session = { ...saved, state: saved.state === "open" ? "failed" : saved.state, tapped: Promise.resolve(false), resolveTap: () => {} };
        sessions.set(session.sessionId, session);
    }

    function get(sessionId) {
        const session = sessions.get(sessionId);
        if (!session) throw new Error(`Unknown session ${sessionId}`);
        return session;
    }

    /** Appends one transaction on the session's money and returns it. */
    function post(sessionId, actions, amount) {
        const session = get(sessionId);
        const transaction = {
            transactionId: nextId(),
            actions,
            amount: amount ?? session.amount,
            currencyCode: session.currencyCode,
            methodId: session.methodId,
            token: session.token,
            // The items this money is about: echoed, so the payment record in CommerceOS lists them.
            specification: session.specification,
            timestamp: now().toISOString(),
            // What paid. A provider without card data names its brand as a Singleton: the receipt,
            // the back office and the sales reports then show "Piggy Bank" instead of nothing.
            means: { type: "Singleton", id: "Piggy Bank" },
        };
        ledger.push(transaction);
        session.transactionIds = [...(session.transactionIds ?? []), transaction.transactionId];
        return transaction;
    }

    return {
        ledger,

        /** Everything a restart needs, as plain JSON: the id prefix and counter, the sessions, the ledger. */
        snapshot: () => ({
            idPrefix: prefix,
            counter,
            sessions: [...sessions.values()].map(({ tapped, resolveTap, ...session }) => session),
            ledger,
        }),

        /** Opens a session for one payment. `state` is `open` until it is settled or closed. */
        createSession({ amount, currencyCode, methodId, token, specification = [] }) {
            const sessionId = nextId();
            const session = { sessionId, amount, currencyCode, methodId, token, specification, state: "open" };
            session.tapped = new Promise(resolve => { session.resolveTap = resolve; });
            sessions.set(sessionId, session);
            return { sessionId };
        },

        /** Reads a session, or throws for an unknown id. */
        session: get,

        /** Resolves when the customer taps. Resolves at once if the tap already happened. */
        waitForTap: sessionId => get(sessionId).tapped,

        /** The customer's phone taps the session. Returns false for an unknown session. */
        tap(sessionId) {
            const session = sessions.get(sessionId);
            if (!session) return false;
            session.resolveTap(true);
            return true;
        },

        /** Settles the session: records the payment's first transaction with `actions`. */
        settle(sessionId, actions) {
            get(sessionId).state = "settled";
            return post(sessionId, actions);
        },

        /** A later move on settled money: `Debit` captures, `Annul` releases, `Credit` refunds. */
        record: (sessionId, actions, amount) => post(sessionId, actions, amount),

        /**
         * The money that `action` can still move on the session, in cents: a `Credit` refunds debited
         * money that is not refunded yet; a `Debit` or an `Annul` uses reserved money that is not
         * captured or released yet.
         */
        left(sessionId, action) {
            const ids = new Set(get(sessionId).transactionIds ?? []);
            const sum = name => ledger.filter(t => ids.has(t.transactionId) && t.actions.includes(name))
                .reduce((total, t) => total + Math.round(Number(t.amount) * 100), 0);
            return action === "Credit" ? sum("Debit") - sum("Credit") : sum("Authorize") - sum("Debit") - sum("Annul");
        },

        /** Closes a session without money moving, for example `declined` or `cancelled`. */
        close(sessionId, state) { get(sessionId).state = state; },
    };
}
