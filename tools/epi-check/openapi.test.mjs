import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDocument, render, toYaml, OUTPUT_PATH } from "./openapi.mjs";

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

test("generation is deterministic and the file on disk is current", () => {
    assert.equal(render(), render());
    assert.equal(readFileSync(OUTPUT_PATH, "utf8"), render(), "run node tools/epi-check/openapi.mjs");
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
    const schema = JSON.parse(readFileSync(join(here, "contract", "dto.schema.json"), "utf8"));
    assert.deepEqual(Object.keys(document.components.schemas), Object.keys(schema.$defs));
    assert.equal(JSON.stringify(document).includes("#/$defs/"), false, "every $defs reference is rewritten");
});

test("the YAML on disk loads back to the same document and every $ref resolves", () => {
    const loaded = loadYaml(readFileSync(OUTPUT_PATH, "utf8"));
    assert.deepEqual(loaded, buildDocument());
    assert.deepEqual(unresolvedRefs(loaded), []);
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
    const lint = spawnSync("npx", ["--no-install", "@redocly/cli", "lint", OUTPUT_PATH], { encoding: "utf8" });
    assert.equal(lint.status, 0, lint.stdout + lint.stderr);
});
