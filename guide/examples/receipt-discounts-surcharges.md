# Receipt Discounts & Surcharges — Extraction Guide

How to extract discount and surcharge data from receipts using field expansion. Covers per-item breakdowns, rule references, reason codes, and integration patterns for ERP/accounting systems.

**Base URL:** `http://localhost:5000/api/v1`
**API Key:** `banana` (passed via Basic Auth with empty username: `-u ":banana"`)

> **See also:** [Receipts Reference](../../reference/receipts.md) | [Discount Rules](./discount-rules.md) | [Surcharge Rules](./surcharge-rules.md) | [Operators Reference](../../reference/operators.md)

---

## Table of Contents

1. [Data Model](#data-model)
2. [Receipt Summary Fields](#receipt-summary-fields)
3. [Expanding Items — Per-Line Totals](#expanding-items--per-line-totals)
4. [Expanding Discount Breakdown — Per-Rule Detail](#expanding-discount-breakdown--per-rule-detail)
5. [Deep Expansion — Full Rule Details](#deep-expansion--full-rule-details)
6. [Expanding Surcharges](#expanding-surcharges)
7. [Receipt-Level Surcharges](#receipt-level-surcharges)
8. [Combining Expansions](#combining-expansions)
9. [Filtering and Projecting](#filtering-and-projecting)
10. [Manual vs Automatic Discounts](#manual-vs-automatic-discounts)
11. [Integration Pattern — Accounting Export](#integration-pattern--accounting-export)
12. [Expansion Operator Reference](#expansion-operator-reference)
13. [Pitfalls and Gotchas](#pitfalls-and-gotchas)

---

## Data Model

Receipts store discount and surcharge data at two levels: **receipt-level totals** and **per-item breakdowns**. Understanding this structure is essential for correct extraction.

```
receipt
├── totalDiscountAmount          ← total discount across all items (excl VAT)
├── totalDiscountAmountInclVat   ← same, incl VAT
├── totalDiscountAmountExclVat   ← same, excl VAT
├── surcharges[]                 ← receipt-level surcharges (delivery, service fees)
│   └── receipt item surcharge
│       ├── reason    { identifiers, name }            ← always inline
│       ├── amountInclVat, amountExclVat, vatAmount
│       ├── count
│       └── rule?     { identifiers, name, ... }       ← reference, expandable
└── items[]
    ├── discountAmount           ← total discount on this line (excl VAT)
    ├── discountAmountInclVat
    ├── discountAmountExclVat
    ├── discountPercentage
    ├── surchargeAmount          ← total surcharge on this line (excl VAT)
    ├── surchargeAmountInclVat
    ├── surchargeAmountExclVat
    ├── totalAmountInclVatExclSurcharges
    ├── vatAmountExclSurcharges
    ├── discounts[]              ← per-rule discount breakdown
    │   └── receipt item discount
    │       ├── reason  { identifiers, name, active }  ← always inline
    │       ├── amount, amountInclVat, amountExclVat
    │       ├── notes   (string[])
    │       ├── manual  (boolean)
    │       └── rule?   { identifiers, name, ... }     ← reference, expandable
    └── surcharges[]             ← per-rule surcharge breakdown
        └── receipt item surcharge
            ├── reason  { identifiers, name }           ← always inline
            ├── amountInclVat, amountExclVat, vatAmount
            ├── count
            └── rule?   { identifiers, name, ... }      ← reference, expandable
```

**Two levels of detail:**

- **Summary fields** (`discountAmount`, `surchargeAmount`) — a single number, the total across all applied rules. Available on each item without expanding `discounts[]` or `surcharges[]`.
- **Breakdown arrays** (`discounts[]`, `surcharges[]`) — per-rule detail showing which specific rule or manual action produced each discount/surcharge. Requires `~with(discounts)` or `~with(surcharges)` expansion.

---

## Receipt Summary Fields

Get discount and surcharge totals without expanding per-item detail.

```bash
# Get receipt with default fields (includes summary amounts)
curl -u ":banana" "localhost:5000/api/v1/receipts/{key}"
```

```bash
# Get just discount-related totals
curl -u ":banana" \
  "localhost:5000/api/v1/receipts/{key}~just(identifiers,totalAmount,totalDiscountAmount,totalDiscountAmountInclVat)"
```

Response:

```json
{
  "@type": "receipt",
  "identifiers": { "key": "6b401deb013d7b07ba8139933e7c9395", "receiptID": "MPK00000000002" },
  "totalAmount": "925.00",
  "totalDiscountAmount": "75.00",
  "totalDiscountAmountInclVat": "93.75"
}
```

`totalDiscountAmount` is the aggregate across all items — a single number, not per-item detail.

---

## Expanding Items — Per-Line Totals

Expand items to see per-line discount and surcharge summary amounts.

```bash
# Expand items to see per-line discount amounts
curl -u ":banana" "localhost:5000/api/v1/receipts/{key}~with(items)"
```

Response (items excerpt):

```json
{
  "items": [
    {
      "description": "T-Shirt Summer Collection",
      "quantity": "2",
      "salesAmount": "500.00",
      "discountAmount": "50.00",
      "discountAmountInclVat": "62.50",
      "discountAmountExclVat": "50.00",
      "discountPercentage": "10",
      "surchargeAmount": "0.00",
      "surchargeAmountInclVat": "0.00",
      "surchargeAmountExclVat": "0.00",
      "totalAmount": "500.00",
      "totalAmountInclVatExclSurcharges": "500.00"
    },
    {
      "description": "Soda 33cl",
      "quantity": "3",
      "salesAmount": "45.00",
      "discountAmount": "0.00",
      "surchargeAmount": "2.68",
      "surchargeAmountInclVat": "3.00",
      "surchargeAmountExclVat": "2.68"
    }
  ]
}
```

This is what most integrations need for line-level totals. Each item has summary fields for discounts and surcharges without the per-rule breakdown.

---

## Expanding Discount Breakdown — Per-Rule Detail

Get the full per-rule discount breakdown for each item.

```bash
# Expand items with their discount breakdown
curl -u ":banana" "localhost:5000/api/v1/receipts/{key}~with(items~with(discounts))"
```

Each item's `discounts[]` array contains individual discount entries:

```json
{
  "items": [
    {
      "description": "T-Shirt Summer Collection",
      "discountAmount": "50.00",
      "discounts": [
        {
          "reason": {
            "identifiers": { "com.example.id": "campaign-summer" },
            "name": "Summer Campaign",
            "active": true
          },
          "amount": "25.00",
          "amountInclVat": "31.25",
          "amountExclVat": "25.00",
          "notes": [],
          "manual": false,
          "rule": {
            "identifiers": { "com.example.id": "summer-promo-20pct" },
            "name": "Summer 20% off"
          }
        },
        {
          "reason": {
            "identifiers": { "com.example.id": "loyalty-gold" },
            "name": "Gold Member",
            "active": true
          },
          "amount": "25.00",
          "amountInclVat": "31.25",
          "amountExclVat": "25.00",
          "notes": [],
          "manual": false,
          "rule": {
            "identifiers": { "com.example.id": "gold-member-5pct" },
            "name": "Gold Member 5%"
          }
        }
      ]
    }
  ]
}
```

### Receipt Item Discount Fields

| Field | Type | Description |
|-------|------|-------------|
| `reason` | object | Discount reason — always embedded inline. Has `identifiers`, `name`, `active`. |
| `amount` | decimal | Discount amount (excl VAT) |
| `amountInclVat` | decimal | Discount amount including VAT |
| `amountExclVat` | decimal | Discount amount excluding VAT |
| `notes` | string[] | Free-text notes added by cashier (for manual discounts) |
| `manual` | boolean | `true` = cashier-applied manual discount; `false` = automatic from a rule |
| `rule` | object? | Reference to the discount rule. Present for automatic discounts, absent/null for manual. |

**The `manual` field:**
- `manual: false` → automatic discount from a rule. `rule` references the specific discount rule.
- `manual: true` → cashier-applied manual discount. `rule` will be absent or null. `notes` may contain the cashier's reason.

---

## Deep Expansion — Full Rule Details

Expand the `rule` reference on each discount entry to get the complete discount rule object.

```bash
# Triple-nested: receipt → items → discounts → rule details
curl -u ":banana" \
  "localhost:5000/api/v1/receipts/{key}~with(items~with(discounts~with(rule)))"
```

With `rule` expanded, you get the full rule definition including phase, effects, and conditions:

```json
{
  "reason": {
    "identifiers": { "com.example.id": "campaign-summer" },
    "name": "Summer Campaign",
    "active": true
  },
  "amount": "25.00",
  "amountInclVat": "31.25",
  "amountExclVat": "25.00",
  "notes": [],
  "manual": false,
  "rule": {
    "@type": "discount rule",
    "identifiers": { "com.example.id": "summer-promo-20pct" },
    "name": "Summer 20% off",
    "includesTax": false,
    "phase": {
      "identifiers": { "com.example.id": "promotions" },
      "name": "Promotions",
      "priority": 400
    },
    "effects": [
      {
        "@type": "percentage discount rule effect",
        "items": ["product"],
        "percentage": "20",
        "multiplicity": "PerUnit",
        "targeting": "All"
      }
    ]
  }
}
```

### Expanded Discount Rule Fields

| Field | Type | Description |
|-------|------|-------------|
| `@type` | string | Always `"discount rule"` |
| `identifiers` | object | Rule identifiers |
| `name` | string | Rule name |
| `includesTax` | boolean | Whether discount applies to tax-inclusive (`true`) or pre-tax (`false`) prices |
| `reason` | object? | Discount reason reference |
| `phase` | object? | Discount phase with `identifiers`, `name`, `priority` — determines evaluation order |
| `effects` | array | Discount effects — how the discount is calculated |
| `seller` / `buyer` | object? | Scope conditions for the rule |
| `currency` | object? | Currency restriction |
| `items` | object | Item group definitions |
| `time` | object? | Validity window |

---

## Expanding Surcharges

Same expansion pattern applies to surcharges on items.

```bash
# Per-item surcharge breakdown
curl -u ":banana" "localhost:5000/api/v1/receipts/{key}~with(items~with(surcharges))"

# With full surcharge rule expanded
curl -u ":banana" \
  "localhost:5000/api/v1/receipts/{key}~with(items~with(surcharges~with(rule)))"
```

Response with pant (bottle deposit) surcharge example:

```json
{
  "items": [
    {
      "description": "Soda 33cl",
      "quantity": "3",
      "surchargeAmount": "2.68",
      "surcharges": [
        {
          "reason": {
            "identifiers": { "com.example.id": "pant" },
            "name": "Pant"
          },
          "amountExclVat": "0.89",
          "amountInclVat": "1.00",
          "vatAmount": "0.11",
          "count": "1",
          "rule": {
            "@type": "surcharge rule",
            "identifiers": { "com.example.id": "pant-1kr" },
            "name": "Pant 1kr",
            "effects": [
              {
                "@type": "fixed surcharge rule effect",
                "items": ["thing"],
                "amount": "0.892857"
              }
            ]
          }
        }
      ]
    }
  ]
}
```

### Receipt Item Surcharge Fields

| Field | Type | Description |
|-------|------|-------------|
| `reason` | object | Surcharge reason — always embedded inline. Has `identifiers`, `name`. |
| `amountInclVat` | decimal | Surcharge amount including VAT |
| `amountExclVat` | decimal | Surcharge amount excluding VAT |
| `vatAmount` | decimal | VAT portion of the surcharge |
| `count` | decimal | Number of times the surcharge rule was applied (typically equals item quantity for per-unit surcharges) |
| `rule` | object? | Reference to the surcharge rule. Expandable with `~with(rule)`. |

---

## Receipt-Level Surcharges

Receipt-level surcharges apply to the receipt as a whole — delivery fees, service charges, etc. These are a **separate array** from item-level surcharges.

```bash
# Get receipt-level surcharges
curl -u ":banana" "localhost:5000/api/v1/receipts/{key}~with(surcharges)"
```

```json
{
  "surcharges": [
    {
      "reason": {
        "identifiers": { "com.example.id": "delivery" },
        "name": "Home Delivery"
      },
      "amountExclVat": "39.20",
      "amountInclVat": "49.00",
      "vatAmount": "9.80",
      "count": "1",
      "rule": {
        "identifiers": { "com.example.id": "delivery-standard" },
        "name": "Standard Delivery"
      }
    }
  ]
}
```

**Receipt `surcharges[]` vs `items[n].surcharges[]`:**

| Level | Array | Typical use |
|-------|-------|-------------|
| Receipt-level | `receipt.surcharges[]` | Delivery fees, service charges, order-level fees |
| Item-level | `receipt.items[n].surcharges[]` | Pant/deposit, environmental fees, per-product fees |

Both arrays contain `receipt item surcharge` entries with the same structure.

---

## Combining Expansions

Expand multiple fields at once using comma-separated names inside `~with()`.

```bash
# Full discount + surcharge detail in one query
curl -u ":banana" \
  "localhost:5000/api/v1/receipts/{key}~with(items~with(discounts,surcharges),surcharges)"
```

This expands:
- `items` — with nested `discounts` and `surcharges` on each item
- `surcharges` — receipt-level surcharges

To also expand the `rule` reference on every discount and surcharge:

```bash
# With rule expansion on both discounts and surcharges at both levels
curl -u ":banana" \
  "localhost:5000/api/v1/receipts/{key}~with(items~with(discounts~with(rule),surcharges~with(rule)),surcharges~with(rule))"
```

`~with()` accepts comma-separated fields at each nesting level: `~with(discounts,surcharges)` expands both arrays on each item.

---

## Filtering and Projecting

Common query patterns for integrations.

```bash
# Get all receipts from today with discount totals
curl -u ":banana" \
  "localhost:5000/api/v1/receipts/after/2026-03-25T00:00:00.000Z~just(identifiers,timestamp,totalAmount,totalDiscountAmount,totalDiscountAmountInclVat)"

# Get first 100 receipts with items and discounts
curl -u ":banana" \
  "localhost:5000/api/v1/receipts~with(items~with(discounts))~take(100)"

# Get a single receipt with full expansion
curl -u ":banana" "localhost:5000/api/v1/receipts/{key}~withAll"
```

### Expansion Operators Compared

| Operator | Behavior |
|----------|----------|
| `~with(field)` | Add specific non-essential fields to the default response |
| `~withAll` | Expand all expandable fields (can produce large payloads) |
| `~just(a,b)` | Return ONLY the listed fields — nothing else |
| `~without(a)` | Exclude specific fields from the default response |
| `?fields=a,b` | Query parameter equivalent of `~just(a,b)` |
| `?fields=all` | Query parameter equivalent of `~withAll` |

---

## Manual vs Automatic Discounts

Receipts can contain both automatic (rule-based) and manual (cashier-applied) discounts on the same item.

```bash
curl -u ":banana" \
  "localhost:5000/api/v1/receipts/{key}~with(items~with(discounts))"
```

```json
{
  "items": [
    {
      "description": "Wireless Headphones",
      "discountAmount": "30.00",
      "discounts": [
        {
          "reason": { "name": "Summer Campaign" },
          "amount": "20.00",
          "amountInclVat": "25.00",
          "amountExclVat": "20.00",
          "notes": [],
          "manual": false,
          "rule": { "name": "Summer 20% off" }
        },
        {
          "reason": { "name": "Manager Override" },
          "amount": "10.00",
          "amountInclVat": "12.50",
          "amountExclVat": "10.00",
          "notes": ["Customer complaint - goodwill discount"],
          "manual": true,
          "rule": null
        }
      ]
    }
  ]
}
```

**How to distinguish:**

| `manual` | `rule` | Meaning |
|----------|--------|---------|
| `false` | present | Automatic discount from a configured discount rule |
| `true` | absent/null | Cashier-applied manual discount |

- **`notes`** may contain free-text notes added by the cashier when applying manual discounts
- Multiple discounts can stack on a single item — both automatic and manual
- The item's `discountAmount` is the total across all discount entries

---

## Integration Pattern — Accounting Export

A complete walkthrough for exporting receipt data to an accounting system that needs per-line discount breakdowns with reason codes.

### Step 1: Query receipts for a date range

```bash
curl -u ":banana" \
  "localhost:5000/api/v1/receipts/after/{startDate}~with(items~with(discounts,surcharges))~take(1000)"
```

### Step 2: Extract per-item amounts

For each item in the receipt:

| Field | Meaning |
|-------|---------|
| `salesAmount` | Price before discounts/surcharges |
| `discountAmount` | Total discount (excl VAT) |
| `surchargeAmount` | Total surcharge (excl VAT) |
| `totalAmount` | Final amount after everything |
| `discounts[]` | Breakdown by reason/rule |
| `surcharges[]` | Breakdown by reason/rule |

### Step 3: Map to accounting categories

- Group discounts by `reason.name` for reporting
- Use `rule.identifiers` to match against ERP discount codes
- Use the `manual` flag to separate manual overrides from system-applied discounts

```
For each receipt:
  For each item:
    base_amount      = item.salesAmount
    discount_total   = item.discountAmount
    surcharge_total  = item.surchargeAmount
    net_amount       = item.totalAmount

    For each discount in item.discounts:
      erp_code     = discount.rule?.identifiers["com.example.erpCode"]
      reason_name  = discount.reason.name
      is_manual    = discount.manual
      amount       = discount.amount
```

### Step 4: Handle receipt-level surcharges separately

Don't forget receipt-level surcharges (delivery, service fees). These are in `receipt.surcharges[]`, not on any item.

---

## Expansion Operator Reference

Quick reference for field expansion operators used with receipts.

| Operator | Meaning | Example |
|----------|---------|---------|
| `~with(field)` | Expand a collapsed field | `~with(items)` |
| `~with(a,b)` | Expand multiple fields | `~with(items,surcharges)` |
| `~with(a~with(b))` | Nested expansion | `~with(items~with(discounts))` |
| `~with(a~with(b~with(c)))` | Deep nesting | `~with(items~with(discounts~with(rule)))` |
| `~with(a~with(b,c))` | Multiple nested | `~with(items~with(discounts,surcharges))` |
| `~withAll` | Expand all expandable fields | `receipts/{key}~withAll` |
| `~just(a,b)` | Return ONLY these fields | `~just(identifiers,totalAmount)` |
| `~without(a)` | Exclude specific fields | `~without(items)` |
| `?fields=a,b` | Query param equivalent of `~just` | `?fields=identifiers,totalAmount` |
| `?fields=all` | Query param equivalent of `~withAll` | `?fields=all` |

---

## Pitfalls and Gotchas

### Direct item subpaths don't work for discounts

You **cannot** access discounts via a direct path:

```bash
# ✗ This does NOT work
curl -u ":banana" "localhost:5000/api/v1/receipts/{id}/items/0/discounts"
```

Instead, expand items inline and read discounts from the response:

```bash
# ✓ Correct approach
curl -u ":banana" "localhost:5000/api/v1/receipts/{id}~with(items~with(discounts))"
```

### `reason` is inline, `rule` is a reference

The discount `reason` (name, active flag) is **always embedded** in the response — you don't need `~with()` for it. The discount `rule` is a **reference** — you see basic fields (identifiers, name) by default, and need `~with(rule)` for the full rule details including effects, phase, and conditions.

### `discountAmount` vs `discounts[].amount`

The `discountAmount` on a receipt item is the **total** discount across all applied rules. Each `discounts[].amount` is the discount from **one specific** rule or manual discount. They won't match when multiple discounts are applied:

```json
{
  "discountAmount": "45.00",
  "discounts": [
    { "reason": { "name": "Promo" }, "amount": "30.00" },
    { "reason": { "name": "Staff" }, "amount": "15.00" }
  ]
}
```

### Surcharges don't have `manual` or `notes`

Unlike discounts, surcharges are always automatic — they're applied by surcharge rules. There is no manual surcharge mechanism, so surcharge entries have no `manual` or `notes` fields.

### `~withAll` can be expensive

For receipts with many items, expanding everything returns very large payloads. Use `~with()` with specific fields for production integrations.

### Surcharges have `count`, discounts don't

The `count` on a surcharge reflects how many times the surcharge rule was applied (typically equals item quantity for per-unit surcharges like pant). Discounts don't have an equivalent count field.

### Receipt-level vs item-level surcharges

`receipt.surcharges[]` and `receipt.items[n].surcharges[]` are different arrays. Receipt-level surcharges (delivery fees) are not duplicated inside item surcharges, and vice versa. Make sure you account for both when calculating totals.
