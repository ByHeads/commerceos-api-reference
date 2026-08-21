# Platform Takeaways (API Usage)

Concise notes on key CommerceOS API patterns and behavior.

---

## 1) Operators and Selectors

### Path Operators

Operators in URL paths chain left-to-right as written:

- `~where(condition)` - Filter collections (AND-combine predicates)
- `~either(condition)` - Filter collections (OR-combine predicates)
- `~with(field)` - Expand non-essential fields
- `~just(fields)` - Project specific fields only
- `~map(name)` - Apply a mapped type transformation
- `~take(N)` and `~skip(N)` - Pagination
- `~orderBy(field:desc)` - Sorting
- `~distinct` and `~distinctBy(key)` - Deduplication

Order is literal, and it decides cost as well as meaning: a limiter placed after a filter stops the scan at the Nth match (placed before it, the answer changes too), and a `~skip` with nothing filtering or sorting in front of it steps over the skipped records without building them. See [Operators → Operator Application Order](operators.md#operator-application-order).

**Reach an element with an operator, not with a number.** `/{collection}/0` means "the element whose key is `0`", so on a collection addressed by key or identifiers — a trade order's `items`, for one — it is a `404` rather than the first element. A plain array of scalars such as `gtin` does take `/0`, and the two are indistinguishable in a response. `~first`, `~last`, `~take(n)` and `~skip(n)` work on both (see [gotcha 42](common-gotchas.md#42-a-positional-index-on-a-keyed-collection-is-a-404)).

### Query Parameter Order

When using query parameters instead of path operators, they are canonicalized to a fixed order regardless of how they appear in the URL:

```
format → where → orderBy → fields → skip → take → simpleJust
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

- `identifiers` - External ID support with reverse-domain keys — exactly three dot-separated segments; anything else is [silently discarded on write](overview.md#a-malformed-identifier-key-is-discarded-not-rejected)
- `name` - Full name
- `nationality`, `languages`, `vatId`
- `addresses` - Nested object with `main`, `home`, `invoice`, `delivery`, `visiting`
- `contactMethods` - Phone numbers, email addresses
- `customerRelations`, `supplierRelations`, `manufacturerRelations` - Trade relationships. Established relationships only, so they reconcile with `/v1/trade-relationships`; an agent that trades under a parent has none of its own
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
- To add one to an existing object, use the `@value` envelope — the outer `identifiers` select the object, the ones inside `@value` are written onto it (see [Resource Patterns → The `@value` Write Envelope](resource-patterns.md#the-value-write-envelope))

---

## 6) Identity and Access

- A **user** is an account, not a person — it holds credentials and points at an `agent` that carries the name. Users have no `name` member (see [Users](users.md))
- **API access is decided by the scopes on the credential making the request** — the `scopes` array on an API key, or an OAuth2 client's granted scopes. User roles and permissions govern the CommerceOS applications, not the API (see [Roles → What roles do not control](user-roles.md#what-roles-do-not-control))
- **Provisioning is an `admin` operation.** There is no `users:write`; `users:read` is read-only. The `admin` scope is excluded from the generated OpenAPI spec, so these endpoints are not described by `/api-docs`
- **Credential secrets are write-only.** Reads return `"********"`; writing that placeholder back sets the secret to those eight characters (see [gotcha 33](common-gotchas.md#33-a-read-modify-write-on-credentials-overwrites-the-secret))
- `DELETE` on a **user** deactivates; `DELETE` on a **credential** purges
- **A scope problem does not answer `403`.** Several resources exist twice, read-only under `<area>:read` and writable under `<area>:write`, at the same path. A write that lands on the read-only twin is a `200` that persists nothing; a token holding neither scope gets a `404`. Confirm a write by reading it back, never by its status (see [gotcha 41](common-gotchas.md#41-a-write-under-a-read-only-scope-is-a-silent-200))
