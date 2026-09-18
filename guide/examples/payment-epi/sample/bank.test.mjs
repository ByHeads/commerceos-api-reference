import { test } from "node:test";
import assert from "node:assert/strict";
import { createBank } from "./bank.mjs";

const clock = () => new Date("2026-01-01T00:00:00Z");
const init = { amount: "10.00", currencyCode: "SEK", methodId: "com.example.piggy", token: "tok-1" };

test("createSession opens a session with a PB id and an empty ledger", () => {
    const bank = createBank({ now: clock });
    const { sessionId } = bank.createSession(init);
    assert.equal(sessionId, "PB-1");
    assert.equal(bank.session(sessionId).state, "open");
    assert.deepEqual(bank.ledger, []);
});

test("tap resolves a waiting session, and an unknown session is refused", async () => {
    const bank = createBank({ now: clock });
    const { sessionId } = bank.createSession(init);
    const waiting = bank.waitForTap(sessionId);
    assert.equal(bank.tap(sessionId), true);
    assert.equal(await waiting, true);
    assert.equal(bank.tap("PB-999"), false);
});

test("settle records the first transaction, and credit appends a Credit", () => {
    const bank = createBank({ now: clock });
    const { sessionId } = bank.createSession(init);
    const sale = bank.settle(sessionId, ["Authorize", "Debit"]);
    const refund = bank.credit(sessionId, "4.00");
    assert.equal(bank.session(sessionId).state, "settled");
    assert.deepEqual(sale, { ...init, transactionId: "PB-2", actions: ["Authorize", "Debit"], timestamp: "2026-01-01T00:00:00.000Z" });
    assert.deepEqual(refund.actions, ["Credit"]);
    assert.equal(refund.amount, "4.00");
    assert.equal(refund.token, "tok-1");
    assert.deepEqual(bank.ledger, [sale, refund]);
});
