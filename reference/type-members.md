# Type Members Reference

Quick reference for the members available on each resource type.

---

## Agent Members (inherited by person, company, store, customer group)

```
identifiers, name, nationality, languages, vatId, addresses, contactMethods,
confirmationAttempts, customerGroups, customerRelations, supplierRelations,
manufacturerRelations, labels, timeline, stockRoots, assortmentOwner,
assortmentRoots, assortment, preferredCurrency,
functionalCurrency (read-only, non-essential), attachments (non-essential)
```

`functionalCurrency` is "the currency the agent keeps its books in: its own `preferredCurrency`, else the nearest one up its organization (a store's `owner`, a company's `parent`); null when none is set. Change it through `preferredCurrency`." Ask with `~with(functionalCurrency)`; a write to it answers `200` and changes nothing.

`attachments` holds files (below): documents attached to the agent, such as contracts or certificates. `/v1/agents/{id}/attachments`.

Every member of an `address` is optional; an address with only `countryCode` is a real address. See [Working with Customers → Addresses](working-with/customers.md#addresses).

`vatId` reads and writes the agent's home VAT registration (the one with no country); registrations in other countries live in `/v1/vat-registrations`. See [Working with VAT → VAT Registrations and `vatId`](working-with/vat.md#vat-registrations-and-vatid).

`customerRelations` and `supplierRelations` list established trade relationships only — the same objects `/v1/trade-relationships` returns, filtered to this agent's role. An agent configured to trade under a parent has none of its own; the relationship belongs to the parent. See [Resource Patterns → What the agent sub-collections contain](resource-patterns.md#what-the-agent-sub-collections-contain).

## Person-specific Members

```
givenName, familyName, fullName, personalNumber, gdprForgotten
```

## Company-specific Members

```
organizationNumber, parent, fiscalYearStart
```

## Store-specific Members

```
owner, organizationNumber, openingHours
```

## Customer Group-specific Members

```
memberMoniker, owner, members
```

A customer group is a type of agent and reads with `"@type": "customer group"`; `members` are trade relationships. See [Working with Customers → Customer Groups](working-with/customers.md#customer-groups).

---

## Product Node Members (inherited by product, category, family, group)

```
identifiers, name, assortmentOwners, assortmentContexts, gtin, plu, hidden,
createdBy, createdAt, promotionTitle, promotionBanner, promotionDescription,
notesForPicking, labels, images, files (non-essential), categories, prices, xrefs, application,
autoGtin (non-essential)
```

`files` holds the documents attached to the node, such as datasheets (the `file` type, below). `autoGtin` reads the setting in effect (its own, else the nearest ancestor's) for getting a GTIN from the buyer's own GS1 series when an order is approved; written, the node's own setting, cleared with `null`. See [Working with Products → Getting a GTIN from your own series](working-with/products.md#getting-a-gtin-from-your-own-series).

## Product/Family/Group Members

```
vatClass (non-essential)
```

`vatClass` reads the VAT class in effect, the node's own or the nearest ancestor's; written, it is the node's own class, cleared with `null`. Ask with `~with(vatClass)`. See [Working with VAT → Assigning VAT to Products](working-with/vat.md#assigning-vat-to-products).

## Product/Family Members

```
salesChannels
```

A product **family** also carries `status ('Active', 'Inactive', 'Pending')`, but **non-essential** —
unlike the essential `status` on a product below, it is absent from a default representation until
you ask for it with `~with(status)` or a `fields=` list.

## Product-specific Members

```
status ('Active', 'Inactive', 'Pending'), instanceProperties, keywords,
designatedStockPlaces, stockLevels, receiptText, signText,
vatRates (read-only, non-essential), attributes (non-essential)
```

`attributes` carries the product's values for the tenant-defined attributes of products, by qualified name (`Product::season`); `null` clears one, attributes left out are untouched. See [Working with Products → Tenant-Defined Attributes](working-with/products.md#tenant-defined-attributes).

`vatRates` lists the treatment and percentage the product's class carries in each VAT area right now, one entry per area whose rules cover it.

## Product Category Members

```
identifiers, members, childCategories
```

## Product Group Members

```
identifiers, name, parentGroup, members (computed), variantDimensions,
variantValues (non-essential), instanceType, ageRestriction
```
- Plus `vatClass` (non-essential), above
- `variantValues` is on families too: the values variants (families: the families under the group) take in each dimension that takes its values from a list, as arrays of value keys by qualified name. Read, the lists in effect — its own, else the nearest group's. See [Working with Products → Product Families](working-with/products.md#product-families-variant-containers)

## Image Members

```
identifiers (key, external ids, url), name, contentUrl (read-only),
mediaType (read-only, non-essential), width (read-only, non-essential), height (read-only, non-essential),
data (write-only)
```

`data` is the content, as a `data:` URL or base64 (JPEG, PNG, WebP, GIF, AVIF, TIFF or SVG, at most 20 MiB); `contentUrl` serves it, with `w`, `h` and `fit` to resize. Reached as `images` on a product node. Scopes `media:read` / `media:write`. See [Working with Products → Images](working-with/products.md#images).

## File Members

```
identifiers (key, external ids, url), name, mediaType, contentUrl (read-only),
data (write-only), accessControl ('Public', 'Signed', 'Private') (non-essential),
expiresAt (non-essential), verified (non-essential), verifiedAt (read-only, non-essential)
```

Reached only as `files` on a product node and `attachments` on an agent; there is no `/v1/files`. A file that nothing holds any more is deleted. See [Working with Products → Files](working-with/products.md#files).

---

## VAT Class Members

```
identifiers, name, supplyKind ('Goods', 'Services') (non-essential)
```

## VAT Area Members

```
identifiers, name, taxingCountry, timeZone (non-essential), euVatScope (non-essential)
```

## VAT Rule Members

```
identifiers, vatArea, vatClass, treatment ('Standard', 'ZeroRated', 'Exempt', 'OutsideScope'),
percentage, exemptionReason, from, to
```
- All but `to` are fixed at creation; `to` can only be moved earlier. See [Working with VAT → VAT Rules](working-with/vat.md#vat-rules)

## VAT Rate Default Members

```
identifiers, vatArea, percentage, vatClass
```

## VAT Registration Members

```
identifiers, holder, country, number
```
- `holder` is read back as the agent's database key; `country` is omitted on the home registration, which `agent.vatId` reads and writes

## Country Members (VAT)

```
vatArea (non-essential)
```

## Surcharge Rule Members

```
identifiers, name, products, currency, kind ('Fixed', 'Percentage'), amount, includesTax,
percentage, worthAtLeast, worthAtMost, reason, seller (non-essential), buyer (non-essential),
time (non-essential)
```
- `amount` is per unit for a `Fixed` rule, gross when `includesTax` is true; `percentage` is for a `Percentage` rule. See [Surcharge Rules](../guide/examples/surcharge-rules.md)

---

## Trade Order Node Members (inherited by trade order and trade order item)

```
status (read-only array), items (required on create)
```

## Trade Order Members

```
identifiers, suppliersId, customersId, currency, customer, relationship,
supplier, sellers, buyers, timestamp, labels, reservedUntil, invoiceAddresses,
deliveryAddresses, totalAmount, balanceAmount, records, payments, shipments,
supplierNotifications, customerNotifications, createdBy, manualDiscounts, actions
```
- Plus inherited: `status`, `items`

## Trade Order Item Members

```
identifiers, product, quantity, reservedUntil, classification, seller, buyer,
statusDetails, totalAmount, unitAmountInclVat, discountAmountInclVat,
unitAmountExclVat, vatPercentage, package, splitFrom, shipmentItems, instances,
manualDiscount, discountable
```
- Plus inherited: `status`, `items`

## Trade Record Members

```
identifiers, items, orders (non-essential), timestamp (non-essential)
```
- `items` and `orders` are read-only; `identifiers` and any registered dynamic properties are writable under `trade-records:write`
- See [Trade Records](trade-records.md#member-reference)

## Trade Record Item Members

```
identifiers, actions
```
- Read-only under both trade-record scopes

## Trade Record Item Action Members

```
type, quantity, amount, product (non-essential), currency (non-essential),
tradeOrderItemEffects (non-essential), return (non-essential)
```
- `type` is one of `Reserve`, `Unreserve`, `Commit`, `Fulfill`, `Cancel`, `CommitReturn`, `FulfillReturn`, `CancelReturn`
- `return` is present only on a `FulfillReturn`

## Trade Relationship Members

```
identifiers, supplierAgent, supplierContacts, primarySupplierContact,
customerAgent, customerContacts, primaryCustomerContact, supplierId, customerId,
defaultDeliveryTerm, defaultPaymentTerm, defaultCurrency, groups, intervalStart,
intervalEnd, acceptedMembershipTerms, acceptedPromotionalMaterial, creditAllowed, allowsBackOrder,
supplierIsManufacturer
```

`supplierIsManufacturer` (boolean): "Indicates if the supplier manufactures for the customer, e.g. a factory that a supplier uses. Such a supplier is listed among the customer's manufacturers (Fabriker), and changes to the link are logged in the activity history of both." See [Working with Assortments → Suppliers and Manufacturers as Owners](working-with/assortments.md#suppliers-and-manufacturers-as-owners).

---

## Receipt Members

```
identifiers (receiptID), ordinal (read-only), prefix (read-only), currencyCode (read-only),
seller, buyer, relationship, user, device, posTerminal, timestamp (read-only, essential),
type ('Sale', 'Return', 'Mixed', 'Other') (non-essential),
items, labels, totalAmount (read-only), totalTaxAmount (read-only), totalDiscountAmount (read-only),
roundingAmount (read-only), totalPayableAmount (read-only), totalPaidAmount (read-only),
totalExternalSettlementsAmount (read-only), externalSettlements (read-only), vatGroups (read-only),
payments (read-only), orders (read-only, non-essential)
```

## Receipt Item Members

```
type ('Sale', 'Return', 'Other') (non-essential),
description (read-only), product, instances, quantity (read-only), unitAmount (read-only),
discounts, taxAmount (read-only), salesAmount (read-only), totalAmount (read-only),
discountAmount (read-only), vatAmount (read-only), vatPercentage (read-only),
discountPercentage (read-only), currencyCode (read-only), manualNotes (read-only),
unitAmountExclVat (read-only, non-essential), unitAmountInclVat (read-only, non-essential),
unitAmountAfterDiscountInclVat (read-only, non-essential),
vatArea (read-only, non-essential), vatTreatment (read-only, non-essential),
vatExemptionReason (read-only, non-essential), supplyKind (read-only, non-essential),
receipt (read-only, non-essential), related (read-only, non-essential),
orderItems (read-only, non-essential)
```

`vatArea`, `vatTreatment`, `vatExemptionReason` and `supplyKind` record what the line was taxed by. The receipt's `vatGroups` are keyed by area, treatment, percentage and exemption reason. See [Working with VAT → VAT in Receipts and Z Reports](working-with/vat.md#vat-in-receipts-and-z-reports).

`unitAmountExclVat` / `unitAmountInclVat` are the VAT-explicit unit prices, mirroring the pair on
`trade order item` but read-only here. `unitAmountExclVat` is the same number as the essential
`unitAmount`. See [Receipts → Item Unit Amounts](receipts.md#item-unit-amounts-vat-explicit).

`unitAmountAfterDiscountInclVat` is the *net* unit price including VAT — `totalAmount / quantity`,
i.e. what was actually charged per unit, where the three above are pre-discount list prices. Use it
to price part of a line (a per-unit return credit). See
[Receipts → The net unit price](receipts.md#the-net-unit-price-unitamountafterdiscountinclvat).

`receipt` names the receipt that **owns** the item — for lines reached through `related` that is the
*other* receipt, not the one you navigated from, and it is `null` for lines recorded outside any
receipt. See [Receipts → Item → Receipt Navigation](receipts.md#item-to-receipt-navigation-the-receipt-backlink).

`orderItems` is a `trade order item[]` naming the order lines this receipt line settles — the per-line
counterpart of the receipt-level `orders`. It is empty for ordinary walk-in sales. See
[Receipts → Item → Order Navigation](receipts.md#item-to-order-navigation-the-orderitems-member).

---

## Price Members

```
identifiers, sellers, buyers, products, amount, includesTax, open, currency, from, to
```

`includesTax` (boolean, default `false`, essential) says whether `amount` is gross. See [Working with Prices → Prices That Include VAT](working-with/prices.md#prices-that-include-vat).

## Stock Place Members

```
identifiers, name, parent, children, effectiveAddress, labels, owner, entries,
transactions, transactionItems
```

## Assortment Context Members

```
owner (agent), articleNumber, primarySupplier (company, non-essential), discontinued (non-essential)
```

A context with only `owner` puts the node in that owner's assortment. `primarySupplier` is who the owner buys the node from; on a context owned by one of your suppliers it is the factory that supplier makes it at. `~with(assortmentContexts~with(primarySupplier))` on the product includes it. See [Working with Assortments](working-with/assortments.md#editing-a-context).

## User Members

```
identifiers, agent, localCredentials, retailCredentials, bankIDCredentials,
mobileCredentials, entraIdCredentials, oauth2Clients, apikeyCredentials,
pinCredentials (non-essential), scanTokenCredentials (non-essential),
roleAssignments (non-essential), inactive (non-essential),
hidden (non-essential), labels (non-essential), config (non-essential),
posMode (non-essential)
```

A user has **no `name` member** — the display name comes from the linked `agent`. `identifiers.userId` is assigned by the system (`U00001`, …) and is read-only.

The non-essential members are absent from a plain `GET`; ask for them with `~with(...)` or `~withAll`. `roleAssignments` is the one that misleads — a plain read of a fully provisioned user shows no roles at all. See [Users → Members](users.md#members) and [gotcha 34](common-gotchas.md#34-roleassignments-is-missing-from-the-default-user-representation).

## User Role Members

```
identifiers (userRoleID), name, permissions (non-essential)
```

`permissions` holds user-permission **objects** (`{"identifiers": {"permissionName": "…"}}`), not strings. There is no `description` member. See [Roles, Permissions and Assignments](user-roles.md).

## User Role Assignment Members

```
identifiers, role, node
```

`node` is the agent (usually a store or company) the role applies at; omit it for an assignment that is not tied to one. The subject — which user is granted the role — comes from the path you create it under, `/v1/users/{id}/roleAssignments`.
