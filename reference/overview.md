# CommerceOS API Overview

This document summarizes how CommerceOS API resources are structured and accessed.

---

## About the API Reference

This reference explains how to integrate with CommerceOS at a practical level. It focuses on workflows, operator syntax, and real examples.

**Audience:** Developers and AI agents building integrations with CommerceOS.

**Scope:** This reference covers HTTP usage, authentication, query operators, content negotiation, and common patterns. For endpoint schemas and model definitions specific to your deployment, use your tenant's `/api-docs`.

**Navigation ladder:**
1. **Start here** - This overview for API basics and authentication
2. **Learn operators** - [`operators.md`](operators.md) for query syntax and recipes
3. **Handle pagination** - [`pagination.md`](pagination.md) for paging patterns and performance tips
4. **See examples** - [`../guide/examples.md`](../guide/examples.md) for practical curl examples
5. **Dive deeper** - [`mapped-types.md`](mapped-types.md), [`sync-webhooks.md`](sync-webhooks.md), [`primitives.md`](primitives.md), [`receipts.md`](receipts.md), [`streaming`](../features/streaming.md), and other reference docs

**Domain Guides (Working with...):**
- [Products](working-with/products.md) — Catalog management, variants, GTIN/PLU, categories, assortments
- [Prices](working-with/prices.md) — Price creation, validity periods, seller/buyer scoping
- [VAT](working-with/vat.md) — Tax codes, rates, net/gross calculations
- [Customers](working-with/customers.md) — People, companies, stores, addresses, contact methods
- [Orders](working-with/orders.md) — Trade orders, items, instances (IMEI), discounts, payments
- [Stock](working-with/stock.md) — Stock places, transactions, adjustments, shipments

**Integration Templates:**
- [CRM Customer Sync](integration-templates/crm-customer-sync.md) — Bidirectional customer sync with CRM systems, identifier strategies, GDPR handling
- [PIM Product Sync](integration-templates/pim-product-sync.md) — Full catalog sync with PIM systems, variants, pricing, assortments
- [Orders Integration](integration-templates/orders-integration.md) — Trade order lifecycle, payments, shipments, status polling and webhooks
- [BI Receipts Analytics](integration-templates/bi-receipts-analytics.md) — Incremental receipt export for BI/analytics, returns handling, data transformation
- [Retail Implementation (ERP/BC to Heads)](integration-templates/retail-implementation.md) — End-to-end integration guide for connecting a back-office or ERP system to Heads

> **Tip:** Your tenant's `/api-docs` is authoritative for endpoints and schemas. This reference complements it with patterns and examples.

---

## Resource Groups & Examples

The API organizes resources into logical groups. Each group maps to OAuth2 scopes and has practical examples.

| Group | Description | Guide | Examples |
|-------|-------------|-------|----------|
| Organization | People, companies, and stores used across orders and inventory | [Customers guide](working-with/customers.md) | [Examples](../guide/examples/organization.md) |
| Products | Catalog items, categories, groups/families, and pricing metadata | [Products guide](working-with/products.md) | [Examples](../guide/examples/products.md) |
| Pricing | Price rules, validity periods, and currency handling | [Prices guide](working-with/prices.md), [VAT guide](working-with/vat.md) | [Examples](../guide/examples/pricing.md) |
| Orders | Trade orders, items, payments, and returns | [Orders guide](working-with/orders.md) | [Examples](../guide/examples/orders.md) |
| Inventory | Stock places, stock transactions, and adjustment reasons | [Stock guide](working-with/stock.md) | [Examples](../guide/examples/inventory.md) |
| POS | Terminals, profiles, receipts, and payment methods | [Receipts](receipts.md) | [Examples](../guide/examples/pos.md) |
| Users | User accounts, credentials, and role assignments | [Users](users.md), [Credentials](credentials.md), [Roles & Permissions](user-roles.md), [Provisioning guide](../guide/provisioning-users.md) | [Examples](../guide/examples/users.md) |
| Configuration | System settings and serial number sequences | — | [Examples](../guide/examples/configuration.md) |
| Advanced | Mapped types and sync webhooks (requires `advanced` scope) | [Sync Webhooks](sync-webhooks.md), [Mapped Types](mapped-types.md) | [Examples](../guide/examples/advanced.md) |

> **Note:** Use your tenant's `/api-docs` for the canonical endpoint list and OAuth2 scope requirements.

---

## API Basics

The CommerceOS API is a RESTful Web API using:
- **OAuth 2.0 / OpenID Connect** for authentication
- **OpenAPI 3.1** for specification
- **JSON** for data exchange (also supports NDJSON, CSV)

**Base URL**: `/api/v1`

> **Note:** Path examples throughout this document (e.g., `/products`, `/people`) are relative to the base URL. The full path would be `/api/v1/products`, `/api/v1/people`, etc.

---

## Authentication

### API Key
```bash
# Via header
curl -H "X-Api-Key: MySecretKey" example.app.heads.com/api/v1/void

# Via Basic Auth (password only)
curl -u ":MySecretKey" example.app.heads.com/api/v1/void
```

### OAuth 2.0
```bash
# Get token
curl -X POST example.app.heads.com/oauth2/v1/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=ID&client_secret=SECRET"

# Use token
curl -H "Authorization: Bearer TOKEN" example.app.heads.com/api/v1/void
```

Both an API key and an OAuth2 client are **credentials on a user** — that is what makes a request attributable to someone. Creating them, and choosing the scopes they carry, is covered in [Credentials](credentials.md); the whole provisioning flow is walked through in [Provisioning Users and Access](../guide/provisioning-users.md).

> **EPI Integration OAuth2 Requirements:** External Payment Integrations (EPI) require a confidential OAuth2 client with specific scopes for the `install` action to succeed. See [EPI Integrations & Configurations](../guide/examples/configuration.md#epi-integrations--configurations) for required scopes and setup.

---

## Resource Model and Endpoint Tree

Resources follow a nested structure that mirrors the data model. Any JSON member in a response can be navigated to by extending the URL path.

Key behaviors:
- `@type` discriminator on polymorphic types (agents, product nodes)
- External identifiers use reverse-domain keys (e.g., `com.example.id`)
- Endpoint tree follows schema structure: collections, members, sub-collections
- **Primitive values** (strings, numbers, dates) support operations directly in the URL path — see [`primitives.md`](primitives.md) for dynamic members like string slicing, arithmetic, and date math

### Path Casing Rules

- **Top-level collections**: kebab-case (e.g., `/trade-orders`, `/product-categories`)
- **Nested member paths**: camelCase (e.g., `/customerRelations`, `/childCategories`)

Example: `/agents/com.heads.seedID=store1/customerRelations` (NOT `customer-relations`)

### Utility Endpoints

A handful of endpoints are not backed by stored data — they compute a value on the spot.

| Endpoint | Returns |
|----------|---------|
| `/v1/now` | The current timestamp |
| `/v1/uuid` | A freshly generated UUID |
| `/v1/void` | A constant string, for connectivity checks |
| `/v1/new` | An ad-hoc object assembled from the selectors you supply |

See [Query Operator Examples](../guide/examples/query-operators.md#system-resources) for runnable curl versions.

#### `/v1/new` — build an object from selectors

`GET /v1/new` returns an empty object. Add `~with(...)` selectors to fill it in; each argument uses the usual `alias:selector` form, and the selector can be a [string literal](primitives.md#string-literals-as-a-starting-point), a cross-fetch into the API root, or any operator pipe.

```
GET /v1/new~with(id:'Brød & Melk'/ld,at:api/v1/now)
```
```json
{ "id": "brød-melk", "at": "2026-08-12T09:00:00.000Z" }
```

`PUT /v1/new` accepts the object template in the request body instead of the URL, and behaves the same way.

> **The response is a bare object — there is no `@type` key.** `/v1/new` assembles an ad-hoc object rather than materializing a declared type, so there is nothing meaningful to report; the generated OpenAPI schema has never declared one. If you have client code reading `@type` off a `/new` response, it will now see the key absent. Other utility endpoints are unaffected.

---

## Common Resource Families

The API is organized around resource families like Agents, Products, Orders, Inventory, Payments, Shipments, and POS. Each family has collections and sub-collections that follow the resource model and endpoint tree. Use the OpenAPI browser (your tenant's `/api-docs`) for the canonical path list, and use the patterns in this documentation for how to navigate and expand these resources safely.

### Scope Map (Concepts, Not Endpoints)

| Scope | Concepts |
|-------|----------|
| **org** | People, companies, and stores in your organization; identifiers and contact data live here. |
| **products** | Catalog items, categories, groups/families, and pricing metadata used by ordering and stock. |
| **stock** | Stock places, stock transactions, and adjustment reasons tied to products and stores. |
| **orders.sales** / **orders.payments** | Trade orders and trade order items, plus payment orders for capturing order payments. |
| **pos** | Terminals, profiles, functions, devices, printers, and currency denominations for in-store flows. |
| **prices** | Price definitions, validity windows, and currency-scoped pricing. |
| **supply-chains** | Trade relationships, delivery terms, and payment terms between agents. |
| **users** | User accounts and credentials for access and identity. `users:read` is read-only and covers users plus local, retail and Entra ID credentials; **there is no `users:write`** — every write, and everything to do with roles and permissions, needs `admin`. See [Users → Scopes](users.md#scopes). |
| **retail** | Receipts, payment methods, payment cards/means, Z/X and cash register reports, return reasons, and mobile device/plans. See [`receipts.md`](receipts.md) for BI/analytics usage. |
| **geo** | Currencies, languages, countries, and cities for localization. |
| **media** | Images and other media assets attached to products and agents. |
| **config** | System settings and serial number sequences. |
| **advanced** | Mapped types and sync webhooks for custom data transformations and integrations. See [`mapped-types.md`](mapped-types.md), [`mapped-types-dry-run.md`](mapped-types-dry-run.md), and [`sync-webhooks.md`](sync-webhooks.md). |

> **Note:** Scopes control what API clients can access. Most scopes have `:read` (GET-only) and `:write` (full access) variants. See your OAuth2 client configuration for assigned scopes.

---

## External Identifiers

Objects with `common identifiers` can hold dynamic external identifiers:

```bash
# Create person with external ID
POST /people '{"identifiers": {"com.myapp.userId": "123"}}'

# Or use PUT (creates if not exists)
PUT /people/com.myapp.userId=123 '{"givenName": "John"}'

# Access by external ID
GET /people/com.myapp.userId=123
```

**The shape of a namespaced key.** What the API recognises as a namespaced identifier key is **exactly three dot-separated segments, with no dash in the first** — `com.myapp.userId`, `com.example.sku`. A dash is fine in the second and third segments, and case is not significant to the shape. A key outside that shape is not recognised as one: `com.example.orders.id` has four segments and is ordinary reverse-domain notation, but sorting on it is a `400` reading `Invalid sort key 'identifiers/com.example.orders.id': field not found` — the shape is rejected before any identifier is looked up, so the message names the wrong cause. The sort is also the only place the shape is checked — `~where`, `~just` and `~distinctBy` take a key of any shape at `200` and pass it through without complaint — so a key that reads fine everywhere else can still fail there. See [what you can sort on](operators-catalog.md#orderbyselectordesc) for both sides of that line.

**Adding an identifier to an object you can only find by another one.** Identifiers listed alongside the payload are used to *select* the object, so they cannot at the same time be written. Put the new identifier inside a `@value` envelope instead:

```bash
PUT /people
[{
  "identifiers": {"com.myapp.userId": "123"},
  "@value": {"identifiers": {"com.myapp.crmId": "CRM-9981"}}
}]
```

The person is now reachable as both `com.myapp.userId=123` and `com.myapp.crmId=CRM-9981`; no other member changes. See [The `@value` Write Envelope](resource-patterns.md#the-value-write-envelope).

---

## Common Identifiers and Dynamic Properties

`commonIdentifiers` exposes `identifiers.key` plus all dynamic, namespaced external IDs:
- Supports namespaced keys (e.g., `com.example.id`)
- Enables lookup by external identifier

`definedProperties` exposes:
- `declared`: Static members from schema definitions
- `dynamic`: Properties with `propertyType`, `description`, `requiredOnCreate`

---

## Field Expansion

Most resources return essential fields only. Non-essential fields are accessed via:
- `~with(...)` / `~withAll`
- `fields=...` or `fields=all` query parameters

**Essential fields** (always returned):
- `identifiers` (including `key`)
- `name`
- `@type` (for polymorphic types)
- `status` (for products)
- `gtin` (for products)

**Non-essential fields** (require `~with`):
- Relations: `categories`, `prices`
- Extended properties: `hidden`, `plu`, `defaultVatCode`

```bash
# Include specific non-essential fields
GET /products/com.example.sku=ABC~with(hidden,plu,gtin)

# Include ALL fields
GET /products/com.example.sku=ABC~withAll
```

---

## Query Operators

The API supports query operators that modify responses:

```
~with(...)     include non-essential fields
~just(...)     include only specified fields
~without(...)  exclude specified fields
~withAll       include all fields
~where(...)    filter by conditions (AND)
~either(...)   filter by conditions (OR)
~orderBy(...)  sort results
~take(n)       limit result count
~skip(n)       skip first n results
```

> **Mixing Query Layers**
>
> You can combine `~` operators and query parameters in a single request. Query parameters are parsed at the `?` position and applied as a fixed block (`format → where → orderBy → fields → skip → take → simpleJust`) regardless of their order in the URL. Prefer a single style when operator ordering matters.

**Path operators (`~`):** Applied in the order they appear in the URL. Think of `~` as a pipe operator: each step consumes the output of the previous step.

**Query parameters (`?`):** Applied in a fixed internal order (not the order they appear in the URL). Use them for simple, standard filtering/sorting/paging.

See [`operators.md`](operators.md) for the full operator reference, or [`operators-catalog.md`](operators-catalog.md) for a complete catalog with detailed signatures and examples.

---

## HTTP Methods

| Method | Usage |
|--------|-------|
| `GET` | Read resources |
| `POST` | Create new resources |
| `PUT` | Create or update (upsert) |
| `PATCH` | Partial update |
| `DELETE` | Remove resources |

`PATCH` on a writable array member additionally accepts the `add`, `replace`, and `remove` operations — see [Array Write Operations](resource-patterns.md#array-write-operations).

Any write body may also wrap its payload in `@value` to separate the identifiers that select an object from the members applied to it — see [The `@value` Write Envelope](resource-patterns.md#the-value-write-envelope).

A `POST`, `PATCH` or `PUT` with an **array** body is committed in chunks of 200 items rather than as one transaction, so a failure part-way through leaves the earlier chunks written. Set `X-Transaction-Count: all` when a partial write would be worse than no write — see [Transaction chunking](../features/streaming.md#3-transaction-chunking).

---

## Content Types

### Response Formats (Accept Header)

| Accept Header | Shorthand | Use Case |
|---------------|-----------|----------|
| `application/json` | `json` | Default, buffered response |
| `application/x-ndjson` | `ndjson` | Streaming, line-delimited |
| `text/csv` | - | Tabular export |
| `text/plain` | - | A single text value, unquoted (see below) |
| `text/html` | - | A single text value in a minimal HTML document (see below) |
| `application/sql` | `sql` | SQL INSERT/UPDATE/DELETE statements (requires mapped type output) |
| `application/vnd.ms-sqlserver.csv` | - | SQL Server CSV format for bulk import (requires mapped type output) |

**`text/plain` and `text/html` serve one text value, not a document.** They apply to a request that resolves to a single text value — a member such as `/v1/products/{key}/name` — and return it with no JSON quoting, `text/html` wrapping it in a minimal HTML document. Anything else is a **406**, including a whole object, a collection, and a numeric value such as `~count`. A member the record leaves empty is a `204`. If you want a whole object or collection as text, `text/csv` is the format that takes one.

```bash
curl -u ":MySecretKey" -H "Accept: text/plain" example.app.heads.com/api/v1/products/{key}/name  # 200 → 1 kr
curl -u ":MySecretKey" -H "Accept: text/plain" example.app.heads.com/api/v1/products?limit=1     # 406
```

**Default behavior:** If no Accept header is provided or `*/*` is used, `application/json` is returned.

**Shorthand values:** The Accept header supports shorthand values like `Accept: json` or `Accept: ndjson`.

**Content-Type defaults for input:** When sending data via POST/PUT/PATCH, if no Content-Type header is provided, `application/json` is assumed.

### Request Content-Type Defaults

When sending data:
- If no Content-Type header is provided, `application/json` is assumed
- For NDJSON import, explicitly set `Content-Type: application/x-ndjson`
- NDJSON accepts trailing newlines on import
- CSV import parses header row and supports quoted values

### JSON Serializer Parameters

The JSON content type accepts parameters to control output:

```bash
# Skip null fields (enabled by default)
Accept: application/json; skipNulls=true

# Include null fields (useful with ~with to show explicitly null values)
Accept: application/json; skipNulls=false

# Strip @type annotations
Accept: application/json; skipTypes=true

# Serialize numbers as strings (for precision)
Accept: application/json; numberHandling=string

# Serialize and send the array incrementally (faster first byte)
Accept: application/json; stream=true

# Skip specific members from output
Accept: application/json; skipMembers=prices,images
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `skipNulls` | boolean | `true` | Omit null fields from output |
| `skipTypes` | boolean | `false` | Strip `@type` discriminators |
| `numberHandling` | `"string"` or `"number"` | `"number"` | Serialize numbers as strings for precision |
| `stream` | boolean | `false` | Serialize and send the collection incrementally instead of building the whole body first — see [Streaming](../features/streaming.md) |
| `skipMembers` | comma-separated | — | Member names to exclude from output |

**`skipNulls` + `~with` interaction:** When `skipNulls=true` (default), null fields are omitted. However, if a field is explicitly requested via `~with()`, a null value is included to indicate the field exists but is empty.

### Accept Parameter Tolerance

Every content type that serializes a collection — `application/json`, `application/x-ndjson`, `text/csv`, `application/sql`, `application/vnd.ms-sqlserver.csv` — accepts parameters it does not recognize and ignores them. A standards-compliant header is safe to send:

```bash
Accept: text/csv;charset=utf-8          # charset ignored, rows returned
Accept: application/json;q=0.9          # q ignored, array returned
Accept: text/csv;delimiter=|;charset=utf-8   # delimiter honored, charset ignored
```

A misspelled parameter **name** falls into the same bucket: it is ignored, silently, so `;strem=true` is a perfectly successful buffered response and nothing reports the typo.

> **An invalid *value* on a parameter the format does recognize empties the response.** The whole parameter set fails to apply, the serializer ends up with nothing to write, and the request answers a **success status with no data** — `204 No Content` on a buffered request. There is no error message.
>
> ```bash
> Accept: application/json;stream=truex    # not a boolean  → empty
> Accept: application/json;skipNulls=1     # not a boolean  → empty (use true/false)
> Accept: application/sql;mode=upsert      # not in the enum → empty
> ```
>
> The SQL `mode` enum is strict: `insert`, `sync` and `merge` are the only accepted values (see [SQL export](../features/sql-export.md#22-serializer-parameters)). Booleans must be spelled `true` or `false` — `1`, `yes` and `on` are all rejected.
>
> The failure mode to recognize: a `204` (or an empty `200`) from a collection you know is not empty, right after you added or edited an `Accept` parameter. Drop the parameter and the data comes back.

### Error Response Framing

An error body is **the same JSON document on every content type** — same members, same `@type` discriminator, same status code. Only its *framing* follows the `Accept` header, and the response's `Content-Type` tells you which one you got:

| Accept header | Error `Content-Type` | Error body |
|---------------|----------------------|------------|
| `application/x-ndjson` or `ndjson`, with or without `;stream=true` | `application/x-ndjson` | One newline-terminated line |
| `application/json`, `json`, `text/csv`, `application/sql`, `application/vnd.ms-sqlserver.csv`, `text/plain`, `text/html`, `*/*`, or no `Accept` at all | `application/json` | Indented JSON |

A client reading NDJSON therefore gets an error as one more line of the stream it was already parsing, rather than as a multi-line document a line-oriented reader can make nothing of:

```bash
curl -sS "https://example.app.heads.com/api/v1/products?limit=50&orderby=identifiers/key&after=not-a-token" \
  -H "Accept: application/x-ndjson" -u ":banana"
```

```json
{"@type":"bad request","error":"The request was invalid and could not be processed.","details":"Malformed cursor token: invalid base64url or JSON"}
```

That single line is valid input to `jq`, and appending a failed request's output to a `.ndjson` file leaves the file readable. Ask for the same failure as `application/json` and you get the identical document, indented over several lines.

This is framing, not a new error type: no new `@type`, no new members. A client that already parses error bodies needs no change; one that splits responses on newlines might.

**Errors are never rendered as CSV or SQL rows.** A failed `text/csv` or `application/sql` export answers with the indented JSON error body, so check the status code before handing a response to a CSV or SQL parser — see [Gotcha 36](common-gotchas.md#36-an-error-response-is-json-whatever-format-you-asked-for).

**Every error response carries a `Content-Type`.** There is no need to sniff the body to find out what an error response contains.

**`Error-Info` is unaffected by framing.** Every error response also carries the same document as compact, single-line JSON in the `Error-Info` response header, identically on every content type.

> **Not the same thing as a mid-stream error.** Everything above is the ordinary HTTP error response — the status code is real and the body is the whole response. A `"@type": "mid-stream error"` element instead appears *inside* an otherwise successful `200` body, when a failure strikes after the headers are already on the wire. Both are line-framed for NDJSON, so one line-oriented reader handles both; only the status code distinguishes them. See [Streaming → Error handling](../features/streaming.md#4-error-handling).

### Error Types

Every error body names what went wrong in its `@type` discriminator. **Branch on `@type` rather than on the status code.** The status codes below are the ordinary ones each type is raised with, not a contract — treat the column as indicative, and read `@type` when you need to know what actually happened.

| `@type` | Typical status | Meaning | Type-specific members |
|---------|----------------|---------|-----------------------|
| `bad request` | 400 | The request was invalid and could not be processed | — |
| `no request body` | 400 | A body was required and none was sent | — |
| `invalid uri syntax` | 400 | The request URI could not be parsed | `uri`, `invalidSection` |
| `failed indexing` | 400 | Identifiers in the request payload named no existing object of the expected type | `usedIndex`, `indexerOwner`, `indexType` |
| `invalid index` | 400 | The index value is not valid for the indexer — e.g. a bare number where identifiers were expected | `usedIndex`, `indexerOwner`, `indexType` |
| `failed coercion` | 400 | A value could not be coerced to the type the target expects | `targetType`, `failedCoercions` |
| `unauthorized` | 401 | Missing or unusable credentials | — |
| `forbidden` | 403 | Authenticated, but the authorized scopes do not permit this | `authorizedScopes` |
| `not found` | 404 | No such resource | `url` |
| `method not available` | 405 | The method is not supported on this target | `method` |
| `not acceptable` | 406 | No serializer for the requested `Accept` type | — |
| `conflict` | 409 | Duplicate or conflicting resource | `conflictingResource` |
| `unsupported media type` | 415 | No deserializer for the request `Content-Type` | — |
| `internal error` | 500 | An unexpected server-side failure, sanitized | — |

**Every type draws on the same three base members**, whatever its discriminator: `error` (the general category — always present), `details` (the occurrence-specific message) and `suggestion` (advice for avoiding the failure next time). Only `error` is guaranteed; `details` and `suggestion` appear when there is something specific to say. The type-specific members above are added on top.

Two details worth knowing before you write the switch:

- **`failed indexing` is a write-side failure, and it echoes your input back.** It means a nested reference in your payload — `{"product": {"identifiers": {"com.example.sku": "NOPE"}}}` — named no object that exists. The identifiers you sent come back in `usedIndex`, and `suggestion` names the type that was being looked for, so you can tell a typo from a genuinely absent record without a second request.
- **`failedCoercions` is a list, not a message.** Each entry describes one value that could not be converted — `success`, `targetType`, `inputValue`, `path` (where in your payload it sat) and `message`. On a bulk write it is the fastest way to find which element and which member were wrong.

**Treat an unrecognized `@type` as a plain error rather than as a parse failure.** New types can be added, so the forward-compatible default branch reports `error` — the one member every type is guaranteed to have — along with `details` when it is present. Two values will never turn up as an HTTP error body: `mid-stream error`, which appears only *inside* a committed `200` (see [Streaming → Error handling](../features/streaming.md#4-error-handling)), and `error` itself, which is the base every type above inherits from rather than something the API emits on its own.

> **Changed 2026-08-19.** An invalid index used to go out as `"invalid index type"`, which is not a type the published schema defines. It is now `"invalid index"`, matching the schema and the client you generate from it. Only relevant if you hard-coded the old string from an observed response — a client that follows the unrecognized-`@type` advice above was already handling it.

### Format-Specific Behaviors

**JSON (`application/json`):**
- Empty collections return `[]` — never an empty body, so JSON is `200` and never `204`
- `~count` returns a number
- POST accepts arrays for bulk creation
- Add `;stream=true` to serialize and send array elements incrementally (see [Streaming](../features/streaming.md)). A mid-collection failure closes the array and becomes its last element

**NDJSON (`application/x-ndjson`):**
- One JSON object per line
- Empty collections yield empty output (no lines) — returned as `204 No Content` buffered, or `200` with an empty body when `;stream=true`
- Add `;stream=true` to build and send lines incrementally (see [Streaming](../features/streaming.md))
- Trailing newlines are accepted on import
- An error response is framed as one line too, so it parses as a record of the stream — check the status code before treating a parsed line as data ([Error response framing](#error-response-framing))

**CSV (`text/csv`):**
- Header row derived from first item's fields
- Commas, quotes, and newlines in values are escaped
- Empty collections yield empty output (no header) — `204 No Content` buffered, `200` with an empty body when `;stream=true`
- Add `;stream=true` to emit the header row and then each data row as the collection advances
- Single item yields header + 1 data row
- A failed request answers with a JSON error body, never CSV rows ([Error response framing](#error-response-framing))

**text/plain and text/html:**
- Require string output; non-string values cause error
- Use `~toString` to convert numeric results: `/products~count~toString`
- HTML wraps non-HTML string content in basic HTML structure

**SQL (`application/sql`) and SQL Server CSV (`application/vnd.ms-sqlserver.csv`):**
- Output-only formats (no input/deserialization support)
- Require mapped type output returning `SqlStatement[]` — see [`features/sql-export.md`](../features/sql-export.md)
- Arrays/objects in values are rejected; flatten or JSON-stringify before serialization
- Supports `batchSize` parameter for streaming batches (e.g., `Accept: application/sql; batchSize=100`)
- Add `;stream=true` to send statements incrementally. A chunk is a whole `batchSize` group, so lower `batchSize` for an earlier first byte (see [Streaming](../features/streaming.md))
- SQL Server CSV escapes special characters for BULK INSERT compatibility
- A failed request answers with a JSON error body, never SQL statements or CSV rows ([Error response framing](#error-response-framing))

### Known Limitations

- **File extension content negotiation not supported:** URLs like `/products.json` or `/products.csv` do not work. The extension is treated as part of the resource identifier. Use the Accept header instead.

### Request Content Types

| Content-Type | Use Case |
|--------------|----------|
| `application/json` | Standard JSON body |
| `application/x-ndjson` | Bulk import (one object per line) |
| `text/csv` | Tabular import (header + rows) |

---

## Transaction and Buffering Semantics

### Default: Buffered (Transaction-Bounded)

Without `stream=true`, all items are read from the database within a single transaction and the complete body is assembled before any of it is written. This guarantees:

- **Snapshot consistency:** The entire result set reflects one point-in-time view of the data
- **Atomicity:** Either all items are returned, or none (on error)
- **No partial results:** An error returns a proper HTTP error status and no data, rather than a truncated array

### With `stream=true`

`;stream=true` makes the computation itself incremental: each item is serialized as it is sent, rather than the whole collection being built first. This applies to **every collection format** — `application/json`, `application/x-ndjson`, `text/csv`, `application/sql` and `application/vnd.ms-sqlserver.csv`.

| Format | First byte arrives |
|--------|--------------------|
| any collection format *without* `stream=true` | After the whole body is assembled |
| `application/x-ndjson; stream=true` | After the first batch — each line is built as the collection advances |
| `application/json; stream=true` | After the first batch — each array element is built as the collection advances |
| `text/csv; stream=true` | After the first batch — header row, then one row at a time |
| `application/sql; stream=true` | After the first batch of `batchSize` groups |
| `text/plain`, `text/html` | No collection path; `stream=true` does nothing |

**Key point:** the win is time-to-first-byte, and the reason it matters is connection liveness — a long-running query behind a proxy or client with a first-byte timeout stays alive because the first chunk ships early. It is *not* a way to parse a JSON array incrementally (a JSON array is only parseable once you hold all of it — use NDJSON for that), and it does *not* bound server memory.

**The first chunk follows a batch, not an item.** Results are read 200 chunks at a time, so on a collection smaller than that there is no observable difference. For `application/sql` a chunk is a whole `batchSize` group (default 1000), so lower `batchSize` if you want bytes sooner.

Streaming trades the guarantees above for that latency: items are read in batches across separate read transactions (so no single-point-in-time snapshot), and a failure after the first byte cannot change the status code. It arrives as a `mid-stream error` object inside the body — appended as one more line on the line-delimited formats, or as the **last element of the array** on `application/json`.

**Two envelope differences** catch integrators switching an existing call to `stream=true`: an empty result is `200` with an empty body rather than `204 No Content` (JSON excepted — it serializes to `[]`), and a buffered `application/json` body ends with a newline the streamed one does not have. For the line-oriented formats the two forms are byte-identical, so an exact-comparison client can diff raw bytes across the switch; only JSON needs the trailing newline accounted for.

> **Streaming in depth:** For transaction chunking, input streaming, `X-Transaction-Count` header, and mid-stream error handling, see [`features/streaming.md`](../features/streaming.md).
