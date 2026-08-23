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

### The subtype vocabulary is per deployment

A POS function's `@type` names a subtype the deployment installed — `lock function`, `pay function`, `open drawer function` and so on. The three named in the comment above are examples, not the vocabulary: the set is whatever functions the POS application registered, so read it off the deployment rather than hard-coding it. Two places to read it:

- `GET /v1/pos-functions` — every function comes back carrying its own `@type`.
- The deployment's OpenAPI document, where the `POS function` schema carries an `x-child-types` array naming every subtype, and each subtype has a component schema of its own, showing any extra members it carries.

Every one of these names is lower case with its words separated by single spaces (`lock function`, `xref multi display function`), and the spelling is exact: `Lock Function` is a `400`. Copy the name from a response rather than reconstructing it.

```bash
# Names a subtype the deployment installed
POST /v1/pos-functions   {"@type": "lock function", "identifiers": {...}, "name": "Lock"}   # 200

# Names the base type
POST /v1/pos-functions   {"@type": "POS function",  "identifiers": {...}, "name": "Lock"}   # 400

# Names nothing
POST /v1/pos-functions   {"identifiers": {...}, "name": "Lock"}                             # 200
```

Omitting `@type` is not an error — it creates a plain `POS function`, which reads back as `"@type": "POS function"`. Writing that same name explicitly is the one spelling that is refused, because only a subtype can be named here.

> **The refusal is the best vocabulary listing there is.** Naming the base type answers a `400` whose `info` carries every subtype this deployment accepts:
>
> ```json
> {"@type": "bad request",
>  "error": "The request was invalid and could not be processed.",
>  "details": "Unknown POS function type: 'POS function'",
>  "info": {"availableTypes": ["lock function", "open drawer function", "..."]}}
> ```
>
> A name the deployment does not carry at all fails earlier and differently — `The provided type key 'no such function' is not defined in the current type schema`, with no list — so the two mistakes are distinguishable from the response alone.

You never have to name a subtype to *reference* an existing function: `{"identifiers": {"posFunctionId": "lock-pos"}}` resolves it wherever a function is expected, and the response names the subtype back to you even though the request did not. That is the portable spelling, since it does not depend on which functions a deployment installed.

The `/v1/pos-functions` collection itself is entirely alive — this is where the functions live, and a tile references one of them by identifier. It is only the `functions` member *on a profile* that is dead.

---

## POS Tile Sets

A profile's `tileSets` is what a terminal renders. A tile set is a grid holding tiles; a tile is one of three subtypes, chosen with `@type`:

| `@type` | What it does | Carries |
|---|---|---|
| `function tile` | Invokes a POS function when pressed | `function` |
| `product tile` | Adds a product, or opens a category | `productNode` |
| `POS tile set` | Opens a nested tile set (a sub-menu) | `rows`, `columns`, `tiles` |

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

> **The `@type` on a tile is load-bearing.** `tiles` holds the abstract `POS tile`, so the discriminator is what selects which subtype is being written — a tile sent without one carries neither `function` nor `productNode`. (`"@type": "POS tile set"` on the set itself is harmless to include and worth keeping for symmetry.) A tile's `function` needs no `@type` of its own: reference an existing function by `identifiers` alone and the response resolves it, subtype and all. Naming the subtype (`"@type": "lock function"`) works too — see [The subtype vocabulary is per deployment](#the-subtype-vocabulary-is-per-deployment) for which names a deployment accepts, and for the one that is refused. A wrong-but-plausible `@type` has a quieter failure mode elsewhere in the API, where the object is built as the target type and the members you sent on top of it are dropped — see [gotcha 47](../../reference/common-gotchas.md#47-a-declared-type-key-is-not-always-one-you-can-write).

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
          "@type": "POS tile set",
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

`columns` is set and `rows` is not, so this set auto-flows: tiles fill four to a row in `order`. The second tile is a nested `POS tile set` — a tile that opens a grid of its own rather than doing anything itself.

> **A nested set is `"@type": "POS tile set"`, the same spelling as the outer one.** There is no separate type for a nested set: the tile-set type is itself a `POS tile`, which is exactly what lets it sit in another set's `tiles`. Anything else there — a shortened `"tile set"`, an invented `"nesting tile"` — is a `400` saying the type key is not defined in the current type schema.

`order` is not part of a nested set's default representation the way it is on a function or product tile, so reading one back does not show it. It is stored — ask for it with `~with(order)`:

```bash
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/pos-profiles/posProfileId=kiosk/tileSets/tileId=drinks/tiles~with(order)"
```

### How the root tile sets are laid out

The tile sets directly on the profile are the top-level panels a terminal shows. Three members on the **profile** — not on the tile set — decide how they are presented:

| Member | Type | Meaning |
|---|---|---|
| `renderRootTilesetPanel` | boolean, default `false` | Render the root tile sets as one panel with pills, rather than as separate panels |
| `tilesetCategoryPillsVisibility` | `Visible` / `Hidden` (default `Hidden`) | Whether the category pills are shown |
| `nestedSiblingTilesetsVisibility` | `Visible` (default) / `Hidden` | Whether sibling panels stay visible while a nested set is open |

```bash
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/pos-profiles/posProfileId=kiosk" \
  -H "Content-Type: application/json" \
  -d '{ "renderRootTilesetPanel": true, "tilesetCategoryPillsVisibility": "Visible" }'
```

None of the three is in a profile's default representation, so a plain `GET` does not show them — name them to read them back:

```bash
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/pos-profiles/posProfileId=kiosk~just(renderRootTilesetPanel,tilesetCategoryPillsVisibility,nestedSiblingTilesetsVisibility)"
```

The two `Visibility` members read back as `null` until you set one, and `null` there means the default in the table above rather than "hidden". `renderRootTilesetPanel` is a plain boolean and reads back `false`.

A value a member does not accept is a `400`:

```
"tilesetCategoryPillsVisibility": "Nonsense"   400  details: Invalid value 'Nonsense' for enum 'Visibility'.
"renderRootTilesetPanel": "Nonsense"           400  details: Invalid data format. A value could not be
                                                    coerced to the expected target type.
```

Two different messages for one class of mistake, and which one you get depends on how the member is typed rather than on what you sent. A member the schema declares as a free string with its vocabulary written into the description — the two `Visibility` members here, and the profile's `mode` (`Invalid value 'Nonsense' for enum 'PosMode'.`) — is checked against the vocabulary and named after the *enum*, never after the values it would have accepted; read those off the table above. A member the schema declares as a fixed set of values, such as `product.status` or a device's `status`, never reaches that check: the platform's ordinary coercion refuses it first, with the second message.

There is no separate panel resource: a panel *is* a root tile set, so `/v1/pos-profiles/{key}/panels` is a `404`.

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
