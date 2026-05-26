# Trade Orders & Fulfillment Examples

Curl examples for trade orders, trade relationships, shipments, and payments.

**Base URL:** `https://example.app.heads.com/api/v1`
**API Key:** `banana` (passed via Basic Auth with empty username: `-u ":banana"`)

> **See also:** [Examples Index](../examples.md) | [Discount Rules](./discount-rules.md) | [Reference Documentation](../../reference/)

---

## Trade Orders

> **Important Notes:**
> - `sellers` is **required** on create (determines stock source)
> - Item amounts like `unitAmountInclVat` are **read-only** (calculated from prices), unless `unitAmountExclVat` is set
> - Item mutations: While the API may return 200/201 for POST/PATCH/DELETE to `/items`, the intended pattern is to set all items at creation. `unitAmountExclVat` can be PATCHed on editable items.
> - Use `tryApprove`/`tryCancel` actions (not `confirm`/`cancel`)

```bash
# List all trade orders
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/trade-orders"

# Get trade order by ID
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/trade-orders/com.myapp.orderId=ORD-2024-001"

# Get trade order with items
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/trade-orders/com.myapp.orderId=ORD-2024-001~with(items)"

# Get trade order with customer and supplier
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/trade-orders/com.myapp.orderId=ORD-2024-001~with(customer,supplier)"

# Get trade order items
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/trade-orders/com.myapp.orderId=ORD-2024-001/items"

# Get trade order payments
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/trade-orders/com.myapp.orderId=ORD-2024-001/payments"

# Get trade order shipments
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/trade-orders/com.myapp.orderId=ORD-2024-001/shipments"

# Create a sales order (sellers REQUIRED, amounts are read-only)
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/trade-orders" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.orderId": "ORD-2024-001"},
    "supplier": {"identifiers": {"com.heads.seedID": "ourcompany"}},
    "customer": {"identifiers": {"com.myapp.customerId": "CUST-001"}},
    "sellers": [{"identifiers": {"com.heads.seedID": "store1"}}],
    "currency": {"identifiers": {"currencyCode": "SEK"}},
    "items": [
      {
        "product": {"identifiers": {"com.myapp.sku": "SKU-001"}},
        "quantity": 2
      }
    ]
  }'

# Create purchase order (with sellers)
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/trade-orders" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.orderId": "PO-2024-001"},
    "supplier": {"identifiers": {"com.myapp.supplierId": "SUPP-001"}},
    "customer": {"identifiers": {"com.heads.seedID": "ourcompany"}},
    "sellers": [{"identifiers": {"com.myapp.supplierId": "SUPP-001"}}],
    "currency": {"identifiers": {"currencyCode": "SEK"}},
    "items": [
      {
        "product": {"identifiers": {"com.myapp.sku": "SKU-001"}},
        "quantity": 100
      }
    ]
  }'

# Order actions - approve order (use tryApprove, not confirm)
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/trade-orders/com.myapp.orderId=ORD-2024-001/actions" \
  -H "Content-Type: application/json" \
  -d '{"tryApprove": true}'

# Order actions - cancel order (use tryCancel, not cancel)
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/trade-orders/com.myapp.orderId=ORD-2024-001/actions" \
  -H "Content-Type: application/json" \
  -d '{"tryCancel": true}'

# Order actions - create shipment
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/trade-orders/com.myapp.orderId=ORD-2024-001/actions" \
  -H "Content-Type: application/json" \
  -d '{"createShipment": true}'

# Order actions - create payment (requires currency and methodId from /v1/payment-methods)
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/trade-orders/com.myapp.orderId=ORD-2024-001/actions" \
  -H "Content-Type: application/json" \
  -d '{
    "createPayment": {
      "timestamp": "2024-01-15T10:30:00Z",
      "transactionId": "TXN-001",
      "currency": {"identifiers": {"currencyCode": "SEK"}},
      "method": {"identifiers": {"methodId": "com.heads.cash"}}
    }
  }'

# Delete order
curl -X DELETE -u ":banana" "https://example.app.heads.com/api/v1/trade-orders/com.myapp.orderId=ORD-2024-001"
```

### Time-relative queries

Trade orders expose `/before/` and `/after/` for time-sliced reads — useful for incremental sync between an external order system and CommerceOS. See [Operators → Time-relative queries](../../reference/operators.md#time-relative-queries-before-and-after) for the shared mechanics.

```bash
# Default mode: orders modified at or after the given ISO timestamp
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/trade-orders/after/2025-02-01T00:00:00.000Z~take(100)"

# Explicit creation-time filter: orders placed at or after the given timestamp
# (useful when you want to ignore later edits and look at when the order itself happened)
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/trade-orders/after(create)/2025-02-01T00:00:00.000Z~take(100)"

# Orders placed before a cutoff (exclusive end), newest first
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/trade-orders/before/2025-03-01T00:00:00.000Z~take(100)"
```

> **Default:** `modify` — the request returns orders whose **last edit** falls in the range. Add `(create)` when you specifically want **placement time** instead. For incremental sync (re-fetching everything that changed since your last poll), the default is what you want; for daily aggregations of orders placed each day, use `(create)`.
>
> **Recommended:** use `/after/` and `/before/` for any time-windowed read of trade orders — they are index-backed and the canonical pattern. Use `~where(timestamp...)` only when you need to combine the time filter with a non-time predicate.

---

## Trade Relationships

```bash
# List all trade relationships
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/trade-relationships"

# Get trade relationship by ID
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/trade-relationships/com.heads.seedID=rel-001"

# Get relationship with agents
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/trade-relationships/com.heads.seedID=rel-001~with(supplierAgent,customerAgent)"

# Create a trade relationship (supplier-customer)
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/trade-relationships" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.relId": "REL-001"},
    "supplierAgent": {"identifiers": {"com.heads.seedID": "ourcompany"}},
    "customerAgent": {"identifiers": {"com.myapp.customerId": "CUST-001"}},
    "defaultCurrency": {"identifiers": {"currencyCode": "SEK"}}
  }'

# Create relationship with payment and delivery terms
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/trade-relationships" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.relId": "REL-002"},
    "supplierAgent": {"identifiers": {"com.heads.seedID": "ourcompany"}},
    "customerAgent": {"identifiers": {"com.myapp.companyId": "COMP-001"}},
    "defaultCurrency": {"identifiers": {"currencyCode": "SEK"}},
    "creditAllowed": true,
    "allowsBackOrder": true
  }'

# Update relationship
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/trade-relationships/com.myapp.relId=REL-001" \
  -H "Content-Type: application/json" \
  -d '{"creditAllowed": true}'
```

---

## Shipment Orders

> **Note:** Shipment orders can be created directly via `POST /v1/shipment-orders` or via the trade order `createShipment` action.

```bash
# List all shipment orders
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/shipment-orders"

# Get shipment order by ID
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/shipment-orders/com.myapp.shipmentId=SHIP-001"

# Get shipment with items
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/shipment-orders/com.myapp.shipmentId=SHIP-001~with(items)"

# Get shipment's related trade orders
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/shipment-orders/com.myapp.shipmentId=SHIP-001/orders"

# Get shipment records
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/shipment-orders/com.myapp.shipmentId=SHIP-001/records"

# Create a shipment order directly
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/shipment-orders" \
  -H "Content-Type: application/json" \
  -d '[{
    "identifiers": {"com.myapp.shipmentOrderId": "SHIP-002"},
    "shipper": {"identifiers": {"com.heads.seedID": "ourcompany"}},
    "recipient": {"identifiers": {"com.myapp.customerId": "CUST-001"}},
    "items": [
      {"product": {"identifiers": {"com.myapp.sku": "SKU-001"}}, "quantity": 5}
    ]
  }]'

# Shipment finder (only modifiedTag filter is supported)
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/shipment-orders/@find" \
  -H "Content-Type: application/json" \
  -d '{"modifiedTag": "abc123"}'

# Release shipment order (only available action)
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/shipment-orders/com.myapp.shipmentId=SHIP-001/actions" \
  -H "Content-Type: application/json" \
  -d '{"release": true}'
```

### Shipment Orders — Time-relative queries

```bash
# Default mode: shipment orders modified at or after the given ISO timestamp
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/shipment-orders/after/2025-02-01T00:00:00.000Z~take(100)"

# Explicit creation-time filter: shipment orders created at or after the given timestamp
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/shipment-orders/after(create)/2025-02-01T00:00:00.000Z~take(100)"
```

> **Default:** `modify` — picks up status transitions (`Released`, `Transiting`, `Acquired`) as well as creation. Use `(create)` if you only care about new shipment orders. See [Operators → Time-relative queries](../../reference/operators.md#time-relative-queries-before-and-after).
>
> **Recommended:** use `/after/` and `/before/` for any time-windowed read of shipment orders — they are index-backed and the canonical pattern. Use `~where(timestamp...)` only when you need to combine the time filter with a non-time predicate.

---

## Picking Orders

> **Note:** Picking orders are **read-only** — they are created automatically as part of shipment processing.

```bash
# List all picking orders
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/picking-orders"

# Get picking order by ID
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/picking-orders/pickingOrderId=PICK-001"
```

---

## Payment Orders

> **Note:** Payment orders can be created directly via `POST /v1/payment-orders` or via the trade order `createPayment` action.

```bash
# List all payment orders
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/payment-orders"

# Create a payment order directly
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/payment-orders" \
  -H "Content-Type: application/json" \
  -d '[{
    "identifiers": {"com.myapp.paymentOrderId": "PAY-002"},
    "amount": "500.00",
    "currency": {"identifiers": {"currencyCode": "SEK"}},
    "method": {"identifiers": {"methodId": "com.heads.cash"}},
    "payer": {"identifiers": {"com.myapp.customerId": "CUST-001"}},
    "payee": {"identifiers": {"com.heads.seedID": "store1"}}
  }]'

# Get payment order by ID
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/payment-orders/com.myapp.paymentOrderId=PAY-001"

# Get payment orders for a trade order
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/trade-orders/com.myapp.orderId=ORD-2024-001/payments"
```

### Payment Orders — Time-relative queries

```bash
# Default mode: payment orders modified at or after the given ISO timestamp
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/payment-orders/after/2025-02-01T00:00:00.000Z~take(100)"

# Explicit creation-time filter: payment orders created at or after the given timestamp
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/payment-orders/after(create)/2025-02-01T00:00:00.000Z~take(100)"
```

> **Default:** `modify` — captures status changes (`Authorized`, `Debited`, `Annulled`, `Credited`) along with creation, which is what reconciliation jobs typically need. Use `(create)` to enumerate payments by when they were first booked. See [Operators → Time-relative queries](../../reference/operators.md#time-relative-queries-before-and-after).
>
> **Recommended:** use `/after/` and `/before/` for any time-windowed read of payment orders — they are index-backed and the canonical pattern. Use `~where(timestamp...)` only when you need to combine the time filter with a non-time predicate.

---

## Returns

Three actions drive a trade-order line through its return lifecycle: `commitReturn` (Fulfilled/New → ReturnCommitted), `fulfillReturn` (ReturnCommitted → ReturnFulfilled, with optional restock), and `cancelReturn` (ReturnCommitted → Fulfilled). Money movement is handled separately via a negative `createPayment` — see [Refund Processing](../../reference/working-with/orders.md#refund-processing).

```bash
# 1. Commit a return on one line item of a fulfilled order
curl -X PATCH -u ":banana" \
  "https://example.app.heads.com/api/v1/trade-orders/com.myapp.orderId=ORD-2024-001/actions" \
  -H "Content-Type: application/json" \
  -d '{
    "commitReturn": {
      "items": [{
        "identifiers": { "key": "{trade-order-item-key}" },
        "returnParameters": {
          "reason": { "identifiers": { "com.myapp.id": "defective" } },
          "complaint": true,
          "restock": true,
          "receiptNotes": "Returned per 30-day policy"
        }
      }]
    }
  }'

# 2. Fulfill the committed return (restocks if restock=true at commit time)
curl -X PATCH -u ":banana" \
  "https://example.app.heads.com/api/v1/trade-orders/com.myapp.orderId=ORD-2024-001/actions" \
  -H "Content-Type: application/json" \
  -d '{
    "fulfillReturn": {
      "items": [{ "identifiers": { "key": "{trade-order-item-key}" } }]
    }
  }'

# 3. Or, cancel the committed return (customer changed mind, item rejected at receiving, etc.)
curl -X PATCH -u ":banana" \
  "https://example.app.heads.com/api/v1/trade-orders/com.myapp.orderId=ORD-2024-001/actions" \
  -H "Content-Type: application/json" \
  -d '{
    "cancelReturn": {
      "items": [{ "identifiers": { "key": "{trade-order-item-key}" } }]
    }
  }'
```

### Returning a Specific IMEI From a Multi-Unit Line

For IMEI-tracked phones, wallet instances, or any case where one specific unit is returned out of a multi-unit line, use the optional `productInstance` field. Resolution honours `identifiers` and `serialNumber`; omit `productInstance` to return the whole line.

```bash
curl -X PATCH -u ":banana" \
  "https://example.app.heads.com/api/v1/trade-orders/com.myapp.orderId=ORD-2024-001/actions" \
  -H "Content-Type: application/json" \
  -d '{
    "commitReturn": {
      "items": [{
        "identifiers": { "key": "{trade-order-item-key}" },
        "returnParameters": {
          "reason": { "identifiers": { "com.myapp.id": "defective" } }
        },
        "productInstance": {
          "identifiers": { "key": "{product-instance-key}" },
          "serialNumber": "IMEI-987654321098765"
        }
      }]
    }
  }'
```

### Exchange: Commit a Return with a Replacement Product

`returnParameters.replacement` records that the customer is exchanging for a different SKU. The replacement reference is captured at commit-time alongside the rest of the return parameters.

```bash
curl -X PATCH -u ":banana" \
  "https://example.app.heads.com/api/v1/trade-orders/com.myapp.orderId=ORD-2024-001/actions" \
  -H "Content-Type: application/json" \
  -d '{
    "commitReturn": {
      "items": [{
        "identifiers": { "key": "{trade-order-item-key}" },
        "returnParameters": {
          "reason": { "identifiers": { "com.myapp.id": "wrong-size" } },
          "restock": true,
          "replacement": { "identifiers": { "com.myapp.sku": "SHIRT-L" } }
        }
      }]
    }
  }'
```

> **See also:** [Returns and Refunds reference](../../reference/working-with/orders.md#returns-and-refunds) for the full per-field breakdown, preconditions, and validation behaviour.

---

## Manual Unit Amounts

Override computed pricing with manual unit amounts (excluding VAT):

```bash
# Create order with manual unit amount
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/trade-orders" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.orderId": "ORD-MANUAL-001"},
    "supplier": {"identifiers": {"com.heads.seedID": "ourcompany"}},
    "customer": {"identifiers": {"com.myapp.customerId": "CUST-001"}},
    "sellers": [{"identifiers": {"com.heads.seedID": "store1"}}],
    "currency": {"identifiers": {"currencyCode": "SEK"}},
    "items": [
      {
        "product": {"identifiers": {"com.myapp.sku": "SERVICE-INSTALL"}},
        "quantity": 1,
        "unitAmountExclVat": "129.00"
      }
    ]
  }'

# Update item unit amount (PATCH to item)
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/trade-orders/com.myapp.orderId=ORD-MANUAL-001/items/key=abc12345678901234567890123456" \
  -H "Content-Type: application/json" \
  -d '{"unitAmountExclVat": "149.50"}'

# Free promotional item (zero amount)
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/trade-orders" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.orderId": "ORD-PROMO-001"},
    "supplier": {"identifiers": {"com.heads.seedID": "ourcompany"}},
    "customer": {"identifiers": {"com.myapp.customerId": "CUST-001"}},
    "sellers": [{"identifiers": {"com.heads.seedID": "store1"}}],
    "currency": {"identifiers": {"currencyCode": "SEK"}},
    "items": [
      {
        "product": {"identifiers": {"com.myapp.sku": "MAIN-PRODUCT"}},
        "quantity": 1
      },
      {
        "product": {"identifiers": {"com.myapp.sku": "FREE-GIFT"}},
        "quantity": 1,
        "unitAmountExclVat": "0.00"
      }
    ]
  }'
```

---

## Mobile Trade-in & Mobilpant Examples

Examples for IMEI device sales, phone-plan linkage, trade-in (mobilbytte) payments, mobilpant discounts, and combined payment methods.

> **Key concepts:**
> - **IMEI tracking**: Device items use `instances: [{ "imei": "..." }]` to track the physical device
> - **Phone-plan linkage**: Plan items use `instances: [{ "phoneImei": "..." }]` to link a subscription to a device IMEI
> - **`discountable: false`**: Set on trade-in device items to prevent automatic discount rules from applying to them
> - **Payment method IDs**: `com.heads.mobilbytte` (trade-in credit) and `com.heads.mobilpant` (installment plan)

### IMEI device + phone plan order

Create an order with a device (tracked by IMEI) and a linked phone plan:

```bash
# Device sale with linked phone plan
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/trade-orders" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.heads.seedID": "example-ord-001" },
    "supplier": { "@type": "company", "identifiers": { "com.heads.seedID": "ourcompany" } },
    "customer": { "@type": "person", "identifiers": { "com.heads.seedID": "sarah-connor" }, "fullName": "Sarah Connor" },
    "currency": { "@type": "currency", "identifiers": { "currencyCode": "SEK" } },
    "items": [
      {
        "product": { "identifiers": { "com.heads.seedID": "iphone15-128-Black-New" } },
        "instances": [{ "imei": "123456789012345" }]
      },
      {
        "product": { "identifiers": { "com.heads.seedID": "ubegrensetpluss" } },
        "instances": [{ "phoneImei": "123456789012345" }]
      }
    ],
    "sellers": [{ "@type": "store", "identifiers": { "com.heads.seedID": "shadestockholm" } }],
    "actions": { "tryApprove": true }
  }'
```

> The phone plan's `phoneImei` matches the device's `imei`, creating an explicit linkage.

### Mobilbytte payment (trade-in)

Trade-in order where the old device's value is applied as a mobilbytte payment. The device item is marked `discountable: false` so discount rules don't apply to it:

```bash
# Trade-in order with mobilbytte payment
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/trade-orders" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.heads.seedID": "example-ord-002" },
    "supplier": { "@type": "company", "identifiers": { "com.heads.seedID": "ourcompany" } },
    "customer": { "@type": "person", "identifiers": { "com.heads.seedID": "john-mcclane" }, "fullName": "John McClane" },
    "currency": { "@type": "currency", "identifiers": { "currencyCode": "SEK" } },
    "items": [
      {
        "identifiers": { "com.heads.seedID": "imei-002" },
        "product": { "identifiers": { "com.heads.seedID": "iphone15-128-Black-New" } },
        "instances": [{ "imei": "123456789012346" }],
        "discountable": false
      },
      {
        "product": { "identifiers": { "com.heads.seedID": "ubegrensetpluss" } },
        "instances": [{ "phoneImei": "123456789012346" }]
      }
    ],
    "sellers": [{ "@type": "store", "identifiers": { "com.heads.seedID": "shadestockholm" } }],
    "actions": {
      "tryApprove": true,
      "createPayment": {
        "transactionId": "payment1-example-002",
        "timestamp": "2025-01-01T12:00:00Z",
        "method": { "identifiers": { "methodId": "com.heads.mobilbytte" } },
        "currency": { "identifiers": { "currencyCode": "SEK" } },
        "items": [{ "identifiers": { "com.heads.seedID": "imei-002" } }]
      }
    }
  }'
```

> The `createPayment.items` references the trade-in device item by its identifiers. The payment amount is determined by the trade-in valuation.

### Mobilpant manual discounts

Mobilpant uses manual discounts (voucher-style) applied across multiple items. Each discount is a `fixed reduction manual discount` with `multiplicity: "PerApplication"` and `includesTax: true`:

```bash
# Order with mobilpant manual discounts across multiple items
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/trade-orders" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.heads.seedID": "example-ord-003" },
    "supplier": { "@type": "company", "identifiers": { "com.heads.seedID": "ourcompany" } },
    "customer": { "@type": "person", "identifiers": { "com.heads.seedID": "ellen-ripley" }, "fullName": "Ellen Ripley" },
    "currency": { "@type": "currency", "identifiers": { "currencyCode": "SEK" } },
    "items": [
      {
        "identifiers": { "com.heads.seedID": "imei-003-1" },
        "product": { "identifiers": { "com.heads.seedID": "iphone15-128-Black-New" } },
        "instances": [{ "imei": "123456789012347" }]
      },
      {
        "identifiers": { "com.heads.seedID": "imei-003-2" },
        "product": { "identifiers": { "com.heads.seedID": "ubegrensetpluss" } },
        "instances": [{ "phoneImei": "123456789012347" }]
      },
      {
        "identifiers": { "com.heads.seedID": "imei-003-3" },
        "product": { "identifiers": { "com.heads.seedID": "anker-soundcore-p40i" } },
        "quantity": "1"
      },
      {
        "identifiers": { "com.heads.seedID": "imei-003-4" },
        "product": { "identifiers": { "com.heads.seedID": "Holdit-MagSafe-Case-iPhone-15-14-13" } },
        "quantity": "1"
      }
    ],
    "sellers": [{ "@type": "store", "identifiers": { "com.heads.seedID": "shadestockholm" } }],
    "manualDiscounts": [
      {
        "@type": "fixed reduction manual discount",
        "amount": "1200",
        "multiplicity": "PerApplication",
        "includesTax": true,
        "reason": { "identifiers": { "com.heads.seedID": "mobilpant" }, "name": "Mobilpant" },
        "notes": "Voucher #123456",
        "discountedItems": [
          { "identifiers": { "com.heads.seedID": "imei-003-1" } },
          { "identifiers": { "com.heads.seedID": "imei-003-2" } },
          { "identifiers": { "com.heads.seedID": "imei-003-3" } },
          { "identifiers": { "com.heads.seedID": "imei-003-4" } }
        ]
      },
      {
        "@type": "fixed reduction manual discount",
        "amount": "300",
        "multiplicity": "PerApplication",
        "includesTax": true,
        "reason": { "identifiers": { "com.heads.seedID": "mobilpant" }, "name": "Mobilpant" },
        "notes": "VendorVoucher #123456",
        "discountedItems": [
          { "identifiers": { "com.heads.seedID": "imei-003-1" } },
          { "identifiers": { "com.heads.seedID": "imei-003-2" } },
          { "identifiers": { "com.heads.seedID": "imei-003-3" } },
          { "identifiers": { "com.heads.seedID": "imei-003-4" } }
        ]
      }
    ],
    "actions": { "tryApprove": true }
  }'
```

> **Manual discount fields:**
> - `@type`: `"fixed reduction manual discount"` (fixed amount off), `"percentage manual discount"`, or `"fixed price manual discount"`
> - `multiplicity`: `"PerApplication"` (discount applied once across items) or `"PerUnit"` (per unit)
> - `includesTax`: whether the discount amount includes tax
> - `discountedItems`: references to the order items the discount applies to (by identifiers)

### Mobilpant payment

A mobilpant payment with an explicit amount, applied to a specific item:

```bash
# Order with mobilpant payment
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/trade-orders" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.heads.seedID": "example-ord-004" },
    "supplier": { "@type": "company", "identifiers": { "com.heads.seedID": "ourcompany" } },
    "customer": { "@type": "person", "identifiers": { "com.heads.seedID": "john-rambo" }, "fullName": "John Rambo" },
    "currency": { "@type": "currency", "identifiers": { "currencyCode": "SEK" } },
    "items": [
      {
        "identifiers": { "com.heads.seedID": "imei-004" },
        "product": { "identifiers": { "com.heads.seedID": "iphone15-128-Black-New" } },
        "instances": [{ "imei": "123456789012348" }]
      },
      {
        "product": { "identifiers": { "com.heads.seedID": "ubegrensetpluss" } },
        "instances": [{ "phoneImei": "123456789012348" }]
      }
    ],
    "sellers": [{ "@type": "store", "identifiers": { "com.heads.seedID": "shadestockholm" } }],
    "actions": {
      "tryApprove": true,
      "createPayment": {
        "transactionId": "payment1-example-004",
        "timestamp": "2025-01-01T12:00:00Z",
        "method": { "identifiers": { "methodId": "com.heads.mobilpant" } },
        "currency": { "identifiers": { "currencyCode": "SEK" } },
        "items": [{ "identifiers": { "com.heads.seedID": "imei-004" } }],
        "amount": "3000"
      }
    }
  }'
```

### Combined mobilbytte + mobilpant payments

Split payment across both trade-in (mobilbytte) and installment (mobilpant) methods. Use an array for `createPayment` to create multiple payments in one action:

```bash
# Combined trade-in + installment payment
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/trade-orders" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.heads.seedID": "example-ord-005" },
    "supplier": { "@type": "company", "identifiers": { "com.heads.seedID": "ourcompany" } },
    "customer": { "@type": "person", "identifiers": { "com.heads.seedID": "imperator-furiosa" }, "fullName": "Imperator Furiosa" },
    "currency": { "@type": "currency", "identifiers": { "currencyCode": "SEK" } },
    "items": [
      {
        "identifiers": { "com.heads.seedID": "imei-005" },
        "product": { "identifiers": { "com.heads.seedID": "iphone15-128-Black-New" } },
        "instances": [{ "imei": "123456789012349" }],
        "discountable": false
      },
      {
        "product": { "identifiers": { "com.heads.seedID": "ubegrensetpluss" } },
        "instances": [{ "phoneImei": "123456789012349" }]
      }
    ],
    "sellers": [{ "@type": "store", "identifiers": { "com.heads.seedID": "shadestockholm" } }],
    "actions": {
      "tryApprove": true,
      "createPayment": [
        {
          "transactionId": "payment1-example-005",
          "timestamp": "2025-01-01T12:00:00Z",
          "method": { "identifiers": { "methodId": "com.heads.mobilbytte" } },
          "currency": { "identifiers": { "currencyCode": "SEK" } },
          "items": [{ "identifiers": { "com.heads.seedID": "imei-005" } }],
          "amount": "8000"
        },
        {
          "transactionId": "payment2-example-005",
          "timestamp": "2025-01-01T12:00:00Z",
          "method": { "identifiers": { "methodId": "com.heads.mobilpant" } },
          "currency": { "identifiers": { "currencyCode": "SEK" } },
          "items": [{ "identifiers": { "com.heads.seedID": "imei-005" } }],
          "amount": "3000"
        }
      ]
    }
  }'
```

> **Split payments:** When `createPayment` is an array, each entry creates a separate payment order. Each payment needs its own `transactionId`, `timestamp`, `method`, and `currency`. The `items` and `amount` fields scope the payment to specific order items and values.

---

## Click-and-Collect Orders

Click-and-collect orders use the `reservedUntil` field to reserve stock for in-store pickup.

**How it works:**
- Create the order via `POST /v1/trade-orders` with a `reservedUntil` timestamp
- The system reserves stock and moves the order to `Reserved` status
- A `PickingOrder` is automatically created for in-store fulfillment (unless the order is immediately approved)
- A release task is scheduled to automatically unreserve stock when `reservedUntil` expires
- Item-level `reservedUntil` is also supported for per-item reservation expiry

```bash
# Create a click-and-collect order with stock reservation
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/trade-orders" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.orderId": "CC-2024-001"},
    "supplier": {"@type": "company", "identifiers": {"com.heads.seedID": "ourcompany"}},
    "customer": {"@type": "person", "identifiers": {"com.myapp.customerId": "CUST-001"}},
    "currency": {"@type": "currency", "identifiers": {"currencyCode": "SEK"}},
    "sellers": [{"@type": "store", "identifiers": {"com.heads.seedID": "store-stockholm"}}],
    "reservedUntil": "2025-06-15T18:00:00Z",
    "items": [
      {
        "product": {"identifiers": {"com.myapp.sku": "CASE-IPHONE-15"}},
        "quantity": "1"
      },
      {
        "product": {"identifiers": {"com.myapp.sku": "IPHONE-15-128-BLACK"}},
        "quantity": "1"
      }
    ],
    "labels": [{"identifiers": {"com.myapp.labelId": "click-and-collect"}}]
  }'
```

**Differences from other orders:**
- The `reservedUntil` field triggers stock reservation and moves status to `Reserved`
- A `PickingOrder` is created automatically for in-store pickup (unless `tryApprove` is set in the same request)
- When `reservedUntil` expires, a scheduled task releases the reservation and moves items back to `Unreserved`

**Typical workflow:**
1. Customer places order online → `POST /v1/trade-orders` with `reservedUntil`
2. Store prepares order for pickup → picking order created automatically
3. Customer picks up order in the POS
4. If customer doesn't pick up → reservation expires automatically

---

## Notes

- **sellers required**: Every trade order must have `sellers` — this determines where stock is picked from
- **Read-only amounts**: Item amounts (`unitAmountInclVat`, `totalAmount`, etc.) are calculated from prices, unless `unitAmountExclVat` is set
- **Manual unit amounts**: Set `unitAmountExclVat` to override computed pricing; value must be non-negative and uses decimal strings (e.g., `"129.00"`)
- **Item mutations**: While the API may accept POST/PATCH/DELETE to `/items`, the intended pattern is to set all items at creation. `unitAmountExclVat` can be PATCHed on editable items.
- **Action names**: Use `tryApprove`/`tryCancel`, not `confirm`/`cancel`
- **Shipments/Payments**: Can be created directly via `POST /v1/shipment-orders` and `POST /v1/payment-orders`, or via trade order actions (`createShipment`, `createPayment`)
- **createPayment requires currency**: The `createPayment` action requires a `currency` field; omitting it throws "Currency not found."
- **Payment methods**: Use `methodId` from `/v1/payment-methods` (e.g., `methodId: "com.heads.cash"`, `methodId: "com.heads.card"`)
- **Click-and-collect**: Use `POST /v1/trade-orders` with `reservedUntil` for in-store pickup orders. The system reserves stock, creates a picking order, and schedules automatic release.
- **reservedUntil**: Must be a future ISO 8601 timestamp. Available at both order level and item level. Reservation expires automatically via a scheduled task.
