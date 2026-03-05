# CommerceOS API Usage Guide

A contextual usage guide for developers and AI agents working with the CommerceOS ERP/POS API.

---

## 1. Purpose and Scope

### What This Document Is

This is a **contextual usage guide** designed to answer real "how do I..." questions when working with the CommerceOS API. It focuses on:

- Decision trees for choosing the right approach
- Complete workflows for common tasks
- Common pitfalls and how to avoid them
- Troubleshooting guidance for errors

### How to Use This Document

**For AI Agents:**
1. **"How do I..."** → Section 3 (Task Recipes)
2. **"What's wrong with..."** → Section 8 (Troubleshooting)
3. **"What operator..."** → Section 5 (Operator Cheat Sheet)
4. **"How do I query..."** → Section 6 (Finder Patterns)
5. **"What format..."** → Section 7 (Content Negotiation)
6. **"What does X mean..."** → Section 9 (Glossary)

**For Humans:**
Start with the Quickstart (Section 2), then jump to Task Recipes (Section 3) for specific workflows.

### Document Links

| Need | Document |
|------|----------|
| Full endpoint reference | OpenAPI: `/api/v1/openapi.json` |
| Operator behavior details | [Operators Reference](../reference/operators.md) |
| Mapped type syntax | [Mapped Types Reference](../reference/mapped-types.md) |
| Curl examples | [Examples](./examples.md) |

---

## 2. First 30 Minutes Quickstart

### 2.1 Base URL and Environment

**Local Development:**
```
http://localhost:5000/api/v1
```

**Health Check:**
```bash
curl -u ":banana" "localhost:5000/api/v1/void"
```

A successful response confirms the API is running and your authentication works.

### 2.2 Authentication

#### Option A: API Key (Development)

The simplest method for local development:

```bash
# Via Basic Auth (recommended - password only, empty username)
curl -u ":banana" "localhost:5000/api/v1/agents"

# Via header
curl -H "X-Api-Key: banana" "localhost:5000/api/v1/agents"
```

#### Option B: OAuth 2.0 (Production)

For production systems using client credentials:

```bash
# 1. Get token
curl -X POST "localhost:5000/oauth2/v1/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=YOUR_ID&client_secret=YOUR_SECRET"

# 2. Use token
curl -H "Authorization: Bearer YOUR_TOKEN" "localhost:5000/api/v1/agents"
```

#### When to Use Which

| Scenario | Method |
|----------|--------|
| Local development | API Key |
| CI/CD pipelines | API Key or OAuth2 |
| Production integrations | OAuth2 |
| POS terminals | OAuth2 with device credentials |

### 2.3 Error Response Decoding

All error responses include an `Error-Info` header and a JSON body. Known Pillow errors include `@type`:

```json
{
  "@type": "error",
  "error": "BadRequest",
  "message": "Must have at least 1 item",
  "details": { ... }
}
```

Unknown 500 errors return a simpler body without `@type`:

```json
{
  "info": "An unknown error has occured",
  "details": "Error: ..."
}
```

**Response headers:**
- `Error-Info`: Contains machine-readable error info (present for both known and unknown errors)
- `Content-Type`: `application/json`

**Quick Reference:**

| Status | Meaning | Common Cause |
|--------|---------|--------------|
| 400 | Bad Request | Missing required field, invalid data format |
| 401 | Unauthorized | Missing or invalid authentication |
| 404 | Not Found | Wrong endpoint path, resource doesn't exist |
| 409 | Conflict | Duplicate identifier, concurrent modification |
| 500 | Server Error | Internal error - check server logs |

### 2.4 Pagination Basics

**Using Operators (Recommended):**
```bash
# First 10 results
curl -u ":banana" "localhost:5000/api/v1/products~take(10)"

# Skip 20, take next 10
curl -u ":banana" "localhost:5000/api/v1/products~skip(20)~take(10)"
```

**Using Query Parameters:**
```bash
curl -u ":banana" "localhost:5000/api/v1/products?limit=10&offset=20"
```

**Important:** There is no `totalCount` in list responses. To count items:
```bash
curl -u ":banana" "localhost:5000/api/v1/products~count"
```

---

## 3. Common Task Recipes

### 3.1 Stock Adjustment with IMEI Tracking

**When to use:** Receiving tracked devices, returns, damage recording

**Prerequisites:**
- Stock place exists with an owner
- Stock adjustment reason exists
- Product supports instance tracking (for IMEI-based adjustments)

**Step 1: Verify stock place exists and has owner**
```bash
curl -u ":banana" "localhost:5000/api/v1/stock-places/com.test.placeId=WAREHOUSE-001~with(owner)"
```

**Step 2: Verify adjustment reason exists**
```bash
curl -u ":banana" "localhost:5000/api/v1/stock-adjustment-reasons"
```

**Step 3: Create the adjustment**
```bash
curl -X POST -u ":banana" "localhost:5000/api/v1/stock-adjustments" \
  -H "Content-Type: application/json" \
  -d '{
    "timestamp": "2025-12-20T10:00:00Z",
    "items": [{
      "product": {"identifiers": {"com.test.sku": "IPHONE-15"}},
      "place": {"identifiers": {"com.test.placeId": "WAREHOUSE-001"}},
      "reason": {"identifiers": {"com.heads.seedID": "returned"}},
      "quantity": 1,
      "instance": {"imei": "352916109123456"}
    }]
  }'
```

**Common Errors:**

| Error | Cause | Fix |
|-------|-------|-----|
| "owner is required" | Stock place has no owner | Add owner via `PUT /stock-places/{id}` |
| "timestamp is required" | Missing timestamp | Add ISO 8601 timestamp |
| "items must have at least 1 item" | Empty items array | Add at least one item |

---

### 3.2 Trade Order Creation (Sales Order)

**When to use:** Customer places order, B2B sales, reservations

**Decision Tree: What fields do I need?**

```
Creating order?
├── Required (always):
│   ├── supplier (agent selling)
│   ├── customer (agent buying)
│   ├── sellers (array of selling agents - usually stores)
│   ├── currency
│   └── items (at least 1)
│
└── For each item:
    ├── product (required)
    └── Either:
        ├── quantity (for non-tracked products)
        └── OR instances (for tracked devices/plans)
            ├── {imei: "..."} for MobileDevice
            └── {phoneImei: "..."} for MobilePlan (links to device in same order)
```

**Create order with quantity-based items:**
```bash
curl -X POST -u ":banana" "localhost:5000/api/v1/trade-orders" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.test.orderId": "ORD-2024-001"},
    "supplier": {"identifiers": {"com.heads.seedID": "ourcompany"}},
    "customer": {"identifiers": {"com.test.customerId": "CUST-001"}},
    "sellers": [{"identifiers": {"com.heads.seedID": "store1"}}],
    "currency": {"identifiers": {"currencyCode": "SEK"}},
    "items": [
      {
        "product": {"identifiers": {"com.test.sku": "PRODUCT-001"}},
        "quantity": 2
      }
    ]
  }'
```

**Order Status Progression:**
```
New → (reservedUntil) → Reserved
New|Reserved → (tryApprove) → Committed
Committed → (tryCancel) → Cancelled
Committed → (shipment fulfillment) → Fulfilled
```

> **Note:** Trade orders use a status array (not a single value). Common statuses include: `New`, `Reserved`, `Unreserved`, `Committed`, `Fulfilled`, `Cancelled`, and return-related statuses. The `tryApprove` action commits the order; there is no `Shipped` or `Completed` status—fulfillment is tracked via shipment orders.

**Required Fields:**
- `items` must be non-empty (at least 1 item required)
- `sellers` must be non-empty (at least 1 seller required)

**Product Identifiers:**

Product identifiers require a **fully qualified namespace**. Bare keys like `"sku"` will be rejected:

```bash
# WRONG - bare key
{"product": {"identifiers": {"sku": "PHONE-001"}}}

# RIGHT - namespaced key
{"product": {"identifiers": {"com.example.sku": "PHONE-001"}}}
```

**Instance Tracking (for serialized products):**

For serialized products (devices, SIM cards), use `instances` instead of `quantity`:

```bash
# MobileDevice with IMEI
{
  "product": {"identifiers": {"com.test.sku": "PHONE-001"}},
  "instances": [{"imei": "352916109123456"}]
}

# MobilePlan referencing device in same order
{
  "product": {"identifiers": {"com.test.sku": "PLAN-001"}},
  "instances": [{"phoneImei": "352916109123456"}]
}
```

**Order matters:** A MobilePlan item with `phoneImei` must reference an IMEI from a MobileDevice item that appears earlier in the items array.

> **Tip:** Products need the correct `instanceType` set during product creation (not on the order).

**Expansions:**
- `~with(manualDiscounts)` - Manual discounts applied to order
- `~with(payments)` - Payment records for this order
- Item-level: `discountable` flag indicates if item accepts discounts

---

### 3.3 Payment Order Creation

**When to use:** Recording payment for trade order

**Via Trade Order Actions (Recommended):**

```bash
curl -X PATCH -u ":banana" "localhost:5000/api/v1/trade-orders/com.test.orderId=ORD-2024-001" \
  -H "Content-Type: application/json" \
  -d '{
    "actions": {
      "createPayment": {
        "transactionId": "TXN-2024-001",
        "timestamp": "2025-12-20T14:30:00Z",
        "method": {"identifiers": {"methodId": "com.heads.card"}},
        "currency": {"identifiers": {"currencyCode": "SEK"}}
      }
    }
  }'
```

**Required Fields:**

| Field | Required | Notes |
|-------|----------|-------|
| `transactionId` | Yes | Unique payment identifier |
| `timestamp` | Yes | ISO 8601 timestamp |
| `method` | Yes | Payment method (must not have integration) |
| `currency` | Yes | Currency for the payment |
| `amount` | No | Defaults to sum of order item amounts |
| `items` | No | Defaults to all order items |

> **Important:** The `currency` field is required. Omitting it results in a "Currency not found" error.

---

### 3.4 Receipt Creation and Querying

**When to use:** POS transactions, sales records

**Creating (Importing) a Receipt:**

Receipt creation is used for importing receipt data from external systems. All fields below are required:

```bash
curl -X POST -u ":banana" "localhost:5000/api/v1/receipts" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"receiptID": "RCP-2024-00001"},
    "prefix": "RCP",
    "ordinal": 1,
    "timestamp": "2025-12-20T10:00:00Z",
    "seller": {"identifiers": {"com.heads.seedID": "store1"}},
    "buyer": {"identifiers": {"com.test.customerId": "CUST-001"}},
    "posTerminal": {"identifiers": {"posTerminalName": "Kassa 1"}},
    "currencyCode": "SEK",
    "items": [
      {
        "product": {"identifiers": {"com.test.sku": "PRODUCT-001"}},
        "quantity": 1,
        "unitAmount": 159.20,
        "vatPercentage": 25
      }
    ],
    "payments": [
      {
        "method": "com.heads.cash",
        "amount": 199.00,
        "consumerPrintout": "CASH PAYMENT\nAmount: 199.00 SEK",
        "merchantPrintout": "CASH PAYMENT\nAmount: 199.00 SEK\nKeep this receipt"
      }
    ]
  }'
```

**Required Receipt Fields:**
- `identifiers.receiptID` - Unique receipt identifier
- `prefix` - Receipt number prefix
- `ordinal` - Receipt sequence number
- `timestamp` - ISO 8601 timestamp for the receipt
- `seller` - Selling agent (store)
- `buyer` - Buying agent (customer)
- `posTerminal` - POS terminal reference
- `currencyCode` - Currency code (e.g., "SEK")
- `items` - At least one item
- `payments` - At least one payment

**Item Fields:**
- `product` - Product reference (required)
- `quantity` - Number of items
- `unitAmount` - Unit price (VAT-exclusive)
- `vatPercentage` - VAT percentage

**Payment Fields:**
- `method` - Payment method ID string (e.g., `"com.heads.cash"`)
- `amount` - Payment amount (positive for payment, negative for refund)
- `consumerPrintout` - Receipt text for the consumer (required on create)
- `merchantPrintout` - Receipt text for the merchant (required on create)

**Querying Receipts:**

| Need | Query |
|------|-------|
| Last 24 hours | `/receipts/after/-=24` |
| Last 7 days | `/receipts/after/-=168` |
| Last 30 minutes | `/receipts/after/-=0:30` |
| After specific time | `/receipts/after/2024-12-01T00:00:00Z` |
| Before specific time | `/receipts/before/2024-12-31T23:59:59Z` |
| Date range | `/receipts~where(timestamp>2024-12-01T00:00:00Z,timestamp<2024-12-31T23:59:59Z)` |
| With item count | `/receipts~with(items/count)` |

> **Important:** The `/receipts/after/` and `/receipts/before/` endpoints cannot be chained together (e.g., `/receipts/after/{ts}/before/{ts}` is not supported). For date ranges, use `~where` with multiple timestamp conditions.

**Performance Tip:** The `/receipts/after/` and `/receipts/before/` endpoints use database indexes and are recommended for time-based queries. Relative date syntax (`-=24`, `-=0:30`) is supported.

---

### 3.5 User and Role Setup

**When to use:** Onboarding employees, access control

**Create User:**

Users must be linked to an existing agent (person). First create or identify the person, then create the user:

```bash
# Step 1: Create the person (if not exists)
curl -X PUT -u ":banana" "localhost:5000/api/v1/people/com.test.personId=PERSON-001" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.test.personId": "PERSON-001"},
    "givenName": "John",
    "familyName": "Cashier"
  }'

# Step 2: Create the user linked to the person
curl -X POST -u ":banana" "localhost:5000/api/v1/users" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.test.userId": "USER-001"},
    "agent": {"identifiers": {"com.test.personId": "PERSON-001"}}
  }'
```

> **Note:** Users do not have a `name` field. The user's display name comes from the linked agent (person).

**Assign Role to User:**
```bash
curl -X POST -u ":banana" "localhost:5000/api/v1/users/com.test.userId=USER-001/roleAssignments" \
  -H "Content-Type: application/json" \
  -d '{
    "role": {"identifiers": {"userRoleID": "cashier"}},
    "node": {"identifiers": {"com.heads.seedID": "store1"}}
  }'
```

> **Note:** Role assignments use `node` (not `scope`) to specify the organizational scope.

---

## 4. Data Modeling Tips

### 4.1 Identifiers and External IDs

Every resource has two types of identifiers:

**Internal Key (`identifiers.key`):**
- Auto-generated, immutable
- Format: hex string like `abc123def456`
- Use for stable references within the system

**External IDs:**
- User-defined, using reverse-domain notation
- Format: `com.yourcompany.idType`
- Primary way to reference objects in integrations

**When to use key vs external ID:**

| Use Case | Use |
|----------|-----|
| Integrations with external systems | External ID |
| Internal references within API | Either |
| Stable references that survive re-seeding | External ID |
| Debugging with known database records | Key |

### 4.2 Essential vs Non-Essential Fields

**Default responses include only essential fields.** Essential fields vary by type:

| Type | Essential Fields |
|------|-----------------|
| Products | `identifiers`, `name`, `gtin`, `status` |
| People | `identifiers`, `fullName`, `givenName`, `familyName`, `personalNumber` |
| Companies/Stores | `identifiers`, `name` |
| Trade Orders | `identifiers`, `status`, `timestamp`, `items` |
| Receipts | `identifiers`, `seller`, `buyer`, `timestamp`, `items`, `payments` |
| Users | `identifiers`, `agent` |

> **Note:** Essential fields are defined per type in the schema. The list above shows common examples. Use `~withAll` to retrieve all fields, or consult the OpenAPI spec for the complete schema.

**To include more fields:**

| Need | Operator | Example |
|------|----------|---------|
| Specific fields | `~with(field1,field2)` | `~with(prices,categories)` |
| All fields | `~withAll` | `/products~withAll` |
| Only certain fields | `~just(field1,field2)` | `~just(name,identifiers)` |

### 4.3 Object References

When referencing another object, use the `identifiers` wrapper:

```json
{
  "product": {
    "identifiers": {"com.test.sku": "SKU-001"}
  }
}
```

**When `@type` is needed:**
- Polymorphic fields (e.g., `customer` can be person or company)
- Discriminated unions

```json
{
  "customer": {
    "@type": "person",
    "identifiers": {"com.test.customerId": "CUST-001"}
  }
}
```

### 4.4 Write Semantics

| Method | Behavior |
|--------|----------|
| POST | Create new - fails if identifier exists |
| PUT | Upsert - create or replace entirely |
| PATCH | Merge - update only specified fields |

---

## 5. Operator Usage Cheat Sheet

### 5.1 Essential Operators

| Operator | Purpose | Example | Pitfall |
|----------|---------|---------|---------|
| `~where(cond)` | Filter | `~where(status=Active)` | In-memory filter, not indexed |
| `~take(N)` | Limit results | `~take(10)` | Apply before other operators when possible |
| `~skip(N)` | Offset | `~skip(20)` | Combine with `~take` for pagination |
| `~orderBy(field)` | Sort ascending | `~orderBy(name)` | Collects ALL items before sorting |
| `~orderBy(field:desc)` | Sort descending | `~orderBy(name:desc)` | Same memory concern |
| `~first` | First element | `~first` | Returns `null` when empty, NOT `[]` |
| `~count` | Count elements | `~count` | Returns number, not object |
| `~with(field)` | Expand field | `~with(items)` | Multiple: `~with(a,b)` |
| `~just(fields)` | Project only | `~just(name,key:identifiers/key)` | Clears ALL other fields |
| `~map(type)` | Transform | `~map(com.heads.receipt-csv)` | **Only accepts mapped type names** |
| `~flat` | Flatten arrays | `/orders~with(items)/items~flat` | NO parentheses |
| `~distinct` | Unique values | `/products/status~distinct` | NO parentheses, primitives only |

> **Important:** `~map` only accepts registered mapped type names (e.g., `com.heads.receipt-csv`). It does NOT accept field names as inline selectors. To extract a field, use path navigation (e.g., `/products/status`) or `~just(field)`.

### 5.2 Parameterless Operators (NO Parentheses!)

These operators take no arguments - don't add `()`:

| Correct | WRONG |
|---------|-------|
| `~first` | `~first()` |
| `~last` | `~last()` |
| `~count` | `~count()` |
| `~flat` | `~flat()` |
| `~distinct` | `~distinct()` |
| `~typeless` | `~typeless()` |

### 5.3 Operators That Don't Exist

| Wrong Pattern | Correct Alternative |
|---------------|---------------------|
| `~reverse()` | `~orderBy(field:desc)` |
| `~any()` | `~where(cond)~first` for existence checks; for sub-collections use `~with(field)` and filter client-side |
| `~contains()` | `~where(field=~pattern)` |
| `~filter()` | `~where()` |
| `~limit()` | `~take()` |
| `~offset()` | `~skip()` |

### 5.4 Indexed Properties (Performance)

Use these instead of `~where()` for date filtering - they use database indexes:

```bash
# FAST (uses index)
/receipts/after/-=168

# SLOW (in-memory filter)
/receipts~where(timestamp>2024-12-14)
```

**Relative Date Syntax:**

| Syntax | Meaning |
|--------|---------|
| `-=168` | 168 hours ago (1 week) |
| `-=24` | 24 hours ago |
| `-=0:30` | 30 minutes ago |
| `+=48` | 48 hours in future |

---

## 6. Finder Patterns and Body Indicators

### 6.1 Body Indicator Basics

The `@` marker in a URL path indicates where the request body is targeted. Path segments after `@` navigate through the result.

**Pattern:**
```
METHOD /resource/@target/navigation/path BODY
```

**Example:**
```bash
# Send body to /trade-orders/find, then navigate to results
PUT /trade-orders/@find/results
Body: { "modifiedTag": "2025-12-17" }
```

### 6.2 Common Finders

| Resource | Endpoint | Common Parameters |
|----------|----------|-------------------|
| Trade Orders | `PUT /trade-orders/@find/results` | `modifiedTag`, `customer`, `supplier`, `buyer`, `seller` |
| Agents | `PUT /agents/@find/results` | `email`, `phone`, `givenName`, `familyName`, `nationalId` |
| Receipts | `PUT /receipts/@find/results` | Date range, seller, terminal |

**Trade Order Finder Example:**
```bash
curl -X PUT -u ":banana" "localhost:5000/api/v1/trade-orders/@find/results" \
  -H "Content-Type: application/json" \
  -d '{"modifiedTag": "2025-12-17"}'
```

**Agent Finder Example (by email):**
```bash
curl -X PUT -u ":banana" "localhost:5000/api/v1/agents/@find/results" \
  -H "Content-Type: application/json" \
  -d '{"email": "john@example.com"}'
```

**Agent Finder Behavior:**
- Uses heuristic lookup by email, phone, or nationalId
- Name filtering uses metaphone (phonetic) matching
- Returns results array; navigate to specific result with `/@find/results/0`

### 6.3 Navigating Finder Results

After finding results, you can navigate into specific elements:

```bash
# Get first result's name
PUT /agents/@find/results/0/name
Body: {"email": "john@example.com"}

# Apply operators to results
PUT /agents/@find/results~take(5)
Body: {"givenName": "John"}
```

---

## 7. Content Negotiation and Export

### 7.1 Response Formats

| Accept Header | Format | Use Case |
|---------------|--------|----------|
| `application/json` | JSON array | Default, code parsing |
| `application/x-ndjson` | NDJSON (line-delimited) | Streaming, large datasets |
| `text/csv` | CSV | Spreadsheet export |
| `text/plain` | Plain text | Simple values |
| `text/html` | HTML | Browser-friendly output |
| `application/sql` | SQL statements | Database export (requires mapped type) |
| `application/vnd.ms-sqlserver.csv` | SQL Server CSV | SQL Server bulk import format |

> **Note:** SQL formats (`application/sql`, `application/vnd.ms-sqlserver.csv`) require a mapped type that produces `SqlStatement[]` output.

### 7.2 Response Format Options

For large result sets, consider using NDJSON format for streaming:

```bash
# NDJSON streaming - one object per line (recommended for large result sets)
curl -u ":banana" -H "Accept: application/x-ndjson" \
  "localhost:5000/api/v1/products~take(100)"
```

**Response Format Modes:**

| Accept Header | Behavior | First Byte | Use Case |
|---------------|----------|------------|----------|
| `application/json` | Buffered - waits for all items | After serialization | Small datasets, simple parsing |
| `application/x-ndjson` | Line-delimited - one object per line | After buffering | CLI pipelines, large datasets |

### 7.3 Transaction and Streaming Semantics

All array responses go through two phases: **buffering** (database read) and **serialization** (output writing).

**Phase 1 - Buffering (Transaction-Bounded):**
All items are read from the database within a single transaction. This guarantees:
- **Snapshot consistency**: The entire result set reflects one point-in-time
- **Atomicity**: Either all items are returned, or none (on error)
- **No partial results**: Errors during buffering return no data, not corrupted arrays

**Phase 2 - Serialization (Format-Dependent):**
After buffering completes, output format determines streaming behavior:

| Format | Buffering | Serialization | First Byte After |
|--------|-----------|---------------|------------------|
| `application/json` | Full | Buffered | All items read + serialized |
| `application/x-ndjson` | Full | Streaming (line-by-line) | All items read |
| `text/csv` | Full | Streaming (row-by-row) | All items read |

### 7.4 Mapped Type Exports

Transform data using mapped types:

```bash
# Export receipts as CSV format
curl -u ":banana" "localhost:5000/api/v1/receipts/after/-=24~map(com.heads.receipt-csv)"

# Bundle receipts into a single result using array-body mapped type with $first
curl -u ":banana" "localhost:5000/api/v1/receipts~map(com.heads.receipts-zip)"
```

> **Note:** `~map` returns **one result per source item**. To aggregate a collection into a single result, use an array-body mapped type ending with `"$first"` (see [Mapped Types Reference](../reference/mapped-types.md)). The legacy `@merge` directive is no longer supported.

### 7.5 Bulk Import (NDJSON)

```bash
curl -X PUT -u ":banana" "localhost:5000/api/v1/products" \
  -H "Content-Type: application/x-ndjson" \
  --data-binary @products.ndjson
```

---

## 8. Troubleshooting: When Things Go Wrong

### 8.1 HTTP 400 Bad Request

**Meaning:** Your request is malformed or contains invalid data.

| Error Message | Cause | Fix |
|---------------|-------|-----|
| "Required field missing" | Missing required property | Check required fields in OpenAPI |
| "Invalid identifier" | Bad external ID format | Use reverse-domain: `com.app.id` |
| "Must have at least 1 item" | Empty items array | Add at least one item |
| "Does not match any existing..." | Reference to non-existent object | Verify referenced object exists first |
| "Must have at least 1 seller" | Empty sellers array | Add seller agent to order |
| "timestamp is required" | Missing timestamp | Add ISO 8601 timestamp |

### 8.2 HTTP 404 Not Found

**Meaning:** The endpoint or resource doesn't exist.

| Symptom | Cause | Fix |
|---------|-------|-----|
| Endpoint not found | Wrong path casing | Use kebab-case for top-level, camelCase for nested |
| Resource not found | Object doesn't exist | Verify identifier value |
| Wrong namespace | External ID not found | Check namespace spelling |

**Path Casing Rules:**
```bash
# TOP-LEVEL: kebab-case
/trade-orders      # Correct
/tradeOrders       # WRONG - 404

# NESTED: camelCase
/agents/{key}/customerRelations    # Correct
/agents/{key}/customer-relations   # WRONG - 404
```

### 8.3 HTTP 409 Conflict

**Meaning:** State conflict, usually duplicate creation or concurrent modification.

| Error | Cause | Fix |
|-------|-------|-----|
| "Already exists" | Duplicate external ID on POST | Use PUT for upsert, or generate unique ID |
| "Concurrent modification" | Another process modified data | Re-fetch and retry |

### 8.4 Common Request Mistakes

| Mistake | Symptom | Fix |
|---------|---------|-----|
| Wrong path casing | 404 | `/customerRelations` not `/customer-relations` (nested) |
| Missing `identifiers` wrapper | 400 | `{"identifiers": {"id": "..."}}` not `{"id": "..."}` |
| Empty parentheses on operator | Unexpected result | `~first` not `~first()` |
| Currency as string | 400 | `{"identifiers": {"currencyCode": "SEK"}}` |
| Wrong reference field | 400 | Stores use `owner` not `parent` |
| POST vs PUT confusion | 409 or incomplete | POST creates new, PUT upserts |
| Missing @type for polymorphic | 400 | Add `"@type": "person"` when needed |

### 8.5 Debug Checklist

When something doesn't work:

1. **Authentication working?**
   ```bash
   curl -u ":banana" "localhost:5000/api/v1/void"
   ```

2. **Endpoint exists?**
   ```bash
   # Check OpenAPI spec for available endpoints
   curl -u ":banana" "localhost:5000/api/v1/openapi.json"

   # Or query the elements API for schema introspection
   curl -u ":banana" "localhost:5000/api/v1/elements/types"
   curl -u ":banana" "localhost:5000/api/v1/elements/properties"
   ```

3. **Referenced objects exist?**
   - Check each object referenced in your payload

4. **Request syntax correct?**
   - Valid JSON?
   - Correct HTTP method?
   - Right Content-Type header?

5. **Operator syntax correct?**
   - No parentheses on parameterless operators?
   - Correct operator name?

---

## 9. Glossary

| Term | Definition |
|------|------------|
| **Agent** | Abstract entity representing a person, company, or store |
| **External ID** | User-defined identifier using reverse-domain notation (e.g., `com.myapp.userId`) |
| **Operator** | Query modifier (e.g., `~where`, `~take`, `~with`) |
| **Mapped Type** | Transform definition for reshaping data on export |
| **Finder** | Parameterized query endpoint that accepts body parameters |
| **Body Indicator** | `@` marker in URL path showing where request body targets |
| **Essential Field** | Field included in default response without expansion |
| **Non-Essential Field** | Field requiring `~with` or `~withAll` to include |
| **Upsert** | Create if not exists, update if exists (PUT behavior) |
| **NDJSON** | Newline-delimited JSON, one object per line |

---

## 10. Common Identifier Patterns

| Resource | Identifier Pattern | Example |
|----------|-------------------|---------|
| Products | `com.myapp.sku=VALUE` | `com.myapp.sku=SKU-001` |
| People | `com.myapp.customerId=VALUE` | `com.myapp.customerId=CUST-001` |
| Companies | `com.myapp.companyId=VALUE` | `com.myapp.companyId=COMP-001` |
| Stores | `com.myapp.storeId=VALUE` | `com.myapp.storeId=STORE-001` |
| Orders | `com.myapp.orderId=VALUE` | `com.myapp.orderId=ORD-001` |
| Currencies | `currencyCode=VALUE` | `currencyCode=SEK` |
| Countries | `countryCode=VALUE` | `countryCode=SE` |
| POS Terminals | `posTerminalName=VALUE` | `posTerminalName=Kassa%201` |
| User Roles | `userRoleID=VALUE` | `userRoleID=admin` |
| Payment Methods | `methodId=VALUE` | `methodId=com.heads.cash` |
| Receipts | `receiptID=VALUE` | `receiptID=RCP-2024-00001` |
| Mapped Types | `mappedTypeName=VALUE` | `mappedTypeName=com.heads.receipt-csv` |
