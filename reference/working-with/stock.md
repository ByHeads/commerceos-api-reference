# Working with Stock and Shipments

This guide covers inventory management in CommerceOS: stock places, stock entries, adjustments, reservations, shipments, and the complete inventory lifecycle from receiving to fulfillment.

---

## Table of Contents

1. [Overview](#overview)
2. [Glossary](#glossary)
3. [Stock Place Hierarchy](#stock-place-hierarchy)
4. [Field Reference](#field-reference)
5. [Creating Stock Places](#creating-stock-places)
6. [Stock Entries](#stock-entries)
7. [Stock Adjustments](#stock-adjustments)
8. [Stock Reservations](#stock-reservations)
9. [Stock Reset](#stock-reset)
10. [Agent Stock Roots](#agent-stock-roots)
11. [Shipment Orders](#shipment-orders)
12. [Shipment Lifecycle](#shipment-lifecycle)
13. [Delivery Terms](#delivery-terms)
14. [Endpoint Matrix](#endpoint-matrix)
15. [Finder and Indexing Patterns](#finder-and-indexing-patterns)
16. [Error Handling and Validation](#error-handling-and-validation)
17. [Integration Playbook](#integration-playbook)
18. [Case Study: Warehouse-to-Customer Fulfillment](#case-study-warehouse-to-customer-fulfillment)
19. [Business Rules and Pitfalls](#business-rules-and-pitfalls)
20. [Related Guides](#related-guides)

---

## Overview

Stock management in CommerceOS uses hierarchical stock places to track inventory across physical and logical locations. The system maintains real-time visibility into:

- **Physical quantity:** Total units at a location
- **Available quantity:** Units available for sale (owner-level availability; equals physical minus reserved only for single-root owners)
- **Reserved quantity:** Units held for pending orders

```
Stock Place (warehouse, stockroom, shelf)
  ├── entries (current stock levels by product)
  ├── transactions (adjustment history)
  └── children (nested locations)
```

**Key characteristics:**

- Stock places can be nested (warehouse → zone → shelf)
- Entries track physical and available quantities at a location
- Adjustments record changes with reasons for audit trail
- Reservations hold stock for pending orders
- Shipments track order fulfillment and delivery
- All stock changes are auditable via transactions

**Stock flow overview:**

```
Receiving          In-Stock            Reserved           Shipped
┌─────────┐      ┌─────────┐        ┌─────────┐       ┌─────────┐
│ Adjust  │ ───► │ Physical│ ─────► │ Order   │ ────► │ Shipment│
│ (+qty)  │      │ Stock   │        │ Reserve │       │ Release │
└─────────┘      └─────────┘        └─────────┘       └─────────┘
                      │
                      ▼
               ┌─────────────┐
               │  Available  │
               │  = Phys-Res │
               └─────────────┘
```

---

## Glossary

| Term | Definition |
|------|------------|
| **Stock Place** | A physical or logical storage location (warehouse, zone, shelf) |
| **Stock Entry** | Current inventory level for a product at a specific location |
| **Physical Quantity** | Total units present at a location |
| **Available Quantity** | Units available for sale (owner-level availability; equals physical minus reserved only for single-root owners) |
| **Reserved Quantity** | Units held for pending orders |
| **Stock Adjustment** | A transaction recording inventory changes with reasons |
| **Adjustment Reason** | Categorization of why inventory changed (received, damaged, etc.) |
| **Stock Root** | Primary stock location(s) exposed by an agent |
| **Shipment Order** | Record of product delivery from source to destination |
| **Carrier** | Transport service provider |
| **Incoterm** | International shipping terms defining responsibility transfer |

---

## Stock Place Ownership Model

### How `owner` Works

The `owner` field on a stock place is a **computed property**, not a stored field. It is derived from `StockOwner.forNearestRoot(place)` — the system finds the agent whose `stockRoots` collection includes this place or one of its parents.

**When you set `owner` on a stock place:**
- The system removes the place from the old owner's `stockRoots` (if any)
- The system adds the place to the new owner's `stockRoots`

The canonical relationship is: **`agent.stockRoots → stock place`**, not `stock place.owner → agent`.

### Recommended Setup Flow

1. **Create stock place(s)** without specifying an owner
2. **Add to agent's stockRoots** via `POST /v1/companies/{id}/stockRoots` or `POST /v1/stores/{id}/stockRoots`
3. **Create adjustment reasons** for tracking why inventory changes
4. **Create stock adjustments** to record inventory changes

```bash
# Step 1: Create stock place (owner is optional)
POST /v1/stock-places
{
  "identifiers": {"com.example.stockPlaceId": "WH-001"},
  "name": "Main Warehouse"
}

# Step 2: Add to agent's stockRoots (preferred approach)
POST /v1/companies/com.example.companyId=OUR-COMPANY/stockRoots
{"identifiers": {"com.example.stockPlaceId": "WH-001"}}
```

**Alternative (shorthand):** Set `owner` directly on the stock place — this manipulates `stockRoots` behind the scenes:

```bash
POST /v1/stock-places
{
  "identifiers": {"com.example.stockPlaceId": "WH-001"},
  "name": "Main Warehouse",
  "owner": {"identifiers": {"com.example.companyId": "OUR-COMPANY"}}
}
```

### stockRoots vs assortmentRoots

These are separate agent members that are often confused:

| Member | Purpose | What it contains |
|--------|---------|------------------|
| `stockRoots` | Defines where an agent's **inventory** is managed (for stock adjustments/entries) | Stock places (warehouses, stockrooms) |
| `assortmentRoots` | Defines an agent's **product catalog/assortment** | Product nodes (categories, groups) |

- Use `stockRoots` for stock adjustments and inventory tracking
- Use `assortmentRoots` for product assortment and catalog visibility
- They are managed independently and serve different purposes

---

## Stock Place Hierarchy

Stock places form a hierarchy enabling granular inventory tracking:

```
Company Stock Roots
├── Warehouse-Central
│   ├── Zone-A (Electronics)
│   │   ├── Shelf-A1
│   │   ├── Shelf-A2
│   │   └── Shelf-A3
│   ├── Zone-B (Accessories)
│   │   ├── Shelf-B1
│   │   └── Shelf-B2
│   └── Receiving-Dock
├── Store-North
│   ├── Backroom
│   └── Sales-Floor
└── Store-South
    ├── Backroom
    └── Sales-Floor
```

### Hierarchy Benefits

| Feature | Description |
|---------|-------------|
| **Granular Tracking** | Track down to shelf/bin level |
| **Location Transfers** | Move between sibling locations |
| **Multi-Site** | Manage multiple warehouses/stores |

> **Note:** Stock entries are stored at the specific stock place where adjustments occur. Querying a parent stock place does not automatically aggregate quantities from children; you must query each child location individually or build aggregation logic in your integration.

---

## Field Reference

### Stock Place Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `identifiers` | object | Yes | Namespaced identifiers |
| `name` | string | Yes | Location display name |
| `owner` | AgentRef | No | Agent owning the stock place (**computed**, not stored; see note below) |
| `parent` | StockPlaceRef | No | Parent location in hierarchy |

> **Note:** Stock places can be created without an `owner`. The `owner` field is a **computed property** derived from `StockOwner.forNearestRoot(place)` — it finds the agent whose `stockRoots` includes this place or a parent.
>
> **Setting `owner`:** When you set `owner` on a stock place, the system manipulates the agent's `stockRoots` collection (removes from old owner, adds to new owner). The canonical relationship is `agent.stockRoots → stock place`.
>
> **Preferred approach:** Create the stock place without `owner`, then add it to the agent's `stockRoots` via `POST /v1/companies/{id}/stockRoots` or `POST /v1/stores/{id}/stockRoots`.
>
> **Stock adjustments:** Adjustments can omit `owner` if it can be inferred from the place's stock root. Adjustments against an unowned place (or a place without a stock-root path) fail with "Cannot update stock for an unowned stock place".

### Stock Place Fields (Expandable)

| Field | Type | Description |
|-------|------|-------------|
| `children` | StockPlace[] | Nested sub-locations (read-only) |
| `entries` | StockEntry[] | Current stock levels; update physical/available to adjust stock |
| `transactions` | Transaction[] | Adjustment history (read-only) |
| `effectiveAddress` | Address | Computed address from hierarchy (read-only) |

### Stock Entry Fields

| Field | Type | Description |
|-------|------|-------------|
| `product` | ProductRef | Product reference |
| `physicalQuantity` | decimal | Total units at this specific location |
| `availableQuantity` | decimal | Units available for sale (**owner-level**, not per-location) |

> **Important:** On `/v1/stock-places/{id}/entries`, `availableQuantity` is computed at the **owner level** (aggregate across all stock roots owned by the agent), not per stock place. When an owner has multiple stock places, `physicalQuantity` reflects the specific location while `availableQuantity` reflects the owner's total availability for that product.
>
> Reserved quantity is not returned directly; deriving it as `physicalQuantity - availableQuantity` is only meaningful for single-root owners (or when you explicitly aggregate across all roots yourself).

### Stock Adjustment Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `identifiers` | object | No | Optional adjustment identifier |
| `timestamp` | datetime | Yes | When adjustment occurred |
| `owner` | AgentRef | No | Agent owning the stock (inferred from stock place stock root if omitted; fails for unowned places) |
| `items` | AdjustmentItem[] | Yes | Items being adjusted |

### Adjustment Item Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `product` | ProductRef | Yes | Product being adjusted |
| `place` | StockPlaceRef | Yes | Location of adjustment |
| `reason` | ReasonRef | Yes | Why inventory changed |
| `quantity` | decimal (string) | No | Amount to adjust; defaults to `"1"`. The direction (increase/decrease) is determined by the reason's `direction` field |
| `instance` | Instance | No | Specific serialized instance |

> **Note:** If `owner` is omitted from the adjustment, it is inferred from the stock place's nearest stock root. Errors occur when the owner cannot be inferred (for example, the place is unowned and not under a stock root).

### Adjustment Reason Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `identifiers` | object | Yes | Namespaced identifier |
| `name` | string | Yes | Display name |
| `active` | boolean | No | Whether reason is in use |
| `direction` | string | No | Default: `Increase` or `Decrease` |

### Shipment Order Fields

Shipment orders can be created directly via `POST /v1/shipment-orders` or via the trade order `createShipment` action. The following fields are exposed:

| Field | Type | Description |
|-------|------|-------------|
| `identifiers` | object | Namespaced identifiers |
| `sender` | AgentRef | Shipping agent (read-only after creation) |
| `receiver` | AgentRef | Receiving agent (read-only after creation) |
| `source` | StockPlaceRef | Origin location (read-only after creation) |
| `destination` | StockPlaceRef | Delivery stock place (read-only after creation) |
| `orders` | OrderRef[] | Assigned trade orders (read-only) |
| `items` | ShipmentItem[] | Items being shipped |
| `carrier` | AgentRef | Transport carrier (read-only after creation) |
| `status` | string[] | Current status array: `["New"]`, `["Released"]`, `["Transiting"]`, `["Acquired"]`, or `["Partially..."]` |
| `records` | Record[] | Event log (read-only) |
| `carriersTrackingUrl` | string | Carrier tracking URL (read-only) |

> **Note:** `status` is an **array**, not a string. Single values are returned as `["New"]`, `["Released"]`, etc. Mixed statuses (e.g., when items have different states) produce summary values like `["PartiallyReleased"]`.

---

## Creating Stock Places

### Recommended Approach (Preferred)

Create the stock place without owner, then add it to the agent's `stockRoots`:

```bash
# Step 1: Create stock place (no owner)
POST /v1/stock-places
{
  "identifiers": {"com.example.stockPlaceId": "WAREHOUSE-001"},
  "name": "Main Warehouse"
}

# Step 2: Add to agent's stockRoots (establishes ownership)
POST /v1/companies/com.example.companyId=OUR-COMPANY/stockRoots
{"identifiers": {"com.example.stockPlaceId": "WAREHOUSE-001"}}
```

### Alternative: Owner Shorthand

You can set `owner` directly on the stock place — this is shorthand that manipulates the agent's `stockRoots` behind the scenes:

```bash
POST /v1/stock-places
{
  "identifiers": {"com.example.stockPlaceId": "WAREHOUSE-001"},
  "name": "Main Warehouse",
  "owner": {"identifiers": {"com.example.companyId": "OUR-COMPANY"}}
}
```

> **Note:** While setting `owner` directly works, it hides the true relationship. The canonical path is `agent.stockRoots → stock place`.

### Idempotent Creation (PUT)

```bash
PUT /v1/stock-places/com.example.stockPlaceId=WAREHOUSE-001
{
  "name": "Main Warehouse"
}

# Then add to stockRoots
POST /v1/companies/com.example.companyId=OUR-COMPANY/stockRoots
{"identifiers": {"com.example.stockPlaceId": "WAREHOUSE-001"}}
```

### Hierarchical Stock Places

Create parent first, then children. Add the root to `stockRoots` — children inherit ownership through the hierarchy:

```bash
# 1. Create warehouse (root) — no owner needed
POST /v1/stock-places
{
  "identifiers": {"com.example.stockPlaceId": "WAREHOUSE-001"},
  "name": "Central Warehouse"
}

# 2. Add root to agent's stockRoots (establishes ownership for entire subtree)
POST /v1/companies/com.example.companyId=OUR-COMPANY/stockRoots
{"identifiers": {"com.example.stockPlaceId": "WAREHOUSE-001"}}

# 3. Create zone within warehouse (inherits ownership from parent's stock root)
POST /v1/stock-places
{
  "identifiers": {"com.example.stockPlaceId": "WAREHOUSE-001-ZONE-A"},
  "name": "Zone A - Electronics",
  "parent": {"identifiers": {"com.example.stockPlaceId": "WAREHOUSE-001"}}
}

# 4. Create shelf within zone (also inherits ownership)
POST /v1/stock-places
{
  "identifiers": {"com.example.stockPlaceId": "WAREHOUSE-001-ZONE-A-SHELF-01"},
  "name": "Shelf A-01",
  "parent": {"identifiers": {"com.example.stockPlaceId": "WAREHOUSE-001-ZONE-A"}}
}
```

> **Note:** When you add a parent stock place to an agent's `stockRoots`, all child places inherit ownership via `StockOwner.forNearestRoot()`. You don't need to set `owner` on each child — the system walks up the parent chain to find the nearest stock root.

### Store Stock Locations

```bash
# 1. Create store root stock place
POST /v1/stock-places
{
  "identifiers": {"com.example.stockPlaceId": "STORE-NORTH-MAIN"},
  "name": "Store North"
}

# 2. Add root to store's stockRoots
POST /v1/stores/com.example.storeId=STORE-NORTH/stockRoots
{"identifiers": {"com.example.stockPlaceId": "STORE-NORTH-MAIN"}}

# 3. Create child locations (inherit ownership from parent's stock root)
POST /v1/stock-places
{
  "identifiers": {"com.example.stockPlaceId": "STORE-NORTH-BACKROOM"},
  "name": "Backroom",
  "parent": {"identifiers": {"com.example.stockPlaceId": "STORE-NORTH-MAIN"}}
}

POST /v1/stock-places
{
  "identifiers": {"com.example.stockPlaceId": "STORE-NORTH-SALESFLOOR"},
  "name": "Sales Floor",
  "parent": {"identifiers": {"com.example.stockPlaceId": "STORE-NORTH-MAIN"}}
}
```

### Querying Stock Places

```bash
# List all stock places
GET /v1/stock-places~take(50)

# Get with children
GET /v1/stock-places/com.example.stockPlaceId=WAREHOUSE-001~with(children)

# Get with entries
GET /v1/stock-places/com.example.stockPlaceId=WAREHOUSE-001~with(entries)

# Get full hierarchy
GET /v1/stock-places/com.example.stockPlaceId=WAREHOUSE-001~withAll
```

---

## Stock Entries

Stock entries represent current inventory levels per product at each location.

### Entry Structure

```json
{
  "product": {
    "@type": "product",
    "identifiers": {"com.example.sku": "PHONE-001"}
  },
  "physicalQuantity": 100,
  "availableQuantity": 95
}
```

### Quantity Relationships

```
physicalQuantity: 100  # What's physically there
availableQuantity: 95  # Can be sold

# Reserved quantity is not returned directly; derive it as:
reservedQuantity = physicalQuantity - availableQuantity  # meaningful only for single-root owners
```

### Reading Stock Levels

```bash
# Stock entries at a location
GET /v1/stock-places/com.example.stockPlaceId=WAREHOUSE-001/entries

# Response
[
  {
    "product": {"@type": "product", "identifiers": {"com.example.sku": "PHONE-001"}},
    "physicalQuantity": 100,
    "availableQuantity": 95
  },
  {
    "product": {"@type": "product", "identifiers": {"com.example.sku": "CASE-001"}},
    "physicalQuantity": 250,
    "availableQuantity": 250
  }
]
```

### Product Stock Across Locations

The `stockLevels` projection on products returns stock aggregated by agent (store or company), not by stock place.

```bash
# Get product with stock levels
GET /v1/products/com.example.sku=PHONE-001~with(stockLevels)

# Response
{
  "identifiers": {"com.example.sku": "PHONE-001"},
  "name": "Smartphone X",
  "stockLevels": [
    {
      "location": {"@type": "store", "identifiers": {"com.example.storeId": "STORE-NORTH"}},
      "totalQuantity": 20,
      "availableQuantity": 18
    },
    {
      "location": {"@type": "store", "identifiers": {"com.example.storeId": "STORE-SOUTH"}},
      "totalQuantity": 15,
      "availableQuantity": 15
    },
    {
      "location": {"@type": "company", "identifiers": {"com.example.companyId": "OUR-COMPANY"}},
      "totalQuantity": 100,
      "availableQuantity": 95
    }
  ]
}
```

### Filtering Entries

```bash
# Entries for specific product
GET /v1/stock-places/com.example.stockPlaceId=WAREHOUSE-001/entries~where(product.identifiers.com.example.sku=PHONE-001)

# Low stock entries (if supported)
GET /v1/stock-places/com.example.stockPlaceId=WAREHOUSE-001/entries~where(availableQuantity<10)
```

---

## Stock Adjustments

Stock adjustments record inventory changes with reasons for audit trail.

### Creating an Adjustment

```bash
POST /v1/stock-adjustments
{
  "identifiers": {"com.example.adjustmentId": "ADJ-2024-001"},
  "timestamp": "2024-12-15T10:00:00Z",
  "owner": {"identifiers": {"com.example.companyId": "OUR-COMPANY"}},
  "items": [
    {
      "product": {"identifiers": {"com.example.sku": "PHONE-001"}},
      "place": {"identifiers": {"com.example.stockPlaceId": "WAREHOUSE-001"}},
      "reason": {"identifiers": {"com.example.reasonId": "RECEIVED"}},
      "quantity": 50
    }
  ]
}
```

### Multi-Item Adjustment

```bash
POST /v1/stock-adjustments
{
  "identifiers": {"com.example.adjustmentId": "ADJ-RECEIPT-001"},
  "timestamp": "2024-12-15T14:00:00Z",
  "owner": {"identifiers": {"com.example.companyId": "OUR-COMPANY"}},
  "items": [
    {
      "product": {"identifiers": {"com.example.sku": "PHONE-001"}},
      "place": {"identifiers": {"com.example.stockPlaceId": "RECEIVING-DOCK"}},
      "reason": {"identifiers": {"com.example.reasonId": "RECEIVED"}},
      "quantity": 50
    },
    {
      "product": {"identifiers": {"com.example.sku": "CASE-001"}},
      "place": {"identifiers": {"com.example.stockPlaceId": "RECEIVING-DOCK"}},
      "reason": {"identifiers": {"com.example.reasonId": "RECEIVED"}},
      "quantity": 200
    },
    {
      "product": {"identifiers": {"com.example.sku": "CHARGER-001"}},
      "place": {"identifiers": {"com.example.stockPlaceId": "RECEIVING-DOCK"}},
      "reason": {"identifiers": {"com.example.reasonId": "RECEIVED"}},
      "quantity": 100
    }
  ]
}
```

### Stock Decrease

```bash
POST /v1/stock-adjustments
{
  "timestamp": "2024-12-15T16:00:00Z",
  "owner": {"identifiers": {"com.example.companyId": "OUR-COMPANY"}},
  "items": [
    {
      "product": {"identifiers": {"com.example.sku": "PHONE-001"}},
      "place": {"identifiers": {"com.example.stockPlaceId": "WAREHOUSE-001"}},
      "reason": {"identifiers": {"com.example.reasonId": "DAMAGED"}},
      "quantity": 2
    }
  ]
}
```

> The `DAMAGED` reason has `direction: "Decrease"`, so the quantity is subtracted from stock.

### Instance-Specific Adjustment

For serialized products:

```bash
POST /v1/stock-adjustments
{
  "timestamp": "2024-12-15T10:00:00Z",
  "owner": {"identifiers": {"com.example.companyId": "OUR-COMPANY"}},
  "items": [
    {
      "product": {"identifiers": {"com.example.sku": "PHONE-001"}},
      "place": {"identifiers": {"com.example.stockPlaceId": "WAREHOUSE-001"}},
      "reason": {"identifiers": {"com.example.reasonId": "RECEIVED"}},
      "quantity": 1,
      "instance": {"imei": "359876543210123"}
    }
  ]
}
```

### Stock Adjustment Reasons

#### Creating Reasons

```bash
# Increase reason
POST /v1/stock-adjustment-reasons
{
  "identifiers": {"com.example.reasonId": "RECEIVED"},
  "name": "Goods Received",
  "active": true,
  "direction": "Increase"
}

# Decrease reason
POST /v1/stock-adjustment-reasons
{
  "identifiers": {"com.example.reasonId": "DAMAGED"},
  "name": "Damaged Goods",
  "active": true,
  "direction": "Decrease"
}

# Bidirectional reason
POST /v1/stock-adjustment-reasons
{
  "identifiers": {"com.example.reasonId": "COUNT"},
  "name": "Inventory Count",
  "active": true
}
```

#### Common Adjustment Reasons

| Reason | Direction | Use Case |
|--------|-----------|----------|
| `RECEIVED` | Increase | Goods received from supplier |
| `RETURNED` | Increase | Customer returns |
| `FOUND` | Increase | Found during inventory count |
| `TRANSFER-IN` | Increase | Received from another location |
| `SOLD` | Decrease | POS sales (if not via orders) |
| `DAMAGED` | Decrease | Damaged goods written off |
| `LOST` | Decrease | Inventory shrinkage |
| `STOLEN` | Decrease | Theft |
| `TRANSFER-OUT` | Decrease | Sent to another location |
| `COUNT` | Both | Physical inventory count corrections |
| `INITIAL` | Increase | Initial stock load |
| `SYNC` | Both | External system synchronization |

#### Listing Reasons

```bash
# All reasons
GET /v1/stock-adjustment-reasons~take(50)

# Active reasons only
GET /v1/stock-adjustment-reasons~where(active=true)
```

### Inter-Location Transfer

Transfer between locations using paired adjustments. The `TRANSFER-OUT` reason has `direction: "Decrease"` and `TRANSFER-IN` has `direction: "Increase"`:

```bash
POST /v1/stock-adjustments
{
  "identifiers": {"com.example.adjustmentId": "TRANSFER-001"},
  "timestamp": "2024-12-15T11:00:00Z",
  "owner": {"identifiers": {"com.example.companyId": "OUR-COMPANY"}},
  "items": [
    {
      "product": {"identifiers": {"com.example.sku": "PHONE-001"}},
      "place": {"identifiers": {"com.example.stockPlaceId": "WAREHOUSE-001"}},
      "reason": {"identifiers": {"com.example.reasonId": "TRANSFER-OUT"}},
      "quantity": 10
    },
    {
      "product": {"identifiers": {"com.example.sku": "PHONE-001"}},
      "place": {"identifiers": {"com.example.stockPlaceId": "STORE-NORTH"}},
      "reason": {"identifiers": {"com.example.reasonId": "TRANSFER-IN"}},
      "quantity": 10
    }
  ]
}
```

### Viewing Transactions

```bash
# Transactions at a location
GET /v1/stock-places/com.example.stockPlaceId=WAREHOUSE-001/transactions~orderBy(timestamp:desc)~take(50)

# All adjustments
GET /v1/stock-adjustments~orderBy(timestamp:desc)~take(50)

# Specific adjustment
GET /v1/stock-adjustments/com.example.adjustmentId=ADJ-001
```

---

## Stock Reservations

Reservations hold stock for pending orders, reducing available quantity without changing physical quantity.

### Reservation Flow

```
Order Created
     │
     ▼
┌───────────────┐
│ Reserve Stock │ ──► availableQuantity -= orderQty
└───────────────┘
     │
     ▼
Order Approved
     │
     ▼
┌───────────────┐
│ Ship Order    │ ──► physicalQuantity -= shippedQty
└───────────────┘
     │
     ▼
Order Cancelled
     │
     ▼
┌───────────────┐
│ Release Stock │ ──► availableQuantity += orderQty
└───────────────┘
```

### Automatic Reservations

When orders are created and approved, stock is reserved automatically:

```bash
# Create order (may reserve stock depending on configuration)
POST /v1/trade-orders
{
  "items": [
    {"product": {"identifiers": {"com.example.sku": "PHONE-001"}}, "quantity": 2}
  ],
  ...
}

# Check stock after order
GET /v1/stock-places/com.example.stockPlaceId=WAREHOUSE-001/entries

# physicalQuantity: 100 (unchanged)
# availableQuantity: 98 (decreased by order qty)
# Reserved quantity = 100 - 98 = 2
```

> **Note:** The `/entries` endpoint exposes `product`, `physicalQuantity`, and `availableQuantity` only. There is no `reservedQuantity` field or `reservations` expansion. Calculate reserved quantity as `physicalQuantity - availableQuantity` if needed.

---

## Stock Reset

Stock reset is a method endpoint (`POST /v1/stock-reset`) that creates a `StockReset` adjustment across all stock roots owned by the specified agent (optionally limited to a single product). It reconciles excess/deficit by emitting adjustment items for the owner's stock accounts.

### Reset All Stock for Owner

```bash
# Offsets specified excess/deficit across all stock places
POST /v1/stock-reset
{
  "owner": {"identifiers": {"com.example.companyId": "OUR-COMPANY"}}
}
```

### Reset Specific Product

```bash
# Offsets specified excess/deficit for a single product
POST /v1/stock-reset
{
  "owner": {"identifiers": {"com.example.companyId": "OUR-COMPANY"}},
  "product": {"identifiers": {"com.example.sku": "PHONE-001"}}
}
```

> **Note:** Stock reset **requires** `owner` and accepts optional `product`, but does **not** accept `stockPlace` or `quantity`. It operates on all stock places under the owner's stock roots (optionally limited to `product`) and creates adjustment items to reconcile excess/deficit. It does not "delete transactions" or "align physical to available".

**Error responses:**

| Error | Cause |
|-------|-------|
| `Missing argument: owner` | Owner not provided |
| `Stock owner not found` | Referenced agent doesn't exist or has no stock roots |
| `Product not found` | Referenced product doesn't exist |

> **Warning:** Stock reset may create no adjustments if there is nothing to reconcile. Use carefully, typically only during initial setup or major system migrations.

---

## Agent Stock Roots

Agents (companies, stores) expose their primary stock locations via stock roots.

### Setting Stock Roots

```bash
# Add stock root to company
POST /v1/companies/com.example.companyId=OUR-COMPANY/stockRoots
{"identifiers": {"com.example.stockPlaceId": "WAREHOUSE-001"}}

# Add stock root to store
POST /v1/stores/com.example.storeId=STORE-NORTH/stockRoots
{"identifiers": {"com.example.stockPlaceId": "STORE-NORTH-MAIN"}}
```

### Querying Stock Roots

```bash
# Company's stock roots
GET /v1/companies/com.example.companyId=OUR-COMPANY~with(stockRoots)

# Store's stock roots
GET /v1/stores/com.example.storeId=STORE-NORTH~with(stockRoots)

# Response
{
  "identifiers": {"com.example.companyId": "OUR-COMPANY"},
  "stockRoots": [
    {"identifiers": {"com.example.stockPlaceId": "WAREHOUSE-001"}},
    {"identifiers": {"com.example.stockPlaceId": "WAREHOUSE-002"}}
  ]
}
```

### Stock Roots Usage

Stock roots determine where an agent's inventory is managed:

| Agent Type | Typical Stock Roots |
|------------|---------------------|
| Company | Central warehouses |
| Store | Store backroom/sales floor |
| Supplier | Supplier warehouse (for dropship) |

---

## Shipment Orders

Shipment orders track physical delivery of products. They can be created directly via `POST /v1/shipment-orders` or via the trade order `createShipment` action, and `status` is an array with values `New`, `Released`, `Transiting`, `Acquired` (plus partial summaries).

### Creating Shipments

Shipment orders can be created directly via `POST /v1/shipment-orders` or via the trade order `createShipment` action:

**Direct creation:**

```bash
# Create a shipment order directly
POST /v1/shipment-orders
{
  "identifiers": {"com.example.shipmentId": "SHIP-001"},
  "shipper": {"identifiers": {"com.example.companyId": "OUR-COMPANY"}},
  "recipient": {"identifiers": {"com.example.customerId": "CUST-001"}},
  "items": [
    {
      "product": {"identifiers": {"com.example.sku": "PHONE-001"}},
      "quantity": 1
    }
  ]
}
```

**Via trade order action:**

```bash
# Create a shipment from a trade order
PATCH /v1/trade-orders/com.example.orderId=ORD-001/actions
{"createShipment": true}
```

> **Important:** The trade order `createShipment` action takes a **boolean** only (`true`). It does not accept `source`, `items`, or `deliveryTerms` parameters — these fields are determined automatically from the trade order.

### Querying Shipments

```bash
# Get shipment by identifier
GET /v1/shipment-orders/com.example.shipmentId=SHIP-001

# Response
{
  "identifiers": {"com.example.shipmentId": "SHIP-001"},
  "sender": {"@type": "company", "identifiers": {"com.example.companyId": "OUR-COMPANY"}},
  "receiver": {"@type": "person", "identifiers": {"com.example.customerId": "CUST-001"}},
  "source": {"identifiers": {"com.example.stockPlaceId": "WAREHOUSE-001"}},
  "destination": {"identifiers": {"com.example.stockPlaceId": "CUSTOMER-LOCATION"}},
  "orders": [
    {"identifiers": {"com.example.orderId": "ORD-001"}}
  ],
  "carrier": {"@type": "company", "identifiers": {"com.example.carrierId": "DHL"}},
  "status": ["New"],
  "items": [
    {
      "product": {"identifiers": {"com.example.sku": "PHONE-001"}},
      "quantity": "1"
    }
  ]
}
```

### Shipment Items

```bash
# Get shipment items
GET /v1/shipment-orders/com.example.shipmentId=SHIP-001/items

# Response
[
  {
    "product": {"identifiers": {"com.example.sku": "PHONE-001"}},
    "quantity": "1",
    "status": ["New"],
    "statusDetails": [
      {"quantity": "1", "status": "New"}
    ]
  }
]
```

> **Note:** Item `status` is an array (e.g., `["New"]`, `["Released"]`). Quantities are returned as decimal strings.

### Shipment Records

Records log shipment events via `actions`:

```bash
GET /v1/shipment-orders/com.example.shipmentId=SHIP-001/records

# Response
[
  {
    "timestamp": "2024-12-15T10:00:00Z",
    "actions": {"create": {}}
  },
  {
    "timestamp": "2024-12-15T10:30:00Z",
    "actions": {"release": {}}
  }
]
```

---

## Shipment Lifecycle

### Status Flow

```
┌───────────┐
│  ["New"]  │
└────┬────┘
     │
     │ release
     ▼
┌────────────┐
│ ["Released"]│
└────┬───────┘
     │
     │ (external fulfillment)
     ▼
┌────────────────┐
│ ["Transiting"] │
└─────┬──────────┘
      │
      │ (delivery confirmation)
      ▼
┌───────────────┐
│ ["Acquired"]  │
└───────────────┘
```

### Shipment Status Reference

| Status | Description | Next Status |
|--------|-------------|-------------|
| `["New"]` | Created, awaiting release | `["Released"]` |
| `["Released"]` | Ready for fulfillment | `["Transiting"]` |
| `["Transiting"]` | In transit to destination | `["Acquired"]` |
| `["Acquired"]` | Fulfillment complete | (terminal) |

> **Note:** Status values are `New`, `Released`, `Transiting`, `Acquired`. When items have mixed statuses, summary values like `PartiallyReleased`, `PartiallyTransiting`, or `PartiallyAcquired` are produced. There is no `Cancelled` or `Completed` status in the current implementation.

### Shipment Actions

Shipment orders support only the `release` action. Shipment progression beyond release (tracking, delivery confirmation) is handled by external integrations.

```bash
# Release shipment
PATCH /v1/shipment-orders/com.example.shipmentId=SHIP-001/actions
{"release": {}}
```

> **Note:** Only `actions.release` is available on the shipment order resource. Actions like `ship`, `deliver`, and `cancel` are not supported. Shipment cancellation is not implemented in the current API.

### Stock Impact

| Action | Stock Effect |
|--------|--------------|
| Create shipment | No change (if order already reserved) |
| Release shipment | Physical quantity decreases |

---

## Delivery Terms

### Incoterms

International Commercial Terms define when responsibility transfers. Delivery terms are managed as separate resources (`/v1/delivery-terms`, `/v1/incoterm-delivery-terms`) and are not directly wired into the `createShipment` action.

> **Note:** The trade order `createShipment` action takes a boolean only (`true`). It does not accept `deliveryTerms`, `source`, or `items` parameters. To use delivery terms, create them separately and reference them on the trade order or configure them at the company level.

### Common Incoterms

| Code | Name | Responsibility Transfer |
|------|------|------------------------|
| `EXW` | Ex Works | At seller's premises |
| `FOB` | Free On Board | At port of shipment |
| `CIF` | Cost, Insurance, Freight | At destination port |
| `DAP` | Delivered at Place | At named destination |
| `DDP` | Delivered Duty Paid | At destination, duties paid |

### Carrier References

Shipment orders reference a carrier as an `agent` (typically a company). There is no `/v1/carriers` resource; carrier configuration and integrations are managed via shipment integrations.

```bash
# Shipment with carrier reference
{
  "carrier": {
    "@type": "company",
    "identifiers": {"com.example.carrierId": "DHL"}
  }
}
```

---

## Endpoint Matrix

### Stock Places

| Operation | Method | Endpoint | Use Case |
|-----------|--------|----------|----------|
| List places | GET | `/v1/stock-places~take(50)` | Browse locations |
| Get place | GET | `/v1/stock-places/{id}` | Single location |
| Create place | POST | `/v1/stock-places` | New location |
| Upsert place | PUT | `/v1/stock-places/{id}` | Idempotent create |
| Get entries | GET | `/v1/stock-places/{id}/entries` | Stock levels |
| Get transactions | GET | `/v1/stock-places/{id}/transactions` | Audit trail |
| Get children | GET | `/v1/stock-places/{id}/children` | Sub-locations |

### Stock Adjustments

| Operation | Method | Endpoint | Use Case |
|-----------|--------|----------|----------|
| List adjustments | GET | `/v1/stock-adjustments~take(50)` | Browse adjustments |
| Get adjustment | GET | `/v1/stock-adjustments/{id}` | Single adjustment |
| Create adjustment | POST | `/v1/stock-adjustments` | Record stock change |
| Reset stock | POST | `/v1/stock-reset` | Create StockReset adjustments to reconcile owner stock roots |

### Adjustment Reasons

| Operation | Method | Endpoint | Use Case |
|-----------|--------|----------|----------|
| List reasons | GET | `/v1/stock-adjustment-reasons` | Browse reasons |
| Get reason | GET | `/v1/stock-adjustment-reasons/{id}` | Single reason |
| Create reason | POST | `/v1/stock-adjustment-reasons` | New reason |

### Shipment Orders

| Operation | Method | Endpoint | Use Case |
|-----------|--------|----------|----------|
| List shipments | GET | `/v1/shipment-orders~take(50)` | Browse shipments |
| Get shipment | GET | `/v1/shipment-orders/{id}` | Single shipment |
| Create shipment (direct) | POST | `/v1/shipment-orders` | New shipment with explicit fields |
| Create shipment (via order) | PATCH | `/v1/trade-orders/{id}/actions` + `{"createShipment": true}` | New shipment from trade order |
| Release shipment | PATCH | `/v1/shipment-orders/{id}/actions` | Release for fulfillment |
| Get items | GET | `/v1/shipment-orders/{id}/items` | Line items |
| Get records | GET | `/v1/shipment-orders/{id}/records` | Event log |
| Find shipments | POST | `/v1/shipment-orders/@find` | Incremental sync (modifiedTag only) |

---

## Finder and Indexing Patterns

### Stock Place Queries

```bash
# All places
GET /v1/stock-places~take(50)

# By owner
GET /v1/stock-places~where(owner.identifiers.com.example.companyId=OUR-COMPANY)~take(50)

# Root places (no parent)
GET /v1/stock-places~where(parent=null)~take(50)

# With children
GET /v1/stock-places/com.example.stockPlaceId=WAREHOUSE-001~with(children)
```

### Stock Entry Queries

```bash
# All entries at location
GET /v1/stock-places/com.example.stockPlaceId=WAREHOUSE-001/entries

# Paginated
GET /v1/stock-places/com.example.stockPlaceId=WAREHOUSE-001/entries~take(100)

# Count entries
GET /v1/stock-places/com.example.stockPlaceId=WAREHOUSE-001/entries~count
```

### Transaction Queries

```bash
# Recent transactions
GET /v1/stock-places/com.example.stockPlaceId=WAREHOUSE-001/transactions~orderBy(timestamp:desc)~take(50)

# All adjustments
GET /v1/stock-adjustments~orderBy(timestamp:desc)~take(50)
```

### Shipment Queries

```bash
# All shipments
GET /v1/shipment-orders~take(50)

# Recent shipments
GET /v1/shipment-orders~orderBy(timestamp:desc)~take(50)

# By status (status is an array; match single values like New)
GET /v1/shipment-orders~where(status=New)~take(50)

> **Note:** Since `status` is an array, filter by the desired value (`New`, `Released`, `Transiting`, `Acquired`, or `Partially...`) rather than by a single string field.
```

### Shipment Finder (Incremental Sync)

```bash
POST /v1/shipment-orders/@find
{
  "modifiedTag": {"tag": "previous-tag-from-last-sync"}
}

# Response format
{
  "modifiedTag": {"tag": "new-tag-for-next-sync"},
  "results": [...]
}
```

> **Note:** Shipment finder only supports `modifiedTag` for incremental sync. Filters such as `sender`, `receiver`, and `carrier` are not supported and will return a 400 error.

---

## Error Handling and Validation

### Common Validation Errors

| Error Code | Cause | Solution |
|------------|-------|----------|
| `MissingRequiredField` | Required field not provided | Add `owner`, `place`, `reason`, etc. |
| `InvalidIdentifier` | Bare identifier key | Use namespaced key |
| `StockPlaceNotFound` | Referenced location doesn't exist | Create stock place first |
| `ProductNotFound` | Referenced product doesn't exist | Create product first |
| `ReasonNotFound` | Referenced reason doesn't exist | Create adjustment reason first |
| `InsufficientStock` | Not enough available quantity | Check stock before shipping |
| `ParentNotFound` | Parent stock place doesn't exist | Create parent first |

### Validation Error Response

```json
{
  "error": "ValidationError",
  "code": "InsufficientStock",
  "message": "Insufficient stock for product PHONE-001 at WAREHOUSE-001",
  "details": {
    "product": "com.example.sku=PHONE-001",
    "location": "com.example.stockPlaceId=WAREHOUSE-001",
    "requested": 10,
    "available": 5
  }
}
```

### Action-Specific Errors

| Action | Error | Cause |
|--------|-------|-------|
| Adjustment | `NegativeStock` | Adjustment would create negative stock |
| Shipment release | `InsufficientStock` | Not enough available stock |
| Direct creation without required fields | `BadRequest` | Missing shipper/recipient |

---

## Integration Playbook

### Phase 1: Stock Place Setup

**Goal:** Establish location hierarchy.

1. **Create warehouse structure (without owner):**
   ```bash
   # Root warehouse
   PUT /v1/stock-places/com.example.stockPlaceId=WAREHOUSE-CENTRAL
   {
     "name": "Central Warehouse"
   }

   # Zones (children inherit ownership from parent's stock root)
   PUT /v1/stock-places/com.example.stockPlaceId=WH-CENTRAL-RECEIVING
   {
     "name": "Receiving Dock",
     "parent": {"identifiers": {"com.example.stockPlaceId": "WAREHOUSE-CENTRAL"}}
   }

   PUT /v1/stock-places/com.example.stockPlaceId=WH-CENTRAL-STORAGE
   {
     "name": "Main Storage",
     "parent": {"identifiers": {"com.example.stockPlaceId": "WAREHOUSE-CENTRAL"}}
   }
   ```

2. **Link stock roots to agents (establishes ownership):**
   ```bash
   POST /v1/companies/com.example.companyId=OUR-COMPANY/stockRoots
   {"identifiers": {"com.example.stockPlaceId": "WAREHOUSE-CENTRAL"}}
   ```

3. **Create store locations:**
   ```bash
   PUT /v1/stock-places/com.example.stockPlaceId=STORE-001-MAIN
   {
     "name": "Store Stockholm"
   }

   POST /v1/stores/com.example.storeId=STORE-001/stockRoots
   {"identifiers": {"com.example.stockPlaceId": "STORE-001-MAIN"}}
   ```

**Checkpoint:** Location hierarchy visible and linked to agents via stockRoots.

### Phase 2: Adjustment Reasons

**Goal:** Establish audit categories.

1. **Create standard reasons:**
   ```bash
   PUT /v1/stock-adjustment-reasons/com.example.reasonId=RECEIVED
   {"name": "Goods Received", "direction": "Increase", "active": true}

   PUT /v1/stock-adjustment-reasons/com.example.reasonId=RETURNED
   {"name": "Customer Return", "direction": "Increase", "active": true}

   PUT /v1/stock-adjustment-reasons/com.example.reasonId=DAMAGED
   {"name": "Damaged Goods", "direction": "Decrease", "active": true}

   PUT /v1/stock-adjustment-reasons/com.example.reasonId=SOLD
   {"name": "Sold", "direction": "Decrease", "active": true}

   PUT /v1/stock-adjustment-reasons/com.example.reasonId=COUNT
   {"name": "Inventory Count", "active": true}

   PUT /v1/stock-adjustment-reasons/com.example.reasonId=TRANSFER
   {"name": "Inter-Location Transfer", "active": true}

   PUT /v1/stock-adjustment-reasons/com.example.reasonId=INITIAL
   {"name": "Initial Stock Load", "direction": "Increase", "active": true}
   ```

**Checkpoint:** All adjustment reasons available for use.

### Phase 3: Initial Stock Load

**Goal:** Populate initial inventory.

1. **Load initial stock per product/location:**
   ```bash
   POST /v1/stock-adjustments
   {
     "identifiers": {"com.example.adjustmentId": "INITIAL-LOAD-001"},
     "timestamp": "2024-12-01T00:00:00Z",
     "owner": {"identifiers": {"com.example.companyId": "OUR-COMPANY"}},
     "items": [
       {
         "product": {"identifiers": {"com.example.sku": "PHONE-001"}},
         "place": {"identifiers": {"com.example.stockPlaceId": "WH-CENTRAL-STORAGE"}},
         "reason": {"identifiers": {"com.example.reasonId": "INITIAL"}},
         "quantity": 100
       },
       {
         "product": {"identifiers": {"com.example.sku": "CASE-001"}},
         "place": {"identifiers": {"com.example.stockPlaceId": "WH-CENTRAL-STORAGE"}},
         "reason": {"identifiers": {"com.example.reasonId": "INITIAL"}},
         "quantity": 500
       }
     ]
   }
   ```

2. **Verify stock levels:**
   ```bash
   GET /v1/stock-places/com.example.stockPlaceId=WH-CENTRAL-STORAGE/entries
   ```

**Checkpoint:** Initial inventory visible and correct.

### Phase 4: Operational Flows

**Goal:** Implement receiving, transfers, and fulfillment.

1. **Receiving workflow:**
   ```bash
   # Record goods receipt (owner inferred from stock place's stock root)
   POST /v1/stock-adjustments
   {
     "timestamp": "2024-12-15T09:00:00Z",
     "items": [
       {
         "product": {"identifiers": {"com.example.sku": "PHONE-001"}},
         "place": {"identifiers": {"com.example.stockPlaceId": "WH-CENTRAL-RECEIVING"}},
         "reason": {"identifiers": {"com.example.reasonId": "RECEIVED"}},
         "quantity": 50
       }
     ]
   }
   ```

   > **Note:** `owner` is optional when the stock place is owned via `stockRoots`. The system infers the owner from `StockOwner.forNearestRoot(place)`.

2. **Transfer to storage:**
   ```bash
   POST /v1/stock-adjustments
   {
     "timestamp": "2024-12-15T10:00:00Z",
     "items": [
       {
         "product": {"identifiers": {"com.example.sku": "PHONE-001"}},
         "place": {"identifiers": {"com.example.stockPlaceId": "WH-CENTRAL-RECEIVING"}},
         "reason": {"identifiers": {"com.example.reasonId": "TRANSFER-OUT"}},
         "quantity": 50
       },
       {
         "product": {"identifiers": {"com.example.sku": "PHONE-001"}},
         "place": {"identifiers": {"com.example.stockPlaceId": "WH-CENTRAL-STORAGE"}},
         "reason": {"identifiers": {"com.example.reasonId": "TRANSFER-IN"}},
         "quantity": 50
       }
     ]
   }
   ```

**Checkpoint:** Receiving and transfer flows operational.

### Phase 5: Shipment Integration

**Goal:** Connect orders to shipments.

1. **Create shipment from trade order:**
   ```bash
   # createShipment takes a boolean only
   PATCH /v1/trade-orders/com.example.orderId=ORD-001/actions
   {"createShipment": true}
   ```

2. **Or create shipment directly:**
   ```bash
   POST /v1/shipment-orders
   {
     "identifiers": {"com.example.shipmentId": "SHIP-ORD-001"},
     "shipper": {"identifiers": {"com.example.companyId": "OUR-COMPANY"}},
     "recipient": {"identifiers": {"com.example.customerId": "CUST-001"}},
     "items": [
       {"product": {"identifiers": {"com.example.sku": "PHONE-001"}}, "quantity": 1}
     ]
   }
   ```

3. **Release shipment:**
   ```bash
   PATCH /v1/shipment-orders/com.example.shipmentId=SHIP-ORD-001/actions
   {"release": {}}
   ```

**Checkpoint:** End-to-end order fulfillment operational. Further tracking and delivery confirmation is handled by external integrations.

---

## Case Study: Warehouse-to-Customer Fulfillment

This case study demonstrates complete fulfillment flow from receiving goods through customer delivery.

### Scenario

- Receive 50 smartphones from supplier
- Transfer to storage
- Fulfill customer order
- Ship to customer

> **Prerequisite:** Stock places `WH-RECEIVING` and `WH-STORAGE` must be added to the company's `stockRoots` before adjustments can be made. When `stockRoots` are set up, `owner` is optional on adjustments (inferred from the stock place's stock root).

### Step 1: Receive Goods from Supplier

```bash
# owner is optional here - inferred from WH-RECEIVING's stock root
POST /v1/stock-adjustments
{
  "identifiers": {"com.example.adjustmentId": "RECEIPT-2024-001"},
  "timestamp": "2024-12-15T08:00:00Z",
  "items": [
    {
      "product": {"identifiers": {"com.example.sku": "IPHONE-15-PRO"}},
      "place": {"identifiers": {"com.example.stockPlaceId": "WH-RECEIVING"}},
      "reason": {"identifiers": {"com.example.reasonId": "RECEIVED"}},
      "quantity": 50
    }
  ]
}
```

**Stock after receipt:**
```
WH-RECEIVING:
  IPHONE-15-PRO: physical=50, available=50, reserved=0
```

### Step 2: Transfer to Main Storage

```bash
POST /v1/stock-adjustments
{
  "identifiers": {"com.example.adjustmentId": "TRANSFER-2024-001"},
  "timestamp": "2024-12-15T09:00:00Z",
  "items": [
    {
      "product": {"identifiers": {"com.example.sku": "IPHONE-15-PRO"}},
      "place": {"identifiers": {"com.example.stockPlaceId": "WH-RECEIVING"}},
      "reason": {"identifiers": {"com.example.reasonId": "TRANSFER-OUT"}},
      "quantity": 50
    },
    {
      "product": {"identifiers": {"com.example.sku": "IPHONE-15-PRO"}},
      "place": {"identifiers": {"com.example.stockPlaceId": "WH-STORAGE"}},
      "reason": {"identifiers": {"com.example.reasonId": "TRANSFER-IN"}},
      "quantity": 50
    }
  ]
}
```

**Stock after transfer:**
```
WH-RECEIVING:
  IPHONE-15-PRO: physical=0, available=0, reserved=0

WH-STORAGE:
  IPHONE-15-PRO: physical=50, available=50, reserved=0
```

### Step 3: Customer Places Order

```bash
POST /v1/trade-orders
{
  "identifiers": {"com.example.orderId": "ORD-CUST-2024-001"},
  "supplier": {"identifiers": {"com.example.companyId": "TELECOM-AB"}},
  "customer": {"identifiers": {"com.example.customerId": "CUST-001"}},
  "sellers": [{"identifiers": {"com.example.storeId": "STORE-ONLINE"}}],
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "items": [
    {
      "product": {"identifiers": {"com.example.sku": "IPHONE-15-PRO"}},
      "instances": [{"imei": "359876543210123"}]
    }
  ]
}
```

### Step 4: Approve Order (Stock Reserved)

```bash
PATCH /v1/trade-orders/com.example.orderId=ORD-CUST-2024-001/actions
{"tryApprove": true}
```

**Stock after approval:**
```
WH-STORAGE:
  IPHONE-15-PRO: physical=50, available=49, reserved=1
```

### Step 5: Create Shipment

Shipments are created via the trade order's `createShipment` action (boolean only):

```bash
PATCH /v1/trade-orders/com.example.orderId=ORD-CUST-2024-001/actions
{"createShipment": true}
```

> **Note:** The `createShipment` action takes only a boolean. Source, items, and delivery terms are determined automatically from the trade order.

### Step 6: Release Shipment

```bash
PATCH /v1/shipment-orders/com.example.shipmentId=SHIP-2024-001/actions
{"release": {}}
```

**Stock after release:**
```
WH-STORAGE:
  IPHONE-15-PRO: physical=49, available=49
```

> **Note:** Further shipment progression (tracking, delivery confirmation) is handled by external integrations. The shipment order resource only supports the `release` action.

### Step 7: Verify Final State

```bash
# Check shipment
GET /v1/shipment-orders/com.example.shipmentId=SHIP-2024-001~withAll

# Response
{
  "identifiers": {"com.example.shipmentId": "SHIP-2024-001"},
  "status": ["Released"],
  "sender": {"@type": "company", "name": "Telecom AB"},
  "receiver": {"@type": "person", "givenName": "Customer", "familyName": "Name"},
  "orders": [{"identifiers": {"com.example.orderId": "ORD-CUST-2024-001"}}],
  "carrier": {"@type": "company", "name": "PostNord"},
  "records": [
    {"timestamp": "2024-12-15T10:00:00Z", "actions": {"create": {}}},
    {"timestamp": "2024-12-15T10:30:00Z", "actions": {"release": {}}}
  ]
}

# Check final stock
GET /v1/stock-places/com.example.stockPlaceId=WH-STORAGE/entries

# Response
{
  "product": {"identifiers": {"com.example.sku": "IPHONE-15-PRO"}},
  "physicalQuantity": 49,
  "availableQuantity": 49
}
```

---

## Business Rules and Pitfalls

### Critical Rules

1. **Stock places can be created without owner:**
   ```bash
   # Owner is optional on creation
   POST /v1/stock-places
   {"identifiers": {"com.example.stockPlaceId": "WH-001"}, "name": "Warehouse"}

   # Stock adjustments can omit owner if it can be inferred from a stock root
   # Unowned places (or places without a stock-root path) will fail
   "owner": {"identifiers": {"com.example.companyId": "..."}}"
   ```

2. **Use hierarchy for organization:**
   ```bash
   # Parent/child for zones, shelves
   "parent": {"identifiers": {"com.example.stockPlaceId": "..."}}"
   ```

3. **Adjustments need reasons:**
   ```bash
   # Always include adjustment reason
   "reason": {"identifiers": {"com.example.reasonId": "..."}}"
   ```

4. **Quantity is a positive decimal string, defaulting to `"1"` if omitted. The reason's `direction` controls increase/decrease:**
   ```bash
   # Increase (reason with direction: "Increase")
   "quantity": "50"

   # Decrease (reason with direction: "Decrease")
   "quantity": "10"
   ```

5. **Namespaced identifiers required:**
   ```bash
   # WRONG
   {"identifiers": {"stockPlaceId": "..."}}

   # RIGHT
   {"identifiers": {"com.example.stockPlaceId": "..."}}
   ```

6. **Query parameter mixing is supported:**
   Query operators and traditional query parameters can be mixed. Operators are normalized in canonical order: `where` > `orderBy` > `skip` > `take` > `with`.
   ```bash
   # Both of these work
   GET /v1/stock-places~orderBy(name)~take(10)
   GET /v1/stock-places~take(10)~orderBy(name)  # Normalized to same order
   ```

### Common Mistakes

| Mistake | Problem | Solution |
|---------|---------|----------|
| Missing owner on adjustment for an unowned place | Adjustment fails | Specify owner or use a stock place with a stock root |
| Bare identifiers | Entity not found | Use `com.example.*` namespace |
| Missing reason | Adjustment fails | Create and reference reasons |
| Parent before child | Order dependency | Create hierarchy top-down |
| Negative stock | Business logic error | Check available before adjusting |

### Stock Calculation Rules

```
# Reserved quantity is derived (not returned by the API):
reservedQuantity = physicalQuantity - availableQuantity

# Available can never be negative
# Reservations cannot exceed physical quantity
# Adjustments that would create negative stock fail
```

### Transfer Atomicity

Transfers should be atomic to prevent stock discrepancies:

```bash
# GOOD: Single adjustment with paired items
POST /v1/stock-adjustments
{
  "items": [
    {"place": "A", "reason": "TRANSFER-OUT", "quantity": 10},  # Decrease source
    {"place": "B", "reason": "TRANSFER-IN", "quantity": 10}    # Increase destination
  ]
}

# BAD: Separate adjustments (risk of partial failure)
POST /v1/stock-adjustments  # First request
{"items": [{"place": "A", "reason": "TRANSFER-OUT", "quantity": 10}]}

POST /v1/stock-adjustments  # Second request (may fail)
{"items": [{"place": "B", "reason": "TRANSFER-IN", "quantity": 10}]}
```

### Shipment Timing

| Sequence | Correct Order |
|----------|---------------|
| 1 | Create trade order |
| 2 | Approve order (reserves stock) |
| 3 | Create shipment via `{"createShipment": true}` action or `POST /v1/shipment-orders` |
| 4 | Release shipment (decrements stock) |
| 5 | (External: fulfillment/tracking via integrations) |

### Instance Tracking

For serialized products, adjustments should include instance:

```bash
# Receiving specific device
{
  "product": {"identifiers": {"com.example.sku": "PHONE-001"}},
  "quantity": 1,
  "instance": {"imei": "359876543210123"}
}
```

---

## Related Guides

- [Products](products.md) - Product stock levels via `stockLevels` projection
- [Orders](orders.md) - Order fulfillment and stock reservation
- [Customers](customers.md) - Agent stock roots
- [Receipts](../receipts.md) - Completed transaction records
