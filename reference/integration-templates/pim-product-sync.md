# PIM Integration Guide: Product Catalog Synchronization

This guide provides a comprehensive template for integrating CommerceOS with a Product Information Management (PIM) system. It covers full and incremental catalog sync, category hierarchies, pricing, media handling, multi-channel assortments, and operational patterns for production deployments.

---

## Executive Summary

Product catalog synchronization is the foundation of retail operations. When your PIM and CommerceOS share accurate, up-to-date product information, you unlock:

- **Consistent customer experience** — Same product info across POS, webshop, and mobile
- **Operational efficiency** — Single source of truth eliminates manual data entry
- **Dynamic pricing** — Time-based and channel-specific pricing flows from PIM
- **Inventory accuracy** — Stock levels tied to correct products
- **Compliance** — VAT codes and regulatory info flow through the entire stack

This guide provides a production-ready integration template with copy-paste payloads, sync patterns, and operational guidance.

---

## Table of Contents

1. [Business Value and ROI](#business-value-and-roi)
2. [Data Model Overview](#data-model-overview)
3. [Identifier Strategy](#identifier-strategy)
4. [Integration Architecture](#integration-architecture)
5. [Phase 1: Foundation Setup](#phase-1-foundation-setup)
6. [Phase 2: Full Catalog Sync](#phase-2-full-catalog-sync)
7. [Phase 3: Incremental Updates](#phase-3-incremental-updates)
8. [Phase 4: Pricing Synchronization](#phase-4-pricing-synchronization)
9. [Phase 5: Multi-Channel Assortments](#phase-5-multi-channel-assortments)
10. [Media and Asset Handling](#media-and-asset-handling)
11. [VAT and Currency Configuration](#vat-and-currency-configuration)
12. [Error Handling and Recovery](#error-handling-and-recovery)
13. [Backfill and Replay Patterns](#backfill-and-replay-patterns)
14. [Production Checklist](#production-checklist)
15. [Copy-Paste Payload Reference](#copy-paste-payload-reference)

---

## Business Value and ROI

### Quantifiable Benefits

| Benefit | Impact | How CommerceOS Enables It |
|---------|--------|---------------------------|
| **Reduced time-to-shelf** | 60-80% faster product launches | Bulk upsert via NDJSON streaming |
| **Price accuracy** | Near-zero pricing errors | Validity-windowed prices with seller/currency scoping |
| **Channel consistency** | Same data across all touchpoints | Assortment contexts per owner/channel |
| **Stock-product alignment** | Eliminated "ghost inventory" | Product identifiers link to stock places |
| **Tax compliance** | Correct VAT on every transaction | VAT codes cascade from product groups |

### Integration Cost vs Value

The investment in proper PIM integration pays off through:

1. **Launch velocity** — New products reach POS in minutes, not days
2. **Error reduction** — Automated sync eliminates manual keying errors
3. **Pricing agility** — Flash sales and promotions activate instantly
4. **Audit trail** — Clear identifier linkage for compliance

---

## Data Model Overview

### Product Node Hierarchy

CommerceOS organizes catalog data in a flexible hierarchy:

```
Product Node (base type)
  ├── Product (sellable items) ────────────► /v1/products
  ├── Product Family (variant containers) ──► /v1/product-families
  ├── Product Group (hierarchical) ─────────► /v1/product-groups
  ├── Product Set (bundles) ────────────────► /v1/product-sets
  └── Product Category (browsing) ──────────► /v1/product-categories
```

### Key Entities for PIM Sync

| Entity | Collection | Description | PIM Equivalent |
|--------|------------|-------------|----------------|
| Product | `/v1/products` | Sellable SKU | SKU, Item |
| Product Family | `/v1/product-families` | Variant container | Style, Base Product |
| Product Group | `/v1/product-groups` | Organizational hierarchy | Collection, Line |
| Product Category | `/v1/product-categories` | Browsing structure | Category, Department |
| Price | `/v1/prices` | Net amount + validity | Price List Entry |
| VAT Code | `/v1/vat-codes` | Tax rate | Tax Class |
| Label | `/v1/labels` | Custom tags | Attribute, Tag |

### Product Fields

| Field | Type | Description |
|-------|------|-------------|
| `identifiers` | object | Namespaced external IDs |
| `name` | string | Product display name |
| `status` | string | `Active`, `Inactive`, `Pending` |
| `gtin` | string[] | Barcode numbers (EAN, UPC) |
| `plu` | string[] | Price look-up codes |
| `instanceType` | string | Variant type (MobileDevice, Apparel) |
| `instanceProperties` | object | Variant attributes (e.g., `Apparel::size`, `Apparel::color`) |
| `defaultVatCode` | reference | VAT rate for this product |
| `parentGroup` | reference | Parent product group |
| `promotionTitle` | localized | Customer-facing title |
| `promotionDescription` | localized | Marketing description |
| `receiptText` | localized | Receipt line text |
| `keywords` | string | Search keywords |

### Product Status Lifecycle

```
[New Product] → Pending → Active → Inactive
                   ↑         ↓
                   └─────────┘ (can reactivate)
```

| Status | Description | Visibility |
|--------|-------------|------------|
| `Pending` | Draft, not yet published | Hidden from POS/webshop |
| `Active` | Available for sale | Visible and sellable |
| `Inactive` | Discontinued | Hidden, preserved for history |

---

## Identifier Strategy

### Recommended: Multi-Identifier Approach

Store PIM ID, GTIN, and any other business identifiers:

```json
{
  "identifiers": {
    "com.acme.pim-id": "PIM-PROD-00012345",
    "com.acme.sku": "SKU-WIDGET-BLU-M",
    "com.acme.gtin": "7312345678901"
  }
}
```

### Namespace Convention

Use reverse-domain notation based on your actual domain:

| Your Domain | Namespace Prefix | Example |
|-------------|------------------|---------|
| `acme.com` | `com.acme.` | `com.acme.pim-id` |
| `retailcorp.se` | `se.retailcorp.` | `se.retailcorp.item-code` |

### Identifier Key Naming

| PIM Entity | Recommended Key | Notes |
|------------|-----------------|-------|
| Product ID | `com.acme.pim-id` | Primary PIM identifier |
| SKU | `com.acme.sku` | If different from PIM ID |
| GTIN/EAN | `com.acme.gtin` | Store in both `identifiers` and `gtin[]` |
| Supplier code | `com.acme.supplier-sku` | Supplier's article number |
| Style/Family | `com.acme.style-id` | For variant grouping |

### Looking Up by Identifier

```bash
# Direct access by PIM ID
GET /v1/products/com.acme.pim-id=PIM-PROD-00012345

# Direct access by SKU
GET /v1/products/com.acme.sku=SKU-WIDGET-BLU-M

# Find by GTIN (use ~where, not direct indexer)
GET /v1/products~where(gtin=7312345678901)~first
```

---

## Integration Architecture

### Data Flow Pattern

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           PIM System                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ Products │  │Categories│  │  Prices  │  │  Media   │  │  VAT     │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  │
└───────┼─────────────┼─────────────┼─────────────┼─────────────┼────────┘
        │             │             │             │             │
        ▼             ▼             ▼             ▼             ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      Integration Layer                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────────┐   │
│  │ Transform/Map   │  │ Batch/Stream    │  │ Error Handling       │   │
│  └────────┬────────┘  └────────┬────────┘  └───────────┬──────────┘   │
└───────────┼────────────────────┼───────────────────────┼──────────────┘
            │                    │                       │
            ▼                    ▼                       ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         CommerceOS                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │ Products │  │Categories│  │  Prices  │  │  Images  │  │ VAT Codes│ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

### Sync Patterns

| Pattern | Description | Best For |
|---------|-------------|----------|
| **Full Sync** | Export entire catalog, upsert all | Initial load, reconciliation |
| **Incremental** | Export changes since last sync | Ongoing updates |
| **Event-Driven** | Push on PIM save/publish | Near-real-time updates |

### Recommended: Incremental with Periodic Full Sync

```
Daily:      Incremental sync (changed products only)
Weekly:     Full catalog reconciliation
On-Demand:  Event-driven for urgent updates (price changes, recalls)
```

---

## Phase 1: Foundation Setup

Before syncing products, establish the foundational data.

### Step 1: Create VAT Codes

VAT codes are identified by their percentage rate. The only supported identifier field is `percentage`.

```bash
# Standard VAT rates for Sweden
PUT /v1/vat-codes/percentage=25
{
  "identifiers": {"percentage": "25"}
}

PUT /v1/vat-codes/percentage=12
{
  "identifiers": {"percentage": "12"}
}

PUT /v1/vat-codes/percentage=6
{
  "identifiers": {"percentage": "6"}
}

PUT /v1/vat-codes/percentage=0
{
  "identifiers": {"percentage": "0"}
}
```

> **Note:** VAT codes accept only `identifiers.percentage`. Other fields like `name` are not persisted.

### Step 2: Create Currencies

Currencies are identified by their ISO 4217 currency code. `currencyCode` is the canonical identifier, but currencies also accept common identifiers (e.g., `identifiers.key` and namespaced IDs).

```bash
# Create or verify currencies
PUT /v1/currencies/currencyCode=SEK
{
  "identifiers": {"currencyCode": "SEK"}
}

PUT /v1/currencies/currencyCode=EUR
{
  "identifiers": {"currencyCode": "EUR"}
}
```

> **Note:** Currencies accept `identifiers.currencyCode` plus common identifiers (e.g., `identifiers.key`, namespaced IDs). Other fields like `name`, `symbol`, and `decimalDigits` are not persisted.

### Step 3: Create Category Hierarchy

Categories form a tree via the `childCategories` member. Create parent categories first, then add children.

```bash
# Root category
PUT /v1/product-categories/com.acme.cat-id=ROOT
{
  "identifiers": {"com.acme.cat-id": "ROOT"},
  "name": "All Products"
}

# Level 1 categories
PUT /v1/product-categories/com.acme.cat-id=ELECTRONICS
{
  "identifiers": {"com.acme.cat-id": "ELECTRONICS"},
  "name": "Electronics"
}

PUT /v1/product-categories/com.acme.cat-id=APPAREL
{
  "identifiers": {"com.acme.cat-id": "APPAREL"},
  "name": "Apparel"
}

# Add Level 1 as children of ROOT
POST /v1/product-categories/com.acme.cat-id=ROOT/childCategories
{
  "identifiers": {"com.acme.cat-id": "ELECTRONICS"}
}

POST /v1/product-categories/com.acme.cat-id=ROOT/childCategories
{
  "identifiers": {"com.acme.cat-id": "APPAREL"}
}

# Level 2 categories
PUT /v1/product-categories/com.acme.cat-id=PHONES
{
  "identifiers": {"com.acme.cat-id": "PHONES"},
  "name": "Smartphones"
}

PUT /v1/product-categories/com.acme.cat-id=ACCESSORIES
{
  "identifiers": {"com.acme.cat-id": "ACCESSORIES"},
  "name": "Accessories"
}

PUT /v1/product-categories/com.acme.cat-id=TSHIRTS
{
  "identifiers": {"com.acme.cat-id": "TSHIRTS"},
  "name": "T-Shirts"
}

# Add Level 2 as children of their parents
POST /v1/product-categories/com.acme.cat-id=ELECTRONICS/childCategories
{
  "identifiers": {"com.acme.cat-id": "PHONES"}
}

POST /v1/product-categories/com.acme.cat-id=ELECTRONICS/childCategories
{
  "identifiers": {"com.acme.cat-id": "ACCESSORIES"}
}

POST /v1/product-categories/com.acme.cat-id=APPAREL/childCategories
{
  "identifiers": {"com.acme.cat-id": "TSHIRTS"}
}
```

> **Note:** Product categories use `childCategories` for hierarchy, not a `parent` field. Create categories first, then establish parent-child relationships.

### Step 4: Create Product Groups (for VAT Inheritance)

Product groups enable VAT code inheritance across multiple products:

```bash
# Create product group with default VAT
POST /v1/product-groups
{
  "identifiers": {"com.acme.group-id": "STANDARD-VAT-PRODUCTS"},
  "name": "Standard VAT Products",
  "defaultVatCode": {"identifiers": {"percentage": "25"}}
}

POST /v1/product-groups
{
  "identifiers": {"com.acme.group-id": "FOOD-PRODUCTS"},
  "name": "Food Products",
  "defaultVatCode": {"identifiers": {"percentage": "12"}}
}
```

### Step 5: Create Labels (Tags)

```bash
# Create labels for product filtering
PUT /v1/labels/com.acme.label-id=new-arrival
{
  "identifiers": {"com.acme.label-id": "new-arrival"},
  "title": "New Arrival",
  "color": "#00FF00"
}

PUT /v1/labels/com.acme.label-id=sale
{
  "identifiers": {"com.acme.label-id": "sale"},
  "title": "On Sale",
  "color": "#FF0000"
}

PUT /v1/labels/com.acme.label-id=limited-edition
{
  "identifiers": {"com.acme.label-id": "limited-edition"},
  "title": "Limited Edition",
  "color": "#FFD700"
}
```

---

## Phase 2: Full Catalog Sync

### Step 1: Create Products

```bash
# Basic product
PUT /v1/products/com.acme.pim-id=PIM-PROD-00001
{
  "identifiers": {
    "com.acme.pim-id": "PIM-PROD-00001",
    "com.acme.sku": "WIDGET-001"
  },
  "name": "Premium Widget",
  "status": "Active",
  "gtin": ["7312345678901"],
  "defaultVatCode": {"identifiers": {"percentage": "25"}}
}
```

### Step 2: Product with Full Details

```bash
PUT /v1/products/com.acme.pim-id=PIM-PROD-00002
{
  "identifiers": {
    "com.acme.pim-id": "PIM-PROD-00002",
    "com.acme.sku": "PHONE-GALAXY-S24",
    "com.acme.gtin": "8806095070568"
  },
  "name": "Samsung Galaxy S24",
  "status": "Active",
  "gtin": ["8806095070568"],
  "plu": ["1001"],
  "instanceType": "MobileDevice",
  "defaultVatCode": {"identifiers": {"percentage": "25"}},
  "parentGroup": {"identifiers": {"com.acme.group-id": "STANDARD-VAT-PRODUCTS"}},
  "promotionTitle": {
    "en-US": "Latest Samsung Flagship",
    "sv-SE": "Senaste Samsung-flaggskeppet"
  },
  "promotionBanner": {
    "en-US": "Experience the future of mobile",
    "sv-SE": "Upplev framtidens mobil"
  },
  "promotionDescription": {
    "en-US": "The Galaxy S24 features cutting-edge AI capabilities, an advanced camera system, and all-day battery life.",
    "sv-SE": "Galaxy S24 har banbrytande AI-funktioner, ett avancerat kamerasystem och batteri som räcker hela dagen."
  },
  "receiptText": {
    "en-US": "Galaxy S24",
    "sv-SE": "Galaxy S24"
  },
  "keywords": "samsung galaxy s24 android smartphone 5g ai camera"
}
```

### Step 3: Product Variants (Family + Products)

```bash
# Create product family
PUT /v1/product-families/com.acme.family-id=TSHIRT-PREMIUM
{
  "identifiers": {"com.acme.family-id": "TSHIRT-PREMIUM"},
  "name": "Premium T-Shirt",
  "promotionTitle": {"en-US": "Premium Cotton T-Shirt"},
  "promotionDescription": {"en-US": "Soft, breathable cotton tee available in multiple sizes and colors."}
}

# Create variant products
PUT /v1/products/com.acme.pim-id=TSHIRT-PREMIUM-S-BLK
{
  "identifiers": {
    "com.acme.pim-id": "TSHIRT-PREMIUM-S-BLK",
    "com.acme.sku": "TSH-PREM-S-BLK"
  },
  "name": "Premium T-Shirt - Small - Black",
  "status": "Active",
  "gtin": ["7312345678001"],
  "instanceType": "Apparel",
  "instanceProperties": {
    "Apparel::size": "S",
    "Apparel::color": "Black"
  },
  "parentGroup": {"identifiers": {"com.acme.family-id": "TSHIRT-PREMIUM"}},
  "defaultVatCode": {"identifiers": {"percentage": "25"}}
}

PUT /v1/products/com.acme.pim-id=TSHIRT-PREMIUM-M-BLK
{
  "identifiers": {
    "com.acme.pim-id": "TSHIRT-PREMIUM-M-BLK",
    "com.acme.sku": "TSH-PREM-M-BLK"
  },
  "name": "Premium T-Shirt - Medium - Black",
  "status": "Active",
  "gtin": ["7312345678002"],
  "instanceType": "Apparel",
  "instanceProperties": {
    "Apparel::size": "M",
    "Apparel::color": "Black"
  },
  "parentGroup": {"identifiers": {"com.acme.family-id": "TSHIRT-PREMIUM"}},
  "defaultVatCode": {"identifiers": {"percentage": "25"}}
}

PUT /v1/products/com.acme.pim-id=TSHIRT-PREMIUM-L-WHT
{
  "identifiers": {
    "com.acme.pim-id": "TSHIRT-PREMIUM-L-WHT",
    "com.acme.sku": "TSH-PREM-L-WHT"
  },
  "name": "Premium T-Shirt - Large - White",
  "status": "Active",
  "gtin": ["7312345678003"],
  "instanceType": "Apparel",
  "instanceProperties": {
    "Apparel::size": "L",
    "Apparel::color": "White"
  },
  "parentGroup": {"identifiers": {"com.acme.family-id": "TSHIRT-PREMIUM"}},
  "defaultVatCode": {"identifiers": {"percentage": "25"}}
}
```

> **Note:** `instanceProperties` keys must be resolved property names (e.g., `Apparel::size`). Unknown property names are rejected.

### Step 4: Assign Products to Categories

Category assignments accept an optional `weight`, but it is currently not persisted/used for ordering.

```bash
# Assign phone to categories (weight is optional and currently ignored)
POST /v1/products/com.acme.pim-id=PIM-PROD-00002/categories
{
  "category": {"identifiers": {"com.acme.cat-id": "PHONES"}},
  "weight": "0"
}

# Assign T-shirts to category
POST /v1/products/com.acme.pim-id=TSHIRT-PREMIUM-S-BLK/categories
{
  "category": {"identifiers": {"com.acme.cat-id": "TSHIRTS"}},
  "weight": "0"
}

POST /v1/products/com.acme.pim-id=TSHIRT-PREMIUM-M-BLK/categories
{
  "category": {"identifiers": {"com.acme.cat-id": "TSHIRTS"}},
  "weight": "1"
}

POST /v1/products/com.acme.pim-id=TSHIRT-PREMIUM-L-WHT/categories
{
  "category": {"identifiers": {"com.acme.cat-id": "TSHIRTS"}},
  "weight": "2"
}
```

> **Note:** The `weight` field is optional and currently not persisted/used for ordering. You can still include it for forward compatibility.

### Step 5: Apply Labels

```bash
# Apply "new-arrival" label
POST /v1/products/com.acme.pim-id=PIM-PROD-00002/labels
{
  "identifiers": {"com.acme.label-id": "new-arrival"}
}
```

### Bulk Loading with NDJSON

For large catalogs, stream products as NDJSON:

```bash
PUT /v1/products
Content-Type: application/x-ndjson

{"identifiers":{"com.acme.pim-id":"PIM-001"},"name":"Product 1","status":"Active","gtin":["7312345670001"],"defaultVatCode":{"identifiers":{"percentage":"25"}}}
{"identifiers":{"com.acme.pim-id":"PIM-002"},"name":"Product 2","status":"Active","gtin":["7312345670002"],"defaultVatCode":{"identifiers":{"percentage":"25"}}}
{"identifiers":{"com.acme.pim-id":"PIM-003"},"name":"Product 3","status":"Active","gtin":["7312345670003"],"defaultVatCode":{"identifiers":{"percentage":"25"}}}
```

---

## Phase 3: Incremental Updates

### Delta Sync Strategy

Track changes in your PIM and push only modified products:

```bash
# PIM exports products modified since last sync timestamp
# Integration layer transforms and pushes to CommerceOS

PUT /v1/products/com.acme.pim-id=PIM-PROD-00001
{
  "identifiers": {"com.acme.pim-id": "PIM-PROD-00001"},
  "name": "Premium Widget - Updated Name",
  "status": "Active",
  "gtin": ["7312345678901"],
  "promotionTitle": {"en-US": "Now with 20% more features!"},
  "defaultVatCode": {"identifiers": {"percentage": "25"}}
}
```

### Status Updates (Discontinue Product)

```bash
# Mark product as inactive
PATCH /v1/products/com.acme.pim-id=PIM-PROD-00001
{
  "status": "Inactive"
}

# Reactivate product
PATCH /v1/products/com.acme.pim-id=PIM-PROD-00001
{
  "status": "Active"
}
```

### Field-Level Updates

```bash
# Update only specific fields
PATCH /v1/products/com.acme.pim-id=PIM-PROD-00002
{
  "promotionTitle": {"en-US": "Limited Time Offer!"},
  "keywords": "samsung galaxy s24 android smartphone 5g ai camera sale discount"
}
```

### Sync Webhook for PIM → CommerceOS

Configure CommerceOS to pull changes from your PIM:

```bash
PUT /v1/sync-webhooks/com.acme.sync-id=pim-product-pull
{
  "identifiers": {"com.acme.sync-id": "pim-product-pull"},
  "name": "PIM Product Pull",
  "description": "Pull product changes from PIM every 15 minutes",
  "when": "api/v1/now/+=0:15:0",
  "repeat": true,
  "in": {
    "url": "https://your-pim.example.com/api/products/changes"
  },
  "out": {
    "method": "PUT",
    "url": "api/v1/products"
  },
  "authorizedScopes": ["write:products"]
}
```

---

## Phase 4: Pricing Synchronization

### Net vs Gross: Critical Concept

CommerceOS stores prices as **NET** (VAT excluded). If your PIM stores gross prices, convert before sync:

```
Net = Gross / (1 + VAT Rate / 100)

Example (25% VAT):
Gross: 249.00 SEK
Net:   249.00 / 1.25 = 199.20 SEK
```

### How VAT is Applied

VAT is calculated automatically when orders and receipts are created:

1. The product's `defaultVatCode` determines the VAT percentage
2. VAT is applied **on top of** the net `amount` from the price
3. Receipt items and order items show both net amounts and VAT breakdowns

```
Product: Widget (defaultVatCode = 25%)
Price:   amount = 199.00 (net)

On Receipt:
  Net Amount:    199.00 SEK
  VAT (25%):      49.75 SEK
  Gross Amount:  248.75 SEK
```

> **Important:** Always store prices as net amounts. VAT rates flow from the product's `defaultVatCode` (or inherited from its `parentGroup`). Do not bake VAT into the price amount.

### Create Basic Price

Price essential fields are `identifiers`, `sellers`, `buyers`, `amount`, `currency`, `from`, and `to`.

```bash
POST /v1/prices
{
  "identifiers": {"com.acme.price-id": "PRICE-PIM-001-ALL"},
  "products": [{"identifiers": {"com.acme.pim-id": "PIM-PROD-00001"}}],
  "sellers": [],
  "buyers": [],
  "amount": "199.00",
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "from": "2024-01-01T00:00:00Z",
  "to": "2099-12-31T23:59:59Z"
}
```

> **Note:** When `sellers` is empty, the price applies to all sellers. When `buyers` is empty, the price applies to all buyers. The `from`/`to` fields define the validity window (use far-future dates for "always valid" prices).

### Store-Specific Pricing

```bash
# Price for Stockholm store
POST /v1/prices
{
  "identifiers": {"com.acme.price-id": "PRICE-PIM-001-STHLM"},
  "products": [{"identifiers": {"com.acme.pim-id": "PIM-PROD-00001"}}],
  "sellers": [{"identifiers": {"com.acme.store-id": "STORE-STOCKHOLM"}}],
  "buyers": [],
  "amount": "199.00",
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "from": "2024-01-01T00:00:00Z",
  "to": "2099-12-31T23:59:59Z"
}

# Price for Gothenburg store (different price)
POST /v1/prices
{
  "identifiers": {"com.acme.price-id": "PRICE-PIM-001-GBG"},
  "products": [{"identifiers": {"com.acme.pim-id": "PIM-PROD-00001"}}],
  "sellers": [{"identifiers": {"com.acme.store-id": "STORE-GOTHENBURG"}}],
  "buyers": [],
  "amount": "189.00",
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "from": "2024-01-01T00:00:00Z",
  "to": "2099-12-31T23:59:59Z"
}
```

### Time-Windowed Pricing (Promotions)

```bash
# Summer sale price (June 1 - August 31)
POST /v1/prices
{
  "identifiers": {"com.acme.price-id": "PRICE-PIM-001-SUMMER"},
  "products": [{"identifiers": {"com.acme.pim-id": "PIM-PROD-00001"}}],
  "sellers": [],
  "buyers": [],
  "amount": "149.00",
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "from": "2024-06-01T00:00:00Z",
  "to": "2024-08-31T23:59:59Z"
}
```

### Multi-Currency Pricing

```bash
# SEK price
POST /v1/prices
{
  "identifiers": {"com.acme.price-id": "PRICE-PIM-001-SEK"},
  "products": [{"identifiers": {"com.acme.pim-id": "PIM-PROD-00001"}}],
  "sellers": [],
  "buyers": [],
  "amount": "199.00",
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "from": "2024-01-01T00:00:00Z",
  "to": "2099-12-31T23:59:59Z"
}

# EUR price (for EU stores)
POST /v1/prices
{
  "identifiers": {"com.acme.price-id": "PRICE-PIM-001-EUR"},
  "products": [{"identifiers": {"com.acme.pim-id": "PIM-PROD-00001"}}],
  "sellers": [{"identifiers": {"com.acme.store-id": "STORE-EU"}}],
  "buyers": [],
  "amount": "18.50",
  "currency": {"identifiers": {"currencyCode": "EUR"}},
  "from": "2024-01-01T00:00:00Z",
  "to": "2099-12-31T23:59:59Z"
}
```

### Bulk Price Sync

```bash
PUT /v1/prices
Content-Type: application/json

[
  {
    "identifiers": {"com.acme.price-id": "PRICE-001"},
    "products": [{"identifiers": {"com.acme.pim-id": "PIM-001"}}],
    "sellers": [],
    "buyers": [],
    "amount": "99.00",
    "currency": {"identifiers": {"currencyCode": "SEK"}},
    "from": "2024-01-01T00:00:00Z",
    "to": "2099-12-31T23:59:59Z"
  },
  {
    "identifiers": {"com.acme.price-id": "PRICE-002"},
    "products": [{"identifiers": {"com.acme.pim-id": "PIM-002"}}],
    "sellers": [],
    "buyers": [],
    "amount": "149.00",
    "currency": {"identifiers": {"currencyCode": "SEK"}},
    "from": "2024-01-01T00:00:00Z",
    "to": "2099-12-31T23:59:59Z"
  },
  {
    "identifiers": {"com.acme.price-id": "PRICE-003"},
    "products": [{"identifiers": {"com.acme.pim-id": "PIM-003"}}],
    "sellers": [],
    "buyers": [],
    "amount": "299.00",
    "currency": {"identifiers": {"currencyCode": "SEK"}},
    "from": "2024-01-01T00:00:00Z",
    "to": "2099-12-31T23:59:59Z"
  }
]
```

---

## Phase 5: Multi-Channel Assortments

Assortment contexts allow different organizations to have their own article numbers and settings for shared products.

### Understanding Assortment Contexts

| Field | Description |
|-------|-------------|
| `owner` | Company/store owning this context |
| `articleNumber` | Owner-specific SKU/article number |
| `minimumOrderQuantity` | Minimum units per order |
| `primarySupplier` | Preferred supplier for restocking |

### Create Product with Assortment Contexts

```bash
PUT /v1/products/com.acme.pim-id=SHARED-PRODUCT
{
  "identifiers": {
    "com.acme.pim-id": "SHARED-PRODUCT",
    "com.acme.gtin": "7312345670100"
  },
  "name": "Shared Catalog Product",
  "status": "Active",
  "gtin": ["7312345670100"],
  "defaultVatCode": {"identifiers": {"percentage": "25"}},
  "assortmentContexts": [
    {
      "owner": {"identifiers": {"com.acme.company-id": "COMPANY-STOCKHOLM"}},
      "articleNumber": "ART-STH-001",
      "minimumOrderQuantity": 1
    },
    {
      "owner": {"identifiers": {"com.acme.company-id": "COMPANY-GOTHENBURG"}},
      "articleNumber": "ART-GBG-001",
      "minimumOrderQuantity": 5,
      "primarySupplier": {"identifiers": {"com.acme.supplier-id": "SUPPLIER-WEST"}}
    },
    {
      "owner": {"identifiers": {"com.acme.company-id": "COMPANY-MALMO"}},
      "articleNumber": "ART-MLM-001",
      "minimumOrderQuantity": 10
    }
  ]
}
```

### Query Assortment by Owner

```bash
# Get products in a specific company's assortment
GET /v1/companies/com.acme.company-id=COMPANY-STOCKHOLM/assortment~take(100)

# Get product's assortment contexts
GET /v1/products/com.acme.pim-id=SHARED-PRODUCT/assortmentContexts

# Get specific owner's context
GET /v1/products/com.acme.pim-id=SHARED-PRODUCT/assortmentContexts/com.acme.company-id=COMPANY-STOCKHOLM
```

### Update Assortment Context

```bash
PATCH /v1/products/com.acme.pim-id=SHARED-PRODUCT/assortmentContexts/com.acme.company-id=COMPANY-STOCKHOLM
{
  "articleNumber": "ART-STH-001-NEW",
  "minimumOrderQuantity": 2
}
```

### Channel Availability Matrix

| Product | Stockholm | Gothenburg | Malmö | Webshop |
|---------|-----------|------------|-------|---------|
| PROD-001 | ✓ | ✓ | ✓ | ✓ |
| PROD-002 | ✓ | ✓ | ✗ | ✓ |
| PROD-003 | ✗ | ✓ | ✓ | ✗ |

Implement by creating assortment contexts only for available channels.

---

## Media and Asset Handling

### Adding Images to Products

Images are identified by their URL. The only supported identifier field is `url`.

```bash
# Add primary image
POST /v1/products/com.acme.pim-id=PIM-PROD-00001/images
{
  "identifiers": {"url": "https://cdn.example.com/products/pim-001-main.jpg"}
}

# Add additional images
POST /v1/products/com.acme.pim-id=PIM-PROD-00001/images
{
  "identifiers": {"url": "https://cdn.example.com/products/pim-001-side.jpg"}
}

POST /v1/products/com.acme.pim-id=PIM-PROD-00001/images
{
  "identifiers": {"url": "https://cdn.example.com/products/pim-001-detail.jpg"}
}
```

> **Note:** Images accept only `identifiers.url`. Fields like `altText` and `sortOrder` are not persisted. Image order is determined by insertion order.

### Query Product Images

```bash
# Get product with images
GET /v1/products/com.acme.pim-id=PIM-PROD-00001~with(images)

# Get just images
GET /v1/products/com.acme.pim-id=PIM-PROD-00001/images
```

### Image Best Practices

| Aspect | Recommendation |
|--------|----------------|
| **URL stability** | Use CDN URLs that won't change |
| **Format** | JPEG for photos, PNG for graphics |
| **Size** | Optimize for web (< 500KB) |
| **Ordering** | Add images in desired display order |

### Replacing Images

```bash
# Access image by URL
GET /v1/products/com.acme.pim-id=PIM-PROD-00001/images/url=https%3A%2F%2Fcdn.example.com%2Fproducts%2Fpim-001-main.jpg

# Replace all images (full replacement)
PUT /v1/products/com.acme.pim-id=PIM-PROD-00001/images
[
  {"identifiers": {"url": "https://cdn.example.com/products/pim-001-new-main.jpg"}}
]
```

---

## VAT and Currency Configuration

### VAT Inheritance

Products inherit VAT codes from their parent group if not set directly:

```
Product Group (defaultVatCode: 25%)
  └── Product A (no defaultVatCode) → Inherits 25%
  └── Product B (defaultVatCode: 12%) → Uses own 12%
```

### Setting VAT on Product

```bash
# Direct VAT assignment
PUT /v1/products/com.acme.pim-id=FOOD-PRODUCT
{
  "identifiers": {"com.acme.pim-id": "FOOD-PRODUCT"},
  "name": "Organic Snack",
  "status": "Active",
  "defaultVatCode": {"identifiers": {"percentage": "12"}}
}
```

### Setting VAT via Product Group

```bash
# Create product group with VAT
PUT /v1/product-groups/com.acme.group-id=FOOD-ITEMS
{
  "identifiers": {"com.acme.group-id": "FOOD-ITEMS"},
  "name": "Food Items",
  "defaultVatCode": {"identifiers": {"percentage": "12"}}
}

# Product inherits VAT from group
PUT /v1/products/com.acme.pim-id=ANOTHER-FOOD
{
  "identifiers": {"com.acme.pim-id": "ANOTHER-FOOD"},
  "name": "Another Food Item",
  "status": "Active",
  "parentGroup": {"identifiers": {"com.acme.group-id": "FOOD-ITEMS"}}
}
```

### Multi-Currency Setup

1. **Create currencies** (if not already present)
2. **Create separate prices** per currency
3. **Scope prices by seller** if different stores use different currencies

```bash
# EUR store with EUR prices
PUT /v1/stores/com.acme.store-id=STORE-EU
{
  "identifiers": {"com.acme.store-id": "STORE-EU"},
  "name": "EU Store",
  "preferredCurrency": {"identifiers": {"currencyCode": "EUR"}}
}
```

---

## Error Handling and Recovery

### Common Validation Errors

| Error | Cause | Resolution |
|-------|-------|------------|
| `InvalidIdentifier` | Non-namespaced identifier | Use `com.acme.pim-id` format |
| `ProductNotFound` | Referenced product doesn't exist | Create product first |
| `VatCodeNotFound` | VAT code doesn't exist | Create VAT code first |
| `CurrencyNotFound` | Currency doesn't exist | Create currency first |
| `DuplicateGtin` | GTIN already used | Check for existing product |

### Retry Strategy

| Error Type | Retry? | Strategy |
|------------|--------|----------|
| 400 Bad Request | No | Fix payload |
| 404 Not Found | No | Create dependencies first |
| 409 Conflict | Conditional | Use PUT for upsert |
| 429 Rate Limited | Yes | Exponential backoff |
| 5xx Server Error | Yes | Retry with backoff |

### Idempotent Operations

Use PUT for safe retries:

```bash
# Safe to retry - creates or updates
PUT /v1/products/com.acme.pim-id=PIM-PROD-00001
{
  "name": "Premium Widget",
  "status": "Active",
  ...
}
```

### Error Response Handling

```json
{
  "error": "ValidationError",
  "code": "InvalidIdentifier",
  "message": "Identifier key 'pim-id' is not namespaced",
  "path": "identifiers.pim-id",
  "details": {
    "suggestion": "Use 'com.yourdomain.pim-id' format"
  }
}
```

---

## Backfill and Replay Patterns

### Full Catalog Backfill

When you need to resync the entire catalog:

```bash
# Step 1: Export all products from PIM

# Step 2: Stream to CommerceOS using NDJSON
PUT /v1/products
Content-Type: application/x-ndjson

# Each line is a complete product JSON

# Step 3: Verify count
GET /v1/products~count
```

### Selective Replay

Re-sync specific products after a failed batch:

```bash
# Get list of failed product IDs from error log
# Re-PUT each failed product

PUT /v1/products/com.acme.pim-id=FAILED-PROD-001
{ ... corrected payload ... }

PUT /v1/products/com.acme.pim-id=FAILED-PROD-002
{ ... corrected payload ... }
```

### Category Hierarchy Replay

If categories get out of sync:

```bash
# Step 1: List current categories
GET /v1/product-categories~take(500)

# Step 2: Compare with PIM category tree

# Step 3: Create missing categories
PUT /v1/product-categories/com.acme.cat-id=MISSING-CAT
{
  "identifiers": {"com.acme.cat-id": "MISSING-CAT"},
  "name": "Missing Category"
}

# Step 4: Link to parent via childCategories
POST /v1/product-categories/com.acme.cat-id=PARENT-CAT/childCategories
{
  "identifiers": {"com.acme.cat-id": "MISSING-CAT"}
}
```

### Price Reconciliation

```bash
# Get all prices for verification
GET /v1/prices~with(products)~take(1000)

# Compare with PIM price list

# Update discrepancies
PUT /v1/prices/com.acme.price-id=PRICE-MISMATCH
{
  "amount": "199.00",
  ...
}
```

---

## Production Checklist

### Pre-Launch

- [ ] **Identifier namespace** — Confirm reverse-domain namespace (e.g., `com.acme.pim-id`)
- [ ] **Field mapping** — Document PIM → CommerceOS field mapping
- [ ] **VAT mapping** — Map PIM tax classes to CommerceOS VAT codes
- [ ] **Category mapping** — Map PIM categories to CommerceOS categories
- [ ] **Price conversion** — Implement gross-to-net conversion if needed

### Foundation Setup

- [ ] **VAT codes** — Create all needed VAT codes
- [ ] **Currencies** — Create all needed currencies
- [ ] **Categories** — Create category hierarchy
- [ ] **Product groups** — Create groups for VAT inheritance
- [ ] **Labels** — Create product labels/tags

### Integration Setup

- [ ] **OAuth scopes** — Obtain scopes: `read:products`, `write:products`, `read:prices`, `write:prices`
- [ ] **Test environment** — Validate integration in staging
- [ ] **Batch sizing** — Determine optimal batch size (100-500 products)
- [ ] **Error handling** — Implement retry logic and dead letter queue

### Data Migration

- [ ] **Initial load** — Run full catalog export/import
- [ ] **Price load** — Sync all prices
- [ ] **Category assignments** — Assign products to categories
- [ ] **Verification** — Spot-check random products

### Go-Live

- [ ] **Incremental sync** — Configure ongoing sync schedule
- [ ] **Monitoring** — Set up sync status dashboards
- [ ] **Alerting** — Configure alerts for sync failures
- [ ] **Runbook** — Document manual intervention procedures

---

## Copy-Paste Payload Reference

### Complete Product with All Fields

```bash
PUT /v1/products/com.acme.pim-id=COMPLETE-PRODUCT
Content-Type: application/json

{
  "identifiers": {
    "com.acme.pim-id": "COMPLETE-PRODUCT",
    "com.acme.sku": "SKU-COMPLETE-001",
    "com.acme.gtin": "7312345670999"
  },
  "name": "Complete Example Product",
  "status": "Active",
  "gtin": ["7312345670999"],
  "plu": ["9999"],
  "instanceType": "MobileDevice",
  "instanceProperties": {
    "MobileDevice::storage": "256GB",
    "MobileDevice::color": "Black"
  },
  "defaultVatCode": {"identifiers": {"percentage": "25"}},
  "parentGroup": {"identifiers": {"com.acme.group-id": "ELECTRONICS"}},
  "promotionTitle": {
    "en-US": "Amazing Product",
    "sv-SE": "Fantastisk produkt"
  },
  "promotionBanner": {
    "en-US": "Limited time offer",
    "sv-SE": "Tidsbegränsat erbjudande"
  },
  "promotionDescription": {
    "en-US": "This is the most amazing product you've ever seen. Features include advanced technology, premium materials, and exceptional performance.",
    "sv-SE": "Detta är den mest fantastiska produkten du någonsin sett. Funktioner inkluderar avancerad teknik, premiummaterial och exceptionell prestanda."
  },
  "receiptText": {
    "en-US": "Complete Product",
    "sv-SE": "Komplett produkt"
  },
  "signText": {
    "en-US": "BEST SELLER",
    "sv-SE": "BÄSTSÄLJARE"
  },
  "keywords": "complete example product amazing best seller premium",
  "notesForPicking": "Handle with care - fragile electronics",
  "assortmentContexts": [
    {
      "owner": {"identifiers": {"com.acme.company-id": "MAIN-COMPANY"}},
      "articleNumber": "ART-MAIN-999",
      "minimumOrderQuantity": 1
    }
  ]
}
```

### Complete Price with All Options

```bash
POST /v1/prices
Content-Type: application/json

{
  "identifiers": {"com.acme.price-id": "PRICE-COMPLETE"},
  "products": [{"identifiers": {"com.acme.pim-id": "COMPLETE-PRODUCT"}}],
  "sellers": [
    {"identifiers": {"com.acme.store-id": "STORE-STOCKHOLM"}},
    {"identifiers": {"com.acme.store-id": "STORE-GOTHENBURG"}}
  ],
  "buyers": [
    {"@type": "company", "identifiers": {"com.acme.company-id": "WHOLESALE-PARTNER-001"}}
  ],
  "amount": "799.00",
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "from": "2024-01-01T00:00:00Z",
  "to": "2024-12-31T23:59:59Z"
}
```

### Complete Category Hierarchy

Create categories first, then establish parent-child relationships via `childCategories`.

```bash
# Create all categories
PUT /v1/product-categories/com.acme.cat-id=ROOT
{"identifiers":{"com.acme.cat-id":"ROOT"},"name":"All Products"}

PUT /v1/product-categories/com.acme.cat-id=ELECTRONICS
{"identifiers":{"com.acme.cat-id":"ELECTRONICS"},"name":"Electronics"}

PUT /v1/product-categories/com.acme.cat-id=APPAREL
{"identifiers":{"com.acme.cat-id":"APPAREL"},"name":"Apparel"}

PUT /v1/product-categories/com.acme.cat-id=HOME
{"identifiers":{"com.acme.cat-id":"HOME"},"name":"Home & Garden"}

PUT /v1/product-categories/com.acme.cat-id=PHONES
{"identifiers":{"com.acme.cat-id":"PHONES"},"name":"Smartphones"}

PUT /v1/product-categories/com.acme.cat-id=TABLETS
{"identifiers":{"com.acme.cat-id":"TABLETS"},"name":"Tablets"}

PUT /v1/product-categories/com.acme.cat-id=ACCESSORIES
{"identifiers":{"com.acme.cat-id":"ACCESSORIES"},"name":"Accessories"}

# Link Level 1 to ROOT
POST /v1/product-categories/com.acme.cat-id=ROOT/childCategories
{"identifiers":{"com.acme.cat-id":"ELECTRONICS"}}

POST /v1/product-categories/com.acme.cat-id=ROOT/childCategories
{"identifiers":{"com.acme.cat-id":"APPAREL"}}

POST /v1/product-categories/com.acme.cat-id=ROOT/childCategories
{"identifiers":{"com.acme.cat-id":"HOME"}}

# Link Level 2 to ELECTRONICS
POST /v1/product-categories/com.acme.cat-id=ELECTRONICS/childCategories
{"identifiers":{"com.acme.cat-id":"PHONES"}}

POST /v1/product-categories/com.acme.cat-id=ELECTRONICS/childCategories
{"identifiers":{"com.acme.cat-id":"TABLETS"}}

POST /v1/product-categories/com.acme.cat-id=ELECTRONICS/childCategories
{"identifiers":{"com.acme.cat-id":"ACCESSORIES"}}
```

### Verification Queries

```bash
# Get product with full expansion
GET /v1/products/com.acme.pim-id=COMPLETE-PRODUCT~with(prices,categories,labels,images,assortmentContexts,stockLevels)

# Get products with labels expanded (filter client-side for specific label)
GET /v1/products~with(labels)~take(100)

# Get products by GTIN
GET /v1/products~where(gtin=7312345670999)~first

# Get category tree
GET /v1/product-categories/com.acme.cat-id=ROOT~with(childCategories~with(childCategories))

# Count products per category
GET /v1/product-categories/com.acme.cat-id=PHONES/members~count

# List prices with products
GET /v1/prices~with(products,sellers,currency)~take(100)
```

---

## Related Documentation

- [Working with Products](../working-with/products.md) — Detailed product field reference
- [Working with Prices](../working-with/prices.md) — Pricing patterns and validation
- [Working with VAT](../working-with/vat.md) — Tax configuration
- [Sync Webhooks](../sync-webhooks.md) — Automated sync configuration
- [Mapped Types](../mapped-types.md) — Data transformation
- [Pagination](../pagination.md) — Large dataset handling
