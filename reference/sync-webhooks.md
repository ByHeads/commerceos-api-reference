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
| `out` | request | The external request to send transformed data |
| `map` | mapped type | Reference to a mapped type for data transformation |
| `then` | object | Actions to perform on source objects after successful sync |

### Scheduling

| Field | Type | Description |
|-------|------|-------------|
| `when` | string | API request URL that returns a date-time for the next run |
| `repeat` | boolean | Whether to reschedule after each successful run |
| `next` | date-time (read-only) | The next scheduled execution time |
| `last` | date-time (read-only) | The last execution time |

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
| `verboseLogging` | boolean | Enable detailed logging for debugging |

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

When a webhook execution fails:

1. **Error recorded** - The `error` field is set with `"Error while executing: <message>"`
2. **Attempts incremented** - The `attempts` counter increases by 1
3. **Retry scheduled** - If `attempts < maxAttempts`, a retry is scheduled for **60 seconds** later
4. **Stopped** - If `attempts >= maxAttempts`, the webhook stops (`when` becomes `"never"`)

### Successful Execution

On success:
- `attempts` is reset to **0**
- `error` is cleared
- If `repeat` is `true`: the webhook reschedules using `when`
- If `repeat` is `false`: `when` is set to `"never"` (one-time execution complete)

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
