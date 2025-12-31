# Pagination

Pagination keeps responses fast and predictable when working with large collections. CommerceOS supports both limit/offset
query parameters and `~skip`/`~take` operators.

## Choose a pagination approach
- **Query parameters (basic):** `?limit=N&offset=N&orderby=selector`
- **Operators (pipe-friendly):** `~orderBy(selector[:desc])~skip(N)~take(N)`

Use query parameters for simple, familiar pagination. Use operators when you need explicit control over evaluation order
or need to chain with other operators like `~where` or `~with`.

## Query parameter normalization

Query parameters are internally translated to operators in a **canonical order** regardless of how you write them in the URL:

```
format → fields → where → orderBy → skip → take → simpleJust
```

This means:
- **Sorting always runs before pagination** — `?orderby=name&limit=10` and `?limit=10&orderby=name` produce identical results
- Query parameters can be **mixed** with path operators — the system normalizes all parameters into the canonical pipeline
- The `fields` parameter (which controls projection) is applied early, before filtering or sorting
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

## Cursor-like patterns (resume without large offsets)

There is no dedicated cursor parameter, but you can resume pagination by reusing the last seen sort key:

```bash
# First page (newest first)
GET /v1/receipts~orderBy(timestamp:desc)~take(200)

# Next page: use the last timestamp from the previous page
GET /v1/receipts~where(timestamp<2025-02-01T10:03:00.123Z)~orderBy(timestamp:desc)~take(200)
```

This pattern avoids growing offsets and keeps scans fast. The same approach works with other sortable fields (e.g.,
`createdAt`, `name`) as long as you maintain the same order.

## Receipt relative endpoints

Receipts expose convenience endpoints for time-based filtering that simplify cursor-style pagination:

```bash
# Get all receipts after a specific timestamp
GET /v1/receipts/after/2025-02-01T00:00:00.000Z~orderBy(timestamp)~take(200)

# Get all receipts before a specific timestamp
GET /v1/receipts/before/2025-02-01T00:00:00.000Z~orderBy(timestamp:desc)~take(200)
```

These endpoints return receipts within a half-open time range:
- `/after/{timestamp}` — receipts with `timestamp >= {timestamp}` (inclusive start)
- `/before/{timestamp}` — receipts with `timestamp < {timestamp}` (exclusive end)

**Cursor pagination with `/after`**:
```bash
# First page
GET /v1/receipts/after/2025-01-01T00:00:00.000Z~orderBy(timestamp)~take(100)
# → Returns receipts, note the last timestamp (e.g., 2025-01-15T14:30:00.000Z)

# Next page: use last timestamp + 1ms to avoid overlap
GET /v1/receipts/after/2025-01-15T14:30:00.001Z~orderBy(timestamp)~take(100)
```

Invalid timestamps return a 404 error response (not an empty array).

## Performance tips for large exports

- Favor smaller, consistent page sizes (e.g., 100–500 items) and iterate until the last page is smaller than your page size.
- Prefer date-window filtering (`timestamp` ranges) over very large offsets.
- Sort by an indexed, unique-ish field (timestamps or identifiers) to keep page boundaries stable.
- Use `/receipts/after/{timestamp}` or `/receipts/before/{timestamp}` for efficient time-sliced receipt exports.

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
```
