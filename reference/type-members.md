# Type Members Reference

Quick reference for the members available on each resource type.

---

## Agent Members (inherited by person, company, store)

```
identifiers, name, nationality, languages, vatId, addresses, contactMethods,
confirmationAttempts, customerGroups, customerRelations, supplierRelations,
manufacturerRelations, labels, timeline, stockRoots, assortmentOwner,
assortmentRoots, assortment, preferredCurrency
```

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

---

## Product Node Members (inherited by product, category, family, group)

```
identifiers, name, assortmentOwners, assortmentContexts, gtin, plu, hidden,
createdBy, createdAt, promotionTitle, promotionBanner, promotionDescription,
notesForPicking, labels, images, categories, prices, xrefs, application
```

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
designatedStockPlaces, stockLevels, receiptText, signText
```

## Product Category Members

```
identifiers, members, childCategories
```

## Product Group Members

```
identifiers, name, parentGroup, members (computed), variantDimensions,
defaultVatCode, instanceType, ageRestriction
```

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
intervalEnd, acceptedMembershipTerms, acceptedPromotionalMaterial, creditAllowed, allowsBackOrder
```

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
receipt (read-only, non-essential), related (read-only, non-essential),
orderItems (read-only, non-essential)
```

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
identifiers, sellers, buyers, products, amount, open, currency, from, to
```

## Stock Place Members

```
identifiers, name, parent, children, effectiveAddress, labels, owner, entries,
transactions, transactionItems
```

## Assortment Context Members

```
owner (agent), articleNumber, minimumOrderQuantity, primarySupplier (company)
```

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
