# Primitive Operations & Dynamic Members

This reference documents how to navigate and transform primitive values directly in URL paths.

> **Key Concept:** When you navigate to a primitive value (string, number, boolean, date-time), you can continue the path with operations that transform or query that value. These "dynamic members" let you build powerful single-request queries.

---

## Overview

After navigating to a resource property that holds a primitive value, you can append additional path segments to:
- Transform the value (case conversion, arithmetic, date math)
- Compare the value (equality, range checks)
- Extract parts (string slicing, date components)

**Example URL chain:**
```
GET /people/com.example.id=123/name/length/neg
     └── resource lookup ──────┘    │      └── negate the number (returns negative length)
                                    └───────── get string length
```

To compare with a value, add a comparison operator:
```
GET /people/com.example.id=123/name/length/>=10
     └── resource lookup ──────┘    │      └── comparison (returns boolean: is length >= 10?)
                                    └───────── get string length
```

---

## String Operations

Strings support character access, slicing, case conversion, and comparisons.

### Static Members

| Member | Returns | Description |
|--------|---------|-------------|
| `length` | number | Number of characters in the string |
| `lower` | string | Lowercase version |
| `upper` | string | Uppercase version |
| `trimmed` | string | Leading/trailing whitespace removed |
| `tr` | string | Same as `trimmed` |
| `urlEncode` | string | URL-encoded version |
| `urlDecode` | string | URL-decoded version |
| `base64` | string | Base64-encoded version |
| `splits` | string[] | Split by spaces into array |
| `true` | boolean | Truthy check (non-empty = true) |
| `bool` | boolean | Parse as boolean (`"true"` → true, `"false"` → false) |
| `num` | number | Parse as number (undefined if invalid) |
| `dec` | decimal | Parse as decimal |
| `ld` | string | Lowercase with non-word chars replaced by dashes |
| `ls` | string | Lowercase with non-word chars replaced by underscores |
| `dash` | string | Non-word chars replaced by dashes |
| `score` | string | Non-word chars replaced by underscores |
| `fold` | string | ASCII folding (converts accented/special characters to ASCII equivalents) |

### Dynamic Members (Index & Range)

| Pattern | Returns | Description |
|---------|---------|-------------|
| `{index}` | string | Character at position (0-based) |
| `-1` | string | Last character (negative indexing) |
| `{start}..{end}` | string | Substring from start to end (exclusive) |
| `..{end}` | string | Substring from beginning to end |
| `{start}..` | string | Substring from start to end of string |

**Index examples:**
```
GET /products/com.example.sku=ABC/name/0        → first character
GET /products/com.example.sku=ABC/name/-1       → last character
GET /products/com.example.sku=ABC/name/2..5     → characters 2,3,4
GET /products/com.example.sku=ABC/name/..3      → first 3 characters
GET /products/com.example.sku=ABC/name/5..      → from position 5 to end
```

### Dynamic Members (Comparisons & Concatenation)

| Pattern | Returns | Description |
|---------|---------|-------------|
| `=={text}` | boolean | Equals comparison |
| `!={text}` | boolean | Not equals comparison |
| `>={text}` | boolean | Greater than or equal (lexicographic) |
| `<={text}` | boolean | Less than or equal (lexicographic) |
| `=~{text}` | boolean | Contains substring |
| `!~{text}` | boolean | Does not contain substring |
| `+={suffix}` | string | Append suffix |
| `-={prefix}` | string | Prepend prefix |
| `+~{text}` | string | Smart concatenation (avoids duplicate overlap) |

**Examples:**
```
GET /products/com.example.sku=ABC/name/upper
# Returns: "PRODUCT NAME" (uppercase)

GET /products/com.example.sku=ABC/name/=~Widget
# Returns: true if name contains "Widget"

GET /products/com.example.sku=ABC/name/+=_v2
# Returns: "Product Name_v2" (appended)

GET /products/com.example.sku=ABC/status/==Active
# Returns: true if status equals "Active"

# Smart concatenation (+~) avoids duplicate overlap:
# If name is "Product ABC" and we use +~ABC123:
GET /products/com.example.sku=ABC/name/+~ABC123
# Returns: "Product ABC123" (overlap "ABC" detected, not duplicated)

# ASCII folding for search normalization:
GET /people/com.example.id=123/fullName/fold
# If fullName is "Müller" → returns: "Muller"
# If fullName is "Æther" → returns: "Aether"
# If fullName is "naïve" → returns: "naive"
```

### Printf Formatting

Strings support printf-style formatting:

| Pattern | Description |
|---------|-------------|
| `%s` | String value |
| `%.{n}s` | String truncated to n characters |
| `%{width}s` | Pad to a minimum width (use `-` for left align, `0` for zero-pad) |
| `%%` | Literal percent sign |

**Example:**
```
GET /products/com.example.sku=ABC/name/%.10s
# Returns: first 10 characters of name
```

---

## Number Operations

Numbers (integers and floating-point) support arithmetic, comparisons, and rounding.

### Static Members

| Member | Returns | Description |
|--------|---------|-------------|
| `str` | string | Number as string |
| `true` | boolean | Truthy check (non-zero = true) |
| `neg` | number | Negation (-x) |
| `abs` | number | Absolute value |
| `evn` | boolean | Is even number |
| `dec` | decimal | Convert to decimal type |

### Dynamic Members (Comparisons)

| Pattern | Returns | Description |
|---------|---------|-------------|
| `=={n}` | boolean | Equals |
| `!={n}` | boolean | Not equals |
| `>={n}` | boolean | Greater than or equal |
| `<={n}` | boolean | Less than or equal |

### Dynamic Members (Arithmetic)

| Pattern | Returns | Description |
|---------|---------|-------------|
| `+={n}` | number | Add n |
| `-={n}` | number | Subtract n |
| `*={n}` | number | Multiply by n |
| `/={n}` | number | Divide by n |
| `+={n}%` | number | Add n percent of value |
| `-={n}%` | number | Subtract n percent of value |

### Dynamic Members (Rounding)

| Pattern | Returns | Description |
|---------|---------|-------------|
| `r0` | number | Round to integer (0 decimal places) |
| `r1` | number | Round to 1 decimal place |
| `r2` | number | Round to 2 decimal places |
| `r{n}` | number | Round to n decimal places (any non-negative integer) |
| `r` | number | Round to 10 decimal places (default) |

> **Note:** Multi-digit precision is supported (e.g., `r12` rounds to 12 decimal places). The `r` shorthand without a number defaults to 10 decimal places.

### Printf Formatting

| Pattern | Description |
|---------|-------------|
| `%d`, `%i` | Integer |
| `%u` | Unsigned integer |
| `%f` | Fixed-point (default 6 decimals) |
| `%.{n}f` | Fixed-point with n decimals |
| `%e`, `%E` | Scientific notation |
| `%g`, `%G` | Shortest representation |
| `%x`, `%X` | Hexadecimal |
| `%o` | Octal |
| `%s` | Value as string |
| `%c` | Character from code point |

**Examples:**
```
GET /products/com.example.sku=ABC/name/length/neg
# Returns: -12 (negated string length)

GET /products/com.example.sku=ABC/price/amount/+=10%
# Returns: price + 10% (e.g., 100 → 110)

GET /products/com.example.sku=ABC/price/amount/r2
# Returns: price rounded to 2 decimals

GET /products/com.example.sku=ABC/price/amount/%.2f
# Returns: "99.99" (formatted string)

GET /people/com.example.id=123/name/length/==-4
# Returns: false (length is not -4; negation example from task)
```

---

## Decimal Operations

Decimals (precision-preserving numbers encoded as strings) share most number operations.

### Static Members

| Member | Returns | Description |
|--------|---------|-------------|
| `str` | string | Decimal as string |
| `true` | boolean | Truthy check (non-zero = true) |
| `num` | number | Convert to JavaScript number |
| `neg` | decimal | Negation |
| `abs` | decimal | Absolute value |
| `evn` | boolean | Is even |

### Dynamic Members

Same patterns as numbers: `==`, `!=`, `>=`, `<=`, `+=`, `-=`, `*=`, `/=`, `+=%`, `-=%`, rounding (`r{n}` for any non-negative integer n, with default `r` = 10 decimals), and printf formatting.

---

## Boolean Operations

Booleans support conversion and inversion.

### Static Members

| Member | Returns | Description |
|--------|---------|-------------|
| `str` | string | Boolean as `"true"` or `"false"` |
| `int` | number | Boolean as `1` or `0` |
| `inv` | boolean | Inverse (NOT) |
| `assert` | boolean or null | Returns the boolean if true, otherwise null |

**Examples:**
```
GET /products/com.example.sku=ABC/hidden/inv
# Returns: true if product is NOT hidden

GET /products/com.example.sku=ABC/hidden/int
# Returns: 1 if hidden, 0 if not

GET /products/com.example.sku=ABC/hidden/assert
# Returns: true if hidden, null if not (useful for conditional checks)
```

---

## Date-Time Operations

Date-time values support relative math, component extraction, and cron-based scheduling.

### Static Members

| Member | Returns | Description |
|--------|---------|-------------|
| `local` | date-time | Date in local timezone (affects JSON serialization) |
| `ms` | number | Milliseconds since Unix epoch |
| `date` | string | Date part only (`YYYY-MM-DD`) |
| `time` | string | Time part only (`HH:MM:SS`) |
| `str` | string | Full ISO 8601 string |
| `true` | boolean | Truthy check (`Boolean(date.getTime())`; note: Unix epoch is falsy) |

### Dynamic Members (Relative Math)

Add or subtract time from a date-time value:

| Pattern | Description |
|---------|-------------|
| `+={h}:{m}:{s}` | Add hours:minutes:seconds |
| `-={h}:{m}:{s}` | Subtract hours:minutes:seconds |
| `+={h}:{m}:{s}.{ms}` | Add with milliseconds |
| `-={h}:{m}:{s}.{ms}` | Subtract with milliseconds |

The time format is `hours:minutes:seconds[.milliseconds]`. Any component can be omitted from the right.

**Examples:**
```
GET /trade-orders/com.example.id=ORD1/createdAt/+=1:00:00
# Returns: createdAt + 1 hour

GET /trade-orders/com.example.id=ORD1/createdAt/-=0:30:0
# Returns: createdAt - 30 minutes

GET /trade-orders/com.example.id=ORD1/createdAt/+=24:0:0
# Returns: createdAt + 24 hours (next day)
```

### Dynamic Members (Cron Expressions)

Calculate the next occurrence from a cron expression. Use underscores (`_`) instead of spaces in URL paths:

```
GET /now/0_0_*_*_1
# Returns: next Monday at midnight (cron: "0 0 * * 1")

GET /trade-orders/com.example.id=ORD1/createdAt/0_9_*_*_*
# Returns: next 9:00 AM occurrence after createdAt
```

> **Note:** Cron expressions use standard 5-field format: minute, hour, day-of-month, month, day-of-week.

---

## Practical Examples

### Chaining Operations

Multiple operations can be chained in a single URL path:

```bash
# Get product name, uppercase it, check if contains "WIDGET"
GET /products/com.example.sku=ABC/name/upper/=~WIDGET

# Get order date, add 7 days, extract date part
GET /trade-orders/com.example.id=ORD1/createdAt/+=168:0:0/date

# Get price, add 25% VAT, round to 2 decimals
GET /products/com.example.sku=ABC/price/amount/+=25%/r2

# Get person name length, check if greater than 10
GET /people/com.example.id=123/name/length/>=10
```

### Copy-Paste Reference Examples

```bash
# Navigate to person, get name length, negate (returns negative number)
GET /people/com.example.id=123/name/length/neg
# If name is "John Doe" (length 8), returns: -8

# Navigate to person, check if name length equals 4 (without negation)
GET /people/com.example.id=123/name/length/==4
# Returns: true or false

# Navigate to product, get name, convert to uppercase
GET /products/com.example.sku=ABC/name/upper

# Navigate to product name, get length, round to 2 decimals (useful after division)
GET /products/com.example.sku=ABC/name/length/r2

# Navigate to order creation date, add 1 hour
GET /trade-orders/com.example.id=ORD1/timestamp/+=1:00:00
```

### Real-World Scenarios

```bash
# Check if product SKU starts with "ELEC-"
GET /products/com.example.id=123/sku/..5/==ELEC-

# Calculate 30-day expiry from order date
GET /trade-orders/com.example.id=ORD1/createdAt/+=720:0:0

# Get formatted price string with 2 decimals
GET /products/com.example.sku=ABC/price/amount/%.2f

# Check if quantity is even (for pair-based products)
GET /inventory/com.example.id=INV1/quantity/evn

# Get slug-friendly version of product name
GET /products/com.example.sku=ABC/name/ld
# Returns: "my-product-name" (lowercase, dashes for spaces)
```

---

## Specialized Primitive Types

In addition to the core primitives above, the API uses specialized string types for validation and semantic clarity.

### Strict String

A strict string is a validated string that cannot be:
- The empty string (`""`)
- Only whitespace characters
- The literal string `"0"` (treated as undefined/empty)

Strict strings ensure that meaningful values are provided. If you pass `"0"` or `"   "` where a strict string is expected, it will be treated as undefined.

**Used for:** Fields where empty or placeholder values are not acceptable, such as `sku`, `barcode`, `externalId`.

### URL

The URL type is a **strict string with URL semantics**. It inherits all `strict string` validation (rejects empty, whitespace-only, and `"0"` values) but does **not** perform URL parsing or validation.

> **Note:** The API accepts any non-empty string as a URL value. URL format validation (protocol, domain structure, etc.) is the responsibility of the client application.

**Examples:**
```
https://example.com
https://example.com/page?query=value
```

**Used for:** Image URLs, external links, webhook endpoints, integration URLs.

### Namespaced Key

A namespaced key is a unique identifier in [reverse domain name notation](https://en.wikipedia.org/wiki/Reverse_domain_name_notation). It **must contain exactly two dots** (three segments) and be **no longer than 128 characters**.

**Format:** `{tld}.{domain}.{identifier}`

**Regex:** `/^\w+\.[\w-]+\.[\w$-]+$/`

**Constraints:**
- Exactly three segments separated by two dots
- First segment: word characters only (`[A-Za-z0-9_]`)
- Second segment: word characters or hyphens
- Third segment: word characters, hyphens, or dollar signs
- Maximum total length: 128 characters

**Examples:**
```
com.example.myapp
com.heads.retailID
se.integrator.ProductId
com.my-company.customer_123
```

**Invalid examples:**
```
example.id               # Only 2 segments (1 dot)
com.mycompany.erp.id     # 4 segments (3 dots) - not allowed
```

**Used for:** External identifier keys (the left side of identifier assignments like `com.example.id=123`).

### Null

The null type represents the intentional absence of a value. It parses the literal string `"null"` (case-insensitive) into a null value.

**Example:**
```
GET /products~where(category=null)
# Filters products where category is not set
```

**Used for:** Filtering by missing values, explicit null assignments.

---

## Type Summary

| Type | Key Operations |
|------|----------------|
| **string** | `length`, `lower`/`upper`, `fold`, indexing (`0`, `-1`), ranges (`2..5`), contains (`=~`), concat (`+=`, `+~`) |
| **strict string** | Same as string; rejects `""`, whitespace-only, and `"0"` |
| **url** | Strict string with URL semantics (no validation) |
| **namespaced key** | Exactly two dots, max 128 chars (e.g., `com.example.id`) |
| **number** | `neg`, `abs`, `evn`, arithmetic (`+=`, `-=`, `*=`, `/=`), percent (`+=10%`), rounding (`r{n}` for any n, default `r`=10), formatting (`%c`, `%0{width}d`) |
| **decimal** | Same as number, with precision preservation |
| **boolean** | `str`, `int`, `inv`, `assert` (returns null if false) |
| **date-time** | `date`, `time`, `ms`, `local`, relative math (`+=h:m:s`), cron expressions (`_` for spaces) |
| **null** | Parses `"null"` literal |

---

## See Also

- [Operators Reference](operators.md) - Query operators for filtering and transforming collections
- [Operators Catalog](operators-catalog.md) - Complete operator reference with examples
- [Mapped Types](mapped-types.md) - Custom type transformations
