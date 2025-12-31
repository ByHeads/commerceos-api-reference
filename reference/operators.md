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
~where(...)    filter by conditions
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
```

### Filtering
- `~where(predicates)` - Filter by predicates.
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
  - Date coercion: Datetime values on either side are compared via `.getTime()`

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

### Ordering & Pagination
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
- `~array` - Wrap single item in an array.
- `~typeless` - Set context flag to strip `@type` from output.
- `~join(separator)` - Join array elements to string; default separator is `,`.
- `~toLower` - Convert string to lowercase; returns `undefined` for non-strings.
- `~toUpper` - Convert string to uppercase; returns `undefined` for non-strings.
- `~toString` - Convert value to string via `.toString()`.
- `~repeat(N)` - Repeat input N times.

---

## Parameter Rules

**Parameterized operators** (require arguments):
- `~where(...)`, `~with(...)`, `~without(...)`, `~just(...)`, `~simpleJust(...)`
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

---

## Evaluation Notes

- Operators are applied in URL order (pipe semantics). The recommended sequence is filtering → sorting → field selection → expansion → pagination.
- `~where`, `~orderBy`, `~distinctBy`, `~with`, `~just` evaluate selectors (same selector language as mapped types).
- `~map` resolves a mapped type by name and strips `@type` annotations from output.
- `~map` always returns one result per source item. For single-result aggregation from a collection, use an array-body mapped type ending with `"$first"` and reference the collection via `$prior`.

> **Note:** `"$first"` limits the mapped stream to the first result, but collection responses still serialize as a single-element array. Use `~first` after `~map(...)` if you need a single object.
- Comparisons in `~where` and `~orderBy` use numeric comparison for numeric values.

---

## Performance Considerations

- Use receipt-specific endpoints for date-based filtering on large datasets:
  - `/v1/receipts/after/{timestamp}` — receipts after the given ISO timestamp
  - `/v1/receipts/before/{timestamp}` — receipts before the given ISO timestamp
  - Example: `/v1/receipts/after/2024-01-01T00:00:00Z~take(100)`
- Use `~with`/`~just` to limit output and avoid expanding expensive relations.
- `~orderBy` collects all items into memory before sorting—not suitable for very large collections.
