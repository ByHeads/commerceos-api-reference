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
4. **Mutate** - Apply `then` actions: write back to the source objects, and/or write to other resources as side effects
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
| `then` | object | Actions to perform after successful sync. Keys in `then.set` that look like a resource path become side-effect writes against that resource; all other keys are written back onto the source object. See [`then.set` key routing](#thenset-key-routing). |

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

These are the only per-webhook retry controls. The retry *timings* — the per-request stale-snapshot budget, the concurrency window, and the recovery cadence — are tenant-wide on the `API config` singleton; see [System Configuration](#system-configuration-v1configapi).

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

- **Keys must be namespaced, and this is the one place in the API that says so out loud.** A key that is not [exactly three dot-separated segments](overview.md#external-identifiers) (e.g. `com.example.tenantCode`) is rejected with a `400` naming it, and the **whole request fails** — a payload mixing valid and invalid keys lands none of it, on either map:

  ```
  POST /v1/sync-webhooks
  [{"identifiers": {…}, "secrets": {"com.test.good": "A", "com.example.orders.id": "B"}}]
  → 400  Invalid secret key 'com.example.orders.id'. Keys must be namespaced — exactly three
         dot-separated segments (e.g. `com.example.thing`), matching the schema's
         `namespaced key` type. A fourth segment is rejected just as a missing one is.
  ```

  Do not generalise from this. Everywhere else — `identifiers` on every resource, this one included — the same key is [silently discarded at `200`](overview.md#a-malformed-identifier-key-is-discarded-not-rejected), which is the behaviour to design against.
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
| `abort` | Stop the run that is executing **right now**. Rejected with `400` when no run is in flight — to stop *future* runs, pause the webhook instead. Cancellation is cooperative and the aborted run does not count as a failure. See [Aborting a Run in Progress](#aborting-a-run-in-progress). |

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

# Stop the run that is currently executing.
curl -X PATCH -u ":banana" \
  "https://example.app.heads.com/api/v1/sync-webhooks/com.myapp.id=my-webhook" \
  -H "Content-Type: application/json" \
  -d '{"abort": true}'
```

### Sync-State Fields

| Field | Type | Description |
|-------|------|-------------|
| `resumeState` | object (read-only) | The pending resume snapshot, if any. Empty when there's no interrupted run to resume — i.e. either the webhook hasn't run, the last run completed cleanly, or its `out` request isn't marked `idempotent`. When present, contains the strategy that was active and the saved continuation token (`cursor` resolved request fragments, or `linkHeader` / `nextUrl` URL). Use it to diagnose stalled paginated runs; clear with `clearProgress` to force a full restart. See [Resume After Failure](#resume-after-failure). |
| `inFlightSince` | date-time (read-only) | When the currently-running run claimed the webhook, or empty when no run is in flight. Refreshed as a heartbeat while the run proceeds, so it is the best "is this webhook alive right now?" signal — unlike `last`, which records the *start* of the last attempt and never advances mid-run. Unaffected by `reset` and `catchUp`. How long a stale value keeps the slot locked is governed by `webhookInFlightWindowMs`; see [System Configuration](#system-configuration-v1configapi). |
| `abortRequestedAt` | date-time (read-only) | When an operator last requested an [`abort`](#aborting-a-run-in-progress), or empty when there is no pending request. A non-empty value means the abort has been recorded but the run has not yet reached the checkpoint where it stops. Consumed (cleared) when the targeted run ends, or when a fresh run claims the slot — so a request can never spill over and cancel a later run. |

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
| `wrapBody` | string | Optional. Set to `"array"` to wrap a non-array request body in a single-element JSON array immediately before the request is sent. Honored on **both** `in` and `out.http`. See [Request Body Wrapping](#request-body-wrapping). |
| `fail` | object | Optional per-item failure policy. Honored only on `out.http`. Maps HTTP status codes (`"404"`) or class wildcards (`"4xx"`, `"5xx"`) to `"skip"` or `"stop"`. See [Request Failure Policy](#request-failure-policy). |

**Notes:**
- **`in` uses only `url`** — `method`, `headers`, and `body` are ignored
- **`out.body` is ignored** — the payload is always the mapped (or unmapped) item JSON
- **Content-Type defaults to `application/json;charset=utf-8`** — but `out.headers["Content-Type"]` can override it (custom headers are merged after the default)
- **`fail` is honored only on `out.http`** — ignored on the `in` request and on `out.tds` targets
- **`then.set` runs per item** even when `out` is omitted (for mutation-only workflows)
- **`then.set` keys are routed by shape** — resource-path keys write to other resources, everything else writes back to the source object. See [`then.set` key routing](#thenset-key-routing).

### Request Body Wrapping

Some target APIs require an array envelope around the request body even when sending a single item. Set `wrapBody: "array"` on the request to have the webhook wrap the body in a single-element JSON array immediately before sending.

- **Only value supported:** `"array"`. Omitting `wrapBody` (or setting any other value) leaves the body unchanged.
- **Idempotent.** A body that is already a JSON array (or absent/null) is sent unchanged. Setting `wrapBody: "array"` twice — or on an already-array body — is a no-op; the wrap happens at most once.
- **Scope.** Honored uniformly on:
  - The `in` request body — both `body` and `resolveBody` participate. For paginated `in` requests, pagination body-overrides are shallow-merged first and the merged object is then wrapped.
  - The `out.http` request body — the mapped output (or `resolveBody`) is wrapped before delivery. Applies to both internal `api/v1/...` targets and external HTTP targets.

**Example — `out` delivering single items in an array envelope:**

```json
{
  "out": {
    "http": {
      "method": "POST",
      "url": "https://api.example.com/v1/products/import",
      "wrapBody": "array"
    }
  }
}
```

Each mapped product `{ "sku": "X", "name": "..." }` is POSTed as `[{ "sku": "X", "name": "..." }]`.

**Example — `in` POST-search whose endpoint requires an array body:**

```json
{
  "in": {
    "method": "POST",
    "url": "https://api.example.com/v1/search",
    "body": { "query": "active" },
    "wrapBody": "array"
  }
}
```

The fetch is sent with body `[{ "query": "active" }]`.

### Request Failure Policy

By default, any 4xx or 5xx response from the `out.http` target aborts the entire webhook run — the failing item and every remaining item in the batch are left undelivered, and the task scheduler retries the whole run (see [Retries & Failure Handling](#retries--failure-handling)). Some integrations need to tolerate specific statuses instead — e.g. a `404 Not Found` on a target where the upstream resource has been removed should typically be skipped, not abort the rest of the batch.

Set `fail` on the `out.http` request to declare which statuses skip vs. stop:

```json
{
  "out": {
    "http": {
      "method": "PUT",
      "url": "https://api.example.com/v1/products/{identifiers/com.example.sku}",
      "fail": { "404": "skip", "4xx": "stop", "5xx": "stop" }
    }
  }
}
```

**Keys** are either an exact HTTP status code as a string (e.g. `"404"`, `"409"`, `"503"`) or a status-class wildcard (`"4xx"`, `"5xx"`, lowercase).

**Values** are one of:

| Value | Behaviour |
|-------|-----------|
| `"skip"` | Log the failure and continue with the next item. The failed item is **not** delivered, and its `then.set` is **not** applied. |
| `"stop"` | Abort the whole webhook run. This is the historical / default behavior. |

**Precedence.** An exact status code wins over a wildcard. Any status not matched by an exact key or a wildcard key defaults to `"stop"`. Omitting `fail` entirely ⇒ every 4xx/5xx stops (the unchanged default, equivalent to `{ "4xx": "stop", "5xx": "stop" }`).

**Scope and limits:**

- **`out.http` only.** Set on the `in` request or on `out.tds`, `fail` is ignored.
- **Network-level failures always stop.** Connection refused, DNS resolution failures, request timeouts — anything that prevents an HTTP response from coming back — abort the run regardless of `fail`. The policy is about HTTP status codes, not transport errors.
- **TDS targets always stop.** The `out.tds` writer has no per-item failure granularity.
- **401 refresh runs first.** For auth schemes that cache credentials (e.g. [`clientCredentials`](#authentication-options), [`customSignin`](#authentication-options)), a `401 Unauthorized` first triggers a one-shot credential refresh + retry. `fail` is only consulted if the *retried* response is still an error.

**Example — best-effort delivery (skip all client errors, stop on server errors):**

```json
{
  "out": {
    "http": {
      "method": "POST",
      "url": "https://api.example.com/v1/ingest",
      "fail": { "4xx": "skip", "5xx": "stop" }
    }
  }
}
```

> **Skipped items don't get `then.set` applied.** If `then.set` is what marks items as synced, a skipped delivery means the source object will be picked up again by the next run's `in` query. Scope the `in` query so items that will be skipped (e.g. a deleted-upstream 404) are also filtered out of future runs, or accept that they re-appear and re-skip on each run.

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

**Custom Signin (vendor-specific handshake):**

Use `customSignin` when the vendor requires a signin handshake that returns credentials to be replayed on subsequent requests — e.g. a token endpoint that returns an access token plus a TTL, or a non-OAuth login that returns a session key. The webhook performs the signin request, evaluates the `scheme` expressions against the JSON response, then writes the resulting `Authorization` header on every subsequent request to `out.url` (or `in.url`).

```json
{
  "auth": {
    "customSignin": {
      "method": "POST",
      "signinUrl": "https://api.example.com/oauth/token",
      "headers": { "Content-Type": "application/x-www-form-urlencoded" },
      "body": "grant_type=password&username=...&password=...",
      "scheme": { "bearer": "accessToken" },
      "tokenExpirationSeconds": "expiresIn"
    }
  }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `method` | yes | HTTP method for the signin request (e.g. `GET`, `POST`, `PUT`). |
| `signinUrl` | yes | The signin endpoint URL. |
| `headers` | no | Headers sent with the signin request. |
| `body` | no | Request body sent with the signin request. |
| `scheme` | yes | How to format the response into the outgoing `Authorization` header — see below. |
| `tokenExpirationSeconds` | no | Expression evaluated against the signin response for the cache TTL (in seconds). Defaults to **3600** when omitted or when the expression doesn't resolve to a positive number. |

**`scheme` variants — exactly one must be set:**

| Variant | Outgoing header | Use when |
|---------|-----------------|----------|
| `scheme.bearer: "<expression>"` | `Authorization: Bearer <resolved>` | The vendor returns a token that should ride on a bearer header. |
| `scheme.basic: { user: "<expression>", password: "<expression>" }` | `Authorization: Basic <base64(user:password)>` | The vendor expects the dynamically-fetched credential on a Basic header — e.g. the token as the password with a fixed username. |

Setting neither (or both) is rejected at execution time.

**Expression mini-language.** Each expression slot in `scheme` and `tokenExpirationSeconds` is evaluated against the **signin response JSON** using the same path syntax as `resultSelector`:

| Expression | Resolves to |
|------------|-------------|
| `accessToken` | The top-level `accessToken` field of the response. |
| `data/token` | Nested path: `response.data.token`. |
| `'0'` (single-quoted) | The literal string `"0"`. |
| `'7200'` | The literal string `"7200"` (used in `tokenExpirationSeconds` for a fixed TTL). |

If an expression fails to resolve, the webhook records an error and the run stops.

**Example — token as the Basic password, literal `"0"` as the username:**

Some vendors (e.g. Tripletex) issue a session token via a signin endpoint and expect it as the password on a Basic header, with a fixed username (often `"0"`). The signin response carries the token at `value/token`:

```json
{
  "auth": {
    "customSignin": {
      "method": "PUT",
      "signinUrl": "https://api.tripletex.io/v2/token/session/:create?consumerToken=...&employeeToken=...&expirationDate=...",
      "scheme": {
        "basic": {
          "user": "'0'",
          "password": "value/token"
        }
      },
      "tokenExpirationSeconds": "'3600'"
    }
  }
}
```

Given a response of `{ "value": { "token": "abc123", ... } }`, the webhook resolves `user` to `"0"` (literal) and `password` to `"abc123"` (path lookup), then sends `Authorization: Basic <base64("0:abc123")>` on every subsequent request.

**Token caching.** The full `Authorization` header value (`Bearer ...` or `Basic ...`) is cached per `out.url` for `tokenExpirationSeconds` seconds (default 3600). The cache is invalidated on a 401 from the target — a fresh signin handshake runs and the next request is retried with the new header.

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

| Field         | Strategy                | Description |
|---------------|-------------------------|-------------|
| `selector`    | `nextUrl`               | **Required.** Path in the response body to the next-page URL (e.g., `nextRecordsUrl`, `@odata.nextLink`). |
| `rel`         | `linkHeader`            | Link relation to follow. **Default: `"next"`.** |
| `stableOrder` | `pageNumber`, `offset`  | Opt in to [resume-from-failure](#resume-after-failure) on positional strategies. **Default: `false`.** Asserts that already-paginated pages stay frozen across attempts — see the [`stableOrder` contract](#the-stableorder-contract) before enabling. Ignored on `cursor` / `linkHeader` / `nextUrl` (their resume identity is intrinsic to the server-issued continuation token). |

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

After successful delivery, the `then.set` object is applied:
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

#### `then.set` key routing

Every key in `then.set` is classified by its **shape**, and that classification decides where the value is written:

| Key shape | Where the value goes |
|-----------|----------------------|
| A **resource path** — the key starts with `/`, `~`, `$`, or the API base `api/…` | Applied as a **side-effect write** against that target resource |
| **Anything else** (member names, `identifiers`, namespaced property keys) | Collected into a single value object that is written back onto the **source object** — the record selected by `in` |

Both kinds are applied in the same transaction, so a run either records its side effects and its source-object bookkeeping together, or neither.

A single `then.set` can mix both. The following clears a flag on the source product *and* creates child stock entries in one pass:

```json
{
  "then": {
    "set": {
      "api/v1/stock-entries": "$this~map(com.myapp.inbound-stock-entry)~array",
      "com.myapp.stockSyncRequested": false
    }
  }
}
```

- `api/v1/stock-entries` → starts with the API base, so it is a **side-effect write**: the mapped array is posted to that collection.
- `com.myapp.stockSyncRequested` → an ordinary key, so it is **patched onto each selected source product**.

#### Writing back to the source object

**Supported mutation paths:**
- **External identifiers**: `identifiers.com.myapp.synced` — set custom identifier values
- **Defined members**: Any writable member on the source type (e.g., `name`, `status`)
- **Pre-defined dynamic properties**: Top-level namespaced keys that have been defined via `properties.dynamic` (e.g., `com.myapp.lastSynced` if that property has been created on the type)

> **Important:** `properties.dynamic.com.example.synced` is **not valid**. The `properties` member exposes metadata about defined properties, not actual values. To set a namespaced dynamic property value, use it as a top-level key (e.g., `"com.myapp.synced": "2024-01-15"`) — but only if the property has been pre-defined via `properties.dynamic`.

#### Side-effect writes to other resources

The value of a resource-path key is a resolver expression, evaluated the same way mapped-type selectors are. Two context references matter here, and they are **not** the same as in the `map` step:

| Reference | Resolves to |
|-----------|-------------|
| `$this` | The **`out` response data** — what the delivery request returned |
| `$prior` | The **source object** — the record selected by `in` that this item came from |

So a side-effect key that needs the response body (e.g. an external ID the target just allocated) reads it from `$this`; a side-effect key that needs the original record reaches back through `$prior`.

> **Note:** When the `out.http` response is fanned out into several elements (via `out.http.resultSelector`), `$this` is the **individual element** currently being processed, not the whole response body.

> **The operator is `~array`, not `~arr`.** [`~array`](operators-catalog.md#array) builds a list from the value piped into it **and/or** its arguments: a value gives `[value]`, which is what a collection target such as `api/v1/stock-entries` expects, and each argument — a resource selector or a single-quoted literal — contributes one more element in the order written. Piping a value in, as here, is the usual form; a chain that pipes in nothing at all answers `[]`. There are no operator aliases. An unknown or misspelled operator does **not** raise an error — it silently resolves to an empty value, so `~arr` drops the mapped payload and writes nothing, with no entry in the run log. This is a common cause of "the webhook reports success but no records were written." See [Misspelled Operators Fail Silently](common-gotchas.md#24-misspelled-operators-fail-silently).

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

When the `out.http.url` is an internal API path (starts with `api/v1/...`), a per-item operation that fails with a **stale-snapshot** error is transparently re-issued on a fresh transaction before the failure escapes to the task-scheduler layer. The error surfaces to the webhook as a wrapped 500 response whose body looks like:

```json
{ "error": "Internal server error.", "details": "Unexpected error: -2" }
```

It means the per-item transaction's read snapshot aged out under load — the read-side history rolled past the transaction's start generation. Search operator logs for `"Unexpected error: -2"` or `"transaction-too-old"`.

The operation retries up to **`internalTooOldMaxRetries`** times (default **50**) with a flat **`internalTooOldRetryDelayMs`** delay (default **3000 ms**) between attempts. The implicit per-operation ceiling is `maxRetries × delayMs` — **150 s** at the defaults — after which the error propagates to the task-scheduler retry layer below.

**Optimistic-lock conflicts are not retried here.** A conflict (`"The transaction conflicted with another transaction"` in `details`) is auto-retried by the transactor itself on the normal write path; when it does escape — the upsert-PUT-to-a-potential-target case, where auto-retry is off — it goes straight to the task-scheduler layer and takes the fast **10 s** reschedule described below. The `internalTooOld*` knobs have no effect on it.

**External (`http://...`) targets do not engage this retry** — stale-snapshot semantics don't apply across the network. The 401-refresh path on external targets is independent and unaffected by these knobs, as is the unreachable-target retry.

Both knobs are **system-wide** on the API configuration (no per-webhook override) — see [System Configuration](#system-configuration-v1configapi) for the full set and for tuning examples.

> **Don't disable the retry.** Setting `internalTooOldMaxRetries: 0` reverts to fail-fast, which forces the task-scheduler layer to absorb every transient flake. The scheduler's fast back-off (below) was sized assuming this inner retry catches the common case; bypassing it produces noisier pauses and more `attempts`-counter churn without any throughput gain.

#### Task-scheduler retry (whole run)

When a run finishes with an error — either because the failure wasn't transient, or because the per-request retry budget above was exhausted — the scheduler reschedules the whole webhook:

1. **Error recorded** — The `error` field is set with `"Error while executing: <message>"`.
2. **Attempts incremented** — The `attempts` counter increases by 1.
3. **Retry scheduled** — If `attempts < maxAttempts`:
   - **Transient transactor errors** (stale snapshot, or an escaped optimistic-lock conflict): retry **10 s** later.
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

### Aborting a Run in Progress

A long-running webhook — a full catalogue sync started by mistake, a paginated run walking far more pages than expected, a delivery loop hammering a target that is having a bad day — can be stopped mid-flight with the [`abort`](#operator-methods) method:

```bash
curl -X PATCH -u ":banana" \
  "https://example.app.heads.com/api/v1/sync-webhooks/com.myapp.id=my-webhook" \
  -H "Content-Type: application/json" \
  -d '{"abort": true}'
```

`abort` acts on the **current execution only**. It is not a pause: the webhook keeps its schedule and will run again at its next `when`.

#### It only works while a run is in flight

The call is rejected with **`400`** when nothing is currently running — that is, when [`inFlightSince`](#sync-state-fields) is empty or has already gone stale (older than `webhookInFlightWindowMs`, see [Concurrency guard](#concurrency-guard--webhookinflightwindowms)). There is no "abort the next run" queueing; a request that found no run does not linger.

To stop *future* runs, pause the webhook instead — clear `when` (`null`) or set it to `"never"`; see [Pause and Stop Behavior](#pause-and-stop-behavior).

#### Cancellation is cooperative

The run is not killed. It is asked to stop, and it does so at its next checkpoint:

- between attempts of the [per-request transient retry](#per-request-transient-retry-internal-targets);
- between items of the `out` batch;
- between elements of a fanned-out `out` response (`out.http.resultSelector`);
- between page fetches of a paginated `in`.

Two consequences worth planning around:

- **An `out` request already on the wire is allowed to finish**, so its outcome is known and recorded rather than left ambiguous. Abort never leaves you wondering whether the last delivery landed.
- **A run sitting inside one long database resolve stops when that resolve completes or fails** — there is no checkpoint inside it. On a heavy `in` selection, expect the abort to take effect at the end of that step rather than instantly.

Between the request and the stop, [`abortRequestedAt`](#sync-state-fields) is non-empty. That is the signal that an abort is pending but the run has not reached its checkpoint yet.

#### An aborted run is not a failure

This is the part that matters for retry budgets and delta windows. An abort:

- **consumes no attempt** — `attempts` is untouched, so aborting repeatedly can never exhaust `maxAttempts` and pause the webhook;
- **does not stamp `lastFailed`**, and does not count as a failed run for health monitoring;
- **leaves the delta high-water mark alone** — `lastStart` is not advanced, so the next run re-covers the same window. At-least-once delivery is preserved: nothing selected by the aborted run is silently dropped, and items it had already delivered are delivered again (make sure the target tolerates that, the same way [resume](#resume-after-failure) requires).

The webhook then reschedules on its normal `when` cadence. Until the next clean run finishes, `error` reads:

```text
Previous run was aborted by operator request.
```

That string is informational — it records why the run ended, not that anything is broken.

#### Stopping a runaway webhook for good

Because an aborted run reschedules normally, aborting alone will not stop a webhook that is misbehaving every cycle. Pause first, then abort:

```bash
# 1. Take it off the schedule so nothing new starts.
curl -X PATCH -u ":banana" \
  "https://example.app.heads.com/api/v1/sync-webhooks/com.myapp.id=my-webhook" \
  -H "Content-Type: application/json" \
  -d '{"when": "never"}'

# 2. Stop the run that is still executing.
curl -X PATCH -u ":banana" \
  "https://example.app.heads.com/api/v1/sync-webhooks/com.myapp.id=my-webhook" \
  -H "Content-Type: application/json" \
  -d '{"abort": true}'
```

In that order the aborted run has no schedule to return to. Reverse the order and the webhook simply starts again on its next tick. To bring it back afterwards, restore the schedule directly or call [`reactivate`](#operator-methods).

### Resume After Failure

When the `out` request is marked `idempotent: true` **and** the `in` request uses a resumable pagination strategy, the webhook can resume an interrupted run from the page boundary it failed on rather than restarting from page 1.

#### Resumable strategies

| Strategy     | Resume eligibility |
|--------------|--------------------|
| `cursor`     | Resumable. The cursor is server-issued and intrinsically stable. |
| `linkHeader` | Resumable. The next-link URL is server-issued and intrinsically stable. |
| `nextUrl`    | Resumable. The next-page URL is server-issued and intrinsically stable. |
| `pageNumber` | Resumable **only when `stableOrder: true`** is set on the strategy block. See the [`stableOrder` contract](#the-stableorder-contract) below. |
| `offset`     | Resumable **only when `stableOrder: true`** is set on the strategy block. See the [`stableOrder` contract](#the-stableorder-contract) below. |

`cursor` / `linkHeader` / `nextUrl` do **not** need `stableOrder` — their resume identity is intrinsic to the server-issued continuation token. The flag belongs on positional strategies only.

#### How it works

1. After each successful page push, the engine snapshots the active continuation token (or, for positional strategies, the per-counter state) into `resumeState`.
2. If a subsequent page fails, retries pick up from the snapshot rather than re-running pages 1..N-1.
3. On the first fully-successful run, `resumeState` is cleared.
4. To force a full restart (e.g. after upstream data changes invalidate the cursor, or after realising `stableOrder` was set incorrectly), call [`clearProgress`](#operator-methods).

#### Engagement rules

For `cursor` / `linkHeader` / `nextUrl`, the single gate is `out.http.idempotent: true`. For `pageNumber` / `offset`, **both** of the following must hold — if either is absent, the next attempt restarts from page 1:

1. `out.http.idempotent: true` — the operator's promise that re-posting an item is safe.
2. `pagination.<strategy>.stableOrder: true` — the operator's promise that source-side order is stable across attempts (see the contract below).

`out.idempotent` defaults to `false`. Internal COS PUTs are always idempotent regardless. External POST targets need explicit confirmation that re-sending items 1..N-1 of a failed page won't duplicate side-effects: opt in by setting `out.http.idempotent: true` (or `out.idempotent: true` in the legacy flat form).

#### The `stableOrder` contract

> **`stableOrder: true` is your promise that pages you've already paginated through stay frozen across attempts.** Items added to the source since the last run must appear *after* everything we've already seen — never inserted into or before an already-paginated page.
>
> The canonical fit is a feed sorted on **timestamp ascending** (oldest first, append-only) — newly created items land at the tail and don't affect any prior offset.
>
> **Reverse-chronological / descending-timestamp feeds do NOT satisfy this.** New items prepend at the head and every page shifts by one — resuming at `page=3` after such a shift silently processes items the previous attempt already saw or (worse) skips items that have moved across a page boundary. Don't enable `stableOrder` for descending feeds.
>
> Other unsafe shapes: alphabetically/name-sorted feeds where inserts can fall anywhere; status-filtered feeds where items can enter or leave the result set between attempts; any feed whose total page count can shrink (deletes upstream).
>
> Drift caused by mis-setting this flag surfaces as **silent gaps or duplicates** in the `out` target, not as an error. The flag is an operator-asserted invariant; the platform does not — and structurally cannot — verify it.

**Safe — append-only feed with ascending timestamp:**

```jsonc
// GET /orders?page=N&sort=createdAt:asc — append-only feed
{
  "in": {
    "url": "https://api.example.com/orders?sort=createdAt:asc",
    "pagination": {
      "pageNumber": {
        "parameters": {
          "page": { "from": 1, "step": 1 },
          "limit": 100
        },
        "while": "items/length>=100",
        "stableOrder": true
      }
    }
  },
  "out": {
    "http": {
      "method": "POST",
      "url": "https://destination.example.com/orders",
      "idempotent": true
    }
  }
}
```

**Unsafe — do NOT enable on a descending feed:**

```jsonc
// GET /orders?page=N&sort=createdAt:desc — newest first
// Item 743 created between attempts → page 3 today != page 3 yesterday.
// Enabling stableOrder here silently corrupts the out target.
```

**Anti-patterns:**

- Don't set `stableOrder` on a descending-timestamp feed.
- Don't set `stableOrder` on a status-filtered feed where items can enter or leave the result set.
- Don't rely on `stableOrder` for a feed that supports upstream deletes.

If you realise `stableOrder` was set incorrectly, call [`clearProgress`](#operator-methods) to drop the now-misleading snapshot, then either remove the flag or re-sort the source feed before the next run.

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

## System Configuration (`/v1/config/api`)

A handful of sync-webhook timings are **system-wide**, not per-webhook. They live on the `API config` singleton at `GET /v1/config/api` and apply to every webhook on the tenant. There is no per-webhook override — the per-webhook knobs are `maxAttempts`, `repeat`, and `when` ([Retry Configuration](#retry-configuration), [Scheduling](#scheduling)).

All four fields are optional numbers. Leaving a field unset (or setting it to `null`) means "use the default"; the defaults are what a healthy deployment should run with, so change them only in response to an observed problem.

| Field | Unit | Default | Controls |
|-------|------|---------|----------|
| `webhookInFlightWindowMs` | ms | `60000` (60 s) | How long a webhook's in-flight marker stays trusted by the concurrent-execution guard. |
| `webhookRecoveryIntervalMs` | ms | `300000` (5 min) | How often the periodic recovery sweep runs. |
| `internalTooOldMaxRetries` | count | `50` | Per-request retry budget for stale-snapshot (`ETOOOLD`) failures on internal-target calls. |
| `internalTooOldRetryDelayMs` | ms | `3000` (3 s) | Flat delay between those per-request retries. |

### Concurrency guard — `webhookInFlightWindowMs`

A webhook must never run twice concurrently: two workers pushing the same delta window produce duplicate `out` deliveries. Before starting a run, the runner checks the webhook's read-only `inFlightSince` marker — if it is set and younger than `webhookInFlightWindowMs`, another worker is assumed to be running and this attempt is skipped.

A running webhook refreshes that marker as a heartbeat, so the window is a **staleness threshold, not a run-duration cap**: a run that legitimately takes an hour keeps its marker fresh the whole time and is never mistaken for a crash. What the window does bound is how long a *crashed* run keeps the slot locked — the marker stops being refreshed, goes stale after one window, and the next attempt (or the recovery sweep) takes over.

- **Raise it** if you see spurious skips because workers are heavily contended and heartbeats are being delayed. The cost is a slower rescue of genuinely crashed runs.
- **Lower it** to recover faster from crashed runs. The cost is a higher risk of two workers overlapping under load — and more heartbeat writes, since the heartbeat cadence tracks the window (roughly a third of it, clamped to 5–30 s).

The marker is read-only over the API, and `reset` / `catchUp` deliberately leave it alone — it belongs to the worker holding the slot, not to the delta high-water mark. To stop *future* runs, set `when` to `"never"` (see [Pause and Stop Behavior](#pause-and-stop-behavior)); to stop the run currently holding the slot, call [`abort`](#aborting-a-run-in-progress); to release a slot held by a *crashed* worker, wait for the window to lapse or for the recovery sweep below — `abort` cannot help there, since it needs a live run to reach a checkpoint.

### Recovery sweep — `webhookRecoveryIntervalMs`

A background sweep runs every `webhookRecoveryIntervalMs` and repairs webhooks that fell out of the normal schedule chain. Each pass:

- clears in-flight markers older than `webhookInFlightWindowMs` (releasing slots held by crashed runs);
- schedules a fresh task for any **active** webhook (`when` set and not `"never"`) that no longer has one.

It never touches a paused or stopped webhook — a webhook whose `when` is `"never"` stays stopped, by design. Recovery is not a substitute for fixing a failing webhook; it only restores webhooks that lost their schedule to a crash or an unclean shutdown.

Lowering the interval detects a lost schedule sooner at the cost of a periodic scan of every webhook. Because the next sweep is scheduled when the current one finishes, a change to this field takes effect only after the currently-pending sweep fires — expect up to one *old* interval of lag.

### Stale-snapshot retry — `internalTooOldMaxRetries` / `internalTooOldRetryDelayMs`

These are the two knobs behind the [per-request transient retry](#per-request-transient-retry-internal-targets). They apply **only** to internal-target calls (`out.http.url` starting with `api/v1/...`); external HTTP targets are unaffected.

`internalTooOldMaxRetries × internalTooOldRetryDelayMs` is an implicit wall-clock ceiling per failing operation — **150 s** at the defaults. Raising either value widens that ceiling, which also means a run can sit longer in a single operation before the failure reaches the scheduler; the recovery sweep accounts for this, so a webhook stuck in a long retry budget is not mistaken for a dead one.

Optimistic-lock conflicts are handled elsewhere and are not governed by these knobs — see the [retry section](#per-request-transient-retry-internal-targets).

### Inspecting and tuning

```bash
# Inspect the current sync-webhook timings
curl -X GET -u ":banana" \
  "https://example.app.heads.com/api/v1/config/api~just(webhookInFlightWindowMs,webhookRecoveryIntervalMs,internalTooOldMaxRetries,internalTooOldRetryDelayMs)"

# Adjust individual knobs (PATCH leaves every other config field untouched)
curl -X PATCH -u ":banana" \
  "https://example.app.heads.com/api/v1/config/api" \
  -H "Content-Type: application/json" \
  -d '{
    "webhookInFlightWindowMs": 120000,
    "webhookRecoveryIntervalMs": 60000,
    "internalTooOldMaxRetries": 20,
    "internalTooOldRetryDelayMs": 5000
  }'

# Return a knob to its default
curl -X PATCH -u ":banana" \
  "https://example.app.heads.com/api/v1/config/api" \
  -H "Content-Type: application/json" \
  -d '{ "internalTooOldRetryDelayMs": null }'
```

> **A read never shows `null`.** An unset field reads back as its default, so `GET /v1/config/api` always reports the value actually in force. To tell "explicitly set to the default value" apart from "never set", you'd have to track that yourself — for tuning purposes the two are equivalent. Send `null` to clear an override.

Changes take effect on the **next** run that reads the field: `internalTooOld*` at the start of the next retried operation, `webhookInFlightWindowMs` at the next claim or sweep, and `webhookRecoveryIntervalMs` only after the currently-pending sweep fires.

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

Pausing only affects **future** runs — a run that is already executing keeps going until it finishes. To stop that one too, follow the pause with [`abort`](#aborting-a-run-in-progress):

```bash
# Stop the run that is executing right now (400 if none is)
PATCH /v1/sync-webhooks/com.example.syncId=my-webhook
{ "abort": true }
```

Aborting on its own is not a pause: the aborted run reschedules on the normal `when` cadence.

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
| `abort` rejected with `400` | No run is in flight — `inFlightSince` is empty or has gone stale | Nothing is running to stop. To prevent *future* runs, pause the webhook (`when: "never"`). See [Aborting a Run in Progress](#aborting-a-run-in-progress) |
| `"Previous run was aborted by operator request."` in `error` | An operator called `abort` and the run stopped at its next checkpoint | Informational, not a failure — no attempt was consumed and `lastStart` is unchanged. It clears on the next clean run |

### Checking Status

```bash
# View webhook configuration and status
GET /v1/sync-webhooks/com.myapp.id=my-webhook

# Check specific fields
GET /v1/sync-webhooks/com.myapp.id=my-webhook~just(error,attempts,last,next,when)

# Is a run executing right now, and is an abort pending?
GET /v1/sync-webhooks/com.myapp.id=my-webhook~just(inFlightSince,abortRequestedAt,error)
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
