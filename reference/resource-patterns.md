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
| `customerGroups` | Groups **owned** by agent (not membership — see [Customer Groups](working-with/customers.md#customer-groups)) | Add/remove |
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

### Clearing Add/Remove Collections

To remove all items from an add/remove collection (e.g., `stockRoots`, `labels`, `assortmentRoots`), use `PUT` with an empty array:

```bash
# Clear all stock roots from a store
PUT /v1/stores/{key}/stockRoots
[]

# Or using PATCH replace
PATCH /v1/stores/{key}/stockRoots
{"replace": []}
```

Both methods remove all existing items. Individual items can still be removed with `DELETE /v1/{collection}/{key}/{member}/{itemKey}`.

To detach a specific subset without touching the rest, use the `remove` operation — see [Array Write Operations](#array-write-operations).

---

## Array Write Operations

Every writable array member — labels on any entity, `members` on a customer group, `prices` on a product, `stockRoots` on an agent, `categories` on a product, `applicableOnlyTo` on a label, the trade-rule relation collections, and so on — supports three write operations via `PATCH`:

| Operation | Effect on the array | Elements not listed |
|-----------|---------------------|---------------------|
| `add` | Appends the listed elements | Left in place |
| `replace` | Makes the array exactly the supplied set | Dropped |
| `remove` | Detaches exactly the listed elements | Left in place |

Read-only arrays stay read-only — these operations are only available where the array itself is writable.

### Two Ways to Invoke

**Envelope** — `PATCH` the array itself with the operation as the body key:

```bash
PATCH /v1/trade-orders/{key}/labels
{"remove": [{"identifiers": {"com.example.labelId": "sync-pending"}}]}
```

A single object is accepted where an array is expected:

```bash
PATCH /v1/trade-orders/{key}/labels
{"remove": {"identifiers": {"com.example.labelId": "sync-pending"}}}
```

**Explicit sub-path** — `PATCH` the operation as a path segment, with the elements as the body:

```bash
PATCH /v1/trade-orders/{key}/labels/remove
[{"identifiers": {"com.example.labelId": "sync-pending"}}]
```

Both forms are equivalent. The same pair of forms works for `add` and `replace`.

### Identifying Elements

Elements are matched **by identity**, resolved the same way `replace` resolves them — so you can target by **any** namespaced identifier, not just the primary key:

```bash
# Removes the "sync-pending" label from this order
PATCH /v1/trade-orders/1a29.../labels
{"remove": {"identifiers": {"com.example.labelId": "sync-pending"}}}
```

- **Object arrays** (labels, group members, prices, categories): identify the element by its identifiers, e.g. `{"category": {"identifiers": {"com.example.catId": "PHONES"}}}` for `categories`.
- **Scalar `string[]` arrays** (e.g. a label's `applicableOnlyTo`): pass the string value itself, e.g. `{"remove": ["Product"]}`.

### `remove` Is Idempotent

Removing an element that is not currently in the array — wrong identifier, or already removed — is a **silent no-op**: `200`, no error, nothing changed. Retries and double-sends are safe. This holds for every array type.

### Combining `add` and `remove`

`add` and `remove` may be sent in a **single** `PATCH` body and are applied together in one transaction:

```bash
PATCH /v1/trade-orders/1a29.../labels
{
  "add":    [{"identifiers": {"com.example.labelId": "vip"}}],
  "remove": [{"identifiers": {"com.example.labelId": "sync-pending"}}]
}
```

If the **same** element appears in both `add` and `remove`, it ends up **present** — `add` wins, deterministically, regardless of key order in the JSON.

`replace` **cannot** be combined with either, since it sets the whole array. A body mixing `replace` with `add` or `remove` is rejected with **`400` Bad Request** and the array is left unchanged. Send `replace` on its own, or `add`/`remove` together.

### Choosing an Operation

| Goal | Use |
|------|-----|
| Attach one or more elements, keep the rest | `add` |
| Detach one or more elements, keep the rest | `remove` |
| Make the array exactly this set | `replace` |
| Clear the array entirely | `replace` with `[]` (or `PUT []`) |
| Detach a single element you already have the key for | `DELETE /v1/{collection}/{key}/{member}/{itemKey}` |

`DELETE` on a single element is unchanged and still supported; `remove` is the bulk/declarative form and the one that matches by arbitrary identifier.

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

Because the element is a wrapper, [`remove`](#array-write-operations) identifies it through the wrapped category:

```bash
PATCH /v1/products/{key}/categories
{"remove": [{"category": {"identifiers": {"com.example.catId": "PHONES"}}}]}
```

### prices

Gets prices specific to this node.
- Replace on set means setting the array replaces all existing prices
- On add, price patterns are updated
- On remove, if no other products remain, price is purged entirely

Detach selected prices without rewriting the whole array with [`remove`](#array-write-operations):

```bash
PATCH /v1/products/{key}/prices
{"remove": [{"identifiers": {"com.example.priceId": "CAMPAIGN-Q1"}}]}
```

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

> **Important:** Payment methods with an associated payment integration are not supported via `createPayment`. Use the payment integration's native flow instead. Query `GET /v1/payment-methods` to discover valid method IDs for your tenant.

> **Idempotent on retry.** `createPayment` is idempotent on the pair (`method`, `transactionId`): repeating the call with the same `transactionId` under the same payment method is a silent no-op (no duplicate, no error, other args ignored). This makes retries after network failures safe. See [Retry and idempotency](working-with/orders.md#create-payment) on the canonical reference for the full contract.

### Labels

Trade orders support labels for categorization. Labels use add/remove semantics — assign via `POST /v1/trade-orders/{id}/labels`, remove via `DELETE`.

> **Note:** Labels must have `applicableOnlyTo` include `"TradeOrder"` (or be unrestricted) to be assignable to orders. See the [Labels guide](../guide/examples/labels.md) for the full reference.

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

### Time-Relative Queries on Agent Sub-Collections

Both `customerRelations` and `supplierRelations` accept the same `/before/` and `/after/` path filters as the global `/v1/trade-relationships` collection, scoped to the parent agent:

```bash
# Customer relationships (this agent is the supplier) modified at/after a cutoff
GET /v1/agents/{id}/customerRelations/after/2025-01-01T00:00:00Z

# Customer relationships modified strictly before a cutoff
GET /v1/agents/{id}/customerRelations/before/2025-03-01T00:00:00Z

# Supplier relationships (this agent is the customer) modified at/after a cutoff
GET /v1/agents/{id}/supplierRelations/after/2025-01-01T00:00:00Z
```

The agent-scoped variants also work on the concrete `/people`, `/companies`, and `/stores` collections (e.g. `/v1/companies/{id}/customerRelations/after/{ts}`).

The filter is on `_modifiedTag` **AND** the agent's role:

- `/agents/SUPPLIER-A/customerRelations/after/{ts}` returns only relationships where `SUPPLIER-A` is the `supplierAgent` **and** `_modifiedTag >= ts`. It does **not** include relationships where some other agent is the supplier, nor relationships where this agent appears as the `customerAgent` — for that, use `supplierRelations`.

**Mode parameter** — matches the global `/v1/trade-relationships` endpoint:

- `before/<ts>` / `after/<ts>` (no parens) = `before(modify)/<ts>` — the default.
- `before(modify)/<ts>` / `after(modify)/<ts>` — explicit; filters on last-modification time.
- `(create)` is **not supported** here (returns 404) — trade relationships are not modelled as discrete events and have no creation span.
- `(status)` returns 404 (not implemented).

See [Operators → Time-relative queries](operators.md#time-relative-queries-before-and-after) for the shared mode-parameter semantics, inclusivity rules, and chaining behaviour.

**Response shape:** identical to the global `/v1/trade-relationships/before|after` — a JSON array of trade-relationship objects, sorted ascending by `_modifiedTag`. The path returns an ordinary collection, so `~with(...)`, `~just(...)`, `~take(N)`, and `~skip(N)` chain in the usual way.

---

## Validity Windows

Several resources bound their period of validity with a **start/end pair**. The members are named differently on each resource, but they all behave identically on write: the payload is merged over what is stored, and the **resulting** window is validated as a whole.

| Resource | Endpoint | Window members |
|----------|----------|----------------|
| Trade rule (discount, price, surcharge) | `/v1/discount-rules`, `/v1/price-rules`, `/v1/surcharge-rules` | `time.start` / `time.end` |
| Price | `/v1/prices`, `/v1/products/{key}/prices` | `from` / `to` |
| Trade restriction | `/v1/trade-restrictions` | `from` / `until` |
| Project reference | `/v1/trade-relationships/{key}/projectReferences` | `validFrom` / `validTo` |
| Period window | `/v1/seasons`, `/v1/campaigns` | `purchaseWindow.start` / `.end`, `salesWindow.start` / `.end` |

Only the trade rule keeps its bounds in a nested `time` object; on the other resources they are flat members of the resource itself. That difference is cosmetic — a flat pair sent in one payload is still applied atomically, exactly like a nested one.

### Merge semantics on `PATCH` and `PUT`

| In the payload | Result |
|----------------|--------|
| Bound present with a value | Set to that value |
| Bound absent | Keeps its stored value |
| Bound present as `null` | Cleared — open-ended in that direction |

Both bounds are optional on write everywhere in the table. A window with neither bound set is unbounded in both directions.

Validation always runs against the resulting window — what you sent, merged over what was stored — and the resulting end must be later than the resulting start.

### Send both bounds together when moving a window

A payload carrying both bounds in the same request is validated and applied **as a whole**, so a window can be moved to a period lying entirely after (or before) its current one in a single call:

```bash
# Price currently valid 2026-02-01 → 2026-02-28; move the whole window into June
PATCH /v1/prices/com.example.priceId=PROD-001-PROMO
{"from": "2026-06-04T05:00:00Z", "to": "2026-06-16T21:59:00Z"}
```

The new `from` (June) is later than the *stored* `to` (February), but that pairing is never the resulting window, so the request succeeds. Patching the far bound first and the near bound second still works and remains valid — it is simply no longer necessary.

### Clearing a bound

```bash
# Drop the expiry; the price stays valid indefinitely from its existing start
PATCH /v1/prices/com.example.priceId=PROD-001-PROMO
{"to": null}
```

### Invalid windows

A resulting window whose end is not later than its start is rejected with **`400` Bad Request** and the message:

```
The end date, if specified, must be greater than the start date.
```

The stored window is left untouched. This covers the single-bound case: patching only the start bound to a date after the stored end bound inverts the window and fails. Swapping the bounds of the example above — `{"from": "2026-06-16T21:59:00Z", "to": "2026-06-04T05:00:00Z"}` — fails the same way. When moving a bound past its stored counterpart, send both bounds.

### Resource-specific notes

**Project references** are a keyed map on the trade relationship (`/v1/trade-relationships/{key}/projectReferences`). A `PATCH` naming a key that is not already present is a silent no-op — it does not create the reference. Only references that already exist can have their `validFrom` / `validTo` updated this way. See [Working with Customers → Project References](working-with/customers.md#project-references).

**Period windows** are the two windows on a trade period — `purchaseWindow` (when buying happens) and `salesWindow` (when selling happens). Seasons and campaigns are both periods and carry both windows:

```bash
# Move a season's sales window; both bounds in one call, applied atomically
PATCH /v1/seasons/com.example.seasonId=SS26
{"salesWindow": {"start": "2026-06-04T05:00:00Z", "end": "2026-06-16T21:59:00Z"}}
```

Each window is merged and validated independently, so a payload may move `purchaseWindow` and `salesWindow` in the same request.

> **Create periods through `/v1/seasons` or `/v1/campaigns`.** A period created directly through `POST /v1/periods` cannot store window spans, so its `purchaseWindow` / `salesWindow` bounds do not persist.

See [gotcha 27](common-gotchas.md#27-patching-one-validity-window-bound-can-invert-the-window) for the short form.

---

## Trade Rules

Trade rules define discounting and pricing logic.

**Concept focus:** This section covers how trade rules behave (discount types, phases, and pricing logic). Use your tenant's `/api-docs` for the canonical endpoint list.

### Validity Window (`time`)

Discount rules, price rules, and surcharge rules — `/v1/discount-rules`, `/v1/price-rules`, `/v1/surcharge-rules` — all share the same optional `time` member: the period during which the rule is eligible to fire.

```bash
POST /v1/discount-rules
{
  "identifiers": {"com.example.discountRuleId": "spring-sale"},
  "time": {"start": "2026-03-01T00:00:00", "end": "2026-05-31T23:59:59"},
  "items": { ... },
  "effects": [ ... ]
}
```

Both bounds are optional. A rule with no `time` at all — or with one bound left unset — is unbounded in that direction.

> **Not the same as a price's `from` / `to`.** Those bound an individual price; `time` bounds a *rule*. See [Working with Prices → Validity Periods](working-with/prices.md#validity-periods).

The rules below are the shared start/end-pair contract described under [Validity Windows](#validity-windows), stated here in terms of `time`.

#### Merge semantics on `PATCH` and `PUT`

| In the payload | Result |
|----------------|--------|
| Bound present with a value | Set to that value |
| Bound absent | Keeps its stored value |
| Bound present as `null` | Cleared — open-ended in that direction |

Validation always runs against the **resulting** window (what you sent, merged over what was stored), and the resulting `end` must be later than the resulting `start`.

#### Send both bounds together when moving a window

A payload carrying `start` and `end` in the same request is validated and applied **as a whole**, so a rule can be moved to a period that lies entirely after its current one in a single call:

```bash
# Currently valid 2026-03-01 → 2026-05-31; move the whole window to the autumn
PATCH /v1/discount-rules/com.example.discountRuleId=spring-sale
{"time": {"start": "2026-09-01T00:00:00", "end": "2026-11-30T23:59:59"}}
```

The new `start` (September) is later than the *stored* `end` (May), but that combination is never the resulting window, so the request succeeds. Patching `end` first and `start` second still works and remains valid — it is simply no longer necessary.

#### Clearing a bound

```bash
# Drop the expiry; the rule runs indefinitely from its existing start
PATCH /v1/discount-rules/com.example.discountRuleId=spring-sale
{"time": {"end": null}}
```

#### Invalid windows

A resulting window whose `end` is not later than its `start` is rejected with **`400` Bad Request** and the message:

```
The end date, if specified, must be greater than the start date.
```

The rule is left untouched. This covers the single-bound case too: patching only `start` to a date after the stored `end` inverts the window and fails. When you are moving a bound past its stored counterpart, send both bounds. See [gotcha 27](common-gotchas.md#27-patching-one-validity-window-bound-can-invert-the-window).

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

`from` and `to` follow the shared start/end-pair contract — see [Validity Windows](#validity-windows) for merge semantics, moving a window in one call, and the `400` on an inverted window.

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
GET /receipts/after/2024-12-01T00:00:00Z~take(100)
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
