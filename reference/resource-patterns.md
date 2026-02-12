# CommerceOS API Resource Patterns

This document highlights repeatable resource patterns observed in the CommerceOS API.

---

## Agents Overview

Agents represent entities that can participate in commerce: individuals (people), businesses (companies), and retail locations (stores).

**Concept focus:** This section covers how agents behave (fields, relationships, expansion, and write semantics). Use your tenant's `/api-docs` for the canonical endpoint list.

### Agent Name Fields

Agents expose name-related fields differently depending on their type:

| Agent Type | Essential Name Field | Requires `~with` |
|------------|---------------------|------------------|
| `person` | `fullName` | `name` |
| `company` | `name` | - |
| `store` | `name` | - |

**Person essentials:** `identifiers`, `fullName`, `givenName`, `familyName`, `personalNumber`
**Company/Store essentials:** `identifiers`, `name`

For **Person** entities, `fullName` is derived from `givenName` and `familyName` and is returned by default. The `name` field (mapped to internal `fullName` property) requires `~with(name)`:

```bash
# fullName is returned by default for people
GET /people~orderBy(fullName)~take(10)

# If you need the `name` alias, use ~with
GET /people~with(name)~orderBy(name)~take(10)
```

For **Company** and **Store** entities, `name` is returned by default:

```bash
# name is returned by default for companies/stores
GET /companies~orderBy(name)~take(10)
GET /stores~orderBy(name)~take(10)
```

**Key behaviors:**
- `fullName` is essential only for `person` type
- `name` is essential for `company` and `store` types
- For people, `name` is computed from `fullName` and requires `~with(name)` to include
- Setting `name` directly updates the underlying `fullName` property
- Use `givenName` and `familyName` for reliable filtering on people

### Agent Finder

The agent finder (`/agents/@find`) uses heuristic lookup:

```bash
# Find by email
PUT /agents/@find/results
{"email": "john@example.com"}

# Find by phone
PUT /agents/@find/results
{"phone": "+46701234567"}

# Find by national ID
PUT /agents/@find/results
{"nationalId": "1990010112345"}

# Navigate to first result's name
PUT /agents/@find/results/0/name
{"email": "john@example.com"}
```

Name filtering uses metaphone (phonetic) matching for approximate name search.

---

## Agent Members

Agents (person, company, store) share common members:

| Member | Description | Write Semantics |
|--------|-------------|-----------------|
| `identifiers` | External IDs + key | Via common identifiers |
| `name` | Mapped from fullName property | Direct set |
| `nationality` | Agent nationality | Direct set |
| `languages` | Spoken languages | Direct set |
| `vatId` | VAT identification number | Direct set |
| `addresses` | Object with `main`, `home`, `invoice`, `delivery`, `visiting` | Each address settable |
| `contactMethods` | Object with `landlinePhone`, `mobilePhone`, `workPhone`, `email` | Each method settable |
| `confirmationAttempts` | Confirmation attempts for agent | Read-only |
| `customerGroups` | Groups owned by agent | Add/remove |
| `customerRelations` | Trade relationships where agent is supplier | Read-only |
| `supplierRelations` | Trade relationships where agent is customer | Read-only |
| `manufacturerRelations` | Manufacturer relationships | Read-only |
| `labels` | Assigned labels | Add/remove |
| `timeline` | Receipts for buyer | Read-only |
| `stockRoots` | Stock places attached to agent | Add/remove |
| `assortmentOwner` | Owner agent for assortment inheritance | Writable |
| `assortmentRoots` | Root product nodes in assortment | Add/remove |
| `assortment` | All product nodes in assortment | Add/remove |
| `preferredCurrency` | Preferred currency | Set by currency key |

Notes:
- `timeline` fetches receipts where agent is the buyer.
- `stockRoots` provides stock owner interface.
- `assortmentOwner` writes config at the agent node.
- Phone numbers are converted on set.
- Email addresses are converted on set.

---

## Product Node Hierarchy

Products exist in a hierarchy with different node types:

- **Products**: Concrete sellable items
- **Product Families**: Abstract product groupings
- **Product Groups**: Groupings with hierarchy (variant containers)
- **Product Categories**: Categorization with membership
- **Product Nodes**: Unified view of all node types

**Concept focus:** The product node resource provides a unified view of all product node types with `assortmentOwners`, `assortmentContexts`, and `xrefs` expansions. Use your tenant's `/api-docs` for the canonical endpoint list.

---

## Product Node Members

Product nodes share common members:

| Member | Description | Write Semantics |
|--------|-------------|-----------------|
| `identifiers` | External IDs + key | Via common identifiers |
| `name` | Product node name | Direct set |
| `gtin` | Global Trade Item Numbers | Direct set |
| `plu` | Price Look-Up codes | Direct set |
| `hidden` | Hidden flag | Direct set |
| `createdAt` | Creation timestamp | Read-only |
| `createdBy` | Creating agent | Read-only |
| `promotionTitle` | Localized promotion title | Localized set |
| `promotionBanner` | Localized promotion banner | Localized set |
| `promotionDescription` | Localized promotion description | Localized set |
| `notesForPicking` | Picker instructions | Direct set |
| `images` | Image files | **Full replace on set** |
| `assortmentOwners` | Agents owning this node | Add/remove |
| `assortmentContexts` | Assortment relation contexts | **Nested fields writable** (see below) |
| `categories` | Category assignments with weight | Add/remove; weight settable per assignment |
| `labels` | Assigned labels | Add/remove |
| `prices` | Price rules for this product | **Replace on set** |
| `xrefs.compatibles` | Compatible products | Add/remove |
| `xrefs.alternatives` | Alternative products | Add/remove |
| `application.webshop` | Webshop settings | **Read-only** |

### assortmentContexts

The collection itself is read-only, but **each context element has writable nested fields**:

| Nested Field | Description | Write Semantics |
|--------------|-------------|-----------------|
| `owner` | Owning agent | Read-only |
| `articleNumber` | Custom article number for this owner | Settable |
| `minimumOrderQuantity` | Minimum order quantity | Settable |
| `primarySupplier` | Primary supplier company | Settable |

When setting nested fields, the relation is created if it doesn't exist.

### categories

Uses a wrapper object pattern:
- `category`: The assigned category
- `weight`: Child weight in the category

Weights stored on the category relation.

### prices

Gets prices specific to this node.
- Replace on set means setting the array replaces all existing prices
- On add, price patterns are updated
- On remove, if no other products remain, price is purged entirely

---

## Products and Categories

### Products

Products represent sellable items with status, identifiers, and various attributes.

**Default Fields (returned without `~with`):**
- `status`: One of `Active`, `Inactive`, `Pending`
- `gtin`: Array of barcode identifiers (string array supporting index access)
- `name`: Product name (always returned)

**Non-essential Fields (require `~with`):**
- `plu`: Array of price look-up codes
- `hidden`: Boolean flag for visibility

**GTIN/PLU Array Access:**

```bash
# Access first GTIN
GET /products/{id}/gtin/0

# Access last GTIN
GET /products/{id}/gtin/-1

# Count GTINs
GET /products/{id}/gtin/count
```

**Localized Fields (require `~with`):**
- `promotionTitle`, `receiptText`, `signText`

```bash
# Filter active products with localized fields
GET /products~where(status=Active)~with(promotionTitle,receiptText)~take(20)

# Filter by name pattern
GET /products~where(name=~Widget)~take(10)
```

### Categories

**Category Fields:**
- Localized promotion fields (require `~with`)
- `images`, `labels` expansions
- `childCategories` for hierarchical navigation

```bash
# Categories with expansions
GET /product-categories~with(images,labels)~take(20)

# Members of a category with pagination
GET /product-categories/{id}/members~take(50)~skip(100)

# Count products in category
GET /product-categories/{id}/members/count
```

### Category Membership

Products belong to categories through the `categories` member. Categories can contain other categories via `childCategories`:

```bash
# Product's categories (returns category assignments with weight)
GET /products/{id}/categories

# Category's child categories (hierarchical navigation)
GET /product-categories/{id}/childCategories

# Category members (products/nodes in this category)
GET /product-categories/{id}/members
```

> **Note:** Categories expose `childCategories` and `members`, not `parentCategories` or `parent`. To find a category's parent, query which categories include it as a child or access parent information via the product node's `categories` relation.

### Product Groups and Families

Groups define variant dimensions, default VAT codes, instance types, and age restrictions.

---

## Assortment Contexts

Assortment contexts link products to owning agents with owner-specific metadata.

### Structure

| Field | Description |
|-------|-------------|
| `owner` | Owning agent (company/store) |
| `articleNumber` | Owner-specific article number |
| `minimumOrderQuantity` | Minimum order quantity for this owner |
| `primarySupplier` | Primary supplier (company reference) |

### Common Interactions (Examples)

Use these patterns when you need owner-specific assortment data or want to navigate an agent's assortment.

```bash
# Product's assortment contexts
GET /products/{id}/assortmentContexts

# Company's assortment (use /stores/{id}/assortment for store-level)
GET /companies/{id}/assortment
```

### Product Expansions

```bash
# Product with assortment owners expanded
GET /products/{id}~with(assortmentOwners)

# Product node with xrefs expanded
GET /products/{id}~with(xrefs)
```

---

## Deep Indexing Patterns

The API supports deep navigation into resources using URL path segments.

### External Identifier Lookup

Objects with `commonIdentifiers` can be accessed by any external identifier namespace:

```bash
# Access by namespace-qualified external ID
GET /people/com.myapp.userId=123

# Multiple identifiers on same object work interchangeably
GET /products/com.legacy.sku=ABC-001
GET /products/com.newapp.productId=xyz789
# Both resolve to the same product if it has both identifiers
```

### Database Key Lookup

Every resource has an internal `key` in its identifiers:

```bash
# Access by database key
GET /products/key=abc123def456
GET /agents/key=987654321
```

### Array Index Access

Array members support numeric index access:

```bash
# Access first element (0-indexed)
GET /products/com.test.sku=ABC/gtin/0

# Access last element with -1
GET /products/com.test.sku=ABC/gtin/-1

# Get array length
GET /products/com.test.sku=ABC/gtin/count
```

### Sub-Collection Navigation

Collections expose their elements as navigable paths:

```bash
# Stock place transactions sub-collection
GET /stock-places/com.test.placeId=WH1/transactions

# Product categories sub-collection
GET /products/com.test.sku=ABC/categories

# Category members (products in category)
GET /product-categories/com.test.catId=ELEC/members

# Agent customer relations
GET /companies/com.test.id=CORP/customerRelations
```

### Nested Relation Navigation

Navigate through relations to reach deeply nested data:

```bash
# Navigate from order to customer's addresses
GET /trade-orders/com.test.orderId=ORD1/customer/addresses/main

# Navigate to count of items in a collection
GET /trade-orders/com.test.orderId=ORD1/items/count

# Navigate through product to its category's child categories
GET /products/com.test.sku=ABC/categories/0/category/childCategories
```

> **Note:** Product categories do not expose a `parent` member. Use `childCategories` for hierarchical navigation downward.

### Receipt Date Indexing

Receipts support efficient date-based access via indexed paths. The `/after/` and `/before/` endpoints accept any Date-parsable timestamp (ISO 8601 recommended):

```bash
# Receipts after specific datetime (ISO 8601 recommended)
GET /receipts/after/2024-12-01T00:00:00Z

# Receipts before specific datetime
GET /receipts/before/2024-12-31T23:59:59Z
```

> **Note:** These endpoints use JavaScript's `new Date(timestamp)` parsing internally. ISO 8601 timestamps are recommended for consistency. Invalid timestamps return **404** (resource not found), not empty arrays. Relative shorthand like `-=24` (24 hours back) is accepted. Combined ranges are not supported via chained paths—use operators for more complex filtering:

```bash
# For time ranges, chain operators instead
GET /receipts~where(timestamp>=2024-12-01T00:00:00Z)~where(timestamp<=2024-12-31T23:59:59Z)~orderBy(timestamp:desc)
```

---

## Structured Slot Patterns

### Addresses

Agent addresses use a structured slot pattern with predefined keys:

| Slot | Description |
|------|-------------|
| `main` | Primary/default address |
| `home` | Home address |
| `invoice` | Billing address |
| `delivery` | Shipping address |
| `visiting` | Physical visit address |

Access and update via PATCH:

```bash
# Read main address
GET /people/com.test.id=123~with(addresses/main)

# Update delivery address
PATCH /people/com.test.id=123
{"addresses": {"delivery": {"line1": "123 Main St", "cityName": "Stockholm", "countryCode": "SE"}}}
```

### Contact Methods

Contact methods follow the same slot pattern:

| Slot | Description |
|------|-------------|
| `landlinePhone` | Landline telephone |
| `mobilePhone` | Mobile telephone |
| `workPhone` | Work telephone |
| `email` | Email address |

**Important:** Use `contactMethods`, not `contactPoints`.

```bash
# Read contact methods
GET /people/com.test.id=123~with(contactMethods)

# Update email
PATCH /people/com.test.id=123
{"contactMethods": {"email": "new@example.com"}}
```

---

## Trade Orders

Trade orders represent sales or purchase transactions between agents.

### Required Fields

- **`items`**: Must be non-empty (at least 1 item required)
- **`sellers`**: Must be non-empty (at least 1 seller required)
- **`customer`**: Must resolve to exactly one agent
- **`supplier`**: Must resolve to exactly one agent
- **`currency`**: Must resolve to exactly one currency

Orders missing any of these or failing to resolve to exactly one entity will fail validation.

### Product References

Product identifiers in trade order items require a **fully qualified namespace**:

```json
// WRONG - bare key
{"product": {"identifiers": {"sku": "PHONE-001"}}}

// RIGHT - namespaced key
{"product": {"identifiers": {"com.example.sku": "PHONE-001"}}}
```

### Instance Tracking

For serialized products (devices, SIM cards), use `instances` instead of `quantity`:

| Instance Type | Instance Field | Description |
|---------------|----------------|-------------|
| MobileDevice | `imei` | Device IMEI number |
| MobilePlan | `phoneImei` | References a device IMEI from an earlier item |

**Order matters:** A MobilePlan item with `phoneImei` must reference an IMEI from a MobileDevice item that appears earlier in the items array.

> **Tip:** Products need the correct `instanceType` set during product creation (not on the order). This is handled by product setup, not order creation.

### Order Actions

| Action | Effect |
|--------|--------|
| `tryApprove` | Sets order status to `Committed` if currently `New` or `Reserved` |
| `tryCancel` | Cancels the order if currently `Committed` |
| `changeInvoiceAddress` | Updates the invoice address (only on `New`/`Reserved` orders) |
| `changeDeliveryAddress` | Updates the delivery address (only on `New`/`Reserved` orders) |
| `createShipment` | Creates a shipment for order items |
| `createPayment` | Creates a payment record (see constraints below) |

#### createPayment Constraints

The `createPayment` action has strict requirements:

| Requirement | Description |
|-------------|-------------|
| `transactionId` | **Required.** Unique payment transaction ID |
| `timestamp` | **Required.** Payment timestamp |
| `method` | **Required.** Must not be an integration-backed payment method. Use namespaced `methodId` (e.g., `com.heads.cash`). Query `/v1/payment-methods` for valid IDs. |
| `currency` | **Required.** Currency reference |
| `amount` | **Optional.** If omitted, defaults to sum of order item amounts (VAT-inclusive). Must be non-zero if specified. |
| `items` | If specified, all items must belong to this order |
| Single seller/buyer | Order must have exactly one seller and one buyer |

```json
// Example createPayment action
{
  "actions": {
    "createPayment": [{
      "transactionId": "TXN-12345",
      "timestamp": "2024-12-01T10:30:00Z",
      "method": { "identifiers": { "methodId": "com.heads.cash" } },
      "currency": { "identifiers": { "currencyCode": "SEK" } },
      "amount": 299.00
    }]
  }
}
```

> **Important:** Payment methods with an associated `PaymentIntegration` are not supported via `createPayment`. Use the payment integration's native flow instead. Query `GET /v1/payment-methods` to discover valid method IDs for your tenant.

### Labels

Trade orders support labels for categorization. Labels use add/remove semantics — assign via `POST /v1/trade-orders/{id}/labels`, remove via `DELETE`.

> **Note:** Labels must have `applicableOnlyTo` include `"TradeOrder"` (or be unrestricted) to be assignable to orders.

### Expansions

| Expansion | Description |
|-----------|-------------|
| `~with(manualDiscounts)` | Manual discounts applied to order |
| `~with(payments)` | Payment records for this order |
| `~with(labels)` | Assigned labels |

Each order item has a `discountable` flag indicating whether it accepts discounts.

---

## Trade Relationships

Trade relationships define B2B or B2C connections between agents.

### Required Fields

- **`supplierAgent`**: The agent providing goods/services
- **`customerAgent`**: The agent receiving goods/services

### Optional Fields

| Field | Description |
|-------|-------------|
| `creditAllowed` | Whether credit is allowed |
| `allowsBackOrder` | Whether backorders are allowed |
| `supplierId` / `customerId` | External IDs |
| `intervalStart` / `intervalEnd` | Validity period |
| `acceptedMembershipTerms` | Membership acceptance flag |
| `acceptedPromotionalMaterial` | Marketing consent flag |

### Agent-Side Access

```bash
# Company's customers
GET /companies/{id}/customerRelations

# Company's suppliers
GET /companies/{id}/supplierRelations
```

Use `~with` to include non-essential fields in the response.

---

## Trade Rules

Trade rules define discounting and pricing logic.

**Concept focus:** This section covers how trade rules behave (discount types, phases, and pricing logic). Use your tenant's `/api-docs` for the canonical endpoint list.

### Manual Discount Types

| Type | Description |
|------|-------------|
| Percentage | Percentage reduction |
| FixedReduction | Fixed amount reduction |
| FixedPrice | Override to fixed price |

Edge cases handled: zero priority, 100% discount, zero reduction amount.

---

## Prices and Currencies

### Price Fields

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `identifiers` | Yes | - | Price identifiers |
| `amount` | No | `0` | Price amount (string for precision) |
| `currency` | No | `USD` | Currency reference |
| `sellers` | No | `[]` | Selling agents (company or store) |
| `buyers` | No | `[]` | Buying agents eligible for this price |
| `from` | No | `Time.always` | Validity start date |
| `to` | No | `Time.always` | Validity end date |
| `products` | No | - | Products this price applies to |
| `open` | No | - | Whether the price is open (set when sold) |

> **Note:** While `sellers`, `buyers`, `from`, and `to` are listed as essential fields in the schema (meaning they're always returned in responses), they have sensible defaults when creating prices:
> - Empty `sellers`/`buyers` arrays mean the price applies to all agents
> - `Time.always` defaults provide an indefinite validity window
>
> For scoped pricing (wholesale vs retail, store-specific), explicitly specify `buyers` and `sellers`.

### Sub-Collections

```bash
# Prices for a specific product
GET /products/{id}/prices

# Product with prices expanded
GET /products/{id}~with(prices)
```

### Currencies

Currencies are resources at `/currencies`:

```bash
GET /currencies
GET /currencies/currencyCode=SEK
```

---

## Stock Management

### Stock Places

Stock places represent physical or logical storage locations.

| Member | Description |
|--------|-------------|
| `owner` | Agent owning the stock place |
| `effectiveAddress` | Computed address (read-only) |
| `parent` / `children` | Hierarchical structure |
| `entries` | Current stock levels |
| `transactions` | Stock transaction history |

### Stock Transactions

```bash
# Transactions at a stock place
GET /stock-places/{id}/transactions
```

Transactions support positive, negative, and zero quantities with product and stock place references.

### Stock Adjustment Reasons

Adjustment reasons are managed at `/stock-adjustment-reasons`.

### Agent Stock Roots

Agents expose their stock places via `stockRoots`:

```bash
GET /companies/{id}~with(stockRoots)
GET /stores/{id}~with(stockRoots)
```

---

## Receipts

Receipts are read-only records of POS transactions.

### Read-Only Nature

Receipts are primarily read-only after creation. Use projections and ordering to query:

```bash
# Recent receipts ordered by timestamp
GET /receipts~orderBy(timestamp:desc)~take(20)

# Receipts with expansions
GET /receipts~with(items,payments)~take(10)
```

### Date-Indexed Access

Use `/receipts/after/` and `/receipts/before/` for efficient date queries (uses database indexes). These endpoints accept any Date-parsable timestamp (ISO 8601 recommended):

```bash
# Receipts from December 2024
GET /receipts/after/2024-12-01T00:00:00Z

# Chain with operators for additional filtering
GET /receipts/after/2024-12-01T00:00:00Z~orderBy(timestamp:desc)~take(100)
```

> **Note:** Invalid timestamps return **404** (resource not found), not empty arrays. Relative shorthand like `-=24` (24 hours back) is accepted; ISO 8601 is still recommended for clarity.

---

## Shipments

Shipments track order delivery and fulfillment.

**Concept focus:** This section covers how shipments behave (orders, records, items, and delivery terms). Use your tenant's `/api-docs` for the canonical endpoint list.

### Sub-Collections

```bash
# Items in a shipment order
GET /shipment-orders/{id}/items
```

### Linking

Shipment records can link back to shipment orders. Use `incotermCode` for delivery terms classification.

---

## Payments and POS

### Payment Methods

| Member | Description |
|--------|-------------|
| `supportsIncoming` | Accepts incoming payments |
| `supportsOutgoing` | Supports outgoing payments |
| `supportsReversal` | Supports reversal transactions |
| `requiresTerminal` | Requires a payment terminal |
| `requiresSpecification` | Requires additional specification |
| `consumerFriendlyTitle` | Display title |
| `consumerFriendlyBanner` | Display banner |

### Payment Orders

| Member | Description |
|--------|-------------|
| `amount` | Payment amount |
| `currency` | Payment currency |
| `method` | Payment method |
| `payer` / `payee` | Payment parties |

Sub-collection: `/payment-orders/{id}/records`

### POS Terminals

| Member | Description |
|--------|-------------|
| `posTerminalName` | Terminal identifier (required on create) |
| `associatedNode` | Associated **agent** (store or company) |
| `status` | Terminal status |
| `profile` | Linked POS profile |
| `receiptSequence` | Receipt sequence serial |
| `assignedDevice` | Assigned device |
| `labels` | Assigned labels |
| `receiptPrinter` | Receipt printer |
| `receiptTemplate` | Receipt template |
| `emailReceiptTemplate` | Email receipt template |
| `slipTemplate` | Slip template |
| `pickingOrderTemplate` | Picking order template |

> **Important:** `associatedNode` should reference an agent (store or company). If you supply a non-agent identifier, the terminal still creates but `associatedNode` resolves to `null` (no match).

### POS Resources

POS resources include terminals, profiles, functions, devices, and printers. Use your tenant's `/api-docs` for the canonical endpoint list.

> **Note:** Device roles and reports endpoints are not currently exposed in the API.

---

## Users and Credentials

### User Resources

| Member | Description | Write Semantics |
|--------|-------------|-----------------|
| `agent` | Linked agent reference | Settable |
| `inactive` | Deactivation flag | Settable |
| `labels` | Assigned labels | Add/remove |
| `roleAssignments` | Role assignments | Add/remove |
| `config` | User configuration (darkModeActive, preferredLocale) | Settable |
| `posMode` | POS mode flag | Settable |

> **Note:** Users do not have a `name` field. The user's display name comes from their linked `agent`.

```bash
# User by key
GET /users/key={userKey}

# User with agent expanded
GET /users/key={userKey}~with(agent)
```

### Credentials Sub-Collections

| Sub-Collection | Description | Key Field |
|----------------|-------------|-----------|
| `localCredentials` | Email-based auth | `email` |
| `retailCredentials` | Username-based auth | `username` |
| `pinCredentials` | PIN-based auth | - |
| `apikeyCredentials` | API key auth | - |
| `oauth2Clients` | OAuth2 clients | - |
| `bankIDCredentials` | BankID auth | - |
| `mobileCredentials` | Mobile auth | - |

### Roles and Permissions

```bash
# Role assignments for a user
GET /users/{id}/roleAssignments

# Available user roles
GET /user-roles

# Permissions collection
GET /user-permissions
```
