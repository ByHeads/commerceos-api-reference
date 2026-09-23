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
| Purchase Order | External supplier | Your receiving store | Procurement — see [Working with Purchasing](purchasing.md#purchase-orders) |
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
| **Trade Record** | The ledger's log of an action taken on an order — a reservation, delivery, return or cancellation, and the quantity it moved. See [Trade Records](../trade-records.md) |

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
┌───────────┐◄────────────────────┐
│ Fulfilled │                     │ cancelReturn
└─────┬─────┘                     │
      │                           │
      │ commitReturn              │
      ▼                           │
┌─────────────────┐               │
│ ReturnCommitted │───────────────┘
└────────┬────────┘
         │ fulfillReturn
         ▼
┌─────────────────┐
│ ReturnFulfilled │
└─────────────────┘
```

### Status Reference

| Status | Description | Transitions To |
|--------|-------------|----------------|
| `New` | Just created, no reservations | Reserved |
| `Reserved` | Stock reserved for the order | Committed, Unreserved |
| `Unreserved` | Reservation released | Reserved |
| `Committed` | Approved via `tryApprove` | Fulfilled, Cancelled |
| `Fulfilled` | Fully delivered to customer | ReturnCommitted (via `commitReturn`) |
| `Cancelled` | Order cancelled | (terminal) |
| `ReturnCommitted` | Return committed | ReturnFulfilled (via `fulfillReturn`), Fulfilled (via `cancelReturn`) |
| `ReturnFulfilled` | Return completed | (terminal) |

> **Note:** Orders can have multiple statuses simultaneously. For example, a partially fulfilled order may show both `Committed` and `Fulfilled` statuses for different line items.

### Status Behavior

**Partial Statuses:**

An order whose lines are in different phases carries all of their statuses at once:

```bash
GET /v1/trade-orders/com.example.orderId=ORD-001~with(status,items~with(statusDetails))
```

```json
{
  "status": ["Committed", "Fulfilled"],
  "items": [
    { "statusDetails": [ { "quantity": "1", "status": "Fulfilled" } ] },
    { "statusDetails": [ { "quantity": "1", "status": "Committed" } ] }
  ]
}
```

The order-level `status` is the union, so it cannot tell you *how much* of the order is where. `statusDetails` on each line can — see below.

**Filtering on `status` needs the right operator.** Because `status` is an array, `=` compares the **whole** value: `status=Committed` matches only an order whose single status is `Committed`, and the partly fulfilled order above matches neither `status=Committed` nor `status=Fulfilled`. `=~` (includes) matches when the value is **one of** the order's statuses, and that is the filter for "still has open lines":

```bash
# Only orders that are wholly Committed — a partly received order is not among them
GET /v1/trade-orders~where(status=Committed)

# Every order with at least one Committed line — the "still expecting goods" list
GET /v1/trade-orders~where(status=~Committed)
```

Neither form says *how much* of the order is where — the order-level `status` is a set with no counts. To answer that, read the lines: fetch `items~with(statusDetails)` and use the per-line breakdown below. See [gotcha 55](../common-gotchas.md#55-status-on-a-trade-order-compares-the-whole-array-use--for-still-open).

### Per-Line Status Breakdown (`statusDetails`)

A single line can itself be split across phases: order three, approve all three, deliver two, and that one line is now part `Fulfilled` and part `Committed`. `statusDetails` is one row per phase, each row carrying the quantity in that phase:

```bash
GET /v1/trade-orders/com.example.orderId=ORD-001/items~first/statusDetails
```

```json
[
  { "@type": "trade order status detail", "quantity": "2", "status": "Fulfilled" },
  { "@type": "trade order status detail", "quantity": "1", "status": "Committed" }
]
```

Rows come back in reverse causal order — the most recent phase first — and a line sitting wholly in one phase gives exactly one row. `quantity` is a decimal string, and each row's `status` is a single value rather than an array; the array is on the *order*, not on the row.

Both members are read-only. To see what produced each move — which action, when, and against which record — read the order's [trade records](../trade-records.md).

> **Reach a line with `~first`, not with `/0`.** `items` is keyed by database key or common identifiers, so a positional index on it is a `404`:
>
> ```bash
> GET /v1/trade-orders/{id}/items/0/statusDetails          # 404 — 0 is not a key
> GET /v1/trade-orders/{id}/items~first/statusDetails      # the first line
> GET /v1/trade-orders/{id}/items/{itemKey}/statusDetails  # a specific line
> ```
>
> Positional indexing works *within* `statusDetails`, which is an ordinary array: `.../items~first/statusDetails/1` returns the second row. See [Accessing Order Items](#accessing-order-items).

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

**Two numbers the platform puts into `identifiers`.** Besides your own namespaced identifiers, an order can carry `identifiers.customersId` — the customer's number for the order — and `identifiers.suppliersId` — the supplier's. Each is issued on creation when the party is one of your own agents under the root organization node and `/v1/config/root-order` names a serial for it: `incomingTradeOrderSerial` for `customersId` (your purchase order number), `outgoingTradeOrderSerial` for `suppliersId` (your sales order number). Both are indexes — `GET /v1/trade-orders/customersId=PO-00001` — and both are **read-only**: a `PATCH` on either is a `200` that changes nothing. The top-level `customersId` / `suppliersId` members (non-essential) carry the same number with its `owner`. See [Working with Purchasing → Your Purchase Order Number](purchasing.md#your-purchase-order-number-identifierscustomersid--long-standing).

### Order Fields (Optional)

| Field | Type | Description |
|-------|------|-------------|
| `reservedUntil` | datetime | Stock reservation expiry (optional) |
| `labels` | Label[] | Assigned labels (add/remove semantics) |

**Purchasing members.** A trade order used as a purchase order carries a further set of optional members. All are non-essential — fetch them with `~with(...)` — and all are settable on create and via `PATCH`.

> **Availability:** v26.2.1 and later. Not in v26.1.x.

| Field | Type | Description |
|-------|------|-------------|
| `supplierConfirmed` | boolean | The supplier has confirmed the order |
| `receiverNotes` | string | Notes for whoever receives the goods |
| `requestedArrivalTime` | datetime | When the goods are wanted |
| `suppliersReference` | string | The supplier's own reference for the order |
| `customersReference` | string | The customer's own reference for the order |
| `suppliersInternalNotes` | string | The supplier's private notes |
| `suppliersExternalNotes` | string | The supplier's shared notes |
| `customersInternalNotes` | string | The customer's private notes |
| `customersExternalNotes` | string | The customer's shared notes |
| `underdeliveryPolicy` | `"LeaveOpen"` \| `"Cancel"` | What approving a short delivery does with the remainder. Reads `"LeaveOpen"` when never set |
| `overdeliveryPolicy` | `"Accept"` \| `"Warn"` \| `"Reject"` | What approving a surplus delivery does with it. Reads `"Accept"` when never set |

An unknown value for either policy is a coercion `400`. The trade relationship carries defaults for the two policies in the back office, but they are not exposed on `/v1/trade-relationships` — through the API the order is the only place a policy is set. What the policies actually do at receipt time is in [Working with Purchasing](purchasing.md#delivery-actions).

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
| `records` | TradeRecord[] | Non-essential — the ledger's log of what was actually done to this order. Use `~with(records)`; see [Trade Records](../trade-records.md) |
| `deliveryDiscrepancy` | string[] | Non-essential — the summarised difference between what was ordered and what arrived, with the same values as a delivery's `discrepancy` (`ZeroDelivery`, `Underdelivery`, `Overdelivery`, `None`). See [Working with Purchasing](purchasing.md#status-and-discrepancy-values) |
| `deliveries` | Delivery[] | Non-essential — the goods receipts raised against this order. See [Working with Purchasing](purchasing.md#deliveries) |
| `returns` | Return[] | Non-essential — the supplier returns raised against this order. See [Working with Purchasing](purchasing.md#returns) |

> **Availability:** v26.2.1 and later. Not in v26.1.x.
>
> Applies to `deliveryDiscrepancy`, `deliveries` and `returns` only; the rest of this table is long-standing.

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
| `deliveryAddresses` | Address[] (at most one) | Where this line ships to. `[]` means the line is collected in the `seller` store; one address means it ships there. Inherits the order's delivery address unless set. Writable on `PATCH /v1/trade-order-items/{key}` while the line is `New` or `Reserved`; ignored once `Committed`; two addresses answer `400`. Non-essential — see [Orders placed at the till](#orders-placed-at-the-till-collect-in-store-and-ship-to-customer). v26.1.10 and later |

### Order Item Fields (Read-Only)

| Field | Type | Description |
|-------|------|-------------|
| `totalAmount` | decimal | Line total (VAT-inclusive) |
| `unitAmountInclVat` | decimal | Unit price including VAT |
| `discountAmountInclVat` | decimal | Discount amount including VAT |
| `vatPercentage` | decimal | VAT percentage applied |
| `classification` | string | `Goods`, `Services`, or `Shipping` |
| `discountable` | boolean | Whether item accepts discounts |
| `statusDetails` | array | One row per phase the line is split across — `quantity` and `status` (see [Per-Line Status Breakdown](#per-line-status-breakdown-statusdetails)) |
| `seller` | agent reference | The store that sells and hands over this line. On an order placed at the till it is the store the cashier picked. The order-level `sellers` is the set of the lines' sellers |
| `buyer` | agent reference | The customer, per line |
| `reservedUntil` | datetime or null | When this line's reservation expires. `null` on a pay-later order placed at the till — that reservation does not expire, unlike an API click-and-collect order's |

> **`seller`, `buyer`, `deliveryAddresses` and `reservedUntil` are non-essential on a line.** None of them is in the order's `items` in the default form, with `?fields=all` on the order, or with `~with(items)`. Ask for them by name: `~with(items~with(seller,buyer,deliveryAddresses,statusDetails))`, a `~just(items~just(…))` projection, `GET /v1/trade-orders/{id}/items?fields=all`, or the line itself on `/v1/trade-order-items/{key}`.

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

**The order establishes the trade relationship.** If no relationship exists between `customer` and `supplier`, posting the order creates one — you do not need to `POST /v1/trade-relationships` first, and a later order for the same pair reuses it.

Which agents the relationship ends up naming is not always the two you sent. Where an agent is configured to trade under a parent — a store buying on its company's account — the relationship is attached to that parent, so it is listed under the parent's `supplierRelations` and not the store's. See [Resource Patterns → Relationships created implicitly by a trade order](../resource-patterns.md#relationships-created-implicitly-by-a-trade-order) for the resolution rules and where the owners are configured.

### Purchase Order

In a purchase order the supplier is `supplier` and sole seller, and **the store that receives the goods is the `customer`** — one purchase order per receiving store. With a company as customer the order still completes, but no store's stock rises. Put your purchase price on each line as `unitAmountExclVat`, and give each line an identifier of your own so a delivery can name it:

```bash
POST /v1/trade-orders
{
  "identifiers": {"com.example.orderId": "PO-001"},
  "supplier": {"identifiers": {"com.example.supplierId": "SUPPLIER-001"}},
  "customer": {"identifiers": {"com.example.storeId": "STORE-001"}},
  "sellers": [{"identifiers": {"com.example.supplierId": "SUPPLIER-001"}}],
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "items": [
    {
      "identifiers": {"com.example.itemId": "PO-001-1"},
      "product": {"identifiers": {"com.example.sku": "PROD-001"}},
      "quantity": "100",
      "unitAmountExclVat": "40.00"
    }
  ]
}
```

Price and quantity are settable while the order is `New`; after `tryApprove` a `PATCH` on either is a silent `200`. Everything specific to buying — the purchase order number in `identifiers.customersId`, the lifecycle, finding open orders, closing a partly received one — is in [Working with Purchasing → Purchase Orders](purchasing.md#purchase-orders).

**Receiving and returning.** Once a purchase order is approved, what arrives against it is booked as a **delivery** and what goes back to the supplier as a **return** — both documents in their own right, with their own numbers, their own line counts and their own approval step. See [Working with Purchasing](purchasing.md). The purchasing members a purchase order can carry (references, notes, and the under/overdelivery policies that decide what a short or surplus receipt does to the order) are in [Order Fields (Optional)](#order-fields-optional).

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

### Click-and-Collect Order

Click-and-collect orders use the `~click-and-collect` resource path suffix and the `reservedUntil` field to reserve stock for in-store customer pickup:

```bash
POST /v1/trade-orders~click-and-collect
{
  "identifiers": {"com.example.orderId": "CC-001"},
  "supplier": {"@type": "company", "identifiers": {"com.example.companyId": "OUR-COMPANY"}},
  "customer": {"@type": "person", "identifiers": {"com.example.customerId": "CUST-001"}},
  "sellers": [{"@type": "store", "identifiers": {"com.example.storeId": "STORE-001"}}],
  "currency": {"@type": "currency", "identifiers": {"currencyCode": "SEK"}},
  "reservedUntil": "2025-06-15T18:00:00Z",
  "items": [
    {
      "product": {"identifiers": {"com.example.sku": "PROD-001"}},
      "quantity": "1"
    }
  ]
}
```

**What `reservedUntil` triggers:**
1. Stock is reserved for the order items
2. Order status moves to `Reserved`
3. A `PickingOrder` is created for in-store fulfillment (unless `tryApprove` is in the same request)
4. A scheduled release task automatically unreserves stock when `reservedUntil` expires

> **Note:** `reservedUntil` must be a future ISO 8601 timestamp. If stock cannot be reserved, the API returns 400: `"Could not reserve order. Ensure the associated product instances are available in stock."` Item-level `reservedUntil` is also supported for per-item reservation expiry.

See the [Orders examples guide](../../guide/examples/orders.md#click-and-collect-orders) for the full workflow including configuration and notification templates.

### Orders Placed at the Till: Collect in Store and Ship to Customer

> **Availability:** `deliveryAddresses` on an order line is v26.1.10 and later; the store lists on the order function are v26.1.11 and later. Orders placed at the till, and the rest of what this section reads, are long-standing.

A cashier can turn the lines in a cart into a customer order with the till's "Add to order" tile. The cashier picks a **delivery mode** — collect in store or ship to the customer — the **store** the goods come from, and a **payment mode** — pay now or pay later. The result is an ordinary trade order on `/v1/trade-orders`, so an order-management, warehouse or e-commerce integration reads it like any other. What differs is how you recognise one, how you tell the two delivery modes apart, which store hands the goods over, and what the till does to the order afterwards.

This is a different thing from the [click-and-collect order](#click-and-collect-order) above, which an integration **creates** through the API with `reservedUntil`. A till order is created by the till, has no expiry, and is finished either at the till or by the integration, depending on its delivery mode.

#### What the till writes

- `identifiers.suppliersId` — the order number, assigned when the cart is completed. The till shows it as "Order #1000000". Every completed till order has one, and so does every order created through the API; the only orders without one are the till's open carts (see [Finding and polling till orders](#finding-and-polling-till-orders)).
- `createdBy` — the cashier. `customer`, `buyers` and `relationship` — the customer attached to the cart. `supplier` — the company.
- `sellers` — the set of stores the cashier picked. Each line's own `seller` is the store that sells and hands over *that* line.
- `deliveryAddresses` **on each line** — `[]` for a collect-in-store line, the one address the cashier picked (prefilled from the customer's delivery or main address) for a ship-to-customer line.
- `labels` — whatever the tile's configuration applies by default plus what the cashier picked. Nothing configured, no labels. See [Configuring the "Add to order" tile](../../guide/examples/pos.md#the-order-function-collect-in-store-and-ship-to-customer).
- `reservedUntil` — `null`, on the order and on every line. A pay-later till order does not expire.

#### The delivery mode is on the line, not on the order

Read `deliveryAddresses` on the **item**. `[]` means the line is collected in its `seller` store; one address means it ships from the `seller` store to that address. The four members that matter are non-essential on a line, so name them:

```bash
GET /v1/trade-orders/suppliersId=1000000~just(status,reservedUntil,deliveryAddresses,items~just(identifiers/key,deliveryAddresses,seller~just(name,identifiers/key)))
```

A collect-in-store line:

```json
{
  "status": ["Reserved"],
  "reservedUntil": null,
  "deliveryAddresses": [
    { "line1": "Alsta Björklunda 7", "postalCode": "75592", "cityName": "Uppsala", "regionName": "Uppsala", "countryCode": "SE" }
  ],
  "items": [
    { "identifiers": "4f2407ec3b07ff2a2f424434818ebc73", "deliveryAddresses": [], "seller": { "name": "Shade Stockholm", "identifiers": "4b47ad1b1f1fd5cb9d59283b11ee2c7f" } }
  ]
}
```

A ship-to-customer line:

```json
{
  "status": ["Committed"],
  "deliveryAddresses": [ { "line1": "Centralgatan 16", "postalCode": "52151", "cityName": "Floby", "regionName": "Västra Götaland", "countryCode": "SE" } ],
  "items": [
    { "deliveryAddresses": [ { "line1": "Centralgatan 16", "postalCode": "52151", "cityName": "Floby", "regionName": "Västra Götaland", "countryCode": "SE" } ],
      "seller": { "name": "Shade Stockholm" } }
  ]
}
```

**The order-level `deliveryAddresses` cannot tell them apart.** It is the union of the order's own delivery address and every line's address, and the order's own address is the customer's address on file. So the collect-in-store order above lists an address at order level while its only line reads `[]`. See [gotcha 58](../common-gotchas.md#58-the-order-level-deliveryaddresses-is-a-union-not-the-delivery-mode).

The line's `deliveryAddresses` is writable through the API as well, on `PATCH /v1/trade-order-items/{key}`, while the line is `New` or `Reserved`: `[]` marks it collected in store, one address makes it a shipped line, two addresses answer `400` with `"A trade order item supports at most one delivery address."` Once the line is `Committed` the write is a `200` that changes nothing. On an order created through the API, a line that has not been set inherits the order's delivery address.

#### Which store hands the goods over

The line's `seller`. The order-level `sellers` is the set of the lines' sellers — one store for a typical till order, but the cashier can send lines to different stores in separate confirmations, so treat `sellers` as a set and read the line. The picking order the till raises names the same store as its `issuer`.

#### What the order looks like right after the cart is completed

| | Pay later | Pay now |
|---|---|---|
| `status` | `["Reserved"]`; line `statusDetails` `[{"quantity": "1", "status": "Reserved"}]` | `["Committed"]`; line `statusDetails` Committed |
| `payments` | `[]` | One payment order, `status ["Debited"]`, `limitAmount` = the line total, `payer` the customer, `payee` the seller store |
| `balanceAmount` | Negative: the amount still owed (`"-2990"` on a `"2990"` order) | `"0"` |
| `records` | One trade record, action `Reserve` | One trade record, action `Commit` |
| `pickingOrders` | One, `status ["New"]`, `issuer` the seller store, its item's `source` and `destination` the store's stock place | Same — the till raises a picking order for **both** delivery modes |
| `shipments` | `[]` | `[]` |
| Stock level at the seller store | `reservedQuantity` up by the line quantity | Unchanged — see [What happens next](#what-happens-next-per-delivery-mode) |
| POS slip | One, `slipKind "order"`, action `Reserve` with the product name and quantity, `paymentRecords []`. No receipt | No slip. One receipt, for the prepayment |

Read `payments` and `balanceAmount` for whether an order is paid; do not infer it from `status`. A `Committed` order with `payments: []` and a negative `balanceAmount` is unpaid.

**The prepayment receipt books no sale.** On a pay-now order the till writes a receipt whose line names the order line it settles (`orderItems`), whose `payments` carries the full amount — and whose `totalAmount`, and the line's `totalAmount`, are `"0"`:

```bash
GET /v1/receipts~first~just(identifiers,totalAmount,items~just(product/name,quantity,totalAmount,orderItems~just(identifiers/key)),payments~just(method~just(identifiers/methodId),amount),orders~just(identifiers/suppliersId,status))
```

```json
{ "identifiers": { "receiptID": "GPG00000000001" }, "totalAmount": "0",
  "items": [ { "product": "Apple AirPods med Lightning (3.gen)", "quantity": "1", "totalAmount": "0",
               "orderItems": [ { "identifiers": "fdcf43b6b2156edf4753d13ea9ab2d86" } ] } ],
  "payments": [ { "method": "com.heads.mock", "amount": "2190" } ],
  "orders": [ { "identifiers": "1000001", "status": ["Committed"] } ] }
```

It documents the advance, not a sale. A receipts reader that books `totalAmount` as revenue and `payments` as cash sees a zero sale with an unexplained payment; match the payment to the order through `orders` or the line's `orderItems` instead. See [Receipts → Item-to-Order Navigation](../receipts.md#item-to-order-navigation-the-orderitems-member). On a Norwegian profile the prepayment is documented on a `prepayment` slip and the hand-over on a `delivery-note` slip instead of on receipts.

#### What happens next, per delivery mode

**Collect in store — the till finishes it.** The customer comes to the line's `seller` store, the cashier opens the order by number, customer or scan and hands it over; the till only offers the hand-over at a till whose store is the line's `seller`. The remaining amount is paid in that sale. Afterwards the order reads:

- `status ["Fulfilled"]`, line `statusDetails` Fulfilled, `balanceAmount "0"`.
- `payments`: one payment order for the full amount, `Debited`.
- `records`: a second trade record whose line carries three actions in this order — `Unreserve`, `Commit`, `Fulfill`.
- `pickingOrders []` — the picking order is gone once the line is fulfilled. `shipments []`.
- A second receipt, this one with the full `totalAmount`, its line's `orderItems` pointing at the order line and `orders` at the order, now `Fulfilled`. **This is the receipt to count as the sale.**
- Stock level at the seller store: `totalQuantity` down by the line quantity, `reservedQuantity` back down.
- No new POS slip.

There is nothing for the integration to write. Do not send `tryFulfill` to a collect-in-store order from the API; the till is what hands the goods over, and what `tryFulfill` does to such an order has not been measured.

**Ship to customer — the warehouse or the integration finishes it.** Ship from the line's `seller` store to the line's `deliveryAddresses[0]`, then tell CommerceOS the goods left:

```bash
PATCH /v1/trade-orders/suppliersId=1000001/actions
{"tryFulfill": true}
```

`200 {"@type": "trade order actions"}`. Read back: `status ["Fulfilled"]`, line Fulfilled, `balanceAmount "0"`, a second trade record with one `Fulfill` action, `pickingOrders []`, `shipments []` — `tryFulfill` raises no shipment order (see [Where Shipment Orders Come From](#where-shipment-orders-come-from)). What `tryFulfill` books against the seller's stock level for a line the till created is being confirmed; read the product's `stockLevels` at the seller store after fulfilment rather than assuming it moved, and count the units out with a stock adjustment if it did not.

On v26.1.12 and earlier, `{"createShipment": true}` followed by `release` on the shipment order is the alternative; v26.2.1 and later books a delivery instead. Both are described under [Where Shipment Orders Come From](#where-shipment-orders-come-from); neither has been measured on a till-created order.

#### Cancelling a till order

| Who | Order state | Result |
|---|---|---|
| API `{"tryCancel": true}` | `Reserved` (pay later, not picked up) | `200`, **nothing changes** — the order stays `Reserved` and the reservation is kept, as the [`tryCancel` preconditions](#cancel-order-trycancel) say |
| Till, cancel the order or a line | `Reserved` | `status ["Unreserved"]`, line `statusDetails` Unreserved, a second trade record with one `Unreserve` action, a POS slip (`slipKind "order"`, action `Unreserve`), the reservation released from the stock level, `balanceAmount "0"` while `totalAmount` stays |
| API `{"tryCancel": true}` | `Committed`, paid now, not yet shipped | Not measured. A wholly `Committed` order is cancelled; what happens to the prepayment's `Debited` payment order through the API has not been checked. Do not assume a refund |
| Till | `Committed`, paid now | On v26.1.11 the till refuses: "Cannot cancel an order with a prepaid amount." From v26.1.12 the till cancels with a refund, referenced to the original payment where the method supports it and otherwise paid out, documented on a receipt (Sweden) or a `prepayment-refund` slip (Norway) |

`Unreserved` is the status of a pay-later till order cancelled at the till. Map it to "cancelled" in an external system, alongside `Cancelled` — see [the orders integration template](../integration-templates/orders-integration.md#status-mapping-to-external-system).

#### Finding and polling till orders

**By the store that has to hand over or ship.** The identifier goes directly under `sellers/`, not under `sellers/identifiers/` ([gotcha 56](../common-gotchas.md#56-a-filter-through-an-array-relation-takes-the-identifier-directly-under-the-relation-name)), and there is no line-level seller filter:

```bash
GET /v1/trade-orders~where(sellers/com.example.storeId=STORE-001)              # matches
GET /v1/trade-orders~where(sellers/key=4b47ad1b1f1fd5cb9d59283b11ee2c7f)       # matches
GET /v1/trade-orders~where(sellers/identifiers/com.example.storeId=STORE-001)  # 200 []
GET /v1/trade-orders~where(items/seller/com.example.storeId=STORE-001)         # 200 [] — no line-level form

# The finder form, with a modifiedTag for polling
POST /v1/trade-orders/find
{"seller": {"identifiers": {"key": "4b47ad1b1f1fd5cb9d59283b11ee2c7f"}}}
```

**Awaiting pickup** — pay later, not yet handed over — is `~where(status=~Reserved)`. **Incremental polling** is `/after/{timestamp}` (last modification, the default) or `/after(create)/{timestamp}` (placement); those are the only two modes, and a `/after(status)/…` is a `404` — see [Time-relative queries](../../guide/examples/orders.md#time-relative-queries).

**Every open cart at a till is a `New` trade order without a number.** It is served by `/v1/trade-orders`, by `/after/…` and by `~where(status=~New)`: `status ["New"]`, no `suppliersId`, `items []` (or the lines still in the cart), `timestamp` = when the cart was opened, `totalAmount "0"`. A poller that treats every `New` order as "order received" acts on carts. Filter on the order number, which every completed till order and every API-created order has:

```bash
GET /v1/trade-orders~where(identifiers/suppliersId)~take(50)
GET /v1/trade-orders/after/2026-09-23T16:00:00Z~where(identifiers/suppliersId)~take(50)

# The carts themselves
GET /v1/trade-orders~where(!identifiers/suppliersId)~take(50)
```

`~where(status!=New)` also hides them, but hides API-created orders that are still `New` too. `~where(suppliersId)` matches everything, and `~where(items~count)` does not help either — a cart with lines in it has items. See [gotcha 59](../common-gotchas.md#59-every-open-pos-cart-is-a-new-trade-order-without-a-number).

**Collect from ship, server-side.** Per line, with a nested filter; the flat spellings look like filters and are not:

```bash
# At least one line shipped to the customer
GET /v1/trade-orders~where(items~where(deliveryAddresses~first/line1)~count)~take(50)
# At least one line collected in store
GET /v1/trade-orders~where(items~where(!deliveryAddresses~first/line1)~count)~take(50)
# Single-line orders, by the first line — combine with the order-number filter, or the ~count=1 form matches carts too
GET /v1/trade-orders~where(identifiers/suppliersId,items~first/deliveryAddresses~count=0)~take(50)
GET /v1/trade-orders~where(identifiers/suppliersId,items~first/deliveryAddresses~count=1)~take(50)

# These are not filters
GET /v1/trade-orders~where(items/deliveryAddresses~count=0)            # 200 []
GET /v1/trade-orders~where(items/deliveryAddresses~first/line1)        # 200 []
GET /v1/trade-orders~where(!items/deliveryAddresses~first/line1)       # every order
```

For anything but a quick count, project the lines and classify each in the client — this one call gives everything an integration needs to route a till order:

```bash
GET /v1/trade-orders~where(identifiers/suppliersId)~just(identifiers/suppliersId,status,items~just(product/name,quantity,statusDetails,seller~just(identifiers/key,name),deliveryAddresses))~take(50)
```

```json
[
  { "identifiers": "1000000", "status": ["Fulfilled"],
    "items": [ { "product": "Apple AirPods Pro (2.gen)", "quantity": "1",
                 "statusDetails": [ { "quantity": "1", "status": "Fulfilled" } ],
                 "seller": { "identifiers": "4b47ad1b1f1fd5cb9d59283b11ee2c7f", "name": "Shade Stockholm" },
                 "deliveryAddresses": [] } ] },
  { "identifiers": "1000001", "status": ["Fulfilled"],
    "items": [ { "product": "Apple AirPods med Lightning (3.gen)", "quantity": "1",
                 "statusDetails": [ { "quantity": "1", "status": "Fulfilled" } ],
                 "seller": { "identifiers": "4b47ad1b1f1fd5cb9d59283b11ee2c7f", "name": "Shade Stockholm" },
                 "deliveryAddresses": [ { "line1": "Centralgatan 16", "postalCode": "52151", "cityName": "Floby", "regionName": "Västra Götaland", "countryCode": "SE" } ] } ] },
  { "identifiers": "1000002", "status": ["Unreserved"],
    "items": [ { "product": "Apple AirPods Pro (2.gen)", "quantity": "1",
                 "statusDetails": [ { "quantity": "1", "status": "Unreserved" } ],
                 "seller": { "identifiers": "4b47ad1b1f1fd5cb9d59283b11ee2c7f", "name": "Shade Stockholm" },
                 "deliveryAddresses": [] } ] }
]
```

See [gotcha 61](../common-gotchas.md#61-flat-itemsdeliveryaddresses-filters-match-nothing-or-everything-when-negated) for the flat forms.

The stores a cashier can pick from, and the labels the tile applies, are configured on the tile's order function — see [The order function](../../guide/examples/pos.md#the-order-function-collect-in-store-and-ship-to-customer). The curl form of everything above is in the [Orders examples guide](../../guide/examples/orders.md#orders-placed-at-the-till-collect-in-store-and-ship-to-customer).

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

# First item — use the operator, not a positional index
GET /v1/trade-orders/com.example.orderId=ORD-001/items~first
```

> **Note:** `items` is keyed by database key or common identifiers, so a **positional index does not resolve** — `/items/0` is a `404`, not the first line. Address a line by its key or identifier, or reach one with an operator: `~first`, `~last`, `~take(n)`, `~where(...)~first`. This applies to every collection whose elements you address by key; a plain scalar array such as `gtin` does take `/0`. See [Array Index Access](../resource-patterns.md#array-index-access).

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
GET /v1/trade-orders~where(items/instances/imei=123456789012345)~first

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
balanceAmount = -597.00 (Committed or Reserved, before payments)
```

`balanceAmount` is what is still owed, and it is **negative** while unpaid: `0` on a `New` order, `-597.00` once the lines are reserved or committed and nothing has been paid, `0` again once the payments cover the total. A cancelled or unreserved order reads `0` while its `totalAmount` stays.

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
| **Editable items only** | Can only be set on items with `New` status; on a `Committed` line the `PATCH` is a silent `200` that changes nothing |
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
| `tryFulfill` | `true` | Fulfills all eligible items (committing `New`, `Reserved` and `Unreserved` items first as needed) and performs a physical move from each item's source to its destination place for physical product instances |
| `tryCancel` | `true` | Cancels the order (releases reservations) |
| `commitReturn` | Return commit object | Commits a return for one or more items (Fulfilled/New → ReturnCommitted) |
| `fulfillReturn` | Return ref object | Fulfills a previously-committed return (ReturnCommitted → ReturnFulfilled; restocks if `restock=true` at commit) |
| `cancelReturn` | Return ref object | Cancels a previously-committed return (ReturnCommitted → Fulfilled) |
| `createPayment` | Payment object | Records a payment against the order |
| `createWalletPayment` | Wallet payment object | Creates a payment using a wallet (gift card, store credit, voucher) |
| `changeDeliveryAddress` | Address object | Updates delivery address |
| `changeInvoiceAddress` | Address object | Updates invoice address |

That table is the whole set on v26.2.1 and later. Earlier releases have one more:

> **`createShipment`** — whether it is a trade order action depends on the release.
>
> **Availability: v26.1.12 and earlier.** Approve the order, send `{"createShipment": true}`, then `release` the shipment order it created. `tryFulfill` is the alternative that fulfils the order without a shipment order.
>
> **Availability: v26.2.1 and later.** `createShipment` is removed and sending it is dropped: `200`, no shipment order. Outbound goods are booked as a delivery on `/v1/deliveries`.
>
> On the releases that have it, it creates one shipment order from the order's shippable lines — the `Committed`, physical ones — unless the order already has a shipment order in status `New`, in which case it does nothing. See [Where Shipment Orders Come From](#where-shipment-orders-come-from).

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
- Orders in `New` or `Reserved` status cannot be cancelled with this action — that includes a pay-later order placed at the till, which is `Reserved` until it is picked up; the till cancels it (see [Cancelling a till order](#cancelling-a-till-order))
- Orders in `Fulfilled` status cannot be cancelled (use return flow instead)
- A **partly fulfilled** order (`["Committed", "Fulfilled"]`) is not cancelled either: the action answers `200` and changes nothing. To close the open remainder of a partly received purchase order, set `underdeliveryPolicy: "Cancel"` and approve a short delivery — see [Working with Purchasing → Cancelling, and Closing the Rest of a Partly Received Order](purchasing.md#cancelling-and-closing-the-rest-of-a-partly-received-order)

In every "cannot" case above the response is still `200` — read `status` back. `DELETE /v1/trade-orders/{id}` answers `200` with `deletedCount: 0`; orders are not deletable.

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

**Retry and idempotency:**

`createPayment` is idempotent on the pair (`method`, `transactionId`). If a payment already exists under the same payment method with the same `transactionId`, the call is a **silent no-op** — no new payment order is recorded, no error is raised, and the response is the same shape as a fresh creation.

| Aspect | Behavior |
|--------|----------|
| Idempotency key | (`method`, `transactionId`). The same `transactionId` under two different methods is treated as two distinct payments. |
| Behavior on repeat | Silent no-op. No duplicate payment, no error, no side effects on order items or accounts. |
| Property comparison | None. The other fields (`amount`, `currency`, `items`, `means`, `timestamp`, `consumerPrintout`, `merchantPrintout`, `rawData`) are **not** compared against the existing payment. If you need to detect a clash, query the existing payment order yourself (e.g. `GET /v1/payment-orders~where(transactionId=...)`). |
| Missing `transactionId` | Still rejected with `"Payment transaction ID is required."` — only requests with a `transactionId` can benefit from idempotent retry. |
| Integration-backed methods | Still rejected with `"createPayment is not supported for payment methods associated with an integration."` The idempotency check runs **after** this validation, so retries on integration-backed methods do not silently pass either. |

This makes `createPayment` safe to retry after a network blip or partial-success response — resend the same `transactionId` (with the same args, or even different args) and you get exactly-once payment creation.

> **Note:** This contract covers `createPayment` only. The sibling `createWalletPayment` action has its own semantics and is not covered here.

### Fulfill Order (tryFulfill)

```bash
PATCH /v1/trade-orders/com.example.orderId=ORD-001/actions
{"tryFulfill": true}
```

**Effects:**
- Fulfills every eligible item on the order, committing `New`, `Reserved` and `Unreserved` items first as needed
- For physical product instances, performs a physical move from each item's source place to its destination place
- Lines that are not eligible are left where they are, so a partly fulfilled order keeps both statuses (see [Status Behavior](#status-behavior))
- On a **purchase order** it receives everything ordered into the customer store's stock with no delivery document — the shortcut for goods that arrived exactly as ordered. See [Working with Purchasing](purchasing.md#receive-everything-without-a-document-tryfulfill--long-standing)

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

### Where Shipment Orders Come From

A shipment order comes from the trade order's `createShipment` action, on the releases that have it. Nothing else creates one: **`tryFulfill` fulfils the order directly and raises no shipment order** — the order reads `Fulfilled`, the sold units leave the seller's stock, and `GET …/shipments` stays `[]` (the physical count at the source place moves only when the buyer has a destination place, see [gotcha 57](../common-gotchas.md#57-tryfulfill-leaves-physicalquantity-alone-unless-the-buyer-has-a-place)) — and `POST /v1/shipment-orders` does not create a usable shipment: the collection has no `create`, so a body carrying `shipper`, `recipient`, `items` and the rest is **dropped** and all you get back is an identifier shell with none of the fields you sent.

> **Availability: v26.1.12 and earlier.** Approve the order, send `{"createShipment": true}`, then `release` the shipment order it created. `tryFulfill` is the alternative that fulfils the order without a shipment order.
>
> **Availability: v26.2.1 and later.** `createShipment` is removed and sending it is dropped: `200`, no shipment order. Outbound goods are booked as a delivery on `/v1/deliveries`.

```bash
# v26.1.12 and earlier: create the shipment order from the approved order's shippable lines
PATCH /v1/trade-orders/com.example.orderId=ORD-001/actions
{"createShipment": true}

GET /v1/trade-orders/com.example.orderId=ORD-001/shipments
```

It creates one shipment order from the lines that are `Committed` and physical, unless the order already has a shipment order in status `New` — then it does nothing, so sending it twice leaves one shipment. With no shippable line it creates nothing and still answers `200`. The lines must share buyer, seller, source and destination; a mix is refused. What you can do with a shipment order afterwards is read it and release it.

### Releasing Shipments

Once a shipment order exists, you can release it using the `release` action:

```bash
PATCH /v1/shipment-orders/com.example.shipmentId=SHIP-001/actions
{"release": true}
```

> **Note:** `release` is the only action available on shipment orders, and it is the only write a shipment order takes. Its contents come from the trade order it was created from — see [Where Shipment Orders Come From](#where-shipment-orders-come-from).

See the [Stock guide](stock.md) for detailed shipment management.

---

## Order Addresses

Orders have separate address collections for invoicing and delivery.

### Address Types

| Type | Purpose | Common Use |
|------|---------|------------|
| `deliveryAddresses` | Where to ship | Customer's home/office |
| `invoiceAddresses` | Where to bill | Customer's billing address |

> **The order-level `deliveryAddresses` is a union.** It reads the order's own delivery address together with every address set on a line, so it does not say where any particular line goes. On an order placed at the till a collect-in-store line reads `deliveryAddresses: []` while the order still lists the customer's address on file. Read the line — see [Orders placed at the till](#orders-placed-at-the-till-collect-in-store-and-ship-to-customer) and [gotcha 58](../common-gotchas.md#58-the-order-level-deliveryaddresses-is-a-union-not-the-delivery-mode).

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

### Reading Labels

```bash
# Get an order's labels
GET /v1/trade-orders/com.example.orderId=ORD-001/labels

# Get order with labels expanded
GET /v1/trade-orders/com.example.orderId=ORD-001~with(labels)

# Get orders with labels expanded (filter client-side)
GET /v1/trade-orders~with(labels)~take(50)
```

> **Note:** There is no server-side label filtering operator. Use `~with(labels)` and filter client-side. See the [Labels guide](../../guide/examples/labels.md#known-limitations) for details.

### Removing Labels

```bash
# Remove label from an order
DELETE /v1/trade-orders/com.example.orderId=ORD-001/labels/com.example.labelId=urgent
```

> See the [Labels guide](../../guide/examples/labels.md) for the complete reference including type restrictions, filtering, and integration patterns.

---

## Returns and Refunds

Returns are driven by three actions on the trade-order item lifecycle (`commitReturn`, `fulfillReturn`, `cancelReturn`). Money movement is handled separately as a negative `createPayment` — see [Refund Processing](#refund-processing) below.

> **Customer returns, not supplier returns.** These three actions are the tool for a record-level, POS-style **customer** return: no return document, no return number, and restocking into a single stock root. Sending goods back to a **supplier** is a document of its own — `/v1/returns`, with a reason per line, its own numbering and a commit/fulfill cycle that moves stock between the two parties. See [Working with Purchasing → Returns](purchasing.md#returns).

### Return Flow

```
Original Order (Fulfilled)
         │
         │ commitReturn
         ▼
┌─────────────────┐
│ ReturnCommitted │◄──────┐
└────────┬────────┘       │
         │                │
   ┌─────┴─────┐          │
   │           │          │
   │ fulfillReturn         │ cancelReturn
   ▼           ▼          │
┌─────────────────┐       │
│ ReturnFulfilled │  ┌────┴──────┐
└─────────────────┘  │ Fulfilled │ (item is back in original Fulfilled state)
                     └───────────┘
```

### Committing a Return

`commitReturn` is the entry point: it moves one or more items from `Fulfilled` (or `New`) into `ReturnCommitted`, captures the `returnParameters` (reason, restock, complaint, notes, optional replacement), and locks those parameters in for the lifetime of the return. Use it to initiate any return from outside POS — for example, when an integrator processes a return through a web channel.

```bash
PATCH /v1/trade-orders/com.example.orderId=ORD-001/actions
{
  "commitReturn": {
    "items": [{
      "identifiers": { "key": "{trade-order-item-key}" },
      "returnParameters": {
        "reason": { "identifiers": { "com.example.id": "defective" } },
        "complaint": true,
        "restock": true,
        "internalNotes": "Customer reported water damage on day 3",
        "receiptNotes": "Returned per 30-day policy"
      }
    }],
    "returnee": { "identifiers": { "com.example.storeId": "STORE-001" } },
    "returner": { "identifiers": { "com.example.customerId": "CUST-001" } }
  }
}
```

**Preconditions**
- Each referenced item must currently be in `Fulfilled` or `New`.
- Each item must belong to the order in the URL.
- Each item must carry a `returnParameters` object, and `returnParameters.reason` must reference an existing return reason (look up via `GET /v1/return-reasons`).

**`returnParameters` fields**

| Field | Type | Required | Description |
|---|---|---|---|
| `reason` | return-reason ref | yes | Reference to a configured `ReturnReason`. |
| `complaint` | `boolean?` | no (default `false`) | Whether the return is a complaint (Swedish: *reklamation*). |
| `restock` | `boolean?` | no (default `true`) | Whether to restock the returnee's stock at fulfill-time. Only meaningful for `PhysicalObject` product instances. |
| `replacement` | product ref | no | Optional product issued as a replacement (exchange flows). |
| `manual` | `boolean?` | no (default `false`) | Whether parameters were chosen manually by a cashier. Integrations should leave this `false`. |
| `internalNotes` | `string?` | no | Stored in the system; not printed on the customer receipt. |
| `receiptNotes` | `string?` | no | Printed on the customer receipt. |

**Returnee and returner defaults**

Both `returnee` and `returner` are optional at the request level:
- `returnee` defaults to the item's original `seller`.
- `returner` defaults to the item's original `buyer`.

Overrides apply to all items in the batch. If different items need different returnees, make separate PATCH calls.

**Targeting a specific product instance**

Each item entry accepts an optional `productInstance` field for IMEI-tracked or otherwise serialized lines. Resolution honours `identifiers` and `serialNumber`; other product-instance fields (`quantity`, `batch`, `domain`) are accepted in the body but ignored. Omit `productInstance` to return the whole line.

```jsonc
{
  "commitReturn": {
    "items": [{
      "identifiers": { "key": "{trade-order-item-key}" },
      "returnParameters": {
        "reason": { "identifiers": { "com.example.id": "defective" } }
      },
      "productInstance": {
        "identifiers": { "key": "{product-instance-key}" },
        "serialNumber": "IMEI-987654321098765"
      }
    }]
  }
}
```

### Fulfilling a Return

`fulfillReturn` is the completion step: items move from `ReturnCommitted` to `ReturnFulfilled`. If `returnParameters.restock` was `true` at commit-time and the product instance is a `PhysicalObject`, stock is moved back into the returnee's place as part of the same transaction. The `returnParameters` themselves are not re-supplied here — they were locked in at commit-time.

```bash
PATCH /v1/trade-orders/com.example.orderId=ORD-001/actions
{
  "fulfillReturn": {
    "items": [{
      "identifiers": { "key": "{trade-order-item-key}" }
    }]
  }
}
```

**Preconditions**
- Each referenced item must currently be in `ReturnCommitted`.
- Each item must belong to the order in the URL.

The per-item shape supports the same optional `productInstance` selector as `commitReturn`.

### Cancelling a Return

`cancelReturn` reverses a committed return: items move from `ReturnCommitted` back to `Fulfilled`. Use it when the customer changes their mind before the return is fulfilled, or when the return is rejected at receiving (for example, the goods returned don't match what was committed).

```bash
PATCH /v1/trade-orders/com.example.orderId=ORD-001/actions
{
  "cancelReturn": {
    "items": [{
      "identifiers": { "key": "{trade-order-item-key}" }
    }]
  }
}
```

**Preconditions**
- Each referenced item must currently be in `ReturnCommitted`.
- Each item must belong to the order in the URL.

The per-item shape supports the same optional `productInstance` selector as `commitReturn`.

### Validation and Error Behaviour

All preflight checks happen before any state mutation. A bad item in a batch fails the whole call without partial commits. Common 400-class errors:

- `items` is empty.
- Item not found, or matches more than one item.
- Item belongs to a different order than the one in the URL.
- Item is not in the required precondition state.
- `commitReturn`: missing `returnParameters`, or missing `returnParameters.reason`.
- Invalid `returnee`, `returner`, `reason`, or `replacement` reference (must resolve to exactly one existing entity).
- `productInstance` does not resolve to exactly one instance on the line.

### Refund Processing

The return actions only handle state transitions and stock movement. Money is moved separately by recording a negative payment against the order:

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
| Set a line's delivery address | PATCH | `/v1/trade-order-items/{key}` | `{"deliveryAddresses": []}` or one address, while `New`/`Reserved` |
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
| Get items | GET | `/v1/shipment-orders/{id}/items` | Line items |
| Release shipment | PATCH | `/v1/shipment-orders/{id}/actions` | Release shipment (`{"release": true}`) |

> **Note:** There is no create operation on this collection: `POST /v1/shipment-orders` returns an identifier shell with the body dropped. A shipment order is created from an approved trade order by `{"createShipment": true}` on v26.1.12 and earlier; v26.2.1 and later has no `createShipment`, and `tryFulfill` never creates one on any release — see [Where Shipment Orders Come From](#where-shipment-orders-come-from).

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
# Filter by status — = matches only orders whose single status is Committed
GET /v1/trade-orders~where(status=Committed)~take(50)

# Orders with at least one Committed line (still open) — =~ is "includes"
GET /v1/trade-orders~where(status=~Committed)~take(50)

# Filter by customer
GET /v1/trade-orders~where(customer/identifiers/com.example.customerId=CUST-001)~take(50)

# Filter by date range
GET /v1/trade-orders~where(timestamp>=2024-01-01)~where(timestamp<2024-02-01)~take(50)

# Filter by seller
GET /v1/trade-orders~where(sellers/com.example.storeId=STORE-001)~take(50)
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
GET /v1/trade-orders~where(customer/identifiers/com.example.customerId=CUST-001)~first

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

3. **Fulfill the order:**
   ```bash
   PATCH /v1/trade-orders/com.example.orderId=ORD-001/actions
   {"tryFulfill": true}
   ```
   The order reads `Fulfilled` and the sold units leave the seller's stock. The physical count at the source stock place (`physicalQuantity`) moves only when the buyer has a destination place: a stock root, or a main or delivery address. A sale to a customer with neither leaves `physicalQuantity` where it was. No shipment order is created by this action.

**Checkpoint:** Orders progress through Committed → Fulfilled.

### Phase 4: Refunds and Edge Cases

**Goal:** Handle refunds and complex scenarios.

> **Note:** Customer returns are driven by the `commitReturn`, `fulfillReturn` and `cancelReturn` actions — see [Returns and Refunds](#returns-and-refunds). Supplier returns are documents on `/v1/returns` — see [Working with Purchasing](purchasing.md#returns).

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

### Step 7: Fulfill

```bash
# Fulfill the order: eligible lines are fulfilled and the seller's stock is debited. No shipment order is created
PATCH /v1/trade-orders/com.example.orderId=ORD-MOBILE-2024-001/actions
{"tryFulfill": true}
```

> **Note:** To ship through a shipment order instead, on v26.1.12 and earlier send `{"createShipment": true}` to the approved order and `release` the shipment order it creates — `release` is the only write a shipment order takes. v26.2.1 and later has no `createShipment` — see [Where Shipment Orders Come From](#where-shipment-orders-come-from).

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
- [Purchasing](purchasing.md) - Receiving a purchase order with deliveries, and sending goods back to a supplier with returns
- [Stock](stock.md) - Inventory and shipment management
- [Receipts](../receipts.md) - Completed transaction records
- [Trade Records](../trade-records.md) - What the ledger actually did to an order, action by action
