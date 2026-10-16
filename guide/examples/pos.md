# Point of Sale (POS) Examples

Curl examples for POS terminals, carts, sessions, supervisor control, profiles, tile sets, functions, slips, receipts, devices, printers, and payment terminals.

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

# The plain-paper (A4/Letter) printer and its template, beside receiptPrinter / receiptTemplate,
# and the customer display's screen and scale
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/pos-terminals/posTerminalName=Kassa%202" \
  -H "Content-Type: application/json" \
  -d '{
    "documentPrinter": {"identifiers": {"com.myapp.printerId": "OFFICE-A4"}},
    "documentTemplate": {"identifiers": {"templateId": "a4-receipt"}},
    "secondaryScreenIndex": 2,
    "customerDisplayScale": 120
  }'

# None of the printer, template, display or sequence members is in the default body
# (a plain GET is identifiers, status, profile and associatedNode) - name them
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/pos-terminals/posTerminalName=Kassa%202~just(receiptPrinter,receiptTemplate,documentPrinter,documentTemplate,secondaryScreenIndex,customerDisplayScale,receiptSequence,receiptCopySequence)"
```

| Member | Type | Meaning |
|---|---|---|
| `documentPrinter` | printer | The plain-paper (A4/Letter) printer. Empty means everything prints on `receiptPrinter`. |
| `documentTemplate` | template | The template for receipts printed on the `documentPrinter`. Empty means `receiptTemplate`. |
| `secondaryScreenIndex` | number | The screen index of the customer display (secondary screen). Empty means 1. |
| `customerDisplayScale` | number | Scale factor of the customer display in percent (0–200), sizing its text, logo and other elements. Empty means 100. |
| `receiptCopySequence` | serial, read-only | The sequence number for receipt copies printed by the POS terminal; copies carry a sequence of their own. `null` on a new terminal until the till prints its first copy; from then on its own serial, with the prefix `COPY_` in front of the receipt prefix. |

A `pos:read` key reads every one of these, printers and templates included, exactly as a `pos:write` key does. A terminal's `receiptSequence` and `receiptCopySequence` are serials, whose root lies outside the `pos:*` scopes: a key holding only `pos:read` or `pos:write` reads both as `null`, which is indistinguishable from a terminal that has none — the admin key, or a key that also holds the scope serving serials, sees them.

---

## POS Carts, Sessions and Supervisor Control

Everything hangs off the terminal. The API adds, changes and removes lines and parks, resumes and discards carts; it never starts or completes a sale. Full contract: [Working with POS Carts](../../reference/working-with/pos-carts.md).

```bash
# What the till is doing: mode, status, locks, age control, its cart and parked carts
curl -u ":banana" "https://example.app.heads.com/api/v1/pos-terminals/posTerminalName=Kassa%201/session"

# The active cart (null when there is none); with its lines, validation and draft order
curl -u ":banana" "https://example.app.heads.com/api/v1/pos-terminals/posTerminalName=Kassa%201/cart"
curl -u ":banana" "https://example.app.heads.com/api/v1/pos-terminals/posTerminalName=Kassa%201/cart?fields=all"

# Add a line - opens the cart when there is none. The answer is the line the units landed on:
# the same product merges into the last line unless that line has a manual price, discount or note.
# The key needs products:read beside pos.carts:write.
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/pos-terminals/posTerminalName=Kassa%201/cart/items" \
  -H "Content-Type: application/json" \
  -d '{"@type": "POS trade item", "product": {"identifiers": {"com.example.sku": "WIDGET-001"}}, "quantity": 2}'

# A line at a manual price (409 if these units would merge into the last line - give that line a note first)
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/pos-terminals/posTerminalName=Kassa%201/cart/items" \
  -H "Content-Type: application/json" \
  -d '{"@type": "POS trade item", "product": {"identifiers": {"com.example.sku": "WIDGET-001"}}, "quantity": 1, "unitAmountInclVat": "149.00"}'

# Change a line: quantity, manual price (null clears), manual discount (null clears), note
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/pos-terminals/posTerminalName=Kassa%201/cart/items/<line key>" \
  -H "Content-Type: application/json" -d '{"quantity": 4}'
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/pos-terminals/posTerminalName=Kassa%201/cart/items/<line key>" \
  -H "Content-Type: application/json" -d '{"unitAmountInclVat": "80.00"}'
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/pos-terminals/posTerminalName=Kassa%201/cart/items/<line key>" \
  -H "Content-Type: application/json" \
  -d '{"manualDiscount": {"@type": "percentage manual discount", "percentage": "10", "reason": {"identifiers": {"com.example.reasonId": "STAFF"}}, "notes": "staff"}}'
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/pos-terminals/posTerminalName=Kassa%201/cart/items/<line key>" \
  -H "Content-Type: application/json" -d '{"manualNotes": "gift wrap"}'

# Remove a line (removing the last one closes the cart)
curl -X DELETE -u ":banana" "https://example.app.heads.com/api/v1/pos-terminals/posTerminalName=Kassa%201/cart/items/<line key>"

# The customer (null detaches) and the receipt note (null clears)
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/pos-terminals/posTerminalName=Kassa%201/cart" \
  -H "Content-Type: application/json" -d '{"customer": {"identifiers": {"com.example.customerId": "CUST-001"}}}'
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/pos-terminals/posTerminalName=Kassa%201/cart" \
  -H "Content-Type: application/json" -d '{"manualNotes": "Called ahead, picks up at 17:00"}'

# Park (This terminal | This store | Everywhere; true keeps the cart's visibility), list, resume elsewhere, discard
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/pos-terminals/posTerminalName=Kassa%201/session/actions" \
  -H "Content-Type: application/json" -d '{"parkCart": "This store"}'
curl -u ":banana" "https://example.app.heads.com/api/v1/pos-terminals/posTerminalName=Kassa%201/parkedCarts"
curl -u ":banana" "https://example.app.heads.com/api/v1/pos-terminals/posTerminalName=Kassa%202/resumableCarts"
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/pos-terminals/posTerminalName=Kassa%202/session/actions" \
  -H "Content-Type: application/json" -d '{"resumeCart": {"identifiers": {"key": "<cart key>"}}}'
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/pos-terminals/posTerminalName=Kassa%202/session/actions" \
  -H "Content-Type: application/json" -d '{"discardCart": true}'

# Supervisor control of a self-checkout lane (pos.supervisor:write)
curl -u ":banana" "https://example.app.heads.com/api/v1/pos-terminals/posTerminalName=SCO-01/supervisor"
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/pos-terminals/posTerminalName=SCO-01/supervisor/actions" \
  -H "Content-Type: application/json" -d '{"lock": "spot-check"}'
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/pos-terminals/posTerminalName=SCO-01/supervisor/actions" \
  -H "Content-Type: application/json" -d '{"unlock": true}'
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/pos-terminals/posTerminalName=SCO-01/supervisor/actions" \
  -H "Content-Type: application/json" -d '{"confirmAgeRestriction": true}'
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/pos-terminals/posTerminalName=SCO-01/supervisor/actions" \
  -H "Content-Type: application/json" -d '{"resetSession": true}'
```

> **Note:** The `actions` answers are empty (`{"@type": "POS session actions"}`); read the session or the cart to see what happened. A key that lacks the scope gets `200 null`, not a `403`.

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

# Everything beyond name is outside the default body (a plain GET is identifiers and name):
# name the settings you want, or ~withAll
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/pos-profiles/posProfileId=quick-service~just(showProductFamiliesAs,productFamilyInteraction,cartItemCountVisibility,separateOrderCheckout)"
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/pos-profiles/posProfileId=quick-service~withAll"

# How a product family opens, whether the cart counts its articles, and orders checked out on their own
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/pos-profiles/posProfileId=quick-service" \
  -H "Content-Type: application/json" \
  -d '{"showProductFamiliesAs": "Show as category", "productFamilyInteraction": "Matrix", "cartItemCountVisibility": "Visible", "separateOrderCheckout": true}'

# Per-language titles of the five search categories on the till (a locale left empty shows the shipped text)
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/pos-profiles/posProfileId=quick-service" \
  -H "Content-Type: application/json" \
  -d '{"productSearchTitle": {"en-US": "Articles", "sv-SE": "Artiklar"}, "receiptSearchTitle": {"en-US": "Receipts", "sv-SE": "Kvitton"}}'

# The self-checkout's "before you go" step: the products it offers (empty disables the step),
# its heading and sub-heading, the per-product ceiling and when it is shown
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/pos-profiles/posProfileId=quick-service" \
  -H "Content-Type: application/json" \
  -d '{
    "scoUpsellProducts": [{"identifiers": {"com.example.sku": "BAG-L"}}],
    "scoUpsellTitle": {"en-US": "Before you go"},
    "scoUpsellSubtitle": {"en-US": "Would you like to add a bag?"},
    "scoUpsellMaxQuantity": 5,
    "scoUpsellPlacement": "After start"
  }'

# scoUpsellProducts is a collection of product references: list it, replace it, remove one product
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/pos-profiles/posProfileId=quick-service/scoUpsellProducts"
curl -X PUT -u ":banana" "https://example.app.heads.com/api/v1/pos-profiles/posProfileId=quick-service/scoUpsellProducts" \
  -H "Content-Type: application/json" \
  -d '[{"identifiers": {"com.example.sku": "BAG-L"}}, {"identifiers": {"com.example.sku": "BAG-S"}}]'
curl -X DELETE -u ":banana" "https://example.app.heads.com/api/v1/pos-profiles/posProfileId=quick-service/scoUpsellProducts/com.example.sku=BAG-S"
```

### The profile's settings

A profile holds well over a hundred settings; the ones below are the ones a back-office editor shows under the profile's main topic, product families, cart, search and self-checkout. None of them is essential, so a plain `GET` shows none of them: ask with `~with(...)`, `~just(...)` or `~withAll`. A `string` member whose description names its values accepts those values and nothing else: any other value is a `400` naming the vocabulary — see [A Refused Value Names the Values It Would Have Accepted](#a-refused-value-names-the-values-it-would-have-accepted).

| Member | Type | Meaning |
|---|---|---|
| `showProductFamiliesAs` | string | How to show product families in the POS: `Show as category` (opens as a sub-tile) or `Show all items` (renders items inline). |
| `productFamilyInteraction` | string | How a product family opens on the till when `showProductFamiliesAs` is `Show as category`: `Cards` (a flat list of variant cards), `Stepwise` (one variant dimension at a time; the default when unset) or `Matrix` (every dimension at once, confirm to add). |
| `cartItemCountVisibility` | string | Whether the cart shows a line with the total number of articles: `Visible` or `Hidden` (default). |
| `separateOrderCheckout` | boolean | Whether a customer order is checked out on its own in the POS: a cart that puts lines on an order (Add to order) cannot sell or return other lines in the same checkout, so the order and the sale never share a receipt. Pay is refused until the cashier puts the remaining lines on the order or removes them. Default `false`. |
| `productSearchTitle`, `customerSearchTitle`, `customerOrderSearchTitle`, `pickingOrderSearchTitle`, `receiptSearchTitle` | localized text | Title of the product / customer / customer-order / put-aside (picking order) / receipt search category on the till; a locale left empty shows the shipped text. |
| `scoStartScreen` | string | How a self-checkout lane opens: `Button` (the default), `Scan` (on the first item scanned), `Payment method` (the customer first presses card or one of `scoStartPaymentMethods`) or `Tap card` (the payment terminal waits for a card on the idle screen; the other methods are buttons). With either payment-first screen nothing goes in the cart until a method is chosen. |
| `scoReceiptMode` | string | How the self-checkout hands over the receipt once a sale completes: `Print` (the paper receipt prints, the default) or `QR first` (the lane shows a QR code for the digital receipt and lets the customer print it or take none). |
| `receiptOptions` | string[] | The receipt options the cashier may choose between when the receipt options modal is shown: any of `Paper`, `Email`, `SMS` and `No receipt`. Empty offers all of them. An option that cannot be used for the sale at hand, such as email or SMS on a return, is left out regardless. |
| `scoUpsellProducts` | product references | Products offered on the self-checkout's "before you go" step (typically carrier bags). Empty disables the step. A sub-collection: `GET` and `PUT` on `.../scoUpsellProducts`, `DELETE .../scoUpsellProducts/{product key}`. |
| `scoUpsellTitle`, `scoUpsellSubtitle` | localized text | Heading and sub-heading of the "before you go" step; the shipped text when empty. |
| `scoUpsellMaxQuantity` | number | Per-product ceiling of the step's quantity steppers. Empty means 10. |
| `scoUpsellPlacement` | string | When the step is offered: `After payment` (the first Pay press, the default when unset) or `After start` (right after Start; a customer who begins by scanning is offered once, at payment). Offered at most once per session. |

**`separateOrderCheckout` and the documents a checkout produces.** With the flag on, a basket that puts lines on an order is an order and nothing else: the till never writes a sale receipt and an order out of one checkout, so a receipt feed and an order feed never have to split a mixed basket between them. The receipts that *do* come out of one checkout share a `checkoutId` and list each other as `checkoutSiblings` — see [Receipts of One Checkout](../../reference/receipts.md#receipts-of-one-checkout-checkoutid-and-checkoutsiblings). The order itself is an ordinary trade order; see [Orders Placed at the Till](../../reference/working-with/orders.md#orders-placed-at-the-till-collect-in-store-and-ship-to-customer).

**A `pos:read` key reads every profile setting a `pos:write` key reads** — `~withAll` under either names the same members. The exception is a relation whose root lies outside the `pos:*` scopes: `defaultCurrency`, `rootCategory` and `scoUpsellProducts` are served from the currency, category and product collections, so a key holding only `pos:read` reads them empty; give it the matching read scope (`products:read` for `scoUpsellProducts`) beside `pos:read`.

**A member that reads `null` under `~just()` has not necessarily been stored.** `~just(member)` answers `{"@type": "POS profile", "member": null}` for a member the type does not declare, exactly as it does for one that is declared and unset, and a write naming an undeclared member is a `200` that stores nothing. Two profile settings a back-office editor shows are deliberately not on the API: `benchTiles`, the tile editor's pool of unassigned tiles (a bench tile is never rendered), and a device permission as a tile's `requiredPermission` (the API takes user permissions only). The check that tells the two `null`s apart is `~withAll`: a declared member is a key in that body, an undeclared one is not. See [gotcha 46](../../reference/common-gotchas.md#46-deprecated-does-not-tell-you-whether-a-member-still-works).

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
# Available fields: identifiers, name, requiredPermissions
#   - a function carries behaviour; its presentation lives on the tile that invokes it
#
# Subtype-specific fields (require @type):
#   - "pay function" → paymentMethod
#   - "manual discount function" → phase, reason
#   - "add product function" → product
#   - "park function" / "get parked function" → cartVisibility
#   - "manual return function" → returnReason
#   - "order function" → defaultLabels, pickableLabels, allowAllApplicableLabels,
#       shipToCustomerStores, collectInStoreStores, shipToCustomerCurrentStore, collectInStoreCurrentStore
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/pos-functions" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"posFunctionId": "void-sale"},
    "name": "Void Sale"
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

### A function carries behaviour, not presentation

A function read back carries three members and no more — `identifiers`, `name` and `requiredPermissions` — and `~withAll` adds nothing to that:

```bash
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/pos-functions/posFunctionId=void-sale~withAll"
```

```json
{"@type": "POS function",
 "identifiers": {"@type": "POS function identifiers", "key": "e890a9af…", "posFunctionId": "void-sale"},
 "name": "Void Sale",
 "requiredPermissions": []}
```

**How the button looks is decided by the tile that invokes it, not by the function.** A function is the behaviour; a [function tile](#pos-tile-sets) is where it appears on the grid and what it looks like there. So every presentation member is a member of the tile:

| On the tile | What it does |
|---|---|
| `icon` | The icon shown on the button |
| `color` | The button colour |
| `hotkey` | The keyboard shortcut that triggers it |
| `order` | Position when the tile set auto-flows |
| `visibility` | `Visible` or `Hidden` |

Note `icon`, not `iconKey` — the tile has its own names. So the function above is given its appearance by the tile that references it:

```bash
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/pos-profiles" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"posProfileId": "till"},
    "name": "Till",
    "tileSets": [{
      "@type": "POS tile set",
      "identifiers": {"tileId": "actions"},
      "name": "Actions",
      "columns": 4,
      "tiles": [{
        "@type": "function tile",
        "identifiers": {"tileId": "tile-void-sale"},
        "name": "Void Sale",
        "icon": "cancel",
        "color": "red",
        "hotkey": "F9",
        "order": 100,
        "visibility": "Visible",
        "function": {"identifiers": {"posFunctionId": "void-sale"}}
      }]
    }]
  }'
```

All five come back on the tile, and the nested `function` is resolved alongside them, so one read gives you both halves of the button.

**A presentation member sent to the function is dropped in silence.** `iconKey`, `hotkey`, `order`, `color`, `visibility` and `visibleInPos` are not members of `POS function`, so a `POST` or `PATCH` naming them is a `200` that stores nothing — the ordinary [unrecognised-member](../../reference/common-gotchas.md#39-a-null-in-a-response-does-not-prove-the-field-exists) behaviour. Addressing one directly says so:

```bash
GET /v1/pos-functions/posFunctionId=void-sale/iconKey    # 404
PUT /v1/pos-functions/posFunctionId=void-sale/order  7   # 404
GET /v1/pos-functions/posFunctionId=void-sale/name       # 200  "Void Sale"
```

> **A `404` on a leaf means "no such member"; a `200 null` does not.** The four members a subtype narrows — `cartVisibility`, `reason`, `returnReason` and `paymentMethod` — are declared on every function and carried by one subtype each, so on a function that is not that subtype they answer `200 null` rather than `404`. Reading `null` there tells you this function does not carry the member; reading `404` tells you nothing does. (`DELETE` distinguishes neither — it never answers `404`, so it is not a probe; see [What a `DELETE` reports](../../reference/overview.md#what-a-delete-reports).)

### The order function: collect in store and ship to customer

The "Add to order" tile invokes a function of subtype `order function`. It is what lets a cashier turn cart lines into a customer order — collected in a store or shipped to the customer, paid now or later — and its members decide which stores the cashier may order from and which labels the order gets. What the resulting order looks like through the API is in [Working with Orders → Orders Placed at the Till](../../reference/working-with/orders.md#orders-placed-at-the-till-collect-in-store-and-ship-to-customer).

```bash
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/pos-functions/posFunctionId=order-default?fields=all"
```

```json
{ "@type": "order function",
  "identifiers": { "key": "26f71cddd749734de579a3ff7809f0e1", "posFunctionId": "order-default" },
  "requiredPermissions": [],
  "defaultLabels": [], "pickableLabels": [], "allowAllApplicableLabels": false,
  "shipToCustomerStores": [], "collectInStoreStores": [],
  "shipToCustomerCurrentStore": false, "collectInStoreCurrentStore": false }
```

| Member | What it does |
|---|---|
| `shipToCustomerStores`, `collectInStoreStores` | The stores the cashier may order from under that delivery mode. Empty = every store in the till's company, with the till's own store preselected. One store listed = preselected outright |
| `shipToCustomerCurrentStore`, `collectInStoreCurrentStore` | `true` admits the till's own store beside the listed ones; with nothing listed it is then the only choice. This is how a chain confines pickups to the ordering store while shipping from a central warehouse |
| `defaultLabels` | Applied to every order the tile creates — where an e-commerce integration that syncs only labelled orders gets its label |
| `pickableLabels` | Offered to the cashier to pick from |
| `allowAllApplicableLabels` | Offers every label applicable to trade orders instead of only `pickableLabels` |

The tile can also be locked to one delivery mode or one payment mode; those two settings are **not** exposed through the API.

```bash
# Add stores - a plain array ADDS to the list, it does not replace it
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/pos-functions/posFunctionId=order-default" \
  -H "Content-Type: application/json" \
  -d '{
    "collectInStoreStores": [{"identifiers": {"com.heads.seedID": "store-gothenburg"}}],
    "shipToCustomerStores": [{"identifiers": {"com.heads.seedID": "store-gothenburg"}}],
    "collectInStoreCurrentStore": true
  }'

# Remove a store - an empty array is a no-op (200, list unchanged); use remove
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/pos-functions/posFunctionId=order-default" \
  -H "Content-Type: application/json" \
  -d '{"collectInStoreStores": {"remove": [{"identifiers": {"com.heads.seedID": "store-gothenburg"}}]}}'
```

With `collectInStoreStores` = one other store and `collectInStoreCurrentStore: true`, the store picker on a till offers exactly that store and the till's own, the till's own preselected.

### The subtype vocabulary is per deployment

A POS function's `@type` names a subtype the deployment installed — `lock function`, `pay function`, `open drawer function` and so on. The ones named in the comment above are examples, and so are the extra members listed beside them — neither is a fixed list. The set is whatever functions the POS application registered, so read it off the deployment rather than hard-coding it. Two places to read it:

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
| `product tile` | Adds a product, or opens a category | `productNode`, `defaultDisplayMode` |
| `POS tile set` | Opens a nested tile set (a sub-menu) | `layout`, `rows`, `columns`, `renderAllEmptyCells`, `tiles` |

Every tile also takes `name`, `icon`, `imageUrl`, `color`, `hotkey`, `visibility` (`Visible` / `Hidden`), `requiredPermission` (only users holding that permission see the tile), and `inputMask` (a scanner pattern that triggers it). On a `function tile` those are the whole appearance of the button — the function it invokes carries none of them; see [A function carries behaviour, not presentation](#a-function-carries-behaviour-not-presentation). Placement is decided by the set's `layout`. In `Grid`, only tiles with an explicit `row` and `column` (both 1-indexed, with optional `rowSpan` / `columnSpan`) render, each at its cell inside the set's `rows` × `columns`. In `List` — the default when `layout` is unset — every tile renders in `order`, flowing across the panel and wrapping; `row`, `column`, `rowSpan`, `columnSpan`, `rows` and `columns` are stored and read back, and ignored. See [Layout, empty cells and a product tile's view](#layout-empty-cells-and-a-product-tiles-view).

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
      "layout": "Grid",
      "rows": 2,
      "columns": 5,
      "tiles": [{
        "@type": "function tile",
        "identifiers": { "tileId": "tile-pay-card" },
        "name": "Card Payment",
        "icon": "CreditCard",
        "hotkey": "F12",
        "row": 1,
        "column": 5,
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

This set has no `layout`, so it is a `List`: its tiles render in `order`, flowing across the panel and wrapping, and the `columns` it carries is stored and ignored until its `layout` is `Grid`. The second tile is a nested `POS tile set` — a tile that opens a panel of its own rather than doing anything itself.

> **A nested set is `"@type": "POS tile set"`, the same spelling as the outer one.** There is no separate type for a nested set: the tile-set type is itself a `POS tile`, which is exactly what lets it sit in another set's `tiles`. Anything else there — a shortened `"tile set"`, an invented `"nesting tile"` — is a `400` saying the type key is not defined in the current type schema.

`order` is not part of a nested set's default representation the way it is on a function or product tile, so reading one back does not show it. It is stored — ask for it with `~with(order)`:

```bash
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/pos-profiles/posProfileId=kiosk/tileSets/tileId=drinks/tiles~with(order)"
```

### Layout, empty cells and a product tile's view

| Member | On | Type | Meaning |
|---|---|---|---|
| `layout` | `POS tile set` | string | How the set renders: `List` (every tile in `order`, flowing across the panel and wrapping; the default when unset) or `Grid` (only tiles with an explicit `row` and `column` render, at that cell). `row`/`column`/`rowSpan`/`columnSpan` and `rows`/`columns` take effect in `Grid` only. |
| `renderAllEmptyCells` | `POS tile set` | boolean, nullable | In `Grid`, whether empty cells are drawn for every configured row (`true`) or only up to the last tile (`false`). `null`, the default: a manned till pads, a self-checkout does not. An explicit `null` puts that default back. |
| `defaultDisplayMode` | `product tile` | string | The view a tile that opens a category, family or group shows its products in: `Grid` or `List`. Unset keeps the till's current view. Ignored on a tile that adds a single product. |

```bash
# Switch a set to a grid; put it back to a list; hand the empty-cell decision back to the per-mode default
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/pos-tile-sets/tileId=main" \
  -H "Content-Type: application/json" -d '{"layout": "Grid", "renderAllEmptyCells": false}'
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/pos-tile-sets/tileId=main" \
  -H "Content-Type: application/json" -d '{"layout": "List"}'
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/pos-tile-sets/tileId=main" \
  -H "Content-Type: application/json" -d '{"renderAllEmptyCells": null}'

# The view a category tile opens in
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/pos-product-tiles/tileId=tile-drinks" \
  -H "Content-Type: application/json" -d '{"defaultDisplayMode": "List"}'

# layout and renderAllEmptyCells are not in a tile set's default body (that is identifiers, name, rows, columns, tiles) - name them
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/pos-tile-sets/tileId=main~just(layout,renderAllEmptyCells,rows,columns)"
```

The three are on the standalone collections `/v1/pos-tile-sets`, `/v1/pos-product-tiles` and `/v1/pos-function-tiles` as well as on a profile's nested `tileSets`, and a `pos:read` key reads them. `defaultDisplayMode` is declared on every tile "only applicable to product tiles": a function tile takes it without a `400`, and it does nothing there — a `POST` drops it (the tile reads back `null`), a `PATCH` stores it, and the till reads it on product tiles only. A value outside the vocabulary is a `400` that names it: `Invalid value 'Nonsense' for enum 'PosTileSetLayout'. Expected 'Grid' or 'List'.` on a tile set, `… for enum 'ProductDisplayMode'. Expected 'Grid' or 'List'.` on a product tile.

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

### A Refused Value Names the Values It Would Have Accepted

A value a member does not accept is a `400`, and the refusal is a vocabulary listing — so a member whose values you do not know can be discovered with one deliberately wrong request:

```
"tilesetCategoryPillsVisibility": "Nonsense"
400  details: Invalid value 'Nonsense' for enum 'Visibility'. Expected 'Hidden' or 'Visible'.
```

That matters more than it looks, because most of a profile's settings are members like this and their vocabularies are not tabulated anywhere in this reference. Send one wrong value and the refusal tells you the rest:

| Member | Values it names |
|---|---|
| `tilesetCategoryPillsVisibility`, `nestedSiblingTilesetsVisibility`, `oskVisibility`, `cartItemCountVisibility` | `Hidden`, `Visible` |
| `mode` | `Manned`, `Self-checkout` |
| `stockDisplay` | `Always`, `Low`, `Never`, `Out` |
| `oskKeyboardLayout` | `Auto`, `English`, `Norwegian`, `Swedish` |
| `cartPlacement` | `Left`, `Right` |
| `searchGridMode` | `Inline`, `Overlay` |
| `showProductFamiliesAs` | `Show all items`, `Show as category` |
| `productFamilyInteraction` | `Cards`, `Matrix`, `Stepwise` |
| `scoStartScreen` | `Button`, `Payment method`, `Scan`, `Tap card` |
| `scoReceiptMode` | `Print`, `QR first` |
| `scoUpsellPlacement` | `After payment`, `After start` |
| `receiptOptions` (each entry) | `Email`, `No receipt`, `Paper`, `SMS` |
| `layout` (tile set) | `Grid`, `List` |
| `defaultDisplayMode` (product tile) | `Grid`, `List` |

The values are comma-separated with `or` before the last, and the whole vocabulary is listed — for a wider member than any of these, see [a wrong unit naming all forty-eight units](./units-of-measure.md#a-wrong-value-is-a-400-that-names-every-unit-there-is).

The members typed as a plain `string` whose description names the values — `showProductFamiliesAs`, `productFamilyInteraction`, `scoStartScreen`, `scoReceiptMode`, `scoUpsellPlacement` and each entry of `receiptOptions` — refuse the same way, with the values in alphabetical order; their message names the member rather than an enum type:

```
"showProductFamiliesAs": "Nonsense"
400  details: Invalid value 'Nonsense' for 'showProductFamiliesAs'. Expected 'Show all items' or 'Show as category'.

"receiptOptions": ["Paper", "Fax"]
400  details: Invalid value 'Fax' for 'receiptOptions'. Expected 'Email', 'No receipt', 'Paper' or 'SMS'.
```

The refusal is the whole answer: a `PUT` carrying a wrong value creates nothing, and a `PATCH` changes nothing.

**A member whose type is fixed in the schema rather than checked against a vocabulary is refused one step earlier, and its message says nothing at all.** `renderRootTilesetPanel` is a plain boolean; `product.status` and a device's `status` are fixed sets of values. A bad value on any of them never reaches the vocabulary check:

```
"renderRootTilesetPanel": "Nonsense"
400  error: Invalid data format. A value could not be coerced to the expected target type.
```

So one class of mistake has two refusals, and which one you get is decided by how the member is declared rather than by what you sent. **The two do not even put their message in the same place**, which is worth knowing before you write the error handler: the vocabulary refusal is a `bad request` carrying its message in `details`, while this one is a `failed coercion` with **no `details` member at all** — its message is the generic `error` string, and everything specific is in a `failedCoercions` list naming the member that failed and the value you sent — with one entry per alternative the member's type allows, so a fixed set of values contributes one entry per value. So the second tells you no less than the first; it says it in the body rather than the message. Branch on `@type`, not on either string. See [Error Types](../../reference/overview.md#error-types).

Coercion runs first, so an object carrying both kinds of mistake reports only the coercion one — fix that and re-send to see the other.

There is no separate panel resource: a panel *is* a root tile set, so `/v1/pos-profiles/{key}/panels` is a `404`.

---

## POS Slips

A **POS slip** is the till's record of what it did against orders — the paper-trail side of a terminal session, one document per slip. Its `actions[]` summarises each action the till took: `type` (what it did, e.g. `Cancel`), `productName` (the product as named at the time) and `quantity`.

```bash
# List slips
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/pos-slips~take(50)"

# The flat action summary on one slip
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/pos-slips/{key}~just(actions~just(type,productName,quantity))"

# The checkout the slip came out of, shared with the receipts and slips of the same finalize
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/pos-slips/{key}~just(identifiers,slipKind,checkoutId)"
```

A slip carries a read-only `checkoutId`: "The identifier of the checkout that produced this slip, shared with the receipts and slips of the same POS finalize. Null on slips created before the member existed." It is the same value as `checkoutId` on the receipts of that finalize, so a slip and the receipt rung up in the same basket can be matched on it. The receipt side — `checkoutId` in a till receipt's default body (left out on imported receipts), `checkoutSiblings` for the other receipts of the checkout — is in [Receipts of One Checkout](../../reference/receipts.md#receipts-of-one-checkout-checkoutid-and-checkoutsiblings).

### Which order line an action moved (`tradeOrderItemEffects`)

Each entry in `actions[]` carries `tradeOrderItemEffects` — an array of effects, each naming an `affectedItem` (a trade order item) together with `affectedQuantity` and `affectedAmount`. It is the member that says *which line* an action moved, and by how much.

```bash
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/pos-slips/{key}~just(actions~just(type,productName,quantity,tradeOrderItemEffects~just(affectedQuantity,affectedItem~just(identifiers))))"
```

```json
{
  "actions": [
    {
      "type": "Cancel",
      "productName": "Oak Table Lamp",
      "quantity": "1",
      "tradeOrderItemEffects": [
        {
          "affectedQuantity": "1",
          "affectedItem": {
            "identifiers": {
              "key": "c88fed13c2edd02d",
              "com.example.lineItemId": "2000165:64b243af"
            }
          }
        }
      ]
    }
  ]
}
```

**Why it matters.** Two lines of the same product produce two `Cancel` actions with identical `productName` and identical `quantity`. Nothing else in `actions[]` tells them apart, and matching on the name is fragile anyway: rename the product between order creation and cancellation and the name in the slip no longer matches the name in your catalogue. `tradeOrderItemEffects` is the member to key a line-addressed export on.

**It is a shortcut, not new information.** The same effects have always been reachable one level down, through the order's trade records: `tradeRecords/*items/*actions/*tradeOrderItemEffects/*affectedItem`. That path still works and returns the same data. The member on `actions[]` is the flat route to it — worth knowing if you read only `actions[]` and concluded the platform could not answer the question at all. See [Trade Records → Items, actions and effects](../../reference/trade-records.md#items-actions-and-effects).

> **Scope caveat.** `affectedItem` resolves through the trade order items collection. A token that does not reach that collection reads **every** `affectedItem` as absent rather than failing — the response is a `200` with the effects present and their `affectedItem` missing, which looks like "this action moved no line" rather than like a permission problem. Check the token's scopes before concluding the data is not there. See [gotcha 41](../../reference/common-gotchas.md#41-a-write-under-a-read-only-scope-is-a-silent-200) for the same shape on the write side.

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

### Scanners and the read-only device collections

Barcode scanners live in collections of their own, and a key holding only `pos:read` reads them, as it reads the printers:

```bash
# Scanners (USB / HID, and serial) - read-only under pos:read, writable under pos:write
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/barcode-scanners"
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/serial-barcode-scanners"

# ESC/POS USB printers, likewise
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/esc-pos-usb-printers"
```

A write under `pos:read` is a silent `200`, as for every read-only twin — see [gotcha 41](../../reference/common-gotchas.md#41-a-write-under-a-read-only-scope-is-a-silent-200).

### Enrollment tokens

An **enrollment token** is the credential a machine presents on first boot to claim its pre-registered POS terminal and receive a device identity. Its `secret` is write-only: at least 64 characters, stored hashed, never returned by any read. A token names the organization node it can claim terminals under (`orgNode`, the node itself or any descendant), must carry an `expiresAt` at most 30 days ahead, and can be capped with `maxUses` and stopped with `revoked`.

```bash
# Create a token for a rollout wave (enrollment:write)
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/enrollment-tokens" \
  -H "Content-Type: application/json" \
  -d '[{
    "identifiers": {"com.myapp.tokenId": "stockholm-wave-1"},
    "name": "Stockholm rollout wave 1",
    "orgNode": {"identifiers": {"com.heads.seedID": "store1"}},
    "expiresAt": "2026-10-22T23:00:00.000Z",
    "secret": "pet_<at least 64 random characters>"
  }]'

# List the tokens with the node each belongs to (enrollment:read)
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/enrollment-tokens"

# The expiry, the cap, how many new device bindings it has created, and whether it is revoked
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/enrollment-tokens/com.myapp.tokenId=stockholm-wave-1~withAll"

# Stop it
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/enrollment-tokens/com.myapp.tokenId=stockholm-wave-1" \
  -H "Content-Type: application/json" -d '{"revoked": true}'
```

The scope `enrollment:read` is "Read access to device enrollment token metadata. Secrets are never returned." — it lists `/v1/enrollment-tokens` with `name` and `orgNode` in the default body and `expiresAt`, `maxUses`, `uses` and `revoked` under `~withAll`, and no `secret` under any projection; the admin key sees the same. `enrollment:write` creates, changes and revokes tokens. A key holding only `pos:read` or `pos:write` does not reach the collection (`404`), and `enrollment:read` reaches nothing else: `/v1/pos-terminals` under it is a `404`. A `POST` without `expiresAt` is `400 enrollment tokens must set expiresAt (at most 30 days ahead)`.

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
