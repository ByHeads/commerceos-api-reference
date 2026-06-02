# Sync Webhooks

Sync webhooks are automated data synchronization tasks that pull data from the API, optionally transform it, and push it to an external endpoint. They support scheduling, retries, and post-sync mutations.

---

## Overview

Use sync webhooks when you need to:
- **Push data to external systems** on a schedule (e.g., sync products to an external catalog)
- **Transform data** before sending using mapped types
- **Apply mutations** to synced objects after successful delivery
- **Retry failed deliveries** with configurable attempts

**Execution flow:**
1. **Pull** - Fetch data from the API using the `in` request configuration
2. **Map** - Optionally transform the response using a mapped type
3. **Push** - Send each item to the external endpoint defined in `out`
4. **Mutate** - Apply `then` actions to update the source objects
5. **Reschedule** - If `repeat` is enabled, schedule the next run

---

## Resource & Endpoint

Sync webhooks are managed via the `/v1/sync-webhooks` collection. Use your tenant's `/api-docs` for the canonical endpoint list. The collection supports standard REST operations (GET, POST, PUT, PATCH, DELETE).

**Lookup by external identifier:**
```bash
GET /v1/sync-webhooks/com.myapp.hookId=product-sync
```

---

## Configuration Fields

### Core Fields

| Field | Type | Description |
|-------|------|-------------|
| `identifiers` | object | Common identifiers for the webhook (includes `key` and external IDs) |
| `name` | string | Human-readable name for the webhook |
| `description` | string | Description of what the webhook does |

### Input/Output Configuration

| Field | Type | Description |
|-------|------|-------------|
| `in` | request | The API request to fetch source data |
| `out` | request \| webhook output | The external delivery target. Either an HTTP request (legacy flat shape with `method`/`url`/`auth`/`headers`, or the explicit `{ "http": { ... } }` form) or a direct SQL Server write via `{ "tds": { ... } }`. Use one or the other — specifying both `http` and `tds` is rejected on write. **TDS targets do not support [resume-from-failure](#resume-after-failure)**: the entire batch is re-sent on retry, so make sure the target schema is idempotent (e.g. use `MERGE` rather than blind `INSERT`s). |
| `map` | mapped type | Reference to a mapped type for data transformation |
| `then` | object | Actions to perform on source objects after successful sync |

### Scheduling

| Field | Type | Description |
|-------|------|-------------|
| `when` | string | API request URL that returns a date-time for the next run |
| `repeat` | boolean | Whether to reschedule after each successful run |
| `lastWhen` | string (read-only) | The previous `when` value, cached when `when` is changed or cleared due to errors. Used by [`reactivate`](#operator-methods). |
| `next` | date-time (read-only) | The next scheduled execution time |
| `last` | date-time (read-only) | Legacy alias for `lastStart`, kept for backwards compatibility. Prefer `lastStart` / `lastFinished` for new consumers. |
| `lastStart` | date-time (read-only) | When the last successful run started fetching its `in` selection. Advances only on success — useful as the lower bound for delta queries (e.g. `{api/v1/context/webhook/lastStart}` in URL templates). |
| `lastFinished` | date-time (read-only) | When the last run finished, regardless of success. Pair with `lastStart` for run-window observability. |
| `lastSuccess` | date-time (read-only) | When the last successful run finished. Only advances on success — answers "when was this webhook last healthy?". |
| `lastFailed` | date-time (read-only) | When the last failed run finished. Only advances on failure. Pair with `lastSuccess` for at-a-glance health ("last error: 12 min ago"). |

### Retry Configuration

| Field | Type | Description |
|-------|------|-------------|
| `attempts` | number | Current retry count since last successful run |
| `maxAttempts` | number | Maximum retry attempts before stopping |
| `error` | string | Error message from the last failed attempt (system-managed but writable for manual clearing) |

### Security & Logging

| Field | Type | Description |
|-------|------|-------------|
| `authorizedScopes` | string[] | API scopes the webhook is authorized to use |
| `oauth2Client` | object | The OAuth2 client this webhook authenticates as for internal API calls. Its `node` (tenant) and `scopes` define the identity and authorization used when resolving `in` URLs and `then.set` mutations. Required for webhooks that touch internal COS APIs; optional for external-only webhooks. |
| `verboseLogging` | boolean | Enable detailed logging for debugging |

### Per-webhook Configuration Store

Two parallel maps hold per-webhook configuration that the webhook's URL templates and `resolveBody` selectors can read at run time:

| Field | Type | Description |
|-------|------|-------------|
| `secrets` | map of namespaced keys → JSON values | **Sensitive** per-webhook configuration: tokens, passwords, keys. Stored in a separate secret store and **masked as `********` in any API response** — secrets are only ever readable in plaintext by the webhook itself, at execution time, via `{api/v1/context/webhook/secrets/<namespaced.key>}` URL-template lookups or `"api/v1/context/webhook/secrets/<namespaced.key>"` `resolveBody` selectors. |
| `variables` | map of namespaced keys → JSON values | **Non-sensitive** per-webhook configuration: page sizes, base URLs, tenant codes, region selectors, feature flags. Stored as a regular property and **returned verbatim in API responses — never masked**. |

Both share the same shape and write semantics:

- **Keys must be namespaced** (e.g. `com.example.tenantCode`). Non-namespaced keys are filtered out with a lenient skip.
- **Values can be any JSON** (`dynamic?`).
- **PATCH merges into the existing map.** PATCHing `{secrets: {a: 1}}` adds key `a`; existing keys stay. Same for `variables`. To clear an entry, set its value to `null` (or use the sub-resource — see below).
- **Sub-resource:** `/v1/sync-webhooks/{id}/secrets` and `/v1/sync-webhooks/{id}/variables` both support GET / PATCH / PUT (full round-trip).
- **Inline at create time:** `POST /v1/sync-webhooks` accepts both maps in the request body.
- **Excluded from default reads.** Neither is part of the default `essential` field set; request them with `~with(secrets,variables)` or `~just(secrets,variables)`.

Both are reachable from URL templates and `resolveBody` selectors as `{api/v1/context/webhook/secrets/<key>}` and `{api/v1/context/webhook/variables/<key>}` — see [URL Template Variables](#url-template-variables).

> **When to use which.** Use `secrets` for anything you would not want logged or returned to a non-admin reader (API tokens, basic-auth passwords). Use `variables` for everything else — the values round-trip verbatim, so integrators can read them back to verify configuration.

### Operator Methods

The webhook resource exposes a few operator methods callable via POST against the resource (or as method-form PATCHes — see your tenant's `/api-docs`):

| Method | Effect |
|--------|--------|
| `runOnce` | Trigger a one-shot run. Pass `true` to schedule it ~3 s from now, or a non-negative number `N` to schedule it `N` seconds from now. |
| `reactivate` | Reactivate a paused or errored webhook by restoring its previous schedule from `lastWhen`. Clears `error` and resets `attempts` to 0. |
| `reset` | Clear all `last*` timestamps (`last`, `lastStart`, `lastFinished`, `lastSuccess`, `lastFailed`). Forces the next run to behave as a full sync — delta queries that key off `lastStart` (e.g. `{api/v1/context/webhook/lastStart}`) will see no lower bound and re-fetch everything. |
| `catchUp` | Mark the webhook as if it had just completed a successful run. Sets `last`, `lastStart`, `lastFinished`, and `lastSuccess` to *now*; clears `error`, `attempts`, and `lastFailed`. Use this to activate a webhook on a system with existing historical data without replaying that history. Inverse of `reset`. |
| `clearProgress` | Clear any pending resume snapshot in `resumeState`, so the next run starts from page 1. See [Resume After Failure](#resume-after-failure). |

```bash
# Run immediately (well, ~3 s from now).
curl -X PATCH -u ":banana" \
  "https://example.app.heads.com/api/v1/sync-webhooks/com.myapp.id=my-webhook" \
  -H "Content-Type: application/json" \
  -d '{"runOnce": true}'

# Run 60 seconds from now.
curl -X PATCH -u ":banana" \
  "https://example.app.heads.com/api/v1/sync-webhooks/com.myapp.id=my-webhook" \
  -H "Content-Type: application/json" \
  -d '{"runOnce": 60}'
```

### Sync-State Fields

| Field | Type | Description |
|-------|------|-------------|
| `resumeState` | object (read-only) | The pending resume snapshot, if any. Empty when there's no interrupted run to resume — i.e. either the webhook hasn't run, the last run completed cleanly, or its `out` request isn't marked `idempotent`. When present, contains the strategy that was active and the saved continuation token (`cursor` resolved request fragments, or `linkHeader` / `nextUrl` URL). Use it to diagnose stalled paginated runs; clear with `clearProgress` to force a full restart. See [Resume After Failure](#resume-after-failure). |

---

## URL Template Variables

The `in.url`, `out.url`, and `resolveBody` selectors support template variables resolved against API resources at run time. Use the `{path}` syntax with `/` as the path separator.

**Per-item variables (in `out` requests):** resolved against the unmapped output item.

```
"url": "https://api.vendor.example.com/products/{identifiers/com.example.sku}"
```

**Global virtual paths:**

| Path | Resolves to |
|------|-------------|
| `{api/v1/uuid}` | A random UUID. Append `..N` to truncate to the first N characters (e.g. `{api/v1/uuid/..8}`). |
| `{api/v1/now}` | The current ISO timestamp. |

**Webhook-context variables** (during execution, the running webhook is reachable via the `api/v1/context/webhook/` path):

| Path | Resolves to |
|------|-------------|
| `{api/v1/context/webhook/lastStart}` | The start time of the previous successful run. Recommended lower bound for delta sync. |
| `{api/v1/context/webhook/last}` | Legacy alias for `lastStart`. Prefer `lastStart` for new integrations. |
| `{api/v1/context/webhook/lastFinished}` | When the previous run finished, regardless of outcome. |
| `{api/v1/context/webhook/lastSuccess}` | When the previous successful run finished. |
| `{api/v1/context/webhook/lastFailed}` | When the previous failed run finished. |
| `{api/v1/context/webhook/name}` | The webhook's `name`. |
| `{api/v1/context/webhook/attempts}` | The current attempt count. |
| `{api/v1/context/webhook/secrets/<namespaced.key>}` | The value of a `secrets` entry by namespaced key. |
| `{api/v1/context/webhook/variables/<namespaced.key>}` | The value of a `variables` entry by namespaced key. |

Values are URL-encoded automatically.

> **Delta sync pattern.** Combine `{api/v1/context/webhook/lastStart}` with a server-side filter to fetch only items modified since the last successful run: `https://api.vendor.example.com/products?modifiedSince={api/v1/context/webhook/lastStart}`. `lastStart` is the canonical delta-sync lower bound; `last` is a legacy alias and should not be used for new integrations. On the first run `lastStart` is empty; design the upstream query so an empty value behaves as "fetch everything", or pre-populate via `catchUp` to start from a known boundary.

---

## Request Configuration

Both `in` and `out` use a request object with the following structure:

```json
{
  "method": "POST",
  "url": "https://api.example.com/receive",
  "auth": { ... },
  "headers": { ... },
  "body": { ... }
}
```

### Request Fields

| Field | Type | Description |
|-------|------|-------------|
| `method` | string | HTTP method (used for `out` only; defaults to `POST` when omitted) |
| `url` | string | Target URL (API path for `in`, external URL for `out`) |
| `auth` | object | Authentication configuration (used for `out` only) |
| `headers` | object | Additional HTTP headers (used for `out` only) |
| `body` | object | **Ignored** — sync webhooks always send the mapped item as the body |

**Notes:**
- **`in` uses only `url`** — `method`, `headers`, and `body` are ignored
- **`out.body` is ignored** — the payload is always the mapped (or unmapped) item JSON
- **Content-Type defaults to `application/json;charset=utf-8`** — but `out.headers["Content-Type"]` can override it (custom headers are merged after the default)
- **`then.set` runs per item** even when `out` is omitted (for mutation-only workflows)

### Authentication Options

**Basic Authentication:**
```json
{
  "auth": {
    "basic": {
      "username": "user",
      "password": "secret"
    }
  }
}
```

**OAuth 2.0 Client Credentials:**
```json
{
  "auth": {
    "clientCredentials": {
      "tokenUrl": "https://auth.example.com/oauth/token",
      "client_id": "your-client-id",
      "client_secret": "your-secret",
      "scope": "write:data"
    }
  }
}
```

**Token caching:** Access tokens are cached per `out.url` and automatically reused until 90 seconds before expiration. This avoids redundant token requests when the webhook processes multiple items or runs frequently.

**Authorization Header:**
```json
{
  "auth": {
    "authorizationHeader": "Bearer static-token"
  }
}
```

**Custom Header:**
```json
{
  "auth": {
    "customHeader": {
      "X-API-Key": "your-api-key"
    }
  }
}
```

---

## Pagination (for `in` requests)

External APIs typically split large collections across many HTTP responses. Configure pagination on the `in` request and the webhook will follow the chain page by page, mapping and pushing items as it goes — so progress is visible after each page rather than after the whole sync.

> Pagination is configured under `in.pagination`. It is **only honored on `in` requests**; setting it on `out` has no effect.

### Choose a strategy

| Strategy     | When to use it                                           | Typical APIs                              |
|--------------|----------------------------------------------------------|-------------------------------------------|
| `cursor`     | Response carries an opaque cursor (token / last item ID) | Stripe, Square, HubSpot                   |
| `nextUrl`    | Response body contains a full URL for the next page      | Salesforce, Dynamics 365 BC (OData)       |
| `linkHeader` | Server returns RFC 8288 `Link` header with `rel="next"`  | Shopify REST, GitHub REST, WooCommerce    |
| `pageNumber` | Client increments a page counter (`?page=1`, `?page=2`)  | Fortnox, Visma eAccounting, WooCommerce, Xero |
| `offset`     | Client increments a row offset by page size              | QuickBooks Online, NetSuite               |

Place exactly **one** of these keys on `in.pagination`. Setting more than one is a configuration error.

```jsonc
{
  "in": {
    "url": "https://api.example.com/items",
    "resultSelector": "data",
    "pagination": {
      "cursor": { /* strategy-specific config */ }
    }
  }
}
```

### Common fields

Every strategy supports the same set of common fields (in addition to its strategy-specific fields):

| Field        | Type      | Description |
|--------------|-----------|-------------|
| `parameters` | object    | Key-value pairs sent as query string parameters. See [Parameter value types](#parameter-value-types) below. |
| `headers`    | object    | Key-value pairs sent as HTTP headers. Same value types as `parameters`. |
| `body`       | object    | Key-value pairs shallow-merged into the request body each page. Same value types as `parameters`. Use this for POST-based search APIs. |
| `maxPages`   | number    | Safety cap on the number of pages fetched. **Default: 500.** |
| `maxItems`   | number    | Stop after accumulating this many items across all pages. |
| `delayMs`    | number    | Milliseconds to wait between page fetches. **Default: 0.** Use to respect rate limits. |
| `while`      | string    | Predicate expression evaluated against each page response; pagination continues while this resolves to a truthy value. See [The `while` expression](#the-while-expression). |

Strategy-specific fields:

| Field      | Strategy     | Description |
|------------|--------------|-------------|
| `selector` | `nextUrl`    | **Required.** Path in the response body to the next-page URL (e.g., `nextRecordsUrl`, `@odata.nextLink`). |
| `rel`      | `linkHeader` | Link relation to follow. **Default: `"next"`.** |

### Parameter value types

Each entry in `parameters`, `headers`, and `body` accepts one of three value shapes:

| Value form                   | Example                                  | Behaviour                                                                                                                                |
|------------------------------|------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------|
| **Number** (literal)         | `"limit": 100`                           | Sent as-is on **every** page request.                                                                                                    |
| **String** (resolver)        | `"starting_after": "data~last/id"`       | Skipped on the first request (no previous response). On subsequent requests, evaluated against the previous page response. If it resolves to `null`/`undefined`, pagination stops. |
| **Object** (counter)         | `"page": { "from": 1, "step": 1 }`       | Auto-incrementing counter. Sent on **every** request, starting at `from`, advancing by `step` (default `1`) after each page.             |

**Parameters vs body — first-request scope:**
- For `nextUrl` and `linkHeader` strategies, `parameters` are sent on the **first** request only — subsequent requests follow the URL returned by the response/header (which already encodes the right params).
- `body` fields are sent on **every** page request for all strategies.

### Resolver and predicate syntax

Resolver expressions in `parameters` / `headers` / `body` and the `while` predicate use the same path syntax as `resultSelector`. A few notes:

- `/` separates path segments: `paging/next/after` walks `response.paging.next.after`.
- `~last` and `~first` pick the last/first element of an array: `data~last/id` resolves to the `id` of the last item in `data`.
- `length` returns array length: `Articles/length` resolves to the size of the `Articles` array.
- The expression is evaluated against the **full response body**, **before** `resultSelector` is applied — cursors and stop signals are usually siblings of the items array, not inside it.

### The `while` expression

`while` continues paging while a predicate is truthy on each page response. The predicate grammar:

| Form                          | Meaning                                  |
|-------------------------------|------------------------------------------|
| `path`                        | Truthy at `path`                         |
| `!path`                       | Falsy at `path` (e.g., `!done`)          |
| `path=value`, `path!=value`   | Equality / inequality                    |
| `path>value`, `path>=value`   | Numeric / lexicographic comparison       |
| `path<value`, `path<=value`   | Numeric / lexicographic comparison       |

**Examples:**
- `has_more` — continue while `response.has_more` is truthy.
- `!done` — continue while `response.done` is falsy (Salesforce inverts).
- `Articles/length>=500` — continue while the page returned at least 500 items (heuristic: a "full" page suggests more).
- `paging/next/after` — continue while a next-cursor field is present (truthy).

> **Operator placement.** Operators must directly follow the path (`length>=500`, no `/` before `>=`). `Articles/length>=500` ✓, `Articles/length/>=500` ✗.

### Stop conditions

Pagination stops as soon as **any** of the following becomes true (checked after each page):

1. `maxPages` reached.
2. `maxItems` reached (accumulated count ≥ `maxItems`).
3. **Strategy signal:**
   - `cursor` — a string resolver in `parameters` resolved to `null` / `undefined`.
   - `nextUrl` — `selector` resolved to `null` / `undefined` / empty.
   - `linkHeader` — no link with the configured `rel` was returned.
   - `pageNumber` / `offset` — no inherent stop signal; rely on `while` or an empty page.
4. `while` resolved to a falsy value.
5. The page returned **0 items** (always checked as a final fallback).

### Per-page streaming

The webhook **streams one page at a time**: each page is mapped, pushed to `out`, and then `then.set` is applied — before the next page is fetched. This means:

- Memory stays bounded regardless of total result size.
- Progress is durable: if page 7 fails, items from pages 1–6 are already synced and marked.
- On retry, a status-based `in` query (e.g., `~where(syncStatus!=synced)`) naturally skips already-processed items.

### Examples

#### Cursor (Stripe)

Stripe returns a `data` array with `has_more`. The cursor is the ID of the last item — passed as `starting_after` on the next request.

```json
{
  "in": {
    "method": "GET",
    "url": "https://api.stripe.com/v1/customers",
    "auth": { "basic": { "username": "sk_live_...", "password": "" } },
    "resultSelector": "data",
    "pagination": {
      "cursor": {
        "parameters": {
          "limit": 100,
          "starting_after": "data~last/id"
        },
        "while": "has_more",
        "maxPages": 200
      }
    }
  }
}
```

- **First request:** `?limit=100` (the `starting_after` resolver is skipped — no previous response).
- **Subsequent requests:** `?limit=100&starting_after=cus_Z9` (resolved from the previous page's last item).
- **Stops** when `has_more` is `false`.

#### Next URL (Dynamics 365 BC, Salesforce)

OData returns `@odata.nextLink` containing an absolute URL with an opaque `$skiptoken`. The field is absent on the last page.

```json
{
  "in": {
    "method": "GET",
    "url": "https://api.businesscentral.dynamics.com/v2.0/env/api/v2.0/items",
    "auth": { "customHeader": { "Authorization": "Bearer ..." } },
    "resultSelector": "value",
    "pagination": {
      "nextUrl": {
        "selector": "@odata.nextLink",
        "maxPages": 500
      }
    }
  }
}
```

Salesforce variant — relative URL plus an inverted `done` flag:

```json
{
  "in": {
    "method": "GET",
    "url": "https://myorg.salesforce.com/services/data/v59.0/query/?q=SELECT+Id,Name+FROM+Account",
    "auth": { "clientCredentials": { "tokenUrl": "...", "client_id": "...", "client_secret": "...", "scope": "..." } },
    "resultSelector": "records",
    "pagination": {
      "nextUrl": {
        "selector": "nextRecordsUrl",
        "while": "!done"
      }
    }
  }
}
```

Relative URLs in the `selector` are resolved against the original request URL.

#### Link header (Shopify)

Shopify returns an RFC 8288 `Link` header with `rel="next"`. `parameters` are sent on the first request only — subsequent requests follow the URL from the header (which already encodes `limit`).

```json
{
  "in": {
    "method": "GET",
    "url": "https://mystore.myshopify.com/admin/api/2024-01/products.json",
    "auth": { "customHeader": { "X-Shopify-Access-Token": "shpat_..." } },
    "resultSelector": "products",
    "pagination": {
      "linkHeader": {
        "parameters": { "limit": 250 },
        "maxPages": 200
      }
    }
  }
}
```

To follow a different relation, set `rel` (default is `"next"`).

#### Page number (Fortnox)

A page counter starting at `1`, incrementing by `1`, plus a heuristic stop: continue while the page returned a full batch.

```json
{
  "in": {
    "method": "GET",
    "url": "https://api.fortnox.se/3/articles",
    "auth": { "customHeader": { "Access-Token": "your-access-token" } },
    "resultSelector": "Articles",
    "pagination": {
      "pageNumber": {
        "parameters": {
          "page": { "from": 1 },
          "limit": 500
        },
        "while": "Articles/length>=500"
      }
    }
  }
}
```

- **Request sequence:** `?page=1&limit=500`, `?page=2&limit=500`, `?page=3&limit=500`, …
- **Stops** the first time `Articles` returns fewer than 500 items, or after `maxPages` (default 500).

#### Offset (NetSuite)

An offset counter starting at `0`, advancing by the page size, with a `hasMore` flag from the response.

```json
{
  "in": {
    "method": "GET",
    "url": "https://xxx.suitetalk.api.netsuite.com/services/rest/record/v1/customer",
    "auth": { "customHeader": { "Authorization": "OAuth ..." } },
    "resultSelector": "items",
    "pagination": {
      "offset": {
        "parameters": {
          "offset": { "from": 0, "step": 1000 },
          "limit": 1000
        },
        "while": "hasMore",
        "maxPages": 100
      }
    }
  }
}
```

- **Request sequence:** `?offset=0&limit=1000`, `?offset=1000&limit=1000`, `?offset=2000&limit=1000`, …
- For 1-based offsets (e.g., QuickBooks `STARTPOSITION`), use `{ "from": 1, "step": 1000 }`.

#### Body-based pagination (POST search)

Some APIs accept pagination fields in the request body rather than the query string (e.g., a `POST /SearchProducts` endpoint). Use `body` instead of `parameters`:

```json
{
  "in": {
    "method": "POST",
    "url": "https://omnium.example.com/api/Products/SearchProducts",
    "auth": { "customHeader": { "Authorization": "Bearer ..." } },
    "body": {
      "storeId": "example-store",
      "marketId": "SE",
      "isDeleted": false
    },
    "resultSelector": "items",
    "pagination": {
      "pageNumber": {
        "body": {
          "page": { "from": 1 },
          "take": 100
        },
        "while": "items/length>=100",
        "maxPages": 500
      }
    }
  }
}
```

`body` fields are shallow-merged on top of the request's base body each page (`{ ...baseBody, ...paginationBody }`) and sent on **every** page — including the first.

### Troubleshooting

| Symptom                                              | Likely cause                                                                                  | Fix                                                                                                              |
|------------------------------------------------------|-----------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------|
| Sync stops after exactly 500 pages with more data    | Hit the default `maxPages` safety cap                                                         | Raise `maxPages` explicitly. Confirm you actually want to fetch this much in one run.                            |
| Sync stops after page 1 even though more data exists | First-page resolver returned `null`, or `while` is falsy on page 1                            | Inspect the response with `verboseLogging: true`. Verify the path you used in the resolver / `while`.            |
| Sync loops forever (rate-limited / 429s)             | No stop condition is firing on a `pageNumber` / `offset` strategy                             | Add a `while` expression (e.g., `Items/length>=100`) and/or a tighter `maxPages`. Use `delayMs` for rate limits. |
| `cursor` strategy refetches the same page            | Resolver path doesn't actually advance (e.g., points at the request param, not a response field) | Verify the cursor field exists on the response. Walk it with the same path syntax you'd use in `resultSelector`. |
| `nextUrl` strategy fetches the wrong host            | Response returned a relative URL the engine can't resolve                                     | Check `selector` resolves to a full URL or a path. Relative paths are resolved against the original request URL.  |
| `linkHeader` doesn't advance                         | Wrong `rel` (server uses something other than `next`), or the header isn't returned at all    | Inspect headers with `verboseLogging: true`. Set `rel` to whatever the server uses.                              |
| `while` expression always falsy / always truthy      | Operator placement (e.g., `length/>=500` instead of `length>=500`) or wrong path              | Operators must directly follow the path: `Articles/length>=500`, not `Articles/length/>=500`.                    |
| Items from later pages aren't marked synced          | A page failed; everything before it is synced, the failing page and after aren't              | This is by design — the next run resumes (status-based `in` query skips already-marked items).                   |

Use `verboseLogging: true` while developing — each page fetch is logged with its URL, response size, and the running totals.

---

## Execution Flow

### 1. Fetch Source Data (`in`)

The webhook fetches data from the API using the `in` configuration:
```json
{
  "in": {
    "url": "api/v1/products~where(status=Active)"
  }
}
```

The URL is relative to the API root. Standard query operators (`~where`, `~take`, etc.) are supported.

### 2. Transform Data (`map`)

The `map` field references an **existing, active mapped type** by key. The webhook looks up the mapped type in the `/v1/mapped-types` collection and uses its body for transformation.

**Important:** Inline `map.body` definitions in webhook payloads are ignored. You must first create the mapped type separately, then reference it.

**Step 1: Create the mapped type**
```bash
POST /v1/mapped-types
{
  "identifiers": { "key": "product-export" },
  "active": true,
  "body": {
    "sku": "identifiers/com.myapp.sku",
    "title": "name",
    "price": "prices/default/amount"
  }
}
```

**Step 2: Reference it in the webhook**
```json
{
  "map": {
    "identifiers": { "key": "product-export" }
  }
}
```

**Requirements for the mapped type reference:**
- The mapped type must exist (lookup by `identifiers.key`)
- The mapped type must have `active: true` — inactive mapped types are skipped
- Only the key reference is used; any inline body in the webhook `map` field is ignored

See [Mapped Types](mapped-types.md) for the full selector language.

### 3. Send to External Endpoint (`out`)

Each transformed item is sent to the external endpoint:
```json
{
  "out": {
    "method": "POST",
    "url": "https://external-api.example.com/products",
    "auth": {
      "basic": { "username": "api", "password": "secret" }
    }
  }
}
```

The webhook sends each item as a separate request with `Content-Type: application/json`.

### 4. Apply Post-Sync Actions (`then`)

After successful delivery, the `then.set` object is applied to each source object as a normal unit setter:
```json
{
  "then": {
    "set": {
      "identifiers": {
        "com.myapp.synced": "true"
      }
    }
  }
}
```

This allows you to mark objects as synced or update tracking fields.

**Supported mutation paths:**
- **External identifiers**: `identifiers.com.myapp.synced` — set custom identifier values
- **Defined members**: Any writable member on the source type (e.g., `name`, `status`)
- **Pre-defined dynamic properties**: Top-level namespaced keys that have been defined via `properties.dynamic` (e.g., `com.myapp.lastSynced` if that property has been created on the type)

> **Important:** `properties.dynamic.com.example.synced` is **not valid**. The `properties` member exposes metadata about defined properties, not actual values. To set a namespaced dynamic property value, use it as a top-level key (e.g., `"com.myapp.synced": "2024-01-15"`) — but only if the property has been pre-defined via `properties.dynamic`.

### 5. Reschedule

If `repeat` is `true`, the webhook reschedules based on the `when` expression. If `repeat` is `false`, the webhook sets `when` to `"never"` after completion.

---

## Scheduling with `when`

The `when` field contains an API request URL that returns a date-time value. The webhook uses this to determine when to run next.

**Common patterns:**

```bash
# Run 5 seconds from now (useful for testing)
api/v1/now/+=0:0:5

# Run 24 hours from now
api/v1/now/+=24:0:0

# Run at next midnight (cron expression: use underscores for spaces)
api/v1/now/0_0_*_*_*

# Run at a specific time each day (stored in config)
api/v1/config/com.myapp.sync-time/value
```

**Supported date-time syntax:**
- **Relative**: `+=HH:MM:SS` or `-=HH:MM:SS` (add/subtract time)
- **Cron expressions**: Use underscores instead of spaces (e.g., `0_0_*_*_*` for midnight)
- **ISO 8601 dates**: Absolute timestamps

> **Note:** There is no `floor(...)` operator. Use cron expressions for scheduling at specific times of day.

The date-time result determines the next execution. If the webhook fails to resolve the schedule, it sets `error` and stops (`when` becomes `"never"`).

---

## Execution Semantics

### Authorization Check

Before execution, the webhook validates that `authorizedScopes` is non-empty. If no scopes are authorized:
- The webhook **cannot be scheduled or executed**
- An error is recorded: `"<name> could not be scheduled: No authorized scopes"`
- `when` is set to `"never"` (webhook stops)

### Schedule Resolution (`when`)

The `when` field is resolved as an API URL that returns a date-time. If resolution fails:
- An error is recorded with details about the failure
- `when` is set to `"never"` (webhook stops)

Invalid `when` expressions (e.g., URLs that don't return a date-time) immediately stop the webhook.

### Retries & Failure Handling

Failures are handled in two layers — a **per-request transient retry** inside a single run (fires only for internal-target operations that hit a known-transient transactor error), and the **task-scheduler retry** that reschedules the whole webhook after the run finishes.

#### Per-request transient retry (internal targets)

When the `out.http.url` is an internal API path (starts with `api/v1/...`), each per-item operation transparently retries two known-transient transactor errors before the failure escapes to the task-scheduler layer. Both errors arrive at the webhook as a wrapped 500 response whose body looks like:

```json
{ "error": "Internal server error.", "details": "<marker>" }
```

| Marker (in `details`) | When it fires | Operator log substring |
|---|---|---|
| `The transaction conflicted with another transaction` | Optimistic-lock collision: two writers contended for the same target. | Same string — search logs for `"transaction conflicted"`. |
| `Unexpected error: -2` | The per-item transaction's read snapshot aged out under load (the read-side history rolled past the transaction's start generation). | Same string — search logs for `"Unexpected error: -2"`. |

Both retry up to **`webhookTransientRetryMaxAttempts`** times (default **50**) with a flat **`webhookTransientRetryDelayMs`** delay (default **3000 ms**) between attempts. The implicit per-operation ceiling is `maxAttempts × delayMs` — **150 s** at the defaults — after which the error propagates to the task-scheduler retry layer below.

**External (`http://...`) targets do not engage this retry** — conflict and stale-snapshot semantics don't apply across the network. The existing 401-refresh path on external targets is independent and unaffected by these knobs.

Both knobs are **system-wide** on the API configuration (no per-webhook override). Tune them via `/v1/config/api`:

```bash
# Inspect current values
curl -X GET -u ":banana" \
  "https://example.app.heads.com/api/v1/config/api~just(webhookTransientRetryMaxAttempts,webhookTransientRetryDelayMs)"

# Update both (operators only)
curl -X PATCH -u ":banana" \
  "https://example.app.heads.com/api/v1/config/api" \
  -H "Content-Type: application/json" \
  -d '{
    "webhookTransientRetryMaxAttempts": 20,
    "webhookTransientRetryDelayMs": 5000
  }'
```

> **Don't disable the retry.** Setting `webhookTransientRetryMaxAttempts: 0` reverts to the old fail-fast behaviour, which forces the task-scheduler layer to absorb every transient flake. The scheduler's fast back-off (below) was sized assuming this inner retry catches the common case; bypassing it produces noisier pauses and more `attempts`-counter churn without any throughput gain.

#### Task-scheduler retry (whole run)

When a run finishes with an error — either because the failure wasn't transient, or because the per-request retry budget above was exhausted — the scheduler reschedules the whole webhook:

1. **Error recorded** — The `error` field is set with `"Error while executing: <message>"`.
2. **Attempts incremented** — The `attempts` counter increases by 1.
3. **Retry scheduled** — If `attempts < maxAttempts`:
   - **Transient errors** (the two markers above): retry **10 s** later.
   - **All other errors**: retry **60 s** later.
4. **Stopped** — If `attempts >= maxAttempts`, the webhook stops (`when` becomes `"never"`).

A sustained contention storm — every per-request retry exhausted, run after run — still increments `attempts` and eventually exhausts `maxAttempts`, pausing the webhook. The two layers compose; they don't shield each other from the `maxAttempts` ceiling.

### Successful Execution

On success:
- `attempts` is reset to **0**
- `error` is cleared
- `lastStart`, `lastFinished`, and `lastSuccess` are updated
- If `repeat` is `true`: the webhook reschedules using `when`
- If `repeat` is `false`: `when` is set to `"never"` (one-time execution complete)

### Resume After Failure

When the `out` request is marked `idempotent: true` **and** the `in` request uses `cursor` or `linkHeader` pagination, the webhook can resume an interrupted run from the page boundary it failed on rather than restarting from page 1.

How it works:

1. After each successful page push, the engine snapshots the active continuation token into `resumeState`.
2. If a subsequent page fails, retries pick up from the snapshot rather than re-running pages 1..N-1.
3. On the first fully-successful run, `resumeState` is cleared.
4. To force a full restart (e.g. after upstream data changes invalidate the cursor), call [`clearProgress`](#operator-methods).

`out.idempotent` defaults to `false`. Internal COS PUTs are always idempotent regardless. External POST targets need explicit confirmation that re-sending items 1..N-1 of a failed page won't duplicate side-effects: opt in by setting `out.http.idempotent: true` (or `out.idempotent: true` in the legacy flat form).

**TDS targets do not support resume-from-failure** — the entire batch is re-sent on the next attempt, regardless of where in the batch it failed. Integrators using TDS should ensure their target schema is idempotent (e.g. `MERGE` statements rather than blind `INSERT`s), or accept the duplicate-write risk on retries.

```bash
# Inspect a stalled run's resume snapshot
curl -X GET -u ":banana" \
  "https://example.app.heads.com/api/v1/sync-webhooks/com.myapp.id=my-webhook~with(resumeState)"

# Force the next run to start from page 1
curl -X POST -u ":banana" \
  "https://example.app.heads.com/api/v1/sync-webhooks/com.myapp.id=my-webhook/clearProgress"
```

### Common Failure Causes

- **No authorized scopes** - `authorizedScopes` is empty or unset
- **External endpoint failure** - Non-2xx status from `out.url`
- **Authentication failure** - Invalid or expired credentials
- **Invalid `in` query** - Unauthorized scopes or malformed URL
- **Invalid `when` expression** - URL doesn't return a date-time

---

## Security & Safety

### Authorized Scopes

Sync webhooks run with restricted permissions. The `authorizedScopes` field defines which API scopes the webhook can use. These are intersected with the creating client's scopes.

```json
{
  "authorizedScopes": ["read:products", "write:products"]
}
```

If no scopes are authorized, the webhook cannot execute.

### Credential Security

- **Never log credentials** - Passwords, secrets, and tokens are masked in logs (`********`)
- **Use OAuth 2.0** when possible - Tokens are cached and refreshed automatically
- **Avoid secrets in `in` URLs** - Use authorized scopes instead of embedded credentials
- **Scope hygiene** - Only authorize the minimum scopes needed

### Payload Safety

- Ensure external endpoints use HTTPS
- Validate that `out` URLs point to trusted destinations
- Review mapped type transformations to avoid leaking sensitive data

---

## Examples

### Minimal Sync: Push Inventory to External API

Push latest inventory items to an external system without any transformation:

```json
{
  "identifiers": { "com.example.syncId": "inventory-push" },
  "name": "Inventory Push",
  "description": "Push latest inventory items to external system",
  "when": "api/v1/now/+=0:5:0",
  "repeat": true,
  "in": {
    "url": "api/v1/products~with(stockLevels)"
  },
  "out": {
    "method": "POST",
    "url": "https://example.com/webhooks/inventory",
    "auth": {
      "authorizationHeader": "Bearer REPLACE_WITH_TOKEN"
    }
  },
  "authorizedScopes": ["read:products"],
  "verboseLogging": false
}
```

### Full Example: Map, Sync, and Mark as Synced

A complete webhook with mapping, retries, and post-sync mutation. First, create the mapped type:

**Step 1: Create the mapped type**
```bash
POST /v1/mapped-types
{
  "identifiers": { "key": "people-export" },
  "active": true,
  "body": {
    "externalId": "identifiers/com.example.personId",
    "fullName": "givenName + ' ' + familyName",
    "email": "contactMethods/email/address",
    "mainAddress": "addresses/main"
  }
}
```

**Step 2: Create the webhook referencing the mapped type**
```json
{
  "identifiers": { "com.example.syncId": "people-sync" },
  "name": "People Sync",
  "description": "Map people into external schema and mark synced flag",
  "when": "api/v1/now/+=0:10:0",
  "repeat": true,
  "maxAttempts": 3,
  "in": {
    "url": "api/v1/people~with(identifiers,addresses,contactMethods)"
  },
  "map": {
    "identifiers": { "key": "people-export" }
  },
  "out": {
    "method": "POST",
    "url": "https://example.com/webhooks/people",
    "auth": {
      "basic": { "username": "api", "password": "REPLACE_WITH_PASSWORD" }
    }
  },
  "then": {
    "set": {
      "identifiers": {
        "com.example.syncedAt": "2024-01-15T10:00:00Z"
      }
    }
  },
  "authorizedScopes": ["read:people", "write:people"],
  "verboseLogging": true
}
```

### Testing with a Sandbox Endpoint

For development and testing, use a request logging service:

```json
{
  "identifiers": { "com.myapp.id": "test-webhook" },
  "name": "Test Webhook",
  "when": "api/v1/now/+=0:0:10",
  "repeat": false,
  "in": {
    "url": "api/v1/products~take(5)"
  },
  "out": {
    "method": "POST",
    "url": "https://webhook.site/your-unique-id"
  },
  "authorizedScopes": ["read:products"],
  "verboseLogging": true
}
```

**Tips for testing:**
- Use `verboseLogging: true` to see detailed execution logs
- Set `repeat: false` for one-time test runs
- Use short `when` intervals (e.g., `+=0:0:10` for 10 seconds)
- Check the `error` field if the webhook stops unexpectedly

### OAuth 2.0 Client Credentials Authentication

For outgoing requests that require OAuth 2.0 client credentials:

```json
{
  "method": "POST",
  "url": "https://example.com/webhooks/sync",
  "auth": {
    "clientCredentials": {
      "tokenUrl": "https://example.com/oauth2/token",
      "client_id": "REPLACE_WITH_CLIENT_ID",
      "client_secret": "REPLACE_WITH_CLIENT_SECRET",
      "scope": "webhook.write"
    }
  }
}
```

The webhook automatically fetches and caches access tokens, refreshing them when they expire.

### Per-Webhook Variables in URL Templates

Per-webhook `variables` (see [Per-webhook Configuration Store](#per-webhook-configuration-store)) let you parameterise URL templates with non-sensitive configuration that varies per environment — base URLs, page sizes, tenant codes, region selectors, feature flags. Values round-trip verbatim, so integrators can read them back to verify configuration.

```bash
# Set per-environment variables on the webhook
curl -X PATCH -u ":banana" \
  "https://example.app.heads.com/api/v1/sync-webhooks/com.example.id=product-sync" \
  -H "Content-Type: application/json" \
  -d '{
    "variables": {
      "com.example.tenantCode": "ACME",
      "com.example.pageSize": 100
    }
  }'

# The webhook's `in.url` references them via the variables lookup
# → resolves to:  https://api.vendor.example.com/products?tenant=ACME&limit=100
curl -X PATCH -u ":banana" \
  "https://example.app.heads.com/api/v1/sync-webhooks/com.example.id=product-sync" \
  -H "Content-Type: application/json" \
  -d '{
    "in": {
      "url": "https://api.vendor.example.com/products?tenant={api/v1/context/webhook/variables/com.example.tenantCode}&limit={api/v1/context/webhook/variables/com.example.pageSize}",
      "method": "GET"
    }
  }'
```

For sensitive values (tokens, passwords) use `secrets` instead — same shape, but masked in API responses.

### Pause and Stop Behavior

To pause or stop a webhook:

- **Pause/stop:** Set `"when": "never"` to prevent further executions
- **One-time run:** If `repeat` is `false`, the webhook automatically sets `when` to `"never"` after a successful run
- **Resume:** Set `when` to a valid schedule expression (e.g., `"api/v1/now/+=0:5:0"`) to restart

```bash
# Pause a webhook
PATCH /v1/sync-webhooks/com.example.syncId=my-webhook
{ "when": "never" }

# Resume a webhook
PATCH /v1/sync-webhooks/com.example.syncId=my-webhook
{ "when": "api/v1/now/+=0:5:0" }
```

---

## Troubleshooting

### Webhook Not Running

| Symptom | Cause | Solution |
|---------|-------|----------|
| `when` is `"never"` | Webhook stopped due to error or exhausted attempts | Check `error` field, fix the issue, reset `when` |
| `next` is in the past | Task queue delay or system restart | The webhook will run on next queue processing |
| No `authorizedScopes` | Missing or empty scopes | Add required scopes to `authorizedScopes` |

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `"<name> could not be scheduled: No authorized scopes"` | `authorizedScopes` is empty or unset | Add required scopes to `authorizedScopes` |
| `"Error while executing: The WebHook has no authorized scopes. It cannot run."` | Scopes became empty after creation | Re-add scopes |
| `"Error while executing: Request to {url} with item N in sequence failed with: {status}: {statusText} – {body}"` | External endpoint returned non-2xx status | Check `out.auth` credentials and external API permissions |
| `"Error while getting date for 'when' using URI '{whenUri}': The response was not a date. Result was: {result}. Could be a permissions issue..."` | Invalid `when` expression | Ensure `when` URL returns a date-time value, or check authorized scopes |
| `"Invalid configuration for client credentials. Missing tokenUrl, client_id"` | Missing OAuth fields | Provide all required fields: `tokenUrl`, `client_id`, `client_secret`, `scope` |
| `"Invalid configuration for basic auth. Missing password."` | Basic auth without password | Provide the password field |

### Checking Status

```bash
# View webhook configuration and status
GET /v1/sync-webhooks/com.myapp.id=my-webhook

# Check specific fields
GET /v1/sync-webhooks/com.myapp.id=my-webhook~just(error,attempts,last,next,when)
```

### Resetting a Failed Webhook

To restart a webhook that stopped due to errors:

```bash
# Reset attempts and set a new schedule
PATCH /v1/sync-webhooks/com.myapp.id=my-webhook
{
  "attempts": 0,
  "when": "api/v1/now/+=0:0:30"
}
```

---

## Related Documentation

- [Mapped Types](mapped-types.md) - Data transformation for sync webhooks
- [Query Operators](operators.md) - Filter and transform data in `in` requests
- [Pagination](pagination.md) - Pagination for the CommerceOS API itself (vs. external API pagination configured on `in` requests)
- [Overview](overview.md) - API authentication and basics
