# Surcharge Rules Examples

Curl examples for surcharge rules, surcharge reasons, and how surcharges appear on receipts. Surcharge rules are the mirror image of discount rules — where discounts reduce prices, surcharges add automatic fees like bottle deposits ("pant"), environmental charges, bag handling fees, and tariffs.

**Base URL:** `https://example.app.heads.com/api/v1`
**API Key:** `banana` (passed via Basic Auth with empty username: `-u ":banana"`)

> **See also:** [Examples Index](../examples.md) | [Discount Rules](./discount-rules.md) | [Orders & Fulfillment](./orders.md) | [Point of Sale](./pos.md) | [Working with VAT](../../reference/working-with/vat.md) | [Reference Documentation](../../reference/)

---

## Surcharge Rule Anatomy

A surcharge rule carries its products, its currency and its value itself. Key properties:

| Property | Purpose |
|----------|---------|
| `products` | The product nodes the rule applies to: products, families, groups or product categories, each with `@type` and `identifiers`. **Replaces on set.** |
| `kind` | `"Fixed"` (a flat amount per unit) or `"Percentage"` (a share of the unit value). Default `Fixed` on create. |
| `amount` | For `Fixed`: the surcharge per unit. Net unless `includesTax` is `true`. |
| `includesTax` | For `Fixed`: `true` means `amount` is the surcharge as the customer sees it, VAT included; the net is derived from the line's own rate. Default `false`. |
| `percentage` | For `Percentage`: a straight percentage of the unit value, `0`–`100`. |
| `currency` | One currency reference, for a fixed amount (e.g. `{"identifiers": {"currencyCode": "SEK"}}`). |
| `worthAtLeast` / `worthAtMost` | Optional unit value bounds, excluding VAT: the rule applies only to units priced inside them. |
| `reason` | A reference to a `surcharge reason` explaining the fee (shown on receipts). |
| `seller` / `buyer` | Scope the rule to specific sellers or buyer groups. Use `include`/`exclude` arrays with identifier references. Non-essential. |
| `time` | Optional validity window with `start` and `end` dates (ISO format). Both bounds are optional; see [Update a surcharge rule](#update-a-surcharge-rule) for the merge and validation rules when changing one. Non-essential. |

A `Fixed` rule reads `kind`, `amount`, `includesTax`, `currency` (expanded) and `products` (an array), and no `percentage`; a `Percentage` rule reads `kind`, `percentage` and no `amount`.

**Key differences from discount rules:**
- No `phase` — surcharge rules have no priority ordering. All matching rules are applied (additive).
- No `multiplicity` or `targeting` — surcharges apply per unit to all matching items.
- No manual surcharges — surcharges are always automatic. There is no equivalent of `manualDiscount`.
- `includesTax` means the same thing on both: on a surcharge rule it says whether the fixed `amount` is gross.

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

### Create a pant surcharge rule (1 SEK deposit, as the customer sees it)

```bash
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/surcharge-rules" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "surcharge rule",
    "identifiers": { "com.example.surchargeRuleId": "pant-1kr" },
    "name": "Pant 1kr",
    "products": [
      { "@type": "product category", "identifiers": { "com.example.categoryId": "beverages-with-deposit" } }
    ],
    "currency": { "identifiers": { "currencyCode": "SEK" } },
    "kind": "Fixed",
    "amount": "1",
    "includesTax": true,
    "reason": {
      "identifiers": { "com.example.surchargeReasonId": "pant" }
    }
  }'
```

What it reads back:

```json
{
  "@type": "surcharge rule",
  "identifiers": { "key": "5d617830d19739b7139d08ed1c5f3c65", "com.example.surchargeRuleId": "pant-1kr" },
  "name": "Pant 1kr",
  "products": [ { "@type": "product category", "identifiers": { "com.example.categoryId": "beverages-with-deposit" }, "name": "Beverages with deposit" } ],
  "currency": { "@type": "currency", "identifiers": { "currencyCode": "SEK" } },
  "kind": "Fixed",
  "amount": "1",
  "includesTax": true,
  "reason": { "@type": "surcharge reason", "identifiers": { "com.example.surchargeReasonId": "pant" }, "name": "Pant", "active": true, "discountable": false }
}
```

> **`includesTax` decides which figure `amount` is.** With `"includesTax": true`, `amount` is the deposit the customer pays, and the net is derived from each line's own VAT rate: `1` on a 12 % line is `0.892857` excl. VAT, on a 25 % line `0.8`. With `includesTax` false or omitted, `amount` is the net surcharge and VAT is added on top. The two forms below both charge 1 kr on a 12 % beverage:
>
> ```json
> { "kind": "Fixed", "amount": "1",        "includesTax": true  }
> { "kind": "Fixed", "amount": "0.892857", "includesTax": false }
> ```
>
> Prefer the first: it is what the customer sees, it survives a rate change, and one rule serves lines at different rates.

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

**Changing the value.** `amount`, `includesTax`, `percentage` and `kind` are ordinary members: a `PATCH` with `{"amount": "2"}` changes the deposit, and `{"kind": "Percentage", "percentage": "2.5"}` turns the rule into a percentage rule.

**Moving a rule's validity window.** The `time` member is merged with what is stored, then the **resulting** window is validated. Send both bounds in one call and they are validated and applied together — so a seasonal rule can be moved to a period that starts after its current end in a single request:

```bash
# Summer 2026 fee (2026-06-01 → 2026-08-31) rescheduled to summer 2027
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/surcharge-rules/com.example.surchargeRuleId=summer-bag-fee-2026" \
  -H "Content-Type: application/json" \
  -d '{
    "time": {
      "start": "2027-06-01T00:00:00",
      "end": "2027-08-31T23:59:59"
    }
  }'
```

A bound you omit keeps its stored value; a bound sent as `null` is cleared (open-ended in that direction). A **single-bound** patch that inverts the window against the stored counterpart — pushing `start` past the stored `end` — is rejected with `400` and `The end date, if specified, must be greater than the start date.`, leaving the rule unchanged. See [Resource Patterns → Validity Window (`time`)](../../reference/resource-patterns.md#validity-window-time) for the full rules, which are shared with discount rules.

### Delete a surcharge rule

```bash
curl -X DELETE -u ":banana" "https://example.app.heads.com/api/v1/surcharge-rules/com.example.surchargeRuleId=pant-1kr"
```

---

## Section 3: Multiple Pant Tiers

A tiered pant system uses separate surcharge rules per tier, all sharing the same "Pant" reason. Each rule targets a different product category.

### Create all pant tiers at once

```bash
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/surcharge-rules" \
  -H "Content-Type: application/json" \
  -d '[
    {
      "@type": "surcharge rule",
      "identifiers": { "com.example.surchargeRuleId": "pant-1kr" },
      "name": "Pant 1kr",
      "products": [ { "@type": "product category", "identifiers": { "com.example.categoryId": "pant-1kr-products" } } ],
      "currency": { "identifiers": { "currencyCode": "SEK" } },
      "kind": "Fixed", "amount": "1", "includesTax": true,
      "reason": { "identifiers": { "com.example.surchargeReasonId": "pant" } }
    },
    {
      "@type": "surcharge rule",
      "identifiers": { "com.example.surchargeRuleId": "pant-2kr" },
      "name": "Pant 2kr",
      "products": [ { "@type": "product category", "identifiers": { "com.example.categoryId": "pant-2kr-products" } } ],
      "currency": { "identifiers": { "currencyCode": "SEK" } },
      "kind": "Fixed", "amount": "2", "includesTax": true,
      "reason": { "identifiers": { "com.example.surchargeReasonId": "pant" } }
    },
    {
      "@type": "surcharge rule",
      "identifiers": { "com.example.surchargeRuleId": "pant-4kr" },
      "name": "Pant 4kr",
      "products": [ { "@type": "product category", "identifiers": { "com.example.categoryId": "pant-4kr-products" } } ],
      "currency": { "identifiers": { "currencyCode": "SEK" } },
      "kind": "Fixed", "amount": "4", "includesTax": true,
      "reason": { "identifiers": { "com.example.surchargeReasonId": "pant" } }
    }
  ]'
```

**Key pattern:** All three rules share the same `reason` (Pant). Each targets a different product category. When a product moves from the "pant-1kr-products" category to "pant-2kr-products", the correct surcharge applies automatically — no rule changes needed.

---

## Section 4: Percentage Surcharge Rules

Percentage surcharges add a fee calculated as a percentage of the unit value. Use these for fees that should scale with price.

### Create a percentage-based environmental fee (5% on electronics)

```bash
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/surcharge-rules" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "surcharge rule",
    "identifiers": { "com.example.surchargeRuleId": "electronics-env-fee" },
    "name": "Environmental fee - Electronics",
    "products": [
      { "@type": "product category", "identifiers": { "com.example.categoryId": "electronics" } }
    ],
    "kind": "Percentage",
    "percentage": "5",
    "reason": {
      "identifiers": { "com.example.surchargeReasonId": "environmental-fee" }
    }
  }'
```

> **Note:** `percentage` is a straight percentage (`"5"` means 5 %) of the unit value, and must be between `0` and `100`; `"100"` is accepted, `"150"` is `400 A surcharge percentage must be between 0 and 100.`. There is no `includesTax` question for a percentage rule: the surcharge is a share of the line, and VAT is calculated on the resulting amount at the line's rate. A `Percentage` rule needs no `currency`.

---

## Section 5: Scoped Surcharge Rules

Like discount rules, surcharge rules can be scoped by seller, time period, unit value, or any combination. A fixed amount is in one currency, so a deposit in another currency is a second rule.

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
    "products": [
      { "@type": "product category", "identifiers": { "com.example.categoryId": "plastic-bags" } }
    ],
    "currency": { "identifiers": { "currencyCode": "SEK" } },
    "kind": "Fixed",
    "amount": "6",
    "includesTax": true,
    "reason": {
      "identifiers": { "com.example.surchargeReasonId": "bag-handling-fee" }
    }
  }'
```

### One currency per fixed rule

A fixed amount names its currency. If you operate in more than one, create a rule per currency:

```bash
# SEK rule: 1 SEK pant
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/surcharge-rules" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "surcharge rule",
    "identifiers": { "com.example.surchargeRuleId": "pant-1kr-sek" },
    "name": "Pant 1kr (SEK)",
    "products": [ { "@type": "product category", "identifiers": { "com.example.categoryId": "pant-1kr-products" } } ],
    "currency": { "identifiers": { "currencyCode": "SEK" } },
    "kind": "Fixed", "amount": "1", "includesTax": true,
    "reason": { "identifiers": { "com.example.surchargeReasonId": "pant" } }
  }'

# NOK rule: 2 NOK deposit
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/surcharge-rules" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "surcharge rule",
    "identifiers": { "com.example.surchargeRuleId": "pant-2nok" },
    "name": "Pant 2kr (NOK)",
    "products": [ { "@type": "product category", "identifiers": { "com.example.categoryId": "pant-1kr-products" } } ],
    "currency": { "identifiers": { "currencyCode": "NOK" } },
    "kind": "Fixed", "amount": "2", "includesTax": true,
    "reason": { "identifiers": { "com.example.surchargeReasonId": "pant" } }
  }'
```

With `includesTax: true` the two rules say what the customer pays in each country; the net is derived from each line's rate in the area of sale, so the Norwegian rate never has to be typed into the Swedish rule or vice versa.

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
    "products": [
      { "@type": "product category", "identifiers": { "com.example.categoryId": "plastic-bags" } }
    ],
    "currency": { "identifiers": { "currencyCode": "SEK" } },
    "kind": "Fixed",
    "amount": "5",
    "includesTax": true,
    "reason": {
      "identifiers": { "com.example.surchargeReasonId": "bag-handling-fee" }
    }
  }'
```

### Scoped by unit value

`worthAtLeast` and `worthAtMost` bound the unit value, excluding VAT, the rule applies to. A deposit on priced units only, so a free sample carries none:

```bash
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/surcharge-rules" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "surcharge rule",
    "identifiers": { "com.example.surchargeRuleId": "pant-1kr-priced" },
    "name": "Pant 1kr (priced units)",
    "products": [ { "@type": "product category", "identifiers": { "com.example.categoryId": "pant-1kr-products" } } ],
    "currency": { "identifiers": { "currencyCode": "SEK" } },
    "kind": "Fixed", "amount": "1", "includesTax": true,
    "worthAtLeast": "0.01",
    "reason": { "identifiers": { "com.example.surchargeReasonId": "pant" } }
  }'
```

### Combined scope (store + time + percentage)

A tariff scoped to a specific store during a defined period:

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
    "time": {
      "start": "2026-01-01T00:00:00",
      "end": "2026-03-31T23:59:59"
    },
    "products": [
      { "@type": "product category", "identifiers": { "com.example.categoryId": "imported-goods" } }
    ],
    "kind": "Percentage",
    "percentage": "3",
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
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/surcharge-rules~just(name,kind,amount,includesTax,reason)"
```

```json
[{"@type":"surcharge rule","name":"Pant 1kr","kind":"Fixed","amount":"1","includesTax":true,"reason":{"@type":"surcharge reason","identifiers":{"com.example.surchargeReasonId":"pant"},"name":"Pant","active":true,"discountable":false}}]
```

### Rules by kind, and the gross-basis ones

```bash
# Percentage rules
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/surcharge-rules~where(kind=Percentage)"

# Fixed rules whose amount is the customer-facing figure
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/surcharge-rules~where(includesTax=true)~just(name,amount,currency)"
```

### List all surcharge reasons

```bash
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/surcharge-reasons"
```

---

## Section 9: Surcharges vs Discounts — Comparison

| Aspect | Discount Rule | Surcharge Rule |
|---|---|---|
| Direction | Reduces price | Adds fee |
| Value | Effects: percentage, fixed reduction, fixed price, package | `kind`: `Fixed` (`amount`) or `Percentage` (`percentage`), on the rule itself |
| Products | `items` map with include/exclude and quantity conditions | `products` array |
| Has `phase` | Yes (priority ordering) | No |
| Has `reason` | Yes (`discount reason`) | Yes (`surcharge reason`) |
| Manual override | Yes (`manualDiscounts` on trade order items) | No manual surcharges |
| `includesTax` field | Yes (on discount rule) | Yes (on a fixed amount) |
| `multiplicity` / `targeting` | Yes (`PerUnit`/`PerApplication`, `All`/`LowestValue`/`HighestValue`) | No |
| Receipt field | `discountAmount`, `discounts[]` | `surchargeAmount`, `surcharges[]` |
| Common use cases | Campaigns, loyalty, volume tiers, staff discount | Pant/deposits, environmental fees, bag fees, tariffs |

---

## Section 10: Best Practices and Pitfalls

### Say which figure `amount` is

A deposit the customer sees as 2 SEK is `{"kind": "Fixed", "amount": "2", "includesTax": true}`. Sent without the flag, `2` is a net surcharge and the customer pays `2.24` at 12 %. If you keep net figures, say so: `{"amount": "1.785714", "includesTax": false}` is the same 2 kr deposit on a 12 % line.

### Prefer the gross form for consumer-facing fees

A gross amount is one figure per rule however many rates the matching products carry (the net is stripped per line at its own rate), and it stays put when a rate changes. A net figure has to be recomputed on both counts.

### One reason, many rules

Use a single "Pant" surcharge reason shared across all pant tiers (1kr, 2kr, 4kr). Don't create separate reasons per tier — the reason describes *what* the fee is, not *how much*.

### Product categories drive matching

Assign products to pant categories (e.g., "Pant 1kr products", "Pant 2kr products") and create surcharge rules targeting those categories. When a product changes category, the correct surcharge applies automatically — no rule changes needed. `products` replaces on set: a `PATCH` with `products` is the whole new list.

### No manual surcharges

Unlike discounts, surcharges cannot be manually applied at checkout. They are always automatic based on matching rules. If you need ad-hoc fees, model them as separate products (line items) on the order.

### No phase/priority system

Unlike discount rules, surcharge rules don't have a `phase` for priority ordering. All matching surcharge rules are applied additively. If two rules match the same item, both surcharges are added (they don't compete or override each other).

### One currency per fixed rule

A fixed amount is in one currency. Create a rule per currency you sell in; with `includesTax: true` each rule carries the local deposit as the customer sees it.

### Testing surcharge setup

After creating surcharge rules, verify the setup by creating a test trade order with matching products and checking the resulting receipt:

```bash
# Check that surcharges appear on the receipt
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/receipts/receiptID=RCP-TEST-001?fields=items.surcharges,surcharges"
```

An order line also shows the effect before any receipt exists: a product at 100 net and 25 % with a `Fixed` `2.5` `includesTax: true` rule reads `totalAmount: "127.5"` (`100` + `2` net surcharge, plus 25 %).
