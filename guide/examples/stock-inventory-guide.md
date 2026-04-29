# Stock & Inventory Guide

A comprehensive guide to managing inventory in CommerceOS — from zero knowledge to confidently operating all stock operations. Covers the two-dimensional inventory model, stock adjustments, stock counts, stock transfers, serial number and batch tracking, and integration patterns.

**Base URL:** `https://example.app.heads.com/api/v1`
**API Key:** `banana` (passed via Basic Auth with empty username: `-u ":banana"`)

> **See also:** [Inventory Quick-Start Examples](./inventory.md) | [Examples Index](../examples.md) | [Reference Documentation](../../reference/)

---

## Table of Contents

- [Part 1: Concepts — The Two-Dimensional Inventory Model](#part-1-concepts--the-two-dimensional-inventory-model)
- [Part 2: Setting Up Inventory Infrastructure](#part-2-setting-up-inventory-infrastructure)
  - [2.1 Creating Stocks (Logical Containers)](#21-creating-stocks-logical-containers)
  - [2.2 Creating Stock Places (Physical Locations)](#22-creating-stock-places-physical-locations)
  - [2.3 Creating Stock Adjustment Reasons](#23-creating-stock-adjustment-reasons)
- [Part 3: Stock Adjustments — Changing Inventory Levels](#part-3-stock-adjustments--changing-inventory-levels)
  - [3.1 Basic Stock Adjustment — Increasing Stock](#31-basic-stock-adjustment--increasing-stock)
  - [3.2 Decreasing Stock](#32-decreasing-stock)
  - [3.3 Multi-Item Adjustments](#33-multi-item-adjustments)
  - [3.4 Adjusting with a Specific Logical Stock](#34-adjusting-with-a-specific-logical-stock)
  - [3.5 Reading Stock Levels](#35-reading-stock-levels)
  - [3.6 Reading Adjustment History](#36-reading-adjustment-history)
- [Part 4: Stock Counts — Physical Inventory](#part-4-stock-counts--physical-inventory)
  - [4.1 Creating a Stock Count](#41-creating-a-stock-count)
  - [4.2 Recording Observations](#42-recording-observations)
  - [4.3 Reviewing Variances](#43-reviewing-variances)
  - [4.4 Approving a Stock Count](#44-approving-a-stock-count)
  - [4.5 Stock Count Records — The Source of Truth](#45-stock-count-records--the-source-of-truth)
- [Part 5: Stock Transfers — Moving Stock Between Logical Stocks](#part-5-stock-transfers--moving-stock-between-logical-stocks)
  - [5.1 Creating a Stock Transfer](#51-creating-a-stock-transfer)
  - [5.2 Stock Transfer Lifecycle — Commit, Fulfill, Cancel](#52-stock-transfer-lifecycle--commit-fulfill-cancel)
  - [5.3 Stock Transfer Records — The Source of Truth](#53-stock-transfer-records--the-source-of-truth)
  - [5.4 Inter-Store Transfers](#54-inter-store-transfers)
- [Part 6: Tracking — Serial Numbers and Batches](#part-6-tracking--serial-numbers-and-batches)
  - [6.1 Configuring Tracking on Products](#61-configuring-tracking-on-products)
  - [6.2 Stock Adjustments with Serial Numbers](#62-stock-adjustments-with-serial-numbers)
  - [6.3 Stock Adjustments with Batches](#63-stock-adjustments-with-batches)
  - [6.4 Tracking in Stock Counts](#64-tracking-in-stock-counts)
  - [6.5 Tracking in Stock Transfers](#65-tracking-in-stock-transfers)
- [Part 7: Stock Resets — Emergency Reconciliation](#part-7-stock-resets--emergency-reconciliation)
- [Part 8: Integration Patterns](#part-8-integration-patterns)
  - [8.1 Initial Stock Import](#81-initial-stock-import)
  - [8.2 Ongoing Inventory Sync](#82-ongoing-inventory-sync)
  - [8.3 Reading Current Stock for E-Commerce](#83-reading-current-stock-for-e-commerce)
- [Part 9: Field Reference (Quick Reference Tables)](#part-9-field-reference-quick-reference-tables)
- [Part 10: Pitfalls and Gotchas](#part-10-pitfalls-and-gotchas)
- [Part 11: API Endpoint Reference](#part-11-api-endpoint-reference)

---

## Part 1: Concepts — The Two-Dimensional Inventory Model

CommerceOS tracks inventory in **two independent dimensions**: logical and physical.

- **Logical dimension** (`stock`): Concerned with _ownership_ and _classification_. Who owns the item? What is its status or purpose?
- **Physical dimension** (`stock place`): Concerned exclusively with _physical whereabouts_. Where, in the real world, is the item located?

These two dimensions are independent of each other. An item in "Stockholm Backroom" (physical) can belong to either the "Default Stock" or the "Consignment Stock" (logical). This separation is powerful because it accurately models real-world scenarios such as:

- Two items in the **same physical location** but with **different owners** — e.g., in a Third-Party Logistics (3PL) warehouse employed by multiple customers.
- Two items in the **same physical location** but with **different classifications** — e.g., one new item intended for sale, and a returned item in quality inspection hold.
- Items **owned by a customer** but **physically located elsewhere** — e.g., at a service center for repair.

### Concrete Example

Imagine a retail chain with two stores (Stockholm, Gothenburg) and a central warehouse. The Stockholm store also handles consignment items for a partner brand.

```
Logical (who owns it / what status)          Physical (where is it)
─────────────────────────────────────        ──────────────────────────────────
├── Stockholm Default Stock                  ├── Stockholm Store
│   ├── Product A: 50 pcs                    │   ├── Shop Floor
│   └── Product B: 20 pcs                    │   │   ├── Product A: 30 pcs
├── Stockholm Consignment Stock              │   │   └── Product B: 15 pcs
│   └── Product C: 10 pcs (owned by Partner) │   └── Backroom
├── Gothenburg Default Stock                 │       ├── Product A: 20 pcs
│   └── Product A: 30 pcs                   │       └── Product C: 10 pcs
└── Warehouse Default Stock                  ├── Gothenburg Store
    └── Product B: 5 pcs                     │   └── Product A: 30 pcs
                                             └── Central Warehouse
                                                 └── Zone A
                                                     └── Product B: 5 pcs
```

The logical side tells you _who owns what_ and _in what capacity_. The physical side tells you _where things are_. Together, they give a complete picture: "10 units of Product C are in the Stockholm Backroom, and they belong to the Consignment Stock (owned by the partner brand)."

### Key Concepts

| Concept | What it is | Analogy |
|---------|-----------|---------|
| **Stock** | A flat, logical subdivision of inventory (ownership/classification) | A ledger or account |
| **Stock Place** | A hierarchical physical location (warehouse → aisle → shelf → bin) | A location on a map |
| **Stock Adjustment** | A document that changes stock quantities (increase or decrease) | A journal entry |
| **Stock Count** | A document representing physical inventory counting | An audit worksheet |
| **Stock Count Record** | The immutable, posted result of an approved stock count | The posted audit adjustment |
| **Stock Transfer** | A document representing movement between logical stocks | A transfer order |
| **Stock Transfer Record** | The immutable, posted result of a stock transfer action | The posted transfer journal |

---

## Part 2: Setting Up Inventory Infrastructure

Before you can adjust stock, count inventory, or transfer items, you need the infrastructure in place: logical stocks, physical stock places, and reason codes for adjustments.

### 2.1 Creating Stocks (Logical Containers)

Every store has a **default stock** that is pre-created and pre-selected for sales, purchase, and inventory transactions. You only need to create additional stocks for special classifications.

```bash
# List existing stocks (the default stock is already here)
curl -X GET -u ":banana" "example.app.heads.com/api/v1/stocks"
```

Response:

```json
[
  {
    "@type": "stock",
    "identifiers": { "key": "abc123..." },
    "name": "Default Stock",
    "default": true
  }
]
```

To create additional stocks for special classifications:

```bash
# Create a consignment stock (items owned by a partner, sold at your store)
curl -X POST -u ":banana" "example.app.heads.com/api/v1/stocks" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "consignment-stock" },
    "name": "Consignment Stock"
  }'

# Create a returns stock (items pending quality inspection)
curl -X POST -u ":banana" "example.app.heads.com/api/v1/stocks" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "returns-stock" },
    "name": "Returns / QC Hold"
  }'

# Create a display stock (showroom items not ordinarily for sale)
curl -X POST -u ":banana" "example.app.heads.com/api/v1/stocks" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "display-stock" },
    "name": "Display Stock"
  }'
```

```bash
# Read a stock by identifier
curl -X GET -u ":banana" "example.app.heads.com/api/v1/stocks/com.example.id=consignment-stock"

# Update a stock name
curl -X PATCH -u ":banana" "example.app.heads.com/api/v1/stocks/com.example.id=consignment-stock" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Partner Consignment Stock" }'
```

> **Note:** The `default` field is read-only. You cannot create a second default stock — each store has exactly one.

> **Scope note:** The `/v1/stocks` endpoint is only available under the `stock:write` scope — it is **not** included in `stock:read`. This means integrations that only have `stock:read` access can work with stock places, adjustments, and transactions, but cannot list or manage logical stock containers. If your integration needs to read stocks, request the `stock:write` scope.

### 2.2 Creating Stock Places (Physical Locations)

A `stock place` represents a hierarchical physical location: warehouse, zone, aisle, shelf, rack, bin, etc.

> **Important:** Currently, CommerceOS doesn't fully support having multiple stock places in a single store. We recommend creating **exactly one stock place per store** and designating it as the sole `stockRoot` of the store.

#### Step 1: Create a stock place

```bash
# Create a stock place without specifying an owner (preferred approach)
curl -X POST -u ":banana" "example.app.heads.com/api/v1/stock-places" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "stockholm-store" },
    "name": "Stockholm Store"
  }'
```

#### Step 2: Assign it to a store via `stockRoots`

This is the **preferred method** for establishing ownership. The `owner` field on a stock place is a **computed property** — it's derived from which agent's `stockRoots` collection includes this place.

```bash
# Add the stock place to the store's stockRoots (establishes ownership)
curl -X POST -u ":banana" "example.app.heads.com/api/v1/stores/com.example.storeId=stockholm/stockRoots" \
  -H "Content-Type: application/json" \
  -d '{ "identifiers": { "com.example.id": "stockholm-store" } }'
```

Alternatively, you can set `owner` directly on the stock place — this manipulates `stockRoots` behind the scenes:

```bash
# Alternative: Create with owner shorthand
curl -X POST -u ":banana" "example.app.heads.com/api/v1/stock-places" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "gothenburg-store" },
    "name": "Gothenburg Store",
    "owner": { "identifiers": { "com.example.storeId": "gothenburg" } }
  }'
```

#### Creating child stock places (zones, aisles, shelves)

The `parent` setter requires the **database key** (the internal `identifiers.key`), not external identifiers. This is a two-step process:

```bash
# Step 1: Get the parent's database key
curl -X GET -u ":banana" "example.app.heads.com/api/v1/stock-places/com.example.id=stockholm-store/identifiers/key"
# Returns the database key, e.g., "abc123def456..."

# Step 2: Create the child using the database key
curl -X POST -u ":banana" "example.app.heads.com/api/v1/stock-places" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "stockholm-backroom" },
    "name": "Backroom",
    "parent": { "identifiers": { "key": "abc123def456..." } }
  }'
```

```bash
# List all stock places
curl -X GET -u ":banana" "example.app.heads.com/api/v1/stock-places"

# Get a stock place with its children (sub-locations)
curl -X GET -u ":banana" "example.app.heads.com/api/v1/stock-places/com.example.id=stockholm-store~with(children)"

# Update a stock place name
curl -X PATCH -u ":banana" "example.app.heads.com/api/v1/stock-places/com.example.id=stockholm-store" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Stockholm Flagship Store" }'
```

#### `stockRoots` vs `assortmentRoots`

These are separate concepts that are often confused:

| Member | Purpose | What it contains |
|--------|---------|------------------|
| `stockRoots` | Defines where an agent's **inventory** is managed | Stock places (warehouses, stockrooms) |
| `assortmentRoots` | Defines an agent's **product catalog** | Product nodes (categories, groups) |

- Use `stockRoots` for stock adjustments and inventory tracking
- Use `assortmentRoots` for product assortment and catalog visibility

#### Clearing stockRoots

To remove all stock roots from an agent, use `PUT` with an empty array:

```bash
# Remove all stock roots from a store
curl -X PUT -u ":banana" "example.app.heads.com/api/v1/stores/com.example.storeId=stockholm/stockRoots" \
  -H "Content-Type: application/json" \
  -d '[]'
```

### 2.3 Creating Stock Adjustment Reasons

Every stock adjustment requires a reason code that explains _why_ the change is happening. Each reason has a `direction` — either `Increase` or `Decrease` — which determines whether the adjustment adds or removes stock.

```bash
# Create an Increase reason: Restock
curl -X POST -u ":banana" "example.app.heads.com/api/v1/stock-adjustment-reasons" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "restock" },
    "name": "Restock",
    "active": true,
    "direction": "Increase"
  }'

# Create an Increase reason: Purchase Receipt
curl -X POST -u ":banana" "example.app.heads.com/api/v1/stock-adjustment-reasons" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "purchase-receipt" },
    "name": "Purchase Receipt",
    "active": true,
    "direction": "Increase"
  }'

# Create an Increase reason: Found (discovered during count)
curl -X POST -u ":banana" "example.app.heads.com/api/v1/stock-adjustment-reasons" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "found" },
    "name": "Found",
    "active": true,
    "direction": "Increase"
  }'

# Create a Decrease reason: Damaged
curl -X POST -u ":banana" "example.app.heads.com/api/v1/stock-adjustment-reasons" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "damaged" },
    "name": "Damaged",
    "active": true,
    "direction": "Decrease"
  }'

# Create a Decrease reason: Stolen
curl -X POST -u ":banana" "example.app.heads.com/api/v1/stock-adjustment-reasons" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "stolen" },
    "name": "Stolen / Shrinkage",
    "active": true,
    "direction": "Decrease"
  }'

# Create a Decrease reason: Expired
curl -X POST -u ":banana" "example.app.heads.com/api/v1/stock-adjustment-reasons" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "expired" },
    "name": "Expired",
    "active": true,
    "direction": "Decrease"
  }'
```

```bash
# List all adjustment reasons
curl -X GET -u ":banana" "example.app.heads.com/api/v1/stock-adjustment-reasons"

# Get a specific reason
curl -X GET -u ":banana" "example.app.heads.com/api/v1/stock-adjustment-reasons/com.example.id=restock"

# Deactivate a reason (soft-disable, doesn't delete it)
curl -X PATCH -u ":banana" "example.app.heads.com/api/v1/stock-adjustment-reasons/com.example.id=stolen" \
  -H "Content-Type: application/json" \
  -d '{ "active": false }'
```

> **Stock Adjustment Reason Fields:**
>
> | Field | Type | Description |
> |-------|------|-------------|
> | `identifiers` | common identifiers | External identifiers for the reason |
> | `name` | string | Human-readable name |
> | `active` | boolean | Whether the reason is currently usable |
> | `direction` | `"Increase"` or `"Decrease"` | Determines whether adjustments with this reason add or remove stock |

---

## Part 3: Stock Adjustments — Changing Inventory Levels

A `stock adjustment` is the primary mechanism for changing stock quantities. Each adjustment pertains to exactly one store and stock, and contains one or more items. The adjustment's direction (increase or decrease) is determined by the **reason code**, not by a negative quantity — quantities are always positive.

### 3.1 Basic Stock Adjustment — Increasing Stock

```bash
# Restock 50 units of T-Shirt Red M at the Stockholm store
curl -X POST -u ":banana" "example.app.heads.com/api/v1/stock-adjustments" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "adj-restock-001" },
    "timestamp": "2026-03-25T10:00:00Z",
    "items": [
      {
        "product": { "identifiers": { "com.example.sku": "TSHIRT-RED-M" } },
        "place": { "identifiers": { "com.example.id": "stockholm-store" } },
        "reason": { "identifiers": { "com.example.id": "restock" } },
        "quantity": 50
      }
    ]
  }'
```

Response:

```json
{
  "@type": "stock adjustment",
  "identifiers": {
    "key": "...",
    "com.example.id": "adj-restock-001"
  },
  "timestamp": "2026-03-25T10:00:00.000Z",
  "owner": {
    "@type": "store",
    "identifiers": { "com.example.storeId": "stockholm" },
    "name": "Stockholm Store"
  }
}
```

> **Note:** The `owner` is auto-inferred from the stock place's ownership (via `stockRoots`). You can also specify it explicitly.

### 3.2 Decreasing Stock

The direction comes from the **reason's `direction` field**, not from the quantity. Quantities are always positive.

```bash
# Record 5 units damaged at the Stockholm store
curl -X POST -u ":banana" "example.app.heads.com/api/v1/stock-adjustments" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "adj-damaged-001" },
    "timestamp": "2026-03-25T14:30:00Z",
    "items": [
      {
        "product": { "identifiers": { "com.example.sku": "TSHIRT-RED-M" } },
        "place": { "identifiers": { "com.example.id": "stockholm-store" } },
        "reason": { "identifiers": { "com.example.id": "damaged" } },
        "quantity": 5
      }
    ]
  }'
```

After this, Stockholm has 45 units of TSHIRT-RED-M (50 restocked minus 5 damaged).

### 3.3 Multi-Item Adjustments

Adjust multiple products in a single request:

```bash
# Bulk restock: multiple products in one adjustment
curl -X POST -u ":banana" "example.app.heads.com/api/v1/stock-adjustments" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "adj-bulk-restock-001" },
    "timestamp": "2026-03-26T09:00:00Z",
    "items": [
      {
        "product": { "identifiers": { "com.example.sku": "TSHIRT-RED-M" } },
        "place": { "identifiers": { "com.example.id": "stockholm-store" } },
        "reason": { "identifiers": { "com.example.id": "restock" } },
        "quantity": 100
      },
      {
        "product": { "identifiers": { "com.example.sku": "TSHIRT-BLUE-L" } },
        "place": { "identifiers": { "com.example.id": "stockholm-store" } },
        "reason": { "identifiers": { "com.example.id": "restock" } },
        "quantity": 75
      },
      {
        "product": { "identifiers": { "com.example.sku": "JEANS-BLACK-32" } },
        "place": { "identifiers": { "com.example.id": "stockholm-store" } },
        "reason": { "identifiers": { "com.example.id": "restock" } },
        "quantity": 30
      }
    ]
  }'
```

All items in the same adjustment share the same `timestamp` and `owner`. Each item can reference a different product, stock place, and reason.

### 3.4 Adjusting with a Specific Logical Stock

By default, adjustments go against the store's **default stock**. To target a non-default stock (e.g., consignment), specify the `stock` field:

```bash
# Adjust consignment stock: 10 units received from partner brand
curl -X POST -u ":banana" "example.app.heads.com/api/v1/stock-adjustments" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "adj-consignment-001" },
    "timestamp": "2026-03-26T11:00:00Z",
    "stock": { "identifiers": { "com.example.id": "consignment-stock" } },
    "items": [
      {
        "product": { "identifiers": { "com.example.sku": "PARTNER-HANDBAG-A" } },
        "place": { "identifiers": { "com.example.id": "stockholm-store" } },
        "reason": { "identifiers": { "com.example.id": "restock" } },
        "quantity": 10
      }
    ]
  }'
```

### 3.5 Reading Stock Levels

After adjustments, you can read the current stock levels in several ways.

#### Per stock place: entries

```bash
# Get current stock levels at a stock place
curl -X GET -u ":banana" "example.app.heads.com/api/v1/stock-places/com.example.id=stockholm-store/entries"
```

Response:

```json
[
  {
    "@type": "stock entry",
    "product": {
      "@type": "product",
      "identifiers": { "com.example.sku": "TSHIRT-RED-M" },
      "name": "T-Shirt Red M"
    },
    "physicalQuantity": "45",
    "availableQuantity": "45"
  },
  {
    "@type": "stock entry",
    "product": {
      "@type": "product",
      "identifiers": { "com.example.sku": "TSHIRT-BLUE-L" },
      "name": "T-Shirt Blue L"
    },
    "physicalQuantity": "75",
    "availableQuantity": "75"
  }
]
```

- **`physicalQuantity`**: The total physical stock at this location.
- **`availableQuantity`**: The stock that's actually available (physical minus any reserved stock, e.g., from pending transfers).

#### Per product: stock levels

```bash
# Get stock levels for a specific product across all locations
curl -X GET -u ":banana" "example.app.heads.com/api/v1/products/com.example.sku=TSHIRT-RED-M/stockLevels"
```

Response:

```json
[
  {
    "location": {
      "@type": "store",
      "identifiers": { "com.example.storeId": "stockholm" },
      "name": "Stockholm Store"
    },
    "totalQuantity": "45",
    "reservedQuantity": "0",
    "availableQuantity": "45"
  },
  {
    "location": {
      "@type": "store",
      "identifiers": { "com.example.storeId": "gothenburg" },
      "name": "Gothenburg Store"
    },
    "totalQuantity": "30",
    "reservedQuantity": "0",
    "availableQuantity": "30"
  }
]
```

- **`totalQuantity`**: Total stock of this product at the location.
- **`reservedQuantity`**: Quantity reserved by committed (but not yet fulfilled) stock transfers.
- **`availableQuantity`**: `totalQuantity` minus `reservedQuantity`.

### 3.6 Reading Adjustment History

```bash
# List all stock adjustments
curl -X GET -u ":banana" "example.app.heads.com/api/v1/stock-adjustments"

# Get a specific adjustment with its items expanded
curl -X GET -u ":banana" "example.app.heads.com/api/v1/stock-adjustments/com.example.id=adj-restock-001~with(items)"

# Get all stock transactions (adjustments) for a specific stock place
curl -X GET -u ":banana" "example.app.heads.com/api/v1/stock-places/com.example.id=stockholm-store/transactions"

# Get individual adjustment items for a specific stock place
curl -X GET -u ":banana" "example.app.heads.com/api/v1/stock-places/com.example.id=stockholm-store/transactionItems"
```

You can also list adjustment items globally:

```bash
# List all stock adjustment items across all adjustments
curl -X GET -u ":banana" "example.app.heads.com/api/v1/stock-adjustment-items"
```

---

## Part 4: Stock Counts — Physical Inventory

A `stock count` represents the process of physically counting inventory. Unlike stock adjustments, stock counts do **not** directly change stock quantities. Instead, when approved, they generate **stock count records** which are the actual posted adjustments.

> **Critical:** You should **NEVER** use stock counts as a source of truth for stock quantity changes. **ALWAYS** consult the stock count records for this.

The stock count lifecycle is: **New → Ongoing → Completed → Approved**.

### 4.1 Creating a Stock Count

```bash
# Create a stock count for Q1 2026 at the Stockholm store
curl -X POST -u ":banana" "example.app.heads.com/api/v1/stock-counts" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "count-2026-q1" },
    "owner": { "identifiers": { "com.example.storeId": "stockholm" } },
    "items": [
      {
        "identifiers": { "com.example.id": "count-item-tshirt-red" },
        "product": { "identifiers": { "com.example.sku": "TSHIRT-RED-M" } },
        "place": { "identifiers": { "com.example.id": "stockholm-store" } }
      },
      {
        "identifiers": { "com.example.id": "count-item-tshirt-blue" },
        "product": { "identifiers": { "com.example.sku": "TSHIRT-BLUE-L" } },
        "place": { "identifiers": { "com.example.id": "stockholm-store" } }
      },
      {
        "identifiers": { "com.example.id": "count-item-jeans" },
        "product": { "identifiers": { "com.example.sku": "JEANS-BLACK-32" } },
        "place": { "identifiers": { "com.example.id": "stockholm-store" } }
      }
    ]
  }'
```

The stock count starts with status `"New"`. Each item specifies the product and stock place to be counted.

You can optionally target a specific logical stock with the `stock` field:

```bash
# Count only consignment stock
curl -X POST -u ":banana" "example.app.heads.com/api/v1/stock-counts" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "count-consignment-2026-q1" },
    "owner": { "identifiers": { "com.example.storeId": "stockholm" } },
    "stock": { "identifiers": { "com.example.id": "consignment-stock" } },
    "items": [
      {
        "identifiers": { "com.example.id": "count-consignment-item-1" },
        "product": { "identifiers": { "com.example.sku": "PARTNER-HANDBAG-A" } },
        "place": { "identifiers": { "com.example.id": "stockholm-store" } }
      }
    ]
  }'
```

You can also add items to an existing stock count after creation:

```bash
# Add a new item to an existing stock count
curl -X POST -u ":banana" "example.app.heads.com/api/v1/stock-count-items" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "count-item-hoodie" },
    "parent": { "identifiers": { "com.example.id": "count-2026-q1" } },
    "product": { "identifiers": { "com.example.sku": "HOODIE-GRAY-L" } },
    "place": { "identifiers": { "com.example.id": "stockholm-store" } }
  }'
```

### 4.2 Recording Observations

Observations are the actual counts made by staff. Multiple people can count the same item — each observation is recorded separately.

```bash
# First counter counts 43 units of T-Shirt Red M
curl -X POST -u ":banana" "example.app.heads.com/api/v1/stock-count-observations" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "obs-tshirt-red-counter1" },
    "parent": { "identifiers": { "com.example.id": "count-item-tshirt-red" } },
    "counter": { "identifiers": { "com.example.userId": "anna" } },
    "instances": [
      { "quantity": 43 }
    ]
  }'

# Second counter recounts and finds 44 units
curl -X POST -u ":banana" "example.app.heads.com/api/v1/stock-count-observations" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "obs-tshirt-red-counter2" },
    "parent": { "identifiers": { "com.example.id": "count-item-tshirt-red" } },
    "counter": { "identifiers": { "com.example.userId": "erik" } },
    "instances": [
      { "quantity": 44 }
    ]
  }'
```

> **Note:** The `quantity` field on a stock count observation is **read-only** — it's computed from the `instances` array. You provide the counted quantity via the `instances` field.

Each observation records:

| Field | Type | Description |
|-------|------|-------------|
| `identifiers` | common identifiers | External identifiers for the observation |
| `parent` | stock count item reference | Which item this observation belongs to |
| `counter` | agent reference | The user/agent who made the observation |
| `quantity` | decimal (read-only) | Computed from `instances` |
| `instances` | product instances | The counted product instances (with quantity) |

### 4.3 Reviewing Variances

After observations are recorded, read back the count items to see computed variances:

```bash
# Get the stock count with items and their observations
curl -X GET -u ":banana" "example.app.heads.com/api/v1/stock-counts/com.example.id=count-2026-q1~with(items~with(observations))"
```

Each stock count item has these computed fields:

```json
{
  "@type": "stock count item",
  "identifiers": { "com.example.id": "count-item-tshirt-red" },
  "product": { "identifiers": { "com.example.sku": "TSHIRT-RED-M" }, "name": "T-Shirt Red M" },
  "place": { "identifiers": { "com.example.id": "stockholm-store" } },
  "counted": true,
  "expectedQuantity": "45",
  "countedQuantity": "44",
  "overageQuantity": "0",
  "shortageQuantity": "1",
  "observations": [
    {
      "counter": { "identifiers": { "com.example.userId": "anna" } },
      "quantity": "43"
    },
    {
      "counter": { "identifiers": { "com.example.userId": "erik" } },
      "quantity": "44"
    }
  ]
}
```

| Field | Description |
|-------|-------------|
| `counted` | Whether any observations have been recorded |
| `expectedQuantity` | System's stock level, captured as a snapshot at the time of the first count |
| `countedQuantity` | Total from the most recent observation(s) |
| `overageQuantity` | Positive variance (counted more than expected) |
| `shortageQuantity` | Negative variance (counted fewer than expected) |

> **Note:** `expectedQuantity` is a **snapshot** captured at the time of the first observation, not a live value. Later stock movements won't change it.

> **Note:** Even if `countedQuantity` equals `expectedQuantity`, a shortage or overage can still exist at the instance level when tracking is used — e.g., the right total quantity but wrong serial numbers.

### 4.4 Approving a Stock Count

The stock count moves through statuses as observations are recorded:

| Status | Meaning |
|--------|---------|
| `New` | Created, no observations yet |
| `Ongoing` | At least one observation recorded |
| `Completed` | All items have been counted |
| `Approved` | Finalized; stock count records have been generated |

The status transitions are managed by the system as observations are added and the count is approved. When a stock count is approved, it generates **stock count records** — the immutable, posted adjustments that actually change stock levels.

```bash
# Read the current status
curl -X GET -u ":banana" "example.app.heads.com/api/v1/stock-counts/com.example.id=count-2026-q1~just(identifiers,status)"
```

### 4.5 Stock Count Records — The Source of Truth

> **Critical:** Stock counts are working documents. Stock count **records** are the source of truth for what actually changed. Always use stock count records when you need to know the actual posted stock quantity changes.

```bash
# List all stock count records
curl -X GET -u ":banana" "example.app.heads.com/api/v1/stock-count-records"

# Get a specific stock count record with items
curl -X GET -u ":banana" "example.app.heads.com/api/v1/stock-count-records/key=abc123~with(items)"

# Get stock count records for a specific stock count
curl -X GET -u ":banana" "example.app.heads.com/api/v1/stock-counts/com.example.id=count-2026-q1/records~with(items)"
```

Each stock count record item shows the actual posted change:

```json
{
  "@type": "stock count record item",
  "product": {
    "identifiers": { "com.example.sku": "TSHIRT-RED-M" },
    "name": "T-Shirt Red M"
  },
  "place": {
    "identifiers": { "com.example.id": "stockholm-store" }
  },
  "increaseQuantity": "0",
  "decreaseQuantity": "1"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `product` | product reference | The product that was adjusted |
| `place` | place reference | The location of the adjustment |
| `increaseQuantity` | decimal (read-only) | How much stock was added |
| `decreaseQuantity` | decimal (read-only) | How much stock was removed |
| `increaseInstances` | product instances | Specific instances added (when tracking) |
| `decreaseInstances` | product instances | Specific instances removed (when tracking) |

---

## Part 5: Stock Transfers — Moving Stock Between Logical Stocks

A `stock transfer` represents the movement of inventory between two **logical stocks**. Currently, the fully supported scenario is transferring between stocks **within the same store** (e.g., moving items from default stock to consignment stock).

Like stock counts, stock transfers do **not** directly post stock changes. Instead, they generate **stock transfer records** when actions are performed.

> **Critical:** You should **NEVER** use stock transfers as a source of truth for actual changes made. **ALWAYS** consult the stock transfer records for this.

### 5.1 Creating a Stock Transfer

Example: Moving 10 units from the default stock to the consignment stock within the Stockholm store.

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/stock-transfers" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "transfer-001" },
    "sender": { "identifiers": { "com.example.storeId": "stockholm" } },
    "receiver": { "identifiers": { "com.example.storeId": "stockholm" } },
    "senderStock": { "identifiers": { "com.example.id": "default-stock" } },
    "receiverStock": { "identifiers": { "com.example.id": "consignment-stock" } },
    "items": [
      {
        "identifiers": { "com.example.id": "transfer-item-001" },
        "product": { "identifiers": { "com.example.sku": "TSHIRT-RED-M" } },
        "quantity": 10
      }
    ]
  }'
```

The transfer starts with status `"New"`. If `senderStock` or `receiverStock` are omitted, the default stock for the respective agent is used.

You can also add items to an existing transfer after creation:

```bash
# Add another item to a transfer
curl -X POST -u ":banana" "example.app.heads.com/api/v1/stock-transfer-items" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "transfer-item-002" },
    "parent": { "identifiers": { "com.example.id": "transfer-001" } },
    "product": { "identifiers": { "com.example.sku": "TSHIRT-BLUE-L" } },
    "quantity": 5
  }'
```

### 5.2 Stock Transfer Lifecycle — Commit, Fulfill, Cancel

Stock transfers have three actions that drive the lifecycle:

| Action | What it does | Status transition |
|--------|-------------|-------------------|
| `tryCommit` | Reserves stock for the transfer. The sender's `availableQuantity` decreases (but `physicalQuantity` stays the same). | New → Committed |
| `tryFulfill` | Completes the movement. Commits first if needed, then posts the actual stock change. | New/Committed → Fulfilled |
| `tryCancel` | Releases reserved stock back to the sender. | Committed → Cancelled |

Actions are invoked via `PATCH` on the stock transfer:

```bash
# Commit: reserve stock for the transfer
curl -X PATCH -u ":banana" "example.app.heads.com/api/v1/stock-transfers/com.example.id=transfer-001" \
  -H "Content-Type: application/json" \
  -d '{ "actions": { "tryCommit": true } }'

# Fulfill: complete the stock movement (commits first if not already committed)
curl -X PATCH -u ":banana" "example.app.heads.com/api/v1/stock-transfers/com.example.id=transfer-001" \
  -H "Content-Type: application/json" \
  -d '{ "actions": { "tryFulfill": true } }'

# Cancel: release reserved stock (only works on committed transfers)
curl -X PATCH -u ":banana" "example.app.heads.com/api/v1/stock-transfers/com.example.id=transfer-001" \
  -H "Content-Type: application/json" \
  -d '{ "actions": { "tryCancel": true } }'
```

> **Tip:** `tryFulfill` is the most common action. It commits and fulfills in one step. Use `tryCommit` separately if you need a two-phase process where stock is reserved before the physical movement happens.

After fulfillment, check the transfer status:

```bash
# Verify the transfer status
curl -X GET -u ":banana" "example.app.heads.com/api/v1/stock-transfers/com.example.id=transfer-001~just(identifiers,status)"
```

Each item also has its own status array:

```bash
# Check individual item statuses
curl -X GET -u ":banana" "example.app.heads.com/api/v1/stock-transfers/com.example.id=transfer-001~with(items)"
```

### 5.3 Stock Transfer Records — The Source of Truth

Stock transfer records are the immutable audit trail of actual stock movements. Each record is created automatically when a transfer action (commit, fulfill, cancel) is performed.

```bash
# List all stock transfer records
curl -X GET -u ":banana" "example.app.heads.com/api/v1/stock-transfer-records"

# Get a specific record with items and their actions
curl -X GET -u ":banana" "example.app.heads.com/api/v1/stock-transfer-records/key=abc123~with(items~with(actions))"

# Get records for a specific transfer
curl -X GET -u ":banana" "example.app.heads.com/api/v1/stock-transfers/com.example.id=transfer-001/records~with(items~with(actions))"
```

Each record item contains an `actions` array showing what happened:

```json
{
  "@type": "stock transfer record item",
  "product": {
    "identifiers": { "com.example.sku": "TSHIRT-RED-M" },
    "name": "T-Shirt Red M"
  },
  "actions": [
    {
      "type": "Commit",
      "quantity": "10"
    },
    {
      "type": "Fulfill",
      "quantity": "10"
    }
  ]
}
```

Action types:

| Action Type | Meaning |
|-------------|---------|
| `Commit` | Stock was reserved (sender's available decreased) |
| `Fulfill` | Stock was actually moved (sender's physical decreased, receiver's increased) |
| `Cancel` | Reserved stock was released back to sender |

### 5.4 Inter-Store Transfers

Transfers between **different stores** are **not fully supported** yet. Within-store transfers (between different logical stocks at the same store) are the currently supported scenario.

If you need to move physical stock between stores today, the recommended workaround is:

1. Create a **decrease adjustment** at the sending store (reason: "Transfer Out")
2. Create an **increase adjustment** at the receiving store (reason: "Transfer In")
3. Use matching identifiers or notes to link them for audit purposes

---

## Part 6: Tracking — Serial Numbers and Batches

Products can be configured to require **tracking information**: either a serial number (unique per unit) or a batch (shared across a production run). Every inventory document carries instance data alongside quantities, though the field name varies by document type — stock adjustments use `productInstances`, stock transfers and stock count observations use `instances`, and stock count items split the data across `expectedInstances`, `countedInstances`, `overageInstances`, and `shortageInstances`. Stock transfer record item actions also expose `instances` for audit-trail visibility (read-only). Whether the field appears by default depends on the type: stock adjustment items, stock transfer items, and stock count observations include the instance field in default responses; stock count items mark the four `*Instances` arrays as non-essential and require items to be expanded to read them; stock transfer record item actions require `~with(instances)` to expand. For non-tracked products, expanded entries contain just `quantity` and auto-generated `identifiers`; `serialNumber` and `batch` are omitted, and `domain` is empty. When tracking is enabled, entries must include the specific serial numbers or batch references.

### 6.1 Configuring Tracking on Products

#### Serial number tracking

A serial number is not a property in its own right — it's a _role_ assigned to a specific instance property. For example, mobile phones use IMEI as the serial number.

```bash
# Configure a product for serial number tracking
curl -X PATCH -u ":banana" "example.app.heads.com/api/v1/products/com.example.sku=IPHONE-15-128" \
  -H "Content-Type: application/json" \
  -d '{
    "tracking": {
      "serialNumberRegistration": ["IncomingTransactions", "OutgoingTransactions", "InternalTransactions"],
      "serialNumberProperty": "MobileDevice::imei"
    }
  }'
```

- **`serialNumberRegistration`**: An array of transaction scenarios where serial numbers are required. Valid values: `"IncomingTransactions"`, `"OutgoingTransactions"`, `"InternalTransactions"`.
- **`serialNumberProperty`**: Identifies the instance property that serves as the serial number. Common values:
  - `"MobileDevice::imei"` — for mobile devices
  - `"Artifact::serialNumber"` — a general-purpose serial number

#### Batch tracking

```bash
# Configure a product for batch tracking
curl -X PATCH -u ":banana" "example.app.heads.com/api/v1/products/com.example.sku=MILK-WHOLE-1L" \
  -H "Content-Type: application/json" \
  -d '{
    "tracking": {
      "batchRegistration": ["IncomingTransactions", "OutgoingTransactions"]
    }
  }'
```

- **`batchRegistration`**: An array of transaction scenarios where batch tracking is required. Same valid values as `serialNumberRegistration`: `"IncomingTransactions"`, `"OutgoingTransactions"`, `"InternalTransactions"`.

#### Creating a batch

Before referencing a batch in stock operations, you need to create it:

```bash
# Create a batch
curl -X POST -u ":banana" "example.app.heads.com/api/v1/batches" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "batch-milk-2026-03" },
    "batchNumber": "LOT-2026-0315",
    "product": { "identifiers": { "com.example.sku": "MILK-WHOLE-1L" } },
    "productionDate": "2026-03-15",
    "expirationDate": "2026-04-15"
  }'
```

### 6.2 Stock Adjustments with Serial Numbers

For serial-number-tracked products, each adjustment item represents a single unit with its unique identifier. The `instance` field is a **single object** (not an array) containing the tracking property:

```bash
# Receive a single iPhone with IMEI tracking
curl -X POST -u ":banana" "example.app.heads.com/api/v1/stock-adjustments" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "adj-iphone-001" },
    "timestamp": "2026-03-25T12:00:00Z",
    "items": [
      {
        "product": { "identifiers": { "com.example.sku": "IPHONE-15-128" } },
        "place": { "identifiers": { "com.example.id": "stockholm-store" } },
        "reason": { "identifiers": { "com.example.id": "restock" } },
        "quantity": 1,
        "instance": { "imei": "353456789012345" }
      }
    ]
  }'
```

To receive multiple serial-numbered units, include one item per unit:

```bash
# Receive 3 iPhones, each with a unique IMEI
curl -X POST -u ":banana" "example.app.heads.com/api/v1/stock-adjustments" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "adj-iphone-batch-001" },
    "timestamp": "2026-03-25T12:00:00Z",
    "items": [
      {
        "product": { "identifiers": { "com.example.sku": "IPHONE-15-128" } },
        "place": { "identifiers": { "com.example.id": "stockholm-store" } },
        "reason": { "identifiers": { "com.example.id": "restock" } },
        "quantity": 1,
        "instance": { "imei": "353456789012345" }
      },
      {
        "product": { "identifiers": { "com.example.sku": "IPHONE-15-128" } },
        "place": { "identifiers": { "com.example.id": "stockholm-store" } },
        "reason": { "identifiers": { "com.example.id": "restock" } },
        "quantity": 1,
        "instance": { "imei": "353456789012346" }
      },
      {
        "product": { "identifiers": { "com.example.sku": "IPHONE-15-128" } },
        "place": { "identifiers": { "com.example.id": "stockholm-store" } },
        "reason": { "identifiers": { "com.example.id": "restock" } },
        "quantity": 1,
        "instance": { "imei": "353456789012347" }
      }
    ]
  }'
```

You can also use the `productInstances` field for more structured instance data:

```bash
# Using productInstances instead of instance
curl -X POST -u ":banana" "example.app.heads.com/api/v1/stock-adjustments" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "adj-iphone-002" },
    "timestamp": "2026-03-25T13:00:00Z",
    "items": [
      {
        "product": { "identifiers": { "com.example.sku": "IPHONE-15-128" } },
        "place": { "identifiers": { "com.example.id": "stockholm-store" } },
        "reason": { "identifiers": { "com.example.id": "restock" } },
        "productInstances": [
          {
            "quantity": 1,
            "serialNumber": "353456789012348",
            "domain": { "imei": "353456789012348" }
          }
        ]
      }
    ]
  }'
```

> **Note:** `instance` is the simpler, legacy field for a single tracked instance. `productInstances` is the newer, more structured field that supports multiple instances with full metadata. Both work.

### 6.3 Stock Adjustments with Batches

For batch-tracked products, reference the batch in the product instances:

```bash
# Receive 100 units of milk from a specific batch
curl -X POST -u ":banana" "example.app.heads.com/api/v1/stock-adjustments" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "adj-milk-batch-001" },
    "timestamp": "2026-03-25T08:00:00Z",
    "items": [
      {
        "product": { "identifiers": { "com.example.sku": "MILK-WHOLE-1L" } },
        "place": { "identifiers": { "com.example.id": "stockholm-store" } },
        "reason": { "identifiers": { "com.example.id": "restock" } },
        "productInstances": [
          {
            "quantity": 100,
            "batch": { "identifiers": { "com.example.id": "batch-milk-2026-03" } }
          }
        ]
      }
    ]
  }'
```

Multiple batches for the same product in one adjustment:

```bash
# Receive two batches of milk in one adjustment
curl -X POST -u ":banana" "example.app.heads.com/api/v1/stock-adjustments" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "adj-milk-multi-batch" },
    "timestamp": "2026-03-25T08:30:00Z",
    "items": [
      {
        "product": { "identifiers": { "com.example.sku": "MILK-WHOLE-1L" } },
        "place": { "identifiers": { "com.example.id": "stockholm-store" } },
        "reason": { "identifiers": { "com.example.id": "restock" } },
        "productInstances": [
          {
            "quantity": 100,
            "batch": { "identifiers": { "com.example.id": "batch-milk-2026-03" } }
          },
          {
            "quantity": 50,
            "batch": { "identifiers": { "com.example.id": "batch-milk-2026-02" } }
          }
        ]
      }
    ]
  }'
```

### 6.4 Tracking in Stock Counts

When counting tracked products, stock count items expose instance-level variance data:

```bash
# Get stock count items with instance details
curl -X GET -u ":banana" "example.app.heads.com/api/v1/stock-counts/com.example.id=count-phones~with(items)"
```

```json
{
  "@type": "stock count item",
  "product": { "identifiers": { "com.example.sku": "IPHONE-15-128" } },
  "counted": true,
  "expectedQuantity": "3",
  "countedQuantity": "3",
  "overageQuantity": "1",
  "shortageQuantity": "1",
  "expectedInstances": [
    { "serialNumber": "353456789012345", "quantity": 1 },
    { "serialNumber": "353456789012346", "quantity": 1 },
    { "serialNumber": "353456789012347", "quantity": 1 }
  ],
  "countedInstances": [
    { "serialNumber": "353456789012345", "quantity": 1 },
    { "serialNumber": "353456789012346", "quantity": 1 },
    { "serialNumber": "353456789012999", "quantity": 1 }
  ],
  "overageInstances": [
    { "serialNumber": "353456789012999", "quantity": 1 }
  ],
  "shortageInstances": [
    { "serialNumber": "353456789012347", "quantity": 1 }
  ]
}
```

In this example, the total quantity is the same (3 expected, 3 counted), but at the instance level:
- **Overage**: IMEI `...999` was found but wasn't expected
- **Shortage**: IMEI `...347` was expected but wasn't found

To record observations with tracking data:

```bash
# Count observation with serial numbers
curl -X POST -u ":banana" "example.app.heads.com/api/v1/stock-count-observations" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "obs-phones-counter1" },
    "parent": { "identifiers": { "com.example.id": "count-item-iphones" } },
    "counter": { "identifiers": { "com.example.userId": "anna" } },
    "instances": [
      { "quantity": 1, "serialNumber": "353456789012345" },
      { "quantity": 1, "serialNumber": "353456789012346" },
      { "quantity": 1, "serialNumber": "353456789012999" }
    ]
  }'
```

### 6.5 Tracking in Stock Transfers

Stock transfer items support an `instances` field for tracked products:

```bash
# Transfer a specific iPhone (by IMEI) to consignment stock
curl -X POST -u ":banana" "example.app.heads.com/api/v1/stock-transfers" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "transfer-phone-001" },
    "sender": { "identifiers": { "com.example.storeId": "stockholm" } },
    "receiver": { "identifiers": { "com.example.storeId": "stockholm" } },
    "receiverStock": { "identifiers": { "com.example.id": "display-stock" } },
    "items": [
      {
        "identifiers": { "com.example.id": "transfer-phone-item-1" },
        "product": { "identifiers": { "com.example.sku": "IPHONE-15-128" } },
        "quantity": 1,
        "instances": [
          { "quantity": 1, "serialNumber": "353456789012345" }
        ]
      }
    ]
  }'

# Fulfill the transfer
curl -X PATCH -u ":banana" "example.app.heads.com/api/v1/stock-transfers/com.example.id=transfer-phone-001" \
  -H "Content-Type: application/json" \
  -d '{ "actions": { "tryFulfill": true } }'
```

The stock transfer record will also include the instance data in its actions:

```bash
# Check the record shows which instances were transferred
curl -X GET -u ":banana" "example.app.heads.com/api/v1/stock-transfers/com.example.id=transfer-phone-001/records~with(items~with(actions))"
```

---

## Part 7: Stock Resets — Emergency Reconciliation

Stock reset is a **method endpoint** that creates offsetting adjustments across all stock places owned by an agent. Use it for:

- **Initial setup**: Zeroing out test data before going live
- **Catastrophic data issues**: When stock levels are fundamentally wrong
- **Testing**: Resetting to a clean state between test runs

```bash
# Reset ALL stock for a store (offsets excess/deficit across all stock places)
curl -X POST -u ":banana" "example.app.heads.com/api/v1/stock-reset" \
  -H "Content-Type: application/json" \
  -d '{
    "owner": { "identifiers": { "com.example.storeId": "stockholm" } }
  }'
```

> **Note:** PATCH is also accepted for this endpoint.

Response:

```json
{ "success": true }
```

```bash
# Reset stock for a specific product only
curl -X POST -u ":banana" "example.app.heads.com/api/v1/stock-reset" \
  -H "Content-Type: application/json" \
  -d '{
    "owner": { "identifiers": { "com.example.storeId": "stockholm" } },
    "product": { "identifiers": { "com.example.sku": "TSHIRT-RED-M" } }
  }'
```

> **Warning:** Stock reset does **not** delete transaction history. It creates new adjustment items with a "StockReset" reason to offset any excess or deficit. The full history (including pre-reset adjustments) remains intact.

**Stock Reset Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `owner` | agent reference | Yes | The agent whose stock is to be reset |
| `product` | product reference | No | Limit reset to a specific product; if omitted, all products are reset |

**Error responses:**

| Status | Message | Cause |
|--------|---------|-------|
| 400 | `"Missing argument: owner"` | Owner not provided |
| 400 | `"Stock owner not found"` | The specified owner doesn't exist |
| 400 | `"Product not found"` | The specified product doesn't exist |

To verify the reset worked:

```bash
# Check stock entries are now zero (or corrected)
curl -X GET -u ":banana" "example.app.heads.com/api/v1/stock-places/com.example.id=stockholm-store/entries"
```

---

## Part 8: Integration Patterns

### 8.1 Initial Stock Import

When integrating CommerceOS with an existing system, follow this sequence to set up inventory from scratch.

#### Step 1: Create stock places

```bash
# Create one stock place per store
curl -X POST -u ":banana" "example.app.heads.com/api/v1/stock-places" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "store-stockholm" },
    "name": "Stockholm Store"
  }'

curl -X POST -u ":banana" "example.app.heads.com/api/v1/stock-places" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "store-gothenburg" },
    "name": "Gothenburg Store"
  }'
```

#### Step 2: Assign to stores via stockRoots

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/stores/com.example.storeId=stockholm/stockRoots" \
  -H "Content-Type: application/json" \
  -d '{ "identifiers": { "com.example.id": "store-stockholm" } }'

curl -X POST -u ":banana" "example.app.heads.com/api/v1/stores/com.example.storeId=gothenburg/stockRoots" \
  -H "Content-Type: application/json" \
  -d '{ "identifiers": { "com.example.id": "store-gothenburg" } }'
```

#### Step 3: Create adjustment reasons

```bash
# At minimum, create an "Initial Import" increase reason
curl -X POST -u ":banana" "example.app.heads.com/api/v1/stock-adjustment-reasons" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "initial-import" },
    "name": "Initial Import",
    "active": true,
    "direction": "Increase"
  }'
```

#### Step 4: Create stock adjustments for initial quantities

```bash
# Import initial stock for the Stockholm store
curl -X POST -u ":banana" "example.app.heads.com/api/v1/stock-adjustments" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "initial-import-stockholm" },
    "timestamp": "2026-03-25T00:00:00Z",
    "items": [
      {
        "product": { "identifiers": { "com.example.sku": "TSHIRT-RED-M" } },
        "place": { "identifiers": { "com.example.id": "store-stockholm" } },
        "reason": { "identifiers": { "com.example.id": "initial-import" } },
        "quantity": 150
      },
      {
        "product": { "identifiers": { "com.example.sku": "TSHIRT-BLUE-L" } },
        "place": { "identifiers": { "com.example.id": "store-stockholm" } },
        "reason": { "identifiers": { "com.example.id": "initial-import" } },
        "quantity": 80
      },
      {
        "product": { "identifiers": { "com.example.sku": "JEANS-BLACK-32" } },
        "place": { "identifiers": { "com.example.id": "store-stockholm" } },
        "reason": { "identifiers": { "com.example.id": "initial-import" } },
        "quantity": 45
      }
    ]
  }'
```

#### Step 5: Verify with stock entries

```bash
# Confirm the imported quantities
curl -X GET -u ":banana" "example.app.heads.com/api/v1/stock-places/com.example.id=store-stockholm/entries"
```

### 8.2 Ongoing Inventory Sync

For keeping stock in sync with an external WMS (Warehouse Management System):

#### Pattern: Delta-based sync

The recommended approach is to compute deltas in your integration layer and create adjustments for the differences:

```bash
# Your integration detects that 10 units were received in the WMS
# Create an increase adjustment to match
curl -X POST -u ":banana" "example.app.heads.com/api/v1/stock-adjustments" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "wms-sync-20260325-001" },
    "timestamp": "2026-03-25T15:30:00Z",
    "items": [
      {
        "product": { "identifiers": { "com.example.sku": "TSHIRT-RED-M" } },
        "place": { "identifiers": { "com.example.id": "store-stockholm" } },
        "reason": { "identifiers": { "com.example.id": "restock" } },
        "quantity": 10
      }
    ]
  }'
```

Use **unique, deterministic identifiers** (e.g., based on the WMS event ID) to prevent duplicate adjustments if the sync retries:

```bash
# Idempotent: same identifier = same adjustment, won't duplicate
"identifiers": { "com.example.wmsEventId": "WMS-EVT-12345" }
```

#### Reading adjustment history for reconciliation

```bash
# Get all adjustments for a stock place to reconcile
curl -X GET -u ":banana" "example.app.heads.com/api/v1/stock-places/com.example.id=store-stockholm/transactions~with(items)"

# Get individual adjustment items for detailed reconciliation
curl -X GET -u ":banana" "example.app.heads.com/api/v1/stock-places/com.example.id=store-stockholm/transactionItems"
```

### 8.3 Reading Current Stock for E-Commerce

The most common integration pattern: querying available stock for display on an online store.

#### Single product lookup

```bash
# Get stock levels for a single product across all locations
curl -X GET -u ":banana" "example.app.heads.com/api/v1/products/com.example.sku=TSHIRT-RED-M/stockLevels"
```

Response:

```json
[
  {
    "location": {
      "@type": "store",
      "identifiers": { "com.example.storeId": "stockholm" },
      "name": "Stockholm Store"
    },
    "totalQuantity": "150",
    "reservedQuantity": "10",
    "availableQuantity": "140"
  }
]
```

For e-commerce display, use `availableQuantity` — it reflects the actual sellable stock (total minus reserved).

#### Per-location lookup

```bash
# Get all stock at a specific location
curl -X GET -u ":banana" "example.app.heads.com/api/v1/stock-places/com.example.id=store-stockholm/entries"
```

#### Designated stock places

Products can have designated stock places — the locations where they're intended or expected to be stocked:

```bash
# Get a product's designated stock places
curl -X GET -u ":banana" "example.app.heads.com/api/v1/products/com.example.sku=TSHIRT-RED-M/designatedStockPlaces"
```

---

## Part 9: Field Reference (Quick Reference Tables)

### Stock

| Field | Type | Required on Create | Read-Only | Description |
|-------|------|--------------------|-----------|-------------|
| `identifiers` | common identifiers | Yes | No | External identifiers |
| `name` | string | Yes | No | Name of the stock (e.g., "Default Stock") |
| `default` | boolean | — | Yes | Whether this is the owner's default stock |

### Stock Place

Inherits from `place` (has `name`, `parent`, `children`).

| Field | Type | Required on Create | Read-Only | Description |
|-------|------|--------------------|-----------|-------------|
| `owner` | agent reference | No | No (computed) | Owner; derived from `stockRoots` |
| `entries` | stock entry[] | — | No | Current stock levels at this location |
| `transactions` | stock adjustment[] | — | No | Adjustments that affected this place |
| `transactionItems` | stock adjustment item[] | — | No | Individual adjustment items for this place |

### Stock Entry

| Field | Type | Description |
|-------|------|-------------|
| `product` | product reference | The product |
| `physicalQuantity` | decimal | Total physical stock at this location |
| `availableQuantity` | decimal | Available stock (physical minus reserved) |

### Stock Adjustment

Inherits from `stock transaction` (has `timestamp`, `owner`).

| Field | Type | Required on Create | Read-Only | Description |
|-------|------|--------------------|-----------|-------------|
| `identifiers` | stock adjustment identifiers | No | No | External identifiers; also supports `transactionId` |
| `transactionId` | string | — | Yes | System-generated unique transaction ID |
| `timestamp` | date-time | Yes | Write-once | When the adjustment occurred; required at creation, immutable after |
| `owner` | agent reference | No | No | Auto-inferred from place if omitted |
| `stock` | stock reference | No | No | Logical stock; defaults to owner's default stock |
| `items` | stock adjustment item[] | Yes | No | Items being adjusted |

### Stock Adjustment Item

| Field | Type | Required on Create | Read-Only | Description |
|-------|------|--------------------|-----------|-------------|
| `identifiers` | common identifiers | No | No | External identifiers |
| `product` | product reference | Yes | No | The product being adjusted |
| `place` | place reference | Yes | No | The stock place being adjusted |
| `reason` | stock adjustment reason reference | Yes | No | Reason code (determines direction) |
| `quantity` | decimal | No (default: 1) | No | Magnitude of the change (always positive) |
| `instance` | dynamic | No | No | Single instance data for tracked products |
| `productInstances` | product instance[] | No | No | Structured instance data |

### Stock Adjustment Reason

| Field | Type | Required on Create | Read-Only | Description |
|-------|------|--------------------|-----------|-------------|
| `identifiers` | common identifiers | No | No | External identifiers |
| `name` | string | No | No | Human-readable name |
| `active` | boolean | No | No | Whether the reason is currently usable |
| `direction` | `"Increase"` or `"Decrease"` | No | No | Adjustment direction |

### Stock Count

| Field | Type | Required on Create | Read-Only | Description |
|-------|------|--------------------|-----------|-------------|
| `identifiers` | common identifiers | Yes | No | External identifiers |
| `id` | string | — | Yes | System-generated ID |
| `owner` | agent reference | Yes | No | Store being counted |
| `stock` | stock reference | No | No | Logical stock being counted |
| `status` | string[] | — | Yes | Current status: New, Ongoing, Completed, Approved |
| `items` | stock count item[] | Yes | No | Items to count |
| `records` | stock count record[] | — | No | Generated records after approval |

### Stock Count Item

| Field | Type | Required on Create | Read-Only | Description |
|-------|------|--------------------|-----------|-------------|
| `identifiers` | common identifiers | No | No | External identifiers |
| `product` | product reference | Yes | No | Product being counted |
| `place` | place reference | Yes | No | Location being counted |
| `counted` | boolean | — | Yes | Whether observations exist (computed) |
| `expectedQuantity` | decimal | — | Yes | System stock at first count (snapshot, computed) |
| `countedQuantity` | decimal | — | Yes | Total from observations (computed) |
| `overageQuantity` | decimal | — | Yes | Positive variance (computed) |
| `shortageQuantity` | decimal | — | Yes | Negative variance (computed) |
| `expectedInstances` | product instance[] | — | Yes | Expected tracked instances (computed) |
| `countedInstances` | product instance[] | — | No | Counted tracked instances |
| `overageInstances` | product instance[] | — | Yes | Unexpected instances found (computed) |
| `shortageInstances` | product instance[] | — | Yes | Expected instances not found (computed) |
| `observations` | stock count observation[] | — | No | Individual counts by staff |

### Stock Count Observation

| Field | Type | Required on Create | Read-Only | Description |
|-------|------|--------------------|-----------|-------------|
| `identifiers` | common identifiers | No | No | External identifiers |
| `counter` | agent reference | No | No | Who made the observation |
| `quantity` | decimal | — | Yes | Computed from instances |
| `instances` | product instance[] | No | No | Observed product instances |

### Stock Count Record

| Field | Type | Read-Only | Description |
|-------|------|-----------|-------------|
| `identifiers` | common identifiers | No | External identifiers |
| `timestamp` | date-time | Yes | When the record was created |
| `owner` | agent reference | No | Store that was counted |
| `stock` | stock reference | No | Logical stock that was counted |
| `items` | stock count record item[] | No | Posted adjustment items |

### Stock Count Record Item

| Field | Type | Read-Only | Description |
|-------|------|-----------|-------------|
| `identifiers` | common identifiers | No | External identifiers |
| `product` | product reference | No | Product adjusted |
| `place` | place reference | No | Location adjusted |
| `increaseQuantity` | decimal | Yes | Amount added |
| `decreaseQuantity` | decimal | Yes | Amount removed |
| `increaseInstances` | product instance[] | No | Specific instances added |
| `decreaseInstances` | product instance[] | No | Specific instances removed |

### Stock Transfer

| Field | Type | Required on Create | Read-Only | Description |
|-------|------|--------------------|-----------|-------------|
| `identifiers` | common identifiers | Yes | No | External identifiers |
| `id` | string | — | Yes | System-generated ID |
| `sender` | agent reference | Yes | No | Sending agent |
| `receiver` | agent reference | Yes | No | Receiving agent |
| `senderStock` | stock reference | No | No | Source stock (defaults to sender's default) |
| `receiverStock` | stock reference | No | No | Destination stock (defaults to receiver's default) |
| `status` | string[] | — | Yes | Current statuses |
| `items` | stock transfer item[] | Yes | No | Items being transferred |
| `records` | stock transfer record[] | — | No | Generated records |
| `actions` | stock transfer actions | No | No | Lifecycle actions |

### Stock Transfer Item

| Field | Type | Required on Create | Read-Only | Description |
|-------|------|--------------------|-----------|-------------|
| `identifiers` | common identifiers | No | No | External identifiers |
| `product` | product reference | Yes | No | Product being transferred |
| `quantity` | decimal | No | No | Quantity to transfer |
| `status` | string[] | — | Yes | Item-level statuses |
| `instances` | assigned product instances | No | No | Tracked instances being transferred |

### Stock Transfer Actions

| Field | Type | Description |
|-------|------|-------------|
| `tryCommit` | boolean (setter only) | Reserves stock for the transfer |
| `tryFulfill` | boolean (setter only) | Completes the movement (commits first if needed) |
| `tryCancel` | boolean (setter only) | Releases reserved stock |

### Stock Transfer Record

| Field | Type | Read-Only | Description |
|-------|------|-----------|-------------|
| `identifiers` | common identifiers | No | External identifiers |
| `timestamp` | date-time | Yes | When the record was created |
| `sender` | agent reference | No | Sending agent |
| `receiver` | agent reference | No | Receiving agent |
| `senderStock` | stock reference | No | Source logical stock |
| `receiverStock` | stock reference | No | Destination logical stock |
| `items` | stock transfer record item[] | No | Record items |

### Stock Transfer Record Item

| Field | Type | Read-Only | Description |
|-------|------|-----------|-------------|
| `identifiers` | common identifiers | No | External identifiers |
| `product` | product reference | No | Product transferred |
| `actions` | stock transfer record item action[] | No | Recorded actions |

### Stock Transfer Record Item Action

| Field | Type | Read-Only | Description |
|-------|------|-----------|-------------|
| `type` | `"Commit"`, `"Fulfill"`, or `"Cancel"` | No | Action type |
| `quantity` | decimal | Yes | Quantity affected |
| `instances` | product instance[] | No | Tracked instances affected |

### Product Stock Fields

| Field | Type | Description |
|-------|------|-------------|
| `stockLevels` | stock level assignment[] | Stock levels across locations |
| `designatedStockPlaces` | place[] | Locations where product should be stocked |
| `tracking.serialNumberRegistration` | string[] | Transaction scenarios requiring serial numbers: `"IncomingTransactions"`, `"OutgoingTransactions"`, `"InternalTransactions"` |
| `tracking.serialNumberProperty` | string | Instance property for serial number (e.g., `"MobileDevice::imei"`) |
| `tracking.batchRegistration` | string[] | Transaction scenarios requiring batch tracking: `"IncomingTransactions"`, `"OutgoingTransactions"`, `"InternalTransactions"` |

### Stock Level Assignment (on product)

| Field | Type | Description |
|-------|------|-------------|
| `location` | agent reference | The store/location |
| `totalQuantity` | decimal | Total stock at this location |
| `reservedQuantity` | decimal | Reserved by pending transfers |
| `availableQuantity` | decimal | Total minus reserved |

### Product Instance

| Field | Type | Description |
|-------|------|-------------|
| `identifiers` | common identifiers | External identifiers |
| `quantity` | decimal | Quantity of this instance |
| `serialNumber` | string | Serial number (if tracked) |
| `batch` | batch reference | Production batch (if tracked) |
| `domain` | dynamic | Type-specific properties (e.g., `{ "imei": "..." }`) |
| `product` | product reference (read-only) | The product this is an instance of |

### Batch

| Field | Type | Required on Create | Description |
|-------|------|--------------------|-------------|
| `identifiers` | common identifiers | No | External identifiers |
| `batchNumber` | string | Yes | Batch/lot number (e.g., "LOT-12345") |
| `product` | product reference | No | Associated product |
| `manufacturer` | agent reference | No | Manufacturer, if known |
| `productionDate` | string (ISO 8601) | No | Production date |
| `expirationDate` | string (ISO 8601) | No | Expiration date |

---

## Part 10: Pitfalls and Gotchas

- **Stock counts are NOT the source of truth.** Stock counts are working documents. When you need to know what actually changed, always consult the **stock count records**. Stock counts represent the counting _process_; stock count records represent the _posted adjustments_.

- **Stock transfers are NOT the source of truth.** Same principle. Stock transfers represent the transfer _request_; stock transfer records represent the _actual posted movement_. Always use stock transfer records for authoritative change data.

- **`owner` on stock places is computed.** It's derived from `stockRoots`, not stored directly. Use `POST /v1/stores/{id}/stockRoots` to establish ownership. Setting `owner` on the stock place is a shorthand that manipulates `stockRoots` behind the scenes.

- **`parent` setter on stock places requires the database key.** You cannot use external identifiers (like `com.example.id`) when setting a stock place's `parent`. You must first fetch the parent's database key via `/identifiers/key`, then use `{ "identifiers": { "key": "..." } }`.

- **`instance` is a single object, not an array.** For tracked products in stock adjustments, the `instance` field is a single dynamic object (e.g., `{ "imei": "..." }`). For multiple instances, use `productInstances` (an array).

- **Stock reset doesn't delete transactions.** It creates new offsetting adjustment items with a "StockReset" reason. The full history — including all pre-reset adjustments — remains intact and queryable.

- **Adjustment `quantity` is always positive.** The direction (increase or decrease) is determined by the reason's `direction` field, not by the sign of the quantity.

- **`stockRoots` vs `assortmentRoots` are different things.** `stockRoots` = inventory locations (stock places). `assortmentRoots` = product catalog (product nodes/categories). Confusing them is a common mistake.

- **Multi-stock-place in a single store is not fully supported.** Create exactly one stock place per store for now and designate it as the sole `stockRoot`.

- **Inter-store stock transfers are not fully supported.** Within-store transfers (between logical stocks at the same agent) work. For inter-store movement, use paired adjustments (decrease at source, increase at destination).

- **`expectedQuantity` on stock count items is a snapshot.** It's captured at the time of the first observation, not updated live. Subsequent stock movements won't change it.

- **Even with matching quantities, instance-level variances can exist.** A stock count item might show `expectedQuantity: 3` and `countedQuantity: 3`, but still have shortage and overage instances if different serial numbers were found.

---

## Part 11: API Endpoint Reference

| Endpoint | Methods | Description |
|----------|---------|-------------|
| `/v1/stocks` | GET, POST, PATCH | Logical stock containers (`stock:write` scope only) |
| `/v1/stock-places` | GET, POST, PATCH | Physical locations |
| `/v1/stock-places/{id}/entries` | GET | Current stock levels at a location |
| `/v1/stock-places/{id}/transactions` | GET | Adjustments affecting a location |
| `/v1/stock-places/{id}/transactionItems` | GET | Individual adjustment items for a location |
| `/v1/stock-adjustments` | GET, POST, PATCH | Inventory corrections |
| `/v1/stock-adjustment-items` | GET, POST | Individual adjustment items |
| `/v1/stock-adjustment-reasons` | GET, POST, PATCH | Reason codes for adjustments |
| `/v1/stock-counts` | GET, POST, PATCH | Physical inventory counts |
| `/v1/stock-count-items` | GET, POST, PATCH | Individual items within a count |
| `/v1/stock-count-observations` | GET, POST | Count observations by staff |
| `/v1/stock-count-records` | GET | Immutable count audit trail (read-only) |
| `/v1/stock-counts/{id}/records` | GET | Records for a specific count |
| `/v1/stock-transfers` | GET, POST, PATCH | Stock movements between logical stocks |
| `/v1/stock-transfer-items` | GET, POST, PATCH | Individual transfer items |
| `/v1/stock-transfer-records` | GET | Immutable transfer audit trail (read-only) |
| `/v1/stock-transfers/{id}/records` | GET | Records for a specific transfer |
| `/v1/stock-transfer-record-items` | GET | Transfer record items |
| `/v1/stock-transactions` | GET | All stock transactions (read-only wrapper) |
| `/v1/stock-reset` | POST | Emergency reconciliation (PATCH also accepted) |
| `/v1/products/{id}/stockLevels` | GET | Stock levels per product across locations |
| `/v1/products/{id}/designatedStockPlaces` | GET | Where a product should be stocked |
| `/v1/batches` | GET, POST, PATCH | Production batches for batch tracking |
