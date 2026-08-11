# Receipts Data Guide

This guide explains how to fetch, paginate, and interpret receipt data from the CommerceOS API for BI and analytics use cases.

---

## Overview

Receipts are immutable records of completed sales at a point of sale. Each receipt captures what was bought, how much was paid, any discounts applied, and taxes charged. Unlike trade orders (which represent pending or in-progress transactions), receipts represent transactions that have already happened.

**Key characteristics:**
- **Immutable after creation:** Receipts cannot be modified via the API once created
- **Importable:** Receipts can be imported via `POST /v1/receipts` for migration or external system integration
- **Timestamped:** Every receipt has a `timestamp` field for chronological ordering
- **Complete:** Each receipt includes items, payments, VAT breakdowns, and optional discounts

---

## Creating (Importing) Receipts

Receipts can be imported into CommerceOS via `POST /v1/receipts`. This is typically used for:
- Migrating historical receipt data from legacy systems
- Importing receipts from external POS systems
- Integration scenarios where receipts are created outside CommerceOS

### Required Fields on Create

| Field | Type | Description |
|-------|------|-------------|
| `identifiers.receiptID` | string | Human-readable receipt ID (e.g., `"MPK00000000002"`) |
| `prefix` | string | Store/terminal prefix (e.g., `"MPK"`) |
| `ordinal` | decimal (string) | Sequential number within prefix (e.g., `"1"`) |
| `timestamp` | date-time | Transaction timestamp (read-only after creation) |
| `seller` | agent | Store or company that sold the products |
| `buyer` | agent | Customer or company that purchased |
| `posTerminal` | POS terminal | The POS terminal associated with the receipt |
| `currencyCode` | string | Currency code (e.g., `"SEK"`) |
| `items` | array | At least one receipt item (product, quantity, unitAmount) |

### Optional Fields on Create

| Field | Type | Description |
|-------|------|-------------|
| `payments` | array | Payment records (optional in current behavior, but typically expected for POS receipts) |

> **Note:** While `payments` is not enforced as required by the API, most POS receipts include at least one payment record.

### Example Import

```bash
POST /v1/receipts
Content-Type: application/json

[
  {
    "identifiers": { "receiptID": "MPK00000000001" },
    "prefix": "MPK",
    "ordinal": "1",
    "seller": { "identifiers": { "com.example.storeId": "STORE-001" } },
    "buyer": { "identifiers": { "com.example.customerId": "CUST-001" } },
    "posTerminal": { "identifiers": { "com.example.posId": "POS-001" } },
    "currencyCode": "SEK",
    "timestamp": "2025-02-13T09:20:32.710Z",
    "items": [
      {
        "product": { "identifiers": { "com.example.sku": "PHONE-001" } },
        "quantity": "1",
        "unitAmount": "5999.20"
      }
    ],
    "payments": [
      {
        "method": "com.heads.cash",
        "amount": "7499.00",
        "consumerPrintout": "CASH PAYMENT\nAmount: 7499.00 SEK",
        "merchantPrintout": "CASH PAYMENT\nAmount: 7499.00 SEK\nKeep this receipt"
      }
    ]
  }
]
```

---

## Fetching Receipts

### Base Collection

```bash
# Get all receipts (default ordering, limited by system defaults)
GET /v1/receipts

# Get a single receipt by database key
GET /v1/receipts/{key}

# Get a single receipt by receipt ID
GET /v1/receipts/receiptID=MPK00000000002
```

### Ordering by Timestamp

For BI and analytics, you typically want receipts in chronological order:

```bash
# Latest receipts first (most recent)
GET /v1/receipts~orderBy(timestamp:desc)~take(200)

# Oldest receipts first
GET /v1/receipts~orderBy(timestamp)~take(200)
```

### Using Receipt Identifiers

Receipts have special identifiers:

| Identifier | Description | Example |
|------------|-------------|---------|
| `key` | Database key (internal, stable) | `6b401deb013d7b07ba8139933e7c9395` |
| `receiptID` | Human-readable ID printed on receipt | `MPK00000000002` |
| `prefix` | Store/terminal prefix | `MPK` |
| `ordinal` | Sequential number within prefix | `"2"` |

```bash
# Lookup by receiptID
GET /v1/receipts/receiptID=MPK00000000002

# Lookup by database key
GET /v1/receipts/6b401deb013d7b07ba8139933e7c9395
```

---

## Pagination at Scale

When exporting large volumes of receipt data, proper pagination is essential.

### Using Operators (Recommended for Complex Queries)

```bash
# Page 1: First 200 receipts
GET /v1/receipts~orderBy(timestamp:desc)~take(200)

# Page 2: Skip first 200, take next 200
GET /v1/receipts~orderBy(timestamp:desc)~skip(200)~take(200)

# Page 3: Skip first 400, take next 200
GET /v1/receipts~orderBy(timestamp:desc)~skip(400)~take(200)
```

### Using Query Parameters (Simple Cases)

```bash
# Page 1
GET /v1/receipts?orderby=timestamp:desc&limit=200

# Page 2
GET /v1/receipts?orderby=timestamp:desc&limit=200&offset=200

# Page 3
GET /v1/receipts?orderby=timestamp:desc&limit=200&offset=400
```

**Query Parameter Normalization**

Query parameters can be mixed with path operators—the system normalizes them into a canonical order:

```
format → fields → where → orderBy → skip → take → simpleJust
```

This means sorting (orderBy) always runs before pagination (skip/take), ensuring consistent results regardless of URL parameter order. For example:

```bash
# These produce equivalent results:
GET /v1/receipts?orderby=timestamp:desc&limit=100&offset=50
GET /v1/receipts~orderBy(timestamp:desc)~skip(50)~take(100)
GET /v1/receipts~orderBy(timestamp:desc)?limit=100&offset=50
```

See the [Operators Reference](operators.md#query-parameter-normalization) for details.

### Incremental Pulls by Timestamp

For ongoing BI synchronization, use timestamp-based incremental pulls:

```bash
# Initial full export (oldest first for stable ordering)
GET /v1/receipts~orderBy(timestamp)~take(1000)

# Subsequent pulls: receipts after your last sync timestamp
GET /v1/receipts/after/2025-02-13T09:20:32.710Z~take(1000)

# Or use the where operator for timestamp filtering
GET /v1/receipts~where(timestamp>2025-02-13T09:20:32.710Z)~orderBy(timestamp)~take(1000)
```

---

## BI Alignment: Stable Keys for Export

When building BI exports, use these stable fields as keys:

### Receipt-Level Keys

| Field | Stability | Use Case |
|-------|-----------|----------|
| `identifiers.key` | Immutable | Primary key in data warehouse |
| `identifiers.receiptID` | Immutable | Human-readable identifier |
| `timestamp` | Immutable | Partitioning, incremental sync |

### Recommended Export Fields

```bash
# Full receipt with all fields
GET /v1/receipts/{id}?fields=all

# Or using operators
GET /v1/receipts/{id}~withAll
```

**Core fields for BI export:**

| Field | Type | Description |
|-------|------|-------------|
| `identifiers.key` | string | Database key |
| `identifiers.receiptID` | string | Printed receipt ID |
| `seller` | agent | Store or company that sold |
| `buyer` | agent | Customer |
| `timestamp` | date-time | Transaction time |
| `currencyCode` | string | Currency code (e.g., "SEK") |
| `totalAmount` | decimal | Grand total including VAT |
| `totalTaxAmount` | decimal | Total VAT amount |
| `totalDiscountAmount` | decimal | Total discount applied (excluding VAT) |
| `roundingAmount` | decimal | Cash rounding adjustment |
| `totalPayableAmount` | decimal | Amount due |
| `totalPaidAmount` | decimal | Amount paid |
| `totalExternalSettlementsAmount` | decimal | Total amount settled outside POS |
| `vatGroups` | array | VAT breakdown by rate |
| `payments` | array | Payment transactions |
| `externalSettlements` | array | External payments from webshop/invoice |
| `items` | array | Line items |

### VAT Groups Structure

Each VAT group summarizes items at the same tax rate:

```json
{
  "percentage": "25",
  "quantity": "3",
  "netAmount": "800.00",
  "grossAmount": "1000.00",
  "vatAmount": "200.00"
}
```

### Payments Structure

Each payment records a transaction:

```json
{
  "identifiers": {
    "key": "abc123",
    "transactionId": "550e8400-e29b-41d4-a716-446655440000"
  },
  "paymentType": "PAYMENT",
  "method": "com.heads.card",
  "amount": "1000.00",
  "currencyCode": "SEK",
  "consumerPrintout": "CARD PAYMENT\nAmount: 1000.00 SEK\nCard: ****1234\nApproved",
  "merchantPrintout": "CARD PAYMENT\nAmount: 1000.00 SEK\nCard: ****1234\nApproved\nKeep this receipt"
}
```

**Required fields (on create):**
- `method`: Payment method identifier (string, e.g., `"com.heads.card"`)
- `amount`: Payment amount (positive for payments, negative for refunds)

**Optional fields (on create):**
- `consumerPrintout`: Text printed on customer receipt copy (recommended for display)
- `merchantPrintout`: Text printed on merchant receipt copy (recommended for display)

> **Note:** While `consumerPrintout` and `merchantPrintout` are not enforced by the importer, they are recommended for displaying payment details on receipts.

**Read-only fields (derived at runtime):**
- `paymentType`: Derived from payment direction—`"PAYMENT"` for positive amounts (incoming), `"REFUND"` for negative amounts (outgoing)
- `currencyCode`: Always matches the receipt's currency; derived from the payment record
- `transactionId`: Auto-generated UUID when importing receipts; read-only after creation

### External Settlements Structure

External settlements balance a receipt against payments that happened outside the POS system. Used when an order was partially or fully paid elsewhere—like through a webshop payment or an invoice—before being completed at the register.

```json
{
  "externalSettlements": [
    {
      "amount": "2500.00",
      "referencedPayment": {
        "@type": "payment order",
        "identifiers": {"key": "..."}
      }
    }
  ],
  "totalExternalSettlementsAmount": "2500.00"
}
```

**Fields:**
- `amount`: The settlement amount
- `referencedPayment`: Optional reference to the payment order this settlement corresponds to

**Accessing external settlements:**

```bash
# Get external settlements for a receipt
GET /v1/receipts/{id}/externalSettlements

# Get the total
GET /v1/receipts/{id}/totalExternalSettlementsAmount
```

---

## Discounts

> **Detailed guide:** See [Receipt Discounts & Surcharges — Extraction Guide](../guide/examples/receipt-discounts-surcharges.md) for comprehensive curl examples, nested expansion patterns, per-rule breakdowns, and ERP integration patterns.

Discounts are stored at the **item level**, not at the receipt level. Each receipt item can have multiple discounts, and discount amounts are reported excluding VAT.

### Where Discounts Live

```
receipt.items[].discounts[]
```

### Discount Structure

```json
{
  "reason": {
    "identifiers": {"key": "..."},
    "name": "Employee Discount",
    "active": true
  },
  "amount": "50.00"
}
```

### Extracting Per-Item Discounts

```bash
# Get receipt with items expanded
GET /v1/receipts/{id}~with(items)
```

> **Note:** Receipt item subpaths for `discounts`/`instances` are currently unsupported, and subpaths like `manualNotes` also error. Use `~with(items)` and read `items[].discounts`/`items[].instances` from the expanded items instead.

### Calculating Total Discounts

The receipt provides a pre-calculated total (excluding VAT):

```bash
GET /v1/receipts/{id}/totalDiscountAmount
```

Or calculate from items:

```json
{
  "items": [
    {
      "description": "Product A",
      "discountAmount": "25.00",
      "discounts": [
        {"reason": {"name": "Loyalty"}, "amount": "25.00"}
      ]
    },
    {
      "description": "Product B",
      "discountAmount": "50.00",
      "discounts": [
        {"reason": {"name": "Promo"}, "amount": "30.00"},
        {"reason": {"name": "Staff"}, "amount": "20.00"}
      ]
    }
  ],
  "totalDiscountAmount": "75.00"
}
```

### Coupon Uses on Receipts

When a discount on a receipt item was triggered by a coupon, the discount entry carries a `couponUses` array listing the coupon (or coupons) that activated it. This is the right place to look for *"which coupon was used to get this discount on this receipt"* — no second request is required.

**Where coupon uses live**

```
receipt.items[].discounts[].couponUses[]
```

**Fields**

| Field | Type | Description |
|-------|------|-------------|
| `coupon` | reference | The discount coupon that activated this discount. Resolves to the standard discount-coupon shape; expand with `~with(coupon)` for the full coupon record. |
| `enteredCode` | string | The literal code the customer entered or that was scanned at the POS. May differ from the coupon's canonical `code` (case, leading zeros, vendor-specific prefixes, etc.). May be absent for coupon uses that were not recorded with a customer-supplied code (e.g., programmatic application). |

`couponUses` is populated whenever a coupon (or coupons) activated the discount — most commonly on automatic discounts (`manual: false`) whose rule requires a coupon. It is empty for cashier-applied manual discounts (`manual: true`) and for automatic discounts whose rule fires purely on conditions (no coupon required). If multiple coupons contributed to the same discount line, each is a separate entry in the array.

> **`enteredCode` vs the coupon's own `code`.** When reconciling receipt data against an external loyalty system or CRM, prefer `enteredCode` — that is the exact string the customer presented. The coupon's canonical `code` is whatever is stored on the coupon record (for [pattern coupons](../guide/examples/discount-coupons.md#literal-codes-vs-pattern-codes), a regular expression rather than the literal customer-supplied string).

**Expansion example**

Fetch a receipt with its items, discounts, and the coupon record behind each coupon use in a single request:

```bash
curl -X GET -u ":banana" \
  "https://example.app.heads.com/api/v1/receipts/com.example.receiptId=REC-2026-001~with(items~with(discounts~with(couponUses~with(coupon))))"
```

**Sample response (truncated to the relevant slice)**

```jsonc
{
  "items": [{
    "discounts": [{
      "reason": { "name": "Summer 20%" },
      "amount": "50.00",
      "manual": false,
      "rule": { "identifiers": { "com.example.ruleId": "summer-20pct" } },
      "couponUses": [{
        "coupon": { "identifiers": { "com.example.couponId": "summer-launch" } },
        "enteredCode": "SUMMER20"
      }]
    }]
  }]
}
```

**Listing every coupon used on a receipt**

Flatten across `items[].discounts[].couponUses[]` and de-duplicate by coupon identifier:

```bash
curl -sS -u ":banana" \
  "https://example.app.heads.com/api/v1/receipts/com.example.receiptId=REC-2026-001~with(items~with(discounts~with(couponUses~with(coupon))))" \
  | jq '[ .items[].discounts[].couponUses[]?
          | { enteredCode,
              couponId: .coupon.identifiers."com.example.couponId" } ]
        | unique_by(.couponId)'
```

The same flatten with a `select(...)` filter answers *"did the customer use coupon X on this receipt?"*:

```bash
curl -sS -u ":banana" \
  "https://example.app.heads.com/api/v1/receipts/com.example.receiptId=REC-2026-001~with(items~with(discounts~with(couponUses~with(coupon))))" \
  | jq '[ .items[].discounts[].couponUses[]?
          | select(.coupon.identifiers."com.example.couponId" == "summer-launch") ]
        | length > 0'
```

For the broader picture — what a coupon entity looks like, how literal codes differ from pattern (regex) codes, redemption counting, and the operational surface — see [Discount Coupons](../guide/examples/discount-coupons.md).

---

## Instances (IMEI/Serial Data)

Instance tracking data (currently mobile device IMEI numbers) is stored at the item level.

### Where Instances Live

```
receipt.items[].instances[]
```

### Instance Structure

For mobile devices, instances contain IMEI data:

```json
{
  "items": [
    {
      "description": "Samsung Galaxy S24",
      "product": {"identifiers": {"key": "..."}},
      "instances": [
        {
          "@type": "mobile device",
          "identifiers": {"key": "..."},
          "imei": "123456789012345"
        }
      ]
    }
  ]
}
```

### Accessing Instance Data

To access instance data, expand items on the receipt:

```bash
# Get receipt with items expanded (includes instances)
GET /v1/receipts/{id}~with(items)
```

> **Note:** Direct item subpaths like `/v1/receipts/{id}/items/0/instances` and `/v1/receipts/{id}/items/0/discounts` are currently unsupported, and subpaths like `manualNotes` also error. Use `~with(items)` and read the `instances` array from each item in the response.

### Instance Types

Instances can be of different types depending on the product, but only mobile devices are currently surfaced:
- **Mobile devices:** Include `imei` field
- **Other tracked products:** Instance data is not currently returned in receipts

---

## Item-to-Receipt Navigation (the `receipt` backlink)

Every receipt item carries a `receipt` member naming the receipt that **owns** that item — the receipt whose `items` array the line belongs to. It is read-only and **non-essential**: request it explicitly with `~with(receipt)`, or navigate through it in a path. Default item payloads do not include it.

```bash
# Expand the owning receipt on each line
GET /v1/receipts/receiptID=MPK00000000002/items~with(receipt)

# Or navigate straight through it
GET /v1/receipts/receiptID=MPK00000000002/items~first/receipt/timestamp
```

For a receipt's own `items`, the owner is simply the receipt you navigated from — the backlink is a convenience there, useful when a query starts at item level and needs receipt-level context (timestamp, POS terminal, cashier) without a second request.

This is the only item → owning-document navigation in the API.

### Owner semantics across `related`

Receipt items also expose `related`: the lines on **other** receipts that concern the same product instance — the same physical unit sold, returned, corrected, or re-sold. `related` recurses (a related line has its own `related`).

`receipt` always names the receipt owning the item it is read from, at **any** recursion depth:

| Item reached via | `receipt` resolves to |
|------------------|-----------------------|
| `…/items` | The receipt you navigated from |
| `…/items/related` (at any depth) | The receipt whose `items` contain *that related line* — not the receipt you started from |
| a related line recorded outside any receipt | `null` |

The last row covers lines that were never rung up on a POS — for example, a sale imported directly from an ERP. Treat `receipt` as nullable whenever you walk `related`.

> **Behaviour change.** Earlier releases returned the receipt you navigated *from* for items reached through `related`, which made the member useless for crossing between documents. It now names the owning receipt. Exports that consumed the old (self-referential) value need re-checking.

### Recipe: from a return line to the sale receipt that owns it

This is the case the backlink exists for. When a product instance appears on more than one sale receipt — a mis-ring that was corrected, a unit that was returned and re-sold — a POS-return export has to name *which* sale is being reversed. Starting from the return receipt, one request answers it:

```bash
GET /v1/receipts/receiptID={return}/items~first/related~where(type=Sale,unitAmount!=0)~first/receipt/identifiers/receiptID
```

That yields the id of the **sale** receipt owning the matched line — not the return receipt you started from.

The property that makes this correct is **consistency**: the owning receipt and the matched line come from the *same* related pick.

```bash
# …~first/receipt/…      → the owning sale receipt
GET /v1/receipts/receiptID={return}/items~first/related~where(type=Sale,unitAmount!=0)~first/receipt/identifiers/receiptID

# …~first/identifiers/…  → the matched line, on that same receipt
GET /v1/receipts/receiptID={return}/items~first/related~where(type=Sale,unitAmount!=0)~first/identifiers/key
```

Both refer to the same line. Two *independent* picks — "earliest related receipt" plus "first non-zero related item", say — carry no such guarantee and start disagreeing as soon as a product instance has more than one sale in its history.

### Where the backlink works

- **Plain GETs** — as a path segment (`…/items~first/receipt/…`) or expanded with `~with(receipt)`.
- **Mapped types and sync-webhook mapping bodies** — a mapping that navigates `receipt` has the relation inlined for it automatically; no `~with` needed in the mapping's source query.
- **`~where` selector predicates over the path** on the receipts collection:

  ```bash
  GET /v1/receipts~where(type=Return,items~first/related~where(type=Sale,unitAmount!=0)~first/receipt/identifiers/receiptID=MPK00000000002)
  ```

- **Read-only receipt access** (clients limited to the `retail:read` scope) — items exposed there carry `receipt` as well. Earlier releases omitted the member entirely from the read-only variant.

---

## Item-to-Order Navigation (the `orderItems` member)

A receipt line records what was *rung up*; a trade order line records what was *ordered*. When a sale settles an order — click-and-collect, a webshop order handed over in store, a special order — the two are linked, and `orderItems` on a receipt item names the trade order items that line settles.

```bash
# Expand the related order lines on each receipt line
GET /v1/receipts/receiptID=MPK00000000002/items~with(orderItems)

# Or navigate straight through it
GET /v1/receipts/receiptID=MPK00000000002/items~first/orderItems~first/identifiers/key
```

It is a `trade order item[]`, **read-only**, and not included by default — request it with `~with(orderItems)`, or navigate through it in a path.

### Line level vs. receipt level

`orderItems` is the per-line counterpart of the receipt-level `orders` member:

| Member | Level | Answers |
|--------|-------|---------|
| `orders` on a receipt | Document | *Which trade orders does this receipt touch?* |
| `orderItems` on a receipt item | Line | *Which order lines does this particular line settle?* |

The receipt-level `orders` is effectively the union across every line, so it cannot tell you *which* line came from *which* order. That distinction matters on any receipt that mixes ordered and walk-in items, or that settles lines from more than one order — a common shape once click-and-collect and in-store pickup are in play. Reach for `orderItems` whenever the attribution has to be per line.

### Cardinality and empty results

`orderItems` is always an array, and it is frequently **empty**:

| Receipt line | `orderItems` |
|--------------|--------------|
| An ordinary walk-in sale, no originating order | `[]` |
| A line settling one order line | One order item |
| A line correlated with more than one order line | Several order items |

An empty array is the normal case for pure POS traffic, not an error — treat it as such when building joins, and don't assume `orderItems~first` resolves.

The match is made on the correlation the platform records when a receipt line settles an order line. It is **not** inferred from product, quantity, or amount, so two lines for the same product on one receipt resolve independently, and a manually keyed line that happens to match an open order line is not falsely linked to it.

### Recipe: compare what was ordered with what was rung up

```bash
# The quantity on the order line behind the first receipt line
GET /v1/receipts/receiptID=MPK00000000002/items~first/orderItems~first/quantity

# The order line's own status — was the line fully settled by this sale?
GET /v1/receipts/receiptID=MPK00000000002/items~first/orderItems~first/status
```

Because both sides are reachable from the same line, the receipt figures (`quantity`, `unitAmount`, `totalAmount`) and the order line's figures always refer to the same product line — no re-matching by product code on the consumer side, and no ambiguity when the same product appears twice on one receipt.

### Where the member works

- **Plain GETs** — as a path segment (`…/items~first/orderItems/…`) or expanded with `~with(orderItems)`.
- **Mapped types and sync-webhook mapping bodies** — a mapping that navigates `orderItems` has the relation inlined for it automatically; no `~with` needed in the mapping's source query.
- **`~where` selector predicates over the path** on the receipts collection — the same shape that works for the `receipt` backlink:

  ```bash
  # Receipts whose first line settles a known order line
  GET /v1/receipts~where(items~first/orderItems~first/identifiers/key=<order-item-key>)
  ```

Combine it with the [`receipt` backlink](#item-to-receipt-navigation-the-receipt-backlink) to cross in both directions: from a return line to the sale line it reverses, and from that sale line to the order it originally settled.

---

## Finder and Relative Access

The receipts collection provides utility endpoints for time-based queries.

### Before/After Timestamps

```bash
# Receipts created before a specific time
GET /v1/receipts/before/2025-02-13T00:00:00.000Z

# Receipts created after a specific time
GET /v1/receipts/after/2025-02-13T00:00:00.000Z
```

These return receipt collections that can be further filtered and paginated:

```bash
# Receipts after a timestamp, ordered and paginated
GET /v1/receipts/after/2025-02-13T00:00:00.000Z~take(100)
```

> **`/before/` and `/after/` are the recommended way to read receipts (and several other collections) by timestamp** — they are index-backed and stable across pagination, where `~where(timestamp...)` falls back to a predicate scan. The same pattern accepts an optional `(create)` or `(modify)` mode qualifier and is supported on trade orders, payment orders, stock adjustments, z-reports, and more — see [Operators → Time-relative queries](operators.md#time-relative-queries-before-and-after) for the full list.

### Receipt Finder

> **Note:** `POST /v1/receipts/@find` is currently unsupported. Use `/v1/receipts/after/{timestamp}` or `~where(timestamp>...)` instead.

For timestamp-based filtering, use the before/after endpoints shown above, or the `~where` operator:

```bash
# Using the after endpoint (recommended for incremental sync)
GET /v1/receipts/after/2025-02-13T00:00:00.000Z~take(100)

# Using the where operator
GET /v1/receipts~where(timestamp>2025-02-13T00:00:00.000Z)~orderBy(timestamp)~take(100)
```

---

## Example: Complete BI Export Query

```bash
# Step 1: Get receipts for a date range with all fields
GET /v1/receipts/after/2025-02-01T00:00:00.000Z~take(500)~withAll

# Step 2: For each receipt, extract:
# - identifiers.key (primary key)
# - identifiers.receiptID (display key)
# - timestamp (partition key)
# - seller.identifiers (store ID)
# - buyer.identifiers (customer ID, if known)
# - totalAmount, totalTaxAmount, totalDiscountAmount
# - vatGroups[] (for tax reporting)
# - payments[] (for payment method analysis)
# - items[].discounts[] (for discount analysis)
# - items[].instances[] (for serial/IMEI tracking)
```

### Streaming Large Exports

For large exports, use NDJSON format for streaming:

```bash
# Stream receipts as newline-delimited JSON
curl -H "Accept: application/x-ndjson" \
  "https://your-tenant.api/v1/receipts~orderBy(timestamp)~take(10000)"
```

Or use CSV for tabular export:

```bash
# Export as CSV (flattened structure)
curl -H "Accept: text/csv" \
  "https://your-tenant.api/v1/receipts~just(identifiers,timestamp,totalAmount,currencyCode)~take(10000)"
```

---

## Related Documentation

- [Operators Reference](operators.md) - Query operators and pagination patterns
- [Operators Catalog](operators-catalog.md) - Complete operator reference
- [Resource Patterns](resource-patterns.md) - POS and receipt resource patterns
- [Common Gotchas](common-gotchas.md) - Avoid common mistakes
