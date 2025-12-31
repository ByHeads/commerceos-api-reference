# Point of Sale (POS) Examples

Curl examples for POS terminals, profiles, functions, receipts, devices, printers, and payment terminals.

**Base URL:** `http://localhost:5000/api/v1`
**API Key:** `banana` (passed via Basic Auth with empty username: `-u ":banana"`)

> **See also:** [Examples Index](../examples.md) | [Reference Documentation](../../reference/)

---

## POS Terminals

```bash
# List all POS terminals
curl -X GET -u ":banana" "localhost:5000/api/v1/pos-terminals"

# Get POS terminal by name
curl -X GET -u ":banana" "localhost:5000/api/v1/pos-terminals/posTerminalName=Kassa%201"

# Get terminal with profile
curl -X GET -u ":banana" "localhost:5000/api/v1/pos-terminals/posTerminalName=Kassa%201~with(profile)"

# Create a POS terminal
# Required: identifiers.posTerminalName, associatedNode
# Optional: profile, status, assignedDevice, receiptPrinter, etc.
# Note: POS terminals do NOT have a `name` field; use identifiers.posTerminalName
curl -X POST -u ":banana" "localhost:5000/api/v1/pos-terminals" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"posTerminalName": "Kassa 2"},
    "status": "Active",
    "profile": {"identifiers": {"posProfileId": "default"}},
    "associatedNode": {"identifiers": {"com.heads.seedID": "store1"}}
  }'

# Update POS terminal
curl -X PATCH -u ":banana" "localhost:5000/api/v1/pos-terminals/posTerminalName=Kassa%202" \
  -H "Content-Type: application/json" \
  -d '{"status": "Inactive"}'
```

---

## POS Profiles

```bash
# List all POS profiles
curl -X GET -u ":banana" "localhost:5000/api/v1/pos-profiles"

# Get POS profile by ID
curl -X GET -u ":banana" "localhost:5000/api/v1/pos-profiles/posProfileId=default"

# Get profile with functions
curl -X GET -u ":banana" "localhost:5000/api/v1/pos-profiles/posProfileId=default~with(functions)"

# Create a POS profile
curl -X POST -u ":banana" "localhost:5000/api/v1/pos-profiles" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"posProfileId": "quick-service"},
    "name": "Quick Service Profile",
    "defaultCurrency": {"identifiers": {"currencyCode": "SEK"}}
  }'

# Update POS profile
curl -X PATCH -u ":banana" "localhost:5000/api/v1/pos-profiles/posProfileId=quick-service" \
  -H "Content-Type: application/json" \
  -d '{"name": "Fast Food Profile"}'
```

---

## POS Functions

```bash
# List all POS functions
curl -X GET -u ":banana" "localhost:5000/api/v1/pos-functions"

# Get POS function by ID
curl -X GET -u ":banana" "localhost:5000/api/v1/pos-functions/posFunctionId=open-drawer"

# Create a POS function
# Note: POS functions have NO `description` field
# Available fields: identifiers, name, iconKey, hotkey, order, color, visibleInPos, requiredPermissions
#
# Subtype-specific fields (require @type):
#   - "pay function" → paymentMethod
#   - "manual discount function" → phase
#   - "add product function" → product
curl -X POST -u ":banana" "localhost:5000/api/v1/pos-functions" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"posFunctionId": "void-sale"},
    "name": "Void Sale",
    "iconKey": "cancel",
    "order": 100,
    "visibleInPos": true
  }'

# Create a pay function with payment method
curl -X POST -u ":banana" "localhost:5000/api/v1/pos-functions" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "pay function",
    "identifiers": {"posFunctionId": "pay-card"},
    "name": "Card Payment",
    "paymentMethod": {"identifiers": {"methodId": "com.heads.card"}}
  }'
```

---

## Receipts

```bash
# List all receipts
curl -X GET -u ":banana" "localhost:5000/api/v1/receipts"

# Get receipt by ID
curl -X GET -u ":banana" "localhost:5000/api/v1/receipts/receiptID=RCP-2024-00001"

# Get receipt with items
curl -X GET -u ":banana" "localhost:5000/api/v1/receipts/receiptID=RCP-2024-00001~with(items)"

# Get receipt items
curl -X GET -u ":banana" "localhost:5000/api/v1/receipts/receiptID=RCP-2024-00001/items"

# Get specific receipt item
curl -X GET -u ":banana" "localhost:5000/api/v1/receipts/receiptID=RCP-2024-00001/items/0"

# Get receipt payments
curl -X GET -u ":banana" "localhost:5000/api/v1/receipts/receiptID=RCP-2024-00001/payments"

# Receipts from last 24 hours
curl -X GET -u ":banana" "localhost:5000/api/v1/receipts/after/-=24"

# Receipts from last 30 minutes
curl -X GET -u ":banana" "localhost:5000/api/v1/receipts/after/-=0:30"

# Receipts from last week with item count
curl -X GET -u ":banana" "localhost:5000/api/v1/receipts/after/-=168~with(items/count)"

# Receipts in date range (use ~where for timestamp filtering)
curl -X GET -u ":banana" "localhost:5000/api/v1/receipts~where(timestamp>2024-12-01T00:00:00Z,timestamp<2024-12-31T23:59:59Z)"

# Alternatively, chain ~where operators
curl -X GET -u ":banana" "localhost:5000/api/v1/receipts~where(timestamp>2024-12-01T00:00:00Z)~where(timestamp<2024-12-31T23:59:59Z)"

# Map receipts to custom format
curl -X GET -u ":banana" "localhost:5000/api/v1/receipts/after/-=24~map(com.heads.receipt-csv)"

# Create/import a receipt (typically done by POS system)
# Required fields: identifiers.receiptID, prefix, ordinal, seller, buyer, posTerminal, currencyCode, timestamp, items, payments
# Payment fields: method, amount, consumerPrintout, merchantPrintout (required on create)
curl -X POST -u ":banana" "localhost:5000/api/v1/receipts" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"receiptID": "RCP-2024-00002"},
    "prefix": "RCP",
    "ordinal": 2,
    "currencyCode": "SEK",
    "timestamp": "2024-12-20T10:00:00Z",
    "seller": {"identifiers": {"com.heads.seedID": "store1"}},
    "buyer": {"identifiers": {"com.myapp.customerId": "CUST-001"}},
    "posTerminal": {"identifiers": {"posTerminalName": "Kassa 1"}},
    "items": [
      {
        "product": {"identifiers": {"com.myapp.sku": "SKU-001"}},
        "quantity": 1,
        "unitAmount": "159.20",
        "vatPercentage": "25"
      }
    ],
    "payments": [
      {
        "method": "com.heads.cash",
        "amount": "199.00",
        "consumerPrintout": "CASH PAYMENT\nAmount: 199.00 SEK",
        "merchantPrintout": "CASH PAYMENT\nAmount: 199.00 SEK\nKeep this receipt"
      }
    ]
  }'
```

### Relative Date Syntax (for receipts)

| Pattern | Meaning |
|---------|---------|
| `-=24` | 24 hours ago |
| `-=1` | 1 hour ago |
| `-=0:30` | 30 minutes ago |
| `-=168` | 1 week ago (168 hours) |

---

## Devices

```bash
# List all devices
curl -X GET -u ":banana" "localhost:5000/api/v1/devices"

# Get device by ID
curl -X GET -u ":banana" "localhost:5000/api/v1/devices/com.myapp.deviceId=DEV-001"

# Create a device
curl -X POST -u ":banana" "localhost:5000/api/v1/devices" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.deviceId": "DEV-001"},
    "name": "Store 1 Tablet",
    "status": "Active"
  }'

# Update device status
curl -X PATCH -u ":banana" "localhost:5000/api/v1/devices/com.myapp.deviceId=DEV-001" \
  -H "Content-Type: application/json" \
  -d '{"status": "Inactive"}'
```

> **Note:** Device roles (`/v1/device-roles`) and role assignments (`~with(roleAssignments)`) are not exposed through the API.

---

## Printers

```bash
# List all printers
curl -X GET -u ":banana" "localhost:5000/api/v1/printers"

# Get printer by ID
curl -X GET -u ":banana" "localhost:5000/api/v1/printers/com.heads.seedID=receipt-printer-1"

# Create Star WebPRNT printer
# Note: Use lowercase endpoint /v1/star-webprnt-printers
# Alternatively use /v1/printers with @type discriminator
curl -X POST -u ":banana" "localhost:5000/api/v1/star-webprnt-printers" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "star webPRNT printer",
    "identifiers": {"com.myapp.printerId": "STAR-001"},
    "name": "Receipt Printer 1",
    "url": "http://192.168.1.100:8080/StarWebPRNT/SendMessage",
    "associatedNode": {"identifiers": {"com.heads.seedID": "store1"}}
  }'

# Create Epson ePOS printer
# Note: Use lowercase endpoint /v1/epson-epos-printers
# Alternatively use /v1/printers with @type discriminator
curl -X POST -u ":banana" "localhost:5000/api/v1/epson-epos-printers" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "epson ePOS printer",
    "identifiers": {"com.myapp.printerId": "EPSON-001"},
    "name": "Kitchen Printer",
    "url": "http://192.168.1.101:8080",
    "deviceID": "local_printer",
    "associatedNode": {"identifiers": {"com.heads.seedID": "store1"}}
  }'

# Create serial printer
curl -X POST -u ":banana" "localhost:5000/api/v1/serial-printers" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "serial printer",
    "identifiers": {"com.myapp.printerId": "SERIAL-001"},
    "name": "Label Printer",
    "port": "COM1",
    "baudRate": 9600,
    "dataBits": 8,
    "stopBits": 1,
    "parity": "None"
  }'
```

---

## Payment Terminals

```bash
# List all payment terminals
curl -X GET -u ":banana" "localhost:5000/api/v1/payment-terminals"

# Get payment terminal by ID
curl -X GET -u ":banana" "localhost:5000/api/v1/payment-terminals/com.myapp.terminalId=TERM-001"

# Create a payment terminal
# Required: identifiers (with external ID)
# Optional: name, method, directUrl, connectedDevice
# Note: method and directUrl are in the schema but not strictly enforced on create.
#       There is NO `associatedNode` field on payment terminals.
curl -X POST -u ":banana" "localhost:5000/api/v1/payment-terminals" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.terminalId": "TERM-001"},
    "name": "Card Terminal 1"
  }'

# Create a payment terminal with method and directUrl
curl -X POST -u ":banana" "localhost:5000/api/v1/payment-terminals" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.terminalId": "TERM-002"},
    "name": "Card Terminal 2",
    "method": {"identifiers": {"methodId": "com.heads.card"}},
    "directUrl": "https://payment-gateway.example.com/terminals/TERM-002"
  }'

# Update a payment terminal
curl -X PATCH -u ":banana" "localhost:5000/api/v1/payment-terminals/com.myapp.terminalId=TERM-001" \
  -H "Content-Type: application/json" \
  -d '{"name": "Main Card Terminal"}'
```
