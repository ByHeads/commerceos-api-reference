# Point of Sale (POS) Examples

Curl examples for POS terminals, profiles, tile sets, functions, receipts, devices, printers, and payment terminals.

**Base URL:** `https://example.app.heads.com/api/v1`
**API Key:** `banana` (passed via Basic Auth with empty username: `-u ":banana"`)

> **See also:** [Examples Index](../examples.md) | [Reference Documentation](../../reference/)

---

## POS Terminals

```bash
# List all POS terminals
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/pos-terminals"

# Get POS terminal by name
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/pos-terminals/posTerminalName=Kassa%201"

# Get terminal with profile
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/pos-terminals/posTerminalName=Kassa%201~with(profile)"

# Create a POS terminal
# Required: identifiers.posTerminalName, associatedNode
# Optional: profile, status, assignedDevice, receiptPrinter, etc.
# Note: POS terminals do NOT have a `name` field; use identifiers.posTerminalName
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/pos-terminals" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"posTerminalName": "Kassa 2"},
    "status": "Active",
    "profile": {"identifiers": {"posProfileId": "default"}},
    "associatedNode": {"identifiers": {"com.heads.seedID": "store1"}}
  }'

# Update POS terminal
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/pos-terminals/posTerminalName=Kassa%202" \
  -H "Content-Type: application/json" \
  -d '{"status": "Inactive"}'
```

---

## POS Profiles

```bash
# List all POS profiles
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/pos-profiles"

# Get POS profile by ID
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/pos-profiles/posProfileId=default"

# Get profile with its tile sets (the buttons the terminal shows)
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/pos-profiles/posProfileId=default~with(tileSets)"

# Create a POS profile
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/pos-profiles" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"posProfileId": "quick-service"},
    "name": "Quick Service Profile",
    "defaultCurrency": {"identifiers": {"currencyCode": "SEK"}}
  }'

# Update POS profile
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/pos-profiles/posProfileId=quick-service" \
  -H "Content-Type: application/json" \
  -d '{"name": "Fast Food Profile"}'
```

> **`functions` is inert — use `tileSets`.** The `functions` member is retained on `POS profile` for backwards compatibility only. It **always reads as an empty array**, whatever the profile is configured with, and a write to it is accepted and discarded: `POST`ing a profile with `functions`, or `PUT`ting the collection directly, returns `200` and stores nothing. There is no configuration under which it returns anything. What decides the buttons a terminal shows is [`tileSets`](#pos-tile-sets). (`DELETE .../functions` is the one request that says so, reporting `deletedCount: 0`.) See [gotcha 46](../../reference/common-gotchas.md#46-deprecated-does-not-tell-you-whether-a-member-still-works).

---

## POS Functions

```bash
# List all POS functions
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/pos-functions"

# Get POS function by ID
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/pos-functions/posFunctionId=open-drawer"

# Create a POS function
# Note: POS functions have NO `description` field
# Available fields: identifiers, name, iconKey, hotkey, order, color, visibleInPos, requiredPermissions
#
# Subtype-specific fields (require @type):
#   - "pay function" → paymentMethod
#   - "manual discount function" → phase
#   - "add product function" → product
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/pos-functions" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"posFunctionId": "void-sale"},
    "name": "Void Sale",
    "iconKey": "cancel",
    "order": 100,
    "visibleInPos": true
  }'

# Create a pay function with payment method
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/pos-functions" \
  -H "Content-Type: application/json" \
  -d '{
    "@type": "pay function",
    "identifiers": {"posFunctionId": "pay-card"},
    "name": "Card Payment",
    "paymentMethod": {"identifiers": {"methodId": "com.heads.card"}}
  }'
```

The `/v1/pos-functions` collection itself is entirely alive — this is where the functions live, and a tile references one of them by identifier. It is only the `functions` member *on a profile* that is dead.

---

## POS Tile Sets

A profile's `tileSets` is what a terminal renders. A tile set is a grid holding tiles; a tile is one of three subtypes, chosen with `@type`:

| `@type` | What it does | Carries |
|---|---|---|
| `function tile` | Invokes a POS function when pressed | `function` |
| `product tile` | Adds a product, or opens a category | `productNode` |
| `tile set` | Opens a nested tile set (a sub-menu) | `rows`, `columns`, `tiles` |

Every tile also takes `name`, `icon`, `imageUrl`, `color`, `hotkey`, `visibility` (`Visible` / `Hidden`), `requiredPermission` (only users holding that permission see the tile), and `inputMask` (a scanner pattern that triggers it). Placement is either explicit — `row` and `column`, both 1-indexed, with optional `rowSpan` / `columnSpan` — or automatic: leave the tile set's `rows` and `columns` unset and tiles flow in `order`.

### Create a profile with a tile set

```bash
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/pos-profiles" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "posProfileId": "standard" },
    "name": "Standard Checkout",
    "tileSets": [{
      "@type": "POS tile set",
      "identifiers": { "tileId": "main" },
      "name": "Main",
      "rows": 2,
      "columns": 5,
      "tiles": [{
        "@type": "function tile",
        "identifiers": { "tileId": "tile-pay-card" },
        "name": "Card Payment",
        "icon": "CreditCard",
        "hotkey": "F12",
        "order": 1,
        "color": "green",
        "visibility": "Visible",
        "function": { "identifiers": { "posFunctionId": "pay-card" } }
      }]
    }]
  }'
```

> **The `@type` on a tile is load-bearing.** `tiles` holds the abstract `POS tile`, so the discriminator is what selects which subtype is being written — a tile sent without one carries neither `function` nor `productNode`. (`"@type": "POS tile set"` on the set itself is harmless to include and worth keeping for symmetry.) Note also that `POS function` is the only spelling for a function: there is no `lock function` or similarly named subtype, and sending one is rejected with a 400 saying the type key is not defined in the current type schema. Reference an existing function by `identifiers` alone.

### Read the tile sets back

```bash
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/pos-profiles/posProfileId=standard/tileSets"
```

The nested `function` on each function tile is resolved in the response, so one request gives you the whole button layout.

### A product tile and a nested set

```bash
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/pos-profiles" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": { "posProfileId": "kiosk" },
    "name": "Kiosk",
    "tileSets": [{
      "@type": "POS tile set",
      "identifiers": { "tileId": "drinks" },
      "name": "Drinks",
      "columns": 4,
      "tiles": [
        {
          "@type": "product tile",
          "identifiers": { "tileId": "tile-cola" },
          "name": "Cola",
          "order": 1,
          "productNode": { "identifiers": { "com.example.sku": "COLA-33CL" } }
        },
        {
          "@type": "tile set",
          "identifiers": { "tileId": "tile-hot-drinks" },
          "name": "Hot Drinks",
          "order": 2,
          "rows": 2,
          "columns": 3,
          "tiles": []
        }
      ]
    }]
  }'
```

`columns` is set and `rows` is not, so this set auto-flows: tiles fill four to a row in `order`. The second tile is a `tile set` — a tile that opens a nested grid rather than doing anything itself.

---

## Receipts

```bash
# List all receipts
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/receipts"

# Get receipt by ID
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/receipts/receiptID=RCP-2024-00001"

# Get receipt with items
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/receipts/receiptID=RCP-2024-00001~with(items)"

# Get receipt items
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/receipts/receiptID=RCP-2024-00001/items"

# Get specific receipt item
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/receipts/receiptID=RCP-2024-00001/items/0"

# Get receipt payments
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/receipts/receiptID=RCP-2024-00001/payments"

# Get receipt items with both VAT-explicit unit prices (non-essential, so ~with is required).
# unitAmountExclVat equals the default unitAmount; unitAmountInclVat is the gross unit price.
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/receipts/receiptID=RCP-2024-00001/items~with(unitAmountExclVat,unitAmountInclVat)"

# Same, expanded from the receipt in one request
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/receipts/receiptID=RCP-2024-00001~with(items~with(unitAmountExclVat,unitAmountInclVat))"

# Project just the columns an export needs
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/receipts/receiptID=RCP-2024-00001/items~just(description,quantity,unitAmountExclVat,unitAmountInclVat,vatPercentage)"

# Get the NET unit price incl. VAT (totalAmount / quantity) — what was actually charged per unit,
# where unitAmountInclVat is the pre-discount list price. Non-essential, so ~with is required.
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/receipts/receiptID=RCP-2024-00001/items~with(unitAmountAfterDiscountInclVat)"

# List price and net price side by side, for every line on the receipt
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/receipts/receiptID=RCP-2024-00001~with(items~with(unitAmountInclVat,unitAmountAfterDiscountInclVat))"

# Credit one unit of a discounted line: multiply this by the unit count.
# It is a positive magnitude even on return lines — apply the credit sign yourself.
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/receipts/receiptID=RCP-2024-00001/items~first~just(description,quantity,unitAmountAfterDiscountInclVat,totalAmount)"

# Get receipt items with the owning receipt inlined (non-essential, so ~with is required)
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/receipts/receiptID=RCP-2024-00001/items~with(receipt)"

# From a return line, find the SALE receipt that owns the matched line.
# The `receipt` on a related item names the receipt owning THAT line,
# not the return receipt you started from.
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/receipts/receiptID=RCP-2024-00001/items~first/related~where(type=Sale,unitAmount!=0)~first/receipt/identifiers/receiptID"

# Same pick, the matched line's own key — consistent with the receipt id above
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/receipts/receiptID=RCP-2024-00001/items~first/related~where(type=Sale,unitAmount!=0)~first/identifiers/key"

# Get receipt items with the order lines they settle inlined (non-essential, so ~with is required).
# Empty for ordinary walk-in lines; populated for click-and-collect, pickup and special orders.
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/receipts/receiptID=RCP-2024-00001/items~with(orderItems)"

# The order line behind a single receipt line
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/receipts/receiptID=RCP-2024-00001/items~first/orderItems~first/identifiers/key"

# Receipt-level counterpart: every trade order this receipt touches (no per-line attribution)
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/receipts/receiptID=RCP-2024-00001~with(orders)"

# Receipts from last 24 hours
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/receipts/after/-=24"

# Receipts from last 30 minutes
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/receipts/after/-=0:30"

# Receipts from last week with item count
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/receipts/after/-=168~with(items/count)"

# Receipts in date range (use ~where for timestamp filtering)
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/receipts~where(timestamp>2024-12-01T00:00:00Z,timestamp<2024-12-31T23:59:59Z)"

# Alternatively, chain ~where operators
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/receipts~where(timestamp>2024-12-01T00:00:00Z)~where(timestamp<2024-12-31T23:59:59Z)"

# Map receipts to custom format
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/receipts/after/-=24~map(com.heads.receipt-csv)"

# Create/import a receipt (typically done by POS system)
# Required fields: identifiers.receiptID, prefix, ordinal, seller, buyer, posTerminal, currencyCode, timestamp, items, payments
# Payment fields: method, amount, consumerPrintout, merchantPrintout (required on create)
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/receipts" \
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

The same `/before/` and `/after/` pattern works for **nine other collections** beyond receipts (trade orders, payment orders, stock adjustments, z-reports, etc.). See [Operators → Time-relative queries](../../reference/operators.md#time-relative-queries-before-and-after) for the full list and the optional `(create)`/`(modify)` qualifier.

---

## Z Reports — Time-relative queries

Z-reports are point-in-time POS audit events emitted at end-of-day (or end-of-shift). The `/before/` and `/after/` endpoints are the standard way to export them on a daily schedule.

```bash
# Default mode: z-reports issued at or after the given ISO timestamp
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/z-reports/after/2025-02-01T00:00:00.000Z~take(100)"

# Z-reports issued before a cutoff (exclusive end), newest first
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/z-reports/before/2025-03-01T00:00:00.000Z~take(100)"
```

> **Default:** `create` — and it is the **only** supported mode. Z-reports are immutable audit events with no separate "last modified" time, so `(modify)` returns a 404. The default is what you want for daily exports. See [Operators → Time-relative queries](../../reference/operators.md#time-relative-queries-before-and-after).
>
> **Recommended:** use `/after/` and `/before/` for any time-windowed read of z-reports — they are index-backed and the canonical pattern. Use `~where(timestamp...)` only when you need to combine the time filter with a non-time predicate.

---

## Devices

```bash
# List all devices
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/devices"

# Get device by ID
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/devices/com.myapp.deviceId=DEV-001"

# Create a device
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/devices" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.deviceId": "DEV-001"},
    "name": "Store 1 Tablet",
    "status": "Active"
  }'

# Update device status
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/devices/com.myapp.deviceId=DEV-001" \
  -H "Content-Type: application/json" \
  -d '{"status": "Inactive"}'
```

> **Note:** Device roles (`/v1/device-roles`) and a device's role assignments (`~with(roleAssignments)` on a device) are not exposed through the API. This is about **devices** only — *user* role assignments are available, at `/v1/users/{id}/roleAssignments`; see [Roles, Permissions and Assignments](../../reference/user-roles.md).

---

## Printers

```bash
# List all printers
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/printers"

# Get printer by ID
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/printers/com.heads.seedID=receipt-printer-1"

# Create Star WebPRNT printer
# Note: Use lowercase endpoint /v1/star-webprnt-printers
# Alternatively use /v1/printers with @type discriminator
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/star-webprnt-printers" \
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
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/epson-epos-printers" \
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
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/serial-printers" \
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
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/payment-terminals"

# Get payment terminal by ID
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/payment-terminals/com.myapp.terminalId=TERM-001"

# Create a payment terminal
# Required: identifiers (with external ID)
# Optional: name, method, directUrl, connectedDevice
# Note: method and directUrl are in the schema but not strictly enforced on create.
#       There is NO `associatedNode` field on payment terminals.
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/payment-terminals" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.terminalId": "TERM-001"},
    "name": "Card Terminal 1"
  }'

# Create a payment terminal with method and directUrl
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/payment-terminals" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.terminalId": "TERM-002"},
    "name": "Card Terminal 2",
    "method": {"identifiers": {"methodId": "com.heads.card"}},
    "directUrl": "https://payment-gateway.example.com/terminals/TERM-002"
  }'

# Update a payment terminal
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/payment-terminals/com.myapp.terminalId=TERM-001" \
  -H "Content-Type: application/json" \
  -d '{"name": "Main Card Terminal"}'
```
