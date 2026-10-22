# Upgrading to 26.2.3

This reference describes the CommerceOS API as of release **26.2.3**. This page is for an integrator whose client was written against an older release: what changed on the wire, and what to write instead. It is the only page in the reference that names versions.

Two parts. [Part A](#part-a-new-in-2623) is what changed between 26.2.2 and 26.2.3; a client written against 26.2.2 reads that part only. [Part B](#part-b-changes-in-2622) is what changed in 26.2.2, for a client written against an older release still.

---

## Part A: new in 26.2.3

### A1. `/v1/kv` and the `kv` scope are gone

`GET /v1/kv/...` is a `404`, and a token request naming `kv` is refused whole with `400 invalid_scope`. What an integration kept there goes in a **key-value store** — `GET`/`PUT`/`PATCH`/`DELETE /v1/context/kv/<store>/<key>` under the store's own `<store>:write` scope — and its configuration in a **config panel**, read as values at `GET /v1/context/<panel>`. An administrator creates both under `/v1/key-value-stores` and `/v1/config-panels` (scope `config`) and grants the scopes; a hosted plugin's install creates the store named by each `<name>:write` scope its client holds.

| You wrote | Write |
|-----------|-------|
| `PUT /v1/kv/com.example.state/cursor` with the `kv` scope | `PUT /v1/context/kv/com.example.state/cursor` with `com.example.state:write` |
| `GET /v1/context/<store>/<key>` | `GET /v1/context/kv/<store>/<key>` — a name directly under `/v1/context` is a config panel's |
| `GET /v1/context/config/<configId>` (payment EPI) | `GET /v1/context/<configId>` — the answer is the EPI configuration element, `configurationHash` in the default body |
| scope `me kv orders.payments:write` on a payment EPI client | `me orders.payments:write payment-records:write` plus the store's `:write` scope |

See [Working with the Configuration Store](working-with/configuration-store.md).

### A2. Sync webhooks lost `secrets` and `variables`

A write naming either is a `200` that stores nothing, and `~with(secrets,variables)` reads `null`. The values move into a config panel the webhook's client reads in clear. Where you wrote `{api/v1/context/webhook/secrets/com.example.token}` in a URL template or body selector, write `{com.example.carrier/token}` (`<panel>/<member>`); `auth.customHeader`, `auth.authorizationHeader`, `auth.basic` values, the `sign` secret and the `receive` token name a panel member the same way, without braces. A client that reaches the panel only through `admin:read` stops with a configuration error instead of sending `********`. See [Sync Webhooks → Configuration for a webhook](sync-webhooks.md#configuration-for-a-webhook-config-panels).

### A3. A client-credentials token is capped to the client's scopes

The token endpoint narrows the request to the scopes the client holds; the response's `scope` says what was granted, and a token granted `scope ""` is `401` everywhere. A client that minted scopes it did not hold loses them at its next token request: grant it what it needs. `POST /oauth2/v1/introspect` works. See [Credentials → OAuth2 clients](credentials.md#oauth2-clients).

### A4. Order actions

- `tryCancel`, `cancelRemainder`, `cancelItems` and `fulfillReturn` refund the released units' money themselves, by recording a Credit on each payment, and are refused with `400`, cancelling nothing, when that money was taken in a till, through a payment integration or from a wallet.
- New actions: `cancelRemainder` (the committed, not yet fulfilled part of every line), `cancelItems` (a cancelled-quantity target per item, idempotent and monotone), `reversePayment` (a Credit on one payment for units released without a refund).
- `createPayment` defaults `amount` to what is still owed and refuses more: `400 Amount exceeds the unpaid amount (<n>).`, `400 Nothing to pay: nothing is owed on the listed items.`. `Currency not found.` and `Order item not found.` are `400` (one was a `500`, the other another text).
- `cancelReturn` leaves the line as `ReturnCancelled`; it cannot be returned again.
- `suppliersId.id` and `customersId.id` are written on `POST` and `PATCH` (they used to be accepted and ignored).
- An order created with its own number no longer consumes one from the serial: the owner's order serial issues a number only for an order created without `suppliersId.id` / `customersId.id`.

See [Working with Orders → Order Actions](working-with/orders.md#order-actions).

### A5. Physical stock follows the trade

`tryFulfill`, a delivery's `approve` and the return actions move the units between the item's source and destination places; a buyer without a stock root or an address gets a stock root. So:

- `physicalQuantity` at the seller's place goes down on every sale, a person with no address included (it used to move only when the buyer had a place).
- A stock entry or a stocktake after a goods receipt books nothing: the received units are already on the place (it used to book them a second time). Drop any "re-enter after approval" step.
- A party with several stock roots is refused when an order or a bare delivery is created: `400 <name> has several stock roots; a trade needs exactly one.`
- A restocking return of goods sold through the API works (`500` → `200`).

See [Stock Entries](stock-entries.md#what-physicalquantity-is-measured-against) and [gotcha 57](common-gotchas.md#57-tryfulfill-moves-physicalquantity-from-the-sellers-place-to-the-buyers).

### A6. One open delivery per order row

`POST /v1/deliveries` with `order` or `orderItems`, and `POST /v1/deliveries/{key}/items` with `orderItem`, are refused while the row already sits on an unapproved delivery; the body's `details` names it (`Order row Widget is already on open delivery #GR-1.`). Two open deliveries on one row used to share the same units. See [gotcha 52](common-gotchas.md#52-a-second-open-delivery-on-an-order-row-is-refused).

### A7. Own GTINs on approval

With `autoGtin` set on a product (or inherited from its family or group), `tryApprove` and `tryFulfill` assign GTINs from the buyer's own GS1 series, and are refused with `400` when the series are short. A product without the flag is unchanged. See [Working with Products → Getting a GTIN from your own series](working-with/products.md#getting-a-gtin-from-your-own-series).

### A8. POS profiles and carts

- A value outside the vocabulary of `showProductFamiliesAs`, `scoStartScreen`, `scoReceiptMode` or `receiptOptions` is `400 Invalid value '…' for '<member>'. Expected '…' or '…'.` (it used to be a stored `200`).
- A value outside the vocabulary of a tile set's `layout` or a tile's `defaultDisplayMode`, both enums, is a `400` that names the enum: `Invalid value '…' for enum 'PosTileSetLayout'. Expected 'Grid' or 'List'.`, `… for enum 'ProductDisplayMode'. Expected 'Grid' or 'List'.`
- Every setting of a POS profile, tile set, product tile and terminal is a declared member, with a `pos:read` twin; tile placement is `layout` with `row`/`column` (see [POS Profiles](../guide/examples/pos.md#pos-profiles)). New `separateOrderCheckout`.
- A cart `visibility` outside its three values is `400` (was `500`); `resumeCart` of a cart parked for another terminal of the store is `409`; adding a line to a self-checkout that waits for the payment method is `409` (was `201`); `resumableCarts` lists parked carts only.

### A9. Identifiers

- A malformed external identifier key — not exactly three dot-separated segments — fails the whole request with `400 failed coercion` on every write, nested references included (it used to be dropped with a `200`, and every retry created another record). See [gotcha 40](common-gotchas.md#40-a-malformed-identifier-key-fails-the-whole-request).
- A bulk `POST` with a known identifier updates in place; a single-object `POST` on a concept collection is the one that answers `409`.

### A10. Projections narrow open objects

`~just` and `fields=` on a config panel's values, a key-value document or an `identifiers` node answer only what they name (they used to answer the whole document). `~just(key)` on `identifiers` leaves the external ids out unless named. See [gotcha 97](common-gotchas.md#97-just-and-fields-on-identifiers-leave-the-external-ids-out-unless-named).

### A11. Receipts

`checkoutId` is in the default body of a till receipt, and left out of the body of a receipt created before the member existed or imported with `POST /v1/receipts` (a path read or a projection answers `null`); `checkoutSiblings` (`~with`) lists the other receipts of the same checkout; `restock` (`~with`) on a return line says whether the units went back into stock. A strict consumer adds the column as optional. See [Receipts → Receipts of One Checkout](receipts.md#receipts-of-one-checkout-checkoutid-and-checkoutsiblings).

### A12. Stock count items

`settled` and `excluded` are in the default body of a stock count item, both `false` on lines approved before the members existed. A settled line reads `counted: true`. See [gotcha 95](common-gotchas.md#95-a-settled-stock-count-line-reads-counted-true).

### A13. Credentials and users

A duplicate API key value is `409 Another API key already holds this value.`; a deactivated user's keys and clients stop working and its live tokens die; `POST /oauth2/v1/introspect` works; a client created without lifetimes mints 3600 s access tokens; `preferredLocale` must be a locale tag (`sv-se`; `sv_SE` is `400`); `config` on a user is stored on create and on a first `PATCH`.

### A14. `then.set` on a sync webhook

A `then.set` write drops members whose value resolves to `undefined`, at any depth, as a JSON body does — a nested identifier the answer leaves out is kept instead of cleared. `null` still clears, and so does a top-level key written without `?` that cannot be resolved. `lastError` keeps the last failure's message after later successes, and a retrying webhook keeps its `error` between attempts.

### A15. Deliveries

`approve` stamps `actualArrivalTime` when the receiver is in the organization under the root, otherwise `actualDepartureTime` when the sender is, unless already registered.

### A16. Additive members, for strict consumers

`functionalCurrency` on agents; `attachments` on agents and `files` on product nodes (the new `file` type); `data`, `contentUrl`, `mediaType`, `width`, `height` on images; `attributes` on products and `variantValues` on families and groups; `autoGtin`; `supplierIsManufacturer` on trade relationships; `lastError`, `backoff` and `idleRuns` on sync webhooks, and `when` as an object; `separateOrderCheckout` and the other POS profile members; `posPrefix` in a POS terminal's default body; `serialPrinter` on devices; `skipPreflightCheck` on serial printers; `sellerStock`/`buyerStock` on order items; `labels` on discount rules; `description` on elements; `keys` on every collection (`/v1/products/keys`); the scope `enrollment:read` and the device read twins under `pos:read`; the collections `/v1/device-roles`, `/v1/device-permissions`, `/v1/device-role-assignments` (scope `admin`), `/v1/serial-payment-terminals`, `/v1/verifone-psdk-printers` and the scanner subtypes `/v1/hid-`, `/v1/camera-`, `/v1/zebra-` and `/v1/dummy-barcode-scanners`; five `webhook*` fields on `/v1/config/api`. A consumer that rejects unknown members updates its schema.

### A17. The pre-26.2.2 shapes are accepted, translated and marked deprecated

26.2.3 and later accept two shapes 26.2.2 refused, translated into the current model and marked `deprecated: true` in the OpenAPI document: the old surcharge rule members (`items`, `effects`, `currency.include`) and `/v1/vat-codes`. Write the new shape; the old one is for clients you cannot change yet, and what it cannot express is `400`. Part B says what to write instead.

### A18. Sync webhook scheduling

- `when` takes an object of time-of-day windows beside the URL form; a `GET` echoes it. See [Sync Webhooks → Time-of-day windows](sync-webhooks.md#time-of-day-windows).
- Idle backoff: `backoff` on the webhook, `idleRuns` read-only, and `webhookIdleBackoffEnabled` (default `false`), `webhookIdleBackoffAfter`, `webhookIdleBackoffFactor`, `webhookIdleBackoffMaxMs` on `/v1/config/api`. Off unless switched on, so nothing changes for an existing webhook. See [Sync Webhooks → Idle backoff](sync-webhooks.md#idle-backoff).
- A run that cannot reach its external target is re-run on `webhookUnreachableRetryMs` without consuming an attempt. The default changed from 5 minutes to 1 (`300000` → `60000`). See [Sync Webhooks → Task-scheduler retry](sync-webhooks.md#task-scheduler-retry-whole-run).

### A19. Devices and peripherals

- `POST /v1/barcode-scanners` without a concrete `@type`, or with the abstract `barcode scanner` itself, is `400 A barcode scanner needs a concrete @type: '…', '…'.` (it used to create a row of the abstract type that nothing could drive). See [POS Examples → Scanners](../guide/examples/pos.md#scanners-and-the-read-only-device-collections).
- `baudRate`, `dataBits` and `stopBits` of a serial printer or a serial barcode scanner created without them read `null` until set (they read `0`), on the `pos:read` twins too. A client that read `0` as "unset" sees `null`.
- `posPrefix` on a POS terminal is set once, on create, and a `PATCH` with another value is `409`. See [POS Examples → The register id](../guide/examples/pos.md#the-register-id-posprefix).
- Device roles, device permissions and device role assignments are collections under `admin`, so a till's hardware and roles can be collected through the API and restored through it. See [POS Examples → Device roles](../guide/examples/pos.md#device-roles).

### A20. Fixed

- `tryFulfill` on a ship-to-customer order answered `400` with `Thing can't already be in excess at the to account.` in `errorMessage` when the customer had been attached to a till cart after the order's creation and had later returned the product over the till; the order fulfils.
- A request that created something and then referenced it could answer `400` for its own creation when the database restarted the transaction after a commit conflict: `POST /v1/trade-orders` with `actions.createPayment` naming a line of the same body answered a `400` naming the line. The retried attempt now starts clean and answers `201`. See [Working with Orders → Action-Specific Errors](working-with/orders.md#action-specific-errors).
- A purchase is `IntraEuSupply` at 0 % when the buyer's organizational ancestors hold the registration in another EU country than the supplier: a store without a VAT number of its own inherits its company's, as the seller side already did. See [Working with VAT](working-with/vat.md#vat-registrations-and-vatid).
- A new EPI configuration's id never ends in `-`, so `GET /v1/context/<id>~just(configuration)` works on it; an id issued before may, see [gotcha 102](common-gotchas.md#102-an-epi-configuration-id-ending-in---takes-no-path-operator).

---

## Part B: changes in 26.2.2

### B1. VAT: codes become classes, areas and rules

VAT codes are not part of the model any more (26.2.3 and later still answer `/v1/vat-codes` as a deprecated view of the VAT rate defaults, see [A17](#a17-the-pre-2622-shapes-are-accepted-translated-and-marked-deprecated)). VAT is now modelled as **VAT classes** (a country-neutral classification of products), **VAT areas** (a territory with one set of rules) and **VAT rules** (how one class is treated in one area over a period), with **VAT rate defaults** and **VAT registrations** alongside. Five collections, all under `products:read` / `products:write`:

| Collection | Holds |
|------------|-------|
| `/v1/vat-classes` | Food, Books, Standard rate, … |
| `/v1/vat-areas` | Sweden, Norway, Åland, … |
| `/v1/vat-rules` | Class × area × period → treatment and rate |
| `/v1/vat-rate-defaults` | Which class a bare percentage stands for in an area |
| `/v1/vat-registrations` | An agent's VAT numbers per country |

**Products, families and groups carry `vatClass`.** Where you wrote

```json
"defaultVatCode": {"identifiers": {"percentage": "25"}}
```

write

```json
"vatClass": {"identifiers": {"com.heads.seedID": "vat-class-standard"}}
```

The reference pack's classes, by the percentage you used to write in Sweden:

| You wrote | Write | Unless the product is |
|-----------|-------|-----------------------|
| `25` | `vat-class-standard` | |
| `12` | `vat-class-food` (food and non-alcoholic drinks) | something else at 12 %: `vat-class-reduced-12`, or `vat-class-accommodation` |
| `6` | `vat-class-books` | `vat-class-newspapers`, `vat-class-passenger-transport`, `vat-class-culture-events`, or `vat-class-reduced-6` |
| `0` | `vat-class-zero-rated` | exempt: `vat-class-exempt` |

The full list of twelve is in [Working with VAT → VAT Classes](working-with/vat.md#vat-classes). `vatClass` reads the class in effect, inherited or own, and is not in the default read: `~with(vatClass)`. `vatRates` (read-only, `~with(vatRates)`) shows the treatment and rate per area.

**A tenant with no VAT area installs one before any sale**, one request, idempotent:

```http
POST /v1/vat-areas
[{"identifiers": {"com.heads.seedID": "vat-area-se"}}]
```

**Products without a class cannot be sold.** See [B5](#b5-what-a-line-is-taxed-by).

### B2. Surcharge rules reshaped

A surcharge rule now carries its products, currency and value itself. The former `items`, `itemOrder`, `where`, `effects` and `currency.include` / `currency.exclude` members, and the collections `/v1/surcharge-rule-effects`, `/v1/fixed-surcharge-rule-effects`, `/v1/percentage-surcharge-rule-effects`, `/v1/trade-rule-effects` and `/v1/price-rules`, are no longer part of the model. 26.2.3 and later still accept the old members on a write, translated and marked deprecated ([A17](#a17-the-pre-2622-shapes-are-accepted-translated-and-marked-deprecated)); write the new shape.

| You wrote | Write |
|-----------|-------|
| `items.<name>.include: [...]` | `products: [...]` (product nodes and categories; replaces on set) |
| `items.<name>.worthAtLeast` / `worthAtMost` | `worthAtLeast` / `worthAtMost` on the rule |
| `currency.include[0]` | `currency` (one reference) |
| an effect of type `fixed surcharge rule effect` with `amount` | `"kind": "Fixed"` and `amount` on the rule; `includesTax` says whether `amount` is gross (`true`) or net (`false`, the default) |
| an effect of type `percentage surcharge rule effect` with `percentage` | `"kind": "Percentage"` and `percentage` on the rule |

A 1 kr deposit on a 12 % beverage, before and after:

```json
{"effects": [{"@type": "fixed surcharge rule effect", "items": ["thing"], "amount": "0.892857"}]}

{"kind": "Fixed", "amount": "1", "includesTax": true, "currency": {"identifiers": {"currencyCode": "SEK"}}}
```

The receipt side (`surchargeAmount`, `surcharges[]`) did not change. See [Surcharge Rules](../guide/examples/surcharge-rules.md).

### B3. Discount rules: unchanged on the wire

Discount rule payloads, their `@type` values and the five effect collections are the same as before. Nothing to do.

### B4. Prices and fixed surcharges may include VAT

`price.includesTax` (boolean, default `false`, in every price read): `true` makes `amount` the gross unit price, and the net is derived at sale time from the product's rate in the VAT area of the sale. Existing prices read `includesTax: false`; the upgrade flips none. The same member exists on a fixed surcharge rule. If your integration converted shelf prices to net before sending them, you can stop: send the shelf price with `includesTax: true`. See [Working with Prices → Prices That Include VAT](working-with/prices.md#prices-that-include-vat).

### B5. What a line is taxed by

One rule per line: the nearest class up the product chain, in the VAT area of the place the sale is supplied from, at the receipt or delivery timestamp.

- A product with its own class under a differently classed group is charged **its own** rate.
- A line no rule covers reads `vatPercentage: "0"` and cannot be posted. `POST /v1/receipts` answers `400 No VAT rate applies to <product>; the line cannot be posted until a VAT rule covers it.`; `tryApprove` and `tryFulfill` answer `400` with the same text after `Could not approve order.` / `Could not fulfill order.`. On receipts this used to be a `500`.

### B6. Receipts and Z reports

- `vatGroups` are keyed by **area, treatment, percentage and exemption reason** and carry `vatArea`, `treatment` and (when present) `exemptionReason`. Two groups can share a percentage, for example a `ZeroRated` domestic line and an `Export` line. A consumer that keys by percentage alone must sum the groups.
- Receipt items carry four new read-only, non-essential stamps: `vatArea`, `vatTreatment`, `vatExemptionReason`, `supplyKind` (`~with(...)`).
- On a Z report, `vatSummation` is unchanged; `vatSummationEntries[]` gain `vatArea`, `treatment` and `exemptionReason` and can hold several entries with the same rate.

See [Working with VAT → VAT in Receipts and Z Reports](working-with/vat.md#vat-in-receipts-and-z-reports).

### B7. `agent.vatId` and VAT registrations

`vatId` on a person, company or store reads and writes the agent's **home** VAT registration (the one with no country): writing it creates the registration, changes its number, or removes it on `""` / `null`. Registrations in other countries are made in `/v1/vat-registrations`, one per holder and country. See [Working with VAT → VAT Registrations and `vatId`](working-with/vat.md#vat-registrations-and-vatid).

### B8. Jurisdiction follows the VAT area

- `POS profile.legalJurisdiction` has no effect: it reads `null`, and a write is accepted and discarded. A terminal's fiscal regime is the taxing country of its store's VAT area.
- `country.vatArea` (non-essential, `~with(vatArea)`, written under `geo:write`) binds a country to an area.
- New `409 POS terminal '<name>' has issued receipts under its jurisdiction.` on `PATCH /v1/countries/{code}` with `vatArea`, `PATCH /v1/vat-areas/{key}` with `taxingCountry` and `PATCH /v1/pos-terminals/{key}` with `associatedNode`, when a terminal that has issued receipts would end up under another taxing country.

### B9. `/v1/stores` lists the whole subtree

`GET /v1/stores` with a key on a company lists the stores of the company's whole organizational subtree, not only its direct children.

---

## Where to go next

- [Working with the Configuration Store](working-with/configuration-store.md) — `/v1/context`, config panels, key-value stores, scopes
- [Working with Orders → Order Actions](working-with/orders.md#order-actions) — the cancel actions, the refund gate, `reversePayment`

- [Working with VAT](working-with/vat.md) — the model, the five collections, the pack, the case study
- [Working with Prices](working-with/prices.md) — `includesTax`
- [Surcharge Rules](../guide/examples/surcharge-rules.md) — the current shape with every example
- [Common Gotchas → 87](common-gotchas.md#87-a-product-with-no-vat-class-cannot-be-sold) — a product with no VAT class cannot be sold
