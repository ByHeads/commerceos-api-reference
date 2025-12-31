# Retail Integration Template: ERP/Back-Office to Heads

This guide provides a practical integration template for connecting an ERP or back-office system (such as BC) to Heads (CommerceOS) in a typical retail rollout.

---

## Executive Summary

A successful retail integration coordinates catalog, pricing, inventory, and receipts across systems. The business impact is direct: **stock accuracy, correct pricing at POS, and reliable financial reporting** depend on well-designed data flows.

In this model:
- **Heads** is the operational platform handling POS, inventory, and transactions
- **BC** (or your ERP) is the master data source for products, pricing, and configuration

This guide provides a project-style roadmap for integrators—not an endpoint list, but a pattern to follow.

---

## Data Flow Overview

Data flows in two directions:

```
┌─────────────────┐                        ┌─────────────────┐
│                 │  Master data, config   │                 │
│   BC / ERP      │ ─────────────────────► │   Heads         │
│   (Back-Office) │                        │   (CommerceOS)  │
│                 │ ◄───────────────────── │                 │
└─────────────────┘  Transactions, stock   └─────────────────┘
```

### BC → Heads (Master Data + Configuration)

Push products, stores, pricing, terminals, and stock from BC to Heads.

### Heads → BC (Transactional Outcomes)

Pull or push receipts, stock movements, and inventory changes back to BC.

**Heads → BC options:**
- **Pull model:** BC polls Heads at a regular cadence (simpler to start)
- **Push model:** Heads uses sync-webhooks to send data to BC (lower latency)

---

## Integration Phases

Follow these phases for a structured rollout:

| Phase | Focus | Key Activities |
|-------|-------|----------------|
| **1. Foundation** | Identifiers, stores, terminals, scopes | Establish namespace conventions, configure stores/terminals, obtain OAuth scopes |
| **2. Catalog & Pricing** | Products, price lists, discounts | Initial catalog load, pricing rules, discount configuration |
| **3. Inventory & Stock** | Stock places, stock adjustments | Map stock locations, run initial stock load |
| **4. Operations** | Receipts, stock movements | Configure receipt export, stock adjustment roundtrip |
| **5. Monitoring** | Retries, reconciliation, exceptions | Track sync status, handle failures, reconcile data |

---

## BC → Heads Flows

### Product Data

**Business purpose:** Products form the core catalog powering orders and POS. Without accurate product data, pricing, inventory, and sales cannot function.

**Direction:** BC → Heads

**Cadence:** Initial full load, then incremental updates (by ID or updatedAt filter if available).

**Example:**

```bash
# Batch upsert products (JSON array)
PUT /v1/products
[
  {
    "identifiers": {
      "com.northwind-retail.bc-id": "SKU-001",
      "com.northwind-retail.gtin": "0731234567890"
    },
    "name": "Wireless Headphones",
    "status": "Active",
    "gtin": ["0731234567890"]
  },
  {
    "identifiers": {
      "com.northwind-retail.bc-id": "SKU-002",
      "com.northwind-retail.gtin": "0731234567897"
    },
    "name": "Noise Cancelling Earbuds",
    "status": "Active",
    "gtin": ["0731234567897"]
  }
]
```

For larger catalogs, use NDJSON to stream batch updates:

```bash
# Batch upsert products (NDJSON)
PUT /v1/products
Content-Type: application/x-ndjson
{"identifiers":{"com.northwind-retail.bc-id":"SKU-003"},"name":"Canvas Tote","status":"Active"}
{"identifiers":{"com.northwind-retail.bc-id":"SKU-004"},"name":"Insulated Bottle","status":"Active"}
```

For incremental updates, upsert by external ID:

```bash
# Update a specific product by external ID
PUT /v1/products/com.northwind-retail.bc-id=SKU-001
{
  "name": "Wireless Headphones",
  "identifiers": { "com.northwind-retail.bc-id": "SKU-001" },
  "status": "Active"
}
```

---

### Stores

**Business purpose:** Stores define the operational scope for stock and sales. Each store needs correct address and contact data for receipts and logistics.

**Direction:** BC → Heads

**Cadence:** Initial setup, then on change.

**Example:**

```bash
# Upsert stores in bulk
PUT /v1/stores
[
  {
    "identifiers": { "com.northwind-retail.store-id": "STORE-001" },
    "name": "Downtown Flagship",
    "owner": { "identifiers": { "com.northwind-retail.org-id": "ORG-001" } },
    "addresses": {
      "main": {
        "line1": "Sveavagen 100",
        "postalCode": "11121",
        "cityName": "Stockholm",
        "countryCode": "SE"
      }
    }
  }
]
```

---

### POS Terminals

**Business purpose:** Device provisioning and POS pairing. Terminals must exist before receipts can be generated.

**Direction:** BC → Heads

**Cadence:** Initial setup, then on hardware changes.

**Example:**

```bash
# Upsert POS terminals
PUT /v1/pos-terminals
[
  {
    "identifiers": { "posTerminalName": "Register 1" },
    "name": "Register 1",
    "profile": { "identifiers": { "posProfileId": "default" } },
    "associatedNode": { "identifiers": { "com.northwind-retail.store-id": "STORE-001" } }
  }
]
```

---

### Payment Terminals

**Business purpose:** Payment device configuration (e.g., Adyen terminals). Required for card payment flows.

**Direction:** BC → Heads

**Cadence:** Initial setup, then on device changes.

**Example:**

```bash
# Upsert payment terminals
PUT /v1/payment-terminals
[
  {
    "identifiers": { "com.northwind-retail.terminal-id": "TERM-001" },
    "name": "Card Terminal 1"
  }
]
```

If your integration supports direct terminal communication, include the optional fields:
`method` (payment method reference) and `directUrl` (terminal API endpoint).

> **Note:** The schema marks `method` and `directUrl` as required, but current behavior allows creating a payment terminal with just `identifiers` and `name`. The field `associatedNode` is not supported on payment terminals.

---

### Stock Places

**Business purpose:** Inventory locations for stock movements. Stock places define where stock lives.

**Direction:** BC → Heads

**Cadence:** Initial setup, then on location changes.

**Example:**

```bash
# Upsert stock places (warehouse + zone)
PUT /v1/stock-places
[
  {
    "identifiers": { "com.northwind-retail.stock-place-id": "WH-001" },
    "name": "Main Warehouse",
    "owner": { "identifiers": { "com.northwind-retail.org-id": "ORG-001" } }
  },
  {
    "identifiers": { "com.northwind-retail.stock-place-id": "WH-001-A" },
    "name": "Zone A",
    "parent": { "identifiers": { "com.northwind-retail.stock-place-id": "WH-001" } }
  }
]
```

---

### Stock Adjustments (Deliveries In)

**Business purpose:** Stock intake and reconciliation. Adjustments record goods received, counted, or transferred.

**Direction:** BC → Heads

**Cadence:** Per delivery or on a schedule.

**Example:**

```bash
# Create a stock adjustment (uses items with product, place, and reason)
POST /v1/stock-adjustments
{
  "identifiers": { "com.northwind-retail.adjustment-id": "ADJ-2024-001" },
  "timestamp": "2024-01-15T10:00:00Z",
  "items": [
    {
      "product": { "identifiers": { "com.northwind-retail.bc-id": "SKU-001" } },
      "place": { "identifiers": { "com.northwind-retail.stock-place-id": "STORE-1" } },
      "reason": { "identifiers": { "com.northwind-retail.reason-id": "DELIVERY" } },
      "quantity": 50
    }
  ]
}
```

> **Note:** `quantity` defaults to 1 if omitted. The `owner` can be inferred from the place if not specified.

---

### Price Data

**Business purpose:** Ensures POS uses correct price rules. Prices have validity windows and currency scoping.

**Direction:** BC → Heads

**Cadence:** Initial load, then on price changes.

**Example:**

```bash
# Upsert prices in bulk (includes required buyers + from/to)
PUT /v1/prices
[
  {
    "identifiers": { "com.northwind-retail.price-id": "PRICE-001" },
    "products": [{ "identifiers": { "com.northwind-retail.bc-id": "SKU-001" } }],
    "sellers": [{ "identifiers": { "com.northwind-retail.org-id": "ORG-001" } }],
    "buyers": [],
    "amount": "799.00",
    "currency": { "identifiers": { "currencyCode": "SEK" } },
    "from": "2024-01-01T00:00:00Z",
    "to": "2099-12-31T23:59:59Z"
  }
]
```

> **Note:** Essential fields are `identifiers`, `sellers`, `buyers`, `amount`, `currency`, `from`, `to`. An empty `buyers` array means "applies to all buyers". Use a far-future `to` date for prices without expiration.

---

### Discount Rules (Trade Rules)

**Business purpose:** Centralized discount behavior in POS. Rules define automatic discounts and promotions using the `trade-rule` schema with item conditions and effects.

**Direction:** BC → Heads

**Cadence:** Initial load, then on rule changes.

**Example:**

```bash
# Upsert trade rules (discount rules)
PUT /v1/trade-rules
[
  {
    "identifiers": { "com.northwind-retail.rule-id": "DISC-2024-SUMMER" },
    "name": "Summer Sale 20%",
    "items": {
      "apparel": {
        "@type": "product condition",
        "include": [{ "identifiers": { "com.northwind-retail.bc-id": "SKU-001" } }],
        "atLeast": 1
      }
    },
    "effects": [{
      "@type": "percentage discount rule effect",
      "items": ["apparel"],
      "percentage": "20",
      "multiplicity": "PerUnit",
      "targeting": "All"
    }],
    "time": {
      "start": "2024-06-01T00:00:00Z",
      "end": "2024-08-31T23:59:59Z"
    }
  }
]
```

> **Note:** Discount rules use the trade-rule schema with `items` (product conditions), `effects` (discount rule effects), and `time` (validity window). The fields `discountPercentage`, `validFrom`, and `validTo` do not exist on trade-rules.

---

### Discount Reasons

**Business purpose:** Consistent discount classification for reporting and auditing.

**Direction:** BC → Heads

**Cadence:** Initial setup.

**Example:**

```bash
# Upsert discount reasons
PUT /v1/discount-reasons
[
  {
    "identifiers": { "com.northwind-retail.reason-id": "EMPLOYEE" },
    "name": "Employee Discount",
    "description": "Discount for staff purchases"
  }
]
```

---

### Return Reasons

**Business purpose:** Standard return codes for reporting and accounting.

**Direction:** BC → Heads

**Cadence:** Initial setup.

**Example:**

```bash
# Upsert return reasons
PUT /v1/return-reasons
[
  {
    "identifiers": { "com.northwind-retail.reason-id": "DEFECT" },
    "name": "Defective Item",
    "description": "Returned due to product defect"
  }
]
```

---

### Stock Adjustment Reasons

**Business purpose:** Enforce reason codes on stock adjustments for audit trails.

**Direction:** BC → Heads

**Cadence:** Initial setup.

**Example:**

```bash
# Upsert stock adjustment reasons
PUT /v1/stock-adjustment-reasons
[
  {
    "identifiers": { "com.northwind-retail.reason-id": "DAMAGED" },
    "name": "Damaged Goods",
    "description": "Product damaged and cannot be sold"
  }
]
```

---

## Heads → BC Flows

### Receipt Data

**Business purpose:** Financial reporting and accounting. Receipts are the source of truth for sales transactions.

**Direction:** Heads → BC

**Approach:** Pull or sync-webhook.

**Pull example:**

```bash
# Fetch recent receipts
GET /v1/receipts~orderBy(timestamp:desc)~take(100)
```

**Sync-webhook example:**

```json
{
  "identifiers": { "com.northwind-retail.sync-id": "receipt-export" },
  "name": "Receipt Export to BC",
  "description": "Push receipts to back-office for accounting",
  "when": "/v1/now/+=0:5:0",
  "repeat": true,
  "in": {
    "url": "/v1/receipts~orderBy(timestamp:desc)~take(50)"
  },
  "out": {
    "method": "POST",
    "url": "https://bc.example.com/webhooks/receipts",
    "auth": {
      "authorizationHeader": "Bearer REPLACE_WITH_TOKEN"
    }
  },
  "authorizedScopes": ["retail:read"]
}
```

---

### Stock Adjustments / Stocktaking

**Business purpose:** Inventory accuracy and reconciliation in BC. Stock movements from Heads must flow back to keep BC in sync.

**Direction:** Heads → BC

**Approach:** Pull or sync-webhook.

**Pull example:**

```bash
# Fetch recent stock adjustments
GET /v1/stock-adjustments~orderBy(timestamp:desc)~take(100)
```

**Sync-webhook example:**

```json
{
  "identifiers": { "com.northwind-retail.sync-id": "stock-sync" },
  "name": "Stock Adjustment Sync",
  "description": "Push stock adjustments to back-office",
  "when": "/v1/now/+=0:10:0",
  "repeat": true,
  "in": {
    "url": "/v1/stock-adjustments~orderBy(timestamp:desc)~take(50)"
  },
  "out": {
    "method": "POST",
    "url": "https://bc.example.com/webhooks/stock/adjustments",
    "auth": {
      "basic": { "username": "api", "password": "REPLACE_WITH_PASSWORD" }
    }
  },
  "authorizedScopes": ["stock:read"]
}
```

---

## Directional Strategy: Push vs Pull

| Approach | Best For | Considerations |
|----------|----------|----------------|
| **Pull** | Nightly/hourly sync, simpler setup | BC drives timing; may miss urgent changes |
| **Push (Webhooks)** | High-volume stores, near-real-time | Lower latency; requires BC webhook endpoint |

**Recommendation:**
- Start with pull for initial implementation and testing
- Migrate to webhooks for receipts and frequent inventory changes
- Keep pull as a fallback for reconciliation and error recovery

---

## Identifiers and Mapping

**Use namespaced external IDs for all cross-system entities.** This is the most critical integration requirement.

### Namespace Convention

Use a reverse-domain prefix based on your real domain to avoid clashes:
- If your integrator domain is `test-integrator.com`, use `com.test-integrator.*`
- Example product ID key: `com.test-integrator.bc-id`

Keep the same namespace across all entities (products, price lists, discount rules, stores) so references stay consistent.

### Common Identifier Strategies

- **BC-native ID:** `com.test-integrator.bc-id` for internal ERP keys
- **GTIN/EAN as common ID:** `com.test-integrator.gtin` when barcodes are the primary identifier
- **Dual identifiers:** store both BC IDs and GTIN/EAN so you can look up by either

### Cross-Entity Referencing

Use the same namespace keys everywhere you reference entities. For example, if product IDs are stored as
`com.test-integrator.bc-id`, then price rules, discount rules, and stock adjustments should reference
products using that same key.

### Why It Matters

- **Lookups:** Access resources directly by external ID
- **Updates:** Upsert with PUT using the external ID path
- **Merges:** Tie records across systems unambiguously

### Example

```bash
# Create or update a product by external ID
PUT /v1/products/com.test-integrator.bc-id=SKU-001
{
  "name": "Phone",
  "identifiers": {
    "com.test-integrator.bc-id": "SKU-001",
    "com.test-integrator.gtin": "0731234567890"
  }
}

# Look up the same product later
GET /v1/products/com.test-integrator.bc-id=SKU-001
```

---

## Data Quality and Validation

### Required Fields

Be aware of required fields for key resources:
- **Prices:** `identifiers`, `amount`, `currency`, `sellers`, `buyers`, `from`, `to` (note: currency defaults to USD, amount defaults to 0, buyers defaults to [], and from/to default to Time.always)
- **Trade orders:** `identifiers`, `items`, `sellers`, `supplier`, `customer`, `currency`
- **Stock adjustments:** `identifiers`, `timestamp`, `items` (each item needs `product`, `place`, `reason`; `quantity` defaults to 1)

### Common Pitfalls

| Issue | Impact | Prevention |
|-------|--------|------------|
| Missing identifiers | Cannot look up or update resources | Always include namespaced identifier |
| Invalid scope | 403 Forbidden | Verify OAuth client has required scopes |
| Missing `instanceType` | IMEI/instance tracking fails | Set `instanceType: "MobileDevice"` or `"MobilePlan"` on products |
| Missing required fields | 400 Bad Request | Check required fields for each resource type |

### Query Layer: Canonical Normalization Order

Query parameters and operators **can be mixed**; the system normalizes all parameters into a canonical order:

`format → fields → where → orderBy → skip → take → simpleJust`

**All of these are equivalent:**
```bash
# Query params only
GET /v1/products?orderby=name&limit=10

# Operators only
GET /v1/products~orderBy(name)~take(10)

# Mixed (supported)
GET /v1/products~orderBy(name)?limit=10
```

> **Note:** The system normalizes query params into operators after any path operators, following the canonical order above.

---

## Operational Cadence and Failure Handling

### Data Load Strategy

1. **Initial load:** Full catalog, stores, stock places, prices, configuration
2. **Incremental:** Filter by `updatedAt` or external ID for changed records
3. **Reconciliation:** Periodic full comparison to catch drift

### Retry Strategy

- **Idempotent writes:** Use PUT with external ID for safe retries
- **Retry backoff:** Implement exponential backoff for transient failures
- **Dead letter:** Track failed records for manual review

### Monitoring

- Track last successful sync timestamp per data type
- Alert on sync gaps exceeding expected cadence
- Monitor webhook retry counts (`attempts` field)

---

## Project Checklist

Use this checklist to track integration progress:

### Phase 1: Foundation
- [ ] Obtain OAuth scopes for org/products/stock/orders/prices/pos/retail/users
- [ ] Establish identifier namespace conventions (e.g., `com.test-integrator.*`)
- [ ] Document identifier mapping for products, stores, people

### Phase 2: Catalog & Pricing
- [ ] Run initial catalog sync (products with categories)
- [ ] Load price lists with validity windows
- [ ] Configure discount rules and reasons

### Phase 3: Inventory
- [ ] Map BC locations to Heads stock places
- [ ] Run initial stock load
- [ ] Configure stock adjustment reasons

### Phase 4: Operations
- [ ] Validate sample store + terminal setup
- [ ] Test receipt generation and export
- [ ] Validate stock adjustment roundtrip

### Phase 5: Monitoring
- [ ] Set up sync status tracking
- [ ] Configure failure alerts
- [ ] Document reconciliation procedures

---

## Related Documentation

For more detail on specific topics:

- [Operators Catalog](../operators-catalog.md) — Full operator reference with signatures and examples
- [Mapped Types](../mapped-types.md) — Transform data during sync with mapped types
- [Sync Webhooks](../sync-webhooks.md) — Configure push-based data flows
- [Primitives Guide](../primitives.md) — URL path operations for strings, numbers, dates
- [Common Gotchas](../common-gotchas.md) — Avoid common integration mistakes

---

## Adapting This Template

This guide uses "BC" as a placeholder for your back-office system. The patterns apply to any ERP or master data source:

- Replace `com.test-integrator.*` with your organization's namespace
- Adjust cadence to match your business requirements
- Add or remove data types based on your integration scope

The key principles remain constant: **use namespaced identifiers, choose one query layer, and design for idempotent operations.**
