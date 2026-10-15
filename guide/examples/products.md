# Products & Catalog Examples

Curl examples for products, categories, families, groups, labels, images, and the complete catalog hierarchy including product variants.

**Base URL:** `https://example.app.heads.com/api/v1`
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
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/products"

# Get product by external ID
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/products/com.heads.seedID=iphone16"

# Get product by GTIN (use ~where, NOT direct indexer)
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/products~where(gtin=7311250449246)~first"

# Get product by PLU
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/products~where(plu=4011)~first"

# Get product with prices
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/products/com.heads.seedID=iphone16~with(prices)"

# Get product with categories
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/products/com.heads.seedID=iphone16~with(categories)"

# Get product with assortment contexts
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/products/com.heads.seedID=iphone16/assortmentContexts"

# Get product's specific assortment context (by owner)
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/products/com.heads.seedID=iphone16/assortmentContexts/com.heads.seedID=ourcompany"

# Get product's images
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/products/com.heads.seedID=iphone16/images"

# Get product's labels
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/products/com.heads.seedID=iphone16/labels"

# Create a simple product
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/products" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.sku": "SKU-001"},
    "name": "Basic T-Shirt",
    "status": "Active"
  }'

# Create product with GTIN and PLU
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/products" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.sku": "SKU-002"},
    "name": "Premium Headphones",
    "gtin": ["7312345678901"],
    "plu": ["1234"],
    "status": "Active"
  }'

# Create product with assortment context
# Without an "assortmentOwners" array the product ALSO lands in the assortment of the owner
# of the key's node. Send "assortmentOwners": [] to place it in the named assortments only.
# See reference/working-with/assortments.md ("The default owner on create").
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/products" \
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
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/products/com.myapp.sku=SKU-001" \
  -H "Content-Type: application/json" \
  -d '{"name": "Premium T-Shirt", "status": "Active"}'

# Add a second identifier to an existing product (@value envelope:
# the outer identifiers find the product, the inner ones are written onto it)
curl -X PUT -u ":banana" "https://example.app.heads.com/api/v1/products" \
  -H "Content-Type: application/json" \
  -d '[{
    "identifiers": {"com.myapp.sku": "SKU-001"},
    "@value": {"identifiers": {"com.myapp.pimId": "PIM-00012345"}}
  }]'

# The product now answers to both keys, with every other member untouched
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/products/com.myapp.pimId=PIM-00012345"

# Update a product through the envelope (same effect as the flat PATCH above;
# note that an outer sibling would win over the same member inside @value)
curl -X PUT -u ":banana" "https://example.app.heads.com/api/v1/products" \
  -H "Content-Type: application/json" \
  -d '[{
    "identifiers": {"com.myapp.sku": "SKU-001"},
    "@value": {"name": "Premium T-Shirt", "status": "Active"}
  }]'

# Assign product to category
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/products/com.myapp.sku=SKU-001/categories" \
  -H "Content-Type: application/json" \
  -d '{"category": {"identifiers": {"com.myapp.catId": "CAT-001"}}}'

# Add product to assortment owner
# Name the agent whose assortment the stores use, usually the company. Naming a store
# that uses its company's assortment puts the product on the company.
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/products/com.myapp.sku=SKU-001/assortmentOwners" \
  -H "Content-Type: application/json" \
  -d '[{"identifiers": {"com.heads.seedID": "ourcompany"}}]'

# Remove product from an assortment owner (nothing on assortmentContexts removes)
curl -X DELETE -u ":banana" "https://example.app.heads.com/api/v1/products/com.myapp.sku=SKU-001/assortmentOwners/com.heads.seedID=ourcompany"

# Delete product
curl -X DELETE -u ":banana" "https://example.app.heads.com/api/v1/products/com.myapp.sku=SKU-001"
```

---

## Product Categories

```bash
# List all product categories
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/product-categories"

# Get category by external ID
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/product-categories/com.heads.seedID=electronics"

# Get category with child categories
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/product-categories/com.heads.seedID=electronics~with(childCategories)"

# Get category members (products)
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/product-categories/com.heads.seedID=electronics/members"

# Create a root category
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/product-categories" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.catId": "CAT-001"},
    "name": "Electronics"
  }'

# Create a child category (two-step: create category, then add to parent's childCategories)
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/product-categories" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.catId": "CAT-002"},
    "name": "Smartphones"
  }'

# Add the child category to parent's childCategories collection
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/product-categories/com.myapp.catId=CAT-001/childCategories" \
  -H "Content-Type: application/json" \
  -d '{"identifiers": {"com.myapp.catId": "CAT-002"}}'

# Update category
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/product-categories/com.myapp.catId=CAT-001" \
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
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/product-families"

# Get product family with variants
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/product-families/com.heads.seedID=iphone-family~with(variants)"

# Create a product family with parent group
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/product-families" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.familyId": "tshirt-basic"},
    "name": "Basic T-Shirt",
    "parentGroup": {"identifiers": {"com.myapp.groupId": "apparel"}},
    "instanceType": "Apparel"
  }'

# Set variant dimensions (MUST be a comma+space separated string)
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/product-families/com.myapp.familyId=tshirt-basic" \
  -H "Content-Type: application/json" \
  -d '{
    "variantDimensions": "Apparel::size, Apparel::color"
  }'

# Clear variant dimensions by setting to null
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/product-families/com.myapp.familyId=tshirt-basic" \
  -H "Content-Type: application/json" \
  -d '{"variantDimensions": null}'

# Which values the variants come in, for a dimension whose property takes its values from a list.
# A key the list does not have yet is added to it as a new value, so a feed need not register sizes first
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/product-families/com.myapp.familyId=tshirt-basic" \
  -H "Content-Type: application/json" \
  -d '{"variantValues": {"Apparel::size": ["S", "M", "L"], "Apparel::color": ["Red", "Black"]}}'

# Read the lists in effect (its own, else the nearest group's). Not in the default body
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/product-families/com.myapp.familyId=tshirt-basic~with(variantValues)"

# Fall back to the group's list for one dimension: null or [] clears the family's own
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/product-families/com.myapp.familyId=tshirt-basic" \
  -H "Content-Type: application/json" \
  -d '{"variantValues": {"Apparel::size": null}}'
```

> `variantValues` names only dimensions whose property takes its values from a list. A free-text property is refused: `400` `Property 'Apparel::color' does not take its values from a list.` A list equal to the one the family gets from its group is not stored.

### Creating Variant Products

Variants are regular `product` entities with their `parentGroup` set to the family. Set `instanceType` and `instanceProperties` to define the specific variant attributes.

> **Important:** `instanceProperties` is currently **write-only** — the getter returns `{}`. Store variant values but do not rely on reading them back.

```bash
# Create variant product attached to family
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/products" \
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
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/products" \
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
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/product-families/com.myapp.familyId=tshirt-basic~with(variants)"

# Get variants with specific fields
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/product-families/com.myapp.familyId=tshirt-basic~with(variants/identifiers,variants/name)"

# Get variants with prices
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/product-families/com.myapp.familyId=tshirt-basic~with(variants/prices)"

# Get variants with stock levels
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/product-families/com.myapp.familyId=tshirt-basic~with(variants/stockLevels)"

# Access variants collection directly
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/product-families/com.myapp.familyId=tshirt-basic/variants"

# Count variants
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/product-families/com.myapp.familyId=tshirt-basic/variants~count"
```

### Instance Properties Write Rules

`instanceProperties` values must follow these rules:
- **Property names must exist** — use `Type::property` format (e.g., `Apparel::size`)
- **Supported types:** `string`, `number`, `boolean` only
- **Unknown properties return 400 Bad Request**

```bash
# Valid: string values
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/products/com.myapp.sku=tshirt-basic-s-red" \
  -H "Content-Type: application/json" \
  -d '{
    "instanceProperties": {
      "Apparel::size": "S",
      "Apparel::color": "Red"
    }
  }'

# Valid: numeric value (number type)
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/products/com.myapp.sku=widget-001" \
  -H "Content-Type: application/json" \
  -d '{
    "instanceProperties": {
      "Widget::weight": 1.5
    }
  }'

# Invalid: unknown property (will return 400)
# curl -X PATCH ... -d '{"instanceProperties": {"invalid::prop": "value"}}'
```

### Tenant-Defined Attributes

`attributes` carries a product's values for the attributes of products the tenant has defined, keyed by qualified name (`Product::season`). It is not `instanceProperties`: those belong to the instance type, these to the product.

```bash
# Write some; the attributes left out are untouched
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/products/com.myapp.sku=tshirt-basic-s-red" \
  -H "Content-Type: application/json" \
  -d '{"attributes": {"Product::season": "SS26", "Product::material": "cotton", "Product::weightGrams": 180}}'

# Clear one with null
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/products/com.myapp.sku=tshirt-basic-s-red" \
  -H "Content-Type: application/json" \
  -d '{"attributes": {"Product::material": null}}'

# Read them back. Not in the default body
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/products/com.myapp.sku=tshirt-basic-s-red~with(attributes)"

# Refused, 400: a name no attribute has (or one without the Product:: prefix)
#   details: "Attribute 'Product::colour' not found."
# Refused, 400: a non-numeric string for a number attribute
#   details: "Value for <what> must be a numeric string or a number."
```

A text, number or boolean attribute takes a value of that kind. An attribute that takes its values from a list takes the **key** of a value, and a key the list does not have yet is added as a new value.

---

## Product Groups (Hierarchical Organizers)

Product groups organize products and families in a tree structure. They can hold variant dimensions and a VAT class that the products under them inherit.

> **Important:** Use `parentGroup` and `members` relationships — product groups do NOT have `parent` or `children` fields.

### Basic Operations

```bash
# List all product groups
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/product-groups"

# Get product group with members
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/product-groups/com.myapp.groupId=GRP-001~with(members)"

# Get group's members (products, families, and sub-groups)
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/product-groups/com.myapp.groupId=GRP-001/members"

# Create a root product group
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/product-groups" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.groupId": "apparel"},
    "name": "Apparel",
    "instanceType": "Apparel"
  }'

# Create child group (use parentGroup, not parent)
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/product-groups" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.groupId": "apparel-summer"},
    "name": "Summer Collection",
    "parentGroup": {"identifiers": {"com.myapp.groupId": "apparel"}}
  }'

# Assign product to group (via parentGroup on the product, NOT group's members)
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/products/com.myapp.sku=SKU-001" \
  -H "Content-Type: application/json" \
  -d '{"parentGroup": {"identifiers": {"com.myapp.groupId": "apparel-summer"}}}'
```

### Variant Dimensions on Groups

Groups can store **default** `variantDimensions` intended for families created within them. However, the API reads `variantDimensions` directly from each node—families do not automatically inherit group values. If you want a family to use the group's dimensions, set `variantDimensions` explicitly on the family. (An `effectiveVariantDimensions` property exists internally but is not exposed via the API.)

```bash
# Set variant dimensions on a group (applies to families in the group)
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/product-groups/com.myapp.groupId=apparel" \
  -H "Content-Type: application/json" \
  -d '{
    "variantDimensions": "Apparel::size, Apparel::color"
  }'

# variantValues on a group ARE inherited: the values families in this group take, for every
# family under it that lists nothing of its own for the dimension
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/product-groups/com.myapp.groupId=apparel" \
  -H "Content-Type: application/json" \
  -d '{"variantValues": {"Apparel::size": ["XS", "S", "M", "L", "XL"]}}'
```

### VAT Class Inheritance

`vatClass` can be set at any level in the group hierarchy. A product reads the class in effect: its own, else the nearest ancestor's. Set it on a group once; override on a product when needed; `null` on the product clears the override. See [Assigning VAT to products](../../reference/working-with/vat.md#assigning-vat-to-products).

```bash
# Set default VAT for entire group
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/product-groups/com.myapp.groupId=apparel" \
  -H "Content-Type: application/json" \
  -d '{
    "vatClass": {"identifiers": {"com.heads.seedID": "vat-class-standard"}}
  }'

# Read the class in effect and the rates it gives per VAT area
curl -u ":banana" "https://example.app.heads.com/api/v1/products/com.myapp.sku=SKU-001~with(vatClass,vatRates)"
```

> **Note:** `vatClass` is not in the default read of a product or group; ask with `~with(vatClass)`. It reads the class in effect, inherited or own. A product with no class, own or inherited, cannot be sold. See [VAT classes](../../reference/working-with/vat.md#vat-classes).

### Maximum Discount Percentage

`maxDiscountPercentage` (decimal, optional) caps the automatic discount on a product node: "The maximum discount percentage allowed on this product node. When set, discounts exceeding this percentage are capped." It is inherited like the VAT class — a value on a group or family applies to every product under it — and it caps what [discount rules](./discount-rules.md#discount-caps-and-vouchers) do; manual discounts at the till are exempt at recalculation.

```bash
# Cap automatic discounts on a whole group at 20%
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/product-groups/com.myapp.groupId=apparel" \
  -H "Content-Type: application/json" \
  -d '{"maxDiscountPercentage": "20"}'

# Tighter cap on one product (a value of its own wins over the inherited one)
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/products/com.myapp.sku=SKU-001" \
  -H "Content-Type: application/json" \
  -d '{"maxDiscountPercentage": "10"}'

# Read it back
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/products/com.myapp.sku=SKU-001~with(maxDiscountPercentage)"
```

See [Working with Products → Maximum Discount Percentage](../../reference/working-with/products.md#maximum-discount-percentage-maxdiscountpercentage).

### Querying the Hierarchy

```bash
# Get group with parent reference
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/product-groups/com.myapp.groupId=apparel-summer~with(parentGroup)"

# Find root groups (those without a parent)
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/product-groups~where(!parentGroup)~take(20)"

# Count members in a group
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/product-groups/com.myapp.groupId=apparel/members~count"
```

---

## Labels

```bash
# List all labels
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/labels"

# Get label by ID
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/labels/com.myapp.labelId=sale"

# Create a label
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/labels" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.labelId": "sale"},
    "title": "On Sale",
    "description": "Items currently on sale",
    "color": "#FF0000"
  }'

# Create label restricted to specific types
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/labels" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.labelId": "vip-customer"},
    "title": "VIP Customer",
    "color": "#FFD700",
    "applicableOnlyTo": ["person", "company"]
  }'

# Assign label to entity
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/products/com.myapp.sku=SKU-001/labels" \
  -H "Content-Type: application/json" \
  -d '{"identifiers": {"com.myapp.labelId": "sale"}}'
```

> For the full labels guide covering all entity types, type restrictions, filtering, and integration patterns, see [Working with Labels](labels.md). For entity-specific examples, see [Orders](../../reference/working-with/orders.md#labels) and [Customers](../../reference/working-with/customers.md#labels).

---

## Images

An image either refers to a URL (`identifiers.url`) or carries its content, sent as `data`, which CommerceOS stores and serves at `contentUrl`. There are no `altText` or `sortOrder` fields; display order is insertion order. Writes need `media:write`.

```bash
# Get product's images
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/products/com.myapp.sku=SKU-001/images"

# Add image to product by URL (CommerceOS fetches it when it is shown)
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/products/com.myapp.sku=SKU-001/images" \
  -H "Content-Type: application/json" \
  -d '{"identifiers": {"url": "https://example.com/images/product-001.jpg"}}'

# Add another image (insertion order determines display order)
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/products/com.myapp.sku=SKU-001/images" \
  -H "Content-Type: application/json" \
  -d '{"identifiers": {"url": "https://example.com/images/product-001-back.jpg"}}'

# Add an image with content, under your own identifier: a data: URL or bare base64,
# JPEG, PNG, WebP, GIF, AVIF, TIFF or SVG, at most 20 MiB
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/products/com.myapp.sku=SKU-001/images" \
  -H "Content-Type: application/json" \
  -d '[{"identifiers": {"com.myapp.imageId": "SKU-001-front"}, "name": "front.png", "data": "iVBORw0KGgoAAAANSUhEUgAAABQAAAAK…"}]'
# [{"@type": "image", "identifiers": {…, "com.myapp.imageId": "SKU-001-front"}, "name": "front.png",
#   "contentUrl": "https://example.app.heads.com/images/7e267ff8f5517a12580a81900410f8ae.png"}]

# mediaType, width and height come from the content; ask for them
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/products/com.myapp.sku=SKU-001/images/com.myapp.imageId=SKU-001-front~withAll"
# …, "mediaType": "image/png", "width": 20, "height": 10

# Fetch the content. The extension picks the format; w and h (at most 2000) resize, fit says how
curl -o thumb.png "https://example.app.heads.com/images/7e267ff8f5517a12580a81900410f8ae.png?w=10"
curl -o thumb.webp "https://example.app.heads.com/images/7e267ff8f5517a12580a81900410f8ae.webp?w=10&h=10&fit=contain"

# Remove image by URL, or by your identifier
curl -X DELETE -u ":banana" "https://example.app.heads.com/api/v1/products/com.myapp.sku=SKU-001/images/url=https%3A%2F%2Fexample.com%2Fimages%2Fproduct-001.jpg"
curl -X DELETE -u ":banana" "https://example.app.heads.com/api/v1/products/com.myapp.sku=SKU-001/images/com.myapp.imageId=SKU-001-front"
```

### Files

Documents — datasheets, manuals, certificates — are files, held as `files` on a product node (and as `attachments` on an agent, see [Organization](organization.md#companies)). There is no `/v1/files` collection: a file is reached through what holds it, and one that nothing holds any more is deleted.

```bash
# Attach a datasheet whose link expires after a day (accessControl Signed; Public is the default, Private has no link)
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/products/com.myapp.sku=SKU-001/files" \
  -H "Content-Type: application/json" \
  -d '[{"identifiers": {"com.myapp.fileId": "SKU-001-datasheet"}, "name": "datasheet.pdf",
        "data": "data:application/pdf;base64,JVBERi0xLjQK…", "accessControl": "Signed"}]'
# [{"@type": "file", "identifiers": {…}, "name": "datasheet.pdf", "mediaType": "application/pdf",
#   "contentUrl": "https://example.app.heads.com/files/0dbd032a60177a2cb9aef44603b061ae?exp=1792191867&sig=…"}]

# A file that refers to a URL instead of carrying content
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/products/com.myapp.sku=SKU-001/files" \
  -H "Content-Type: application/json" \
  -d '[{"identifiers": {"url": "https://example.com/docs/SKU-001-manual.pdf"}, "name": "manual.pdf"}]'

# Everything about the files: accessControl, expiresAt, verified, verifiedAt
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/products/com.myapp.sku=SKU-001/files~withAll"

# The product with its files and images
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/products/com.myapp.sku=SKU-001~with(files,images)"

# Take a file off the product. Held by nothing else, it is deleted and its identifier is free again
curl -X DELETE -u ":banana" "https://example.app.heads.com/api/v1/products/com.myapp.sku=SKU-001/files/com.myapp.fileId=SKU-001-datasheet"
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/products/com.myapp.sku=SKU-001/files"
# []
```

---

## Complete Variant Creation Workflow

This example shows the complete flow for creating a product group, family, and variants:

```bash
# Step 1: Create the product group
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/product-groups" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.groupId": "apparel"},
    "name": "Apparel",
    "instanceType": "Apparel"
  }'

# Step 2: Create the product family with variant dimensions
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/product-families" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.familyId": "tshirt-basic"},
    "name": "Basic T-Shirt",
    "parentGroup": {"identifiers": {"com.myapp.groupId": "apparel"}},
    "instanceType": "Apparel",
    "variantDimensions": "Apparel::size, Apparel::color"
  }'

# Step 3: Create variant products
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/products" \
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

curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/products" \
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
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/product-families/com.myapp.familyId=tshirt-basic~with(variants)"
```

---

## Sales Channels and Assortment

Sales channels control where products are available (POS, webshop, mobile). The `salesChannels` member exists on `product` and `product family` (sellable nodes) only; `product category` and `product group` do not expose `salesChannels`.

```bash
# Get product's sales channels
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/products/com.myapp.sku=SKU-001~with(salesChannels)"

# Get family's sales channels
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/product-families/com.myapp.familyId=tshirt-basic~with(salesChannels)"

# Assign product to sales channel
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/products/com.myapp.sku=SKU-001/salesChannels" \
  -H "Content-Type: application/json" \
  -d '{"identifiers": {"com.myapp.channelId": "webshop"}}'

# Get assortment contexts (per-owner article numbers)
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/products/com.myapp.sku=SKU-001/assortmentContexts"
```

For which assortment a store uses, where a new product lands and what makes it sell at the till, see [Working with Assortments](../../reference/working-with/assortments.md).

---

## Notes

### Catalog Hierarchy
- **Product Groups**: Assign products via `parentGroup` on the product, NOT via the group's `members`
- **Product Families**: Use `parentGroup` to attach variants to a family
- **Category Hierarchy**: Categories have NO `parent` setter — add child categories via parent's `childCategories` collection
- **Inherited members**: `vatClass` and `maxDiscountPercentage` set on a group or family apply to the products under it

### Variant Dimensions
- **`variantDimensions` is a STRING**, not an array: `"Apparel::size, Apparel::color"`
- Property names must follow `Type::property` format
- Unknown property names return **400 Bad Request**
- Clear by setting to `null`
- **`variantValues`** is an object of arrays: `{"Apparel::size": ["S", "M"]}`, only for dimensions whose property takes its values from a list. A group's lists are inherited by the families under it; a new key becomes a new list value

### Tenant-Defined Attributes
- `attributes` on a product: `{"Product::season": "SS26"}`, by the attribute's qualified name; `null` clears one, attributes left out are untouched
- A list attribute takes a value **key**; an unknown key is added to the list
- Unknown attribute names, and a non-numeric string for a number attribute, return **400 Bad Request**

### Instance Properties
- **Write-only**: reads currently return `{}`
- Property names must exist and follow `Type::property` format
- Only `string`, `number`, `boolean` values are supported

### Images and Files
- An image refers to a URL (`identifiers.url`) or carries content (`data`, write-only); `contentUrl` serves it, with `w`, `h` and `fit` to resize
- NO `altText` or `sortOrder` fields; display order determined by insertion order
- Files live under a product's `files` (and an agent's `attachments`); a file nothing holds is deleted
- Both need `media:read` / `media:write`

### Lookups
- **GTIN/PLU Lookup**: Use `~where(gtin=...)~first`, NOT direct indexer
- **External IDs**: Use reverse domain notation for namespacing (e.g., `com.myapp.sku`)

### Reading Variants
- Use `~with(variants)` on product families to expand variants
- Use `~with(variants/prices)` or `~with(variants/stockLevels)` for nested expansions
