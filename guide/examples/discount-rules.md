# Discount Rules Examples

Curl examples for discount rules, manual discounts, and trade restrictions.

**Base URL:** `https://example.app.heads.com/api/v1`
**API Key:** `banana` (passed via Basic Auth with empty username: `-u ":banana"`)

> **See also:** [Examples Index](../examples.md) | [Discount Coupons](./discount-coupons.md) | [Orders & Fulfillment](./orders.md) | [Customer Groups](../../reference/working-with/customers.md#customer-groups) | [Reference Documentation](../../reference/)

---

## Discount Rule Anatomy

A discount rule defines **when** and **how** discounts apply. Key properties:

| Property | Purpose |
|----------|---------|
| `seller` / `buyer` | Scope the rule to specific sellers or buyer groups. The `buyer` condition accepts **customer group** identifiers (see [Customer Groups and Buyer Conditions](#customer-groups-and-buyer-conditions)). Use `include`/`exclude` arrays with identifier references. |
| `currency` | Restrict to specific currencies (e.g., `{"currencyCode": "SEK"}`). |
| `time` | Optional validity window with `start` and `end` dates (ISO format). |
| `phase` | Determines evaluation order. Rules in lower-priority phases apply first; higher-priority phases can stack on top. Include `identifiers`, `name`, and `priority`. |
| `items` | A **named map** of item groups. Each key (e.g., `"phone"`, `"plan"`) defines a group with `include`/`exclude` arrays, optional `atLeast`/`atMost` quantity constraints, and optional `worthAtLeast`/`worthAtMost` value thresholds. Set `includeAll: true` to match all products without listing specific groups (see [Using `includeAll` for Cart-Wide Rules](#using-includeall-for-cart-wide-rules)). |
| `where.equals` | Links item groups by matching property paths (e.g., ensuring a phone's IMEI matches a plan's phoneImei for bundle discounts). |
| `effects` | Array of effect objects. Each effect must include `@type`, which items it targets, and how it applies. |
| `effects[].@type` | Effect type: `"percentage discount rule effect"`, `"fixed reduction discount rule effect"`, `"fixed price discount rule effect"`, or `"package discount rule effect"`. |
| `effects[].items` | **Must reference keys from the `items` map** (e.g., `["phone"]` or `["item1", "item2"]`). |
| `effects[].multiplicity` | `"PerUnit"` (applies to each qualifying unit) or `"PerApplication"` (applies once per rule match). |
| `effects[].targeting` | `"All"` (affects all matching items), `"LowestValue"` (targets the cheapest item), or `"HighestValue"` (targets the most expensive item). |
| `effects[].minimumResultingPrice` | Floor price after discount (prevents negative prices). |
| `includesTax` | Whether the discount applies to tax-inclusive prices (`true`) or pre-tax prices (`false`). |
| `coupon` | Optional precondition. When set, the rule fires only if the cart presents a code that resolves to one of the coupons in `coupon.include` (and not in `coupon.exclude`). Without this field, the rule is automatic — it fires whenever its other conditions match. See [Example 17: Coupon-Bound Rule](#example-17-coupon-bound-rule-activated-only-by-a-code) and [Discount Coupons](./discount-coupons.md) for full coupon mechanics. |
| `reason` | A reference to explain why the discount was applied (shown on receipts). |

```bash
# List all discount rules
curl -X GET -u ":banana" "example.app.heads.com/api/v1/discount-rules"

# Get discount rule by ID
curl -X GET -u ":banana" "example.app.heads.com/api/v1/discount-rules/com.heads.seedID=employee-discount"
```

---

## Example 1: Employee Apparel Percentage Discount (Category-Based)

This rule gives employees 10% off apparel products:

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/discount-rules" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.heads.seedID": "employee-discount"},
    "name": "Employee apparel 10%",
    "seller": {"include": [{"identifiers": {"com.heads.seedID": "ourcompany"}}]},
    "buyer": {"include": [{"identifiers": {"com.heads.seedID": "employee-customers"}}]},
    "currency": {"include": [{"identifiers": {"currencyCode": "SEK"}}]},
    "phase": {"identifiers": {"com.heads.seedID": "loyalty"}, "name": "Loyalty discounts", "priority": 300},
    "items": {
      "apparel": {
        "include": [{"identifiers": {"com.heads.seedID": "fashion-clothes"}}],
        "exclude": [],
        "atLeast": 1
      }
    },
    "effects": [{
      "@type": "percentage discount rule effect",
      "items": ["apparel"],
      "percentage": "10",
      "multiplicity": "PerUnit",
      "targeting": "All"
    }],
    "reason": {"identifiers": {"com.heads.seedID": "employee-discount-reason"}, "name": "Employee discount"},
    "includesTax": false
  }'
```

---

## Example 2: Phone + Plan Subsidy with Bundle Link

This rule applies a fixed SEK 2,500 reduction when a phone and matching plan are purchased together. The `where.equals` ensures the phone's IMEI matches the plan's `phoneImei` property:

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/discount-rules" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.heads.seedID": "phone-plan-subsidy"},
    "name": "Phone with plan subsidy",
    "seller": {"include": [{"identifiers": {"com.heads.seedID": "ourcompany"}}]},
    "currency": {"include": [{"identifiers": {"currencyCode": "SEK"}}]},
    "phase": {"identifiers": {"com.heads.seedID": "subsidy"}, "name": "Subsidy", "priority": 200},
    "includesTax": true,
    "time": {"start": "2025-04-11", "end": "2035-12-11"},
    "items": {
      "phone": {
        "include": [{"identifiers": {"com.heads.seedID": "mobile-telephone-group"}}],
        "atLeast": 1,
        "atMost": 1
      },
      "plan": {
        "include": [{"identifiers": {"com.heads.seedID": "mobile-plans-group"}}],
        "atLeast": 1,
        "atMost": 1
      }
    },
    "where": {
      "equals": [
        "phone.MobileDevice::imei",
        "plan.MobilePlan::phoneImei"
      ]
    },
    "effects": [{
      "@type": "fixed reduction discount rule effect",
      "items": ["phone"],
      "amount": "2500",
      "minimumResultingPrice": "1",
      "multiplicity": "PerApplication",
      "targeting": "All"
    }],
    "reason": {"identifiers": {"com.heads.seedID": "phone-plan-subsidy"}, "name": "Phone with plan"}
  }'
```

---

## Example 3: Pair Discount on Two Specific SKUs

This rule gives 25% off when two specific AirPods models are purchased together:

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/discount-rules" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.heads.seedID": "buy-together"},
    "name": "AirPods pair discount",
    "seller": {"include": [{"identifiers": {"com.heads.seedID": "ourcompany"}}]},
    "currency": {"include": [{"identifiers": {"currencyCode": "SEK"}}]},
    "phase": {"identifiers": {"com.heads.seedID": "custom"}, "name": "Custom", "priority": 500},
    "time": {"start": "2025-04-11", "end": "2035-12-11"},
    "items": {
      "item1": {
        "include": [{"identifiers": {"com.heads.seedID": "apple-airpods-3gen"}}],
        "exclude": [],
        "atLeast": 1,
        "atMost": 1
      },
      "item2": {
        "include": [{"identifiers": {"com.heads.seedID": "apple-airpods-2gen"}}],
        "exclude": [],
        "atLeast": 1,
        "atMost": 1
      }
    },
    "effects": [{
      "@type": "percentage discount rule effect",
      "items": ["item1", "item2"],
      "percentage": "25",
      "multiplicity": "PerApplication",
      "targeting": "All"
    }],
    "reason": {"identifiers": {"com.heads.seedID": "pair-discount"}, "name": "Pair discount"}
  }'
```

---

## Example 4: Percentage Discount on Category (Campaign Promo)

A simple percentage-off campaign targeting all accessories:

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/discount-rules" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.heads.seedID": "campaign-accessories-20"},
    "name": "Accessories 20% off",
    "seller": {"include": [{"identifiers": {"com.heads.seedID": "stockholm-store"}}]},
    "currency": {"include": [{"identifiers": {"currencyCode": "SEK"}}]},
    "phase": {"identifiers": {"com.heads.seedID": "promotions"}, "name": "Promotions", "priority": 400},
    "items": {
      "accessory": {
        "include": [{"identifiers": {"com.heads.seedID": "accessories"}}],
        "exclude": [],
        "atLeast": 1
      }
    },
    "effects": [{
      "@type": "percentage discount rule effect",
      "items": ["accessory"],
      "percentage": "20",
      "multiplicity": "PerUnit",
      "targeting": "All"
    }],
    "includesTax": false,
    "reason": {"identifiers": {"com.heads.seedID": "campaign"}, "name": "Campaign promo"}
  }'
```

---

## Example 5: Quantity Tier Discounts (Volume Breaks)

Two rules implement tiered pricing: 5% off at 3+ items, 10% off at 5+ items. Both rules use the same phase priority so they are evaluated together:

> **Note: How Overlapping Tier Rules Work**
>
> When multiple rules match the same instances (e.g., 5 items match both `atLeast: 3` and `atLeast: 5`), the discount engine evaluates possible outcomes and selects the one that **minimizes the total price** (maximizes the customer's discount). Rules within the same phase consume instances—once an instance is discounted by one rule, it's unavailable to other rules in that phase. This means:
>
> - **Overlapping tiers compete**, and each item can only be discounted once per phase.
> - The engine automatically picks the best outcome; with 5 items, it will apply the 10% tier (better discount) rather than the 5% tier.
> - **For deterministic tiers**, use explicit ranges: `atLeast: 3, atMost: 4` for tier 1 and `atLeast: 5` for tier 2—this ensures exactly one tier matches each quantity.
> - **To stack discounts**, place rules in separate phases with different priorities; each phase operates independently on all items.

```bash
# Tier 1: 5% off when buying 3+ items
curl -X POST -u ":banana" "example.app.heads.com/api/v1/discount-rules" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.heads.seedID": "tier-3plus-5pct"},
    "name": "Buy 3+, get 5%",
    "phase": {"identifiers": {"com.heads.seedID": "promotions"}, "name": "Promotions", "priority": 410},
    "items": {
      "cart": {
        "include": [{"identifiers": {"com.heads.seedID": "all-products"}}],
        "atLeast": 3
      }
    },
    "effects": [{
      "@type": "percentage discount rule effect",
      "items": ["cart"],
      "percentage": "5",
      "multiplicity": "PerApplication",
      "targeting": "All"
    }],
    "includesTax": true
  }'

# Tier 2: 10% off when buying 5+ items
curl -X POST -u ":banana" "example.app.heads.com/api/v1/discount-rules" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.heads.seedID": "tier-5plus-10pct"},
    "name": "Buy 5+, get 10%",
    "phase": {"identifiers": {"com.heads.seedID": "promotions"}, "name": "Promotions", "priority": 410},
    "items": {
      "cart": {
        "include": [{"identifiers": {"com.heads.seedID": "all-products"}}],
        "atLeast": 5
      }
    },
    "effects": [{
      "@type": "percentage discount rule effect",
      "items": ["cart"],
      "percentage": "10",
      "multiplicity": "PerApplication",
      "targeting": "All"
    }],
    "includesTax": true
  }'
```

---

## Example 6: Bundle Deal (3-for-2)

The cheapest item is free when buying 3 from a category. Use `targeting: "LowestValue"` with 100% off:

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/discount-rules" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.heads.seedID": "bundle-3for2"},
    "name": "3 for 2 on cosmetics",
    "currency": {"include": [{"identifiers": {"currencyCode": "SEK"}}]},
    "phase": {"identifiers": {"com.heads.seedID": "promotions"}, "name": "Promotions", "priority": 300},
    "items": {
      "bundle": {
        "include": [{"identifiers": {"com.heads.seedID": "cosmetics"}}],
        "atLeast": 3,
        "atMost": 3
      }
    },
    "effects": [{
      "@type": "percentage discount rule effect",
      "items": ["bundle"],
      "percentage": "100",
      "multiplicity": "PerUnit",
      "targeting": "LowestValue"
    }],
    "includesTax": true,
    "reason": {"identifiers": {"com.heads.seedID": "bundle"}, "name": "3-for-2 bundle"}
  }'
```

---

## Example 7: Buy X Get Y Free

Buy 2 coffees, get a mug free. Two item groups with a 100% discount applied only to the reward item:

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/discount-rules" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.heads.seedID": "coffee-mug-bogo"},
    "name": "Buy 2 coffees, get mug free",
    "phase": {"identifiers": {"com.heads.seedID": "promotions"}, "name": "Promotions", "priority": 320},
    "items": {
      "coffee": {
        "include": [{"identifiers": {"com.heads.seedID": "coffee-beans"}}],
        "atLeast": 2
      },
      "mug": {
        "include": [{"identifiers": {"com.heads.seedID": "ceramic-mug"}}],
        "atLeast": 1,
        "atMost": 1
      }
    },
    "effects": [{
      "@type": "percentage discount rule effect",
      "items": ["mug"],
      "percentage": "100",
      "multiplicity": "PerApplication",
      "targeting": "LowestValue"
    }],
    "includesTax": true,
    "reason": {"identifiers": {"com.heads.seedID": "bogo"}, "name": "Buy X get Y"}
  }'
```

---

## Example 8: Store-Specific Discount

Clearance discount limited to a single store location using the `seller` scope:

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/discount-rules" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.heads.seedID": "stockholm-clearance"},
    "name": "Stockholm clearance -15%",
    "seller": {"include": [{"identifiers": {"com.heads.seedID": "store-stockholm"}}]},
    "currency": {"include": [{"identifiers": {"currencyCode": "SEK"}}]},
    "items": {
      "clearance": {
        "include": [{"identifiers": {"com.heads.seedID": "clearance"}}],
        "atLeast": 1
      }
    },
    "effects": [{
      "@type": "percentage discount rule effect",
      "items": ["clearance"],
      "percentage": "15",
      "multiplicity": "PerUnit",
      "targeting": "All"
    }],
    "includesTax": true,
    "reason": {"identifiers": {"com.heads.seedID": "clearance"}, "name": "Store clearance"}
  }'
```

---

## Example 9: Staff Discount with Floor Price

Employee discount using `buyer` scope. The `minimumResultingPrice` ensures the price never drops below a floor:

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/discount-rules" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.heads.seedID": "staff-apparel-30"},
    "name": "Staff apparel 30%",
    "buyer": {"include": [{"identifiers": {"com.heads.seedID": "employee-customers"}}]},
    "currency": {"include": [{"identifiers": {"currencyCode": "SEK"}}]},
    "items": {
      "apparel": {
        "include": [{"identifiers": {"com.heads.seedID": "fashion-clothes"}}],
        "atLeast": 1
      }
    },
    "effects": [{
      "@type": "percentage discount rule effect",
      "items": ["apparel"],
      "percentage": "30",
      "multiplicity": "PerUnit",
      "targeting": "All",
      "minimumResultingPrice": "99"
    }],
    "includesTax": false,
    "reason": {"identifiers": {"com.heads.seedID": "staff"}, "name": "Staff discount"}
  }'
```

---

## Example 10: Cart Value Threshold (Spend X, Get Discount on Y)

When the total cart value reaches a monetary threshold, apply a discount on specific products. This uses two item groups:

- A **qualifier group** (`allTheThings`) with a broad product group in `include` (e.g., a top-level "all products" group) and `worthAtLeast` set to the monetary threshold
- A **target group** (`accessory`) with specific product includes that receives the discount effect

> **Warning:** The qualifier group's `include` must be **non-empty**. An empty `include` targets no products and the rule will never match. Use a top-level product group to match all products, or use `includeAll: true` instead (see [Using `includeAll` for Cart-Wide Rules](#using-includeall-for-cart-wide-rules)).

The `worthAtLeast` field is a **value-based** threshold (decimal), unlike `atLeast`/`atMost` which are quantity-based. It checks the total value of matched items accumulated up to the current phase.

| Field | Type | Description |
|-------|------|-------------|
| `worthAtLeast` | `decimal?` | Minimum total value (up to this phase) of matched products |
| `worthAtMost` | `decimal?` | Maximum total value (up to this phase) of matched products |

> **Note:** `worthAtLeast` evaluates the sum of effects applied to matched items by preceding phases. This means the threshold is based on the accumulated price after earlier discount phases have been applied, not the original list price.

```bash
# When purchasing for at least 10,000 SEK, get 10% off all accessories
curl -X POST -u ":banana" "example.app.heads.com/api/v1/discount-rules" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.heads.seedID": "cart-threshold-accessory-discount"},
    "name": "10% off accessories when purchasing for 10 000 SEK or more",
    "seller": {"include": [{"identifiers": {"com.heads.seedID": "ourcompany"}}]},
    "currency": {"include": [{"identifiers": {"currencyCode": "SEK"}}]},
    "phase": {"identifiers": {"com.heads.seedID": "promotions"}, "name": "Promotions", "priority": 400},
    "items": {
      "allTheThings": {
        "include": [{"identifiers": {"com.heads.seedID": "all-products"}}],
        "exclude": [],
        "worthAtLeast": 10000
      },
      "accessory": {
        "include": [{"identifiers": {"com.heads.seedID": "mobile-accessories-group"}}],
        "exclude": [],
        "atLeast": 1
      }
    },
    "effects": [{
      "@type": "percentage discount rule effect",
      "items": ["accessory"],
      "percentage": "10",
      "multiplicity": "PerUnit",
      "targeting": "All"
    }],
    "includesTax": true,
    "reason": {"identifiers": {"com.heads.seedID": "cart-threshold-promo"}, "name": "Cart threshold promotion"}
  }'
```

### How It Works

1. The `allTheThings` group matches **all products** (via a top-level product group in `include`). The `worthAtLeast: 10000` threshold requires their total value to be at least 10,000 SEK.
2. The `accessory` group matches products from the accessories category with at least 1 item.
3. **Both groups must match** for the rule to fire — the cart must contain 10,000+ SEK worth of products AND at least one accessory.
4. The effect targets only the `accessory` group (10% off), leaving qualifier items at full price.

### Simpler Variant: Whole-Cart Discount

For a straightforward "spend X, get Y% off everything" rule, use a single item group:

```bash
# 10% off everything when cart exceeds 1,500 SEK
curl -X POST -u ":banana" "example.app.heads.com/api/v1/discount-rules" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.heads.seedID": "cart-discount-1500"},
    "name": "10% off when purchasing for 1500 SEK or more",
    "currency": {"include": [{"identifiers": {"currencyCode": "SEK"}}]},
    "phase": {"identifiers": {"com.heads.seedID": "promotions"}, "name": "Promotions", "priority": 400},
    "items": {
      "everything": {
        "include": [{"identifiers": {"com.heads.seedID": "all-products"}}],
        "exclude": [],
        "worthAtLeast": 1500
      }
    },
    "effects": [{
      "@type": "percentage discount rule effect",
      "items": ["everything"],
      "percentage": "10",
      "multiplicity": "PerUnit",
      "targeting": "All"
    }],
    "includesTax": true,
    "reason": {"identifiers": {"com.heads.seedID": "value-discount-reason"}, "name": "Cart value discount"}
  }'
```

---

## Using `includeAll` for Cart-Wide Rules

The `includeAll` field on a product condition (item group) makes it match **every product in the catalog** without requiring a specific product group in `include`. This is the simplest way to build cart-wide discount rules like "10% off entire purchase."

### How `includeAll` Works

| Field | Type | Description |
|-------|------|-------------|
| `includeAll` | `boolean` | When `true`, all products match this item group. Overrides `include` but respects `exclude`. |

Key behaviors:

- **Overrides `include`** — when `includeAll: true`, the `include` array is ignored entirely. You can omit it.
- **Respects `exclude`** — you can still exempt specific products or categories using the `exclude` array.
- **Thresholds still apply** — `atLeast`, `atMost`, `worthAtLeast`, and `worthAtMost` still constrain when the rule activates.

> **Tip:** Compare with Example 10's "Simpler Variant" above, which uses `include: [{"identifiers": {"com.heads.seedID": "all-products"}}]` to achieve a similar result. The difference: `include` requires a pre-existing top-level product group that encompasses all products. `includeAll: true` needs no such group — it's a built-in "match everything" flag.

### Example 11: Cart-Wide Percentage Discount with `includeAll`

10% off everything when the cart total exceeds 1,500 SEK. This is the canonical `includeAll` use case — identical to the production seed rule `cart-discount-1500`:

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/discount-rules" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.example.id": "cart-discount-1500"},
    "name": "10% off orders over 1500 SEK",
    "seller": {"include": [{"identifiers": {"com.example.id": "ourcompany"}}]},
    "currency": {"include": [{"identifiers": {"currencyCode": "SEK"}}]},
    "phase": {"identifiers": {"com.example.id": "cart-phase"}},
    "includesTax": true,
    "items": {
      "everything": {
        "includeAll": true,
        "worthAtLeast": 1500
      }
    },
    "effects": [{
      "@type": "percentage discount rule effect",
      "items": ["everything"],
      "percentage": "10"
    }],
    "reason": {
      "identifiers": {"com.example.id": "value-discount"},
      "name": "Cart value discount"
    }
  }'
```

Notice the `items` map: the `"everything"` group has no `include` array at all. `includeAll: true` means every product in the catalog matches, and `worthAtLeast: 1500` ensures the rule only fires when those items' total value reaches 1,500 SEK.

---

### Example 12: `includeAll` with Exclusions

10% off everything except gift cards. The `exclude` array is the only way to exempt products when using `includeAll`:

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/discount-rules" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.example.id": "cart-discount-no-giftcards"},
    "name": "10% off everything (excl gift cards)",
    "includesTax": true,
    "items": {
      "everything": {
        "includeAll": true,
        "exclude": [
          {"@type": "product category", "identifiers": {"com.example.categoryId": "gift-cards"}}
        ]
      }
    },
    "effects": [{
      "@type": "percentage discount rule effect",
      "items": ["everything"],
      "percentage": "10"
    }]
  }'
```

Products in the "gift-cards" category are exempt even though `includeAll` matches everything else.

---

### Example 13: Staff Discount on All Products

15% staff discount with no value or quantity threshold. The `buyer` condition scopes the rule to staff members; `includeAll` means the discount applies to everything they buy:

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/discount-rules" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.example.id": "staff-discount"},
    "name": "Staff discount 15%",
    "includesTax": false,
    "buyer": {"include": [{"identifiers": {"com.example.id": "staff-group"}}]},
    "items": {
      "allProducts": {
        "includeAll": true
      }
    },
    "effects": [{
      "@type": "percentage discount rule effect",
      "items": ["allProducts"],
      "percentage": "15",
      "multiplicity": "PerUnit",
      "targeting": "All"
    }]
  }'
```

No `worthAtLeast` or `atLeast` — the rule is unconditional for staff buyers. See [Customer Groups and Buyer Conditions](#customer-groups-and-buyer-conditions) for how to set up the `"staff-group"` buyer condition.

---

### Example 14: `includeAll` with Quantity Threshold

Rule activates when 5 or more items (of any kind) are in the cart:

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/discount-rules" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.example.id": "bulk-5-items"},
    "name": "5% off when buying 5+ items",
    "includesTax": true,
    "items": {
      "allItems": {
        "includeAll": true,
        "atLeast": 5
      }
    },
    "effects": [{
      "@type": "percentage discount rule effect",
      "items": ["allItems"],
      "percentage": "5",
      "multiplicity": "PerUnit",
      "targeting": "All"
    }]
  }'
```

Without `atLeast`, the rule would activate for any non-empty cart.

---

### `includeAll` vs Explicit `include` — When to Use Which

| Approach | When to use | Example scenario |
|----------|-------------|------------------|
| `include: [specific products/categories]` | Discount targets specific product groups | "20% off electronics" |
| `includeAll: true` | Discount applies to everything in the catalog | "10% off entire cart" |
| `includeAll: true` + `exclude: [...]` | Everything except specific exemptions | "10% off all except gift cards" |
| `includeAll: true` + `worthAtLeast` | Cart-value threshold on all products | "10% off when cart > 1500 SEK" |
| `includeAll: true` + `atLeast` | Item-count threshold on all products | "Free shipping on 5+ items" |

### Pitfalls

- **`includeAll` completely overrides `include`.** If you set both, `include` is ignored. Don't combine them expecting an additive effect.
- **`exclude` still works with `includeAll`** — this is the only way to exempt specific products from the "all products" match.
- **Don't confuse `includeAll` with `~withAll`.** `includeAll` is a product condition property (matches all products). `~withAll` is an API field expansion operator (expands all nested fields in the response). Completely different concepts.
- **Thresholds still constrain activation.** `includeAll` makes the item group match all products, but `atLeast`, `atMost`, `worthAtLeast`, and `worthAtMost` still determine whether the cart contents satisfy the rule's conditions.

---

## Example 15: Fixed Reduction Distributed Across Cart Items

A fixed monetary reduction (e.g., a coupon for "250 SEK off entire purchase") applied once and distributed proportionally across all items. This uses `fixed reduction discount rule effect` with `includeAll` to target the whole cart:

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/discount-rules" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.example.id": "cart-fixed-reduction-250"},
    "name": "250 SEK off entire purchase",
    "includesTax": true,
    "items": {
      "allItems": {
        "includeAll": true
      }
    },
    "effects": [{
      "@type": "fixed reduction discount rule effect",
      "items": ["allItems"],
      "amount": "250",
      "multiplicity": "PerApplication",
      "targeting": "All"
    }],
    "reason": {
      "identifiers": {"com.example.id": "coupon"},
      "name": "Coupon discount"
    }
  }'
```

### How It Works

1. **`includeAll: true`** — the `"allItems"` group matches every product in the cart without listing specific product groups (see [Using `includeAll` for Cart-Wide Rules](#using-includeall-for-cart-wide-rules)).
2. **`amount: "250"`** — the reduction amount in the rule's currency (SEK). 250 SEK off the cart.
3. **`multiplicity: "PerApplication"`** — the 250 SEK reduction is applied **once** to the entire cart, not per individual item.
4. **`targeting: "All"`** — the reduction is distributed **proportionally** across all matched items based on their relative values. An item worth 60% of the cart total absorbs 60% of the 250 SEK reduction.
5. **`includesTax: true`** — the 250 SEK amount includes VAT. The system calculates the ex-VAT portion automatically based on each item's VAT rate.

### `PerApplication` vs `PerUnit` for Fixed Reductions

The `multiplicity` field changes the meaning of the reduction dramatically:

| Multiplicity | Behavior | Example (3 items in cart) |
|---|---|---|
| `PerApplication` | Total reduction applied once, distributed across items | 250 SEK off the whole cart |
| `PerUnit` | Reduction applied to each qualifying item individually | 250 SEK off **each** item (750 SEK total) |

For coupon-style "X SEK off entire purchase" scenarios, always use `PerApplication`. Use `PerUnit` for per-item reductions like "50 SEK off each drink."

### Variant: Fixed Reduction with Exclusions

Combine with `exclude` to exempt specific products from the coupon:

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/discount-rules" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.example.id": "cart-fixed-reduction-250-no-giftcards"},
    "name": "250 SEK off entire purchase (excl gift cards)",
    "includesTax": true,
    "items": {
      "allItems": {
        "includeAll": true,
        "exclude": [
          {"@type": "product category", "identifiers": {"com.example.categoryId": "gift-cards"}}
        ]
      }
    },
    "effects": [{
      "@type": "fixed reduction discount rule effect",
      "items": ["allItems"],
      "amount": "250",
      "multiplicity": "PerApplication",
      "targeting": "All"
    }],
    "reason": {
      "identifiers": {"com.example.id": "coupon"},
      "name": "Coupon discount"
    }
  }'
```

Gift card items are excluded from both the match set and the proportional distribution of the reduction.

---

## Example 16: Product-Triggered Fixed Reduction Across Cart

A variant of [Example 15](#example-15-fixed-reduction-distributed-across-cart-items) where the discount is **conditional** — it only fires when a specific trigger product is present in the cart. For example: "Buy Trigger Product, get 250 SEK off the entire cart."

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/discount-rules" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.example.id": "product-trigger-reduction"},
    "name": "Buy Trigger Product, 250 SEK off cart",
    "includesTax": true,
    "items": {
      "triggerItem": {
        "include": [{"identifiers": {"com.example.id": "trigger-product"}}],
        "atLeast": 1
      },
      "allItems": {
        "includeAll": true
      }
    },
    "effects": [{
      "@type": "fixed reduction discount rule effect",
      "items": ["allItems"],
      "amount": "250",
      "multiplicity": "PerApplication",
      "targeting": "All"
    }],
    "reason": {
      "identifiers": {"com.example.id": "coupon"},
      "name": "Coupon discount"
    }
  }'
```

### How It Works

1. **Two named item groups** — the `items` map defines `"triggerItem"` (a specific product) and `"allItems"` (everything in the cart). Both are independent [product conditions](../../reference/) evaluated separately.
2. **`"triggerItem"` with `atLeast: 1`** — the rule only activates when at least one unit of the trigger product is in the cart. Without this condition, the discount would be unconditional (like [Example 15](#example-15-fixed-reduction-distributed-across-cart-items)).
3. **Effect targets `"allItems"`, not `"triggerItem"`** — the 250 SEK reduction is distributed across the **whole cart**, not just the trigger product. The trigger product merely gates whether the discount fires.
4. **Trigger product participates in distribution** — since `"allItems"` uses `includeAll: true`, the trigger product is included in the proportional distribution. If you want to exclude it, add an `exclude` entry on `"allItems"`.

### Conditional vs Unconditional: Key Difference

| Scenario | `items` map | When does the discount fire? |
|---|---|---|
| [Example 15](#example-15-fixed-reduction-distributed-across-cart-items) (unconditional) | `"allItems": { "includeAll": true }` only | Always, for any non-empty cart |
| Example 16 (product-triggered) | `"triggerItem": { "include": [...], "atLeast": 1 }` + `"allItems": { "includeAll": true }` | Only when trigger product is in cart |

The `"triggerItem"` group doesn't need to appear in `effects[].items` — its presence in the `items` map with `atLeast: 1` is enough to make it a required activation condition. The effect only references the groups it acts upon.

### Variant: Exclude Trigger Product from Reduction

If the reduction should apply to all items **except** the trigger product itself:

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/discount-rules" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.example.id": "product-trigger-reduction-excl"},
    "name": "Buy Trigger Product, 250 SEK off other items",
    "includesTax": true,
    "items": {
      "triggerItem": {
        "include": [{"identifiers": {"com.example.id": "trigger-product"}}],
        "atLeast": 1
      },
      "otherItems": {
        "includeAll": true,
        "exclude": [{"identifiers": {"com.example.id": "trigger-product"}}]
      }
    },
    "effects": [{
      "@type": "fixed reduction discount rule effect",
      "items": ["otherItems"],
      "amount": "250",
      "multiplicity": "PerApplication",
      "targeting": "All"
    }],
    "reason": {
      "identifiers": {"com.example.id": "coupon"},
      "name": "Coupon discount"
    }
  }'
```

Here, `"otherItems"` uses `includeAll: true` with `exclude` to match everything except the trigger product. The reduction is distributed only among the non-trigger items.

---

## Example 17: Coupon-Bound Rule (Activated Only by a Code)

By default, a discount rule is **automatic** — it fires whenever its `seller`, `currency`, `items`, etc. all match. Adding a `coupon` precondition makes the rule **gated**: it fires only when the cart also presents a code that resolves to a coupon listed in `coupon.include` (and not listed in `coupon.exclude`). The coupon does not change *what* the rule does; it only adds a condition for *whether* the rule fires.

Two pieces are needed:

1. A coupon (the token customers present), created via `/v1/discount-coupons` — see [Discount Coupons](./discount-coupons.md).
2. A rule that lists that coupon under `coupon.include`. Best practice is to put coupon-bound rules in their own [discount phase](./discount-coupons.md#where-coupon-rules-sit-in-the-discount-stack) so they don't compete with automatic promotions.

```bash
# The coupon
curl -X PUT -u ":banana" \
  "example.app.heads.com/api/v1/discount-coupons/com.heads.seedID=spring-launch" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.heads.seedID": "spring-launch"},
    "issuer": {"identifiers": {"com.heads.seedID": "ourcompany"}},
    "code": "SPRING2026",
    "pattern": false,
    "maxRedemptions": 500
  }'

# The rule that the coupon activates
curl -X POST -u ":banana" "example.app.heads.com/api/v1/discount-rules" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.heads.seedID": "spring-launch-rule"},
    "name": "Spring launch -10%",
    "seller": {"include": [{"identifiers": {"com.heads.seedID": "ourcompany"}}]},
    "currency": {"include": [{"identifiers": {"currencyCode": "SEK"}}]},
    "phase": {"identifiers": {"com.heads.seedID": "dc-phase"}, "name": "Discount Coupon", "priority": 500},
    "includesTax": true,
    "coupon": {
      "include": [{"identifiers": {"com.heads.seedID": "spring-launch"}}],
      "exclude": []
    },
    "items": {
      "everything": { "includeAll": true }
    },
    "effects": [{
      "@type": "percentage discount rule effect",
      "items": ["everything"],
      "percentage": "10"
    }],
    "reason": {"identifiers": {"com.heads.seedID": "spring-launch-reason"}, "name": "Spring launch"}
  }'
```

### How `coupon.include` / `coupon.exclude` Work

| Field | Meaning |
|---|---|
| `coupon.include` | One or more coupon refs. The rule fires only when the cart presents a code that resolves to **at least one** of these coupons. |
| `coupon.exclude` | One or more coupon refs. The rule **does not** fire when the cart presents a code resolving to any of these — useful for narrowing a broadly-scoped rule away from specific tokens. |
| (no `coupon` field) | The rule is automatic and ignores any coupons in the cart. |

### Multiple Coupons, One Rule

A single rule can be activated by any of several coupons — list them all in `coupon.include`. This is convenient when several codes (for example, partner-specific variants of the same promotion) should grant the same effect. Each cart that presents any one of them activates the rule, and only the coupon actually presented has its `redemptions` counter incremented.

### One Coupon, Multiple Rules

A coupon can also appear in `coupon.include` of multiple rules — for example, a single launch code that activates both a percentage discount on accessories and a fixed reduction on a specific SKU. **If the coupon is `stackable: true`,** every rule whose conditions match fires; **if it is non-stackable (the default),** the coupon is consumed by the first matching rule per phase and other rules in that phase will not see it. Either way, the coupon counts as **one redemption per finalised order** regardless of how many rules fired.

### Combining `coupon` with Other Conditions

The `coupon` precondition stacks on top of every other condition (`seller`, `buyer`, `currency`, `time`, `items`, `where.equals`, `worthAtLeast`, etc.). All of them must hold for the rule to fire — a coupon code does **not** override an unmet `time` window or an unsatisfied `items` group. If a customer's code is accepted by the engine but no discount appears, check the rule's other conditions against the cart contents (see [Failure Modes](./discount-coupons.md#failure-modes-when-a-coupon-does-not-apply)).

---

## Customer Groups and Buyer Conditions

The `buyer` condition on a discount rule scopes the discount to specific customer groups. When a customer group is included in `buyer.include`, the discount applies only to orders where the buyer is a member of that group.

### How It Works

Customer groups are a subtype of Agent in the data model (`CustomerGroup → Cohort → Agent`), so the `buyer.include` array accepts customer group identifiers directly. The discount engine checks whether the trade order's customer belongs to any of the included customer groups (via their trade relationship's `groups` member).

### Setup Flow

To use customer groups with discount rules:

1. **Create a customer group** — owned by your company
2. **Create trade relationships** — between your company and each customer
3. **Assign customers to the group** — via the trade relationship's `groups` member
4. **Create a discount rule** — with `buyer.include` referencing the customer group

```bash
# 1. Create the customer group (owner requires database key)
#    First: GET /v1/companies/com.example.companyId=our-company/identifiers/key
POST /v1/customer-groups
{
  "identifiers": {"com.example.groupId": "employee-customers"},
  "name": "Employees",
  "memberMoniker": "Employee",
  "owner": {"identifiers": {"key": "<company-database-key>"}}
}

# 2. Create a trade relationship (embeds customer creation)
POST /v1/trade-relationships
{
  "identifiers": {"com.example.relId": "tr-pelle"},
  "customerAgent": {
    "@type": "person",
    "identifiers": {"com.example.customerId": "pelle"},
    "givenName": "Pelle",
    "familyName": "Personalsson",
    "contactMethods": {"email": "pelle@company.se", "mobilePhone": "+46712345678"}
  },
  "supplierAgent": {"identifiers": {"com.example.companyId": "our-company"}},
  "defaultCurrency": {"identifiers": {"currencyCode": "SEK"}}
}

# 3. Add the customer to the group
POST /v1/trade-relationships/com.example.relId=tr-pelle/groups
{"identifiers": {"com.example.groupId": "employee-customers"}}

# 4. Create the discount rule with buyer condition
#    (see Example 1 and Example 9 for full payloads)
```

### Buyer Condition Structure

The `buyer` field is an **agent condition** with `include` and `exclude` arrays:

```json
{
  "buyer": {
    "include": [
      {"identifiers": {"com.example.groupId": "employee-customers"}}
    ],
    "exclude": []
  }
}
```

- **`include`** — Customer groups (or individual agents) eligible for the discount
- **`exclude`** — Customer groups (or individual agents) excluded from the discount
- If `buyer` is omitted, the rule applies to **all buyers**

### Querying Group Membership

```bash
# Which groups does a customer belong to?
GET /v1/trade-relationships/com.example.relId=tr-pelle/groups

# Which customers are in a group?
GET /v1/customer-groups/com.example.groupId=employee-customers~with(members)

# Get trade relationships with groups expanded (filter client-side for specific group)
GET /v1/trade-relationships~with(groups)~take(50)
```

> For full customer group management documentation (creating groups, assigning members, querying membership), see [Working with Customers — Customer Groups](../../reference/working-with/customers.md#customer-groups).

---

## Manual Discounts (Ad-Hoc at POS)

Manual discounts are applied directly to trade orders, not through discount rules. They are set on individual items at order creation time via the `manualDiscount` field:

```bash
# Create order with manual discount on an item
curl -X POST -u ":banana" "example.app.heads.com/api/v1/trade-orders" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.orderId": "ORD-001"},
    "supplier": {"identifiers": {"com.heads.seedID": "ourcompany"}},
    "customer": {"identifiers": {"com.myapp.customerId": "CUST-001"}},
    "sellers": [{"identifiers": {"com.heads.seedID": "store1"}}],
    "currency": {"identifiers": {"currencyCode": "SEK"}},
    "items": [
      {
        "product": {"identifiers": {"com.heads.seedID": "iphone16"}},
        "quantity": 1,
        "manualDiscount": {"identifiers": {"com.heads.seedID": "loyalty-10pct"}}
      }
    ]
  }'

# Query order with manual discounts expanded
curl -X GET -u ":banana" "example.app.heads.com/api/v1/trade-orders/com.myapp.orderId=ORD-001~with(manualDiscounts)"
```

> **Note:** Manual discounts are set at order creation; the `manualDiscount` field is read-only afterward. Check the `discountable` flag on items before applying.

---

## Trade Restrictions

```bash
# List trade restrictions
curl -X GET -u ":banana" "example.app.heads.com/api/v1/trade-restrictions"

# List trade restriction reasons
curl -X GET -u ":banana" "example.app.heads.com/api/v1/trade-restriction-reasons"

# Create trade restriction reason
curl -X POST -u ":banana" "example.app.heads.com/api/v1/trade-restriction-reasons" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.reasonId": "AGE-RESTRICTED"},
    "name": "Age Restricted Product",
    "description": "Requires age verification before purchase"
  }'
```

---

## Planned Features (Not Yet Supported)

The following discount capabilities are planned for future releases:

| Feature | Status | Notes |
|---------|--------|-------|
| Maximum discount caps | Planned | Per-rule or per-order caps on total discount amount |
| Discount vouchers | Planned | One-time voucher codes redeemable as discount rules |

For the latest status on these features, contact your CommerceOS representative.
