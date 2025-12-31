# Mapped Types

Mapped types are named mapping definitions stored in the API and used to transform data in two places:
- **Response mapping** via the `~map(<mappedTypeName>)` operator.
- **Request mapping** via the `X-Request-Map` header on write operations.

This document covers the storage model, lookup rules, and the selector language used in mapped type bodies.

---

## Body Formats

A mapped type `body` can be:
- **A single object** — the standard mapping definition where keys are output field names and values are selectors
- **An array** (pipeline) — a sequence of transformations applied in order

### Array Body (Pipeline)

When `body` is an array, each element is resolved sequentially. The output of each stage becomes the input for the next. This enables multi-stage transformations.

**The `"$first"` sentinel:**

Include `"$first"` as the last element of an array body to return only the **first mapped result** when mapping a collection. This is useful when you want a single representative item rather than the full transformed collection.

```json
{
  "identifiers": { "mappedTypeName": "com.example.receipts-zip" },
  "active": true,
  "body": [
    {
      "receipts": "$prior~map(com.example.receipt-row)",
      "items": "$prior~just(items~map(com.example.receipt-item-row))/*items~flat"
    },
    "$first"
  ]
}
```

**Behavior with `$first`:**
- Without `$first`: mapping a collection returns an array of all mapped results
- With `$first`: mapping a collection returns only the first mapped result, but the response is still a single-element array (use `~first` after `~map(...)` for a single object)

**Use cases for `$first`:**
- Extracting a single representative record from a batch
- Testing mapping transformations on real data without processing entire collections
- Building aggregate summaries where you only need one output object

---

## Using the ~map Operator

The `~map` operator applies a mapped type to transform API responses.

**Basic usage:**
```bash
# Transform products using a custom export format
GET /v1/products~map(com.example.export)

# Chain with other operators
GET /v1/products~where(status=Active)~map(com.example.export)~take(10)

# Apply to single item
GET /v1/products/com.example.sku=ABC~map(com.example.export)
```

**Key behaviors:**
- Single items return a single mapped object
- Collections return an array of mapped objects
- Output automatically strips `@type` annotations
- Only mapped fields appear in output (existing fields not in the mapping are excluded)

See [Operators Reference](operators.md) for more on `~map` and other operators.

---

## Mapped Type Body Structure

A mapped type body is a JSON object where:
- **Keys** are the output field names
- **Values** are selectors, expressions, or nested mappings

```json
{
  "outputField": "selector/path",
  "aliasedField": "selector",
  "nested": { "child": "path/to/value" },
  "literal": "'static text'",
  "computed": "field1+':'+field2"
}
```

### Field Aliasing

Mapped types alias fields by using the desired output name as the key:

```json
{
  "productName": "name",
  "sku": "identifiers/com.example.sku",
  "lastUpdate": "updatedAt"
}
```

The key is the output field name; the selector path determines what value is retrieved.

### Arrays in Mapped Types

Array values resolve each element as a selector:

```json
{
  "labels": ["tags/0", "tags/1", "tags/2"],
  "mixedData": ["name", "status", "'constant'"]
}
```

Each element in the array is resolved independently, producing an array of values in the output.

---

## Storage and Lookup

**Identifiers**
- `identifiers.mappedTypeName` is the canonical name used by `~map(...)` and `X-Request-Map`.

**Body storage**
- `body` is stored as a JSON string.
- On read, `body` is parsed as either a single object or an array (pipeline format).
- Within object bodies, array values in properties are treated as collections to resolve.

**Lookup**
- `~map(<name>)` resolves the mapped type by name.
- If the mapped type has no body, `NotFound` is thrown with: `There is no active mapped type with name '<name>'`.
- Note: The `active` flag is purely metadata; the lookup only checks for presence of a body.

---

## Map Operator Behavior

**Settings:**
- Output removes `@type` annotations
- Spaces inside selectors become concatenation boundaries
- Output contains only mapped fields (clears existing subunits)
- No implicit field expansion outside the mapping

**Single vs collection**
- Mapping a **single item** returns one mapped object.
- Mapping a **collection** returns an array of mapped objects.
- Use `"$first"` in an array-body to limit the mapped stream to the first result; collection responses still serialize as arrays. Use `~first` after `~map(...)` if you need a single object.

---

## Aggregation with $prior

Use `$prior` to reference the parent collection when you need aggregate information in your mapping. This is useful for including counts or other collection-level data.

**Example: Including collection count**
```json
{
  "name": "name",
  "totalInCollection": "$prior~count"
}
```

When mapped over a collection, each result includes the total count of items.

**Example: Building a receipt bundle with `$first`**
```json
[
  {
    "receipt": "$this",
    "items": "$this/items",
    "payments": "$this/payments"
  },
  "$first"
]
```

This array-body format:
1. Uses `$this` to reference the current receipt being mapped
2. Limits output to a single result (due to `"$first"`), though the response still serializes as a single-element array

**Note:** Use `$this` for the current item and `$prior` for the parent collection (e.g., `$prior~count` for collection totals).

---

## Selector Language (Mapping Body)

Mapped type bodies are objects whose values can be selectors or nested mappings.

### 1) URI selectors and operators

Selectors behave like API paths:
- `identifiers/receiptID`
- `items/count/str`
- `discounts~map(com.heads.receipt-item-discount-line)/*line~join(;)`

Selectors may start with:
- `/` to anchor at the current item
- `/api/v1/...` to anchor at the API root
- `~` to apply operators directly

### 2) Literals

Wrap in single quotes to force a literal string:
- `"buyer/name ?? 'unknown'"`
- `"reason/name+':'+amount/str"`

### 3) Null-coalescing

Use ` ?? ` (note required spaces) to provide a fallback:
- `"buyer/name ?? ''"`

### 4) Ternary expressions

Use `cond ? trueExpr : falseExpr` for conditional output:
- `"paymentType ? paymentType : 'unknown'"`

> **Critical: Existence-based, not value-based**
>
> The condition is an **existence check**, not a value comparison. It tests whether the selector resolves to a truthy value (exists and is not null/undefined/empty).

**What this means:**
- `"status ? status : 'none'"` — returns the status value if it exists, otherwise `'none'`
- `"field=value"` — this is NOT a comparison; it resolves as a path `field/=value`

**Correct patterns:**
```json
{
  "safePayment": "paymentType ? paymentType : 'Unknown'",
  "hasDiscount": "discount ? 'Yes' : 'No'",
  "fallback": "nonexistent ? nonexistent : 'Default'"
}
```

**For value-based logic**, use `~where()` filtering before mapping:
```bash
# Filter first, then map
GET /v1/products~where(status=Active)~map(com.example.active-export)
```

### 5) Concatenation

Use `+` to concatenate values and literals:
- `"identifiers/receiptID+':'+timestamp/str"`

If all parts are primitive, the result becomes a string. If any part is non-primitive, a flattened array is returned.

### 6) Context references

Special prefixes navigate the data graph:
- `$this` -> current item
- `$prior` -> parent item (repeatable: `$prior/$prior/...`)
- `$index` -> array index of the current item

Example from default mapped types:
```
"Receipt ID": "$prior/$prior/identifiers/receiptID"
```

### 7) Variables

If a **key** in the mapping object starts with `$`, it defines a variable instead of emitting a field:
```
{
  "$seller": "seller",
  "Seller name": "$seller/name"
}
```

Variables can be reused in later selectors within the same mapping.

### 8) Nested objects and arrays

Mapping values can be objects (nested mappings) or arrays:
```
{
  "address": { "line1": "addresses/main/line1" },
  "tags": ["labels/0", "labels/1"]
}
```

Arrays are emitted as arrays of resolved values.

---

## Request Mapping (X-Request-Map)

> **⚠️ Experimental Feature**
>
> The `X-Request-Map` header is currently **experimental and non-functional** for most use cases. Selectors in mapped type bodies become REST paths during resolution, which requires type context that raw JSON request bodies lack. Until the resolver is updated to handle literal selectors for raw JSON input, **preprocessing data client-side is the recommended approach**.

Write operations can transform incoming JSON by specifying the `X-Request-Map` header.

**Intended behavior:**
- The incoming body is deserialized.
- Each item is mapped using the mapped type body.
- The mapped result is JSON-serialized to materialize computed values before write.

**Example (currently non-functional):**
```
PUT /v1/products
X-Request-Map: com.myapp.product-import

[
  {"sku":"P-1","title":"Widget","state":"Active"}
]
```

Mapped type body:
```json
{
  "identifiers": { "com.myapp.sku": "sku" },
  "name": "title",
  "status": "state"
}
```

### Why X-Request-Map Fails

The core issue is that selectors (e.g., `"sku"`, `"title"`, `"state"`) are resolved with `regularStringsMapping="reference"`, which converts them to REST paths (e.g., `/sku`). The REST pipeline then attempts to navigate these paths against the raw JSON object, but:

1. **Raw JSON lacks type information** — the resolver needs Pillow type descriptors to navigate property paths
2. **No property descriptors** — `unify()` creates a dynamic Unit without `possibleTypes` or member definitions
3. **Path resolution fails** — without type context, the pipeline cannot resolve property access

**Potential future fixes:**
- Add a "dynamic object" type that wraps JSON and exposes properties as members
- Modify the resolver to use `regularStringsMapping="literal"` for X-Request-Map operations
- Create a custom Unit wrapper that provides type descriptors for JSON object keys

### Alternative: Client-Side Preprocessing

Until X-Request-Map is fixed, transform data client-side before sending:

```javascript
// Client-side transformation
const externalData = [
  { sku: "P-1", title: "Widget", state: "Active" }
];

const apiPayload = externalData.map(item => ({
  identifiers: { "com.myapp.sku": item.sku },
  name: item.title,
  status: item.state
}));

// Send transformed data directly
PUT /v1/products
Content-Type: application/json

[
  {
    "identifiers": { "com.myapp.sku": "P-1" },
    "name": "Widget",
    "status": "Active"
  }
]
```

---

## Default Mapped Types

Key patterns:
- **Receipt CSV export**: `com.heads.receipt-csv`
- **Receipt item CSV export**: `com.heads.receipt-item-csv`
- **Receipt payment CSV export**: `com.heads.receipt-payment-csv`
- **Receipt discount line**: `com.heads.receipt-item-discount-line`
- **Receipt ZIP bundle**: `com.heads.receipts-zip` using `$prior` and `"$first"`

Examples:
```
GET /v1/receipts~map(com.heads.receipt-csv)
GET /v1/receipts~just(items~map(com.heads.receipt-item-csv))/*items~flat
GET /v1/receipts~just(payments~map(com.heads.receipt-payment-csv))/*payments~flat
GET /v1/receipts~map(com.heads.receipts-zip)
```

The ZIP mapping uses an array-body with `"$first"`:
```json
[
  {
    "receipts": "$prior~map(com.heads.receipt-csv)",
    "items": "$prior~just(items~map(com.heads.receipt-item-csv))/*items~flat",
    "payments": "$prior~just(payments~map(com.heads.receipt-payment-csv))/*payments~flat"
  },
  "$first"
]
```

Note: `$first` limits the mapped stream to one result, but collection responses still serialize as `[ { ... } ]`. Use `~first` after `~map(...)` to return a single object.
