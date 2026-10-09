# Working with VAT

This guide is the playbook for VAT (Value Added Tax) in CommerceOS: the VAT classes, areas and rules that decide what a line is taxed by, prices that include VAT, how products get their class, and how VAT is reported on receipts and Z reports.

> **Coming from an older release?** VAT used to be configured as rates on products. [Upgrading to 26.2.2](../upgrading-to-26-2-2.md) lists what changed and what to write instead.

---

## Table of Contents

1. [Overview](#overview)
2. [Glossary](#glossary)
3. [The Model in Brief](#the-model-in-brief)
4. [Field Reference](#field-reference)
5. [Net vs Gross: Core Formulas](#net-vs-gross-core-formulas)
6. [VAT Classes](#vat-classes)
7. [VAT Areas and the Reference Pack](#vat-areas-and-the-reference-pack)
8. [VAT Rules](#vat-rules)
9. [VAT Rate Defaults](#vat-rate-defaults)
10. [VAT Registrations and `vatId`](#vat-registrations-and-vatid)
11. [Assigning VAT to Products](#assigning-vat-to-products)
12. [VAT in Trade Orders](#vat-in-trade-orders)
13. [VAT in Receipts and Z Reports](#vat-in-receipts-and-z-reports)
14. [Countries, Areas and Terminals](#countries-areas-and-terminals)
15. [Endpoint Matrix](#endpoint-matrix)
16. [Error Handling and Validation](#error-handling-and-validation)
17. [Integration Playbook: VAT Setup](#integration-playbook-vat-setup)
18. [Case Study: A Swedish Store with Food, Books and Standard Goods](#case-study-a-swedish-store-with-food-books-and-standard-goods)
19. [Business Rules and Pitfalls](#business-rules-and-pitfalls)
20. [Related Guides](#related-guides)

---

## Overview

CommerceOS taxes a sale by looking up **one rule per line**: the rule for the line's **VAT class** in the **VAT area** of the place the sale is supplied from, at the time of the sale. Products carry a class; areas carry rules; the platform does the rest at order, delivery and receipt time.

**Key characteristics:**
- A VAT class is country-neutral (Food, Books, Standard rate). One list of classes serves every area.
- A VAT area is a territory with one set of rules (Sweden, Norway, Åland). Rates live in rules, with a period, so a rate change is a new rule rather than an edit.
- Products get their class through `vatClass`, set on the product or inherited from a family or group. A product with no class cannot be sold.
- Prices are net unless `includesTax` is true. A gross price keeps the shelf figure through a rate change.
- Heads ships a reference pack of classes, areas, rules and rate defaults for Sweden, Norway, Denmark, Finland and Åland. Installing an area is one request.
- Receipts stamp every line with the area, treatment and rate it was taxed at, and group totals by area, treatment and rate.

**Domain relationships:**
```
VAT classes  ─┐
              ├─ VAT rules (class × area × period → treatment, rate)
VAT areas    ─┘      │
   │                 └─ what a line is taxed by
   ├─ countries (country.vatArea)
   ├─ stores → terminals (fiscal jurisdiction)
Products (vatClass, vatRates) ─ prices (includesTax) ─ orders ─ receipts (vatGroups, item stamps) ─ Z reports
Agents (vatId) ─ VAT registrations
```

---

## Glossary

| Term | Description |
|------|-------------|
| **VAT class** | A country-neutral classification of products: Food, Books, Standard rate. Set on products, families and groups through `vatClass`. |
| **VAT area** | A territory with one set of rules: Sweden, Norway, Åland. Has a taxing country, a time zone and an EU VAT scope. |
| **VAT rule** | How one class is treated in one area over a period: a treatment, a percentage or an exemption reason, `from` and `to`. |
| **VAT rate default** | Which class a bare percentage stands for in an area (25 → Standard rate in Sweden). Used when the platform is given only a percentage, as in migrated or imported data. |
| **VAT registration** | An agent's VAT number. The home registration is what `vatId` reads and writes; further registrations each name a country. |
| **Treatment** | How a line is taxed: `Standard`, `ZeroRated`, `Exempt`, `OutsideScope`, and on sales across a border `ReverseCharge`, `IntraEuSupply`, `Export`. |
| **Reference pack** | The classes, areas, rules and rate defaults Heads ships for SE, NO, DK, FI and AX. Addressed by `com.heads.seedID`. |
| **Net amount** | Amount excluding VAT. |
| **Gross amount** | Amount including VAT. |
| **`includesTax`** | On a price or a fixed surcharge rule: `true` means `amount` is gross. Default `false`. |
| **VAT group** | A receipt's totals for one area, treatment, percentage and exemption reason. |

---

## The Model in Brief

- A **VAT class** is a country-neutral classification of products. One list serves every area. A class has `supplyKind` `Goods` (the default) or `Services`; cross-border VAT treats the two differently.
- A **VAT area** is a territory with one set of rules. It has a `taxingCountry`, an IANA `timeZone` (the midnight a rate change takes effect at) and `euVatScope`, the supply kinds under EU VAT in the area: `["Goods","Services"]` for a member state, `["Services"]` for Åland, empty outside the EU. Empty means the taxing country's EU membership decides.
- A **VAT rule** says how one class is treated in one area over a period: `treatment` `Standard` (with a positive `percentage`), `ZeroRated` (taxable at 0 %), `Exempt` or `OutsideScope` (no VAT; `exemptionReason` carries a VATEX code such as `VATEX-EU-G`), with `from` and `to` instants, open when omitted. At most one rule covers a class in an area at any instant. **A rate change is a new rule**: close the current one with `to`, create the next with `from` on the same instant. A rule's other fields are fixed once created.
- A **VAT rate default** says which class a bare percentage stands for in an area. One per area and percentage.
- A **VAT registration** is an agent's VAT number. The home registration (no country) is what `vatId` reads and writes; further registrations each name the country they apply in.
- **Products** get a class through `vatClass` on a product, family or group. A product without a class, own or inherited, cannot be sold. `vatRates` on a product shows the treatment and rate it carries in each area right now.
- **How a sale is taxed.** The rule for the line's class in the area of the place the sale is supplied from (the store's stock root, its address, its country, the country's `vatArea`; a tenant with a single area falls back to it), at the receipt's or delivery's timestamp. Goods shipped to another area or country are `Export` or `IntraEuSupply` at 0 % with a VATEX reason, decided by the areas' `euVatScope` (a destination country with no area by its EU membership). The treatment the line ended up with is stamped on the receipt item and VAT group.
- **The reference pack.** Heads ships classes, areas, rules and rate defaults for SE, NO, DK, FI and AX. A tenant installs an area from it with one request; the platform re-applies the pack at every start, so pack rows that are still as shipped cannot be deleted.

Treatments a client can **read** on receipts and reports: `Standard`, `ZeroRated`, `Exempt`, `ReverseCharge`, `IntraEuSupply`, `Export`, `OutsideScope`. Treatments a client can **write** on a rule: `Standard`, `ZeroRated`, `Exempt` and `OutsideScope` only; any other value is `400 Invalid data format`.

---

## Field Reference

All five VAT collections are under `products:read` / `products:write`, with read-only twins for `products:read`. They are indexed by database key or any common identifier (`/v1/vat-classes/com.heads.seedID=vat-class-food`, `/v1/vat-areas/{key}`). POST an array to create, PUT to upsert by identifier, PATCH to change, DELETE to remove.

### VAT Class (`/v1/vat-classes`)

| Field | Type | Essential | Description |
|-------|------|-----------|-------------|
| `identifiers` | object | yes | Common identifiers; pack classes carry `com.heads.seedID` |
| `name` | string | yes | Display name |
| `supplyKind` | `"Goods"` or `"Services"` | no, `~with(supplyKind)` | Absent or `null` means goods |

### VAT Area (`/v1/vat-areas`)

| Field | Type | Essential | Description |
|-------|------|-----------|-------------|
| `identifiers` | object | yes | Pack areas carry `com.heads.seedID` |
| `name` | string | yes | Display name |
| `taxingCountry` | country reference | yes | The country whose VAT the area charges |
| `timeZone` | string (IANA) | no, `~with(timeZone)` | The local midnight a rate change takes effect at |
| `euVatScope` | array of `"Goods"` / `"Services"` | no, `~with(euVatScope)` | Supply kinds under EU VAT in the area; reads `null` when empty |

### VAT Rule (`/v1/vat-rules`)

| Field | Type | Essential | Description |
|-------|------|-----------|-------------|
| `identifiers` | object | yes | |
| `vatArea` | VAT area reference | yes, required on create | Rendered expanded with its essentials |
| `vatClass` | VAT class reference | yes, required on create | Rendered expanded with its essentials |
| `treatment` | `Standard`, `ZeroRated`, `Exempt`, `OutsideScope` | yes | |
| `percentage` | decimal string | yes | Required and positive for `Standard`; absent otherwise |
| `exemptionReason` | string | yes | A VATEX code for `Exempt` and `OutsideScope`; not allowed on `Standard` |
| `from`, `to` | date-time or `null` | yes | Period; `null` means open in that direction |

`vatArea`, `vatClass`, `treatment`, `percentage`, `exemptionReason` and `from` are fixed at creation. `to` can only be moved earlier, and not into the past. See [Changing a rate](#changing-a-rate).

### VAT Rate Default (`/v1/vat-rate-defaults`)

| Field | Type | Essential | Description |
|-------|------|-----------|-------------|
| `identifiers` | object | yes | |
| `vatArea` | VAT area reference | yes, required | |
| `percentage` | decimal string | yes, required | One default per area and percentage |
| `vatClass` | VAT class reference | yes, required | The class a bare percentage stands for |

### VAT Registration (`/v1/vat-registrations`)

| Field | Type | Essential | Description |
|-------|------|-----------|-------------|
| `identifiers` | object | yes | |
| `holder` | string | yes | The agent: its database key, or `<namespace>=<identifier>` such as `com.example.companyId=ACME`. Read back as the key |
| `country` | country reference | yes | The country the registration applies in. Omitted on the home registration |
| `number` | string | yes | The VAT number |

### Product Members

| Field | Type | Essential | Description |
|-------|------|-----------|-------------|
| `vatClass` | VAT class reference or `null` | no, `~with(vatClass)` | On products, families and groups. Read: the class in effect, the node's own or the nearest ancestor's. Write: the node's own class; `null` clears it |
| `vatRates` | array, read-only | no, `~with(vatRates)` | One `{vatArea, treatment, percentage, exemptionReason?}` per VAT area whose rules cover the product's class right now |

### Receipt Members

| Field | On | Essential | Description |
|-------|----|-----------|-------------|
| `vatArea` | receipt item | no, `~with(vatArea)` | Name of the area the line was taxed in |
| `vatTreatment` | receipt item | no, `~with(vatTreatment)` | `Standard`, `ZeroRated`, `Exempt`, `ReverseCharge`, `IntraEuSupply`, `Export` or `OutsideScope` |
| `vatExemptionReason` | receipt item | no, `~with(vatExemptionReason)` | The VATEX code when the treatment carries one, else `null` |
| `supplyKind` | receipt item | no, `~with(supplyKind)` | `Goods` or `Services` |
| `vatGroups[]` | receipt | no, `~with(vatGroups)` | `percentage`, `vatArea`, `treatment`, `exemptionReason` (omitted when empty), `quantity`, `netAmount`, `grossAmount`, `vatAmount` |

`vatPercentage`, `vatAmount`, `unitAmountExclVat`, `unitAmountInclVat` and `unitAmountAfterDiscountInclVat` on a receipt item are described in [Receipts](../receipts.md#item-unit-amounts-vat-explicit).

---

## Net vs Gross: Core Formulas

### Prices That Include VAT

You do not have to convert a shelf price to net before you send it. A price is net unless `includesTax` is `true`:

```http
POST /v1/prices
[{"identifiers": {"com.example.priceId": "LOAF-SHELF"},
  "products": [{"identifiers": {"com.example.sku": "LOAF-001"}}],
  "amount": "53", "includesTax": true,
  "currency": {"identifiers": {"currencyCode": "SEK"}}}]
```

With `includesTax: true`, `amount` is the **gross** unit price, the figure on the shelf. The till and the order engine derive the net at sale time from the product's rate in the VAT area of the sale, so:

- the consumer price is what you typed, not a rounded `0.892857`;
- a rate change leaves the consumer price alone and moves the net. The Swedish food rate in the reference pack is 12 % until 2026-03-31, 6 % from 2026-04-01 and 12 % again from 2028-01-01: a 112 kr loaf priced with `includesTax: true` stays 112 kr on the shelf through both changes, while a 100 kr net loaf goes 112 → 106 → 112.

The same flag exists on a fixed [surcharge rule](../../guide/examples/surcharge-rules.md): a 1 kr deposit is `{"kind": "Fixed", "amount": "1", "includesTax": true}`. Existing prices read `includesTax: false`.

Worked numbers, as the order line reads them (`~with(unitAmountExclVat,unitAmountInclVat,vatPercentage)`):

| Set-up | Reads |
|---|---|
| Price `125`, `includesTax: true`, product at 25 % | `unitAmountExclVat` `100`, `unitAmountInclVat` `125` |
| Price `100` (net), product at 25 % | `unitAmountExclVat` `100`, `unitAmountInclVat` `125` |
| Price `112` incl, product at 12 %; the rate becomes 25 % | line total incl. VAT stays `112`; the net goes `100` → `89.6` |
| Price `100` net, same rate change | the net stays `100`; total incl. VAT goes `112` → `125` |
| Two prices on one product, `100` incl (80 net at 25 %) and `90` net | the line is priced at `80` net, `100` incl: prices compete on their net, the lowest wins |
| Price `100` incl on a product at 0 % | charged as `100` (nothing to remove) |
| Package price `250` incl on a 10-unit carton, one line at 25 % and one at 0 % | each line is stripped by its own rate |
| Fixed surcharge `2.5`, `includesTax: true`, on a 100 net product at 25 % | surcharge `2` excl., line total `127.5` |
| POS cart line `unitAmountInclVat: "50"` (manual price, gross) at 25 % | net `40`, total `50` |
| Order item `unitAmountExclVat: "50"` (manual price, net) at 25 % | `unitAmountExclVat` `50`, `unitAmountInclVat` `62.5` |

The first two rows and the last one were read from an order on a Swedish store. See [Working with Prices → Prices That Include VAT](prices.md#prices-that-include-vat) for the price side, and [Surcharge Rules](../../guide/examples/surcharge-rules.md) for deposits entered as the customer sees them.

### Formulas

If you want to check the numbers yourself:

```
VAT Amount   = Net × (rate / 100)
Gross        = Net + VAT Amount
Net          = Gross / (1 + rate / 100)
VAT Amount   = Gross − Net
```

### Worked Examples

**25 % (standard rate):**
```
Net:     800.00 SEK
VAT:     200.00 SEK (800.00 × 0.25)
Gross:  1000.00 SEK
```

**6 % (food, books):**
```
Net:      50.00 SEK
VAT:       3.00 SEK (50.00 × 0.06)
Gross:    53.00 SEK
```

**0 % (zero-rated, export):**
```
Net:     500.00 SEK
VAT:       0.00 SEK
Gross:   500.00 SEK
```

### Multi-Item Totals

| Item | Net | Rate | VAT | Gross |
|------|-----|------|-----|-------|
| Headphones | 800.00 | 25 % | 200.00 | 1000.00 |
| Novel | 150.00 | 6 % | 9.00 | 159.00 |
| Loaf × 2 | 100.00 | 6 % | 6.00 | 106.00 |
| **Total** | **1050.00** | — | **215.00** | **1265.00** |

VAT is summed per area, treatment and rate, then totalled; see [VAT in Receipts and Z Reports](#vat-in-receipts-and-z-reports).

---

## VAT Classes

### The Twelve Pack Classes

The reference pack ships twelve classes, addressed by `com.heads.seedID`. Names are in Swedish.

| Seed ID | Name | `supplyKind` |
|---------|------|--------------|
| `vat-class-standard` | Normalskattesats | Goods |
| `vat-class-food` | Livsmedel och alkoholfria drycker | Goods |
| `vat-class-books` | Böcker | Goods |
| `vat-class-newspapers` | Tidningar och tidskrifter | Goods |
| `vat-class-passenger-transport` | Persontransport | Services |
| `vat-class-accommodation` | Logi | Services |
| `vat-class-culture-events` | Kultur, idrott och evenemang | Services |
| `vat-class-medicine` | Läkemedel | Goods |
| `vat-class-zero-rated` | Nollskattesats | Goods |
| `vat-class-exempt` | Undantagen från moms | Goods |
| `vat-class-reduced-12` | Reducerad skattesats 12 % | Goods |
| `vat-class-reduced-6` | Reducerad skattesats 6 % | Goods |

The last two have rules in Sweden only; they are what a bare 12 and 6 stand for there (see [VAT Rate Defaults](#vat-rate-defaults)).

### Listing and Reading

```bash
# Every class, with the supply kind
GET /v1/vat-classes~with(supplyKind)

# One class by seed ID
GET /v1/vat-classes/com.heads.seedID=vat-class-food
```

```json
[{"@type":"VAT class","identifiers":{"@type":"common identifiers","key":"62e6c5b4156e4f1b684d0da7a6382269","com.heads.seedID":"vat-class-standard"},"name":"Normalskattesats","supplyKind":null},
 {"@type":"VAT class","identifiers":{"@type":"common identifiers","key":"93abae96630e756503938e82017a4e76","com.heads.seedID":"vat-class-food"},"name":"Livsmedel och alkoholfria drycker","supplyKind":null},
 {"@type":"VAT class","identifiers":{"@type":"common identifiers","key":"dd589674daf2e0f58b3406f6f717fa14","com.heads.seedID":"vat-class-passenger-transport"},"name":"Persontransport","supplyKind":"Services"}]
```

`supplyKind` reads `null` unless it is `Services`.

### Creating Your Own Class

```http
POST /v1/vat-classes
[{"identifiers": {"com.example.id": "haircuts"}, "name": "Haircuts", "supplyKind": "Services"}]
```

A class of your own has no rate until you give it a [rule](#vat-rules) in each area you sell in.

### Refusals

| Request | Response |
|---------|----------|
| `supplyKind` other than `Goods` or `Services` | `400 A supply kind is 'Goods' or 'Services', not 'Pets'.` |
| `DELETE` of a class that has rules | `400 A VAT class that has rules cannot be deleted.` |

---

## VAT Areas and the Reference Pack

### Installing a Pack Area: One Request

```http
POST /v1/vat-areas
[{"identifiers": {"com.heads.seedID": "vat-area-se"}}]
```

This creates the area "Sverige" (`SE`, `Europe/Stockholm`, `["Goods","Services"]`) together with the twelve classes, the 14 Swedish rules and the 4 Swedish rate defaults (25, 12, 6, 0). The request is idempotent: a replay answers `200` with the area and changes nothing.

| Seed ID | Area | Rules | Rate defaults |
|---------|------|-------|---------------|
| `vat-area-se` | Sverige | 14 | 25, 12, 6, 0 |
| `vat-area-no` | Norge | 10 | 25, 15, 12, 0 |
| `vat-area-dk` | Danmark | 10 | 25, 0 |
| `vat-area-fi` | Finland | the Finnish rates | 25.5, 14, 13.5, 10, 0 |
| `vat-area-ax` | Åland | the Finnish rates | 25.5, 14, 13.5, 10, 0 |

A conflict between the pack's rules and rules the tenant already has is a `400`, and nothing is applied. The platform re-applies the pack at every start, so pack rows that are still as shipped cannot be deleted (see the refusals under [VAT Rules](#vat-rules) and [VAT Rate Defaults](#vat-rate-defaults)).

### Creating Your Own Area

Any identifier other than a pack seed ID creates an empty area:

```http
POST /v1/vat-areas
[{"identifiers": {"com.example.id": "own"}, "name": "Own area",
  "taxingCountry": {"identifiers": {"countryCode": "SE"}},
  "timeZone": "Europe/Stockholm", "euVatScope": ["Goods", "Services"]}]
```

Writing `taxingCountry` also binds the country to the area for the places in it (see [Countries, Areas and Terminals](#countries-areas-and-terminals)).

### Reading

```bash
GET /v1/vat-areas~with(timeZone,euVatScope)
```

```json
{"@type":"VAT area","identifiers":{"@type":"common identifiers","key":"814b3c04f2d7548f146a24af9cc072c0","com.heads.seedID":"vat-area-se"},"name":"Sverige","taxingCountry":{"@type":"country","identifiers":{"@type":"country identifiers","key":"90eac72adf3cde16f9374812939519ab","countryCode":"SE"},"name":"Sweden"},"timeZone":"Europe/Stockholm","euVatScope":["Goods","Services"]}
```

### Refusals

| Request | Response |
|---------|----------|
| Unknown `timeZone` | `400 Unknown IANA time zone: 'Europe/Atlantis'.` |
| `euVatScope` value other than `Goods` or `Services` | `400 A supply kind is 'Goods' or 'Services', not 'Cars'.` |
| `DELETE` of an area that has rules | `400 A VAT area that has rules cannot be deleted.` |
| `taxingCountry` change that would move a terminal with receipts to another jurisdiction | `409 POS terminal '<name>' has issued receipts under its jurisdiction.` |

---

## VAT Rules

### Reading Rules

```bash
# A class's rules across areas
GET /v1/vat-rules~where(vatClass/identifiers/com.heads.seedID=vat-class-food)

# One area's rules
GET /v1/vat-rules~where(vatArea/identifiers/com.heads.seedID=vat-area-se)

# The compact view
GET /v1/vat-rules~where(vatClass/identifiers/com.heads.seedID=vat-class-food)~just(identifiers,treatment,percentage,from,to)
```

A full rule, the Swedish food rate in force today:

```json
{"@type":"VAT rule","identifiers":{"@type":"common identifiers","key":"df3bc66f25b8e3dbb0f60c00d1dc43d3","com.heads.seedID":"vat-rule-se-food-2"},"vatArea":{"@type":"VAT area","identifiers":{"@type":"common identifiers","key":"814b3c04f2d7548f146a24af9cc072c0","com.heads.seedID":"vat-area-se"},"name":"Sverige","taxingCountry":{"@type":"country","identifiers":{"@type":"country identifiers","key":"90eac72adf3cde16f9374812939519ab","countryCode":"SE"},"name":"Sweden"}},"vatClass":{"@type":"VAT class","identifiers":{"@type":"common identifiers","key":"93abae96630e756503938e82017a4e76","com.heads.seedID":"vat-class-food"},"name":"Livsmedel och alkoholfria drycker"},"treatment":"Standard","percentage":"6","from":"2026-03-31T22:00:00.000Z","to":"2027-12-31T23:00:00.000Z"}
```

The instants are the area's local midnights rendered in UTC. The three Swedish food rules in a row show how a rate change is modelled:

| Rule | `percentage` | `from` | `to` |
|------|-------------|--------|------|
| `vat-rule-se-food-1` | 12 | `null` | `2026-03-31T22:00:00.000Z` |
| `vat-rule-se-food-2` | 6 | `2026-03-31T22:00:00.000Z` | `2027-12-31T23:00:00.000Z` |
| `vat-rule-se-food-3` | 12 | `2027-12-31T23:00:00.000Z` | `null` |

### Creating a Rule

```http
POST /v1/vat-rules
[{"identifiers": {"com.example.id": "haircuts-se"},
  "vatArea": {"identifiers": {"com.heads.seedID": "vat-area-se"}},
  "vatClass": {"identifiers": {"com.example.id": "haircuts"}},
  "treatment": "Standard", "percentage": "25"}]
```

Omit `from` and `to` for a rule that is open at both ends. An `Exempt` or `OutsideScope` rule carries an `exemptionReason` (a VATEX code) instead of a percentage.

### Changing a Rate

A rule's area, class, treatment, percentage, exemption reason and start are fixed at creation. To change a rate, close the current rule and create the next one on the same instant. "Sweden's standard rate becomes 24 % on 2027-01-01":

```http
PATCH /v1/vat-rules/com.heads.seedID=vat-rule-se-standard
{"to": "2026-12-31T23:00:00Z"}

POST /v1/vat-rules
[{"identifiers": {"com.example.id": "se-standard-2027"},
  "vatArea": {"identifiers": {"com.heads.seedID": "vat-area-se"}},
  "vatClass": {"identifiers": {"com.heads.seedID": "vat-class-standard"}},
  "treatment": "Standard", "percentage": "24", "from": "2026-12-31T23:00:00Z"}]
```

Shortening `to` is the one change allowed on a pack rule. When a rate change is enacted, the pack's own successor rows arrive with a later platform release; if they overlap a rule you created yourself the pack is not applied, so a tenant that pre-empts a change should expect to reconcile its own rule against the pack's at that point.

What a `PATCH` or `DELETE` on a rule does:

| Request | Result |
|---------|--------|
| `vatArea`, `vatClass`, `treatment`, `percentage`, `exemptionReason` or `from` to another value | `400 A VAT rule's <field> is fixed at creation; close the rule and create the next.` |
| The same value again | `200`, nothing changes |
| `to` earlier than the stored end, not before now, after `from` | `200` (the way to end a rule) |
| `to` before now | `400 A VAT rule cannot be closed in the past.` |
| `to` later than the stored end | `400 A VAT rule can only be shortened.` |
| `to: null` on a closed rule | `400 A VAT rule's end can only be moved earlier.` |
| `DELETE` of a rule that has started | `400 A VAT rule that has started cannot be removed; close it instead.` |
| `DELETE` of a rule that has not started | `200` |
| `DELETE` of a pack rule still as shipped | `400 The VAT reference pack ships this rule and restores it at the next start.` |

### Refusals on Create

All `400`:

| Request | `details` |
|---------|-----------|
| No `treatment` | `A VAT rule needs a treatment.` |
| `Standard` without `percentage` | `A Standard VAT rule needs a percentage.` |
| `Exempt` with a `percentage` | `A Exempt VAT rule has no percentage.` |
| `Standard` with an `exemptionReason` | `A Standard VAT rule has no exemption reason.` |
| A treatment outside the four | `Invalid data format` (a `failed coercion` body naming the four values) |
| A period another rule of the same class and area covers | `A VAT rule for Haircuts in Sverige already covers part of the period.` |

---

## VAT Rate Defaults

A rate default says which class a bare percentage stands for in an area. The platform uses it when it is given only a percentage, as in migrated or imported data. One per area and percentage.

```bash
GET /v1/vat-rate-defaults~where(vatArea/identifiers/com.heads.seedID=vat-area-se)
```

The Swedish pack defaults:

| Seed ID | `percentage` | `vatClass` |
|---------|--------------|------------|
| `vat-default-se-25` | 25 | `vat-class-standard` |
| `vat-default-se-12` | 12 | `vat-class-reduced-12` |
| `vat-default-se-6` | 6 | `vat-class-reduced-6` |
| `vat-default-se-0` | 0 | `vat-class-zero-rated` |

Note that a bare 12 maps to `vat-class-reduced-12`, not to food: a percentage does not say what the product is. Assign `vat-class-food` yourself when the product is food.

```http
POST /v1/vat-rate-defaults
[{"identifiers": {"com.example.id": "se-9"},
  "vatArea": {"identifiers": {"com.heads.seedID": "vat-area-se"}},
  "percentage": "9",
  "vatClass": {"identifiers": {"com.example.id": "haircuts"}}}]
```

| Request | Response |
|---------|----------|
| Missing area, percentage or class | `400 A VAT rate default needs an area, a percentage and a class.` |
| A second default for the same area and percentage | `400 Sverige already has a default class for 12%.` |
| `PATCH` moving a default to a free area and percentage | `200` |
| `vatClass` of a pack default changed to another class | `200` |
| `DELETE` or `vatClass: null` on a pack default | `400 The VAT reference pack ships a rate default for 12% in Sverige and restores it at the next start; change its vatClass instead.` |
| `DELETE` of a tenant's own default | `200` |

---

## VAT Registrations and `vatId`

`vatId` on an agent (person, company, store) reads the number of the agent's **home** VAT registration, the one with no country, and writes it: creating the registration, changing its number, or removing it on `""` or `null`.

```http
PATCH /v1/companies/com.example.companyId=ACME
{"vatId": "SE556677889901"}
```

The registration it creates appears in `/v1/vat-registrations`, with `holder` the company's database key:

```bash
GET /v1/vat-registrations~where(holder=c5369403ceeeaec1c481f9658d156159)
```
```json
[{"@type":"VAT registration","identifiers":{"@type":"common identifiers","key":"f10788a98eeb9fb117e7e088d62828ed"},"holder":"c5369403ceeeaec1c481f9658d156159","number":"SE556677889901"}]
```

`~where(holder=...)` takes the key; `holder=com.example.companyId=ACME` matches nothing on a read. On a write, `holder` accepts either form.

Registrations in other countries are created here, one per holder and country:

```http
POST /v1/vat-registrations
[{"identifiers": {"com.example.id": "acme-no"},
  "holder": "com.example.companyId=ACME",
  "country": {"identifiers": {"countryCode": "NO"}},
  "number": "NO999999999MVA"}]
```

A sale is identified by the registration for the taxing country of the sale's area, held by the seller or its nearest organizational ancestor, with the home registration as the fallback.

| Request | Response |
|---------|----------|
| A `holder` no agent has | `400 No agent has com.example.companyId 'X'.` |
| A second registration for the same holder and country | `400 The holder already has a VAT registration in NO.` |
| A second home registration through this collection | `400 The holder already has a home VAT registration; its vatId changes the number.` |

The collection is under `products:read` / `products:write`, like the other four.

---

## Assigning VAT to Products

### `vatClass`: The Member to Write

On every product, family and group. **Read:** the class in effect, the node's own or the nearest ancestor's. **Write:** the node's own class; `null` clears it, and the node inherits again. `vatClass` is **not in the default read** of a product, family or group; ask with `~with(vatClass)`.

```http
# A group's class, inherited by everything under it
PATCH /v1/product-groups/com.example.groupId=FOOD
{"vatClass": {"identifiers": {"com.heads.seedID": "vat-class-food"}}}

# A product with a class of its own, overriding the group's
POST /v1/products
[{"identifiers": {"com.example.sku": "GIFTBOX-001"}, "name": "Premium Gift Box", "status": "Active",
  "parentGroup": {"identifiers": {"com.example.groupId": "FOOD"}},
  "vatClass": {"identifiers": {"com.heads.seedID": "vat-class-standard"}}}]

# Back to the group's class
PATCH /v1/products/com.example.sku=GIFTBOX-001
{"vatClass": null}
```

A product's own class beats its group's: one rule per line, the nearest class up the chain. Read from a product under the food group with a standard-rate class of its own:

```bash
GET /v1/products/com.example.sku=GIFTBOX-001~with(vatClass,vatRates)~just(identifiers,vatClass,vatRates)
```
```json
{"@type":"product","identifiers":{"@type":"common identifiers","key":"68fbfdd0f82d4faf2f34ce44b0d55050","com.example.sku":"GIFTBOX-001"},"vatClass":{"@type":"VAT class","identifiers":{"@type":"common identifiers","key":"62e6c5b4156e4f1b684d0da7a6382269","com.heads.seedID":"vat-class-standard"},"name":"Normalskattesats"},"vatRates":[{"@type":"product VAT rate","vatArea":{"@type":"VAT area","identifiers":{"@type":"common identifiers","key":"814b3c04f2d7548f146a24af9cc072c0","com.heads.seedID":"vat-area-se"},"name":"Sverige","taxingCountry":{"@type":"country","identifiers":{"@type":"country identifiers","key":"90eac72adf3cde16f9374812939519ab","countryCode":"SE"},"name":"Sweden"}},"treatment":"Standard","percentage":"25"}]}
```

After `{"vatClass": null}` the same read shows the group's `vat-class-food` and `"percentage":"6"` for Sverige.

### `vatRates`: Read-Only, Per Area

`vatRates` lists one `{vatArea, treatment, percentage, exemptionReason?}` per VAT area whose rules cover the product's class right now; areas with no covering rule are left out. Not in the default read: `~with(vatRates)`. It is read-only.

**Recipe: show a consumer price.** Read `price.amount` and `price.includesTax` and the product's `vatRates` entry for the store's area. The gross is `amount` when `includesTax` is `true`, else `amount × (1 + percentage / 100)`.

### A Product with No Class Cannot Be Sold

A product with no class, own or inherited, reads `"vatClass": null` and `"vatRates": []`. An order line on it reads `vatPercentage: "0"` and the order cannot be approved, fulfilled or posted:

```http
PATCH /v1/trade-orders/com.example.orderId=O-1/actions
{"tryApprove": true}
→ 400 Could not approve order. No VAT rate applies to Docs unclassed; the line cannot be posted until a VAT rule covers it.

POST /v1/receipts
[{... "items": [{"product": {"identifiers": {"com.example.sku": "NOCLASS-1"}}, "quantity": "1", "unitAmount": "100"}] ...}]
→ 400 No VAT rate applies to Docs unclassed; the line cannot be posted until a VAT rule covers it.
```

`tryFulfill` answers the same text after `Could not fulfill order.`. The fix is a `vatClass` on the product or on one of its groups.

---

## VAT in Trade Orders

Order items carry the VAT the product's class resolves to in the seller's area at the time of the order:

```http
POST /v1/trade-orders
[{"identifiers": {"com.example.orderId": "ORD-001"},
  "supplier": {"identifiers": {"com.example.companyId": "OUR-COMPANY"}},
  "customer": {"identifiers": {"com.example.customerId": "CUST-001"}},
  "sellers": [{"identifiers": {"com.example.storeId": "STORE-001"}}],
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "items": [
    {"product": {"identifiers": {"com.example.sku": "LOAF-001"}}, "quantity": 2},
    {"product": {"identifiers": {"com.example.sku": "NOVEL-001"}}, "quantity": 1},
    {"product": {"identifiers": {"com.example.sku": "HEADPHONES-001"}}, "quantity": 1}
  ]}]
```

```bash
GET /v1/trade-orders/com.example.orderId=ORD-001/items~with(unitAmountExclVat,unitAmountInclVat,vatPercentage)~just(product,quantity,unitAmountExclVat,unitAmountInclVat,vatPercentage,totalAmount)
```

Read on a Swedish store, with the loaf priced `53` gross, the novel `150` net and the headphones `1000` gross:

| Line | `quantity` | `unitAmountExclVat` | `unitAmountInclVat` | `vatPercentage` | `totalAmount` |
|------|-----------|---------------------|---------------------|-----------------|---------------|
| Sourdough loaf | 2 | 50 | 53 | 6 | 106 |
| Paperback novel | 1 | 150 | 159 | 6 | 159 |
| Headphones | 1 | 800 | 1000 | 25 | 1000 |

### Item VAT Fields

| Field | Description |
|-------|-------------|
| `unitAmountExclVat` | Net unit price. Writable: a manual net price for the line |
| `unitAmountInclVat` | Gross unit price, read-only |
| `vatPercentage` | The rate the line resolved to; `"0"` on a line no rule covers |
| `totalAmount` | Line total including VAT |

A posted receipt is taxed at its `timestamp` with the rule in force then. Goods delivered to a buyer in another VAT area or country are taxed as `Export` or `IntraEuSupply` at 0 %, visible as `vatPercentage: "0"` on the line and as the treatment stamped on the receipt item.

---

## VAT in Receipts and Z Reports

### Receipt Item Stamps

Every receipt line records what it was taxed by. The four stamps are non-essential:

```bash
GET /v1/receipts/receiptID=DOC00000000003/items~with(vatArea,vatTreatment,vatExemptionReason,supplyKind)
```

```json
{"@type":"receipt item","description":"Sourdough loaf","quantity":"2","unitAmount":"50","vatPercentage":"6","vatAmount":"6","totalAmount":"106","vatArea":"Sverige","vatTreatment":"Standard","vatExemptionReason":null,"supplyKind":"Goods"}
```

| Member | Meaning |
|--------|---------|
| `vatArea` | The name of the area the line was taxed in |
| `vatTreatment` | `Standard`, `ZeroRated`, `Exempt`, `ReverseCharge`, `IntraEuSupply`, `Export` or `OutsideScope` |
| `vatExemptionReason` | The VATEX code when the treatment carries one, else `null` |
| `supplyKind` | `Goods` or `Services` |

The unit prices both ways (`unitAmountExclVat`, `unitAmountInclVat`, `unitAmountAfterDiscountInclVat`) are described in [Receipts → Item Unit Amounts](../receipts.md#item-unit-amounts-vat-explicit).

### VAT Groups

A VAT group is keyed by **area, treatment, percentage and exemption reason**; `exemptionReason` is omitted when empty. Two groups can share `percentage: "0"`, for example a `ZeroRated` domestic line and an `Export` line. A consumer that keys by percentage alone must sum the groups; a consumer that reports by treatment finally can.

```bash
GET /v1/receipts/receiptID=DOC00000000003~with(vatGroups)~just(identifiers,vatGroups,totalAmount,totalTaxAmount)
```

```json
{"@type":"receipt","identifiers":{"@type":"receipt identifiers","key":"7fa8f0b9561038ab96909ec24cd90ae4","receiptID":"DOC00000000003"},"vatGroups":[{"@type":"VAT group","percentage":"6","vatArea":"Sverige","treatment":"Standard","quantity":"3","netAmount":"250","grossAmount":"265","vatAmount":"15"},{"@type":"VAT group","percentage":"25","vatArea":"Sverige","treatment":"Standard","quantity":"1","netAmount":"800","grossAmount":"1000","vatAmount":"200"}],"totalAmount":"1265","totalTaxAmount":"215"}
```

### Querying Receipts with VAT

```bash
# One receipt with its groups
GET /v1/receipts/receiptID=DOC00000000003~with(vatGroups)

# Groups and item stamps, newest first
GET /v1/receipts~orderBy(timestamp:desc)~with(vatGroups,items~with(vatArea,vatTreatment,vatExemptionReason))~take(100)

# NDJSON for a BI load
GET /v1/receipts~orderBy(timestamp:desc)~with(vatGroups)
Accept: application/x-ndjson
```

### Z Reports

On a Z report (`/v1/z-reports`), `vatSummation` is a map by rate and sums everything with the same rate. `vatSummationEntries[]` carry `vatArea`, `treatment` and `exemptionReason` next to the rate (`vatCode`, a decimal: the entry's percentage) and the amounts, and can hold several entries with the same rate when the treatments differ. Use the entries for a report by area or treatment; use the map for a report by rate alone.

---

## Countries, Areas and Terminals

- **`country.vatArea`** is the area the country's places are taxed in. Not in the default read: `GET /v1/countries/countryCode=SE~with(vatArea)` reads `"vatArea": {... "com.heads.seedID": "vat-area-se", "name": "Sverige" ...}`. Written under `geo:write`. Installing a pack area or writing `taxingCountry` on an area binds the country.
- **A terminal's fiscal jurisdiction** is the taxing country of its store's VAT area. `POS profile.legalJurisdiction` has no effect: it reads `null`, and a write is accepted and discarded.
- **Moving a terminal with receipts to another jurisdiction is refused.** `PATCH /v1/countries/{code}` with `vatArea`, `PATCH /v1/vat-areas/{key}` with `taxingCountry` and `PATCH /v1/pos-terminals/{key}` with `associatedNode` answer `409 POS terminal '<name>' has issued receipts under its jurisdiction.` when a terminal that has issued receipts would end up under another taxing country. Terminals without receipts move with `200`.

---

## Endpoint Matrix

| Goal | Method | Endpoint | Scope |
|------|--------|----------|-------|
| List classes | GET | `/v1/vat-classes~with(supplyKind)` | `products:read` |
| Create a class | POST | `/v1/vat-classes` | `products:write` |
| Install a pack area | POST | `/v1/vat-areas` with `{"identifiers": {"com.heads.seedID": "vat-area-se"}}` | `products:write` |
| List areas | GET | `/v1/vat-areas~with(timeZone,euVatScope)` | `products:read` |
| A class's rules | GET | `/v1/vat-rules~where(vatClass/identifiers/com.heads.seedID=vat-class-food)` | `products:read` |
| An area's rules | GET | `/v1/vat-rules~where(vatArea/identifiers/com.heads.seedID=vat-area-se)` | `products:read` |
| Create a rule | POST | `/v1/vat-rules` | `products:write` |
| Close a rule | PATCH | `/v1/vat-rules/{id}` with `{"to": ...}` | `products:write` |
| List rate defaults | GET | `/v1/vat-rate-defaults` | `products:read` |
| Create a rate default | POST | `/v1/vat-rate-defaults` | `products:write` |
| Home VAT number | PATCH | `/v1/companies/{id}` with `{"vatId": ...}` | `org:write` |
| Other registrations | POST | `/v1/vat-registrations` | `products:write` |
| An agent's registrations | GET | `/v1/vat-registrations~where(holder=<key>)` | `products:read` |
| Set a product's class | PATCH | `/v1/products/{id}` with `{"vatClass": ...}` | `products:write` |
| Set a group's class | PATCH | `/v1/product-groups/{id}` with `{"vatClass": ...}` | `products:write` |
| A product's class and rates | GET | `/v1/products/{id}~with(vatClass,vatRates)` | `products:read` |
| A country's area | GET | `/v1/countries/{code}~with(vatArea)` | `geo:read` |
| Receipt VAT groups | GET | `/v1/receipts/{id}~with(vatGroups)` | `receipts:read` |
| Receipt item stamps | GET | `/v1/receipts/{id}/items~with(vatArea,vatTreatment,vatExemptionReason,supplyKind)` | `receipts:read` |

---

## Error Handling and Validation

| Status | Where | Cause | Resolution |
|--------|-------|-------|------------|
| 400 `No VAT rate applies to <product>; the line cannot be posted until a VAT rule covers it.` | `POST /v1/receipts`, `tryApprove`, `tryFulfill` | The product has no class, own or inherited, or its class has no rule in the seller's area | Set `vatClass` on the product or its group; give your own class a rule |
| 400 `A VAT rule for <class> in <area> already covers part of the period.` | `POST /v1/vat-rules` | Overlapping period | Close the current rule first |
| 400 `A VAT rule's <field> is fixed at creation; close the rule and create the next.` | `PATCH /v1/vat-rules/{id}` | Editing a rule's rate | Close and create |
| 400 `A VAT rule that has started cannot be removed; close it instead.` | `DELETE /v1/vat-rules/{id}` | | Set `to` |
| 400 `The VAT reference pack ships this rule and restores it at the next start.` | `DELETE` of a pack rule | | Shorten `to` instead |
| 400 `Sverige already has a default class for 12%.` | `POST /v1/vat-rate-defaults` | One default per area and percentage | Change the existing default's `vatClass` |
| 400 `A supply kind is 'Goods' or 'Services', not '<value>'.` | class `supplyKind`, area `euVatScope` | | |
| 400 `Unknown IANA time zone: '<zone>'.` | area `timeZone` | | |
| 400 `The holder already has a home VAT registration; its vatId changes the number.` | `POST /v1/vat-registrations` without `country` | | Write `vatId` on the agent |
| 409 `POS terminal '<name>' has issued receipts under its jurisdiction.` | country `vatArea`, area `taxingCountry`, terminal `associatedNode` | A terminal with receipts would change jurisdiction | Leave the terminal where it is |

### Preconditions

- The VAT area the selling store is in must exist, with rules for the classes you sell. Installing the pack area covers the twelve pack classes.
- Every sellable product has a class, own or inherited.
- Prices say which basis they are in (`includesTax`); VAT is applied at sale time from the class and area, not stored with the price.

---

## Integration Playbook: VAT Setup

### Phase 1: Install the Area

**Checkpoint:** the area, its rules and defaults exist.

```http
POST /v1/vat-areas
[{"identifiers": {"com.heads.seedID": "vat-area-se"}}]

GET /v1/vat-rules~where(vatArea/identifiers/com.heads.seedID=vat-area-se)~just(identifiers,vatClass,treatment,percentage,from,to)
```

Idempotent; put it at the start of every deployment script.

### Phase 2: Classes on Groups

**Checkpoint:** every group whose products share a rate has a class.

```http
POST /v1/product-groups
[{"identifiers": {"com.example.groupId": "GOODS"}, "name": "Standard goods",
  "vatClass": {"identifiers": {"com.heads.seedID": "vat-class-standard"}}},
 {"identifiers": {"com.example.groupId": "FOOD"}, "name": "Food",
  "vatClass": {"identifiers": {"com.heads.seedID": "vat-class-food"}}},
 {"identifiers": {"com.example.groupId": "BOOKS"}, "name": "Books",
  "vatClass": {"identifiers": {"com.heads.seedID": "vat-class-books"}}}]
```

### Phase 3: Products Under Groups

**Checkpoint:** products inherit.

```http
PATCH /v1/products/com.example.sku=HEADPHONES-001
{"parentGroup": {"identifiers": {"com.example.groupId": "GOODS"}}}

PATCH /v1/products/com.example.sku=LOAF-001
{"parentGroup": {"identifiers": {"com.example.groupId": "FOOD"}}}
```

### Phase 4: Overrides

**Checkpoint:** exceptions have a class of their own.

```http
PATCH /v1/products/com.example.sku=GIFTBOX-001
{"vatClass": {"identifiers": {"com.heads.seedID": "vat-class-standard"}}}
```

### Phase 5: Prices in Their Own Basis

**Checkpoint:** consumer prices carry `includesTax: true`.

```http
POST /v1/prices
[{"identifiers": {"com.example.priceId": "LOAF-SHELF"}, "products": [{"identifiers": {"com.example.sku": "LOAF-001"}}],
  "amount": "53", "includesTax": true, "currency": {"identifiers": {"currencyCode": "SEK"}}}]
```

### Phase 6: Verification

```bash
# The class in effect and the rate per area
GET /v1/products/com.example.sku=LOAF-001~with(vatClass,vatRates)

# Products with no class, own or inherited
GET /v1/products~where(vatClass=null)~just(identifiers,name)

# An order, then its lines both ways
GET /v1/trade-orders/com.example.orderId=ORD-001/items~with(unitAmountExclVat,unitAmountInclVat,vatPercentage)
```

---

## Case Study: A Swedish Store with Food, Books and Standard Goods

### Scenario

- One Swedish store; the tenant has no VAT area yet
- Three product groups: food (6 % today), books (6 %), standard goods (25 %)
- The loaf and the headphones are priced as the customer sees them; the novel is priced net

### Step 1: Install the Area

```http
POST /v1/vat-areas
[{"identifiers": {"com.heads.seedID": "vat-area-se"}}]
```

### Step 2: Three Groups, Three Pack Classes

```http
POST /v1/product-groups
[{"identifiers": {"com.example.groupId": "FOOD"}, "name": "Food",
  "vatClass": {"identifiers": {"com.heads.seedID": "vat-class-food"}}},
 {"identifiers": {"com.example.groupId": "BOOKS"}, "name": "Books",
  "vatClass": {"identifiers": {"com.heads.seedID": "vat-class-books"}}},
 {"identifiers": {"com.example.groupId": "GOODS"}, "name": "Standard goods",
  "vatClass": {"identifiers": {"com.heads.seedID": "vat-class-standard"}}}]
```

### Step 3: Products

```http
POST /v1/products
[{"identifiers": {"com.example.sku": "LOAF-001"}, "name": "Sourdough loaf", "status": "Active",
  "parentGroup": {"identifiers": {"com.example.groupId": "FOOD"}}},
 {"identifiers": {"com.example.sku": "NOVEL-001"}, "name": "Paperback novel", "status": "Active",
  "parentGroup": {"identifiers": {"com.example.groupId": "BOOKS"}}},
 {"identifiers": {"com.example.sku": "HEADPHONES-001"}, "name": "Headphones", "status": "Active",
  "parentGroup": {"identifiers": {"com.example.groupId": "GOODS"}}}]
```

```bash
GET /v1/products/com.example.sku=LOAF-001~with(vatClass,vatRates)~just(identifiers,name,vatClass,vatRates)
```
```json
{"@type":"product","identifiers":{"@type":"common identifiers","key":"91df83743218153427cb347ec8dd6a0e","com.example.sku":"LOAF-001"},"name":"Sourdough loaf","vatClass":{"@type":"VAT class","identifiers":{"@type":"common identifiers","key":"93abae96630e756503938e82017a4e76","com.heads.seedID":"vat-class-food"},"name":"Livsmedel och alkoholfria drycker"},"vatRates":[{"@type":"product VAT rate","vatArea":{"@type":"VAT area","identifiers":{"@type":"common identifiers","key":"814b3c04f2d7548f146a24af9cc072c0","com.heads.seedID":"vat-area-se"},"name":"Sverige","taxingCountry":{"@type":"country","identifiers":{"@type":"country identifiers","key":"90eac72adf3cde16f9374812939519ab","countryCode":"SE"},"name":"Sweden"}},"treatment":"Standard","percentage":"6"}]}
```

### Step 4: One Gross Price, One Net Price

```http
POST /v1/prices
[{"identifiers": {"com.example.priceId": "LOAF-SHELF"}, "products": [{"identifiers": {"com.example.sku": "LOAF-001"}}],
  "amount": "53", "includesTax": true, "currency": {"identifiers": {"currencyCode": "SEK"}}},
 {"identifiers": {"com.example.priceId": "NOVEL-NET"}, "products": [{"identifiers": {"com.example.sku": "NOVEL-001"}}],
  "amount": "150", "currency": {"identifiers": {"currencyCode": "SEK"}}},
 {"identifiers": {"com.example.priceId": "HEADPHONES-SHELF"}, "products": [{"identifiers": {"com.example.sku": "HEADPHONES-001"}}],
  "amount": "1000", "includesTax": true, "currency": {"identifiers": {"currencyCode": "SEK"}}}]
```

### Step 5: An Order

```http
POST /v1/trade-orders
[{"identifiers": {"com.example.orderId": "ORD-CASE-1"},
  "supplier": {"identifiers": {"com.example.companyId": "OUR-COMPANY"}},
  "customer": {"identifiers": {"com.example.customerId": "CUST-001"}},
  "sellers": [{"identifiers": {"com.example.storeId": "STORE-001"}}],
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "items": [
    {"product": {"identifiers": {"com.example.sku": "LOAF-001"}}, "quantity": 2},
    {"product": {"identifiers": {"com.example.sku": "NOVEL-001"}}, "quantity": 1},
    {"product": {"identifiers": {"com.example.sku": "HEADPHONES-001"}}, "quantity": 1}
  ]}]
```

The order's `totalAmount` is `1265`; the lines read as in [VAT in Trade Orders](#vat-in-trade-orders): the loaf `50` net and `53` gross at 6 %, the novel `150` and `159` at 6 %, the headphones `800` and `1000` at 25 %.

### Step 6: The Receipt's VAT Groups

```json
"vatGroups": [
  {"@type": "VAT group", "percentage": "6",  "vatArea": "Sverige", "treatment": "Standard", "quantity": "3", "netAmount": "250", "grossAmount": "265",  "vatAmount": "15"},
  {"@type": "VAT group", "percentage": "25", "vatArea": "Sverige", "treatment": "Standard", "quantity": "1", "netAmount": "800", "grossAmount": "1000", "vatAmount": "200"}
],
"totalAmount": "1265",
"totalTaxAmount": "215"
```

The loaf and the novel share one group: same area, treatment and rate. When the food rate returns to 12 % on 2028-01-01 the loaf's shelf price stays `53` and its net becomes `47.32`; the novel stays `150` net and goes to `168` on the shelf; and the two land in separate groups.

---

## Business Rules and Pitfalls

### Critical Rules

1. **One rule per line.** The nearest class up the product chain, in the area of the place the sale is supplied from, at the time of the sale.
2. **A product with no class cannot be sold.** `vatClass: null` and `vatRates: []` on a product mean a `400 No VAT rate applies to …` at the receipt or the order action. Set the class on the group.
3. **Say which basis a price is in.** `includesTax: true` for a shelf price, `false` (the default) for net. A gross amount sent without the flag is taxed again.
4. **A rate change is a new rule.** Close with `to`, create the next with `from` on the same instant. Nothing else on a rule changes.
5. **Pack rows cannot be deleted.** Shorten a pack rule's `to`, or change a pack default's `vatClass`; the pack restores the row at the next start otherwise.
6. **Group receipts by area, treatment and rate**, not by rate alone: two groups can share a percentage.
7. **`vatClass` is not in the default read.** Ask with `~with(vatClass)` on products, families and groups; it reads the class in effect, inherited or own.
8. **A rate default maps a percentage to a class, not to a product kind.** A bare 12 in Sweden is `vat-class-reduced-12`; food is `vat-class-food`.

### Common Mistakes

| Mistake | Result | Fix |
|---------|--------|-----|
| A gross amount sent without `includesTax: true` | Taxed again | Set the flag |
| A product under no classed group and with no class of its own | `400 No VAT rate applies to …` | `vatClass` on the group |
| Editing a rule's percentage | `400 … fixed at creation` | Close the rule, create the next |
| Deleting a pack rule or default | `400 The VAT reference pack ships …` | Shorten `to`; change `vatClass` |
| Reading `vatClass` without `~with` | The member is absent and looks unset | `~with(vatClass,vatRates)` |
| Summing receipt VAT by percentage alone | Two groups at 0 % collapse | Key by area, treatment, percentage and exemption reason |
| A second home registration through `/v1/vat-registrations` | `400 … its vatId changes the number.` | Write `vatId` on the agent |

### Calculation Notes

- Amounts are decimals printed as strings (`"89.6"`, `"47.32"`); the platform does not round in the model. Receipt totals are authoritative.
- VAT is summed per group, then totalled, so mixed-rate receipts do not accumulate per-line rounding.

---

## Related Guides

- [Upgrading to 26.2.2](../upgrading-to-26-2-2.md) - What changed for integrations written against an older release
- [Products](products.md) - `vatClass` on products, families and groups
- [Prices](prices.md) - `includesTax`, net and gross prices, price selection
- [Surcharge Rules](../../guide/examples/surcharge-rules.md) - Deposits and fees, with `includesTax` on a fixed amount
- [Orders](orders.md) - VAT on trade order items, manual unit amounts
- [Receipts](../receipts.md) - VAT groups, item unit amounts, the item stamps
- [BI Receipts Analytics](../integration-templates/bi-receipts-analytics.md) - Loading VAT groups into a warehouse
- [PIM Product Sync](../integration-templates/pim-product-sync.md) - Mapping PIM tax classes to VAT classes
