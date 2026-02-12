# Products & Catalog Examples

Curl examples for products, categories, families, groups, labels, images, and the complete catalog hierarchy including product variants.

**Base URL:** `http://localhost:5000/api/v1`
**API Key:** `banana` (passed via Basic Auth with empty username: `-u ":banana"`)

> **See also:** [Examples Index](../examples.md) | [Reference Documentation](../../reference/) | [Working with Products](../../reference/working-with/products.md)

---

## Catalog Hierarchy Overview

CommerceOS organizes catalog data in a hierarchical structure where **product node** is the base type:

```
Product Node (base type)
  ├── Product Group → organizes families and products
  │     └── Product Family → groups variant products
  │           └── Product → sellable items (variants)
  └── Product Category → browsing/navigation structure
```

**Key relationships:**
- `parentGroup` — attaches a product/family to its parent (group or family)
- `variantDimensions` — string listing dimension property names on families
- `instanceType` + `instanceProperties` — defines variant attributes on products

> **Important:** All entities in the hierarchy—`product group`, `product family`, `product`, and `product category` (plus `product set` and `product package`)—are considered **product nodes** and share common fields like `identifiers`, `name`, `images`, `prices`, `categories`, and `labels`.

---

## Products

```bash
# List all products
curl -X GET -u ":banana" "localhost:5000/api/v1/products"

# Get product by external ID
curl -X GET -u ":banana" "localhost:5000/api/v1/products/com.heads.seedID=iphone16"

# Get product by GTIN (use ~where, NOT direct indexer)
curl -X GET -u ":banana" "localhost:5000/api/v1/products~where(gtin=7311250449246)~first"

# Get product by PLU
curl -X GET -u ":banana" "localhost:5000/api/v1/products~where(plu=4011)~first"

# Get product with prices
curl -X GET -u ":banana" "localhost:5000/api/v1/products/com.heads.seedID=iphone16~with(prices)"

# Get product with categories
curl -X GET -u ":banana" "localhost:5000/api/v1/products/com.heads.seedID=iphone16~with(categories)"

# Get product with assortment contexts
curl -X GET -u ":banana" "localhost:5000/api/v1/products/com.heads.seedID=iphone16/assortmentContexts"

# Get product's specific assortment context (by owner)
curl -X GET -u ":banana" "localhost:5000/api/v1/products/com.heads.seedID=iphone16/assortmentContexts/com.heads.seedID=ourcompany"

# Get product's images
curl -X GET -u ":banana" "localhost:5000/api/v1/products/com.heads.seedID=iphone16/images"

# Get product's labels
curl -X GET -u ":banana" "localhost:5000/api/v1/products/com.heads.seedID=iphone16/labels"

# Create a simple product
curl -X POST -u ":banana" "localhost:5000/api/v1/products" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.sku": "SKU-001"},
    "name": "Basic T-Shirt",
    "status": "Active"
  }'

# Create product with GTIN and PLU
curl -X POST -u ":banana" "localhost:5000/api/v1/products" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.sku": "SKU-002"},
    "name": "Premium Headphones",
    "gtin": ["7312345678901"],
    "plu": ["1234"],
    "status": "Active"
  }'

# Create product with assortment context
curl -X POST -u ":banana" "localhost:5000/api/v1/products" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.sku": "SKU-003"},
    "name": "Organic Coffee",
    "status": "Active",
    "assortmentContexts": [
      {
        "owner": {"identifiers": {"com.heads.seedID": "ourcompany"}},
        "articleNumber": "ART-12345"
      }
    ]
  }'

# Update product
curl -X PATCH -u ":banana" "localhost:5000/api/v1/products/com.myapp.sku=SKU-001" \
  -H "Content-Type: application/json" \
  -d '{"name": "Premium T-Shirt", "status": "Active"}'

# Assign product to category
curl -X POST -u ":banana" "localhost:5000/api/v1/products/com.myapp.sku=SKU-001/categories" \
  -H "Content-Type: application/json" \
  -d '{"category": {"identifiers": {"com.myapp.catId": "CAT-001"}}}'

# Add product to assortment owner
curl -X POST -u ":banana" "localhost:5000/api/v1/products/com.myapp.sku=SKU-001/assortmentOwners" \
  -H "Content-Type: application/json" \
  -d '{"@type": "store", "identifiers": {"com.heads.seedID": "store1"}}'

# Delete product
curl -X DELETE -u ":banana" "localhost:5000/api/v1/products/com.myapp.sku=SKU-001"
```

---

## Product Categories

```bash
# List all product categories
curl -X GET -u ":banana" "localhost:5000/api/v1/product-categories"

# Get category by external ID
curl -X GET -u ":banana" "localhost:5000/api/v1/product-categories/com.heads.seedID=electronics"

# Get category with child categories
curl -X GET -u ":banana" "localhost:5000/api/v1/product-categories/com.heads.seedID=electronics~with(childCategories)"

# Get category members (products)
curl -X GET -u ":banana" "localhost:5000/api/v1/product-categories/com.heads.seedID=electronics/members"

# Create a root category
curl -X POST -u ":banana" "localhost:5000/api/v1/product-categories" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.catId": "CAT-001"},
    "name": "Electronics"
  }'

# Create a child category (two-step: create category, then add to parent's childCategories)
curl -X POST -u ":banana" "localhost:5000/api/v1/product-categories" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.catId": "CAT-002"},
    "name": "Smartphones"
  }'

# Add the child category to parent's childCategories collection
curl -X POST -u ":banana" "localhost:5000/api/v1/product-categories/com.myapp.catId=CAT-001/childCategories" \
  -H "Content-Type: application/json" \
  -d '{"identifiers": {"com.myapp.catId": "CAT-002"}}'

# Update category
curl -X PATCH -u ":banana" "localhost:5000/api/v1/product-categories/com.myapp.catId=CAT-001" \
  -H "Content-Type: application/json" \
  -d '{"name": "Electronics & Gadgets"}'
```

---

## Product Families (Variant Containers)

Product families group products that are variants of each other (same base product, different size/color/storage, etc.). The family defines which dimensions vary across its variants via `variantDimensions`.

### Understanding Variant Dimensions

> **Critical:** `variantDimensions` is a **comma+space separated string**, NOT an array of objects. Each dimension name must be a valid property in the format `Type::property`. Unknown property names return 400 Bad Request.

```bash
# List all product families
curl -X GET -u ":banana" "localhost:5000/api/v1/product-families"

# Get product family with variants
curl -X GET -u ":banana" "localhost:5000/api/v1/product-families/com.heads.seedID=iphone-family~with(variants)"

# Create a product family with parent group
curl -X POST -u ":banana" "localhost:5000/api/v1/product-families" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.familyId": "tshirt-basic"},
    "name": "Basic T-Shirt",
    "parentGroup": {"identifiers": {"com.myapp.groupId": "apparel"}},
    "instanceType": "Apparel"
  }'

# Set variant dimensions (MUST be a comma+space separated string)
curl -X PATCH -u ":banana" "localhost:5000/api/v1/product-families/com.myapp.familyId=tshirt-basic" \
  -H "Content-Type: application/json" \
  -d '{
    "variantDimensions": "Apparel::size, Apparel::color"
  }'

# Clear variant dimensions by setting to null
curl -X PATCH -u ":banana" "localhost:5000/api/v1/product-families/com.myapp.familyId=tshirt-basic" \
  -H "Content-Type: application/json" \
  -d '{"variantDimensions": null}'
```

### Creating Variant Products

Variants are regular `product` entities with their `parentGroup` set to the family. Set `instanceType` and `instanceProperties` to define the specific variant attributes.

> **Important:** `instanceProperties` is currently **write-only** — the getter returns `{}`. Store variant values but do not rely on reading them back.

```bash
# Create variant product attached to family
curl -X POST -u ":banana" "localhost:5000/api/v1/products" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.sku": "tshirt-basic-s-red"},
    "name": "Basic T-Shirt S Red",
    "parentGroup": {"identifiers": {"com.myapp.familyId": "tshirt-basic"}},
    "instanceType": "Apparel",
    "instanceProperties": {
      "Apparel::size": "S",
      "Apparel::color": "Red"
    },
    "status": "Active"
  }'

# Create another variant
curl -X POST -u ":banana" "localhost:5000/api/v1/products" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.sku": "tshirt-basic-m-blue"},
    "name": "Basic T-Shirt M Blue",
    "parentGroup": {"identifiers": {"com.myapp.familyId": "tshirt-basic"}},
    "instanceType": "Apparel",
    "instanceProperties": {
      "Apparel::size": "M",
      "Apparel::color": "Blue"
    },
    "status": "Active"
  }'
```

### Reading Variants

```bash
# List family variants
curl -X GET -u ":banana" "localhost:5000/api/v1/product-families/com.myapp.familyId=tshirt-basic~with(variants)"

# Get variants with specific fields
curl -X GET -u ":banana" "localhost:5000/api/v1/product-families/com.myapp.familyId=tshirt-basic~with(variants/identifiers,variants/name)"

# Get variants with prices
curl -X GET -u ":banana" "localhost:5000/api/v1/product-families/com.myapp.familyId=tshirt-basic~with(variants/prices)"

# Get variants with stock levels
curl -X GET -u ":banana" "localhost:5000/api/v1/product-families/com.myapp.familyId=tshirt-basic~with(variants/stockLevels)"

# Access variants collection directly
curl -X GET -u ":banana" "localhost:5000/api/v1/product-families/com.myapp.familyId=tshirt-basic/variants"

# Count variants
curl -X GET -u ":banana" "localhost:5000/api/v1/product-families/com.myapp.familyId=tshirt-basic/variants~count"
```

### Instance Properties Write Rules

`instanceProperties` values must follow these rules:
- **Property names must exist** — use `Type::property` format (e.g., `Apparel::size`)
- **Supported types:** `string`, `number`, `boolean` only
- **Unknown properties return 400 Bad Request**

```bash
# Valid: string values
curl -X PATCH -u ":banana" "localhost:5000/api/v1/products/com.myapp.sku=tshirt-basic-s-red" \
  -H "Content-Type: application/json" \
  -d '{
    "instanceProperties": {
      "Apparel::size": "S",
      "Apparel::color": "Red"
    }
  }'

# Valid: numeric value (number type)
curl -X PATCH -u ":banana" "localhost:5000/api/v1/products/com.myapp.sku=widget-001" \
  -H "Content-Type: application/json" \
  -d '{
    "instanceProperties": {
      "Widget::weight": 1.5
    }
  }'

# Invalid: unknown property (will return 400)
# curl -X PATCH ... -d '{"instanceProperties": {"invalid::prop": "value"}}'
```

---

## Product Groups (Hierarchical Organizers)

Product groups organize products and families in a tree structure. They can hold variant dimensions and VAT codes that cascade down to children.

> **Important:** Use `parentGroup` and `members` relationships — product groups do NOT have `parent` or `children` fields.

### Basic Operations

```bash
# List all product groups
curl -X GET -u ":banana" "localhost:5000/api/v1/product-groups"

# Get product group with members
curl -X GET -u ":banana" "localhost:5000/api/v1/product-groups/com.myapp.groupId=GRP-001~with(members)"

# Get group's members (products, families, and sub-groups)
curl -X GET -u ":banana" "localhost:5000/api/v1/product-groups/com.myapp.groupId=GRP-001/members"

# Create a root product group
curl -X POST -u ":banana" "localhost:5000/api/v1/product-groups" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.groupId": "apparel"},
    "name": "Apparel",
    "instanceType": "Apparel"
  }'

# Create child group (use parentGroup, not parent)
curl -X POST -u ":banana" "localhost:5000/api/v1/product-groups" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.groupId": "apparel-summer"},
    "name": "Summer Collection",
    "parentGroup": {"identifiers": {"com.myapp.groupId": "apparel"}}
  }'

# Assign product to group (via parentGroup on the product, NOT group's members)
curl -X PATCH -u ":banana" "localhost:5000/api/v1/products/com.myapp.sku=SKU-001" \
  -H "Content-Type: application/json" \
  -d '{"parentGroup": {"identifiers": {"com.myapp.groupId": "apparel-summer"}}}'
```

### Variant Dimensions on Groups

Groups can store **default** `variantDimensions` intended for families created within them. However, the API reads `variantDimensions` directly from each node—families do not automatically inherit group values. If you want a family to use the group's dimensions, set `variantDimensions` explicitly on the family. (An `effectiveVariantDimensions` property exists internally but is not exposed via the API.)

```bash
# Set variant dimensions on a group (applies to families in the group)
curl -X PATCH -u ":banana" "localhost:5000/api/v1/product-groups/com.myapp.groupId=apparel" \
  -H "Content-Type: application/json" \
  -d '{
    "variantDimensions": "Apparel::size, Apparel::color"
  }'
```

### VAT Code Inheritance

VAT codes can be assigned at any level in the group hierarchy. VAT calculations traverse `parentGroup` to find the nearest ancestor with a VAT rule, so effective VAT can be inherited.

```bash
# Set default VAT for entire group
curl -X PATCH -u ":banana" "localhost:5000/api/v1/product-groups/com.myapp.groupId=apparel" \
  -H "Content-Type: application/json" \
  -d '{
    "defaultVatCode": {"identifiers": {"percentage": "25"}}
  }'
```

> **Note:** Products use the nearest ancestor VAT rule for calculations, but `defaultVatCode` in API responses only shows direct assignments; set it on the product if you need it to appear on the product payload.

### Querying the Hierarchy

```bash
# Get group with parent reference
curl -X GET -u ":banana" "localhost:5000/api/v1/product-groups/com.myapp.groupId=apparel-summer~with(parentGroup)"

# Find root groups (those without a parent)
curl -X GET -u ":banana" "localhost:5000/api/v1/product-groups~where(!parentGroup)~take(20)"

# Count members in a group
curl -X GET -u ":banana" "localhost:5000/api/v1/product-groups/com.myapp.groupId=apparel/members~count"
```

---

## Labels

```bash
# List all labels
curl -X GET -u ":banana" "localhost:5000/api/v1/labels"

# Get label by ID
curl -X GET -u ":banana" "localhost:5000/api/v1/labels/com.myapp.labelId=sale"

# Create a label
curl -X POST -u ":banana" "localhost:5000/api/v1/labels" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.labelId": "sale"},
    "title": "On Sale",
    "description": "Items currently on sale",
    "color": "#FF0000"
  }'

# Create label restricted to specific types
curl -X POST -u ":banana" "localhost:5000/api/v1/labels" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.labelId": "vip-customer"},
    "title": "VIP Customer",
    "color": "#FFD700",
    "applicableOnlyTo": ["person", "company"]
  }'

# Assign label to entity
curl -X POST -u ":banana" "localhost:5000/api/v1/products/com.myapp.sku=SKU-001/labels" \
  -H "Content-Type: application/json" \
  -d '{"identifiers": {"com.myapp.labelId": "sale"}}'
```

> Labels can also be assigned to trade orders, companies, people, stores, POS terminals, and users using the same `POST /{resource}/{id}/labels` pattern. See [Orders](../../reference/working-with/orders.md#labels) and [Customers](../../reference/working-with/customers.md#labels) guides.

---

## Images

> **Note:** Images only have `identifiers.url` — no `altText` or `sortOrder` fields. Display order is determined by insertion order.

```bash
# Get product's images
curl -X GET -u ":banana" "localhost:5000/api/v1/products/com.myapp.sku=SKU-001/images"

# Add image to product (use identifiers.url only)
curl -X POST -u ":banana" "localhost:5000/api/v1/products/com.myapp.sku=SKU-001/images" \
  -H "Content-Type: application/json" \
  -d '{"identifiers": {"url": "https://example.com/images/product-001.jpg"}}'

# Add another image (insertion order determines display order)
curl -X POST -u ":banana" "localhost:5000/api/v1/products/com.myapp.sku=SKU-001/images" \
  -H "Content-Type: application/json" \
  -d '{"identifiers": {"url": "https://example.com/images/product-001-back.jpg"}}'

# Remove image by URL
curl -X DELETE -u ":banana" "localhost:5000/api/v1/products/com.myapp.sku=SKU-001/images/url=https%3A%2F%2Fexample.com%2Fimages%2Fproduct-001.jpg"
```

---

## Complete Variant Creation Workflow

This example shows the complete flow for creating a product group, family, and variants:

```bash
# Step 1: Create the product group
curl -X POST -u ":banana" "localhost:5000/api/v1/product-groups" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.groupId": "apparel"},
    "name": "Apparel",
    "instanceType": "Apparel"
  }'

# Step 2: Create the product family with variant dimensions
curl -X POST -u ":banana" "localhost:5000/api/v1/product-families" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.familyId": "tshirt-basic"},
    "name": "Basic T-Shirt",
    "parentGroup": {"identifiers": {"com.myapp.groupId": "apparel"}},
    "instanceType": "Apparel",
    "variantDimensions": "Apparel::size, Apparel::color"
  }'

# Step 3: Create variant products
curl -X POST -u ":banana" "localhost:5000/api/v1/products" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.sku": "tshirt-basic-s-red"},
    "name": "Basic T-Shirt S Red",
    "parentGroup": {"identifiers": {"com.myapp.familyId": "tshirt-basic"}},
    "instanceType": "Apparel",
    "instanceProperties": {
      "Apparel::size": "S",
      "Apparel::color": "Red"
    },
    "status": "Active"
  }'

curl -X POST -u ":banana" "localhost:5000/api/v1/products" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.sku": "tshirt-basic-m-blue"},
    "name": "Basic T-Shirt M Blue",
    "parentGroup": {"identifiers": {"com.myapp.familyId": "tshirt-basic"}},
    "instanceType": "Apparel",
    "instanceProperties": {
      "Apparel::size": "M",
      "Apparel::color": "Blue"
    },
    "status": "Active"
  }'

# Step 4: Verify the family with its variants
curl -X GET -u ":banana" "localhost:5000/api/v1/product-families/com.myapp.familyId=tshirt-basic~with(variants)"
```

---

## Sales Channels and Assortment

Sales channels control where products are available (POS, webshop, mobile). The `salesChannels` member exists on `product` and `product family` (sellable nodes) only; `product category` and `product group` do not expose `salesChannels`.

```bash
# Get product's sales channels
curl -X GET -u ":banana" "localhost:5000/api/v1/products/com.myapp.sku=SKU-001~with(salesChannels)"

# Get family's sales channels
curl -X GET -u ":banana" "localhost:5000/api/v1/product-families/com.myapp.familyId=tshirt-basic~with(salesChannels)"

# Assign product to sales channel
curl -X POST -u ":banana" "localhost:5000/api/v1/products/com.myapp.sku=SKU-001/salesChannels" \
  -H "Content-Type: application/json" \
  -d '{"identifiers": {"com.myapp.channelId": "webshop"}}'

# Get assortment contexts (per-owner article numbers)
curl -X GET -u ":banana" "localhost:5000/api/v1/products/com.myapp.sku=SKU-001/assortmentContexts"
```

---

## Notes

### Catalog Hierarchy
- **Product Groups**: Assign products via `parentGroup` on the product, NOT via the group's `members`
- **Product Families**: Use `parentGroup` to attach variants to a family
- **Category Hierarchy**: Categories have NO `parent` setter — add child categories via parent's `childCategories` collection

### Variant Dimensions
- **`variantDimensions` is a STRING**, not an array: `"Apparel::size, Apparel::color"`
- Property names must follow `Type::property` format
- Unknown property names return **400 Bad Request**
- Clear by setting to `null`

### Instance Properties
- **Write-only**: reads currently return `{}`
- Property names must exist and follow `Type::property` format
- Only `string`, `number`, `boolean` values are supported

### Images
- Only `identifiers.url` exists — NO `altText` or `sortOrder` fields
- Display order determined by insertion order

### Lookups
- **GTIN/PLU Lookup**: Use `~where(gtin=...)~first`, NOT direct indexer
- **External IDs**: Use reverse domain notation for namespacing (e.g., `com.myapp.sku`)

### Reading Variants
- Use `~with(variants)` on product families to expand variants
- Use `~with(variants/prices)` or `~with(variants/stockLevels)` for nested expansions
