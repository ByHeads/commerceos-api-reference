import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEvents, formatEvent, collectEvents, decodeSSE } from "./sse.mjs";

const encoder = new TextEncoder();

async function* chunked(text, size) {
    const bytes = encoder.encode(text);
    for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size);
}

const stream = [
    formatEvent("Cancellable", { cancellationToken: "c-1" }),
    formatEvent("Wait", { message: "Blipp — vänta", params: ["1", "2"] }),
    formatEvent("Complete", { result: { methodId: "m", amount: "100.00", currencyCode: "SEK", processorsId: "p", transactions: [] } }),
].join("");

const expected = [
    { type: "Cancellable", cancellationToken: "c-1" },
    { type: "Wait", message: "Blipp — vänta", params: ["1", "2"] },
    { type: "Complete", result: { methodId: "m", amount: "100.00", currencyCode: "SEK", processorsId: "p", transactions: [] } },
];

test("a data line without the space after the colon fails as CommerceOS reads it, with the reason", async () => {
    // `data:{"a":1}` loses its `{` in CommerceOS, so the JSON never parses. The tool says why.
    const bytes = chunked('event: Complete\ndata:{"result":{}}\n\n', 64);
    await assert.rejects(collectEvents(bytes), /the data of a Complete step is not JSON as CommerceOS reads it .*one space after "data:"/);
});

test("formatEvent then parseEvents is a round trip", async () => {
    assert.deepEqual(await collectEvents(chunked(stream, stream.length)), expected);
});

test("1-byte and 7-byte chunks yield the same events as the whole stream", async () => {
    const whole = await collectEvents(chunked(stream, stream.length));
    assert.deepEqual(await collectEvents(chunked(stream, 1)), whole);
    assert.deepEqual(await collectEvents(chunked(stream, 7)), whole);
    // 1-byte chunks split the multi-byte "—" and "ä"; the streaming decoder must reassemble them.
    assert.equal(whole[1].message, "Blipp — vänta");
});

test("two events in one chunk yield two events", async () => {
    const two = formatEvent("Create", { result: { processorsId: "p" } }) + formatEvent("Cancel");
    assert.deepEqual(await collectEvents(chunked(two, two.length)), [
        { type: "Create", result: { processorsId: "p" } },
        { type: "Cancel" },
    ]);
});

test("an event without data yields { type } only", async () => {
    assert.equal(formatEvent("Cancel"), "event: Cancel\n\n");
    assert.deepEqual(await collectEvents(chunked(formatEvent("Cancel"), 3)), [{ type: "Cancel" }]);
});

test("retry: and id: lines are ignored", async () => {
    const text = "retry: 3000\nid: 7\nevent: Wait\ndata: {\"message\":\"m\"}\n\n";
    assert.deepEqual(await collectEvents(chunked(text, text.length)), [{ type: "Wait", message: "m" }]);
});

test("several data: lines join with a newline before JSON.parse", async () => {
    const text = "event: Complete\ndata: {\"a\":\ndata: 1}\n\n";
    assert.deepEqual(await collectEvents(chunked(text, 5)), [{ type: "Complete", a: 1 }]);
    const records = [];
    for await (const record of decodeSSE(chunked(text, text.length))) records.push(record);
    assert.deepEqual(records, [{ event: "Complete", data: "{\"a\":\n1}" }]);
});

test("formatEvent matches the hosted integrations' event() byte for byte", () => {
    assert.equal(formatEvent("Decline", { reason: "InsufficientFunds" }), "event: Decline\ndata: {\"reason\":\"InsufficientFunds\"}\n\n");
});
