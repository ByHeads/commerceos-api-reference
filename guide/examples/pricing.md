# Pricing Examples

Curl examples for prices, currencies, and VAT codes.

**Base URL:** `http://localhost:5000/api/v1`
**API Key:** `banana` (passed via Basic Auth with empty username: `-u ":banana"`)

> **See also:** [Examples Index](../examples.md) | [Reference Documentation](../../reference/)

---

## Prices

```bash
# List all prices
curl -X GET -u ":banana" "localhost:5000/api/v1/prices"

# Get prices for a product
curl -X GET -u ":banana" "localhost:5000/api/v1/products/com.myapp.sku=SKU-001/prices"

# Get prices with currency info
curl -X GET -u ":banana" "localhost:5000/api/v1/prices~with(currency)~take(20)"

# Create a price
curl -X POST -u ":banana" "localhost:5000/api/v1/prices" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.priceId": "PRICE-001"},
    "products": [{"identifiers": {"com.myapp.sku": "SKU-001"}}],
    "sellers": [{"identifiers": {"com.heads.seedID": "ourcompany"}}],
    "amount": 199.00,
    "currency": {"identifiers": {"currencyCode": "SEK"}}
  }'

# Create price with validity period
curl -X POST -u ":banana" "localhost:5000/api/v1/prices" \
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
curl -X POST -u ":banana" "localhost:5000/api/v1/prices" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.priceId": "PRICE-003"},
    "products": [{"identifiers": {"com.myapp.sku": "SKU-001"}}],
    "sellers": [{"identifiers": {"com.heads.seedID": "ourcompany"}}],
    "buyers": [{"identifiers": {"com.myapp.customerId": "CUST-001"}}],
    "amount": 179.00,
    "currency": {"identifiers": {"currencyCode": "SEK"}}
  }'

# Update price
curl -X PATCH -u ":banana" "localhost:5000/api/v1/prices/com.myapp.priceId=PRICE-001" \
  -H "Content-Type: application/json" \
  -d '{"amount": 189.00}'

# Delete price
curl -X DELETE -u ":banana" "localhost:5000/api/v1/prices/com.myapp.priceId=PRICE-001"
```

---

## Currencies

> **Note:** Currencies expose `identifiers.currencyCode` plus common identifiers (e.g. `identifiers.key` and namespaced IDs) — no `name`, `symbol`, or `decimalDigits` fields.

```bash
# List all currencies
curl -X GET -u ":banana" "localhost:5000/api/v1/currencies"

# Get currency by code
curl -X GET -u ":banana" "localhost:5000/api/v1/currencies/currencyCode=SEK"

# Create/update currency (identifiers.currencyCode plus other identifiers)
curl -X PUT -u ":banana" "localhost:5000/api/v1/currencies/currencyCode=USD" \
  -H "Content-Type: application/json" \
  -d '{"identifiers": {"currencyCode": "USD"}}'
```

---

## Currency Denominations

> **Note:** Denominations are a separate resource — NOT available via `~with(denominations)` on currency.

```bash
# List all currency denominations
curl -X GET -u ":banana" "localhost:5000/api/v1/currency-denominations"

# Get denominations for a specific currency (use ~where filter)
curl -X GET -u ":banana" "localhost:5000/api/v1/currency-denominations~where(currency/identifiers/currencyCode=SEK)"

# Create a currency denomination
curl -X POST -u ":banana" "localhost:5000/api/v1/currency-denominations" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.denomId": "SEK-20"},
    "currency": {"identifiers": {"currencyCode": "SEK"}},
    "name": "20 kr",
    "value": "20"
  }'
```

---

## VAT Codes

> **Note:** VAT codes only use `identifiers.percentage` (and optional namespaced IDs) — no `vatCodeId`, `name`, or `country` fields.

```bash
# List all VAT codes
curl -X GET -u ":banana" "localhost:5000/api/v1/vat-codes"

# Get VAT code by percentage
curl -X GET -u ":banana" "localhost:5000/api/v1/vat-codes/percentage=25"

# Create VAT code (use identifiers.percentage only)
curl -X POST -u ":banana" "localhost:5000/api/v1/vat-codes" \
  -H "Content-Type: application/json" \
  -d '{"identifiers": {"percentage": "25"}}'

# Create VAT code with namespaced identifier
curl -X POST -u ":banana" "localhost:5000/api/v1/vat-codes" \
  -H "Content-Type: application/json" \
  -d '{"identifiers": {"com.myapp.vatId": "SE25", "percentage": "25"}}'
```

---

## Notes

- **Currencies**: `identifiers.currencyCode` plus common identifiers (e.g. `identifiers.key` and namespaced IDs) are supported — `name`, `symbol`, `decimalDigits` fields do NOT exist
- **Denominations**: Use `/v1/currency-denominations~where(currency/identifiers/currencyCode=X)` to filter by currency
- **VAT Codes**: Identified by `percentage` — no separate `vatCodeId`, `name`, or `country` fields
- **Buyer restrictions**: The `buyers` array accepts individual agent identifiers. For group-based pricing, use [customer groups](../../reference/working-with/customers.md#customer-groups) with [discount rules](./discount-rules.md#customer-groups-and-buyer-conditions) to apply discounts to all members of a group
