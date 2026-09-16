# Stock Entries

Stock entries are a **target-based** stock-update resource: a caller posts the desired physical quantity at one or more `(product, place)` pairs, and the server reads the current level — the quantity at that place *and* in the submission's `stock` — and writes a stock-adjustment record that carries the deltas needed to land each pair on its target. Callers express *desired stock levels* rather than *deltas*; the deltas are computed server-side.

Every submission appears in the regular stock-adjustment audit trail and is cross-linked by identifiers, so existing readers over `/v1/stock-adjustments` keep working without change.

---

## Overview

> **Availability:** v26.1.11 and later. Earlier builds read the current level from the place alone, regardless of the submission's `stock` — see [What `physicalQuantity` is measured against](#what-physicalquantity-is-measured-against).

### When to use it

| Use case | Use this |
|---|---|
| "Set product X at place Y to 42 units" (target-based, idempotent w.r.t. drift) | `POST /v1/stock-entries` |
| "Increase product X at place Y by 5 units" (delta-based) | `POST /v1/stock-adjustments` — see [Stock Adjustments](working-with/stock.md#stock-adjustments) |
| "Bulk-update many products at one place" (legacy nested-array shape) | `PATCH /v1/stock-places/<key>` with the nested `entries` array — still supported for back-compat. The nested path writes synthetic correction accounts and **does not** show up in the stock-adjustment audit trail; new callers should prefer `/v1/stock-entries`. |

### Relationship to stock-adjustments

A `stock-entries` submission *is* a stock-adjustment under the hood:

- The submission's `identifiers` (including any caller-supplied namespaced IDs and the system-allocated `transactionId`) are copied onto the underlying stock-adjustment record.
- The submission's `timestamp`, `owner`, and `stock` become the stock-adjustment's `timestamp`, `owner`, and `stock`.
- Each `(product, place, target)` becomes a stock-adjustment item carrying the computed delta — the difference between the target and the quantity currently at that place in the submission's `stock`.
- Zero-delta entries (target already matches current physical) emit **no item**; the submission still succeeds.
- The direction of each generated item follows the sign of the computed delta. Callers never resolve a direction themselves — the `direction` field and the reason-direction precedence that apply to `/v1/stock-adjustments` items have no counterpart here. See [No direction on stock entries](#no-direction-on-stock-entries).

Once the submission is committed, the same record is readable via `/v1/stock-adjustments` by the same identifiers — see [Cross-Linking to Stock Adjustments](#cross-linking-to-stock-adjustments) below.

---

## Endpoints

| Method | Endpoint | Use Case |
|--------|----------|----------|
| POST | `/v1/stock-entries` | Submit one or more target-based entries (cross-product, cross-place). |
| GET | `/v1/stock-entries` | List submissions (paged like every other CommerceOS resource). |
| GET | `/v1/stock-entries/<key>` | Read back a submission. |
| GET | `/v1/stock-entries/<key>~with(items,transactionId,owner,stock,timestamp,identifiers)` | Read back with the underlying adjustment items expanded. |
| POST | `/v1/products/<product-key>/stockEntries` | Product-scoped variant — the `product` field on each entry is implicit (taken from the URL). |
| GET | `/v1/products/<product-key>/stockEntries` | List submissions whose underlying stock-adjustment touched the URL-scoped product. |

### Product-scoped variant

`/v1/products/<product-key>/stockEntries` is a convenience for callers that drive one product at a time across many places. On this endpoint:

- The `product` field on each entry is **implicit** (taken from the URL).
- If a caller sends `product` in the body anyway, **the URL wins** — this is a deliberate guardrail, not a quirk. Body `product` values are silently ignored so an inconsistent submission cannot land on a different product than the URL implies. **No diagnostic is returned** — the body `product` is silently dropped before any validation step. If you need to catch a misrouted client, validate the URL/body match before posting.
- Listing this collection is filtered to submissions whose underlying stock-adjustment extent involves the URL-scoped product.

---

## Request

### Top-level fields

| Field | Type | Required | Description |
|---|---|---|---|
| `identifiers` | object | yes | Caller-supplied identifiers. Maps to the underlying stock-adjustment record's identifiers — including `transactionId` once the underlying record is allocated. |
| `timestamp` | ISO timestamp | yes | The event timestamp recorded on the resulting stock-adjustment record. Submissions without a valid timestamp are rejected — see [Errors](#errors). |
| `owner` | agent ref | no | The stock owner. If omitted, inferred from `entries[0].place` via the nearest root place. If the inference returns multiple owners, the POST is rejected — pass `owner` explicitly. |
| `stock` | stock ref | no | The logical stock being adjusted. Each entry's current level is read from this stock at the entry's `place` — see [What `physicalQuantity` is measured against](#what-physicalquantity-is-measured-against). Defaults to the owner's default stock when omitted; with several stocks, a submission that forgets `stock` silently targets the default one. |
| `reason` | stock-adjustment-reason ref | no | The reason applied to every generated stock-adjustment item, recorded for audit. Its `direction` does **not** steer the movement — see [No direction on stock entries](#no-direction-on-stock-entries). Defaults to a system-managed `StockEntry` reason that is auto-created on first use and reused thereafter. |
| `entries` | `stock entry target[]` | yes | One or more target entries. An empty array is rejected; an object instead of an array is rejected — see [Entry validation](#entry-validation). Write-only: a submission reads back with `items`, and `~with(entries)` yields `null`. See the entry shape below. |

### Entry object fields

> **Availability:** ships in the release after v26.1.11. Not in v26.1.10 or v26.1.11.
>
> That release declares the element as a typed `stock entry target` in the OpenAPI document and the `/v1/elements` schema endpoints, and validates it as one (see [Entry validation](#entry-validation)). Earlier builds accept the same fields and described the element in prose only. The `physicalQuantity` semantics in the table are those of v26.1.11 and later — see [What `physicalQuantity` is measured against](#what-physicalquantity-is-measured-against).

Each element of `entries` is a **`stock entry target`**:

| Field | Type | Required | Description |
|---|---|---|---|
| `product` | product ref | yes on `/v1/stock-entries`; implicit (URL) on `/v1/products/.../stockEntries` | The product to drive. On the product-scoped endpoint, any `product` field present in the body is ignored — the URL is authoritative. |
| `place` | place ref (stock-place) | yes | The stock-place to drive. A `place` that does not resolve is rejected with `400`. All entries in one submission must resolve to the same owner — mixing places across owners is rejected. |
| `physicalQuantity` | decimal (number or numeric-string) | yes | The **target** physical quantity at `(product, place)` after the submission lands. The resource reads the current level — the quantity that is both at `place` and in the submission's `stock`, with units held on open customer orders counted as present — computes the delta, and emits a stock-adjustment item carrying that delta. See [What `physicalQuantity` is measured against](#what-physicalquantity-is-measured-against). Zero-delta entries emit no item but the submission still succeeds. Decimal targets are preserved (`"2.5"` ⇒ 2.5). May be **negative** — see [No direction on stock entries](#no-direction-on-stock-entries). A non-numeric value is rejected with `400` — see [Entry validation](#entry-validation). |
| `availableQuantity` | decimal | no (`nullable`) | Accepted for parity with the legacy nested `stock-place.entries` shape, but **informational only**. A single stock-adjustment item moves owner-stock and place-stock by the same delta, so effective stock follows `physicalQuantity`. See the anti-pattern callout in [Anti-Patterns](#anti-patterns). |
| `productInstances` | array of `{ quantity, serialNumber?, identifiers?, batch?, domain? }` | no | New-style instance list, identical to the shape on `stock-adjustment` items. Use this for serial- or batch-tracked products to record which specific units are being driven to the target. Round-trips through the read path (`~with(productInstances)`). |
| `instance` | object (e.g. `{ "imei": "..." }`) | no | **Deprecated** single-unit form, kept for compatibility with the stock-adjustment item shape. Prefer `productInstances` in new code. |

> **Note for generated clients:** earlier OpenAPI documents showed `availableQuantity` as **required** on this endpoint. It is optional (`nullable: true`) and always was; regenerate from a current document if your client insists on sending it.

Unrecognised keys on an entry — a `direction`, or a typo such as `physicalQty` — are **ignored, not rejected**. A misspelt `physicalQuantity` therefore surfaces only as the `"physicalQuantity is required on each entry"` error, never as an unknown-field error.

`entries` is **write-only**. A submission reads back with `items` (the generated stock-adjustment items); `~with(entries)` yields `null`. See [Read-Back](#read-back).

> **Heads up — duplicate `(product, place)` entries are not deduped.** A submission containing two or more entries that resolve to the same `(product, place)` pair processes each one independently. Each entry's delta is computed against the **pre-submission** current physical (not against any intermediate post-first-entry state), and each becomes a separate adjustment item on the underlying stock-adjustment record. The resulting final physical level is the sum of every delta applied — the last entry does **not** "win". If you intend a single target per pair, dedupe client-side before posting. See [Anti-Patterns](#anti-patterns).

### What `physicalQuantity` is measured against

> **Availability:** v26.1.11 and later. Earlier builds read the current level from the place alone, regardless of the submission's `stock`.

The resource takes absolute targets and writes the delta needed to reach them. The "current level" it subtracts from is the quantity that is both **at the entry's `place`** and **in the submission's `stock`** (the owner's default stock when `stock` is omitted):

- **One stock per place.** The number is the place's level, exactly as before. An owner set up this way sees no difference.
- **Several logical stocks at one place.** The place's total is the **sum over the stocks living there**, and each stock is addressed by its own submission (its own `stock` value). Two submissions targeting the same place with different `stock` values do **not** correct each other: driving `(SKU-001, WH-001)` to 40 in the default stock and to 10 in a display stock leaves the place holding 50.
- **Units held on open customer orders count as present.** Units reserved or committed to a customer order have left the *available* figure but are still on the shelf until the order fulfils, so the resource counts them. A store holding 7 with 2 committed on an open order reads 7 — a caller echoing the physical count 7 writes nothing. Once the order fulfils the level is 5, and an echo of 5 is a no-op. A cancelled order returns its units, and an echo of 7 is again a no-op. Open orders do not suppress the sync: a genuine shrink while an order is open still writes — 6 echoed against the held 7 writes −1.
- **Units on a committed supplier order do not count.** They are the mirror image — expected, but not on the shelf yet.
- **A stock transfer moves logical stock only.** A transfer whose receiver is a different owner puts nothing at the receiving owner's place, so an echo of the receiving store's post-transfer balance still writes the full quantity in as an increase, on top of the transferred quantity that is already in the stock. This was true before v26.1.11 as well. (From v26.1.11, `/v1/stock-transfers` refuses to create a transfer between different agents — see [Inter-Store Transfers](../guide/examples/stock-inventory-guide.md#54-inter-store-transfers) — so this concerns balances moved on earlier builds.)

Sign and direction rules are unaffected — see [No direction on stock entries](#no-direction-on-stock-entries).

### No direction on stock entries

`/v1/stock-entries` has **no direction concept**. `physicalQuantity` is an absolute target level, not a movement, so the resource computes the signed delta against the current stock and applies it. There is nothing for a caller to specify and nothing that can conflict:

- **There is no per-entry `direction` field.** Don't send one — it is ignored. Direction only exists on the delta-based `/v1/stock-adjustments` items, where the caller supplies the movement rather than the target. See [Direction and Sign Rules](working-with/stock.md#direction-and-sign-rules).
- **The submission's `reason` is recorded for audit, but its `direction` does not affect the movement.** A reason declared `direction: "Decrease"` used to *raise* a level from 4 to 8 simply increases it to 8. Pick the reason for what it says in the audit trail, not for the direction you want.
- **`physicalQuantity` may be negative.** It is a signed absolute level, and negative stock balances are permitted, so a target of `-5` drives the level to −5 and a subsequent submission of `5` recovers it to 5. A negative target is not a "decrease by 5" instruction — for that, post a delta to `/v1/stock-adjustments`.

```jsonc
// Drive (SKU-001, WH-001) to −5 — a signed absolute level, not a decrease of 5
[{
  "identifiers": { "com.example.id": "ENT-NEG-001" },
  "timestamp": "2024-03-15T10:30:00Z",
  "entries": [{
    "product": { "identifiers": { "com.example.sku": "SKU-001" } },
    "place":   { "identifiers": { "com.example.stockPlaceId": "WH-001" } },
    "physicalQuantity": -5
  }]
}]
```

### Worked example — single (product, place) to a target

Drive `SKU-001` at `WH-001` to 100 units, regardless of the current level:

```jsonc
POST /v1/stock-entries
Content-Type: application/json

[{
  "identifiers": { "com.example.id": "ENT-001" },
  "timestamp": "2024-03-15T10:30:00Z",
  "entries": [{
    "product": { "identifiers": { "com.example.sku": "SKU-001" } },
    "place":   { "identifiers": { "com.example.stockPlaceId": "WH-001" } },
    "physicalQuantity": 100
  }]
}]
```

- If the current physical at `(SKU-001, WH-001)` is 73, the resulting stock-adjustment record carries a single item with quantity `+27`.
- If it's already 100, the record carries no items (no-op submission).

### Worked example — product-scoped, with instance tracking

On the product-scoped endpoint, `product` is implicit. Drive `SKU-001` at `WH-001` to 100 units and record two specific serial numbers:

```jsonc
POST /v1/products/com.example.sku=SKU-001/stockEntries
Content-Type: application/json

[{
  "identifiers": { "com.example.id": "ENT-PROD-001" },
  "timestamp": "2024-03-15T10:30:00Z",
  "entries": [{
    "place": { "identifiers": { "com.example.stockPlaceId": "WH-001" } },
    "physicalQuantity": 100,
    "productInstances": [
      { "quantity": 1, "serialNumber": "IMEI-AAA-111" },
      { "quantity": 1, "serialNumber": "IMEI-AAA-112" }
    ]
  }]
}]
```

---

## Read-Back

`GET /v1/stock-entries/<key>` returns the submission shape with these fields:

| Field | Description |
|---|---|
| `identifiers` | The caller-supplied identifiers plus the system-allocated `transactionId` once the underlying stock-adjustment record is committed. |
| `transactionId` | Read-only string. Allocated by the stock-adjustment transaction-ID sequence; will be `null` if the deployment hasn't configured one for stock-adjustments. |
| `timestamp` | As submitted. |
| `owner` | As submitted, or as inferred from `entries[0].place` when omitted. |
| `stock` | As submitted, or the owner's default stock when omitted. |
| `items` | The underlying stock-adjustment items, exposed as a cross-link into the stock-adjustment read-back shape. Expand further with `~with(items)` or `~with(productInstances)`. |
| `entries` | **Not returned.** `entries` is write-only; `~with(entries)` yields `null`. The submitted targets are represented by the generated `items`. |

### Cross-Linking to Stock Adjustments

Because the submission's `identifiers` are copied onto the underlying stock-adjustment record, the same data is readable via either resource:

```http
GET /v1/stock-adjustments/com.example.id=ENT-001~with(items,productInstances)
```

Any reporting that already consumes `/v1/stock-adjustments` picks up `stock-entries`-originated records automatically — no extra integration work.

---

## Errors

Canonical error strings (operators search for these in logs):

| Trigger | HTTP | Body marker |
|---|---|---|
| `timestamp` missing or invalid | 400 | `"Timestamp is required"` |
| `entries` empty / missing | 400 | `"Entries are required"` |
| Entry without `physicalQuantity` | 400 | `"physicalQuantity is required on each entry"` |
| `owner` omitted and inference ambiguous | 400 | `"Could not determine owner for stock entry submission, please specify an owner manually or use a root place."` |
| Entries span places with different owners | 400 | `"All entries in a stock entry submission must be owned by the same owner. Expected '<owner-A>', found '<owner-B>' on entry."` |

The owner mismatch is checked atomically — one offending entry fails the entire submission. Split into one submission per owner to recover.

### Entry validation

> **Availability:** ships in the release after v26.1.11. Not in v26.1.10 or v26.1.11.

Each element of `entries` is validated as a typed `stock entry target` before the submission is processed. Earlier builds rejected the same values further into processing, with a different message.

| Trigger | HTTP | Body marker |
|---|---|---|
| `physicalQuantity` is not numeric (e.g. `"abc"`) | 400 | `"Invalid data format. A value could not be coerced to the expected target type."` |
| `entries` sent as an object instead of an array | 400 | `"Invalid data format. A value could not be coerced to the expected target type."` |
| Entry without `physicalQuantity` | 400 | `"physicalQuantity is required on each entry"` |
| `place` does not resolve to a stock-place | 400 | (no fixed marker) |

Unrecognised keys on an entry (`direction`, a typo such as `physicalQty`) are **ignored, not rejected**. There is no unknown-field error, so a misspelt `physicalQuantity` surfaces only as `"physicalQuantity is required on each entry"`.

---

## Anti-Patterns

> **Availability:** v26.1.11 and later — applies to the two `stock` bullets; the rest of this list predates that release.

- **Don't expect submissions with different `stock` values to correct each other.** The current level is read per `(place, stock)`. Driving the same `(product, place)` in the default stock and again in a display stock lands two independent levels whose sum is the place's total; neither submission "fixes" the other. Address each stock with its own submission and echo that stock's count, not the place's. See [What `physicalQuantity` is measured against](#what-physicalquantity-is-measured-against).
- **Don't omit `stock` once the owner has more than one.** An omitted `stock` silently resolves to the owner's default stock — no error, no warning. A count taken in a display or consignment stock that is posted without `stock` is applied to the default stock instead.
- **Don't use `availableQuantity` to set a different available level than physical.** The field is accepted for back-compat with the nested `stock-place.entries` shape, but it does not steer effective stock independently. Callers that genuinely need to diverge physical and available must use the legacy `PATCH /v1/stock-places/<key>` path with the nested `entries` array.
- **Don't mix places across owners in one submission.** The call fails atomically; split into one submission per owner instead.
- **Don't double-bookkeep against `/v1/stock-adjustments`.** Every `/v1/stock-entries` POST already emits a stock-adjustment record. Consuming both endpoints will count the same movement twice.
- **Don't rely on `transactionId` for client-side idempotency.** It's a system-allocated value (read-only). For caller-driven idempotency, use the caller's own namespaced keys under `identifiers.<namespace>`.
- **Don't rely on entry deduplication.** Passing two entries for the same `(product, place)` pair does not "overwrite" to the last target — both deltas are computed against the pre-submission current physical and land as separate adjustment items, so the resulting final physical level is the sum of every delta applied. Dedupe client-side before posting if you intend a single target per pair.
- **Don't try to steer the movement with `direction` or with the reason's direction.** Stock entries take an absolute target and compute the delta themselves; a per-entry `direction` is ignored and the reason's `direction` is audit metadata only. If you need to express a movement rather than a level, post to `/v1/stock-adjustments` instead — see [No direction on stock entries](#no-direction-on-stock-entries).
- **Don't read a negative `physicalQuantity` as "decrease by N".** It's a signed absolute level: `-5` drives the level to −5 from wherever it currently sits.
- **Don't expect a server-side error on a misrouted product-scoped POST.** On `/v1/products/<key>/stockEntries`, body `product` values that disagree with the URL are silently dropped — there is no 400 and no diagnostic in the response. A misrouted client is only detectable by reading the resulting record. Validate URL/body parity client-side before posting.

---

## Related

- [Stock Adjustments](working-with/stock.md#stock-adjustments) — the delta-based sibling resource that backs every `stock-entries` submission.
- [Working with Stock](working-with/stock.md) — full stock domain guide (places, adjustments, reasons, reservations, shipments).
- [Stock & Inventory Examples](../guide/examples/inventory.md) — curl recipes including the "set target stock" flow.
- [Products](working-with/products.md) — the `stockEntries` product sub-collection.
