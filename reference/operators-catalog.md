# Operator Catalog

A complete reference of all CommerceOS API operators.

> **Quick Reference:** See [`operators.md`](operators.md) for usage patterns and recipes, or [`../guide/examples.md`](../guide/examples.md) for practical curl examples.

---

## Public Operators (URL-Pipeable)

These operators can be used directly in URLs via the `~` syntax. Think of them as pipe operators: each step consumes the output of the previous step.

**Example:** `GET /v1/products~where(status=Active)~orderBy(name)~take(10)`

---

### Projection Operators

#### ~with(selectors)

Include additional non-essential fields on each object.

**Signature:** `~with(selector1,selector2,...)`

**Example:**
```
GET /v1/products~with(prices,categories)
```

**Query param equivalent:** `?fields=default,prices,categories`

**Notes:**
- Selectors support nested paths: `~with(items~with(product))`
- Multiple fields are comma-separated
- Use for expanding relations without fetching all fields

---

#### ~withAll

Include all fields on each object (expands all non-essential fields).

**Signature:** `~withAll` (no parameters)

**Example:**
```
GET /v1/products~withAll
```

**Query param equivalent:** `?fields=all`

**Notes:**
- May be expensive for resources with many relations
- Prefer `~with(...)` for targeted expansion

---

#### ~without(selectors)

Exclude specified fields from each object.

**Signature:** `~without(selector1,selector2,...)`

**Example:**
```
GET /v1/products~without(createdAt,updatedAt,createdBy)
```

**Notes:**
- Useful for removing audit fields or other clutter
- Works on default fields and expanded fields

---

#### ~just(selectors)

Include only the specified fields; clears all other fields first.

**Signature:** `~just(selector1,selector2,...)`

**Example:**
```
GET /v1/products~just(name,status)
```

**Query param equivalent:** `?fields=name,status` (note: also applies `~simpleJust`)

**Notes:**
- Clears existing subunits before applying
- Use for strict whitelisting of fields
- `~just()` with empty args returns minimal object

---

#### ~simpleJust(names)

Keep only the given property names (no selector parsing, just property name matching).

**Signature:** `~simpleJust(name1,name2,...)`

**Example:**
```
GET /v1/products~simpleJust(name,status,gtin)
```

**Query param equivalent:** Part of `?fields=a,b` (which maps to `~just(a,b)~simpleJust(a,b)`)

**Notes:**
- Unlike `~just`, does not resolve selectors or nested paths
- Faster for simple property name filtering
- Operates on the output object's property names directly

---

### Filtering Operators

#### ~where(predicates)

Filter objects by predicate conditions.

**Signature:** `~where(predicate1,predicate2,...)`

**Predicate operators:**
- `=` equals
- `!=` not equals
- `>` greater than
- `<` less than
- `>=` greater than or equals
- `<=` less than or equals
- `=~` includes (for strings/arrays)
- `!~` not includes

**Truthy/falsy checks:**
- `field` — truthy check (field exists and is truthy)
- `!field` — falsy check (field is null/undefined/false/empty)

**Examples:**
```
GET /v1/products~where(status=Active)
GET /v1/products~where(status!=Discontinued)
GET /v1/products~where(gtin=~7312345)
GET /v1/products~where(hidden)
GET /v1/products~where(!hidden)
GET /v1/people~where(addresses/main/countryCode=SE)
GET /v1/products~where(status=Active,hidden=false)
```

**Query param equivalent:** `?field=value` (each param becomes a predicate)

**Notes:**
- Multiple predicates within `~where(...)` are AND-ed together
- Separators: `,` or `&` within the operator
- Multiple `~where` clauses also combine as AND
- Value parsing: `null`, `undefined`, `true`, `false` are parsed as literals; numbers and ISO dates are coerced
- Date comparison uses `.getTime()` for both sides

---

### Ordering Operators

#### ~orderBy(selector[:desc])

Sort a collection by a selector (ascending by default).

**Signature:** `~orderBy(selector)` or `~orderBy(selector:desc)`

**Examples:**
```
GET /v1/products~orderBy(name)
GET /v1/products~orderBy(name:desc)
GET /v1/trade-orders~orderBy(customer/name)
```

**Query param equivalent:** `?orderby=name` or `?orderby=name:desc`

**Notes:**
- `~orderBy` accepts a single selector; commas are treated as part of the selector string
- Nested paths supported: `~orderBy(customer/name)`
- Collects all items in memory before sorting — not suitable for very large collections

---

#### ~order(asc|desc)

Order a primitive stream in ascending or descending order.

**Signature:** `~order` or `~order(asc)` or `~order(desc)`

**Example:**
```
GET /v1/products/names~order(desc)
```

**Notes:**
- Default is `asc` if no parameter
- Works on streams of primitive values (strings, numbers)
- For object collections, use `~orderBy(selector)`

---

### Distinct Operators

#### ~distinct

Deduplicate streams by value identity.

**Signature:** `~distinct` (no parameters)

**Example:**
```
GET /v1/products/status~distinct
```

**Notes:**
- Works on primitives (strings, numbers)
- For objects, use `~distinctBy(selector)`
- Maintains first occurrence, drops subsequent duplicates

---

#### ~distinctBy(selector)

Deduplicate objects by a selector value.

**Signature:** `~distinctBy(selector)`

**Examples:**
```
GET /v1/products~distinctBy(status)
GET /v1/trade-orders~distinctBy(customer/identifiers/key)
```

**Notes:**
- Evaluates selector per item
- Drops subsequent items with duplicate selector values
- Supports nested paths

---

### Transformation Operators

#### ~map(typeName)

Apply a registered mapped type to transform each object.

**Signature:** `~map(mappedTypeName)`

**Example:**
```
GET /v1/products~map(com.example.export)
```

**Notes:**
- Looks up a mapped type by name in `/mapped-types`
- The name must match the `mappedTypeName` identifier exactly
- Strips `@type` annotations from output
- Map always returns **one result per source item**
- For single-result aggregation (collapsing multiple inputs to one), use an array-body mapped type with `$prior` and a trailing `"$first"` sentinel:
  ```json
  {
    "body": [{ "total": "$prior/totalAmount", "items": "$prior/items" }, "$first"]
  }
  ```

> **Note:** `"$first"` limits the mapped stream to the first result, but collection responses still serialize as a single-element array. Use `~first` after `~map(...)` if you need a single object.

---

#### ~array

Wrap a single item in an array.

**Signature:** `~array` (no parameters)

**Example:**
```
GET /v1/products/com.example.sku=ABC~array
```

**Notes:**
- Useful for ensuring consistent array output
- Input: single object; Output: array with one element

---

#### ~flat

Flatten nested arrays one level deep.

**Signature:** `~flat` (no parameters)

**Example:**
```
GET /v1/products~with(categories)~flat
```

**Notes:**
- Flattens one level of nesting
- Input: `[[a, b], [c, d]]`; Output: `[a, b, c, d]`

---

#### ~entries

Convert an object to key-value entries.

**Signature:** `~entries` (no parameters)

**Example:**
```
GET /v1/products/com.example.sku=ABC/properties~entries
```

**Output format:** `[{index, key, value}, ...]`

**Notes:**
- Excludes `@type` from entries
- Index is 1-based

---

#### ~typeless

Set context flag to strip `@type` from output.

**Signature:** `~typeless` (no parameters)

**Example:**
```
GET /v1/agents~typeless
```

**Notes:**
- Removes `@type` discriminators from polymorphic types
- Affects all items in the output stream

---

#### ~join(separator)

Join array elements into a string.

**Signature:** `~join(separator)`

**Example:**
```
GET /v1/products/com.example.sku=ABC/gtin~join(,)
```

**Notes:**
- Default separator is `,` if not specified
- Input must be an array

---

#### ~toLower

Convert string to lowercase.

**Signature:** `~toLower` (no parameters)

**Example:**
```
GET /v1/products/com.example.sku=ABC/name~toLower
```

**Notes:**
- Returns `undefined` for non-string values

---

#### ~toUpper

Convert string to uppercase.

**Signature:** `~toUpper` (no parameters)

**Example:**
```
GET /v1/products/com.example.sku=ABC/name~toUpper
```

**Notes:**
- Returns `undefined` for non-string values

---

#### ~toString

Convert value to its string representation.

**Signature:** `~toString` (no parameters)

**Example:**
```
GET /v1/products~count~toString
```

**Notes:**
- Uses `.toString()` on the value
- Useful for converting numeric results for `text/plain` output

---

### Pagination Operators

#### ~take(n)

Take first N items from the stream.

**Signature:** `~take(N)`

**Example:**
```
GET /v1/products~take(10)

# Stable pagination with sorting
GET /v1/products~orderBy(name)~take(50)
```

**Query param equivalent:** `?limit=10`

**Notes:**
- `~take(0)` returns empty result
- `~take(1)` returns first item as part of a collection
- Pair with `~orderBy(selector[:desc])` for stable pages (single selector only)
- Query params **can** be mixed with operators. See [Query Parameter Normalization](#query-parameter-normalization) below.

---

#### ~skip(n)

Skip first N items from the stream.

**Signature:** `~skip(N)`

**Example:**
```
GET /v1/products~skip(20)~take(10)

# Page 3 with stable sort
GET /v1/products~orderBy(name)~skip(100)~take(50)
```

**Query param equivalent:** `?offset=20`

**Notes:**
- `~skip(0)` is a no-op
- Combine with `~take` for pagination
- Use the same `~orderBy` selector on every page to avoid duplicates or gaps

---

#### ~repeat(n)

Repeat the input N times.

**Signature:** `~repeat(N)`

**Example:**
```
GET /v1/products/com.example.sku=ABC~repeat(3)
```

**Notes:**
- Repeats the input item N times in the output stream
- Default is 1 if not specified

---

### Reducer Operators

Reducers collapse a collection to a single value.

#### ~first

Return the first item from a collection.

**Signature:** `~first` (no parameters)

**Example:**
```
GET /v1/products~orderBy(name)~first
```

**Notes:**
- Returns `null` if collection is empty
- Returns a single object, not an array

---

#### ~last

Return the last item from a collection.

**Signature:** `~last` (no parameters)

**Example:**
```
GET /v1/products~orderBy(name)~last
```

**Notes:**
- Returns `null` if collection is empty
- Returns a single object, not an array

---

#### ~count

Return the count of items as a number.

**Signature:** `~count` (no parameters)

**Example:**
```
GET /v1/products~where(status=Active)~count
```

**Notes:**
- Returns `0` for empty collections
- Returns a number, not an array
- Use `~count~toString` for `text/plain` output

---

### Diagnostic Operators

These operators are for debugging and testing purposes.

#### ~test(flag)

Print metadata about the passed stream of objects.

**Signature:** `~test(flag)`

**Example:**
```
GET /v1/products~test(debug)
```

**Notes:**
- For diagnostic use only
- Logs stream metadata to console
- Does not affect output

---

#### ~throwAt(n)

Throw an exception after N elements have passed through.

**Signature:** `~throwAt(N)`

**Example:**
```
GET /v1/products~throwAt(5)
```

**Notes:**
- For testing error handling
- Zero-indexed: `~throwAt(0)` throws immediately
- Not for production use

---

## Query Parameter Equivalents Reference

| Operator | Query Parameter | Notes |
|----------|-----------------|-------|
| `~take(n)` | `?limit=n` | |
| `~skip(n)` | `?offset=n` | |
| `~orderBy(field)` | `?orderby=field` | |
| `~orderBy(field:desc)` | `?orderby=field:desc` | |
| `~withAll` | `?fields=all` | |
| `~just(a,b)` | `?fields=a,b` | Also applies `~simpleJust` |
| `~just()` | `?fields=none` | Empty selection |
| `~with(extra)` | `?fields=default,extra` | |
| `~where(field=value)` | `?field=value` | Each param becomes a predicate |

---

## Query Parameter Normalization

Query parameters and path operators **can be mixed** in the same request. The system normalizes all query parameters into operators and appends them after any path operators in the following **canonical order**:

```
format → fields → where → orderBy → skip → take → simpleJust
```

**Example - mixing works:**
```
GET /v1/products~orderBy(name)?limit=2
```
This is equivalent to:
```
GET /v1/products~orderBy(name)~take(2)
```

**Important:** Because query parameters are translated after path operators, the canonical order ensures:
- Sorting (`orderBy`) always runs **before** pagination (`skip`/`take`)
- This happens regardless of URL parameter order

**Example - parameter order doesn't matter:**
```
GET /v1/products?limit=10&orderby=name
GET /v1/products?orderby=name&limit=10
```
Both produce identical results because `orderBy` is applied before `take` in the canonical pipeline.

**Best practice:** For maximum clarity, prefer explicit operators when order matters:
```
GET /v1/products~orderBy(name)~skip(20)~take(10)
```

---

## See Also

- [Operators Reference](operators.md) — Usage patterns and recipes
- [Mapped Types](mapped-types.md) — Custom type transformations for `~map`
- [Examples](../guide/examples.md) — Practical curl examples
- [Overview](overview.md) — API basics and authentication
