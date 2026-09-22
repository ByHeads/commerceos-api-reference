import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDocument, buildCosDocument, render, renderAll, toYaml, OUTPUT_PATH, OUTPUT_PATHS } from "./openapi.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "openapi.mjs");
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });

/**
 * Loads the YAML subset that openapi.mjs writes: block mappings, block sequences, double-quoted
 * strings, numbers, booleans, null, `[]` and `{}`. No JSON.parse: the quoted scalars are decoded here.
 */
export function loadYaml(text) {
    const lines = text.split("\n").filter(line => line.trim() !== "" && !line.trimStart().startsWith("#")).map(line => ({ indent: line.length - line.trimStart().length, text: line.trim() }));
    let index = 0;
    const unquote = raw => raw.slice(1, -1).replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, code) => code[0] === "u" ? String.fromCharCode(parseInt(code.slice(1), 16)) : ({ n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" })[code] ?? code);
    const scalar = raw => {
        if (raw.startsWith('"')) return unquote(raw);
        if (raw === "[]") return [];
        if (raw === "{}") return {};
        if (raw === "true" || raw === "false") return raw === "true";
        if (raw === "null") return null;
        if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
        throw new Error(`Unknown scalar ${raw}`);
    };
    const splitKey = text => {
        const match = /^("(?:[^"\\]|\\.)*"|[A-Za-z_][A-Za-z0-9_.-]*):(?: (.*))?$/.exec(text);
        if (!match) throw new Error(`Not a mapping line: ${text}`);
        return [match[1].startsWith('"') ? unquote(match[1]) : match[1], match[2]];
    };
    function block(indent) {
        if (lines[index].text.startsWith("- ")) {
            const items = [];
            while (index < lines.length && lines[index].indent === indent && lines[index].text.startsWith("- ")) {
                const rest = lines[index].text.slice(2);
                if (rest.includes(": ") || rest.endsWith(":")) {
                    lines[index] = { indent: indent + 2, text: rest };
                    items.push(block(indent + 2));
                } else {
                    index++;
                    items.push(scalar(rest));
                }
            }
            return items;
        }
        const object = {};
        while (index < lines.length && lines[index].indent === indent && !lines[index].text.startsWith("- ")) {
            const [name, rest] = splitKey(lines[index].text);
            index++;
            object[name] = rest !== undefined ? scalar(rest) : block(lines[index].indent);
        }
        return object;
    }
    return block(0);
}

/** Every `$ref` in `value` points at an existing entry of `document`. Returns the unresolved ones. */
export function unresolvedRefs(document, value = document, found = []) {
    if (Array.isArray(value)) value.forEach(item => unresolvedRefs(document, item, found));
    else if (value && typeof value === "object") {
        for (const [key, item] of Object.entries(value)) {
            if (key === "$ref") {
                const target = item.replace(/^#\//, "").split("/").reduce((node, part) => node?.[part], document);
                if (target === undefined) found.push(item);
            } else unresolvedRefs(document, item, found);
        }
    }
    return found;
}

test("generation is deterministic and both files on disk are current", () => {
    assert.deepEqual(renderAll(), renderAll());
    assert.equal(render(), renderAll().epi);
    for (const [name, path] of Object.entries(OUTPUT_PATHS)) assert.equal(readFileSync(path, "utf8"), renderAll()[name], `${path}: run node tools/epi-check/openapi.mjs`);
});

test("the document lists the ten routes, three context parameters on every contextful route, and every DTO", () => {
    const document = buildDocument();
    const routes = Object.entries(document.paths).flatMap(([path, methods]) => Object.keys(methods).map(method => `${method.toUpperCase()} ${path}`));
    assert.deepEqual(routes, [
        "POST /install", "POST /uninstall", "GET /config-schema", "POST /test", "GET /methods", "GET /terminals",
        "GET /terminals/{terminalId}", "PUT /payments/{paymentKey}", "POST /payments/{paymentKey}/transactions", "POST /payments/{cancellationToken}/cancel",
    ]);
    const contextful = routes.slice(3);
    for (const route of contextful) {
        const [method, path] = route.split(" ");
        const refs = document.paths[path][method.toLowerCase()].parameters.filter(p => p.$ref).map(p => p.$ref);
        assert.deepEqual(refs, ["#/components/parameters/ConfigId", "#/components/parameters/ConfigHash", "#/components/parameters/DebugInfo"], route);
    }
    assert.equal(document.paths["/install"].post.parameters, undefined, "a bare route carries no context parameters");
    const stream = document.paths["/payments/{paymentKey}"].put;
    assert.equal(Object.keys(stream.responses["200"].content)[0], "text/event-stream");
    for (const step of ["Create", "Cancellable", "Wait", "ShowImage", "VisitPage", "RenderView", "Complete", "Decline", "Cancel", "Fail"]) assert.match(stream.description, new RegExp(`\\b${step}\\b`));
    assert.equal(stream.responses["200"].content["text/event-stream"].schema.$ref, "#/components/schemas/PaymentStep");
    assert.equal(document.paths["/config-schema"].get.responses["200"].content["application/json"].schema.$ref, "#/components/schemas/ConfigSchema");
    for (const [path, methods] of Object.entries(document.paths)) for (const [method, operation] of Object.entries(methods)) {
        assert.ok(operation.description?.length > 40, `${method} ${path} says when CommerceOS calls it`);
        assert.equal(operation.tags.length, 1, `${method} ${path} has one tag`);
    }
    const schema = JSON.parse(readFileSync(join(here, "contract", "dto.schema.json"), "utf8"));
    const cos = buildCosDocument();
    const inEpi = Object.keys(document.components.schemas), inCos = Object.keys(cos.components.schemas);
    assert.deepEqual(new Set([...inEpi, ...inCos]), new Set(Object.keys(schema.$defs)), "every definition is in at least one document");
    assert.ok(inEpi.includes("ConfigSchema") && !inEpi.includes("PaymentOrderPatch"), "the EPI document carries the routes it serves");
    assert.ok(inCos.includes("PaymentOrderPatch") && inCos.includes("TokenResponse") && !inCos.includes("PaymentInitDto"), "the CommerceOS document carries the calls back");
    for (const doc of [document, cos]) assert.equal(JSON.stringify(doc).includes("#/$defs/"), false, "every $defs reference is rewritten");
});

test("every schema and every property carries a description, so the documents explain themselves", () => {
    const schema = JSON.parse(readFileSync(join(here, "contract", "dto.schema.json"), "utf8"));
    const missing = [];
    const walk = (node, path) => {
        for (const [name, property] of Object.entries(node.properties ?? {})) {
            if (!property.description && !property.$ref) missing.push(`${path}.${name}`);
            walk(property, `${path}.${name}`);
        }
    };
    for (const [name, definition] of Object.entries(schema.$defs)) {
        if (!definition.description) missing.push(name);
        walk(definition, name);
    }
    assert.deepEqual(missing, []);
});

test("the CommerceOS document: one scope per operation, the token route on its own server, form body for the token", () => {
    const cos = buildCosDocument();
    const token = cos.paths["/oauth2/v1/token"].post;
    assert.deepEqual(token.security, []);
    assert.ok(token.requestBody.content["application/x-www-form-urlencoded"]);
    assert.equal(token.servers[0].url, "{oauth2Origin}");
    const scopes = Object.keys(cos.components.securitySchemes.oauth2.flows.clientCredentials.scopes);
    for (const [path, methods] of Object.entries(cos.paths)) for (const [method, operation] of Object.entries(methods)) {
        if (path === "/oauth2/v1/token") continue;
        assert.equal(operation.security.length, 1, `${method} ${path}`);
        const [scope] = operation.security[0].oauth2;
        assert.ok(scopes.includes(scope), `${method} ${path} needs a declared scope, got ${scope}`);
    }
    assert.equal(cos.paths["/v1/context/config/{configId}"].get.security[0].oauth2[0], "me");
    assert.equal(cos.paths["/v1/payment-orders/{paymentKey}"].patch.security[0].oauth2[0], "orders.payments:write");
    assert.equal(JSON.stringify(cos).includes('"epi"'), false, "no scope named epi exists in CommerceOS");
});

test("the YAML on disk loads back to the same documents and every $ref resolves", () => {
    const loaded = loadYaml(readFileSync(OUTPUT_PATH, "utf8"));
    assert.deepEqual(loaded, buildDocument());
    assert.deepEqual(unresolvedRefs(loaded), []);
    const cos = loadYaml(readFileSync(OUTPUT_PATHS.cos, "utf8"));
    assert.deepEqual(cos, buildCosDocument());
    assert.deepEqual(unresolvedRefs(cos), []);
    assert.deepEqual(unresolvedRefs({ a: { $ref: "#/b/c" } }), ["#/b/c"], "the check itself sees a dangling reference");
});

test("the YAML writer round-trips scalars, empty containers and quoted keys", () => {
    const value = { "$ref": "x", plain: "text", n: 1.5, yes: true, nothing: null, empty: [], none: {}, list: ["a", { k: "v", m: [1, 2] }, []], pattern: "^-?\\d+$", quote: 'say "hi"\n' };
    assert.deepEqual(loadYaml(toYaml(value)), value);
});

test("--check passes on a fresh file and fails after an edit", () => {
    const original = readFileSync(OUTPUT_PATH, "utf8");
    try {
        assert.equal(run("--check").status, 0);
        writeFileSync(OUTPUT_PATH, original + "extra: true\n");
        const edited = run("--check");
        assert.equal(edited.status, 1);
        assert.match(edited.stderr, /differs/);
    } finally {
        writeFileSync(OUTPUT_PATH, original);
    }
});

test("redocly lint, when the CLI is installed", { skip: spawnSync("npx", ["--no-install", "@redocly/cli", "--version"], { encoding: "utf8" }).status !== 0 && "@redocly/cli is not installed" }, () => {
    const lint = spawnSync("npx", ["--no-install", "@redocly/cli", "lint", ...Object.values(OUTPUT_PATHS)], { encoding: "utf8" });
    assert.equal(lint.status, 0, lint.stdout + lint.stderr);
});
