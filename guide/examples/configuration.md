# Configuration & Reference Data Examples

Curl examples for countries, languages, templates, mapped types, dynamic properties, payment methods, discount/return reasons, delivery/payment terms, sales channels, customer groups, sync webhooks, shortened links, the key-value store, config API, order numbering serials, and EPI integrations.

**Base URL:** `https://example.app.heads.com/api/v1`
**API Key:** `banana` (passed via Basic Auth with empty username: `-u ":banana"`)

> **See also:** [Examples Index](../examples.md) | [Reference Documentation](../../reference/)

---

## Countries & Geography

```bash
# List all countries
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/countries"

# Get country by code
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/countries/countryCode=SE"

# Get country with child places (e.g., cities, regions)
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/countries/countryCode=SE~with(children)"

# List all cities
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/cities"

# Create/update country
curl -X PUT -u ":banana" "https://example.app.heads.com/api/v1/countries/countryCode=NO" \
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
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/languages"

# Get language by code
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/languages/languageCode=sv"

# Create/update language
curl -X PUT -u ":banana" "https://example.app.heads.com/api/v1/languages/languageCode=nb" \
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
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/templates"

# Get template by ID
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/templates/templateId=default-receipt"

# Create a template (templateLanguage + mimeType required)
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/templates" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"templateId": "custom-receipt"},
    "name": "Custom Receipt Template",
    "templateLanguage": "handlebars",
    "mimeType": "text/html",
    "text": "RECEIPT\n========\n{{items}}\n--------\nTotal: {{total}}"
  }'

# Update template
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/templates/templateId=custom-receipt" \
  -H "Content-Type: application/json" \
  -d '{"text": "RECEIPT v2\n========\n{{items}}\n--------\nTotal: {{total}}\nThank you!"}'
```

---

## Mapped Types

```bash
# List all mapped types
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/mapped-types"

# Get mapped type by name
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/mapped-types/mappedTypeName=com.heads.receipt-csv"

# Create a mapped type
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/mapped-types" \
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
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/products~map(com.myapp.product-export)~take(10)"

# Map a receipts bundle (default mapped type)
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/receipts~map(com.heads.receipts-zip)"

# Map request bodies on write (NOT CURRENTLY WORKING - see note below)
# This example shows intended usage but X-Request-Map is blocked pending resolver changes.
curl -X PUT -u ":banana" "https://example.app.heads.com/api/v1/products" \
  -H "Content-Type: application/json" \
  -H "X-Request-Map: com.myapp.product-import" \
  -d '[{"sku":"P-001","title":"Mapped Product","state":"Active"}]'
```

> **Important: X-Request-Map is currently blocked**
>
> Request-body mapping via `X-Request-Map` is not reliable yet. The resolver treats selectors like `"sku"` as reference paths (`regularStringsMapping="reference"`), but raw JSON has no Pillow type context, so resolution fails. Until the resolver supports literal mapping of raw JSON, this feature is effectively unsupported. Use normal payloads or `~map(...)` on reads instead.

---

## Dynamic Properties

Namespaced members an integration adds to a concept without a schema change. Register once at deploy time, then use the key on individual records. Full rules — including which write scope each collection's registry sits behind — in [Dynamic Properties](../../reference/resource-patterns.md#dynamic-properties).

```bash
# List the dynamic properties defined on products
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/products/properties/dynamic"

# Register one (needs products:write)
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/products/properties/dynamic" \
  -H "Content-Type: application/json" \
  -d '{"com.myapp.tracking": {"propertyType": "string", "description": "Carrier tracking id"}}'

# The response is the registry as it stands - if com.myapp.tracking is not in it,
# the write was dropped for want of a write scope. There is no error to catch.

# Read one property's definition
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/products/properties/dynamic/com.myapp.tracking"

# Change only the description - never re-register just to reword it
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/products/properties/dynamic/com.myapp.tracking/description" \
  -H "Content-Type: application/json" \
  -d '"Carrier tracking number"'

# requiredOnCreate can go straight in the registration body above; this leaf sets it
# without re-registering. Either way, a later registration that omits the flag clears it.
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/products/properties/dynamic/com.myapp.tracking/requiredOnCreate" \
  -H "Content-Type: application/json" \
  -d 'true'

# Set the value on a record - a top-level namespaced key, not under properties
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/products/com.myapp.sku=WIDGET-001" \
  -H "Content-Type: application/json" \
  -d '{"com.myapp.tracking": "TRK-99"}'

# Read it back - values are non-essential, and ~withAll does NOT include them
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/products/com.myapp.sku=WIDGET-001~with(com.myapp.tracking)"

# Remove the registration - this also stops every stored value reading
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/products/properties/dynamic" \
  -H "Content-Type: application/json" \
  -d '{"com.myapp.tracking": null}'
```

> **Two things that surprise people.** Registering under a scope that only *reads* the collection is a `200` that registers nothing, so a deploy step can stop working silently after a key is re-scoped — check the response body rather than the status ([gotcha 43](../../reference/common-gotchas.md#43-registering-a-dynamic-property-under-a-read-scope-is-a-silent-200)). And re-registering a property with a *different* `propertyType`, or removing it, makes its values stop reading on every record of the concept at once; re-registering with the same `propertyType` is safe ([gotcha 44](../../reference/common-gotchas.md#44-retyping-a-dynamic-property-blanks-it-on-every-record)).

---

## Payment Methods

```bash
# List all payment methods
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/payment-methods"

# Get payment method by ID
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/payment-methods/methodId=com.heads.cash"

# Create a payment method (no description field supported)
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/payment-methods" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"methodId": "com.myapp.gift-card"},
    "name": "Gift Card"
  }'

# Update payment method
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/payment-methods/methodId=com.myapp.gift-card" \
  -H "Content-Type: application/json" \
  -d '{"name": "Store Gift Card"}'
```

---

## Discount & Return Reasons

```bash
# List discount reasons
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/discount-reasons"

# Create discount reason (no description field supported; use name + active)
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/discount-reasons" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.reasonId": "EMPLOYEE"},
    "name": "Employee Discount",
    "active": true
  }'

# List return reasons
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/return-reasons"

# Create return reason (no description field; use usedForReturns + restock)
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/return-reasons" \
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
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/delivery-terms"

# Create a delivery term through the collection for its code.
# The collection fixes the code, so there is no incotermCode to send.
# NOTE: location setter requires a database key. First, get the place key:
#   curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/places/address.cityName=Stockholm/identifiers/key"
# Then use that key in the location field:
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/fob-delivery-terms" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.termId": "FOB-STOCKHOLM"},
    "location": {
      "identifiers": {"key": "plc123456789012345678901234567890"}
    }
  }'

# The same term through the generic collection, where the code selects the type.
# The response names what it became - a "fob delivery term", not the collection
# you posted to.
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/incoterm-delivery-terms" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.termId": "FOB-GOTHENBURG"},
    "incotermCode": "FOB"
  }'

# List payment terms
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/payment-terms"

# Create payment term (no description field supported)
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/payment-terms" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.termId": "NET30"},
    "name": "Net 30"
  }'
```

> **`incotermCode` decides the term's type, so a mismatched code moves the record.** Posting to `/v1/cfr-delivery-terms` with `"incotermCode": "DDP"` answers `200` naming a `ddp delivery term`, and that record is then absent from `/v1/cfr-delivery-terms` entirely. Omit the code when the collection already implies it, and check the `@type` you get back against the one the collection implies. See [Incoterms](../../reference/working-with/stock.md#incotermcode-is-the-type-not-a-label) and [gotcha 48](../../reference/common-gotchas.md#48-a-member-write-can-move-a-record-to-another-collection).

---

## Sales Channels

```bash
# List all sales channels
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/sales-channels"

# Get sales channel by ID
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/sales-channels/com.myapp.channelId=webshop"

# Get sales channel products
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/sales-channels/com.myapp.channelId=webshop/products"

# Create a sales channel
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/sales-channels" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.channelId": "webshop"},
    "name": "Online Webshop"
  }'
```

---

## Customer Groups

> For full documentation on customer group management, membership assignment, and using groups with discount rules, see [Working with Customers — Customer Groups](../../reference/working-with/customers.md#customer-groups) and [Discount Rules — Buyer Conditions](./discount-rules.md#customer-groups-and-buyer-conditions).

```bash
# List all customer groups
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/customer-groups"

# Get customer group by ID
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/customer-groups/com.myapp.groupId=vip"

# Get customer group members (trade relationships in this group)
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/customer-groups/com.myapp.groupId=vip/members"

# Create a customer group
# NOTE: owner setter requires a database key. First, get the agent key:
#   curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/companies/com.heads.seedID=ourcompany/identifiers/key"
# Then use that key in the owner field:
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/customer-groups" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.groupId": "vip"},
    "name": "VIP Customers",
    "memberMoniker": "VIP",
    "owner": {"identifiers": {"key": "agt123456789012345678901234567890"}}
  }'

# Assign a customer to a group (via trade relationship)
curl -X POST -u ":banana" \
  "https://example.app.heads.com/api/v1/trade-relationships/com.myapp.relId=REL-001/groups" \
  -H "Content-Type: application/json" \
  -d '{"identifiers": {"com.myapp.groupId": "vip"}}'

# Remove a customer from a group
curl -X DELETE -u ":banana" \
  "https://example.app.heads.com/api/v1/trade-relationships/com.myapp.relId=REL-001/groups/com.myapp.groupId=vip"
```

---

## Sync Webhooks

```bash
# List all sync webhooks
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/sync-webhooks"

# Get sync webhook by ID
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/sync-webhooks/com.myapp.webhookId=product-sync"

# Create a sync webhook
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/sync-webhooks" \
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
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/sync-webhooks/com.myapp.webhookId=product-sync" \
  -H "Content-Type: application/json" \
  -d '{"repeat": false}'

# then.set doing both jobs at once: write to another resource AND clear a flag
# on the source product. Keys that look like a resource path (start with /, ~, $,
# or api/...) are side-effect writes; every other key is patched onto the source.
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/sync-webhooks/com.myapp.webhookId=product-sync" \
  -H "Content-Type: application/json" \
  -d '{
    "then": {
      "set": {
        "api/v1/stock-entries": "$this~map(com.myapp.inbound-stock-entry)~array",
        "com.myapp.stockSyncRequested": false
      }
    }
  }'

# Is a run executing right now, and is an abort pending?
curl -X GET -u ":banana" \
  "https://example.app.heads.com/api/v1/sync-webhooks/com.myapp.webhookId=product-sync~just(inFlightSince,abortRequestedAt,error)"

# Stop the run that is currently executing (400 if none is in flight).
# The webhook keeps its schedule and runs again at the next `when`.
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/sync-webhooks/com.myapp.webhookId=product-sync" \
  -H "Content-Type: application/json" \
  -d '{"abort": true}'

# Stop a runaway webhook for good: pause first, then abort — in that order the
# aborted run has no schedule to return to.
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/sync-webhooks/com.myapp.webhookId=product-sync" \
  -H "Content-Type: application/json" \
  -d '{"when": "never"}'
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/sync-webhooks/com.myapp.webhookId=product-sync" \
  -H "Content-Type: application/json" \
  -d '{"abort": true}'
```

> **`abort` stops a run, it does not pause the webhook.** Cancellation is cooperative — the run stops at its next checkpoint, an `out` request already on the wire is allowed to finish, and the aborted run is *not* a failure: no attempt is consumed and `lastStart` stays put, so the next run re-covers the same window. See [Aborting a Run in Progress](../../reference/sync-webhooks.md#aborting-a-run-in-progress).

> **Watch the operator spelling.** It is `~array`, never `~arr`. An unknown operator resolves silently to an empty value, so a typo here delivers nothing and still reports success. See [`then.set` key routing](../../reference/sync-webhooks.md#thenset-key-routing).

Retry *counts* are per-webhook (`maxAttempts`), but retry *timings* — the concurrency window, the recovery-sweep cadence, and the internal stale-snapshot retry budget — are tenant-wide on `/v1/config/api`. See [Config API](#config-api-system-settings) below for the curl recipes.

---

## Shortened Links

```bash
# List all shortened links
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/shortened-links"

# Create shortened link (url + validTo required; shortenedLinkID is auto-generated)
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/shortened-links" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://shop.example.com/promotions/summer-2024",
    "validTo": "2025-12-31T23:59:59Z",
    "expirationRedirect": "https://shop.example.com/expired"
  }'
```

---

## Key-Value Store (`/v1/kv`)

> **Availability:** v26.1.11 and later.

A place to keep integration state the schema has no home for — a sync cursor, a feature flag, a small settings document. Entries live under a [namespaced key](../../reference/primitives.md#namespaced-key) and are addressed as `/v1/kv/{namespaced-key}/{entry}`. Each entry is a JSON document whose sub-paths can be read, written and deleted individually. Reaching any of it needs the `kv` scope.

```bash
# Store a document
curl -X PUT -u ":banana" "https://example.app.heads.com/api/v1/kv/com.example.settings/config" \
  -H "Content-Type: application/json" \
  -d '{"a": "123", "b": 1}'

# Read the whole entry back
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/kv/com.example.settings/config"
# → {"a": "123", "b": 1}

# Write one field. 200 "dsa", and the entry now reads {"a": "dsa", "b": 1}
curl -X PUT -u ":banana" "https://example.app.heads.com/api/v1/kv/com.example.settings/config/a" \
  -H "Content-Type: application/json" \
  -d '"dsa"'

# A field that is not there yet is created by writing it
curl -X PUT -u ":banana" "https://example.app.heads.com/api/v1/kv/com.example.settings/config/f" \
  -H "Content-Type: application/json" \
  -d '"new"'

# Any depth, as long as the intermediates are there. Create the branch once...
curl -X PUT -u ":banana" "https://example.app.heads.com/api/v1/kv/com.example.settings/config/x" \
  -H "Content-Type: application/json" \
  -d '{"y": {"z": 1, "keep": true}}'

# ...then one leaf at a time. Siblings and ancestors are left alone
curl -X PUT -u ":banana" "https://example.app.heads.com/api/v1/kv/com.example.settings/config/x/y/z" \
  -H "Content-Type: application/json" \
  -d '2'

# PATCH on a sub-path does the same thing as PUT
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/kv/com.example.settings/config/x/y/z" \
  -H "Content-Type: application/json" \
  -d '3'

# Remove a key - DELETE, or PUT with a body of null
curl -X DELETE -u ":banana" "https://example.app.heads.com/api/v1/kv/com.example.settings/config/a"

# An array body is stored whole, and the operators read it like a collection
curl -X PUT -u ":banana" "https://example.app.heads.com/api/v1/kv/com.example.settings/config/list" \
  -H "Content-Type: application/json" \
  -d '[3, 4, 5]'
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/kv/com.example.settings/config/list~count"   # → 3
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/kv/com.example.settings/config/list?limit=1"

# A sub-path holding nothing answers like a missing entry
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/kv/com.example.settings/config/missing"
# → 200  null
```

**A write replaces what is at the path — nothing merges.** This is the rule to hold on to, and it is unchanged. `PATCH /v1/kv/com.example.settings/config` with `{"f": 1}` replaces the whole document with `{"f": 1}`; `PUT .../config/a` with `{"b": 2}` replaces `a` entirely. To update one field, write that field's own leaf.

**Array elements are not addressable for writes.** `.../config/list/0` is a `404`; replace the whole array instead. `POST` to an array-valued key is not an append either — it replaces the array with the posted value wrapped in an array — so use `PUT`.

**An intermediate has to exist, and has to be an object.** Writing `.../config/a/b` when `a` is a string, or `.../config/x/y` when `x` does not exist, is a `404`. Create the object first.

**The key itself must be a well-formed namespaced key.** `PUT /v1/kv/com.test` is a `404` — a path segment outside the shape does not route at all, unlike the same key in a request body ([namespaced key](../../reference/primitives.md#namespaced-key)).

> **Earlier builds handled sub-paths differently.** Before v26.1.11 an entry was written and read only as a whole: writing a sub-path answered `204` and stored nothing, writing a field that did not exist yet was a `404`, `DELETE` on a sub-path answered `200 "Deleted 1 items"` while deleting nothing, and reading a missing sub-path was a `404`. An array body anywhere under `/v1/kv` stored only its last element while echoing the whole array back — that fix reaches every dynamically typed non-collection target, a mapped type's `body` included, so a note elsewhere telling you to "send one value, not an array" for such a member no longer applies.

---

## Config API (System Settings)

```bash
# Get API config (singleton)
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/config/api"

# Update API config
curl -X PUT -u ":banana" "https://example.app.heads.com/api/v1/config/api" \
  -H "Content-Type: application/json" \
  -d '{
    "publicBaseURL": "https://api.example.com",
    "verboseLogging": true,
    "requestLogPath": "/var/log/commerceos/api"
  }'

# Inspect the tenant-wide sync-webhook timings
curl -X GET -u ":banana" \
  "https://example.app.heads.com/api/v1/config/api~just(webhookInFlightWindowMs,webhookRecoveryIntervalMs,internalTooOldMaxRetries,internalTooOldRetryDelayMs)"

# Tune sync-webhook timings (all optional numbers; unset reads back as the default)
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/config/api" \
  -H "Content-Type: application/json" \
  -d '{
    "webhookInFlightWindowMs": 120000,
    "webhookRecoveryIntervalMs": 60000,
    "internalTooOldMaxRetries": 20,
    "internalTooOldRetryDelayMs": 5000
  }'

# Clear an override and go back to the default
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/config/api" \
  -H "Content-Type: application/json" \
  -d '{ "internalTooOldRetryDelayMs": null }'

# Get webshop config
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/config/webshop"

# Update webshop config
curl -X PUT -u ":banana" "https://example.app.heads.com/api/v1/config/webshop" \
  -H "Content-Type: application/json" \
  -d '{
    "siteURL": "https://shop.example.com",
    "siteTitle": {"en": "Example Shop"},
    "paymentMethods": []
  }'
```

The four sync-webhook timings on `/v1/config/api` are **tenant-wide** — they apply to every webhook and have no per-webhook override. See [System Configuration](../../reference/sync-webhooks.md#system-configuration-v1configapi) for what each one controls and when a change takes effect.

---

## Order Numbering Serials (`/v1/config/root-order`)

The numbers the platform stamps on purchasing documents come from serials named on `/v1/config/root-order`. A serial is a prefix, a next ordinal and a padded length; the order configuration says which serial numbers what. Writing either needs the `config` scope, and a number is issued only when the party it belongs to sits under the root organization node.

| Serial on `/v1/config/root-order` | Numbers | Lands in |
|---|---|---|
| `incomingTradeOrderSerial` | purchase orders | `trade order.identifiers.customersId` |
| `outgoingTradeOrderSerial` | sales orders | `trade order.identifiers.suppliersId` |
| `supplierDeliverySerial` | goods receipts | `delivery.identifiers.receiversId` |
| `customerDeliverySerial` | outbound deliveries | `delivery.identifiers.sendersId` |
| `supplierReturnSerial` | supplier returns | `return.identifiers.returnersId` |

> **Availability:** the two trade order serials are long-standing. The delivery and return serials ship in v26.2.1 and later. Not in v26.1.x.

```bash
# Create a serial: PO-00001, PO-00002, ...
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/serials" \
  -H "Content-Type: application/json" \
  -d '[{"identifiers": {"com.myapp.serialId": "PO-SERIAL"}, "prefix": "PO-", "nextOrdinal": 1, "length": 5}]'

# Point the order configuration at it - the next purchase order reads identifiers.customersId "PO-00001"
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/config/root-order" \
  -H "Content-Type: application/json" \
  -d '{"incomingTradeOrderSerial": {"identifiers": {"com.myapp.serialId": "PO-SERIAL"}}}'

# Goods-receipt and supplier-return numbers the same way
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/config/root-order" \
  -H "Content-Type: application/json" \
  -d '{"supplierDeliverySerial": {"identifiers": {"com.myapp.serialId": "GR-SERIAL"}},
       "supplierReturnSerial": {"identifiers": {"com.myapp.serialId": "RET-SERIAL"}}}'

# Read the configuration back
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/config/root-order"

# The issued numbers are indexes
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/trade-orders/customersId=PO-00001"
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/deliveries/receiversId=GR-00001"
```

The issued order numbers are read-only — a `PATCH` on `identifiers.customersId` or `suppliersId` is a `200` that changes nothing. The delivery and return numbers are writable, so a document created outside the numbered node can be given one by hand. See [Working with Purchasing → Your Purchase Order Number](../../reference/working-with/purchasing.md#your-purchase-order-number-identifierscustomersid--long-standing).

---

## EPI Integrations & Configurations

To build the integration behind `baseUrl`, read [Build a payment integration](./payment-epi.md).

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
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/payment-integrations" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"name": "Mock"},
    "baseUrl": "https://mock-payment.example.com"
  }'

# 2) Create a user for the integration with an OAuth2 client
# The user must have the integration as its holder (agent).
# First, get the integration key:
#   curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/epi-integrations/name=Mock/identifiers/key"
# Then create the user with embedded OAuth2 client:
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/users" \
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
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/epi-integrations/name=Mock" \
  -H "Content-Type: application/json" \
  -d '{"install": true}'

# 4) Create EPI configuration for a specific node
# NOTE: Both integration and node setters require database keys.
# First, get the integration key:
#   curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/epi-integrations/name=Mock/identifiers/key"
# Then, get the node (agent) key:
#   curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/companies/com.heads.seedID=ourcompany/identifiers/key"
# Then use those keys:
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/epi-configurations" \
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
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/epi-configurations/com.myapp.configId=company-mock-config" \
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
