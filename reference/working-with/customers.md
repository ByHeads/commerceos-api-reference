# Working with Customers

This guide is the definitive playbook for customer management in CommerceOS. It covers the customer domain end-to-end: people, companies, stores, addresses, contact methods, trade relationships, customer groups, and integration patterns.

---

## Table of Contents

1. [Overview](#overview)
2. [Glossary](#glossary)
3. [Agent Types](#agent-types)
4. [Field Reference](#field-reference)
5. [People (Individuals)](#people-individuals)
6. [Companies](#companies)
7. [Stores](#stores)
8. [Addresses](#addresses)
9. [Contact Methods](#contact-methods)
10. [Trade Relationships](#trade-relationships)
11. [Agent Finder](#agent-finder)
12. [Customer Groups and Labels](#customer-groups-and-labels)
13. [Timeline and History](#timeline-and-history)
14. [Endpoint Matrix](#endpoint-matrix)
15. [Error Handling and Validation](#error-handling-and-validation)
16. [Integration Playbook: Customer Sync](#integration-playbook-customer-sync)
17. [Case Study: B2B Customer Onboarding](#case-study-b2b-customer-onboarding)
18. [Business Rules and Pitfalls](#business-rules-and-pitfalls)
19. [Related Guides](#related-guides)

---

## Overview

Customers in CommerceOS are represented as **agents** - a unified concept that encompasses all parties in commercial transactions. The agent model provides consistent handling of identifiers, addresses, and contact methods across different entity types.

**Key Characteristics:**
- All agents share common members (addresses, contactMethods, identifiers, labels)
- Agents can be both customers AND suppliers in different contexts
- Trade relationships track business connections between agents
- Person `name` is computed from `givenName` + `familyName`

**Domain Relationships:**
```
Agents  ↔  Trade Relationships (supplier ↔ customer)
    ↔  Trade Orders (as supplier, customer, seller, buyer)
    ↔  Receipts (as seller, buyer)
    ↔  Prices (as seller, buyer scoping)
    ↔  Stock Places (as owner)
    ↔  Assortment Contexts (as owner)
    ↔  Customer Groups (segmentation)
```

---

## Glossary

| Term | Description |
|------|-------------|
| **Agent** | Base type for all parties (people, companies, stores) |
| **Person** | Individual customer or contact |
| **Company** | Business organization |
| **Store** | Retail location or warehouse |
| **Trade Relationship** | Business connection between supplier and customer |
| **Address Slot** | Named address (main, home, invoice, delivery, visiting) |
| **Contact Method** | Communication channel (email, phone) |
| **Timeline** | Historical receipts for an agent |
| **Customer Group** | Segmentation for pricing or marketing |
| **GDPR Forgotten** | Flag indicating data erasure request |

---

## Agent Types

CommerceOS uses three agent types:

| Type | Collection | Description |
|------|------------|-------------|
| `person` | `/v1/people` | Individual customers or contacts |
| `company` | `/v1/companies` | Business organizations |
| `store` | `/v1/stores` | Retail locations, warehouses |

All agents share these common members:
- `identifiers` - External IDs (namespaced)
- `name` - Display name
- `addresses` - Named address slots
- `contactMethods` - Communication channels
- `labels` - Custom tags
- `customerRelations` / `supplierRelations` - Trade relationships
- `stockRoots` - Primary stock locations
- `assortment` / `assortmentRoots` - Product ownership
- `timeline` - Receipt history
- `preferredCurrency` - Default currency

---

## Field Reference

### Common Agent Fields

| Field | Type | Description |
|-------|------|-------------|
| `identifiers` | object | Namespaced external IDs |
| `identifiers.key` | string | System UUID (read-only) |
| `name` | string | Display name |
| `addresses` | object | Named address slots |
| `contactMethods` | object | Communication channels |
| `nationality` | string | ISO 3166-1 alpha-2 country code |
| `languages` | array | ISO 639-1 language codes |
| `vatId` | string | VAT identification number |
| `preferredCurrency` | reference | Default currency |
| `labels` | array | Custom labels |

### Person-Specific Fields

| Field | Type | Description |
|-------|------|-------------|
| `givenName` | string | First name |
| `familyName` | string | Last name |
| `fullName` | string | Combined name |
| `personalNumber` | string | National ID (SSN, personnummer) |
| `gdprForgotten` | boolean | GDPR erasure flag |

### Company-Specific Fields

| Field | Type | Description |
|-------|------|-------------|
| `organizationNumber` | string | Business registration number |
| `parent` | reference | Parent company (for subsidiaries) |
| `fiscalYearStart` | datetime | Fiscal year start date |

### Store-Specific Fields

| Field | Type | Description |
|-------|------|-------------|
| `owner` | reference | Owning company |
| `organizationNumber` | string | Store registration number |
| `openingHours` | string | Opening hours |

---

## People (Individuals)

### Creating a Person

```bash
POST /v1/people
{
  "identifiers": {"com.example.customerId": "CUST-001"},
  "givenName": "John",
  "familyName": "Doe"
}
```

### Person with Full Details

```bash
POST /v1/people
{
  "identifiers": {"com.example.customerId": "CUST-002"},
  "givenName": "Jane",
  "familyName": "Smith",
  "personalNumber": "19900101-1234",
  "nationality": "SE",
  "languages": ["sv", "en"],
  "addresses": {
    "main": {
      "line1": "Kungsgatan 1",
      "postalCode": "11143",
      "cityName": "Stockholm",
      "countryCode": "SE"
    }
  },
  "contactMethods": {
    "email": "jane@example.com",
    "mobilePhone": "+46701234567"
  }
}
```

### Person Name Behavior

The `name` field for people is computed from `givenName` + `familyName`:

```bash
# Create person
POST /v1/people
{
  "identifiers": {"com.example.customerId": "CUST-003"},
  "givenName": "Anna",
  "familyName": "Andersson"
}

# Response includes computed name
{
  "@type": "person",
  "identifiers": {...},
  "givenName": "Anna",
  "familyName": "Andersson",
  "fullName": "Anna Andersson",
  "name": "Anna Andersson"
}

# Query by name
GET /v1/people~orderBy(name)~take(50)

# Note: name requires ~with for expansion if not returned by default
GET /v1/people/com.example.customerId=CUST-003~with(name)
```

### Using PUT for Upsert

```bash
PUT /v1/people/com.example.customerId=CUST-001
{
  "givenName": "John",
  "familyName": "Doe",
  "contactMethods": {"email": "john.new@example.com"}
}
```

---

## Companies

### Creating a Company

```bash
POST /v1/companies
{
  "identifiers": {"com.example.companyId": "COMP-001"},
  "name": "Acme Corporation",
  "organizationNumber": "556123-4567"
}
```

### Company with Full Details

```bash
POST /v1/companies
{
  "identifiers": {"com.example.companyId": "COMP-002"},
  "name": "Nordic Industries AB",
  "organizationNumber": "556789-0123",
  "vatId": "SE556789012301",
  "fiscalYearStart": "2024-01-01T00:00:00Z",
  "nationality": "SE",
  "languages": ["sv", "en"],
  "addresses": {
    "main": {
      "line1": "Industrivägen 10",
      "postalCode": "12345",
      "cityName": "Göteborg",
      "countryCode": "SE"
    },
    "invoice": {
      "line1": "Box 100",
      "postalCode": "12346",
      "cityName": "Göteborg",
      "countryCode": "SE"
    }
  },
  "contactMethods": {
    "email": "info@nordicindustries.se",
    "landlinePhone": "+46317001000"
  }
}
```

### Company with Subsidiary

> **Important:** The `parent` setter uses `Agent.fromKey()` and only accepts `identifiers.key` (the database key). You must first retrieve the parent's database key, then use it to set the relationship.

```bash
# Step 1: Create parent company
POST /v1/companies
{
  "identifiers": {"com.example.companyId": "CORP-001"},
  "name": "Acme Corporation"
}

# Step 2: Retrieve the parent company's database key
# Note: /identifiers/key returns a raw string (not JSON-quoted)
GET /v1/companies/com.example.companyId=CORP-001/identifiers/key
# Response: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4  (32-char hex string)

# Step 3: Create subsidiary using the database key
POST /v1/companies
{
  "identifiers": {"com.example.companyId": "CORP-002"},
  "name": "Acme Sweden AB",
  "parent": {"identifiers": {"key": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"}}
}

# Query subsidiaries (filter by parent reference)
GET /v1/companies~where(parent/identifiers/com.example.companyId=CORP-001)
```

---

## Stores

### Creating a Store

> **Important:** The `owner` setter uses `Agent.fromKey()` and only accepts `identifiers.key` (the database key). You must first retrieve the owner company's database key, then use it to set the relationship.

```bash
# Step 1: Retrieve the owning company's database key
GET /v1/companies/com.example.companyId=COMP-001/identifiers/key
# Response: b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5  (32-char hex string)

# Step 2: Create store using the database key
POST /v1/stores
{
  "identifiers": {"com.example.storeId": "STORE-001"},
  "name": "Downtown Store",
  "owner": {"identifiers": {"key": "b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5"}},
  "addresses": {
    "main": {
      "line1": "Drottninggatan 50",
      "postalCode": "11121",
      "cityName": "Stockholm",
      "countryCode": "SE"
    }
  }
}
```

### Store with Full Details

```bash
# Assumes owner key retrieved via: GET /v1/companies/{id}/identifiers/key
POST /v1/stores
{
  "identifiers": {"com.example.storeId": "STORE-002"},
  "name": "Mall of Scandinavia",
  "owner": {"identifiers": {"key": "<owner-database-key>"}},
  "organizationNumber": "556123-4567-01",
  "openingHours": "Mon-Fri 10:00-21:00, Sat-Sun 10:00-18:00",
  "addresses": {
    "main": {
      "line1": "Stjärntorget 2",
      "postalCode": "16979",
      "cityName": "Solna",
      "countryCode": "SE"
    },
    "visiting": {
      "line1": "Stjärntorget 2, Level 2",
      "postalCode": "16979",
      "cityName": "Solna",
      "countryCode": "SE"
    }
  },
  "contactMethods": {
    "landlinePhone": "+468123456",
    "email": "mallstore@example.com"
  }
}
```

### Owner vs Parent

| Relationship | Used On | Field | Setter Requirement |
|--------------|---------|-------|-------------------|
| `owner` | Stores | Links store to owning company | Requires `identifiers.key` (database key) |
| `parent` | Companies | Links subsidiary to parent company | Requires `identifiers.key` (database key) |

```bash
# Store uses "owner" - must use database key
{"owner": {"identifiers": {"key": "<database-key>"}}}

# Company uses "parent" - must use database key
{"parent": {"identifiers": {"key": "<database-key>"}}}
```

> **Note:** Both `owner` and `parent` setters use `Agent.fromKey()`, which only accepts the database key. External identifiers (like `com.example.companyId`) will not work for these setters. Retrieve the key first via `GET /v1/{collection}/{id}/identifiers/key`.

---

## Addresses

All agents share a structured address pattern with named slots.

### Address Slots

| Slot | Description |
|------|-------------|
| `main` | Primary/default address |
| `home` | Home address (for people) |
| `invoice` | Billing address |
| `delivery` | Shipping address |
| `visiting` | Physical visit address |

### Address Structure

```json
{
  "line1": "Street Name 123",
  "line2": "Apt 4B",
  "postalCode": "12345",
  "cityName": "Stockholm",
  "regionName": "Stockholm",
  "countryCode": "SE"
}
```

### Address Fields

| Field | Required | Description |
|-------|----------|-------------|
| `line1` | Yes | Street name and number |
| `line2` | No | Additional info (apt, suite) |
| `postalCode` | Yes | Postal/ZIP code |
| `cityName` | Yes | City name |
| `regionName` | No | State/province/region |
| `countryCode` | Yes | ISO 3166-1 alpha-2 |

### Reading Addresses

```bash
# Get agent with all addresses
GET /v1/people/com.example.customerId=CUST-001~with(addresses)

# Get specific address slot
GET /v1/people/com.example.customerId=CUST-001/addresses/main
GET /v1/people/com.example.customerId=CUST-001/addresses/delivery

# Check if slot exists
GET /v1/people/com.example.customerId=CUST-001/addresses/home
# Returns null if not set
```

### Updating Addresses

```bash
# Set or update delivery address
PATCH /v1/people/com.example.customerId=CUST-001
{
  "addresses": {
    "delivery": {
      "line1": "New Street 456",
      "postalCode": "11122",
      "cityName": "Stockholm",
      "countryCode": "SE"
    }
  }
}

# Update multiple slots
PATCH /v1/people/com.example.customerId=CUST-001
{
  "addresses": {
    "main": {
      "line1": "Main Street 1",
      "postalCode": "11111",
      "cityName": "Stockholm",
      "countryCode": "SE"
    },
    "delivery": {
      "line1": "Delivery Ave 2",
      "postalCode": "11112",
      "cityName": "Stockholm",
      "countryCode": "SE"
    }
  }
}
```

---

## Contact Methods

All agents share contact method slots.

### Contact Method Slots

| Slot | Description |
|------|-------------|
| `landlinePhone` | Landline phone |
| `mobilePhone` | Mobile phone |
| `workPhone` | Work phone |
| `email` | Email address |

### Phone Number Format

Phone numbers should include the country code:

```bash
# Correct formats
"+46701234567"   # Sweden mobile
"+4687654321"    # Sweden landline
"+1234567890"    # US
```

### Reading Contact Methods

```bash
# Get agent with contact methods
GET /v1/people/com.example.customerId=CUST-001~with(contactMethods)

# Get specific method
GET /v1/people/com.example.customerId=CUST-001/contactMethods/email
GET /v1/people/com.example.customerId=CUST-001/contactMethods/mobilePhone
```

### Updating Contact Methods

```bash
PATCH /v1/people/com.example.customerId=CUST-001
{
  "contactMethods": {
    "email": "new@example.com",
    "mobilePhone": "+46709876543"
  }
}
```

> **Important:** Use `contactMethods`, not `contactPoints`. This is a common mistake.

---

## Trade Relationships

Trade relationships connect suppliers and customers for B2B or B2C commerce.

### Creating a Relationship

```bash
POST /v1/trade-relationships
{
  "identifiers": {"com.example.relId": "REL-001"},
  "supplierAgent": {"identifiers": {"com.example.companyId": "OUR-COMPANY"}},
  "customerAgent": {"identifiers": {"com.example.customerId": "CUST-001"}},
  "defaultCurrency": {"identifiers": {"currencyCode": "SEK"}}
}
```

### Relationship with Terms

```bash
POST /v1/trade-relationships
{
  "identifiers": {"com.example.relId": "REL-002"},
  "supplierAgent": {"identifiers": {"com.example.companyId": "OUR-COMPANY"}},
  "customerAgent": {"identifiers": {"com.example.companyId": "WHOLESALE-CUST"}},
  "defaultCurrency": {"identifiers": {"currencyCode": "SEK"}},
  "creditAllowed": true,
  "allowsBackOrder": true,
  "acceptedMembershipTerms": true,
  "intervalStart": "2024-01-01T00:00:00Z",
  "intervalEnd": "2024-12-31T23:59:59Z"
}
```

### Relationship Fields

| Field | Type | Description |
|-------|------|-------------|
| `supplierAgent` | reference | Agent providing goods/services |
| `customerAgent` | reference | Agent receiving goods/services |
| `defaultCurrency` | reference | Default transaction currency |
| `creditAllowed` | boolean | Allow credit purchases |
| `allowsBackOrder` | boolean | Allow backorders |
| `intervalStart` | datetime | Validity start |
| `intervalEnd` | datetime | Validity end |
| `supplierId` | string | Supplier's local reference ID |
| `customerId` | string | Customer's local reference ID |
| `acceptedMembershipTerms` | boolean | Membership flag |
| `acceptedPromotionalMaterial` | boolean | Marketing consent |

### Querying Relationships

```bash
# List all relationships
GET /v1/trade-relationships~take(50)

# Get with agents expanded
GET /v1/trade-relationships/com.example.relId=REL-001~with(supplierAgent,customerAgent)

# Company's customers (where company is supplier)
GET /v1/companies/com.example.companyId=OUR-COMPANY/customerRelations

# Company's suppliers (where company is customer)
GET /v1/companies/com.example.companyId=OUR-COMPANY/supplierRelations

# Person's supplier relationships
GET /v1/people/com.example.customerId=CUST-001/supplierRelations
```

---

## Agent Finder

The agent finder provides heuristic lookup across agent types.

> **Important:** The agent finder is a **method type**, which requires **PUT** (not POST). POST is restricted to array types in the API.

### Find by Email

```bash
PUT /v1/agents/@find
{"email": "john@example.com"}
```

### Find by Phone

```bash
PUT /v1/agents/@find
{"phone": "+46701234567"}
```

### Find by National ID

```bash
PUT /v1/agents/@find
{"nationalId": "1990010112345"}
```

### Find by Name

```bash
PUT /v1/agents/@find
{"name": "John Doe"}
```

Name matching uses metaphone (phonetic) for approximate name search.

### Finder Response

The finder returns an object with `modifiedTag` and `results`:

```json
{
  "modifiedTag": "2024-01-15T10:30:00Z",
  "results": [
    {
      "@type": "person",
      "identifiers": {"com.example.customerId": "CUST-001", "key": "..."},
      "givenName": "John",
      "familyName": "Doe"
    }
  ]
}
```

### Navigate Finder Results

```bash
# Get results with modifiedTag for change tracking
PUT /v1/agents/@find
{"email": "john@example.com"}
# Response: { "modifiedTag": "...", "results": [...] }

# To get just the results array directly:
PUT /v1/agents/@find/results
{"email": "john@example.com"}
# Response: [{ "@type": "person", ... }]
```

---

## Customer Groups and Labels

### Customer Groups

Organize customers into groups for pricing, promotions, or segmentation.

> **Important:** The `/people|companies/{id}/customerGroups` collection lists groups **owned** by the agent, not group membership. Customer group membership is managed via the trade relationship's `groups` member.

**Creating a Customer Group:**

> **Note:** The `owner` setter for customer groups uses `Agent.fromKey()` and requires `identifiers.key` (the database key).

```bash
# Step 1: Get the owning company's database key
GET /v1/companies/com.example.companyId=OUR-COMPANY/identifiers/key
# Response: c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6  (32-char hex string)

# Step 2: Create the group with owner using database key
POST /v1/customer-groups
{
  "identifiers": {"com.example.groupId": "VIP-CUSTOMERS"},
  "name": "VIP Customers",
  "owner": {"identifiers": {"key": "c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6"}}
}
```

**Assigning Membership via Trade Relationship:**

```bash
# First, ensure a trade relationship exists between supplier and customer
# Then assign the customer to the group via the relationship's groups member
POST /v1/trade-relationships/com.example.relId=REL-001/groups
{"identifiers": {"com.example.groupId": "VIP-CUSTOMERS"}}
```

**Querying Group Membership:**

```bash
# Get groups a customer belongs to (via their trade relationship)
GET /v1/trade-relationships/com.example.relId=REL-001/groups

# Find all trade relationships in a specific group
GET /v1/trade-relationships~where(groups~any(identifiers/com.example.groupId=VIP-CUSTOMERS))
```

**Note:** Posting to `/v1/people/{id}/customerGroups` sets the person as the group's **owner**, which is typically used for B2B scenarios where a company owns customer groups for their own customers.

### Labels

Apply labels for custom segmentation:

```bash
# Create customer label (applicable to people and companies)
POST /v1/labels
{
  "identifiers": {"com.example.labelId": "vip"},
  "title": "VIP Customer",
  "color": "#FFD700",
  "applicableOnlyTo": ["person", "company"]
}

# Assign label to a person
POST /v1/people/com.example.customerId=CUST-001/labels
{"identifiers": {"com.example.labelId": "vip"}}

# Get person's labels
GET /v1/people/com.example.customerId=CUST-001/labels

# Find people with label
GET /v1/people~with(labels)~where(labels~any(identifiers/com.example.labelId=vip))~take(20)
```

**Supplier/Company Labels:**

```bash
# Create a label for suppliers
POST /v1/labels
{
  "identifiers": {"com.example.labelId": "preferred-supplier"},
  "title": "Preferred Supplier",
  "color": "#00AA00",
  "applicableOnlyTo": ["company"]
}

# Assign label to a supplier (companies are at /v1/companies)
POST /v1/companies/com.example.companyId=SUP-001/labels
{"identifiers": {"com.example.labelId": "preferred-supplier"}}

# Get supplier's labels
GET /v1/companies/com.example.companyId=SUP-001/labels

# Find suppliers with label
GET /v1/companies~with(labels)~where(labels~any(identifiers/com.example.labelId=preferred-supplier))~take(20)
```

> **Note:** Labels can also be assigned to trade orders, stores, POS terminals, and users using the same `POST /{resource}/{id}/labels` pattern. See [Orders](orders.md) for order label examples.

---

## Timeline and History

Access customer transaction history:

```bash
# Get customer's receipt timeline
GET /v1/people/com.example.customerId=CUST-001/timeline~take(50)

# With ordering
GET /v1/people/com.example.customerId=CUST-001/timeline~orderBy(timestamp:desc)~take(50)

# Company timeline
GET /v1/companies/com.example.companyId=COMP-001/timeline~take(50)
```

The `timeline` returns receipts where the agent is the buyer.

---

## Endpoint Matrix

### When to Use What

| Goal | Method | Endpoint | Notes |
|------|--------|----------|-------|
| List people | GET | `/v1/people~take(50)` | Paginate with `~skip` |
| List companies | GET | `/v1/companies~take(50)` | Paginate with `~skip` |
| List stores | GET | `/v1/stores~take(50)` | Paginate with `~skip` |
| Get single agent | GET | `/v1/{collection}/{id}` | By identifier |
| Create agent | POST | `/v1/{collection}` | Returns created agent |
| Create or update | PUT | `/v1/{collection}/{id}` | Upsert by identifier |
| Update agent | PATCH | `/v1/{collection}/{id}` | Partial update |
| Find by email/phone | PUT | `/v1/agents/@find` | Method type (heuristic lookup) |
| Get relationships | GET | `/v1/{collection}/{id}/customerRelations` | As supplier |
| Get timeline | GET | `/v1/{collection}/{id}/timeline` | Receipt history |

---

## Error Handling and Validation

### Common 4xx Errors

| Status | Cause | Resolution |
|--------|-------|------------|
| 400 | Invalid identifier format | Use `com.namespace.key` |
| 400 | Missing required field | Include givenName/familyName (person), name (company) |
| 400 | Invalid phone format | Include country code (+46...) |
| 400 | Invalid country code | Use ISO 3166-1 alpha-2 |
| 404 | Agent not found | Verify identifier exists |
| 409 | Duplicate identifier | Use PUT for upsert |

### Validation Rules

1. **Namespaced identifiers required:**
   ```bash
   # WRONG
   {"identifiers": {"customerId": "..."}}

   # RIGHT
   {"identifiers": {"com.example.customerId": "..."}}
   ```

2. **Phone numbers need country code:**
   ```bash
   # WRONG
   {"mobilePhone": "0701234567"}

   # RIGHT
   {"mobilePhone": "+46701234567"}
   ```

3. **Use `contactMethods`, not `contactPoints`:**
   ```bash
   # WRONG
   {"contactPoints": {"email": "..."}}

   # RIGHT
   {"contactMethods": {"email": "..."}}
   ```

4. **Stores use `owner`, companies use `parent` (both require database key):**
   ```bash
   # WRONG - external identifiers don't work for owner/parent setters
   {"owner": {"identifiers": {"com.example.companyId": "..."}}}
   {"parent": {"identifiers": {"com.example.companyId": "..."}}}

   # RIGHT - use database key from GET /{collection}/{id}/identifiers/key
   {"owner": {"identifiers": {"key": "<database-key>"}}}
   {"parent": {"identifiers": {"key": "<database-key>"}}}
   ```

### Preconditions

- Referenced agents must exist (owner, parent, supplier, customer)
- Currency must exist for trade relationships
- Labels must exist before assignment

---

## Integration Playbook: Customer Sync

This section provides a phased approach to building a customer integration.

### Phase 1: Create Agents

**Checkpoint:** Customers and companies exist

```bash
# Create customers
PUT /v1/people/com.example.customerId=YOUR-ID
{
  "givenName": "John",
  "familyName": "Doe",
  "contactMethods": {"email": "john@example.com"}
}

# Create companies
PUT /v1/companies/com.example.companyId=COMP-001
{
  "name": "Customer Company",
  "organizationNumber": "556123-4567"
}
```

### Phase 2: Set Up Addresses

**Checkpoint:** Agents have proper addresses

```bash
PATCH /v1/people/com.example.customerId=YOUR-ID
{
  "addresses": {
    "main": {
      "line1": "Home Street 1",
      "postalCode": "12345",
      "cityName": "Stockholm",
      "countryCode": "SE"
    },
    "delivery": {
      "line1": "Delivery Street 2",
      "postalCode": "12346",
      "cityName": "Stockholm",
      "countryCode": "SE"
    }
  }
}
```

### Phase 3: Create Trade Relationships

**Checkpoint:** Business relationships established

```bash
POST /v1/trade-relationships
{
  "identifiers": {"com.example.relId": "REL-YOUR-ID"},
  "supplierAgent": {"identifiers": {"com.example.companyId": "YOUR-COMPANY"}},
  "customerAgent": {"identifiers": {"com.example.customerId": "YOUR-ID"}},
  "defaultCurrency": {"identifiers": {"currencyCode": "SEK"}}
}
```

### Phase 4: Assign Groups/Labels

**Checkpoint:** Segmentation applied

```bash
# Assign customer to group via their trade relationship
# (Customer group membership is on trade relationships, not directly on agents)
POST /v1/trade-relationships/com.example.relId=REL-YOUR-ID/groups
{"identifiers": {"com.example.groupId": "RETAIL-CUSTOMERS"}}

# Assign label directly to the person
POST /v1/people/com.example.customerId=YOUR-ID/labels
{"identifiers": {"com.example.labelId": "new-customer"}}
```

### Phase 5: Verification

```bash
# Verify customer with all expansions
GET /v1/people/com.example.customerId=YOUR-ID~with(addresses,contactMethods,labels,supplierRelations)

# Verify trade relationship with groups
GET /v1/trade-relationships/com.example.relId=REL-YOUR-ID~with(groups,customerAgent,supplierAgent)
```

---

## Case Study: B2B Customer Onboarding

This case study demonstrates onboarding a B2B wholesale customer.

### Scenario

- New wholesale company wanting to buy from your company
- Needs invoice and delivery addresses
- Requires credit terms
- Should have wholesale pricing

### Step 1: Create the Company

```bash
POST /v1/companies
{
  "identifiers": {"com.example.companyId": "WHOLESALE-001"},
  "name": "Nordic Retailers AB",
  "organizationNumber": "556999-8888",
  "vatId": "SE556999888801",
  "addresses": {
    "main": {
      "line1": "Grossistvägen 100",
      "postalCode": "41250",
      "cityName": "Göteborg",
      "countryCode": "SE"
    },
    "invoice": {
      "line1": "Box 500, Finance Department",
      "postalCode": "41251",
      "cityName": "Göteborg",
      "countryCode": "SE"
    },
    "delivery": {
      "line1": "Warehouse Dock 3",
      "postalCode": "41252",
      "cityName": "Göteborg",
      "countryCode": "SE"
    }
  },
  "contactMethods": {
    "email": "orders@nordicretailers.se",
    "landlinePhone": "+4631100100"
  }
}
```

### Step 2: Create Contact Person

```bash
POST /v1/people
{
  "identifiers": {"com.example.contactId": "CONTACT-WS001"},
  "givenName": "Erik",
  "familyName": "Johansson",
  "contactMethods": {
    "email": "erik.johansson@nordicretailers.se",
    "mobilePhone": "+46701234567"
  }
}
```

### Step 3: Establish Trade Relationship

```bash
POST /v1/trade-relationships
{
  "identifiers": {"com.example.relId": "REL-WS001"},
  "supplierAgent": {"identifiers": {"com.example.companyId": "OUR-COMPANY"}},
  "customerAgent": {"identifiers": {"com.example.companyId": "WHOLESALE-001"}},
  "defaultCurrency": {"identifiers": {"currencyCode": "SEK"}},
  "creditAllowed": true,
  "allowsBackOrder": true,
  "customerId": "WS-001"
}
```

### Step 4: Assign Wholesale Group

```bash
# Assign to wholesale customer group via the trade relationship (for pricing)
# Customer group membership is managed via trade relationships, not agent collections
POST /v1/trade-relationships/com.example.relId=REL-WS001/groups
{"identifiers": {"com.example.groupId": "WHOLESALE-CUSTOMERS"}}

# Assign label directly to the company
POST /v1/companies/com.example.companyId=WHOLESALE-001/labels
{"identifiers": {"com.example.labelId": "verified-business"}}
```

### Step 5: Create Wholesale Prices

```bash
# Create wholesale price for products
# Required fields: sellers, buyers, from, to (or defaults apply)
POST /v1/prices
{
  "identifiers": {"com.example.priceId": "PROD-001-WHOLESALE"},
  "products": [{"identifiers": {"com.example.sku": "PROD-001"}}],
  "sellers": [{"identifiers": {"com.example.companyId": "OUR-COMPANY"}}],
  "buyers": [{"identifiers": {"com.example.companyId": "WHOLESALE-001"}}],
  "amount": "150.00",
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "from": "2024-01-01T00:00:00Z",
  "to": "2099-12-31T23:59:59Z"
}
```

> **Note:** If `buyers` is omitted or empty `[]`, the price applies to all buyers. If `from`/`to` are omitted, the price defaults to `Time.always` (always valid). The example above explicitly sets these for clarity.

### Step 6: First Order

```bash
POST /v1/trade-orders
{
  "identifiers": {"com.example.orderId": "ORD-WS001-001"},
  "supplier": {"identifiers": {"com.example.companyId": "OUR-COMPANY"}},
  "customer": {"identifiers": {"com.example.companyId": "WHOLESALE-001"}},
  "sellers": [{"identifiers": {"com.example.storeId": "WAREHOUSE-MAIN"}}],
  "currency": {"identifiers": {"currencyCode": "SEK"}},
  "items": [
    {
      "product": {"identifiers": {"com.example.sku": "PROD-001"}},
      "quantity": 100
    }
  ]
}
```

### Final Verification

```bash
# Verify complete customer setup
GET /v1/companies/com.example.companyId=WHOLESALE-001~with(addresses,contactMethods,labels,supplierRelations)

# Check relationship with group membership
GET /v1/trade-relationships/com.example.relId=REL-WS001~with(supplierAgent,customerAgent,groups)

# Verify pricing
GET /v1/prices~where(buyers~any(identifiers/com.example.companyId=WHOLESALE-001))~take(10)
```

---

## Business Rules and Pitfalls

### Critical Rules

1. **Agent finder uses PUT (method type, not array):**
   ```bash
   # WRONG - GET doesn't send body
   GET /v1/agents/@find?email=...

   # WRONG - POST is restricted to array types
   POST /v1/agents/@find
   {"email": "..."}

   # RIGHT - PUT for method types
   PUT /v1/agents/@find
   {"email": "..."}
   ```

2. **Use `contactMethods`, not `contactPoints`:**
   ```bash
   # WRONG
   {"contactPoints": {"email": "..."}}

   # RIGHT
   {"contactMethods": {"email": "..."}}
   ```

3. **Phone numbers need country code:**
   ```bash
   # Include country code
   {"mobilePhone": "+46701234567"}
   ```

4. **Stores use `owner`, companies use `parent`:**
   ```bash
   # For stores
   {"owner": {"identifiers": {...}}}

   # For company subsidiaries
   {"parent": {"identifiers": {...}}}
   ```

5. **Namespaced identifiers required:**
   ```bash
   # WRONG
   {"identifiers": {"customerId": "..."}}

   # RIGHT
   {"identifiers": {"com.example.customerId": "..."}}
   ```

6. **Query params and operators can be mixed:**
   Query parameters are normalized into operators in canonical order: `format → fields → where → orderBy → skip → take → simpleJust`. Mixing is supported:
   ```bash
   # Both of these are valid and produce the same result:
   GET /v1/people~orderBy(name)?limit=10
   GET /v1/people~orderBy(name)~take(10)

   # The system normalizes query params after path operators
   ```

### Common Mistakes

| Mistake | Result | Fix |
|---------|--------|-----|
| `contactPoints` instead of `contactMethods` | Field ignored | Use `contactMethods` |
| Phone without country code | Finder may fail | Include `+` and country code |
| `parent` on store | Field rejected | Use `owner` for stores |
| Bare identifier keys | 400 Bad Request | Use `com.namespace.key` |
| GET for agent finder | 405 Method Not Allowed | Use PUT |
| POST for agent finder | 405 Method Not Allowed | Use PUT (method types require PUT) |

### Address Considerations

- All address fields are stored as provided (no normalization)
- Country code validation uses ISO 3166-1 alpha-2
- Postal code format is not validated (varies by country)

### GDPR Considerations

```bash
# Mark person as forgotten (GDPR erasure)
PATCH /v1/people/com.example.customerId=CUST-001
{
  "gdprForgotten": true
}
```

When `gdprForgotten: true`, personal data is masked in responses.

---

## Related Guides

- [Products](products.md) - Assortment contexts per owner
- [Prices](prices.md) - Buyer-specific pricing
- [Orders](orders.md) - Customer/supplier in trade orders
- [Stock](stock.md) - Agent stock roots
- [Receipts](../receipts.md) - Transaction history
