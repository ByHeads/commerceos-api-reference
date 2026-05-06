# Surcharge Rules Examples

Curl examples for surcharge rules, surcharge reasons, and how surcharges appear on receipts. Surcharge rules are the mirror image of discount rules — where discounts reduce prices, surcharges add automatic fees like bottle deposits ("pant"), environmental charges, bag handling fees, and tariffs.

**Base URL:** `https://example.app.heads.com/api/v1`
**API Key:** `banana` (passed via Basic Auth with empty username: `-u ":banana"`)

> **See also:** [Examples Index](../examples.md) | [Discount Rules](./discount-rules.md) | [Orders & Fulfillment](./orders.md) | [Point of Sale](./pos.md) | [Reference Documentation](../../reference/)

---

## Surcharge Rule Anatomy

A surcharge rule extends `trade rule` (the same base type as discount rules and price rules). Key properties:

| Property | Purpose |
|----------|---------|
| `seller` / `buyer` | Scope the rule to specific sellers or buyer groups. Use `include`/`exclude` arrays with identifier references. |
| `currency` | Restrict to specific currencies (e.g., `{"currencyCode": "SEK"}`). |
| `time` | Optional validity window with `start` and `end` dates (ISO format). |
| `items` | A **named map** of item groups. Each key defines a group with `include`/`exclude` arrays and optional `atLeast`/`atMost` quantity constraints. |
| `effects` | Array of effect objects. Each effect must include `@type` and which items it targets. |
| `effects[].@type` | Effect type: `"fixed surcharge rule effect"` (flat amount) or `"percentage surcharge rule effect"` (percentage of item value). |
| `effects[].items` | **Must reference keys from the `items` map** (e.g., `["thing"]`). |
| `reason` | A reference to a `surcharge reason` explaining the fee (shown on receipts). |

**Key differences from discount rules:**
- No `phase` — surcharge rules have no priority ordering. All matching rules are applied (additive).
- No `includesTax` — the `amount` on fixed effects is **always excluding VAT**.
- No `multiplicity` or `targeting` — surcharges apply per unit to all matching items.
- No manual surcharges — surcharges are always automatic. There is no equivalent of `manualDiscount`.

---

## Section 1: Surcharge Reasons — CRUD

Surcharge reasons explain **why** a fee is applied. They appear on receipts and are shared across multiple surcharge rules (e.g., one "Pant" reason is used by all pant tier rules).

### Create a surcharge reason

```bash
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/surcharge-reasons" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "surcharge reason",
    "identifiers": { "com.example.surchargeReasonId": "pant" },
    "name": "Pant"
  }'
```

### More surcharge reason examples

```bash
# Environmental Fee
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/surcharge-reasons" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "surcharge reason",
    "identifiers": { "com.example.surchargeReasonId": "environmental-fee" },
    "name": "Environmental Fee"
  }'

# Bag Handling Fee
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/surcharge-reasons" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "surcharge reason",
    "identifiers": { "com.example.surchargeReasonId": "bag-handling-fee" },
    "name": "Bag Handling Fee"
  }'

# Service Charge
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/surcharge-reasons" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "surcharge reason",
    "identifiers": { "com.example.surchargeReasonId": "service-charge" },
    "name": "Service Charge"
  }'

# Tariff
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/surcharge-reasons" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "surcharge reason",
    "identifiers": { "com.example.surchargeReasonId": "tariff" },
    "name": "Tariff"
  }'
```

### List all surcharge reasons

```bash
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/surcharge-reasons"
```

### Get a specific surcharge reason

```bash
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/surcharge-reasons/com.example.surchargeReasonId=pant"
```

### Rename a surcharge reason

```bash
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/surcharge-reasons/com.example.surchargeReasonId=pant" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Bottle & Can Deposit (Pant)"
  }'
```

---

## Section 2: Fixed Surcharge Rules — Pant (Bottle Deposits)

This is the primary use case for surcharge rules. Swedish "pant" adds a fixed deposit fee to beverages at checkout — 1 SEK for cans, 2 SEK for PET bottles, etc.

### Create a pant surcharge rule (1 SEK deposit)

```bash
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/surcharge-rules" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "surcharge rule",
    "identifiers": { "com.example.surchargeRuleId": "pant-1kr" },
    "name": "Pant 1kr",
    "currency": {
      "include": [{ "identifiers": { "currencyCode": "SEK" } }]
    },
    "items": {
      "thing": {
        "@type": "product condition",
        "include": [
          { "@type": "product category", "identifiers": { "com.example.categoryId": "beverages-with-deposit" } }
        ],
        "exclude": []
      }
    },
    "effects": [
      {
        "@type": "fixed surcharge rule effect",
        "items": ["thing"],
        "amount": "0.892857"
      }
    ],
    "reason": {
      "identifiers": { "com.example.surchargeReasonId": "pant" }
    }
  }'
```

> **CRITICAL: The `amount` is always excluding VAT.**
>
> This is the most common integration mistake. The `amount` field on `fixed surcharge rule effect` is the surcharge amount **before VAT**. For a consumer-facing 1 SEK pant deposit at 12% VAT, the excl-VAT amount is:
>
> ```
> 1 SEK / 1.12 = 0.892857 SEK (excl VAT)
> ```
>
> The system adds VAT on top to arrive at the consumer-facing price.

### Swedish Pant Deposit Reference Table

These are the exact values used in production. All assume 12% VAT (standard Swedish food/beverage rate):

| Consumer-facing deposit | VAT rate | `amount` value (excl VAT) |
|---|---|---|
| 1 SEK | 12% | `0.892857` |
| 2 SEK | 12% | `1.785714` |
| 3 SEK | 12% | `2.678571` |
| 4 SEK | 12% | `3.571429` |
| 5 SEK | 12% | `4.464286` |
| 10 SEK | 12% | `8.928571` |
| 24 SEK | 12% | `21.428571` |

Formula: `amount = consumer_facing_price / (1 + vat_rate)`

### Get a surcharge rule

```bash
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/surcharge-rules/com.example.surchargeRuleId=pant-1kr"
```

### Update a surcharge rule

```bash
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/surcharge-rules/com.example.surchargeRuleId=pant-1kr" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Pant 1kr - Cans"
  }'
```

### Delete a surcharge rule

```bash
curl -X DELETE -u ":banana" "https://example.app.heads.com/api/v1/surcharge-rules/com.example.surchargeRuleId=pant-1kr"
```

---

## Section 3: Multiple Pant Tiers

A tiered pant system uses separate surcharge rules per tier, all sharing the same "Pant" reason. Each rule targets a different product category.

### Create all pant tiers at once

```bash
# Tier 1: Small cans (33cl) — 1 SEK deposit
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/surcharge-rules" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "surcharge rule",
    "identifiers": { "com.example.surchargeRuleId": "pant-1kr" },
    "name": "Pant 1kr",
    "currency": {
      "include": [{ "identifiers": { "currencyCode": "SEK" } }]
    },
    "items": {
      "thing": {
        "@type": "product condition",
        "include": [
          { "@type": "product category", "identifiers": { "com.example.categoryId": "pant-1kr-products" } }
        ],
        "exclude": []
      }
    },
    "effects": [
      {
        "@type": "fixed surcharge rule effect",
        "items": ["thing"],
        "amount": "0.892857"
      }
    ],
    "reason": {
      "identifiers": { "com.example.surchargeReasonId": "pant" }
    }
  }'

# Tier 2: Large bottles (PET 50cl–150cl) — 2 SEK deposit
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/surcharge-rules" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "surcharge rule",
    "identifiers": { "com.example.surchargeRuleId": "pant-2kr" },
    "name": "Pant 2kr",
    "currency": {
      "include": [{ "identifiers": { "currencyCode": "SEK" } }]
    },
    "items": {
      "thing": {
        "@type": "product condition",
        "include": [
          { "@type": "product category", "identifiers": { "com.example.categoryId": "pant-2kr-products" } }
        ],
        "exclude": []
      }
    },
    "effects": [
      {
        "@type": "fixed surcharge rule effect",
        "items": ["thing"],
        "amount": "1.785714"
      }
    ],
    "reason": {
      "identifiers": { "com.example.surchargeReasonId": "pant" }
    }
  }'

# Tier 3: Multi-packs / large containers — 4 SEK deposit
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/surcharge-rules" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "surcharge rule",
    "identifiers": { "com.example.surchargeRuleId": "pant-4kr" },
    "name": "Pant 4kr",
    "currency": {
      "include": [{ "identifiers": { "currencyCode": "SEK" } }]
    },
    "items": {
      "thing": {
        "@type": "product condition",
        "include": [
          { "@type": "product category", "identifiers": { "com.example.categoryId": "pant-4kr-products" } }
        ],
        "exclude": []
      }
    },
    "effects": [
      {
        "@type": "fixed surcharge rule effect",
        "items": ["thing"],
        "amount": "3.571429"
      }
    ],
    "reason": {
      "identifiers": { "com.example.surchargeReasonId": "pant" }
    }
  }'
```

**Key pattern:** All three rules share the same `reason` (Pant). Each targets a different product category. When a product moves from the "pant-1kr-products" category to "pant-2kr-products", the correct surcharge applies automatically — no rule changes needed.

---

## Section 4: Percentage Surcharge Rules

Percentage surcharges add a fee calculated as a percentage of the item's value. Use these for fees that should scale with price.

### Create a percentage-based environmental fee (5% on electronics)

```bash
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/surcharge-rules" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "surcharge rule",
    "identifiers": { "com.example.surchargeRuleId": "electronics-env-fee" },
    "name": "Environmental fee - Electronics",
    "items": {
      "product": {
        "@type": "product condition",
        "include": [
          { "@type": "product category", "identifiers": { "com.example.categoryId": "electronics" } }
        ],
        "exclude": [],
        "atLeast": 1
      }
    },
    "effects": [
      {
        "@type": "percentage surcharge rule effect",
        "items": ["product"],
        "percentage": "5"
      }
    ],
    "reason": {
      "identifiers": { "com.example.surchargeReasonId": "environmental-fee" }
    }
  }'
```

> **Note:** The `percentage` field on `percentage surcharge rule effect` is a straight percentage (e.g., `"5"` means 5%). Unlike fixed surcharges, there is no VAT calculation concern in the rule definition — the percentage is applied to the item's price, and VAT is calculated on the resulting surcharge amount.

---

## Section 5: Scoped Surcharge Rules

Like discount rules, surcharge rules can be scoped by seller, currency, time period, or any combination.

### Scoped by seller (store-specific surcharge)

A bag handling fee that only applies at a specific store:

```bash
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/surcharge-rules" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "surcharge rule",
    "identifiers": { "com.example.surchargeRuleId": "bag-fee-store-a" },
    "name": "Bag handling fee - Store A",
    "seller": {
      "include": [{ "identifiers": { "com.example.storeId": "store-a" } }]
    },
    "items": {
      "thing": {
        "@type": "product condition",
        "include": [
          { "@type": "product category", "identifiers": { "com.example.categoryId": "plastic-bags" } }
        ],
        "exclude": []
      }
    },
    "effects": [
      {
        "@type": "fixed surcharge rule effect",
        "items": ["thing"],
        "amount": "5.357143"
      }
    ],
    "reason": {
      "identifiers": { "com.example.surchargeReasonId": "bag-handling-fee" }
    }
  }'
```

### Scoped by currency

Pant amounts are currency-specific. If you operate in multiple currencies, create separate rules:

```bash
# SEK rule: 1 SEK pant at 12% VAT
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/surcharge-rules" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "surcharge rule",
    "identifiers": { "com.example.surchargeRuleId": "pant-1kr-sek" },
    "name": "Pant 1kr (SEK)",
    "currency": {
      "include": [{ "identifiers": { "currencyCode": "SEK" } }]
    },
    "items": {
      "thing": {
        "@type": "product condition",
        "include": [
          { "@type": "product category", "identifiers": { "com.example.categoryId": "pant-1kr-products" } }
        ],
        "exclude": []
      }
    },
    "effects": [
      {
        "@type": "fixed surcharge rule effect",
        "items": ["thing"],
        "amount": "0.892857"
      }
    ],
    "reason": {
      "identifiers": { "com.example.surchargeReasonId": "pant" }
    }
  }'

# NOK rule: 2 NOK deposit at 15% VAT (Norwegian equivalent)
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/surcharge-rules" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "surcharge rule",
    "identifiers": { "com.example.surchargeRuleId": "pant-2nok" },
    "name": "Pant 2kr (NOK)",
    "currency": {
      "include": [{ "identifiers": { "currencyCode": "NOK" } }]
    },
    "items": {
      "thing": {
        "@type": "product condition",
        "include": [
          { "@type": "product category", "identifiers": { "com.example.categoryId": "pant-1kr-products" } }
        ],
        "exclude": []
      }
    },
    "effects": [
      {
        "@type": "fixed surcharge rule effect",
        "items": ["thing"],
        "amount": "1.739130"
      }
    ],
    "reason": {
      "identifiers": { "com.example.surchargeReasonId": "pant" }
    }
  }'
```

### Scoped by time (seasonal surcharge)

A summer bag fee active only during a specific period:

```bash
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/surcharge-rules" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "surcharge rule",
    "identifiers": { "com.example.surchargeRuleId": "summer-bag-fee-2026" },
    "name": "Summer bag fee 2026",
    "time": {
      "start": "2026-06-01T00:00:00",
      "end": "2026-08-31T23:59:59"
    },
    "items": {
      "thing": {
        "@type": "product condition",
        "include": [
          { "@type": "product category", "identifiers": { "com.example.categoryId": "plastic-bags" } }
        ],
        "exclude": []
      }
    },
    "effects": [
      {
        "@type": "fixed surcharge rule effect",
        "items": ["thing"],
        "amount": "4.464286"
      }
    ],
    "reason": {
      "identifiers": { "com.example.surchargeReasonId": "bag-handling-fee" }
    }
  }'
```

### Combined scope (store + currency + time)

A tariff scoped to a specific store, in SEK, during a defined period:

```bash
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/surcharge-rules" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "surcharge rule",
    "identifiers": { "com.example.surchargeRuleId": "import-tariff-store-b-2026" },
    "name": "Import tariff - Store B (Q1 2026)",
    "seller": {
      "include": [{ "identifiers": { "com.example.storeId": "store-b" } }]
    },
    "currency": {
      "include": [{ "identifiers": { "currencyCode": "SEK" } }]
    },
    "time": {
      "start": "2026-01-01T00:00:00",
      "end": "2026-03-31T23:59:59"
    },
    "items": {
      "product": {
        "@type": "product condition",
        "include": [
          { "@type": "product category", "identifiers": { "com.example.categoryId": "imported-goods" } }
        ],
        "exclude": [],
        "atLeast": 1
      }
    },
    "effects": [
      {
        "@type": "percentage surcharge rule effect",
        "items": ["product"],
        "percentage": "3"
      }
    ],
    "reason": {
      "identifiers": { "com.example.surchargeReasonId": "tariff" }
    }
  }'
```

---

## Section 6: How Surcharges Appear on Receipts

When surcharge rules match items in a trade order, the computed surcharges appear on receipt items. This is what integrators read when processing receipt data.

### Receipt item with pant surcharge

A customer buys 2x Coca-Cola 33cl (1 SEK pant deposit each):

```json
{
  "@type": "receipt item",
  "description": "Coca-Cola 33cl",
  "product": { "@type": "product", "identifiers": { "sku": "COKE-33CL" } },
  "quantity": "2",
  "salesAmount": "19.84",
  "taxAmount": "4.96",
  "discountAmount": "0",
  "surchargeAmount": "1.79",
  "surchargeAmountInclVat": "2.00",
  "surchargeAmountExclVat": "1.79",
  "totalAmount": "26.80",
  "unitAmount": "9.92",
  "vatPercentage": "25",
  "surcharges": [
    {
      "reason": { "name": "Pant" },
      "amountExclVat": "1.79",
      "amountInclVat": "2.00",
      "vatAmount": "0.21",
      "count": "2",
      "rule": {
        "@type": "surcharge rule",
        "identifiers": { "com.example.surchargeRuleId": "pant-1kr" },
        "name": "Pant 1kr"
      }
    }
  ]
}
```

### Understanding receipt surcharge fields

| Field | Description |
|-------|-------------|
| `surchargeAmount` | Total surcharge on this line item across **all** matching surcharge rules (excl VAT). |
| `surchargeAmountInclVat` | Total surcharge including VAT. |
| `surchargeAmountExclVat` | Total surcharge excluding VAT (same as `surchargeAmount`). |
| `surcharges[]` | Breakdown by individual surcharge rule. |
| `surcharges[].reason` | The surcharge reason (e.g., "Pant"). |
| `surcharges[].amountExclVat` | This rule's surcharge amount excluding VAT. |
| `surcharges[].amountInclVat` | This rule's surcharge amount including VAT. |
| `surcharges[].vatAmount` | VAT portion of this rule's surcharge. |
| `surcharges[].count` | How many times the rule was applied. Equals quantity for per-unit surcharges (2 bottles = count 2). |
| `surcharges[].rule` | Reference to the surcharge rule that generated this surcharge. |

> **How `count` works:** For per-unit surcharges like pant, `count` equals the item quantity. If the customer buys 2 bottles with a 1 SEK pant deposit, `count` is `"2"` and `amountInclVat` is `"2.00"` (2 x 1 SEK).

---

## Section 7: Receipt-Level vs Item-Level Surcharges

Surcharges appear at two levels on a receipt:

### Item-level surcharges (`receipt.items[n].surcharges`)

Applied per product line. Each receipt item has its own `surcharges[]` array showing which surcharge rules applied to that specific product.

**Use case:** Pant on individual beverage lines, environmental fees on specific electronics.

### Receipt-level surcharges (`receipt.surcharges`)

Applied to the receipt as a whole, not tied to any specific product line.

**Use case:** Delivery charges, service fees, order-level handling fees.

```json
{
  "@type": "receipt",
  "identifiers": { "receiptID": "RCP-2026-00042" },
  "items": [
    {
      "description": "Coca-Cola 33cl",
      "quantity": "2",
      "surcharges": [
        {
          "reason": { "name": "Pant" },
          "amountInclVat": "2.00",
          "amountExclVat": "1.79",
          "vatAmount": "0.21",
          "count": "2"
        }
      ]
    },
    {
      "description": "Fanta Orange 50cl",
      "quantity": "1",
      "surcharges": [
        {
          "reason": { "name": "Pant" },
          "amountInclVat": "2.00",
          "amountExclVat": "1.79",
          "vatAmount": "0.21",
          "count": "1"
        }
      ]
    }
  ],
  "surcharges": [
    {
      "reason": { "name": "Service Charge" },
      "amountInclVat": "15.00",
      "amountExclVat": "12.00",
      "vatAmount": "3.00",
      "count": "1"
    }
  ]
}
```

Both levels use the `receipt item surcharge` type with the same fields. The difference is scope:
- **Item-level:** in `receipt.items[n].surcharges` — per product line
- **Receipt-level:** in `receipt.surcharges` — per receipt

---

## Section 8: Querying Surcharge Rules

### List all surcharge rules

```bash
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/surcharge-rules"
```

### Get a specific surcharge rule by identifier

```bash
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/surcharge-rules/com.example.surchargeRuleId=pant-1kr"
```

### Get specific fields only

```bash
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/surcharge-rules?fields=name,effects,reason"
```

### List all surcharge reasons

```bash
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/surcharge-reasons"
```

### List all surcharge rule effects

```bash
# All effect types
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/surcharge-rule-effects"

# Fixed effects only
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/fixed-surcharge-rule-effects"

# Percentage effects only
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/percentage-surcharge-rule-effects"
```

---

## Section 9: Surcharges vs Discounts — Comparison

| Aspect | Discount Rule | Surcharge Rule |
|---|---|---|
| Direction | Reduces price | Adds fee |
| Effect types | Percentage, Fixed reduction, Fixed price, Package | Percentage, Fixed amount |
| Has `phase` | Yes (priority ordering) | No |
| Has `reason` | Yes (`discount reason`) | Yes (`surcharge reason`) |
| Manual override | Yes (`manualDiscounts` on trade order items) | No manual surcharges |
| `includesTax` field | Yes (on discount rule) | No (amount is always excl VAT) |
| `multiplicity` / `targeting` | Yes (`PerUnit`/`PerApplication`, `All`/`LowestValue`/`HighestValue`) | No |
| Receipt field | `discountAmount`, `discounts[]` | `surchargeAmount`, `surcharges[]` |
| Common use cases | Campaigns, loyalty, volume tiers, staff discount | Pant/deposits, environmental fees, bag fees, tariffs |

---

## Section 10: Best Practices and Pitfalls

### Amount is always excl VAT

The most common integration mistake. If your consumer-facing deposit is 2 SEK and VAT is 12%, the `amount` must be `1.785714`, not `2`. Use the formula:

```
amount = consumer_facing_price / (1 + vat_rate)
```

### One reason, many rules

Use a single "Pant" surcharge reason shared across all pant tiers (1kr, 2kr, 4kr). Don't create separate reasons per tier — the reason describes *what* the fee is, not *how much*.

### Product categories drive matching

Assign products to pant categories (e.g., "Pant 1kr products", "Pant 2kr products") and create surcharge rules targeting those categories. When a product changes category, the correct surcharge applies automatically — no rule changes needed.

### No manual surcharges

Unlike discounts, surcharges cannot be manually applied at checkout. They are always automatic based on matching rules. If you need ad-hoc fees, model them as separate products (line items) on the order.

### No phase/priority system

Unlike discount rules, surcharge rules don't have a `phase` for priority ordering. All matching surcharge rules are applied additively. If two rules match the same item, both surcharges are added (they don't compete or override each other).

### Currency scoping is critical

Pant amounts are currency-specific. The excl-VAT amount for a "1 SEK" deposit is different from a "1 NOK" deposit because the VAT rates differ. Always create separate rules per currency with the correct excl-VAT amounts.

### Testing surcharge setup

After creating surcharge rules, verify the setup by creating a test trade order with matching products and checking the resulting receipt:

```bash
# Check that surcharges appear on the receipt
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/receipts/receiptID=RCP-TEST-001?fields=items.surcharges,surcharges"
```
