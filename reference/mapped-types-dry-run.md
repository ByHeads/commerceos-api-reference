# Mapped Types — Dry-Run Endpoint

`POST /v1/mapped-types/dry-run` executes a mapped type body against an inline input document and returns the resolved output, without touching the tenant database, calling out to any other resources, or producing any side effects. It is the same resolver that runs inside a sync webhook — same operators, same primitives, same evaluation semantics — exposed as a stateless RPC so integrators can iterate on mappings end-to-end before installing them.

Read [Mapped Types](mapped-types.md) first if you haven't yet — this page assumes you already know what a mapped type body looks like.

---

## When to Use It

There are three ways to validate a mapped type today; pick the one that matches what you're trying to learn:

| Tool | What it runs | Network / auth | Fidelity | Use it for |
|---|---|---|---|---|
| `mini-resolver` (`cos-integration-tools/mini-resolver.mjs`) | A dependency-free reimplementation of part of the resolver | None — offline | **Partial.** Several production operators (brace interpolation `/+={path}`, decimal arithmetic, printf `/%2503d`, `~renderTemplate`, wildcard `*` segments, deep `$prior` chains, ...) are silent no-ops. Mappings that pass mini regularly behave differently in production. | In-editor / CI loops with no network. Quick syntax checks. |
| `POST /v1/mapped-types/dry-run` | The **production** resolver | Network + `integrations` scope, no tenant data | **Full.** Every production operator works the same way as in a real webhook send. No side effects, no DB reads. | Iterating on a new mapping; verifying an output shape; reproducing a webhook-side defect. |
| Install + push from a sync webhook to a real target | The production resolver and the production delivery path | Network + `integrations` scope, on a real tenant | **Exact.** Includes side effects (audit log, schedule churn, downstream system writes). | Pre-flight before shipping to a production tenant. |

The dry-run endpoint is the in-between option: production-fidelity, stateless, no footprint. Mini stays useful for offline / no-network iteration; the live-tenant push stays useful when you need to verify the side-effecting delivery path end-to-end.

---

## Endpoint, Method, Authentication

```
POST /v1/mapped-types/dry-run
Content-Type: application/json
Authorization: Bearer <token>
```

- **Scope:** `integrations` — the same scope used to install mapped types and sync webhooks.
- **Tenant:** the endpoint is stateless. The token's tenant is irrelevant to the result; two identical requests from any two tenants produce byte-identical responses.
- **Idempotent:** repeating the same request always produces the same output. No DB writes, no audit log, no scheduling.

> `PATCH /v1/mapped-types/dry-run` is also accepted (Pillow's method-dispatch parity treats `PATCH` and `POST` identically here). Use `POST` for clarity.

---

## Request Body

Two required fields and six optional fields. Every field is documented end-to-end below.

```jsonc
{
  "mapping":          { /* required, object */ },
  "input":            <required, any JSON>,
  "siblingMappings":  { /* optional, object */ },
  "stubs":            { /* optional, object */ },
  "variables":        { /* optional, object */ },
  "outputType":       "<optional, string>",
  "trace":            false,
  "templates":        { /* reserved for v2 — see below */ }
}
```

### `mapping` — required, JSON object

The mapped type body to execute. Same JSON shape as the `body` field of an installed mapped type.

```json
{
  "lineNo": "$index/+=1/%2503d",
  "name":   "name",
  "lines":  "items~map(com.example.line-item)"
}
```

### `input` — required, any JSON value

The source document the mapping is applied to. May be a JSON **object**, **array**, or **scalar** — there is no shape requirement.

- For a single source document, pass a JSON object.
- For an array of source documents, pass a JSON array. The resolver wraps it as a collection and the mapping runs per element (the same way `~map(thisMappingType)` would behave inside a webhook).
- Scalars (strings, numbers, booleans) are accepted for testing literal-only mappings.

### `siblingMappings` — optional, object keyed by mapped-type name

Additional mapped type bodies available to `~map(<name>)` invocations in `mapping`. The endpoint never falls back to the installed mapped-type table — any `~map(<name>)` reference whose `<name>` does not appear here returns a 400.

```json
{
  "com.example.line-item": { "id": "$index", "label": "name" }
}
```

Direct self-recursion is allowed: a mapping named `A` may include itself in `siblingMappings.A` to support recursive `~map(A)` patterns. Indirect cycles (`A → B → A`) are detected pre-flight and rejected with a 400 listing the cycle path.

### `stubs` — optional, object keyed by URL path

Stubs for cross-fetch references the mapping makes via `api/v1/...`. Keys are the URL paths (with or without a leading `/`); values are the JSON the resolver should pretend was returned. The endpoint **never** reaches out to the network — even to other resources within the same API. Any unstubbed `api/v1/...` reference returns a 400.

```json
{
  "api/v1/now":  "2026-05-17T10:00:00Z",
  "api/v1/uuid": "00112233-4455-6677-8899-aabbccddeeff"
}
```

Stub keys may include or omit the leading `/` — both `api/v1/now` and `/api/v1/now` resolve to the same stub. Use the no-slash form: that's what the pre-walk captures and what error messages reference.

Stubs that are not referenced by the mapping are silently ignored — there's no penalty for over-stubbing.

### `variables` — optional, object keyed by variable name

Resolver variables that the mapping references via `$<name>`.

```json
{
  "tenantCode": "demo",
  "currency":   "EUR"
}
```

> **Important: keys are bare names, no `$` prefix.** Write `"tenantCode": "demo"`, then reference it from the mapping as `"$tenantCode"`. The endpoint normalises bare-name keys to `$`-prefixed keys for resolver lookup.

Values are arbitrary JSON and are wrapped the same way `input` is wrapped.

### `outputType` — optional, string

A COS API type name (`agent`, `trade-order`, `product`, `discount-coupon`, ...). When supplied, the resolved output is validated against the named type using the same coercion path Pillow runs on inbound writes. The response gains a `validation` object enumerating any errors and warnings.

- A type name the schema doesn't recognise produces a 400 (`Unknown outputType ...`). The error message hints at known types.
- A valid type name with a structurally-wrong output **does not** produce a 400. The response is still 200 with a non-empty `validation.errors[]` array. This mirrors how inbound writes surface coercion failures.
- Unknown keys in the resolved output are silently accepted, matching inbound-write semantics for types without additionals.

### `trace` — optional, boolean (default `false`)

When `true`, the response includes a per-property `trace[]` array showing how each top-level mapping key was resolved (operator chain, intermediate values, final value).

Trace size grows linearly with the resolver's step count. Use it on small mappings while debugging — leaving it on by default makes responses large and slow. Trace entries are emitted in mapping key order.

### `templates` — reserved for v2

This field is reserved for a future template-injection feature.

- Any `~renderTemplate(<name>)` reference in `mapping` returns a 400 in v1, **regardless of whether `templates` includes that name**. The fix is to resolve the rendered string upstream and pass it inline through `input` (or as a stub) instead.
- If the mapping has no `~renderTemplate` references, the `templates` field is silently ignored — you can keep it in your request payloads without changing behaviour.

---

## Response Body

### 200 OK

```jsonc
{
  "resolved": {
    "lineNo": "001",
    "name":   "Coffee",
    "lines":  [
      { "id": 0, "label": "Coffee" },
      { "id": 1, "label": "Bun" }
    ]
  },

  // Present iff `outputType` was provided.
  "validation": {
    "errors":   [],
    "warnings": []
  },

  // Present iff `trace: true` was in the request.
  "trace": [
    {
      "key":   "lineNo",
      "path":  "$index/+=1/%2503d",
      "steps": [
        { "op": "$index",   "result": 0 },
        { "op": "/+=1",     "result": 1 },
        { "op": "/%2503d",  "result": "001" }
      ]
    },
    { "key": "name", "path": "name", "steps": [ { "op": "/name", "result": "Coffee" } ] }
  ]
}
```

| Field | When present | Description |
|---|---|---|
| `resolved` | Always | The mapped output, exactly as the resolver produced it. Verbatim — not coerced even when `outputType` validation runs. |
| `validation` | When `outputType` was in the request | `{ errors: [], warnings: [] }`. Each `errors[]` entry has a `path` (the JSON path inside `resolved`) and an `error` string. A non-empty `errors` array does **not** make the response a 4xx — the response is still 200. |
| `trace` | When `trace: true` was in the request | One entry per top-level mapping key (in mapping order), skipping directive keys (`#nullability`) and `'@type'` markers. Each entry has the `key`, the original `path` from the mapping, and a `steps[]` array of `{ op, result }`. Pure-literal selectors (`'fixed'`) have an empty `steps` array — the key was visited but no path navigation happened. |

### 400 Bad Request

Returned for any input-side defect the caller can fix. See [Errors](#errors) below for the table of causes and exact messages.

### 500 Internal Server Error

Returned only for genuine resolver bugs. Integrators should never need to handle 500 as a normal case; surface it to the API team.

---

## Operator Support

Every operator that works inside a real webhook send works the same way here. See the [operators reference](operators.md) and [operators catalog](operators-catalog.md) for the full list. The two exceptions are:

- **`~renderTemplate(<name>)`** — always returns a 400 in v1. The fix is to resolve the rendered string upstream (in the client code that builds the request) and pass it inline via `input` or `stubs`. Full template injection is reserved for v2.
- **`api/v1/...` cross-fetches** — must be stubbed via `stubs`. The endpoint never reaches the network, even to itself. Any unstubbed `api/v1/...` reference returns a 400.

All other operators — including the ones mini-resolver only partially implements (brace interpolation `/+={path}`, decimal arithmetic, printf `/%2503d`, wildcard `*` segments, `$prior/$prior` chains, ternary, null-coalescing, concatenation, variables) — behave identically to a webhook send.

---

## Sibling Mappings and Cycle Detection

When a mapping uses `~map(<name>)`, the named mapping must be present in `siblingMappings` — there is no fallback to installed mapped types.

```jsonc
// 400: "Mapping references `~map(com.example.line-item)` but
//       `siblingMappings` does not include that name. Add it to `siblingMappings`."
{
  "mapping": { "lines": "items~map(com.example.line-item)" },
  "input":   { "items": [] }
}
```

**Self-recursion is allowed.** A mapping named `com.example.node` may include itself in `siblingMappings` and use `~map(com.example.node)` against a child collection — useful for recursive tree structures, provided the input data has a base case.

**Indirect cycles are rejected.** If `A → B → A` (or any longer chain that loops back), the endpoint detects it before resolution begins and returns a 400 with the cycle path:

```jsonc
// 400: "Cyclic sibling mapping detected: __top__ → A → B → A.
//       Remove the cycle or restructure the mappings."
{
  "mapping": { "x": "items~map(com.example.A)" },
  "input":   { "items": [] },
  "siblingMappings": {
    "com.example.A": { "y": "items~map(com.example.B)" },
    "com.example.B": { "z": "items~map(com.example.A)" }
  }
}
```

The pre-walk also enumerates references in **every** sibling body, so a missing reference deep inside a chain is reported up-front rather than at run time.

---

## Stateless Guarantees

The endpoint runs inside a read-only transaction and is forbidden from reading or writing tenant data:

- **No DB reads.** The endpoint refuses to invoke resolver paths that would read installed data (other mapped types, templates, ...). Cross-type schema navigation (operator definitions, type metadata) is allowed — that's compile-time state, not tenant state.
- **No DB writes.** The wrapping transaction is read-only; any accidental write attempt aborts.
- **No outbound HTTP.** Any `api/v1/...` reference in the mapping must be stubbed via `stubs`; the resolver never reaches the network.
- **No audit log.** No tenant writes means no audit hook fires.
- **No scheduling.** No `SyncWebHook` task is created or modified.

**Idempotency.** Two identical requests against an empty tenant and a fully-seeded tenant produce byte-identical responses. CI for this endpoint can run against an empty test DB; no fixtures needed.

---

## Errors

| Cause | Example request fragment | `details` message |
|---|---|---|
| Request body is not a JSON object | `"hello"` or `null` | `Request body must be a JSON object.` |
| Missing `mapping` | `{ "input": {} }` | `` Request body is missing required field `mapping`. `` |
| Missing `input` | `{ "mapping": { "name": "name" } }` | `` Request body is missing required field `input`. `` |
| `mapping` is not an object | `{ "mapping": "x", "input": {} }` | `` `mapping` must be a JSON object (the mapped-type body). `` |
| `siblingMappings` is not an object | `{ "siblingMappings": [] }` | `` `siblingMappings` must be a JSON object keyed by mappedTypeName. `` |
| `siblingMappings.<name>` is not an object | `{ "siblingMappings": { "x": "not an object" } }` | `` `siblingMappings.x` must be a JSON object (the mapped-type body). `` |
| `stubs` is not an object | `{ "stubs": [] }` | `` `stubs` must be a JSON object keyed by URL path. `` |
| `templates` is not an object | `{ "templates": [] }` | `` `templates` must be a JSON object keyed by template ID. `` |
| `templates.<name>` is not a string | `{ "templates": { "tpl": 42 } }` | `` `templates.tpl` must be a string (Liquid template source). `` |
| `variables` is not an object | `{ "variables": [] }` | `` `variables` must be a JSON object keyed by variable name. `` |
| `outputType` is not a string | `{ "outputType": 42 }` | `` `outputType` must be a string (a COS API type name). `` |
| `outputType` is empty | `{ "outputType": "" }` | `` `outputType` must be a non-empty string. `` |
| `trace` is not a boolean | `{ "trace": "yes" }` | `` `trace` must be a boolean. `` |
| Unterminated `~map(` in a selector | `{ "mapping": { "x": "items~map(unfinished" } }` | `` Selector contains unterminated `~map(` reference at position N: "...". `` |
| Unterminated `~renderTemplate(` | `{ "mapping": { "x": "~renderTemplate(unfinished" } }` | `` Selector contains unterminated `~renderTemplate(` reference at position N: "...". `` |
| Cyclic sibling mappings | `A → B → A` | `Cyclic sibling mapping detected: __top__ → A → B → A. Remove the cycle or restructure the mappings.` |
| Missing sibling mapping | `~map(com.example.x)` with no entry | `` Mapping references `~map(com.example.x)` but `siblingMappings` does not include that name. Add it to `siblingMappings`. `` |
| Any `~renderTemplate(...)` reference (v1) | `~renderTemplate(rcpt-se)` | `` `~renderTemplate(rcpt-se)` is not supported by the dry-run endpoint in v1. Resolve the rendered string upstream and pass it inline via `input` instead; full template injection is tracked for a future v2. `` |
| Missing stub for an `api/v1/...` reference | `api/v1/now` with no stub | `` Mapping references cross-fetch path `api/v1/now` but `stubs` does not include that path. Add it to `stubs` with the JSON value the resolver should return. `` |
| Unknown `outputType` | `"outputType": "totally-bogus"` | `` Unknown outputType `totally-bogus`. Pass a valid COS API type name (e.g. `agent`, `trade order`, `product`). `` |

500 errors are reserved for genuine resolver defects (the caller has no way to fix the request). Integrators should treat any 500 as a bug report rather than a normal failure mode.

---

## Worked Examples

The examples build progressively from a smoke test to a fully-loaded request with stubs, variables, output validation, and trace.

### Example A — Smoke test

A bare-path mapping that aliases one input field to one output field.

**Request**

```json
{
  "mapping": { "name": "name" },
  "input":   { "name": "Hello" }
}
```

**Response (200 OK)**

```json
{
  "resolved": { "name": "Hello" }
}
```

### Example B — Operators and a sibling mapping

A receipt-shaped input transformed into a row-per-line export. Uses zero-based `$index` plus printf padding (`/%2503d`) for a line number, a literal currency code, and a sibling mapping for nested items.

**Request**

```json
{
  "mapping": {
    "receiptId": "identifiers/receiptID",
    "currency":  "'SEK'",
    "lines": "items~map(com.example.line-item)"
  },
  "siblingMappings": {
    "com.example.line-item": {
      "no":    "$index/+=1/%2503d",
      "name":  "name",
      "price": "price"
    }
  },
  "input": {
    "identifiers": { "receiptID": "R-0042" },
    "items": [
      { "name": "Coffee", "price": "39.00" },
      { "name": "Bun",    "price": "25.00" }
    ]
  }
}
```

**Response (200 OK)**

```json
{
  "resolved": {
    "receiptId": "R-0042",
    "currency":  "SEK",
    "lines": [
      { "no": "001", "name": "Coffee", "price": "39.00" },
      { "no": "002", "name": "Bun",    "price": "25.00" }
    ]
  }
}
```

### Example C — Stubs, variables, output validation, trace

A mapping that pulls the current time from `api/v1/now`, uses a `$tenantCode` variable in the output, validates against an `agent` shape, and asks for a trace.

**Request**

```json
{
  "mapping": {
    "identifiers": {
      "com.example.agentId": "id"
    },
    "name":      "displayName",
    "tenant":    "$tenantCode",
    "createdAt": "api/v1/now"
  },
  "input": {
    "id":          "ag-0001",
    "displayName": "Spring 2026 Sync"
  },
  "stubs": {
    "api/v1/now": "2026-05-26T08:30:00Z"
  },
  "variables": {
    "tenantCode": "demo-eu"
  },
  "outputType": "agent",
  "trace": true
}
```

**Response (200 OK, abbreviated)**

```jsonc
{
  "resolved": {
    "identifiers": { "com.example.agentId": "ag-0001" },
    "name":        "Spring 2026 Sync",
    "tenant":      "demo-eu",
    "createdAt":   "2026-05-26T08:30:00Z"
  },
  "validation": {
    "errors":   [],
    "warnings": []
  },
  "trace": [
    {
      "key":   "identifiers",
      "path":  "{\"com.example.agentId\":\"id\"}",
      "steps": [ /* ... per-step capture for the nested mapping ... */ ]
    },
    { "key": "name",      "path": "displayName",   "steps": [ { "op": "/displayName", "result": "Spring 2026 Sync" } ] },
    { "key": "tenant",    "path": "$tenantCode",   "steps": [ /* ... */ ] },
    { "key": "createdAt", "path": "api/v1/now",    "steps": [ /* ... */ ] }
  ]
}
```

### Example D — Missing sibling reference (error case)

A `~map(...)` reference without a matching entry in `siblingMappings` is rejected before resolution begins.

**Request**

```json
{
  "mapping": { "lines": "items~map(com.example.line-item)" },
  "input":   { "items": [] }
}
```

**Response (400 Bad Request)**

```json
{
  "@type":   "bad request",
  "error":   "Bad Request",
  "details": "Mapping references `~map(com.example.line-item)` but `siblingMappings` does not include that name. Add it to `siblingMappings`."
}
```

---

## Calling It With curl

Save the request body to a file and pipe the response through `jq`:

```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data @body.json \
  https://example.app.heads.com/api/v1/mapped-types/dry-run \
  | jq .
```

For one-off calls, use a here-doc:

```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  https://example.app.heads.com/api/v1/mapped-types/dry-run \
  --data @- <<'JSON' | jq .
{
  "mapping": { "name": "name" },
  "input":   { "name": "Hello" }
}
JSON
```

---

## See Also

- [Mapped Types](mapped-types.md) — the storage model, the selector language, and how installed mappings are looked up at run time.
- [Operators](operators.md) and [Operators Catalog](operators-catalog.md) — the full operator set the resolver supports.
- [Sync Webhooks](sync-webhooks.md) — how installed mapped types are referenced from `map` and applied during a real sync.
