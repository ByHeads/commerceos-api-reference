# Common API Gotchas

Known pitfalls and their solutions when working with the CommerceOS API. This is mainly for AI agents who tend do make mistakes with these things, but us humans can benefit too :)

---

## 1. No GTIN/PLU Indexer on Products

Products cannot be indexed by GTIN or PLU directly.

```bash
# WRONG - No GTIN indexer exists
GET /products/gtin=7312345678901

# RIGHT - Use ~where() to filter by GTIN
GET /products~where(gtin=7312345678901)~first
```

---

## 2. Nested Paths Use camelCase

Top-level collections use kebab-case, but nested member paths use camelCase:

```bash
# RIGHT - camelCase for member paths
GET /agents/{key}/customerRelations
GET /product-categories/{key}/childCategories

# WRONG - kebab-case for member paths
GET /agents/{key}/customer-relations  # Will not work
```

---

## 3. ~reverse() and ~any() Don't Exist

```bash
# WRONG - ~reverse() doesn't exist
GET /products~orderBy(name)~reverse()

# RIGHT - Use :desc suffix
GET /products~orderBy(name:desc)

# WRONG - ~any() doesn't exist
GET /products~any(status=Active)

# RIGHT - Use ~where() + ~first or ~count
GET /products~where(status=Active)~first
```

---

## 4. Store Uses `owner`, Not `parent`

Stores use `owner` to reference the owning company:

```bash
# RIGHT
POST /stores '{"owner": {"identifiers": {...}}, ...}'

# WRONG
POST /stores '{"parent": {"identifiers": {...}}, ...}'
```

---

## 5. POS Terminal Uses `associatedNode`, Not `store`

```bash
# RIGHT
POST /pos-terminals '{"associatedNode": {"identifiers": {...}}, ...}'

# WRONG
POST /pos-terminals '{"store": {"identifiers": {...}}, ...}'
```

---

## 6. Trade Relationship Uses `supplierAgent`/`customerAgent`

```bash
# RIGHT
POST /trade-relationships '{
  "supplierAgent": {"identifiers": {...}},
  "customerAgent": {"identifiers": {...}}
}'

# WRONG - supplier/customer without "Agent" suffix
POST /trade-relationships '{"supplier": {...}, "customer": {...}}'
```

---

## 7. Currency Must Be Referenced by Identifier

```bash
# WRONG
POST /prices '{"currency": "SEK", ...}'

# RIGHT
POST /prices '{"currency": {"identifiers": {"currencyCode": "SEK"}}, ...}'
```

---

## 8. Agent References Require Nested identifiers

Agent references require the `identifiers` wrapper object. The `@type` is optional—include it when you want to be explicit or when creating the agent itself.

```bash
# WRONG - identifiers must be nested under identifiers
POST /stores '{"owner": {"com.myapp.id": "123"}}'

# RIGHT - identifiers only (no @type needed for references)
POST /stores '{"owner": {"identifiers": {"com.myapp.id": "123"}}}'

# ALSO OK - explicit @type
POST /stores '{"owner": {"@type": "company", "identifiers": {"com.myapp.id": "123"}}}'
```

> **When to include @type:** Use `@type` when creating the referenced entity itself (e.g., `POST /companies`), or when referencing a polymorphic type where the system cannot infer the subtype. For simple owner/customer/supplier references to existing entities, identifiers alone are sufficient.

---

## 9. Parameterless Operators: No Empty Parentheses

Operators without parameters must be used WITHOUT parentheses:

```bash
# WRONG - Empty parentheses break the query
GET /products~first()   # Returns "not found"
GET /products~count()   # Error

# RIGHT - No parentheses
GET /products~first
GET /products~count
GET /products~map(status)~distinct
```

---

## 10. Products Belong to Groups via `parentGroup`

To add a product to a group, set the product's `parentGroup`:

```bash
# WRONG - This doesn't persist
POST /product-groups/{key}/members '{"identifiers": {...}}'

# RIGHT - Set parentGroup on the product
PATCH /products/{key} '{"parentGroup": {"identifiers": {...}}}'
```

---

## 11. Companies Don't Have `stores` Member

Companies do NOT have a `stores` array. Use trade-relationships or query stores:

```bash
# WRONG
GET /companies~with(stores)

# RIGHT - Query stores by owner
GET /stores~where(owner/identifiers/key=COMPANY_KEY)
```

---

## 12. Agents Don't Have `tradeOrders` or `stockTransactions`

Stores and other agents don't have direct order/transaction members:

```bash
# WRONG
GET /stores~with(tradeOrders)

# RIGHT - Query orders directly
GET /trade-orders~where(sellers/identifiers/key=STORE_KEY)
```

---

## 13. ~distinct Only Works on Primitives

```bash
# WRONG - No effect on object streams
GET /products~distinct

# RIGHT - Use ~distinctBy for objects
GET /products~distinctBy(status)

# Or map to primitive first
GET /products~map(status)~distinct
```

---

## 14. Use `contactMethods`, Not `contactPoints`

Agent contact information is under `contactMethods`:

```bash
# RIGHT
GET /people/com.test.id=123~with(contactMethods)
PATCH /people/com.test.id=123 '{"contactMethods": {"email": "new@example.com"}}'

# WRONG - contactPoints doesn't exist
GET /people/com.test.id=123~with(contactPoints)
```

Slots: `landlinePhone`, `mobilePhone`, `workPhone`, `email`

---

## 15. SQL Serializers Require Mapped Types

SQL output is available via `Accept: application/sql` or `Accept: application/vnd.ms-sqlserver.csv`, but **only works with mapped types** that emit `SqlStatement[]` arrays. Direct queries return JSON—the SQL serializers require pre-structured SQL statement output.

```bash
# WRONG - Direct queries don't produce SQL
GET /receipts~take(10)
Accept: application/sql
# Returns error: arrays/objects rejected without flattening

# RIGHT - Use a mapped type that emits SqlStatement[]
GET /receipts~take(10)~map(com.example.receipt-sql-export)
Accept: application/sql
# Returns: INSERT INTO receipts (...) VALUES (...);
```

**Key behaviors:**
- Arrays and nested objects are **rejected** by the SQL serializer unless your mapped type flattens them first
- Use `batchSize` parameter for streaming: `Accept: application/sql;batchSize=100`
- SQL Server CSV (`application/vnd.ms-sqlserver.csv`) uses BCP-compatible escaping

See [SQL Export](../features/sql-export.md) for mapped type examples and value conversion rules.

---

## 16. Body Indicator Navigation Patterns

The `@` marker in a URL path targets the request body to a specific endpoint. Path segments after `@` navigate through the result.

```bash
# Basic pattern: @target/navigation
PUT /agents/@find/results           # Send body to /agents/find, navigate to results

# Navigate into results by index
PUT /agents/@find/results/0         # First match
PUT /agents/@find/results/0/name    # Name of first match

# Operators work after navigation
PUT /agents/@find/results~take(5)~just(name,identifiers)
```

**Common finder endpoints:**
- `/agents/@find` - Agent lookup by email, phone, nationalId, or metaphone-based name filtering
- `/trade-orders/@find` - Order lookup by modifiedTag, customer, supplier, buyer, seller

---

## 17. Single-Result Aggregation with `$prior` + `"$first"`

To aggregate collection data into a single result (e.g., bundling all receipts with items/payments), use an array-body mapped type with `$prior` and the `"$first"` sentinel:

```json
// Mapped type body - aggregates collection into single bundle
[
  {
    "receipts": "$prior",
    "items": "$prior~flatMap(items)",
    "payments": "$prior~flatMap(payments)"
  },
  "$first"
]
```

```bash
# Returns a single object (not an array)
GET /receipts~take(100)~map(com.example.receipt-bundle)
# → {"receipts": [...], "items": [...], "payments": [...]}
```

**Key points:**
- `$prior` references the entire source collection within the mapped type body
- `"$first"` as the final array element triggers single-result extraction
- Without `"$first"`, `~map` returns one result per source item (array output)

---

## 18. Ternary Conditions in Mapped Types Test Existence

In mapped type ternary expressions, the condition tests for **existence**, not value comparison:

```json
{
  "result": "someField ? 'has value' : 'empty'"
}
```

This returns `'has value'` if `someField` exists and is truthy, not if it equals a specific value. For value comparisons, use `~where()` filtering before mapping.

---

## 19. Query Parameter Normalization Order

Query parameters (`?limit=…&orderby=…`) are translated to operators in a **fixed canonical order**, regardless of how they appear in the URL:

```
format → fields → where → orderBy → skip → take → simpleJust
```

This means sorting (`orderBy`) always runs **before** pagination (`skip`/`take`) when using query params—ensuring consistent page boundaries.

**Examples:**

```bash
# Query params: orderBy applied BEFORE skip/take
GET /products?offset=2&limit=3&orderby=name
# → Sorts all by name, then skips 2, then takes 3

# Operators: explicit left-to-right chaining (same result)
GET /products~orderBy(name)~skip(2)~take(3)
# → Sorts all, then skips 2, then takes 3

# Query params can be mixed with path operators
GET /products~where(status=Active)?orderby=name&limit=10
# → Filters active, sorts by name, takes 10
```

**Best practice:** Query params and operators can be freely mixed. The system normalizes everything into the canonical pipeline order before execution.

---

## 20. Product Identifiers Require Fully Qualified Namespace

Product references in trade orders (and elsewhere) require a **fully qualified namespace** on identifiers. Using bare keys like `"sku"` will fail.

```bash
# WRONG - bare "sku" key is not a valid identifier
{
  "items": [
    {"product": {"identifiers": {"sku": "PHONE-001"}}, "quantity": 1}
  ]
}

# RIGHT - use reverse-domain namespace
{
  "items": [
    {"product": {"identifiers": {"com.example.sku": "PHONE-001"}}, "quantity": 1}
  ]
}
```

Always use a namespaced key like `com.yourcompany.sku`, `com.myapp.productId`, etc.

---

## 21. Instance-Tracked Items: Order and Type Requirements

When using instance tracking (IMEI, serial numbers), the item order matters:

```bash
# WRONG - MobilePlan before MobileDevice
{
  "items": [
    {"product": {"identifiers": {"com.example.sku": "PLAN-001"}}, "instances": [{"phoneImei": "123456789012345"}]},
    {"product": {"identifiers": {"com.example.sku": "PHONE-001"}}, "instances": [{"imei": "123456789012345"}]}
  ]
}

# RIGHT - MobileDevice before MobilePlan
{
  "items": [
    {"product": {"identifiers": {"com.example.sku": "PHONE-001"}}, "instances": [{"imei": "123456789012345"}]},
    {"product": {"identifiers": {"com.example.sku": "PLAN-001"}}, "instances": [{"phoneImei": "123456789012345"}]}
  ]
}
```

The `phoneImei` must reference an `imei` from an item that appears **earlier** in the items array.

> **Tip:** Products with instance tracking need the correct `instanceType` set during product creation (`"MobileDevice"` for devices, `"MobilePlan"` for plans). This is a product setup requirement, not something you specify on the order.

---

## 22. Clearing Array Properties

To remove all items from an array property (`stockRoots`, `labels`, `assortmentRoots`, `categories`, `prices`, etc.), use `PUT` with an empty array or `PATCH` with `replace: []`:

```bash
# Clear all stock roots from a store
PUT /v1/stores/{key}/stockRoots
[]

# Or equivalently via PATCH
PATCH /v1/stores/{key}/stockRoots
{"replace": []}

# WRONG - DELETE on the collection path removes a single item, not all
DELETE /v1/stores/{key}/stockRoots  # Not the same as clearing
```

This works for all `indexedArray` properties: `stockRoots`, `assortmentRoots`, `assortmentOwners`, `categories`, `labels`, `prices`, `users`, `customerGroups`, etc.

> **Note:** Individual items can be removed with `DELETE /v1/{collection}/{key}/{member}/{itemKey}`.

---

## API Response Behaviors

### Empty Collection Results

| Operation | Empty Result |
|-----------|--------------|
| `~count` | `0` |
| `~first` | `null` |
| `~take(N)` | `[]` |

### Person Name Fields

Person entities expose both computed and raw name fields:

| API Field | Description | Default? |
|-----------|-------------|----------|
| `givenName` | First/given name | ✓ Included |
| `familyName` | Last/family name | ✓ Included |
| `fullName` | Combined name (from givenName + familyName) | ✓ Included |
| `name` | Alias for fullName (via agent inheritance) | ✗ Use `~with(name)` |

**Key points:**
- `fullName` is included by default in person responses
- `name` (inherited from agent) requires `~with(name)` to include
- Both `name` and `fullName` can be used for sorting and filtering
- Setting name values directly is supported; computed values derive from givenName/familyName

```bash
# fullName is included by default
GET /v1/people/com.example.id=123
# → {"givenName": "John", "familyName": "Doe", "fullName": "John Doe", ...}

# name requires explicit inclusion (agent-level alias)
GET /v1/people~orderBy(name)~with(name)~take(10)

# Or use fullName directly (already included)
GET /v1/people~orderBy(fullName)~take(10)
```
