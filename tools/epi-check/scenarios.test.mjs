import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DRIVER_CALLS } from "./driver.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const scenariosDir = join(here, "..", "..", "guide", "examples", "payment-epi", "scenarios");
const schema = JSON.parse(readFileSync(join(here, "contract", "dto.schema.json"), "utf8"));
const files = readdirSync(scenariosDir).filter(name => /^[A-Z]\d+\.json$/.test(name)).sort();
const expected = ["E1", "H1", "L1", "L2", "L3", "L4", "L5", "P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9"];

function* steps(scenario) {
    for (const step of scenario.steps) {
        yield step;
        for (const nested of Object.values(step.react ?? {})) yield nested;
    }
}

test("every scenario file and the fixtures parse", () => {
    assert.deepEqual(files.map(name => name.replace(".json", "")), expected);
    JSON.parse(readFileSync(join(scenariosDir, "fixtures.json"), "utf8"));
    for (const file of files) {
        const scenario = JSON.parse(readFileSync(join(scenariosDir, file), "utf8"));
        assert.equal(scenario.id + ".json", file);
        assert.equal(typeof scenario.title, "string");
        assert.ok(Array.isArray(scenario.steps) && scenario.steps.length > 0, file);
    }
});

test("every schema name exists in dto.schema.json and every call exists on the driver", () => {
    for (const file of files) {
        const scenario = JSON.parse(readFileSync(join(scenariosDir, file), "utf8"));
        for (const step of steps(scenario)) {
            assert.ok(DRIVER_CALLS.includes(step.call), `${file}: unknown call ${step.call}`);
            if (step.expect?.schema !== undefined) assert.ok(step.expect.schema in schema.$defs, `${file}: unknown schema ${step.expect.schema}`);
        }
    }
});

test("the amounts follow the plan's scenario table", () => {
    const amounts = Object.fromEntries(files.map(file => {
        const scenario = JSON.parse(readFileSync(join(scenariosDir, file), "utf8"));
        return [scenario.id, scenario.amount];
    }));
    assert.deepEqual(amounts, {
        L1: undefined, L2: undefined, L3: undefined, L4: undefined, L5: undefined, H1: undefined,
        P1: "100.00", P2: "100.05", P3: "100.05", P4: "100.00", P5: "50.00", P6: "100.01", P7: "100.03", P8: "100.02", P9: "100.04", E1: "100.00",
    });
    const h1 = JSON.parse(readFileSync(join(scenariosDir, "H1.json"), "utf8"));
    assert.equal(h1.referenceOnly, true);
    const p5 = JSON.parse(readFileSync(join(scenariosDir, "P5.json"), "utf8"));
    assert.equal(p5.steps[0].args.direction, "Payout");
});

test("every JSON example in the reference that names a fixture equals that fixture", () => {
    const reference = readFileSync(join(scenariosDir, "..", "reference.md"), "utf8");
    const pattern = /<!-- fixture: (scenarios\/[^ #]+)(?:#(\/[^ ]+))? -->\n```json\n([\s\S]*?)```/g;
    let count = 0;
    for (const [, file, pointer, body] of reference.matchAll(pattern)) {
        let node = JSON.parse(readFileSync(join(scenariosDir, "..", file), "utf8"));
        for (const part of (pointer ?? "").split("/").filter(Boolean)) node = Array.isArray(node) ? node[Number(part)] : node[part];
        assert.deepEqual(JSON.parse(body), node, `${file}${pointer ?? ""} drifted from the reference`);
        count++;
    }
    assert.ok(count >= 5, `found ${count} fixture examples`);
});
