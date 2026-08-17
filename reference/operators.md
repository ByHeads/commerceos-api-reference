# Query Operators

This reference documents CommerceOS API query operators.

> **Quick Reference:** See [`../guide/examples.md`](../guide/examples.md) for practical usage examples.
>
> **Full Catalog:** See [`operators-catalog.md`](operators-catalog.md) for a complete operator reference with detailed signatures and examples.

---

## Quick Reference

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

---

## Operator Syntax vs Query Parameters

CommerceOS supports two query syntaxes:

- **Query parameters:** `/v1/products?status=Active&limit=10`
- **Path operators:** `/v1/products~where(status=Active)~take(10)`

Query parameters and path operators **can be mixed** in the same request. The system normalizes query parameters into operators and appends them after any path operators in a canonical order.

| Syntax | Filtering | Pagination | Sorting | Expansion |
|--------|-----------|------------|---------|-----------|
| Query params | `?status=Active` | `?limit=10&offset=20` | `?orderby=name` | `?fields=all` |
| Operators | `~where(status=Active)` | `~take(10)~skip(20)` | `~orderBy(name)` | `~withAll` |

**Why two syntaxes?** Query parameters are familiar and work well for simple requests. Operators are chainable and expressive for complex queries like multi-field filtering, nested expansions, and mapped type transformations.

### Query Parameter Normalization

When query parameters are used, they are translated into operators and applied in a **canonical order** regardless of their position in the URL:

```
format → fields → where → orderBy → skip → take → simpleJust
```

This means:
- **Path operators** are applied first, in URL order (left-to-right)
- **Query parameters** are normalized and appended after path operators
- Sorting (`orderBy`) runs **before** pagination (`skip`, `take`) when using query params

**Example:** `/v1/products~with(prices)?orderby=name&limit=10` is equivalent to:
```
/v1/products~with(prices)~orderBy(name)~take(10)
```

**Best practice:** For predictable results, use either query parameters OR path operators for filtering/sorting/pagination—but not both. When mixing, understand that query params are appended after path operators.

**Path operator order:** When using path operators, they are applied in URL order (pipe semantics). See [Operator Application Order](#operator-application-order) below.

**Pagination guide:** See [`pagination.md`](pagination.md) for paging patterns, stable sorting, and performance tips.

### Operator Recipes

Common operator patterns for everyday tasks:

```bash
# Paginated list (page 3, 20 items per page)
GET /v1/products~take(20)~skip(40)

# Filtered search (valid members)
GET /v1/products~where(status=Active,hidden=false)

# Expanded view with pagination
GET /v1/products~with(prices,categories)~take(10)

# Sorted and filtered
GET /v1/products~where(status=Active)~orderBy(name)~take(20)

# Transformed export
GET /v1/products~map(com.example.export-format)~take(100)
```

---

## Operator Categories

### Projection
- `~with(selectors)` - Add/replace fields on each object.
- `~withAll` - Include all fields (expands all non-essential fields).
- `~without(selectors)` - Remove fields.
- `~just(selectors)` - Keep only specified fields; clears existing subunits first.
- `~simpleJust(names)` - Keep only given member names (no selector parsing, just property name matching).

**Expansion Examples:**

```bash
# Include prices and categories on products
GET /v1/products~with(prices,categories)

# Deep nesting - expand items, then product on each item, then prices on product
GET /v1/trade-orders~with(items~with(product~with(prices)))

# Whitelist: only return name and status
GET /v1/products~just(name,status)

# Blacklist: exclude audit fields
GET /v1/products~without(createdAt,updatedAt,createdBy)

# Alias a computed value; a selector may be a quoted string literal
GET /v1/products~with(slug:name/ld,source:'catalog'/upper)
```

> **String literals as selectors.** A single-quoted literal is a valid selector and can be continued with a `/` member chain or a `~` pipe, e.g. `~with(slug:'Brød & Melk'/ld)`. Percent-encode any `,` (`%2C`) or `?` (`%3F`) inside the quotes — the URL is split before the literal is read. See [String Literals as a Starting Point](primitives.md#string-literals-as-a-starting-point).

### Filtering
- `~where(predicates)` - Filter by predicates (AND).
  - Predicate operators: `=`, `!=`, `>`, `<`, `>=`, `<=`, `=~` (includes), `!~` (not includes)
  - Truthy/falsy: `field` (truthy check) / `!field` (falsy check, matches null/undefined/false/0/empty string)
  - Predicate separators: `,` or `&` within `~where(...)` - both are AND
  - Multiple `~where` clauses: Each additional `~where` adds more AND conditions (they combine as AND)
  - **Value parsing rules:**
    - `null` and `undefined` are parsed as their literal values
    - `true` and `false` are parsed as booleans
    - Numbers (including decimals and negative) are parsed numerically
    - ISO 8601 dates (e.g., `2024-12-20T10:00:00Z`) are parsed as Date objects
    - Empty strings: use `field=` (nothing after `=`) to match empty string
    - Nested paths work as keys: `~where(addresses/main/countryCode=SE)`
    - A literal `~` in a value must be percent-encoded as `%7E` — a bare `~` ends the segment and starts an operator, except directly after `+ < - ~ = !` where it forms a two-character token (`=~`, `!~`, `+~`, …). See [Escaping a Tilde in an Operand](primitives.md#escaping-a-tilde-in-an-operand)
  - Date coercion: Datetime values on either side are compared via `.getTime()`
- `~either(predicates)` - Filter by predicates (OR). See [`~either` below](#either-or-filtering) for details.

> **Tip:** for plain time-window reads (`timestamp > X`, `timestamp < X`, `timestamp >= X` with no other predicate), use [`/before/` or `/after/`](#time-relative-queries-before-and-after) instead. The path endpoints are index-backed; `~where` on a timestamp is a predicate scan.

**Filtering Examples:**

```bash
# Simple equality
GET /v1/products~where(status=Active)

# Not equals
GET /v1/products~where(status!=Discontinued)

# Includes (contains in array or string)
GET /v1/products~where(gtin=~7312345)

# Truthy check (field exists and is truthy)
GET /v1/products~where(hidden)

# Falsy check (Boolean false: null/undefined/false/0/empty string)
GET /v1/products~where(!hidden)

# Nested path filtering
GET /v1/people~where(addresses/main/countryCode=SE)

# Multiple conditions (AND)
GET /v1/products~where(status=Active,hidden=false)

# Chained where clauses (also AND)
GET /v1/products~where(status=Active)~where(hidden=false)
```

#### `~either` (OR filtering)

`~where(A,B,C)` keeps rows matching **all** predicates (AND). `~either(A,B,C)` keeps rows matching **any** predicate (OR). Both operators share the same predicate syntax — comparison operators (`=`, `!=`, `=~`, `!~`, `>`, `<`, `>=`, `<=`), truthy/falsy checks, nested paths, and value-parsing rules from [`~where`](#filtering) all apply identically.

**OR Filtering Examples:**

```bash
# Two-predicate OR on the same field (status in a set)
GET /v1/products~either(status=Active,status=Pending)

# OR across different fields (the case ~where cannot express)
GET /v1/products~either(status=Inactive,name=~Apple)

# Combined with ~where to express (A OR B) AND C
GET /v1/products~either(status=Inactive,name=~Apple)~where(name=~Pro)
```

**Precedence note.** When combining `~either` with `~where`, each operator is applied in URL order as an independent filter step. `~either(A,B)~where(C)` evaluates as `(A OR B) AND C` — **not** `A OR (B AND C)`. To express the latter, use two separate calls or restructure the predicates.

**Edge cases:**

- An empty predicate list (`~either()`) defaults to a truthy check on `$this` — keeps truthy values, drops falsy ones. Same default as `~where()`.
- On a single-unit target (not a collection), `~either` either lets the unit through or drops it to `[]`, matching the pass/drop gate behaviour of `~where`.

**When to use which:**

| You want… | Use |
|---|---|
| All predicates must hold | `~where(A,B,C)` |
| Any predicate may hold (same or different fields) | `~either(A,B,C)` |
| Mixed: some AND, some OR | Chain them: `~either(A,B)~where(C)` for `(A OR B) AND C` |

### Ordering & Pagination

> **Note (v26.1+):** the `/before/` and `/after/` time-relative endpoints already return results in timestamp order, so chaining `~orderBy(timestamp)` after them is redundant. For every other query — including `~where(timestamp...)` filters, plain collection listings, and any sort by a non-timestamp field — `~orderBy(...)` is still required when you want a specific order.

- `~orderBy(field)` or `~orderBy(field:desc)` - Order objects by selector value (single selector only).
- `~order` / `~order(desc)` - Order primitive streams in ascending/descending order.
- `~take(N)` - Take first N items.
- `~skip(N)` - Skip first N items.
- `~first` - Return first item (reducer). Returns `null` if collection is empty.
- `~last` - Return last item (reducer). Returns `null` if collection is empty.
- `~count` - Return item count as number (reducer). Returns `0` for empty collections.

**Ordering Examples:**

```bash
# Ascending order (default)
GET /v1/products~orderBy(name)

# Descending order
GET /v1/products~orderBy(name:desc)

# Order by nested field
GET /v1/trade-orders~orderBy(customer/name)

# Pagination: skip 20, take 10
GET /v1/products~skip(20)~take(10)
```

### Distinct
- `~distinct` - Deduplicate streams by value identity. Works on primitives (strings, numbers). For objects, use `~distinctBy`.
- `~distinctBy(selector)` - Deduplicate objects by selector value. Evaluates selector per item, drops subsequent duplicates.

**Distinct Examples:**

```bash
# Deduplicate objects by a field
GET /v1/products~distinctBy(status)

# Deduplicate objects by a nested field
GET /v1/trade-orders~distinctBy(customer/identifiers/key)
```

### Transformation
- `~map(mappedTypeName)` - Apply a registered mapped type by name.
  - **Mapped type lookup:** `~map(com.example.typeName)` looks up a mapped type with that exact name in `/mapped-types`. The name must match the `mappedTypeName` identifier.
  - **Field projection:** Use `~just(...)` for simple field selection, or create a mapped type when you need reshaping.
  - **Full guide:** See [Mapped Types](mapped-types.md) for body structure, selectors, aliasing, `$prior` aggregation, and X-Request-Map usage.
- `~flat` - Flatten nested arrays one level deep.
- `~entries` - Convert object to `{index, key, value}[]` entries (excludes `@type`).
- `~array` - Wrap single item in an array. Spelled in full — there is no `~arr` alias, and a misspelled operator resolves silently to an empty value (see [gotcha 24](common-gotchas.md#24-misspelled-operators-fail-silently)).
- `~typeless` - Set context flag to strip `@type` from output.
- `~join(separator)` - Join array elements to string; default separator is `,`. Inverse of the string split member `/={separator}`.
- `~toLower` - Convert string to lowercase; returns `undefined` for non-strings.
- `~toUpper` - Convert string to uppercase; returns `undefined` for non-strings.
- `~toString` - Convert value to string via `.toString()`.
- `~repeat(N)` - Repeat input N times.

> **Operators also consume arrays produced by a path member.** Navigating to a string and splitting it with `/={separator}` yields a real `string[]`, so `~first`, `~last`, `~count`, `~take(N)`, `~skip(N)`, `~flat` and `~join(...)` all chain onto it — `name//=%3A~last` keeps the part after the colon. Percent-encode a separator that the URL syntax already uses (`%2F` for `/`, `%3F` for `?`). One exception does not chain at all: a separator ending in `+ < - ~ = !` absorbs the operator that follows it, so split on a hyphen through a `~with(...)` alias instead — `~with(parts:name//=-)/parts~last`. See [Splitting a String into an Array](primitives.md#splitting-a-string-into-an-array).

---

## Parameter Rules

**Parameterized operators** (require arguments):
- `~where(...)`, `~either(...)`, `~with(...)`, `~without(...)`, `~just(...)`, `~simpleJust(...)`
- `~orderBy(...)`, `~distinctBy(...)`
- `~map(...)`, `~join(...)`, `~take(...)`, `~skip(...)`, `~repeat(...)`

**Non-parameterized operators** (no parentheses):
- `~withAll`, `~first`, `~last`, `~count`, `~distinct`
- `~flat`, `~entries`, `~array`, `~typeless`
- `~toLower`, `~toUpper`, `~toString`

**Special case**:
- `~order` can be used without parameter (defaults to `asc`) or with `~order(desc)`

---

## Query Parameter Equivalents

Standard query parameters are translated to operators:

| Query Parameter | Operator Equivalent | Example |
|-----------------|---------------------|---------|
| `limit=N` | `~take(N)` | `?limit=10` → `~take(10)` |
| `offset=N` | `~skip(N)` | `?offset=20` → `~skip(20)` |
| `fields=a,b` | `~just(a,b)` + `~simpleJust(a,b)` | `?fields=prices,categories` → `~just(prices,categories)~simpleJust(prices,categories)` |
| `fields=all` | `~withAll` | `?fields=all` → `~withAll` |
| `orderby=field` | `~orderBy(field)` | `?orderby=name` → `~orderBy(name)` |
| `orderby=field:desc` | `~orderBy(field:desc)` | `?orderby=name:desc` → `~orderBy(name:desc)` |
| `format=json` | Accept: application/json | Content type selection |
| `format=ndjson` | Accept: application/x-ndjson | Streaming output |
| `format=csv` | Accept: text/csv | Tabular export |
| `format=txt` | Accept: text/plain | Plain text output |
| `format=html` | Accept: text/html | HTML-wrapped output |

**Fields edge cases:** `fields=none` maps to `~just()` with empty args. `fields=all,extra` emits `~withAll` and `~with(extra)`. `fields=default` is a no-op.

**Multiple `where` clauses:** Each non-reserved query parameter becomes a `~where` clause. Repeating the same key (e.g., `?status=Active&status=Pending`) produces multiple `~where` clauses that combine as AND.

**Query parameter canonical order:** Query parameters are normalized into operators in a fixed order regardless of their position in the URL:

```
format → fields → where → orderBy → skip → take → simpleJust
```

Sorting (`orderBy`) is applied **before** pagination (`skip`, `take`), ensuring consistent page boundaries when sorting and paginating collections. This matches the recommended path operator order where sorting comes before pagination.

---

## Operator Application Order

Operators are applied in the order they appear in the URL. Think of `~` as a pipe operator: each step consumes the output of the previous step.

**Recommended sequence** (for predictable results):

1. **Filtering** (`~where`) — narrow down the result set
2. **Sorting** (`~orderBy`) — order the filtered results
3. **Field selection** (`~just`, `~without`, `~simpleJust`) — choose which fields to include
4. **Expansion** (`~with`, `~withAll`) — expand non-essential fields
5. **Pagination** (`~skip`, `~take`) — slice the final result set

This sequence is recommended because:
- Filtering before pagination ensures you get the right items
- Sorting before pagination ensures consistent page order
- Pagination at the end avoids unexpected results from filtered/sorted subsets

### Limiters stop the scan early

A chain is evaluated lazily: items are pulled through it one at a time, and a **limiter** — `~take(N)` or `~first` — stops pulling as soon as it has what it asked for. Everything upstream of the limiter, including the `~where` predicate and any per-element subqueries it evaluates, simply never runs against the rest of the collection.

```bash
# Stops at the tenth match, however large the collection is
GET /v1/products~where(status=Active)~take(10)

# Stops at the first match
GET /v1/products~where(gtin=7312345678901)~first

# Stops after N + M items
GET /v1/products~skip(100)~take(50)
```

`limit=N` is normalized to `~take(N)` and behaves identically, and query parameters are always appended *after* path operators — so `/v1/products~where(status=Active)?limit=10` is the same chain as the first example above.

**Order is literal — put the filter first.** `~` is a pipe, and the pipeline does exactly what you wrote, in the order you wrote it. A limiter placed before the filter truncates the collection first and then filters the survivors, which is almost never what was meant:

```bash
# RIGHT - "the first active product"
GET /v1/products~where(status=Active)~take(1)

# WRONG - "take the first product, then check whether it happens to be active"
#         Returns [] whenever the very first product isn't active.
GET /v1/products~take(1)~where(status=Active)
```

**Draining operators still see everything.** `~count`, `~last` and `~orderBy` cannot answer their question without consuming the whole stream, so a limiter placed after one of them does not save any work:

- `~where(...)~count` counts every match — that is the point of the operator.
- `~orderBy(name)~take(10)` sorts the entire collection before slicing. You cannot know the alphabetically-first ten rows without looking at all of them. If you only need *some* ten rows rather than the *top* ten, drop the `~orderBy` and the request short-circuits.
- `~last` walks to the end of the stream. On a sorted collection, `~orderBy(field:desc)~first` answers the same question and stops at the first item.

---

## Evaluation Notes

- Operators are applied in URL order (pipe semantics). The recommended sequence is filtering → sorting → field selection → expansion → pagination.
- `~where`, `~either`, `~orderBy`, `~distinctBy`, `~with`, `~just` evaluate selectors (same selector language as mapped types).
- `~map` resolves a mapped type by name and strips `@type` annotations from output.
- `~map` always returns one result per source item. For single-result aggregation from a collection, use an array-body mapped type ending with `"$first"` and reference the collection via `$prior`.

> **Note:** `"$first"` limits the mapped stream to the first result, but collection responses still serialize as a single-element array. Use `~first` after `~map(...)` if you need a single object.
- Comparisons in `~where` and `~orderBy` use numeric comparison for numeric values.

---

## Time-relative queries (`/before/` and `/after/`)

**Recommended for any time-window query on these collections.** Several collections expose path-style time filters that are the canonical way to read items by timestamp. They are index-backed (single-pass on the time field with no offset growth between pages), where `~where(timestamp>...)` falls back to a generic predicate scan that becomes progressively more expensive as page offsets grow on large collections. Use `~where(timestamp...)` only when you need to combine the time predicate with a non-time condition the path endpoint cannot express. The pattern is:

```
/v1/{collection}/{before|after}[(create|modify)]/{timestamp}
```

`{timestamp}` accepts any string `Date.parse` understands; ISO 8601 (`2025-02-01T00:00:00.000Z`) is recommended. Invalid timestamps return an empty collection or a 404 (depending on the operator).

### Relative timestamps

Instead of an absolute timestamp you can write an offset from *now*: `-=` subtracts, `+=` adds.

**The leading number is hours.** The full form is `-=h[:m[:s[.ms]]]`, so every field you leave off defaults to zero:

| Written | Means |
|---|---|
| `-=1` | 1 hour ago |
| `-=24` | 24 hours ago |
| `-=168` | 1 week ago |
| `-=0:30` | 30 minutes ago |
| `-=0:0:30` | 30 seconds ago |
| `+=48` | 48 hours from now |

```bash
GET /v1/receipts/after/-=24
GET /v1/receipts/after/-=0:30~take(100)
```

> **Watch the magnitude.** Because the unit is hours, a number that looks like a day count is not one: `-=2000` is 2000 hours — about 83 days — not 2000 days and not 2000 minutes. This is a common source of accidentally enormous windows in a polling job. If you mean 30 days, write `-=720`.

### Polling efficiently

For an incremental sync, keep the timestamp of the last record you processed in your own state store and ask for a **tight** window each time, rather than a fixed generous lookback:

```bash
# Good: resume from where the last run finished
GET /v1/trade-orders/after/2025-02-01T10:03:00.124Z~take(500)

# Wasteful: re-reads ~83 days of history on every poll, then throws almost all of it away
GET /v1/trade-orders/after/-=2000~take(500)
```

A limiter such as `~take(500)` short-circuits the pipeline ([details](#limiters-stop-the-scan-early)), so an oversized window does not make the *response* larger — but the endpoint still has to walk the records that fall inside the window in order to return them in time order. The width of the window, not the size of the page, sets the floor on what the request costs. A five-minute poll should ask for roughly five minutes of data (plus whatever overlap you want for safety), not for the last three months.

### Mode parameter

The optional `(create)` or `(modify)` qualifier between the operator name and the slash selects which time field is filtered:

| Mode | What it filters on |
|---|---|
| `(create)` | The time the underlying event happened (when the order was placed, the receipt was rung up, the stock movement was recorded). |
| `(modify)` | The time the resource was last written to (any field change). |
| _(omitted)_ | The collection's default — `(modify)` for resources that record a last-modified time, `(create)` otherwise. |

The collections that support the pattern, and the modes each one accepts, are:

| Collection | Default | Also accepts |
|---|---|---|
| [`/v1/trade-orders`](../guide/examples/orders.md#time-relative-queries) | `modify` | `create` |
| [`/v1/trade-relationships`](../guide/examples/users.md#trade-relationships--time-relative-queries) | `modify` | — |
| [`/v1/agents/{id}/customerRelations`](resource-patterns.md#time-relative-queries-on-agent-sub-collections) | `modify` | — |
| [`/v1/agents/{id}/supplierRelations`](resource-patterns.md#time-relative-queries-on-agent-sub-collections) | `modify` | — |
| [`/v1/shipment-orders`](../guide/examples/orders.md#shipment-orders--time-relative-queries) | `modify` | `create` |
| [`/v1/payment-orders`](../guide/examples/orders.md#payment-orders--time-relative-queries) | `modify` | `create` |
| [`/v1/stock-transfers`](../guide/examples/inventory.md#stock-transfers--time-relative-queries) | `create` | — |
| [`/v1/stock-counts`](../guide/examples/inventory.md#stock-counts--time-relative-queries) | `modify` | `create` |
| [`/v1/stock-adjustments`](../guide/examples/inventory.md#stock-adjustments--time-relative-queries) | `create` | — |
| [`/v1/receipts`](receipts.md#beforeafter-timestamps) | `create` | — |
| [`/v1/z-reports`](../guide/examples/pos.md#z-reports--time-relative-queries) | `create` | — |

Asking for a mode the collection does not accept returns a 404 whose message lists the supported modes.

### Inclusivity and chaining

The endpoint returns a half-open time range:

- `/after/{timestamp}` — items with timestamp `>= {timestamp}` (inclusive start)
- `/before/{timestamp}` — items with timestamp `< {timestamp}` (exclusive end)

Results are returned as an ordinary collection, so any operator can be chained: `~orderBy(...)`, `~take(N)`, `~skip(N)`, `~with(...)`, `~just(...)`, `~map(...)`. See [`pagination.md`](pagination.md#resuming-from-the-last-sort-key-without-a-cursor-token) for the "resume from last seen timestamp" pattern, and [`pagination.md`](pagination.md#cursor-pagination) for the `after` cursor token.

---

## Performance Considerations

- **Always prefer `/before/{ts}` and `/after/{ts}` over `~where(timestamp>{ts})` / `~where(timestamp<{ts})`** on any collection that supports them — see [Time-relative queries](#time-relative-queries-before-and-after) for the full list. The path endpoints use the collection's time index and stay linear in the number of returned rows; `~where` on a timestamp is a predicate scan and becomes the dominant cost on large datasets. Use `~where(timestamp...)` only when you must combine the time predicate with a non-time condition the path endpoint cannot express.
- **Put `~where` before `~take`/`~first`.** A limiter stops the scan as soon as it is satisfied, so `~where(...)~take(10)` costs ten matches rather than a whole collection — see [Limiters stop the scan early](#limiters-stop-the-scan-early). Written the other way round the query is also *wrong*, not just slow.
- Use `~with`/`~just` to limit output and avoid expanding expensive relations.
- `~orderBy` collects all items into memory before sorting—not suitable for very large collections, and it defeats the short-circuit above because a limiter after it still waits for the full sort.
- `~count` and `~last` also consume the entire stream by definition. Where a `~first` on a sorted collection answers the same question, prefer it.
