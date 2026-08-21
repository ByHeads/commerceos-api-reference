# Trade Records

A trade record is the ledger's account of what actually *happened* to a trade order — a unit was reserved, committed, delivered, returned or cancelled. Where the order says what was asked for, the records say what was done, to how much of each line, and when.

---

## Overview

**Key characteristics:**

- **Written by the ledger, not by clients.** Records appear as a side effect of order activity (an approval, a fulfilment, a return). `POST`, `PUT` and `DELETE` on the collection create and remove nothing.
- **The body is read-only.** `items`, `orders` and `timestamp` cannot be changed through the API — not even with the write scope.
- **Two surfaces are writable**, and only under [`trade-records:write`](#scopes): the record's external identifiers, and registered dynamic properties. That is enough to stamp your own ID or a sync marker on a record, and nothing more.
- **Records carry a creation time and no modification time.** [`/before/` and `/after/`](#time-relative-queries) filter on creation time and that is the only mode they accept.

**How it sits beside its neighbours:**

| Resource | What it holds |
|---|---|
| [Trade order](working-with/orders.md) | What was ordered — lines, quantities, prices, current status |
| **Trade record** | What was done to that order, action by action, with the quantity each action moved |
| [Receipt](receipts.md) | The immutable point-of-sale document for a completed sale |

An order links to its records through `records`, and a record links back through `orders`. Both are non-essential, so ask for them:

```
GET /v1/trade-orders/com.example.orderId=ORD-001~with(records)
GET /v1/trade-records/{key}~with(orders)
```

---

## Scopes

| Scope | What it opens |
|---|---|
| `trade-records:read` | Read `/v1/trade-records` and `/v1/trade-record-items`. |
| `trade-records:write` | The same reads, **plus** external identifiers and registered dynamic properties on a record. Record items stay read-only. |

`trade-records:write` includes the read side, so a key that only stamps markers needs just the one scope. The broad legacy `write:api` expands to every fine-grained scope and therefore covers it; the broad `read:api` does **not** include `trade-records:read`, so list that one explicitly if you want a read-only key. See [Credentials → Scopes](credentials.md#scope-names).

> **A missing scope does not answer `403` here.** Whether a write lands depends on which scope routed it, and neither failure looks like a permission error:
>
> | Token holds | `PATCH /v1/trade-records/{key}` |
> |---|---|
> | `trade-records:write` | `200`, and the change persists |
> | `trade-records:read` only | `200`, and **nothing persists** — the endpoint is in that scope's graph, so the request routes, it just lands on read-only members |
> | neither trade-record scope | `404` — the path is not in the graph at all, and a path that is not there is not found |
>
> So the status code is not the gate. **Read the value back and check it**, exactly as you would after any write whose target might be read-only:
>
> ```
> PATCH /v1/trade-records/{key}    {"com.example.synced": true}   # 200 either way — ignore it
> GET   /v1/trade-records/{key}~with(com.example.synced)          # this is the gate
> ```
>
> If the readback is missing or `false`, the key is short a scope. Same shape as [gotcha 41](common-gotchas.md#41-a-write-under-a-read-only-scope-is-a-silent-200).

---

## Reading Trade Records

### The collection and a single record

```
GET /v1/trade-records~take(20)
GET /v1/trade-records/{key}
GET /v1/trade-records/com.example.recordId=TR-2025-001
```

A record's essential members are `identifiers` and `items`. `timestamp` and `orders` are non-essential:

```
GET /v1/trade-records/{key}~with(timestamp,orders)
GET /v1/trade-records/{key}~withAll
```

### Items, actions and effects

A record holds one item per order line it touched, and each item holds the actions taken on that line. Ask for the actions explicitly on the collection form:

```
GET /v1/trade-records~with(items~with(actions))~first
```

```json
{
  "@type": "trade record",
  "identifiers": { "@type": "common identifiers", "key": "trec1234…" },
  "items": [
    {
      "@type": "trade record item",
      "identifiers": { "@type": "common identifiers", "key": "tri5678…" },
      "actions": [
        { "@type": "trade record item action", "type": "Fulfill", "quantity": "2", "amount": "398.00" }
      ]
    }
  ]
}
```

An action's `type` is one of eight values, matching the order lifecycle:

| `type` | What moved |
|---|---|
| `Reserve` / `Unreserve` | Stock reserved for the line, or released again |
| `Commit` | The line was approved |
| `Fulfill` | The line was delivered |
| `Cancel` | The line was cancelled |
| `CommitReturn` / `FulfillReturn` / `CancelReturn` | A return was committed, completed, or called off |

`type`, `quantity` and `amount` are essential on an action. `product`, `currency`, `tradeOrderItemEffects` and `return` need `~with`. `return` — carrying `reason`, `restock` and `complaint` — is present only on a `FulfillReturn`.

`tradeOrderItemEffects` is the join back to the order: each effect names the `affectedItem` and how much of it the action moved (`affectedQuantity`, `affectedAmount`).

```
# Every action across a record's items, flattened, and only the deliveries
GET /v1/trade-records~first~with(items/*actions~flat~where(type=Fulfill)~count)

# Which order line a delivery moved, and by how much
GET /v1/trade-records/{key}/items~first~with(actions~with(tradeOrderItemEffects))
```

`items/*actions` in the first query is the collect-a-member-across-a-collection form — it gathers every item's `actions` into one array, which `~flat` then levels so a single `~where` can run across all of them. See [Mapped Types → Selectors](mapped-types.md).

---

## Time-Relative Queries

Trade records support the shared [`/before/` and `/after/`](operators.md#time-relative-queries-before-and-after) path filters, with one difference from most collections worth knowing before you build a sweep on them:

> **`(create)` is the only mode, and the default.** A trade record has no modification time, so `/after/{t}` and `/after(create)/{t}` are the same query, and `(modify)` and `(status)` answer `404` with `Supported modes: create` in the error's `details`.

```
GET /v1/trade-records/after/2025-02-01T00:00:00.000Z~take(500)
GET /v1/trade-records/after(create)/-=48~count      # identical to the line above's default mode
GET /v1/trade-records/after(modify)/-=48            # 404
GET /v1/trade-records/after(status)/-=48            # 404
```

**The useful consequence for an incremental sync:** because there is no modification time, [stamping a marker](#sync-markers) or an identifier on a record cannot move it within the window. A record's creation time is the same before and after the write, so a marker written mid-sweep can neither push a record out of the range an in-flight walk is reading nor pull an already-processed one back in. The two things a sweep does — read a window, and mark what it processed — do not interfere.

The flip side is that there is no "records changed since" query on this collection at all. If you need to notice an edit, notice it on the [order](working-with/orders.md), which does carry a modification time.

---

## Writing to a Trade Record

Both writable surfaces are ordinary `PATCH`es against a single record, and both need `trade-records:write`.

### Stamping an external identifier

```
PATCH /v1/trade-records/{key}
{ "identifiers": { "com.example.recordId": "TR-X1" } }
```

The record is then reachable by that identifier as well as by its key:

```
GET /v1/trade-records/com.example.recordId=TR-X1
```

Identifiers add rather than replace, so an earlier one keeps resolving. Keys must be well-formed — see [External Identifiers](overview.md#external-identifiers), and [gotcha 40](common-gotchas.md#40-a-malformed-identifier-key-is-dropped-and-every-retry-then-creates-another-record) for what a malformed one costs.

### Sync markers

A namespaced marker has to be **registered on the type first**; an unregistered key is not a member and a write to it is ignored. Register once, at deploy time:

```
PATCH /v1/trade-records/properties/dynamic
{ "com.example.synced": { "propertyType": "boolean", "description": "Pushed to the finance system" } }
```

`propertyType` is one of `string`, `number`, `boolean` or `date-time`, and `description` is required and may not be empty. Read the registry back with `GET /v1/trade-records/properties/dynamic`.

Then set the marker as a **top-level key** on the record — not under `properties`:

```
PATCH /v1/trade-records/{key}
{ "com.example.synced": true }
```

```
GET /v1/trade-records/{key}~with(com.example.synced)
```

Setting it to `null` clears it.

**The point of the marker is the selector it enables.** A sweep asks for the records it has not handled yet, and shrinks that set as it goes:

```
GET /v1/trade-records~where(!com.example.synced)~count      # N still to push
PATCH /v1/trade-records/{key}   { "com.example.synced": true }
GET /v1/trade-records~where(!com.example.synced)~count      # N - 1
```

`!field` is the falsy check, so it matches records where the marker is absent as well as ones where it is `false` — an unmarked record and a cleared one are both picked up again. See [Operators → Filtering](operators.md#filtering).

### What is not writable

> **A write to a read-only member is a silent `200`.** The record body is not writable and does not say so — the request succeeds and the member is unchanged.
>
> ```
> PATCH /v1/trade-records/{key}   {"items": []}          # 200, items unchanged
> PATCH /v1/trade-records/{key}   {"orders": []}         # 200, orders unchanged
> PATCH /v1/trade-records/{key}   {"timestamp": "…"}     # 200, timestamp unchanged
> PATCH /v1/trade-records/{key}   {"bogusMember": 1}     # 200, nothing written
> ```
>
> A marker sent **alongside** a rejected body member still lands, so a payload that carries both is not lost — only the read-only half is dropped.

The collection is not creatable either: `POST /v1/trade-records` leaves the count unchanged, and there is no way to delete a record. Records exist because the ledger recorded something.

---

## Member Reference

### Trade record

| Member | Type | Notes |
|---|---|---|
| `identifiers` | common identifiers | Essential. Writable under `trade-records:write`. |
| `items` | trade record item[] | Essential, read-only. |
| `orders` | trade order[] | Read-only, non-essential — use `~with(orders)`. |
| `timestamp` | date-time | Read-only, non-essential — use `~with(timestamp)`. |

Plus any registered dynamic properties, addressed as top-level namespaced keys.

### Trade record item

| Member | Type | Notes |
|---|---|---|
| `identifiers` | common identifiers | Essential. Read-only — items are not writable under either scope. |
| `actions` | trade record item action[] | Essential. |

### Trade record item action

| Member | Type | Notes |
|---|---|---|
| `type` | string | Essential. One of the eight values [above](#items-actions-and-effects). |
| `quantity` | decimal | Essential. How much of the line this action moved. |
| `amount` | decimal | Essential. |
| `product` | product | Non-essential. |
| `currency` | currency | Non-essential. |
| `tradeOrderItemEffects` | trade order item effect[] | Non-essential. `affectedQuantity`, `affectedAmount`, `affectedItem`. |
| `return` | object | Non-essential, and present only on a `FulfillReturn`: `reason`, `restock`, `complaint`. |

---

## Related

- [Working with Orders](working-with/orders.md) — the orders these records account for, and [`statusDetails`](working-with/orders.md#per-line-status-breakdown-statusdetails) for where each line stands *now*, which these records are the log behind
- [Receipts](receipts.md) — the point-of-sale document for a completed sale
- [Operators → Time-relative queries](operators.md#time-relative-queries-before-and-after)
- [Credentials → Scopes](credentials.md#scope-names)
- [Orders integration template](integration-templates/orders-integration.md)
