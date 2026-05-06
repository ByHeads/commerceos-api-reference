# Product Instances & Serial Number Tracking Guide

A comprehensive guide to product instance management in CommerceOS — covering serial number tracking, batch tracking, instance types, and how tracking interacts with stock adjustments, orders, receipts, stock counts, and stock transfers.

**Base URL:** `https://example.app.heads.com/api/v1`
**API Key:** `banana` (passed via Basic Auth with empty username: `-u ":banana"`)

> **See also:** [Stock & Inventory Guide](./stock-inventory-guide.md) | [Products & Catalog](./products.md) | [Orders & Fulfillment](./orders.md) | [Examples Index](../examples.md) | [Common Gotchas](../../reference/common-gotchas.md)

---

## Table of Contents

- [Part 1: What Are Product Instances?](#part-1-what-are-product-instances)
- [Part 2: Setting Up Instance Types](#part-2-setting-up-instance-types)
  - [2.1 Using Artifact for Generic Serial-Tracked Products](#21-using-artifact-for-generic-serial-tracked-products)
  - [2.2 Using MobileDevice for Phones and Tablets](#22-using-mobiledevice-for-phones-and-tablets)
  - [2.3 Configuring Batch Tracking](#23-configuring-batch-tracking)
  - [2.4 Creating Batches](#24-creating-batches)
  - [2.5 Combining Serial Number and Batch Tracking](#25-combining-serial-number-and-batch-tracking)
- [Part 3: The serialNumber Field — A Universal Accessor](#part-3-the-serialnumber-field--a-universal-accessor)
- [Part 4: Working with Product Instances in Transactions](#part-4-working-with-product-instances-in-transactions)
  - [4.1 Stock Adjustments with Serial-Tracked Instances](#41-stock-adjustments-with-serial-tracked-instances)
  - [4.2 Stock Adjustments with Batch-Tracked Instances](#42-stock-adjustments-with-batch-tracked-instances)
  - [4.3 Trade Orders with Serial-Tracked Items](#43-trade-orders-with-serial-tracked-items)
  - [4.4 MobileDevice + MobilePlan Bundling](#44-mobiledevice--mobileplan-bundling)
  - [4.5 Stock Transfers with Instances](#45-stock-transfers-with-instances)
  - [4.6 Stock Counts with Tracked Products](#46-stock-counts-with-tracked-products)
  - [4.7 Reading Instances on Receipts](#47-reading-instances-on-receipts)
- [Part 5: Reading Instance Data](#part-5-reading-instance-data)
  - [5.1 Expanding Product Instances on Transactions](#51-expanding-product-instances-on-transactions)
  - [5.2 The domain Field — Type-Specific Properties](#52-the-domain-field--type-specific-properties)
  - [5.3 Reading Instance Data Across Multiple Items](#53-reading-instance-data-across-multiple-items)
- [Part 6: Integration Patterns](#part-6-integration-patterns)
  - [6.1 WMS Integration — Serial Number Sync](#61-wms-integration--serial-number-sync)
  - [6.2 E-Commerce — Serial Assignment at Fulfillment](#62-e-commerce--serial-assignment-at-fulfillment)
  - [6.3 Pharma / Food — Batch Tracking for Recalls](#63-pharma--food--batch-tracking-for-recalls)
- [Part 7: Field Reference Tables](#part-7-field-reference-tables)
- [Part 8: Pitfalls and Gotchas](#part-8-pitfalls-and-gotchas)

---

## Part 1: What Are Product Instances?

In CommerceOS, a **product** is a catalog entry — "iPhone 15 128GB" or "Organic Whole Milk 1L". A **product instance** is a specific physical unit (or batch of units) of that product, carrying tracking information that distinguishes it from other units.

There are two tracking flavors:

| Tracking Type | What it identifies | Example | Quantity per instance |
|---------------|-------------------|---------|----------------------|
| **Serial number** | A single, unique unit | IMEI `353456789012345` | Always **1** |
| **Batch** | A production run (many units share one batch) | `LOT-2026-0315` | Any positive number |

Products can have:
- **Serial number tracking only** — each unit gets a unique serial number (phones, electronics, luxury goods)
- **Batch tracking only** — units are grouped by production batch (food, pharmaceuticals, chemicals)
- **Both** — each unit has a serial number AND belongs to a batch (medical devices, high-value perishables)
- **Neither** — no tracking at all (generic retail, commodities)

Every inventory document carries instance data alongside quantities, but the field name varies by document type. Stock adjustments, trade orders, and receipts use `productInstances`. Stock transfers and stock count observations use `instances`. Stock count items split the data across `expectedInstances`, `countedInstances`, `overageInstances`, and `shortageInstances`. Stock transfer record item actions also expose `instances` for audit-trail visibility (read-only). The structure inside is the same in every case — see [Section 4](#part-4-working-with-product-instances-in-transactions) for the per-document field name and [Pitfalls 11–12](#11-stock-transfer-instances-use-the-instances-field) for the full mapping. For tracked products, entries provide per-unit or per-batch detail (serial numbers, batches). For non-tracked products, expanded entries contain just `quantity` and auto-generated `identifiers` — `serialNumber` and `batch` are omitted entirely, and `domain` is an empty object.

Whether instance fields appear in default responses depends on the document type:

| Document type | Instance field | Default behaviour |
|---|---|---|
| Stock adjustment item | `productInstances` | Included by default |
| Stock transfer item | `instances` | Included by default |
| Stock count observation | `instances` | Included by default |
| Trade order item | `productInstances` | Non-essential — expand with `~with(productInstances)` |
| Receipt item | `productInstances` | Non-essential — expand with `~with(productInstances)` |
| Stock count item | `expectedInstances` / `countedInstances` / `overageInstances` / `shortageInstances` | Non-essential — included when items are expanded |
| Stock transfer record item action | `instances` | Non-essential — expand with `~with(instances)` |

### The productInstances Pattern

The `productInstances` field is the canonical instance carrier on stock adjustments, trade orders, and receipts. Stock transfers and stock counts use document-specific field names (`instances`, `expectedInstances`, etc.) but accept the same per-entry structure.

A product instance has these fields:

```json
{
  "identifiers": { "com.example.id": "instance-001" },
  "quantity": 1,
  "serialNumber": "353456789012345",
  "batch": { "identifiers": { "com.example.id": "lot-2026-03" } },
  "domain": {
    "imei": "353456789012345",
    "color": "Black",
    "storage": 128
  }
}
```

- **`identifiers`**: External identifiers for the instance (optional on create, useful for round-trip tracking)
- **`quantity`**: How many units this instance represents. Always `1` for serial-tracked products. Can be any positive number for batch-tracked products.
- **`serialNumber`**: The universal serial number accessor (see [Part 3](#part-3-the-serialnumber-field--a-universal-accessor))
- **`batch`**: Reference to the batch this instance belongs to (for batch-tracked products)
- **`domain`**: Type-specific properties (IMEI, color, condition, etc.)
- **`product`**: The product this is an instance of (read-only, populated in responses)

---

## Part 2: Setting Up Instance Types

Before tracking can work, products need to be configured with an **instance type** and **tracking settings**. The instance type determines what properties each unit carries. The tracking settings control when serial numbers and batches are required.

### 2.1 Using Artifact for Generic Serial-Tracked Products

`Artifact` is the general-purpose instance type for any product that needs serial number tracking without domain-specific properties. Use it for electronics, furniture, tools, appliances — anything that has a serial number but doesn't need specialized fields like IMEI.

```bash
# Create a serial-tracked product using Artifact
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/products" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.sku": "LAPTOP-PRO-15" },
    "name": "Laptop Pro 15-inch",
    "instanceType": "Artifact",
    "tracking": {
      "serialNumberRegistration": ["IncomingTransactions", "OutgoingTransactions"],
      "serialNumberProperty": "Artifact::serialNumber"
    },
    "status": "Active"
  }'
```

Key points:
- **`instanceType: "Artifact"`** — tells CommerceOS to use the Artifact type for product instances.
- **`serialNumberProperty: "Artifact::serialNumber"`** — the property on the Artifact type that carries the serial number. `Artifact` defines `serialNumber` as its own domain property, so the `domain` object for Artifact instances contains `serialNumber`.
- **`serialNumberRegistration`** — an array of transaction scenarios where serial numbers are required (see [Registration Scenarios](#registration-scenarios) below).

### 2.2 Using MobileDevice for Phones and Tablets

`MobileDevice` is a specialized instance type for mobile devices. It extends `Artifact` and adds device-specific properties: IMEI, color, condition, storage capacity, and financing fields.

```bash
# Create a phone product using MobileDevice
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/products" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.sku": "IPHONE-15-128" },
    "name": "iPhone 15 128GB",
    "instanceType": "MobileDevice",
    "tracking": {
      "serialNumberRegistration": ["IncomingTransactions", "OutgoingTransactions", "InternalTransactions"],
      "serialNumberProperty": "MobileDevice::imei"
    },
    "status": "Active"
  }'
```

Key points:
- **`instanceType: "MobileDevice"`** — each unit is a MobileDevice instance.
- **`serialNumberProperty: "MobileDevice::imei"`** — the IMEI number serves as the serial number.
- The `domain` for MobileDevice instances includes: `imei`, `color`, `z_condition` (device condition), `storage`, `financingRate`, `financingPeriod`, `financing`.

#### MobilePlan — for cellular plans

`MobilePlan` is the instance type for voice/data plans. It's not a physical device — it represents a service subscription that can be linked to a MobileDevice.

```bash
# Create a plan product using MobilePlan
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/products" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.sku": "PLAN-UNLIMITED-12M" },
    "name": "Unlimited Plan 12 months",
    "instanceType": "MobilePlan",
    "status": "Active"
  }'
```

MobilePlan instances have:
- **`subscriber`** — the person subscribing to the plan
- **`device`** — reference to the MobileDevice this plan is bound to (set this on input via `domain.device.serialNumber`)
- **`phoneImei`** — read-only computed property, equivalent to `device.[MobileDevice::imei]` — appears in responses but is not used as input on `productInstances`

> **Important:** When selling a phone with a plan, the phone item (MobileDevice) must appear **before** the plan item (MobilePlan) in the items array. See [Section 4.4](#44-mobiledevice--mobileplan-bundling).

### 2.3 Configuring Batch Tracking

Batch tracking groups product instances by production batch. Unlike serial numbers, multiple units can share the same batch.

```bash
# Create a batch-tracked product (no serial numbers)
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/products" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.sku": "MILK-WHOLE-1L" },
    "name": "Whole Milk 1L",
    "tracking": {
      "batchRegistration": ["IncomingTransactions", "OutgoingTransactions"]
    },
    "status": "Active"
  }'
```

- **`batchRegistration`** — controls which transaction scenarios require batch tracking. Same values as `serialNumberRegistration`.
- No `instanceType` is needed for batch-only tracking (the default instance type handles batches).
- No `serialNumberProperty` since there are no serial numbers.

### Registration Scenarios

Both `serialNumberRegistration` and `batchRegistration` accept an array of these values:

| Value | Meaning | Examples |
|-------|---------|---------|
| `"IncomingTransactions"` | Require tracking when receiving goods | Stock adjustments (increase), purchase orders |
| `"OutgoingTransactions"` | Require tracking when shipping/selling goods | Sales orders, stock adjustments (decrease) |
| `"InternalTransactions"` | Require tracking for internal movements | Stock transfers, stock counts |

Combine them as needed:

```json
// Track serial numbers everywhere
"serialNumberRegistration": ["IncomingTransactions", "OutgoingTransactions", "InternalTransactions"]

// Track batches only on incoming goods (for expiration date management)
"batchRegistration": ["IncomingTransactions"]

// Track serial numbers only on outgoing goods (for warranty registration)
"serialNumberRegistration": ["OutgoingTransactions"]
```

### 2.4 Creating Batches

Before referencing a batch in stock operations, create it:

```bash
# Create a production batch
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/batches" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "batch-milk-2026-03" },
    "batchNumber": "LOT-2026-0315",
    "product": { "identifiers": { "com.example.sku": "MILK-WHOLE-1L" } },
    "productionDate": "2026-03-15",
    "expirationDate": "2026-04-15"
  }'
```

Response:

```json
{
  "@type": "batch",
  "identifiers": { "com.example.id": "batch-milk-2026-03" },
  "batchNumber": "LOT-2026-0315",
  "product": {
    "@type": "product",
    "identifiers": { "com.example.sku": "MILK-WHOLE-1L" },
    "name": "Whole Milk 1L"
  },
  "productionDate": "2026-03-15",
  "expirationDate": "2026-04-15"
}
```

Batch fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `identifiers` | common identifiers | Yes | External identifiers for the batch |
| `batchNumber` | string | Yes | The batch/lot number (e.g., `LOT-2026-0315`) |
| `product` | product reference | No | The product this batch is associated with |
| `manufacturer` | agent reference | No | The manufacturer, if known |
| `productionDate` | string (ISO 8601) | No | When the batch was produced |
| `expirationDate` | string (ISO 8601) | No | When the batch expires |

```bash
# List all batches
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/batches"

# Get a specific batch
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/batches/com.example.id=batch-milk-2026-03"

# Find batches for a product
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/batches~where(product.identifiers.com.example.sku==MILK-WHOLE-1L)"
```

### 2.5 Combining Serial Number and Batch Tracking

A product can have both serial number and batch tracking enabled. Each unit gets a unique serial number AND belongs to a batch.

```bash
# Medical device: both serial and batch tracked
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/products" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.sku": "INSULIN-PEN-3ML" },
    "name": "Insulin Pen 3mL",
    "instanceType": "Artifact",
    "tracking": {
      "serialNumberRegistration": ["IncomingTransactions", "OutgoingTransactions", "InternalTransactions"],
      "serialNumberProperty": "Artifact::serialNumber",
      "batchRegistration": ["IncomingTransactions", "OutgoingTransactions"]
    },
    "status": "Active"
  }'
```

When both are enabled, each `productInstances` entry must have both `serialNumber` and `batch`:

```json
{
  "productInstances": [
    {
      "quantity": 1,
      "serialNumber": "PEN-2026-00001",
      "batch": { "identifiers": { "com.example.id": "batch-insulin-2026-03" } }
    },
    {
      "quantity": 1,
      "serialNumber": "PEN-2026-00002",
      "batch": { "identifiers": { "com.example.id": "batch-insulin-2026-03" } }
    }
  ]
}
```

Each instance still has `quantity: 1` (because serial numbers are per-unit), but they share the same batch reference.

---

## Part 3: The serialNumber Field — A Universal Accessor

The `serialNumber` field on a product instance is a **universal accessor** — it reads and writes whichever property is configured as the serial number for that product, regardless of instance type.

This is a critical concept to understand:

| Instance Type | `serialNumberProperty` | `serialNumber` reads/writes... |
|---------------|----------------------|-------------------------------|
| `MobileDevice` | `MobileDevice::imei` | The `imei` field on the instance |
| `Artifact` | `Artifact::serialNumber` | The `serialNumber` field on the instance |
| Any custom type | `CustomType::someField` | The `someField` field on the instance |

### Why this matters

When creating instances, you can always use `serialNumber` regardless of the underlying type:

```json
{
  "productInstances": [
    {
      "quantity": 1,
      "serialNumber": "353456789012345"
    }
  ]
}
```

For a MobileDevice product (where `serialNumberProperty` is `MobileDevice::imei`), this sets the IMEI. For an Artifact product, this sets the generic serial number. The API handles the mapping transparently.

### Reading serial numbers

When reading instances back, the `serialNumber` field is always populated (if the product has serial number tracking). You don't need to know the underlying property name:

```json
{
  "productInstances": [
    {
      "identifiers": { "key": "abc123" },
      "quantity": 1,
      "serialNumber": "353456789012345",
      "domain": {
        "imei": "353456789012345",
        "color": "Black",
        "storage": 128
      }
    }
  ]
}
```

Notice: `serialNumber` contains the same value as `domain.imei`. The `serialNumber` field is the universal way to access it; `domain.imei` is the type-specific way.

### Cross-instance references via serial number

Some instance types reference other instances by serial number. The most important example is `MobilePlan`, which references its associated phone via the `device` property in its `domain`. Use the universal `serialNumber` accessor to identify the target device:

```json
{
  "@type": "product instance",
  "domain": {
    "device": { "serialNumber": "353456789012345" },
    "subscriber": { "name": "Jane Doe" }
  }
}
```

When you set `domain.device.serialNumber` on a MobilePlan instance, the API looks up the MobileDevice instance with that IMEI (within the same transaction) and binds it to the plan's `device` property. On the way out, the plan's domain also exposes `phoneImei` — a read-only computed property derived from `device.[MobileDevice::imei]` — so responses may show either or both.

This is why **item order matters** in orders — the MobileDevice must exist before the MobilePlan can reference it. See [Section 4.4](#44-mobiledevice--mobileplan-bundling).

---

## Part 4: Working with Product Instances in Transactions

All inventory and sales documents use the `productInstances` field to carry instance data. This section covers every transaction type.

### 4.1 Stock Adjustments with Serial-Tracked Instances

When receiving serial-tracked products into stock, provide a `productInstances` array where each entry has `quantity: 1` and a `serialNumber`:

```bash
# Receive 3 iPhones with unique IMEIs
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/stock-adjustments" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "adj-phones-001" },
    "timestamp": "2026-03-25T10:00:00Z",
    "items": [
      {
        "product": { "identifiers": { "com.example.sku": "IPHONE-15-128" } },
        "place": { "identifiers": { "com.example.id": "stockholm-store" } },
        "reason": { "identifiers": { "com.example.id": "restock" } },
        "productInstances": [
          { "quantity": 1, "serialNumber": "353456789012345" },
          { "quantity": 1, "serialNumber": "353456789012346" },
          { "quantity": 1, "serialNumber": "353456789012347" }
        ]
      }
    ]
  }'
```

Key points:
- Each `productInstances` entry represents one physical unit with `quantity: 1`.
- The total quantity is inferred from the instances (3 instances = 3 units). You don't need to set `quantity` on the item separately.
- `serialNumber` is used to set the serial number, regardless of the underlying property (IMEI for MobileDevice, serialNumber for Artifact).

#### With domain properties

You can set type-specific properties via the `domain` field:

```bash
# Receive a phone with additional properties
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/stock-adjustments" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "adj-phones-002" },
    "timestamp": "2026-03-25T10:30:00Z",
    "items": [
      {
        "product": { "identifiers": { "com.example.sku": "IPHONE-15-128" } },
        "place": { "identifiers": { "com.example.id": "stockholm-store" } },
        "reason": { "identifiers": { "com.example.id": "restock" } },
        "productInstances": [
          {
            "quantity": 1,
            "serialNumber": "353456789012348",
            "domain": {
              "color": "Black",
              "storage": 128
            }
          }
        ]
      }
    ]
  }'
```

The `domain` field accepts any property defined on the instance type. For `MobileDevice`, that includes `color`, `z_condition`, `storage`, `financingRate`, `financingPeriod`, and `financing`. You don't need to include `imei` in `domain` if you've already set `serialNumber` — the system maps it automatically.

#### Decreasing stock with serial numbers

When removing serial-tracked items from stock (e.g., damaged, stolen), reference the specific instances:

```bash
# Remove a damaged iPhone by IMEI
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/stock-adjustments" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "adj-damaged-001" },
    "timestamp": "2026-03-26T09:00:00Z",
    "items": [
      {
        "product": { "identifiers": { "com.example.sku": "IPHONE-15-128" } },
        "place": { "identifiers": { "com.example.id": "stockholm-store" } },
        "reason": { "identifiers": { "com.example.id": "damaged" } },
        "productInstances": [
          { "quantity": 1, "serialNumber": "353456789012345" }
        ]
      }
    ]
  }'
```

### 4.2 Stock Adjustments with Batch-Tracked Instances

For batch-tracked products, each `productInstances` entry can have `quantity` greater than 1, since multiple units share a batch:

```bash
# Receive 100 units of milk from a specific batch
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/stock-adjustments" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "adj-milk-001" },
    "timestamp": "2026-03-25T08:00:00Z",
    "items": [
      {
        "product": { "identifiers": { "com.example.sku": "MILK-WHOLE-1L" } },
        "place": { "identifiers": { "com.example.id": "stockholm-store" } },
        "reason": { "identifiers": { "com.example.id": "restock" } },
        "productInstances": [
          {
            "quantity": 100,
            "batch": { "identifiers": { "com.example.id": "batch-milk-2026-03" } }
          }
        ]
      }
    ]
  }'
```

#### Multiple batches in one adjustment

If a delivery includes units from different batches, include multiple entries:

```bash
# Receive milk from two different batches
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/stock-adjustments" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "adj-milk-multi-batch" },
    "timestamp": "2026-03-25T08:30:00Z",
    "items": [
      {
        "product": { "identifiers": { "com.example.sku": "MILK-WHOLE-1L" } },
        "place": { "identifiers": { "com.example.id": "stockholm-store" } },
        "reason": { "identifiers": { "com.example.id": "restock" } },
        "productInstances": [
          {
            "quantity": 100,
            "batch": { "identifiers": { "com.example.id": "batch-milk-2026-03" } }
          },
          {
            "quantity": 50,
            "batch": { "identifiers": { "com.example.id": "batch-milk-2026-02" } }
          }
        ]
      }
    ]
  }'
```

#### Both serial and batch

For products with both tracking types enabled (e.g., medical devices):

```bash
# Receive tracked medical devices with serial numbers AND batch
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/stock-adjustments" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "adj-pens-001" },
    "timestamp": "2026-03-25T09:00:00Z",
    "items": [
      {
        "product": { "identifiers": { "com.example.sku": "INSULIN-PEN-3ML" } },
        "place": { "identifiers": { "com.example.id": "stockholm-store" } },
        "reason": { "identifiers": { "com.example.id": "restock" } },
        "productInstances": [
          {
            "quantity": 1,
            "serialNumber": "PEN-2026-00001",
            "batch": { "identifiers": { "com.example.id": "batch-insulin-2026-03" } }
          },
          {
            "quantity": 1,
            "serialNumber": "PEN-2026-00002",
            "batch": { "identifiers": { "com.example.id": "batch-insulin-2026-03" } }
          },
          {
            "quantity": 1,
            "serialNumber": "PEN-2026-00003",
            "batch": { "identifiers": { "com.example.id": "batch-insulin-2026-03" } }
          }
        ]
      }
    ]
  }'
```

Each instance has `quantity: 1` (serial number = per-unit), and they all reference the same batch.

### 4.3 Trade Orders with Serial-Tracked Items

When creating orders for serial-tracked products, specify which instances are being sold:

```bash
# Create an order selling a specific iPhone by IMEI
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/trade-orders" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.orderId": "ORD-2026-001" },
    "supplier": { "identifiers": { "com.example.storeId": "stockholm" } },
    "customer": { "identifiers": { "com.example.customerId": "CUST-001" } },
    "items": [
      {
        "identifiers": { "com.example.itemId": "item-phone" },
        "product": { "identifiers": { "com.example.sku": "IPHONE-15-128" } },
        "quantity": 1,
        "productInstances": [
          {
            "quantity": 1,
            "serialNumber": "353456789012346"
          }
        ]
      }
    ]
  }'
```

### 4.4 MobileDevice + MobilePlan Bundling

When selling a phone together with a cellular plan, the items must be in the correct order: **MobileDevice first, then MobilePlan**. The plan references the phone via the `device` property in its `domain`, using `serialNumber` to link to the device's IMEI.

```bash
# CORRECT: Phone before plan, plan links to phone via serialNumber
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/trade-orders" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.orderId": "ORD-2026-002" },
    "supplier": { "identifiers": { "com.example.storeId": "stockholm" } },
    "customer": { "identifiers": { "com.example.customerId": "CUST-002" } },
    "items": [
      {
        "product": { "identifiers": { "com.example.sku": "IPHONE-15-128" } },
        "productInstances": [{ "serialNumber": "353456789012346" }]
      },
      {
        "product": { "identifiers": { "com.example.sku": "PLAN-UNLIMITED-12M" } },
        "productInstances": [{ "domain": { "device": { "serialNumber": "353456789012346" } } }]
      }
    ]
  }'
```

Key points:
- The **MobileDevice item** (phone) must appear **before** the **MobilePlan item** (plan) in the `items` array.
- The plan's `domain.device.serialNumber` must match the phone's `serialNumber` (which maps to `imei` for MobileDevice products).
- The device is looked up **within the same transaction** and bound to the plan.
- If the plan item appears before the phone item, the lookup fails because the phone instance doesn't exist yet.

Here's what **NOT** to do:

```bash
# WRONG: Plan before phone — device lookup cannot resolve
{
  "items": [
    {
      "product": { "identifiers": { "com.example.sku": "PLAN-UNLIMITED-12M" } },
      "productInstances": [{ "domain": { "device": { "serialNumber": "353456789012346" } } }]
    },
    {
      "product": { "identifiers": { "com.example.sku": "IPHONE-15-128" } },
      "productInstances": [{ "serialNumber": "353456789012346" }]
    }
  ]
}
```

> **See also:** [Common Gotchas — Rule 21: Instance-Tracked Items: Order and Type Requirements](../../reference/common-gotchas.md#21-instance-tracked-items-order-and-type-requirements)

### 4.5 Stock Transfers with Instances

When transferring serial-tracked products between logical stocks, specify which instances to transfer:

```bash
# Transfer a specific iPhone to display stock
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/stock-transfers" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "transfer-phone-display" },
    "sender": { "identifiers": { "com.example.storeId": "stockholm" } },
    "receiver": { "identifiers": { "com.example.storeId": "stockholm" } },
    "receiverStock": { "identifiers": { "com.example.id": "display-stock" } },
    "items": [
      {
        "identifiers": { "com.example.id": "transfer-item-phone-1" },
        "product": { "identifiers": { "com.example.sku": "IPHONE-15-128" } },
        "quantity": 1,
        "instances": [
          { "quantity": 1, "serialNumber": "353456789012346" }
        ]
      }
    ]
  }'

# Fulfill the transfer
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/stock-transfers/com.example.id=transfer-phone-display" \
  -H "Content-Type: application/json" \
  -d '{ "actions": { "tryFulfill": true } }'
```

With domain properties:

```bash
# Transfer with full instance metadata
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/stock-transfers" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "transfer-phone-display-2" },
    "sender": { "identifiers": { "com.example.storeId": "stockholm" } },
    "receiver": { "identifiers": { "com.example.storeId": "stockholm" } },
    "receiverStock": { "identifiers": { "com.example.id": "display-stock" } },
    "items": [
      {
        "identifiers": { "com.example.id": "transfer-item-phone-2" },
        "product": { "identifiers": { "com.example.sku": "IPHONE-15-128" } },
        "quantity": 1,
        "instances": [
          {
            "quantity": 1,
            "serialNumber": "353456789012347",
            "domain": {
              "color": "Blue",
              "storage": 256
            }
          }
        ]
      }
    ]
  }'
```

> **Note:** Stock transfers use the `instances` field on transfer items (not `productInstances`). This is the transfer-specific field name, but the structure and content is the same.

### 4.6 Stock Counts with Tracked Products

When counting serial-tracked products, stock count observations carry instance-level data, and the count items expose instance-level variance.

#### Recording observations with serial numbers

```bash
# Count observation: staff scanned 3 phones
# Observations are created via the nested resource path on the stock count item
curl -X POST -u ":banana" \
  "https://example.app.heads.com/api/v1/stock-count-items/com.example.id=count-item-phones/observations/new" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "obs-phones-anna" },
    "counter": { "identifiers": { "com.example.userId": "anna" } },
    "instances": [
      { "quantity": 1, "serialNumber": "353456789012345" },
      { "quantity": 1, "serialNumber": "353456789012346" },
      { "quantity": 1, "serialNumber": "353456789012999" }
    ]
  }'
```

#### Reviewing instance-level variance

After observations are recorded, the stock count item shows both quantity-level and instance-level variance:

```bash
# Get count items with instance details
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/stock-counts/com.example.id=count-phones~with(items)"
```

Response:

```json
{
  "@type": "stock count item",
  "product": { "identifiers": { "com.example.sku": "IPHONE-15-128" } },
  "counted": true,
  "expectedQuantity": "3",
  "countedQuantity": "3",
  "overageQuantity": "1",
  "shortageQuantity": "1",
  "expectedInstances": [
    { "serialNumber": "353456789012345", "quantity": 1 },
    { "serialNumber": "353456789012346", "quantity": 1 },
    { "serialNumber": "353456789012347", "quantity": 1 }
  ],
  "countedInstances": [
    { "serialNumber": "353456789012345", "quantity": 1 },
    { "serialNumber": "353456789012346", "quantity": 1 },
    { "serialNumber": "353456789012999", "quantity": 1 }
  ],
  "overageInstances": [
    { "serialNumber": "353456789012999", "quantity": 1 }
  ],
  "shortageInstances": [
    { "serialNumber": "353456789012347", "quantity": 1 }
  ]
}
```

In this example, the total quantity is the same (3 expected, 3 counted), but at the instance level:
- **Overage**: IMEI `...999` was found but wasn't expected (possibly misplaced from another location)
- **Shortage**: IMEI `...347` was expected but wasn't found (possibly stolen, misplaced, or already sold)

> **See also:** [Stock & Inventory Guide — Part 4: Stock Counts](./stock-inventory-guide.md#part-4-stock-counts--physical-inventory) for the complete stock count lifecycle.

### 4.7 Reading Instances on Receipts

Receipts contain instance data for tracked products. Use `~with(items~with(productInstances))` to expand them:

```bash
# Get a receipt with product instance details
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/receipts/com.example.receiptId=RCP-2026-001~with(items~with(productInstances))"
```

Response (excerpt):

```json
{
  "@type": "receipt",
  "identifiers": { "com.example.receiptId": "RCP-2026-001" },
  "items": [
    {
      "@type": "receipt item",
      "description": "iPhone 15 128GB",
      "quantity": "1",
      "productInstances": [
        {
          "identifiers": { "key": "abc123" },
          "quantity": 1,
          "serialNumber": "353456789012346",
          "domain": {
            "imei": "353456789012346",
            "color": "Black",
            "storage": 128
          },
          "product": {
            "@type": "product",
            "identifiers": { "com.example.sku": "IPHONE-15-128" },
            "name": "iPhone 15 128GB"
          }
        }
      ]
    },
    {
      "@type": "receipt item",
      "description": "Unlimited Plan 12 months",
      "quantity": "1",
      "productInstances": [
        {
          "identifiers": { "key": "def456" },
          "quantity": 1,
          "domain": {
            "phoneImei": "353456789012346"
          },
          "product": {
            "@type": "product",
            "identifiers": { "com.example.sku": "PLAN-UNLIMITED-12M" },
            "name": "Unlimited Plan 12 months"
          }
        }
      ]
    }
  ]
}
```

Notice:
- The phone's `productInstances` includes `serialNumber` (the universal accessor) and `domain.imei` (the type-specific field) — both contain the IMEI.
- The plan's `productInstances` shows `domain.phoneImei` — a read-only computed property derived from `device.[MobileDevice::imei]`. On input, the plan was created with `domain.device.serialNumber`; on read, `phoneImei` is exposed for compatibility.
- The `product` field on each instance is read-only — populated automatically in the response.

#### Querying receipts with instance expansion for date ranges

```bash
# Get recent receipts with full instance data
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/receipts/after/2026-03-01T00:00:00.000Z~with(items~with(productInstances))~take(100)"
```

> **See also:** [Receipt Discounts & Surcharges Guide](./receipt-discounts-surcharges.md) for how to combine instance expansion with discount/surcharge expansion.

---

## Part 5: Reading Instance Data

### 5.1 Expanding Product Instances on Transactions

Product instances are expandable fields on transaction items. They're not included in default responses — you need `~with()` to expand them.

```bash
# Stock adjustment with instances expanded
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/stock-adjustments/com.example.id=adj-phones-001~with(items~with(productInstances))"

# Trade order with instances expanded
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/trade-orders/com.example.orderId=ORD-2026-001~with(items~with(productInstances))"

# Receipt with instances expanded
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/receipts/com.example.receiptId=RCP-2026-001~with(items~with(productInstances))"

# Stock count with instances on items
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/stock-counts/com.example.id=count-phones~with(items)"
```

For stock count items, the instance fields (`expectedInstances`, `countedInstances`, `overageInstances`, `shortageInstances`) are included when items are expanded — no additional nested `~with()` is needed.

### 5.2 The domain Field — Type-Specific Properties

The `domain` field contains all properties specific to the instance type. It's a dynamic field — its structure depends on the product's `instanceType`.

**MobileDevice domain fields:**

| Field | Type | Description |
|-------|------|-------------|
| `imei` | string | The IMEI number (also accessible via `serialNumber`) |
| `unverifiedImei` | string | User-input IMEI that bypasses validation |
| `color` | string | Device color |
| `z_condition` | string | Device condition (e.g., "New", "Refurbished", "Used") |
| `storage` | number | Storage capacity (e.g., 128, 256) |
| `financingRate` | number | Financing interest rate |
| `financingPeriod` | number | Financing period (months) |
| `financing` | boolean | Whether financing is active |

**MobilePlan domain fields:**

| Field | Type | Description |
|-------|------|-------------|
| `phoneImei` | string | IMEI of the associated phone (computed from `device.[MobileDevice::imei]`) |
| `device` | MobileDevice reference | The phone this plan is bound to |
| `subscriber` | person reference | The plan subscriber |

**Artifact domain fields:**

| Field | Type | Description |
|-------|------|-------------|
| `serialNumber` | string | Manufacturer-assigned serial number for this artifact |

Artifact defines `serialNumber` as its own domain property. When you read instance data, the `domain` object contains `serialNumber`.

### 5.3 Reading Instance Data Across Multiple Items

When reading transaction items in bulk, expand instances across all items:

```bash
# Get all stock adjustment items with instances
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/stock-adjustment-items~with(productInstances)~take(100)"

# Get all items for a specific product with instances
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/stock-adjustments~with(items~with(productInstances))~take(50)"
```

You can also use `~just()` to limit the response to only instance-related fields:

```bash
# Get just the product and instances for each adjustment item
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/stock-adjustment-items~just(product,productInstances)~take(100)"
```

---

## Part 6: Integration Patterns

### 6.1 WMS Integration — Serial Number Sync

**Scenario:** A Warehouse Management System (WMS) tracks serial-numbered electronics. You need to sync stock movements from the WMS into CommerceOS.

#### Step 1: Ensure products are configured for tracking

```bash
# Check if the product has tracking configured
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/products/com.example.sku=IPHONE-15-128~just(identifiers,name,instanceType,tracking)"
```

Expected response:

```json
{
  "identifiers": { "com.example.sku": "IPHONE-15-128" },
  "name": "iPhone 15 128GB",
  "instanceType": "MobileDevice",
  "tracking": {
    "serialNumberRegistration": ["IncomingTransactions", "OutgoingTransactions", "InternalTransactions"],
    "serialNumberProperty": "MobileDevice::imei"
  }
}
```

#### Step 2: Receive goods with serial numbers

For each WMS goods-receipt event, create a stock adjustment with `productInstances`:

```bash
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/stock-adjustments" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "wms-receipt-2026-0325-001" },
    "timestamp": "2026-03-25T10:00:00Z",
    "items": [
      {
        "product": { "identifiers": { "com.example.sku": "IPHONE-15-128" } },
        "place": { "identifiers": { "com.example.id": "stockholm-store" } },
        "reason": { "identifiers": { "com.example.id": "purchase-receipt" } },
        "productInstances": [
          { "quantity": 1, "serialNumber": "353456789012345" },
          { "quantity": 1, "serialNumber": "353456789012346" },
          { "quantity": 1, "serialNumber": "353456789012347" }
        ]
      }
    ]
  }'
```

#### Step 3: Verify stock entries

```bash
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/stock-places/com.example.id=stockholm-store/entries"
```

#### Step 4: Handle outbound movements (sales, returns, damages)

For each WMS dispatch/return event, create a corresponding adjustment with the specific serial numbers:

```bash
# WMS reports a sale — decrease stock with specific IMEI
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/stock-adjustments" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "wms-dispatch-2026-0326-001" },
    "timestamp": "2026-03-26T14:00:00Z",
    "items": [
      {
        "product": { "identifiers": { "com.example.sku": "IPHONE-15-128" } },
        "place": { "identifiers": { "com.example.id": "stockholm-store" } },
        "reason": { "identifiers": { "com.example.id": "sold" } },
        "productInstances": [
          { "quantity": 1, "serialNumber": "353456789012345" }
        ]
      }
    ]
  }'
```

### 6.2 E-Commerce — Serial Assignment at Fulfillment

**Scenario:** An e-commerce system creates orders without serial numbers (the customer doesn't choose a specific unit). Serial numbers are assigned later during warehouse fulfillment.

#### Step 1: Create the order without instances

```bash
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/trade-orders" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.orderId": "WEB-ORD-2026-001" },
    "supplier": { "identifiers": { "com.example.storeId": "stockholm" } },
    "customer": { "identifiers": { "com.example.customerId": "CUST-WEB-001" } },
    "items": [
      {
        "identifiers": { "com.example.itemId": "item-laptop" },
        "product": { "identifiers": { "com.example.sku": "LAPTOP-PRO-15" } },
        "quantity": 1
      }
    ]
  }'
```

#### Step 2: Assign serial number at fulfillment

When the warehouse picks a specific unit, update the order item with the serial number:

```bash
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/trade-orders/com.example.orderId=WEB-ORD-2026-001" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {
        "identifiers": { "com.example.itemId": "item-laptop" },
        "productInstances": [
          {
            "quantity": 1,
            "serialNumber": "SN-LAPTOP-2026-00042"
          }
        ]
      }
    ]
  }'
```

### 6.3 Pharma / Food — Batch Tracking for Recalls

**Scenario:** A food distributor needs to track batches for recall capability. When a batch is recalled, they need to find all stock locations that still have units from that batch.

#### Step 1: Receive goods with batch tracking

```bash
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/stock-adjustments" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "com.example.id": "adj-yogurt-delivery-001" },
    "timestamp": "2026-03-20T07:00:00Z",
    "items": [
      {
        "product": { "identifiers": { "com.example.sku": "YOGURT-VANILLA-200G" } },
        "place": { "identifiers": { "com.example.id": "store-stockholm" } },
        "reason": { "identifiers": { "com.example.id": "purchase-receipt" } },
        "productInstances": [
          {
            "quantity": 200,
            "batch": { "identifiers": { "com.example.id": "batch-yogurt-2026-w12" } }
          }
        ]
      },
      {
        "product": { "identifiers": { "com.example.sku": "YOGURT-VANILLA-200G" } },
        "place": { "identifiers": { "com.example.id": "store-gothenburg" } },
        "reason": { "identifiers": { "com.example.id": "purchase-receipt" } },
        "productInstances": [
          {
            "quantity": 150,
            "batch": { "identifiers": { "com.example.id": "batch-yogurt-2026-w12" } }
          }
        ]
      }
    ]
  }'
```

#### Step 2: On recall, query adjustment history to find affected locations

```bash
# Find all adjustments for the recalled product
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/stock-adjustments~with(items~with(productInstances))~where(items.product.identifiers.com.example.sku==YOGURT-VANILLA-200G)"
```

Inspect the `productInstances` on each item to identify which stock places received the recalled batch.

---

## Part 7: Field Reference Tables

### Product Instance

| Field | Type | On Create | Read-Only | Description |
|-------|------|-----------|-----------|-------------|
| `identifiers` | common identifiers | Optional | No | External identifiers for this instance |
| `quantity` | decimal | Optional (defaults to 1) | No | Number of units. Always 1 for serial-tracked. |
| `serialNumber` | string | For serial-tracked | No | Universal serial number accessor |
| `batch` | batch reference | For batch-tracked | No | The batch this instance belongs to |
| `domain` | dynamic object | Optional | No | Type-specific properties (IMEI, color, etc.) |
| `product` | product reference | — | Yes | The product this is an instance of |

### Batch

| Field | Type | On Create | Read-Only | Description |
|-------|------|-----------|-----------|-------------|
| `identifiers` | common identifiers | Required | No | External identifiers |
| `batchNumber` | string | Required | No | The batch/lot number |
| `product` | product reference | Optional | No | Associated product |
| `manufacturer` | agent reference | Optional | No | Manufacturer, if known |
| `productionDate` | string (ISO 8601) | Optional | No | Production date |
| `expirationDate` | string (ISO 8601) | Optional | No | Expiration date |

### Product Tracking Configuration

| Field | Type | Description |
|-------|------|-------------|
| `tracking.serialNumberRegistration` | string[] | Transaction scenarios requiring serial numbers: `"IncomingTransactions"`, `"OutgoingTransactions"`, `"InternalTransactions"` |
| `tracking.serialNumberProperty` | string | Qualified property name for serial number (e.g., `"MobileDevice::imei"`, `"Artifact::serialNumber"`) |
| `tracking.batchRegistration` | string[] | Transaction scenarios requiring batch tracking: `"IncomingTransactions"`, `"OutgoingTransactions"`, `"InternalTransactions"` |

### Instance Types

| Type | Use Case | Serial Number Property | Domain Fields |
|------|----------|----------------------|---------------|
| `Artifact` | Generic serial-tracked products | `Artifact::serialNumber` | `serialNumber` |
| `MobileDevice` | Phones, tablets | `MobileDevice::imei` | `imei`, `color`, `z_condition`, `storage`, `financingRate`, `financingPeriod`, `financing` |
| `MobilePlan` | Cellular plans | — | `phoneImei`, `device`, `subscriber` |

### Instance Fields on Transaction Types

| Transaction | Instance Field (Create) | Instance Field (Read) | Notes |
|-------------|------------------------|----------------------|-------|
| Stock adjustment item | `productInstances` | `productInstances` (default) | Included by default in responses |
| Trade order item | `productInstances` | `productInstances` (via `~with`) | Non-essential — expand to read |
| Receipt item | — | `productInstances` (via `~with`) | Read-only; non-essential — expand to read |
| Stock transfer item | `instances` | `instances` (default) | Transfer-specific field name; included by default |
| Stock count observation | `instances` | `instances` (default) | Count-specific field name; included by default |
| Stock count item | — | `expectedInstances`, `countedInstances`, `overageInstances`, `shortageInstances` | Non-essential — included when items are expanded |
| Stock transfer record item action | — | `instances` (via `~with`) | Read-only audit trail; non-essential — expand to read |

---

## Part 8: Pitfalls and Gotchas

### 1. MobileDevice must come before MobilePlan in order items

When selling a phone with a plan, the phone item **must** appear before the plan item in the `items` array. The plan's `domain.device.serialNumber` references the phone's IMEI, which must already exist in the transaction context. If the order is reversed, the device lookup fails.

### 2. Use productInstances, not the legacy instance / instances fields

The `productInstances` field is the current, supported way to provide instance data on stock adjustments, trade orders, and receipts. Two legacy fields still parse for backwards compatibility:

- **`instance`** (singular dynamic on stock adjustment items) accepts raw domain properties like `{ "imei": "..." }`.
- **`instances`** (plural array on trade order items) accepts ICE-era entries shaped like `[{ "imei": "..." }, { "phoneImei": "..." }]`. ICE-era integrators sending `phoneImei` directly on this legacy field will keep working until the field is removed. On `productInstances`, `phoneImei` is read-only and the canonical input form is `domain.device.serialNumber` (see [Section 3](#part-3-the-serialnumber-field--a-universal-accessor)).

For new code, always use `productInstances` with the structured format (`quantity`, `serialNumber`, `batch`, `domain`).

### 3. Serial-tracked instances always have quantity 1

Each serial number identifies exactly one physical unit. A `productInstances` entry for a serial-tracked product must have `quantity: 1`. To handle multiple serial-tracked units, include multiple entries in the `productInstances` array — one per unit.

### 4. serialNumber is a universal accessor

The `serialNumber` field reads/writes whichever property is configured as the serial number for the product. For MobileDevice, setting `serialNumber` sets `imei`. You don't need to set both `serialNumber` and `domain.imei` — one suffices.

### 5. Tracking is configured at product creation time

The `instanceType` and `tracking` fields should be set when the product is first created. While `tracking` registration settings can be updated via PATCH, changing `instanceType` after instances have been created can cause inconsistencies.

### 6. instanceProperties is write-only (for variants, not tracking)

Don't confuse `instanceProperties` (used for variant dimensions like size/color on product families) with `productInstances` (used for tracked units in transactions). `instanceProperties` is write-only and sets variant dimensions on the product. `productInstances` is the per-transaction instance tracking data.

### 7. Use Artifact for generic serial tracking

If your product just needs a serial number without additional domain-specific fields (no IMEI, no color, no condition), use `Artifact` as the instance type with `serialNumberProperty: "Artifact::serialNumber"`. Artifact's domain contains `serialNumber` — when you read instance data back, you'll find it in `domain.serialNumber`. Don't use `MobileDevice` unless you actually need mobile-specific properties.

### 8. Instance identifiers round-trip

If you set `identifiers` on a product instance when creating it, those identifiers are preserved and returned when reading the instance back. This is useful for external system integration — you can use your WMS instance ID as the identifier and look it up later.

### 9. Batch references must exist before use

When including a `batch` reference in `productInstances`, the batch must already exist in the system. Create the batch first with `POST /v1/batches`, then reference it by identifiers. If the batch doesn't exist, the request will fail.

### 10. Stock count instance variance can differ from quantity variance

A stock count item can show `expectedQuantity: 3` and `countedQuantity: 3` (no quantity variance) while still having `overageInstances` and `shortageInstances` at the instance level. This happens when the same number of units is found, but some are different units than expected (e.g., a phone was swapped).

### 11. Stock transfer instances use the instances field

Stock transfer items use `instances` (not `productInstances`) for instance data. This is a transfer-specific field name. The structure inside is the same: `{ "quantity": 1, "serialNumber": "...", "domain": { ... } }`.

### 12. Stock count observation instances use the instances field

Similarly, stock count observations use `instances` for the counted instance data. Each observation records what was physically found, with optional serial number or batch information on each entry.
