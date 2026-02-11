# Stock & Inventory Examples

Curl examples for stock places, stock adjustments, and stock resets.

**Base URL:** `http://localhost:5000/api/v1`
**API Key:** `banana` (passed via Basic Auth with empty username: `-u ":banana"`)

> **See also:** [Examples Index](../examples.md) | [Reference Documentation](../../reference/)

---

## Quick Start: Recommended Setup Order

1. **Create stock place(s)** without specifying an owner
2. **Add to agent's stockRoots** via `POST /v1/companies/{id}/stockRoots` or `POST /v1/stores/{id}/stockRoots`
3. **Create adjustment reasons** for tracking why inventory changes
4. **Create stock adjustments** to record inventory changes

```bash
# Step 1: Create stock place (owner is optional)
curl -X POST -u ":banana" "localhost:5000/api/v1/stock-places" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.stockPlaceId": "WH-001"},
    "name": "Main Warehouse"
  }'

# Step 2: Add to agent's stockRoots (preferred approach)
curl -X POST -u ":banana" "localhost:5000/api/v1/companies/com.heads.seedID=ourcompany/stockRoots" \
  -H "Content-Type: application/json" \
  -d '{"identifiers": {"com.myapp.stockPlaceId": "WH-001"}}'

# Step 3: Create adjustment reason
curl -X POST -u ":banana" "localhost:5000/api/v1/stock-adjustment-reasons" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.reasonId": "RESTOCK"},
    "name": "Restock",
    "active": true,
    "direction": "Increase"
  }'

# Step 4: Create stock adjustment (owner inferred from stock root)
curl -X POST -u ":banana" "localhost:5000/api/v1/stock-adjustments" \
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

---

## Stock Places

```bash
# List all stock places
curl -X GET -u ":banana" "localhost:5000/api/v1/stock-places"

# Get stock place by ID
curl -X GET -u ":banana" "localhost:5000/api/v1/stock-places/com.heads.seedID=warehouse1"

# Get stock place with children (sub-locations)
curl -X GET -u ":banana" "localhost:5000/api/v1/stock-places/com.heads.seedID=warehouse1~with(children)"

# Get stock place entries (current stock levels)
curl -X GET -u ":banana" "localhost:5000/api/v1/stock-places/com.heads.seedID=warehouse1/entries"

# Get stock transactions
curl -X GET -u ":banana" "localhost:5000/api/v1/stock-places/com.heads.seedID=warehouse1/transactions"

# Create a stock place (warehouse) - without owner (preferred)
curl -X POST -u ":banana" "localhost:5000/api/v1/stock-places" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.stockPlaceId": "WH-001"},
    "name": "Main Warehouse"
  }'

# Then add to agent's stockRoots (establishes ownership)
curl -X POST -u ":banana" "localhost:5000/api/v1/companies/com.heads.seedID=ourcompany/stockRoots" \
  -H "Content-Type: application/json" \
  -d '{"identifiers": {"com.myapp.stockPlaceId": "WH-001"}}'

# Alternative: Create with owner shorthand (manipulates stockRoots behind the scenes)
curl -X POST -u ":banana" "localhost:5000/api/v1/stock-places" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.stockPlaceId": "WH-002"},
    "name": "Secondary Warehouse",
    "owner": {"identifiers": {"com.heads.seedID": "ourcompany"}}
  }'

# Create child stock place (zone within warehouse)
# NOTE: The parent setter requires the database key (identifiers.key), not external IDs.
# Step 1: Get the parent's database key
curl -X GET -u ":banana" "localhost:5000/api/v1/stock-places/com.myapp.stockPlaceId=WH-001/identifiers/key"
# Returns the database key, e.g., "abc123..."

# Step 2: Create the child using the database key
curl -X POST -u ":banana" "localhost:5000/api/v1/stock-places" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.stockPlaceId": "WH-001-A"},
    "name": "Zone A",
    "parent": {"identifiers": {"key": "abc123..."}}
  }'

# Update stock place
curl -X PATCH -u ":banana" "localhost:5000/api/v1/stock-places/com.myapp.stockPlaceId=WH-001" \
  -H "Content-Type: application/json" \
  -d '{"name": "Central Distribution Warehouse"}'
```

> **Important:** The `parent` setter on stock places only accepts the database key via `identifiers.key`. External identifiers (like `com.myapp.stockPlaceId`) are not supported for relationship setters. Always fetch the parent's database key first using `/identifiers/key`.

---

## Stock Adjustments

Stock adjustments use an `items[]` array to adjust one or more products in a single transaction. Each item specifies a `product`, `place`, `reason`, and optional `quantity` (defaults to 1).

```bash
# List all stock adjustments
curl -X GET -u ":banana" "localhost:5000/api/v1/stock-adjustments"

# List stock adjustment reasons
curl -X GET -u ":banana" "localhost:5000/api/v1/stock-adjustment-reasons"

# Create stock adjustment reason
# NOTE: Only identifiers, name, active, and direction are supported - no description field.
curl -X POST -u ":banana" "localhost:5000/api/v1/stock-adjustment-reasons" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.reasonId": "DAMAGED"},
    "name": "Damaged Goods",
    "active": true,
    "direction": "Decrease"
  }'

# Create another adjustment reason (increase direction)
curl -X POST -u ":banana" "localhost:5000/api/v1/stock-adjustment-reasons" \
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
curl -X POST -u ":banana" "localhost:5000/api/v1/stock-adjustments" \
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

# Create stock adjustment (decrease) - negative quantity
curl -X POST -u ":banana" "localhost:5000/api/v1/stock-adjustments" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.adjustmentId": "ADJ-002"},
    "timestamp": "2024-03-15T14:00:00Z",
    "items": [
      {
        "product": {"identifiers": {"com.myapp.sku": "SKU-001"}},
        "place": {"identifiers": {"com.myapp.stockPlaceId": "WH-001"}},
        "reason": {"identifiers": {"com.myapp.reasonId": "DAMAGED"}},
        "quantity": -5
      }
    ]
  }'

# Create stock adjustment with multiple items (bulk adjustment)
curl -X POST -u ":banana" "localhost:5000/api/v1/stock-adjustments" \
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
curl -X POST -u ":banana" "localhost:5000/api/v1/stock-adjustments" \
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
curl -X GET -u ":banana" "localhost:5000/api/v1/stock-adjustments/com.myapp.adjustmentId=ADJ-001~with(items)"
```

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

```bash
# Reset all stock for an owner (offsets specified excess/deficit across all stock places)
curl -X POST -u ":banana" "localhost:5000/api/v1/stock-reset" \
  -H "Content-Type: application/json" \
  -d '{
    "owner": {"identifiers": {"com.heads.seedID": "ourcompany"}}
  }'

# Reset stock for a specific product only
curl -X POST -u ":banana" "localhost:5000/api/v1/stock-reset" \
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
