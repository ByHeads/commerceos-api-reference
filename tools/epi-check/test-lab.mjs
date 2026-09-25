// Test helper, not runtime code: a reference server installed on the stand-in CommerceOS (cos-stub.mjs).
import { startReferenceServer } from "./reference-server.mjs";
import { startCosStub, install, CLIENT } from "./cos-stub.mjs";
import { CANCELLABLE_ALONE, NOT_CAPTURED_UNDER_FLAG } from "./run.mjs";

/**
 * The self-test set-up: a reference server (with `defect` switched on, if any), installed on a stand-in
 * CommerceOS that lists it as `Reference` on node `Shade AB`. `integration` overrides the record, `stub`
 * the stand-in's other options, `client` the client the reference server is installed with (a wrong one
 * makes its `/test` answer false). Returns `{ cos, key, integration, stub, server, close }`.
 */
export async function startLab({ defect, now, integration = {}, stub: stubOptions = {}, client = CLIENT } = {}) {
    const server = await startReferenceServer({ ...(now ? { now: () => new Date(now) } : {}), defect });
    const stub = await startCosStub({ ...stubOptions, integrations: { Reference: { baseUrl: server.url, ...integration }, ...(stubOptions.integrations ?? {}) } });
    await install(server.url, stub.url, client);
    return {
        cos: stub.url, key: stub.key, integration: "Reference", stub, server,
        close: async () => { await stub.close(); await server.close(); },
    };
}

/** Per reference defect, the messages its scenario's failures must contain; the processorsId one names the run id. */
export function defectMessages(RUN_ID) {
    return {
        "no-final-step": [/the stream ended without a final step/],
        "two-final-steps": [/exactly one final step, and it is the last event/],
        "no-space-after-colon": [/one space after "data:"/],
        "processorsId-reused": [new RegExp(`processorsId proc-pay-${RUN_ID}-P1 was already used by P1: CommerceOS refuses a reused processorsId`)],
        "resume-new-transaction": [/expected the same transactionIds .*a resume answers the same transactions, never a second charge/],
        "cancel-refuses": [/expected 2xx, got 409/],
        "credit-refuses": [/expected 200, got 500/],
        "credit-deduplicated": [/a second identical Credit answered the first refund again/],
        "cancellable-without-wait": [new RegExp(CANCELLABLE_ALONE)],
        "authorize-only-under-flag": [new RegExp(NOT_CAPTURED_UNDER_FLAG), /expected \[Authorize, Debit\], got \[Authorize\]/],
    };
}
