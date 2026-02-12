# Working with Orders

This guide covers trade orders in CommerceOS: order creation, items, instance tracking (IMEI), discounts, payments, approvals, and the complete order-to-fulfillment lifecycle.

---

## Table of Contents

1. [Overview](#overview)
2. [Glossary](#glossary)
3. [Order Lifecycle](#order-lifecycle)
4. [Field Reference](#field-reference)
5. [Creating Orders](#creating-orders)
6. [Order Items](#order-items)
7. [Instance Tracking (IMEI/Serial)](#instance-tracking-imeiserial)
8. [Order Amounts and Totals](#order-amounts-and-totals)
9. [Manual Unit Amounts](#manual-unit-amounts)
10. [Discounts](#discounts)
11. [Order Actions](#order-actions)
12. [Payments](#payments)
13. [Shipments](#shipments)
14. [Order Addresses](#order-addresses)
15. [Labels](#labels)
16. [Returns and Refunds](#returns-and-refunds)
17. [Endpoint Matrix](#endpoint-matrix)
18. [Finder and Indexing Patterns](#finder-and-indexing-patterns)
19. [Error Handling and Validation](#error-handling-and-validation)
20. [Integration Playbook](#integration-playbook)
21. [Case Study: Mobile Device Bundle Sale](#case-study-mobile-device-bundle-sale)
22. [Business Rules and Pitfalls](#business-rules-and-pitfalls)
23. [Related Guides](#related-guides)

---

## Overview

Trade orders represent sales or purchase transactions between agents. Orders track their status as they progress through the fulfillment lifecycle, connecting customers, products, pricing, stock, and payments into a single transaction record.

**Key characteristics:**

- Orders require `items`, `sellers`, `supplier`, `customer`, and `currency`
- Items can track serialized instances (IMEI for mobile devices, phoneImei for plans)
- Orders support manual discounts at item level (order `manualDiscounts` is derived)
- Status is read-only and reflects the order's lifecycle
- Order items are immutable after creation
- Amounts are VAT-inclusive and calculated from product prices

**Order types:**

| Type | Supplier | Customer | Use Case |
|------|----------|----------|----------|
| Sales Order | Your company | External customer | B2C/B2B sales |
| Purchase Order | External supplier | Your company | Procurement |
| Internal Transfer | Your company | Your company | Inter-store transfers |

---

## Glossary

| Term | Definition |
|------|------------|
| **Trade Order** | A transaction record representing a sale or purchase between agents |
| **Order Item** | A line item in an order, referencing a product with quantity or instances |
| **Instance** | A serialized unit of a product (e.g., a specific phone with IMEI) |
| **Seller** | The agent (typically a store) where items are picked/fulfilled from |
| **Supplier** | The agent providing goods/services (seller of goods) |
| **Customer** | The agent receiving goods/services (buyer of goods) |
| **Manual Discount** | A discount applied manually to an item (order-level `manualDiscounts` is derived from item discounts) |
| **Payment** | A financial transaction settling part or all of an order |
| **Shipment** | Physical delivery of order items to the customer |
| **Committed** | Order status indicating approval and stock reservation |
| **Fulfilled** | Order status indicating delivery completion |

---

## Order Lifecycle

### Status Transitions

```
┌─────────┐
│   New   │
└────┬────┘
     │
     ▼
┌──────────┐
│ Reserved │
└────┬─────┘
     │ tryApprove
     ▼
┌───────────┐    tryCancel    ┌───────────┐
│ Committed │ ───────────────►│ Cancelled │
└─────┬─────┘                 └───────────┘
      │
      │ fulfill
      ▼
┌───────────┐
│ Fulfilled │
└─────┬─────┘
      │
      │ return flow
      ▼
┌────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ ReturnCommitted│───►│ ReturnFulfilled │    │ ReturnCancelled │
└────────────────┘    └─────────────────┘    └─────────────────┘
```

### Status Reference

| Status | Description | Transitions To |
|--------|-------------|----------------|
| `New` | Just created, no reservations | Reserved |
| `Reserved` | Stock reserved for the order | Committed, Unreserved |
| `Unreserved` | Reservation released | Reserved |
| `Committed` | Approved via `tryApprove` | Fulfilled, Cancelled |
| `Fulfilled` | Fully delivered to customer | ReturnCommitted |
| `Cancelled` | Order cancelled | (terminal) |
| `ReturnCommitted` | Return initiated | ReturnFulfilled, ReturnCancelled |
| `ReturnFulfilled` | Return completed | (terminal) |
| `ReturnCancelled` | Return cancelled | (terminal) |

> **Note:** Orders can have multiple statuses simultaneously. For example, a partially fulfilled order may show both `Committed` and `Fulfilled` statuses for different line items.

### Status Behavior

**Partial Statuses:**
```bash
# An order with 3 items where 2 are fulfilled
GET /v1/trade-orders/com.example.orderId=ORD-001~with(status,items.statusDetails)

# Response shows composite status with item-level details
{
  "status": ["Committed", "Fulfilled"],
  "items": [
    {"statusDetails": {"fulfilled": true}},
    {"statusDetails": {"fulfilled": true}},
    {"statusDetails": {"fulfilled": false}}
  ]
}
```

---

## Field Reference

### Order Fields (Essential)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `identifiers` | object | Yes | Namespaced identifiers for the order |
| `supplier` | AgentRef | Yes | Agent providing goods/services |
| `customer` | AgentRef | Yes | Agent receiving goods/services |
| `sellers` | AgentRef[] | Yes | Stores where items are picked (non-empty) |
| `currency` | CurrencyRef | Yes | Transaction currency |
| `items` | OrderItem[] | Yes | Line items (non-empty array) |

### Order Fields (Optional)

| Field | Type | Description |
|-------|------|-------------|
| `reservedUntil` | datetime | Stock reservation expiry (optional) |
| `labels` | Label[] | Assigned labels (add/remove semantics) |

### Order Fields (Read-Only - Set via Actions)

| Field | Type | Description |
|-------|------|-------------|
| `deliveryAddresses` | Address[] | Shipping addresses (set via `changeDeliveryAddress` action) |
| `invoiceAddresses` | Address[] | Billing addresses (set via `changeInvoiceAddress` action) |

### Order Fields (Read-Only)

| Field | Type | Description |
|-------|------|-------------|
| `status` | string[] | Current order status(es) |
| `timestamp` | datetime | Order creation timestamp |
| `totalAmount` | decimal | Total order amount |
| `balanceAmount` | decimal | Remaining balance after payments |
| `payments` | Payment[] | Associated payments |
| `shipments` | Shipment[] | Associated shipments |

### Order Item Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `product` | ProductRef | Yes | Product reference (namespaced) |
| `quantity` | decimal (string) | Conditional | Quantity ordered (use if not using instances) |
| `instances` | Instance[] | Conditional | Serialized instances (use if not using quantity) |

### Order Item Fields (Writable)

| Field | Type | Description |
|-------|------|-------------|
| `unitAmountExclVat` | decimal | Manual unit price excluding VAT (see [Manual Unit Amounts](#manual-unit-amounts)) |

### Order Item Fields (Read-Only)

| Field | Type | Description |
|-------|------|-------------|
| `totalAmount` | decimal | Line total (VAT-inclusive) |
| `unitAmountInclVat` | decimal | Unit price including VAT |
| `discountAmountInclVat` | decimal | Discount amount including VAT |
| `vatPercentage` | decimal | VAT percentage applied |
| `classification` | string | `Goods`, `Services`, or `Shipping` |
| `discountable` | boolean | Whether item accepts discounts |
| `statusDetails` | object | Item-level status information |

---

## Creating Orders

### Basic Sales Order

```bash
POST /v1/trade-orders
{
  "identifiers": {"com.example.orderId": "ORD-001"},
  "supplier": {"identifiers": {"com.example.companyId": "OUR-COMPANY"}},
  "customer": {"identifiers": {"com.example.customerId": "CUST-001"}},
  "sellers": [{"identifiers": {"com.example.storeId": "STORE-001"}}],
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "items": [
    {
      "product": {"identifiers": {"com.example.sku": "PROD-001"}},
      "quantity": 2
    }
  ]
}
```

Item amounts are derived from product prices; `unitAmountInclVat`, `totalAmount`, and other amount fields are read-only and VAT-inclusive.

### Required Fields Summary

| Field | Description |
|-------|-------------|
| `supplier` | Agent providing goods/services |
| `customer` | Agent receiving goods/services |
| `sellers` | Agents (stores) where items are picked |
| `currency` | Transaction currency |
| `items` | Order line items (at least 1 required) |

> **Important:** Both `items` and `sellers` must be non-empty arrays.

### Purchase Order

In a purchase order, your company is the customer:

```bash
POST /v1/trade-orders
{
  "identifiers": {"com.example.orderId": "PO-001"},
  "supplier": {"identifiers": {"com.example.supplierId": "SUPPLIER-001"}},
  "customer": {"identifiers": {"com.example.companyId": "OUR-COMPANY"}},
  "sellers": [{"identifiers": {"com.example.supplierId": "SUPPLIER-001"}}],
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "items": [
    {
      "product": {"identifiers": {"com.example.sku": "PROD-001"}},
      "quantity": 100
    }
  ]
}
```

### Order with Multiple Sellers

When items come from different stores:

```bash
POST /v1/trade-orders
{
  "identifiers": {"com.example.orderId": "ORD-MULTI"},
  "supplier": {"identifiers": {"com.example.companyId": "OUR-COMPANY"}},
  "customer": {"identifiers": {"com.example.customerId": "CUST-001"}},
  "sellers": [
    {"identifiers": {"com.example.storeId": "STORE-NORTH"}},
    {"identifiers": {"com.example.storeId": "STORE-SOUTH"}}
  ],
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "items": [
    {
      "product": {"identifiers": {"com.example.sku": "PROD-001"}},
      "quantity": 5
    },
    {
      "product": {"identifiers": {"com.example.sku": "PROD-002"}},
      "quantity": 3
    }
  ]
}
```

### Setting Addresses After Order Creation

Addresses cannot be set in the create payload. Use the `changeDeliveryAddress` and `changeInvoiceAddress` actions on orders with `New` or `Reserved` status:

```bash
# First create the order
POST /v1/trade-orders
{
  "identifiers": {"com.example.orderId": "ORD-ADDR"},
  "supplier": {"identifiers": {"com.example.companyId": "OUR-COMPANY"}},
  "customer": {"identifiers": {"com.example.customerId": "CUST-001"}},
  "sellers": [{"identifiers": {"com.example.storeId": "STORE-001"}}],
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "items": [
    {
      "product": {"identifiers": {"com.example.sku": "PROD-001"}},
      "quantity": 1
    }
  ]
}

# Then set addresses via actions (only works for New/Reserved orders)
PATCH /v1/trade-orders/com.example.orderId=ORD-ADDR/actions
{
  "changeDeliveryAddress": {
    "line1": "Delivery Street 123",
    "postalCode": "11122",
    "cityName": "Stockholm",
    "countryCode": "SE"
  }
}

PATCH /v1/trade-orders/com.example.orderId=ORD-ADDR/actions
{
  "changeInvoiceAddress": {
    "line1": "Invoice Street 456",
    "postalCode": "11133",
    "cityName": "Stockholm",
    "countryCode": "SE"
  }
}
```

### Idempotent Order Creation (PUT)

Use PUT for idempotent creation when the identifier is known:

```bash
PUT /v1/trade-orders/com.example.orderId=ORD-001
{
  "supplier": {"identifiers": {"com.example.companyId": "OUR-COMPANY"}},
  "customer": {"identifiers": {"com.example.customerId": "CUST-001"}},
  "sellers": [{"identifiers": {"com.example.storeId": "STORE-001"}}],
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "items": [
    {
      "product": {"identifiers": {"com.example.sku": "PROD-001"}},
      "quantity": 2
    }
  ]
}
```

---

## Order Items

### Item Structure

Each order item represents a line in the order:

```json
{
  "product": {"identifiers": {"com.example.sku": "PHONE-X"}},
  "quantity": 2
}
```

Or with a serialized instance:

```json
{
  "product": {"identifiers": {"com.example.sku": "PHONE-X"}},
  "instances": [{"imei": "123456789012345"}]
}
```

### Item Mutability

Order items are created with the order and are **read-only afterward**. Mutations via `/v1/trade-orders/{id}/items` are currently no-ops—use `/v1/trade-order-items/{id}` or `/v1/trade-order-items/key=...` for the limited updates that are supported (such as `unitAmountExclVat`). To change quantities or products, cancel and recreate the order with updated items.

**Why items are immutable:**
- Preserves audit trail integrity
- Ensures pricing consistency
- Maintains stock reservation accuracy
- Simplifies reconciliation

### Product Identifier Requirements

Product identifiers must use a **fully qualified namespace**:

```json
// WRONG - bare key
{"product": {"identifiers": {"sku": "PROD-001"}}}

// RIGHT - namespaced key
{"product": {"identifiers": {"com.example.sku": "PROD-001"}}}
```

### Item Classification

Items are automatically classified based on the product:

| Classification | Description | Examples |
|----------------|-------------|----------|
| `Goods` | Physical products and services | Phones, accessories, plans, subscriptions |
| `Shipping` | Delivery charges | Freight, express delivery |

> **Note:** The API currently returns only `Goods` or `Shipping`. The schema allows `Services` as a value, but the classification getter does not currently produce it—service products (like mobile plans) are classified as `Goods`.

```bash
# View item classifications
GET /v1/trade-orders/com.example.orderId=ORD-001/items~with(classification)
```

### Accessing Order Items

```bash
# All items
GET /v1/trade-orders/com.example.orderId=ORD-001/items

# Specific item by identifier
GET /v1/trade-orders/com.example.orderId=ORD-001/items/{itemId}

# Item count
GET /v1/trade-orders/com.example.orderId=ORD-001/items/count

# Items with full details
GET /v1/trade-orders/com.example.orderId=ORD-001/items~withAll
```

> **Note:** Access items by their identifier or key, not by index. Use the item's `id` field from the items collection.

---

## Instance Tracking (IMEI/Serial)

For serialized products (phones, devices), use `instances` instead of `quantity`. Instance tracking enables:

- Individual unit tracking through the supply chain
- IMEI/serial number association with sales
- Warranty and service history per unit
- Plan-to-device linking

### Instance Types

| Instance Type | Instance Field | Description |
|---------------|----------------|-------------|
| `MobileDevice` | `imei` | Device IMEI number |
| `MobilePlan` | `phoneImei` | References device IMEI from earlier item |

### Mobile Device with IMEI

```bash
POST /v1/trade-orders
{
  "identifiers": {"com.example.orderId": "ORD-DEVICE"},
  "supplier": {"identifiers": {"com.example.companyId": "OUR-COMPANY"}},
  "customer": {"identifiers": {"com.example.customerId": "CUST-001"}},
  "sellers": [{"identifiers": {"com.example.storeId": "STORE-001"}}],
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "items": [
    {
      "product": {"identifiers": {"com.example.sku": "PHONE-001"}},
      "instances": [{"imei": "123456789012345"}]
    }
  ]
}
```

### Mobile Plan with Phone Reference

Mobile plans reference the device's IMEI via `phoneImei`:

```bash
POST /v1/trade-orders
{
  "identifiers": {"com.example.orderId": "ORD-BUNDLE"},
  "supplier": {"identifiers": {"com.example.companyId": "OUR-COMPANY"}},
  "customer": {"identifiers": {"com.example.customerId": "CUST-001"}},
  "sellers": [{"identifiers": {"com.example.storeId": "STORE-001"}}],
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "items": [
    {
      "product": {"identifiers": {"com.example.sku": "PHONE-001"}},
      "instances": [{"imei": "123456789012345"}]
    },
    {
      "product": {"identifiers": {"com.example.sku": "PLAN-001"}},
      "instances": [{"phoneImei": "123456789012345"}]
    }
  ]
}
```

### Multiple Devices in One Order

> **Important:** Each order item supports only **one** `imei`/`phoneImei` entry per item. When multiple entries are provided in a single item's `instances` array, only the first is used. To order multiple serialized devices or plans, create separate items—one per IMEI.

```bash
POST /v1/trade-orders
{
  "identifiers": {"com.example.orderId": "ORD-MULTI-DEVICE"},
  "supplier": {"identifiers": {"com.example.companyId": "OUR-COMPANY"}},
  "customer": {"identifiers": {"com.example.customerId": "CUST-001"}},
  "sellers": [{"identifiers": {"com.example.storeId": "STORE-001"}}],
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "items": [
    {
      "product": {"identifiers": {"com.example.sku": "PHONE-001"}},
      "instances": [{"imei": "123456789012345"}]
    },
    {
      "product": {"identifiers": {"com.example.sku": "PHONE-001"}},
      "instances": [{"imei": "123456789012346"}]
    },
    {
      "product": {"identifiers": {"com.example.sku": "PHONE-001"}},
      "instances": [{"imei": "123456789012347"}]
    }
  ]
}
```

### Instance Tracking Rules

1. **Order matters:** A `MobilePlan` with `phoneImei` must appear **after** the `MobileDevice` item with the matching IMEI in the same order. The `phoneImei` field can only link to devices that appear **earlier** in the same order's item list.

2. **Product setup required:** Products need `instanceType` set during product creation:
   ```bash
   PUT /v1/products/com.example.sku=PHONE-001
   {"instanceType": "MobileDevice", ...}
   ```

3. **Instance count = quantity:** When using instances, the quantity is derived from the instance array length. For `MobileDevice` and `MobilePlan`, only the first `imei`/`phoneImei` entry is honored—use separate items for multiple devices or plans.

4. **IMEI uniqueness not enforced:** The API does not validate that an IMEI is unique within an order. Duplicate IMEIs in the same order will not trigger a validation error.

### Querying by Instance

```bash
# Find order containing a specific IMEI
GET /v1/trade-orders~where(items.instances.imei=123456789012345)~first

# Get instances for an order item (by item identifier)
GET /v1/trade-orders/com.example.orderId=ORD-001/items/{itemId}/instances
```

---

## Order Amounts and Totals

### Amount Calculation

Order amounts are calculated automatically based on:

1. **Product price** (from price list matching seller/currency)
2. **VAT code** (from product or product group)
3. **Quantity or instance count**
4. **Discounts** (if any)

### Amount Fields

| Level | Field | Description |
|-------|-------|-------------|
| Order | `totalAmount` | Grand total order amount (VAT-inclusive) |
| Order | `balanceAmount` | Remaining balance after payments |
| Item | `unitAmountInclVat` | Unit price including VAT |
| Item | `totalAmount` | Line total (VAT-inclusive) |
| Item | `discountAmountInclVat` | Discount amount including VAT |
| Item | `vatPercentage` | VAT percentage applied |

### Amount Calculation Example

All amounts are VAT-inclusive:

```
Product: Widget
Price: 199.00 SEK (including 25% VAT)
VAT Percentage: 25%
Quantity: 3

unitAmountInclVat = 199.00
totalAmount (item) = 199.00 × 3 = 597.00
totalAmount (order) = 597.00
balanceAmount = 597.00 (before payments)
```

### Fetching Amounts

```bash
# Order totals
GET /v1/trade-orders/com.example.orderId=ORD-001~with(totalAmount,balanceAmount)

# Item amounts
GET /v1/trade-orders/com.example.orderId=ORD-001/items~with(unitAmountInclVat,totalAmount,vatPercentage)
```

---

## Manual Unit Amounts

The `unitAmountExclVat` property allows you to set a manual unit price (excluding VAT) that overrides computed pricing. Once set, the item bypasses **price rules** but discounts still apply (unless `discountable=false` is also set on the item).

### When to Use Manual Unit Amounts

- **Custom pricing:** Override standard prices for special customers or negotiations
- **Promotional items:** Set items to zero cost for gifts or promotions
- **External pricing:** Apply prices from external systems (ERP, POS with embedded prices)
- **Price adjustments:** Correct pricing without creating new price list entries

### Setting Manual Unit Amounts

#### On Order Creation

Include `unitAmountExclVat` on items when creating the order:

```bash
POST /v1/trade-orders
{
  "identifiers": {"com.example.orderId": "ORD-MANUAL-001"},
  "supplier": {"identifiers": {"com.example.companyId": "OUR-COMPANY"}},
  "customer": {"identifiers": {"com.example.customerId": "CUST-001"}},
  "sellers": [{"identifiers": {"com.example.storeId": "STORE-001"}}],
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "items": [
    {
      "product": {"identifiers": {"com.example.sku": "SERVICE-INSTALL"}},
      "quantity": 1,
      "unitAmountExclVat": "129.00"
    }
  ]
}
```

#### Updating an Existing Item

Update the unit amount on an item that's still in an editable status (`New` only). Updates must target the `trade-order-items` resource—`/v1/trade-orders/{id}/items` mutations are no-ops:

```bash
PATCH /v1/trade-order-items/{itemId}
{
  "unitAmountExclVat": "129.00"
}
```

Or using the item's key directly:

```bash
PATCH /v1/trade-order-items/key=abc12345678901234567890123456
{
  "unitAmountExclVat": "149.50"
}
```

### Constraints

| Constraint | Description |
|------------|-------------|
| **Non-negative** | Value must be ≥ 0; negative amounts are rejected |
| **Editable items only** | Can only be set on items with `New` status |
| **Bypasses price rules** | Item no longer participates in price rules; discounts still apply unless `discountable=false` |
| **Decimal string format** | Use string values (e.g., `"129.00"`, not `129`) |

### Related Fields

| Field | Access | Description |
|-------|--------|-------------|
| `unitAmountExclVat` | Read/Write | Manual unit amount excluding VAT |
| `unitAmountInclVat` | Read-only | Calculated from `unitAmountExclVat` + VAT |
| `totalAmount` | Read-only | Line total (quantity × unit amount including VAT) |
| `vatPercentage` | Read-only | VAT percentage applied to this item |

### Example: Free Promotional Item

```bash
POST /v1/trade-orders
{
  "identifiers": {"com.example.orderId": "ORD-PROMO-001"},
  "supplier": {"identifiers": {"com.example.companyId": "OUR-COMPANY"}},
  "customer": {"identifiers": {"com.example.customerId": "CUST-001"}},
  "sellers": [{"identifiers": {"com.example.storeId": "STORE-001"}}],
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "items": [
    {
      "product": {"identifiers": {"com.example.sku": "MAIN-PRODUCT"}},
      "quantity": 1
    },
    {
      "product": {"identifiers": {"com.example.sku": "FREE-GIFT"}},
      "quantity": 1,
      "unitAmountExclVat": "0.00"
    }
  ]
}
```

### Notes

- **Clearing manual amounts:** There is no direct API to clear a manual unit amount. To revert to computed pricing, cancel and recreate the item, or handle it at the domain level.
- **VAT calculation:** The VAT percentage is determined by the product's VAT code configuration. `unitAmountInclVat` is calculated automatically.
- **Interaction with discounts:** If you also apply a `manualDiscount` to the item, the discount operates on top of the manual unit amount.
- **Order recalculation:** Setting `unitAmountExclVat` triggers automatic recalculation of all order totals.

---

## Discounts

### Discount Types

| Type | Description | Example |
|------|-------------|---------|
| `Percentage` | Percentage reduction | 10% off |
| `FixedReduction` | Fixed amount off | 50 SEK off |
| `FixedPrice` | Override to fixed price | Set price to 150 SEK |

### Manual Discounts

The order-level `manualDiscounts` field is **read-only and derived** from item-level discounts. Only item-level `manualDiscount` can be set.

```bash
# Get order with discounts (derived from items)
GET /v1/trade-orders/com.example.orderId=ORD-001~with(manualDiscounts)
```

### Applying Discounts

Manual discounts are applied at order creation time by including `manualDiscount` on individual items:

```bash
POST /v1/trade-orders
{
  "identifiers": {"com.example.orderId": "ORD-001"},
  "supplier": {"identifiers": {"com.example.companyId": "OUR-COMPANY"}},
  "customer": {"identifiers": {"com.example.customerId": "CUST-001"}},
  "sellers": [{"identifiers": {"com.example.storeId": "STORE-001"}}],
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "items": [
    {
      "product": {"identifiers": {"com.example.sku": "PROD-001"}},
      "quantity": 2,
      "manualDiscount": {"identifiers": {"com.example.discountId": "LOYALTY-10"}}
    }
  ]
}
```

> **Note:** Discounts are referenced by identifier and must exist as manual discount resources. There are no `applyDiscount` or `applyItemDiscount` order actions—manual discounts are set on items during creation and the `manualDiscount` fields are read-only afterward. The order's `manualDiscounts` collection is derived from item-level discounts.

### Item Discountability

Each item has a `discountable` flag indicating whether it accepts discounts:

```bash
# Check if items are discountable
GET /v1/trade-orders/com.example.orderId=ORD-001/items~with(discountable)
```

**Non-discountable items:**
- Shipping charges (often)
- Pre-discounted items
- Items with price matching

### Discount Stacking

When multiple discounts apply to an item:

1. The manual discount on the item is evaluated
2. Fixed price discounts override other discount types
3. Percentage and fixed reduction discounts are applied to the base price

---

## Order Actions

Order actions modify order state through a dedicated actions endpoint:

```bash
PATCH /v1/trade-orders/{identifier}/actions
{action: payload}
```

### Available Actions

| Action | Payload | Effect |
|--------|---------|--------|
| `tryApprove` | `true` | Commits the order (reserves stock) |
| `tryCancel` | `true` | Cancels the order (releases reservations) |
| `createPayment` | Payment object | Records a payment against the order |
| `createShipment` | `true` | Creates a shipment order unless a `New` shipment already exists |
| `changeDeliveryAddress` | Address object | Updates delivery address |
| `changeInvoiceAddress` | Address object | Updates invoice address |

### Approve Order (tryApprove)

```bash
PATCH /v1/trade-orders/com.example.orderId=ORD-001/actions
{"tryApprove": true}
```

**Effects:**
- Sets status to `Committed`
- Reserves stock for order items
- Triggers downstream workflows

**Preconditions:**
- Order must have status `New` **or** `Reserved` (only these statuses allow approval)
- All items must have valid prices
- Product instances must be available in stock

> **Warning:** If stock is insufficient for the requested items, the approval will fail with an error. Check stock availability before attempting to approve.

### Cancel Order (tryCancel)

```bash
PATCH /v1/trade-orders/com.example.orderId=ORD-001/actions
{"tryCancel": true}
```

**Effects:**
- Sets status to `Cancelled`
- Releases stock reservations

**Preconditions:**
- Order must have status `Committed` (only committed orders can be cancelled via this action)
- Orders in `New` or `Reserved` status cannot be cancelled with this action
- Orders in `Fulfilled` status cannot be cancelled (use return flow instead)

### Create Payment

Records a payment against the order.

```bash
PATCH /v1/trade-orders/com.example.orderId=ORD-001/actions
{
  "createPayment": {
    "transactionId": "TXN-001",
    "timestamp": "2024-12-15T10:30:00Z",
    "method": {"identifiers": {"methodId": "com.heads.card"}},
    "currency": {"identifiers": {"currencyCode": "SEK"}},
    "amount": 497.50
  }
}
```

**Required fields:**
- `transactionId` — Unique transaction identifier (string)
- `timestamp` — Payment timestamp (ISO 8601 datetime)

**Constraints:**
- Order must have exactly **one seller** and **one buyer** (multi-seller orders require standalone payment orders)
- Payment method must **not** have an associated integration (use standalone payment orders for integrated methods)
- Amount cannot be **zero**
- Currency must exist
- Any items included in the payload must belong to the order

**Default behavior:**
- If `amount` is omitted, defaults to the sum of all order items
- If `items` is provided, amount defaults to sum of specified items only

### Create Shipment

Creates a shipment order for the order.

```bash
PATCH /v1/trade-orders/com.example.orderId=ORD-001/actions
{"createShipment": true}
```

> **Note:** If a shipment with status `New` already exists for the order, no new shipment is created (idempotent behavior). The current implementation does not filter out items already on shipments—it simply prevents creating multiple `New` shipments.

### Change Addresses

```bash
# Change delivery address
PATCH /v1/trade-orders/com.example.orderId=ORD-001/actions
{
  "changeDeliveryAddress": {
    "line1": "New Street 123",
    "postalCode": "11122",
    "cityName": "Stockholm",
    "countryCode": "SE"
  }
}

# Change invoice address
PATCH /v1/trade-orders/com.example.orderId=ORD-001/actions
{
  "changeInvoiceAddress": {
    "line1": "Billing Street 456",
    "postalCode": "11133",
    "cityName": "Stockholm",
    "countryCode": "SE"
  }
}
```

**Preconditions:**
- Order status must be `New` or `Reserved` (address changes on other statuses are rejected)
- Orders with multiple existing invoice/delivery addresses cannot be changed via this action

### Action Error Handling

Actions return errors when preconditions aren't met:

```json
{
  "error": "OrderNotApprovable",
  "message": "Order cannot be approved: missing price for item 2",
  "details": {
    "itemIndex": 2,
    "productId": "com.example.sku=PROD-003"
  }
}
```

---

## Payments

### Payment Models

CommerceOS supports two payment approaches:

1. **Embedded payments** via order actions (simpler)
2. **Standalone payment orders** (more flexible)

### Get Order Payments

```bash
# Via sub-resource
GET /v1/trade-orders/com.example.orderId=ORD-001/payments

# Via projection
GET /v1/trade-orders/com.example.orderId=ORD-001~with(payments)
```

### Create Payment via Order Action

```bash
PATCH /v1/trade-orders/com.example.orderId=ORD-001/actions
{
  "createPayment": {
    "transactionId": "TXN-001",
    "timestamp": "2024-12-15T10:30:00Z",
    "method": {"identifiers": {"methodId": "com.heads.card"}},
    "currency": {"identifiers": {"currencyCode": "SEK"}},
    "amount": 497.50
  }
}
```

### Payment Order Creation

Payment orders can be created directly via `POST /v1/payment-orders` or via the trade order `createPayment` action.

```bash
# Direct creation
POST /v1/payment-orders
{
  "identifiers": {"com.example.paymentOrderId": "PO-001"},
  "amount": "500.00",
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "method": {"identifiers": {"methodId": "com.heads.card"}},
  "payer": {"identifiers": {"com.example.customerId": "CUST-001"}},
  "payee": {"identifiers": {"com.example.storeId": "STORE-001"}}
}
```

### Payment Methods

Payment methods use namespaced `methodId` values. Query available methods via:

```bash
GET /v1/payment-methods
```

Common payment method identifiers:

| Method ID | Description |
|-----------|-------------|
| `com.heads.card` | Credit/debit card |
| `com.heads.cash` | Cash payment |
| `com.heads.invoice` | Invoice/billing |
| `com.heads.swish` | Swish mobile payment |
| `com.heads.klarna` | Klarna payment |
| `com.heads.giftcard` | Gift card |

> **Note:** Always use `GET /v1/payment-methods` to retrieve valid payment method IDs for your environment. Method IDs are namespaced (e.g., `com.heads.cash`) and may vary by configuration.

### Split Payments

Orders can have multiple payments:

```bash
# First payment (partial)
PATCH /v1/trade-orders/com.example.orderId=ORD-001/actions
{
  "createPayment": {
    "transactionId": "TXN-001A",
    "timestamp": "2024-12-15T10:30:00Z",
    "method": {"identifiers": {"methodId": "com.heads.giftcard"}},
    "currency": {"identifiers": {"currencyCode": "SEK"}},
    "amount": 100.00
  }
}

# Second payment (remaining)
PATCH /v1/trade-orders/com.example.orderId=ORD-001/actions
{
  "createPayment": {
    "transactionId": "TXN-001B",
    "timestamp": "2024-12-15T10:31:00Z",
    "method": {"identifiers": {"methodId": "com.heads.card"}},
    "currency": {"identifiers": {"currencyCode": "SEK"}},
    "amount": 397.50
  }
}
```

### Payment Status

```bash
# Check payment status
GET /v1/trade-orders/com.example.orderId=ORD-001~with(payments,totalAmount,balanceAmount)

# Response
{
  "totalAmount": 497.50,
  "balanceAmount": 0.00,
  "payments": [
    {"amount": 100.00, "method": "giftcard"},
    {"amount": 397.50, "method": "card"}
  ]
}
```

---

## Shipments

### Get Order Shipments

```bash
GET /v1/trade-orders/com.example.orderId=ORD-001/shipments
```

### Shipment Order Creation

Shipment orders can be created directly via `POST /v1/shipment-orders` or via the trade order `createShipment` action.

```bash
# Direct creation
POST /v1/shipment-orders
{
  "identifiers": {"com.example.shipmentOrderId": "SO-001"},
  "shipper": {"identifiers": {"com.example.companyId": "OUR-COMPANY"}},
  "recipient": {"identifiers": {"com.example.customerId": "CUST-001"}},
  "items": [
    {
      "product": {"identifiers": {"com.example.sku": "PROD-001"}},
      "quantity": "5"
    }
  ]
}

# Via trade order action
PATCH /v1/trade-orders/com.example.orderId=ORD-001/actions
{"createShipment": true}
```

### Releasing Shipments

Once a shipment order exists, you can release it using the `release` action:

```bash
PATCH /v1/shipment-orders/com.example.shipmentId=SHIP-001/actions
{"release": true}
```

> **Note:** The `release` action is the only action available on shipment orders. Shipment creation and configuration are managed through trade order actions.

See the [Stock guide](stock.md) for detailed shipment management.

---

## Order Addresses

Orders have separate address collections for invoicing and delivery.

### Address Types

| Type | Purpose | Common Use |
|------|---------|------------|
| `deliveryAddresses` | Where to ship | Customer's home/office |
| `invoiceAddresses` | Where to bill | Customer's billing address |

### Get Addresses

```bash
# Get invoice addresses
GET /v1/trade-orders/com.example.orderId=ORD-001/invoiceAddresses

# Get delivery addresses
GET /v1/trade-orders/com.example.orderId=ORD-001/deliveryAddresses

# Both via projection
GET /v1/trade-orders/com.example.orderId=ORD-001~with(deliveryAddresses,invoiceAddresses)
```

### Address Structure

```json
{
  "line1": "Street Name 123",
  "line2": "Apartment 4B",
  "postalCode": "11122",
  "cityName": "Stockholm",
  "regionName": "Stockholm",
  "countryCode": "SE",
  "attention": "John Doe"
}
```

### Address Inheritance

If addresses aren't specified on the order, they may be inherited from the customer:

```bash
# Customer with default addresses
PUT /v1/people/com.example.customerId=CUST-001
{
  "givenName": "John",
  "familyName": "Doe",
  "addresses": {
    "home": {
      "line1": "Home Street 1",
      "postalCode": "11111",
      "cityName": "Stockholm",
      "countryCode": "SE"
    },
    "delivery": {
      "line1": "Delivery Street 2",
      "postalCode": "11112",
      "cityName": "Stockholm",
      "countryCode": "SE"
    }
  }
}
```

---

## Labels

Assign labels to orders for categorization, filtering, and workflow management.

### Creating an Order Label

```bash
# Create a label restricted to trade orders
POST /v1/labels
{
  "identifiers": {"com.example.labelId": "urgent"},
  "title": "Urgent",
  "color": "#FF0000",
  "applicableOnlyTo": ["TradeOrder"]
}
```

> **Note:** `applicableOnlyTo` uses Heidi type names. For trade orders, use `"TradeOrder"` (PascalCase). Labels without `applicableOnlyTo` (or with an empty array) are applicable to all entity types.

### Assigning Labels

```bash
# Assign label to an existing order
POST /v1/trade-orders/com.example.orderId=ORD-001/labels
{"identifiers": {"com.example.labelId": "urgent"}}

# Assign label during order creation
POST /v1/trade-orders
{
  "identifiers": {"com.example.orderId": "ORD-002"},
  "supplier": {"identifiers": {"com.example.companyId": "OUR-COMPANY"}},
  "customer": {"identifiers": {"com.example.customerId": "CUST-001"}},
  "sellers": [{"identifiers": {"com.example.storeId": "STORE-001"}}],
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "items": [{"product": {"identifiers": {"com.example.sku": "PROD-001"}}, "quantity": 1}],
  "labels": [{"identifiers": {"com.example.labelId": "urgent"}}]
}
```

### Reading and Filtering by Labels

```bash
# Get an order's labels
GET /v1/trade-orders/com.example.orderId=ORD-001/labels

# Get order with labels expanded
GET /v1/trade-orders/com.example.orderId=ORD-001~with(labels)

# Find orders with a specific label
GET /v1/trade-orders~with(labels)~where(labels~any(identifiers/com.example.labelId=urgent))~take(50)
```

### Removing Labels

```bash
# Remove label from an order
DELETE /v1/trade-orders/com.example.orderId=ORD-001/labels/com.example.labelId=urgent
```

---

## Returns and Refunds

### Return Flow

```
Original Order (Fulfilled)
         │
         ▼
┌─────────────────┐
│ ReturnCommitted │  (no API action yet)
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌─────────────────┐ ┌─────────────────┐
│ ReturnFulfilled │ │ ReturnCancelled │
└─────────────────┘ └─────────────────┘
```

### Initiating Returns

> **Note:** There is currently **no API action to initiate returns**. The `initiateReturn` action does not exist in the schema. Returns must be handled through other system workflows or manual processes. The return statuses (`ReturnCommitted`, `ReturnFulfilled`, `ReturnCancelled`) exist as order status values, but the API does not currently expose an action to trigger the return flow.

### Refund Processing

Refunds are processed as negative payments:

```bash
PATCH /v1/trade-orders/com.example.orderId=ORD-001/actions
{
  "createPayment": {
    "transactionId": "REFUND-001",
    "timestamp": "2024-12-20T14:00:00Z",
    "method": {"identifiers": {"methodId": "com.heads.card"}},
    "currency": {"identifiers": {"currencyCode": "SEK"}},
    "amount": -248.75
  }
}
```

---

## Endpoint Matrix

### Trade Orders

| Operation | Method | Endpoint | Use Case |
|-----------|--------|----------|----------|
| List orders | GET | `/v1/trade-orders~take(50)` | Browse orders |
| Get order | GET | `/v1/trade-orders/{id}` | Fetch single order |
| Create order | POST | `/v1/trade-orders` | New order (generates ID) |
| Upsert order | PUT | `/v1/trade-orders/{id}` | Idempotent create/update |
| Order actions | PATCH | `/v1/trade-orders/{id}/actions` | Approve, cancel, pay |
| Get items | GET | `/v1/trade-orders/{id}/items` | List line items |
| Get payments | GET | `/v1/trade-orders/{id}/payments` | List payments |
| Get shipments | GET | `/v1/trade-orders/{id}/shipments` | List shipments |
| Get addresses | GET | `/v1/trade-orders/{id}/deliveryAddresses` | Delivery addresses |
| Get labels | GET | `/v1/trade-orders/{id}/labels` | Order labels |
| Assign label | POST | `/v1/trade-orders/{id}/labels` | Add label to order |
| Remove label | DELETE | `/v1/trade-orders/{id}/labels/{labelId}` | Remove label from order |

### Payment Orders

| Operation | Method | Endpoint | Use Case |
|-----------|--------|----------|----------|
| List payments | GET | `/v1/payment-orders~take(50)` | Browse payments |
| Get payment | GET | `/v1/payment-orders/{id}` | Fetch single payment |
| Create payment | POST | `/v1/payment-orders` | Direct payment creation |

> **Note:** Payment orders can be created directly via POST or via the `createPayment` action on trade orders.

### Shipment Orders

| Operation | Method | Endpoint | Use Case |
|-----------|--------|----------|----------|
| List shipments | GET | `/v1/shipment-orders~take(50)` | Browse shipments |
| Get shipment | GET | `/v1/shipment-orders/{id}` | Fetch single shipment |
| Create shipment | POST | `/v1/shipment-orders` | Direct shipment creation |
| Release shipment | PATCH | `/v1/shipment-orders/{id}/actions` | Release shipment (`{"release": true}`) |

> **Note:** Shipment orders can be created directly via POST or via the `createShipment` action on trade orders.

---

## Finder and Indexing Patterns

### Basic Queries

```bash
# List all orders
GET /v1/trade-orders~take(50)

# Order with items
GET /v1/trade-orders/com.example.orderId=ORD-001~with(items)

# Order with customer and supplier
GET /v1/trade-orders/com.example.orderId=ORD-001~with(customer,supplier)

# Orders with all details
GET /v1/trade-orders/com.example.orderId=ORD-001~withAll
```

### Filtering

```bash
# Filter by status
GET /v1/trade-orders~where(status=Committed)~take(50)

# Filter by customer
GET /v1/trade-orders~where(customer.identifiers.com.example.customerId=CUST-001)~take(50)

# Filter by date range
GET /v1/trade-orders~where(timestamp>=2024-01-01)~where(timestamp<2024-02-01)~take(50)

# Filter by seller
GET /v1/trade-orders~where(sellers.identifiers.com.example.storeId=STORE-001)~take(50)
```

### Sorting

```bash
# Newest first
GET /v1/trade-orders~orderBy(timestamp:desc)~take(50)

# By timestamp
GET /v1/trade-orders~orderBy(timestamp:desc)~take(50)

# By amount
GET /v1/trade-orders~orderBy(totalAmount:desc)~take(50)
```

### Pagination

```bash
# First page
GET /v1/trade-orders~orderBy(timestamp:desc)~take(50)

# Next page (using skip)
GET /v1/trade-orders~orderBy(timestamp:desc)~skip(50)~take(50)

# With explicit offset
GET /v1/trade-orders~orderBy(timestamp:desc)~skip(100)~take(50)
```

### Projections

```bash
# Minimal projection
GET /v1/trade-orders/com.example.orderId=ORD-001~with(status,totalAmount)

# Full details
GET /v1/trade-orders/com.example.orderId=ORD-001~withAll

# Items with amounts
GET /v1/trade-orders/com.example.orderId=ORD-001/items~with(unitAmountInclVat,totalAmount)
```

### Finding First Match

```bash
# First order for customer
GET /v1/trade-orders~where(customer.identifiers.com.example.customerId=CUST-001)~first

# First committed order
GET /v1/trade-orders~where(status=Committed)~orderBy(timestamp:asc)~first
```

### Counting

```bash
# Count all orders
GET /v1/trade-orders/count

# Count by status
GET /v1/trade-orders~where(status=Committed)/count

# Count items in order
GET /v1/trade-orders/com.example.orderId=ORD-001/items/count
```

---

## Error Handling and Validation

### Common Validation Errors

| Error Code | Cause | Solution |
|------------|-------|----------|
| `MissingRequiredField` | Required field not provided | Add `supplier`, `customer`, `sellers`, `currency`, or `items` |
| `EmptyArray` | Empty `items` or `sellers` array | Provide at least one item and seller |
| `InvalidIdentifier` | Bare identifier key | Use namespaced key (`com.example.sku`) |
| `ProductNotFound` | Referenced product doesn't exist | Create product first |
| `PriceNotFound` | No price for product/seller/currency | Create matching price |
| `InvalidInstanceType` | Instance field doesn't match product | Use `imei` for MobileDevice, `phoneImei` for MobilePlan |
| `InvalidPhoneImeiReference` | `phoneImei` references IMEI not in earlier item | Place device item before plan item |
| `InvalidInstanceOrder` | MobilePlan before MobileDevice | Reorder items: device before plan |

### Validation Error Response

```json
{
  "error": "ValidationError",
  "code": "MissingRequiredField",
  "message": "Field 'customer' is required",
  "path": "customer",
  "details": {
    "field": "customer",
    "constraint": "required"
  }
}
```

### Action-Specific Errors

| Action | Error | Cause |
|--------|-------|-------|
| `tryApprove` | `OrderNotApprovable` | Order not in valid state |
| `tryApprove` | `MissingPrice` | Item has no applicable price |
| `tryCancel` | `OrderNotCancellable` | Order already fulfilled |
| `createPayment` | `InvalidAmount` | Amount exceeds remaining balance |

### Handling Errors

```bash
# Check if order can be approved
GET /v1/trade-orders/com.example.orderId=ORD-001~with(status,items.unitAmountInclVat)

# If any item has null unitAmountInclVat, price is missing
# Create price before approving
```

---

## Integration Playbook

### Phase 1: Foundation

**Goal:** Establish basic order creation capability.

1. **Set up products with instance types:**
   ```bash
   PUT /v1/products/com.example.sku=PHONE-001
   {
     "name": "Smartphone X",
     "instanceType": "MobileDevice",
     "status": "Active",
     "defaultVatCode": {"identifiers": {"percentage": "25"}}
   }
   ```

2. **Create prices for products:**
   ```bash
   POST /v1/prices
   {
     "products": [{"identifiers": {"com.example.sku": "PHONE-001"}}],
     "sellers": [{"identifiers": {"com.example.storeId": "STORE-001"}}],
     "amount": "9990.00",
     "currency": {"identifiers": {"currencyCode": "SEK"}}
   }
   ```

3. **Create customers:**
   ```bash
   PUT /v1/people/com.example.customerId=CUST-001
   {
     "givenName": "Anna",
     "familyName": "Customer"
   }
   ```

4. **Create basic orders:**
   ```bash
   POST /v1/trade-orders
   {
     "identifiers": {"com.example.orderId": "ORD-001"},
     "supplier": {"identifiers": {"com.example.companyId": "OUR-COMPANY"}},
     "customer": {"identifiers": {"com.example.customerId": "CUST-001"}},
     "sellers": [{"identifiers": {"com.example.storeId": "STORE-001"}}],
     "currency": {"identifiers": {"currencyCode": "SEK"}},
     "items": [
       {
         "product": {"identifiers": {"com.example.sku": "PHONE-001"}},
         "quantity": 1
       }
     ]
   }
   ```

**Checkpoint:** Orders create successfully with calculated amounts.

### Phase 2: Instance Tracking

**Goal:** Enable serialized product tracking.

1. **Configure products for instance tracking:**
   ```bash
   PUT /v1/products/com.example.sku=PLAN-MONTHLY
   {
     "name": "Monthly Plan",
     "instanceType": "MobilePlan",
     "status": "Active",
     "classification": "Services"
   }
   ```

2. **Create orders with instances:**
   ```bash
   POST /v1/trade-orders
   {
     "identifiers": {"com.example.orderId": "ORD-BUNDLE-001"},
     ...
     "items": [
       {
         "product": {"identifiers": {"com.example.sku": "PHONE-001"}},
         "instances": [{"imei": "123456789012345"}]
       },
       {
         "product": {"identifiers": {"com.example.sku": "PLAN-MONTHLY"}},
         "instances": [{"phoneImei": "123456789012345"}]
       }
     ]
   }
   ```

3. **Validate instance tracking:**
   ```bash
   GET /v1/trade-orders/com.example.orderId=ORD-BUNDLE-001/items~with(instances)
   ```

**Checkpoint:** Device-plan bundles track correctly with linked IMEIs.

### Phase 3: Order Lifecycle

**Goal:** Implement full order workflow.

1. **Approve orders:**
   ```bash
   PATCH /v1/trade-orders/com.example.orderId=ORD-001/actions
   {"tryApprove": true}
   ```

2. **Process payments:**
   ```bash
   PATCH /v1/trade-orders/com.example.orderId=ORD-001/actions
   {
     "createPayment": {
       "transactionId": "TXN-001",
       "timestamp": "2024-12-15T10:30:00Z",
       "method": {"identifiers": {"methodId": "com.heads.card"}},
       "currency": {"identifiers": {"currencyCode": "SEK"}},
       "amount": 12487.50
     }
   }
   ```

3. **Create shipments:**
   ```bash
   # Create shipment via trade order action
   PATCH /v1/trade-orders/com.example.orderId=ORD-001/actions
   {"createShipment": true}

   # Release shipment when ready
   PATCH /v1/shipment-orders/{shipmentId}/actions
   {"release": true}
   ```

**Checkpoint:** Orders progress through Committed → Fulfilled.

### Phase 4: Refunds and Edge Cases

**Goal:** Handle refunds and complex scenarios.

> **Note:** Returns do not have an API action yet. The return statuses exist, but initiating returns must be handled through other system workflows.

1. **Issue refunds:**
   ```bash
   PATCH /v1/trade-orders/com.example.orderId=ORD-001/actions
   {
     "createPayment": {
       "transactionId": "REFUND-001",
       "timestamp": "2024-12-20T14:00:00Z",
       "method": {"identifiers": {"methodId": "com.heads.card"}},
       "currency": {"identifiers": {"currencyCode": "SEK"}},
       "amount": -12487.50
     }
   }
   ```

2. **Handle cancellations:**
   ```bash
   PATCH /v1/trade-orders/com.example.orderId=ORD-002/actions
   {"tryCancel": true}
   ```

**Checkpoint:** Refunds and cancellations operational.

### Phase 5: Production Optimization

**Goal:** Scale for production volumes.

1. **Implement batch queries:**
   ```bash
   GET /v1/trade-orders~where(status=New)~orderBy(timestamp:asc)~take(100)
   ```

2. **Set up order monitoring:**
   ```bash
   # Orders pending approval
   GET /v1/trade-orders~where(status=New)~orderBy(timestamp:asc)~take(50)

   # Orders awaiting payment
   GET /v1/trade-orders~where(status=Committed)~with(payments,totalAmount)~take(50)
   ```

3. **Configure webhooks for order events** (if supported)

**Checkpoint:** System handles production load with monitoring.

---

## Case Study: Mobile Device Bundle Sale

This case study demonstrates a complete mobile device + plan bundle sale from order creation through fulfillment.

### Scenario

Customer purchases:
- iPhone 15 Pro (IMEI: 359876543210123)
- 24-month unlimited plan
- Phone case accessory

### Step 1: Ensure Products Exist

```bash
# Device product
PUT /v1/products/com.example.sku=IPHONE-15-PRO
{
  "name": "iPhone 15 Pro 256GB",
  "instanceType": "MobileDevice",
  "status": "Active",
  "defaultVatCode": {"identifiers": {"percentage": "25"}},
  "classification": "Goods"
}

# Plan product
PUT /v1/products/com.example.sku=PLAN-UNLIMITED-24
{
  "name": "Unlimited 24-Month Plan",
  "instanceType": "MobilePlan",
  "status": "Active",
  "defaultVatCode": {"identifiers": {"percentage": "25"}},
  "classification": "Services"
}

# Accessory product
PUT /v1/products/com.example.sku=CASE-IPHONE-15
{
  "name": "iPhone 15 Protective Case",
  "status": "Active",
  "defaultVatCode": {"identifiers": {"percentage": "25"}},
  "classification": "Goods"
}
```

### Step 2: Ensure Prices Exist

```bash
# Device price
POST /v1/prices
{
  "products": [{"identifiers": {"com.example.sku": "IPHONE-15-PRO"}}],
  "sellers": [{"identifiers": {"com.example.storeId": "STORE-CENTRAL"}}],
  "amount": "14990.00",
  "currency": {"identifiers": {"currencyCode": "SEK"}}
}

# Plan price (monthly, shown as first payment)
POST /v1/prices
{
  "products": [{"identifiers": {"com.example.sku": "PLAN-UNLIMITED-24"}}],
  "sellers": [{"identifiers": {"com.example.storeId": "STORE-CENTRAL"}}],
  "amount": "599.00",
  "currency": {"identifiers": {"currencyCode": "SEK"}}
}

# Case price
POST /v1/prices
{
  "products": [{"identifiers": {"com.example.sku": "CASE-IPHONE-15"}}],
  "sellers": [{"identifiers": {"com.example.storeId": "STORE-CENTRAL"}}],
  "amount": "399.00",
  "currency": {"identifiers": {"currencyCode": "SEK"}}
}
```

### Step 3: Ensure Customer Exists

```bash
PUT /v1/people/com.example.customerId=CUST-MOBILE-001
{
  "givenName": "Erik",
  "familyName": "Svensson",
  "addresses": {
    "home": {
      "line1": "Storgatan 15",
      "postalCode": "11456",
      "cityName": "Stockholm",
      "countryCode": "SE"
    }
  },
  "contactMethods": {
    "email": {"emailAddress": "erik.svensson@example.com"},
    "mobilePhone": {"phoneNumber": "+46701234567"}
  }
}
```

### Step 4: Create the Order

```bash
POST /v1/trade-orders
{
  "identifiers": {"com.example.orderId": "ORD-MOBILE-2024-001"},
  "supplier": {"identifiers": {"com.example.companyId": "TELECOM-AB"}},
  "customer": {"identifiers": {"com.example.customerId": "CUST-MOBILE-001"}},
  "sellers": [{"identifiers": {"com.example.storeId": "STORE-CENTRAL"}}],
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "items": [
    {
      "product": {"identifiers": {"com.example.sku": "IPHONE-15-PRO"}},
      "instances": [{"imei": "359876543210123"}]
    },
    {
      "product": {"identifiers": {"com.example.sku": "PLAN-UNLIMITED-24"}},
      "instances": [{"phoneImei": "359876543210123"}]
    },
    {
      "product": {"identifiers": {"com.example.sku": "CASE-IPHONE-15"}},
      "quantity": 1
    }
  ]
}

# Set delivery address (only on New/Reserved orders)
PATCH /v1/trade-orders/com.example.orderId=ORD-MOBILE-2024-001/actions
{
  "changeDeliveryAddress": {
    "line1": "Storgatan 15",
    "postalCode": "11456",
    "cityName": "Stockholm",
    "countryCode": "SE"
  }
}
```

**Response:**
```json
{
  "identifiers": {"com.example.orderId": "ORD-MOBILE-2024-001"},
  "status": ["New"],
  "totalAmount": 15988.00,
  "balanceAmount": 15988.00,
  "items": [
    {
      "product": {"name": "iPhone 15 Pro 256GB"},
      "instances": [{"imei": "359876543210123"}],
      "unitAmountInclVat": 14990.00,
      "totalAmount": 14990.00,
      "classification": "Goods"
    },
    {
      "product": {"name": "Unlimited 24-Month Plan"},
      "instances": [{"phoneImei": "359876543210123"}],
      "unitAmountInclVat": 599.00,
      "totalAmount": 599.00,
      "classification": "Services"
    },
    {
      "product": {"name": "iPhone 15 Protective Case"},
      "quantity": 1,
      "unitAmountInclVat": 399.00,
      "totalAmount": 399.00,
      "classification": "Goods"
    }
  ]
}
```

### Step 5: Approve the Order

```bash
PATCH /v1/trade-orders/com.example.orderId=ORD-MOBILE-2024-001/actions
{"tryApprove": true}
```

**Response:**
```json
{
  "status": ["Committed"],
  "committedAt": "2024-12-15T14:32:00Z"
}
```

### Step 6: Process Payment

```bash
PATCH /v1/trade-orders/com.example.orderId=ORD-MOBILE-2024-001/actions
{
  "createPayment": {
    "transactionId": "STRIPE-PI-ABC123",
    "timestamp": "2024-12-15T14:33:00Z",
    "method": {"identifiers": {"methodId": "com.heads.card"}},
    "currency": {"identifiers": {"currencyCode": "SEK"}},
    "amount": 15988.00
  }
}
```

**Response:**
```json
{
  "payment": {
    "transactionId": "STRIPE-PI-ABC123",
    "amount": 15988.00,
    "status": "Completed"
  },
  "orderPaymentStatus": "FullyPaid"
}
```

### Step 7: Create Shipment

```bash
# Create shipment via trade order action
PATCH /v1/trade-orders/com.example.orderId=ORD-MOBILE-2024-001/actions
{"createShipment": true}

# Then release the shipment when ready
PATCH /v1/shipment-orders/com.example.shipmentId=SHIP-MOBILE-2024-001/actions
{"release": true}
```

> **Note:** Shipment orders are read-only resources. Use the `createShipment` action on the trade order to create a shipment, then use the `release` action on the shipment order when ready to ship.

### Step 8: Verify Final State

```bash
GET /v1/trade-orders/com.example.orderId=ORD-MOBILE-2024-001~withAll
```

**Response:**
```json
{
  "identifiers": {"com.example.orderId": "ORD-MOBILE-2024-001"},
  "status": ["Committed", "Fulfilled"],
  "customer": {
    "givenName": "Erik",
    "familyName": "Svensson"
  },
  "totalAmount": 15988.00,
  "balanceAmount": 0.00,
  "payments": [
    {
      "transactionId": "STRIPE-PI-ABC123",
      "amount": 15988.00,
      "method": "card",
      "status": "Completed"
    }
  ],
  "shipments": [
    {
      "identifiers": {"com.example.shipmentId": "SHIP-MOBILE-2024-001"},
      "status": "Released"
    }
  ],
  "items": [
    {
      "product": {"name": "iPhone 15 Pro 256GB"},
      "instances": [{"imei": "359876543210123"}],
      "totalAmount": 14990.00
    },
    {
      "product": {"name": "Unlimited 24-Month Plan"},
      "instances": [{"phoneImei": "359876543210123"}],
      "totalAmount": 599.00
    },
    {
      "product": {"name": "iPhone 15 Protective Case"},
      "quantity": 1,
      "totalAmount": 399.00
    }
  ]
}
```

---

## Business Rules and Pitfalls

### Critical Rules

1. **Both `items` and `sellers` are required (non-empty):**
   ```bash
   # Missing sellers will fail
   "sellers": []  # WRONG - must have at least one seller
   ```

2. **Product identifiers need namespace:**
   ```json
   // WRONG
   {"product": {"identifiers": {"sku": "..."}}}

   // RIGHT
   {"product": {"identifiers": {"com.example.sku": "..."}}}
   ```

3. **Instance order matters (MobileDevice before MobilePlan):**
   ```bash
   "items": [
     {"product": {...}, "instances": [{"imei": "123..."}]},      # Device first
     {"product": {...}, "instances": [{"phoneImei": "123..."}]}  # Plan second
   ]
   ```

4. **`instanceType` is on the product, not the order:**
   ```bash
   # Set on product creation
   PUT /v1/products/...
   {"instanceType": "MobileDevice", ...}
   ```

5. **Query operators follow canonical normalization order:**

   When combining query operators, they are normalized in this order: `where` → `orderBy` → `skip` → `take` → `with`/`withAll` → `first`

   ```bash
   # Canonical order example
   GET /v1/trade-orders~where(status=Committed)~orderBy(timestamp:desc)~skip(10)~take(50)~with(items)
   ```

### Common Mistakes

| Mistake | Problem | Solution |
|---------|---------|----------|
| Empty sellers array | Validation error | Add at least one seller |
| Bare identifier keys | Product not found | Use `com.example.sku` format |
| Plan before device | Invalid instance order | Place MobileDevice items first |
| Missing prices | Approval fails | Create prices before orders |
| Editing items | Items are immutable | Cancel and recreate order |

### Order Item Immutability

Once created, order items cannot be modified. This ensures:
- **Audit integrity:** Historical records remain accurate
- **Price consistency:** Original pricing preserved
- **Stock accuracy:** Reservations match original order

**To change an order:**
1. Cancel the existing order
2. Create a new order with correct items

### Timing Considerations

1. **Create prices before orders:** Orders without matching prices will have null amounts
2. **Create products before orders:** References to non-existent products fail
3. **Approve before ship:** Shipments require committed orders
4. **Pay before or after approve:** Flexible based on business rules

### Instance Tracking Edge Cases

1. **IMEI reuse across orders:** An IMEI sold, returned, and resold creates multiple order references
2. **Plan without device in same order:** Not valid—`phoneImei` must reference a device IMEI from an **earlier item in the same order**. You cannot reference devices from previous orders.
3. **Multiple plans per device:** Each plan needs unique instance entry with same `phoneImei`
4. **Duplicate IMEI:** The API does not check for duplicate IMEIs within an order. Ensure uniqueness in your application logic.

---

## Related Guides

- [Products](products.md) - Product setup and instanceType configuration
- [Prices](prices.md) - Pricing for order items
- [VAT](vat.md) - Tax calculation on orders
- [Customers](customers.md) - Customer/supplier agent management
- [Stock](stock.md) - Inventory and shipment management
- [Receipts](../receipts.md) - Completed transaction records
