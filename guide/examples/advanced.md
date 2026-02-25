# Advanced Query Patterns

Complex filtering, deep path navigation, aggregations, mapped types, bulk operations, and SQL export.

**Base URL:** `http://localhost:5000/api/v1`
**API Key:** `banana` (passed via Basic Auth with empty username: `-u ":banana"`)

> **See also:** [Examples Index](../examples.md) | [Query Operators](./query-operators.md) | [Reference Documentation](../../reference/)

---

## Complex Filtering

```bash
# Filter with multiple conditions (AND logic via chaining)
curl -X GET -u ":banana" "localhost:5000/api/v1/products~where(status=Active)~where(name=~Premium)~take(10)"

# Filter by nested property
curl -X GET -u ":banana" "localhost:5000/api/v1/trade-orders~where(supplier/name=~Acme)"

# Filter by count
curl -X GET -u ":banana" "localhost:5000/api/v1/receipts~where(items~count>5)~take(10)"
```

---

## Deep Path Navigation

```bash
# Navigate through relationships
curl -X GET -u ":banana" "localhost:5000/api/v1/trade-orders/com.myapp.orderId=ORD-001/customer/addresses/main"

# Get nested count
curl -X GET -u ":banana" "localhost:5000/api/v1/product-categories/com.heads.seedID=electronics/members~count"

# Deep with clause
curl -X GET -u ":banana" "localhost:5000/api/v1/trade-orders~with(items~with(product~just(name)))~take(5)"
```

---

## Aggregations

```bash
# Count by status
curl -X GET -u ":banana" "localhost:5000/api/v1/products~where(status=Active)~count"

# Get distinct statuses (navigate to the field, then apply ~distinct)
curl -X GET -u ":banana" "localhost:5000/api/v1/products/status~distinct"

# Get one product per status
curl -X GET -u ":banana" "localhost:5000/api/v1/products~distinctBy(status)~take(10)"

# Count items per receipt
curl -X GET -u ":banana" "localhost:5000/api/v1/receipts~just(receiptId:identifiers/receiptID,itemCount:items~count)~take(20)"
```

---

## Path Aliasing

```bash
# Simple alias
curl -X GET -u ":banana" "localhost:5000/api/v1/products~just(sku:identifiers/key,productName:name)"

# Nested alias
curl -X GET -u ":banana" "localhost:5000/api/v1/trade-orders~just(orderId:identifiers/key,customerName:customer/name,supplierName:supplier/name)~take(10)"

# Alias with aggregation
curl -X GET -u ":banana" "localhost:5000/api/v1/receipts~just(id:identifiers/receiptID,items:items~count,total:totalAmount)"
```

---

## Body Indicators

Body indicators (`@`) mark where the request body is targeted in the URL path.

```http
PUT /v1/agents/@find
Content-Type: application/json

{ "familyName": "Smith" }
```

Resources with find endpoints:
- `/v1/agents/find`
- `/v1/trade-orders/find`
- `/v1/receipts/find`
- `/v1/payment-orders/find`
- `/v1/shipment-orders/find`
- `/v1/trade-relationships/find`

---

## Mapped Type Patterns

```bash
# Create a mapped type using variables and null coalescing
curl -X POST -u ":banana" "localhost:5000/api/v1/mapped-types" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"mappedTypeName": "com.myapp.receipt-summary"},
    "body": {
      "$buyer": "buyer",
      "receiptId": "identifiers/receiptID",
      "buyerName": "$buyer/name ?? '\'''\''",
      "buyerKey": "$buyer/identifiers/key",
      "total": "totalAmount/str"
    }
  }'

# Apply the mapped type to a collection
curl -X GET -u ":banana" "localhost:5000/api/v1/receipts~map(com.myapp.receipt-summary)~take(5)"

# Bundle receipts + items with array-body and "$first" pattern
# Note: ~map returns one result per source item; for aggregation use an array body ending with "$first"
curl -X POST -u ":banana" "localhost:5000/api/v1/mapped-types" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"mappedTypeName": "com.myapp.receipt-bundle"},
    "active": true,
    "body": [
      {
        "receipts": "$prior~map(com.heads.receipt-csv)",
        "items": "$prior~just(items~map(com.heads.receipt-item-csv))/*items~flat"
      },
      "$first"
    ]
  }'

# Use the bundle (returns a single object due to "$first")
curl -X GET -u ":banana" "localhost:5000/api/v1/receipts~map(com.myapp.receipt-bundle)"
```

---

## Bulk Operations (NDJSON)

```bash
# Bulk create products (NDJSON format)
curl -X PUT -u ":banana" "localhost:5000/api/v1/products" \
  -H "Content-Type: application/x-ndjson" \
  --data-binary @- << 'EOF'
{"identifiers":{"com.myapp.sku":"BULK-001"},"name":"Bulk Product 1","status":"Active"}
{"identifiers":{"com.myapp.sku":"BULK-002"},"name":"Bulk Product 2","status":"Active"}
{"identifiers":{"com.myapp.sku":"BULK-003"},"name":"Bulk Product 3","status":"Active"}
EOF

# Bulk create prices
curl -X PUT -u ":banana" "localhost:5000/api/v1/prices" \
  -H "Content-Type: application/x-ndjson" \
  --data-binary @- << 'EOF'
{"identifiers":{"com.myapp.priceId":"PRICE-BULK-001"},"products":[{"identifiers":{"com.myapp.sku":"BULK-001"}}],"sellers":[{"identifiers":{"com.heads.seedID":"ourcompany"}}],"amount":99.00,"currency":{"identifiers":{"currencyCode":"SEK"}}}
{"identifiers":{"com.myapp.priceId":"PRICE-BULK-002"},"products":[{"identifiers":{"com.myapp.sku":"BULK-002"}}],"sellers":[{"identifiers":{"com.heads.seedID":"ourcompany"}}],"amount":149.00,"currency":{"identifiers":{"currencyCode":"SEK"}}}
EOF
```

> **Streaming guide:** For controlling transaction chunk size (`X-Transaction-Count`), streaming results back as each chunk commits, and handling mid-stream errors, see [`features/streaming.md`](../../features/streaming.md).

---

## SQL Export Serialization

The API supports SQL-compatible output serialization for exporting data to MSSQL Server and other SQL databases. SQL support is implemented as serializers that consume an intermediary format.

> **Specification:** See [SQL Export](../../features/sql-export.md) for the complete SQL export specification.

### SqlStatement Intermediary Format

The SQL serializer consumes an array of statement objects representing SQL operations:

```typescript
type SqlStatement =
  | { "DELETE FROM": string; "WHERE": Record<string, unknown[]> }
  | { "INSERT INTO": string; "VALUES": Record<string, unknown>[] }
  | { "MERGE INTO": string; "ON": string[]; "VALUES": Record<string, unknown>[] }
  | { "UPDATE": string; "SET": Record<string, unknown>; "WHERE": Record<string, unknown[]> }
  | { "GO": true }
  | { "--": string };
```

### Statement Examples

**DELETE Statement:**
```javascript
// Input
{ "DELETE FROM": "HeadsReceipt", "WHERE": { "ReceiptObjectID": [1001, 1002] } }

// Output
DELETE FROM [HeadsReceipt] WHERE [ReceiptObjectID] IN (1001, 1002)
```

**INSERT Statement:**
```javascript
// Input
{ "INSERT INTO": "HeadsReceipt", "VALUES": [
  { ReceiptObjectID: 1001, SellerID: "S001", Total: 1250.25 },
  { ReceiptObjectID: 1002, SellerID: "S001", Total: 890.50 }
]}

// Output
INSERT INTO [HeadsReceipt] ([ReceiptObjectID], [SellerID], [Total])
VALUES (1001, N'S001', 1250.2500), (1002, N'S001', 890.5000)
```

**MERGE Statement (Upsert):**
```javascript
// Input
{ "MERGE INTO": "HeadsReceipt", "ON": ["ReceiptObjectID"], "VALUES": [
  { ReceiptObjectID: 1001, SellerID: "S001", Total: 1250.25 }
]}

// Output
MERGE INTO [HeadsReceipt] AS t
USING (VALUES (1001, N'S001', 1250.2500)) AS s ([ReceiptObjectID], [SellerID], [Total])
ON t.[ReceiptObjectID] = s.[ReceiptObjectID]
WHEN MATCHED THEN UPDATE SET t.[SellerID] = s.[SellerID], t.[Total] = s.[Total]
WHEN NOT MATCHED THEN INSERT ([ReceiptObjectID], [SellerID], [Total])
  VALUES (s.[ReceiptObjectID], s.[SellerID], s.[Total]);
```

**UPDATE Statement:**
```javascript
// Input
{ "UPDATE": "HeadsReceipt", "SET": { "Total": 1300.50 }, "WHERE": { "ReceiptObjectID": [1001] } }

// Output
UPDATE [HeadsReceipt] SET [Total] = 1300.5000 WHERE [ReceiptObjectID] IN (1001)
```

**Batch Separator:**
```javascript
// Input
{ "GO": true }

// Output
GO
```

**Comment:**
```javascript
// Input
{ "--": "Exported from CommerceOS API" }

// Output
-- Exported from CommerceOS API
```

### Delete-then-Insert Pattern (Sync Mode)

For synchronizing data to an external database, use the delete-then-insert pattern:

```javascript
[
  { "--": "Sync HeadsReceipt" },
  { "DELETE FROM": "HeadsReceipt", "WHERE": { "ReceiptObjectID": [1001, 1002] } },
  { "INSERT INTO": "HeadsReceipt", "VALUES": [
    { ReceiptObjectID: 1001, SellerID: "S001", Total: 1250.25 },
    { ReceiptObjectID: 1002, SellerID: "S001", Total: 890.50 }
  ]},
  { "GO": true },
  { "--": "Sync HeadsProductReceiptItem" },
  { "DELETE FROM": "HeadsProductReceiptItem", "WHERE": { "ReceiptObjectID": [1001, 1002] } },
  { "INSERT INTO": "HeadsProductReceiptItem", "VALUES": [
    { ReceiptItemObjectID: 10001, ReceiptObjectID: 1001, ProductID: "SKU-001", Quantity: 2 },
    { ReceiptItemObjectID: 10002, ReceiptObjectID: 1001, ProductID: "SKU-002", Quantity: 1 }
  ]},
  { "GO": true }
]
```

### Type Inference

The serializer infers SQL types from JavaScript values:

| JS Type | SQL Output |
|---------|------------|
| `string` | `N'escaped value'` |
| `number` (integer) | `123` |
| `number` (decimal) | `123.4500` |
| `boolean` | `1` or `0` |
| `null` / `undefined` | `NULL` |
| `Date` | `'2024-12-18T10:30:00.000'` |
| `bigint` | `9007199254740993` |

### Content Negotiation

The SQL serializer accepts `SqlStatement[]` as input, not raw API objects. To produce SQL output, you must use a **mapped type** that transforms data into the `SqlStatement[]` intermediary format.

**Important:** Raw API resources like `/receipts` return receipt objects, not SQL statements. Requesting `Accept: application/sql` against raw resources will fail because the serializer expects `SqlStatement[]` input.

**Built-in CSV Mapped Types:**

The following CSV-producing mapped types are available in `seed/default-mapped-types/seed-config.json`:

| Mapped Type | Description |
|-------------|-------------|
| `com.heads.receipt-csv` | Flattens receipt to CSV row columns |
| `com.heads.receipt-item-csv` | Flattens receipt items to CSV rows |
| `com.heads.receipt-payment-csv` | Flattens receipt payments to CSV rows |
| `com.heads.receipts-zip` | Bundles receipts, items, and payments into a single ZIP-ready export |

> **Note:** SQL-producing mapped types (INSERT, DELETE, MERGE) are **not included by default** and must be created manually using the custom mapped type examples below. The built-in seed provides only CSV export formats.

**Usage examples with built-in CSV types:**

```bash
# Export receipts as CSV
curl -X GET -u ":banana" "localhost:5000/api/v1/receipts~take(10)~map(com.heads.receipt-csv)" \
  -H "Accept: application/vnd.ms-sqlserver.csv"

# Export as bundled ZIP (receipts + items + payments)
curl -X GET -u ":banana" "localhost:5000/api/v1/receipts~take(10)~map(com.heads.receipts-zip)" \
  -H "Accept: application/json"
```

**Usage with custom SQL mapped types (after creating them):**

```bash
# INSERT statement (after creating com.myapp.receipt-sql-insert)
curl -X GET -u ":banana" "localhost:5000/api/v1/receipts~take(10)~map(com.myapp.receipt-sql-insert)" \
  -H "Accept: application/sql"

# DELETE statement (after creating com.myapp.receipt-sql-delete)
curl -X GET -u ":banana" "localhost:5000/api/v1/receipts~take(10)~map(com.myapp.receipt-sql-delete)" \
  -H "Accept: application/sql"
```

**CSV format (works with flat objects):**

The CSV serializer (`application/vnd.ms-sqlserver.csv`) accepts flat object arrays and produces RFC 4180 CSV. This can work with existing CSV-producing mapped types:

```bash
# CSV export using existing mapped type
curl -X GET -u ":banana" "localhost:5000/api/v1/receipts~take(10)~map(com.heads.receipt-csv)" \
  -H "Accept: application/vnd.ms-sqlserver.csv"
```

**Creating custom SQL-producing mapped types:**

SQL mapped types use an array-body with `$prior` and `"$first"` to collect multiple items and emit statement objects. The `~map` operator always returns one result per source item; for aggregation into a single result, use an array body ending with `"$first"`.

**Example: INSERT mapped type**
```json
{
  "identifiers": {"mappedTypeName": "com.myapp.receipt-sql-insert"},
  "active": true,
  "body": [
    {
      "INSERT INTO": "@dbo.HeadsReceipt",
      "VALUES": "$prior~map(com.myapp.receipt-sql-row)"
    },
    "$first"
  ]
}
```

**Example: Row mapper for VALUES**
```json
{
  "identifiers": {"mappedTypeName": "com.myapp.receipt-sql-row"},
  "active": true,
  "body": {
    "ReceiptObjectID": "objectID",
    "ReceiptID": "identifiers/receiptID",
    "SellerID": "seller/identifiers/sellerId",
    "SellerName": "seller/name",
    "Timestamp": "timestamp",
    "CurrencyCode": "currencyCode",
    "TotalAmount": "totalAmount/num"
  }
}
```

**Example: DELETE mapped type**
```json
{
  "identifiers": {"mappedTypeName": "com.myapp.receipt-sql-delete"},
  "active": true,
  "body": [
    {
      "DELETE FROM": "@dbo.HeadsReceipt",
      "WHERE": {
        "ReceiptObjectID": "$prior~just(objectID)/*objectID"
      }
    },
    "$first"
  ]
}
```

**Example: MERGE (upsert) mapped type**
```json
{
  "identifiers": {"mappedTypeName": "com.myapp.receipt-sql-merge"},
  "active": true,
  "body": [
    {
      "MERGE INTO": "@dbo.HeadsReceipt",
      "ON": ["@ReceiptObjectID"],
      "VALUES": "$prior~map(com.myapp.receipt-sql-row)"
    },
    "$first"
  ]
}
```

Key patterns:
- `["...", "$first"]`: Array body ending with `"$first"` collects all items into a single result
- `@value`: Creates literal string values (e.g., `@dbo.HeadsReceipt`)
- `$prior~map(...)`: References the parent collection and maps each item
- `$prior~just(field)/*field`: Collects all values of a field into an array

### SQL Server CSV Format

The `application/vnd.ms-sqlserver.csv` content type produces RFC 4180 compliant CSV optimized for SQL Server BULK INSERT:

```csv
ReceiptObjectID,SellerID,SellerName,ReceiptDate,Total,Currency
1001,"S001","Store Stockholm","2024-12-18T10:30:00.000",1250.00,"SEK"
1002,"S001","Store Stockholm","2024-12-18T11:45:00.000",890.50,"SEK"
```

Import into SQL Server:
```sql
BULK INSERT [target_table]
FROM 'data.csv'
WITH (FORMAT = 'CSV', FIELDQUOTE = '"', FIRSTROW = 2, CODEPAGE = '65001');
```

### Security

All identifiers and string values are properly escaped:

- **String values:** Single quotes escaped with `''`, wrapped in `N'...'` for Unicode
- **Identifiers:** Wrapped in `[brackets]`, closing brackets doubled `]]`
- **SQL injection protection:** The system generates SQL output but does NOT execute it

---

## Notes

1. **External IDs**: Use reverse domain notation for namespacing (e.g., `com.myapp.customerId`)
2. **URL Encoding**: Special characters must be URL-encoded (space = `%20`, etc.)
3. **camelCase Paths**: Nested members use camelCase: `customerRelations`, `childCategories`, `assortmentContexts`, `oauth2Clients`, `roleAssignments`
4. **Agent References**: Use `{"identifiers": {...}}` to reference existing agents in relationships
5. **Store Owner**: Stores use `owner` (not `parent`) to reference the owning company
6. **Product Groups**: Assign products via `parentGroup` on the product, NOT via the group's `members`
7. **DELETE Limitations**: Some sub-collection DELETEs return success but don't persist - always verify
