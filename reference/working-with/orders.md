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
┌───────────┐  tryCancel / cancelRemainder  ┌───────────┐
│ Committed │ ─────── cancelItems ─────────►│ Cancelled │
└─────┬─────┘                               └───────────┘
      │
      │ fulfill
      ▼
┌───────────┐
│ Fulfilled │
└─────┬─────┘
      │ commitReturn
      ▼
┌─────────────────┐   cancelReturn   ┌─────────────────┐
│ ReturnCommitted │─────────────────►│ ReturnCancelled │
└────────┬────────┘                  └─────────────────┘
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
| `ReturnCommitted` | Return committed | ReturnFulfilled (via `fulfillReturn`), ReturnCancelled (via `cancelReturn`) |
| `ReturnFulfilled` | Return completed | (terminal) |
| `ReturnCancelled` | Return called off; the line is neither `Fulfilled` nor `New`, so it cannot be returned again | (terminal) |

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

**Two numbers the platform puts into `identifiers`.** Besides your own namespaced identifiers, an order can carry `identifiers.customersId` — the customer's number for the order — and `identifiers.suppliersId` — the supplier's. Each is issued on creation when the party is one of your own agents under the root organization node and `/v1/config/root-order` names a serial for it: `incomingTradeOrderSerial` for `customersId` (your purchase order number), `outgoingTradeOrderSerial` for `suppliersId` (your sales order number). Both are indexes — `GET /v1/trade-orders/customersId=PO-00001`. Inside `identifiers` they are read-only: a `PATCH` on `identifiers.customersId` is a `200` that changes nothing. **To set or change one, write the top-level member** — `customersId.id` or `suppliersId.id` — on `POST` or `PATCH`: "Set suppliersId.id or customersId.id when creating or updating an order; owner is derived from the order's supplier or customer." The member and the identifier are the same value: an order created with `"customersId": {"id": "PO-7"}` reads `identifiers.customersId "PO-7"` with the customer as `owner`; after `PATCH {"customersId": {"id": "PO-8"}}` the identifier reads `"PO-8"`, the owner is unchanged, and the old value no longer finds the order (`GET /v1/trade-orders/customersId=PO-7` → `200 null`). A non-string `id` is a coercion `400` (`targetType: "strict string"`) and neither id changes. The top-level members are non-essential; `~just(identifiers,customersId,suppliersId)` reads number and owner together. See [Working with Purchasing → Your Purchase Order Number](purchasing.md#your-purchase-order-number-identifierscustomersid).

### Order Fields (Optional)

| Field | Type | Description |
|-------|------|-------------|
| `reservedUntil` | datetime | Stock reservation expiry (optional) |
| `labels` | Label[] | Assigned labels (add/remove semantics) |

**Purchasing members.** A trade order used as a purchase order carries a further set of optional members. All are non-essential — fetch them with `~with(...)` — and all are settable on create and via `PATCH`.

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
| `deliveryAddresses` | Address[] (at most one) | Where this line ships to. `[]` means the line is collected in the `seller` store and lands on the buyer's own stock root; one address means it ships there. Inherits the order's delivery address unless set. Writable on `PATCH /v1/trade-order-items/{key}` while the line is `New` or `Reserved`; ignored once `Committed`; two addresses answer `400`. Non-essential — see [Orders placed at the till](#orders-placed-at-the-till-collect-in-store-and-ship-to-customer) |
| `sellerStock` | stock reference | The seller's logical stock the line is sold from. Defaults to the seller's default stock; `null` selects that default again. Must be one of the seller's stocks. Writable while the line is `New`; afterwards `409`. Non-essential — see [Which logical stock a line uses](#which-logical-stock-a-line-uses-sellerstock-and-buyerstock) |
| `buyerStock` | stock reference | The buyer's logical stock the line is received into, with the same rules as `sellerStock` applied to the `buyer`. A person has a default stock too (`Main`), so it is never empty on a sales order |

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

> **`seller`, `buyer`, `deliveryAddresses`, `reservedUntil`, `sellerStock` and `buyerStock` are non-essential on a line.** None of them is in the order's `items` in the default form, with `?fields=all` on the order, or with `~with(items)`. Ask for them by name: `~with(items~with(seller,buyer,deliveryAddresses,statusDetails))`, a `~just(items~just(…))` projection, `GET /v1/trade-orders/{id}/items?fields=all`, or the line itself on `/v1/trade-order-items/{key}`.

#### Which logical stock a line uses: `sellerStock` and `buyerStock`

A store can keep several logical stocks (a sales stock, a demo stock, a consignment stock — see [Stock guide → Part 1](../../guide/examples/stock-inventory-guide.md#part-1-concepts--the-two-dimensional-inventory-model)). `sellerStock` names the one a line is sold from and `buyerStock` the one it is received into; without a choice they are the default stock of the line's `seller` and `buyer`. Set them per item in the create body, or on the line while it is `New`:

```bash
POST /v1/trade-orders
[{ …, "items": [{ "product": {"identifiers": {"com.example.sku": "PROD-001"}}, "quantity": "2",
                  "sellerStock": {"identifiers": {"com.example.warehouseCode": "DEMO"}} }] }]

PATCH /v1/trade-order-items/com.example.itemId=ORD-001-1
{"sellerStock": null}                                    # back to the seller's default stock

GET /v1/trade-order-items/com.example.itemId=ORD-001-1~with(sellerStock,buyerStock)
```

| Request | Answer |
|---|---|
| A stock of another store or company | `400`, `details` `The sellerStock of a trade order item must be one of the stocks of its seller.` (at creation prefixed with `Error on order item nr <n>: `) |
| A stock that does not exist, at creation | `400` `Invalid sellerStock match. The stock must match exactly one existing stock`; on an update the "must be one of the stocks" text, and no stock is created |
| A change once the line is no longer `New` (`Reserved`, `Committed`, …) | `409`, `@type` `state conflict`, `details` `The sellerStock of a trade order item can only be changed while the item is New.`, `info.status` the line's status. Sending the stock the line already has is `200` in any status |
| `"sellerStock": {"identifiers": {…}, "name": "New name"}` | selects the stock; the stock's own members are left alone |

`buyerStock` follows the same rules with "buyer". A reservation (`reservedUntil`) and an approval hold the units against the named stock, not the default one; the product's `stockLevels` still report per store. Filter lines by stock with `~where(sellerStock/identifiers/<key>=…)` or `~where(sellerStock/name=…)` — the short forms `sellerStock/<key>=…` and `sellerStock/key=…` match nothing, as for `seller`. The members read and write under the order scopes, but the stock resolves only when the key can also read stocks: without `stock:read` both read `null` and a write is a `200` that stores nothing.

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

**One seller per order.** Every line of a trade order ships from one place — its seller's stock root — so `sellers` must name exactly one store. A `POST` with two sellers is refused before anything is created, whether or not the lines carry their own `seller`:

```bash
POST /v1/trade-orders
[{ "identifiers": {"com.example.orderId": "ORD-MULTI"},
   "supplier": {"identifiers": {"com.example.companyId": "OUR-COMPANY"}},
   "customer": {"identifiers": {"com.example.customerId": "CUST-001"}},
   "sellers": [ {"identifiers": {"com.example.storeId": "STORE-NORTH"}},
                {"identifiers": {"com.example.storeId": "STORE-SOUTH"}} ],
   "currency": {"identifiers": {"currencyCode": "SEK"}},
   "items": [ … ] }]
```

```json
400 { "@type": "bad request", "error": "The request was invalid and could not be processed.",
      "details": "Could not create order: Several parties given; a trade needs exactly one." }
```

When items come from different stores, create one order per store. The same rule refuses a seller that has **several stock roots**: `400` `details` `Could not create order: <name> has several stock roots; a trade needs exactly one.` — give the selling store one stock root (see [Stock guide → Agent Stock Roots](stock.md#agent-stock-roots)). A multi-seller order can still exist — the till creates one when the cashier picks several stores (see [Orders placed at the till](#orders-placed-at-the-till-collect-in-store-and-ship-to-customer)) — and reads like any other.

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

A cashier can turn the lines in a cart into a customer order with the till's "Add to order" tile. The cashier picks a **delivery mode** — collect in store or ship to the customer — the **store** the goods come from, and a **payment mode** — pay now or pay later. The result is an ordinary trade order on `/v1/trade-orders`, so an order-management, warehouse or e-commerce integration reads it like any other. What differs is how you recognise one, how you tell the two delivery modes apart, which store hands the goods over, and what the till does to the order afterwards.

The cart itself, before the cashier completes it, is readable and changeable at `/v1/pos-terminals/{id}/cart`; its `draftOrder` is the numberless `New` order described under [Finding and polling till orders](#finding-and-polling-till-orders). See [Working with POS Carts](pos-carts.md).

This is a different thing from the [click-and-collect order](#click-and-collect-order) above, which an integration **creates** through the API with `reservedUntil`. A till order is created by the till, has no expiry, and is finished either at the till or by the integration, depending on its delivery mode.

#### What the till writes

- `identifiers.suppliersId` — the order number, assigned when the cart is completed. The till shows it as "Order #1000000". Every completed till order has one, and so does every order created through the API; the only orders without one are the till's open carts (see [Finding and polling till orders](#finding-and-polling-till-orders)).
- `createdBy` — the cashier. `customer`, `buyers` and `relationship` — the customer attached to the cart. `supplier` — the company.
- `sellers` — the set of stores the cashier picked. Each line's own `seller` is the store that sells and hands over *that* line.
- `deliveryAddresses` **on each line** — `[]` for a collect-in-store line, the one address the cashier picked (prefilled from the customer's delivery or main address) for a ship-to-customer line.
- `labels` — whatever the tile's configuration applies by default plus what the cashier picked. Nothing configured, no labels. See [Configuring the "Add to order" tile](../../guide/examples/pos.md#the-order-function-collect-in-store-and-ship-to-customer).
- `reservedUntil` — `null`, on the order and on every line. A pay-later till order does not expire.

#### The delivery mode is on the line, not on the order

Read `deliveryAddresses` on the **item**. `[]` means the line is collected in its `seller` store; one address means it ships from the `seller` store to that address. Either way the line has a destination: a shipped line goes to that address as a place, a collected line goes to the buyer's own stock root, which is why a collected order moves `physicalQuantity` at the seller just as a shipped one does (see [Fulfill Order](#fulfill-order-tryfulfill)). The four members that matter are non-essential on a line, so name them:

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

`200 {"@type": "trade order actions"}`. Read back: `status ["Fulfilled"]`, line Fulfilled, `balanceAmount "0"`, a second trade record with one `Fulfill` action, `pickingOrders []`, `shipments []` — `tryFulfill` raises no shipment order (see [Where Shipment Orders Come From](#where-shipment-orders-come-from)). The units leave the line's `seller` stock and its stock root's place and land at the line's delivery address as a place, as for any order (see [Fulfill Order](#fulfill-order-tryfulfill)).

Booking a delivery on `/v1/deliveries` is the alternative, described under [Where Shipment Orders Come From](#where-shipment-orders-come-from); it has not been measured on a till-created order.

#### Cancelling a till order

| Who | Order state | Result |
|---|---|---|
| API `{"tryCancel": true}` | `Reserved` (pay later, not picked up) | `200`, **nothing changes** — the order stays `Reserved` and the reservation is kept, as the [`tryCancel` preconditions](#cancel-order-trycancel) say |
| Till, cancel the order or a line | `Reserved` | `status ["Unreserved"]`, line `statusDetails` Unreserved, a second trade record with one `Unreserve` action, a POS slip (`slipKind "order"`, action `Unreserve`), the reservation released from the stock level, `balanceAmount "0"` while `totalAmount` stays |
| API `{"tryCancel": true}` | `Committed`, paid now, not yet shipped | **Refused**, `400`, nothing cancelled: the prepayment was taken in a till, and the refund has to be made where the payment was — `details` `The cancellation would refund a payment taken in a till (<method>); do it in the POS, where the refund is documented.` See [the refund gate](#cancel-order-trycancel) |
| Till | `Committed`, paid now | The till cancels with a refund, referenced to the original payment where the method supports it and otherwise paid out, documented on a receipt (Sweden) or a `prepayment-refund` slip (Norway) |

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
2. **VAT class** (the product's own or its group's) and the VAT rule for it in the selling store's VAT area
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
- **VAT calculation:** The VAT percentage comes from the product's VAT class (own or inherited) and the rule for it in the seller's VAT area. `unitAmountExclVat` is the net manual price you write; `unitAmountInclVat` is read-only and derived. See [VAT](vat.md#vat-areas-and-the-reference-pack).
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
| `tryApprove` | `true` | Commits the order (reserves stock); assigns own GTINs where `autoGtin` asks for them |
| `tryFulfill` | `true` | Fulfills all eligible items (committing `New`, `Reserved` and `Unreserved` items first as needed) and moves the physical units from each item's source place to its destination place |
| `tryCancel` | `true` | Cancels a wholly `Committed` order and credits the money paid towards the cancelled units back on their payments; refused when that refund has to be made elsewhere |
| `cancelRemainder` | `true` | Cancels the committed, not yet fulfilled part of every item — the open remainder of a partly received purchase order; credits as `tryCancel` does |
| `cancelItems` | `{"items": [...]}` | Cancels part of an approved order, per item, to a target `cancelledQuantity`; credits as `tryCancel` does |
| `commitReturn` | Return commit object | Commits a return for one or more items (Fulfilled/New → ReturnCommitted) |
| `fulfillReturn` | Return ref object | Fulfills a previously-committed return (ReturnCommitted → ReturnFulfilled; restocks if `restock=true` at commit); credits the returned units' money on their payments |
| `cancelReturn` | Return ref object | Cancels a previously-committed return (ReturnCommitted → ReturnCancelled; the line cannot be returned again) |
| `createPayment` | Payment object | Records a payment against the order; `amount` defaults to what is still owed |
| `createWalletPayment` | Wallet payment object | Creates a payment using a wallet (gift card, store credit, voucher) |
| `reversePayment` | Reversal object | Refunds part of a payment recorded on the order, referenced to that payment, for units released without a credit |
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

**Own GTINs on approval.** A product whose `autoGtin` is in effect (its own setting, else the nearest group's or family's) gets a GTIN from the buyer's own GS1 series when an order for it is approved: `tryApprove`, and `tryFulfill` on a `New`, `Reserved` or `Unreserved` order, assign the next codes of the buyer's assortment owner's GTIN-13 series to the flagged products on the rows being approved, skipping codes a product already carries; a cancelled row does not count. When the series cannot cover the demand the action is refused with `400` saying how many numbers the series are short, and nothing is approved. Approving a one-line purchase order for a product with `autoGtin: true` and no GTIN gives it the series' `nextCode` (read `~with(gtin)`), and the series moves on. See [Working with Products → GTIN and PLU Codes](products.md#gtin-and-plu-codes).

### Cancel Order (tryCancel)

```bash
PATCH /v1/trade-orders/com.example.orderId=ORD-001/actions
{"tryCancel": true}
```

> Attempts to cancel the entire order. Refunds the money paid towards the cancelled units by recording a Credit on each of their payments, keyed by the cancellation's trade record (see `reversePayment`); refused (400), cancelling nothing, when such a payment was taken in a till, goes through a payment integration or came from a wallet, since the refund then has to be made where the payment was.

**Effects:**
- Sets status to `Cancelled`
- Releases stock reservations
- Credits the money paid towards the cancelled units back on each of their payments: a `Committed` order paid in full with two `createPayment` calls (375 and 125) reads, after `tryCancel`, `status ["Cancelled"]`, `balanceAmount "0"`, and each payment order `creditedAmount` equal to its `limitAmount` with `status ["Credited", "Debited"]`. `creditedAmount` is not in a payment's default body — read `GET /v1/trade-orders/{id}/payments~withAll` or `~with(payments~with(creditedAmount))`

**Preconditions:**
- Order must have status `Committed` (only committed orders can be cancelled via this action)
- Orders in `New` or `Reserved` status cannot be cancelled with this action — that includes a pay-later order placed at the till, which is `Reserved` until it is picked up; the till cancels it (see [Cancelling a till order](#cancelling-a-till-order))
- Orders in `Fulfilled` status cannot be cancelled (use return flow instead)
- A **partly fulfilled** order (`["Committed", "Fulfilled"]`) is not cancelled either: the action answers `200` and changes nothing. The open remainder is cancelled with [`cancelRemainder`](#cancel-the-remainder-cancelremainder); single lines with [`cancelItems`](#cancel-items-cancelitems)

In every "cannot" case above the response is still `200` — read `status` back. `DELETE /v1/trade-orders/{id}` answers `200` with `deletedCount: 0`; orders are not deletable.

**The refund gate.** `tryCancel`, `cancelRemainder`, `cancelItems` and `fulfillReturn` record a Credit on each payment for the money paid towards the released units. When that money has to be refunded where the payment was taken, the action is refused with `400` and moves nothing. The three texts — `<action>` is `cancellation` or `return`, `<method>` the payment method id:

```
The <action> would refund a payment taken in a till (<method>); do it in the POS, where the refund is documented.
The <action> would refund a payment processed by a payment integration (<method>); do it in the POS, where the refund goes through the integration.
The <action> would refund a wallet payment (<method>); refund it onto the wallet first, with createWalletPayment and action Credit.
```

The gate is about what can be recorded, not about the method's `supportsReversal` flag: a payment recorded from outside with every flag `false` is credited. Only the payments behind the released units are consulted — an order paid by a till payment and a cash-like one is refused only when the released units were paid by the till payment; cancelling unpaid units credits nothing and is not refused. A payment recorded before `tryApprove` is stranded on a `New` order and attached (and credited) on a `Reserved` one. A line is credited at its incl.-VAT amount, whatever its rate. A wallet-paid return is refused until `createWalletPayment` with action `Credit` has been recorded, and then fulfils without a second credit. `cancelReturn` and `commitReturn` move no money and are not gated. The till-payment and integration refusals are from the API's own text; they cannot be reproduced with payments recorded through the API, since those are neither.

### Cancel the Remainder (cancelRemainder)

> Cancels the committed, not yet fulfilled part of every item, e.g. the outstanding remainder of a partly received purchase order. Refused (400) while the order is in a POS checkout; a no-op when nothing is outstanding. Refunds the money paid towards the cancelled units by recording a Credit on each of their payments, keyed by the cancellation's trade record (see `reversePayment`); refused (400), cancelling nothing, when such a payment was taken in a till, goes through a payment integration or came from a wallet, since the refund then has to be made where the payment was.

```bash
PATCH /v1/trade-orders/com.example.orderId=PO-1/actions
{"cancelRemainder": true}
```

A purchase order of 10 + 5 with 8 of the first line received and approved reads `status ["Committed", "Fulfilled"]`. After `cancelRemainder`: `200`, `status ["Cancelled", "Fulfilled"]`, the first line's `statusDetails` `[{"status": "Cancelled", "quantity": "2"}, {"status": "Fulfilled", "quantity": "8"}]`, the second line `Cancelled 5`, `deliveryDiscrepancy ["None"]`, store stock still 8. One trade record is added, with a `Cancel` action per line (`quantity` 2 and 5). A repeat call, and a call on a `New` order, answer `200` and post no record. A `POST /v1/deliveries` from the order afterwards is `400` `The order has no committed items to deliver.` Compare `tryCancel`, which acts only while the status is `Committed` alone and leaves a partly received order untouched. The `PUT …/actions/cancelRemainder` form with body `true` follows the other actions' pattern. See [Working with Purchasing → Cancelling, and Closing the Rest of a Partly Received Order](purchasing.md#cancelling-and-closing-the-rest-of-a-partly-received-order).

### Cancel Items (cancelItems)

> Cancels part of an approved order, per item: ensures that at least `cancelledQuantity` units of each listed item are Cancelled, taking the shortfall from the item's Committed units and nothing else. Idempotent and monotone: a target at or below what is already cancelled is a no-op, and nothing is ever un-cancelled. Fulfilled, returned, New and Reserved units are never touched; a target they put out of reach is met as far as the Committed units allow and the call still answers 200. Refused (400) while the order is in a POS checkout. Refunds the money paid towards the cancelled units by recording a Credit on each of their payments, keyed by the cancellation's trade record (see `reversePayment`); refused (400), cancelling nothing, when such a payment was taken in a till, goes through a payment integration or came from a wallet, since the refund then has to be made where the payment was.

```bash
PATCH /v1/trade-orders/com.example.orderId=ORD-001/actions
{
  "cancelItems": {
    "items": [
      { "identifiers": {"com.example.itemId": "ORD-001-2"}, "cancelledQuantity": "1" }
    ]
  }
}
```

| Member of each item | Meaning |
|---|---|
| `identifiers` | The trade-order item |
| `cancelledQuantity` | **A target, not a delta:** the number of units of the item that must be `Cancelled` after the call, counting units cancelled earlier. Omitted, it is the item's quantity — cancel everything still `Committed`. A feed can send its cumulative count on every poll; nothing moves after the first |
| `productInstance` | Restricts the cancellation to one product instance of a serialised line, in the shape the return actions take (`{identifiers, serialNumber?}`); `cancelledQuantity` is then ignored. The instance is cancelled if it is `Committed` and left alone otherwise; an instance that is not on the item answers `400` |

Measured on a `Committed` three-unit line paid in full (unit 125 incl. VAT, cash 375):

| Call | Afterwards |
|---|---|
| `cancelledQuantity: "1"` | `200`; line `statusDetails` `[{"status": "Cancelled", "quantity": "1"}, {"status": "Committed", "quantity": "2"}]`, order `status ["Cancelled", "Committed"]`, one new trade record (`Cancel`, `quantity "1"`); the payment order reads `creditedAmount "125"`, `status ["Credited", "Debited"]`; `balanceAmount` stays `"0"` |
| the same body again | `200`, unchanged, no new trade record, no further credit |
| `{"identifiers": {…}}` with no target | `200`; the line `Cancelled 3`, the order `["Cancelled"]`, `creditedAmount "375"` |
| `tryCancel` on the now-cancelled order | `200`, nothing changes |

Read the split back with `GET /v1/trade-orders/{key}~with(items~with(status,statusDetails))`. One trade record per call, none when nothing moves; the order's `status` is the union over its items. Refusals, all `400` with nothing moved — one bad entry fails the whole call:

| Body | `details` |
|---|---|
| `items: []` | `cancelItems requires at least one item.` |
| An item that matches nothing | `Invalid item match — each item must reference an existing trade-order item.` |
| Another order's item | `Item does not belong to the order.` |
| A negative target | `Quantity cannot be negative.` |
| An instance not on the item | `Invalid productInstance — could not resolve to an instance on this item.` |
| The order is in a live or parked POS checkout | the checkout guard's own text |
| A refund that has to be made elsewhere | the [refund gate](#cancel-order-trycancel) texts |

### Create Payment

Records a payment against the order.

> Creates a simplified payment for the order. `amount` defaults to what is still owed on the listed items, or on the whole order; an amount beyond that is refused (400), since the surplus could be settled against nothing. Idempotent on `transactionId` + `method`: if a payment with the same transaction ID already exists under the same payment method, the call is a silent no-op and the other args are ignored — safe to retry.

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

**Default amount: what is still owed.** Without `amount`, the payment is what is still owed on the listed `items`, or on the whole order when `items` is omitted — not the lines' amounts. On an order of two lines, 125 and 375 incl. VAT (`balanceAmount "-500"`):

| Call | Answer |
|---|---|
| `createPayment` with `items: [the 375 line]`, no `amount` | `200`; the payment order's `limitAmount "375"`, `balanceAmount "-125"` |
| a bare `createPayment` (no `items`, no `amount`) | `200`; `limitAmount "125"`, `balanceAmount "0"` |
| a third bare `createPayment` | `400` `Nothing to pay: nothing is owed on the listed items.` |
| an explicit `amount` beyond what is owed (`"200"` against the 125 still open) | `400` `Amount exceeds the unpaid amount (125).`, nothing recorded |

A negative `amount` is not capped: it records an **unreferenced payout** — a payment order of its own, `limitAmount "50"`, `status ["Debited"]` for `amount: "-50"` — that does not settle against the order: the order's `payments` and `balanceAmount` do not change, and the payout's payment order has no related trade orders. To refund money that was paid towards released units, use the cancel actions, `fulfillReturn` or [`reversePayment`](#reverse-a-payment-reversepayment) instead. Other refusals, all `400` with nothing recorded: `Currency not found.` for an unknown currency, `Order item not found.` for an unknown item (the same text in `createWalletPayment`); an unpriced line with an explicit amount is refused as well, since nothing is owed on it.

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

### Reverse a Payment (reversePayment)

> Refunds part of a payment recorded on the order, referenced to that payment: records a Credit on the payment order, visible as its `creditedAmount` and a `Credited` status, and settles it against the order's ledger. What can be reversed is the part of the payment that paid for units no longer bound to goods — Cancelled, or returned and ReturnFulfilled — and not yet credited. The cancel actions and `fulfillReturn` credit their units' money themselves, so this is for units released without that credit. `amount` defaults to all of it. Idempotent on `transactionId` per payment. Refused (400) when nothing is reversible, when `amount` exceeds the reversible remainder, when the payment is not allocated to this order, when its method has a payment integration or is a wallet (reverse it where it was taken, or use `createWalletPayment` with `action: Credit`), and when the payment was taken in a till (reverse it there, so that the refund is documented). Declared last; a request that cancels or returns and also reverses answers 400 with nothing to reverse, and the cancellation is rolled back with it.

```bash
PATCH /v1/trade-orders/com.example.orderId=ORD-001/actions
{
  "reversePayment": {
    "payment": {
      "identifiers": {
        "processorsId": { "method": {"identifiers": {"methodId": "com.heads.card"}}, "id": "TXN-001" }
      }
    },
    "transactionId": "REFUND-001",
    "timestamp": "2024-12-20T14:00:00Z",
    "amount": "125"
  }
}
```

| Member | Meaning |
|---|---|
| `payment` | The payment to reverse: by `{"identifiers": {"key": "…"}}`, or by its processors id — the `method` and the `transactionId` it was created with |
| `transactionId` | The reversal's own id, unique per payment. A repeat with the same id is a no-op — a feed that sends its state on every poll must send the provider's refund id, not a fresh one |
| `timestamp` | When the reversal was made |
| `amount` | Positive; optional, defaults to everything reversible on the payment |

The Credit lands on the original payment order: its `creditedAmount` rises and its `status` gains `Credited`, readable on `/v1/payment-orders/{key}` and in the order's `payments` (`~withAll`; `creditedAmount` is not in the default body). On a unit released without a credit, a reversal of one 125-unit answers `200` and `creditedAmount "125"`; the same `transactionId` again leaves it unchanged; `amount "250"` with one unit released is `400` `Amount exceeds the reversible amount (125).` The effect is on the payment, not on the order: `balanceAmount` is `"0"` before and after a cancel-and-reverse.

Because `tryCancel`, `cancelRemainder`, `cancelItems` and `fulfillReturn` credit the released units' money themselves, a bare `reversePayment` after any of them is `400` `Nothing to reverse: no unit paid by this payment has been cancelled or returned.` — and `{"cancelItems": …, "reversePayment": …}` in one `PATCH` answers the same `400` with the cancellation rolled back. Refusals, all `400`, nothing moved:

| `details` | When |
|---|---|
| `Payment not found.` | `payment` matches nothing |
| `Payment is not allocated to this order.` | another order's payment, or one recorded before `tryApprove`, which never attaches |
| `Nothing to reverse: no unit paid by this payment has been cancelled or returned.` | nothing is reversible |
| `Reversal amount must be positive.` | `amount` ≤ 0 |
| `Amount exceeds the reversible amount (<n>).` | `amount` beyond the reversible remainder |
| `Use createWalletPayment with direction Credit to refund onto a wallet.` | the payment's method is a wallet |
| `reversePayment is not supported for payment methods associated with an integration; reverse the payment where it was taken.` | the method has a payment integration |
| `This payment was taken in a till; reverse it there so that the refund is documented.` | the payment was taken in a till |

The payment method's `supportsReversal` and `supportsOutgoing` flags do not gate: a payment recorded from outside with every flag `false` reverses.

### Fulfill Order (tryFulfill)

```bash
PATCH /v1/trade-orders/com.example.orderId=ORD-001/actions
{"tryFulfill": true}
```

**Effects:**
- Fulfills every eligible item on the order, committing `New`, `Reserved` and `Unreserved` items first as needed
- For physical product instances, moves the units from each item's source place to its destination place: the sold units leave the seller's stock **and its stock root's place**, and land on the buyer's place. Every line carries both places — an item inherits its order's `source` and `destination`, an item whose seller or buyer changes gets that party's place — and a party's place is its stock root, else the place of its main or delivery address, else a stock root created for it on the spot. A sale of 2 to a person with no address and no stock root therefore reads `physicalQuantity` 7 before and **5** after at the seller's stock root, and the person then has a stock root of their own. `availableQuantity` at the seller moves at approval (7 → 5 for the 2 reserved), `physicalQuantity` at fulfilment
- Lines that are not eligible are left where they are, so a partly fulfilled order keeps both statuses (see [Status Behavior](#status-behavior))
- On a **purchase order** it receives everything ordered into the customer store's stock and onto its place with no delivery document — the shortcut for goods that arrived exactly as ordered. See [Working with Purchasing](purchasing.md#receive-everything-without-a-document-tryfulfill)
- No shipment order is created, and a stock entry that echoes the shelf count afterwards writes nothing — the place already reflects the sale (see [Stock Entries](../stock-entries.md#what-physicalquantity-is-measured-against))

```bash
GET /v1/stock-places/{key}~with(entries)                    # physicalQuantity 7, availableQuantity 7
PATCH /v1/trade-orders/{id}/actions  {"tryApprove": true}   # 2 sold to a person with no address: 7 / 5
PATCH /v1/trade-orders/{id}/actions  {"tryFulfill": true}
GET /v1/stock-places/{key}~with(entries)                    # physicalQuantity 5, availableQuantity 5
```

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

An action that is refused answers `400` with the reason in `details`, and moves nothing:

```json
{
  "@type": "bad request",
  "error": "The request was invalid and could not be processed.",
  "details": "The cancellation would refund a payment taken in a till (com.heads.card); do it in the POS, where the refund is documented."
}
```

A `tryApprove`, `tryCancel` or `tryFulfill` whose preconditions are not met answers `200` and changes nothing — read `status` back (see each action above). The refusal texts of `cancelItems`, `createPayment` and `reversePayment` are listed under their sections; the [refund gate](#cancel-order-trycancel) texts apply to every action that credits a payment. A `sellerStock` change on a line that is no longer `New` is a `409` `state conflict` with `info.status`.

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

No write on the API creates a shipment order. **`tryFulfill` fulfils the order directly and raises no shipment order** — the order reads `Fulfilled`, the sold units leave the seller's stock and its stock root's place, and `GET …/shipments` stays `[]` (see [gotcha 57](../common-gotchas.md#57-tryfulfill-moves-physicalquantity-from-the-sellers-place-to-the-buyers)) — and `POST /v1/shipment-orders` does not create a usable shipment: the collection has no `create`, so a body carrying `shipper`, `recipient`, `items` and the rest is **dropped** and all you get back is an identifier shell with none of the fields you sent.

`createShipment` is not a trade order action: sending `{"createShipment": true}` is dropped — `200`, no shipment order. Outbound goods are booked as a delivery on `/v1/deliveries`. What you can do with a shipment order is read it and release it.

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

Returns are driven by three actions on the trade-order item lifecycle (`commitReturn`, `fulfillReturn`, `cancelReturn`). `fulfillReturn` credits the returned units' money back on their payments itself; `reversePayment` covers units released without that credit — see [Refund Processing](#refund-processing) below.

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
│ ReturnFulfilled │  ┌────┴────────────┐
└─────────────────┘  │ ReturnCancelled │ (the line is neither Fulfilled nor New: it cannot be returned again)
                     └─────────────────┘
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

`fulfillReturn` is the completion step: items move from `ReturnCommitted` to `ReturnFulfilled`. If `returnParameters.restock` was `true` at commit-time and the product instance is a `PhysicalObject`, stock is moved back into the returnee's place as part of the same transaction; a return that does not restock still hands the goods back, into an anonymous account rather than the returnee's place. The `returnParameters` themselves are not re-supplied here — they were locked in at commit-time. The action also refunds the money paid towards the returned units by recording a Credit on each of their payments, keyed by the return's trade record, and is refused (`400`, returning nothing) when such a payment was taken in a till, goes through a payment integration or came from a wallet — the [refund gate](#cancel-order-trycancel).

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

`cancelReturn` calls off a committed return: items move from `ReturnCommitted` to `ReturnCancelled`. Use it when the customer changes their mind before the return is fulfilled, or when the return is rejected at receiving (for example, the goods returned don't match what was committed).

> Cancels a previously-committed return; moves items from ReturnCommitted to ReturnCancelled. A line in that state is neither Fulfilled nor New, so it cannot be returned again.

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

The per-item shape supports the same optional `productInstance` selector as `commitReturn`. Afterwards the line reads `statusDetails [{"status": "ReturnCancelled", "quantity": "2"}]` and the order `status ["ReturnCancelled"]`; a second `commitReturn` on it is `400` `Cannot commit return — item (or specified instance) is not in Fulfilled or New state.` The seller's place is untouched: the units left it at fulfilment and a cancelled return does not bring them back. `cancelReturn` moves no money.

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

A cancellation (`tryCancel`, `cancelRemainder`, `cancelItems`) or a `fulfillReturn` refunds the released units' money itself: it records a Credit on each payment behind those units, keyed by its own trade record, and the payment order reads `creditedAmount` with `status ["Credited", "Debited"]`. When the payment was taken in a till, goes through a payment integration or came from a wallet, the action is refused instead and the refund has to be made where the payment was — see [the refund gate](#cancel-order-trycancel).

[`reversePayment`](#reverse-a-payment-reversepayment) is for units released **without** that credit — cancelled or returned through another channel, or before the credit existed on the order. It credits the named payment for the part that paid for `Cancelled` or `ReturnFulfilled` units and is not yet credited:

```bash
PATCH /v1/trade-orders/com.example.orderId=ORD-001/actions
{
  "reversePayment": {
    "payment": {"identifiers": {"processorsId": {"method": {"identifiers": {"methodId": "com.heads.card"}}, "id": "TXN-001"}}},
    "transactionId": "REFUND-001",
    "timestamp": "2024-12-20T14:00:00Z"
  }
}
```

A negative `createPayment` is still accepted, but it is an **unreferenced payout**: a payment order of its own that does not settle against the order — the order's `payments` and `balanceAmount` do not change, and the payout's payment order has no related trade orders. Use it only for money that is not a refund of a recorded payment.

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

> **Note:** There is no create operation on this collection: `POST /v1/shipment-orders` returns an identifier shell with the body dropped. There is no `createShipment` action on a trade order, and `tryFulfill` never creates one — see [Where Shipment Orders Come From](#where-shipment-orders-come-from).

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

All `400`, the text in `details`, nothing moved:

| Action | `details` | Cause |
|--------|-------|-------|
| `tryApprove` | `<n>` numbers short (the series cannot cover the demand) | `autoGtin` products need more codes than the buyer's GS1 series hold |
| `tryCancel`, `cancelRemainder`, `cancelItems`, `fulfillReturn` | `The <cancellation\|return> would refund a payment taken in a till (<method>); do it in the POS, where the refund is documented.` and the two sibling texts | The refund has to be made where the payment was ([refund gate](#cancel-order-trycancel)) |
| `tryCancel`, `cancelRemainder`, `cancelItems` | the POS checkout guard's text | The order is in a live or parked POS checkout |
| `cancelItems` | `cancelItems requires at least one item.`, `Item does not belong to the order.`, `Quantity cannot be negative.`, … | See [Cancel Items](#cancel-items-cancelitems) |
| `createPayment` | `Amount exceeds the unpaid amount (<n>).` | Explicit `amount` beyond what is still owed |
| `createPayment` | `Nothing to pay: nothing is owed on the listed items.` | A bare call on a fully paid order or lines |
| `createPayment`, `createWalletPayment` | `Currency not found.`, `Order item not found.` | Unknown currency or item |
| `reversePayment` | `Nothing to reverse: …`, `Amount exceeds the reversible amount (<n>).`, … | See [Reverse a Payment](#reverse-a-payment-reversepayment) |
| `commitReturn` | `Cannot commit return — item (or specified instance) is not in Fulfilled or New state.` | The line is `ReturnCancelled`, `Committed`, … |
| `POST /v1/trade-orders` | `Could not create order: Several parties given; a trade needs exactly one.`, `Could not create order: <name> has several stock roots; a trade needs exactly one.` | Two sellers, or a seller with several stock roots |

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
     "vatClass": {"identifiers": {"com.heads.seedID": "vat-class-standard"}}
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
   The order reads `Fulfilled`, and the sold units leave the seller's stock and its stock root's place: `physicalQuantity` at the source goes down by the fulfilled quantity and the units land on the buyer's place (its stock root, else its main or delivery address, else a stock root made for the buyer). No shipment order is created by this action.

**Checkpoint:** Orders progress through Committed → Fulfilled.

### Phase 4: Refunds and Edge Cases

**Goal:** Handle refunds and complex scenarios.

> **Note:** Customer returns are driven by the `commitReturn`, `fulfillReturn` and `cancelReturn` actions — see [Returns and Refunds](#returns-and-refunds). Supplier returns are documents on `/v1/returns` — see [Working with Purchasing](purchasing.md#returns).

1. **Handle cancellations** — a cancellation credits the money paid towards the cancelled units back on their payments by itself; a partly fulfilled order takes `cancelRemainder` or `cancelItems`:
   ```bash
   PATCH /v1/trade-orders/com.example.orderId=ORD-002/actions
   {"tryCancel": true}

   PATCH /v1/trade-orders/com.example.orderId=ORD-003/actions
   {"cancelItems": {"items": [{"identifiers": {"com.example.itemId": "ORD-003-2"}, "cancelledQuantity": "1"}]}}
   ```
   Expect `400` with the [refund gate](#cancel-order-trycancel) text when the payment behind the cancelled units was taken in a till, through a payment integration or from a wallet — then the refund is made there.

2. **Refund units released without a credit** with `reversePayment`, referenced to the payment:
   ```bash
   PATCH /v1/trade-orders/com.example.orderId=ORD-001/actions
   {
     "reversePayment": {
       "payment": {"identifiers": {"processorsId": {"method": {"identifiers": {"methodId": "com.heads.card"}}, "id": "TXN-001"}}},
       "transactionId": "REFUND-001",
       "timestamp": "2024-12-20T14:00:00Z"
     }
   }
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
  "vatClass": {"identifiers": {"com.heads.seedID": "vat-class-standard"}},
  "classification": "Goods"
}

# Plan product
PUT /v1/products/com.example.sku=PLAN-UNLIMITED-24
{
  "name": "Unlimited 24-Month Plan",
  "instanceType": "MobilePlan",
  "status": "Active",
  "vatClass": {"identifiers": {"com.heads.seedID": "vat-class-standard"}},
  "classification": "Services"
}

# Accessory product
PUT /v1/products/com.example.sku=CASE-IPHONE-15
{
  "name": "iPhone 15 Protective Case",
  "status": "Active",
  "vatClass": {"identifiers": {"com.heads.seedID": "vat-class-standard"}},
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
# Fulfill the order: eligible lines are fulfilled, the units leave the seller's stock and its place. No shipment order is created
PATCH /v1/trade-orders/com.example.orderId=ORD-MOBILE-2024-001/actions
{"tryFulfill": true}
```

> **Note:** There is no `createShipment` action: outbound goods are booked as a delivery on `/v1/deliveries` — see [Where Shipment Orders Come From](#where-shipment-orders-come-from). `release` is the only write a shipment order takes.

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
