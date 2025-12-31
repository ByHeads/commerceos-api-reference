# Working with VAT

This guide is the definitive playbook for VAT (Value Added Tax) handling in CommerceOS. It covers the VAT domain end-to-end: VAT codes, rate management, net/gross calculations, product inheritance, receipt VAT groups, and multi-country setup.

---

## Table of Contents

1. [Overview](#overview)
2. [Glossary](#glossary)
3. [Field Reference](#field-reference)
4. [Net vs Gross: Core Formulas](#net-vs-gross-core-formulas)
5. [VAT Codes](#vat-codes)
6. [Assigning VAT to Products](#assigning-vat-to-products)
7. [VAT Inheritance (Product Groups)](#vat-inheritance-product-groups)
8. [VAT in Trade Orders](#vat-in-trade-orders)
9. [VAT in Receipts](#vat-in-receipts)
10. [Multi-Country VAT Setup](#multi-country-vat-setup)
11. [Endpoint Matrix](#endpoint-matrix)
12. [Error Handling and Validation](#error-handling-and-validation)
13. [Integration Playbook: VAT Sync](#integration-playbook-vat-sync)
14. [Case Study: Multi-Rate Retail Setup](#case-study-multi-rate-retail-setup)
15. [Business Rules and Pitfalls](#business-rules-and-pitfalls)
16. [Related Guides](#related-guides)

---

## Overview

CommerceOS handles VAT through **VAT codes** that define tax rates. Products reference VAT codes, and the system calculates tax at transaction time. This separation ensures accurate tax handling across different jurisdictions.

**Key Characteristics:**
- VAT codes are identified primarily by percentage
- Products inherit VAT from parent groups if not explicitly set
- Prices are stored as NET amounts (VAT excluded)
- Gross amounts are calculated at transaction time
- Receipts include VAT group breakdowns for reporting

**Domain Relationships:**
```
VAT Codes  ↔  Products (via defaultVatCode field)
    ↔  Product Groups (VAT inheritance)
    ↔  Prices (net amounts only)
    ↔  Trade Orders (items include VAT percentage)
    ↔  Receipts (vatGroups breakdown)
    ↔  Countries (multi-jurisdiction support)
```

---

## Glossary

| Term | Description |
|------|-------------|
| **VAT Code** | A tax rate definition (e.g., 25%, 12%, 0%) |
| **Net Amount** | Price excluding VAT |
| **Gross Amount** | Price including VAT (net + VAT) |
| **VAT Amount** | The tax portion (gross - net) |
| **VAT Group** | Breakdown in receipts by tax rate |
| **VAT Inheritance** | Products inheriting rate from parent group |
| **Standard Rate** | Most common rate (e.g., 25% in Sweden) |
| **Reduced Rate** | Lower rate for specific goods (e.g., 12% for food) |
| **Zero Rate** | 0% rate for exports or exempt items |

---

## Field Reference

### VAT Code Fields

| Field | Type | Description |
|-------|------|-------------|
| `identifiers.percentage` | decimal | VAT percentage rate (e.g., 25, 12, 0) |
| `identifiers.<namespace>` | string | Optional external ID (namespaced, e.g., `com.example.vatCodeId`) |
| `identifiers.key` | string | System UUID (read-only) |
| `products` | array | Products using this VAT code |

### VAT Group Fields (in Receipts)

| Field | Type | Description |
|-------|------|-------------|
| `percentage` | decimal | VAT rate |
| `quantity` | decimal | Number of items in this group |
| `netAmount` | decimal | Total net for this group |
| `grossAmount` | decimal | Total gross for this group |
| `vatAmount` | decimal | Total VAT for this group |

---

## Net vs Gross: Core Formulas

Understanding net/gross math is fundamental to VAT handling.

### Formulas

```
VAT Amount = Net Amount × (VAT Rate / 100)
Gross Amount = Net Amount + VAT Amount
Net Amount = Gross Amount / (1 + VAT Rate / 100)
VAT Amount = Gross Amount - Net Amount
```

### Worked Examples

**25% VAT (Standard):**
```
Net:     199.00 SEK
VAT:      49.75 SEK (199.00 × 0.25)
Gross:   248.75 SEK (199.00 + 49.75)
```

**12% VAT (Food/Restaurant):**
```
Net:      89.00 SEK
VAT:      10.68 SEK (89.00 × 0.12)
Gross:    99.68 SEK (89.00 + 10.68)
```

**6% VAT (Books/Transport):**
```
Net:     150.00 SEK
VAT:       9.00 SEK (150.00 × 0.06)
Gross:   159.00 SEK (150.00 + 9.00)
```

**0% VAT (Exports/Exempt):**
```
Net:     500.00 SEK
VAT:       0.00 SEK
Gross:   500.00 SEK
```

### Converting Gross to Net

If your source system has VAT-inclusive (gross) prices:

```
Net = Gross / (1 + VAT Rate / 100)

25% VAT:
  Gross: 249.00 SEK → Net: 249.00 / 1.25 = 199.20 SEK

12% VAT:
  Gross: 112.00 SEK → Net: 112.00 / 1.12 = 100.00 SEK

6% VAT:
  Gross: 106.00 SEK → Net: 106.00 / 1.06 = 100.00 SEK
```

### Multi-Item Totals

For an order with multiple items at different VAT rates:

| Item | Net | VAT Rate | VAT | Gross |
|------|-----|----------|-----|-------|
| Phone | 7999.00 | 25% | 1999.75 | 9998.75 |
| Case | 199.00 | 25% | 49.75 | 248.75 |
| Snack | 30.00 | 12% | 3.60 | 33.60 |
| **Total** | **8228.00** | — | **2053.10** | **10281.10** |

---

## VAT Codes

### Creating VAT Codes

VAT codes are identified by percentage:

```bash
# Standard rate (25%)
POST /v1/vat-codes
{
  "identifiers": {"percentage": 25}
}

# Reduced rate (12%)
POST /v1/vat-codes
{
  "identifiers": {"percentage": 12}
}

# Lower reduced rate (6%)
POST /v1/vat-codes
{
  "identifiers": {"percentage": 6}
}

# Zero rate (0%)
POST /v1/vat-codes
{
  "identifiers": {"percentage": 0}
}
```

### With Custom ID

```bash
POST /v1/vat-codes
{
  "identifiers": {
    "com.example.vatCodeId": "SE25",
    "percentage": 25
  }
}
```

### Querying VAT Codes

```bash
# List all VAT codes
GET /v1/vat-codes

# Get by percentage (primary index)
GET /v1/vat-codes/percentage=25

# Get by custom ID (namespaced external identifier)
GET /v1/vat-codes/com.example.vatCodeId=SE25

# Get with products using this code
GET /v1/vat-codes/percentage=25~with(products)
```

### Common VAT Rates by Country

| Country | Standard | Reduced | Lower | Zero |
|---------|----------|---------|-------|------|
| Sweden (SE) | 25% | 12% | 6% | 0% |
| Germany (DE) | 19% | 7% | — | 0% |
| Norway (NO) | 25% | 15% | 12% | 0% |
| Denmark (DK) | 25% | — | — | 0% |
| Finland (FI) | 24% | 14% | 10% | 0% |
| UK (GB) | 20% | 5% | — | 0% |
| France (FR) | 20% | 10% | 5.5% | 0% |

---

## Assigning VAT to Products

### Direct Assignment

Set VAT code directly on the product:

```bash
POST /v1/products
{
  "identifiers": {"com.example.sku": "PROD-001"},
  "name": "Standard Product",
  "defaultVatCode": {"identifiers": {"percentage": "25"}},
  "status": "Active"
}
```

### Update Existing Product

```bash
PATCH /v1/products/com.example.sku=PROD-001
{
  "defaultVatCode": {"identifiers": {"percentage": "12"}}
}
```

### Reference by Custom ID

```bash
POST /v1/products
{
  "identifiers": {"com.example.sku": "PROD-002"},
  "name": "Food Product",
  "defaultVatCode": {"identifiers": {"com.example.vatCodeId": "SE12"}},
  "status": "Active"
}
```

---

## VAT Inheritance (Product Groups)

VAT codes cascade down the product hierarchy. This allows setting a default rate on a group that applies to all products within it.

### Inheritance Hierarchy

```
Product Group (defaultVatCode: 12%)
  └── Product Family (inherits 12%)
       └── Product (inherits 12%, unless overridden)
```

### Setting VAT on a Group

```bash
# Create group with VAT code
POST /v1/product-groups
{
  "identifiers": {"com.example.groupId": "FOOD-ITEMS"},
  "name": "Food Items",
  "defaultVatCode": {"identifiers": {"percentage": "12"}}
}
```

### Products Inherit from Group

```bash
# This product inherits 12% from FOOD-ITEMS group
POST /v1/products
{
  "identifiers": {"com.example.sku": "FOOD-001"},
  "name": "Organic Apples",
  "parentGroup": {"identifiers": {"com.example.groupId": "FOOD-ITEMS"}},
  "status": "Active"
}
# No defaultVatCode specified → inherits 12% from group
```

### Override at Product Level

```bash
# This product overrides to 25% despite being in FOOD-ITEMS group
POST /v1/products
{
  "identifiers": {"com.example.sku": "FOOD-002"},
  "name": "Premium Gift Box",
  "parentGroup": {"identifiers": {"com.example.groupId": "FOOD-ITEMS"}},
  "defaultVatCode": {"identifiers": {"percentage": "25"}},
  "status": "Active"
}
```

### Inheritance Rules

1. Product's `defaultVatCode` takes precedence if set
2. Otherwise, parent group's `defaultVatCode` is used
3. If no group or group has no VAT code, product has no default VAT
4. Inheritance is resolved at transaction time

**Response note:** `defaultVatCode` in API responses reflects **direct** VAT assignments only. Inherited VAT codes are applied during calculations by traversing `parentGroup`, even if the product response shows no `defaultVatCode`.

---

## VAT in Trade Orders

Trade order items include VAT information derived from the product:

### Order Creation

```bash
POST /v1/trade-orders
{
  "identifiers": {"com.example.orderId": "ORD-001"},
  "supplier": {"identifiers": {"com.example.companyId": "OUR-COMPANY"}},
  "customer": {"identifiers": {"com.example.personId": "CUST-001"}},
  "sellers": [{"identifiers": {"com.example.storeId": "STORE-001"}}],
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "items": [
    {
      "product": {"identifiers": {"com.example.sku": "PROD-001"}},
      "quantity": 2
    }
  ]
}
```

### Response Includes VAT

```json
{
  "identifiers": {"com.example.orderId": "ORD-001"},
  "items": [
    {
      "product": {"identifiers": {"com.example.sku": "PROD-001"}},
      "quantity": 2,
      "unitAmountInclVat": 248.75,
      "vatPercentage": 25,
      "totalAmount": 497.50
    }
  ],
  "totalAmount": 497.50
}
```

### Item VAT Fields (Read-Only)

| Field | Description |
|-------|-------------|
| `unitAmountInclVat` | Unit price including VAT |
| `vatPercentage` | Applied VAT rate |
| `totalAmount` | Line total (quantity × unitAmountInclVat) |

---

## VAT in Receipts

Receipts include a `vatGroups` breakdown for tax reporting:

### VAT Groups Structure

```json
{
  "identifiers": {"receiptID": "R-2024-001"},
  "items": [...],
  "vatGroups": [
    {
      "percentage": 25,
      "quantity": 3,
      "netAmount": 597.00,
      "grossAmount": 746.25,
      "vatAmount": 149.25
    },
    {
      "percentage": 12,
      "quantity": 1,
      "netAmount": 89.00,
      "grossAmount": 99.68,
      "vatAmount": 10.68
    }
  ],
  "totalAmount": 845.93,
  "totalTaxAmount": 159.93
}
```

### Querying Receipts with VAT

```bash
# Get receipt with VAT breakdown
GET /v1/receipts/key=abc123~with(vatGroups)

# Stream receipts with VAT for export
GET /v1/receipts~orderBy(timestamp:desc)~with(vatGroups)~take(100)

# NDJSON format for BI
GET /v1/receipts~orderBy(timestamp:desc)~with(vatGroups)
Accept: application/x-ndjson
```

### VAT Reporting from Receipts

Receipt `vatGroups` provides pre-calculated totals by rate, suitable for:
- Tax reporting
- VAT reconciliation
- Financial exports
- Accounting integration

Each VAT group contains:
- **percentage**: The VAT rate
- **quantity**: Count of items at this rate
- **netAmount**: Sum of net amounts at this rate
- **grossAmount**: Sum of gross amounts at this rate
- **vatAmount**: Sum of VAT amounts at this rate

---

## Multi-Country VAT Setup

### Country-Specific VAT Codes

Use namespaced custom IDs to distinguish VAT codes by country:

```bash
# Swedish rates
POST /v1/vat-codes
{
  "identifiers": {"com.example.vatCodeId": "SE25", "percentage": 25}
}

POST /v1/vat-codes
{
  "identifiers": {"com.example.vatCodeId": "SE12", "percentage": 12}
}

# German rates
POST /v1/vat-codes
{
  "identifiers": {"com.example.vatCodeId": "DE19", "percentage": 19}
}

POST /v1/vat-codes
{
  "identifiers": {"com.example.vatCodeId": "DE7", "percentage": 7}
}
```

### Organizing by Country

Option 1: Use country-specific custom IDs (namespaced, e.g., `com.example.vatCodeId=SE25`, `com.example.vatCodeId=DE19`)
Option 2: Use product groups per country
Option 3: Use assortment contexts with country-specific products

### Store-Level VAT

Different stores can apply different VAT based on location:

```bash
# Swedish store - products use SE rates
PATCH /v1/product-groups/com.example.groupId=SE-STANDARD-GOODS
{
  "defaultVatCode": {"identifiers": {"com.example.vatCodeId": "SE25"}}
}

# German store - products use DE rates
PATCH /v1/product-groups/com.example.groupId=DE-STANDARD-GOODS
{
  "defaultVatCode": {"identifiers": {"com.example.vatCodeId": "DE19"}}
}
```

---

## Endpoint Matrix

### When to Use What

| Goal | Method | Endpoint | Notes |
|------|--------|----------|-------|
| List VAT codes | GET | `/v1/vat-codes` | All codes |
| Get by percentage | GET | `/v1/vat-codes/percentage=25` | Primary index |
| Get by custom ID | GET | `/v1/vat-codes/com.example.vatCodeId=SE25` | Namespaced external ID |
| Create VAT code | POST | `/v1/vat-codes` | Returns created code |
| Create or update | PUT | `/v1/vat-codes/percentage=25` | Upsert |
| Update VAT code | PATCH | `/v1/vat-codes/percentage=25` | Partial update |
| Get products using code | GET | `/v1/vat-codes/percentage=25~with(products)` | Expansion |
| Set product VAT | PATCH | `/v1/products/{id}` | Set defaultVatCode |
| Set group VAT | PATCH | `/v1/product-groups/{id}` | Set defaultVatCode |
| Get receipt VAT groups | GET | `/v1/receipts/{id}~with(vatGroups)` | Receipt VAT |

---

## Error Handling and Validation

### Common 4xx Errors

| Status | Cause | Resolution |
|--------|-------|------------|
| 400 | Invalid percentage format | Use decimal number (25, 12, 6) |
| 409 | Duplicate percentage | VAT codes are unique by percentage; use PUT/PATCH (or array POST) to update |
| 404 | VAT code not found | Verify percentage or namespaced ID exists |
| 400 | Invalid product VAT reference | Ensure VAT code exists first |

**Note:** Single-object `POST /v1/vat-codes` against an existing `percentage` returns `409 Conflict`. Use `PUT`/`PATCH` (or array `POST`) when updating existing VAT codes.

### Validation Rules

1. **Percentage is the primary identifier:**
   ```bash
   # Reference by percentage
   {"identifiers": {"percentage": "25"}}

   # Or by namespaced custom ID
   {"identifiers": {"com.example.vatCodeId": "SE25"}}
   ```

2. **Percentage format:**
   ```bash
   # Correct formats
   {"percentage": 25}     # Integer
   {"percentage": 12.5}   # Decimal
   {"percentage": "25"}   # String (auto-converted)
   ```

3. **Product VAT code must exist:**
   ```bash
   # Create VAT code first
   POST /v1/vat-codes {"identifiers": {"percentage": 25}}

   # Then reference in product
   PATCH /v1/products/... {"defaultVatCode": {...}}
   ```

### Preconditions

- VAT codes must exist before referencing in products
- Products without VAT code and without parent group have no default VAT
- VAT is applied at transaction time, not stored with prices

---

## Integration Playbook: VAT Sync

This section provides a phased approach to setting up VAT for an integration.

### Phase 1: Create VAT Codes

**Checkpoint:** All needed VAT rates exist

```bash
# Create standard rates
PUT /v1/vat-codes/percentage=25
{"identifiers": {"percentage": 25}}

PUT /v1/vat-codes/percentage=12
{"identifiers": {"percentage": 12}}

PUT /v1/vat-codes/percentage=6
{"identifiers": {"percentage": 6}}

PUT /v1/vat-codes/percentage=0
{"identifiers": {"percentage": 0}}
```

### Phase 2: Set Up Product Groups

**Checkpoint:** Groups have default VAT for inheritance

```bash
# Standard goods group (25%)
POST /v1/product-groups
{
  "identifiers": {"com.example.groupId": "STANDARD-GOODS"},
  "name": "Standard Goods",
  "defaultVatCode": {"identifiers": {"percentage": "25"}}
}

# Food group (12%)
POST /v1/product-groups
{
  "identifiers": {"com.example.groupId": "FOOD-ITEMS"},
  "name": "Food Items",
  "defaultVatCode": {"identifiers": {"percentage": "12"}}
}

# Books/media group (6%)
POST /v1/product-groups
{
  "identifiers": {"com.example.groupId": "BOOKS-MEDIA"},
  "name": "Books and Media",
  "defaultVatCode": {"identifiers": {"percentage": "6"}}
}
```

### Phase 3: Assign Products to Groups

**Checkpoint:** Products inherit VAT from groups

```bash
# Electronics → Standard (25%)
PATCH /v1/products/com.example.sku=PHONE-001
{
  "parentGroup": {"identifiers": {"com.example.groupId": "STANDARD-GOODS"}}
}

# Food → Reduced (12%)
PATCH /v1/products/com.example.sku=COFFEE-001
{
  "parentGroup": {"identifiers": {"com.example.groupId": "FOOD-ITEMS"}}
}
```

### Phase 4: Override Exceptions

**Checkpoint:** Special cases have explicit VAT

```bash
# Gift box in food group, but uses standard rate
PATCH /v1/products/com.example.sku=GIFTBOX-001
{
  "defaultVatCode": {"identifiers": {"percentage": "25"}}
}
```

### Phase 5: Verification

```bash
# Verify product has correct VAT
GET /v1/products/com.example.sku=PHONE-001~with(defaultVatCode)

# Test order creation and VAT calculation
POST /v1/trade-orders
{...}
# Check response includes correct vatPercentage
```

---

## Case Study: Multi-Rate Retail Setup

This case study demonstrates setting up a retail store with multiple VAT rates.

### Scenario

- Swedish retail store
- Three product categories: Electronics (25%), Food (12%), Books (6%)
- Need correct VAT on receipts for reporting

### Step 1: Create VAT Codes

```bash
PUT /v1/vat-codes/percentage=25
{"identifiers": {"com.example.vatCodeId": "SE25", "percentage": 25}}

PUT /v1/vat-codes/percentage=12
{"identifiers": {"com.example.vatCodeId": "SE12", "percentage": 12}}

PUT /v1/vat-codes/percentage=6
{"identifiers": {"com.example.vatCodeId": "SE6", "percentage": 6}}
```

### Step 2: Create Product Groups

```bash
POST /v1/product-groups
{
  "identifiers": {"com.example.groupId": "ELECTRONICS"},
  "name": "Electronics",
  "defaultVatCode": {"identifiers": {"percentage": "25"}}
}

POST /v1/product-groups
{
  "identifiers": {"com.example.groupId": "FOOD"},
  "name": "Food & Beverages",
  "defaultVatCode": {"identifiers": {"percentage": "12"}}
}

POST /v1/product-groups
{
  "identifiers": {"com.example.groupId": "BOOKS"},
  "name": "Books & Media",
  "defaultVatCode": {"identifiers": {"percentage": "6"}}
}
```

### Step 3: Create Sample Products

```bash
# Phone (inherits 25%)
PUT /v1/products/com.example.sku=IPHONE-16
{
  "name": "iPhone 16",
  "parentGroup": {"identifiers": {"com.example.groupId": "ELECTRONICS"}},
  "status": "Active"
}

# Coffee (inherits 12%)
PUT /v1/products/com.example.sku=COFFEE-ORGANIC
{
  "name": "Organic Coffee 500g",
  "parentGroup": {"identifiers": {"com.example.groupId": "FOOD"}},
  "status": "Active"
}

# Novel (inherits 6%)
PUT /v1/products/com.example.sku=BOOK-FICTION
{
  "name": "Best Seller Novel",
  "parentGroup": {"identifiers": {"com.example.groupId": "BOOKS"}},
  "status": "Active"
}
```

### Step 4: Create Test Order

```bash
POST /v1/trade-orders
{
  "identifiers": {"com.example.orderId": "ORD-TEST-001"},
  "supplier": {"identifiers": {"com.example.companyId": "OUR-COMPANY"}},
  "customer": {"identifiers": {"com.example.personId": "CUST-001"}},
  "sellers": [{"identifiers": {"com.example.storeId": "STORE-001"}}],
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "items": [
    {"product": {"identifiers": {"com.example.sku": "IPHONE-16"}}, "quantity": 1},
    {"product": {"identifiers": {"com.example.sku": "COFFEE-ORGANIC"}}, "quantity": 2},
    {"product": {"identifiers": {"com.example.sku": "BOOK-FICTION"}}, "quantity": 1}
  ]
}
```

### Expected VAT Breakdown

Assuming prices: Phone 7999 SEK (net), Coffee 79 SEK (net), Book 149 SEK (net)

| Item | Net | VAT % | VAT | Gross |
|------|-----|-------|-----|-------|
| iPhone 16 (×1) | 7999.00 | 25% | 1999.75 | 9998.75 |
| Coffee (×2) | 158.00 | 12% | 18.96 | 176.96 |
| Book (×1) | 149.00 | 6% | 8.94 | 157.94 |
| **Total** | **8306.00** | — | **2027.65** | **10333.65** |

### Receipt VAT Groups

```json
{
  "vatGroups": [
    {"percentage": 25, "quantity": 1, "netAmount": 7999.00, "grossAmount": 9998.75, "vatAmount": 1999.75},
    {"percentage": 12, "quantity": 2, "netAmount": 158.00, "grossAmount": 176.96, "vatAmount": 18.96},
    {"percentage": 6, "quantity": 1, "netAmount": 149.00, "grossAmount": 157.94, "vatAmount": 8.94}
  ],
  "totalAmount": 10333.65,
  "totalTaxAmount": 2027.65
}
```

---

## Business Rules and Pitfalls

### Critical Rules

1. **Store NET prices, not gross:**
   ```bash
   # Price is net (VAT excluded)
   "amount": "199.00"  # Not 248.75 (gross)
   ```

2. **VAT inheritance chain:**
   ```
   If product has defaultVatCode → use it
   Else if parent group has defaultVatCode → use it
   Else → no default VAT (must be specified elsewhere)
   ```

3. **Percentage is the primary identifier:**
   ```bash
   # Reference by percentage
   {"identifiers": {"percentage": "25"}}

   # Or by namespaced custom ID
   {"identifiers": {"com.example.vatCodeId": "SE25"}}
   ```

4. **Rounding in calculations:**
   ```
   VAT calculations may involve rounding.
   Receipt totals are authoritative.
   Always verify totals match expected values.
   ```

5. **Query parameter normalization order:**
   Query params and operators can be mixed. They are normalized in this order:
   `format → fields → where → orderBy → skip → take → simpleJust`
   ```bash
   # Both forms are equivalent after normalization
   GET /v1/vat-codes?take=10~orderBy(percentage)
   GET /v1/vat-codes~orderBy(percentage)~take(10)
   ```

### Common Mistakes

| Mistake | Result | Fix |
|---------|--------|-----|
| Storing gross as net | Double taxation | Convert gross to net: `gross / (1 + rate)` |
| Missing VAT code on product | No VAT applied | Set defaultVatCode or use parent group |
| Wrong percentage format | VAT code not found | Use decimal (25) not string with % (25%) |
| Forgetting product group VAT | Products have no VAT | Set defaultVatCode on groups |

### Calculation Edge Cases

1. **Rounding to 2 decimals:**
   ```
   Net 33.33 × 25% = 8.3325 → round to 8.33
   Gross = 33.33 + 8.33 = 41.66
   ```

2. **Multiple items at same rate:**
   ```
   Sum net amounts first, then calculate VAT on total
   Avoids cumulative rounding errors
   ```

3. **Mixed rates in one transaction:**
   ```
   Calculate VAT separately per rate
   Sum for totals
   ```

---

## Related Guides

- [Products](products.md) - Setting VAT on products, groups, and inheritance
- [Prices](prices.md) - Net price handling and conversions
- [Orders](orders.md) - VAT in trade order items
- [Receipts](../receipts.md) - VAT groups in completed transactions
- [Stock](stock.md) - Inventory (VAT is not on stock, only transactions)
