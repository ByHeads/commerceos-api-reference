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

---

## Content Types

### Response Formats (Accept Header)

| Accept Header | Shorthand | Use Case |
|---------------|-----------|----------|
| `application/json` | `json` | Default, buffered response |
| `application/x-ndjson` | `ndjson` | Streaming, line-delimited |
| `text/csv` | - | Tabular export |
| `text/plain` | - | Plain text output |
| `text/html` | - | HTML-wrapped output |
| `application/sql` | `sql` | SQL INSERT/UPDATE/DELETE statements (requires mapped type output) |
| `application/vnd.ms-sqlserver.csv` | - | SQL Server CSV format for bulk import (requires mapped type output) |

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

**Unknown parameters:** Unknown parameters in the Accept header are accepted and ignored (they do not cause errors).

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

**CSV (`text/csv`):**
- Header row derived from first item's fields
- Commas, quotes, and newlines in values are escaped
- Empty collections yield empty output (no header) — `204 No Content` buffered, `200` with an empty body when `;stream=true`
- Add `;stream=true` to emit the header row and then each data row as the collection advances
- Single item yields header + 1 data row

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

**Two envelope differences** catch integrators switching an existing call to `stream=true`: an empty result is `200` with an empty body rather than `204 No Content` (JSON excepted — it serializes to `[]`), and the buffered body carries one extra trailing newline. Compare lines rather than raw bytes when diffing the two.

> **Streaming in depth:** For transaction chunking, input streaming, `X-Transaction-Count` header, and mid-stream error handling, see [`features/streaming.md`](../features/streaming.md).
