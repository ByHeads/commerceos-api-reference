# Units of Measure Examples

Curl examples for setting and using the `unit` property on products, product groups, and product families. The unit determines how quantities are measured — `"Piece"` for discrete items, `"Kilogram"` for weight-based goods, `"Liter"` for liquids, `"Meter"` for length, etc. This affects order quantities, receipt display, and inventory tracking.

**Base URL:** `https://example.app.heads.com/api/v1`
**API Key:** `banana` (passed via Basic Auth with empty username: `-u ":banana"`)

> **See also:** [Examples Index](../examples.md) | [Products & Catalog](./products.md) | [Orders & Fulfillment](./orders.md) | [Point of Sale](./pos.md) | [Reference Documentation](../../reference/)

---

## Section 1: Setting the Unit on a Product

The `unit` property is a string field on `product group node` — the shared parent of product groups, product families, and individual products. Set it when creating or updating any of these.

### Create a weight-based product

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/products" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "product",
    "identifiers": { "sku": "DELI-SALAMI-001" },
    "name": "Artisan Salami",
    "unit": "Kilogram",
    "parentGroup": { "identifiers": { "com.example.id": "deli-meats" } },
    "defaultVatCode": { "identifiers": { "percentage": "12" } }
  }'
```

### Update the unit on an existing product

```bash
curl -X PATCH -u ":banana" "example.app.heads.com/api/v1/products/sku=DELI-SALAMI-001" \
  -H "Content-Type: application/json" \
  -d '{ "unit": "Kilogram" }'
```

### Create a discrete item (default)

Most products are sold by the piece. `"Piece"` is the standard unit:

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/products" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "product",
    "identifiers": { "sku": "PHONE-X200" },
    "name": "Phone X200",
    "unit": "Piece",
    "parentGroup": { "identifiers": { "com.example.id": "smartphones" } },
    "defaultVatCode": { "identifiers": { "percentage": "25" } }
  }'
```

> **Tip:** If the product group already has `"unit": "Piece"` (see [Section 4](#section-4-inheritance--setting-unit-at-the-group-level)), individual products inherit it automatically. You only need to set `unit` on the product if it differs from its group.

---

## Section 2: Complete Unit Reference

All valid `unit` values, organized by system. Values are **case-sensitive PascalCase** strings.

### Occurrence (discrete count)

| Value | Symbol (en) | Use case |
|-------|-------------|----------|
| `Piece` | pc | Discrete items — phones, shirts, screws, packaged food |

### Mass

| Value | Symbol | Use case |
|-------|--------|----------|
| `Milligram` | mg | Spices, precious metals |
| `Gram` | g | Small food items, jewelry |
| `Kilogram` | kg | Deli meats, bulk produce, construction materials |
| `MetricTon` | t | Industrial goods, bulk commodities |
| `Ounce` | oz | US/UK weight-based products |
| `Pound` | lb | US/UK weight-based products |
| `Stone` | st | UK body weight (rare in retail) |

### Length

| Value | Symbol | Use case |
|-------|--------|----------|
| `Millimeter` | mm | Hardware, precision parts |
| `Centimeter` | cm | Fabric (sometimes) |
| `Decimeter` | dm | Rarely used in retail |
| `Meter` | m | Fabric, cable, rope, timber |
| `Kilometer` | km | Rarely used in retail |
| `Inch` | in | US/UK hardware |
| `Foot` | ft | US/UK timber, construction |
| `Yard` | yd | US/UK fabric |
| `Mile` | mi | Not typical for retail |

### Area

| Value | Symbol | Use case |
|-------|--------|----------|
| `SquareMillimeter` | mm² | Rarely used |
| `SquareCentimeter` | cm² | Rarely used |
| `SquareMeter` | m² | Flooring, tiles, wallpaper |
| `SquareKilometer` | km² | Not typical for retail |
| `Hectare` | ha | Agricultural land |
| `Acre` | ac | US/UK agricultural land |

### Volume

| Value | Symbol | Use case |
|-------|--------|----------|
| `CubicCentimeter` | cm³ | Small containers |
| `Milliliter` | mL | Beverages, cosmetics |
| `Liter` | L | Beverages, paint, fuel |
| `CubicMeter` | m³ | Building materials, sand, gravel |
| `FluidOunce` | fl oz | US/UK beverages, cosmetics |
| `Gallon` | gal | US/UK fuel, paint |

### Temperature

| Value | Symbol | Use case |
|-------|--------|----------|
| `Celsius` | °C | Rarely a sales unit |
| `Fahrenheit` | °F | Rarely a sales unit |
| `Kelvin` | K | Scientific/industrial |

### Energy

| Value | Symbol | Use case |
|-------|--------|----------|
| `Joule` | J | Nutritional/industrial |
| `KilowattHour` | kWh | Electricity sales |

### Power

| Value | Symbol | Use case |
|-------|--------|----------|
| `Watt` | W | Electronics rating |
| `Kilowatt` | kW | Equipment rating |
| `MechanicalHorsepower` | hp | Vehicles, machinery |
| `MetricHorsepower` | hp | EU vehicles, machinery |

### Speed

| Value | Symbol | Use case |
|-------|--------|----------|
| `MeterPerSecond` | m/s | Industrial |
| `KilometerPerHour` | km/h | Vehicle rating |
| `MilePerHour` | mph | US/UK vehicle rating |
| `Knot` | kn | Marine equipment |

### Time

| Value | Symbol | Use case |
|-------|--------|----------|
| `Millisecond` | ms | Rarely a sales unit |
| `Second` | s | Telecom billing |
| `Minute` | min | Service billing |
| `Hour` | h | Service billing, parking |
| `Day` | d | Rental, service billing |
| `Week` | wk | Rental, subscription |

> **Total: 48 unit values** across 10 systems. For typical retail, focus on Occurrence, Mass, Length, Area, Volume, and Time.

---

## Section 3: Common Retail Scenarios

### Discrete items (most products)

The vast majority of retail products use `"Piece"`. A packaged bottle of soda is `"Piece"`, not `"Liter"` — the unit describes how you **sell** the item, not what's inside.

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/products" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "product",
    "identifiers": { "sku": "TSHIRT-BLK-M" },
    "name": "Black T-Shirt (M)",
    "unit": "Piece",
    "parentGroup": { "identifiers": { "com.example.id": "tshirts" } },
    "defaultVatCode": { "identifiers": { "percentage": "25" } }
  }'
```

### Weight-based deli/produce

Deli counters selling sliced salami or loose vegetables by weight. Quantities are decimal (e.g., `"0.350"` for 350g):

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/products" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "product",
    "identifiers": { "sku": "CHEESE-BRIE-001" },
    "name": "French Brie",
    "unit": "Kilogram",
    "parentGroup": { "identifiers": { "com.example.id": "deli-cheese" } },
    "defaultVatCode": { "identifiers": { "percentage": "12" } }
  }'
```

When ordering 350g of brie, the trade order item quantity is `"0.350"`:

```json
{
  "@type": "trade order item",
  "product": { "identifiers": { "sku": "CHEESE-BRIE-001" } },
  "quantity": "0.350"
}
```

### Fabric/cable by length

Fabric rolls, electrical cable, rope — sold by the meter:

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/products" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "product",
    "identifiers": { "sku": "CABLE-CAT6-BLU" },
    "name": "Cat6 Ethernet Cable (Blue)",
    "unit": "Meter",
    "parentGroup": { "identifiers": { "com.example.id": "network-cables" } },
    "defaultVatCode": { "identifiers": { "percentage": "25" } }
  }'
```

### Flooring/tiles by area

Tiles, laminate, carpet — sold by the square meter:

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/products" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "product",
    "identifiers": { "sku": "TILE-MARBLE-30X30" },
    "name": "Marble Tile 30x30",
    "unit": "SquareMeter",
    "parentGroup": { "identifiers": { "com.example.id": "floor-tiles" } },
    "defaultVatCode": { "identifiers": { "percentage": "25" } }
  }'
```

### Beverages by volume

Fountain drinks or bulk liquids sold by the liter. Note: pre-packaged bottles are `"Piece"` — use `"Liter"` only for measured dispensing:

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/products" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "product",
    "identifiers": { "sku": "FOUNTAIN-COLA" },
    "name": "Fountain Cola",
    "unit": "Liter",
    "parentGroup": { "identifiers": { "com.example.id": "fountain-drinks" } },
    "defaultVatCode": { "identifiers": { "percentage": "12" } }
  }'
```

### Time-based services

Consulting, repair services, parking — sold by the hour:

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/products" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "product",
    "identifiers": { "sku": "SVC-REPAIR-HOURLY" },
    "name": "Repair Service (Hourly)",
    "unit": "Hour",
    "parentGroup": { "identifiers": { "com.example.id": "services" } },
    "defaultVatCode": { "identifiers": { "percentage": "25" } }
  }'
```

### Electricity sales

Energy sold by the kilowatt-hour:

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/products" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "product",
    "identifiers": { "sku": "ELEC-KWH-SPOT" },
    "name": "Electricity (Spot Price)",
    "unit": "KilowattHour",
    "parentGroup": { "identifiers": { "com.example.id": "energy" } },
    "defaultVatCode": { "identifiers": { "percentage": "25" } }
  }'
```

---

## Section 4: Inheritance — Setting Unit at the Group Level

The `unit` is typically set on the **product group** and inherited by all descendants. This keeps data consistent and reduces maintenance.

### Create a product group with a unit

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/product-groups" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "product group",
    "identifiers": { "com.example.id": "deli-meats" },
    "name": "Deli Meats",
    "instanceType": "Food",
    "unit": "Kilogram",
    "defaultVatCode": { "identifiers": { "percentage": "12" } }
  }'
```

All products created under this group inherit `"unit": "Kilogram"`. You don't need to set `unit` on each product.

### Inheritance hierarchy

```
Product Group (unit: "Kilogram")     ← set here
  └── Product Family (inherits)
        └── Product (inherits)        ← reads as "Kilogram"
```

### Setting unit on a product family

Product families can also have a unit that overrides the parent group:

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/product-families" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "product family",
    "identifiers": { "com.example.id": "premium-salami" },
    "name": "Premium Salami",
    "unit": "Kilogram",
    "parentGroup": { "identifiers": { "com.example.id": "deli-meats" } }
  }'
```

### Overriding at the product level

Individual products can override the inherited unit, but this is uncommon and should be done deliberately:

```bash
# The "deli-meats" group uses "Kilogram", but pre-sliced packs are sold by the piece
curl -X POST -u ":banana" "example.app.heads.com/api/v1/products" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "product",
    "identifiers": { "sku": "SALAMI-PRESLICED-150G" },
    "name": "Pre-Sliced Salami 150g",
    "unit": "Piece",
    "parentGroup": { "identifiers": { "com.example.id": "deli-meats" } },
    "defaultVatCode": { "identifiers": { "percentage": "12" } }
  }'
```

> **When to override:** Pre-packaged items in a weight-based group (a 150g salami pack is `"Piece"`, even though loose salami is `"Kilogram"`). The unit describes how you **sell**, not what the item contains.

---

## Section 5: Localized Unit Symbols

The system provides localized unit symbols for display on receipts and POS terminals. SI unit symbols (kg, m, L, etc.) are international and don't vary by language. The main exception is `"Piece"`:

| Language | Code | "Piece" symbol |
|----------|------|----------------|
| English | en | pc |
| Swedish | sv | st |
| Norwegian | nb | stk |
| Danish | da | stk |
| Finnish | fi | kpl |
| German | de | Stk |
| French | fr | pc |
| Spanish | es | ud |

### How this affects receipts

A receipt item for 350g of salami displays as `0.350 kg` in any language.

A receipt item for 2 pieces of a product displays differently:
- English: `2 pc`
- Swedish: `2 st`
- Norwegian/Danish: `2 stk`
- Finnish: `2 kpl`
- German: `2 Stk`
- Spanish: `2 ud`

> **Note:** The localization is handled automatically by the POS/receipt system. You only need to set the correct `unit` value — the symbol rendering is language-dependent at display time.

---

## Section 6: Best Practices and Pitfalls

- **Set unit at the group level, not per product.** Unless a product has a different unit than its group, rely on inheritance. This keeps data consistent and reduces maintenance.

- **Use `"Piece"` for pre-packaged goods.** A bottle of soda is `"Piece"`, not `"Liter"`. A bag of flour is `"Piece"`, not `"Kilogram"`. The unit describes how you **sell** the item, not what's inside.

- **Use `"Kilogram"` (etc.) for weighed/measured goods.** A deli counter selling sliced salami by weight uses `"Kilogram"`. The quantity on the order item will be a decimal like `"0.350"`.

- **Values are case-sensitive PascalCase.** It's `"Kilogram"`, not `"kilogram"` or `"kg"`. The API expects the exact string value.

- **Not all units make sense for retail.** Temperature, speed, and power units exist for completeness but are rarely used as sales units. Stick to Occurrence, Mass, Length, Area, Volume, and Time for typical retail.

- **The unit affects receipt display.** The POS terminal and receipt will show the localized unit symbol next to quantities. A receipt item for 350g of salami shows `0.350 kg` (or `0,350 kg` in Swedish locale).

- **Decimal quantities for measured goods.** When the unit is `"Kilogram"`, `"Meter"`, `"Liter"`, etc., order item quantities can and should be decimal strings (e.g., `"0.350"`, `"2.5"`, `"1.75"`). For `"Piece"`, quantities are typically whole numbers.

- **Don't confuse unit with packaging.** A "6-pack of soda" is still `"Piece"` (one sellable unit). The packaging is modeled via [product packages](./product-packages.md), not the unit property.
