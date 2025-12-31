# Orders Integration Guide: Trade Orders from External Systems

This guide provides a comprehensive template for integrating CommerceOS with order-placing systems (e-commerce platforms, EDI systems, B2B portals). It covers order creation, payment attachment, shipment handling, status tracking, webhooks, idempotency patterns, and production operations.

---

## Executive Summary

Order integration is where commerce comes to life. When external order systems connect seamlessly with CommerceOS, you unlock:

- **Omnichannel fulfillment** — Orders from webshop, app, and B2B flow through one system
- **Real-time inventory** — Stock reservations prevent overselling
- **Unified operations** — Warehouse staff see all orders in one place
- **Accurate financials** — Payment and order data stay synchronized
- **Customer visibility** — Order status flows back to customers

This guide provides a production-ready integration template with copy-paste payloads, sequence diagrams, and operational patterns.

---

## Table of Contents

1. [Business Value and ROI](#business-value-and-roi)
2. [Data Model Overview](#data-model-overview)
3. [Identifier Strategy](#identifier-strategy)
4. [Integration Architecture](#integration-architecture)
5. [Phase 1: Order Creation](#phase-1-order-creation)
6. [Phase 2: Payment Handling](#phase-2-payment-handling)
7. [Phase 3: Shipment Management](#phase-3-shipment-management)
8. [Phase 4: Status Synchronization](#phase-4-status-synchronization)
9. [Idempotency and Error Recovery](#idempotency-and-error-recovery)
10. [Webhook Configuration](#webhook-configuration)
11. [SLA and Throughput Guidance](#sla-and-throughput-guidance)
12. [Production Checklist](#production-checklist)
13. [Copy-Paste Payload Reference](#copy-paste-payload-reference)

---

## Business Value and ROI

### Quantifiable Benefits

| Benefit | Impact | How CommerceOS Enables It |
|---------|--------|---------------------------|
| **Reduced overselling** | 90%+ reduction in stock conflicts | Real-time stock reservation on order creation |
| **Faster fulfillment** | 30-50% reduction in pick-pack-ship time | Unified order queue with shipment orders |
| **Payment accuracy** | Near-zero payment reconciliation errors | Payment records linked to orders |
| **Customer satisfaction** | 20-40% fewer "where's my order" calls | Status webhooks enable proactive updates |
| **Operational visibility** | Real-time order status dashboards | Status progression and event timestamps |

### Integration Cost vs Value

The investment in proper order integration pays off through:

1. **Stock accuracy** — No more "sorry, we oversold" emails
2. **Operational efficiency** — Staff work from one system
3. **Customer trust** — Reliable delivery promises
4. **Financial integrity** — Orders and payments reconcile automatically

---

## Data Model Overview

### Order Entity Relationships

```
Trade Order
  ├── supplier (Agent) ─────────── Company providing goods
  ├── customer (Agent) ─────────── Company/person receiving goods
  ├── sellers (Agent[]) ────────── Stores fulfilling the order
  ├── currency (Currency) ──────── Transaction currency
  ├── items (OrderItem[]) ──────── Line items
  │     ├── product (Product) ──── Product reference
  │     ├── quantity / instances ── Count or serialized units
  │     └── amounts (calculated) ── Unit and line totals
  ├── payments (Payment[]) ──────── Payment records
  ├── shipments (Shipment[]) ────── Delivery records
  ├── deliveryAddresses ─────────── Shipping addresses
  └── invoiceAddresses ──────────── Billing addresses
```

### Order Status Lifecycle

Trade order status is a read-only string array that reflects the current state of the order. Common statuses include `New` and `Committed`. Item-level status details track fulfillment progress per item.

```
┌───────────┐
│    New    │   Order created
└─────┬─────┘
      │
      │ tryApprove
      ▼
┌───────────┐   tryCancel    ┌───────────┐
│ Committed │ ──────────────►│ Cancelled │
└─────┬─────┘                └───────────┘
      │
      │ createShipment (via actions)
      ▼
┌───────────────────────────────────────────┐
│  Shipment Order                            │
│  (separate resource with its own status)   │
│  - status: New → Released → Transiting →   │
│            Acquired (+ Partially* variants)│
│  - action: release                         │
└───────────────────────────────────────────┘
```

**Note:** Stock reservation is controlled via the `reservedUntil` field on orders or items. Setting `reservedUntil` reserves stock until the specified time **and** moves the order/item status to `Reserved`. Fulfillment happens via shipment orders, which are separate resources.

### Status Reference

| Status | Description | Actions Available |
|--------|-------------|-------------------|
| `New` | Just created, awaiting approval | `tryApprove`, `createPayment`, `changeDeliveryAddress`, `changeInvoiceAddress` |
| `Reserved` | Stock reserved (via `reservedUntil`) | `tryApprove`, `createPayment`, `changeDeliveryAddress`, `changeInvoiceAddress` |
| `Committed` | Approved, ready for fulfillment | `createShipment`, `createPayment`, `tryCancel` |
| `Cancelled` | Order cancelled | (terminal state) |

> **Note:** `tryCancel` only works on `Committed` orders. Address changes are only allowed on `New` or `Reserved` orders.

**Item-Level Status:**
Each item has `statusDetails` showing per-quantity status (e.g., how many units are shipped vs pending). This enables partial fulfillment tracking.

**Actions Reference:**

| Action | Description |
|--------|-------------|
| `tryApprove` | Approve the order (New → Committed) |
| `tryCancel` | Cancel the order |
| `createShipment` | Create a shipment for eligible items |
| `createPayment` | Record a payment against the order |
| `changeInvoiceAddress` | Update invoice address |
| `changeDeliveryAddress` | Update delivery address |

### Required Fields for Order Creation

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `identifiers` | object | Yes | Namespaced external IDs |
| `supplier` | AgentRef | Yes | Company selling the goods |
| `customer` | AgentRef | Yes | Customer receiving the goods |
| `sellers` | AgentRef[] | Yes | Stores fulfilling (non-empty) |
| `currency` | CurrencyRef | Yes | Transaction currency |
| `items` | OrderItem[] | Yes | Line items (non-empty) |

---

## Identifier Strategy

### Recommended: Source System Identifier

Use your order system's native order ID:

```json
{
  "identifiers": {
    "com.acme.order-id": "WEB-2024-123456",
    "com.acme.channel": "webshop"
  }
}
```

### Namespace Convention

| System | Namespace | Example |
|--------|-----------|---------|
| Webshop | `com.acme.webshop-order` | `WEB-2024-123456` |
| B2B Portal | `com.acme.b2b-order` | `B2B-PO-98765` |
| EDI | `com.acme.edi-order` | `EDI-850-2024-001` |
| Mobile App | `com.acme.app-order` | `APP-2024-789012` |

### Idempotency via Identifier

The order identifier is your idempotency key:

```bash
# First request creates the order
PUT /v1/trade-orders/com.acme.order-id=WEB-2024-123456
{ ... order payload ... }

# Retry (network failure recovery) — same identifier, same result
PUT /v1/trade-orders/com.acme.order-id=WEB-2024-123456
{ ... order payload ... }
```

---

## Integration Architecture

### Data Flow Pattern

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Order Source Systems                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐                │
│  │ Webshop  │  │ B2B      │  │  EDI     │  │ Mobile   │                │
│  │          │  │ Portal   │  │          │  │  App     │                │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘                │
└───────┼─────────────┼─────────────┼─────────────┼──────────────────────┘
        │             │             │             │
        └─────────────┼─────────────┼─────────────┘
                      │             │
                      ▼             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      Integration Layer                                   │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────────────────┐  │
│  │ Order Mapping  │  │ Idempotency    │  │ Status Callbacks         │  │
│  └───────┬────────┘  └───────┬────────┘  └───────────┬──────────────┘  │
└──────────┼───────────────────┼───────────────────────┼─────────────────┘
           │                   │                       │
           ▼                   ▼                       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         CommerceOS                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │ Trade Orders │  │   Payments   │  │  Shipments   │  │   Stock     │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └─────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

### Typical Order Flow

```
External System                    CommerceOS
      │                                │
      │  1. PUT /trade-orders/{id}     │
      │ ───────────────────────────────►
      │                                │ Create order (status: New)
      │  2. Response: order created    │
      │ ◄───────────────────────────────
      │                                │
      │  3. PATCH /actions             │
      │     {createPayment: {...}}     │
      │ ───────────────────────────────►
      │                                │ Record payment
      │  4. Response: payment recorded │
      │ ◄───────────────────────────────
      │                                │
      │  5. PATCH /actions             │
      │     {tryApprove: true}         │
      │ ───────────────────────────────►
      │                                │ Approve → Committed
      │                                │ Reserve stock
      │  6. Response: approved         │
      │ ◄───────────────────────────────
      │                                │
      │                                │ (Warehouse picks & ships)
      │                                │
      │  7. Webhook: shipment complete │
      │ ◄───────────────────────────────
```

---

## Phase 1: Order Creation

### Basic Order

```bash
PUT /v1/trade-orders/com.acme.order-id=WEB-2024-123456
Content-Type: application/json

{
  "identifiers": {
    "com.acme.order-id": "WEB-2024-123456",
    "com.acme.channel": "webshop"
  },
  "supplier": {"identifiers": {"com.acme.company-id": "ACME-RETAIL"}},
  "customer": {"identifiers": {"com.acme.customer-id": "CUST-001"}},
  "sellers": [{"identifiers": {"com.acme.store-id": "WAREHOUSE-MAIN"}}],
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "items": [
    {
      "product": {"identifiers": {"com.acme.sku": "WIDGET-001"}},
      "quantity": 2
    }
  ]
}
```

### Order with Full Details

> **Note:** `deliveryAddresses` and `invoiceAddresses` are read-only on create. Set them via `changeDeliveryAddress` / `changeInvoiceAddress` actions after creating the order (only allowed when status is `New` or `Reserved`).

```bash
# Step 1: Create the order (addresses cannot be set on create)
PUT /v1/trade-orders/com.acme.order-id=WEB-2024-123457
Content-Type: application/json

{
  "identifiers": {
    "com.acme.order-id": "WEB-2024-123457",
    "com.acme.channel": "webshop",
    "com.acme.session-id": "sess_abc123"
  },
  "supplier": {"identifiers": {"com.acme.company-id": "ACME-RETAIL"}},
  "customer": {"identifiers": {"com.acme.customer-id": "CUST-002"}},
  "sellers": [{"identifiers": {"com.acme.store-id": "WAREHOUSE-MAIN"}}],
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "items": [
    {
      "product": {"identifiers": {"com.acme.sku": "WIDGET-001"}},
      "quantity": 2
    },
    {
      "product": {"identifiers": {"com.acme.sku": "GADGET-002"}},
      "quantity": 1
    }
  ]
}
```

```bash
# Step 2: Set delivery address via action
PATCH /v1/trade-orders/com.acme.order-id=WEB-2024-123457/actions
{
  "changeDeliveryAddress": {
    "line1": "Delivery Street 123",
    "line2": "Apt 4B",
    "postalCode": "11122",
    "cityName": "Stockholm",
    "countryCode": "SE",
    "attention": "John Doe"
  }
}
```

```bash
# Step 3: Set invoice address via action
PATCH /v1/trade-orders/com.acme.order-id=WEB-2024-123457/actions
{
  "changeInvoiceAddress": {
    "line1": "Invoice Street 456",
    "postalCode": "11133",
    "cityName": "Stockholm",
    "countryCode": "SE"
  }
}
```

### Order with Instance Tracking (Mobile Devices)

For serialized products, use `instances` instead of `quantity`:

```bash
PUT /v1/trade-orders/com.acme.order-id=WEB-2024-MOBILE-001
Content-Type: application/json

{
  "identifiers": {"com.acme.order-id": "WEB-2024-MOBILE-001"},
  "supplier": {"identifiers": {"com.acme.company-id": "ACME-MOBILE"}},
  "customer": {"identifiers": {"com.acme.customer-id": "CUST-003"}},
  "sellers": [{"identifiers": {"com.acme.store-id": "STORE-CENTRAL"}}],
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "items": [
    {
      "product": {"identifiers": {"com.acme.sku": "IPHONE-16-PRO"}},
      "instances": [{"imei": "359876543210123"}]
    },
    {
      "product": {"identifiers": {"com.acme.sku": "PLAN-UNLIMITED"}},
      "instances": [{"phoneImei": "359876543210123"}]
    },
    {
      "product": {"identifiers": {"com.acme.sku": "CASE-IPHONE-16"}},
      "quantity": 1
    }
  ]
}
```

**Critical: Instance Order Rule**
MobileDevice items must appear **before** MobilePlan items that reference them via `phoneImei`.

### Multi-Seller Order

When items ship from different locations:

```bash
PUT /v1/trade-orders/com.acme.order-id=WEB-2024-MULTI-001
Content-Type: application/json

{
  "identifiers": {"com.acme.order-id": "WEB-2024-MULTI-001"},
  "supplier": {"identifiers": {"com.acme.company-id": "ACME-RETAIL"}},
  "customer": {"identifiers": {"com.acme.customer-id": "CUST-004"}},
  "sellers": [
    {"identifiers": {"com.acme.store-id": "WAREHOUSE-NORTH"}},
    {"identifiers": {"com.acme.store-id": "WAREHOUSE-SOUTH"}}
  ],
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "items": [
    {
      "product": {"identifiers": {"com.acme.sku": "BULKY-ITEM"}},
      "quantity": 1
    },
    {
      "product": {"identifiers": {"com.acme.sku": "SMALL-ITEM"}},
      "quantity": 5
    }
  ]
}
```

### B2B Order (Purchase Order)

For purchase orders where you're the customer:

```bash
PUT /v1/trade-orders/com.acme.order-id=PO-2024-001
Content-Type: application/json

{
  "identifiers": {"com.acme.order-id": "PO-2024-001"},
  "supplier": {"identifiers": {"com.acme.supplier-id": "SUPPLIER-XYZ"}},
  "customer": {"identifiers": {"com.acme.company-id": "ACME-RETAIL"}},
  "sellers": [{"identifiers": {"com.acme.supplier-id": "SUPPLIER-XYZ"}}],
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "items": [
    {
      "product": {"identifiers": {"com.acme.sku": "RAW-MATERIAL-001"}},
      "quantity": 1000
    }
  ]
}
```

---

## Phase 2: Payment Handling

### Payment via Order Action

Record payments using the order actions endpoint:

```bash
PATCH /v1/trade-orders/com.acme.order-id=WEB-2024-123456/actions
Content-Type: application/json

{
  "createPayment": {
    "transactionId": "STRIPE-PI-abc123xyz",
    "timestamp": "2024-12-15T14:32:00Z",
    "method": {"identifiers": {"methodId": "com.heads.card"}},
    "currency": {"identifiers": {"currencyCode": "SEK"}},
    "amount": 497.50
  }
}
```

### Split Payment (Multiple Methods)

```bash
# First payment: Gift card
PATCH /v1/trade-orders/com.acme.order-id=WEB-2024-123456/actions
{
  "createPayment": {
    "transactionId": "GIFTCARD-GC-001",
    "timestamp": "2024-12-15T14:32:00Z",
    "method": {"identifiers": {"methodId": "com.heads.store-credit"}},
    "currency": {"identifiers": {"currencyCode": "SEK"}},
    "amount": 100.00
  }
}

# Second payment: Credit card (remaining balance)
PATCH /v1/trade-orders/com.acme.order-id=WEB-2024-123456/actions
{
  "createPayment": {
    "transactionId": "STRIPE-PI-def456",
    "timestamp": "2024-12-15T14:32:30Z",
    "method": {"identifiers": {"methodId": "com.heads.card"}},
    "currency": {"identifiers": {"currencyCode": "SEK"}},
    "amount": 397.50
  }
}
```

### Payment Methods

Payment method identifiers are namespaced. Query `/v1/payment-methods` to get the valid method IDs for your installation. Common examples:

| Method ID | Description |
|-----------|-------------|
| `com.heads.card` | Credit/debit card |
| `com.heads.cash` | Cash payment |
| `com.heads.store-credit` | Store credit |
| `com.heads.wolt` | Wolt payment |
| `com.heads.klarna.ecommerce` | Klarna e-commerce |

> **Note:** Always query `GET /v1/payment-methods` to discover available payment methods and their configuration.

### Payment Orders

Payment orders can be created directly via `POST /v1/payment-orders` **or** via the trade order `createPayment` action.

**Option 1: Direct creation**

```bash
POST /v1/payment-orders
{
  "identifiers": {"com.acme.paymentOrderId": "PO-001"},
  "amount": "500.00",
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "method": {"identifiers": {"methodId": "com.heads.card"}},
  "payer": {"identifiers": {"com.acme.customer-id": "CUST-001"}},
  "payee": {"identifiers": {"com.acme.store-id": "STORE-001"}}
}
```

**Option 2: Via trade order action (recommended for order-linked payments)**

```bash
PATCH /v1/trade-orders/com.acme.order-id=WEB-2024-123456/actions
{
  "createPayment": {
    "transactionId": "STRIPE-PI-abc123xyz",
    "timestamp": "2024-12-15T14:32:00Z",
    "method": {"identifiers": {"methodId": "com.heads.card"}},
    "currency": {"identifiers": {"currencyCode": "SEK"}},
    "amount": 497.50
  }
}
```

To query payment orders associated with an order:

```bash
GET /v1/trade-orders/com.acme.order-id=WEB-2024-123456~with(payments)
```

### Verify Payment Status

```bash
# Get order with payments
GET /v1/trade-orders/com.acme.order-id=WEB-2024-123456~with(payments,totalAmount)

# Response includes payment status
{
  "totalAmount": "497.50",
  "payments": [
    {"amount": "100.00", "method": {"identifiers": {"methodId": "com.heads.store-credit"}}},
    {"amount": "397.50", "method": {"identifiers": {"methodId": "com.heads.card"}}}
  ]
}
```

---

## Phase 3: Shipment Management

### Approve Order (Commit Stock)

Before shipping, approve the order to reserve stock:

```bash
PATCH /v1/trade-orders/com.acme.order-id=WEB-2024-123456/actions
{
  "tryApprove": true
}
```

**Effects of tryApprove:**
- Status changes to `Committed`
- Order is ready for fulfillment

**Preconditions:**
- Order must be in `New` or `Reserved` status
- All items must have valid prices

**Note:** Stock reservation is controlled via `reservedUntil`. Setting `reservedUntil` reserves stock **and** moves status to `Reserved`. You can approve directly from either `New` or `Reserved` status.

### Create Shipment via Order Action

```bash
PATCH /v1/trade-orders/com.acme.order-id=WEB-2024-123456/actions
{
  "createShipment": true
}
```

### Shipment Orders

Shipment orders can be created directly via `POST /v1/shipment-orders` **or** via the trade order `createShipment` action.

**Option 1: Direct creation**

```bash
POST /v1/shipment-orders
{
  "identifiers": {"com.acme.shipmentOrderId": "SO-001"},
  "shipper": {"identifiers": {"com.acme.company-id": "ACME-RETAIL"}},
  "recipient": {"identifiers": {"com.acme.customer-id": "CUST-001"}},
  "items": [
    {
      "product": {"identifiers": {"com.acme.sku": "WIDGET-001"}},
      "quantity": 2
    }
  ]
}
```

**Option 2: Via trade order action (recommended for order-linked shipments)**

```bash
# Create shipment for all eligible items
PATCH /v1/trade-orders/com.acme.order-id=WEB-2024-123456/actions
{
  "createShipment": true
}
```

When created via trade order action, the shipment order is populated with:
- `sender` and `receiver` from the trade order
- `source` and `destination` from the order's addresses
- `carrier` configured at the store/order level

### Query Shipment Details

```bash
# Get shipments for an order
GET /v1/trade-orders/com.acme.order-id=WEB-2024-123456~with(shipments)

# Get shipment with full details
GET /v1/shipment-orders/{shipment-key}~with(items,orders,status,records)
```

### Release Shipment (Mark as Shipped)

Once items are physically shipped, use the release action:

```bash
PATCH /v1/shipment-orders/{shipment-key}/actions
{
  "release": true
}
```

### Partial Fulfillment

For partial shipments, the system creates multiple shipment orders as items are fulfilled. Track item-level status via the trade order's item status details:

```bash
# Get order with item-level fulfillment status
GET /v1/trade-orders/com.acme.order-id=WEB-2024-123456~with(items~with(statusDetails,shipmentItems))
```

### Query Order Shipments

```bash
# Get order shipments
GET /v1/trade-orders/com.acme.order-id=WEB-2024-123456/shipments

# Get order with shipments expanded
GET /v1/trade-orders/com.acme.order-id=WEB-2024-123456~with(shipments)
```

---

## Phase 4: Status Synchronization

### Poll Order Status

```bash
# Get order status
GET /v1/trade-orders/com.acme.order-id=WEB-2024-123456~with(status)

# Response
{
  "identifiers": {"com.acme.order-id": "WEB-2024-123456"},
  "status": ["Committed"]
}
```

### Batch Status Check

```bash
# Get multiple orders with status
GET /v1/trade-orders~where(identifiers/com.acme.channel=webshop)~with(status)~take(100)
```

### Status Webhook (Push Model)

Configure CommerceOS to push status changes. First, create a mapped type for the transformation:

```bash
# Step 1: Create the mapped type
# Note: identifiers.mappedTypeName is the name field (no top-level "name")
PUT /v1/mapped-types/com.acme.mapped-type=order-status-map
{
  "identifiers": {
    "mappedTypeName": "order-status-map",
    "com.acme.mapped-type": "order-status-map"
  },
  "active": true,
  "body": {
    "orderId": "identifiers/com.acme.order-id",
    "status": "status",
    "timestamp": "timestamp"
  }
}
```

```bash
# Step 2: Retrieve the mapped type's database key
GET /v1/mapped-types/com.acme.mapped-type=order-status-map~just(identifiers)
# Response includes: { "identifiers": { "key": "...", ... } }
```

```bash
# Step 3: Create the sync webhook referencing the mapped type by database key
PUT /v1/sync-webhooks/com.acme.sync-id=order-status-push
{
  "identifiers": {"com.acme.sync-id": "order-status-push"},
  "name": "Order Status Push",
  "description": "Push order status changes to webshop",
  "when": "api/v1/now/+=0:1:0",
  "repeat": true,
  "maxAttempts": 3,
  "in": {
    "url": "api/v1/trade-orders~where(status=Committed)~with(status,identifiers)~take(50)"
  },
  "map": {
    "identifiers": {"key": "<mapped-type-db-key>"}
  },
  "out": {
    "method": "POST",
    "url": "https://your-webshop.example.com/api/orders/status",
    "auth": {
      "authorizationHeader": "Bearer YOUR_WEBHOOK_SECRET"
    }
  },
  "then": {
    "set": {
      "identifiers": {
        "com.acme.status-synced": "true"
      }
    }
  },
  "authorizedScopes": ["read:orders", "write:orders"],
  "verboseLogging": false
}
```

> **Important:** Sync webhooks require referencing an existing **active** mapped type by its **database key** (`identifiers.key`). The setter uses `MappedType.fromKey(value.identifiers.key)` internally, so namespaced identifiers won't work. Inline `map.body` payloads are ignored.

### Status Mapping to External System

| CommerceOS Status | Webshop Status | Customer Message |
|-------------------|----------------|------------------|
| New | pending | Order received |
| Committed | confirmed | Order confirmed, preparing |
| Cancelled | cancelled | Order cancelled |

**Shipment-Based Status Mapping:**

For shipment progress, query shipment orders associated with the trade order:

| Shipment Status | Webshop Status | Customer Message |
|-----------------|----------------|------------------|
| `New` | processing | Preparing shipment |
| `Released` | released | Ready for pickup |
| `Transiting` | shipped | Order shipped |
| `Acquired` | delivered | Order delivered |

> **Note:** Partial fulfillment produces `Partially*` variants (e.g., `PartiallyReleased`). Only the `release` action is exposed via the API; there are no `ship` or `deliver` actions.

---

## Idempotency and Error Recovery

### Idempotent Order Creation

Use PUT with the order identifier for safe retries:

```bash
# Request 1: Creates order
PUT /v1/trade-orders/com.acme.order-id=WEB-2024-123456
{ ... order payload ... }

# Response: 201 Created

# Request 2 (retry after network timeout): Updates existing order
PUT /v1/trade-orders/com.acme.order-id=WEB-2024-123456
{ ... same payload ... }

# Response: 200 OK (order unchanged if payload identical)
```

### Check Before Create Pattern

For POST operations or when you need to verify:

```bash
# Check if order exists
GET /v1/trade-orders/com.acme.order-id=WEB-2024-123456

# If 404: Create order
# If 200: Order already exists, check status
```

### Payment Idempotency

Payments use `transactionId` for idempotency:

```bash
# First attempt
PATCH /v1/trade-orders/com.acme.order-id=WEB-2024-123456/actions
{
  "createPayment": {
    "transactionId": "STRIPE-PI-abc123xyz",
    "amount": 497.50,
    ...
  }
}

# Retry with same transactionId is safe
# Same transactionId = same payment record
```

### Error Recovery Matrix

| Scenario | Detection | Recovery |
|----------|-----------|----------|
| Network timeout on order create | No response | Retry PUT (idempotent) |
| Network timeout on payment | No response | Retry with same transactionId |
| Order rejected (400) | Error response | Fix payload, retry |
| Item out of stock | 409 Conflict | Cancel order, notify customer |
| Payment failed | Payment provider error | Retry or request new payment |

### Retry Strategy

```
Retry 1: Immediate
Retry 2: 1 second delay
Retry 3: 2 seconds delay
Retry 4: 5 seconds delay
Retry 5: 10 seconds delay
After 5 retries: Send to dead letter queue
```

### Dead Letter Handling

For orders that fail after all retries:

1. Log full request/response
2. Store in dead letter table
3. Alert operations team
4. Manual review and resolution
5. Replay after fix

---

## Webhook Configuration

### Order Created → External System

```bash
PUT /v1/sync-webhooks/com.acme.sync-id=order-created-webhook
{
  "identifiers": {"com.acme.sync-id": "order-created-webhook"},
  "name": "New Order Notification",
  "description": "Notify external systems of new orders",
  "when": "api/v1/now/+=0:1:0",
  "repeat": true,
  "maxAttempts": 3,
  "in": {
    "url": "api/v1/trade-orders~where(status=New)~with(items,customer,deliveryAddresses)~take(50)"
  },
  "out": {
    "method": "POST",
    "url": "https://your-system.example.com/webhooks/orders/new",
    "auth": {
      "clientCredentials": {
        "tokenUrl": "https://your-system.example.com/oauth/token",
        "client_id": "YOUR_CLIENT_ID",
        "client_secret": "YOUR_CLIENT_SECRET",
        "scope": "orders.write"
      }
    }
  },
  "authorizedScopes": ["read:orders"],
  "verboseLogging": false
}
```

### Shipment Completed → Update External System

To track fulfillment, monitor shipment orders rather than trade order status. First, create a mapped type:

```bash
# Step 1: Create the mapped type for shipment data
PUT /v1/mapped-types/com.acme.mapped-type=shipment-completed-map
{
  "identifiers": {
    "mappedTypeName": "shipment-completed-map",
    "com.acme.mapped-type": "shipment-completed-map"
  },
  "active": true,
  "body": {
    "shipmentId": "identifiers/key",
    "orderId": "orders/0/identifiers/com.acme.order-id",
    "status": "status",
    "trackingUrl": "carriersTrackingUrl"
  }
}
```

```bash
# Step 2: Retrieve the mapped type's database key
GET /v1/mapped-types/com.acme.mapped-type=shipment-completed-map~just(identifiers)
# Response includes: { "identifiers": { "key": "...", ... } }
```

```bash
# Step 3: Create the sync webhook referencing the mapped type by database key
PUT /v1/sync-webhooks/com.acme.sync-id=shipment-completed-webhook
{
  "identifiers": {"com.acme.sync-id": "shipment-completed-webhook"},
  "name": "Shipment Completed Notification",
  "description": "Notify when shipments are completed",
  "when": "api/v1/now/+=0:2:0",
  "repeat": true,
  "maxAttempts": 3,
  "in": {
    "url": "api/v1/shipment-orders~where(identifiers/com.acme.shipped-notified=null)~with(orders,status)~take(50)"
  },
  "map": {
    "identifiers": {"key": "<mapped-type-db-key>"}
  },
  "out": {
    "method": "POST",
    "url": "https://your-webshop.example.com/webhooks/shipments/completed",
    "auth": {
      "authorizationHeader": "Bearer WEBHOOK_SECRET"
    }
  },
  "then": {
    "set": {
      "identifiers": {
        "com.acme.shipped-notified": "true"
      }
    }
  },
  "authorizedScopes": ["read:shipments", "write:shipments"],
  "verboseLogging": false
}
```

### Webhook Security Best Practices

1. **Use HTTPS** — Always use secure endpoints
2. **Authenticate** — Use OAuth 2.0 or Bearer tokens
3. **Verify payloads** — Validate incoming webhook data
4. **Idempotent receivers** — Handle duplicate deliveries
5. **Respond quickly** — Return 2xx within 5 seconds

---

## SLA and Throughput Guidance

### Expected Performance

| Operation | Typical Latency | Throughput |
|-----------|-----------------|------------|
| Order creation | 100-300ms | 100+ orders/second |
| Payment recording | 50-100ms | 200+ payments/second |
| Status query | 20-50ms | 500+ queries/second |
| Bulk operations | 1-5s per batch | 1000+ items/batch |

### Batch Size Recommendations

| Operation | Recommended Batch Size |
|-----------|----------------------|
| Order queries | 50-100 per page |
| Bulk status updates | 100-500 per batch |
| NDJSON streaming | 1000+ items |

### Rate Limiting

CommerceOS applies rate limiting to protect system stability:

- Standard tier: 100 requests/second
- High-volume: Contact support for increased limits

### Peak Traffic Handling

For high-traffic events (flash sales, Black Friday):

1. **Pre-create products and prices** before the event
2. **Use PUT for idempotency** — safe retries
3. **Batch status checks** instead of individual queries
4. **Configure webhooks** to push status updates

### Monitoring Recommendations

| Metric | Threshold | Action |
|--------|-----------|--------|
| Order creation latency | > 500ms | Investigate |
| Error rate | > 1% | Alert |
| Queue depth | > 1000 orders | Scale |
| Payment success rate | < 95% | Review payment provider |

---

## Production Checklist

### Pre-Launch

- [ ] **Identifier namespace** — Confirm namespace (e.g., `com.acme.order-id`)
- [ ] **Field mapping** — Document external → CommerceOS mapping
- [ ] **Product setup** — All products exist with prices
- [ ] **Customer setup** — Customer records exist or create on first order
- [ ] **Payment methods** — Payment method identifiers configured

### Integration Setup

- [ ] **OAuth scopes** — Obtain scopes: `read:orders`, `write:orders`, `read:payments`, `write:payments`
- [ ] **Test environment** — Validate integration in staging
- [ ] **Idempotency** — Verify retry logic works correctly
- [ ] **Error handling** — Implement retry and dead letter logic

### Order Flow Validation

- [ ] **Create order** — Basic order creation works
- [ ] **Add payment** — Payment recording works
- [ ] **Approve order** — Status transitions correctly
- [ ] **Create shipment** — Shipment creation works
- [ ] **Cancel order** — Cancellation works

### Go-Live

- [ ] **Webhook endpoints** — External endpoints ready
- [ ] **Monitoring** — Order processing dashboards configured
- [ ] **Alerting** — Alerts for failures and SLA breaches
- [ ] **Runbook** — Document manual intervention procedures

### Post-Launch

- [ ] **Performance** — Monitor latency and throughput
- [ ] **Error rates** — Track and investigate failures
- [ ] **Reconciliation** — Verify order counts match between systems

---

## Copy-Paste Payload Reference

### Complete Order Creation

> **Note:** Addresses are set via actions after order creation. See [Order with Full Details](#order-with-full-details) for the complete flow.

```bash
# Step 1: Create the order
PUT /v1/trade-orders/com.acme.order-id=COMPLETE-ORDER-001
Content-Type: application/json

{
  "identifiers": {
    "com.acme.order-id": "COMPLETE-ORDER-001",
    "com.acme.channel": "webshop",
    "com.acme.session-id": "sess_xyz789"
  },
  "supplier": {"identifiers": {"com.acme.company-id": "ACME-RETAIL"}},
  "customer": {"identifiers": {"com.acme.customer-id": "CUST-VIP-001"}},
  "sellers": [{"identifiers": {"com.acme.store-id": "WAREHOUSE-MAIN"}}],
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "items": [
    {
      "product": {"identifiers": {"com.acme.sku": "PREMIUM-WIDGET"}},
      "quantity": 2
    },
    {
      "product": {"identifiers": {"com.acme.sku": "ACCESSORY-PACK"}},
      "quantity": 1
    },
    {
      "product": {"identifiers": {"com.acme.sku": "EXTENDED-WARRANTY"}},
      "quantity": 1
    }
  ]
}
```

```bash
# Step 2: Set delivery address
PATCH /v1/trade-orders/com.acme.order-id=COMPLETE-ORDER-001/actions
{
  "changeDeliveryAddress": {
    "line1": "Storgatan 123",
    "line2": "Apt 4B",
    "postalCode": "11456",
    "cityName": "Stockholm",
    "regionName": "Stockholm",
    "countryCode": "SE",
    "attention": "John Doe"
  }
}
```

```bash
# Step 3: Set invoice address
PATCH /v1/trade-orders/com.acme.order-id=COMPLETE-ORDER-001/actions
{
  "changeInvoiceAddress": {
    "line1": "Fakturagatan 456",
    "postalCode": "11457",
    "cityName": "Stockholm",
    "countryCode": "SE"
  }
}
```

### Complete Payment Flow

```bash
# Step 1: Create order
PUT /v1/trade-orders/com.acme.order-id=PAYMENT-FLOW-001
{
  "identifiers": {"com.acme.order-id": "PAYMENT-FLOW-001"},
  "supplier": {"identifiers": {"com.acme.company-id": "ACME-RETAIL"}},
  "customer": {"identifiers": {"com.acme.customer-id": "CUST-002"}},
  "sellers": [{"identifiers": {"com.acme.store-id": "STORE-001"}}],
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "items": [
    {"product": {"identifiers": {"com.acme.sku": "ITEM-001"}}, "quantity": 1}
  ]
}

# Step 2: Record payment
PATCH /v1/trade-orders/com.acme.order-id=PAYMENT-FLOW-001/actions
{
  "createPayment": {
    "transactionId": "STRIPE-PI-complete123",
    "timestamp": "2024-12-15T14:35:00Z",
    "method": {"identifiers": {"methodId": "com.heads.card"}},
    "currency": {"identifiers": {"currencyCode": "SEK"}},
    "amount": 299.00
  }
}

# Step 3: Approve order
PATCH /v1/trade-orders/com.acme.order-id=PAYMENT-FLOW-001/actions
{
  "tryApprove": true
}
```

### Complete Fulfillment Flow

```bash
# Step 1: Create shipment via order action
PATCH /v1/trade-orders/com.acme.order-id=PAYMENT-FLOW-001/actions
{
  "createShipment": true
}

# Step 2: Get the created shipment key
GET /v1/trade-orders/com.acme.order-id=PAYMENT-FLOW-001/shipments~just(identifiers)

# Step 3: Release shipment (mark as shipped)
PATCH /v1/shipment-orders/{shipment-key}/actions
{
  "release": true
}
```

> **Note:** Shipment orders can be created directly via POST or via the trade order `createShipment` action. Use the `release` action on the shipment to mark it as shipped.

### Verification Queries

```bash
# Get order with full details
GET /v1/trade-orders/com.acme.order-id=COMPLETE-ORDER-001~with(items,payments,shipments,status,deliveryAddresses,customer)

# Get orders by channel
GET /v1/trade-orders~where(identifiers/com.acme.channel=webshop)~orderBy(timestamp:desc)~take(50)

# Get orders by status
GET /v1/trade-orders~where(status=Committed)~take(100)

# Get orders for customer
GET /v1/trade-orders~where(customer/identifiers/com.acme.customer-id=CUST-VIP-001)~take(50)

# Count orders by status
GET /v1/trade-orders~where(status=New)~count

# Get order payments
GET /v1/trade-orders/com.acme.order-id=COMPLETE-ORDER-001/payments

# Get order shipments
GET /v1/trade-orders/com.acme.order-id=COMPLETE-ORDER-001/shipments
```

### Cancel Order

```bash
PATCH /v1/trade-orders/com.acme.order-id=CANCEL-THIS-ORDER/actions
{
  "tryCancel": true
}
```

### Refund Payment

```bash
PATCH /v1/trade-orders/com.acme.order-id=REFUND-ORDER/actions
{
  "createPayment": {
    "transactionId": "REFUND-001",
    "timestamp": "2024-12-16T10:00:00Z",
    "method": {"identifiers": {"methodId": "com.heads.card"}},
    "currency": {"identifiers": {"currencyCode": "SEK"}},
    "amount": -299.00
  }
}
```

---

## Related Documentation

- [Working with Orders](../working-with/orders.md) — Detailed order field reference
- [Working with Products](../working-with/products.md) — Product setup for orders
- [Working with Prices](../working-with/prices.md) — Pricing configuration
- [Working with Stock](../working-with/stock.md) — Inventory management
- [Sync Webhooks](../sync-webhooks.md) — Webhook configuration
- [Pagination](../pagination.md) — Large result set handling
