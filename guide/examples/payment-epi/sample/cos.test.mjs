import { test } from "node:test";
import assert from "node:assert/strict";
import { startCosStandIn, orderStatus } from "./cos.mjs";

const token = async (cos, clientId = "play", clientSecret = "play-secret") => {
    const form = new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret, scope: "kv" });
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
        assert.equal((await fetch(`${cos.url}/api/v1/context/config/EPI1`)).status, 401, "no bearer, no answer");
    } finally {
        await cos.close();
    }
});

test("the key-value store round-trips a value and the configuration answers the context id", async () => {
    const lines = [];
    const cos = await startCosStandIn({ log: line => lines.push(line) });
    try {
        const headers = { authorization: await bearer(cos), "content-type": "application/json" };
        const url = `${cos.url}/api/v1/kv/com.example.piggy/pay-1`;
        assert.equal((await fetch(url, { method: "PUT", headers, body: JSON.stringify({ state: "pending" }) })).status, 200);
        assert.deepEqual(await (await fetch(url, { headers })).json(), { state: "pending" });
        assert.equal((await fetch(url, { method: "DELETE", headers })).status, 200);
        assert.equal((await fetch(url, { headers })).status, 404);
        const config = await (await fetch(`${cos.url}/api/v1/context/config/EPI1`, { headers })).json();
        assert.deepEqual(config, { configuration: { merchantId: "M-0001", mode: "TEST" }, configurationHash: "cos-sim-1" });
        assert.deepEqual(lines.slice(0, 3), ["POST /oauth2/v1/token 200", "PUT /api/v1/kv/com.example.piggy/pay-1 200", "GET /api/v1/kv/com.example.piggy/pay-1 200"]);
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
