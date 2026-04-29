# Serial Number Tracking

Track individual units by serial number across stock, orders, and receipts.

**Base URL:** `https://example.app.heads.com/api/v1`
**API Key:** `banana` (passed via Basic Auth with empty username: `-u ":banana"`)

> **Full guide:** [Product Instances & Tracking Guide](./product-instances-tracking.md) covers all instance types, batch tracking, integration patterns, and field references.

---

## How It Works

1. **Configure the product** with an instance type and serial number tracking
2. **Include `productInstances`** with a `serialNumber` on each transaction (stock adjustments, orders, etc.)
3. **Read back** instance data using `~with(productInstances)` or `~with(items~with(productInstances))`

Stock adjustments, trade orders, and receipts use `productInstances` to carry per-unit detail. Stock transfers and stock count observations use `instances`; stock count items split the data across `expectedInstances`/`countedInstances`/`overageInstances`/`shortageInstances`. Stock transfer record item actions also expose `instances` for audit-trail visibility (read-only). The per-entry structure is the same in every case. When serial number tracking is enabled, each entry must carry a `serialNumber`. See the [full guide](./product-instances-tracking.md#part-4-working-with-product-instances-in-transactions) for transfer and count examples.

---

## 1. Enable Serial Number Tracking on a Product

Set `instanceType` and `tracking` when creating or updating the product:

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/products" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.sku": "ROUTER-AX6000" },
    "name": "WiFi Router AX6000",
    "instanceType": "Artifact",
    "tracking": {
      "serialNumberRegistration": ["IncomingTransactions", "OutgoingTransactions"],
      "serialNumberProperty": "Artifact::serialNumber"
    }
  }'
```

- **`instanceType`** — a plain string: `"Artifact"` for generic serial tracking, `"MobileDevice"` for phones/tablets (uses IMEI as serial number)
- **`serialNumberRegistration`** — an array of transaction scenarios where serial numbers are required: `"IncomingTransactions"` (stock receipts), `"OutgoingTransactions"` (sales), `"InternalTransactions"` (transfers, counts)
- **`serialNumberProperty`** — the qualified property name that holds the serial number: `"Artifact::serialNumber"` for Artifact, `"MobileDevice::imei"` for MobileDevice

> **See:** [Setting Up Instance Types](./product-instances-tracking.md#part-2-setting-up-instance-types) for all instance types and configuration options.

---

## 2. Receive Stock with Serial Numbers

Each serial-tracked unit has `quantity: 1` and its own `serialNumber`:

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/stock-adjustments" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "recv-routers-001" },
    "items": [
      {
        "product": { "identifiers": { "com.example.sku": "ROUTER-AX6000" } },
        "place": { "identifiers": { "com.example.storeId": "oslo" } },
        "reason": { "identifiers": { "name": "Purchase" } },
        "productInstances": [
          { "quantity": 1, "serialNumber": "SN-AX6K-00001" },
          { "quantity": 1, "serialNumber": "SN-AX6K-00002" },
          { "quantity": 1, "serialNumber": "SN-AX6K-00003" }
        ]
      }
    ]
  }'
```

> **See:** [Stock Adjustments with Serial-Tracked Instances](./product-instances-tracking.md#41-stock-adjustments-with-serial-tracked-instances)

---

## 3. Sell a Specific Unit by Serial Number

Reference the serial number in the order's `productInstances`:

```bash
curl -X POST -u ":banana" "example.app.heads.com/api/v1/trade-orders" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.orderId": "ORD-2026-100" },
    "supplier": { "identifiers": { "com.example.storeId": "oslo" } },
    "customer": { "identifiers": { "com.example.customerId": "CUST-050" } },
    "items": [
      {
        "product": { "identifiers": { "com.example.sku": "ROUTER-AX6000" } },
        "productInstances": [{ "serialNumber": "SN-AX6K-00001" }]
      }
    ]
  }'
```

> **See:** [Trade Orders with Serial-Tracked Items](./product-instances-tracking.md#43-trade-orders-with-serial-tracked-items)

---

## 4. Read Back Instance Data

Expand `productInstances` on any transaction to see serial numbers:

```bash
# On a stock adjustment
GET /v1/stock-adjustments/com.example.id=recv-routers-001~with(items~with(productInstances))

# On a receipt
GET /v1/receipts/{receipt-key}~with(items~with(productInstances))

# On a trade order
GET /v1/trade-orders/com.example.orderId=ORD-2026-100~with(items~with(productInstances))
```

> **See:** [Reading Instance Data](./product-instances-tracking.md#part-5-reading-instance-data)

---

## The `serialNumber` Field

`serialNumber` is a universal accessor that works across all instance types. You don't need to know whether the underlying property is `imei`, `Artifact::serialNumber`, or something else — `serialNumber` always maps to the right field.

| Instance Type | Underlying Property | `serialNumber` Maps To |
|---------------|--------------------|-----------------------|
| `Artifact` | `Artifact::serialNumber` | The artifact's serial number |
| `MobileDevice` | `MobileDevice::imei` | The device's IMEI |

> **See:** [The serialNumber Field — A Universal Accessor](./product-instances-tracking.md#part-3-the-serialnumber-field--a-universal-accessor)

---

## Next Steps

- **[Batch tracking](./product-instances-tracking.md#23-configuring-batch-tracking)** — group units by production batch instead of (or in addition to) serial numbers
- **[MobileDevice + MobilePlan bundling](./product-instances-tracking.md#44-mobiledevice--mobileplan-bundling)** — sell phones with linked cellular plans
- **[Stock transfers with instances](./product-instances-tracking.md#45-stock-transfers-with-instances)** — move specific serial-tracked units between stocks
- **[Integration patterns](./product-instances-tracking.md#part-6-integration-patterns)** — WMS sync, e-commerce fulfillment, recall workflows
