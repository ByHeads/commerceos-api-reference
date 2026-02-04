# Configuration & Reference Data Examples

Curl examples for countries, languages, templates, mapped types, payment methods, discount/return reasons, delivery/payment terms, sales channels, customer groups, sync webhooks, shortened links, config API, and EPI integrations.

**Base URL:** `http://localhost:5000/api/v1`
**API Key:** `banana` (passed via Basic Auth with empty username: `-u ":banana"`)

> **See also:** [Examples Index](../examples.md) | [Reference Documentation](../../reference/)

---

## Countries & Geography

```bash
# List all countries
curl -X GET -u ":banana" "localhost:5000/api/v1/countries"

# Get country by code
curl -X GET -u ":banana" "localhost:5000/api/v1/countries/countryCode=SE"

# Get country with child places (e.g., cities, regions)
curl -X GET -u ":banana" "localhost:5000/api/v1/countries/countryCode=SE~with(children)"

# List all cities
curl -X GET -u ":banana" "localhost:5000/api/v1/cities"

# Create/update country
curl -X PUT -u ":banana" "localhost:5000/api/v1/countries/countryCode=NO" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"countryCode": "NO"},
    "name": "Norway"
  }'
```

---

## Languages

```bash
# List all languages
curl -X GET -u ":banana" "localhost:5000/api/v1/languages"

# Get language by code
curl -X GET -u ":banana" "localhost:5000/api/v1/languages/languageCode=sv"

# Create/update language
curl -X PUT -u ":banana" "localhost:5000/api/v1/languages/languageCode=nb" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"languageCode": "nb"},
    "name": "Norwegian Bokmal"
  }'
```

---

## Templates

```bash
# List all templates
curl -X GET -u ":banana" "localhost:5000/api/v1/templates"

# Get template by ID
curl -X GET -u ":banana" "localhost:5000/api/v1/templates/templateId=default-receipt"

# Create a template (templateLanguage + mimeType required)
curl -X POST -u ":banana" "localhost:5000/api/v1/templates" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"templateId": "custom-receipt"},
    "name": "Custom Receipt Template",
    "templateLanguage": "handlebars",
    "mimeType": "text/html",
    "text": "RECEIPT\n========\n{{items}}\n--------\nTotal: {{total}}"
  }'

# Update template
curl -X PATCH -u ":banana" "localhost:5000/api/v1/templates/templateId=custom-receipt" \
  -H "Content-Type: application/json" \
  -d '{"text": "RECEIPT v2\n========\n{{items}}\n--------\nTotal: {{total}}\nThank you!"}'
```

---

## Mapped Types

```bash
# List all mapped types
curl -X GET -u ":banana" "localhost:5000/api/v1/mapped-types"

# Get mapped type by name
curl -X GET -u ":banana" "localhost:5000/api/v1/mapped-types/mappedTypeName=com.heads.receipt-csv"

# Create a mapped type
curl -X POST -u ":banana" "localhost:5000/api/v1/mapped-types" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"mappedTypeName": "com.myapp.product-export"},
    "body": {
      "sku": "identifiers/com.myapp.sku",
      "name": "name",
      "price": "prices~first/amount"
    }
  }'

# Use mapped type in query
curl -X GET -u ":banana" "localhost:5000/api/v1/products~map(com.myapp.product-export)~take(10)"

# Map a receipts bundle (default mapped type)
curl -X GET -u ":banana" "localhost:5000/api/v1/receipts~map(com.heads.receipts-zip)"

# Map request bodies on write (NOT CURRENTLY WORKING - see note below)
# This example shows intended usage but X-Request-Map is blocked pending resolver changes.
curl -X PUT -u ":banana" "localhost:5000/api/v1/products" \
  -H "Content-Type: application/json" \
  -H "X-Request-Map: com.myapp.product-import" \
  -d '[{"sku":"P-001","title":"Mapped Product","state":"Active"}]'
```

> **Important: X-Request-Map is currently blocked**
>
> Request-body mapping via `X-Request-Map` is not reliable yet. The resolver treats selectors like `"sku"` as reference paths (`regularStringsMapping="reference"`), but raw JSON has no Pillow type context, so resolution fails. Until the resolver supports literal mapping of raw JSON, this feature is effectively unsupported. Use normal payloads or `~map(...)` on reads instead.

---

## Payment Methods

```bash
# List all payment methods
curl -X GET -u ":banana" "localhost:5000/api/v1/payment-methods"

# Get payment method by ID
curl -X GET -u ":banana" "localhost:5000/api/v1/payment-methods/methodId=com.heads.cash"

# Create a payment method (no description field supported)
curl -X POST -u ":banana" "localhost:5000/api/v1/payment-methods" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"methodId": "com.myapp.gift-card"},
    "name": "Gift Card"
  }'

# Update payment method
curl -X PATCH -u ":banana" "localhost:5000/api/v1/payment-methods/methodId=com.myapp.gift-card" \
  -H "Content-Type: application/json" \
  -d '{"name": "Store Gift Card"}'
```

---

## Discount & Return Reasons

```bash
# List discount reasons
curl -X GET -u ":banana" "localhost:5000/api/v1/discount-reasons"

# Create discount reason (no description field supported; use name + active)
curl -X POST -u ":banana" "localhost:5000/api/v1/discount-reasons" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.reasonId": "EMPLOYEE"},
    "name": "Employee Discount",
    "active": true
  }'

# List return reasons
curl -X GET -u ":banana" "localhost:5000/api/v1/return-reasons"

# Create return reason (no description field; use usedForReturns + restock)
curl -X POST -u ":banana" "localhost:5000/api/v1/return-reasons" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.reasonId": "DEFECTIVE"},
    "name": "Defective Product",
    "usedForReturns": true,
    "restock": false
  }'
```

---

## Delivery & Payment Terms

```bash
# List delivery terms
curl -X GET -u ":banana" "localhost:5000/api/v1/delivery-terms"

# Create incoterm delivery term
# NOTE: location setter requires a database key. First, get the place key:
#   curl -X GET -u ":banana" "localhost:5000/api/v1/places/address.cityName=Stockholm/identifiers/key"
# Then use that key in the location field:
curl -X POST -u ":banana" "localhost:5000/api/v1/incoterm-delivery-terms" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "incoterm delivery term",
    "identifiers": {"com.myapp.termId": "FOB-STOCKHOLM"},
    "incotermCode": "FOB",
    "location": {
      "identifiers": {"key": "plc123456789012345678901234567890"}
    }
  }'

# List payment terms
curl -X GET -u ":banana" "localhost:5000/api/v1/payment-terms"

# Create payment term (no description field supported)
curl -X POST -u ":banana" "localhost:5000/api/v1/payment-terms" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.termId": "NET30"},
    "name": "Net 30"
  }'
```

---

## Sales Channels

```bash
# List all sales channels
curl -X GET -u ":banana" "localhost:5000/api/v1/sales-channels"

# Get sales channel by ID
curl -X GET -u ":banana" "localhost:5000/api/v1/sales-channels/com.myapp.channelId=webshop"

# Get sales channel products
curl -X GET -u ":banana" "localhost:5000/api/v1/sales-channels/com.myapp.channelId=webshop/products"

# Create a sales channel
curl -X POST -u ":banana" "localhost:5000/api/v1/sales-channels" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.channelId": "webshop"},
    "name": "Online Webshop"
  }'
```

---

## Customer Groups

```bash
# List all customer groups
curl -X GET -u ":banana" "localhost:5000/api/v1/customer-groups"

# Get customer group by ID
curl -X GET -u ":banana" "localhost:5000/api/v1/customer-groups/com.myapp.groupId=vip"

# Get customer group members
curl -X GET -u ":banana" "localhost:5000/api/v1/customer-groups/com.myapp.groupId=vip/members"

# Create a customer group
# NOTE: owner setter requires a database key. First, get the agent key:
#   curl -X GET -u ":banana" "localhost:5000/api/v1/companies/com.heads.seedID=ourcompany/identifiers/key"
# Then use that key in the owner field:
curl -X POST -u ":banana" "localhost:5000/api/v1/customer-groups" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.groupId": "vip"},
    "name": "VIP Customers",
    "owner": {"identifiers": {"key": "agt123456789012345678901234567890"}}
  }'
```

---

## Sync Webhooks

```bash
# List all sync webhooks
curl -X GET -u ":banana" "localhost:5000/api/v1/sync-webhooks"

# Get sync webhook by ID
curl -X GET -u ":banana" "localhost:5000/api/v1/sync-webhooks/com.myapp.webhookId=product-sync"

# Create a sync webhook
curl -X POST -u ":banana" "localhost:5000/api/v1/sync-webhooks" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.webhookId": "product-sync"},
    "name": "Product Sync to ERP",
    "description": "Syncs new products to external ERP system",
    "when": "api/v1/now/0_0_*_*_*",
    "repeat": true,
    "in": {
      "method": "GET",
      "url": "api/v1/products~where(status=Active)~take(100)"
    },
    "out": {
      "method": "POST",
      "url": "https://erp.example.com/api/products",
      "auth": {
        "basic": {
          "username": "api-user",
          "password": "api-secret"
        }
      }
    }
  }'

# Update sync webhook
curl -X PATCH -u ":banana" "localhost:5000/api/v1/sync-webhooks/com.myapp.webhookId=product-sync" \
  -H "Content-Type: application/json" \
  -d '{"repeat": false}'
```

---

## Shortened Links

```bash
# List all shortened links
curl -X GET -u ":banana" "localhost:5000/api/v1/shortened-links"

# Create shortened link (url + validTo required; shortenedLinkID is auto-generated)
curl -X POST -u ":banana" "localhost:5000/api/v1/shortened-links" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://shop.example.com/promotions/summer-2024",
    "validTo": "2025-12-31T23:59:59Z",
    "expirationRedirect": "https://shop.example.com/expired"
  }'
```

---

## Config API (System Settings)

```bash
# Get API config (singleton)
curl -X GET -u ":banana" "localhost:5000/api/v1/config/api"

# Update API config
curl -X PUT -u ":banana" "localhost:5000/api/v1/config/api" \
  -H "Content-Type: application/json" \
  -d '{
    "publicBaseURL": "https://api.example.com",
    "verboseLogging": true,
    "requestLogPath": "/var/log/commerceos/api"
  }'

# Get webshop config
curl -X GET -u ":banana" "localhost:5000/api/v1/config/webshop"

# Update webshop config
curl -X PUT -u ":banana" "localhost:5000/api/v1/config/webshop" \
  -H "Content-Type: application/json" \
  -d '{
    "siteURL": "https://shop.example.com",
    "siteTitle": {"en": "Example Shop"},
    "paymentMethods": []
  }'
```

---

## EPI Integrations & Configurations

### OAuth2 Client Prerequisites

Installing an EPI integration requires a **confidential OAuth2 client** associated with the integration's user (`User.byHolder(integration)`). The install action will fail if:

- No associated OAuth2 client exists
- Multiple OAuth2 clients exist for the integration user
- The OAuth2 client has no secret (non-confidential)
- The OAuth2 Server is not configured

**Default OAuth2 Client Configuration (from API-gen seeds):**

| Field | Value |
|-------|-------|
| **Scopes** | `me`, `geo:read`, `orders.sales:write`, `orders.payments:write`, `payment-records:write`, `kv` |
| **Grant Type** | `client_credentials` |
| **Access Token Lifetime** | 3600 seconds (1 hour) |
| **Refresh Token Lifetime** | 2592000 seconds (30 days) |
| **Confidential** | `true` (client secret required) |

> **Where these defaults come from:** EPI users are seeded via `commerceos-api-gen/src/v1/epi-users.ts` when running seed configurations (e.g., `seed/pay/seed-config.json`). The seeder creates a user with an embedded OAuth2 client using the scopes and grants listed above.

### Installation Flow

```bash
# 1) Create a payment integration (name + baseUrl required)
curl -X POST -u ":banana" "localhost:5000/api/v1/payment-integrations" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"name": "Mock"},
    "baseUrl": "https://mock-payment.example.com"
  }'

# 2) Create a user for the integration with an OAuth2 client
# The user must have the integration as its holder (agent).
# First, get the integration key:
#   curl -X GET -u ":banana" "localhost:5000/api/v1/epi-integrations/name=Mock/identifiers/key"
# Then create the user with embedded OAuth2 client:
curl -X POST -u ":banana" "localhost:5000/api/v1/users" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.userId": "user-mock-integration"},
    "agent": {"identifiers": {"key": "<integration-db-key>"}},
    "oauth2Clients": [{
      "identifiers": {"clientID": "mock-integration-client"},
      "scopes": ["me", "geo:read", "orders.sales:write", "orders.payments:write", "payment-records:write", "kv"],
      "secret": "your-secure-client-secret",
      "accessTokenLifetimeSeconds": 3600,
      "refreshTokenLifetimeSeconds": 2592000,
      "grants": ["client_credentials"],
      "isConfidential": true,
      "node": {"identifiers": {"com.heads.seedID": "ourcompany"}}
    }]
  }'

# 3) Install the integration
# The install action sends installation payload to the integration's baseUrl
curl -X PATCH -u ":banana" "localhost:5000/api/v1/epi-integrations/name=Mock" \
  -H "Content-Type: application/json" \
  -d '{"install": true}'

# 4) Create EPI configuration for a specific node
# NOTE: Both integration and node setters require database keys.
# First, get the integration key:
#   curl -X GET -u ":banana" "localhost:5000/api/v1/epi-integrations/name=Mock/identifiers/key"
# Then, get the node (agent) key:
#   curl -X GET -u ":banana" "localhost:5000/api/v1/companies/com.heads.seedID=ourcompany/identifiers/key"
# Then use those keys:
curl -X POST -u ":banana" "localhost:5000/api/v1/epi-configurations" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.configId": "company-mock-config"},
    "integration": {"identifiers": {"key": "epi123456789012345678901234567890"}},
    "node": {"identifiers": {"key": "agt123456789012345678901234567890"}},
    "configuration": {
      "message": "You are Company Mock!"
    }
  }'

# 5) Configure the integration for first-time setup
curl -X PATCH -u ":banana" "localhost:5000/api/v1/epi-configurations/com.myapp.configId=company-mock-config" \
  -H "Content-Type: application/json" \
  -d '{"configure": true}'
```

---

## Metrics: Sync Webhooks

Example metrics emitted per webhook run using the webhook `logName`:

```text
cos_sync_webhook_runs_total{webhook_log_name="WebHook 'product-sync'",status="success"} 12
cos_sync_webhook_runs_total{webhook_log_name="WebHook 'product-sync'",status="failure"} 2
cos_sync_webhook_retries_total{webhook_log_name="WebHook 'product-sync'"} 1
cos_sync_webhook_attempts_exhausted_total{webhook_log_name="WebHook 'product-sync'"} 0
cos_sync_webhook_last_success_timestamp_ms{webhook_log_name="WebHook 'product-sync'"} 1734514825012
cos_sync_webhook_last_failure_timestamp_ms{webhook_log_name="WebHook 'product-sync'"} 1734514750123
cos_sync_webhook_duration_ms_bucket{webhook_log_name="WebHook 'product-sync'",le="1000"} 10
cos_sync_webhook_duration_ms_bucket{webhook_log_name="WebHook 'product-sync'",le="+Inf"} 14
```

Notes:
- Labels use `logName` for human-readable identification.
- Do not include URLs, secrets, or error messages in labels.
- Cardinality of 10-30 per tenant is acceptable.
