# Working with POS Carts, Sessions and Supervisor Control

> **Availability:** v26.2.1 and later. Not in v26.2.0 or v26.1.x: there neither the members below nor the three scopes exist.

This guide covers what a till is doing right now and how an integration takes part in it: reading a terminal's session, adding and changing the lines of its cart, setting the customer and the receipt note, parking, resuming and discarding carts, and controlling a self-checkout lane as a supervisor would.

---

## Table of Contents

1. [Overview](#overview)
2. [Routes](#routes)
3. [Scopes](#scopes)
4. [Reading a Terminal's State](#reading-a-terminals-state)
5. [Lines](#lines)
6. [The Cart's Customer, Note and Visibility](#the-carts-customer-note-and-visibility)
7. [Park, Resume, Discard](#park-resume-discard)
8. [Supervisor Control](#supervisor-control)
9. [Refusals](#refusals)
10. [Endpoint Matrix](#endpoint-matrix)

---

## Overview

A POS terminal holds at most one **active cart** and any number of **parked carts**. The API reaches all of it **through the terminal**: `/v1/pos-terminals/{id}` has five members for it.

| Member | What it is |
|---|---|
| `session` | What the till is doing: mode, status, locks, age control, its cart and its parked carts |
| `cart` | The active cart, `null` when there is none |
| `parkedCarts` | The carts parked at this terminal |
| `resumableCarts` | Every parked cart this terminal may resume |
| `supervisor` | The supervisor's control of the lane |

There are no top-level cart, session or supervisor collections, and no `find`.

The API does what the till's buttons do, with the till's own guards: add, change and remove lines, set the customer and the receipt note, park, resume and discard, and the supervisor's lock, unlock, age control, clear, reset and unclog. A refusal is a `409` carrying the till's reason.

**The API never starts or completes a sale.** There is no request that creates a cart: the first accepted line opens it. Payment happens at the till, after which `cart` reads `null` and the sale is under [`/v1/receipts`](../receipts.md).

Every change is recorded as made by the API user, on the terminal's assigned device. Nothing in the audit trail marks a change as "made through the API", so give an integration its own technical user if its changes must be told apart from the cashiers'.

The cart before payment owns a draft trade order, the numberless `New` order of [gotcha 59](../common-gotchas.md#59-every-open-pos-cart-is-a-new-trade-order-without-a-number). It is readable as `draftOrder` on the cart.

---

## Routes

`{id}` is `posTerminalName=<name>` or the terminal's key. URL-encode spaces: `posTerminalName=Kassa%201`. Member segments are camelCase in the URL: `/parkedCarts`, not `/parked-carts`.

| Route under `/v1/pos-terminals/{id}` | Methods | Scope |
|---|---|---|
| `/session` | `GET` | `pos.carts:read` |
| `/session/actions` | `PATCH` with `parkCart`, `resumeCart`, `discardCart` | `pos.carts:write` |
| `/cart` | `GET` (`null` when none); `PATCH` with `customer`, `manualNotes`, `visibility` | `pos.carts:read` / `pos.carts:write` |
| `/cart/items` | `GET` (`[]` when there is no cart); `POST` one trade line or an array of them | `pos.carts:read` / `pos.carts:write` |
| `/cart/items/{key}` | `GET`; `PATCH` with `quantity`, `unitAmountInclVat`, `manualDiscount`, `manualNotes`; `DELETE` | `pos.carts:read` / `pos.carts:write` |
| `/parkedCarts`, `/parkedCarts/{key}` | `GET` | `pos.carts:read` |
| `/parkedCarts/{key}/items`, `…/items/{key}` | `GET`. Every write is a `409`, see [A parked cart is read-only](#a-parked-cart-is-read-only) | `pos.carts:read` |
| `/resumableCarts`, `/resumableCarts/{key}` | `GET` | `pos.carts:read` |
| `/supervisor` | `GET` | `pos.supervisor:write` |
| `/supervisor/actions` | `PATCH` with `lock`, `unlock`, `denyAgeRestriction`, `confirmAgeRestriction`, `clearHelpRequest`, `clearAlert`, `resetSession`, `unclog` | `pos.supervisor:write` |

`GET /v1/pos-terminals/{id}` and the collection read as before: none of the five members is in the default projection. `?fields=all` renders all five, and `~with(session)` works too.

**The two `actions` objects are write-only.** A `PATCH` answers `200 {"@type": "POS session actions"}` or `{"@type": "POS supervisor actions"}` and nothing else, and a `GET` on them answers the same empty object. Read the session or the cart afterwards to see the effect.

- Several actions can go in one body: `{"clearAlert": true, "clearHelpRequest": true}`.
- An action sent as `false` or `null` is a silent `200` that does nothing.
- So is an action whose state already holds: `unlock` on an unlocked lane, `confirmAgeRestriction` with nothing pending.

---

## Scopes

Three fine-grained scopes. `read:api` includes `pos.carts:read`; `write:api` includes all three.

| Scope | Opens |
|---|---|
| `pos.carts:read` | The `session`, `cart`, `parkedCarts` and `resumableCarts` members, read-only. It also gives a key without any `pos:*` scope a read-only view of the terminals themselves |
| `pos.carts:write` | Adding, changing and removing lines, the cart's customer and notes, and park, resume and discard |
| `pos.supervisor:write` | The `supervisor` member and its actions. It has no read twin |

What a key answers with exactly the scopes named:

| Key holds | `GET …/session`, `GET …/cart` | `GET …/supervisor` | `PATCH …/session/actions` | `POST …/cart/items` | `PATCH …/supervisor/actions` |
|---|---|---|---|---|---|
| `pos:read` only | `200 null` | `200 null` | `200 null`, nothing happens | `400` `failed indexing` | `200 null` |
| `pos.carts:read` only | the session, the cart | `200 null` | `200 null`, nothing happens | `400` `failed indexing` | `200 null` |
| `pos.carts:read` + `pos.carts:write` | the session, the cart | `200 null` | works | `400` `Invalid product match…` until the key also holds `products:read` | `200 null` |
| `pos.supervisor:write` only | `200 null` | the control, with the session nested | `200 null` | `400` `failed indexing` | works |

- **A missing scope is never a `403` or a `404` on these routes.** The member reads `null` (arrays `[]`), a write answers `200 null` and changes nothing, and a `POST` into a cart the key cannot see answers `400` `failed indexing`. This is [gotcha 41](../common-gotchas.md#41-a-write-under-a-read-only-scope-is-a-silent-200) again. Check the key with [`GET /v1/scopes`](../overview.md#checking-what-a-key-can-do-v1scopes).
- **The references in a cart need their own read scopes.** The read twins are enough:

  | To do this | The key also needs |
  |---|---|
  | add a line (`product`) | `products:read` |
  | attach a customer | `customers:read` |
  | give a manual discount (`reason`) | `discounts.manual:read` |
  | read `draftOrder` | `orders.sales:read` |

  Without `products:read` every `POST` answers `400` `Invalid product match. Must match exactly one existing product.` With those four beside the two cart scopes, `relationship` on the cart still does not render; it needs a scope that carries trade relationships.
- **The cart scopes do not open the terminal's configuration.** A key with `pos.carts:write` and without `pos:write` changes carts and cannot change the terminal's `status` or `profile`: that `PATCH` answers `200` and persists nothing.
- **A supervisor-only key sees the lane's state, not its cart.** `supervisor.session` carries the mode, status and lock; the nested `cart` reads `null` and `parkedCarts` `[]` without `pos.carts:read`.

See [Credentials → Scope names](../credentials.md#scope-names).

---

## Reading a Terminal's State

### The session

```bash
GET /v1/pos-terminals/posTerminalName=Kassa%201/session
```

```json
{
  "@type": "POS terminal session",
  "identifiers": { "@type": "POS terminal identifiers", "key": "49af…", "posTerminalName": "Kassa 1" },
  "terminal": { "@type": "POS terminal", "identifiers": { "posTerminalName": "Kassa 1" }, "status": "Active" },
  "mode": "Manned",
  "status": "shopping",
  "locked": false,
  "helpRequested": false,
  "ageRestrictionPending": false,
  "sessionActive": false,
  "frozen": false,
  "turnedOn": false,
  "cart": {
    "@type": "POS cart",
    "identifiers": { "key": "a279…" },
    "state": "Active",
    "itemCount": 1, "pieceCount": 2,
    "totalAmountInclVat": "200", "totalAmountExclVat": "200", "vatAmount": "0",
    "discountAmountInclVat": "0", "paidAmount": "0", "prepaidAmount": "0", "roundingAmount": "0",
    "balanceAmount": "200", "balanced": false,
    "hasSales": true, "hasReturns": false, "hasPayments": false,
    "projectReferenceRequired": false,
    "modifiedTag": "2026-09-30T09:03:12.635Z"
  },
  "parkedCarts": []
}
```

| Member | Values | Notes |
|---|---|---|
| `mode` | `Manned`, `Self-checkout` | The profile's mode. Absent when the terminal has no profile |
| `status` | `age-restriction`, `locked`, `paying`, `loyalty-pending`, `reward-pending`, `help-requested`, `alert`, `shopping`, `receipt`, `completing`, `available` | The first that applies, in that order. `available` on a fresh or reset till, `shopping` with lines in the cart, `locked` under a supervisor lock. v26.2.2 and later add `card-reading`, between `alert` and `shopping`: a self-checkout whose start screen asks for the payment method is reading the customer's card. Treat a value outside this list as possible |
| `locked`, `lockReason` | `true` with `manual`, `spot-check`, `cancelled`, `printer-error` or `age-restriction` | Only ever set on a self-checkout. `lockReason` is absent when not locked |
| `helpRequested` | boolean | The customer asked for help at the lane |
| `ageRestrictionPending`, `pendingAgeRestriction`, `ageRestrictionReasons` | `true`, `18`, `"Alcohol"` | See [Age control](#age-control). The last two are absent when no line is restricted |
| `sessionActive` | boolean | A self-checkout customer's session. Lines added through the API do not start one |
| `frozen`, `currentTask` | `true` and a task name | While a task is queued at the till. Cart writes are refused, see [A frozen terminal](#a-frozen-terminal) |
| `cardAcquisitionStatus` | `Pending`, `Acquired`, `Failed`, `Idle` | The lane's card tap ahead of the amount. `Pending` while one is in flight, `Acquired` or `Failed` once it has ended. Often absent. On v26.2.1 it reads `Idle` after `unclog`. Test for `Pending`: every other value, and absence, mean no tap is in flight |
| `alert` | `{ message, customerMessage, tone }` | When the lane shows an alert. Absent otherwise |
| `turnedOn` | boolean | Started for the day |
| `cart` | the cart's default projection | Absent when there is none |
| `parkedCarts` | the parked carts' default projection | `[]` when there are none |

**Test for "absent or `null`", not for one of them.** Empty members are usually left out of an object, a direct `GET …/cart` without a cart answers a literal `null`, and a projection that names an empty member renders it as `null`: `~just(lockReason,cart)` on an idle till answers `{"lockReason": null, "cart": null}`.

### The cart

```bash
GET /v1/pos-terminals/posTerminalName=Kassa%201/cart
GET /v1/pos-terminals/posTerminalName=Kassa%201/cart?fields=all
```

The default projection:

| Member | Notes |
|---|---|
| `identifiers` | The key only. The parking id is not an identifier |
| `state` | `Active` or `Parked` |
| `terminal`, `site` | The terminal that holds the cart, active or parked, and its store |
| `currency` | The cart's currency: `{"@type": "currency", "identifiers": {"key": "…", "currencyCode": "SEK"}}` |
| `itemCount`, `pieceCount` | Lines, and units across them |
| `totalAmountInclVat`, `totalAmountExclVat`, `vatAmount`, `discountAmountInclVat` | |
| `paidAmount`, `prepaidAmount`, `roundingAmount`, `balanceAmount`, `balanced` | |
| `hasSales`, `hasReturns`, `hasPayments`, `projectReferenceRequired` | |
| `modifiedTag` | The polling handle. It moves on every line change |
| `parkingId`, `visibility`, `customer`, `manualNotes` | When set. `customer` is expanded with name fields and identifiers |

`?fields=all` adds:

| Member | Notes |
|---|---|
| `items` | The lines, in order. See [Lines](#lines) |
| `validation` | `{ "@type": "POS cart validation", "valid": true, "errors": [] }`, or the reasons in the API user's language. Computed for the **active** cart only: a parked cart has none |
| `draftOrder` | The cart's draft trade order: `status: ["New"]`, no order number, `items`, `totalAmount`, and the `customer` once one is attached |
| `discountAmountExclVat` | |
| `relationship` | The trade relationship between the store and the customer. Only when a customer is attached |

A narrower projection works: `?fields=identifiers,validation,modifiedTag,customer` answers exactly those.

### Parked and resumable carts

```bash
GET /v1/pos-terminals/posTerminalName=Kassa%201/parkedCarts
GET /v1/pos-terminals/posTerminalName=Kassa%202/resumableCarts
```

- `parkedCarts` lists the carts parked **at this terminal**.
- `resumableCarts` lists every parked cart this terminal **may resume**: its own, those parked in its store as `This store` or `Everywhere`, and those parked anywhere as `Everywhere`.
- Both take `?fields=all` and `/{key}`.
- A key that is not in the list answers `200 null`. So does the old `parkedCarts/{key}` URL of a cart that was resumed elsewhere or discarded.

### The supervisor control

```bash
GET /v1/pos-terminals/posTerminalName=SCO-01/supervisor
```

```json
{
  "@type": "POS supervisor control",
  "identifiers": { "@type": "POS terminal identifiers", "key": "e96a…", "posTerminalName": "SCO-01" },
  "terminal": { "@type": "POS terminal" },
  "session": { "@type": "POS terminal session", "mode": "Self-checkout", "status": "available", "locked": false }
}
```

`session` is the session above. The control reads on a manned terminal too; only `lock` is refused there.

---

## Lines

### Adding a line

```bash
POST /v1/pos-terminals/posTerminalName=Kassa%201/cart/items
{
  "@type": "POS trade item",
  "product": { "identifiers": { "com.example.sku": "WIDGET-001" } },
  "quantity": 2
}
```

Optional on create: `unitAmountInclVat` (a manual price), `manualNotes`, `package`, `productInstance`. `@type` may be left out.

The answer is `201` with the line:

```json
{
  "@type": "POS trade item",
  "identifiers": { "@type": "common identifiers", "key": "f1e3…" },
  "index": 1,
  "product": { "@type": "product", "identifiers": { "com.example.sku": "WIDGET-001" }, "name": "Widget A", "status": "Active" },
  "quantity": "2",
  "baseQuantity": "2",
  "unit": "",
  "intent": "Fulfill",
  "orderItem": { "@type": "trade order item", "identifiers": { "key": "1752…" }, "quantity": "2", "totalAmount": "200", "unitAmountInclVat": "100" },
  "draft": true,
  "unitAmountInclVat": "100",
  "unitAmountExclVat": "100",
  "hasManualUnitAmount": false,
  "totalAmountInclVat": "200", "totalAmountExclVat": "200", "vatAmount": "0", "vatPercentage": "0",
  "discountAmountInclVat": "0", "discountAmountExclVat": "0", "discountPercentage": "0",
  "prepaidAmount": "0", "payableAmount": "200",
  "inStock": false,
  "pendingInput": [],
  "originallyCreated": "2026-09-30T09:03:12.635Z",
  "sign": 1,
  "removable": true
}
```

- Left out when empty: `package`, `manualDiscount`, `manualNotes`.
- `unit` is the till's unit label in the API user's language: `""` for a product without a unit, `"st"` for pieces under a Swedish user.
- `pendingInput` names what the till still needs before the line can be sold: `tracking` (a serial number), `weight`, `price`, `domain`.
- `orderItem` is the line of the cart's draft order.
- `unitAmountExclVat` is the unit price without VAT, before discounts: `"799.2"` beside `unitAmountInclVat: "999"` on a line with 25 % VAT.

A cart the till has worked on can hold other line types, told apart by `@type` and read-only through the API: `POS payment item`, `POS pick item`, `POS wallet item`.

### What a POST answers: the line the units landed on

A `POST` does not necessarily create the line it answers.

| Case | Answer |
|---|---|
| Same product (and package) as the last line, that line has no manual price, discount or note, and the quantity is a whole number | `201`, the **same key** as before, with the higher quantity. The units merged |
| The same, with a fractional quantity such as `0.5` | `201`, a **new** line. The next whole-number add merges into that new line |
| The last line has a note, a manual price or a discount | `201`, a new line |
| A priced add (`unitAmountInclVat`) that would merge | `409`, nothing changed, `info.mergedInto` names the line. See below |
| A product sold one line per unit (serial-tracked), `quantity: 3` | `201`, the **last** of three new lines, each with `quantity: "1"` |
| The same, more than 20 at once | `400` `Could not add the line: Cannot add more than 20 items at once. 21 requested.` |
| More than 500 units of any other product at once | `400` `Could not add the line: Cannot add more than 500 units at once. 501 requested.` The cart stays `null` |
| An array body `[ {…} ]` | **`200`** with an array of the landed lines. A single object answers `201` |

So count the cart's lines with `GET …/cart/items~count`, not your `POST`s.

**A priced add that would merge is refused, so the price is not lost:**

```json
{
  "@type": "state conflict",
  "error": "The request conflicts with the current state of the resource.",
  "details": "The units merged into the last line, which keeps its price. Change that line's unitAmountInclVat, or give it a note first so that the next units start their own line.",
  "info": { "mergedInto": "0cf2a357bfe406a180b27639dc1fe1ed" }
}
```

Either `PATCH` that line's `unitAmountInclVat`, or give it a `manualNotes` first so the next add starts its own line. A note sent with an add lands on the line the units landed on, so it stops the next merge, not its own.

**References and refusals on a `POST`:**

| Body | Answer |
|---|---|
| `"product": { "identifiers": { "com.example.sku": "…" } }` | resolves |
| `"product": { "com.example.sku": "…" }` (bare) | resolves too |
| a product that matches nothing | `400` `Invalid product match. Must match exactly one existing product.`, `info.invalidItem` |
| no `product` | `400` `A product is required.` |
| `quantity` of `0` or less | `400` `The quantity must be greater than zero.` |
| a `package` that matches nothing | `400` `The package must match exactly one product package.` |
| any `@type` other than `POS trade item` | `400` `Only a POS trade item can be created through the API; a POS payment item is created at the till.` |
| a product under a trade restriction for the terminal's store | `409` with the till's restriction message |
| any line, on a self-checkout whose profile has `scoStartScreen` `Payment method` or `Tap card`, before the customer has chosen how to pay at the lane | `409` with the till's text, "Choose how to pay before you scan." The cart stays `null`. v26.2.2 and later |

**Opening the cart.** The first line on a terminal without a cart opens one, as a scan on an empty till does, and `session.status` goes from `available` to `shopping`.

- A **refused** first line opens nothing: the terminal's `cart` stays `null`.
- A terminal **without a profile** cannot open a cart: `409` `The terminal has no profile, so it cannot open a cart.`
- There is no other way to open one. `PATCH …/cart` on a terminal without a cart answers `200 null` and changes nothing.
- A **self-checkout that asks for the payment method first** opens no cart until the customer has chosen at the lane. Until then `session.sessionActive` is `false` and `status` is `available` or `card-reading`. v26.2.2 and later.

### Changing a line

```bash
PATCH /v1/pos-terminals/posTerminalName=Kassa%201/cart/items/{key}
```

| Body | Answer |
|---|---|
| `{"quantity": 4}` | `200`, the line with `quantity: "4"` |
| `{"quantity": 0}` | `400` `The quantity must be greater than zero; remove the line with DELETE instead.` |
| `{"unitAmountInclVat": "80.00"}` | `200`, `unitAmountInclVat: "80"`, `hasManualUnitAmount: true`, totals follow |
| `{"unitAmountInclVat": null}` | `200`, the manual price is cleared: back to the list price, `hasManualUnitAmount: false` |
| `{"manualDiscount": {…}}` | `200`, see [Manual discounts](#manual-discounts) |
| `{"manualDiscount": null}` | `200`, the discount is gone |
| `{"manualNotes": "gift wrap"}` | `200`, the note is on the line. `null` clears it |

- A product sold one line per unit takes an increase as new lines and refuses a decrease: `400` `A product sold one line per unit cannot be decreased; remove lines instead.`
- A line that is no longer editable answers `409` `The line can no longer be changed.` with `info.status`.

### Manual discounts

Three kinds, told apart by `@type`. Amounts are **per unit, on the price including VAT**. A `reason` is required.

```bash
PATCH /v1/pos-terminals/posTerminalName=Kassa%201/cart/items/{key}
{
  "manualDiscount": {
    "@type": "percentage manual discount",
    "percentage": "10",
    "reason": { "identifiers": { "com.example.reasonId": "STAFF" } },
    "notes": "staff"
  }
}
```

On a line of 4 at 100:

| `manualDiscount` | Line total | `discountAmountInclVat` |
|---|---|---|
| `"@type": "percentage manual discount", "percentage": "10"` | `"360"` | `"40"`, and `discountPercentage: "10"` |
| `"@type": "fixed reduction manual discount", "amount": "5"` | `"380"` | `"20"` — 5 off each unit |
| `"@type": "fixed price manual discount", "amount": "90"` | `"360"` | `"40"` — each unit at 90 |

It reads back on the line as:

```json
"manualDiscount": {
  "@type": "manual discount",
  "identifiers": { "key": "e804…" },
  "phase": { "@type": "discount phase", "identifiers": { "key": "2878…" } },
  "includesTax": true,
  "reason": { "@type": "discount reason", "identifiers": { "key": "dee0…" } },
  "notes": "staff"
}
```

`reason` and `phase` read back **by key only**. `phase` is the default phase when none was sent.

| Mistake | Answer |
|---|---|
| no `reason`, or one that matches nothing | `400` `A manual discount needs a reason that matches exactly one discount reason.` |
| no `@type` | `400` `manualDiscount takes a percentage, fixed reduction or fixed price manual discount, told apart by @type.` The line's `@type` may be left out; the discount's is required |
| an unknown `@type` | `400` `The provided type key 'bogus' is not defined in the current type schema` |
| a percentage discount without `percentage` | `400` `A percentage manual discount needs a percentage.` |
| a fixed kind without `amount` | `400` `A fixed manual discount needs an amount.` |
| a `phase` that matches nothing | `400` `The discount phase must match exactly one discount phase.` |
| more than the product's `maxDiscountPercentage` | `409` with the till's reason, "Exceeds product max discount". At the cap it goes through. A user allowed to override the cap at the till is allowed to here |

### Removing a line

```bash
DELETE /v1/pos-terminals/posTerminalName=Kassa%201/cart/items/{key}
```

`200 { "deletedCount": 1, "info": "Deleted 1 items" }`.

- **Removing the last line closes the cart**: `GET …/cart` answers `null` and `…/cart/items~count` answers `0`.
- A payment line cannot be removed (`removable: false`): `409` `The line cannot be removed from the cart.`
- Removing the last age-restricted line clears `session.ageRestrictionPending`.

---

## The Cart's Customer, Note and Visibility

```bash
PATCH /v1/pos-terminals/posTerminalName=Kassa%201/cart
```

| Body | Answer |
|---|---|
| `{"customer": { "identifiers": { "com.example.customerId": "CUST-001" } }}` | `200`, the cart with `customer` expanded. The customer is attached as the till attaches one: the trade relationship is ensured, and `relationship` and `projectReferenceRequired` follow |
| `{"customer": null}` | `200`, the customer is detached. With none attached: `409`, "No customer attached to cart" |
| a `customer` that matches nothing | `400` `The customer was not found; pass a reference to an existing one, e.g. { "identifiers": { "key": "…" } }.` Nothing is attached |
| `{"manualNotes": "Called ahead, picks up at 17:00"}` | `200`, the receipt note. `null` clears it |
| `{"visibility": "Everywhere"}` | `200`. One of `This terminal`, `This store`, `Everywhere`; the same values and the same rule as when parking. `null` clears it |
| `{"visibility": "<any other string>"}` | `400` `visibility takes one of 'This terminal', 'This store', 'Everywhere', or null to clear it.`, `info.invalidItem` |

- Unlike `product` on a line, `customer` does **not** take the bare form `{ "com.example.customerId": "…" }`. Use `{ "identifiers": { … } }`.
- A customer cannot be detached while the cart holds lines of existing orders: `409`.
- Every one of these is a `409` while the cart is parked, while the terminal is frozen, and while a supervisor lock is on.

---

## Park, Resume, Discard

```bash
PATCH /v1/pos-terminals/posTerminalName=Kassa%201/session/actions
```

### Park

```json
{"parkCart": "This store"}
```

`200`. Afterwards `GET …/cart` answers `null`, and the cart is in `parkedCarts` with `state: "Parked"`, the `visibility` you gave, a five-character `parkingId` such as `"EIO89"`, and its `customer` and `manualNotes` as set.

| Value | Effect |
|---|---|
| `"This terminal"`, `"This store"`, `"Everywhere"` | Parks with that visibility |
| `true` | Parks with the cart's current visibility. **A cart that never had one is parked for this terminal only**: the store's other terminals do not list it under `resumableCarts` and cannot resume it (`409`) |
| any other string | `400` `parkCart takes true or one of 'This terminal', 'This store', 'Everywhere'.` |
| `false`, `null` | `200`, nothing happens |

Refused with `409`: an empty cart ("Cart is empty"), a frozen terminal, and `Everywhere` when the cart holds payments, returns or lines of existing orders (`Can only park 'Everywhere' if the cart exclusively has new sales.`). A supervisor lock does **not** stop parking.

### A parked cart is read-only

Every write to a parked cart or its lines answers `409`:

```json
{
  "@type": "state conflict",
  "error": "The request conflicts with the current state of the resource.",
  "details": "The cart is parked; resume it at a terminal before changing it.",
  "info": { "state": "Parked" }
}
```

That is `PATCH …/parkedCarts/{key}`, `POST …/parkedCarts/{key}/items`, and `PATCH` and `DELETE` on `…/parkedCarts/{key}/items/{line}`. Resume the cart first.

### Resume

```json
{"resumeCart": { "identifiers": { "key": "<cart key>" } }}
```

Sent to the terminal that takes the cart. `200`; the cart becomes that terminal's active cart (`state: "Active"`) and leaves the other terminal's `parkedCarts`. Its `visibility` is cleared; its `parkingId` stays until the next park. A terminal that has a cart of its own parks that one first.

Which carts a terminal may resume is its `resumableCarts`:

| Parked as | Resumable at |
|---|---|
| `This terminal`, or `true` on a cart without a visibility | the same terminal |
| `This store` | every terminal of the same store |
| `Everywhere` | every terminal. Resumed in another store, the cart's `site` becomes that store |

| Refusal | Answer |
|---|---|
| a cart parked for another terminal of the same store: parked there as `This terminal`, or with `true` and no visibility | `409` `The cart is parked for another terminal.` Nothing moves |
| a cart parked `This store`, resumed in another store | `409` `Can only resume a cart from a different node if its visibility is 'Everywhere' and it exclusively has new sales.` |
| a cart that is not parked (active somewhere, or already resumed) | `409` `The cart is not parked.` |
| a key that matches no cart | `400` `failed indexing`, `Found no matching 'POS cart' using this index.` |
| `{ "identifiers": { "key": "new" } }` | `400` `A cart is not created directly: the first line added at POST /v1/pos-terminals/{id}/cart/items opens it.` |

A supervisor lock does **not** stop a resume. A frozen terminal does.

### Discard

```json
{"discardCart": true}
```

`200`. `GET …/cart` answers `null`, the cart is gone for good, and its old `parkedCarts/{key}` URL answers `200 null`. `false` is a `200` that does nothing.

Refused with `409`:

- an empty cart ("Cart is empty")
- payments in the cart ("Cart has external side effects that must be resolved first")
- a frozen terminal
- a pending card tap, on v26.2.1 only (`A card acquisition is pending at the terminal; empty the cart at the till, which cancels it.`). From v26.2.2 the discard goes through and releases the card at the payment terminal
- a loyalty session (`The cart has a loyalty session; discard it at the till, which cancels the session.`)

With payments in the cart, a pending card tap or a loyalty session, `parkCart` stays open, and so does the supervisor's `unclog`. A supervisor lock does **not** stop a discard.

---

## Supervisor Control

```bash
PATCH /v1/pos-terminals/posTerminalName=SCO-01/supervisor/actions
```

Every action takes `true`; `lock` also takes a reason.

| Body | Answer, and the session afterwards |
|---|---|
| `{"lock": "spot-check"}` | `200`; `status: "locked"`, `locked: true`, `lockReason: "spot-check"` |
| `{"lock": true}` | `200`; the reason is `manual`. On a lane that is already locked it **overwrites the reason** with `manual` |
| `{"lock": "age-restriction"}`, or any value outside `manual`, `spot-check`, `cancelled` | `400` `lock takes true or one of 'manual', 'spot-check', 'cancelled'; other reasons are set by the system.` |
| `{"lock": true}` on a manned terminal | `409` `lock applies to self-checkout terminals; block a manned terminal with status Inactive.`, `info.mode: "Manned"` |
| `{"unlock": true}` | `200`; `locked: false`, `lockReason` absent, `status` back to what the cart implies |
| `{"confirmAgeRestriction": true}` | `200`; `ageRestrictionPending: false` |
| `{"denyAgeRestriction": true}` | Under an age-control lock: lifts the lock, the restriction stays pending, and the next Pay locks again. Otherwise `409` `The terminal is not under an age control.`, `info.lockReason` |
| `{"clearAlert": true, "clearHelpRequest": true}` | `200` |
| `{"resetSession": true}` | `200`; the active cart is gone, `status: "available"`, `locked: false`, `sessionActive: false`, `helpRequested: false`. A cart already parked at the lane stays parked. Works under a supervisor lock |
| `{"unclog": true}` | `200`; the cart is **parked** (with the visibility it had, usually none, and a new `parkingId`) and `status` is `available`. It also clears a queued task and the alert, and ends a pending card tap. The way out of a lane the till cannot clear |

`resetSession` is refused with `409` when the cart holds payments, the terminal is frozen, or the cart has a loyalty session; on v26.2.1 also while a card tap is pending. `unclog` is the action for those cases.

**A cart that `unclog` parked is resumable at that lane only**, unless it carried a wider visibility: another terminal's `resumeCart` answers `409` `The cart is parked for another terminal.` To continue the sale at another terminal, send three requests:

1. `{"resumeCart": {"identifiers": {"key": "<cart key>"}}}` to the lane's `/session/actions`
2. `{"parkCart": "This store"}` to the lane's `/session/actions`
3. the same `resumeCart` to the other terminal's `/session/actions`

### What a lock blocks

**A lock freezes the cart's contents, not its lifecycle.**

| While the lane is locked | Answer |
|---|---|
| adding a line | `409` `The terminal is locked by a supervisor.` |
| changing a line's `quantity` or `unitAmountInclVat`, removing a line | `409`, the same |
| changing the cart's `customer` or `manualNotes` | `409`, the same |
| `parkCart` | `200`. The cart parks; `status` stays `locked` |
| `resumeCart`, `discardCart`, `resetSession` | `200` |

The `409` carries the text in `details` and in `info.reasons`, and the cart is untouched.

### Age control

Adding an age-restricted product lands the line (`201`) and the session then shows:

```json
{ "status": "shopping", "ageRestrictionPending": true, "pendingAgeRestriction": 18, "ageRestrictionReasons": "Alcohol" }
```

- **Only the lane raises the `age-restriction` lock**, when the customer presses Pay. The API cannot request it.
- `confirmAgeRestriction` works ahead of the lock and lifts an age-control lock. Afterwards `ageRestrictionPending` is `false` while `pendingAgeRestriction` and `ageRestrictionReasons` **still** read `18` and `"Alcohol"`: they describe the cart's restriction, not the pending state.
- **`unlock` and `confirmAgeRestriction` do not resume a payment the lock interrupted.** The customer presses Pay again at the lane.

### A frozen terminal

While a task is queued at the till, `session.frozen` is `true` and `currentTask` names it. Then every cart change answers `409` "Terminal is frozen due to a running task. Please wait.": adding, changing and removing lines, the cart's customer, note and visibility, `parkCart`, `resumeCart`, `discardCart`, `lock` and `resetSession`.

Not held back by it: reads, `unlock`, `denyAgeRestriction`, `confirmAgeRestriction`, `clearAlert`, `clearHelpRequest` and `unclog`. It clears when the task has run.

### What the till can do that the API cannot

The till cancels a loyalty session when it empties a cart. The API cannot: while the cart has a loyalty session, `discardCart` and `resetSession` answer `409`. `parkCart` and `unclog` stay open.

A pending card tap (`session.cardAcquisitionStatus` is `"Pending"`):

- v26.2.1: `discardCart`, `resetSession` and a `DELETE` of the last line answer `409`. `parkCart` and `unclog` stay open.
- v26.2.2 and later: all of them go through, and the card is released at the payment terminal. A `DELETE` of the last line on a self-checkout with an active session keeps the card for that session.

---

## Refusals

A `409` is:

```json
{
  "@type": "state conflict",
  "error": "The request conflicts with the current state of the resource.",
  "details": "<text>",
  "info": { "reasons": ["<text>"] }
}
```

A `400` is `{ "@type": "bad request", "error": "…", "details": "<text>", "info": { "invalidItem": … } }`.

**Match on the status and on the keys of `info`, not on the wording.** Where the till words the refusal, the text comes in the **API user's preferred language**, else the deployment's default. Under a Swedish user "Cart is empty" arrives as `"Varukorgen är tom"`.

| `info` key | Says |
|---|---|
| `reasons` | The till's own reasons, as text |
| `mergedInto` | The line a priced add would have merged into |
| `state` | `Parked` on a write to a parked cart |
| `status` | The order line's status, on a line that can no longer be changed |
| `@type` | The line's type, on a line that cannot be removed |
| `lockReason` | The lane's current lock reason, on `denyAgeRestriction` |
| `mode` | `Manned`, on `lock` at a manned terminal |
| `invalidItem` | The value a `400` refused |

Texts that follow the user's language (English shown):

| Text | When |
|---|---|
| Cart is empty | `parkCart`, `discardCart` on an empty cart |
| Exceeds product max discount | a manual discount over the product's cap |
| No customer attached to cart | `{"customer": null}` with none attached |
| Cannot remove customer with existing orders | detaching while the cart holds lines of existing orders |
| Terminal is frozen due to a running task. Please wait. | any cart change on a frozen terminal |
| Cart has external side effects that must be resolved first | `discardCart`, `resetSession` with payments in the cart |
| Can only park 'Everywhere' if the cart exclusively has new sales. | `parkCart: "Everywhere"` with payments, returns or order lines |
| Choose how to pay before you scan. | adding a line to a self-checkout that asks for the payment method first, before the customer has chosen |

The other texts quoted in this guide are English whatever the user's language.

---

## Endpoint Matrix

All under `/v1/pos-terminals/{id}`.

| Operation | Method | Endpoint | Notes |
|---|---|---|---|
| What the till is doing | GET | `/session` | Mode, status, locks, cart, parked carts |
| Active cart | GET | `/cart` | `null` when none. `?fields=all` for lines, validation, draft order |
| Set customer, note, visibility | PATCH | `/cart` | `null` clears each |
| List lines | GET | `/cart/items` | `[]` when there is no cart |
| Add a line | POST | `/cart/items` | Opens the cart. `201` for an object, `200` for an array |
| Change a line | PATCH | `/cart/items/{key}` | `quantity`, `unitAmountInclVat`, `manualDiscount`, `manualNotes` |
| Remove a line | DELETE | `/cart/items/{key}` | The last one closes the cart |
| Park, resume, discard | PATCH | `/session/actions` | `parkCart`, `resumeCart`, `discardCart` |
| Parked here | GET | `/parkedCarts`, `/parkedCarts/{key}` | Read-only |
| May be resumed here | GET | `/resumableCarts`, `/resumableCarts/{key}` | Read-only |
| Supervisor's view | GET | `/supervisor` | `pos.supervisor:write` |
| Supervisor actions | PATCH | `/supervisor/actions` | `lock`, `unlock`, `denyAgeRestriction`, `confirmAgeRestriction`, `clearHelpRequest`, `clearAlert`, `resetSession`, `unclog` |
| Create a cart | — | — | Not possible. The first accepted line opens it |
| Pay | — | — | At the till only |

Related: [POS examples](../../guide/examples/pos.md#pos-carts-sessions-and-supervisor-control), [Orders placed at the till](orders.md#orders-placed-at-the-till-collect-in-store-and-ship-to-customer), [Receipts](../receipts.md), [Credentials → Scope names](../credentials.md#scope-names).
