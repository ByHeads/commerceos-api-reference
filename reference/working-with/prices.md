# Working with Prices

This guide is the definitive playbook for pricing in CommerceOS. It covers the price domain end-to-end: price creation, validity periods, seller/buyer scoping, currency handling, open prices, and integration patterns.

---

## Table of Contents

1. [Overview](#overview)
2. [Glossary](#glossary)
3. [Field Reference](#field-reference)
4. [Net vs Gross: The Core Concept](#net-vs-gross-the-core-concept)
5. [Creating Prices](#creating-prices)
6. [Price Scoping](#price-scoping)
7. [Validity Periods](#validity-periods)
8. [Open Prices](#open-prices)
9. [Currency Management](#currency-management)
10. [Price Selection Logic](#price-selection-logic)
11. [Product-Price Relationships](#product-price-relationships)
12. [Endpoint Matrix](#endpoint-matrix)
13. [Finder and Query Patterns](#finder-and-query-patterns)
14. [Error Handling and Validation](#error-handling-and-validation)
15. [Integration Playbook: Price Sync](#integration-playbook-price-sync)
16. [Case Study: Multi-Store Seasonal Pricing](#case-study-multi-store-seasonal-pricing)
17. [Business Rules and Pitfalls](#business-rules-and-pitfalls)
18. [Related Guides](#related-guides)

---

## Overview

Prices in CommerceOS store **net amounts** (VAT excluded). The system calculates gross amounts at transaction time using the product's VAT code. This separation ensures pricing remains accurate across different tax jurisdictions.

**Key Characteristics:**
- Prices are NET (VAT is calculated separately at transaction time)
- Prices are scoped by seller, optionally by buyer, and optionally by time period
- Multiple prices for the same product support different contexts (wholesale vs retail, seasonal, customer-specific)
- Currency defaults to USD if omitted (recommended to always set explicitly)
- Prices are linked to products (one-to-many: a product can have many prices)

**Domain Relationships:**
```
Prices  ↔  Products (prices apply to one or more products)
    ↔  Sellers (agents: stores, companies that sell at this price)
    ↔  Buyers (agents: customers who get this price)
    ↔  Currency (every price has a currency)
    ↔  VAT Codes (tax applied via product's defaultVatCode)
    ↔  Orders (order items use applicable prices)
    ↔  Receipts (final transaction records)
```

---

## Glossary

| Term | Description |
|------|-------------|
| **Net Amount** | Price excluding VAT (what you store) |
| **Gross Amount** | Price including VAT (calculated at transaction time) |
| **Seller** | Agent (store, company) authorized to sell at this price |
| **Buyer** | Agent (customer) eligible for this price |
| **Validity Period** | Time range during which price is active (`from`/`to`) |
| **Open Price** | Price determined at sale time (e.g., custom orders) |
| **Currency** | ISO 4217 currency (SEK, EUR, USD, etc.) |
| **Price Scoping** | Restricting price applicability by seller/buyer/time |

---

## Field Reference

### Core Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `identifiers` | object | — | Namespaced external IDs |
| `amount` | string (decimal) | `"0"` | Net price (VAT excluded). Defaults to zero if omitted. |
| `currency` | reference | `USD` | Currency reference. Defaults to USD if omitted. |
| `products` | array | `[]` | Products this price applies to. Can be omitted or empty. |

> **Recommendation:** Always explicitly set `amount`, `currency`, and `products` for clarity. Relying on defaults can lead to unexpected behavior in production integrations.

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `sellers` | array | Agents eligible to sell at this price. **Empty array = all sellers** (no restriction). |
| `buyers` | array | Agents eligible to buy at this price. **Empty array = all buyers** (no restriction). |
| `from` | datetime | Valid from date/time (inclusive) |
| `to` | datetime | Valid until date/time (exclusive — the instant the price stops applying) |
| `open` | boolean | If true, amount is entered at sale time |

### Read-Only Fields

| Field | Description |
|-------|-------------|
| `identifiers.key` | System-generated UUID |

---

## Net vs Gross: The Core Concept

CommerceOS stores prices as **NET** (VAT excluded). This is fundamental to understand.

### Why Net?

1. **Tax jurisdiction flexibility** - Same product can have different VAT rates in different countries
2. **Consistent pricing math** - Net + VAT = Gross calculation is unambiguous
3. **Integration clarity** - External systems often work with net prices

### Conversion Formulas

```
VAT Amount = Net Amount × (VAT Rate / 100)
Gross Amount = Net Amount + VAT Amount
Net Amount = Gross Amount / (1 + VAT Rate / 100)
```

### Worked Examples

**25% VAT (standard rate):**
```
Net:   199.00 SEK
VAT:    49.75 SEK (199.00 × 0.25)
Gross: 248.75 SEK
```

**12% VAT (food/restaurant):**
```
Net:    89.00 SEK
VAT:    10.68 SEK (89.00 × 0.12)
Gross:  99.68 SEK
```

**0% VAT (exports/exempt):**
```
Net:   500.00 SEK
VAT:     0.00 SEK
Gross: 500.00 SEK
```

### Converting VAT-Inclusive Prices

If your source system has gross (VAT-inclusive) prices:

```
Net = Gross / (1 + VAT Rate / 100)

Example (25% VAT):
Gross: 249.00 SEK
Net:   249.00 / 1.25 = 199.20 SEK

Example (12% VAT):
Gross: 112.00 SEK
Net:   112.00 / 1.12 = 100.00 SEK
```

Store the calculated net amount in the price, and ensure the product's `defaultVatCode` is set correctly.

---

## Creating Prices

### Basic Price

```bash
POST /v1/prices
{
  "identifiers": {"com.example.priceId": "PRICE-001"},
  "products": [{"identifiers": {"com.example.sku": "PROD-001"}}],
  "sellers": [{"identifiers": {"com.example.companyId": "OUR-COMPANY"}}],
  "amount": "199.00",
  "currency": {"identifiers": {"currencyCode": "SEK"}}
}
```

> **Note:** The `sellers` and `buyers` arrays are optional. Omit them or use empty arrays (`[]`) for global pricing. See [Price Scoping](#price-scoping) for details.

### Price with Validity Period

```bash
POST /v1/prices
{
  "identifiers": {"com.example.priceId": "PRICE-SUMMER"},
  "products": [{"identifiers": {"com.example.sku": "PROD-001"}}],
  "sellers": [{"identifiers": {"com.example.companyId": "OUR-COMPANY"}}],
  "amount": "149.00",
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "from": "2024-06-01T00:00:00Z",
  "to": "2024-08-31T23:59:59Z"
}
```

### Buyer-Specific Price (Wholesale)

```bash
POST /v1/prices
{
  "identifiers": {"com.example.priceId": "PRICE-WHOLESALE"},
  "products": [{"identifiers": {"com.example.sku": "PROD-001"}}],
  "sellers": [{"identifiers": {"com.example.companyId": "OUR-COMPANY"}}],
  "buyers": [{"identifiers": {"com.example.customerId": "WHOLESALE-CUST"}}],
  "amount": "150.00",
  "currency": {"identifiers": {"currencyCode": "SEK"}}
}
```

### Multiple Products, Single Price

```bash
POST /v1/prices
{
  "identifiers": {"com.example.priceId": "PRICE-BUNDLE"},
  "products": [
    {"identifiers": {"com.example.sku": "PROD-001"}},
    {"identifiers": {"com.example.sku": "PROD-002"}},
    {"identifiers": {"com.example.sku": "PROD-003"}}
  ],
  "sellers": [{"identifiers": {"com.example.companyId": "OUR-COMPANY"}}],
  "amount": "99.00",
  "currency": {"identifiers": {"currencyCode": "SEK"}}
}
```

### Using PUT for Upsert

```bash
# Creates if not exists, updates if exists
PUT /v1/prices/com.example.priceId=PRICE-001
{
  "products": [{"identifiers": {"com.example.sku": "PROD-001"}}],
  "sellers": [{"identifiers": {"com.example.companyId": "OUR-COMPANY"}}],
  "amount": "199.00",
  "currency": {"identifiers": {"currencyCode": "SEK"}}
}
```

---

## Price Scoping

Prices can be scoped by seller, buyer, and time to create flexible pricing structures.

### Default Scoping (Global Prices)

When `sellers` or `buyers` arrays are **empty or omitted**, the price applies universally on that dimension:

| `sellers` | `buyers` | Meaning |
|-----------|----------|---------|
| `[]` or omitted | `[]` or omitted | **Global price** — all sellers, all buyers |
| `[]` or omitted | `[{...}]` | Buyer-specific — any seller, specific buyers |
| `[{...}]` | `[]` or omitted | Seller-specific — specific sellers, any buyer |
| `[{...}]` | `[{...}]` | Fully scoped — specific sellers AND specific buyers |

**Global price example (applies everywhere):**

```bash
POST /v1/prices
{
  "identifiers": {"com.example.priceId": "PROD-001-GLOBAL"},
  "products": [{"identifiers": {"com.example.sku": "PROD-001"}}],
  "sellers": [],
  "buyers": [],
  "amount": "199.00",
  "currency": {"identifiers": {"currencyCode": "SEK"}}
}
```

This price applies to all sellers and all buyers — useful for company-wide standard pricing.

> **Note:** Empty arrays mean "no restriction" (applies to all), not "no one can use this price."

### By Seller (Store-Specific Pricing)

Different stores can have different prices:

```bash
# Store A price
POST /v1/prices
{
  "identifiers": {"com.example.priceId": "PROD-001-STORE-A"},
  "products": [{"identifiers": {"com.example.sku": "PROD-001"}}],
  "sellers": [{"identifiers": {"com.example.storeId": "STORE-A"}}],
  "amount": "199.00",
  "currency": {"identifiers": {"currencyCode": "SEK"}}
}

# Store B price (different amount)
POST /v1/prices
{
  "identifiers": {"com.example.priceId": "PROD-001-STORE-B"},
  "products": [{"identifiers": {"com.example.sku": "PROD-001"}}],
  "sellers": [{"identifiers": {"com.example.storeId": "STORE-B"}}],
  "amount": "189.00",
  "currency": {"identifiers": {"currencyCode": "SEK"}}
}
```

### Multi-Store (Single Price for Multiple Sellers)

```bash
POST /v1/prices
{
  "identifiers": {"com.example.priceId": "PROD-001-ALL-STORES"},
  "products": [{"identifiers": {"com.example.sku": "PROD-001"}}],
  "sellers": [
    {"identifiers": {"com.example.storeId": "STORE-A"}},
    {"identifiers": {"com.example.storeId": "STORE-B"}},
    {"identifiers": {"com.example.storeId": "STORE-C"}}
  ],
  "amount": "199.00",
  "currency": {"identifiers": {"currencyCode": "SEK"}}
}
```

### By Buyer (Customer-Specific Pricing)

```bash
# VIP customer price
POST /v1/prices
{
  "identifiers": {"com.example.priceId": "PROD-001-VIP"},
  "products": [{"identifiers": {"com.example.sku": "PROD-001"}}],
  "sellers": [{"identifiers": {"com.example.companyId": "OUR-COMPANY"}}],
  "buyers": [{"identifiers": {"com.example.customerId": "VIP-CUSTOMER"}}],
  "amount": "179.00",
  "currency": {"identifiers": {"currencyCode": "SEK"}}
}

# Wholesale customer price
POST /v1/prices
{
  "identifiers": {"com.example.priceId": "PROD-001-WHOLESALE"},
  "products": [{"identifiers": {"com.example.sku": "PROD-001"}}],
  "sellers": [{"identifiers": {"com.example.companyId": "OUR-COMPANY"}}],
  "buyers": [{"identifiers": {"com.example.companyId": "WHOLESALE-CO"}}],
  "amount": "150.00",
  "currency": {"identifiers": {"currencyCode": "SEK"}}
}
```

---

## Validity Periods

Prices can have start and end dates for seasonal or promotional pricing.

### Time-Bounded Price

```bash
# Holiday sale price (active Dec 20-26)
POST /v1/prices
{
  "identifiers": {"com.example.priceId": "PROD-001-XMAS"},
  "products": [{"identifiers": {"com.example.sku": "PROD-001"}}],
  "sellers": [{"identifiers": {"com.example.companyId": "OUR-COMPANY"}}],
  "amount": "99.00",
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "from": "2024-12-20T00:00:00Z",
  "to": "2024-12-26T23:59:59Z"
}
```

### Open-Ended Start (No End Date)

```bash
# Price valid from a date, no end
POST /v1/prices
{
  "identifiers": {"com.example.priceId": "PROD-001-NEW"},
  "products": [{"identifiers": {"com.example.sku": "PROD-001"}}],
  "sellers": [{"identifiers": {"com.example.companyId": "OUR-COMPANY"}}],
  "amount": "219.00",
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "from": "2025-01-01T00:00:00Z"
}
```

### Updating Validity

```bash
PATCH /v1/prices/com.example.priceId=PROD-001-XMAS
{
  "from": "2024-12-18T00:00:00Z",
  "to": "2024-12-28T23:59:59Z"
}
```

### Validity Rules

| Scenario | `from` | `to` | Meaning |
|----------|--------|------|---------|
| Always valid | null | null | Active indefinitely |
| Future price | date | null | Active from date, no end |
| Past price | null | date | Was active until date |
| Window | date | date | Active within range |

---

## Open Prices

For products where price is determined at sale time (custom orders, weight-based, negotiated):

```bash
POST /v1/prices
{
  "identifiers": {"com.example.priceId": "CUSTOM-ITEM-PRICE"},
  "products": [{"identifiers": {"com.example.sku": "CUSTOM-ITEM"}}],
  "sellers": [{"identifiers": {"com.example.companyId": "OUR-COMPANY"}}],
  "open": true,
  "currency": {"identifiers": {"currencyCode": "SEK"}}
}
```

When `open: true`:
- The `amount` field is ignored (can be omitted)
- The actual price is entered at the point of sale
- Currency defaults to USD if omitted; set it explicitly to avoid unintended USD pricing

### Use Cases for Open Prices

- Custom fabrication or made-to-order items
- Weight-based produce
- Negotiated B2B pricing
- Services quoted per project

---

## Currency Management

### Available Currencies

```bash
# List all currencies
GET /v1/currencies

# Get currency by code
GET /v1/currencies/currencyCode=SEK

```

### Currency Fields

| Field | Description |
|-------|-------------|
| `identifiers.currencyCode` | ISO 4217 code (SEK, EUR, USD) |

> **Note:** Currency objects expose `identifiers.currencyCode` plus common identifiers (e.g., `identifiers.key` and namespaced IDs). Fields like `name`, `symbol`, and `decimalDigits` are not available on the currency schema, and there is no `denominations` member on the currency object (denominations are separate resources).

### Creating/Updating Currencies

```bash
PUT /v1/currencies/currencyCode=EUR
{
  "identifiers": {"currencyCode": "EUR"}
}
```

### Multi-Currency Pricing

Same product, different currencies:

```bash
# SEK price
POST /v1/prices
{
  "identifiers": {"com.example.priceId": "PROD-001-SEK"},
  "products": [{"identifiers": {"com.example.sku": "PROD-001"}}],
  "sellers": [{"identifiers": {"com.example.storeId": "STORE-SE"}}],
  "amount": "199.00",
  "currency": {"identifiers": {"currencyCode": "SEK"}}
}

# EUR price
POST /v1/prices
{
  "identifiers": {"com.example.priceId": "PROD-001-EUR"},
  "products": [{"identifiers": {"com.example.sku": "PROD-001"}}],
  "sellers": [{"identifiers": {"com.example.storeId": "STORE-DE"}}],
  "amount": "18.50",
  "currency": {"identifiers": {"currencyCode": "EUR"}}
}
```

---

## Price Selection Logic

When multiple prices exist for a product, CommerceOS filters to the eligible prices and returns the lowest net amount.

### Eligibility checks

1. **Currency match** - Price currency must match the transaction currency.
2. **Time validity** - Current date must be within `from`/`to` range (or null for open-ended)
3. **Seller match** - Price seller must match transaction seller, OR sellers array is empty (global)
4. **Buyer match** - Price buyer must match transaction buyer, OR buyers array is empty (all buyers)
5. **Quantity range** - Only simple prices without a quantity range are automatically selected.

### Empty Array Matching

| Price `sellers` | Transaction seller | Match? |
|-----------------|-------------------|--------|
| `[]` (empty) | Any seller | **Yes** — global price |
| `[Store-A]` | Store-A | Yes — specific match |
| `[Store-A]` | Store-B | No — seller not in list |

| Price `buyers` | Transaction buyer | Match? |
|----------------|------------------|--------|
| `[]` (empty) | Any buyer | **Yes** — open to all |
| `[VIP-Cust]` | VIP-Cust | Yes — specific match |
| `[VIP-Cust]` | Regular-Cust | No — buyer not in list |

### Selection outcome

- The **lowest net amount** among the eligible prices wins. If two prices share the same amount, the first encountered match is used—avoid equal amounts when you need deterministic overrides.
- Empty `sellers`/`buyers` arrays are global, so a cheaper global price can override a more specific seller/buyer price.

### Example Scenario

Product has these prices:
- Price A: Seller=Store1, Amount=199 (general)
- Price B: Seller=Store1, Buyer=VIP-Cust, Amount=179 (VIP)
- Price C: Seller=Store1, From=Dec 20, To=Dec 26, Amount=149 (holiday sale)
- Price D: Seller=Store1, Buyer=VIP-Cust, From=Dec 20, To=Dec 26, Amount=129 (VIP holiday)

Transaction at Store1 on Dec 22:
- Regular customer → Price C (149)
- VIP customer → Price D (129)

Transaction at Store1 on Jan 15:
- Regular customer → Price A (199)
- VIP customer → Price B (179)

---

## Product-Price Relationships

Prices can be managed two ways:

### Via Product's `prices` Sub-collection

```bash
# Get product's prices
GET /v1/products/com.example.sku=PROD-001/prices

# Get product with prices expanded
GET /v1/products/com.example.sku=PROD-001~with(prices)

# Replace all prices on product (FULL REPLACE)
PUT /v1/products/com.example.sku=PROD-001/prices
[
  {
    "identifiers": {"com.example.priceId": "PRICE-A"},
    "sellers": [{"identifiers": {"com.example.companyId": "..."}}],
    "amount": "199.00",
    "currency": {"identifiers": {"currencyCode": "SEK"}}
  }
]
```

> **Warning:** Setting prices via the product replaces ALL existing prices for that product.

### Via Standalone `/prices` Collection

```bash
# Create price independently (ADDITIVE)
POST /v1/prices
{
  "identifiers": {"com.example.priceId": "PRICE-B"},
  "products": [{"identifiers": {"com.example.sku": "PROD-001"}}],
  "sellers": [...],
  "amount": "...",
  "currency": {...}
}

# Update independently
PATCH /v1/prices/com.example.priceId=PRICE-B
{"amount": "189.00"}

# Delete independently
DELETE /v1/prices/com.example.priceId=PRICE-B
```

### Recommendation

Use the standalone `/prices` collection for integration scenarios. It's additive and gives you fine-grained control over individual prices.

---

## Endpoint Matrix

### When to Use What

| Goal | Method | Endpoint | Notes |
|------|--------|----------|-------|
| List all prices | GET | `/v1/prices~take(50)` | Paginate with `~skip` |
| Get single price | GET | `/v1/prices/{id}` | By identifier |
| Get with expansions | GET | `/v1/prices/{id}~with(products,sellers)` | Expand references |
| Create price | POST | `/v1/prices` | Returns created price |
| Create or update | PUT | `/v1/prices/{id}` | Upsert by identifier |
| Update price | PATCH | `/v1/prices/{id}` | Partial update |
| Delete price | DELETE | `/v1/prices/{id}` | Hard delete |
| Product's prices | GET | `/v1/products/{id}/prices` | Prices for product |
| Product with prices | GET | `/v1/products/{id}~with(prices)` | Inline expansion |

---

## Finder and Query Patterns

### Pagination with Operators

```bash
# First page
GET /v1/prices~orderBy(amount)~take(100)

# Next page
GET /v1/prices~orderBy(amount)~skip(100)~take(100)

# Count total
GET /v1/prices~count
```

### Pagination with Query Parameters

```bash
# First page
GET /v1/prices?orderby=amount&limit=100

# Next page
GET /v1/prices?orderby=amount&offset=100&limit=100
```

> **Note:** You can mix operators and query parameters. When both are present, the API normalizes them in this order: `format` -> `fields` -> `where` -> `orderBy` -> `skip` -> `take` -> `simpleJust`.

### Projections

```bash
# Include related data
GET /v1/prices~with(products,sellers,buyers,currency)

# All fields
GET /v1/prices/com.example.priceId=PRICE-001~withAll

# Just specific fields
GET /v1/prices~just(identifiers,amount,currency)
```

### Filtering

```bash
# Prices with sellers expanded (filter client-side for specific seller)
GET /v1/prices~with(sellers)~take(50)

# Prices in a specific currency
GET /v1/prices~with(currency)~where(currency/identifiers/currencyCode=SEK)~take(50)
```

---

## Error Handling and Validation

### Common 4xx Errors

| Status | Cause | Resolution |
|--------|-------|------------|
| 400 | Invalid amount format | Use string decimal (e.g., "199.00") |
| 400 | Invalid identifier format | Use `com.namespace.key` |
| 404 | Price not found | Verify identifier exists |
| 409 | Duplicate identifier | Use PUT for upsert |

### Field Defaults

The API applies these defaults when fields are omitted:

| Field | Default | Notes |
|-------|---------|-------|
| `currency` | `USD` | Defaults to USD if not specified |
| `amount` | `"0"` | Defaults to zero if not specified |
| `products` | `[]` | Empty array; price applies to no products |

> **Recommendation:** Always explicitly set `currency`, `amount`, and `products`. Relying on defaults can cause unexpected behavior (e.g., a price silently defaulting to USD instead of your intended currency).

### Validation Rules

1. **Currency recommendation:**
   ```bash
   # Always include for clarity (defaults to USD if omitted)
   "currency": {"identifiers": {"currencyCode": "SEK"}}
   ```

2. **Amount precision:**
   ```bash
   # Use string for decimal precision
   "amount": "199.99"  # Correct
   "amount": 199.99    # May lose precision
   ```

3. **Products recommendation:**
   ```bash
   # Include products for the price to be useful (defaults to empty if omitted)
   "products": [{"identifiers": {...}}]
   ```

4. **Sellers and buyers are optional:**
   ```bash
   # Empty or omitted = no restriction (applies to all)
   "sellers": [],  # All sellers can use this price
   "buyers": []    # All buyers can use this price
   ```

5. **Namespaced identifiers:**
   ```bash
   # WRONG
   {"identifiers": {"priceId": "..."}}

   # RIGHT
   {"identifiers": {"com.example.priceId": "..."}}
   ```

### Preconditions

For prices to function correctly at transaction time:

- Products should exist before referencing in prices (otherwise price selection may fail)
- Sellers (agents) should exist before referencing
- Currency should exist before referencing

> **Note:** The API does not validate these references at price creation time, but invalid references will cause issues during price selection.

---

## Integration Playbook: Price Sync

This section provides a phased approach to building a pricing integration.

### Phase 1: Prerequisites

**Checkpoint:** Products, sellers, and currencies exist

```bash
# Verify product exists
GET /v1/products/com.example.sku=PROD-001

# Verify seller exists
GET /v1/stores/com.example.storeId=STORE-001

# Verify currency exists
GET /v1/currencies/currencyCode=SEK
```

### Phase 2: Price Creation

**Checkpoint:** Prices created with proper scoping

```bash
# Use PUT for idempotent sync
PUT /v1/prices/com.example.priceId=PROD-001-STORE-001
{
  "products": [{"identifiers": {"com.example.sku": "PROD-001"}}],
  "sellers": [{"identifiers": {"com.example.storeId": "STORE-001"}}],
  "amount": "199.00",
  "currency": {"identifiers": {"currencyCode": "SEK"}}
}
```

### Phase 3: Handling Source Data Formats

**Converting gross prices to net:**

```javascript
// JavaScript example
function grossToNet(grossAmount, vatPercentage) {
  return grossAmount / (1 + vatPercentage / 100);
}

// Source: 249.00 SEK (VAT-inclusive, 25% VAT)
// Net: 249.00 / 1.25 = 199.20 SEK
const netAmount = grossToNet(249.00, 25);
```

### Phase 4: Bulk Price Sync

```bash
# Sync multiple prices in sequence
PUT /v1/prices/com.example.priceId=PROD-001-PRICE
{"amount": "199.00", "products": [...], "sellers": [...], "currency": {...}}

PUT /v1/prices/com.example.priceId=PROD-002-PRICE
{"amount": "299.00", "products": [...], "sellers": [...], "currency": {...}}

# Or use bulk POST for new prices
POST /v1/prices
[
  {"identifiers": {...}, "amount": "199.00", ...},
  {"identifiers": {...}, "amount": "299.00", ...}
]
```

### Phase 5: Verification

```bash
# Verify prices are created
GET /v1/products/com.example.sku=PROD-001~with(prices)

# Check price details
GET /v1/prices/com.example.priceId=PROD-001-PRICE~with(products,sellers)
```

---

## Case Study: Multi-Store Seasonal Pricing

This case study demonstrates a realistic pricing scenario with multiple stores and seasonal pricing.

### Scenario

- 3 stores (Stockholm, Gothenburg, Malmö)
- 1 product (Winter Jacket)
- Regular price, summer sale price, VIP customer price

### Step 1: Create Base Product

```bash
PUT /v1/products/com.example.sku=JACKET-001
{
  "name": "Premium Winter Jacket",
  "status": "Active",
  "defaultVatCode": {"identifiers": {"percentage": "25"}}
}
```

### Step 2: Create Regular Prices (All Stores)

```bash
# Single price for all stores
POST /v1/prices
{
  "identifiers": {"com.example.priceId": "JACKET-001-REGULAR"},
  "products": [{"identifiers": {"com.example.sku": "JACKET-001"}}],
  "sellers": [
    {"identifiers": {"com.example.storeId": "STORE-STOCKHOLM"}},
    {"identifiers": {"com.example.storeId": "STORE-GOTHENBURG"}},
    {"identifiers": {"com.example.storeId": "STORE-MALMO"}}
  ],
  "amount": "2399.00",
  "currency": {"identifiers": {"currencyCode": "SEK"}}
}
```

### Step 3: Create Summer Sale Price

```bash
POST /v1/prices
{
  "identifiers": {"com.example.priceId": "JACKET-001-SUMMER-SALE"},
  "products": [{"identifiers": {"com.example.sku": "JACKET-001"}}],
  "sellers": [
    {"identifiers": {"com.example.storeId": "STORE-STOCKHOLM"}},
    {"identifiers": {"com.example.storeId": "STORE-GOTHENBURG"}},
    {"identifiers": {"com.example.storeId": "STORE-MALMO"}}
  ],
  "amount": "1499.00",
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "from": "2024-06-01T00:00:00Z",
  "to": "2024-08-31T23:59:59Z"
}
```

### Step 4: Create VIP Customer Price

```bash
POST /v1/prices
{
  "identifiers": {"com.example.priceId": "JACKET-001-VIP"},
  "products": [{"identifiers": {"com.example.sku": "JACKET-001"}}],
  "sellers": [
    {"identifiers": {"com.example.storeId": "STORE-STOCKHOLM"}},
    {"identifiers": {"com.example.storeId": "STORE-GOTHENBURG"}},
    {"identifiers": {"com.example.storeId": "STORE-MALMO"}}
  ],
  "buyers": [{"identifiers": {"com.example.customerId": "VIP-CUST-001"}}],
  "amount": "1999.00",
  "currency": {"identifiers": {"currencyCode": "SEK"}}
}
```

### Step 5: Create VIP Summer Sale Price

```bash
POST /v1/prices
{
  "identifiers": {"com.example.priceId": "JACKET-001-VIP-SUMMER"},
  "products": [{"identifiers": {"com.example.sku": "JACKET-001"}}],
  "sellers": [
    {"identifiers": {"com.example.storeId": "STORE-STOCKHOLM"}},
    {"identifiers": {"com.example.storeId": "STORE-GOTHENBURG"}},
    {"identifiers": {"com.example.storeId": "STORE-MALMO"}}
  ],
  "buyers": [{"identifiers": {"com.example.customerId": "VIP-CUST-001"}}],
  "amount": "1199.00",
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "from": "2024-06-01T00:00:00Z",
  "to": "2024-08-31T23:59:59Z"
}
```

### Result Matrix

| Date | Customer | Applicable Price | Amount |
|------|----------|------------------|--------|
| Jan 15 | Regular | JACKET-001-REGULAR | 2399.00 SEK |
| Jan 15 | VIP | JACKET-001-VIP | 1999.00 SEK |
| Jul 15 | Regular | JACKET-001-SUMMER-SALE | 1499.00 SEK |
| Jul 15 | VIP | JACKET-001-VIP-SUMMER | 1199.00 SEK |

### Gross Calculation (25% VAT)

| Net Price | VAT (25%) | Gross Price |
|-----------|-----------|-------------|
| 2399.00 | 599.75 | 2998.75 SEK |
| 1999.00 | 499.75 | 2498.75 SEK |
| 1499.00 | 374.75 | 1873.75 SEK |
| 1199.00 | 299.75 | 1498.75 SEK |

---

## Business Rules and Pitfalls

### Critical Rules

1. **Prices are NET (VAT excluded):**
   ```
   Store net amount, not gross. VAT is calculated at transaction time.
   ```

2. **Currency defaults to USD:**
   ```bash
   # Always include currency explicitly (defaults to USD if omitted)
   "currency": {"identifiers": {"currencyCode": "SEK"}}
   ```

3. **Amount as string for precision:**
   ```bash
   # Use string
   "amount": "199.99"

   # Avoid floating point issues
   "amount": 199.99  # May cause rounding issues
   ```

4. **Query parameter and operator mixing:**
   ```bash
   # Both styles work and can be mixed
   GET /v1/prices~orderBy(amount)~take(10)
   GET /v1/prices?orderby=amount&limit=10
   GET /v1/prices~orderBy(amount)?limit=10
   ```
   When mixed, the API normalizes in this order: `format` -> `fields` -> `where` -> `orderBy` -> `skip` -> `take` -> `simpleJust`.

5. **Namespaced identifiers required:**
   ```bash
   # WRONG
   {"identifiers": {"priceId": "..."}}

   # RIGHT
   {"identifiers": {"com.example.priceId": "..."}}
   ```

6. **Validity period semantics:**
   - `from` is inclusive (price starts applying), `to` is exclusive (the instant the price stops applying)
   - Use full timestamps with timezone
   - Null means no boundary

### Common Mistakes

| Mistake | Result | Fix |
|---------|--------|-----|
| Storing gross instead of net | Incorrect tax calculations | Convert gross to net before storing |
| Omitting currency | Defaults to USD unexpectedly | Always include currency reference explicitly |
| Number instead of string for amount | Precision loss | Use `"199.00"` not `199.00` |
| Wrong validity range | Price not applied | Check `from`/`to` timestamps |
| Expecting sellers=[] to restrict | Price applies to ALL sellers | Use specific seller refs to restrict |

### Currency Considerations

- Prices are currency-specific (no automatic conversion)
- Orders must use one currency
- Multi-currency requires separate prices per currency

---

## Related Guides

- [Products](products.md) - Product catalog management
- [VAT](vat.md) - Tax calculation and net/gross formulas
- [Orders](orders.md) - Using prices in trade orders
- [Customers](customers.md) - Buyer-specific pricing
- [Stock](stock.md) - Inventory that prices apply to
