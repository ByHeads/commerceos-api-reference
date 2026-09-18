// A JSON Schema validator for the subset that contract/dto.schema.json uses:
// type, required, properties, additionalProperties, items, enum, const, pattern, oneOf,
// and $ref to #/$defs/<name>. It returns a list of { path, message }, empty when the value fits.

function typeOf(value) {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value;
}

function hasType(value, type) {
    if (type === "integer") return Number.isInteger(value);
    if (type === "number") return typeof value === "number" && Number.isFinite(value);
    return typeOf(value) === type;
}

function joinPath(path, key) {
    if (typeof key === "number") return `${path}[${key}]`;
    return path ? `${path}.${key}` : key;
}

function describe(value) {
    const text = JSON.stringify(value);
    return text === undefined ? String(value) : text.length > 60 ? text.slice(0, 57) + "..." : text;
}

function resolveRef(schemaDoc, ref) {
    const match = /^#\/\$defs\/([^/]+)$/.exec(ref);
    if (!match) throw new Error(`Unsupported $ref: ${ref}`);
    const definition = schemaDoc.$defs?.[match[1]];
    if (!definition) throw new Error(`Unknown definition: ${match[1]}`);
    return definition;
}

function check(schemaDoc, schema, value, path, errors) {
    if (schema === true) return;
    if (schema === false) { errors.push({ path, message: "no value is allowed here" }); return; }
    if (schema.$ref) { check(schemaDoc, resolveRef(schemaDoc, schema.$ref), value, path, errors); return; }

    if (schema.oneOf) {
        const attempts = schema.oneOf.map(alternative => {
            const own = [];
            check(schemaDoc, alternative, value, path, own);
            return own;
        });
        const matching = attempts.filter(own => own.length === 0).length;
        if (matching === 1) return;
        if (matching > 1) { errors.push({ path, message: `matches ${matching} of ${schema.oneOf.length} oneOf alternatives, expected exactly one` }); return; }
        // Nothing matched: the alternative with the fewest errors is the closest, so its errors
        // are reported, with their own paths, and the alternatives named once.
        const closest = attempts.reduce((best, own) => own.length < best.length ? own : best);
        const names = schema.oneOf.map(alternative => alternative.$ref?.replace("#/$defs/", "") ?? "inline").join(", ");
        for (const error of closest) {
            errors.push(error.message.includes("closest of oneOf") ? error : { path: error.path, message: `${error.message} (closest of oneOf [${names}])` });
        }
        return;
    }

    if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)) {
        errors.push({ path, message: `expected the constant ${describe(schema.const)}, got ${describe(value)}` });
        return;
    }
    if (schema.enum && !schema.enum.some(allowed => JSON.stringify(allowed) === JSON.stringify(value))) {
        errors.push({ path, message: `expected one of ${schema.enum.map(describe).join(", ")}, got ${describe(value)}` });
        return;
    }
    if (schema.type) {
        const types = Array.isArray(schema.type) ? schema.type : [schema.type];
        if (!types.some(type => hasType(value, type))) {
            errors.push({ path, message: `expected ${types.join(" or ")}, got ${typeOf(value)} ${describe(value)}` });
            return;
        }
    }
    if (schema.pattern && typeof value === "string" && !new RegExp(schema.pattern).test(value)) {
        errors.push({ path, message: `${describe(value)} does not match /${schema.pattern}/` });
    }
    if (typeOf(value) === "object") {
        for (const name of schema.required ?? []) {
            if (!(name in value)) errors.push({ path: joinPath(path, name), message: "required property is missing" });
        }
        for (const [name, property] of Object.entries(schema.properties ?? {})) {
            if (name in value) check(schemaDoc, property, value[name], joinPath(path, name), errors);
        }
        if (schema.additionalProperties !== undefined) {
            for (const name of Object.keys(value)) {
                if (name in (schema.properties ?? {})) continue;
                if (schema.additionalProperties === false) errors.push({ path: joinPath(path, name), message: "additional property is not allowed" });
                else if (schema.additionalProperties !== true) check(schemaDoc, schema.additionalProperties, value[name], joinPath(path, name), errors);
            }
        }
    }
    if (Array.isArray(value) && schema.items !== undefined) {
        value.forEach((item, index) => check(schemaDoc, schema.items, item, joinPath(path, index), errors));
    }
}

/** Validates `value` against `$defs/<defName>` of `schemaDoc`. Returns `[{ path, message }]`, empty on success. */
export function validate(schemaDoc, defName, value) {
    const definition = schemaDoc.$defs?.[defName];
    if (!definition) throw new Error(`Unknown definition: ${defName}`);
    const errors = [];
    check(schemaDoc, definition, value, "", errors);
    return errors;
}
