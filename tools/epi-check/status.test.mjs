import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveStatus, toMinor, scaleOf } from "./status.mjs";

const order = (...transactions) => deriveStatus({ limitAmount: "100.00", transactions });
const tx = (actions, amount) => ({ actions, amount });

test("one-step sale: Authorize and Debit for the full amount gives Debited", () => {
    assert.deepEqual(order(tx(["Authorize", "Debit"], "100.00")), ["Debited"]);
});

test("Authorize for the full amount gives Authorized", () => {
    assert.deepEqual(order(tx(["Authorize"], "100.00")), ["Authorized"]);
});

test("Authorize full then Debit half gives Authorized and Debited", () => {
    assert.deepEqual(order(tx(["Authorize"], "100.00"), tx(["Debit"], "50.00")), ["Authorized", "Debited"]);
});

test("Authorize full then Annul full gives Annulled", () => {
    assert.deepEqual(order(tx(["Authorize"], "100.00"), tx(["Annul"], "100.00")), ["Annulled"]);
});

test("sale then full refund gives Credited and Debited", () => {
    assert.deepEqual(order(tx(["Authorize", "Debit"], "100.00"), tx(["Credit"], "100.00")), ["Credited", "Debited"]);
});

test("Authorize for half the limit gives Authorized and New", () => {
    assert.deepEqual(order(tx(["Authorize"], "50.00")), ["Authorized", "New"]);
});

test("no transactions gives New", () => {
    assert.deepEqual(order(), ["New"]);
});

test("partial refund keeps the authorized remainder", () => {
    assert.deepEqual(
        order(tx(["Authorize"], "100.00"), tx(["Debit"], "50.00"), tx(["Credit"], "50.00")),
        ["Authorized", "Credited", "Debited"]);
});

test("annulled money is not authorizable again", () => {
    assert.throws(
        () => order(tx(["Authorize"], "100.00"), tx(["Annul"], "100.00"), tx(["Authorize"], "1.00")),
        /not authorizable/);
});

test("a debit above the authorized amount is refused", () => {
    assert.throws(() => order(tx(["Authorize"], "50.00"), tx(["Debit"], "60.00")), /not debitable/);
});

test("a credit above the debited amount is refused", () => {
    assert.throws(() => order(tx(["Authorize", "Debit"], "50.00"), tx(["Credit"], "50.01")), /not creditable/);
});

test("actions apply in the fixed order Authorize, Annul, Debit, Credit", () => {
    assert.deepEqual(order(tx(["Debit", "Authorize"], "100.00")), ["Debited"]);
});

test("a bad action or a non-positive amount is refused", () => {
    assert.throws(() => order(tx(["Capture"], "1.00")), /bad payment action/);
    assert.throws(() => order(tx(["Authorize"], "0")), /must be positive/);
    assert.throws(() => order(tx(["Authorize"], "1.5.0")), /Not a decimal/);
});

test("amounts are integer minor units at a shared scale, never floats", () => {
    assert.equal(scaleOf(["1", "0.1", "0.005"]), 3);
    assert.equal(toMinor("100.5", 2), 10050n);
    assert.equal(toMinor("-0.10", 2), -10n);
    assert.throws(() => toMinor("1.234", 2), /More decimals/);
    // 0.1 + 0.2 style input: 0.30 total must not read as New at limit 0.3.
    assert.deepEqual(deriveStatus({ limitAmount: "0.3", transactions: [tx(["Authorize", "Debit"], "0.1"), tx(["Authorize", "Debit"], "0.2")] }), ["Debited"]);
});
