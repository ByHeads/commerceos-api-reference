# Upgrading to 26.2.2

This reference describes the CommerceOS API as of release **26.2.2**. This page is for an integrator whose client was written against an older release: what changed on the wire, and what to write instead. It is the only page in the reference that names versions.

---

## 1. VAT: codes become classes, areas and rules

VAT codes are no longer part of the API. VAT is now modelled as **VAT classes** (a country-neutral classification of products), **VAT areas** (a territory with one set of rules) and **VAT rules** (how one class is treated in one area over a period), with **VAT rate defaults** and **VAT registrations** alongside. Five collections, all under `products:read` / `products:write`:

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

**Products without a class cannot be sold.** See [item 5](#5-what-a-line-is-taxed-by).

## 2. Surcharge rules reshaped

A surcharge rule now carries its products, currency and value itself. The former `items`, `itemOrder`, `where`, `effects` and `currency.include` / `currency.exclude` members, and the collections `/v1/surcharge-rule-effects`, `/v1/fixed-surcharge-rule-effects`, `/v1/percentage-surcharge-rule-effects`, `/v1/trade-rule-effects` and `/v1/price-rules`, are no longer part of the API.

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

## 3. Discount rules: unchanged on the wire

Discount rule payloads, their `@type` values and the five effect collections are the same as before. Nothing to do.

## 4. Prices and fixed surcharges may include VAT

`price.includesTax` (boolean, default `false`, in every price read): `true` makes `amount` the gross unit price, and the net is derived at sale time from the product's rate in the VAT area of the sale. Existing prices read `includesTax: false`; the upgrade flips none. The same member exists on a fixed surcharge rule. If your integration converted shelf prices to net before sending them, you can stop: send the shelf price with `includesTax: true`. See [Working with Prices → Prices That Include VAT](working-with/prices.md#prices-that-include-vat).

## 5. What a line is taxed by

One rule per line: the nearest class up the product chain, in the VAT area of the place the sale is supplied from, at the receipt or delivery timestamp.

- A product with its own class under a differently classed group is charged **its own** rate.
- A line no rule covers reads `vatPercentage: "0"` and cannot be posted. `POST /v1/receipts` answers `400 No VAT rate applies to <product>; the line cannot be posted until a VAT rule covers it.`; `tryApprove` and `tryFulfill` answer `400` with the same text after `Could not approve order.` / `Could not fulfill order.`. On receipts this used to be a `500`.

## 6. Receipts and Z reports

- `vatGroups` are keyed by **area, treatment, percentage and exemption reason** and carry `vatArea`, `treatment` and (when present) `exemptionReason`. Two groups can share a percentage, for example a `ZeroRated` domestic line and an `Export` line. A consumer that keys by percentage alone must sum the groups.
- Receipt items carry four new read-only, non-essential stamps: `vatArea`, `vatTreatment`, `vatExemptionReason`, `supplyKind` (`~with(...)`).
- On a Z report, `vatSummation` is unchanged; `vatSummationEntries[]` gain `vatArea`, `treatment` and `exemptionReason` and can hold several entries with the same rate.

See [Working with VAT → VAT in Receipts and Z Reports](working-with/vat.md#vat-in-receipts-and-z-reports).

## 7. `agent.vatId` and VAT registrations

`vatId` on a person, company or store reads and writes the agent's **home** VAT registration (the one with no country): writing it creates the registration, changes its number, or removes it on `""` / `null`. Registrations in other countries are made in `/v1/vat-registrations`, one per holder and country. See [Working with VAT → VAT Registrations and `vatId`](working-with/vat.md#vat-registrations-and-vatid).

## 8. Jurisdiction follows the VAT area

- `POS profile.legalJurisdiction` has no effect: it reads `null`, and a write is accepted and discarded. A terminal's fiscal regime is the taxing country of its store's VAT area.
- `country.vatArea` (non-essential, `~with(vatArea)`, written under `geo:write`) binds a country to an area.
- New `409 POS terminal '<name>' has issued receipts under its jurisdiction.` on `PATCH /v1/countries/{code}` with `vatArea`, `PATCH /v1/vat-areas/{key}` with `taxingCountry` and `PATCH /v1/pos-terminals/{key}` with `associatedNode`, when a terminal that has issued receipts would end up under another taxing country.

## 9. `/v1/stores` lists the whole subtree

`GET /v1/stores` with a key on a company lists the stores of the company's whole organizational subtree, not only its direct children.

---

## Where to go next

- [Working with VAT](working-with/vat.md) — the model, the five collections, the pack, the case study
- [Working with Prices](working-with/prices.md) — `includesTax`
- [Surcharge Rules](../guide/examples/surcharge-rules.md) — the 26.2.2 shape with every example
- [Common Gotchas → 87](common-gotchas.md#87-a-product-with-no-vat-class-cannot-be-sold) — a product with no VAT class cannot be sold
