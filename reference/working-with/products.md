# Working with Products

This guide is the definitive playbook for catalog management in CommerceOS. It covers the product domain end-to-end: creating and managing products, variants, categories, GTIN/PLU codes, assortment contexts, product families and groups, stock levels, and integration patterns.

---

## Table of Contents

1. [Overview](#overview)
2. [Glossary](#glossary)
3. [Product Lifecycle and States](#product-lifecycle-and-states)
4. [Field Reference](#field-reference)
5. [Product Node Hierarchy](#product-node-hierarchy)
6. [Creating Products](#creating-products)
7. [GTIN and PLU Codes](#gtin-and-plu-codes)
8. [Product Variants and Instance Types](#product-variants-and-instance-types)
9. [Categories](#categories)
10. [Assortment Contexts](#assortment-contexts)
11. [Product Families and Groups](#product-families-and-groups)
12. [Stock Levels](#stock-levels)
13. [Display and Marketing Fields](#display-and-marketing-fields)
14. [Labels and Images](#labels-and-images)
15. [Endpoint Matrix](#endpoint-matrix)
16. [Finder and Indexing Patterns](#finder-and-indexing-patterns)
17. [Error Handling and Validation](#error-handling-and-validation)
18. [Integration Playbook: Catalog Sync](#integration-playbook-catalog-sync)
19. [Case Study: Full Product Lifecycle](#case-study-full-product-lifecycle)
20. [Business Rules and Pitfalls](#business-rules-and-pitfalls)
21. [Related Guides](#related-guides)

---

## Overview

Products are the core of your catalog in CommerceOS. Every item you sell, track, or report on starts as a product. Products exist within a hierarchical structure that enables flexible organization, variant management, and multi-tenant article numbering.

**Key Characteristics:**
- Products have a `status` lifecycle: `Active`, `Inactive`, or `Pending`
- Products support multiple barcodes (GTIN) and PLU codes
- Assortment contexts allow different article numbers per owner (multi-tenant support)
- VAT codes cascade down from parent groups if not set on the product
- Instance types enable tracking of serialized goods (devices, plans, accessories)

**Domain Relationships:**
```
Products  ↔  Prices (which sellers can sell at what price)
    ↔  VAT Codes (tax rates cascade from product groups)
    ↔  Stock (inventory levels at stock places)
    ↔  Orders (products appear as order items)
    ↔  Receipts (proof of sale, downstream from orders)
    ↔  Categories (organizational structure)
    ↔  Assortment Contexts (multi-tenant article numbers)
```

---

## Glossary

| Term | Description |
|------|-------------|
| **Product** | A sellable item in your catalog with status, pricing, and inventory |
| **Product Node** | Base type for all catalog items (products, families, groups, sets) |
| **Product Family** | A container for variant products (e.g., "iPhone 16" family with size/color variants) |
| **Product Group** | Hierarchical container for organizing products and families (e.g., "Electronics") |
| **Category** | Organizational structure for browsing products |
| **GTIN** | Global Trade Item Number - barcode for POS scanning |
| **PLU** | Price Look-Up code - commonly used for produce and bulk items |
| **Assortment Context** | Per-owner settings including article number and supplier |
| **Instance Type** | Classification that determines tracking behavior (e.g., "MobileDevice" enables IMEI tracking) |
| **Instance Properties** | Pre-defined variant properties (e.g., size: "M", color: "Blue") |
| **VAT Code** | Tax rate applied to the product (or inherited from parent group) |
| **Stock Level** | Quantity of product at a specific location |

---

## Product Lifecycle and States

Products move through three states:

| Status | Description | Visibility |
|--------|-------------|------------|
| `Pending` | Draft state, not yet published | Hidden from POS/webshop |
| `Active` | Available for sale | Visible and sellable |
| `Inactive` | Discontinued or out of season | Hidden, preserved for history |

> **Note:** New products default to **Active** unless `status` is explicitly set to `Pending` or `Inactive` in the create payload.

### State Transitions

```
[New Product] → Active (default)
                   ↓
               Inactive
                   ↓
               Pending ← (can transition to any state)
```

Products can transition between any states, but new products start as `Active` by default:

```bash
# Query by status
GET /v1/products~where(status=Active)~take(50)

# Update status
PATCH /v1/products/com.example.sku=PROD-001
{"status": "Inactive"}

# Bulk query: pending products awaiting review
GET /v1/products~where(status=Pending)~orderBy(createdAt:desc)~take(100)
```

---

## Field Reference

### Essential Fields (Always Returned)

| Field | Type | Description |
|-------|------|-------------|
| `identifiers` | object | System keys and external IDs (namespaced) |
| `identifiers.key` | string | Internal 32-char hex UUID (read-only) |
| `name` | string | Product display name |
| `gtin` | string[] | Barcode numbers |
| `status` | string | `Active`, `Inactive`, or `Pending` |
| `@type` | string | Always `"product"` |

### Optional Fields (Require `~with` to Include)

| Field | Type | Description |
|-------|------|-------------|
| `promotionTitle` | localized | Customer-facing title |
| `promotionBanner` | localized | Brief one-sentence description |
| `promotionDescription` | localized | Full marketing description |
| `receiptText` | localized | Text printed on receipts |
| `signText` | localized | Text for signage/displays |
| `keywords` | string | Search keywords |
| `plu` | string[] | Price look-up codes |
| `hidden` | boolean | Visibility flag |
| `instanceType` | string | Variant type (e.g., "MobileDevice", "Apparel") |
| `instanceProperties` | object | Pre-defined variant values (e.g., size, color) |
| `defaultVatCode` | reference | VAT rate for this product |
| `parentGroup` | reference | Parent product group |
| `assortmentContexts` | array | Per-owner settings |
| `prices` | array | Associated price definitions |
| `stockLevels` | array | Inventory at locations |
| `designatedStockPlaces` | array | Preferred stocking locations |
| `categories` | array | Category assignments |
| `labels` | array | Custom tags |
| `images` | array | Product images |
| `createdAt` | datetime | Creation timestamp (read-only) |
| `createdBy` | reference | Creator agent (read-only) |
| `notesForPicking` | string | Warehouse picking notes |

### Read-Only Computed Fields

| Field | Description |
|-------|-------------|
| `identifiers.key` | System-generated UUID |
| `createdAt` | Creation timestamp |
| `createdBy` | Agent who created the product |

---

## Product Node Hierarchy

Products exist within a hierarchical type system:

```
Product Node (base type)
  ├── Product (sellable items)
  ├── Product Family (variant containers)
  ├── Product Group (hierarchical organizers)
  ├── Product Set (bundles)
  └── Product Category (browsing structure)
```

All product nodes share common members:
- `identifiers`, `name`
- `gtin`, `plu`
- `promotionTitle`, `promotionBanner`, `promotionDescription`
- `hidden`, `labels`, `images`, `categories`
- `assortmentContexts`, `assortmentOwners`
- `createdBy`, `createdAt`
- `notesForPicking`

---

## Creating Products

### Basic Product

```bash
POST /v1/products
{
  "identifiers": {"com.example.sku": "PROD-001"},
  "name": "Basic T-Shirt",
  "status": "Active"
}
```

### Product with GTIN, PLU, and VAT

```bash
POST /v1/products
{
  "identifiers": {"com.example.sku": "PROD-002"},
  "name": "Premium Headphones",
  "gtin": ["7312345678901", "7312345678902"],
  "plu": ["1234"],
  "status": "Active",
  "defaultVatCode": {"identifiers": {"percentage": "25"}}
}
```

### Product with Marketing Content

```bash
POST /v1/products
{
  "identifiers": {"com.example.sku": "PROD-003"},
  "name": "Organic Coffee",
  "status": "Active",
  "promotionTitle": {"en-US": "Premium Organic Coffee", "sv-SE": "Ekologiskt Premiumkaffe"},
  "promotionDescription": {"en-US": "Ethically sourced, medium roast..."},
  "receiptText": {"en-US": "Coffee Organic"},
  "keywords": "organic fair-trade arabica medium-roast"
}
```

### Product with Instance Type (for Serialized Tracking)

```bash
POST /v1/products
{
  "identifiers": {"com.example.sku": "PHONE-001"},
  "name": "Smartphone Pro Max",
  "status": "Active",
  "instanceType": "MobileDevice",
  "defaultVatCode": {"identifiers": {"percentage": "25"}}
}
```

### Using PUT for Upsert

```bash
# Creates if not exists, updates if exists
PUT /v1/products/com.example.sku=PROD-001
{
  "name": "Updated Product Name",
  "status": "Active"
}
```

> **Important:** Use namespaced identifiers (e.g., `com.example.sku`) for all external IDs. Bare keys like `{"sku": "..."}` are invalid.

---

## GTIN and PLU Codes

### GTIN (Global Trade Item Numbers)

GTIN codes are barcodes used for scanning at POS. Products support multiple GTINs:

```bash
# Create product with multiple GTINs
POST /v1/products
{
  "identifiers": {"com.example.sku": "PROD-004"},
  "name": "Product Bundle",
  "gtin": ["7312345678901", "7312345678902", "7312345678903"]
}

# Add GTIN to existing product
PATCH /v1/products/com.example.sku=PROD-004
{
  "gtin": ["7312345678901", "7312345678902", "7312345678903", "7312345678904"]
}
```

### GTIN Lookup Patterns

```bash
# Find product by GTIN (use ~where, NOT direct indexer)
GET /v1/products~where(gtin=7312345678901)~first

# Query param equivalent
GET /v1/products?gtin=7312345678901&limit=1

# Access first GTIN of a product
GET /v1/products/com.example.sku=PROD-004/gtin/0

# Access last GTIN
GET /v1/products/com.example.sku=PROD-004/gtin/-1

# Count GTINs
GET /v1/products/com.example.sku=PROD-004/gtin/count
```

### PLU (Price Look-Up Codes)

PLU codes are commonly used for produce and bulk items:

```bash
# Create product with PLU
POST /v1/products
{
  "identifiers": {"com.example.sku": "PRODUCE-001"},
  "name": "Organic Bananas",
  "plu": ["4011"],
  "status": "Active"
}

# Find product by PLU
GET /v1/products~where(plu=4011)~first

# Get product with PLU expanded
GET /v1/products/com.example.sku=PRODUCE-001~with(plu)
```

> **Note:** GTIN is essential (returned by default), but PLU requires `~with(plu)` to include.

---

## Product Variants and Instance Types

### Instance Types

The `instanceType` field categorizes how products behave, especially for serialized tracking:

| Instance Type | Description | Tracking Field | Use Case |
|---------------|-------------|----------------|----------|
| `MobileDevice` | Phones, tablets | `imei` | Device serial tracking |
| `MobilePlan` | Service plans | `phoneImei` | Plan linked to device |
| `Apparel` | Clothing items | — | Size/color variants |
| `Accessory` | Accessories | `bundleId` | Bundle tracking |
| Custom types | Your own categories | — | Flexible properties |

### Creating Variant Products

Instance properties must use qualified keys in the format `InstanceType::propertyName`. The API resolves properties by name and throws an error if the property is not found. Note that `instanceProperties` is currently write-only (the getter returns an empty object).

```bash
# Create variant with instance type and qualified property keys
POST /v1/products
{
  "identifiers": {"com.example.sku": "TSHIRT-M-BLUE"},
  "name": "T-Shirt Medium Blue",
  "instanceType": "Apparel",
  "instanceProperties": {
    "Apparel::size": "M",
    "Apparel::color": "Blue"
  },
  "parentGroup": {"identifiers": {"com.example.familyId": "TSHIRT-FAMILY"}},
  "status": "Active"
}
```

### Mobile Device Setup

```bash
# Create phone product with MobileDevice type
POST /v1/products
{
  "identifiers": {"com.example.sku": "IPHONE-16"},
  "name": "iPhone 16",
  "instanceType": "MobileDevice",
  "gtin": ["0194252123456"],
  "status": "Active",
  "defaultVatCode": {"identifiers": {"percentage": "25"}}
}

# Create associated plan with MobilePlan type
POST /v1/products
{
  "identifiers": {"com.example.sku": "PLAN-UNLIMITED"},
  "name": "Unlimited Data Plan",
  "instanceType": "MobilePlan",
  "status": "Active",
  "defaultVatCode": {"identifiers": {"percentage": "25"}}
}
```

> **Critical for Orders:** When creating trade orders with instance-tracked items, the `MobileDevice` item must appear BEFORE the `MobilePlan` item. See the [Orders guide](orders.md) for details.

---

## Categories

Categories provide browsing structure for products.

### Creating Categories

Product categories do not have a `parent` property. Instead, use the parent category's `childCategories` collection to establish hierarchy.

```bash
# Create a root category
POST /v1/product-categories
{ "identifiers": {"com.example.catId": "ELECTRONICS"}, "name": "Electronics" }

# Create another category (not yet linked)
POST /v1/product-categories
{ "identifiers": {"com.example.catId": "PHONES"}, "name": "Smartphones" }

# Link PHONES as a child of ELECTRONICS via the parent's childCategories collection
POST /v1/product-categories/com.example.catId=ELECTRONICS/childCategories
{ "identifiers": {"com.example.catId": "PHONES"} }

# Create another category for nesting
POST /v1/product-categories
{ "identifiers": {"com.example.catId": "ANDROID-PHONES"}, "name": "Android Phones" }

# Link ANDROID-PHONES as a child of PHONES
POST /v1/product-categories/com.example.catId=PHONES/childCategories
{ "identifiers": {"com.example.catId": "ANDROID-PHONES"} }
```

### Assigning Products to Categories

```bash
# Assign product to category
POST /v1/products/com.example.sku=PROD-001/categories
{
  "category": {"identifiers": {"com.example.catId": "PHONES"}}
}

# Assign with weight (for sorting) - NOTE: weight is currently ignored
POST /v1/products/com.example.sku=PROD-001/categories
{
  "category": {"identifiers": {"com.example.catId": "FEATURED"}},
  "weight": 100
}
```

> **Important:** The `weight` field is accepted in the request but is **currently ignored/not persisted**. Sorting by weight is unimplemented. Products in a category are returned in their default order, not by weight. If you need custom ordering, manage it in your application layer.

### Querying Categories

```bash
# List all categories
GET /v1/product-categories~take(50)

# Get category with children
GET /v1/product-categories/com.example.catId=ELECTRONICS~with(childCategories)

# Get category members (products in category)
GET /v1/product-categories/com.example.catId=PHONES/members~take(50)

# Navigate product's categories
GET /v1/products/com.example.sku=PROD-001/categories

# Deep category tree
GET /v1/product-categories/com.example.catId=ELECTRONICS~with(childCategories~with(childCategories))
```

---

## Assortment Contexts

Assortment contexts allow different organizations to have their own article numbers and settings for the same product. This enables multi-tenant catalog sharing.

### Structure

| Field | Description |
|-------|-------------|
| `owner` | Company/store owning this context |
| `articleNumber` | Owner-specific SKU/article number |
| `minimumOrderQuantity` | Minimum units per order for this owner |
| `primarySupplier` | Preferred supplier for this owner |

### Creating with Assortment Contexts

```bash
POST /v1/products
{
  "identifiers": {"com.example.sku": "SHARED-PROD"},
  "name": "Shared Product",
  "status": "Active",
  "assortmentContexts": [
    {
      "owner": {"identifiers": {"com.example.companyId": "COMPANY-A"}},
      "articleNumber": "ART-001",
      "minimumOrderQuantity": 10
    },
    {
      "owner": {"identifiers": {"com.example.companyId": "COMPANY-B"}},
      "articleNumber": "SKU-999",
      "primarySupplier": {"identifiers": {"com.example.supplierId": "SUPP-001"}}
    }
  ]
}
```

### Managing Assortment Contexts

```bash
# Get product's assortment contexts
GET /v1/products/com.example.sku=SHARED-PROD/assortmentContexts

# Get specific owner's context
GET /v1/products/com.example.sku=SHARED-PROD/assortmentContexts/com.example.companyId=COMPANY-A

# Update owner-specific article number
PATCH /v1/products/com.example.sku=SHARED-PROD/assortmentContexts/com.example.companyId=COMPANY-A
{"articleNumber": "ART-001-NEW"}

# Get agent's assortment (products they own)
GET /v1/companies/com.example.companyId=COMPANY-A/assortment~take(50)
```

---

## Product Families and Groups

### Product Families (Variant Containers)

Families group products that are variants of each other (same product, different size/color/etc.):

```bash
# Create a product family
POST /v1/product-families
{
  "identifiers": {"com.example.familyId": "IPHONE-16"},
  "name": "iPhone 16 Family"
}

# Add variant dimensions
PATCH /v1/product-families/com.example.familyId=IPHONE-16
{
  "variantDimensions": "MobileDevice::storage, MobileDevice::color"
}

# Create variants within family (use qualified property keys)
POST /v1/products
{
  "identifiers": {"com.example.sku": "IPHONE-16-128-BLACK"},
  "name": "iPhone 16 128GB Black",
  "instanceType": "MobileDevice",
  "instanceProperties": {"MobileDevice::storage": "128GB", "MobileDevice::color": "Black"},
  "parentGroup": {"identifiers": {"com.example.familyId": "IPHONE-16"}},
  "status": "Active"
}

# Get family with all variants
GET /v1/product-families/com.example.familyId=IPHONE-16~with(variants)
```

### Product Groups (Hierarchical)

Groups organize products in a tree structure:

```bash
# Create a group
POST /v1/product-groups
{
  "identifiers": {"com.example.groupId": "SUMMER-2024"},
  "name": "Summer Collection 2024"
}

# Create nested group
POST /v1/product-groups
{
  "identifiers": {"com.example.groupId": "SUMMER-2024-APPAREL"},
  "name": "Summer Apparel",
  "parentGroup": {"identifiers": {"com.example.groupId": "SUMMER-2024"}}
}

# Assign product to group
PATCH /v1/products/com.example.sku=PROD-001
{
  "parentGroup": {"identifiers": {"com.example.groupId": "SUMMER-2024-APPAREL"}}
}

# Get group's members
GET /v1/product-groups/com.example.groupId=SUMMER-2024~with(members)

# Set default VAT for entire group
PATCH /v1/product-groups/com.example.groupId=SUMMER-2024-APPAREL
{
  "defaultVatCode": {"identifiers": {"percentage": "25"}}
}
```

---

## Stock Levels

Products track stock at various locations:

```bash
# Get product with stock levels
GET /v1/products/com.example.sku=PROD-001~with(stockLevels)

# Response includes per-location quantities:
{
  "identifiers": {...},
  "name": "Basic T-Shirt",
  "stockLevels": [
    {
      "location": {"@type": "store", "identifiers": {...}},
      "totalQuantity": 100,
      "reservedQuantity": 5,
      "availableQuantity": 95
    },
    {
      "location": {"@type": "store", "identifiers": {...}},
      "totalQuantity": 50,
      "reservedQuantity": 0,
      "availableQuantity": 50
    }
  ]
}

# Get designated stock places
GET /v1/products/com.example.sku=PROD-001~with(designatedStockPlaces)

# Set designated stock places
PATCH /v1/products/com.example.sku=PROD-001
{
  "designatedStockPlaces": [
    {"identifiers": {"com.example.stockPlaceId": "WAREHOUSE-001"}}
  ]
}
```

See the [Stock guide](stock.md) for inventory management details.

---

## Display and Marketing Fields

Products support localized marketing content:

```bash
PATCH /v1/products/com.example.sku=PROD-001
{
  "promotionTitle": {
    "en-US": "Best Seller!",
    "sv-SE": "Storsäljare!"
  },
  "promotionBanner": {
    "en-US": "Limited time offer"
  },
  "promotionDescription": {
    "en-US": "Our most popular item with excellent reviews..."
  },
  "receiptText": {
    "en-US": "T-Shirt Basic",
    "sv-SE": "T-Shirt Bas"
  },
  "signText": {
    "en-US": "SALE"
  }
}

# Fetch with localized fields (require ~with)
GET /v1/products/com.example.sku=PROD-001~with(promotionTitle,promotionDescription,receiptText)

# All marketing fields at once
GET /v1/products/com.example.sku=PROD-001~with(promotionTitle,promotionBanner,promotionDescription,receiptText,signText)
```

### Webshop Properties

The `application.webshop` property is **read-only** and cannot be modified via PATCH requests. Webshop configuration is managed through other means.

```bash
# Read webshop properties (read-only)
GET /v1/products/com.example.sku=PROD-001~with(application)

# Note: PATCH to application.webshop is NOT supported
```

---

## Labels and Images

### Labels

Labels are custom tags for filtering and organization:

```bash
# Create a label
POST /v1/labels
{
  "identifiers": {"com.example.labelId": "sale"},
  "title": "On Sale",
  "color": "#FF0000"
}

# Assign label to product
POST /v1/products/com.example.sku=PROD-001/labels
{"identifiers": {"com.example.labelId": "sale"}}

# Get product's labels
GET /v1/products/com.example.sku=PROD-001/labels

# Get products with labels expanded (filter client-side)
GET /v1/products~with(labels)~take(20)

# Remove label
DELETE /v1/products/com.example.sku=PROD-001/labels/com.example.labelId=sale
```

### Images

Images are identified by URL only. Properties like `altText` and `sortOrder` are not supported, and index-based updates (`/images/0`) are not available.

```bash
# Get product images
GET /v1/products/com.example.sku=PROD-001/images

# Add image (URL-only payload via identifiers)
POST /v1/products/com.example.sku=PROD-001/images
{ "identifiers": { "url": "https://cdn.example.com/products/prod-001.jpg" } }

# Get product with images
GET /v1/products/com.example.sku=PROD-001~with(images)

# Delete image by URL
DELETE /v1/products/com.example.sku=PROD-001/images/url=https%3A%2F%2Fcdn.example.com%2Fproducts%2Fprod-001.jpg
```

---

## Endpoint Matrix

### When to Use What

| Goal | Method | Endpoint | Notes |
|------|--------|----------|-------|
| List products | GET | `/v1/products~take(50)` | Paginate with `~skip` |
| Get single product | GET | `/v1/products/{id}` | Use identifier |
| Get with expansions | GET | `/v1/products/{id}~with(prices,categories)` | Add needed fields |
| Create product | POST | `/v1/products` | Returns created product |
| Create or update | PUT | `/v1/products/{id}` | Upsert by identifier |
| Update product | PATCH | `/v1/products/{id}` | Partial update |
| Delete product | DELETE | `/v1/products/{id}` | **No-op** (use status change instead) |
| Retire product | PATCH | `/v1/products/{id}` | Use `{"status": "Inactive"}` to retire |
| Find by GTIN | GET | `/v1/products~where(gtin=...)~first` | Use ~where, not indexer |
| Find by PLU | GET | `/v1/products~where(plu=...)~first` | Use ~where |
| Get categories | GET | `/v1/products/{id}/categories` | Product's categories |
| Assign category | POST | `/v1/products/{id}/categories` | Add to category |
| Get stock levels | GET | `/v1/products/{id}~with(stockLevels)` | Inventory across locations |
| Get prices | GET | `/v1/products/{id}/prices` | Product's prices |

---

## Finder and Indexing Patterns

### Pagination with Operators

```bash
# First page
GET /v1/products~orderBy(name)~take(100)

# Next page
GET /v1/products~orderBy(name)~skip(100)~take(100)

# Count total
GET /v1/products~count

# First match
GET /v1/products~where(status=Active)~first
```

### Pagination with Query Parameters

```bash
# First page
GET /v1/products?orderby=name&limit=100

# Next page
GET /v1/products?orderby=name&offset=100&limit=100
```

> **Note:** You can mix operators and query parameters. When mixed, they are normalized in this order: `format` -> `fields` -> `where` -> `orderBy` -> `skip` -> `take` -> `simpleJust`. For example, `~orderBy(name)?limit=10` is valid and normalizes to `~orderBy(name)~take(10)`.

### Projections

```bash
# Include specific fields
GET /v1/products~with(prices,categories,stockLevels)

# Include all fields
GET /v1/products/com.example.sku=PROD-001~withAll

# Exclude fields
GET /v1/products~without(createdAt,createdBy)

# Only specific fields
GET /v1/products~just(identifiers,name,status)
```

### Deep Indexing

```bash
# Access by external identifier
GET /v1/products/com.example.sku=PROD-001

# Access nested property
GET /v1/products/com.example.sku=PROD-001/name

# Access array element
GET /v1/products/com.example.sku=PROD-001/gtin/0

# Access last element
GET /v1/products/com.example.sku=PROD-001/gtin/-1

# Sub-collection count
GET /v1/products/com.example.sku=PROD-001/categories/count
```

---

## Error Handling and Validation

### Common 4xx Errors

| Status | Cause | Resolution |
|--------|-------|------------|
| 400 | Invalid request body | Check JSON syntax and field types |
| 400 | Missing required field | Include `identifiers`, `name` |
| 400 | Invalid identifier format | Use `com.namespace.key` format |
| 404 | Product not found | Verify identifier exists |
| 409 | Duplicate identifier | Use different identifier or PUT for upsert |

### Validation Rules

1. **Identifiers must be namespaced:**
   ```bash
   # WRONG
   {"identifiers": {"sku": "..."}}

   # RIGHT
   {"identifiers": {"com.example.sku": "..."}}
   ```

2. **Status must be valid:**
   ```bash
   # Valid values: "Active", "Inactive", "Pending"
   {"status": "Active"}
   ```

3. **GTIN format:**
   ```bash
   # GTINs are strings, typically 8-14 digits
   {"gtin": ["7312345678901"]}
   ```

4. **VAT code reference:**
   ```bash
   # Reference by percentage
   {"defaultVatCode": {"identifiers": {"percentage": "25"}}}
   ```

### Preconditions

- `DELETE /v1/products/{id}` is a **no-op** (the product resource doesn't implement purge). To retire a product, use `PATCH` with `{"status": "Inactive"}` instead.
- Status changes to `Inactive` preserve historical data and keep the product available for order history/reporting
- VAT codes must exist before referencing

---

## Integration Playbook: Catalog Sync

This section provides a phased approach to building a catalog integration.

### Phase 1: Foundation

**Checkpoint:** Categories and VAT codes exist

```bash
# 1. Create VAT codes
PUT /v1/vat-codes/percentage=25
{"identifiers": {"percentage": 25}}

PUT /v1/vat-codes/percentage=12
{"identifiers": {"percentage": 12}}

# 2. Create category structure
POST /v1/product-categories
{ "identifiers": {"com.example.catId": "ROOT"}, "name": "All Products" }

POST /v1/product-categories
{ "identifiers": {"com.example.catId": "ELECTRONICS"}, "name": "Electronics" }

# Link ELECTRONICS as child of ROOT via childCategories collection
POST /v1/product-categories/com.example.catId=ROOT/childCategories
{ "identifiers": {"com.example.catId": "ELECTRONICS"} }
```

### Phase 2: Products

**Checkpoint:** Products created with proper identifiers and VAT

```bash
# 3. Create products using PUT for upsert
PUT /v1/products/com.example.sku=PROD-001
{
  "name": "Product Name",
  "status": "Active",
  "gtin": ["7312345678901"],
  "defaultVatCode": {"identifiers": {"percentage": "25"}}
}

# 4. Assign to categories
POST /v1/products/com.example.sku=PROD-001/categories
{"category": {"identifiers": {"com.example.catId": "ELECTRONICS"}}}
```

### Phase 3: Pricing

**Checkpoint:** Products have prices for sellers

```bash
# 5. Create prices (see Prices guide for details)
# Required fields: products, sellers, buyers, amount, currency, from, to
POST /v1/prices
{
  "identifiers": {"com.example.priceId": "PROD-001-PRICE"},
  "products": [{"identifiers": {"com.example.sku": "PROD-001"}}],
  "sellers": [{"identifiers": {"com.example.storeId": "STORE-001"}}],
  "buyers": [],
  "amount": "99.00",
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "from": "2024-01-01T00:00:00Z",
  "to": "2099-12-31T23:59:59Z"
}
```

### Phase 4: Stock

**Checkpoint:** Initial stock levels recorded

```bash
# 6. Record initial stock (see Stock guide)
POST /v1/stock-adjustments
{
  "timestamp": "2024-12-15T00:00:00Z",
  "owner": {"identifiers": {"com.example.companyId": "OUR-COMPANY"}},
  "items": [{
    "product": {"identifiers": {"com.example.sku": "PROD-001"}},
    "place": {"identifiers": {"com.example.stockPlaceId": "WAREHOUSE-001"}},
    "reason": {"identifiers": {"com.example.reasonId": "INITIAL"}},
    "quantity": 100
  }]
}
```

### Phase 5: Verification

```bash
# Verify product with all expansions
GET /v1/products/com.example.sku=PROD-001~with(prices,categories,stockLevels)

# Expected: Complete product with price, category, and stock data
```

---

## Case Study: Full Product Lifecycle

This case study demonstrates creating a mobile device product end-to-end, from initial creation through order and receipt.

### Step 1: Create the Device Product

```bash
POST /v1/products
{
  "identifiers": {"com.example.sku": "GALAXY-S24"},
  "name": "Samsung Galaxy S24",
  "status": "Active",
  "instanceType": "MobileDevice",
  "gtin": ["8806095070568"],
  "defaultVatCode": {"identifiers": {"percentage": "25"}},
  "promotionTitle": {"en-US": "Latest Galaxy Flagship"},
  "keywords": "samsung galaxy s24 android smartphone"
}

# Response:
{
  "@type": "product",
  "identifiers": {
    "key": "abc123...",
    "com.example.sku": "GALAXY-S24"
  },
  "name": "Samsung Galaxy S24",
  "status": "Active",
  "gtin": ["8806095070568"]
}
```

### Step 2: Create Associated Plan

```bash
POST /v1/products
{
  "identifiers": {"com.example.sku": "PLAN-5G-UNLIMITED"},
  "name": "5G Unlimited Plan",
  "status": "Active",
  "instanceType": "MobilePlan",
  "defaultVatCode": {"identifiers": {"percentage": "25"}}
}
```

### Step 3: Set Up Pricing

```bash
# Device price (include buyers and validity period)
POST /v1/prices
{
  "identifiers": {"com.example.priceId": "GALAXY-S24-PRICE"},
  "products": [{"identifiers": {"com.example.sku": "GALAXY-S24"}}],
  "sellers": [{"identifiers": {"com.example.storeId": "STORE-001"}}],
  "buyers": [],
  "amount": "7999.00",
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "from": "2024-01-01T00:00:00Z",
  "to": "2099-12-31T23:59:59Z"
}

# Plan price (include buyers and validity period)
POST /v1/prices
{
  "identifiers": {"com.example.priceId": "PLAN-5G-PRICE"},
  "products": [{"identifiers": {"com.example.sku": "PLAN-5G-UNLIMITED"}}],
  "sellers": [{"identifiers": {"com.example.storeId": "STORE-001"}}],
  "buyers": [],
  "amount": "399.00",
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "from": "2024-01-01T00:00:00Z",
  "to": "2099-12-31T23:59:59Z"
}
```

### Step 4: Stock the Device

```bash
POST /v1/stock-adjustments
{
  "timestamp": "2024-12-15T09:00:00Z",
  "owner": {"identifiers": {"com.example.companyId": "OUR-COMPANY"}},
  "items": [{
    "product": {"identifiers": {"com.example.sku": "GALAXY-S24"}},
    "place": {"identifiers": {"com.example.stockPlaceId": "STORE-001-STOCK"}},
    "reason": {"identifiers": {"com.example.reasonId": "RECEIVED"}},
    "quantity": 10
  }]
}
```

### Step 5: Create Order with IMEI Tracking

```bash
POST /v1/trade-orders
{
  "identifiers": {"com.example.orderId": "ORD-2024-001"},
  "supplier": {"identifiers": {"com.example.companyId": "OUR-COMPANY"}},
  "customer": {"identifiers": {"com.example.personId": "CUST-001"}},
  "sellers": [{"identifiers": {"com.example.storeId": "STORE-001"}}],
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "items": [
    {
      "product": {"identifiers": {"com.example.sku": "GALAXY-S24"}},
      "instances": [{"imei": "352916109123456"}]
    },
    {
      "product": {"identifiers": {"com.example.sku": "PLAN-5G-UNLIMITED"}},
      "instances": [{"phoneImei": "352916109123456"}]
    }
  ]
}
```

### Step 6: Verify Final State

```bash
# Product with full context
GET /v1/products/com.example.sku=GALAXY-S24~with(prices,stockLevels)

# Order with items
GET /v1/trade-orders/com.example.orderId=ORD-2024-001~with(items)
```

---

## Business Rules and Pitfalls

### Critical Rules

1. **GTIN lookup uses `~where`, not direct indexer:**
   ```bash
   # WRONG - treats GTIN as identifier
   GET /v1/products/gtin=7312345678901

   # RIGHT - filters products by GTIN
   GET /v1/products~where(gtin=7312345678901)~first
   ```

2. **Namespaced identifiers are required:**
   ```bash
   # WRONG - bare key
   {"identifiers": {"sku": "..."}}

   # RIGHT - namespaced key
   {"identifiers": {"com.example.sku": "..."}}
   ```

3. **Localized and extended fields require `~with`:**
   ```bash
   GET /v1/products/...~with(promotionTitle,plu,hidden)
   ```

4. **Query param and operator mixing is supported:**
   ```bash
   # Valid - mixing is allowed with canonical normalization
   GET /v1/products~orderBy(name)?limit=10

   # Normalization order: format -> fields -> where -> orderBy -> skip -> take -> simpleJust
   # The above normalizes to: ~orderBy(name)~take(10)

   # Also valid
   GET /v1/products~orderBy(name)~take(10)
   GET /v1/products?orderby=name&limit=10
   ```

5. **VAT inheritance:**
   - If product has no `defaultVatCode`, it inherits from `parentGroup`
   - Ensure either product or group has a VAT code set

6. **Instance type is on product, not order:**
   - Set `instanceType: "MobileDevice"` when creating the product
   - Order items reference the product; `imei` tracking depends on product's instanceType

### Common Mistakes

| Mistake | Result | Fix |
|---------|--------|-----|
| Bare identifier keys | 400 Bad Request | Use `com.namespace.key` format |
| Direct GTIN indexing | 404 Not Found | Use `~where(gtin=...)~first` |
| Missing `~with` for PLU | Empty field | Add `~with(plu)` |
| Wrong instance type | Order validation fails | Check product's instanceType |

---

## Related Guides

- [Prices](prices.md) - Price creation, validity periods, seller/buyer scoping
- [VAT](vat.md) - Tax codes, rates, net/gross calculations
- [Orders](orders.md) - Using products in trade orders, IMEI tracking
- [Stock](stock.md) - Inventory management, stock places
- [Customers](customers.md) - Agent-product relationships, assortments
- [Receipts](../receipts.md) - Completed transactions with products
