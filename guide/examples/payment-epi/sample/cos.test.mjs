import { test } from "node:test";
import assert from "node:assert/strict";
import { startCosStandIn, orderStatus } from "./cos.mjs";

const token = async (cos, clientId = "play", clientSecret = "play-secret") => {
    const form = new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret, scope: "me com.example.piggy:write" });
    return fetch(`${cos.url}/oauth2/v1/token`, { method: "POST", body: form });
};
const bearer = async cos => `Bearer ${(await (await token(cos)).json()).access_token}`;

test("the token endpoint answers the install client and refuses another", async () => {
    const cos = await startCosStandIn();
    try {
        const ok = await token(cos);
        assert.equal(ok.status, 200);
        const body = await ok.json();
        assert.match(body.access_token, /^cos-token-\d+$/);
        assert.equal(body.expires_in, 3600);
        assert.equal((await token(cos, "play", "wrong")).status, 401);
        assert.equal((await fetch(`${cos.url}/api/v1/context/EPI1`)).status, 401, "no bearer, no answer");
    } finally {
        await cos.close();
    }
});

test("the store round-trips a value and the configuration answers the context id", async () => {
    const lines = [];
    const cos = await startCosStandIn({ log: line => lines.push(line) });
    try {
        const headers = { authorization: await bearer(cos), "content-type": "application/json" };
        const url = `${cos.url}/api/v1/context/kv/com.example.piggy/pay-1`;
        assert.equal((await fetch(url, { method: "PUT", headers, body: JSON.stringify({ state: "pending" }) })).status, 200);
        assert.deepEqual(await (await fetch(url, { headers })).json(), { state: "pending" });
        const deleted = await fetch(url, { method: "DELETE", headers });
        assert.equal(deleted.status, 200);
        assert.deepEqual(await deleted.json(), { deletedCount: 1, info: "Deleted 1 items" });
        const missing = await fetch(url, { headers });
        assert.equal(missing.status, 200, "like CommerceOS, a missing entry is not a 404");
        assert.equal(await missing.json(), null);
        const malformed = await fetch(url, { method: "PUT", headers, body: "not json" });
        assert.equal(malformed.status, 400, "a malformed body is answered, not thrown");
        assert.match((await malformed.json()).errors[0].message, /JSON/);
        const config = await (await fetch(`${cos.url}/api/v1/context/EPI1`, { headers })).json();
        assert.deepEqual(config, { "@type": "EPI configuration", identifiers: { contextConfigId: "EPI1" }, configuration: { merchantId: "M-0001", environment: "TEST" }, configurationHash: "GoX_BCsLy-8XeQboK40yk1Aw-S4W43l5zxk4l4XigA0", configurationType: "piggy configuration", schema: { "piggy configuration": { description: "Merchant account at Piggy Bank", members: { merchantId: { type: "string", title: "Merchant id" }, environment: { type: "'TEST' or 'LIVE'", title: "Environment", description: "TEST until go-live" } } } } });
        assert.deepEqual(lines.slice(0, 3), ["POST /oauth2/v1/token 200", "PUT /api/v1/context/kv/com.example.piggy/pay-1 200", "GET /api/v1/context/kv/com.example.piggy/pay-1 200"]);
    } finally {
        await cos.close();
    }
});

test("a write replaces the value, PATCH the same as PUT; PUT null deletes; the store itself lists nothing", async () => {
    const cos = await startCosStandIn();
    try {
        const headers = { authorization: await bearer(cos), "content-type": "application/json" };
        const url = `${cos.url}/api/v1/context/kv/com.example.piggy/pay-2`;
        const write = (method, value) => fetch(url, { method, headers, body: JSON.stringify(value) }).then(r => r.json());
        assert.deepEqual(await write("PUT", { sessionId: "PB-1", state: "waiting" }), { sessionId: "PB-1", state: "waiting" }, "the body is echoed");
        assert.deepEqual(await write("PATCH", { state: "settled" }), { state: "settled" }, "PATCH echoes too");
        assert.deepEqual(await (await fetch(url, { headers })).json(), { state: "settled" }, "replaced, not merged: sessionId is gone");
        assert.equal(await write("PUT", null), null);
        assert.equal(await (await fetch(url, { headers })).json(), null, "a null write is a delete");
        assert.deepEqual(await (await fetch(`${cos.url}/api/v1/context/kv/com.example.piggy`, { headers })).json(), {}, "a store never lists its keys");
    } finally {
        await cos.close();
    }
});

test("PATCH /api/v1/payment-orders derives Debited from the records and ignores a duplicate", async () => {
    const cos = await startCosStandIn();
    try {
        const headers = { authorization: await bearer(cos), "content-type": "application/json" };
        const record = id => ({
            identifiers: { transactionId: { method: { identifiers: { methodId: "com.example.piggy" } }, id } },
            currency: { identifiers: { currencyCode: "SEK" } }, timestamp: "2026-01-01T00:00:00Z", amount: "10.04",
            actions: ["Authorize", "Debit"], token: "tok-10.04", specification: [],
        });
        const patch = records => fetch(`${cos.url}/api/v1/payment-orders/pay-1`, { method: "PATCH", headers, body: JSON.stringify({ records }) });
        const first = await (await patch([record("T-1")])).json();
        assert.deepEqual(first.status, ["Debited"]);
        assert.equal(first.records.length, 1);
        const second = await (await patch([record("T-1")])).json();
        assert.equal(second.records.length, 1, "the same transaction id is not a second record");
        const refund = await (await patch([{ ...record("T-2"), actions: ["Credit"] }])).json();
        assert.deepEqual(refund.status, ["Debited", "Credited"]);
    } finally {
        await cos.close();
    }
});

test("orderStatus follows the action table", () => {
    assert.deepEqual(orderStatus([{ actions: ["Authorize"] }]), ["Authorized"]);
    assert.deepEqual(orderStatus([{ actions: ["Authorize", "Debit"] }]), ["Debited"]);
    assert.deepEqual(orderStatus([{ actions: ["Authorize"] }, { actions: ["Annul"] }]), ["Authorized", "Annulled"]);
    assert.deepEqual(orderStatus([]), []);
});
