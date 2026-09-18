# Working with Purchasing: Purchase Orders, Deliveries and Returns

> **Availability:** ships in the release after v26.1.11. Not in v26.1.10 or v26.1.11.
>
> Sections marked **long-standing** are in every current release and need no such caveat.

This guide covers the buying side of a trade order end to end: placing a **purchase order** with a supplier, booking the goods that arrive with `/v1/deliveries`, and sending goods back with `/v1/returns`. The two documents are records in their own right — they carry the supplier's paperwork numbers, they can be counted and corrected before they are posted, and posting them is what moves stock.

---

## Table of Contents

1. [Overview](#overview)
2. [Terminology](#terminology)
3. [Scopes](#scopes)
4. [Purchase Orders](#purchase-orders)
5. [The Recipe: Receive a Purchase Order](#the-recipe-receive-a-purchase-order)
6. [Deliveries](#deliveries)
7. [Returns](#returns)
8. [Purchasing Fields on Trade Orders](#purchasing-fields-on-trade-orders)
9. [Endpoint Matrix](#endpoint-matrix)
10. [Related Guides](#related-guides)

---

## Overview

A [purchase order](#purchase-orders) says what you asked a supplier for. A **delivery** says what arrived, line by line, against that order — and, once approved, puts those units into the receiving store's stock and marks the order lines fulfilled. A **return** says what went back to the supplier, with a reason per line, and moves the units out again when it is executed.

**Key characteristics:**

- A purchase order is an ordinary trade order with the supplier as `supplier` and your **store** as `customer`; there is no separate resource for it
- A delivery is created *from* an order (or from selected order lines), or bare with an explicit `sender` and `receiver`
- Every delivery line carries `expectedQuantity` (ordered) and `quantity` (received); the difference is summarised as a `discrepancy`
- Nothing moves until the delivery is approved; until then lines can be counted, added and removed
- A return is created from a delivery, from an order, from selected lines of either, or bare; each line needs a `reason` before it can be committed
- The order's `underdeliveryPolicy` and `overdeliveryPolicy` decide what an approval does with a shortfall or a surplus
- Both documents can carry the supplier's own numbers (`sendersId`, `returneesId`) and can be issued a number of your own (`receiversId`, `returnersId`) automatically

**How it sits beside its neighbours:**

| Resource | What it holds |
|---|---|
| [Trade order](orders.md) | What was ordered — lines, quantities, prices, current status |
| **Delivery** | What the supplier delivered against the order, and what of it you accepted into stock |
| **Return** | What you sent back to the supplier, and why |
| [Trade record](../trade-records.md) | The ledger's log of each move these documents caused on the order |

---

## Terminology

The back office and the API name the same three things differently:

| In the back office | In the API |
|---|---|
| Supplier order | A trade order (`/v1/trade-orders`) where your store is the `customer` |
| Supplier delivery (goods receipt) | A delivery (`/v1/deliveries`) where your store is the `receiver` |
| Supplier return | A return (`/v1/returns`) where your store is the `returner` |

There is no separate supplier order resource, and none is planned: a supplier order is the same trade order, seen from the buying side.

---

## Scopes

| Scope | What it opens |
|---|---|
| `deliveries:read` | Read `/v1/deliveries` and `/v1/delivery-items`. |
| `deliveries:write` | The same, plus create, edit and the `actions` member on a delivery. |
| `returns:read` | Read `/v1/returns` and `/v1/return-items`. |
| `returns:write` | The same, plus create, edit and the `actions` member on a return. |

These are deliberately **not** part of `logistics:read` / `logistics:write`: `approve` on a delivery and `commit`/`fulfill`/`execute` on a return move stock, and an existing logistics key should not gain that silently. The broad legacy `write:api` expands to every fine-grained scope and therefore covers all four; the broad `read:api` does **not** include `deliveries:read` or `returns:read`, so list them explicitly on a read-only key. See [Credentials → Scopes](../credentials.md#scope-names).

**A write under a read scope is a silent `200`, as everywhere.** Under `deliveries:read` alone, `PATCH /v1/deliveries/{id}/actions { "approve": true }` answers `200` with a `null` body and the delivery stays `["New"]` with stock untouched; `PATCH /v1/delivery-items/{key} { "quantity": "3" }` answers `200` and the line still reads `"0"`. A `POST /v1/deliveries` for a document that does not exist yet is a `400` — `"Found no matching 'delivery' using this index. Check identifiers."` — the same lookup failure any create under a read scope reports. None of this is a `403`; read the value back after a write whose scope you are unsure of. See [gotcha 41](../common-gotchas.md#41-a-write-under-a-read-only-scope-is-a-silent-200).

### The Scope Set for a Receiving Integration

A delivery refers to agents, products, a currency and trade orders, and each of those members is filled only when the key also reaches that collection. The same delivery, created from a purchase order, read under different scope sets:

| Scope set | What you get |
|---|---|
| `deliveries:write`, `orders.sales:write`, `suppliers:read`, `products:read`, `geo:read` | Create the order, approve it, create the delivery from it, count, approve: all `200`. A read shows `sender`, `receiver`, `currency`, every line's `product` and `orders`. |
| `deliveries:read`, `suppliers:read`, `products:read`, `geo:read` | Read `200` with `sender`, `receiver`, `currency` and `product` — but **`orders: []`**, although the delivery has an order. |
| `deliveries:read` alone | Read `200`, but `sender`, `receiver`, `currency` and every line's `product` are **absent**, and `orders: []`. |
| `read:api` + `deliveries:read` | `sender`, `receiver`, `currency` present; `orders: []`. |
| `deliveries:write` alone | `POST /v1/deliveries` from an order → `400` `"Invalid trade order match. Must match exactly one existing trade order."` — the key cannot see the order it names. |
| `read:api` alone | `GET /v1/deliveries` → `404`. |
| `orders.sales:write` alone | `GET /v1/trade-orders/{id}~just(status,deliveries,deliveryDiscrepancy)` → `200` with **`deliveries: []`** on an order that has one; `deliveryDiscrepancy` reads normally. Add `deliveries:read` and the same read lists the delivery. |

**Grant a receiving integration** `deliveries:write`, `orders.sales:write`, `suppliers:read`, `products:read` and `geo:read`. Add `stock:read` when it verifies stock levels, `returns:write` for supplier returns, and `config` when it sets up the numbering serials (`/v1/serials`, `/v1/config/root-order`). `supply-chains:read` fills the agent members as well as `suppliers:read` does.

Two consequences worth knowing before you size a key:

- **Trade orders have no read scope.** `orders.sales:write` is what fills `orders` on a delivery and lets a create find the order it names — even for a key that otherwise only reads.
- **The link is one-directional per scope.** `deliveries` on an order reads `[]` without `deliveries:read`, and `orders` on a delivery reads `[]` without `orders.sales:write`. A key that needs both directions needs both scopes.

---

## Purchase Orders

A purchase order is a trade order created with the supplier as `supplier` and sole seller and your receiving store as `customer`. Everything on [Working with Orders](orders.md) applies to it; this section covers what is specific to buying.

### The Receiving Store Is the `customer` — long-standing

**Make the store that receives the goods the `customer`. One purchase order per receiving store.**

With a **store** as `customer`, an approved delivery raises that store's stock level (`stockLevels[].totalQuantity` 0 → 10). With a **company** as `customer` and `receiver`, the whole flow still completes — delivery `["Delivered"]`, order `["Fulfilled"]`, `deliveryDiscrepancy: ["None"]` — but every store's stock level still reads `0` afterwards:

```bash
GET /v1/products/com.example.sku=WIDGET~just(stockLevels)
# DOWNTOWN   totalQuantity "0"
# WAREHOUSE  totalQuantity "0"
```

The company has no stock of its own for the units to land in. `buyers` on the order reads the customer (`[{ "@type": "company", … }]`) and is read-only, so the customer is the only way to say where the goods go.

### Purchase Price per Line: `unitAmountExclVat` — long-standing

Put your agreed purchase price on each line as `unitAmountExclVat`, and give each line an identifier of your own:

```json
POST /v1/trade-orders
[{
  "identifiers": { "com.example.orderId": "PO-1" },
  "supplier": { "identifiers": { "com.example.companyId": "ACME-SUPPLIES" } },
  "customer": { "identifiers": { "com.example.storeId": "DOWNTOWN" } },
  "sellers": [{ "identifiers": { "com.example.companyId": "ACME-SUPPLIES" } }],
  "currency": { "identifiers": { "currencyCode": "SEK" } },
  "requestedArrivalTime": "2026-10-01T08:00:00.000Z",
  "customersReference": "Autumn campaign",
  "customersExternalNotes": "Deliver to the back door.",
  "receiverNotes": "Fragile - count on arrival",
  "items": [
    { "identifiers": { "com.example.itemId": "PO-1-1" }, "product": { "identifiers": { "com.example.sku": "WIDGET" } }, "quantity": "10", "unitAmountExclVat": "40.00" },
    { "identifiers": { "com.example.itemId": "PO-1-2" }, "product": { "identifiers": { "com.example.sku": "GADGET" } }, "quantity": "5",  "unitAmountExclVat": "120.50" }
  ]
}]
```

Response `200`, and the amounts read back (no VAT configured in this example, so net equals gross):

| | `unitAmountExclVat` | `unitAmountInclVat` | `totalAmount` |
|---|---|---|---|
| WIDGET × 10 | `"40"` | `"40"` | `"400"` |
| GADGET × 5 | `"120.5"` | `"120.5"` | `"602.5"` |
| order | | | `"1002.5"` |

- **A line without a price is still accepted.** With no `unitAmountExclVat` and no price configured for the product, the line reads `unitAmountInclVat: "0"` and `totalAmount: "0"`; the order can still be approved and received.
- **Agree price and quantity before `tryApprove`.** While the order is `New`, `PATCH /v1/trade-order-items/com.example.itemId=PO-1-1 { "unitAmountExclVat": "35.00" }` → `200`, line total `"350"`, order total `"952.5"`. After approval the same `PATCH` answers `200` and changes nothing (read back: still `"40"`). A `quantity` `PATCH` on an approved line behaves the same way — `200`, still `"10"`. This is the ordinary silent write of a read-only member; the `200` is not evidence that it landed.
- **Line identifiers make lines addressable.** `com.example.itemId` above is what `/v1/trade-order-items/com.example.itemId=PO-1-1` resolves, and what a delivery's `orderItems` / `orderItem` references take. Without one the only handle on a line is its `key`.
- **`package` on an order line is not stored.** A line sent with `"package": { "identifiers": {…} }` naming an existing product package is accepted (`200`) and reads `"package": null` afterwards — and so does the delivery line created from it. `quantity` is in base units throughout; see [Product Packages](../../guide/examples/product-packages.md#section-5-packages-on-trade-order-items).

The purchasing members in the example (`requestedArrivalTime`, `customersReference`, `customersExternalNotes`, `receiverNotes`) are described in [Purchasing Fields on Trade Orders](#purchasing-fields-on-trade-orders).

### Your Purchase Order Number: `identifiers.customersId` — long-standing

`identifiers.customersId` is **the customer's number for the order — your purchase order number.** It is issued on creation from the `incomingTradeOrderSerial` on `/v1/config/root-order` when the customer sits under the root organization node, the same condition that governs `receiversId` on a delivery. "Incoming" is from the goods' point of view: an order whose goods come in to you.

```json
POST /v1/serials
[{ "identifiers": { "com.example.serialId": "PO-SERIAL" }, "prefix": "PO-", "nextOrdinal": 1, "length": 5 }]

PATCH /v1/config/root-order
{ "incomingTradeOrderSerial": { "identifiers": { "com.example.serialId": "PO-SERIAL" } } }
```

The next purchase order then reads:

```json
GET /v1/trade-orders/com.example.orderId=PO-1~just(identifiers,customersId,suppliersId)
{ "@type": "trade order",
  "identifiers": { "key": "…", "customersId": "PO-00001", "com.example.orderId": "PO-1" },
  "customersId": { "@type": "trade order local id", "owner": { "@type": "store", "name": "Downtown Store", … }, "id": "PO-00001" },
  "suppliersId": { "@type": "trade order local id", "owner": { "@type": "company", "name": "Acme Supplies", … } } }
```

- **It is an index.** `GET /v1/trade-orders/customersId=PO-00001` → `200`, the order.
- **`identifiers.suppliersId` is the supplier's number.** It is issued from `outgoingTradeOrderSerial` when the *supplier* is one of your own agents — a sales order, an internal order. For an external supplier it stays absent.
- **Both are read-only.** `PATCH { "identifiers": { "customersId": "MY-PO-7" } }`, and the same for `suppliersId`, answer `200` and change nothing. To record the supplier's order confirmation number use `suppliersReference` (free text, writable at any time) or an identifier in your own namespace.
- The top-level `customersId` / `suppliersId` members carry the same number together with its `owner`. They are non-essential; `identifiers` is the place to read the number from.

**The three serials** that number purchasing documents all sit on `/v1/config/root-order`:

| Serial on `/v1/config/root-order` | Numbers | Lands in |
|---|---|---|
| `incomingTradeOrderSerial` | purchase orders | `trade order.identifiers.customersId` |
| `supplierDeliverySerial` | goods receipts | `delivery.identifiers.receiversId` |
| `supplierReturnSerial` | supplier returns | `return.identifiers.returnersId` |

`incomingTradeOrderSerial` is long-standing; the other two ship with the deliveries surface. Setting them needs the `config` scope. Curl versions are in [Configuration Examples → Order Numbering Serials](../../guide/examples/configuration.md#order-numbering-serials-v1configroot-order).

### Lifecycle of a Purchase Order

| Step | Request | Order `status` | Store stock |
|---|---|---|---|
| Create | `POST /v1/trade-orders` | `["New"]` | 0 |
| Approve | `PATCH …/actions { "tryApprove": true }` | `["Committed"]` | 0 |
| Receive 8 of 10 WIDGET (GADGET not yet) | a delivery approved | `["Committed", "Fulfilled"]`, `deliveryDiscrepancy: ["Underdelivery", "ZeroDelivery"]` | WIDGET 8 |
| Receive the rest | a second delivery approved | `["Fulfilled"]`, `deliveryDiscrepancy: ["None"]` | WIDGET 10, GADGET 5 |

- **Approving a purchase order moves no stock and needs none.** Nothing about the expected goods shows in `stockLevels` — `totalQuantity`, `reservedQuantity` and `availableQuantity` all stay `"0"`. There is no "on order" quantity in the API; what is on its way is read from the open orders ([Finding Purchase Orders](#finding-purchase-orders--long-standing-except-deliverydiscrepancy)).
- **Progress per line** is `statusDetails` on the order item (non-essential):

  ```json
  GET /v1/trade-orders/com.example.orderId=PO-1/items~just(product,quantity,status,statusDetails)
  [ { "product": { … "WIDGET" }, "quantity": "10", "status": ["Committed", "Fulfilled"],
      "statusDetails": [ { "quantity": "8", "status": "Fulfilled" }, { "quantity": "2", "status": "Committed" } ] },
    { "product": { … "GADGET" }, "quantity": "5", "status": ["Committed"],
      "statusDetails": [ { "quantity": "5", "status": "Committed" } ] } ]
  ```

- **The purchasing members stay writable after approval.** `PATCH { "supplierConfirmed": true, "suppliersReference": "SO-88213", "requestedArrivalTime": "2026-10-03T08:00:00.000Z" }` on a `Committed` order → `200`, all three read back changed. Lines do not (see above).
- **`supplierConfirmed` is a flag for people.** The back office shows it and lets the receiver accept a confirmed order wholesale. Through the API it changes nothing about receiving — a delivery still starts at `0` received per line.

### What a Fresh Order Reads

An order created without any of the purchasing members reads, under `~just(…)`:

```json
{ "supplierConfirmed": false, "receiverNotes": null, "requestedArrivalTime": null,
  "customersReference": null, "suppliersReference": null,
  "customersInternalNotes": null, "customersExternalNotes": null,
  "suppliersInternalNotes": null, "suppliersExternalNotes": null,
  "underdeliveryPolicy": "LeaveOpen", "overdeliveryPolicy": "Accept",
  "deliveryDiscrepancy": ["None"], "deliveries": [], "returns": [] }
```

(`null` under `~just(…)`; absent from a default read, as usual.) The two policies default to `LeaveOpen` and `Accept`. The trade relationship between supplier and customer has its own defaults for them in the back office, but those are **not exposed on `/v1/trade-relationships`**, so through the API the order is the only place a policy is set.

An unknown policy value is the ordinary coercion `400`:

```json
PATCH /v1/trade-orders/com.example.orderId=PO-1   { "overdeliveryPolicy": "Refuse" }
400 { "error": "Invalid data format. A value could not be coerced to the expected target type.",
      "targetType": "trade order",
      "failedCoercions": [ { "path": "/overdeliveryPolicy", "targetType": "'Accept'", "inputValue": "Refuse", … },
                           { … "'Warn'" … }, { … "'Reject'" … } ], … }
```

### Finding Purchase Orders — long-standing, except `deliveryDiscrepancy`

Four orders for the same supplier and store — `PO-OPEN` `["Committed"]`, `PO-PART` `["Committed", "Fulfilled"]`, `PO-DONE` `["Fulfilled"]`, `PO-NEW` `["New"]`:

| Request | Returns |
|---|---|
| `POST /v1/trade-orders/find { "supplier": {…ACME…} }` | all four |
| `POST /v1/trade-orders/find { "customer": {…DOWNTOWN…} }` (likewise `buyer`, and `seller` with the supplier) | all four |
| `POST /v1/trade-orders/find { "supplier": {…ACME…}, "customer": {…WAREHOUSE…} }` | none — the parameters combine with AND |
| `GET /v1/trade-orders~where(status=Committed)` | `PO-OPEN` only |
| `GET /v1/trade-orders~where(status=~Committed)` | `PO-OPEN`, `PO-PART` |
| `GET /v1/trade-orders~where(deliveryDiscrepancy=Underdelivery)` | `PO-PART` |
| `GET /v1/trade-orders~where(requestedArrivalTime<2026-10-15T00:00:00.000Z)` | the orders due before then |
| `GET /v1/trade-orders~where(supplier/identifiers/com.example.companyId=ACME-SUPPLIES)` | all four |

**`status` is an array, and `=` compares the whole value**, so `status=Committed` matches only an order whose single status is `Committed`. **`=~` (includes) is the filter for "still expecting goods"** — it is what catches a partly received order. The recipe for an open-orders list:

```
GET /v1/trade-orders~where(customer/identifiers/com.example.storeId=DOWNTOWN,status=~Committed)~just(identifiers,supplier,requestedArrivalTime,status,deliveryDiscrepancy)
```

The finder returns `{ "modifiedTag": …, "results": […] }` like every finder; pass the tag back to get only what changed since. See [gotcha 55](../common-gotchas.md#55-status-on-a-trade-order-compares-the-whole-array-use--for-still-open).

### Cancelling, and Closing the Rest of a Partly Received Order

`tryCancel` acts only on an order whose one status is `Committed`:

| Order `status` | `{ "tryCancel": true }` | Afterwards |
|---|---|---|
| `["Committed"]`, nothing received | `200` | `["Cancelled"]`; a delivery from it is then `400` `"The order has no committed items to deliver."` |
| `["Committed", "Fulfilled"]` (partly received) | `200` | **unchanged** — still `["Committed", "Fulfilled"]`, the open units still `Committed` |
| `["New"]` | `200` | unchanged |

`DELETE /v1/trade-orders/{id}` answers `200 { "deletedCount": 0, "info": "Nothing happened" }` on a `New` and on a `Committed` order alike; orders are not deletable.

**Closing the remainder** of a partly received order is done with the underdelivery policy, not with `tryCancel`:

```
# PO-1: 10 ordered, 8 received and approved. status ["Committed", "Fulfilled"]
PATCH /v1/trade-orders/com.example.orderId=PO-1          { "underdeliveryPolicy": "Cancel" }      → 200
POST  /v1/deliveries  [{ "identifiers": { "com.example.deliveryId": "GR-CLOSE" },
                         "order": { "identifiers": { "com.example.orderId": "PO-1" } } }]           → 200, one line: expected 2, received 0
PATCH /v1/deliveries/com.example.deliveryId=GR-CLOSE/actions   { "approve": true }                  → 200
```

Result: order `status: ["Cancelled", "Fulfilled"]`, `deliveryDiscrepancy: ["None"]`, the line's `statusDetails` `[{ "quantity": "2", "status": "Cancelled" }, { "quantity": "8", "status": "Fulfilled" }]`, store stock still 8, and a further `POST /v1/deliveries` from the order is `400` `"The order has no committed items to deliver."` Setting the policy at order creation gives the same end state on the first short delivery. See [gotcha 54](../common-gotchas.md#54-trycancel-on-a-partly-received-order-is-a-silent-200).

### Receive Everything Without a Document: `tryFulfill` — long-standing

`PATCH /v1/trade-orders/com.example.orderId=PO-1/actions { "tryFulfill": true }` on a `Committed` purchase order → `200`; the order reads `["Fulfilled"]`, `deliveryDiscrepancy: ["None"]`, `deliveries: []`, and the store's stock goes 0 → 10. A later `POST /v1/deliveries` from it is `400` `"The order has no committed items to deliver."`

It is the shortcut for goods that arrived exactly as ordered and need no paperwork:

| | `tryFulfill` on the order | A delivery |
|---|---|---|
| Quantities | everything ordered, as ordered | what was counted, line by line |
| Document, delivery-note number, goods-receipt number, discrepancy | none | yes |

---

## The Recipe: Receive a Purchase Order

Five requests take a purchase order from approved to received, and a sixth sends something back.

**1. Approve the purchase order.** Create it as in [Purchase Orders](#purchase-orders) — your store as `customer`, the supplier as `supplier` and sole seller — and approve it so its lines are `Committed`:

```bash
PATCH /v1/trade-orders/com.example.orderId=PO-1/actions
{"tryApprove": true}
```

**2. Create a delivery from the order.** One delivery item is created per committed line, with `expectedQuantity` equal to the quantity ordered and `quantity` (received) at `0`:

```bash
POST /v1/deliveries
[{ "identifiers": { "com.example.deliveryId": "GR-1" },
   "order": { "identifiers": { "com.example.orderId": "PO-1" } } }]
```

The new delivery reads `status: ["New"]` and `discrepancy: ["ZeroDelivery"]` — nothing has been counted yet.

**3. Count what arrived.** Set the received quantity on each line. This is allowed only while the delivery is `New`:

```bash
PATCH /v1/delivery-items/{key}
{ "quantity": "8" }
```

**4. Approve the delivery.** This posts the received quantities:

```bash
PATCH /v1/deliveries/com.example.deliveryId=GR-1/actions
{ "approve": true }
```

The delivery's status becomes `["Delivered"]`; the 8 units land in the receiver's stock (`GET /v1/products/com.example.sku=WIDGET~with(stockLevels)` shows them); the order line becomes 8 `Fulfilled` and keeps the remaining 2 `Committed`, because the default `underdeliveryPolicy` is `"LeaveOpen"`. A second `POST /v1/deliveries` from the same order picks up only what is still committed — create it only **after** this one is approved (see [Safe Receiving](#safe-receiving)).

**5. Return something.** Create a return from the delivered delivery (or from the fulfilled order), give each line a `quantity` and a `reason`, then execute it:

```bash
POST /v1/returns
[{ "identifiers": { "com.example.returnId": "RET-1" },
   "delivery": { "identifiers": { "com.example.deliveryId": "GR-1" } } }]

PATCH /v1/return-items/{key}
{ "quantity": "2", "reason": { "identifiers": { "com.example.reasonId": "DEFECTIVE" } } }

PATCH /v1/returns/com.example.returnId=RET-1/actions
{ "execute": true }
```

An integration that already knows the counted quantities can collapse steps 2–4 into [one request](#a-receipt-in-one-request).

---

## Deliveries

### Creating a Delivery

Bodies are arrays, as on every collection, and `identifiers` takes your own namespace as usual. There are three shapes.

**From an order** — one line per committed order line:

```bash
POST /v1/deliveries
[{ "identifiers": { "com.example.deliveryId": "GR-1" },
   "order": { "identifiers": { "com.example.orderId": "PO-1" } } }]
```

**From selected order lines:**

```bash
POST /v1/deliveries
[{ "identifiers": { "com.example.deliveryId": "GR-1" },
   "orderItems": [{ "identifiers": { "com.example.itemId": "PO-1-1" } }] }]
```

Any identifier of the order line works — your own, as here, or its `key`.

**Bare** — no order; `sender`, `receiver`, `currency` and `items` are given explicitly:

```bash
POST /v1/deliveries
[{ "identifiers": { "com.example.deliveryId": "GR-BARE" },
   "sender":   { "identifiers": { "com.example.companyId": "ACME-SUPPLIES" } },
   "receiver": { "identifiers": { "com.example.storeId": "DOWNTOWN" } },
   "currency": { "identifiers": { "currencyCode": "SEK" } },
   "items": [{ "product": { "identifiers": { "com.example.sku": "WIDGET" } }, "quantity": "5" }] }]
```

`order`, `orderItems`, `sender`, `receiver` and `currency` are **create-only inputs**: they shape the document and are never echoed back. What you read afterwards is the resolved `sender`/`receiver`/`currency` and the `orders` backlink.

**Extra items on the order shapes.** `items` may be mixed into either order-based shape. An item is one of:

| Item form | Meaning |
|---|---|
| `{ "orderItem": { "identifiers": {...} } }` | A line delivering against that order line — `expectedQuantity` is its committed quantity, `quantity` starts at `0` |
| `{ "product": { "identifiers": {...} }, "quantity": "n" }` | An unreferenced line — nothing was ordered, so `expectedQuantity` is `0` and the line reads `discrepancy: ["Overdelivery"]` |

Extra `items` are for lines the shape did **not** bring in: unreferenced products, or lines of another order. A line in `items` that names an order line the `order` / `orderItems` shape already brought in is **added again** — `{ "order": PO-1, "items": [{ "orderItem": <WIDGET line>, "quantity": "8" }] }` produces two WIDGET lines, one `0` of 10 and one `8` of 10. To create a delivery with the counts already filled in, use the bare shape ([A Receipt in One Request](#a-receipt-in-one-request)).

**Create errors** — all `400` with `error: "The request was invalid and could not be processed."` and these `details`:

| Request | `details` |
|---|---|
| `order` with no committed lines (new, cancelled or fully received) | `The order has no committed items to deliver.` (`info.invalidItem` names the order) |
| `order` that matches nothing | `Invalid trade order match. Must match exactly one existing trade order.` |
| `orderItems` naming a line that is not committed | `Could not create delivery from order items: The source item has no product instance in an eligible status.` |
| `orderItems: []` | `orderItems must contain at least one trade order item.` |
| Bare, no `items` | `A delivery must have at least one item, or be created from an order.` |
| Bare, no `receiver` (same pattern for `sender`) | `A receiver is required.` |
| A line with neither `product` nor `orderItem` | `A delivery item must reference a product or an order item.` |
| A negative `quantity` | rejected |

### A Receipt in One Request

The bare shape accepts order-referencing lines with a received quantity, and `actions` in the create body runs after the lines exist. So an integration that already knows the counted quantities — a WMS, an EDI despatch advice that has been checked — books a receipt in one request:

```json
POST /v1/deliveries
[{
  "identifiers": { "com.example.deliveryId": "GR-ONE", "sendersId": "DN-1" },
  "sender":   { "identifiers": { "com.example.companyId": "ACME-SUPPLIES" } },
  "receiver": { "identifiers": { "com.example.storeId": "DOWNTOWN" } },
  "currency": { "identifiers": { "currencyCode": "SEK" } },
  "items": [
    { "orderItem": { "identifiers": { "com.example.itemId": "PO-1-1" } }, "quantity": "8" },
    { "orderItem": { "identifiers": { "com.example.itemId": "PO-1-2" } }, "quantity": "5" }
  ],
  "actions": { "approve": true }
}]
```

`200`. Read back: delivery `status: ["Delivered"]`, `discrepancy: ["Underdelivery"]`; the WIDGET line `quantity "8"`, `expectedQuantity "10"`, `remainingQuantity "2"`, `["Delivered"]`, `["Underdelivery"]`; the GADGET line `"5"` / `"5"` / `"0"`, `["None"]`; `orders` lists `PO-1`; the order `["Committed", "Fulfilled"]` with `deliveryDiscrepancy: ["Underdelivery"]`; stock WIDGET 8, GADGET 5.

`sender`, `receiver` and `currency` are required here even though every line names an order — only the `order` / `orderItems` shapes derive them. The [five-request recipe](#the-recipe-receive-a-purchase-order) stays the one for counting inside CommerceOS, or step by step.

### Safe Receiving

**Always send your own identifier.** A `POST` is an upsert, so a retry with the same identifier is harmless; without one, every retry is a new document:

| Request | Deliveries afterwards |
|---|---|
| `POST [{ "identifiers": { "com.example.deliveryId": "GR-1" }, "order": {…PO-1…} }]` twice | one — the second `POST` is an update of `GR-1` and adds no lines |
| `POST [{ "order": {…PO-1…} }]` once more, without identifiers | two — a second `New` delivery expecting the same 10 |

A delivery created without an identifier of your own cannot be retried safely, and the duplicate it leaves behind is exactly the situation the warning below is about.

> **Warning: keep at most one `New` delivery per order line.** Approve a delivery before creating the next one from the same order; the next one then expects only what is still open.
>
> Two `New` deliveries created from the same order both expect the same units. With 6 counted on `GR-1` and 4 on `GR-2`, approving `GR-1` puts 6 into stock — and flips `GR-2` to `status: ["Delivered"]`, still showing `quantity "4"`, **without it having been approved**. Approving `GR-2` afterwards is a `200` that does nothing: stock stays at 6, the order reads `["Committed", "Fulfilled"]` with 6 `Fulfilled` and 4 `Committed`. The 4 units counted on `GR-2` never reach stock, and its document says `Delivered`. With both counted at 10 the effect is the same: stock 10, not 20, both `Delivered`.
>
> If a second one was created by mistake, empty it while it is `New` — its lines can be removed (see [What Can Be Changed, and When](#what-can-be-changed-and-when)). See [gotcha 52](../common-gotchas.md#52-two-open-deliveries-on-one-order-line-share-the-same-units).

**Count first. `approve` is final for the document, whatever the counts are.**

- A delivery with one line counted (WIDGET 10 of 10) and one left at `0` (GADGET 0 of 5): `approve` → delivery `["Delivered"]`, `discrepancy: ["ZeroDelivery"]`; the GADGET line reads `quantity "0"`, `status: ["Delivered"]`, `discrepancy: ["ZeroDelivery"]`; the order keeps GADGET `Committed` (`["Committed", "Fulfilled"]`, `deliveryDiscrepancy: ["ZeroDelivery"]`). A second delivery picks GADGET up.
- A delivery where **nothing** was counted: `approve` → `200`, delivery `["Delivered"]` / `["ZeroDelivery"]`, order unchanged (`["Committed"]`), stock unchanged. The same happens when `"actions": { "approve": true }` is sent in a create body that has `order` / `orderItems` and no counted lines. The document is spent: its lines can no longer be edited (`409`) and it cannot be deleted.
- Under `underdeliveryPolicy: "Cancel"` an uncounted approval cancels everything it expected. That is the mechanism [closing a remainder](#cancelling-and-closing-the-rest-of-a-partly-received-order) uses on purpose; by accident it cancels the order's open lines. See [gotcha 53](../common-gotchas.md#53-approve-on-an-uncounted-delivery-posts-nothing-and-spends-the-document).

**Cancelling an order does not void its open deliveries.** An order approved, a delivery created from it and counted (10), the order then cancelled with `tryCancel` (`["Cancelled"]`): the delivery still reads `["New"]`, `discrepancy: ["None"]`. Approving it is a `200` — the delivery becomes `["Delivered"]`, **store stock goes 0 → 10**, and the order stays `["Cancelled"]` with every unit `Cancelled`. Empty, or leave unapproved, any `New` delivery of an order you cancel — unless the goods did arrive, in which case approving it receives them.

### Reading a Delivery

```bash
GET /v1/deliveries/com.example.deliveryId=GR-1~with(items,orders)
```

```json
{ "@type": "delivery",
  "identifiers": { "key": "…", "com.example.deliveryId": "GR-1", "sendersId": "DN-4711", "receiversId": "GR-0001" },
  "sender":   { "@type": "company", "identifiers": { "com.example.companyId": "ACME-SUPPLIES" }, "name": "Acme Supplies" },
  "receiver": { "@type": "store",   "identifiers": { "com.example.storeId": "DOWNTOWN" }, "name": "Downtown Store" },
  "currency": { "@type": "currency", "identifiers": { "currencyCode": "SEK" } },
  "status": ["New"], "discrepancy": ["Underdelivery"],
  "items": [{ "@type": "delivery item", "identifiers": { "key": "…" },
              "product": { "identifiers": { "com.example.sku": "WIDGET" }, "name": "Widget", "status": "Active" },
              "quantity": "8", "expectedQuantity": "10", "remainingQuantity": "2",
              "status": ["New"], "discrepancy": ["Underdelivery"] }],
  "orders": [{ "@type": "trade order", "identifiers": { "com.example.orderId": "PO-1" } }] }
```

The essential members are `identifiers`, `timestamp`, `sender`, `receiver`, `currency`, `status`, `discrepancy` and `items`. `orders` is non-essential. Which of `sender`, `receiver`, `currency`, `product` and `orders` are actually present depends on the key's scopes — see [The Scope Set for a Receiving Integration](#the-scope-set-for-a-receiving-integration).

**Non-essential members** (fetch with `~with(...)`):

| Member | Type | Notes |
|---|---|---|
| `destinationAddress` | address | Read/write, at any time. |
| `carrier` | agent | Read/write, at any time. |
| `estimatedDepartureTime`, `estimatedArrivalTime` | date-time | Read/write, at any time. |
| `actualDepartureTime`, `actualArrivalTime` | date-time | Read-only — stamped by `registerDeparture` / `registerArrival` (see [Delivery Actions](#delivery-actions)). |
| `labels` | label[] | As on trade orders — see [Labels](orders.md#labels). |
| `orders` | trade order[] | The orders this delivery delivers against. |

**The two document numbers** live in `identifiers`:

- `identifiers.sendersId` is the **supplier's delivery-note number**. It is writable — before and after approval, since the note often arrives after the goods — and it is an index, so a delivery can be fetched by it:

  ```bash
  GET /v1/deliveries/sendersId=DN-4711
  ```

- `identifiers.receiversId` is **your goods-receipt number**. It is writable too, and it is issued automatically on creation when `/v1/config/root-order` has a `supplierDeliverySerial` **and** the receiver sits under the root organization node. A receiver outside that node gets no number unless you set one.

### Delivery Items

A line's essentials are `identifiers`, `product`, `quantity` (received), `expectedQuantity` (ordered), `remainingQuantity`, `status` and `discrepancy`. Non-essential:

| Member | Type | Notes |
|---|---|---|
| `delivery` | delivery | The owning document. |
| `orderItem` | trade order item | The order line this line delivers against. Absent on an unreferenced line. |
| `package` | package | Read-only. |
| `productInstances` | product instance[] | Read-only. |
| `totalAmount` | decimal | `quantity` × the order line's unit price — see [What an Overdelivery Is Worth](#what-an-overdelivery-is-worth). |

> **Serial numbers and batches cannot yet be captured on a delivery through the API.** Receive tracked products by `quantity`; a serial- or batch-tracked product is accepted on a plain count and the order line is fulfilled as usual. Capture at receipt is planned.

### Status and Discrepancy Values

| Member | Values | Notes |
|---|---|---|
| `status` | `New` \| `Delivered` | On the item and on the document. An array, as on trade orders — but a delivery has one status at a time, so `~where(status=Delivered)` is enough. |
| `discrepancy` | `ZeroDelivery` \| `Underdelivery` \| `Overdelivery` \| `None` | On the item and on the document. The document aggregates every non-`None` value its lines carry, so a delivery with one short line and one surplus line reads `["Underdelivery", "Overdelivery"]`. |

### What Can Be Changed, and When

While the delivery is `New`, lines can be counted, added and removed:

```bash
# Count a line
PATCH /v1/delivery-items/{key}
{ "quantity": "8" }

# Add a line to the document
POST /v1/deliveries/com.example.deliveryId=GR-1/items
[{ "product": { "identifiers": { "com.example.sku": "WIDGET" } }, "quantity": "3" }]

# The same, addressed through the items collection
POST /v1/delivery-items
[{ "delivery": { "identifiers": { "com.example.deliveryId": "GR-1" } },
   "product": { "identifiers": { "com.example.sku": "WIDGET" } }, "quantity": "3" }]

# Remove a line
DELETE /v1/deliveries/com.example.deliveryId=GR-1/items/{key}

# The header, before or after approval
PATCH /v1/deliveries/com.example.deliveryId=GR-1
{ "identifiers": { "sendersId": "DN-4712" }, "estimatedArrivalTime": "2026-10-02T09:00:00.000Z" }
```

What each write answers:

| Write | While `New` | After approval |
|---|---|---|
| `identifiers.sendersId`, `identifiers.receiversId`, `estimatedDepartureTime`, `estimatedArrivalTime`, `carrier`, `destinationAddress` (`PATCH /v1/deliveries/{id}`) | `200` | `200` — still writable and read back changed |
| `registerArrival` / `registerDeparture` | `200` | `200` |
| Line `quantity` | `200` | `409` |
| Add a line (`POST …/items`) | `200` | `409`, `details` `"Items can only be added while the delivery is New."`, `info: { "status": ["Delivered"], "expected": "New" }` |
| Remove a line (`DELETE …/items/{key}`) | `200 { "deletedCount": 1, "info": "Deleted 1 items" }` — for counted, uncounted and unreferenced lines alike | `400`, `details` `"Could not remove delivery item: Cannot remove this item in its current state."` |
| `DELETE /v1/deliveries/{id}` | `200 { "deletedCount": 0, "info": "Nothing happened" }` — still there | the same |
| `{ "approve": false }` | `200`, nothing happens | the same |
| `registerArrival: "yesterday"` | ordinary coercion `400` (`path: "actions/registerArrival"`, tried `boolean` and `date-time`) | the same |

Two things to spell out:

- **A delivery cannot be deleted.** The `DELETE` answers `200` with `deletedCount: 0` (see [What a `DELETE` reports](../overview.md#what-a-delete-reports)). An unwanted `New` delivery is neutralised by removing its lines: it then reads `items: []`, `orders: []`, cannot be approved (`400` `"Cannot approve a delivery without items."`), and the next delivery from the order expects the full open quantities again. It keeps reading its old `discrepancy`.
- **The delivery-note number often arrives after the goods.** `sendersId` can be set after approval, as can the carrier, the addresses and the estimated times.

### Delivery Actions

```bash
PATCH /v1/deliveries/{identifier}/actions
{action: payload}
```

| Action | Payload | Effect | Errors |
|---|---|---|---|
| `approve` | `true` | Posts the received quantities: the units move into the receiver's stock and status becomes `["Delivered"]`. Idempotent once `Delivered`. What happens to a shortfall is the order's `underdeliveryPolicy`: `"Cancel"` auto-cancels the undelivered remainder (the order then reads `["Fulfilled", "Cancelled"]`); `"LeaveOpen"` (default) leaves it `Committed` for a later delivery. | `409` when a line received more than was ordered and the order's `overdeliveryPolicy` is `"Reject"` — nothing moves and status stays `["New"]`. `409` on a mixed status. `400` on a delivery with no items. |
| `registerArrival` | `true` or an ISO 8601 timestamp | Stamps `actualArrivalTime` (`true` means now). No stock effect. | `400` on an unparsable timestamp |
| `registerDeparture` | `true` or an ISO 8601 timestamp | Stamps `actualDepartureTime`. No stock effect. | `400` on an unparsable timestamp |

`actions` may also be sent in the create body; it runs after the lines exist ([A Receipt in One Request](#a-receipt-in-one-request)).

The overdelivery refusal is a `409` whose `@type` is `state conflict` and whose `details` reads, exactly:

```
This delivery overdelivers and the order's overdelivery policy rejects it.
```

With the default `overdeliveryPolicy: "Accept"` the surplus is simply received — 12 counted against 10 ordered puts 12 into stock. Through the API `"Warn"` behaves exactly as `"Accept"` (`200`, `["Delivered"]`, stock 12); it exists for the back office, which warns the person approving. The policies are set on the trade order; see [Purchasing Fields on Trade Orders](#purchasing-fields-on-trade-orders).

**Each `approve` adds exactly one trade record to the order** (a `"Cancel"` policy adds a second one for the cancelled remainder). The records do not name the delivery. See [Trade Records](../trade-records.md).

### What an Overdelivery Is Worth

WIDGET ordered 10 at 40, counted 12, `overdeliveryPolicy` `Accept`:

| Where | Reads |
|---|---|
| Delivery line | `quantity "12"`, `expectedQuantity "10"`, `remainingQuantity "0"`, `["Overdelivery"]`, `totalAmount "480"` (before and after approval) |
| Order | `["Fulfilled"]`, `deliveryDiscrepancy: ["Overdelivery"]`, `totalAmount` unchanged `"1002.5"`; the line still `quantity "10"`, `totalAmount "400"` |
| The order's trade records (`GET …/records`) | one record for the approval, WIDGET as two items: `Fulfill` `quantity "10"`, `amount "400"` and `Fulfill` `quantity "2"`, `amount "0"` |
| Store stock | 12 |

The surplus is received into stock at no value; the order's quantities and totals do not change. The delivery line's own `totalAmount` values all 12 at the order price, so **do not sum delivery lines to reconcile an invoice — use the order.**

### One Delivery for Several Orders

`orderItems` may name lines of different orders: one line of `PO-1` and one of `PO-2` (same supplier, same store) → one delivery, two lines, `orders` lists both. After counting and `approve` both orders read `["Fulfilled"]`, each order's `deliveries` lists the delivery, and `POST /v1/deliveries/find { "order": {…PO-2…} }` finds it.

The delivery takes its `sender`, `receiver` and `currency` from the **first** line's order and does not check the others. Combine only orders with the same supplier, receiving store and currency.

### Deliveries Are Direction-Agnostic

The same resource documents goods going **out**; `sender` and `receiver` say which way. A sales order — your store as `supplier` and sole seller, a company as `customer`, 4 WIDGET, approved — gives `POST /v1/deliveries { "order": … }` a delivery whose `sender` is the store and whose `receiver` is the customer, with one line expecting 4. Count 4 and `approve` → delivery `["Delivered"]` / `["None"]`, order `["Fulfilled"]`. The store's stock had already dropped from 10 to 6 when the order was approved and stays 6.

On an outbound delivery `identifiers.sendersId` is **your** number — issued from `customerDeliverySerial` on `/v1/config/root-order` under the same root-organization condition — and `receiversId` is the customer's.

### Querying Deliveries

```bash
# Filter by any of sender, receiver, order, modifiedTag
POST /v1/deliveries/find
{ "receiver": { "identifiers": { "com.example.storeId": "DOWNTOWN" } } }
```

The response is `{ "modifiedTag": "2026-09-18T10:10:11.730Z", "results": [...] }`, the same shape as the other finders. **Incremental reads** pass the tag back:

```bash
POST /v1/deliveries/find
{ "receiver": { "identifiers": { "com.example.storeId": "DOWNTOWN" } }, "modifiedTag": "2026-09-18T10:10:11.730Z" }
# → { "results": [] }   no modifiedTag member when nothing matched — keep the previous one
```

Counting a line moves the delivery's tag, and approving moves it again, so a poll on the tag sees drafts being counted as well as approvals. Filter on `status` for approvals only:

```bash
# Approved deliveries only — a delivery has one status, so = is enough here
GET /v1/deliveries~where(status=Delivered)
GET /v1/deliveries~where(status=New)

# By sender
GET /v1/deliveries~where(sender/identifiers/com.example.companyId=ACME-SUPPLIES)

# Time-relative reads, with the same (create)/(modify) modes as trade orders; the default is modify
GET /v1/deliveries/after/2026-01-01T00:00:00.000Z~take(100)
GET /v1/deliveries/after(create)/2026-01-01T00:00:00.000Z~take(100)
GET /v1/deliveries/before/2026-02-01T00:00:00.000Z~take(100)

# By the supplier's delivery-note number
GET /v1/deliveries/sendersId=DN-4711

# From the order side: its deliveries and the summarised discrepancy
GET /v1/trade-orders/com.example.orderId=PO-1~with(deliveries,deliveryDiscrepancy)
```

---

## Returns

### Creating a Return

Five shapes. The first four derive the lines from an existing document; the last spells them out:

| Shape | Lines created |
|---|---|
| `{ "delivery": {...} }` | Every delivered line of that delivery |
| `{ "deliveryItems": [...] }` | The named delivery lines |
| `{ "order": {...} }` | Every fulfilled line of that order |
| `{ "orderItems": [...] }` | The named order lines |
| Bare — `returner`, `returnee`, `items` | Exactly the `items` given |

```bash
POST /v1/returns
[{ "identifiers": { "com.example.returnId": "RET-1" },
   "returner": { "identifiers": { "com.example.storeId": "DOWNTOWN" } },
   "returnee": { "identifiers": { "com.example.companyId": "ACME-SUPPLIES" } },
   "items": [{ "deliveryItem": { "identifiers": { "key": "<delivery item key>" } },
               "quantity": "2",
               "reason": { "identifiers": { "com.example.reasonId": "DEFECTIVE" } } }] }]
```

An item is `{ "deliveryItem": {...} }`, `{ "orderItem": {...} }` or `{ "product": {...}, "quantity": "n" }`. On the first two, `quantity` may be lowered to return part of the line; the item keeps its link to the source line either way.

**Create errors:**

| Request | Response |
|---|---|
| `order` with nothing fulfilled | `400` with `details` `"The order has no fulfilled items to return."` |
| Bare shape without `items` | `400` |
| An item with `quantity` `0` | `400` |
| `delivery` where the delivery contains a zero-delivery line | `400` — the zero line has nothing to return, so the document cannot be returned wholesale. Name the lines with `deliveryItems` instead. |

### Reading a Return

```bash
GET /v1/returns/com.example.returnId=RET-1~with(orders)
```

Essential members:

| Member | Type | Notes |
|---|---|---|
| `identifiers` | common identifiers | `returnersId` is your return number — issued automatically on creation when `/v1/config/root-order` has a `supplierReturnSerial` and the returner sits under the root organization node. `returneesId` is the supplier's number for the return. Both are writable. |
| `timestamp` | date-time | |
| `returner` | agent | Who sends the goods back. |
| `returnee` | agent | Who receives them. |
| `currency` | currency | |
| `status` | string[] | `New` \| `Committed` \| `Fulfilled` \| `Cancelled` |
| `items` | return item[] | Each with `product`, `quantity`, `reason` and `status`. |

Non-essential: `orders` (backlink) and `labels`, as on deliveries. On an item, `orderItem` and `deliveryItem` (the provenance of the line — whichever it was created from), `productInstances` (read-only) and `totalAmount`.

### Editing Return Items

While the return is `New`:

```bash
PATCH /v1/return-items/{key}
{ "quantity": "2", "reason": { "identifiers": { "com.example.reasonId": "DEFECTIVE" } } }
```

`quantity` and `reason` are the writable members. Setting a reason also adopts the reason's `restock` directive, which is what decides whether `fulfill` puts the units into the returnee's stock (see below). After `commit` or `execute`, a write to either is a `409`.

### Return Actions

```bash
PATCH /v1/returns/{identifier}/actions
{action: payload}
```

| Action | Payload | Transition | Effect |
|---|---|---|---|
| `commit` | `true` | `New → Committed` | The units leave the returner's stock. |
| `fulfill` | `true` | `Committed → Fulfilled` | Completes the return. With a restocking reason the units enter the returnee's stock — a store-to-warehouse return, for example. |
| `execute` | `true` | `New → Fulfilled` | `commit` and `fulfill` in one request. The one-shot for an ERP that already knows the goods have gone. |
| `cancel` | `true` | `Committed → Cancelled` | Calls the return off; the units go back to the returner's stock. |

- `commit` and `execute` need a `reason` on **every** item. Missing one, the action answers `400` and its `details` lists the keys of the items without a reason.
- An action from the wrong state is a `409`.
- Each action is idempotent when the return is already in its target state.

**Restock behaviour**, with the returner holding 10 units before the return:

| Reason | `restock` | Returner after | Returnee after |
|---|---|---|---|
| `DEFECTIVE`, 2 units | `false` | 10 → 8 | untouched |
| `WRONG-ITEM`, 3 units | `true` | 10 → 7 | 0 → 3 |

> **Note:** This is the document for **supplier** returns. A record-level customer return — the POS-style flow with no document, no return number and restocking into a single stock root — is still the trade order's `commitReturn` / `fulfillReturn` / `cancelReturn` actions. See [Returns and Refunds](orders.md#returns-and-refunds).

---

## Purchasing Fields on Trade Orders

A trade order carries a set of purchasing members. All are non-essential — fetch them with `~with(...)` — and the writable ones can be set on create and via `PATCH`, before and after approval:

| Field | Type | Description |
|---|---|---|
| `supplierConfirmed` | boolean | The supplier has confirmed the order. A flag for people; it changes nothing about receiving through the API |
| `receiverNotes` | string | Notes for whoever receives the goods |
| `requestedArrivalTime` | date-time | When the goods are wanted. Filterable: `~where(requestedArrivalTime<…)` |
| `suppliersReference`, `customersReference` | string | Each party's reference for the order — `suppliersReference` is where the supplier's order confirmation number goes |
| `suppliersInternalNotes`, `suppliersExternalNotes` | string | The supplier's notes, private and shared |
| `customersInternalNotes`, `customersExternalNotes` | string | The customer's notes, private and shared |
| `underdeliveryPolicy` | `"LeaveOpen"` \| `"Cancel"` | What approving a short delivery does with the remainder. Reads `"LeaveOpen"` when never set |
| `overdeliveryPolicy` | `"Accept"` \| `"Warn"` \| `"Reject"` | What approving a surplus delivery does with it. Reads `"Accept"` when never set; `"Warn"` behaves as `"Accept"` through the API |

Read-only: `deliveryDiscrepancy` (`string[]`, the same values as a delivery's `discrepancy`; filterable), `deliveries` and `returns` (the documents raised against the order). An unknown policy value is a coercion `400`. The trade relationship between supplier and customer carries defaults for the two policies in the back office, but they are not exposed on `/v1/trade-relationships`; through the API the order is the only place a policy is set, and an order created without them reads `LeaveOpen` / `Accept`.

The full order field reference is in [Working with Orders → Field Reference](orders.md#field-reference).

---

## Endpoint Matrix

### Purchase Orders

| Operation | Method | Endpoint | Use Case |
|---|---|---|---|
| Create purchase order | POST | `/v1/trade-orders` | Store as `customer`, `unitAmountExclVat` and your own `identifiers` on each line |
| Get by your PO number | GET | `/v1/trade-orders/customersId={no}` | Issued from `incomingTradeOrderSerial` |
| Open purchase orders | GET | `/v1/trade-orders~where(status=~Committed)` | `=~`, not `=` — catches partly received orders |
| Change a line's price or quantity | PATCH | `/v1/trade-order-items/{id}` | While `New` only; a silent `200` afterwards |
| Set purchasing members | PATCH | `/v1/trade-orders/{id}` | References, notes, policies, `requestedArrivalTime` — at any time |
| Approve | PATCH | `/v1/trade-orders/{id}/actions` | `tryApprove` — moves no stock |
| Receive everything, no document | PATCH | `/v1/trade-orders/{id}/actions` | `tryFulfill` |
| Cancel | PATCH | `/v1/trade-orders/{id}/actions` | `tryCancel` — only when nothing has been received |
| Close a partly received order | PATCH + POST | `underdeliveryPolicy: "Cancel"`, then an uncounted delivery approved | The remainder is cancelled |

### Deliveries

| Operation | Method | Endpoint | Use Case |
|---|---|---|---|
| List deliveries | GET | `/v1/deliveries~take(50)` | Browse |
| Get delivery | GET | `/v1/deliveries/{id}` | Single document |
| Get by supplier's number | GET | `/v1/deliveries/sendersId={no}` | Match a delivery note |
| Create delivery | POST | `/v1/deliveries` | From `order`, `orderItems`, or bare — the bare shape with `orderItem` lines and `actions` is a receipt in one request |
| Edit the header | PATCH | `/v1/deliveries/{id}` | `sendersId`, `receiversId`, `carrier`, `destinationAddress`, estimated times — at any time |
| Get items | GET | `/v1/deliveries/{id}/items` | Lines |
| Add item | POST | `/v1/deliveries/{id}/items` | While `New` |
| Remove item | DELETE | `/v1/deliveries/{id}/items/{key}` | While `New` |
| Count a line | PATCH | `/v1/delivery-items/{key}` | `quantity`, while `New` |
| Delivery actions | PATCH | `/v1/deliveries/{id}/actions` | `approve`, `registerArrival`, `registerDeparture` |
| Find deliveries | POST | `/v1/deliveries/find` | `sender`, `receiver`, `order`, `modifiedTag` |
| Time window | GET | `/v1/deliveries/after/{ts}`, `/before/{ts}` | Incremental reads |
| Delete delivery | DELETE | `/v1/deliveries/{id}` | Not supported — `200` with `deletedCount: 0`. Empty a `New` delivery instead |

### Returns

| Operation | Method | Endpoint | Use Case |
|---|---|---|---|
| List returns | GET | `/v1/returns~take(50)` | Browse |
| Get return | GET | `/v1/returns/{id}` | Single document |
| Create return | POST | `/v1/returns` | From `delivery`, `deliveryItems`, `order`, `orderItems`, or bare |
| Get items | GET | `/v1/returns/{id}/items` | Lines |
| Edit a line | PATCH | `/v1/return-items/{key}` | `quantity`, `reason`, while `New` |
| Return actions | PATCH | `/v1/returns/{id}/actions` | `commit`, `fulfill`, `execute`, `cancel` |

---

## Related Guides

- [Orders](orders.md) — the trade order itself, the purchasing fields, and the record-level return actions
- [Stock](stock.md) — where the received units land, and stock levels
- [Trade Records](../trade-records.md) — the ledger's log of each move a delivery or return caused on the order; one record per `approve`, and the records do not name the delivery
- [Configuration Examples → Order Numbering Serials](../../guide/examples/configuration.md#order-numbering-serials-v1configroot-order) — the serials that number purchase orders, goods receipts and returns
- [Credentials → Scopes](../credentials.md#scope-names)
- [Common Gotchas 52–55](../common-gotchas.md#52-two-open-deliveries-on-one-order-line-share-the-same-units) — the four purchasing pitfalls
