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
- `~orderBy` accepts a single selector; add `:desc` for descending (`~orderBy(createdAt:desc)`). More than one field is a `400` — see [Compound sorting](#requirements-and-notes).
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

`limit` and `orderby` are both required on every request of a walk. The cursor is passed back as the `after` query
parameter.

### Walking a collection

**1. First request** — send `limit` **and** `orderby`, no `after`. Both are required: with `orderby` alone the
response is the whole collection and carries no pagination headers at all, so there is nothing to walk from.

```bash
GET /v1/products?limit=50&orderby=identifiers/key
```

**2. Read the response headers:**

| Header | Description |
|--------|-------------|
| `Link` | RFC 8288 link with `rel="next"` pointing at the next page URL. Absent when no next cursor could be minted. |
| `X-Cursor-Next` | The raw opaque token for the next page. Absent when no next cursor could be minted. |
| `X-Has-More` | `true` if more pages exist, `false` on the last page. |

All three are listed in `Access-Control-Expose-Headers`, so browser clients can read them cross-origin.

**`X-Has-More: true` with no `X-Cursor-Next` is a real state, and it means the walk stops here.** It is not the last
page — more items exist — but the last item on the page you just received has no value for the sort field, so there is
nothing to resume from. A walk written as "repeat while `X-Has-More` is true" spins on a request it cannot advance; one
written as "repeat while a cursor is present" stops mid-collection and reports success. Loop on the cursor, and check
the two headers together: no cursor while `X-Has-More` is `true` is an error, not the end. Sorting on a field that
is always present — `identifiers/key` — avoids the state entirely, which is the same recommendation the uniqueness
requirement below makes, for a second reason.

**3. Follow the cursor** — pass the `X-Cursor-Next` value as `after` (or just request the `Link` URL):

```bash
GET /v1/products?limit=50&orderby=identifiers/key&after=eyJ2IjoiV0lER0VULTAwMSIsImYiOiJpZGVudGlmaWVycy9rZXkiLCJkIjoiYXNjIn0=
```

**4. Repeat** while `X-Cursor-Next` is present. `X-Has-More: false` is the normal end of the collection; a missing
cursor while `X-Has-More` is still `true` is the stalled walk described above, and should be surfaced rather than
treated as the end.

Cursor pagination combines with the rest of the query pipeline — `~where` filters and a `:desc` sort direction work as
usual, as long as every request in the walk uses the *same* query apart from `after`. Projections compose too, with one
current restriction when the sort selector is nested — see
[`fields` and the sort field](#requirements-and-notes) below.

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

`identifiers/key` is the safest choice, and being always populated it is also the field that avoids the
[stalled-walk state](#walking-a-collection) above. `name` is *not* guaranteed unique either — the same product name can
exist per currency or per store — and low-cardinality fields such as `status` are never safe.

**Sort on a field that is always populated, too.** An item with no value for the sort field stalls the walk when it
lands at the end of a page, as described above — the response carries `X-Has-More: true` with no `X-Cursor-Next`,
because there is nothing to resume from. This is a quiet failure: the walk stops mid-collection rather than erroring,
and a successful first page tells you nothing about whether it will finish. Note that this is a requirement of the
*walk*, not of the sort — a sparse member sorts perfectly well on its own
([what you can sort on](operators-catalog.md#orderbyselectordesc)); it is carrying a position from one request to the
next that needs a value on every item.

If you sort a walk on one of your own identifiers rather than on `identifiers/key`, note that a misspelled namespace
lands in exactly this state instead of erroring — `orderby=identifiers/com.example.Sku` when the items carry
`com.example.sku` is a `200` with `X-Has-More: true` and no `X-Cursor-Next`, because no item has a value under the name
you asked for. The identifier namespace is open, so there is no member list to check the spelling against
([details](operators-catalog.md#orderbyselectordesc)).

Compound sorting is not a workaround, and not just for pagination: **a multi-field `orderby` is rejected with a `400`
whether or not you are paginating.** Two layers reach the same answer — `~orderBy` takes one selector, so
`?orderby=status,name` on its own fails with `details` of `Invalid sort key 'status,name': field not found`, and with an
`after` token present the cursor rewrite rejects it first with `Cursor pagination with compound sort not yet supported`.
There is no first page whose `Link` could point at a request that then fails.

**Sort values may contain anything — including `&`, `,` and `?`.** The token carries the last sort value into the next
request, and it is escaped so that a value like `Black & Decker` or `Shirt, Blue` cannot rewrite the query it is sent
with. Nothing about the sort field's *content* constrains a walk; only its uniqueness and its presence do.

This was fixed recently, so it is worth naming: before the fix, such a value rewrote the request it was spliced into,
and the next page came back empty with `X-Has-More: false` — a walk stopped mid-collection and reported success.
Product names carrying a comma or an ampersand are routine, so anyone paginating on `name` was exposed to it. If you
built a walk that avoids punctuation in the sort field, or sorts on a surrogate column to dodge it, that workaround
still works and is simply no longer necessary.

**The pagination headers require a buffered JSON response.** `Link`, `X-Cursor-Next` and `X-Has-More` are emitted only
for `application/json` without `;stream=true`. A streamed body starts before the headers could be computed, and the
line-oriented formats (`application/x-ndjson`, `text/csv`, `application/sql`) are not in a shape the header
post-processing can annotate — so neither gets them, streamed or not. This is inherent, not a bug.

An `after` token *is* still honored in every format — the response holds at most `limit` items starting after the
token — but with no next-cursor header there is nothing to continue from. **Walk the pages with buffered JSON**, then
re-request a page in the export format if you need the rows as NDJSON or CSV. See
[`features/streaming.md`](../features/streaming.md).

**`fields` may omit the sort field, when the sort field is a flat member.** The API fetches the `orderby` selector
internally to compute the next cursor and strips it back out before responding, so a projection that excludes it still
paginates correctly and the response contains exactly the fields you asked for:

```bash
# Paginates fine; each item comes back with status only, no name
GET /v1/products?limit=50&orderby=name&fields=status
```

Naming the sort field yourself (`fields=name,status`) changes nothing — it is already there, so nothing is added and
nothing is stripped.

> **Projecting alongside a nested sort selector (as of 2026-08-19).** While walking with a nested selector such as
> `orderby=identifiers/key`, **project the parent object — `fields=name,identifiers` — or drop the projection
> entirely.** A narrower projection currently returns `X-Has-More: true` with no `X-Cursor-Next`, so the walk cannot
> start at all — not on a later page, on the *first* request. Projecting the parent costs one extra object per item;
> the alternative is an export that never begins.

The stall covers every projection that does not reach the parent, including the one that names the sort path exactly:

| With `orderby=identifiers/key` | Walk starts? | Response |
|---|---|---|
| `fields=name,identifiers` — names the parent | **yes** | exactly as requested |
| `fields=all`, or no `fields=` at all | **yes** | exactly as requested |
| `fields=name`, `fields=name,status`, `fields=none` | no | `identifiers` collapses to a bare key string |
| `fields=identifiers/key` — the exact sort path | no | same |
| `fields=identifiers/com.example.sku` — a sibling | no | `identifiers` is the bare key string, under the member name you asked to hold a sku |
| `fields=default`, `fields=default,gtin` | no | bare key string |
| a path-operator projection, `~just(name)` | no | `~just` is not a way around it |

One visible symptom lets you recognise the state without reading the headers: `identifiers` comes back as a **bare
string holding the database key** instead of the object you would otherwise get.

```json
{"@type":"product","name":"501 Original Jeans W28 L36 Stonewash","identifiers":"0239ada480742fd8d2b8b31367cb7d18"}
```

**One exception, and it applies to a flat sort field only: a projection built on `default`.** `fields=default,gtin`
with `orderby=name` returns `name` as well, even though you did not ask for it. Which members `default` covers is a
property of the type rather than of your request, so the sort field is added and then left in place rather than risk
deleting a member you were entitled to — one extra member beats silent data loss. Every other projection over a flat
sort field is returned exactly as requested. With a *nested* selector `default` does not get this treatment; it stalls
like the rest.

**Other notes:**

- **`limit` is required to start a walk.** The first request emits pagination headers only when `orderby` *and* a
  positive `limit` are both present. Without `limit` the response is the whole collection — not a page, and with
  nothing to resume from. `limit=0` gets the same treatment — no pagination headers — since a zero-item page has no
  last item to mint a cursor from; it returns an empty collection rather than the whole one. On an `after` request
  `limit` falls back to 100, but there is no reason to lean on that: send the same `limit` on every request of a walk.
- **`orderby` is required with `after`.** Omitting it returns a `400` whose `details` read `Cursor pagination requires
  'orderby' to be specified`. A malformed or truncated token also returns 400, with `details` of
  `Malformed cursor token: …`. Both are ordinary error bodies — `@type` of `bad request`, framed to match your `Accept`
  header like any other error ([Error response framing](overview.md#error-response-framing)).
- **The `after` token must match the `orderby` it is sent with.** A token minted under `orderby=name` and replayed with
  `orderby=price`, or with `:desc` flipped, is a `400` — `Cursor token does not match 'orderby': the token was issued
  for 'name:asc' but the request asks for 'price:asc'`. This is worth designing around rather than discovering: the
  natural client bug is a stored token replayed after the user changed the sort control, and the alternative to the
  error is a walk that filters on one field while sorting by another.
- **Tokens longer than 4096 characters are rejected as malformed.** A cursor holds one sort value, so nothing this API
  mints comes close; a token that long did not come from a response header.
- **`offset` is ignored** when `after` is present — use one pagination style per request, not both.
- **A page holds at most `limit` items**, and exactly `limit` on every page but the last.
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
  follow `X-Cursor-Next`. Remember that `limit` is required on every request of the walk, that the sort field must be
  unique *and* always populated, and that the walk has to be buffered JSON — a streamed response, or any NDJSON/CSV/SQL
  response, never returns the cursor headers ([details](#cursor-pagination)).
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

# Full catalog sync (cursor) — buffered requests only; repeat while X-Cursor-Next is present.
# Send the same limit every time; X-Has-More: true with no cursor means the walk stalled.
GET /v1/products?limit=500&orderby=identifiers/key
GET /v1/products?limit=500&orderby=identifiers/key&after=<X-Cursor-Next from the previous response>
```
