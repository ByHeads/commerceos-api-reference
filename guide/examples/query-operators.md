# Query Operators Reference

Comprehensive reference for all query operators available in the CommerceOS API.

**Base URL:** `http://localhost:5000/api/v1`
**API Key:** `banana` (passed via Basic Auth with empty username: `-u ":banana"`)

> **See also:** [Examples Index](../examples.md) | [Advanced Query Patterns](./advanced.md) | [Reference Documentation](../../reference/)

---

## Collection Operators

```bash
# ~take(n) - Limit results
curl -X GET -u ":banana" "localhost:5000/api/v1/products~take(10)"

# ~skip(n) - Skip first n results
curl -X GET -u ":banana" "localhost:5000/api/v1/products~skip(20)~take(10)"

# ~first - Get first element (NO parentheses!)
curl -X GET -u ":banana" "localhost:5000/api/v1/products~first"

# ~last - Get last element (NO parentheses!)
curl -X GET -u ":banana" "localhost:5000/api/v1/receipts~last"

# ~count - Count elements (NO parentheses!)
curl -X GET -u ":banana" "localhost:5000/api/v1/products~count"

# ~distinct - Unique primitive values (NO parentheses!)
# Use path navigation to extract a field, then ~distinct for unique values
curl -X GET -u ":banana" "localhost:5000/api/v1/products/status~distinct"

# ~distinctBy(field) - Unique objects by field
curl -X GET -u ":banana" "localhost:5000/api/v1/products~distinctBy(status)~take(10)"

# ~flat - Flatten nested arrays (NO parentheses!)
# Use ~with to expand a collection, then ~flat to flatten
curl -X GET -u ":banana" "localhost:5000/api/v1/receipts~with(items)/items~flat~take(100)"

# ~orderBy(field) - Sort ascending
curl -X GET -u ":banana" "localhost:5000/api/v1/products~orderBy(name)"

# ~orderBy(field:desc) - Sort descending
curl -X GET -u ":banana" "localhost:5000/api/v1/products~orderBy(name:desc)"
```

---

## Projection Operators

```bash
# ~just(...) - Select specific fields
curl -X GET -u ":banana" "localhost:5000/api/v1/products~just(name,identifiers)"

# ~just with path aliasing
curl -X GET -u ":banana" "localhost:5000/api/v1/products~just(sku:identifiers/key,productName:name)"

# ~with(...) - Include related entities
curl -X GET -u ":banana" "localhost:5000/api/v1/products~with(prices,categories)"

# ~with nested take
curl -X GET -u ":banana" "localhost:5000/api/v1/products~with(prices~take(3))~take(10)"

# ~without(...) - Exclude fields
curl -X GET -u ":banana" "localhost:5000/api/v1/agents~without(addresses)"
```

---

## Filter Operators

```bash
# ~where(condition) - Filter by condition
curl -X GET -u ":banana" "localhost:5000/api/v1/products~where(status=Active)"

# Equality check
curl -X GET -u ":banana" "localhost:5000/api/v1/agents~where(@type=person)"

# Not equal
curl -X GET -u ":banana" "localhost:5000/api/v1/products~where(status!=Inactive)"

# Pattern match (contains)
curl -X GET -u ":banana" "localhost:5000/api/v1/products~where(name=~iPhone)"

# Not contains
curl -X GET -u ":banana" "localhost:5000/api/v1/products~where(name!~test)"

# Greater than / less than
curl -X GET -u ":banana" "localhost:5000/api/v1/prices~where(amount>100)"
curl -X GET -u ":banana" "localhost:5000/api/v1/prices~where(amount<=50)"

# Truthy check (field exists and has value)
curl -X GET -u ":banana" "localhost:5000/api/v1/trade-relationships~where(creditAllowed)"

# Falsy check
curl -X GET -u ":banana" "localhost:5000/api/v1/products~where(!hidden)"

# Nested path filter
curl -X GET -u ":banana" "localhost:5000/api/v1/trade-orders~where(customer/@type=person)"
```

---

## Transformation Operators

```bash
# ~map(mappedTypeName) - Transform using a pre-defined mapped type
# NOTE: ~map ONLY accepts mapped type names, not field selectors!
# Use path navigation or ~just to extract fields instead
curl -X GET -u ":banana" "localhost:5000/api/v1/receipts~map(com.heads.receipt-csv)"

# To extract a field from each element, use path navigation:
curl -X GET -u ":banana" "localhost:5000/api/v1/products/name"

# To project specific fields, use ~just:
curl -X GET -u ":banana" "localhost:5000/api/v1/products~just(name,status)"

# ~typeless - Remove @type annotations (NO parentheses!)
curl -X GET -u ":banana" "localhost:5000/api/v1/products~first~typeless"

# ~entries - Convert object to array of {index, key, value}
curl -X GET -u ":banana" "localhost:5000/api/v1/agents/com.heads.seedID=ourcompany/addresses~entries"
```

---

## Parameterless Operators (NO parentheses!)

| Operator | Purpose |
|----------|---------|
| `~first` | First element |
| `~last` | Last element |
| `~count` | Count elements |
| `~distinct` | Unique primitive values (use after path navigation like `/status~distinct`) |
| `~flat` | Flatten arrays |
| `~typeless` | Remove @type |

---

## Query Parameter Alternatives

```bash
# Filter and limit with query params
curl -X GET -u ":banana" "localhost:5000/api/v1/products?status=Active&limit=3"

# Sort and paginate with query params
curl -X GET -u ":banana" "localhost:5000/api/v1/products?orderby=name&offset=2&limit=2"

# Sort descending with query params
curl -X GET -u ":banana" "localhost:5000/api/v1/products?orderby=name:desc&limit=3"

# Request all fields
curl -X GET -u ":banana" "localhost:5000/api/v1/products?fields=all&limit=1"
```

---

## System Resources

```bash
# Get current timestamp
curl -X GET -u ":banana" "localhost:5000/api/v1/now"

# Generate UUID
curl -X GET -u ":banana" "localhost:5000/api/v1/uuid"

# Connection test (returns constant string, not empty)
# Response: "･*★`ﾟ+✧`*ﾟ✦´★･ﾟ✧'*･"
curl -X GET -u ":banana" "localhost:5000/api/v1/void"
```

> **Note:** The `/void` endpoint returns a constant string (`"･*★\`ﾟ+✧\`*ﾟ✦´★･ﾟ✧'*･"`) rather than an empty response. This is useful for testing API connectivity—a successful response confirms the API is reachable and responding.

---

## Schema Introspection

Use the `/api/v1/elements/` endpoints to discover available types, properties, and methods in the API schema. This is useful for understanding what resources exist and what operations are available.

```bash
# Get all registered types
curl -X GET -u ":banana" "localhost:5000/api/v1/elements/types"

# Get all properties across all types
curl -X GET -u ":banana" "localhost:5000/api/v1/elements/properties"

# Get all methods across all types
curl -X GET -u ":banana" "localhost:5000/api/v1/elements/methods"
```

For detailed resource schemas, use the OpenAPI specification:

```bash
# Get full OpenAPI specification (JSON)
curl -X GET -u ":banana" "localhost:5000/api" -H "Accept: application/json"

# Get OpenAPI specification (YAML)
curl -X GET -u ":banana" "localhost:5000/api" -H "Accept: application/yaml"
```

The elements endpoints return:
- **types**: All registered entity types and their descriptions
- **properties**: All properties with their owning types and metadata
- **methods**: All available operations/methods

---

## Quick Reference

### HTTP Methods

| Method | Purpose | Example |
|--------|---------|---------|
| GET | Read | `GET /products` |
| POST | Create | `POST /products {...}` |
| PUT | Upsert (create or replace) | `PUT /products/key=123 {...}` |
| PATCH | Partial update | `PATCH /products/key=123 {"name": "..."}` |
| DELETE | Remove | `DELETE /products/key=123` |

### Common Identifier Patterns

| Resource | Identifier Pattern |
|----------|-------------------|
| Products | `com.myapp.sku=SKU-001` |
| People | `com.myapp.customerId=CUST-001` |
| Companies | `com.myapp.companyId=COMP-001` |
| Stores | `com.myapp.storeId=STORE-001` |
| Orders | `com.myapp.orderId=ORD-001` |
| Currencies | `currencyCode=SEK` |
| Countries | `countryCode=SE` |
| Languages | `languageCode=sv` |
| POS Terminals | `posTerminalName=Kassa%201` |
| POS Profiles | `posProfileId=default` |
| User Roles | `userRoleID=admin` |
| Templates | `templateId=default-receipt` |
| Mapped Types | `mappedTypeName=com.heads.receipt-csv` |
| Payment Methods | `methodId=com.heads.cash` |
| Receipts | `receiptID=RCP-2024-00001` |
