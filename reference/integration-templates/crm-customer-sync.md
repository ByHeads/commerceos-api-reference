# CRM Integration Guide: Customer Data Synchronization

This guide provides a comprehensive template for integrating CommerceOS with a Customer Relationship Management (CRM) system. It covers bidirectional customer data sync, identifier strategies, conflict resolution, GDPR compliance, and operational patterns for production deployments.

---

## Executive Summary

Customer data synchronization is the backbone of unified commerce. When your CRM and CommerceOS share accurate, up-to-date customer information, you unlock:

- **360-degree customer view** — Sales, support, and marketing teams see the same customer data
- **Personalized pricing** — Customer-specific pricing and discounts based on CRM segments
- **Accurate analytics** — Transaction data ties back to CRM customer records
- **Compliance confidence** — GDPR and consent handling flows through both systems

This guide provides a production-ready integration template with copy-paste payloads, sequence diagrams, and operational patterns.

---

## Table of Contents

1. [Business Value and ROI](#business-value-and-roi)
2. [Data Model Overview](#data-model-overview)
3. [Identifier Strategy](#identifier-strategy)
4. [Integration Architecture](#integration-architecture)
5. [Phase 1: Initial Customer Load](#phase-1-initial-customer-load)
6. [Phase 2: Bidirectional Sync](#phase-2-bidirectional-sync)
7. [Phase 3: Deduplication and Conflict Resolution](#phase-3-deduplication-and-conflict-resolution)
8. [Phase 4: GDPR and Consent Management](#phase-4-gdpr-and-consent-management)
9. [Webhook Configuration](#webhook-configuration)
10. [Pagination and Delta Sync](#pagination-and-delta-sync)
11. [Error Handling and Recovery](#error-handling-and-recovery)
12. [Production Checklist](#production-checklist)
13. [Copy-Paste Payload Reference](#copy-paste-payload-reference)

---

## Business Value and ROI

### Quantifiable Benefits

| Benefit | Impact | How CommerceOS Enables It |
|---------|--------|---------------------------|
| **Reduced data entry** | 40-60% less manual customer creation | PUT-based upserts from CRM master |
| **Faster checkout** | 20-30% reduction in new customer friction | Agent finder locates existing records |
| **Accurate segmentation** | Customer groups drive dynamic pricing | Trade relationships + customer groups |
| **Compliance automation** | Automated GDPR erasure workflows | `gdprForgotten` flag propagation |
| **Single source of truth** | Eliminate "which system is correct?" debates | Clear identifier mapping |

### Integration Cost vs Value

The investment in proper CRM integration pays off through:

1. **Operational efficiency** — Staff don't manually re-key customer data
2. **Data quality** — Consistent customer records across systems
3. **Customer experience** — Staff see purchase history, preferences, and status
4. **Regulatory compliance** — Centralized consent and erasure handling

---

## Data Model Overview

### Agent Types in CommerceOS

CommerceOS uses an "agent" model where all parties (people, companies, stores) share common capabilities:

| Agent Type | Collection | Description | CRM Equivalent |
|------------|------------|-------------|----------------|
| `person` | `/v1/people` | Individual customers, contacts | Contact, Lead |
| `company` | `/v1/companies` | Business organizations | Account, Organization |
| `store` | `/v1/stores` | Retail locations | (Usually not in CRM) |

### Common Agent Members

All agents share these members relevant to CRM sync:

| Member | Type | Description |
|--------|------|-------------|
| `identifiers` | object | Namespaced external IDs (CRM ID goes here) |
| `name` | string | Display name |
| `addresses` | object | Named address slots (main, home, invoice, delivery) |
| `contactMethods` | object | Email, phone, mobile |
| `labels` | array | Custom tags for segmentation |
| `customerGroups` | array | Customer groups **owned** by this agent (not membership) |
| `preferredCurrency` | reference | Default transaction currency |
| `nationality` | string | ISO 3166-1 alpha-2 country code |
| `languages` | array | Preferred languages |

### Person-Specific Fields

| Field | Type | Description |
|-------|------|-------------|
| `givenName` | string | First name |
| `familyName` | string | Last name |
| `fullName` | string | Computed from givenName + familyName |
| `personalNumber` | string | National ID (SSN, personnummer) |
| `gdprForgotten` | boolean | GDPR erasure flag |

### Company-Specific Fields

| Field | Type | Description |
|-------|------|-------------|
| `organizationNumber` | string | Business registration number |
| `vatId` | string | VAT identification number |
| `parent` | reference | Parent company (subsidiaries) |
| `fiscalYearStart` | datetime | Fiscal year start date |

---

## Identifier Strategy

The identifier strategy is the **most critical decision** in your integration. Get this right and everything flows smoothly; get it wrong and you'll spend months debugging data mismatches.

### Recommended: Dual-Identifier Approach

Store both your CRM's internal ID and any business identifiers:

```json
{
  "identifiers": {
    "com.yourcompany.crm-id": "CRM-CUST-00001234",
    "com.yourcompany.email": "john.doe@example.com"
  }
}
```

### Namespace Convention

Use reverse-domain notation based on your actual domain:

| Your Domain | Namespace Prefix | Example Identifier |
|-------------|------------------|-------------------|
| `acme.com` | `com.acme.` | `com.acme.crm-id` |
| `retailcorp.se` | `se.retailcorp.` | `se.retailcorp.customer-id` |
| `example-retail.io` | `io.example-retail.` | `io.example-retail.crm-customer` |

### Identifier Key Naming

| CRM Entity | Recommended Key | Notes |
|------------|-----------------|-------|
| Customer ID | `com.acme.crm-id` | Primary CRM identifier |
| Email (canonical) | `com.acme.email` | For email-based dedup |
| External system ID | `com.acme.erp-id` | If syncing through multiple systems |
| Loyalty number | `com.acme.loyalty-id` | For loyalty program integration |

### Looking Up by Identifier

```bash
# Direct access by CRM ID
GET /v1/people/com.acme.crm-id=CRM-CUST-00001234

# Direct access by email
GET /v1/people/com.acme.email=john.doe@example.com

# Either identifier works — both point to the same record
```

### Why This Matters

1. **Upserts become trivial** — PUT by CRM ID creates or updates
2. **Dedup is deterministic** — Email identifier catches duplicates
3. **Cross-system tracing** — Follow a customer across CRM, CommerceOS, and ERP
4. **Migration flexibility** — Add new identifiers without breaking existing flows

---

## Integration Architecture

### Data Flow Patterns

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CRM System                                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐ │
│  │ Contacts │  │ Accounts │  │ Segments │  │ Consent/Preferences  │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────────┬───────────┘ │
└───────┼─────────────┼─────────────┼───────────────────┼─────────────┘
        │             │             │                   │
        ▼             ▼             ▼                   ▼
┌───────────────────────────────────────────────────────────────────────┐
│                    Integration Layer                                   │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────────────┐  │
│  │ Transform/Map  │  │ Dedup/Merge    │  │ Conflict Resolution    │  │
│  └───────┬────────┘  └───────┬────────┘  └──────────┬─────────────┘  │
└──────────┼───────────────────┼──────────────────────┼────────────────┘
           │                   │                      │
           ▼                   ▼                      ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      CommerceOS                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │  People  │  │Companies │  │ Trade        │  │ Customer        │  │
│  │          │  │          │  │ Relationships│  │ Groups/Labels   │  │
│  └──────────┘  └──────────┘  └──────────────┘  └─────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

### Sync Direction Options

| Pattern | Description | Best For |
|---------|-------------|----------|
| **CRM → CommerceOS** | CRM is master; push to CommerceOS | Most integrations |
| **CommerceOS → CRM** | CommerceOS is master; push to CRM | POS-first retailers |
| **Bidirectional** | Both systems update; sync changes | Omnichannel operations |

### Recommended: CRM-Master with Transaction Feedback

```
CRM (Master)                    CommerceOS (Operational)
     │                                │
     │  ──── Customer Data ────────►  │
     │                                │
     │  ◄─── Transaction Events ────  │
     │       (receipts, orders)       │
```

---

## Phase 1: Initial Customer Load

### Sequence: Full Customer Export

```
CRM                              Integration                        CommerceOS
 │                                    │                                  │
 │  1. Export customers (paginated)   │                                  │
 │ ─────────────────────────────────► │                                  │
 │                                    │                                  │
 │                                    │  2. Transform to CommerceOS      │
 │                                    │     schema                       │
 │                                    │                                  │
 │                                    │  3. PUT /v1/people/{id}          │
 │                                    │ ─────────────────────────────────►
 │                                    │                                  │
 │                                    │  4. Record sync status           │
 │                                    │ ◄─────────────────────────────────
 │                                    │                                  │
 │  5. Mark as synced in CRM          │                                  │
 │ ◄───────────────────────────────── │                                  │
```

### Step 1: Create/Update People (Individuals)

```bash
# Upsert a person by CRM ID
PUT /v1/people/com.acme.crm-id=CRM-CUST-00001234
Content-Type: application/json

{
  "identifiers": {
    "com.acme.crm-id": "CRM-CUST-00001234",
    "com.acme.email": "john.doe@example.com"
  },
  "fullName": "John Doe",
  "givenName": "John",
  "familyName": "Doe",
  "personalNumber": "19850615-1234",
  "nationality": "SE",
  "languages": ["sv", "en"],
  "addresses": {
    "main": {
      "line1": "Kungsgatan 1",
      "line2": "Apt 4B",
      "postalCode": "11143",
      "cityName": "Stockholm",
      "countryCode": "SE"
    },
    "delivery": {
      "line1": "Drottninggatan 50",
      "postalCode": "11121",
      "cityName": "Stockholm",
      "countryCode": "SE"
    }
  },
  "contactMethods": {
    "email": "john.doe@example.com",
    "mobilePhone": "+46701234567",
    "landlinePhone": "+4687654321"
  }
}
```

### Step 2: Create/Update Companies (B2B Accounts)

```bash
# Upsert a company by CRM ID
PUT /v1/companies/com.acme.crm-id=CRM-ACCT-00005678
Content-Type: application/json

{
  "identifiers": {
    "com.acme.crm-id": "CRM-ACCT-00005678",
    "com.acme.org-number": "5561234567"
  },
  "name": "Acme Retail AB",
  "organizationNumber": "556123-4567",
  "vatId": "SE556123456701",
  "nationality": "SE",
  "languages": ["sv", "en"],
  "fiscalYearStart": "2024-01-01T00:00:00Z",
  "addresses": {
    "main": {
      "line1": "Industrivägen 10",
      "postalCode": "12345",
      "cityName": "Göteborg",
      "countryCode": "SE"
    },
    "invoice": {
      "line1": "Box 100, Ekonomiavdelningen",
      "postalCode": "12346",
      "cityName": "Göteborg",
      "countryCode": "SE"
    },
    "delivery": {
      "line1": "Lagervägen 5, Dock 3",
      "postalCode": "12347",
      "cityName": "Göteborg",
      "countryCode": "SE"
    }
  },
  "contactMethods": {
    "email": "info@acmeretail.se",
    "landlinePhone": "+46317001000"
  }
}
```

### Step 3: Create Company Subsidiaries (Parent-Child)

```bash
# Create parent company first
PUT /v1/companies/com.acme.crm-id=CRM-ACCT-PARENT
{
  "identifiers": {"com.acme.crm-id": "CRM-ACCT-PARENT"},
  "name": "Acme Corporation",
  "organizationNumber": "556000-0001"
}

# Create subsidiary with parent reference
PUT /v1/companies/com.acme.crm-id=CRM-ACCT-CHILD
{
  "identifiers": {"com.acme.crm-id": "CRM-ACCT-CHILD"},
  "name": "Acme Sweden AB",
  "organizationNumber": "556000-0002",
  "parent": {
    "identifiers": {"com.acme.crm-id": "CRM-ACCT-PARENT"}
  }
}
```

### Step 4: Establish Trade Relationships

Trade relationships define business connections between your company and customers:

```bash
# Create trade relationship for B2B customer
POST /v1/trade-relationships
Content-Type: application/json

{
  "identifiers": {"com.acme.rel-id": "REL-ACCT-00005678"},
  "supplierAgent": {
    "identifiers": {"com.acme.company-id": "OUR-COMPANY"}
  },
  "customerAgent": {
    "identifiers": {"com.acme.crm-id": "CRM-ACCT-00005678"}
  },
  "defaultCurrency": {"identifiers": {"currencyCode": "SEK"}},
  "creditAllowed": true,
  "allowsBackOrder": true,
  "customerId": "CUST-5678",
  "intervalStart": "2024-01-01T00:00:00Z"
}
```

### Step 5: Assign Customer Groups

Customer groups enable group-based pricing and segmentation. Groups are assigned via trade relationships (the supplier-customer link), not directly on agents:

```bash
# First, ensure customer group exists
PUT /v1/customer-groups/com.acme.group-id=VIP-CUSTOMERS
{
  "identifiers": {"com.acme.group-id": "VIP-CUSTOMERS"},
  "name": "VIP Customers",
  "owner": {"identifiers": {"com.acme.company-id": "OUR-COMPANY"}}
}

# Assign group via trade relationship
# The trade relationship's "groups" member links customers to groups
PATCH /v1/trade-relationships/com.acme.rel-id=REL-CUST-00001234
{
  "groups": [
    {"identifiers": {"com.acme.group-id": "VIP-CUSTOMERS"}}
  ]
}

# Or add a group when creating the trade relationship
POST /v1/trade-relationships
{
  "identifiers": {"com.acme.rel-id": "REL-ACCT-00005678"},
  "supplierAgent": {"identifiers": {"com.acme.company-id": "OUR-COMPANY"}},
  "customerAgent": {"identifiers": {"com.acme.crm-id": "CRM-ACCT-00005678"}},
  "defaultCurrency": {"identifiers": {"currencyCode": "SEK"}},
  "groups": [
    {"identifiers": {"com.acme.group-id": "WHOLESALE-CUSTOMERS"}}
  ]
}
```

> **Note**: The `/people/{id}/customerGroups` and `/companies/{id}/customerGroups` endpoints manage group *ownership*, not group *membership*. To add a customer to a group for pricing purposes, use the trade relationship's `groups` member as shown above.

### Step 6: Apply Labels (Custom Tags)

Labels provide flexible tagging for segmentation:

```bash
# Create label
PUT /v1/labels/com.acme.label-id=high-value
{
  "identifiers": {"com.acme.label-id": "high-value"},
  "title": "High Value Customer",
  "color": "#FFD700"
}

# Assign label to customer
POST /v1/people/com.acme.crm-id=CRM-CUST-00001234/labels
{
  "identifiers": {"com.acme.label-id": "high-value"}
}
```

### Bulk Loading Pattern

For large customer bases, use NDJSON streaming:

```bash
PUT /v1/people
Content-Type: application/x-ndjson

{"identifiers":{"com.acme.crm-id":"CRM-CUST-001"},"fullName":"John Doe","givenName":"John","familyName":"Doe","contactMethods":{"email":"john@example.com"}}
{"identifiers":{"com.acme.crm-id":"CRM-CUST-002"},"fullName":"Jane Smith","givenName":"Jane","familyName":"Smith","contactMethods":{"email":"jane@example.com"}}
{"identifiers":{"com.acme.crm-id":"CRM-CUST-003"},"fullName":"Bob Wilson","givenName":"Bob","familyName":"Wilson","contactMethods":{"email":"bob@example.com"}}
```

---

## Phase 2: Bidirectional Sync

### CRM → CommerceOS: Customer Updates

When a customer record changes in your CRM, push the update:

```bash
# Customer updated in CRM → PUT to CommerceOS
PUT /v1/people/com.acme.crm-id=CRM-CUST-00001234
{
  "identifiers": {
    "com.acme.crm-id": "CRM-CUST-00001234",
    "com.acme.email": "john.doe@example.com"
  },
  "fullName": "John Doe-Smith",
  "givenName": "John",
  "familyName": "Doe-Smith",
  "addresses": {
    "main": {
      "line1": "New Address 123",
      "postalCode": "11144",
      "cityName": "Stockholm",
      "countryCode": "SE"
    }
  },
  "contactMethods": {
    "email": "john.doe@example.com",
    "mobilePhone": "+46709876543"
  }
}
```

### CommerceOS → CRM: Transaction Events

Configure sync webhooks to push transaction data back to CRM:

```bash
# Create sync webhook for customer timeline events
PUT /v1/sync-webhooks/com.acme.sync-id=customer-transactions
{
  "identifiers": {"com.acme.sync-id": "customer-transactions"},
  "name": "Customer Transaction Sync",
  "description": "Push receipt data to CRM for customer timeline",
  "when": "api/v1/now/+=0:5:0",
  "repeat": true,
  "maxAttempts": 3,
  "in": {
    "url": "api/v1/receipts~orderBy(timestamp:desc)~take(100)~with(buyer)"
  },
  "out": {
    "method": "POST",
    "url": "https://your-crm.example.com/api/receipts",
    "auth": {
      "clientCredentials": {
        "tokenUrl": "https://your-crm.example.com/oauth/token",
        "client_id": "YOUR_CLIENT_ID",
        "client_secret": "YOUR_CLIENT_SECRET",
        "scope": "receipts.write"
      }
    }
  },
  "authorizedScopes": ["read:receipts"],
  "verboseLogging": false
}
```

### Sync Frequency Recommendations

| Data Type | Direction | Recommended Frequency | Rationale |
|-----------|-----------|----------------------|-----------|
| Customer master | CRM → CommerceOS | Real-time or hourly | Critical for checkout |
| Contact methods | CRM → CommerceOS | Real-time | Affects communications |
| Trade relationships | CRM → CommerceOS | Daily | Changes infrequently |
| Receipts/transactions | CommerceOS → CRM | Every 5-15 minutes | Near-real-time analytics |
| Customer groups | CRM → CommerceOS | Hourly | Affects pricing |

---

## Phase 3: Deduplication and Conflict Resolution

### Finding Potential Duplicates

Use the agent finder to locate customers before creating:

```bash
# Find by email
POST /v1/agents/@find
{
  "email": "john.doe@example.com"
}

# Find by phone
POST /v1/agents/@find
{
  "phone": "+46701234567"
}

# Find by name (phonetic/fuzzy)
POST /v1/agents/@find
{
  "name": "John Doe"
}

# Find by national ID
POST /v1/agents/@find
{
  "nationalId": "19900101-1234"
}
```

### Dedup Decision Flow

```
                    ┌─────────────────────────┐
                    │  New Customer from CRM  │
                    └───────────┬─────────────┘
                                │
                                ▼
                    ┌─────────────────────────┐
                    │  Search by email/phone  │
                    │  POST /agents/@find     │
                    └───────────┬─────────────┘
                                │
                    ┌───────────┴───────────┐
                    │                       │
                    ▼                       ▼
            ┌───────────┐           ┌───────────┐
            │ No Match  │           │  Match    │
            └─────┬─────┘           └─────┬─────┘
                  │                       │
                  ▼                       ▼
        ┌─────────────────┐     ┌─────────────────────┐
        │ Create new      │     │ Merge: Add CRM ID   │
        │ PUT /people/... │     │ to existing record  │
        └─────────────────┘     └─────────────────────┘
```

### Merge Strategy: Add Identifier to Existing

When a duplicate is found, add the CRM identifier to the existing record:

```bash
# Existing record found with key abc123...
# Add CRM identifier to existing record
PATCH /v1/people/abc123def456789012345678901234567
{
  "identifiers": {
    "com.acme.crm-id": "CRM-CUST-00001234"
  }
}
```

### Conflict Resolution Matrix

| Field | CRM Value | CommerceOS Value | Resolution |
|-------|-----------|------------------|------------|
| `givenName` | "John" | "Johnny" | CRM wins (master) |
| `email` | "new@example.com" | "old@example.com" | CRM wins |
| `addresses.main` | (updated) | (original) | CRM wins |
| `timeline` | N/A | (receipts) | CommerceOS only |
| `trade-relationship.groups` | (from CRM segments) | (local assigns) | Merge both |

### Recommended Conflict Resolution Code

```javascript
// Pseudocode for conflict resolution
function resolveConflict(crmRecord, commerceOsRecord) {
  const merged = {
    // CRM-mastered fields
    givenName: crmRecord.givenName,
    familyName: crmRecord.familyName,
    addresses: crmRecord.addresses,
    contactMethods: crmRecord.contactMethods,

    // Preserve CommerceOS identifiers
    identifiers: {
      ...commerceOsRecord.identifiers,
      ...crmRecord.identifiers
    }
  };

  return merged;
}
```

> **Note**: Customer group membership for pricing is set via trade relationships (`trade-relationship.groups`), not directly on agents. The `agent.customerGroups` field manages groups *owned* by the agent. To merge CRM segment membership, update the relevant trade relationships separately.

---

## Phase 4: GDPR and Consent Management

### GDPR Erasure Flow

When a customer exercises their "right to be forgotten":

```
CRM                              Integration                     CommerceOS
 │                                    │                              │
 │  1. GDPR erasure request           │                              │
 │ ─────────────────────────────────► │                              │
 │                                    │                              │
 │                                    │  2. PATCH gdprForgotten=true │
 │                                    │ ──────────────────────────────►
 │                                    │                              │
 │                                    │  3. Confirm erasure          │
 │                                    │ ◄──────────────────────────────
 │                                    │                              │
 │  4. Mark erased in CRM             │                              │
 │ ◄───────────────────────────────── │                              │
```

### Mark Person as Forgotten

```bash
PATCH /v1/people/com.acme.crm-id=CRM-CUST-00001234
{
  "gdprForgotten": true
}
```

**Effects of `gdprForgotten: true`:**
- Personal data fields are masked in responses
- Historical transactions remain for accounting (anonymized)
- Identifiers may be retained for "do not recreate" tracking

### Consent Fields via Trade Relationship

Track marketing consent through trade relationships:

```bash
PATCH /v1/trade-relationships/com.acme.rel-id=REL-CUST-001
{
  "acceptedPromotionalMaterial": true,
  "acceptedMembershipTerms": true
}
```

### Checking Customer Consent

```bash
# Get trade relationship with consent fields
GET /v1/trade-relationships/com.acme.rel-id=REL-CUST-001~with(acceptedPromotionalMaterial,acceptedMembershipTerms)
```

### GDPR Sync Pattern

```bash
# Sync webhook to propagate GDPR status to CRM
PUT /v1/sync-webhooks/com.acme.sync-id=gdpr-sync
{
  "identifiers": {"com.acme.sync-id": "gdpr-sync"},
  "name": "GDPR Status Sync",
  "description": "Push GDPR forgotten status to CRM",
  "when": "api/v1/now/+=0:1:0",
  "repeat": true,
  "maxAttempts": 3,
  "in": {
    "url": "api/v1/people~where(gdprForgotten=true)~take(50)"
  },
  "out": {
    "method": "POST",
    "url": "https://your-crm.example.com/api/gdpr/forgotten",
    "auth": {
      "authorizationHeader": "Bearer YOUR_TOKEN"
    }
  },
  "authorizedScopes": ["read:people"],
  "verboseLogging": false
}
```

---

## Webhook Configuration

Sync webhooks require a two-step setup: first create a mapped type to transform the data, then create the webhook referencing that mapped type by its key.

### Step 1: Create Mapped Type for Customer Export

```bash
PUT /v1/mapped-types/com.acme.mapped-type=crm-customer-export
{
  "identifiers": {
    "mappedTypeName": "crm-customer-export",
    "com.acme.mapped-type": "crm-customer-export"
  },
  "active": true,
  "body": {
    "crmId": "identifiers/com.acme.crm-id",
    "firstName": "givenName",
    "lastName": "familyName",
    "email": "contactMethods/email",
    "phone": "contactMethods/mobilePhone",
    "address": {
      "street": "addresses/main/line1",
      "city": "addresses/main/cityName",
      "postalCode": "addresses/main/postalCode",
      "country": "addresses/main/countryCode"
    }
  }
}
```

> **Note**: Mapped types use `identifiers.mappedTypeName` for naming—there is no top-level `name` field. The response will include `identifiers.key` (the database key), which is needed when referencing this mapped type in webhooks.

### Step 2: Create Webhook Referencing the Mapped Type

First, retrieve the mapped type's database key:

```bash
# Get the mapped type to obtain its database key
GET /v1/mapped-types/com.acme.mapped-type=crm-customer-export

# Response includes identifiers.key (the database key):
# {
#   "identifiers": {
#     "key": "abc123def456...",   <-- use this value
#     "mappedTypeName": "crm-customer-export",
#     "com.acme.mapped-type": "crm-customer-export"
#   },
#   ...
# }
```

Then create the webhook using that database key:

```bash
PUT /v1/sync-webhooks/com.acme.sync-id=customer-export
{
  "identifiers": {"com.acme.sync-id": "customer-export"},
  "name": "Customer Export to CRM",
  "description": "Push customer changes to CRM system",
  "when": "api/v1/now/+=0:10:0",
  "repeat": true,
  "maxAttempts": 5,
  "in": {
    "url": "api/v1/people~with(addresses,contactMethods,labels)~take(100)"
  },
  "map": {
    "identifiers": {"key": "<mapped-type-db-key>"}
  },
  "out": {
    "method": "POST",
    "url": "https://your-crm.example.com/api/customers/sync",
    "auth": {
      "clientCredentials": {
        "tokenUrl": "https://your-crm.example.com/oauth/token",
        "client_id": "YOUR_CLIENT_ID",
        "client_secret": "YOUR_CLIENT_SECRET",
        "scope": "customers.write"
      }
    }
  },
  "then": {
    "set": {
      "identifiers": {
        "com.acme.synced-to-crm": "true"
      }
    }
  },
  "authorizedScopes": ["read:people", "write:people"],
  "verboseLogging": true
}
```

> **Important**: The `map` field must reference an existing mapped type by its **database key** (from `identifiers.key`), not by a namespaced identifier. Inline `map.body` definitions in webhooks are ignored—always create a separate mapped type first. The mapped type must have `active: true` to be applied.

### Webhook for New Customers from POS

```bash
PUT /v1/sync-webhooks/com.acme.sync-id=new-pos-customers
{
  "identifiers": {"com.acme.sync-id": "new-pos-customers"},
  "name": "New POS Customers to CRM",
  "description": "Push customers created at POS back to CRM",
  "when": "api/v1/now/+=0:5:0",
  "repeat": true,
  "maxAttempts": 3,
  "in": {
    "url": "api/v1/people~where(identifiers/com.acme.crm-id=null)~with(addresses,contactMethods)~take(50)"
  },
  "out": {
    "method": "POST",
    "url": "https://your-crm.example.com/api/customers/new",
    "auth": {
      "basic": {
        "username": "api-user",
        "password": "YOUR_PASSWORD"
      }
    }
  },
  "authorizedScopes": ["read:people"],
  "verboseLogging": false
}
```

---

## Pagination and Delta Sync

### Initial Full Sync with Pagination

```bash
# Page 1: First 500 customers
GET /v1/people~orderBy(name)~take(500)

# Page 2: Skip first 500
GET /v1/people~orderBy(name)~skip(500)~take(500)

# Page 3: Skip first 1000
GET /v1/people~orderBy(name)~skip(1000)~take(500)

# Continue until response has fewer than 500 items
```

### Delta Sync Using Timestamp

Track the last sync timestamp and fetch only newer records:

```bash
# Store last sync timestamp: 2024-12-15T10:00:00Z

# Next sync: fetch customers modified after that timestamp
# Note: CommerceOS doesn't have a native updatedAt filter on agents,
# so use sync webhooks with "then.set" to mark synced records

# Alternative: Use identifier-based tracking
GET /v1/people~where(identifiers/com.acme.synced-to-crm=null)~take(500)
```

### Cursor-Style Pagination

For very large datasets, use cursor-based pagination with a sortable field:

```bash
# First page: order by fullName
GET /v1/people~orderBy(fullName)~take(500)

# Next page: start after last fullName from previous response
# Replace "LastNameFromPreviousPage" with the actual last value
GET /v1/people~where(fullName>"LastNameFromPreviousPage")~orderBy(fullName)~take(500)
```

> **Note**: Path members use `/` separators, not dots. For example, use `identifiers/key` not `identifiers.key`. However, `identifiers/key` is read-only and not ideal for pagination — prefer user-facing fields like `fullName` for cursors.

---

## Error Handling and Recovery

### Retry Strategy

| Error Type | Retry? | Strategy |
|------------|--------|----------|
| 400 Bad Request | No | Fix payload and re-submit |
| 401 Unauthorized | Yes | Refresh token, retry once |
| 403 Forbidden | No | Check scopes/permissions |
| 404 Not Found | No | Create referenced entities first |
| 409 Conflict | Yes | Fetch current, merge, retry |
| 429 Rate Limited | Yes | Exponential backoff |
| 5xx Server Error | Yes | Exponential backoff, max 5 retries |

### Idempotency with PUT

PUT operations are idempotent — safe to retry:

```bash
# This can be safely retried on network failure
PUT /v1/people/com.acme.crm-id=CRM-CUST-00001234
{
  "givenName": "John",
  "familyName": "Doe",
  ...
}
```

### Error Logging Format

```json
{
  "timestamp": "2024-12-15T14:30:00Z",
  "operation": "PUT /v1/people/com.acme.crm-id=CRM-CUST-00001234",
  "status": 400,
  "error": {
    "code": "InvalidIdentifier",
    "message": "Identifier key 'crm-id' is not namespaced",
    "path": "identifiers"
  },
  "request": {
    "identifiers": {"crm-id": "CRM-CUST-00001234"}
  },
  "resolution": "Use namespaced identifier: com.acme.crm-id"
}
```

### Dead Letter Queue Pattern

For records that fail after all retries:

1. Log the failed record with full context
2. Move to dead letter queue/table
3. Alert operations team
4. Manual review and correction
5. Replay after fix

---

## Production Checklist

### Pre-Launch

- [ ] **Identifier namespace** — Confirm reverse-domain namespace (e.g., `com.acme.crm-id`)
- [ ] **Field mapping** — Document CRM → CommerceOS field mapping
- [ ] **Dedup strategy** — Define dedup rules (email? phone? national ID?)
- [ ] **Conflict resolution** — Document which system wins for each field
- [ ] **GDPR handling** — Map CRM erasure to `gdprForgotten` flag

### Integration Setup

- [ ] **OAuth scopes** — Obtain required scopes: `read:people`, `write:people`, `read:companies`, `write:companies`
- [ ] **Test environment** — Validate integration in staging
- [ ] **Initial load** — Run full customer export/import
- [ ] **Webhook endpoints** — Configure and test sync webhooks
- [ ] **Error handling** — Implement retry logic and dead letter queue

### Go-Live

- [ ] **Monitoring** — Set up sync status dashboards
- [ ] **Alerting** — Configure alerts for sync failures
- [ ] **Runbook** — Document manual intervention procedures
- [ ] **Rollback plan** — Define rollback procedure if issues arise

### Post-Launch

- [ ] **Reconciliation** — Schedule periodic full-sync verification
- [ ] **Performance** — Monitor sync latency and throughput
- [ ] **Data quality** — Track duplicate rate and resolution effectiveness

---

## Copy-Paste Payload Reference

### Complete Person Creation

```bash
PUT /v1/people/com.acme.crm-id=CRM-CUST-00001234
Content-Type: application/json

{
  "identifiers": {
    "com.acme.crm-id": "CRM-CUST-00001234",
    "com.acme.email": "john.doe@example.com",
    "com.acme.loyalty-id": "LOY-9876543"
  },
  "fullName": "John Doe",
  "givenName": "John",
  "familyName": "Doe",
  "personalNumber": "19850615-1234",
  "nationality": "SE",
  "languages": ["sv", "en"],
  "addresses": {
    "main": {
      "line1": "Kungsgatan 1",
      "line2": "Apt 4B",
      "postalCode": "11143",
      "cityName": "Stockholm",
      "countryCode": "SE"
    },
    "delivery": {
      "line1": "Drottninggatan 50",
      "postalCode": "11121",
      "cityName": "Stockholm",
      "countryCode": "SE"
    },
    "invoice": {
      "line1": "Kungsgatan 1",
      "line2": "Apt 4B",
      "postalCode": "11143",
      "cityName": "Stockholm",
      "countryCode": "SE"
    }
  },
  "contactMethods": {
    "email": "john.doe@example.com",
    "mobilePhone": "+46701234567",
    "landlinePhone": "+4687654321",
    "workPhone": "+4687651000"
  },
  "preferredCurrency": {"identifiers": {"currencyCode": "SEK"}}
}
```

### Complete Company Creation

```bash
PUT /v1/companies/com.acme.crm-id=CRM-ACCT-00005678
Content-Type: application/json

{
  "identifiers": {
    "com.acme.crm-id": "CRM-ACCT-00005678",
    "com.acme.org-number": "5561234567"
  },
  "name": "Acme Retail AB",
  "organizationNumber": "556123-4567",
  "vatId": "SE556123456701",
  "nationality": "SE",
  "languages": ["sv", "en"],
  "fiscalYearStart": "2024-01-01T00:00:00Z",
  "addresses": {
    "main": {
      "line1": "Industrivägen 10",
      "postalCode": "12345",
      "cityName": "Göteborg",
      "countryCode": "SE"
    },
    "invoice": {
      "line1": "Box 100",
      "line2": "Ekonomiavdelningen",
      "postalCode": "12346",
      "cityName": "Göteborg",
      "countryCode": "SE"
    },
    "delivery": {
      "line1": "Lagervägen 5",
      "line2": "Dock 3",
      "postalCode": "12347",
      "cityName": "Göteborg",
      "countryCode": "SE"
    },
    "visiting": {
      "line1": "Industrivägen 10",
      "line2": "Reception, Floor 1",
      "postalCode": "12345",
      "cityName": "Göteborg",
      "countryCode": "SE"
    }
  },
  "contactMethods": {
    "email": "info@acmeretail.se",
    "landlinePhone": "+46317001000"
  },
  "preferredCurrency": {"identifiers": {"currencyCode": "SEK"}}
}
```

### Complete Trade Relationship

```bash
POST /v1/trade-relationships
Content-Type: application/json

{
  "identifiers": {"com.acme.rel-id": "REL-ACCT-00005678"},
  "supplierAgent": {
    "identifiers": {"com.acme.company-id": "OUR-COMPANY"}
  },
  "customerAgent": {
    "identifiers": {"com.acme.crm-id": "CRM-ACCT-00005678"}
  },
  "defaultCurrency": {"identifiers": {"currencyCode": "SEK"}},
  "creditAllowed": true,
  "allowsBackOrder": true,
  "acceptedMembershipTerms": true,
  "acceptedPromotionalMaterial": false,
  "customerId": "CUST-5678",
  "supplierId": "SUPP-001",
  "intervalStart": "2024-01-01T00:00:00Z"
}
```

### Verification Queries

```bash
# Get person with all expansions
GET /v1/people/com.acme.crm-id=CRM-CUST-00001234~with(addresses,contactMethods,customerGroups,labels,supplierRelations)

# Get company with all expansions
GET /v1/companies/com.acme.crm-id=CRM-ACCT-00005678~with(addresses,contactMethods,customerGroups,labels,customerRelations)

# Get trade relationship with agents
GET /v1/trade-relationships/com.acme.rel-id=REL-ACCT-00005678~with(supplierAgent,customerAgent)

# List all people with CRM IDs
GET /v1/people~where(identifiers/com.acme.crm-id!=null)~take(100)
```

---

## Related Documentation

- [Working with Customers](../working-with/customers.md) — Detailed customer field reference
- [Sync Webhooks](../sync-webhooks.md) — Webhook configuration and troubleshooting
- [Mapped Types](../mapped-types.md) — Data transformation for sync
- [Pagination](../pagination.md) — Pagination patterns for large datasets
- [Common Gotchas](../common-gotchas.md) — Avoid common integration mistakes
