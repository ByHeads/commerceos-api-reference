# Discount Rules Examples

Curl examples for discount rules, manual discounts, and trade restrictions.

**Base URL:** `http://localhost:5000/api/v1`
**API Key:** `banana` (passed via Basic Auth with empty username: `-u ":banana"`)

> **See also:** [Examples Index](../examples.md) | [Orders & Fulfillment](./orders.md) | [Customer Groups](../../reference/working-with/customers.md#customer-groups) | [Reference Documentation](../../reference/)

---

## Discount Rule Anatomy

A discount rule defines **when** and **how** discounts apply. Key properties:

| Property | Purpose |
|----------|---------|
| `seller` / `buyer` | Scope the rule to specific sellers or buyer groups. The `buyer` condition accepts **customer group** identifiers (see [Customer Groups and Buyer Conditions](#customer-groups-and-buyer-conditions)). Use `include`/`exclude` arrays with identifier references. |
| `currency` | Restrict to specific currencies (e.g., `{"currencyCode": "SEK"}`). |
| `time` | Optional validity window with `start` and `end` dates (ISO format). |
| `phase` | Determines evaluation order. Rules in lower-priority phases apply first; higher-priority phases can stack on top. Include `identifiers`, `name`, and `priority`. |
| `items` | A **named map** of item groups. Each key (e.g., `"phone"`, `"plan"`) defines a group with `include`/`exclude` arrays, optional `atLeast`/`atMost` quantity constraints, and optional `worthAtLeast`/`worthAtMost` value thresholds. |
| `where.equals` | Links item groups by matching property paths (e.g., ensuring a phone's IMEI matches a plan's phoneImei for bundle discounts). |
| `effects` | Array of effect objects. Each effect must include `@type`, which items it targets, and how it applies. |
| `effects[].@type` | Effect type: `"percentage discount rule effect"`, `"fixed reduction discount rule effect"`, `"fixed price discount rule effect"`, or `"package discount rule effect"`. |
| `effects[].items` | **Must reference keys from the `items` map** (e.g., `["phone"]` or `["item1", "item2"]`). |
| `effects[].multiplicity` | `"PerUnit"` (applies to each qualifying unit) or `"PerApplication"` (applies once per rule match). |
| `effects[].targeting` | `"All"` (affects all matching items), `"LowestValue"` (targets the cheapest item), or `"HighestValue"` (targets the most expensive item). |
| `effects[].minimumResultingPrice` | Floor price after discount (prevents negative prices). |
| `includesTax` | Whether the discount applies to tax-inclusive prices (`true`) or pre-tax prices (`false`). |
| `reason` | A reference to explain why the discount was applied (shown on receipts). |

```bash
# List all discount rules
curl -X GET -u ":banana" "localhost:5000/api/v1/discount-rules"

# Get discount rule by ID
curl -X GET -u ":banana" "localhost:5000/api/v1/discount-rules/com.heads.seedID=employee-discount"
```

---

## Example 1: Employee Apparel Percentage Discount (Category-Based)

This rule gives employees 10% off apparel products:

```bash
curl -X POST -u ":banana" "localhost:5000/api/v1/discount-rules" \
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
curl -X POST -u ":banana" "localhost:5000/api/v1/discount-rules" \
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
curl -X POST -u ":banana" "localhost:5000/api/v1/discount-rules" \
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
curl -X POST -u ":banana" "localhost:5000/api/v1/discount-rules" \
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
curl -X POST -u ":banana" "localhost:5000/api/v1/discount-rules" \
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
curl -X POST -u ":banana" "localhost:5000/api/v1/discount-rules" \
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
curl -X POST -u ":banana" "localhost:5000/api/v1/discount-rules" \
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
curl -X POST -u ":banana" "localhost:5000/api/v1/discount-rules" \
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
curl -X POST -u ":banana" "localhost:5000/api/v1/discount-rules" \
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
curl -X POST -u ":banana" "localhost:5000/api/v1/discount-rules" \
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

> **Warning:** The qualifier group's `include` must be **non-empty**. An empty `include` targets no products and the rule will never match. Use a top-level product group to match all products.

The `worthAtLeast` field is a **value-based** threshold (decimal), unlike `atLeast`/`atMost` which are quantity-based. It checks the total value of matched items accumulated up to the current phase.

| Field | Type | Description |
|-------|------|-------------|
| `worthAtLeast` | `decimal?` | Minimum total value (up to this phase) of matched products |
| `worthAtMost` | `decimal?` | Maximum total value (up to this phase) of matched products |

> **Note:** `worthAtLeast` evaluates the sum of effects applied to matched items by preceding phases. This means the threshold is based on the accumulated price after earlier discount phases have been applied, not the original list price.

```bash
# When purchasing for at least 10,000 SEK, get 10% off all accessories
curl -X POST -u ":banana" "localhost:5000/api/v1/discount-rules" \
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
curl -X POST -u ":banana" "localhost:5000/api/v1/discount-rules" \
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

# Find all trade relationships in a group
GET /v1/trade-relationships~where(groups~any(identifiers/com.example.groupId=employee-customers))
```

> For full customer group management documentation (creating groups, assigning members, querying membership), see [Working with Customers — Customer Groups](../../reference/working-with/customers.md#customer-groups).

---

## Manual Discounts (Ad-Hoc at POS)

Manual discounts are applied directly to trade orders, not through discount rules. They are set on individual items at order creation time via the `manualDiscount` field:

```bash
# Create order with manual discount on an item
curl -X POST -u ":banana" "localhost:5000/api/v1/trade-orders" \
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
curl -X GET -u ":banana" "localhost:5000/api/v1/trade-orders/com.myapp.orderId=ORD-001~with(manualDiscounts)"
```

> **Note:** Manual discounts are set at order creation; the `manualDiscount` field is read-only afterward. Check the `discountable` flag on items before applying.

---

## Trade Restrictions

```bash
# List trade restrictions
curl -X GET -u ":banana" "localhost:5000/api/v1/trade-restrictions"

# List trade restriction reasons
curl -X GET -u ":banana" "localhost:5000/api/v1/trade-restriction-reasons"

# Create trade restriction reason
curl -X POST -u ":banana" "localhost:5000/api/v1/trade-restriction-reasons" \
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
