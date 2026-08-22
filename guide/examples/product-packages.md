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
└── product composition (abstract — no members of its own)
    ├── product package — one product, one size, and a package class
    └── product set — a multi-entry manifest, for bundles like "Combo Meal"
```

A product package holds **exactly one `(product, size)` pair**: ten Levis 501 to a carton, six cans of cola to a shrink-wrap. That pair is what makes unit-to-package conversion work — order 30 units of a package of 10 and the system knows that is three cartons.

| Property | Purpose |
|----------|---------|
| `packageClass` | References a `product package class` — the classification (Carton, Pallet, etc.). **Required on create.** |
| `product` | The product, family or group the package contains. **Required on create.** |
| `size` | How many units of `product` fit in one package. **Required on create.** |
| `name` | Display name. Takes the package class's name unless set on its own — see [Naming a package](#naming-a-package-takes-a-second-request). |
| `active` | Whether the package is available for use in new transactions. |
| `identifiers` | External identifiers for lookup. |
| `manifest` | **Deprecated** — a one-entry facade over `product` and `size`. See [The deprecated `manifest`](#the-deprecated-manifest). |

> **The member is `size`, and it is not `quantity`.** `quantity` is what the entries of the deprecated `manifest` call it, and it is not a member of the package itself — so a payload putting `quantity` next to `product` has its value dropped like any unknown member, and the create then fails for having no size. You get a `400` naming the size rather than the member you actually mistyped, which is the one thing to recognise about that message.

> **There is no such thing as a mixed package.** A package cannot hold two different products: "a pallet of 24 chips + 24 nuts" is not expressible. It used to be, as a multi-entry manifest, and a manifest carrying more than one entry is now rejected with a `400`. For a group of different products, use a [product set](#section-3-packages-vs-sets) instead.

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
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/product-package-classes" \
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
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/product-package-classes" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "product package class",
    "identifiers": { "com.example.id": "shrink-wrap" },
    "name": "Shrink-wrap"
  }'

# Display box
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/product-package-classes" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "product package class",
    "identifiers": { "com.example.id": "display-box" },
    "name": "Display Box"
  }'
```

### List all package classes

```bash
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/product-package-classes"
```

### Get a specific package class

```bash
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/product-package-classes/com.example.id=carton"
```

> **Note:** Package classes are immutable after creation. To use a different name, create a new package class.

---

## Section 2: Product Packages — Creating and Managing

A product package needs three things: the package class it belongs to, the product it contains, and how many of that product fit inside one.

### Create a package — Carton of 10

```bash
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/product-packages" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "product package",
    "identifiers": { "com.example.id": "levis-501-carton" },
    "name": "Levis 501 Carton x10",
    "packageClass": { "identifiers": { "com.example.id": "carton" } },
    "product": { "identifiers": { "com.example.id": "levis-501-family" } },
    "size": "10"
  }'
```

`product` here names a product *family*, so any variant (size, colour) of Levis 501 can be packed in this carton. It can equally name a single SKU or a whole product group — whichever level the packing rule actually applies at.

### Create a 6-pack of soda

```bash
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/product-packages" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "product package",
    "identifiers": { "com.example.id": "6pack-cola" },
    "name": "6-Pack Cola",
    "packageClass": { "identifiers": { "com.example.id": "shrink-wrap" } },
    "product": { "identifiers": { "com.example.sku": "COLA-33CL" } },
    "size": "6"
  }'
```

The `name` in that payload does **not** stick, and neither does the one in the carton above — see below.

### Naming a package takes a second request

A package's `name` cannot be set in the same payload as its `packageClass`: the class is applied after the name and renames the package to the class's own name. Since `packageClass` is required on create, that means **a `name` sent on create is always lost** — the create succeeds, nothing in the response says the name was dropped, and the catalogue lists as "Carton" and "Shrink-wrap" rather than by what is in the box.

```bash
# The name in the create above did not stick — set it in a PATCH that names nothing else
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/product-packages/com.example.id=6pack-cola" \
  -H "Content-Type: application/json" \
  -d '{ "name": "6-Pack Cola" }'
```

A `PATCH` carrying `name` **and** `packageClass` loses the name the same way, so keep the two apart. It is worth doing: "Levis 501 Carton x10" is far more useful than "Carton" when browsing a list of packages, and every package of that class otherwise reads the same.

### What a create refuses

Three members are required on create — `packageClass`, `product` and `size` — and all three are enforced. Each has its own `400`, and the request is refused outright:

```
# packageClass missing
Missing or invalid member 'packageClass' of the input object. Expected object of type product package class

# neither product nor a legacy manifest
A package must have a product (or a legacy manifest with exactly one entry).

# a product, but no size and no legacy manifest quantity to stand in for one
A package must have a size (or a legacy manifest entry with a quantity).
```

The first names the member and is the platform's ordinary coercion message; the other two name what the package needs. They are the same three members the schema marks required on create, so a client generated from the spec asks for exactly what the server insists on.

**Watch `size` in particular, because the near misses are refused rather than quietly accepted.** `quantity` is what the [deprecated manifest](#the-deprecated-manifest) entries call it and is *not* a member of the package — send `"quantity": "6"` beside `product` and it is dropped like any unknown member, leaving the create with no size and answering the third `400` above. An explicit `"size": null` is refused the same way. `"size": "0"` is **not**: the check is on the member being given, not on the value being non-zero, so a package of zero is a legitimate thing to create.

The requirement is on create only. A later `PATCH` that names `product` and not `size` leaves the stored size where it was. Read the pair back after creating a package:

```bash
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/product-packages/com.example.id=6pack-cola~just(product,size)"
```

### There is no mixed package

A package holds one product. A "pallet of 24 chips + 24 nuts" cannot be expressed as a package, and reaching for the deprecated multi-entry manifest to do it is refused:

```bash
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/product-packages" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "product package",
    "identifiers": { "com.example.id": "mixed-snack-pallet" },
    "packageClass": { "identifiers": { "com.example.id": "pallet" } },
    "manifest": [
      { "product": { "identifiers": { "com.example.categoryId": "chips" } }, "quantity": "24" },
      { "product": { "identifiers": { "com.example.categoryId": "nuts" } }, "quantity": "24" }
    ]
  }'
```

```
400  A product package can have at most one manifest entry.
     The manifest is deprecated - use `product` and `size` instead.
```

The request is refused outright — nothing is written under that identifier. Two ways to model it instead:

- **One package per product.** A chips pallet ×24 and a nuts pallet ×24, each referenced where it applies. This is what you want when the two products are ordered and shipped as separate lines that happen to travel together.
- **A [product set](#section-3-packages-vs-sets).** A set carries a genuine multi-entry manifest and is the type for "these things go together". It is not a packaging unit, so it does not appear on supply relations.

### List all product packages

```bash
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/product-packages"
```

### Get a specific package

```bash
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/product-packages/com.example.id=levis-501-carton?fields=all"
```

### Change a package's size

```bash
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/product-packages/com.example.id=6pack-cola" \
  -H "Content-Type: application/json" \
  -d '{ "size": "8" }'
```

This turns the 6-pack into an 8-pack. Note what it does *not* touch: the `name`. A package called "6-Pack Cola" keeps saying six, so send `name` alongside `size` whenever the name carries the count — that pairing is fine, and it is only `packageClass` that a `name` cannot share a payload with.

### Retire a package

```bash
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/product-packages/com.example.id=6pack-cola" \
  -H "Content-Type: application/json" \
  -d '{ "active": false }'
```

`active` marks whether a package is available for use in new transactions. Clearing it retires the package without deleting it, leaving existing references intact.

### The deprecated `manifest`

`manifest` predates `product` and `size` and is kept so integrations written against the older, multi-entry model keep working. It is a **one-entry facade** over that pair rather than storage of its own:

- **Reading** it gives one entry whose `product` and `quantity` mirror the package's `product` and `size`. `manifest~count` is `1`, or `0` when the package has no product.
- **Writing one entry** writes whichever of `product` and `size` the entry names — on create, as a member of a `PATCH` on the package, or against `.../manifest` directly, including the `add`, `replace` and `remove` envelopes. On an existing package an entry carrying only `product` leaves the size alone; on a create it is the missing-size `400` above, since there is no stored size to keep.
- **Writing more than one entry** is the `400` above, wherever you send it.
- **Writing an empty array** (`PUT .../manifest` with `[]`) clears `product`, exactly as `DELETE .../product` does. `size` is left where it was.
- **The leaf paths write through too:** `PATCH .../manifest/0/quantity` sets `size`, and `PATCH .../manifest/0/product` sets `product`.

These two requests are the same write:

```bash
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/product-packages/com.example.id=6pack-cola" \
  -H "Content-Type: application/json" \
  -d '{ "manifest": [{ "product": { "identifiers": { "com.example.sku": "COLA-33CL" } }, "quantity": "8" }] }'

curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/product-packages/com.example.id=6pack-cola" \
  -H "Content-Type: application/json" \
  -d '{ "product": { "identifiers": { "com.example.sku": "COLA-33CL" } }, "size": "8" }'
```

Prefer the second. Everything the manifest can express, `product` and `size` express directly — and only the manifest can be written in a shape the API refuses. It is worth knowing that a deprecated member is not always still functional — this one is, and [`POS profile.functions`](../../reference/common-gotchas.md#46-deprecated-does-not-tell-you-whether-a-member-still-works) is not.

> **The numeric index is not honoured.** Every index resolves to the same single entry, so `manifest/1` reads back what `manifest/0` does even though the collection holds one element, and `{"remove": [...]}` clears that entry whatever product it names. Address `product` and `size` and the question does not arise.

---

## Section 3: Packages vs Sets

`product package` and `product set` both extend `product composition`, but that base carries no members of its own — each subtype declares its own shape, and the two shapes are no longer alike:

| Aspect | Product Package | Product Set |
|--------|----------------|-------------|
| Type | `"product package"` | `"product set"` |
| Contents | one `product` and a `size` | a `manifest` of any number of entries, each with its own `product` and `quantity` |
| Additional field | `packageClass` (required) | none |
| Purpose | Supply chain packaging units | Bundled products for sale |
| Examples | "Carton of 10", "6-pack", "Pallet of 48" | "Dinner Set (table + 4 chairs)", "Combo Meal" |
| Typical use | Referenced in supply relations and trade order items | Used in bundle discount rules |

**The multi-entry manifest lives on the set**, and only there. A package's `manifest` is a [deprecated one-entry facade](#the-deprecated-manifest) over `product` and `size`; a set's is the real thing, and nothing about it is deprecated. So "1 table + 4 chairs" is a product set, not a package.

### Create a product set

```bash
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/product-sets" \
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

- **Product package**: You're modeling how one product is physically shipped or stored. A carton, a pallet, a shrink-wrapped 6-pack.
- **Product set**: You're modeling several items that go together as a conceptual unit. A combo meal, a furniture set, a gift box — or a mixed pallet, which a package cannot express.

Packages participate in the supply chain (supply relations, trade order items); sets participate in commercial rules (bundle discounts).

---

## Section 4: Supply Relations — Linking Packages to Trade Terms

Supply relations specify the terms under which a product is traded between parties. The `package` field specifies which physical packaging unit is used.

### Create a supply relation with carton packaging

```bash
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/supply-relations" \
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
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/supply-relations" \
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
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/supply-relations"
```

### Query supply relations with specific fields

```bash
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/supply-relations?fields=product,package,moq"
```

---

## Section 5: Packages on Trade Order Items

When items are ordered, the trade order item can reference the package to track how items are physically packaged and shipped.

### Trade order item with package reference

```json
{
  "@type": "trade order item",
  "product": { "identifiers": { "com.example.sku": "LEVIS-501-32-32" } },
  "quantity": "30",
  "package": { "identifiers": { "com.example.id": "levis-501-carton" } }
}
```

This means 30 units ordered as 3 cartons of 10.

### Creating an order with packaged items

```bash
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/trade-orders" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.orderId": "PO-2026-001" },
    "supplier": { "identifiers": { "com.example.id": "supplier-acme" } },
    "customer": { "identifiers": { "com.example.id": "ourcompany" } },
    "sellers": [{ "identifiers": { "com.example.id": "supplier-acme" } }],
    "currency": { "identifiers": { "currencyCode": "SEK" } },
    "items": [
      {
        "product": { "identifiers": { "com.example.sku": "LEVIS-501-32-32" } },
        "quantity": "30",
        "package": { "identifiers": { "com.example.id": "levis-501-carton" } }
      },
      {
        "product": { "identifiers": { "com.example.sku": "LEVIS-501-34-34" } },
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
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/discount-rules" \
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
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/discount-rules" \
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
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/product-package-classes"

# Get a specific class
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/product-package-classes/com.example.id=carton"
```

### Product packages

```bash
# List all packages
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/product-packages"

# Get a specific package with every field
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/product-packages/com.example.id=levis-501-carton?fields=all"

# Get only package names and classes
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/product-packages?fields=name,packageClass"
```

### Product sets

```bash
# List all product sets
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/product-sets"

# Get a specific set with manifest
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/product-sets/com.example.id=lunch-combo?fields=all"
```

### Supply relations

```bash
# List all supply relations
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/supply-relations"

# Filter supply relations by specific fields
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/supply-relations?fields=product,package,moq"
```

---

## Section 8: End-to-End Workflow — Setting Up Package-Based Supply

This walkthrough sets up supply for a new juice product that comes in cases of 12, shipped on quarter-pallets of 48 cases (576 units).

### Step 1: Create a custom package class (if needed)

The predefined classes may not cover your needs. Here we create a "Case" class:

```bash
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/product-package-classes" \
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
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/product-packages" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "product package",
    "identifiers": { "com.example.id": "tropical-juice-case" },
    "name": "Tropical Juice Case x12",
    "packageClass": { "identifiers": { "com.example.id": "case" } },
    "product": { "identifiers": { "com.example.id": "tropical-juice-family" } },
    "size": "12"
  }'
```

The `name` here is lost the same way it is on every create — set it with a follow-up `PATCH` naming only `name`, per [Naming a package](#naming-a-package-takes-a-second-request), or the package lists as "Case".

### Step 3: Create a supply relation

Link the package to the supplier agreement:

```bash
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/supply-relations" \
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
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/trade-orders" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.orderId": "PO-2026-JUICE-001" },
    "supplier": { "identifiers": { "com.example.id": "supplier-tropicana" } },
    "customer": { "identifiers": { "com.example.id": "ourcompany" } },
    "sellers": [{ "identifiers": { "com.example.id": "supplier-tropicana" } }],
    "currency": { "identifiers": { "currencyCode": "SEK" } },
    "items": [
      {
        "product": { "identifiers": { "com.example.sku": "TROP-MANGO-1L" } },
        "quantity": "288",
        "package": { "identifiers": { "com.example.id": "tropical-juice-case" } }
      },
      {
        "product": { "identifiers": { "com.example.sku": "TROP-PASSION-1L" } },
        "quantity": "288",
        "package": { "identifiers": { "com.example.id": "tropical-juice-case" } }
      }
    ]
  }'
```

This orders 576 total units: 288 mango (24 cases) + 288 passion fruit (24 cases), fitting on one quarter-pallet.

### Step 5: Verify the order

```bash
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/trade-orders/com.example.orderId=PO-2026-JUICE-001?fields=all"
```

---

## Section 9: Best Practices and Pitfalls

- **Package class is required on create.** You cannot create a `product package` without a `packageClass`. Create or reference an existing class first. Omitting it will fail validation.

- **A package's `product` can be a family, not just a SKU.** A "Carton of 10 Levis 501" can reference the product family, meaning any variant (size/colour) can be packed in it. Use product families for flexible packaging that accommodates multiple SKUs.

- **The size member is called `size`, not `quantity`.** All three of `packageClass`, `product` and `size` are enforced on create, so a payload that omits the size — or that spells it `quantity`, the deprecated manifest's name for it — is refused with `A package must have a size (or a legacy manifest entry with a quantity).` The message names the size rather than the member you mistyped, so read it as "nothing in this payload gave me one".

- **Quantities are always in base units.** When specifying `moq` in supply relations or `quantity` in trade order items, always use base units (individual items), not package counts. 100 units in a carton of 10 = 10 cartons. The system converts by dividing by the package's `size`.

- **A package's name has to be set on its own.** `name` sent alongside `packageClass` — which every create carries, since the class is required — is overwritten by the class's name, on an otherwise successful write and with nothing to say so. Set it in a follow-up `PATCH` that names only `name`, or the whole catalogue reads "Carton".

- **Don't confuse `package discount rule effect` with product packages.** The former is about pricing bundles ("2 for 55 SEK"), the latter is about physical packaging ("carton of 10"). They are completely unrelated concepts that unfortunately share the word "package".

- **Package classes are intentionally simple.** They have no dimensions, weight, or volume fields. This is by design — the system does not currently model physical packaging attributes. If integrators need to track those, they should use custom identifiers (e.g., `com.myapp.widthCm`) and manage the mapping in an external system.

- **A package holds one product.** There is no mixed package and no multi-entry manifest — `product` and `size` are single-valued, and the unit-to-package conversion is exactly `size`. For a group of different products, reach for a [product set](#section-3-packages-vs-sets).

- **One package, many orders.** A product package is a reusable definition. Define "Tropical Juice Case x12" once and reference it from multiple supply relations and trade orders. Don't create duplicate packages for each order.
