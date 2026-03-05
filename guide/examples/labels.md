# Working with Labels

Labels are lightweight, colored tags you can attach to entities across the API for organization, filtering, and workflow purposes. One label can be applied to many entities, and each entity can have many labels.

**Use cases:**
- Marking orders as "urgent" or "high-value"
- Tagging products as "seasonal" or "clearance"
- Categorizing customers by segment ("VIP", "wholesale")
- Flagging devices for maintenance
- Tracking integration sync state ("pending-sync", "synced-to-erp")

---

## Table of Contents

1. [Label Fields](#label-fields)
2. [Creating and Managing Labels](#creating-and-managing-labels)
3. [Supported Entity Types](#supported-entity-types)
4. [Assigning Labels to Entities](#assigning-labels-to-entities)
5. [Filtering and Querying by Labels](#filtering-and-querying-by-labels)
6. [Type Restrictions with applicableOnlyTo](#type-restrictions-with-applicableonlyto)
7. [Integration Patterns](#integration-patterns)
8. [Tips and Best Practices](#tips-and-best-practices)

---

## Label Fields

| Field | Type | Description |
|-------|------|-------------|
| `identifiers` | common identifiers | External identifiers (e.g., `com.myapp.labelId`) plus `identifiers.key` (database key) |
| `title` | string | Display title of the label |
| `description` | string (optional) | Longer description of the label's purpose |
| `color` | string (optional) | Color value — any CSS-parsable string (e.g., `#FF0000`, `red`) |
| `applicableOnlyTo` | string[] (optional) | Restricts which entity types the label can be applied to. Empty = applies to all types |
| `appliedToCount` | number (read-only) | Number of entities currently using this label |
| `owner` | agent reference (optional) | The owning agent (organization node). Uses `identifiers.key` for the setter |

---

## Creating and Managing Labels

### Create a label

```bash
curl -X POST -u ":banana" "localhost:5000/api/v1/labels" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.labelId": "urgent"},
    "title": "Urgent",
    "description": "High priority items requiring immediate attention",
    "color": "#FF0000"
  }'
```

### Upsert a label by external identifier

```bash
curl -X PUT -u ":banana" "localhost:5000/api/v1/labels/com.myapp.labelId=urgent" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.labelId": "urgent"},
    "title": "Urgent",
    "color": "#FF0000"
  }'
```

### Create a type-restricted label

```bash
curl -X POST -u ":banana" "localhost:5000/api/v1/labels" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.labelId": "order-flagged"},
    "title": "Flagged for Review",
    "color": "#FFA500",
    "applicableOnlyTo": ["TradeOrder"]
  }'
```

### Create a label with an owner

```bash
curl -X POST -u ":banana" "localhost:5000/api/v1/labels" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.labelId": "seasonal"},
    "title": "Spring 2026",
    "color": "#ffAAff",
    "owner": {"identifiers": {"com.myapp.companyId": "our-company"}}
  }'
```

### List all labels

```bash
# Basic list
curl -X GET -u ":banana" "localhost:5000/api/v1/labels"

# With pagination and ordering
curl -X GET -u ":banana" "localhost:5000/api/v1/labels~orderBy(title)~skip(20)~take(20)"

# Include type restrictions and applied count
curl -X GET -u ":banana" "localhost:5000/api/v1/labels~with(applicableOnlyTo,appliedToCount)"
```

### Get a single label

```bash
curl -X GET -u ":banana" "localhost:5000/api/v1/labels/com.myapp.labelId=urgent"
```

### Update a label

```bash
curl -X PATCH -u ":banana" "localhost:5000/api/v1/labels/com.myapp.labelId=urgent" \
  -H "Content-Type: application/json" \
  -d '{"color": "#CC0000", "description": "Updated description"}'
```

### Delete a label

```bash
# Check usage before deleting
curl -X GET -u ":banana" "localhost:5000/api/v1/labels/com.myapp.labelId=urgent~with(appliedToCount)"

# Delete
curl -X DELETE -u ":banana" "localhost:5000/api/v1/labels/com.myapp.labelId=urgent"
```

> Deleting a label removes it from all entities it was applied to.

---

## Supported Entity Types

Labels use the **same pattern** across all entity types — only the base URL changes.

| Resource | Collection endpoint | Labels on entity | Typical use cases |
|----------|-------------------|------------------|-------------------|
| Trade orders | `/v1/trade-orders` | `/v1/trade-orders/{id}/labels` | Priority, fulfillment channel, origin |
| Receipts | `/v1/receipts` | `/v1/receipts/{id}/labels` | Audit flags, return tracking |
| Shipment orders | `/v1/shipment-orders` | `/v1/shipment-orders/{id}/labels` | Carrier, urgency, warehouse zone |
| People | `/v1/people` | `/v1/people/{id}/labels` | VIP, lead status, customer segment |
| Companies | `/v1/companies` | `/v1/companies/{id}/labels` | Preferred supplier, partner tier |
| Stores | `/v1/stores` | `/v1/stores/{id}/labels` | Region, format, pilot program |
| Users | `/v1/users` | `/v1/users/{id}/labels` | Department, team, role tagging |
| Products | `/v1/products` | `/v1/products/{id}/labels` | Seasonal, clearance, new arrival |
| Product categories | `/v1/product-categories` | `/v1/product-categories/{id}/labels` | Category flags |
| Product families | `/v1/product-families` | `/v1/product-families/{id}/labels` | Family-level flags |
| POS terminals | `/v1/pos-terminals` | `/v1/pos-terminals/{id}/labels` | Lane type, express, self-checkout |
| Devices | `/v1/devices` | `/v1/devices/{id}/labels` | Maintenance needed, firmware group |
| Places | `/v1/places` | `/v1/places/{id}/labels` | Geographic tagging |
| Stock places | `/v1/stock-places` | `/v1/stock-places/{id}/labels` | Warehouse zone, temperature class |
| Countries | `/v1/countries` | `/v1/countries/{id}/labels` | Market region |
| Cities | `/v1/cities` | `/v1/cities/{id}/labels` | Metropolitan area |

> **Note:** Labels on entities are **non-essential fields** — they are not included in default responses. Use `~with(labels)` to expand them.

---

## Assigning Labels to Entities

All entity types use the same pattern for label operations:

```bash
# Assign a label (by external ID)
POST /v1/{resource}/{entityId}/labels
{"identifiers": {"com.myapp.labelId": "my-label"}}

# Remove a label (by external ID)
DELETE /v1/{resource}/{entityId}/labels/com.myapp.labelId=my-label

# Read labels on an entity
GET /v1/{resource}/{entityId}/labels

# Include labels in collection responses
GET /v1/{resource}~with(labels)
```

### Trade order examples

**Assign during order creation:**

```bash
curl -X POST -u ":banana" "localhost:5000/api/v1/trade-orders" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.orderId": "ORD-001"},
    "supplier": {"identifiers": {"com.myapp.companyId": "our-company"}},
    "customer": {"identifiers": {"com.myapp.customerId": "CUST-001"}},
    "sellers": [{"identifiers": {"com.myapp.storeId": "store-1"}}],
    "currency": {"identifiers": {"currencyCode": "SEK"}},
    "items": [{"product": {"identifiers": {"com.myapp.sku": "PHONE-001"}}, "quantity": "1"}],
    "labels": [{"identifiers": {"com.myapp.labelId": "urgent"}}]
  }'
```

**Assign to an existing order:**

```bash
curl -X POST -u ":banana" "localhost:5000/api/v1/trade-orders/com.myapp.orderId=ORD-001/labels" \
  -H "Content-Type: application/json" \
  -d '{"identifiers": {"com.myapp.labelId": "urgent"}}'
```

**Get order labels:**

```bash
curl -X GET -u ":banana" "localhost:5000/api/v1/trade-orders/com.myapp.orderId=ORD-001/labels"
```

**Remove a label:**

```bash
curl -X DELETE -u ":banana" "localhost:5000/api/v1/trade-orders/com.myapp.orderId=ORD-001/labels/com.myapp.labelId=urgent"
```

### Product examples

```bash
# Label a product as seasonal
curl -X POST -u ":banana" "localhost:5000/api/v1/products/com.myapp.sku=SKU-001/labels" \
  -H "Content-Type: application/json" \
  -d '{"identifiers": {"com.myapp.labelId": "seasonal"}}'

# Label a product category
curl -X POST -u ":banana" "localhost:5000/api/v1/product-categories/com.myapp.catId=accessories/labels" \
  -H "Content-Type: application/json" \
  -d '{"identifiers": {"com.myapp.labelId": "clearance"}}'
```

### People and company examples

```bash
# Label a customer as VIP
curl -X POST -u ":banana" "localhost:5000/api/v1/people/com.myapp.customerId=CUST-001/labels" \
  -H "Content-Type: application/json" \
  -d '{"identifiers": {"com.myapp.labelId": "vip"}}'

# Label a supplier as preferred
curl -X POST -u ":banana" "localhost:5000/api/v1/companies/com.myapp.companyId=SUP-001/labels" \
  -H "Content-Type: application/json" \
  -d '{"identifiers": {"com.myapp.labelId": "preferred-supplier"}}'
```

### Clearing all labels

Use `PUT` with an empty array or `PATCH` with `replace`:

```bash
# Clear all labels from an order
curl -X PUT -u ":banana" "localhost:5000/api/v1/trade-orders/com.myapp.orderId=ORD-001/labels" \
  -H "Content-Type: application/json" \
  -d '[]'

# Or via PATCH replace
curl -X PATCH -u ":banana" "localhost:5000/api/v1/trade-orders/com.myapp.orderId=ORD-001/labels" \
  -H "Content-Type: application/json" \
  -d '{"replace": []}'
```

---

## Filtering and Querying by Labels

Use `~where(labels~any(...))` to filter entities by their labels:

```bash
# Orders with a specific label
curl -X GET -u ":banana" \
  "localhost:5000/api/v1/trade-orders~with(labels)~where(labels~any(identifiers/com.myapp.labelId=urgent))"

# Combine label filter with other conditions
curl -X GET -u ":banana" \
  "localhost:5000/api/v1/trade-orders~with(labels)~where(labels~any(identifiers/com.myapp.labelId=urgent))~orderBy(timestamp:desc)~take(20)"

# Products with seasonal label
curl -X GET -u ":banana" \
  "localhost:5000/api/v1/products~with(labels,prices)~where(labels~any(identifiers/com.myapp.labelId=seasonal))"

# VIP customers
curl -X GET -u ":banana" \
  "localhost:5000/api/v1/people~with(labels)~where(labels~any(identifiers/com.myapp.labelId=vip))~take(50)"

# Suppliers with preferred label
curl -X GET -u ":banana" \
  "localhost:5000/api/v1/companies~with(labels)~where(labels~any(identifiers/com.myapp.labelId=preferred-supplier))~take(20)"
```

---

## Type Restrictions with `applicableOnlyTo`

Labels can be restricted to specific entity types using `applicableOnlyTo`. When set, the API rejects attempts to assign the label to unsupported types.

### How it works

- **Empty or absent:** The label applies to any entity type
- **Set to type names:** Only entities of those types (or subtypes) can receive the label
- **Error on mismatch:** `"Label 'X' is not applicable for objects of this type"`

### Type names

Use Heidi type names in `applicableOnlyTo`:

| Entity | Type name |
|--------|-----------|
| Trade orders | `TradeOrder` |
| Shipment orders | `ShipmentOrder` |
| Receipts | `Receipt` |
| People | `person` |
| Companies | `company` |
| Stores | `store` |
| Products | `product` |
| Product families | `product family` |
| Product categories | varies by category type |
| Users | `user` |
| POS terminals | `POS terminal` |
| Devices | `device` |

> Type checking uses the Heidi type hierarchy — if an instance's type or any ancestor type matches a value in `applicableOnlyTo`, the label is applicable.

### Examples

```bash
# Create a label restricted to orders only
curl -X POST -u ":banana" "localhost:5000/api/v1/labels" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.labelId": "fulfillment-hold"},
    "title": "Fulfillment Hold",
    "color": "#FF6600",
    "applicableOnlyTo": ["TradeOrder"]
  }'

# This succeeds — trade orders are in the allowed types
curl -X POST -u ":banana" "localhost:5000/api/v1/trade-orders/com.myapp.orderId=ORD-001/labels" \
  -H "Content-Type: application/json" \
  -d '{"identifiers": {"com.myapp.labelId": "fulfillment-hold"}}'

# This fails — products are not in the allowed types
curl -X POST -u ":banana" "localhost:5000/api/v1/products/com.myapp.sku=SKU-001/labels" \
  -H "Content-Type: application/json" \
  -d '{"identifiers": {"com.myapp.labelId": "fulfillment-hold"}}'
# → 400: Label 'Fulfillment Hold' is not applicable for objects of this type
```

### Managing type restrictions after creation

`applicableOnlyTo` is an add/remove array. Add or remove type restrictions individually:

```bash
# Add a type to an existing label's restrictions
curl -X POST -u ":banana" "localhost:5000/api/v1/labels/com.myapp.labelId=fulfillment-hold/applicableOnlyTo" \
  -H "Content-Type: application/json" \
  -d '"ShipmentOrder"'

# Remove a type from restrictions
curl -X DELETE -u ":banana" "localhost:5000/api/v1/labels/com.myapp.labelId=fulfillment-hold/applicableOnlyTo/TradeOrder"

# Replace all restrictions
curl -X PUT -u ":banana" "localhost:5000/api/v1/labels/com.myapp.labelId=fulfillment-hold/applicableOnlyTo" \
  -H "Content-Type: application/json" \
  -d '["TradeOrder", "ShipmentOrder"]'
```

---

## Integration Patterns

### Order routing

Assign labels based on business rules, then let downstream systems poll for orders with specific labels:

```bash
# Label high-value orders
# (Integration logic: if order total > 10000 SEK, assign "high-value")
curl -X POST -u ":banana" "localhost:5000/api/v1/trade-orders/com.myapp.orderId=ORD-001/labels" \
  -H "Content-Type: application/json" \
  -d '{"identifiers": {"com.myapp.labelId": "high-value"}}'

# Downstream: poll for high-value orders
curl -X GET -u ":banana" \
  "localhost:5000/api/v1/trade-orders~with(labels)~where(labels~any(identifiers/com.myapp.labelId=high-value))~take(100)"
```

### Sync status tracking

Track integration sync state using labels — assign "pending-sync" on creation, replace with "synced" or "sync-failed":

```bash
# Mark as pending sync
curl -X POST -u ":banana" "localhost:5000/api/v1/trade-orders/com.myapp.orderId=ORD-001/labels" \
  -H "Content-Type: application/json" \
  -d '{"identifiers": {"com.myapp.sync": "pending"}}'

# After successful sync — remove pending, add synced
curl -X DELETE -u ":banana" \
  "localhost:5000/api/v1/trade-orders/com.myapp.orderId=ORD-001/labels/com.myapp.sync=pending"

curl -X POST -u ":banana" "localhost:5000/api/v1/trade-orders/com.myapp.orderId=ORD-001/labels" \
  -H "Content-Type: application/json" \
  -d '{"identifiers": {"com.myapp.sync": "synced"}}'

# Query failed syncs
curl -X GET -u ":banana" \
  "localhost:5000/api/v1/trade-orders~with(labels)~where(labels~any(identifiers/com.myapp.sync=failed))~take(100)"
```

### Data segmentation for exports

Label entities for targeted exports, then combine with `~map()` for custom formats:

```bash
# Label products for export
curl -X POST -u ":banana" "localhost:5000/api/v1/products/com.myapp.sku=SKU-001/labels" \
  -H "Content-Type: application/json" \
  -d '{"identifiers": {"com.myapp.labelId": "export-ready"}}'

# Export labeled products with a mapped type
curl -X GET -u ":banana" \
  "localhost:5000/api/v1/products~where(labels~any(identifiers/com.myapp.labelId=export-ready))~map(product-export)"
```

### Webhook-based workflows

When configuring sync webhooks with `~with(labels)` expansion, downstream systems receive label data in the payload without re-querying:

```bash
# Webhook configured to push orders with labels
# The webhook source query includes ~with(labels):
#   GET /v1/trade-orders~with(labels,items)~where(...)
# Downstream receives labels in each order payload
```

---

## Tips and Best Practices

1. **Namespace your identifiers** — Use reverse-domain notation (`com.yourcompany.label-purpose`) for stable cross-system references. Avoid generic keys that might collide.

2. **Establish a color system** — Pick consistent colors across your label set: red = urgent/blocked, green = approved/synced, yellow = pending/review, blue = informational.

3. **Use `applicableOnlyTo` in multi-team environments** — Prevent accidental cross-entity labeling by restricting labels to their intended entity types.

4. **Check `appliedToCount` before deleting** — Understand the blast radius before removing a label:
   ```bash
   GET /v1/labels/com.myapp.labelId=old-label~with(appliedToCount)
   ```

5. **Labels are lightweight** — Prefer many specific labels over few overloaded generic ones. "sync-pending" + "sync-complete" + "sync-failed" is better than a single "sync-status" label.

6. **Single-label-per-state pattern** — For state tracking, remove the old state label before adding the new one. This keeps queries simple (`~where(labels~any(...))` returns entities currently in that state).

7. **Labels are non-essential** — They won't appear in default GET responses. Always use `~with(labels)` when you need them.

---

## See Also

- [Product label examples](products.md#labels) — Creating and assigning labels to products
- [Order label examples](../../reference/working-with/orders.md#labels) — Labeling trade orders
- [Customer/supplier label examples](../../reference/working-with/customers.md#labels) — Labeling people and companies
- [Resource patterns](../../reference/resource-patterns.md) — Label add/remove semantics on all resources
