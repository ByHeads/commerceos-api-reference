// Piggy Bank: the in-memory bank behind the sample integration. It holds payment sessions and a
// ledger of transactions, and nothing else. A session waits until the customer's phone taps
// it (`tap`). The clock is injected, so tests and the conformance run get the same output.
//
// Ids are `<prefix><counter>`: sessions and transactions share one counter. CommerceOS requires a
// processorsId to be unique per payment method for all time, so a prefix that changes on every
// start (the default) keeps a restarted bank from colliding with orders it created earlier.

/** Creates a bank. `now` returns the Date used for every timestamp; `idPrefix` starts every id. */
export function createBank({ now = () => new Date(), idPrefix = `PB-${Date.now().toString(36)}-` } = {}) {
    let counter = 0;
    const sessions = new Map();
    const ledger = [];
    const nextId = () => `${idPrefix}${++counter}`;

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
            timestamp: now().toISOString(),
        };
        ledger.push(transaction);
        return transaction;
    }

    return {
        ledger,

        /** Opens a session for one payment. `state` is `open` until it is settled or closed. */
        createSession({ amount, currencyCode, methodId, token }) {
            const sessionId = nextId();
            const session = { sessionId, amount, currencyCode, methodId, token, state: "open" };
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

        /** Closes a session without money moving, for example `declined` or `cancelled`. */
        close(sessionId, state) { get(sessionId).state = state; },
    };
}
