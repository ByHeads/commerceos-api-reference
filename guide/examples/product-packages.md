# Product Packages Examples

Curl examples for product packages, package classes, product compositions, supply relations, and package discount rules. Product packages model how products are physically packaged for trade — cartons, pallets, 6-packs, sleeves — and how those packages flow through supply relations, trade orders, and discount rules.

**Base URL:** `https://example.app.heads.com/api/v1`
**API Key:** `banana` (passed via Basic Auth with empty username: `-u ":banana"`)

> **See also:** [Examples Index](../examples.md) | [Discount Rules](./discount-rules.md) | [Orders & Fulfillment](./orders.md) | [Products & Catalog](./products.md) | [Reference Documentation](../../reference/)

---

## Type Hierarchy

Understanding the type hierarchy is critical for working with packages:

```
product node (base)
└── product composition (abstract — has manifest)
    ├── product package (adds packageClass)
    └── product set (no additional fields — for bundles like "Combo Meal")
```

| Property | Purpose |
|----------|---------|
| `packageClass` | References a `product package class` — the classification (Carton, Pallet, etc.). **Required on create.** |
| `manifest` | Array of entries, each with a `product` reference and `quantity`. Defines what's inside the package. |
| `name` | Display name. May inherit from the package class if omitted. |
| `identifiers` | External identifiers for lookup. |

**Key concept — simple vs complex packages:**
- A **simple package** has one manifest entry (e.g., "Carton of 10 Levis 501"). The system can compute unit-to-package quantity conversions directly.
- A **complex package** has multiple manifest entries (e.g., "Mixed Snack Pallet with 24 chips + 24 nuts"). Automatic quantity conversion is not supported for complex packages.

---

## Section 1: Package Classes — CRUD and Predefined Classes

Package classes are classifications for packages. They are intentionally minimal — only `identifiers` and `name`, with no physical properties like dimensions, weight, or volume. If you need to track physical attributes, use custom identifiers and manage the mapping externally.

### Predefined package classes

The system ships with 7 predefined classes:

| Identifier | Name | Description |
|------------|------|-------------|
| `package-class-carton` | Krt | Carton — standard shipping box |
| `package-class-pallet` | Pall | Full pallet (EUR pallet: 120×80 cm) |
| `package-class-half-pallet` | ½ Pall | Half pallet |
| `package-class-third-pallet` | ⅓ Pall | Third pallet |
| `package-class-quarter-pallet` | ¼ Pall | Quarter pallet |
| `package-class-sleeve` | Stock | Sleeve / stock unit |
| `package-class-tray` | Lav | Tray / display tray |

### Create a package class

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/product-package-classes" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "product package class",
    "identifiers": { "com.example.id": "carton" },
    "name": "Carton"
  }'
```

### More package class examples

```bash
# Shrink-wrap (custom class not in the predefined set)
curl -X POST -u ":banana" "example.app.heads.com/api/v1/product-package-classes" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "product package class",
    "identifiers": { "com.example.id": "shrink-wrap" },
    "name": "Shrink-wrap"
  }'

# Display box
curl -X POST -u ":banana" "example.app.heads.com/api/v1/product-package-classes" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "product package class",
    "identifiers": { "com.example.id": "display-box" },
    "name": "Display Box"
  }'
```

### List all package classes

```bash
curl -X GET -u ":banana" "example.app.heads.com/api/v1/product-package-classes"
```

### Get a specific package class

```bash
curl -X GET -u ":banana" "example.app.heads.com/api/v1/product-package-classes/com.example.id=carton"
```

> **Note:** Package classes are immutable after creation. To use a different name, create a new package class.

---

## Section 2: Product Packages — Creating and Managing

A product package requires two things: (1) a package class, and (2) a manifest listing the products and quantities inside.

### Create a simple package — Carton of 10

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/product-packages" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "product package",
    "identifiers": { "com.example.id": "levis-501-carton" },
    "packageClass": { "identifiers": { "com.example.id": "carton" } },
    "manifest": [
      {
        "product": { "identifiers": { "com.example.id": "levis-501-family" } },
        "quantity": "10"
      }
    ]
  }'
```

This is a **simple package** — one manifest entry. The manifest references a product family, meaning any variant (size, color) of Levis 501 can be packed in this carton.

### Create a 6-pack of soda

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/product-packages" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "product package",
    "identifiers": { "com.example.id": "6pack-cola" },
    "name": "6-Pack Cola",
    "packageClass": { "identifiers": { "com.example.id": "shrink-wrap" } },
    "manifest": [
      {
        "product": { "identifiers": { "sku": "COLA-33CL" } },
        "quantity": "6"
      }
    ]
  }'
```

Here an explicit `name` is set. Without it, the name may inherit from the package class (e.g., "Shrink-wrap"), which is often not descriptive enough.

### Create a complex package — Mixed Snack Pallet

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/product-packages" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "product package",
    "identifiers": { "com.example.id": "mixed-snack-pallet" },
    "name": "Mixed Snack Pallet",
    "packageClass": { "identifiers": { "com.example.id": "pallet" } },
    "manifest": [
      {
        "product": { "identifiers": { "com.example.categoryId": "chips" } },
        "quantity": "24"
      },
      {
        "product": { "identifiers": { "com.example.categoryId": "nuts" } },
        "quantity": "24"
      }
    ]
  }'
```

This is a **complex package** — multiple manifest entries. Automatic unit-to-package quantity conversion is not supported for complex packages.

### List all product packages

```bash
curl -X GET -u ":banana" "example.app.heads.com/api/v1/product-packages"
```

### Get a specific package with full manifest

```bash
curl -X GET -u ":banana" "example.app.heads.com/api/v1/product-packages/com.example.id=levis-501-carton?fields=all"
```

### Update a package manifest

```bash
curl -X PATCH -u ":banana" "example.app.heads.com/api/v1/product-packages/com.example.id=6pack-cola" \
  -H "Content-Type: application/json" \
  -d '{
    "manifest": [
      {
        "product": { "identifiers": { "sku": "COLA-33CL" } },
        "quantity": "8"
      }
    ]
  }'
```

This changes the 6-pack into an 8-pack by replacing the manifest entirely.

---

## Section 3: Product Compositions — The Shared Base (Packages vs Sets)

Both `product package` and `product set` extend `product composition` and share the `manifest` field. They serve fundamentally different purposes:

| Aspect | Product Package | Product Set |
|--------|----------------|-------------|
| Type | `"product package"` | `"product set"` |
| Additional field | `packageClass` (required) | None |
| Purpose | Supply chain packaging units | Bundled products for sale |
| Examples | "Carton of 10", "6-pack", "Pallet of 48" | "Dinner Set (table + 4 chairs)", "Combo Meal" |
| Typical use | Referenced in supply relations and trade order items | Used in bundle discount rules |

### Create a product set (for comparison)

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/product-sets" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "product set",
    "identifiers": { "com.example.id": "lunch-combo" },
    "name": "Lunch Combo",
    "manifest": [
      {
        "product": { "identifiers": { "com.example.id": "burger" } },
        "quantity": "1"
      },
      {
        "product": { "identifiers": { "com.example.id": "fries" } },
        "quantity": "1"
      },
      {
        "product": { "identifiers": { "com.example.id": "soda" } },
        "quantity": "1"
      }
    ]
  }'
```

Note the absence of `packageClass` — product sets don't have one because they represent logical bundles, not physical packaging.

### When to use which

- **Product package**: You're modeling how items are physically shipped/stored. A carton, a pallet, a shrink-wrapped 6-pack.
- **Product set**: You're modeling a group of items sold together as a conceptual unit. A combo meal, a furniture set, a gift box.

Both use the same manifest structure. The key difference is that packages participate in the supply chain (supply relations, trade order items), while sets participate in commercial rules (bundle discounts).

---

## Section 4: Supply Relations — Linking Packages to Trade Terms

Supply relations specify the terms under which a product is traded between parties. The `package` field specifies which physical packaging unit is used.

### Create a supply relation with carton packaging

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/supply-relations" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "supply relation",
    "relationship": { "identifiers": { "com.example.id": "supplier-acme" } },
    "product": { "identifiers": { "com.example.id": "levis-501-family" } },
    "moq": "100",
    "package": { "identifiers": { "com.example.id": "levis-501-carton" } }
  }'
```

This means: "Levis 501 products are traded with ACME supplier in cartons of 10, minimum order 100 units."

**Field breakdown:**

| Field | Meaning |
|-------|---------|
| `relationship` | The trade relationship (supplier agreement) this applies to. |
| `product` | The product or product family these terms apply to. Can be a family (applies to all variants). |
| `moq` | Minimum order quantity **in base units** (individual items), not packages. 100 units = 10 cartons. |
| `package` | The physical packaging unit used when trading this product. |

### Create a pallet-level supply relation

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/supply-relations" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "supply relation",
    "relationship": { "identifiers": { "com.example.id": "supplier-nordic-beverages" } },
    "product": { "identifiers": { "com.example.id": "sparkling-water-family" } },
    "moq": "576",
    "package": { "identifiers": { "com.example.id": "sparkling-water-pallet" } }
  }'
```

This means: "Sparkling water is supplied by Nordic Beverages on full pallets, minimum order 576 units (e.g., 24 cases × 24 bottles)."

### List all supply relations

```bash
curl -X GET -u ":banana" "example.app.heads.com/api/v1/supply-relations"
```

### Query supply relations with specific fields

```bash
curl -X GET -u ":banana" "example.app.heads.com/api/v1/supply-relations?fields=product,package,moq"
```

---

## Section 5: Packages on Trade Order Items

When items are ordered, the trade order item can reference the package to track how items are physically packaged and shipped.

### Trade order item with package reference

```json
{
  "@type": "trade order item",
  "product": { "identifiers": { "sku": "LEVIS-501-32-32" } },
  "quantity": "30",
  "package": { "identifiers": { "com.example.id": "levis-501-carton" } }
}
```

This means 30 units ordered as 3 cartons of 10.

### Creating an order with packaged items

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/trade-orders" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.orderId": "PO-2026-001" },
    "supplier": { "identifiers": { "com.example.id": "supplier-acme" } },
    "customer": { "identifiers": { "com.example.id": "ourcompany" } },
    "sellers": [{ "identifiers": { "com.example.id": "supplier-acme" } }],
    "currency": { "identifiers": { "currencyCode": "SEK" } },
    "items": [
      {
        "product": { "identifiers": { "sku": "LEVIS-501-32-32" } },
        "quantity": "30",
        "package": { "identifiers": { "com.example.id": "levis-501-carton" } }
      },
      {
        "product": { "identifiers": { "sku": "LEVIS-501-34-34" } },
        "quantity": "20",
        "package": { "identifiers": { "com.example.id": "levis-501-carton" } }
      }
    ]
  }'
```

> **Note:** Trade orders are created via `POST /api/v1/trade-orders`. The `relationship` field is **read-only** — it is derived automatically from the supplier/customer pairing. You must specify `supplier`, `customer`, `sellers` (stock source), and `currency` explicitly.

**Key points:**

- The `package` field is **optional** — items can be ordered without specifying packaging.
- Quantity is always in **base units** (individual items), not in packages.
- The package reference allows the system to validate that the quantity is compatible with the package size.
- Multiple items in the same order can reference the same package class but will each have their own package reference.

---

## Section 6: Package Discount Rule Effects

> **Important naming distinction:** The `package discount rule effect` is a **discount rule concept**, not a packaging concept. The word "package" here means "package deal" (bundle price), not physical packaging. This effect type is completely unrelated to `product package`.

The `package discount rule effect` sets a **total price for a group of matched items**. It's used for bundle deals like "2 for 55 SEK" or coupon-redeemed meal deals.

### Bundle deal — 2 Barebells for 55 SEK

This is a real production rule. When a customer buys any 2 qualifying Barebells protein bars, they pay 55 SEK total instead of individual prices.

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/discount-rules" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "discount rule",
    "identifiers": { "com.example.id": "barebells-2for55" },
    "name": "Barebells 2 för 55:-",
    "includesTax": true,
    "seller": {
      "include": [{ "identifiers": { "com.example.id": "ourcompany" } }]
    },
    "currency": {
      "include": [{ "identifiers": { "currencyCode": "SEK" } }]
    },
    "phase": {
      "identifiers": { "com.example.id": "deals" },
      "name": "Deals",
      "priority": "100"
    },
    "time": {
      "start": "2024-01-01T00:00:00",
      "end": "2030-12-31T23:59:59"
    },
    "items": {
      "barebells": {
        "@type": "product condition",
        "include": [
          { "identifiers": { "ean": "7340001803303" } },
          { "identifiers": { "ean": "7340001804812" } },
          { "identifiers": { "ean": "7340001802016" } }
        ],
        "exclude": [],
        "atLeast": 2,
        "atMost": 2
      }
    },
    "effects": [
      {
        "@type": "package discount rule effect",
        "items": ["barebells"],
        "amount": "55"
      }
    ],
    "reason": {
      "identifiers": { "com.example.id": "barebells-deal-reason" },
      "name": "Barebells 2 för 55:-"
    }
  }'
```

**How it works:**
- `items.barebells` defines qualifying products with `atLeast: 2` and `atMost: 2` — exactly 2 items must match.
- The `package discount rule effect` with `amount: "55"` sets the **total price for all matched items combined** to 55 SEK.
- `includesTax: true` means the 55 SEK is the consumer-facing price including VAT.

### Coupon-redeemed deal — Loyalty Glass (amount "0")

This pattern is used in production for coupon-based promotions. A coupon product (scanned at checkout) triggers a deal where the entire bundle costs 0 SEK — effectively making the glass ice cream free when redeemed with the coupon.

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/discount-rules" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "discount rule",
    "identifiers": { "com.example.id": "loyalty-glass" },
    "name": "Loyalty Glass Deal",
    "includesTax": true,
    "currency": {
      "include": [{ "identifiers": { "currencyCode": "SEK" } }]
    },
    "phase": {
      "identifiers": { "com.example.id": "promotions" },
      "name": "Promotions",
      "priority": "100"
    },
    "time": {
      "start": "2024-01-01T00:00:00",
      "end": "2030-12-31T23:59:59"
    },
    "items": {
      "glass": {
        "@type": "product condition",
        "include": [
          { "identifiers": { "ean": "7310090452010" } },
          { "identifiers": { "ean": "7310090452027" } },
          { "identifiers": { "ean": "7310090452034" } }
        ],
        "exclude": [],
        "atLeast": 1,
        "atMost": 1
      },
      "coupon": {
        "@type": "product condition",
        "include": [
          { "identifiers": { "ean": "1920" } }
        ],
        "exclude": [],
        "atLeast": 1,
        "atMost": 1
      }
    },
    "effects": [
      {
        "@type": "package discount rule effect",
        "items": ["glass", "coupon"],
        "amount": "0"
      }
    ],
    "reason": {
      "identifiers": { "com.example.id": "loyalty-glass-reason" },
      "name": "Loyalty Glass Deal"
    }
  }'
```

**How it works:**
- Two item groups: `glass` (the product) and `coupon` (the redemption coupon with EAN `1920`).
- The `package discount rule effect` targets **both groups** with `amount: "0"` — the combined price for glass + coupon = 0 SEK.
- The coupon is consumed as part of the deal. The customer gets the glass for free.

### Comparison with other discount effect types

| Effect type | What `amount` means | Example |
|-------------|---------------------|---------|
| `percentage discount rule effect` | Percentage off | "20% off accessories" |
| `fixed reduction discount rule effect` | Fixed amount off per item | "50 SEK off" |
| `fixed price discount rule effect` | Fixed price per item | "Each item for 199 SEK" |
| `package discount rule effect` | **Total bundle price** | "2 items for 55 SEK" |

The `package discount rule effect` is the only effect type where `amount` represents a **total** for the group, not a per-item value.

---

## Section 7: Querying Packages and Related Resources

### Package classes

```bash
# List all package classes
curl -X GET -u ":banana" "example.app.heads.com/api/v1/product-package-classes"

# Get a specific class
curl -X GET -u ":banana" "example.app.heads.com/api/v1/product-package-classes/com.example.id=carton"
```

### Product packages

```bash
# List all packages
curl -X GET -u ":banana" "example.app.heads.com/api/v1/product-packages"

# Get a specific package with full manifest
curl -X GET -u ":banana" "example.app.heads.com/api/v1/product-packages/com.example.id=levis-501-carton?fields=all"

# Get only package names and classes
curl -X GET -u ":banana" "example.app.heads.com/api/v1/product-packages?fields=name,packageClass"
```

### Product sets

```bash
# List all product sets
curl -X GET -u ":banana" "example.app.heads.com/api/v1/product-sets"

# Get a specific set with manifest
curl -X GET -u ":banana" "example.app.heads.com/api/v1/product-sets/com.example.id=lunch-combo?fields=all"
```

### Supply relations

```bash
# List all supply relations
curl -X GET -u ":banana" "example.app.heads.com/api/v1/supply-relations"

# Filter supply relations by specific fields
curl -X GET -u ":banana" "example.app.heads.com/api/v1/supply-relations?fields=product,package,moq"
```

---

## Section 8: End-to-End Workflow — Setting Up Package-Based Supply

This walkthrough sets up supply for a new juice product that comes in cases of 12, shipped on quarter-pallets of 48 cases (576 units).

### Step 1: Create a custom package class (if needed)

The predefined classes may not cover your needs. Here we create a "Case" class:

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/product-package-classes" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "product package class",
    "identifiers": { "com.example.id": "case" },
    "name": "Case"
  }'
```

### Step 2: Create the product package

Define how the juice is packaged — cases of 12:

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/product-packages" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "product package",
    "identifiers": { "com.example.id": "tropical-juice-case" },
    "name": "Tropical Juice Case x12",
    "packageClass": { "identifiers": { "com.example.id": "case" } },
    "manifest": [
      {
        "product": { "identifiers": { "com.example.id": "tropical-juice-family" } },
        "quantity": "12"
      }
    ]
  }'
```

### Step 3: Create a supply relation

Link the package to the supplier agreement:

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/supply-relations" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "supply relation",
    "relationship": { "identifiers": { "com.example.id": "supplier-tropicana" } },
    "product": { "identifiers": { "com.example.id": "tropical-juice-family" } },
    "moq": "576",
    "package": { "identifiers": { "com.example.id": "tropical-juice-case" } }
  }'
```

This means: minimum order 576 units (= 48 cases of 12), traded in case packaging.

### Step 4: Place a supplier order

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/trade-orders" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.orderId": "PO-2026-JUICE-001" },
    "supplier": { "identifiers": { "com.example.id": "supplier-tropicana" } },
    "customer": { "identifiers": { "com.example.id": "ourcompany" } },
    "sellers": [{ "identifiers": { "com.example.id": "supplier-tropicana" } }],
    "currency": { "identifiers": { "currencyCode": "SEK" } },
    "items": [
      {
        "product": { "identifiers": { "sku": "TROP-MANGO-1L" } },
        "quantity": "288",
        "package": { "identifiers": { "com.example.id": "tropical-juice-case" } }
      },
      {
        "product": { "identifiers": { "sku": "TROP-PASSION-1L" } },
        "quantity": "288",
        "package": { "identifiers": { "com.example.id": "tropical-juice-case" } }
      }
    ]
  }'
```

This orders 576 total units: 288 mango (24 cases) + 288 passion fruit (24 cases), fitting on one quarter-pallet.

### Step 5: Verify the order

```bash
curl -X GET -u ":banana" "example.app.heads.com/api/v1/trade-orders/com.example.orderId=PO-2026-JUICE-001?fields=all"
```

---

## Section 9: Best Practices and Pitfalls

- **Package class is required on create.** You cannot create a `product package` without a `packageClass`. Create or reference an existing class first. Omitting it will fail validation.

- **Manifest products can be families, not just SKUs.** A "Carton of 10 Levis 501" can reference the product family, meaning any variant (size/color) can be packed in it. Use product families for flexible packaging that accommodates multiple SKUs.

- **Quantities are always in base units.** When specifying `moq` in supply relations or `quantity` in trade order items, always use base units (individual items), not package counts. 100 units in a carton of 10 = 10 cartons. The system handles the conversion for simple packages.

- **Package names are often inherited from class.** If you don't set `name` on a product package, it may inherit from the package class (e.g., "Krt"). Set an explicit name for clarity — "Levis 501 Carton x10" is far more useful than "Krt" when browsing a list of packages.

- **Don't confuse `package discount rule effect` with product packages.** The former is about pricing bundles ("2 for 55 SEK"), the latter is about physical packaging ("carton of 10"). They are completely unrelated concepts that unfortunately share the word "package".

- **Package classes are intentionally simple.** They have no dimensions, weight, or volume fields. This is by design — the system does not currently model physical packaging attributes. If integrators need to track those, they should use custom identifiers (e.g., `com.myapp.widthCm`) and manage the mapping in an external system.

- **Simple vs complex packages.** A simple package (one manifest entry) has a clear unit-to-package ratio. The system uses this internally for validation. Packages with multiple manifest entries (mixed pallets) are "complex" and don't support automatic quantity conversion.

- **One package, many orders.** A product package is a reusable definition. Define "Tropical Juice Case x12" once and reference it from multiple supply relations and trade orders. Don't create duplicate packages for each order.
