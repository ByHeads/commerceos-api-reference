# BI Integration Guide: Receipts and Sales Analytics

This guide provides a comprehensive template for integrating CommerceOS receipt and sales data with Business Intelligence (BI) and analytics systems. It covers incremental data extraction, data shaping for analytics, handling returns and voids, currency normalization, late-arriving data, and streaming options.

---

## Executive Summary

Sales analytics drives business decisions. When your BI system has access to accurate, timely receipt data from CommerceOS, you unlock:

- **Real-time visibility** — Sales dashboards update within minutes
- **Accurate reporting** — Returns, voids, and discounts are properly accounted
- **Trend analysis** — Historical data enables forecasting and planning
- **Store performance** — Compare locations, terminals, and staff
- **Customer insights** — Purchase patterns tied to customer segments

This guide provides a production-ready integration template with copy-paste queries, data modeling guidance, and operational patterns.

---

## Table of Contents

1. [Business Value and ROI](#business-value-and-roi)
2. [Data Model Overview](#data-model-overview)
3. [Integration Architecture](#integration-architecture)
4. [Phase 1: Initial Data Export](#phase-1-initial-data-export)
5. [Phase 2: Incremental Sync](#phase-2-incremental-sync)
6. [Phase 3: Data Transformation](#phase-3-data-transformation)
7. [Handling Returns and Voids](#handling-returns-and-voids)
8. [Currency and VAT Normalization](#currency-and-vat-normalization)
9. [Late-Arriving Data Patterns](#late-arriving-data-patterns)
10. [Webhook and Streaming Options](#webhook-and-streaming-options)
11. [Data Warehouse Schema Design](#data-warehouse-schema-design)
12. [Production Checklist](#production-checklist)
13. [Copy-Paste Query Reference](#copy-paste-query-reference)

---

## Business Value and ROI

### Quantifiable Benefits

| Benefit | Impact | How CommerceOS Enables It |
|---------|--------|---------------------------|
| **Faster reporting** | Days → minutes for sales reports | Real-time receipt data via API |
| **Accurate financials** | 99.9%+ reconciliation accuracy | Complete transaction records |
| **Inventory insights** | 15-30% reduction in stockouts | Sales velocity data for forecasting |
| **Staff performance** | 10-20% productivity improvement | Per-terminal and per-staff metrics |
| **Customer analytics** | 25-40% increase in repeat purchases | Purchase history for segmentation |

### Integration Cost vs Value

The investment in BI integration pays off through:

1. **Decision velocity** — Real-time data enables faster responses
2. **Forecasting accuracy** — Historical trends improve predictions
3. **Operational efficiency** — Identify underperforming stores/products
4. **Financial compliance** — Audit-ready transaction records

---

## Data Model Overview

### Receipt Entity Structure

```
Receipt
  ├── identifiers ────────────────── key, receiptID
  ├── seller (Agent) ─────────────── Store/company
  ├── buyer (Agent) ──────────────── Customer (if known)
  ├── posTerminal (POSTerminal) ──── Terminal that created receipt
  ├── timestamp ──────────────────── Transaction date/time
  ├── currencyCode ───────────────── Transaction currency
  ├── items (ReceiptItem[]) ──────── Line items
  │     ├── product (Product) ────── Product reference
  │     ├── description ──────────── Receipt line text
  │     ├── quantity ─────────────── Units sold
  │     ├── unitAmount ───────────── Price per unit (excl. VAT)
  │     ├── salesAmount ─────────────── Sales amount (excl. VAT)
  │     ├── taxAmount ───────────────── Tax amount
  │     ├── totalAmount ─────────────── Line total (incl. VAT)
  │     ├── discountAmount ───────── Discount amount
  │     ├── discounts[] ──────────── Discount breakdown (item subpaths currently unsupported)
  │     ├── vatPercentage ────────── Tax rate
  │     └── instances[] ──────────── IMEI/serial data (item subpaths currently unsupported)
  ├── payments (Payment[]) ───────── Payment transactions
  │     ├── method ───────────────── Payment method
  │     ├── amount ───────────────── Amount paid
  │     └── paymentType ──────────── PAYMENT or REFUND
  ├── vatGroups (VATGroup[]) ─────── Tax summary by rate
  ├── totalAmount ────────────────── Grand total (incl. VAT)
  ├── totalTaxAmount ─────────────── Total VAT
  ├── totalDiscountAmount ────────── Total discounts (excl. VAT)
  ├── roundingAmount ─────────────── Cash rounding adjustment
  ├── totalPayableAmount ─────────── Amount due
  └── totalPaidAmount ────────────── Amount received
```

### Key Fields for Analytics

| Field | Type | BI Use Case |
|-------|------|-------------|
| `identifiers.key` | string | Primary key, dedup |
| `identifiers.receiptID` | string | Human-readable ID, display |
| `timestamp` | datetime | Time dimensions, partitioning |
| `seller.identifiers` | object | Store/location analysis |
| `buyer.identifiers` | object | Customer analysis |
| `totalAmount` | decimal | Revenue reporting |
| `totalTaxAmount` | decimal | Tax reporting |
| `totalDiscountAmount` | decimal | Discount analysis |
| `items[].product` | reference | Product performance |
| `items[].quantity` | decimal | Units sold |
| `payments[].method` | reference | Payment method mix |

### Receipt vs Trade Order

| Aspect | Receipt | Trade Order |
|--------|---------|-------------|
| **Nature** | Read-only transaction record | Editable order |
| **Creation** | Created by POS at checkout | Created by API/POS |
| **Mutability** | Immutable | Editable until fulfilled |
| **Use case** | Historical analysis | Order management |
| **Returns** | Separate return receipt | Order status change |

---

## Integration Architecture

### Data Flow Pattern

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CommerceOS                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                  │
│  │   Receipts   │  │  Products    │  │   Stores     │                  │
│  │              │  │              │  │              │                  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                  │
└─────────┼─────────────────┼─────────────────┼───────────────────────────┘
          │                 │                 │
          │ GET /receipts   │ GET /products   │ GET /stores
          │ (incremental)   │ (dimension)     │ (dimension)
          ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      Integration Layer (ETL)                             │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────────────────┐  │
│  │ Extract        │  │ Transform      │  │ Load                     │  │
│  │ (API calls)    │  │ (flatten,      │  │ (insert to DW)           │  │
│  │                │  │  normalize)    │  │                          │  │
│  └───────┬────────┘  └───────┬────────┘  └───────────┬──────────────┘  │
└──────────┼───────────────────┼───────────────────────┼─────────────────┘
           │                   │                       │
           ▼                   ▼                       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      Data Warehouse / BI Platform                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                  │
│  │ fact_sales   │  │ dim_product  │  │ dim_store    │                  │
│  │              │  │              │  │              │                  │
│  └──────────────┘  └──────────────┘  └──────────────┘                  │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    BI Dashboards & Reports                        │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### Sync Strategy Options

| Strategy | Description | Latency | Complexity |
|----------|-------------|---------|------------|
| **Polling** | Periodic API queries | 5-60 minutes | Low |
| **Webhook** | Push on receipt creation | 1-5 minutes | Medium |
| **Streaming** | Real-time NDJSON stream | Seconds | Higher |

### Recommended: Incremental Polling with Webhook Trigger

```
Primary:    Incremental polling every 5-15 minutes
Secondary:  Webhook triggers immediate sync for urgent updates
Fallback:   Full reconciliation weekly
```

---

## Phase 1: Initial Data Export

### Full Historical Export

For initial data warehouse load, export all historical receipts:

```bash
# Get receipt count to estimate export scope
GET /v1/receipts~count

# Response: {"count": 125000}
```

### Paginated Full Export

```bash
# Page 1: Oldest receipts first
GET /v1/receipts~orderBy(timestamp)~take(500)~withAll

# Page 2: Skip first 500
GET /v1/receipts~orderBy(timestamp)~skip(500)~take(500)~withAll

# Continue until response has fewer than 500 items
```

### Streaming Export (Large Datasets)

For very large datasets, use NDJSON streaming:

```bash
curl -H "Accept: application/x-ndjson" \
  "https://your-tenant.api/v1/receipts~orderBy(timestamp)~take(10000)"
```

### CSV Export (Flat Structure)

For simple tabular export:

```bash
curl -H "Accept: text/csv" \
  "https://your-tenant.api/v1/receipts~just(identifiers,timestamp,totalAmount,currencyCode)~take(10000)"
```

### Export Fields Checklist

**Receipt Level:**
- [ ] `identifiers.key` — Primary key
- [ ] `identifiers.receiptID` — Display ID
- [ ] `timestamp` — Transaction time
- [ ] `seller.identifiers` — Store reference
- [ ] `buyer.identifiers` — Customer reference
- [ ] `posTerminal.identifiers` — Terminal reference
- [ ] `currencyCode` — Currency
- [ ] `totalAmount` — Grand total
- [ ] `totalTaxAmount` — VAT total
- [ ] `totalDiscountAmount` — Discount total
- [ ] `roundingAmount` — Rounding adjustment
- [ ] `vatGroups` — Tax breakdown

**Item Level:**
- [ ] `items[].product.identifiers` — Product reference
- [ ] `items[].description` — Line description
- [ ] `items[].quantity` — Units
- [ ] `items[].unitAmount` — Unit price (excl. VAT)
- [ ] `items[].salesAmount` — Sales amount (excl. VAT)
- [ ] `items[].taxAmount` — Tax amount for line
- [ ] `items[].totalAmount` — Line total (incl. VAT)
- [ ] `items[].discountAmount` — Discount amount
- [ ] `items[].vatPercentage` — Tax rate

Note: receipt item subpaths for `discounts` and `instances` are currently unsupported, so avoid relying on those expansions in receipt exports.

**Payment Level:**
- [ ] `payments[].method` — Payment method ID (string, e.g., `com.heads.card`)
- [ ] `payments[].amount` — Amount
- [ ] `payments[].paymentType` — PAYMENT or REFUND
- [ ] `payments[].identifiers.transactionId` — Payment reference
- [ ] `payments[].consumerPrintout` — Consumer receipt text
- [ ] `payments[].merchantPrintout` — Merchant receipt text

---

## Phase 2: Incremental Sync

### Time-Based Incremental Pull

Track the last sync timestamp and fetch only newer receipts:

```bash
# Store last sync timestamp: 2024-12-15T10:00:00.000Z

# Fetch receipts after that timestamp
GET /v1/receipts/after/2024-12-15T10:00:00.000Z~orderBy(timestamp)~take(500)~withAll

# Or use the finder
POST /v1/receipts/@find
{
  "timestampFrom": "2024-12-15T10:00:00.000Z"
}
```

### Cursor-Based Pagination

For large incremental pulls, use cursor-style pagination:

```bash
# First batch
GET /v1/receipts/after/2024-12-15T10:00:00.000Z~orderBy(timestamp)~take(500)

# Next batch: use last timestamp from previous response
GET /v1/receipts/after/2024-12-15T10:05:32.123Z~orderBy(timestamp)~take(500)

# Continue until response has fewer than 500 items
```

### Incremental Sync Algorithm

```python
# Pseudocode for incremental sync
def sync_receipts():
    last_sync = get_last_sync_timestamp()  # From state store

    while True:
        receipts = api.get(f"/receipts/after/{last_sync}~orderBy(timestamp)~take(500)~withAll")

        if len(receipts) == 0:
            break

        for receipt in receipts:
            transform_and_load(receipt)

        # Update last sync to timestamp of most recent receipt
        last_sync = receipts[-1]['timestamp']
        save_last_sync_timestamp(last_sync)

        if len(receipts) < 500:
            break  # No more data

    return last_sync
```

### Handling Gaps and Retries

```python
# With retry and gap handling
def sync_with_recovery():
    try:
        last_sync = get_last_sync_timestamp()

        # Overlap by 1 minute to catch any timing issues
        safe_start = last_sync - timedelta(minutes=1)

        sync_from(safe_start)

    except NetworkError:
        # Retry with exponential backoff
        for attempt in range(5):
            sleep(2 ** attempt)
            try:
                sync_from(safe_start)
                break
            except NetworkError:
                continue
```

### Sync Frequency Recommendations

| Use Case | Frequency | Rationale |
|----------|-----------|-----------|
| Real-time dashboards | 1-5 minutes | Near-real-time visibility |
| Daily reporting | 15-60 minutes | Balance load and freshness |
| Batch analytics | Daily/nightly | Full reconciliation |
| Compliance/audit | Weekly full sync | Catch any missed records |

---

## Phase 3: Data Transformation

### Flattening Receipt Data

Transform nested receipt JSON into flat fact tables:

**Source Receipt:**
```json
{
  "identifiers": {"key": "abc123", "receiptID": "MPK00000001"},
  "timestamp": "2024-12-15T14:30:00Z",
  "seller": {"identifiers": {"key": "store1"}},
  "buyer": {"identifiers": {"com.acme.customer-id": "CUST-001"}},
  "currencyCode": "SEK",
  "totalAmount": "1250.00",
  "items": [
    {
      "product": {"identifiers": {"com.acme.sku": "PROD-001"}},
      "description": "Widget",
      "quantity": "2",
      "unitAmount": "400.00",
      "salesAmount": "800.00",
      "taxAmount": "200.00",
      "totalAmount": "1000.00",
      "discountAmount": "0.00",
      "vatPercentage": "25"
    },
    {
      "product": {"identifiers": {"com.acme.sku": "PROD-002"}},
      "description": "Gadget",
      "quantity": "1",
      "unitAmount": "200.00",
      "salesAmount": "200.00",
      "taxAmount": "50.00",
      "totalAmount": "250.00",
      "discountAmount": "0.00",
      "vatPercentage": "25"
    }
  ],
  "payments": [
    {
      "paymentType": "PAYMENT",
      "method": "com.heads.card",
      "amount": "1250.00",
      "currencyCode": "SEK",
      "consumerPrintout": "Card Payment\nAmount: 1250.00 SEK",
      "merchantPrintout": "VISA ****1234\nApproved"
    }
  ]
}
```

**Target: fact_receipt_header:**
| receipt_key | receipt_id | timestamp | store_key | customer_key | currency | total_amount | total_tax | total_discount |
|-------------|------------|-----------|-----------|--------------|----------|--------------|-----------|----------------|
| abc123 | MPK00000001 | 2024-12-15T14:30:00Z | store1 | CUST-001 | SEK | 1250.00 | 250.00 | 0.00 |

**Target: fact_receipt_item:**
| receipt_key | line_number | product_sku | description | quantity | unit_price | line_total | discount | vat_rate |
|-------------|-------------|-------------|-------------|----------|------------|------------|----------|----------|
| abc123 | 1 | PROD-001 | Widget | 2 | 400.00 | 1000.00 | 0.00 | 25 |
| abc123 | 2 | PROD-002 | Gadget | 1 | 200.00 | 250.00 | 0.00 | 25 |

**Target: fact_receipt_payment:**
| receipt_key | payment_number | payment_method | amount | payment_type |
|-------------|----------------|----------------|--------|--------------|
| abc123 | 1 | card | 1250.00 | PAYMENT |

### Mapped Type for Transformation

Use CommerceOS mapped types for server-side transformation:

```bash
# Create mapped type for BI export (must be active for webhook use)
PUT /v1/mapped-types/receipt-bi-export
{
  "identifiers": {"mappedTypeName": "receipt-bi-export"},
  "active": true,
  "body": {
    "receipt_key": "identifiers/key",
    "receipt_id": "identifiers/receiptID",
    "timestamp": "timestamp",
    "store_key": "seller/identifiers/key",
    "customer_key": "buyer/identifiers/com.acme.customer-id",
    "currency": "currencyCode",
    "total_amount": "totalAmount",
    "total_tax": "totalTaxAmount",
    "total_discount": "totalDiscountAmount"
  }
}

# Use mapped type in query
GET /v1/receipts/after/2024-12-15T00:00:00Z~map(receipt-bi-export)~take(500)
```

### Extracting Item-Level Data

```bash
# Get receipt with items expanded
GET /v1/receipts/{receipt-key}~with(items~with(product))

# Or use just() for specific fields
GET /v1/receipts/{receipt-key}~with(items~just(product,quantity,unitAmount,totalAmount,discountAmount,vatPercentage))
```

---

## Handling Returns and Voids

### Return Receipts

Returns create separate receipts with negative amounts:

```json
{
  "identifiers": {
    "key": "return123",
    "receiptID": "MPK00000002",
    "com.acme.originalReceiptKey": "abc123"
  },
  "timestamp": "2024-12-16T09:00:00Z",
  "totalAmount": "-500.00",
  "items": [
    {
      "product": {"identifiers": {"com.acme.sku": "PROD-001"}},
      "description": "Widget - RETURN",
      "quantity": "-1",
      "unitAmount": "400.00",
      "salesAmount": "-400.00",
      "taxAmount": "-100.00",
      "totalAmount": "-500.00"
    }
  ],
  "payments": [
    {
      "paymentType": "REFUND",
      "method": "com.heads.card",
      "amount": "-500.00",
      "currencyCode": "SEK",
      "consumerPrintout": "Refund\nAmount: -500.00 SEK",
      "merchantPrintout": "VISA ****1234\nRefund Approved"
    }
  ]
}
```

> **Note:** The schema has no `originalReceipt` field. If you need to link returns to original receipts, use a namespaced identifier like `com.acme.originalReceiptKey` in the receipt's identifiers.

### Identifying Returns in Analytics

**Method 1: Check for negative totals**
```sql
SELECT
  receipt_key,
  CASE WHEN total_amount < 0 THEN 'RETURN' ELSE 'SALE' END as transaction_type,
  total_amount
FROM fact_receipt_header
```

**Method 2: Check payment type**
```sql
SELECT
  r.receipt_key,
  CASE WHEN p.payment_type = 'REFUND' THEN 'RETURN' ELSE 'SALE' END as transaction_type
FROM fact_receipt_header r
JOIN fact_receipt_payment p ON r.receipt_key = p.receipt_key
```

### Net Sales Calculation

```sql
-- Net sales = Sales - Returns
SELECT
  date_trunc('day', timestamp) as sales_date,
  store_key,
  SUM(CASE WHEN total_amount >= 0 THEN total_amount ELSE 0 END) as gross_sales,
  SUM(CASE WHEN total_amount < 0 THEN ABS(total_amount) ELSE 0 END) as returns,
  SUM(total_amount) as net_sales
FROM fact_receipt_header
GROUP BY 1, 2
ORDER BY 1 DESC
```

### Void Handling

Voided transactions are typically not included in receipt exports (they're cancelled before completion). If your integration receives voids, filter them:

```bash
# Receipts exclude voided transactions by default
GET /v1/receipts~take(500)
```

### Analyzing Return Receipts

Return receipts are identified by negative `totalAmount`. To analyze returns, fetch return receipts with their items:

```bash
# Get return receipts with items
GET /v1/receipts~where(totalAmount<0)~with(items~with(product))~take(100)
```

```sql
-- Return analysis by product
SELECT
  product_sku,
  COUNT(*) as return_count,
  SUM(ABS(line_total)) as return_value
FROM fact_receipt_item
WHERE line_total < 0
GROUP BY product_sku
ORDER BY return_value DESC
```

> **Note:** Return reasons are captured at the store/POS level and may be stored in your external systems. The receipt schema captures the transaction details but not the reason for return.

---

## Currency and VAT Normalization

### Multi-Currency Handling

If you have stores in multiple currencies:

```sql
-- Create currency dimension
CREATE TABLE dim_currency (
  currency_code VARCHAR(3) PRIMARY KEY,
  currency_name VARCHAR(50),
  symbol VARCHAR(5),
  decimal_places INT
);

-- Store exchange rates
CREATE TABLE fact_exchange_rate (
  rate_date DATE,
  from_currency VARCHAR(3),
  to_currency VARCHAR(3),
  rate DECIMAL(18,6),
  PRIMARY KEY (rate_date, from_currency, to_currency)
);

-- Normalize to reporting currency (e.g., SEK)
SELECT
  r.receipt_key,
  r.timestamp,
  r.total_amount as local_amount,
  r.currency,
  r.total_amount * COALESCE(fx.rate, 1) as normalized_amount_sek
FROM fact_receipt_header r
LEFT JOIN fact_exchange_rate fx
  ON DATE(r.timestamp) = fx.rate_date
  AND r.currency = fx.from_currency
  AND fx.to_currency = 'SEK'
```

### Fetch Exchange Rates from CommerceOS

```bash
# Get spot exchange rates
GET /v1/spot-exchange-rates~where(baseCurrency/identifiers/currencyCode=EUR)~where(quoteCurrency/identifiers/currencyCode=SEK)~take(100)
```

### VAT Normalization

Receipts include VAT breakdown by rate:

```json
{
  "vatGroups": [
    {"percentage": "25", "quantity": "3", "netAmount": "800.00", "grossAmount": "1000.00", "vatAmount": "200.00"},
    {"percentage": "12", "quantity": "1", "netAmount": "89.00", "grossAmount": "99.68", "vatAmount": "10.68"}
  ]
}
```

**VAT Analysis Query:**
```sql
SELECT
  vat_rate,
  SUM(net_amount) as net_sales,
  SUM(vat_amount) as vat_collected,
  SUM(gross_amount) as gross_sales
FROM fact_receipt_vat
GROUP BY vat_rate
ORDER BY vat_rate DESC
```

### Net vs Gross Calculations

```sql
-- Calculate net from gross (for 25% VAT)
SELECT
  gross_amount,
  gross_amount / 1.25 as net_amount,
  gross_amount - (gross_amount / 1.25) as vat_amount
FROM fact_receipt_item
WHERE vat_rate = 25
```

---

## Late-Arriving Data Patterns

### Understanding Late Data

Late-arriving data occurs when:
- Offline POS syncs after reconnecting
- Time zone differences in processing
- System delays or retries

### Detection Strategy

```sql
-- Detect late arrivals (receipt timestamp vs sync timestamp)
SELECT
  receipt_key,
  timestamp as receipt_time,
  loaded_at as sync_time,
  DATEDIFF(hour, timestamp, loaded_at) as hours_late
FROM fact_receipt_header
WHERE DATEDIFF(hour, timestamp, loaded_at) > 1
```

### Handling Late Data

**Option 1: Upsert Pattern**
```python
# Always upsert, never insert
def load_receipt(receipt):
    execute("""
        INSERT INTO fact_receipt_header (receipt_key, ...)
        VALUES (%(key)s, ...)
        ON CONFLICT (receipt_key)
        DO UPDATE SET ...
    """, receipt)
```

**Option 2: Partition by Sync Date**
```sql
-- Partition by sync date, not receipt date
CREATE TABLE fact_receipt_header (
    receipt_key VARCHAR(64),
    timestamp TIMESTAMP,
    loaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ...
) PARTITION BY RANGE (loaded_at);
```

**Option 3: Separate Late Table**
```sql
-- Move late arrivals to separate table for reprocessing
INSERT INTO fact_receipt_late
SELECT * FROM staging_receipt
WHERE timestamp < DATEADD(day, -1, CURRENT_DATE);
```

### Reconciliation Pattern

```sql
-- Weekly reconciliation: compare source vs DW counts
WITH source_counts AS (
  -- From incremental sync log
  SELECT date_trunc('day', receipt_time) as day, COUNT(*) as source_count
  FROM sync_log
  WHERE sync_date = CURRENT_DATE
  GROUP BY 1
),
dw_counts AS (
  SELECT date_trunc('day', timestamp) as day, COUNT(*) as dw_count
  FROM fact_receipt_header
  WHERE timestamp >= DATEADD(day, -7, CURRENT_DATE)
  GROUP BY 1
)
SELECT
  COALESCE(s.day, d.day) as day,
  COALESCE(s.source_count, 0) as source,
  COALESCE(d.dw_count, 0) as dw,
  COALESCE(s.source_count, 0) - COALESCE(d.dw_count, 0) as diff
FROM source_counts s
FULL OUTER JOIN dw_counts d ON s.day = d.day
WHERE COALESCE(s.source_count, 0) != COALESCE(d.dw_count, 0)
```

---

## Webhook and Streaming Options

### Webhook: Receipt Created

Configure CommerceOS to push receipts to your endpoint:

```bash
PUT /v1/sync-webhooks/com.acme.sync-id=receipt-to-bi
{
  "identifiers": {"com.acme.sync-id": "receipt-to-bi"},
  "name": "Receipt BI Export",
  "description": "Push receipts to BI system",
  "when": "api/v1/now/+=0:5:0",
  "repeat": true,
  "maxAttempts": 3,
  "in": {
    "url": "api/v1/receipts~orderBy(timestamp:desc)~take(100)~withAll"
  },
  "map": {
    "identifiers": {"mappedTypeName": "receipt-bi-export"}
  },
  "out": {
    "method": "POST",
    "url": "https://your-bi-system.example.com/api/receipts",
    "auth": {
      "clientCredentials": {
        "tokenUrl": "https://your-bi-system.example.com/oauth/token",
        "client_id": "YOUR_CLIENT_ID",
        "client_secret": "YOUR_CLIENT_SECRET",
        "scope": "receipts.write"
      }
    }
  },
  "then": {
    "set": {
      "identifiers": {
        "com.acme.bi-synced": "true"
      }
    }
  },
  "authorizedScopes": ["read:receipts", "write:receipts"],
  "verboseLogging": false
}
```

### Streaming: NDJSON

For real-time streaming to data pipelines:

```bash
# Stream receipts as newline-delimited JSON
curl -N -H "Accept: application/x-ndjson" \
  "https://your-tenant.api/v1/receipts~orderBy(timestamp:desc)~take(10000)"
```

### Integration with Common BI Platforms

**Apache Kafka:**
```python
# Produce receipts to Kafka topic
from kafka import KafkaProducer

producer = KafkaProducer(bootstrap_servers='kafka:9092')

def sync_receipt_to_kafka(receipt):
    producer.send('receipts',
                  key=receipt['identifiers']['key'].encode(),
                  value=json.dumps(receipt).encode())
```

**AWS Kinesis:**
```python
import boto3

kinesis = boto3.client('kinesis')

def sync_receipt_to_kinesis(receipt):
    kinesis.put_record(
        StreamName='receipts-stream',
        Data=json.dumps(receipt),
        PartitionKey=receipt['identifiers']['key']
    )
```

**Google BigQuery:**
```python
from google.cloud import bigquery

client = bigquery.Client()

def load_receipt_to_bq(receipts):
    table_ref = client.dataset('sales').table('fact_receipt_header')
    errors = client.insert_rows_json(table_ref, receipts)
    if errors:
        raise Exception(f"BigQuery insert errors: {errors}")
```

---

## Data Warehouse Schema Design

### Star Schema Design

```
                          ┌──────────────┐
                          │ dim_date     │
                          │              │
                          │ date_key (PK)│
                          │ date         │
                          │ day_of_week  │
                          │ week         │
                          │ month        │
                          │ quarter      │
                          │ year         │
                          └──────┬───────┘
                                 │
┌──────────────┐   ┌─────────────┴─────────────┐   ┌──────────────┐
│ dim_store    │   │    fact_receipt_header    │   │ dim_product  │
│              │   │                           │   │              │
│ store_key    │───│ receipt_key (PK)          │───│ product_key  │
│ store_id     │   │ date_key (FK)             │   │ product_sku  │
│ store_name   │   │ store_key (FK)            │   │ product_name │
│ region       │   │ customer_key (FK)         │   │ category     │
│ city         │   │ timestamp                 │   │ brand        │
│ country      │   │ total_amount              │   │ vat_rate     │
└──────────────┘   │ total_tax_amount          │   └──────────────┘
                   │ total_discount_amount     │
┌──────────────┐   │ currency_code             │   ┌──────────────┐
│ dim_customer │───│                           │───│ dim_payment  │
│              │   └───────────────────────────┘   │ _method      │
│ customer_key │                 │                 │              │
│ customer_id  │                 │                 │ method_key   │
│ customer_name│                 │                 │ method_id    │
│ segment      │                 │                 │ method_name  │
│ vip_flag     │                 │                 │ type         │
└──────────────┘                 │                 └──────────────┘
                                 │
                   ┌─────────────┴─────────────┐
                   │    fact_receipt_item      │
                   │                           │
                   │ receipt_key (FK)          │
                   │ line_number               │
                   │ product_key (FK)          │
                   │ quantity                  │
                   │ unit_price                │
                   │ line_total                │
                   │ discount_amount           │
                   │ vat_percentage            │
                   └───────────────────────────┘
```

### DDL: Fact Tables

```sql
-- Fact: Receipt Header
CREATE TABLE fact_receipt_header (
    receipt_key VARCHAR(64) PRIMARY KEY,
    receipt_id VARCHAR(50),
    date_key INT REFERENCES dim_date(date_key),
    store_key VARCHAR(64) REFERENCES dim_store(store_key),
    customer_key VARCHAR(64) REFERENCES dim_customer(customer_key),
    pos_terminal_key VARCHAR(64),
    timestamp TIMESTAMP NOT NULL,
    currency_code VARCHAR(3),
    total_amount DECIMAL(18,2),
    total_tax_amount DECIMAL(18,2),
    total_discount_amount DECIMAL(18,2),
    rounding_amount DECIMAL(18,2),
    total_payable_amount DECIMAL(18,2),
    total_paid_amount DECIMAL(18,2),
    transaction_type VARCHAR(10), -- SALE or RETURN
    loaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Fact: Receipt Items
CREATE TABLE fact_receipt_item (
    receipt_key VARCHAR(64) REFERENCES fact_receipt_header(receipt_key),
    line_number INT,
    product_key VARCHAR(64) REFERENCES dim_product(product_key),
    description VARCHAR(255),
    quantity DECIMAL(18,4),
    unit_price DECIMAL(18,4),
    line_total DECIMAL(18,2),
    discount_amount DECIMAL(18,2),
    vat_percentage DECIMAL(5,2),
    return_reason_key VARCHAR(64),
    PRIMARY KEY (receipt_key, line_number)
);

-- Fact: Receipt Payments
CREATE TABLE fact_receipt_payment (
    receipt_key VARCHAR(64) REFERENCES fact_receipt_header(receipt_key),
    payment_number INT,
    payment_method_key VARCHAR(64) REFERENCES dim_payment_method(method_key),
    amount DECIMAL(18,2),
    payment_type VARCHAR(10), -- PAYMENT or REFUND
    transaction_id VARCHAR(100),
    PRIMARY KEY (receipt_key, payment_number)
);

-- Fact: Receipt VAT Groups
CREATE TABLE fact_receipt_vat (
    receipt_key VARCHAR(64) REFERENCES fact_receipt_header(receipt_key),
    vat_rate DECIMAL(5,2),
    quantity DECIMAL(18,4),
    net_amount DECIMAL(18,2),
    gross_amount DECIMAL(18,2),
    vat_amount DECIMAL(18,2),
    PRIMARY KEY (receipt_key, vat_rate)
);
```

### DDL: Dimension Tables

```sql
-- Dimension: Date
CREATE TABLE dim_date (
    date_key INT PRIMARY KEY,
    date DATE NOT NULL,
    day_of_week INT,
    day_name VARCHAR(10),
    week_of_year INT,
    month INT,
    month_name VARCHAR(10),
    quarter INT,
    year INT,
    is_weekend BOOLEAN,
    is_holiday BOOLEAN
);

-- Dimension: Store
CREATE TABLE dim_store (
    store_key VARCHAR(64) PRIMARY KEY,
    store_id VARCHAR(50),
    store_name VARCHAR(100),
    address_line1 VARCHAR(200),
    city VARCHAR(100),
    region VARCHAR(100),
    country VARCHAR(100),
    country_code VARCHAR(2),
    store_type VARCHAR(50),
    opening_date DATE,
    valid_from TIMESTAMP,
    valid_to TIMESTAMP
);

-- Dimension: Product
CREATE TABLE dim_product (
    product_key VARCHAR(64) PRIMARY KEY,
    product_sku VARCHAR(50),
    product_name VARCHAR(200),
    gtin VARCHAR(14),
    category_l1 VARCHAR(100),
    category_l2 VARCHAR(100),
    category_l3 VARCHAR(100),
    brand VARCHAR(100),
    supplier VARCHAR(100),
    default_vat_rate DECIMAL(5,2),
    status VARCHAR(20),
    valid_from TIMESTAMP,
    valid_to TIMESTAMP
);

-- Dimension: Customer
CREATE TABLE dim_customer (
    customer_key VARCHAR(64) PRIMARY KEY,
    customer_id VARCHAR(50),
    customer_name VARCHAR(200),
    customer_type VARCHAR(20), -- PERSON, COMPANY
    segment VARCHAR(50),
    vip_flag BOOLEAN,
    country VARCHAR(100),
    city VARCHAR(100),
    valid_from TIMESTAMP,
    valid_to TIMESTAMP
);

-- Dimension: Payment Method
CREATE TABLE dim_payment_method (
    method_key VARCHAR(64) PRIMARY KEY,
    method_id VARCHAR(50),
    method_name VARCHAR(100),
    method_type VARCHAR(50), -- CARD, CASH, DIGITAL
    provider VARCHAR(100)
);
```

---

## Production Checklist

### Pre-Launch

- [ ] **Schema design** — Create fact and dimension tables
- [ ] **Field mapping** — Document CommerceOS → DW field mapping
- [ ] **Historical load** — Plan initial data migration
- [ ] **Incremental strategy** — Define sync frequency and method

### Integration Setup

- [ ] **OAuth scopes** — Obtain scope: `read:receipts`
- [ ] **Test environment** — Validate extraction in staging
- [ ] **Error handling** — Implement retry and dead letter logic
- [ ] **Late data handling** — Define policy for late arrivals

### Data Quality

- [ ] **Deduplication** — Ensure receipt_key uniqueness
- [ ] **Referential integrity** — Dimension lookups work
- [ ] **Null handling** — Handle missing customer/product refs
- [ ] **Data type validation** — Amounts, dates, quantities valid

### Go-Live

- [ ] **Monitoring** — Sync status dashboards
- [ ] **Alerting** — Alerts for sync failures and data gaps
- [ ] **Reconciliation** — Weekly source vs DW comparison
- [ ] **Performance** — Query performance meets SLA

### Post-Launch

- [ ] **Data freshness** — Monitor sync latency
- [ ] **Growth planning** — Monitor table growth
- [ ] **Query optimization** — Index tuning as needed

---

## Copy-Paste Query Reference

### Basic Receipt Queries

```bash
# Get recent receipts
GET /v1/receipts~orderBy(timestamp:desc)~take(100)

# Get receipts with all details
GET /v1/receipts~orderBy(timestamp:desc)~take(100)~withAll

# Get receipts for specific store
GET /v1/receipts~where(seller/identifiers/com.acme.store-id=STORE-001)~orderBy(timestamp:desc)~take(100)

# Get receipts for date range
GET /v1/receipts/after/2024-12-01T00:00:00Z~orderBy(timestamp)~take(500)

# Get receipts before a date
GET /v1/receipts/before/2024-12-31T23:59:59Z~orderBy(timestamp:desc)~take(500)

# Get single receipt by ID
GET /v1/receipts/receiptID=MPK00000001~withAll

# Get single receipt by key
GET /v1/receipts/abc123def456~withAll
```

### Incremental Sync Queries

```bash
# Incremental pull from timestamp
GET /v1/receipts/after/2024-12-15T10:00:00.000Z~orderBy(timestamp)~take(500)~withAll

# Using finder with timestampFrom
POST /v1/receipts/@find
{
  "timestampFrom": "2024-12-15T10:00:00.000Z"
}

# With pagination cursor
GET /v1/receipts~where(timestamp>2024-12-15T10:00:00.000Z)~orderBy(timestamp)~take(500)
```

### Analytics Queries

```bash
# Count receipts by date range (use ~where for range filtering)
# Note: Chaining /after/{ts}/before/{ts} is NOT supported; use ~where operators instead
GET /v1/receipts~where(timestamp>2024-12-01T00:00:00Z)~where(timestamp<2024-12-31T23:59:59Z)~count

# Get receipt with items and payments
GET /v1/receipts/{id}~with(items~with(product),payments,vatGroups)

# Get receipts with customer info
GET /v1/receipts~with(buyer~with(name))~orderBy(timestamp:desc)~take(100)

# Get return receipts only
GET /v1/receipts~where(totalAmount<0)~orderBy(timestamp:desc)~take(100)

# Get receipts by payment method (requires filtering after fetch)
GET /v1/receipts~with(payments)~orderBy(timestamp:desc)~take(500)
```

### Streaming Queries

```bash
# NDJSON stream for large exports
curl -H "Accept: application/x-ndjson" \
  "https://your-tenant.api/v1/receipts~orderBy(timestamp)~take(10000)"

# CSV export for flat data
curl -H "Accept: text/csv" \
  "https://your-tenant.api/v1/receipts~just(identifiers,timestamp,totalAmount,currencyCode)~take(10000)"
```

### Webhook Configuration

```bash
# Create BI sync webhook
PUT /v1/sync-webhooks/com.acme.sync-id=bi-receipt-sync
{
  "identifiers": {"com.acme.sync-id": "bi-receipt-sync"},
  "name": "BI Receipt Sync",
  "description": "Push receipts to BI system every 5 minutes",
  "when": "api/v1/now/+=0:5:0",
  "repeat": true,
  "maxAttempts": 5,
  "in": {
    "url": "api/v1/receipts~orderBy(timestamp:desc)~take(100)~withAll"
  },
  "out": {
    "method": "POST",
    "url": "https://your-bi-system.example.com/api/receipts/ingest",
    "auth": {
      "authorizationHeader": "Bearer YOUR_API_KEY"
    }
  },
  "authorizedScopes": ["read:receipts"],
  "verboseLogging": true
}

# Check webhook status
GET /v1/sync-webhooks/com.acme.sync-id=bi-receipt-sync~just(error,attempts,last,next,when)

# Reset failed webhook
PATCH /v1/sync-webhooks/com.acme.sync-id=bi-receipt-sync
{
  "attempts": 0,
  "when": "api/v1/now/+=0:0:30"
}
```

### Dimension Loading

```bash
# Load stores for dim_store
GET /v1/stores~with(addresses,owner)~take(500)

# Load products for dim_product
GET /v1/products~with(defaultVatCode,categories)~take(1000)

# Load customers for dim_customer (people)
GET /v1/people~with(addresses,customerGroups)~take(1000)

# Load customers for dim_customer (companies)
GET /v1/companies~with(addresses,customerGroups)~take(500)

# Load payment methods
GET /v1/payment-methods~take(100)
```

---

## Related Documentation

- [Receipts Data Guide](../receipts.md) — Receipt field reference
- [Pagination](../pagination.md) — Large result set handling
- [Sync Webhooks](../sync-webhooks.md) — Webhook configuration
- [Mapped Types](../mapped-types.md) — Data transformation
- [Operators Catalog](../operators-catalog.md) — Query operators reference
