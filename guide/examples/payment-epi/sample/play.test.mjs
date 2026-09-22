import { test } from "node:test";
import assert from "node:assert/strict";
import { startPiggyServer } from "./server.mjs";
import { play, transactionTable } from "./play.mjs";

const clock = () => new Date("2026-01-01T00:00:00Z");
// No cosBaseUrl: the bank skips the key-value callback, so the test touches nothing outside.
const install = { cosBaseUrl: "", tokenUrl: "", clientId: "test", clientSecret: "test", scope: "kv" };

test("play 10.00 ends with Complete and prints the transaction table", async () => {
    const piggy = await startPiggyServer({ idPrefix: "PB-", now: clock });
    const lines = [];
    try {
        const final = await play({ amount: "10.00", base: piggy.url, print: line => lines.push(line), install });
        assert.equal(final.type, "Complete");
        assert.deepEqual(final.result.transactions[0].actions, ["Authorize", "Debit"]);
        assert.equal(lines[0], "Method com.example.piggy (Piggy Bank)");
        assert.match(lines[1], /^→ Complete \{"result":/);
        assert.equal(lines[2], transactionTable(final.result.transactions));
        assert.match(lines[2], /PB-2 {11}Authorize\+Debit {2}10\.00 {3}SEK {11}tok-10\.00 {2}2026-01-01T00:00:00\.000Z$/);
    } finally {
        await piggy.close();
    }
});

test("play 10.01 ends with Decline", async () => {
    const piggy = await startPiggyServer({ idPrefix: "PB-", now: clock });
    const lines = [];
    try {
        const final = await play({ amount: "10.01", base: piggy.url, print: line => lines.push(line), install });
        assert.deepEqual(final, { type: "Decline", reason: "InsufficientFunds", params: ["0.00", "10.01"] });
        assert.deepEqual(lines.slice(1), ['→ Decline {"reason":"InsufficientFunds","params":["0.00","10.01"]}']);
    } finally {
        await piggy.close();
    }
});

test("play 10.04 prints the tap command, and a tap completes the payment before the window closes", async () => {
    const piggy = await startPiggyServer({ idPrefix: "PB-", now: clock, waitMs: 5000 });
    const lines = [];
    try {
        const print = line => {
            lines.push(line);
            const tap = /^ {2}tap: {4}curl -X POST (\S+)$/.exec(line);
            if (tap) fetch(tap[1], { method: "POST" });
        };
        const started = Date.now();
        const final = await play({ amount: "10.04", base: piggy.url, print, install });
        assert.equal(final.type, "Complete");
        assert.ok(Date.now() - started < 4000, "the tap, not the window, completed the payment");
        assert.equal(lines[2], `  tap:    curl -X POST ${piggy.url}/tap/PB-1`);
    } finally {
        await piggy.close();
    }
});

test("play against a closed port is a transport error", async () => {
    await assert.rejects(play({ amount: "10.00", base: "http://127.0.0.1:1/piggy", print: () => {}, install }), /fetch failed/);
});

test("play 10.04 --cos: the bank writes its session to the stand-in's key-value store, and the output shows it", async () => {
    const piggy = await startPiggyServer({ idPrefix: "PB-", now: clock, waitMs: 200 });
    const lines = [];
    try {
        const final = await play({ amount: "10.04", base: piggy.url, print: line => lines.push(line), cos: true });
        assert.equal(final.type, "Complete");
        assert.ok(lines.includes("[cos] POST /oauth2/v1/token 200"), lines.join("\n"));
        assert.ok(lines.some(line => /^\[cos\] PUT \/api\/v1\/kv\/com\.example\.piggy\/pay-\d+ 200$/.test(line)), lines.join("\n"));
        assert.equal(lines.filter(line => line.startsWith("[cos] PUT")).length, 2, "waiting, then settled");
    } finally {
        await piggy.close();
    }
});
