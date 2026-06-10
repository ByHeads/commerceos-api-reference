# Stock & Inventory Examples

Curl examples for stock places, stock adjustments, and stock resets.

**Base URL:** `https://example.app.heads.com/api/v1`
**API Key:** `banana` (passed via Basic Auth with empty username: `-u ":banana"`)

> **See also:** [Stock & Inventory Guide (comprehensive)](./stock-inventory-guide.md) | [Product Instances & Tracking](./product-instances-tracking.md) | [Examples Index](../examples.md) | [Reference Documentation](../../reference/)

---

## Quick Start: Recommended Setup Order

1. **Create stock place(s)** without specifying an owner
2. **Add to agent's stockRoots** via `POST /v1/companies/{id}/stockRoots` or `POST /v1/stores/{id}/stockRoots`
3. **Create adjustment reasons** for tracking why inventory changes
4. **Create stock adjustments** to record inventory changes

```bash
# Step 1: Create stock place (owner is optional)
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/stock-places" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.stockPlaceId": "WH-001"},
    "name": "Main Warehouse"
  }'

# Step 2: Add to agent's stockRoots (preferred approach)
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/companies/com.heads.seedID=ourcompany/stockRoots" \
  -H "Content-Type: application/json" \
  -d '{"identifiers": {"com.myapp.stockPlaceId": "WH-001"}}'

# Step 3: Create adjustment reason
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/stock-adjustment-reasons" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.reasonId": "RESTOCK"},
    "name": "Restock",
    "active": true,
    "direction": "Increase"
  }'

# Step 4: Create stock adjustment (owner inferred from stock root)
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/stock-adjustments" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.adjustmentId": "ADJ-001"},
    "timestamp": "2024-03-15T10:30:00Z",
    "items": [
      {
        "product": {"identifiers": {"com.myapp.sku": "SKU-001"}},
        "place": {"identifiers": {"com.myapp.stockPlaceId": "WH-001"}},
        "reason": {"identifiers": {"com.myapp.reasonId": "RESTOCK"}},
        "quantity": 100
      }
    ]
  }'
```

---

## Stock Place Ownership Model

> **Important: How `owner` works on stock places**
>
> The `owner` field on a stock place is a **computed property**, not a stored field. It's derived from `StockOwner.forNearestRoot(place)` — finding the agent whose `stockRoots` collection includes this place (or a parent).
>
> **When you set `owner` on a stock place:**
> - The system removes the place from the old owner's `stockRoots` (if any)
> - The system adds the place to the new owner's `stockRoots`
>
> **The canonical relationship is:** `agent.stockRoots → stock place`, not `stock place.owner → agent`.
>
> **Preferred approach:** Create the stock place without `owner`, then add it to the agent's `stockRoots` collection:
> ```bash
> POST /v1/companies/{id}/stockRoots
> {"identifiers": {"com.myapp.stockPlaceId": "WH-001"}}
> ```
>
> **Also works (shorthand):** Set `owner` directly on the stock place — this manipulates `stockRoots` behind the scenes:
> ```bash
> POST /v1/stock-places
> {"identifiers": {...}, "name": "...", "owner": {"identifiers": {"com.example.companyId": "..."}}}
> ```

### stockRoots vs assortmentRoots

These are separate concepts that are often confused:

| Member | Purpose | What it contains |
|--------|---------|------------------|
| `stockRoots` | Defines where an agent's **inventory** is managed | Stock places (warehouses, stockrooms) |
| `assortmentRoots` | Defines an agent's **product catalog** | Product nodes (categories, groups) |

- Use `stockRoots` for stock adjustments and inventory tracking
- Use `assortmentRoots` for product assortment and catalog visibility

### Clearing stockRoots

To remove all stock roots from an agent, use `PUT` with an empty array:

```bash
# Remove all stock roots from a company
curl -X PUT -u ":banana" "https://example.app.heads.com/api/v1/companies/com.heads.seedID=ourcompany/stockRoots" \
  -H "Content-Type: application/json" \
  -d '[]'

# Or using PATCH replace
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/companies/com.heads.seedID=ourcompany/stockRoots" \
  -H "Content-Type: application/json" \
  -d '{"replace": []}'
```

This applies to all `indexedArray` properties (e.g., `stockRoots`, `assortmentRoots`, `labels`, `categories`).

---

## Stock Places

```bash
# List all stock places
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/stock-places"

# Get stock place by ID
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/stock-places/com.heads.seedID=warehouse1"

# Get stock place with children (sub-locations)
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/stock-places/com.heads.seedID=warehouse1~with(children)"

# Get stock place entries (current stock levels)
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/stock-places/com.heads.seedID=warehouse1/entries"

# Get stock transactions
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/stock-places/com.heads.seedID=warehouse1/transactions"

# Create a stock place (warehouse) - without owner (preferred)
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/stock-places" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.stockPlaceId": "WH-001"},
    "name": "Main Warehouse"
  }'

# Then add to agent's stockRoots (establishes ownership)
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/companies/com.heads.seedID=ourcompany/stockRoots" \
  -H "Content-Type: application/json" \
  -d '{"identifiers": {"com.myapp.stockPlaceId": "WH-001"}}'

# Alternative: Create with owner shorthand (manipulates stockRoots behind the scenes)
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/stock-places" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.stockPlaceId": "WH-002"},
    "name": "Secondary Warehouse",
    "owner": {"identifiers": {"com.heads.seedID": "ourcompany"}}
  }'

# Create child stock place (zone within warehouse)
# NOTE: The parent setter requires the database key (identifiers.key), not external IDs.
# Step 1: Get the parent's database key
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/stock-places/com.myapp.stockPlaceId=WH-001/identifiers/key"
# Returns the database key, e.g., "abc123..."

# Step 2: Create the child using the database key
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/stock-places" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.stockPlaceId": "WH-001-A"},
    "name": "Zone A",
    "parent": {"identifiers": {"key": "abc123..."}}
  }'

# Update stock place
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/stock-places/com.myapp.stockPlaceId=WH-001" \
  -H "Content-Type: application/json" \
  -d '{"name": "Central Distribution Warehouse"}'
```

> **Important:** The `parent` setter on stock places only accepts the database key via `identifiers.key`. External identifiers (like `com.myapp.stockPlaceId`) are not supported for relationship setters. Always fetch the parent's database key first using `/identifiers/key`.

---

## Stock Entries (set target stock)

Stock entries are the **target-based** counterpart to stock adjustments. Submit a desired physical quantity at one or more `(product, place)` pairs, and the server reads the current level, computes the delta, and writes a stock-adjustment record under the hood. Use this when you have a known *target* inventory (e.g. a reconciled count or an upstream source-of-truth) rather than a known *movement*. See the [Stock Entries reference](../../reference/stock-entries.md) for the full field list and error matrix.

```bash
# Drive a single (product, place) to a target — owner inferred from the place's stock root
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/stock-entries" \
  -H "Content-Type: application/json" \
  -d '[{
    "identifiers": {"com.myapp.id": "ENT-001"},
    "timestamp": "2024-03-15T10:30:00Z",
    "entries": [
      {
        "product": {"identifiers": {"com.myapp.sku": "SKU-001"}},
        "place":   {"identifiers": {"com.myapp.stockPlaceId": "WH-001"}},
        "physicalQuantity": 100
      }
    ]
  }]'
# If physical at (SKU-001, WH-001) is 73, the underlying stock-adjustment carries one item with quantity +27.
# If it's already 100, no items are emitted — the submission still succeeds.

# Multi-pair submission — all places must share the same owner
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/stock-entries" \
  -H "Content-Type: application/json" \
  -d '[{
    "identifiers": {"com.myapp.id": "ENT-002"},
    "timestamp": "2024-03-15T10:31:00Z",
    "entries": [
      {
        "product": {"identifiers": {"com.myapp.sku": "SKU-001"}},
        "place":   {"identifiers": {"com.myapp.stockPlaceId": "WH-001"}},
        "physicalQuantity": 100
      },
      {
        "product": {"identifiers": {"com.myapp.sku": "SKU-002"}},
        "place":   {"identifiers": {"com.myapp.stockPlaceId": "WH-001"}},
        "physicalQuantity": 50
      }
    ]
  }]'

# Duplicate (product, place) entries are NOT deduped — each one becomes a separate adjustment item.
# Each delta is computed against the same pre-submission current physical, not against an intermediate
# post-first-entry state, so the resulting final level is the sum of every delta applied (not "last wins").
# Dedupe client-side: same (product, place) twice yields two adjustment items, not one.
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/stock-entries" \
  -H "Content-Type: application/json" \
  -d '[{
    "identifiers": {"com.myapp.id": "ENT-DUP-001"},
    "timestamp": "2024-03-15T10:32:00Z",
    "entries": [
      {
        "product": {"identifiers": {"com.myapp.sku": "SKU-001"}},
        "place":   {"identifiers": {"com.myapp.stockPlaceId": "WH-001"}},
        "physicalQuantity": 100
      },
      {
        "product": {"identifiers": {"com.myapp.sku": "SKU-001"}},
        "place":   {"identifiers": {"com.myapp.stockPlaceId": "WH-001"}},
        "physicalQuantity": 90
      }
    ]
  }]'

# Product-scoped variant — product is implicit (taken from the URL)
# Useful for drift-correction across many places for one SKU. Body `product` values are silently
# dropped — no 400, no diagnostic — so validate URL/body parity client-side if you need to catch
# misrouted clients.
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/products/com.myapp.sku=SKU-001/stockEntries" \
  -H "Content-Type: application/json" \
  -d '[{
    "identifiers": {"com.myapp.id": "ENT-PROD-001"},
    "timestamp": "2024-03-15T10:30:00Z",
    "entries": [
      {
        "place": {"identifiers": {"com.myapp.stockPlaceId": "WH-001"}},
        "physicalQuantity": 100,
        "productInstances": [
          {"quantity": 1, "serialNumber": "IMEI-AAA-111"},
          {"quantity": 1, "serialNumber": "IMEI-AAA-112"}
        ]
      }
    ]
  }]'

# Read back a submission with the computed adjustment items expanded
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/stock-entries/com.myapp.id=ENT-001~with(items,transactionId,owner,stock,timestamp,identifiers)"

# The same record is also readable via the stock-adjustments resource by the same identifiers
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/stock-adjustments/com.myapp.id=ENT-001~with(items,productInstances)"
```

> **Heads up:**
>
> - All entries in a submission must resolve to the same owner. Mixing places across owners fails atomically with `"All entries in a stock entry submission must be owned by the same owner. ..."`.
> - Two entries that resolve to the same `(product, place)` pair are **not deduped** — each computes its delta against the pre-submission current physical and lands as a separate adjustment item, so the final level is the sum of every delta applied (not "last entry wins"). Dedupe client-side.
> - On the product-scoped endpoint (`/v1/products/<key>/stockEntries`), body `product` values that disagree with the URL are silently dropped — there is no 400 and no diagnostic. Validate URL/body parity client-side if you need to catch misrouted clients.
> - `availableQuantity` on an entry is accepted for back-compat parity with the legacy `PATCH /v1/stock-places/<key>` nested-array shape but is **informational only** — it does not steer effective stock separately from `physicalQuantity`.
> - Every `/v1/stock-entries` POST emits a stock-adjustment record. Don't double-bookkeep against `/v1/stock-adjustments` or you'll count the same movement twice.

---

## Stock Adjustments

Stock adjustments use an `items[]` array to adjust one or more products in a single transaction. Each item specifies a `product`, `place`, `reason`, and optional `quantity` (defaults to 1).

```bash
# List all stock adjustments
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/stock-adjustments"

# List stock adjustment reasons
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/stock-adjustment-reasons"

# Create stock adjustment reason
# NOTE: Only identifiers, name, active, and direction are supported - no description field.
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/stock-adjustment-reasons" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.reasonId": "DAMAGED"},
    "name": "Damaged Goods",
    "active": true,
    "direction": "Decrease"
  }'

# Create another adjustment reason (increase direction)
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/stock-adjustment-reasons" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.reasonId": "RESTOCK"},
    "name": "Restock",
    "active": true,
    "direction": "Increase"
  }'

# Create stock adjustment (increase) - single item
# Required fields: timestamp, items[] (each with product, place, reason)
# Optional: owner (auto-inferred from place if omitted), items[].quantity (defaults to 1)
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/stock-adjustments" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.adjustmentId": "ADJ-001"},
    "timestamp": "2024-03-15T10:30:00Z",
    "items": [
      {
        "product": {"identifiers": {"com.myapp.sku": "SKU-001"}},
        "place": {"identifiers": {"com.myapp.stockPlaceId": "WH-001"}},
        "reason": {"identifiers": {"com.myapp.reasonId": "RESTOCK"}},
        "quantity": 100
      }
    ]
  }'

# Create stock adjustment (decrease) - reason with direction: "Decrease"
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/stock-adjustments" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.adjustmentId": "ADJ-002"},
    "timestamp": "2024-03-15T14:00:00Z",
    "items": [
      {
        "product": {"identifiers": {"com.myapp.sku": "SKU-001"}},
        "place": {"identifiers": {"com.myapp.stockPlaceId": "WH-001"}},
        "reason": {"identifiers": {"com.myapp.reasonId": "DAMAGED"}},
        "quantity": 5
      }
    ]
  }'

# Create stock adjustment with multiple items (bulk adjustment)
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/stock-adjustments" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.adjustmentId": "ADJ-003"},
    "timestamp": "2024-03-16T09:00:00Z",
    "owner": {"identifiers": {"com.heads.seedID": "ourcompany"}},
    "items": [
      {
        "product": {"identifiers": {"com.myapp.sku": "SKU-001"}},
        "place": {"identifiers": {"com.myapp.stockPlaceId": "WH-001"}},
        "reason": {"identifiers": {"com.myapp.reasonId": "RESTOCK"}},
        "quantity": 50
      },
      {
        "product": {"identifiers": {"com.myapp.sku": "SKU-002"}},
        "place": {"identifiers": {"com.myapp.stockPlaceId": "WH-001"}},
        "reason": {"identifiers": {"com.myapp.reasonId": "RESTOCK"}},
        "quantity": 25
      }
    ]
  }'

# Create stock adjustment with instance data (serialized/IMEI-tracked product)
# NOTE: `instance` is a single object, NOT an array
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/stock-adjustments" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.adjustmentId": "ADJ-004"},
    "timestamp": "2024-03-17T11:00:00Z",
    "items": [
      {
        "product": {"identifiers": {"com.heads.seedID": "iphone15-128-Black-New"}},
        "place": {"identifiers": {"com.myapp.stockPlaceId": "WH-001"}},
        "reason": {"identifiers": {"com.myapp.reasonId": "RESTOCK"}},
        "quantity": 1,
        "instance": {"imei": "123456789012345"}
      }
    ]
  }'

# Get stock adjustment items
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/stock-adjustments/com.myapp.adjustmentId=ADJ-001~with(items)"
```

### Stock Adjustments — Time-relative queries

Stock adjustments are immutable records, so the most useful sync pattern is a daily/hourly delta poll keyed off creation time. See [Operators → Time-relative queries](../../reference/operators.md#time-relative-queries-before-and-after) for shared mechanics.

```bash
# Default mode: adjustments created at or after the given ISO timestamp
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/stock-adjustments/after/2025-02-01T00:00:00.000Z~take(200)"

# Adjustments created before a cutoff (exclusive end), newest first
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/stock-adjustments/before/2025-03-01T00:00:00.000Z~take(200)"
```

> **Default:** `create` — and it is the **only** supported mode. Stock adjustments do not record a separate "last modified" time, so `(modify)` returns a 404. The default is what you want for delta syncs.
>
> **Recommended:** use `/after/` and `/before/` for any time-windowed read of stock adjustments — they are index-backed and the canonical pattern. Use `~where(timestamp...)` only when you need to combine the time filter with a non-time predicate.

> **Stock Adjustment Fields:**
> - `timestamp` (required): The time of the adjustment (ISO 8601)
> - `items[]` (required): Array of adjustment items, each containing:
>   - `product` (required): Product reference
>   - `place` (required): Stock place reference
>   - `reason` (required): Stock adjustment reason reference
>   - `quantity` (optional, defaults to 1): Positive for increase, negative for decrease
>   - `instance` (optional): Instance data for serialized products
> - `owner` (optional): Auto-inferred from the first item's place if omitted

---

## Stock Resets

Stock reset is a method endpoint (`POST /v1/stock-reset`) that creates a StockReset adjustment across all stock places owned by the specified agent (optionally limited to a single product). It offsets any specified excess/deficit on each stock place account to reconcile balances.

> **Note:** PATCH is also accepted for this endpoint.

```bash
# Reset all stock for an owner (offsets specified excess/deficit across all stock places)
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/stock-reset" \
  -H "Content-Type: application/json" \
  -d '{
    "owner": {"identifiers": {"com.heads.seedID": "ourcompany"}}
  }'

# Reset stock for a specific product only
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/stock-reset" \
  -H "Content-Type: application/json" \
  -d '{
    "owner": {"identifiers": {"com.heads.seedID": "ourcompany"}},
    "product": {"identifiers": {"com.myapp.sku": "SKU-001"}}
  }'
```

> **Stock Reset Fields:**
> - `owner` (required): The agent whose stock is to be reset
> - `product` (optional): Limit reset to a specific product; if omitted, all products are reset
>
> Returns `{ "success": true }` on completion.
>
> **Note:** Stock reset does NOT accept `stockPlace` or `quantity` parameters. It operates on all stock places under the owner's stock roots (optionally limited to `product`) and creates adjustment items to offset specified excess/deficit, rather than deleting transactions or aligning "physical" to "available".
>
> **Error responses:**
> - `400 Bad Request` with `"Missing argument: owner"` if owner is not provided
> - `400 Bad Request` with `"Stock owner not found"` if the specified owner does not exist
> - `400 Bad Request` with `"Product not found"` if the specified product does not exist

---

## Stock Counts — Time-relative queries

Stock counts (physical inventory counts — see the [Stock & Inventory Guide](./stock-inventory-guide.md#part-4-stock-counts--physical-inventory) for the full lifecycle) support `/before/` and `/after/` for picking up newly created or recently amended counts.

```bash
# Default mode: counts modified at or after the given ISO timestamp
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/stock-counts/after/2025-02-01T00:00:00.000Z~take(100)"

# Explicit creation-time filter: counts opened at or after the given timestamp
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/stock-counts/after(create)/2025-02-01T00:00:00.000Z~take(100)"
```

> **Default:** `modify` — captures status transitions (`Ongoing`, `Completed`, `Approved`) along with creation. Use `(create)` to enumerate counts by when they were opened. See [Operators → Time-relative queries](../../reference/operators.md#time-relative-queries-before-and-after).
>
> **Recommended:** use `/after/` and `/before/` for any time-windowed read of stock counts — they are index-backed and the canonical pattern. Use `~where(timestamp...)` only when you need to combine the time filter with a non-time predicate.

---

## Stock Transfers — Time-relative queries

Stock transfers (movements between logical stocks — see the [Stock & Inventory Guide](./stock-inventory-guide.md#part-5-stock-transfers--moving-stock-between-logical-stocks) for the full lifecycle) support `/before/` and `/after/`.

```bash
# Default mode: transfers created at or after the given ISO timestamp
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/stock-transfers/after/2025-02-01T00:00:00.000Z~take(100)"

# Transfers created before a cutoff (exclusive end), newest first
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/stock-transfers/before/2025-03-01T00:00:00.000Z~take(100)"
```

> **Default:** `create` — and it is the **only** supported mode. Stock transfers do not record a separate "last modified" time, so `(modify)` returns a 404. The default is what you want for delta syncs. See [Operators → Time-relative queries](../../reference/operators.md#time-relative-queries-before-and-after).
>
> **Recommended:** use `/after/` and `/before/` for any time-windowed read of stock transfers — they are index-backed and the canonical pattern. Use `~where(timestamp...)` only when you need to combine the time filter with a non-time predicate.
