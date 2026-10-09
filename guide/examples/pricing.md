# Pricing Examples

Curl examples for prices (net or including VAT), currencies, and VAT classes.

**Base URL:** `https://example.app.heads.com/api/v1`
**API Key:** `banana` (passed via Basic Auth with empty username: `-u ":banana"`)

> **See also:** [Examples Index](../examples.md) | [Reference Documentation](../../reference/)

---

## Prices

```bash
# List all prices
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/prices"

# Get prices for a product
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/products/com.myapp.sku=SKU-001/prices"

# Get prices with currency info
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/prices~with(currency)~take(20)"

# Create a price
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/prices" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.priceId": "PRICE-001"},
    "products": [{"identifiers": {"com.myapp.sku": "SKU-001"}}],
    "sellers": [{"identifiers": {"com.heads.seedID": "ourcompany"}}],
    "amount": 199.00,
    "currency": {"identifiers": {"currencyCode": "SEK"}}
  }'

# A consumer price: 199 kr on the shelf, VAT included. The net is derived at sale time
# from the product's VAT rate, so the shelf price survives a rate change
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/prices" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.priceId": "PRICE-010"},
    "products": [{"identifiers": {"com.myapp.sku": "SKU-010"}}],
    "sellers": [{"identifiers": {"com.heads.seedID": "ourcompany"}}],
    "amount": "199.00",
    "includesTax": true,
    "currency": {"identifiers": {"currencyCode": "SEK"}}
  }'

# A net price (the default): 159.20 excl. VAT, 199.00 on the shelf at 25 %
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/prices" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.priceId": "PRICE-011"},
    "products": [{"identifiers": {"com.myapp.sku": "SKU-011"}}],
    "sellers": [{"identifiers": {"com.heads.seedID": "ourcompany"}}],
    "amount": "159.20",
    "currency": {"identifiers": {"currencyCode": "SEK"}}
  }'

# Switch an existing price to the gross basis: give the gross amount in the same request
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/prices/com.myapp.priceId=PRICE-011" \
  -H "Content-Type: application/json" \
  -d '{"amount": "199.00", "includesTax": true}'

# Every price in the gross basis
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/prices~where(includesTax=true)~with(products)~take(100)"

# Create price with validity period
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/prices" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.priceId": "PRICE-002"},
    "products": [{"identifiers": {"com.myapp.sku": "SKU-001"}}],
    "sellers": [{"identifiers": {"com.heads.seedID": "ourcompany"}}],
    "amount": 149.00,
    "currency": {"identifiers": {"currencyCode": "SEK"}},
    "from": "2024-12-01T00:00:00Z",
    "to": "2024-12-31T23:59:59Z"
  }'

# Create price with buyer restriction (individual customer)
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/prices" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.priceId": "PRICE-003"},
    "products": [{"identifiers": {"com.myapp.sku": "SKU-001"}}],
    "sellers": [{"identifiers": {"com.heads.seedID": "ourcompany"}}],
    "buyers": [{"identifiers": {"com.myapp.customerId": "CUST-001"}}],
    "amount": 179.00,
    "currency": {"identifiers": {"currencyCode": "SEK"}}
  }'

# Create price for a customer group (serves every member of the group)
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/prices" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.priceId": "PRICE-004"},
    "products": [{"identifiers": {"com.myapp.sku": "SKU-001"}}],
    "sellers": [{"identifiers": {"com.heads.seedID": "ourcompany"}}],
    "buyers": [{"identifiers": {"com.myapp.groupId": "wholesale-customers"}}],
    "amount": 150.00,
    "currency": {"identifiers": {"currencyCode": "SEK"}}
  }'

# List a "price list": every price whose buyer is the group. The identifier goes directly
# under buyers/ - buyers/identifiers/... matches nothing. Do not tag prices with a shared
# identifier value: every identifier value names exactly one price
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/prices~where(buyers/com.myapp.groupId=wholesale-customers)~with(products,buyers)~take(100)"

# Update price
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/prices/com.myapp.priceId=PRICE-001" \
  -H "Content-Type: application/json" \
  -d '{"amount": 189.00}'

# Move a price's validity window (both bounds in one call, applied atomically)
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/prices/com.myapp.priceId=PRICE-002" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "2026-06-04T05:00:00Z",
    "to": "2026-06-16T21:59:00Z"
  }'

# Lift the expiry; the price stays valid indefinitely from its existing start
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/prices/com.myapp.priceId=PRICE-002" \
  -H "Content-Type: application/json" \
  -d '{"to": null}'

# Delete price
curl -X DELETE -u ":banana" "https://example.app.heads.com/api/v1/prices/com.myapp.priceId=PRICE-001"
```

> **Net or gross.** A price is net unless `includesTax` is `true`; `includesTax` is in every price read and defaults to `false`. With it set, `amount` is the figure on the shelf and the net is derived from the product's VAT rate at sale time: a price of `125` with `includesTax: true` on a 25 % product reads `unitAmountExclVat: "100"`, `unitAmountInclVat: "125"` on the order line, the same as a net price of `100`. A gross amount sent without the flag is taxed again. See [Working with Prices → Prices That Include VAT](../../reference/working-with/prices.md#prices-that-include-vat).

> **Validity windows.** A bound you omit keeps its stored value; a bound sent as `null` is cleared. Send both bounds together when moving a window — the pair is validated as a whole, so the new `from` may be later than the stored `to`. A resulting window whose `to` is not later than its `from` is rejected with `400` and `The end date, if specified, must be greater than the start date.`, leaving the price unchanged. See [Working with Prices → Updating Validity](../../reference/working-with/prices.md#updating-validity).

---

## Currencies

> **Note:** Currencies expose `identifiers.currencyCode` plus common identifiers (e.g. `identifiers.key` and namespaced IDs) — no `name`, `symbol`, or `decimalDigits` fields.

```bash
# List all currencies
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/currencies"

# Get currency by code
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/currencies/currencyCode=SEK"

# Create/update currency (identifiers.currencyCode plus other identifiers)
curl -X PUT -u ":banana" "https://example.app.heads.com/api/v1/currencies/currencyCode=USD" \
  -H "Content-Type: application/json" \
  -d '{"identifiers": {"currencyCode": "USD"}}'
```

---

## Currency Denominations

> **Note:** Denominations are a separate resource — NOT available via `~with(denominations)` on currency.

```bash
# List all currency denominations
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/currency-denominations"

# Get denominations for a specific currency (use ~where filter)
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/currency-denominations~where(currency/identifiers/currencyCode=SEK)"

# Create a currency denomination
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/currency-denominations" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.denomId": "SEK-20"},
    "currency": {"identifiers": {"currencyCode": "SEK"}},
    "name": "20 kr",
    "value": "20"
  }'
```

---

## VAT Classes

A price carries no VAT rate. The rate comes from the product's **VAT class** (`vatClass`, own or inherited from its group) and the VAT rules of the area the sale is made in. The reference pack ships twelve classes; install the Swedish area and they come with it.

```bash
# Install the Swedish VAT area with its classes, rules and rate defaults (idempotent)
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/vat-areas" \
  -H "Content-Type: application/json" \
  -d '[{"identifiers": {"com.heads.seedID": "vat-area-se"}}]'

# List the classes
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/vat-classes~with(supplyKind)"

# Put a product in the standard-rate class
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/products/com.myapp.sku=SKU-001" \
  -H "Content-Type: application/json" \
  -d '{"vatClass": {"identifiers": {"com.heads.seedID": "vat-class-standard"}}}'

# The class in effect and the rate per area (neither is in the default read)
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/products/com.myapp.sku=SKU-001~with(vatClass,vatRates)"
```

The model, the rules and a rate-change recipe are in [Working with VAT](../../reference/working-with/vat.md).

---

## Notes

- **Currencies**: `identifiers.currencyCode` plus common identifiers (e.g. `identifiers.key` and namespaced IDs) are supported — `name`, `symbol`, `decimalDigits` fields do NOT exist
- **Denominations**: Use `/v1/currency-denominations~where(currency/identifiers/currencyCode=X)` to filter by currency
- **VAT**: Not on the price. A product's `vatClass` and the VAT rules of the area of sale give the rate; a price says only whether its `amount` is net or gross (`includesTax`)
- **Buyer restrictions**: The `buyers` array accepts individual agents and [customer groups](../../reference/working-with/customers.md#customer-groups) alike; a group reference serves every member. The lowest eligible amount wins, so a group price only takes effect when it is lower than the general price — see [Working with Prices → Customer Groups as Buyers](../../reference/working-with/prices.md#customer-groups-as-buyers-price-lists). For percentage or bundle deals scoped to a group, use [discount rules](./discount-rules.md#customer-groups-and-buyer-conditions) instead
