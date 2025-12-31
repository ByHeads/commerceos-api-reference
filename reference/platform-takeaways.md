# Platform Takeaways (API Usage)

Concise notes on key CommerceOS API patterns and behavior.

---

## 1) Operators and Selectors

### Path Operators

Operators in URL paths chain left-to-right as written:

- `~where(condition)` - Filter collections
- `~with(field)` - Expand non-essential fields
- `~just(fields)` - Project specific fields only
- `~map(name)` - Apply a mapped type transformation
- `~take(N)` and `~skip(N)` - Pagination
- `~orderBy(field:desc)` - Sorting
- `~distinct` and `~distinctBy(key)` - Deduplication

### Query Parameter Order

When using query parameters instead of path operators, they are canonicalized to a fixed order regardless of how they appear in the URL:

```
format → fields → where → orderBy → skip → take → simpleJust
```

This means `?skip=10&orderBy=name:asc` is equivalent to `?orderBy=name:asc&skip=10` — sorting always runs before pagination.

Selector syntax supports:
- `$prior`, `$this`, `$index` for context references
- Concatenation with `+`
- Null coalescing with ` ?? ` (spaces required)
- Ternary expressions `cond ? a : b`
- Type coercion via `->string`, `->number`, `->boolean`

---

## 2) Mapped Types

Mapped types provide reusable transformations for data export:

- Stored in the `mapped-types` resource
- Applied via `~map(<name>)` operator
- Returns one result per source item when mapping collections

### Aggregation with `$prior` and `$first`

To aggregate multiple source items into a single result, use an array-body mapped type with `"$first"`:

```json
{
  "body": [
    {
      "receipts": "$prior",
      "items": "$prior/items",
      "payments": "$prior/payments"
    },
    "$first"
  ]
}
```

The `$prior` selector references data from the source context. `"$first"` limits the mapped stream to the first result, but collection responses still serialize as a single-element array (`[ { ... } ]`). Use `~first` after `~map(...)` if you need a single object rather than an array.

### Request Mapping (X-Request-Map)

> **Warning: Currently Blocked/Unsupported**
>
> The `X-Request-Map` header is currently blocked/unsupported. The resolver treats selectors as reference paths (`regularStringsMapping="reference"`), but raw JSON request bodies lack Pillow type context, so resolution fails. Use normal payloads or `~map(...)` on reads until the resolver supports literal mapping for raw JSON.

---

## 3) Common Resource Patterns

### Agents

Agents represent people, companies, or stores:

- `identifiers` - External ID support with reverse-domain keys
- `name` - Full name
- `nationality`, `languages`, `vatId`
- `addresses` - Nested object with `main`, `home`, `invoice`, `delivery`, `visiting`
- `contactMethods` - Phone numbers, email addresses
- `customerRelations`, `supplierRelations`, `manufacturerRelations` - Trade relationships
- `timeline` - List of receipts where this agent is the buyer

### Product Nodes

Products in the catalog:

- `identifiers` - External ID support
- `name`, `gtin`, `plu`, `hidden`, `createdAt`, `createdBy`
- `images` - With full replace on set
- `assortmentOwners` - Add/remove pattern
- `labels` - Assigned labels
- `xrefs.compatibles/alternatives` - Cross-references

---

## 4) Essential vs Non-Essential Fields

Most API responses include only "essential" fields by default:

- Use `~with(field)` or `~withAll` to expand additional fields
- Use `~just(a,b,c)` to return only specified fields
- Query params `fields=...` or `fields=all` also work

---

## 5) External Identifiers

Resources support user-defined external identifiers:

- Reverse-domain notation: `com.example.id`
- Access via `identifiers` member
- Multiple external IDs can exist on the same object
- Used for integration and cross-system references
