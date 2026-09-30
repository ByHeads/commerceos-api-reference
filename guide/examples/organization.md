# Organization Examples

Curl examples for agents, people, companies, and stores.

**Base URL:** `https://example.app.heads.com/api/v1`
**API Key:** `banana` (passed via Basic Auth with empty username: `-u ":banana"`)

> **See also:** [Examples Index](../examples.md) | [Reference Documentation](../../reference/)

---

## People

```bash
# List all people
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/people"

# Get person by external ID
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/people/com.myapp.customerId=CUST-001"

# Get person with addresses included
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/people/com.myapp.customerId=CUST-001~with(addresses)"

# Get person's customer relationships
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/people/com.myapp.customerId=CUST-001/customerRelations"

# Create a person (fullName is auto-derived from givenName + familyName)
# personalNumber is optional but recommended for Swedish/Nordic contexts
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/people" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.customerId": "CUST-001"},
    "givenName": "John",
    "familyName": "Doe"
  }'

# Create person with full details
# fullName will be auto-computed as "Jane Smith" from givenName + familyName
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/people" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.customerId": "CUST-002"},
    "givenName": "Jane",
    "familyName": "Smith",
    "personalNumber": "199001011234",
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
  }'

# Update person (partial)
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/people/com.myapp.customerId=CUST-001" \
  -H "Content-Type: application/json" \
  -d '{"familyName": "Doe-Smith"}'

# Delete person
curl -X DELETE -u ":banana" "https://example.app.heads.com/api/v1/people/com.myapp.customerId=CUST-001"
```

---

## Companies

```bash
# List all companies
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/companies"

# Get company by external ID
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/companies/com.heads.seedID=ourcompany"

# Get company with supplier relations
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/companies/com.heads.seedID=ourcompany~with(supplierRelations)"

# Get company's assortment (every product node it offers)
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/companies/com.heads.seedID=ourcompany/assortment"

# Get company's assortment roots (every product node with its own entry in the assortment, not only categories)
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/companies/com.heads.seedID=ourcompany/assortmentRoots"

# Create a company
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/companies" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.companyId": "COMP-001"},
    "name": "Acme Corporation",
    "organizationNumber": "556123-4567"
  }'

# Create company with parent (subsidiary)
# The parent is named by external identifier or by database key (identifiers.key)
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/companies" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.companyId": "COMP-002"},
    "name": "Acme Subsidiary",
    "parent": {"identifiers": {"com.myapp.companyId": "COMP-001"}}
  }'
# Read the response back: "parent" must name COMP-001. A reference that matches nothing
# is not refused; it creates a nameless agent and hangs the company under it.

# Update company
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/companies/com.myapp.companyId=COMP-001" \
  -H "Content-Type: application/json" \
  -d '{"name": "Acme Corp International"}'
```

---

## Stores

```bash
# List all stores
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/stores"

# Get store by external ID
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/stores/com.heads.seedID=store1"

# Get store with opening hours
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/stores/com.heads.seedID=store1~with(openingHours)"

# Get the assortment the store uses (products it carries).
# Most stores use their company's assortment: read it through assortmentOwner.
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/stores/com.heads.seedID=store1/assortmentOwner/assortment"

# Which assortment does the store use? null = its own; then read /stores/{id}/assortment instead
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/stores/com.heads.seedID=store1~with(assortmentOwner)"

# The store's own entries only. [] for a store that uses its company's assortment
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/stores/com.heads.seedID=store1/assortment"

# Get store's stock roots (warehouses/stock places)
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/stores/com.heads.seedID=store1/stockRoots"

# Create a store (uses "owner" not "parent" for ownership relationship)
# The owner is named by external identifier or by database key (identifiers.key).
# A store created without "owner" is outside the organization and uses its own assortment.
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/stores" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.storeId": "STORE-001"},
    "name": "Downtown Store",
    "owner": {"identifiers": {"com.heads.seedID": "ourcompany"}},
    "addresses": {
      "main": {
        "line1": "Drottninggatan 50",
        "postalCode": "11121",
        "cityName": "Stockholm",
        "countryCode": "SE"
      }
    }
  }'

# Create store with organization number
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/stores" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.storeId": "STORE-002"},
    "name": "Mall Store",
    "owner": {"identifiers": {"com.heads.seedID": "ourcompany"}},
    "organizationNumber": "556789-0123"
  }'

# Update store
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/stores/com.myapp.storeId=STORE-001" \
  -H "Content-Type: application/json" \
  -d '{"name": "Downtown Flagship Store"}'
```

---

## Generic Agents

```bash
# List all agents (people, companies, stores combined)
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/agents"

# Filter agents by type
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/agents~where(@type=person)"
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/agents~where(@type=company)"
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/agents~where(@type=store)"

# Get agent by database key
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/agents/key=abc123def456"

# Get agent's addresses
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/agents/com.heads.seedID=ourcompany/addresses"
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/agents/com.heads.seedID=ourcompany/addresses/main"

# Get agent's contact methods
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/agents/com.heads.seedID=ourcompany/contactMethods"

# Get agent's labels
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/agents/com.heads.seedID=ourcompany/labels"
```

---

## Notes

- **Store Owner**: Stores use `owner` (not `parent`) to reference the owning company
- **Company Parent**: Companies use `parent` to reference a parent company (for subsidiary relationships)
- **External IDs**: Use reverse domain notation for namespacing (e.g., `com.myapp.customerId`)
- **Person fullName**: The `fullName` field is auto-derived from `givenName` + `familyName`. When both are set, `fullName = "${givenName} ${familyName}"`. When setting a person, you typically provide `givenName` and `familyName`; `fullName` is computed automatically.
- **Person personalNumber**: Optional field for personal identification numbers (e.g., Swedish personnummer). Not required for creation, but useful for identification in Nordic contexts.

### Relationship Setters (parent/owner)

The `parent` setter on companies and the `owner` setter on stores accept a reference by **external identifier or by database key** (`identifiers.key`):

```json
{"parent": {"identifiers": {"com.myapp.companyId": "COMP-001"}}}
```

```json
{"owner": {"identifiers": {"key": "comXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"}}}
```

- **Read the response back.** A reference whose identifier matches nothing is not refused: the write answers `200`, a nameless agent is created, and the company or store hangs under it. The response then shows a `parent` or `owner` without a name
- On an older release where an external identifier does not resolve this way, use the database key: `GET /v1/companies/com.myapp.companyId=COMP-001/identifiers/key`
- The top company's `parent` is the root organization (`GET /v1/agents~where(name=System)`). A company without `parent` and a store without `owner` are outside the organization, and the tenant-wide assortment default does not reach them. See [Working with Assortments](../../reference/working-with/assortments.md#organization-first)

### Customer Groups and Trade Relationships

For customer group management (creating groups, assigning customers, using groups with discount rules), see:
- [Working with Customers — Customer Groups](../../reference/working-with/customers.md#customer-groups)
- [Configuration — Customer Groups](./configuration.md#customer-groups)
- [Discount Rules — Buyer Conditions](./discount-rules.md#customer-groups-and-buyer-conditions)

An agent's `customerRelations` / `supplierRelations` list established trade relationships only, and reconcile with the top-level collection:

```bash
# Who this company sells to, and who it buys from
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/companies/com.heads.seedID=ourcompany/customerRelations~take(50)"
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/companies/com.heads.seedID=ourcompany/supplierRelations~take(50)"

# Count them
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/companies/com.heads.seedID=ourcompany/customerRelations~count"

# Expand both parties on each row
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/companies/com.heads.seedID=ourcompany/supplierRelations~with(supplierAgent,customerAgent)~take(20)"
```

A store configured to buy on its parent company's account has **no** supplier relationships of its own — the relationship belongs to the parent, and a trade order posted for the store uses it. An empty `supplierRelations` on such a store is expected, not a missing record. See [Resource Patterns — Relationships created implicitly by a trade order](../../reference/resource-patterns.md#relationships-created-implicitly-by-a-trade-order).
