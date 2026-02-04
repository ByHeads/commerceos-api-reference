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
5. **Dive deeper** - [`mapped-types.md`](mapped-types.md), [`sync-webhooks.md`](sync-webhooks.md), [`primitives.md`](primitives.md), [`receipts.md`](receipts.md), and other reference docs

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
| Users | User accounts, credentials, and role assignments | — | [Examples](../guide/examples/users.md) |
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
curl -H "X-Api-Key: MySecretKey" localhost:5000/api/v1/void

# Via Basic Auth (password only)
curl -u ":MySecretKey" localhost:5000/api/v1/void
```

### OAuth 2.0
```bash
# Get token
curl -X POST localhost:5000/oauth2/v1/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=ID&client_secret=SECRET"

# Use token
curl -H "Authorization: Bearer TOKEN" localhost:5000/api/v1/void
```

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
| **users** | User accounts and credentials (local and retail) for access and identity. |
| **retail** | Receipts, payment methods, payment cards/means, Z/X and cash register reports, return reasons, and mobile device/plans. See [`receipts.md`](receipts.md) for BI/analytics usage. |
| **geo** | Currencies, languages, countries, and cities for localization. |
| **media** | Images and other media assets attached to products and agents. |
| **config** | System settings and serial number sequences. |
| **advanced** | Mapped types and sync webhooks for custom data transformations and integrations. See [`mapped-types.md`](mapped-types.md) and [`sync-webhooks.md`](sync-webhooks.md). |

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
~where(...)    filter by conditions
~orderBy(...)  sort results
~take(n)       limit result count
~skip(n)       skip first n results
```

> **Mixing Query Layers**
>
> You can combine `~` operators and query parameters in a single request. Query parameters are parsed at the `?` position and applied as a fixed block (`format → fields → where → orderBy → skip → take → simpleJust`) regardless of their order in the URL. Prefer a single style when operator ordering matters.

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

# Stream JSON array output (faster first-byte, but still buffers first)
Accept: application/json; stream=true

# Skip specific members from output
Accept: application/json; skipMembers=prices,images
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `skipNulls` | boolean | `true` | Omit null fields from output |
| `skipTypes` | boolean | `false` | Strip `@type` discriminators |
| `numberHandling` | `"string"` or `"number"` | `"number"` | Serialize numbers as strings for precision |
| `stream` | boolean | `false` | Stream JSON array output (one item at a time) |
| `skipMembers` | comma-separated | — | Member names to exclude from output |

**`skipNulls` + `~with` interaction:** When `skipNulls=true` (default), null fields are omitted. However, if a field is explicitly requested via `~with()`, a null value is included to indicate the field exists but is empty.

**Unknown parameters:** Unknown parameters in the Accept header are accepted and ignored (they do not cause errors).

### Format-Specific Behaviors

**JSON (`application/json`):**
- Empty collections return `[]`
- `~count` returns a number
- POST accepts arrays for bulk creation

**NDJSON (`application/x-ndjson`):**
- One JSON object per line
- Empty collections yield empty output (no lines)
- Trailing newlines are accepted on import

**CSV (`text/csv`):**
- Header row derived from first item's fields
- Commas, quotes, and newlines in values are escaped
- Empty collections yield empty output (no header)
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

All collection responses go through two phases: **buffering** (database read) and **serialization** (output writing).

### Phase 1: Buffering (Transaction-Bounded)

All items are read from the database within a single transaction before any output is written. This guarantees:

- **Snapshot consistency:** The entire result set reflects one point-in-time view of the data
- **Atomicity:** Either all items are returned, or none (on error)
- **No partial results:** Errors during buffering return no data, preventing corrupted or incomplete arrays

### Phase 2: Serialization (Format-Dependent)

After buffering completes, items are serialized according to the requested output format:

| Format | Serialization Behavior | First Byte Timing |
|--------|------------------------|-------------------|
| `application/json` | Buffered (default) | After all items read + serialized |
| `application/json; stream=true` | Streaming - one array element at a time | After all items read |
| `application/x-ndjson` | Streaming - one line per item | After all items read |
| `text/csv` | Streaming - one row per item | After all items read |

**Key point:** Even streaming formats buffer all items during the database read phase. The "streaming" behavior applies only to the serialization phase, providing faster first-byte response times for large result sets while maintaining transaction consistency.

**JSON streaming note:** By default, JSON arrays are fully serialized before output begins. With `stream=true`, JSON array elements are streamed individually **after** the buffering phase completes—the first byte arrives after all items are read from the database, but before the full JSON array is assembled. This is useful for large result sets where you want incremental output.
