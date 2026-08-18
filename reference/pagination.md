# Pagination

Pagination keeps responses fast and predictable when working with large collections. CommerceOS supports offset
pagination (limit/offset query parameters or `~skip`/`~take` operators) and cursor pagination (an opaque `after` token).

## Choose a pagination approach
- **Query parameters (basic):** `?limit=N&offset=N&orderby=selector`
- **Operators (pipe-friendly):** `~orderBy(selector[:desc])~skip(N)~take(N)`
- **Cursor (stable under concurrent writes):** `?limit=N&orderby=selector&after=<token>` — see
  [Cursor pagination](#cursor-pagination)

Use query parameters for simple, familiar pagination. Use operators when you need explicit control over evaluation order
or need to chain with other operators like `~where` or `~with`. Use a cursor when the collection is being written to
while you walk it, or when growing offsets are making pages slow.

## Query parameter normalization

Query parameters are internally translated to operators in a **canonical order** regardless of how you write them in the URL:

```
format → where → orderBy → fields → skip → take → simpleJust
```

This means:
- **Sorting always runs before pagination** — `?orderby=name&limit=10` and `?limit=10&orderby=name` produce identical results
- Query parameters can be **mixed** with path operators — the system normalizes all parameters into the canonical pipeline
- **Filtering and sorting run before projection** — so `?status=Active&fields=name` filters on `status` even though `status` is not in the projection
- The `fields` projection lands **ahead of `skip`/`take`**, which is what makes `?fields=…&offset=…` more expensive than `?offset=…` alone (see [Operators: `~skip` and `~take`](#operators-skip-and-take) below)
- **`~skip` is only added when `offset` is present** — `?limit=50` translates to `~take(50)` (no `~skip`); `?limit=50&offset=0` translates to `~skip(0)~take(50)`

**Example**: These requests are equivalent:
```bash
# Query params only
GET /v1/products?limit=50&orderby=name&status=Active

# Mixed: query params + operators
GET /v1/products~where(status=Active)?orderby=name&limit=50

# Both translate to this operator sequence:
# ~where(status=Active)~orderBy(name)~take(50)
```

## Query parameters: limit/offset

```bash
# Page 1 (sorted for stability)
GET /v1/products?orderby=name&limit=50

# Page 2
GET /v1/products?orderby=name&limit=50&offset=50

# Page 3
GET /v1/products?orderby=name&limit=50&offset=100
```

## Operators: `~skip` and `~take`

```bash
# Page 1 (stable ordering)
GET /v1/products~orderBy(name)~take(50)

# Page 2
GET /v1/products~orderBy(name)~skip(50)~take(50)

# Page 3
GET /v1/products~orderBy(name)~skip(100)~take(50)
```

Notes:
- `~orderBy` accepts a single selector; add `:desc` for descending (`~orderBy(createdAt:desc)`).
- Keep the sort consistent across pages to avoid duplicates or gaps when new records appear.
- Stop paging when a response returns fewer than `take` items.
- Put any `~where` filter **before** `~skip`/`~take`. Besides being the only order that gives the right answer, it lets the request stop scanning once the page is full — see [Limiters stop the scan early](operators.md#limiters-stop-the-scan-early).
- Skipping past the end of a collection returns an empty result, not an error.

**Offset cost.** On a plain collection — nothing filtering, sorting or projecting before the skip — `~skip(N)~take(M)` steps over the N skipped records without building them, and builds only the M it returns. A `~where` or `~orderBy` written *ahead* of the skip removes that, necessarily: after a filter the skip is counting matches, and a sort has to see everything before it can say what sits at position N. This makes the offset pages you already have cheaper; it does not make a deep offset cheap, since the request still walks N + M records either way. Details: [A skip is only cheap while nothing filters, sorts or projects before it](operators.md#a-skip-is-only-cheap-while-nothing-filters-sorts-or-projects-before-it).

**`?fields=` cancels it, and this is the one to watch.** `?offset=1000&limit=10` on its own is the cheap shape. Add `?fields=name` and it is not: the projection normalizes to a `~just(name)` placed *ahead* of the skip under the [canonical order](#query-parameter-normalization), so it is applied to all 1000 skipped records as well as the 10 you asked for. `orderby=` and filter parameters land ahead of the skip the same way. There is no query-parameter spelling that puts the projection after the skip — if you want a projected page at offset cost, write the operators yourself:

```bash
# Full cost — ~just(name) runs before the skip
GET /v1/people?fields=name&offset=1000&limit=10

# Same response, cheap — the projection is applied to the ten records returned
GET /v1/people~skip(1000)~take(10)~just(name)
```

## Cursor pagination

Cursor pagination marks your position in a result set with an opaque token instead of a numeric offset. Because the
token encodes *where you left off* rather than *how many rows to skip*, pages stay stable when items are inserted or
removed while you are walking the collection, and page cost does not grow as you go deeper.

`orderby` is required. The cursor is passed back as the `after` query parameter.

### Walking a collection

**1. First request** — send `limit` and `orderby`, no `after`:

```bash
GET /v1/products?limit=50&orderby=identifiers/key
```

**2. Read the response headers:**

| Header | Description |
|--------|-------------|
| `Link` | RFC 8288 link with `rel="next"` pointing at the next page URL. Absent on the last page. |
| `X-Cursor-Next` | The raw opaque token for the next page. Absent on the last page. |
| `X-Has-More` | `true` if more pages exist, `false` on the last page. |

All three are listed in `Access-Control-Expose-Headers`, so browser clients can read them cross-origin.

**3. Follow the cursor** — pass the `X-Cursor-Next` value as `after` (or just request the `Link` URL):

```bash
GET /v1/products?limit=50&orderby=identifiers/key&after=eyJ2IjoiV0lER0VULTAwMSIsImYiOiJpZGVudGlmaWVycy9rZXkiLCJkIjoiYXNjIn0=
```

**4. Repeat** until `X-Has-More` is `false`.

Cursor pagination combines with the rest of the query pipeline — `~where` filters, `fields` projections and a
`:desc` sort direction all work as usual, as long as every request in the walk uses the *same* query apart from `after`.

### Requirements and notes

**Sort on a field with unique values.** This is the one requirement that fails silently, so treat it as the first
thing to get right. The cursor tracks position by sort value alone — the next page is fetched with a strict
`field > lastValue` filter, with no secondary tiebreaker. If several items share the sort value that falls on a page
boundary, every one of them except the last is skipped, and the walk can even report `X-Has-More: false` while items
remain unread. There is no error and no warning; the export just comes up short.

```bash
# Wrong: many products share a status, so items are dropped at every page boundary
GET /v1/products?limit=50&orderby=status

# Right: identifiers/key is unique per resource
GET /v1/products?limit=50&orderby=identifiers/key
```

`identifiers/key` is the safest choice. `name` is *not* guaranteed unique either — the same product name can exist per
currency or per store — and low-cardinality fields such as `status` are never safe. Compound sorting is not a
workaround: an `orderby` with more than one field is rejected with `400 Cursor pagination with compound sort not yet
supported` as soon as an `after` token is present.

**The pagination headers require a buffered JSON response.** `Link`, `X-Cursor-Next` and `X-Has-More` are emitted only
for `application/json` without `;stream=true`. A streamed body starts before the headers could be computed, and the
line-oriented formats (`application/x-ndjson`, `text/csv`, `application/sql`) are not in a shape the header
post-processing can annotate — so neither gets them, streamed or not. This is inherent, not a bug.

An `after` token *is* still honored in every format — the response is exactly `limit` items starting after the token —
but with no next-cursor header there is nothing to continue from. **Walk the pages with buffered JSON**, then re-request
a page in the export format if you need the rows as NDJSON or CSV. See
[`features/streaming.md`](../features/streaming.md).

**`fields` may omit the sort field.** The API fetches the `orderby` field internally to compute the next cursor and
strips it back out before responding, so a projection that excludes it still paginates correctly and still returns only
the fields you asked for:

```bash
# Paginates fine; each item comes back with name and status only, no identifiers
GET /v1/products?limit=50&orderby=identifiers/key&fields=name,status
```

For a nested sort selector this applies to its first segment — sorting on `identifiers/key` while projecting
`fields=name` fetches and then strips the whole `identifiers` object. If your projection already includes that field,
nothing is added or removed.

**Other notes:**

- **`orderby` is required with `after`.** Omitting it returns `400 Cursor pagination requires 'orderby' to be
  specified`. A malformed or truncated token also returns 400.
- **`limit` defaults to 100** when omitted. Send it explicitly so page sizes are predictable.
- **`offset` is ignored** when `after` is present — use one pagination style per request, not both.
- **The token is opaque.** Do not parse, edit or construct it; always use the value from the response headers.
- **Cursors are stateless.** They encode a position, not a server-side session, and stay valid indefinitely as long as
  the sort field still exists.

## Resuming from the last sort key (without a cursor token)

Cursor pagination is query-parameter based. When you are working with the operator pipeline instead, you can get the
same "no growing offsets" effect by filtering on the last value you saw:

```bash
# First page (newest first)
GET /v1/receipts~orderBy(timestamp:desc)~take(200)

# Next page: use the last timestamp from the previous page
GET /v1/receipts~where(timestamp<2025-02-01T10:03:00.123Z)~orderBy(timestamp:desc)~take(200)
```

This pattern avoids growing offsets and keeps scans fast. The same approach works with other sortable fields (e.g.,
`createdAt`, `name`) as long as you maintain the same order.

## Time-relative endpoints

**For time-window reads, these are the recommended endpoints — use them in preference to `~where(timestamp...)` whenever the query has no non-time predicate.**

Several collections expose convenience endpoints for time-based filtering that simplify cursor-style pagination. The pattern is `/v1/{collection}/{before|after}[(create|modify)]/{timestamp}` and is supported on `trade-orders`, `trade-relationships`, `shipment-orders`, `payment-orders`, `stock-transfers`, `stock-counts`, `stock-adjustments`, `receipts`, and `z-reports`. See [Operators → Time-relative queries](operators.md#time-relative-queries-before-and-after) for the full list, the supported modes per collection, and the optional `(create)`/`(modify)` qualifier.

The receipts examples below use the same shape as every other supported collection.

```bash
# Get all receipts after a specific timestamp
GET /v1/receipts/after/2025-02-01T00:00:00.000Z~take(200)

# Get all receipts before a specific timestamp
GET /v1/receipts/before/2025-02-01T00:00:00.000Z~take(200)
```

These endpoints return items within a half-open time range:
- `/after/{timestamp}` — items with `timestamp >= {timestamp}` (inclusive start)
- `/before/{timestamp}` — items with `timestamp < {timestamp}` (exclusive end)

**Paging through a time window** (works for any supported collection — receipts shown). Note that the `/after/`
*path segment* here is unrelated to the `after` *query parameter* of [cursor pagination](#cursor-pagination) — this
pattern carries its position in the timestamp itself rather than in a token:

```bash
# First page
GET /v1/receipts/after/2025-01-01T00:00:00.000Z~take(100)
# → Returns receipts, note the last timestamp (e.g., 2025-01-15T14:30:00.000Z)

# Next page: use last timestamp + 1ms to avoid overlap
GET /v1/receipts/after/2025-01-15T14:30:00.001Z~take(100)
```

The same approach applies to other collections — substitute `/v1/trade-orders/after/...`, `/v1/payment-orders/after/...`, etc., and order by whichever timestamp field that resource exposes.

Invalid timestamps return a 404 error response (not an empty array).

## Performance tips for large exports

- Favor smaller, consistent page sizes (e.g., 100–500 items) and iterate until the last page is smaller than your page size.
- Prefer date-window filtering (`timestamp` ranges) over very large offsets. An unfiltered, unsorted `~skip(N)` steps over the skipped records cheaply, but it still steps over N of them — a deep offset is still proportional to its depth ([details](operators.md#a-skip-is-only-cheap-while-nothing-filters-sorts-or-projects-before-it)).
- **Filter before you limit.** `~where(...)~take(N)` stops scanning at the Nth match; `~take(N)~where(...)` truncates first and then filters, which is both slower to reason about and usually empty. An `~orderBy` between the two removes the benefit, because the sort must read every row first ([details](operators.md#limiters-stop-the-scan-early)).
- Sort by an indexed, unique-ish field (timestamps or identifiers) to keep page boundaries stable.
- **Prefer a cursor over deep offsets** when exporting a whole collection: `?limit=500&orderby=identifiers/key` and then
  follow `X-Cursor-Next`. Remember the sort field must be unique, and that the walk has to be buffered JSON — a streamed
  response, or any NDJSON/CSV/SQL response, never returns the cursor headers ([details](#cursor-pagination)).
- **Use `/after/{timestamp}` and `/before/{timestamp}` for any time-sliced export** — they are the recommended pattern on every collection that supports them ([list](operators.md#time-relative-queries-before-and-after)). They use the collection's time index, stay linear in returned rows, and produce stable cursor boundaries between pages. `~where(timestamp>...)` works but is a predicate scan that gets slower as page offsets grow; reach for it only when you need to combine the time filter with a non-time condition.

## Copy-paste recipes

```bash
# Full catalog sync (operators)
GET /v1/products~orderBy(name)~skip(0)~take(500)
GET /v1/products~orderBy(name)~skip(500)~take(500)
GET /v1/products~orderBy(name)~skip(1000)~take(500)

# Lightweight listing (query params)
GET /v1/people?orderby=name&limit=100&offset=0
GET /v1/people?orderby=name&limit=100&offset=100

# Time-sliced export (operators + date window)
GET /v1/trade-orders~where(timestamp>=2025-01-01)~where(timestamp<2025-02-01)~orderBy(timestamp:desc)~take(200)
GET /v1/trade-orders~where(timestamp>=2025-01-01)~where(timestamp<2025-02-01)~orderBy(timestamp:desc)~skip(200)~take(200)

# Full catalog sync (cursor) — buffered requests only; repeat while X-Has-More is true
GET /v1/products?limit=500&orderby=identifiers/key
GET /v1/products?limit=500&orderby=identifiers/key&after=<X-Cursor-Next from the previous response>
```
