# Organization Examples

Curl examples for agents, people, companies, and stores.

**Base URL:** `http://localhost:5000/api/v1`
**API Key:** `banana` (passed via Basic Auth with empty username: `-u ":banana"`)

> **See also:** [Examples Index](../examples.md) | [Reference Documentation](../../reference/)

---

## People

```bash
# List all people
curl -X GET -u ":banana" "localhost:5000/api/v1/people"

# Get person by external ID
curl -X GET -u ":banana" "localhost:5000/api/v1/people/com.myapp.customerId=CUST-001"

# Get person with addresses included
curl -X GET -u ":banana" "localhost:5000/api/v1/people/com.myapp.customerId=CUST-001~with(addresses)"

# Get person's customer relationships
curl -X GET -u ":banana" "localhost:5000/api/v1/people/com.myapp.customerId=CUST-001/customerRelations"

# Create a person (fullName is auto-derived from givenName + familyName)
# personalNumber is optional but recommended for Swedish/Nordic contexts
curl -X POST -u ":banana" "localhost:5000/api/v1/people" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.customerId": "CUST-001"},
    "givenName": "John",
    "familyName": "Doe"
  }'

# Create person with full details
# fullName will be auto-computed as "Jane Smith" from givenName + familyName
curl -X POST -u ":banana" "localhost:5000/api/v1/people" \
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
curl -X PATCH -u ":banana" "localhost:5000/api/v1/people/com.myapp.customerId=CUST-001" \
  -H "Content-Type: application/json" \
  -d '{"familyName": "Doe-Smith"}'

# Delete person
curl -X DELETE -u ":banana" "localhost:5000/api/v1/people/com.myapp.customerId=CUST-001"
```

---

## Companies

```bash
# List all companies
curl -X GET -u ":banana" "localhost:5000/api/v1/companies"

# Get company by external ID
curl -X GET -u ":banana" "localhost:5000/api/v1/companies/com.heads.seedID=ourcompany"

# Get company with supplier relations
curl -X GET -u ":banana" "localhost:5000/api/v1/companies/com.heads.seedID=ourcompany~with(supplierRelations)"

# Get company's assortment roots (product categories it owns)
curl -X GET -u ":banana" "localhost:5000/api/v1/companies/com.heads.seedID=ourcompany/assortmentRoots"

# Create a company
curl -X POST -u ":banana" "localhost:5000/api/v1/companies" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.companyId": "COMP-001"},
    "name": "Acme Corporation",
    "organizationNumber": "556123-4567"
  }'

# Create company with parent (subsidiary)
# IMPORTANT: The parent setter requires the database key (identifiers.key), not external IDs
# First, get the parent company to retrieve its database key
curl -X GET -u ":banana" "localhost:5000/api/v1/companies/com.myapp.companyId=COMP-001/identifiers/key"
# Returns: "comXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" (32-char database key)

# Then create the subsidiary using the database key
curl -X POST -u ":banana" "localhost:5000/api/v1/companies" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.companyId": "COMP-002"},
    "name": "Acme Subsidiary",
    "parent": {"identifiers": {"key": "comXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"}}
  }'

# Update company
curl -X PATCH -u ":banana" "localhost:5000/api/v1/companies/com.myapp.companyId=COMP-001" \
  -H "Content-Type: application/json" \
  -d '{"name": "Acme Corp International"}'
```

---

## Stores

```bash
# List all stores
curl -X GET -u ":banana" "localhost:5000/api/v1/stores"

# Get store by external ID
curl -X GET -u ":banana" "localhost:5000/api/v1/stores/com.heads.seedID=store1"

# Get store with opening hours
curl -X GET -u ":banana" "localhost:5000/api/v1/stores/com.heads.seedID=store1~with(openingHours)"

# Get store's assortment (products it carries)
curl -X GET -u ":banana" "localhost:5000/api/v1/stores/com.heads.seedID=store1/assortment"

# Get store's stock roots (warehouses/stock places)
curl -X GET -u ":banana" "localhost:5000/api/v1/stores/com.heads.seedID=store1/stockRoots"

# Create a store (uses "owner" not "parent" for ownership relationship)
# IMPORTANT: The owner setter requires the database key (identifiers.key), not external IDs
# First, get the owning company's database key
curl -X GET -u ":banana" "localhost:5000/api/v1/companies/com.heads.seedID=ourcompany/identifiers/key"
# Returns: "comXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" (32-char database key)

# Then create the store using the database key
curl -X POST -u ":banana" "localhost:5000/api/v1/stores" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.storeId": "STORE-001"},
    "name": "Downtown Store",
    "owner": {"identifiers": {"key": "comXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"}},
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
curl -X POST -u ":banana" "localhost:5000/api/v1/stores" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.storeId": "STORE-002"},
    "name": "Mall Store",
    "owner": {"identifiers": {"key": "comXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"}},
    "organizationNumber": "556789-0123"
  }'

# Update store
curl -X PATCH -u ":banana" "localhost:5000/api/v1/stores/com.myapp.storeId=STORE-001" \
  -H "Content-Type: application/json" \
  -d '{"name": "Downtown Flagship Store"}'
```

---

## Generic Agents

```bash
# List all agents (people, companies, stores combined)
curl -X GET -u ":banana" "localhost:5000/api/v1/agents"

# Filter agents by type
curl -X GET -u ":banana" "localhost:5000/api/v1/agents~where(@type=person)"
curl -X GET -u ":banana" "localhost:5000/api/v1/agents~where(@type=company)"
curl -X GET -u ":banana" "localhost:5000/api/v1/agents~where(@type=store)"

# Get agent by database key
curl -X GET -u ":banana" "localhost:5000/api/v1/agents/key=abc123def456"

# Get agent's addresses
curl -X GET -u ":banana" "localhost:5000/api/v1/agents/com.heads.seedID=ourcompany/addresses"
curl -X GET -u ":banana" "localhost:5000/api/v1/agents/com.heads.seedID=ourcompany/addresses/main"

# Get agent's contact methods
curl -X GET -u ":banana" "localhost:5000/api/v1/agents/com.heads.seedID=ourcompany/contactMethods"

# Get agent's labels
curl -X GET -u ":banana" "localhost:5000/api/v1/agents/com.heads.seedID=ourcompany/labels"
```

---

## Notes

- **Store Owner**: Stores use `owner` (not `parent`) to reference the owning company
- **Company Parent**: Companies use `parent` to reference a parent company (for subsidiary relationships)
- **External IDs**: Use reverse domain notation for namespacing (e.g., `com.myapp.customerId`)
- **Person fullName**: The `fullName` field is auto-derived from `givenName` + `familyName`. When both are set, `fullName = "${givenName} ${familyName}"`. When setting a person, you typically provide `givenName` and `familyName`; `fullName` is computed automatically.
- **Person personalNumber**: Optional field for personal identification numbers (e.g., Swedish personnummer). Not required for creation, but useful for identification in Nordic contexts.

### Relationship Setters (parent/owner)

**Important:** The `parent` setter on companies and `owner` setter on stores **only accept the database key** (`identifiers.key`), not external identifiers.

To set these relationships:

1. **Get the target entity's database key:**
   ```bash
   curl -X GET -u ":banana" "localhost:5000/api/v1/companies/com.myapp.companyId=COMP-001/identifiers/key"
   # Returns the 32-character database key, e.g., "comXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
   ```

2. **Use the database key in the relationship:**
   ```json
   {
     "parent": {"identifiers": {"key": "comXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"}}
   }
   ```

Using external identifiers in `parent` or `owner` (e.g., `{"identifiers": {"com.myapp.companyId": "COMP-001"}}`) will **not resolve** the relationship correctly.

### Customer Groups and Trade Relationships

For customer group management (creating groups, assigning customers, using groups with discount rules), see:
- [Working with Customers — Customer Groups](../../reference/working-with/customers.md#customer-groups)
- [Configuration — Customer Groups](./configuration.md#customer-groups)
- [Discount Rules — Buyer Conditions](./discount-rules.md#customer-groups-and-buyer-conditions)
