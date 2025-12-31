# SQL Output Serialization

**Version:** 2.0
**Status:** Production
**Last Updated:** 2026-01-13
**Related:** HEADS-5739, GT-193

## 1. Overview

The CommerceOS API provides SQL-compatible output serialization for exporting data to MSSQL Server and other SQL databases. SQL output is implemented as a **serializer** that consumes a mapped-type-produced intermediary format (`SqlStatement[]`) and renders SQL text. It is available via content negotiation using the `Accept` header.

### 1.1 Key Characteristics

| Aspect | Behavior |
|--------|----------|
| Intermediary Format | `SqlStatement[]` (JS object array produced by mapped types) |
| Primary Format | `application/sql` — SQL INSERT/DELETE/MERGE/UPDATE statements |
| Secondary Format | `application/vnd.ms-sqlserver.csv` — RFC 4180 CSV for SQL Server BULK INSERT |
| Table Names | Specified in the `SqlStatement` objects themselves, not serializer parameters |
| Streaming | Batched output with configurable `batchSize` (default 1000 statements) |
| Array/Object Handling | **SQL:** Rejected (flatten before serialization); **CSV:** JSON-stringified automatically |
| Mode Parameter | **Reserved** — `mode=insert|sync|merge` is parsed by the serializer but not passed to mapped types; serializer emits statements as-is |
| Operator | None — SQL output is via serializer only (no `~sqlexport` operator) |

### 1.2 Scope

**Available:**
- SQL INSERT, DELETE, MERGE, UPDATE, GO, and comment statement serialization
- Content negotiation via `Accept: application/sql` and `Accept: application/vnd.ms-sqlserver.csv`
- Configurable batch sizes for streaming large datasets
- Proper SQL escaping for injection prevention

**Not Available:**
- Direct database connections (output only)
- Built-in schema generation endpoints
- API-type-to-SQL-type mapping layer
- ZIP bundle exports
- Real-time CDC replication

---

## 2. Using SQL Output

### 2.1 Content Negotiation

Request SQL output by setting the `Accept` header:

```http
GET /v1/products~map(my-sql-export-type)
Accept: application/sql
```

Or for CSV format compatible with SQL Server BULK INSERT:

```http
GET /v1/products~map(my-csv-export-type)
Accept: application/vnd.ms-sqlserver.csv
```

Short-form content type is also accepted:

```http
GET /v1/products~map(my-sql-export-type)
Accept: sql
```

### 2.2 Serializer Parameters

Parameters are passed via the Accept header after a semicolon:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `batchSize` | int | 1000 | Statements per batch for streaming output (a multi-row INSERT counts as one statement) |

**Example:**
```http
Accept: application/sql; batchSize=500
```

> **Note:** The `mode` parameter (`insert`, `sync`, `merge`) is accepted by the serializer settings but currently unused—mapped types cannot read it (there is no `$mode` variable in the resolver). The SQL serializer emits statements exactly as provided without interpreting or transforming based on mode.

---

## 3. Intermediary Format

The SQL serializer consumes an array of `SqlStatement` objects. Mapped types are responsible for producing this format. Table names, column names, and values are embedded in the statement objects.

### 3.1 Statement Types

```typescript
type SqlStatement =
  | { "DELETE FROM": string; "WHERE": Record<string, unknown[]> }
  | { "INSERT INTO": string; "VALUES": Record<string, unknown>[] }
  | { "MERGE INTO": string; "ON": string[]; "VALUES": Record<string, unknown>[] }
  | { "UPDATE": string; "SET": Record<string, unknown>; "WHERE": Record<string, unknown[]> }
  | { "GO": true }
  | { "--": string };
```

### 3.2 Statement Examples

**DELETE:**
```javascript
{ "DELETE FROM": "dbo.Products", "WHERE": { "SKU": ["SKU-001", "SKU-002"] } }
// → DELETE FROM [dbo].[Products] WHERE [SKU] IN (N'SKU-001', N'SKU-002')
```

**INSERT:**
```javascript
{ "INSERT INTO": "dbo.Products", "VALUES": [
  { SKU: "SKU-001", Name: "Widget A", Price: 29.99 },
  { SKU: "SKU-002", Name: "Widget B", Price: 49.99 }
]}
// → INSERT INTO [dbo].[Products] ([SKU], [Name], [Price]) VALUES (N'SKU-001', N'Widget A', 29.9900), (N'SKU-002', N'Widget B', 49.9900)
```

**MERGE (upsert):**
```javascript
{ "MERGE INTO": "dbo.Products", "ON": ["SKU"], "VALUES": [
  { SKU: "SKU-001", Name: "Widget A", Price: 29.99 }
]}
// → MERGE INTO [dbo].[Products] AS t USING (VALUES ...) AS s ON t.[SKU] = s.[SKU] WHEN MATCHED THEN UPDATE ... WHEN NOT MATCHED THEN INSERT ...
```

**UPDATE:**
```javascript
{ "UPDATE": "dbo.Products", "SET": { "Price": 34.99 }, "WHERE": { "SKU": ["SKU-001"] } }
// → UPDATE [dbo].[Products] SET [Price] = 34.9900 WHERE [SKU] IN (N'SKU-001')
```

**Batch separator:**
```javascript
{ "GO": true }
// → GO
```

**Comment:**
```javascript
{ "--": "Exported from CommerceOS API" }
// → -- Exported from CommerceOS API
```

### 3.3 Delete-then-Insert Pattern

A common sync pattern that clears and repopulates data:

```javascript
[
  { "--": "Sync Products" },
  { "DELETE FROM": "dbo.Products", "WHERE": { "SKU": ["SKU-001", "SKU-002"] } },
  { "INSERT INTO": "dbo.Products", "VALUES": [
    { SKU: "SKU-001", Name: "Widget A", Price: 29.99 },
    { SKU: "SKU-002", Name: "Widget B", Price: 49.99 }
  ]},
  { "GO": true }
]
```

---

## 4. Creating Mapped Types for SQL Export

The SQL serializer relies on mapped types to produce `SqlStatement[]`. You must create mapped types that transform API entities into the intermediary format.

### 4.1 Single-Row INSERT Mapped Type

Each source item produces one INSERT statement:

```http
POST /v1/mapped-types
Content-Type: application/json

[{
  "identifiers": { "mappedTypeName": "com.example.product-sql-insert" },
  "active": true,
  "body": {
    "INSERT INTO": "@dbo.Products",
    "VALUES": [{
      "SKU": "identifiers/com.example.sku",
      "ProductName": "name",
      "Status": "status"
    }]
  }
}]
```

Usage:
```http
GET /v1/products~map(com.example.product-sql-insert)~take(100)
Accept: application/sql
```

**Output:**
```sql
INSERT INTO [dbo].[Products] ([SKU], [ProductName], [Status]) VALUES (N'SKU-001', N'Widget', N'Active')
INSERT INTO [dbo].[Products] ([SKU], [ProductName], [Status]) VALUES (N'SKU-002', N'Gadget', N'Active')
...
```

> **Note:** With the removal of `@merge`, each source item produces its own INSERT statement. For batched inserts with multiple VALUES rows, aggregate outside the API or use `$prior` to reference previous items in multi-row VALUES mapping.

### 4.2 DELETE Mapped Type

```http
POST /v1/mapped-types
Content-Type: application/json

[{
  "identifiers": { "mappedTypeName": "com.example.product-sql-delete" },
  "active": true,
  "body": {
    "DELETE FROM": "@dbo.Products",
    "WHERE": {
      "SKU": ["identifiers/com.example.sku"]
    }
  }
}]
```

### 4.3 Flat Row Export for CSV

For CSV export, create a mapped type that produces flat objects (not SqlStatement):

```http
POST /v1/mapped-types
Content-Type: application/json

[{
  "identifiers": { "mappedTypeName": "com.example.product-csv-row" },
  "active": true,
  "body": {
    "SKU": "identifiers/com.example.sku",
    "ProductName": "name",
    "Price": "defaultPrice/netAmount/value",
    "Currency": "defaultPrice/netAmount/currency",
    "Status": "status"
  }
}]
```

Usage:
```http
GET /v1/products~map(com.example.product-csv-row)~take(100)
Accept: application/vnd.ms-sqlserver.csv
```

**Output:**
```csv
SKU,ProductName,Price,Currency,Status
SKU-001,Widget,29.99,SEK,Active
SKU-002,Gadget,49.99,SEK,Active
```

---

## 5. Value Conversion

The serializer converts JavaScript values to SQL literals at runtime:

| JS Type | SQL Output | Notes |
|---------|------------|-------|
| `string` | `N'escaped value'` | Unicode string, single quotes doubled |
| `number` (integer) | `123` | Literal integer |
| `number` (decimal) | `123.4500` | Fixed 4 decimal places for DECIMAL(18,4) |
| `boolean` | `1` or `0` | BIT-compatible |
| `null` / `undefined` | `NULL` | SQL NULL |
| `Date` | `'2024-12-18T10:30:00.000'` | ISO 8601 for DATETIME2 |
| `bigint` | `123456789012345` | Numeric literal |
| `object` | **Error** | Must be flattened before serialization |
| `array` | **Error** | Must be JSON-stringified or split into separate tables |

### 5.1 Handling Nested Data

The SQL serializer **rejects** arrays and objects (throws an error). The CSV serializer JSON-stringifies them automatically. For SQL output, you must flatten or pre-serialize before serialization:

1. **Flatten nested objects** in your mapped type using path expressions:
   ```javascript
   // Instead of: { "address": "deliveryAddress" }
   // Use flattened fields:
   {
     "AddressLine1": "deliveryAddress/street",
     "City": "deliveryAddress/city",
     "PostalCode": "deliveryAddress/postalCode"
   }
   ```

2. **JSON-stringify arrays** if you need them in a single column:
   ```javascript
   // Mapped type must pre-serialize to JSON string
   { "CategoriesJson": "categories~toJson" }
   ```

3. **Export to separate tables** for one-to-many relationships by creating multiple mapped types.

---

## 6. SQL Escaping and Security

### 6.1 String Escaping

All string values are escaped by doubling single quotes and wrapped in `N'...'` for Unicode:

```javascript
escapeSqlString("it's a test") // → N'it''s a test'
escapeSqlString("日本語")       // → N'日本語'
```

### 6.2 Identifier Escaping

All identifiers (table names, column names) are wrapped in brackets with bracket-doubling:

```javascript
escapeSqlIdentifier("Column Name")         // → [Column Name]
escapeSqlIdentifier("dbo.HeadsReceipt")    // → [dbo].[HeadsReceipt]
escapeSqlIdentifier("Table]Name")          // → [Table]]Name]
```

### 6.3 Security Notes

- All string values are properly escaped to prevent SQL injection
- All identifiers are bracket-escaped
- The API does **not** execute generated SQL—output is for external execution only
- Export respects API authorization; users can only export data they have access to

---

## 7. CSV Format Details

The `application/vnd.ms-sqlserver.csv` format produces RFC 4180-compliant CSV optimized for SQL Server BULK INSERT.

### 7.1 Format Characteristics

- Header row with column names
- NULL represented as empty fields (configurable via `nullValue` parameter)
- Dot (`.`) decimal separator
- ISO 8601 dates
- Double-quote escaping for fields containing delimiters or quotes

### 7.2 SQL Server Import

Import the CSV using BULK INSERT:

```sql
BULK INSERT [dbo].[Products]
FROM 'products.csv'
WITH (
    FORMAT = 'CSV',
    FIELDQUOTE = '"',
    FIRSTROW = 2,
    CODEPAGE = '65001'
);
```

---

## 8. Streaming and Batching

### 8.1 SQL Statement Batching

For large exports, the serializer batches output based on `batchSize`:

```http
GET /v1/receipts~map(receipt-sql-export)
Accept: application/sql; batchSize=500
```

Each batch is flushed to the response stream, keeping memory usage constant regardless of total row count.

### 8.2 CSV Row Streaming

CSV output streams row-by-row:
- First row determines column ordering
- Header emitted with first data row
- Subsequent rows stream independently

Memory usage: O(1) per row.

---

## 9. Error Handling

### 9.1 Validation Errors

The serializer validates each statement before rendering. Invalid statements cause errors:

| Condition | Error Message |
|-----------|---------------|
| Unknown statement type | `SQL serialization error: Unknown statement type. Expected one of: DELETE FROM, INSERT INTO, MERGE INTO, UPDATE, GO, --` |
| Empty WHERE clause | `SQL serialization error: DELETE statement requires at least one WHERE condition` |
| Empty VALUES array | `SQL serialization error: INSERT statement requires at least one row in VALUES` |
| Non-finite number | `SQL serialization error: Cannot serialize {value} (non-finite number)` |
| Array value (SQL) | `SQL serialization error: Arrays must be serialized as JSON columns or separate tables. Value: ...` |
| Object value (SQL) | `SQL serialization error: Objects must be flattened or serialized as JSON columns. Value: ...` |

### 9.2 Mid-Stream Errors

Because SQL export uses streaming responses, errors occurring after response headers are committed appear as mid-stream errors:

```json
{
  "@type": "mid-stream error",
  "innerError": {
    "error": "Internal server error.",
    "details": "SQL serialization error: Unknown statement type..."
  }
}
```

Test your mapped types with small datasets before production use to catch validation errors early.

---

## 10. Complete Example

### 10.1 Setup: Create SQL Export Mapped Type

```http
POST /v1/mapped-types
Content-Type: application/json

[{
  "identifiers": { "mappedTypeName": "com.example.receipt-sql-sync" },
  "active": true,
  "body": [
    { "--": "Receipt sync batch" },
    {
      "DELETE FROM": "@dbo.Receipts",
      "WHERE": { "ReceiptID": ["identifiers/key"] }
    },
    {
      "INSERT INTO": "@dbo.Receipts",
      "VALUES": [{
        "ReceiptID": "identifiers/key",
        "StoreID": "seller/identifiers/com.example.store-id",
        "Timestamp": "timestamp",
        "Total": "totalAmount/value",
        "Currency": "totalAmount/currency"
      }]
    },
    { "GO": true }
  ]
}]
```

### 10.2 Export Receipts to SQL

```http
GET /v1/receipts~where(timestamp>=2024-01-01)~map(com.example.receipt-sql-sync)
Accept: application/sql; batchSize=100
```

**Response:**
```sql
-- Receipt sync batch
DELETE FROM [dbo].[Receipts] WHERE [ReceiptID] IN (12345)
INSERT INTO [dbo].[Receipts] ([ReceiptID], [StoreID], [Timestamp], [Total], [Currency]) VALUES (12345, N'STORE-001', '2024-01-15T14:30:00.000', 1250.0000, N'SEK')
GO
-- Receipt sync batch
DELETE FROM [dbo].[Receipts] WHERE [ReceiptID] IN (12346)
INSERT INTO [dbo].[Receipts] ([ReceiptID], [StoreID], [Timestamp], [Total], [Currency]) VALUES (12346, N'STORE-001', '2024-01-15T15:45:00.000', 890.5000, N'SEK')
GO
```

---

## 11. References

- [RFC 4180 - CSV Format](https://tools.ietf.org/html/rfc4180)
- [SQL Server BULK INSERT](https://learn.microsoft.com/en-us/sql/t-sql/statements/bulk-insert-transact-sql)
- [SQL Server MERGE](https://learn.microsoft.com/en-us/sql/t-sql/statements/merge-transact-sql)
- Source: `polyjuice-pillow-lib/src/sql.ts`
- Tests: `commerceos-api/test/pillow.sql-serializers.test.ts`

---

## 12. Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2024-12-18 | CommerceOS Team | Initial document (proposed specification) |
| 2.0 | 2026-01-13 | Rupert | Updated to reflect shipped implementation; removed fictional schemas and endpoints; documented actual mapped-type-driven flow |
