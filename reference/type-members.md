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
items, labels, totalAmount (read-only), totalTaxAmount (read-only), totalDiscountAmount (read-only),
roundingAmount (read-only), totalPayableAmount (read-only), totalPaidAmount (read-only),
totalExternalSettlementsAmount (read-only), externalSettlements (read-only), vatGroups (read-only),
payments (read-only)
```

## Receipt Item Members

```
description (read-only), product, instances, quantity (read-only), unitAmount (read-only),
discounts, taxAmount (read-only), salesAmount (read-only), totalAmount (read-only),
discountAmount (read-only), vatAmount (read-only), vatPercentage (read-only),
discountPercentage (read-only), currencyCode (read-only), manualNotes (read-only)
```

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
