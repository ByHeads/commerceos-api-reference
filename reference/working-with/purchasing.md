# Working with Purchasing: Deliveries and Returns

> **Availability:** ships in the release after v26.1.11. Not in v26.1.10 or v26.1.11.

This guide covers the receiving side of a purchase order: booking the goods a supplier delivers with `/v1/deliveries`, and sending goods back with `/v1/returns`. Both are documents in their own right — they carry the supplier's paperwork numbers, they can be counted and corrected before they are posted, and posting them is what moves stock.

---

## Table of Contents

1. [Overview](#overview)
2. [Scopes](#scopes)
3. [The Recipe: Receive a Purchase Order](#the-recipe-receive-a-purchase-order)
4. [Deliveries](#deliveries)
5. [Returns](#returns)
6. [Purchasing Fields on Trade Orders](#purchasing-fields-on-trade-orders)
7. [Endpoint Matrix](#endpoint-matrix)
8. [Related Guides](#related-guides)

---

## Overview

A [purchase order](orders.md#purchase-order) says what you asked a supplier for. A **delivery** says what arrived, line by line, against that order — and, once approved, puts those units into the receiving store's stock and marks the order lines fulfilled. A **return** says what went back to the supplier, with a reason per line, and moves the units out again when it is executed.

**Key characteristics:**

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

## Scopes

| Scope | What it opens |
|---|---|
| `deliveries:read` | Read `/v1/deliveries` and `/v1/delivery-items`. |
| `deliveries:write` | The same, plus create, edit and the `actions` member on a delivery. |
| `returns:read` | Read `/v1/returns` and `/v1/return-items`. |
| `returns:write` | The same, plus create, edit and the `actions` member on a return. |

These are deliberately **not** part of `logistics:read` / `logistics:write`: `approve` on a delivery and `commit`/`fulfill`/`execute` on a return move stock, and an existing logistics key should not gain that silently. The broad legacy `write:api` expands to every fine-grained scope and therefore covers all four; the broad `read:api` does **not** include `deliveries:read` or `returns:read`, so list them explicitly on a read-only key. See [Credentials → Scopes](../credentials.md#scope-names).

Under a read scope the four collections are read-only and the documents have **no `actions` member at all** — a `PATCH .../actions` is a `404`, not a `403`, in the same way as any collection a key does not reach (see [gotcha 41](../common-gotchas.md#41-a-write-under-a-read-only-scope-is-a-silent-200)).

---

## The Recipe: Receive a Purchase Order

Five requests take a purchase order from approved to received, and a sixth sends something back.

**1. Approve the purchase order.** Create it as in [Purchase Order](orders.md#purchase-order) — your store as `customer`, the supplier as `supplier` and sole seller — and approve it so its lines are `Committed`:

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

The delivery's status becomes `["Delivered"]`; the 8 units land in the receiver's stock (`GET /v1/products/com.example.sku=WIDGET~with(stockLevels)` shows them); the order line becomes 8 `Fulfilled` and keeps the remaining 2 `Committed`, because the default `underdeliveryPolicy` is `"LeaveOpen"`. A second `POST /v1/deliveries` from the same order picks up only what is still committed.

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
   "orderItems": [{ "identifiers": { "key": "<trade order item key>" } }] }]
```

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

**Create errors:**

| Request | Response |
|---|---|
| `order` (or `orderItems`) with no committed lines | `400` with `details` `"The order has no committed items to deliver."` |
| Bare shape without `sender` or `receiver` | `400` |
| A negative `quantity` | `400` |

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

The essential members are `identifiers`, `timestamp`, `sender`, `receiver`, `currency`, `status`, `discrepancy` and `items`. `orders` is non-essential.

**Non-essential members** (fetch with `~with(...)`):

| Member | Type | Notes |
|---|---|---|
| `destinationAddress` | address | Read/write. |
| `carrier` | agent | Read/write. |
| `estimatedDepartureTime`, `estimatedArrivalTime` | date-time | Read/write. |
| `actualDepartureTime`, `actualArrivalTime` | date-time | Read-only — stamped by `registerDeparture` / `registerArrival` (see [Delivery Actions](#delivery-actions)). |
| `labels` | label[] | As on trade orders — see [Labels](orders.md#labels). |
| `orders` | trade order[] | The orders this delivery delivers against. |

**The two document numbers** live in `identifiers`:

- `identifiers.sendersId` is the **supplier's delivery-note number**. It is writable, and it is an index, so a delivery can be fetched by it:

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
| `package` | package | |
| `productInstances` | product instance[] | Serial or batch capture for the received units. Replaceable while the delivery is `New`. |
| `totalAmount` | decimal | |

### Status and Discrepancy Values

| Member | Values | Notes |
|---|---|---|
| `status` | `New` \| `Delivered` | On the item and on the document. An array, as on trade orders. |
| `discrepancy` | `ZeroDelivery` \| `Underdelivery` \| `Overdelivery` \| `None` | On the item and on the document. The document aggregates every non-`None` value its lines carry, so a delivery with one short line and one surplus line reads `["Underdelivery", "Overdelivery"]`. |

### Editing Lines on a New Delivery

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
```

After approval every write to `quantity` or `productInstances` is a `409`.

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

The overdelivery refusal is a `409` whose `@type` is `state conflict` and whose `details` reads, exactly:

```
This delivery overdelivers and the order's overdelivery policy rejects it.
```

With the default `overdeliveryPolicy: "Accept"` the surplus is simply received — 12 counted against 10 ordered puts 12 into stock. `"Warn"` receives it as well. The policies are set on the trade order and default from the trade relationship; see [Purchasing Fields on Trade Orders](#purchasing-fields-on-trade-orders).

### Querying Deliveries

```bash
# Filter by any of sender, receiver, order, modifiedTag
POST /v1/deliveries/find
{ "receiver": { "identifiers": { "com.example.storeId": "DOWNTOWN" } } }
```

The response is `{ "modifiedTag": …, "results": [...] }`, the same shape as the other finders.

```bash
# Time-relative reads, with the same (create)/(modify) modes as trade orders
GET /v1/deliveries/after/2026-01-01T00:00:00.000Z~take(100)
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

Non-essential: `orders` (backlink) and `labels`, as on deliveries. On an item, `orderItem` and `deliveryItem` (the provenance of the line — whichever it was created from), `productInstances` and `totalAmount`.

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

A trade order carries a set of purchasing members. All are non-essential — fetch them with `~with(...)` — and the writable ones can be set on create and via `PATCH`:

| Field | Type | Description |
|---|---|---|
| `supplierConfirmed` | boolean | The supplier has confirmed the order |
| `receiverNotes` | string | Notes for whoever receives the goods |
| `requestedArrivalTime` | date-time | When the goods are wanted |
| `suppliersReference`, `customersReference` | string | Each party's reference for the order |
| `suppliersInternalNotes`, `suppliersExternalNotes` | string | The supplier's notes, private and shared |
| `customersInternalNotes`, `customersExternalNotes` | string | The customer's notes, private and shared |
| `underdeliveryPolicy` | `"LeaveOpen"` \| `"Cancel"` | What approving a short delivery does with the remainder |
| `overdeliveryPolicy` | `"Accept"` \| `"Warn"` \| `"Reject"` | What approving a surplus delivery does with it |

Read-only: `deliveryDiscrepancy` (`string[]`, the same values as a delivery's `discrepancy`), `deliveries` and `returns` (the documents raised against the order). An unknown policy value is rejected. When neither policy is set on the order it defaults from the trade relationship between supplier and customer.

The full order field reference is in [Working with Orders → Field Reference](orders.md#field-reference).

---

## Endpoint Matrix

### Deliveries

| Operation | Method | Endpoint | Use Case |
|---|---|---|---|
| List deliveries | GET | `/v1/deliveries~take(50)` | Browse |
| Get delivery | GET | `/v1/deliveries/{id}` | Single document |
| Get by supplier's number | GET | `/v1/deliveries/sendersId={no}` | Match a delivery note |
| Create delivery | POST | `/v1/deliveries` | From `order`, `orderItems`, or bare |
| Get items | GET | `/v1/deliveries/{id}/items` | Lines |
| Add item | POST | `/v1/deliveries/{id}/items` | While `New` |
| Remove item | DELETE | `/v1/deliveries/{id}/items/{key}` | While `New` |
| Count a line | PATCH | `/v1/delivery-items/{key}` | `quantity`, `productInstances`, while `New` |
| Delivery actions | PATCH | `/v1/deliveries/{id}/actions` | `approve`, `registerArrival`, `registerDeparture` |
| Find deliveries | POST | `/v1/deliveries/find` | `sender`, `receiver`, `order`, `modifiedTag` |
| Time window | GET | `/v1/deliveries/after/{ts}`, `/before/{ts}` | Incremental reads |

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

- [Orders](orders.md) — purchase orders, the purchasing fields, and the record-level return actions
- [Stock](stock.md) — where the received units land, and stock levels
- [Trade Records](../trade-records.md) — the ledger's log of each move a delivery or return caused on the order
- [Credentials → Scopes](../credentials.md#scope-names)
