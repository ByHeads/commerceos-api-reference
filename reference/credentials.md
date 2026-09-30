# Credentials

A **credential** is one way for a [user](users.md) to prove who they are. A user can hold any number of them, of any mix of types — the same account might sign in to the back office with an email and password, unlock a POS terminal with a PIN, and drive an integration with an API key.

There are nine credential types. They differ in what identifies the record and what secret (if any) the API stores.

> **Every write here needs the `admin` scope.** `users:read` grants read-only access to local, retail and Entra ID credentials and nothing else. `admin:read` reads all eight credential collections and OAuth2 clients, secrets masked, and cannot write either; it is v26.2.1 and later, see [The two restricted twins](#the-two-restricted-twins-integrationsread-and-adminread). There is no `users:write`. See [Users → Scopes](users.md#scopes).

---

## Secrets go in, they never come out

This one contract explains most of the surprising behaviour in this area, so it is worth reading before the type tables.

**A read never returns a secret.** Where a secret is set, the API returns the fixed placeholder `"********"` — not the value, not a hash of it, and not a value of the right length. Where no secret is set, the member is absent. So the response tells you *whether* a secret exists, and nothing else about it.

```bash
GET /v1/local-credentials/email=ada@example.com
```

```json
{
  "@type": "local credentials",
  "identifiers": { "email": "ada@example.com" },
  "password": "********"
}
```

This is the standard write-only-field contract, and it applies to five members: `password` (local), `pin` (PIN), `token` (scan token), `apiKey` (API key) and `secret` (OAuth2 client).

**The consequence is that a read-modify-write does not work on a credentials record.** Fetch the record, change the email, send the whole object back, and the placeholder goes to the setter like any other value — the password becomes those eight literal characters. The request returns `200` and the next read is byte-identical to the one before it, so nothing in the response tells you it happened.

```bash
# WRONG - GET returned "password": "********", and sending it back sets
#         the password to the string "********"
PATCH /v1/local-credentials/email=ada@example.com
{ "identifiers": { "email": "ada@new.example.com" }, "password": "********" }

# RIGHT - patch only what is changing
PATCH /v1/local-credentials/email=ada@example.com
{ "identifiers": { "email": "ada@new.example.com" } }
```

**Rule: patch only the fields you are changing, and never include a secret member unless you intend to set it.** See [gotcha 33](common-gotchas.md#33-a-read-modify-write-on-credentials-overwrites-the-secret).

**And: the value you send is the only copy.** Because no read returns it, a secret that is not captured at the moment you write it cannot be recovered from the API — the credential has to be replaced. That matters most for API keys and OAuth2 client secrets, where the value is typically generated once and handed to an integration.

To clear a secret without deleting the credential, set it to `null`:

```bash
PATCH /v1/local-credentials/email=ada@example.com
{ "password": null }
```

---

## Addressing a credential

Every credential type is reachable two ways:

| Form | Path | Use it to |
|---|---|---|
| Sub-collection of a user | `/v1/users/{userKey}/localCredentials` | Attach a credential to a user, or list that user's credentials |
| Root collection | `/v1/local-credentials/email=ada@example.com` | Address an existing record directly — read it, patch it, delete it |

```bash
# Attach
POST /v1/users/com.example.userId=U-1/localCredentials
[{ "identifiers": { "email": "ada@example.com" }, "password": "Secret1!" }]

# Address the same record afterwards
GET /v1/local-credentials/email=ada@example.com
```

A credential created through the root collection is not attached to any user, and an unattached credential cannot sign anyone in. Create through the user's sub-collection unless you have a reason not to.

---

## The nine types

| Sub-collection on a user | Root collection | Identified by | Other writable members |
|---|---|---|---|
| `localCredentials` | `/v1/local-credentials` | `email` and/or `username` | `password` |
| `retailCredentials` | `/v1/retail-credentials` | `username` | *none* |
| `pinCredentials` | `/v1/pin-credentials` | *your own identifiers only* | `pin`, `userPrefix` |
| `scanTokenCredentials` | `/v1/scan-token-credentials` | *your own identifiers only* | `token` |
| `apikeyCredentials` | `/v1/apikey-credentials` | *your own identifiers only* | `apiKey`, `scopes`, `node` |
| `bankIDCredentials` | `/v1/bankid-credentials` | `personalNumber` | *none* |
| `mobileCredentials` | `/v1/mobile-credentials` | `phoneNumber` | *none* |
| `entraIdCredentials` | `/v1/entraid-credentials` | `subject`, `objectId` | `email`, `tenantId`, `issuer` |
| `oauth2Clients` | `/v1/oauth2-clients` | `clientID` | `secret`, `redirectURIs`, `grants`, `scopes`, `isConfidential`, `accessTokenLifetimeSeconds`, `refreshTokenLifetimeSeconds`, `node` |

> **Watch the casing of the sub-collection names.** They are camelCase member paths, and two of them are irregular: `bankIDCredentials` (capital `ID`) and `entraIdCredentials` (capital `I`, lowercase `d`). The root collections are kebab-case and lowercase throughout: `/v1/bankid-credentials`, `/v1/entraid-credentials`.

"*Your own identifiers only*" means the type declares no login-principal identifier of its own: the record carries `identifiers.key` plus whatever namespaced identifiers you put on it, and you address it by one of those. Give every PIN, scan-token and API-key credential a namespaced identifier when you create it, or you will only be able to find it by database key.

---

### Local credentials

Email or username plus a password — the ordinary sign-in.

```bash
POST /v1/users/com.example.userId=U-1/localCredentials
[{
  "identifiers": { "email": "ada@example.com" },
  "password": "Secret1!"
}]
```

`email` and `username` are both login principals. Supply at least one; both may be present on the same record, in which case either one signs the user in.

```bash
# Username instead of email
POST /v1/users/com.example.userId=U-1/localCredentials
[{ "identifiers": { "username": "ada" }, "password": "Secret1!" }]

# Change a password on an existing record
PATCH /v1/local-credentials/email=ada@example.com
{ "password": "NewSecret2!" }
```

---

### Retail credentials

**Retail credentials carry no password.** The type has identifiers and nothing else. The record exists to *identify* a user to Heads Retail, which holds the secret and performs the authentication — so there is no password member to set, by design.

```bash
POST /v1/users/com.example.userId=U-1/retailCredentials
[{ "identifiers": { "username": "cashier001" } }]
```

A `password` sent here is not an error — it is simply not a member of the type, and it is ignored. The request returns `200` and stores the username. If you came from the local-credentials example and expected a password to be required, this is why it is absent.

---

### PIN credentials

Used to unlock a POS terminal.

```bash
POST /v1/users/com.example.userId=U-1/pinCredentials
[{
  "identifiers": { "com.example.pinId": "cashier-01" },
  "pin": "1234",
  "userPrefix": "C01"
}]
```

| Member | Notes |
|---|---|
| `pin` | The PIN. Write-only — reads return `********` |
| `userPrefix` | Optional prefix used to identify the user when entering a PIN. Readable normally |

`pinCredentials` is **not** in the default user representation — read it with `~with(pinCredentials)`.

---

### Scan-token credentials

The opaque token encoded on a QR card, scanned at a self-checkout terminal.

```bash
POST /v1/users/com.example.userId=U-1/scanTokenCredentials
[{
  "identifiers": { "com.example.cardId": "card-01" },
  "token": "ABCDEFGHJKMNPQRS"
}]
```

`token` is write-only. Like `pinCredentials`, `scanTokenCredentials` needs `~with(scanTokenCredentials)` to appear in a user read.

---

### API-key credentials

An API key is a credential on a user, not a free-standing object. That is why an API request is attributable to someone: the key resolves to its credentials record, the record resolves to the user, and the user's linked agent is who the request acts as.

```bash
POST /v1/users/com.example.userId=U-1/apikeyCredentials
[{
  "identifiers": { "com.example.keyId": "erp-integration" },
  "apiKey": "generate-a-long-random-value-here",
  "scopes": ["products:read", "products:write", "stock:read"],
  "node": { "@type": "store", "identifiers": { "com.example.storeId": "S-1" } }
}]
```

| Member | Notes |
|---|---|
| `apiKey` | The key value itself. **You supply it** — the API does not generate one. Write-only; no read ever returns it |
| `scopes` | The fine-grained scopes this key may use. An empty list means the key cannot authenticate at all |
| `node` | The organizational node the key acts within. Optional. It also decides where new products land: a product created without an `assortmentOwners` array goes into the assortment of the owner of this node, and a key without a node puts it in none. See [The default owner on create](working-with/assortments.md#the-default-owner-on-create) |

**Capture the key value when you write it.** The API never hands it back, so if the value is lost the credential has to be replaced with a new one.

**A key with no usable scope cannot authenticate.** The request fails as unauthorized rather than as forbidden, which reads like a bad key rather than a bad scope list — check `scopes` before you suspect the value.

#### Scope names

`scopes` takes fine-grained scope names. These are the ones an integration will want:

| Kind | Values |
|---|---|
| Read | `org:read`, `geo:read`, `suppliers:read`, `customers:read`, `supply-chains:read`, `users:read`, `products:read`, `prices:read`, `prices.sales:read`, `surcharges:read`, `pos:read`, `retail:read`, `logistics:read`, `trade-records:read`, `payment-means:read`, `labels:read`, `stock:read`, `media:read`, `wallet:read`, `deliveries:read`, `returns:read`, `orders.sales:read`, `orders.payments:read`, `discounts.system:read`, `discounts.manual:read`, `periods:read`, `payment-records:read`, `shipment-records:read`, `links:read`, `prices.purchase:read`, `integrations:read`, `admin:read` |
| Write | `geo:write`, `supply-chains:write`, `products:write`, `prices:write`, `discounts.system:write`, `discounts.manual:write`, `surcharges:write`, `pos:write`, `retail:write`, `receipts:write`, `pos-slips:write`, `logistics:write`, `payment-records:write`, `shipment-records:write`, `trade-records:write`, `orders.sales:write`, `orders.payments:write`, `labels:write`, `stock:write`, `periods:write`, `media:write`, `wallet:write`, `links:write`, `deliveries:write`, `returns:write` |
| Other | `me`, `advanced`, `config`, `integrations`, `admin` |

`orders.sales:read` and `orders.payments:read` read trade orders, order items and payment orders without opening any write. They are two of the eleven read scopes at the end of the Read row, from `orders.sales:read` to `admin:read`, which are v26.2.1 and later, not in v26.2.0 or v26.1.x: see [Every write scope has a read twin](#every-write-scope-has-a-read-twin). Before that release there was no read scope for orders: order data was read through `trade-records:read` and `logistics:read`, or by granting the write scope. `deliveries:*` and `returns:*` ship in v26.2.1 and later (not in v26.1.x) and are not part of `logistics:*` or `read:api`.

**The scope set for a receiving integration** — one that books supplier deliveries against purchase orders — is `deliveries:write`, `orders.sales:write`, `suppliers:read`, `products:read` and `geo:read`. Add `stock:read` to verify stock, `returns:write` for supplier returns, and `config` to set up the numbering serials. Two consequences of the missing `orders:read`: `orders` on a delivery reads `[]` without `orders.sales:write`, even for a key that only reads, and a create from an order fails to find it; the other way round, `deliveries` on an order reads `[]` without `deliveries:read`. See [Working with Purchasing → Scopes](working-with/purchasing.md#scopes).

A few `:write` scopes include their own read side rather than sitting beside it, so you do not need both halves. `trade-records:write` is one — it opens the same reads as `trade-records:read` plus a narrow writable surface on each record. See [Trade Records → Scopes](trade-records.md#scopes).

Two broad legacy scopes are also accepted, and they do not mean what their names suggest:

- **`read:api`** expands to a fixed set of read scopes — `org:read`, `geo:read`, `suppliers:read`, `supply-chains:read`, `users:read`, `products:read`, `prices:read`, `pos:read`, `retail:read`, `stock:read`, `media:read`, `surcharges:read`. It is not "every `:read` scope": `customers:read`, `prices.sales:read`, `logistics:read`, `trade-records:read`, `payment-means:read`, `labels:read` and `wallet:read` are **not** included, so those collections stay out of reach for a `read:api` key. Neither is any of the eleven newer read scopes: `orders.sales:read`, `orders.payments:read`, `discounts.system:read`, `discounts.manual:read`, `periods:read`, `payment-records:read`, `shipment-records:read`, `links:read`, `prices.purchase:read`, `integrations:read` and `admin:read`. `GET /v1/trade-orders` under `read:api` is a `404`. List them explicitly if you need them.
- **`write:api`** expands to **every** fine-grained scope, `admin` included. A key created with it can create users, set passwords and define roles.

Grant the narrowest set that works. A key that only reads the catalogue should carry `products:read` and nothing else.

**One thing a narrow set quietly takes away: registering dynamic properties.** `PATCH /v1/{collection}/properties/dynamic` needs that collection's `:write` scope, and two of them are not the scope the endpoint's name suggests — receipt properties need `receipts:write` rather than `retail:write`, and picking-order properties need `logistics:write` rather than `shipment-records:write`. A key that lacks the right one registers nothing and says `200`. If this key runs a deploy step that defines properties, list the write scopes for every collection it registers on. See [Dynamic Properties](resource-patterns.md#which-scope-registers-which-collection) and [gotcha 43](common-gotchas.md#43-registering-a-dynamic-property-under-a-read-scope-is-a-silent-200).

**Getting the set wrong is not an error you will see.** A scope this key does not hold does not make its resources refuse the request — it makes them absent, so a read or a write against one is a `404`, and a write that landed on a read-only twin is a `200` that persists nothing. There is no `403` anywhere in that list. See [gotcha 41](common-gotchas.md#41-a-write-under-a-read-only-scope-is-a-silent-200).

**Ask the key what it holds rather than inferring it.** `GET /v1/scopes` returns this credential's fine-grained scopes, legacy groups already expanded, so you can check a new key in one request instead of exercising endpoints and reading statuses — which cannot tell a read-only resource from its writable twin anyway. See [Checking what a key can do](overview.md#checking-what-a-key-can-do-v1scopes).

#### Every write scope has a read twin

> **Availability:** v26.2.1 and later. Not in v26.2.0 or v26.1.x: there the scopes marked **new** do not exist, and the ones marked **widened** stop short of the collections listed under [What the widened scopes add](#what-the-widened-scopes-add).

Every `:write` scope has a `:read` twin that exposes the same collections read-only.

| Write scope | Read twin | |
|---|---|---|
| `geo:write` | `geo:read` | references only, see [Listing and resolving](#a-read-scope-on-the-org-or-geo-side-resolves-it-does-not-list) |
| `supply-chains:write` | `supply-chains:read` | agents, people, companies, stores and systems as references only |
| `products:write` | `products:read` | **widened** |
| `prices:write` | `prices:read` | `prices.sales:read` is the narrower choice; `prices.purchase:read` is **new** |
| `discounts.system:write` | `discounts.system:read` | **new** |
| `discounts.manual:write` | `discounts.manual:read` | **new** |
| `surcharges:write` | `surcharges:read` | |
| `pos:write` | `pos:read` | **widened** |
| `retail:write` | `retail:read` | |
| `receipts:write` | `retail:read` | receipts are read under `retail:read` |
| `pos-slips:write` | `retail:read` | |
| `trade-records:write` | `trade-records:read` | |
| `payment-records:write` | `payment-records:read` | **new** |
| `shipment-records:write` | `shipment-records:read` | **new** |
| `logistics:write` | `logistics:read` | **widened** |
| `orders.sales:write` | `orders.sales:read` | **new** |
| `orders.payments:write` | `orders.payments:read` | **new** |
| `stock:write` | `stock:read` | **widened** |
| `periods:write` | `periods:read` | **new** |
| `labels:write` | `labels:read` | |
| `media:write` | `media:read` | |
| `wallet:write` | `wallet:read` | |
| `links:write` | `links:read` | **new** |
| `integrations` | `integrations:read` | **new**, restricted: see [below](#the-two-restricted-twins-integrationsread-and-adminread) |
| `admin` | `admin:read` | **new**, restricted: see [below](#the-two-restricted-twins-integrationsread-and-adminread) |

`me`, `advanced`, `config` and `kv` have no read variant. `org:read`, `suppliers:read`, `customers:read`, `users:read` and `payment-means:read` are read-only families with no write scope of their own. `deliveries:*` and `returns:*` are pairs too; they are covered in [Working with Purchasing → Scopes](working-with/purchasing.md#scopes).

Two things a read twin never gets are the members of a write scope that are not collections: `/v1/stock-reset` under `stock:write`, and the `renderTemplate` operator under `pos:write`.

##### What the new scopes open

Each opens the collections below at their usual paths. The `find` methods work as under the write scope: `POST /v1/trade-orders/@find` and `POST /v1/payment-orders/@find` answer under the read twin.

| Scope | Collections |
|---|---|
| `orders.sales:read` | `trade-orders`, `trade-order-items` |
| `orders.payments:read` | `payment-orders` |
| `discounts.system:read` | `discount-rules`, `discount-phases`, `discount-reasons`, `discount-coupons`, `trade-rule-effects`, `discount-rule-effects`, `percentage-discount-rule-effects`, `fixed-reduction-discount-rule-effects`, `fixed-price-rule-effects`, `package-discount-rule-effects` |
| `discounts.manual:read` | `manual-discounts`, `percentage-manual-discounts`, `fixed-reduction-manual-discounts`, `fixed-price-manual-discounts`, `discount-reasons` |
| `periods:read` | `periods`, `seasons`, `campaigns` |
| `payment-records:read` | `payment-records` |
| `shipment-records:read` | `shipment-records` |
| `links:read` | `shortened-links` |
| `prices.purchase:read` | `prices`, limited to the price rules that name the key's organization, or one above it, among the `buyers`. It is the buyer-side counterpart of `prices.sales:read`. A key without a `node` lists none |
| `integrations:read` | `payment-integrations`, `shipment-integrations`, `wallet-integrations`, `native-wallet-integrations`, `loyalty-integrations`, `epi-integrations`, `epi-configurations`, `wallet-providers` |
| `admin:read` | `users`, `systems`, `oauth2-clients`, `local-credentials`, `retail-credentials`, `mobile-credentials`, `bankid-credentials`, `entraid-credentials`, `pin-credentials`, `scan-token-credentials`, `apikey-credentials` |

In the back office's scope picker and in the OpenAPI scopes table each new scope carries the name of its write twin (Sales Orders, Payment Orders, System Discounts, Manual Discounts, Trade Periods, Payment Records, Shipment Records, Links, Integrations, Administration). `prices.purchase:read` is Purchase Pricing.

##### What the widened scopes add

| Scope | Added | It already had |
|---|---|---|
| `stock:read` | `stocks`, `stock-placement-rules`, `stock-entries`, `stock-counts`, `stock-count-items`, `stock-count-observations`, `stock-count-records`, `stock-count-record-items`, `stock-transfers`, `stock-transfer-items`, `stock-transfer-records`, `stock-transfer-record-items` | `stock-places`, `stock-transactions`, `stock-adjustments`, `stock-adjustment-items`, `stock-adjustment-reasons` |
| `logistics:read` | `shipment-orders`, `shipment-order-items`, `supply-routes`, `delivery-terms`, `incoterm-delivery-terms` and the eleven Incoterm code collections from `exw-delivery-terms` to `ddp-delivery-terms` | `picking-orders`, `picking-order-items`, `picking-records` |
| `products:read` | `product-package-classes`, `age-restrictions`, `age-restriction-overrides`, `hazard-classes`, `dangerous-goods`, `commodity-codes`, `hs-codes`, `cn-codes`, `taric-codes`, `hts-codes`, `brands`, `batches`, `gs1-series` | the catalogue |
| `pos:read` | `pos-tiles`, `pos-tile-sets`, `pos-function-tiles`, `pos-product-tiles`, `templates`, `printers` and the printer type collections, `currency-denominations` | terminals, profiles, functions, devices |
| `customers:read` | `customer-groups`: the groups of the key's own organization | customers |

##### What a request under a read twin answers

| Request | Answer | Effect |
|---|---|---|
| `GET` on any collection above | `200` | |
| `POST` | `400` `failed indexing`, `Found no matching '<type>' using this index. Check identifiers.` | nothing is created |
| `PATCH` | `200`, the object echoed | nothing changes |
| `DELETE` | `200` `{"deletedCount": 0, "info": "Nothing happened"}` | nothing is removed |
| `PUT …/actions/tryApprove` with `true` | `204` | the order stays `["New"]` |
| `PATCH …/actions {"tryApprove": true}` | `200` `null` | the order stays `["New"]` |

These are the three shapes of [gotcha 41](common-gotchas.md#41-a-write-under-a-read-only-scope-is-a-silent-200), now on every family. Actions are inert in the same way on a stock transfer under `stock:read` (`tryCommit`, `tryFulfill`) and on a shipment order under `logistics:read` (`release`). One shape is not a scope matter: a `POST` to an abstract collection such as `/v1/commodity-codes`, the base of `hs-codes`, `cn-codes` and the others, answers `200 [null]` under read and write scopes alike and creates nothing either way.

Four rules complete the picture:

- **References outside the key's scopes are absent.** Under `orders.sales:read` alone a trade order carries `identifiers`, `timestamp`, `status`, `totalAmount`, `balanceAmount`, the addresses and `items`, but no `supplier`, `customer` or `currency`, and its items have no `product`. [Reading orders without write access](../guide/examples/orders.md#reading-orders-without-write-access) shows which scope brings each back.
- **`read:api` does not carry them.** It expands to none of the eleven new scopes. `write:api` expands to every scope, the new ones included.
- **Scopes only add.** A read scope next to a write scope never narrows what the key can write: `supply-chains:write` with `logistics:read` still creates delivery terms. Where two read scopes carry the same collection at different widths the broader listing wins: `prices:read` with `prices.purchase:read` lists every price rule, `prices.sales:read` with `prices.purchase:read` lists the organization's sales and purchase prices together, and `customers:read` with `supply-chains:read` lists every customer group.
- **Registering a dynamic property still needs the `:write` scope.** Under any read twin it is the silent `200` of [gotcha 43](common-gotchas.md#43-registering-a-dynamic-property-under-a-read-scope-is-a-silent-200).

#### The two restricted twins: `integrations:read` and `admin:read`

> **Availability:** v26.2.1 and later. Not in v26.2.0 or v26.1.x.

**`integrations:read`** lists the eight integration collections. An integration reads its `identifiers`, `status`, `baseUrl`, `configurations`, `users`, and `methods`, `providers` or `assignedTerminals` where the type has them.

- **Configuration bodies are withheld.** The `configuration` member is absent on `/v1/epi-configurations/{id}` and on each entry of an integration's `configurations`. A key with `integrations` still reads them.
- **`configurationHash` is served**, so a poller can tell that a configuration changed. It is outside the default projection: ask for it with `~with(configurationHash)`.
- The action members `install`, `uninstall`, `test` and `configure` are absent, and writes change nothing: a `PATCH` with a new `baseUrl` and `"uninstall": true` answers `200` and the integration reads as before.
- Wallet providers read in full, `codePrefix` included.

```bash
GET /v1/epi-configurations~take(1)~with(configurationHash)
# integrations:read  → integration, node, configurationHash
# integrations       → the same plus configuration
```

**`admin:read`** lists users, systems, OAuth2 clients and all eight credential collections.

- **Secrets are masked**, as on every read: an OAuth2 client's `secret` and an API key's `apiKey` read `"********"`, and so do `password`, `pin` and `token`.
- `scopes`, `grants`, `redirectURIs`, the lifetimes and `isConfidential` read normally, so an audit can list what every key and client may do.
- **Not opened:** roles, permissions, role assignments, auth providers and `/v1/admin`. `GET /v1/user-roles`, `/v1/user-permissions`, `/v1/user-role-assignments`, `/v1/auth-providers` and `/v1/admin` are a `404` under it, and so are `/v1/agents` and `/v1/people`.
- Writes change nothing: a `PATCH` of `scopes` on another key answers `200` with the credential echoed and the key's scopes are as they were; a `DELETE` answers `deletedCount: 0`.
- `users:read` remains the narrower choice: users plus local, retail and Entra ID credentials. `admin:read` adds systems, OAuth2 clients and the other five credential collections.
- It is not part of `read:api`. Like `admin`, it is excluded from the published OpenAPI schema, so `/api-docs` does not describe the collections that only it reaches.

```bash
GET /v1/apikey-credentials~take(1)~just(identifiers,apiKey,scopes)
→ [{"identifiers": {…}, "apiKey": "********", "scopes": ["read:api", "write:api"]}]
```

#### A read scope on the org or geo side resolves, it does not list

`geo:read`, `supply-chains:read`, `suppliers:read`, `customers:read` and `users:read` make countries, currencies, agents, people, companies and stores readable where another resource refers to them: a product's `countryOfOrigin`, an order's `customer` and `sellers`, a payment terminal's `store`. They do not open the collections themselves. This is long-standing.

| Collection | Lists under |
|---|---|
| `/v1/agents`, `/v1/people`, `/v1/companies` | `supply-chains:write` |
| `/v1/systems` | `supply-chains:write`, `admin`, `admin:read` |
| `/v1/countries`, `/v1/currencies`, `/v1/cities`, `/v1/places`, `/v1/languages` | `geo:write` |
| `/v1/stores` | `org:read`: the stores of the key's own organization. `supply-chains:write`: every store |
| `/v1/suppliers`, `/v1/customers` | `suppliers:read`, `customers:read` |

Under a read scope alone the other rows are a `404`: `GET /v1/countries` under `geo:read`, `GET /v1/agents` under `supply-chains:read`.

**`GET /v1/stores` lists the stores of the key's own organization, whatever else the key holds.**

> **Availability:** v26.2.1 and later. Before v26.2.1 (v26.2.0, v26.1.12 and earlier), `org:read` together with `supply-chains:read`, `suppliers:read`, `customers:read` or `users:read`, and therefore `read:api`, lists every store.

A key whose `node` is a company lists that company's stores under `org:read`. Adding `supply-chains:read`, `suppliers:read`, `customers:read` or `users:read`, or using `read:api`, does not widen the listing: those scopes make any store resolvable as a reference and nothing more. A key on a store, or without a node, lists `[]`; a store key reads its own store at `/v1/store`. `GET /v1/stores/{id}` for a store outside the listing is `200 null`. A listing of every store takes `supply-chains:write`.

**The OpenAPI document names only the scopes under which a path answers.** From v26.2.1, an operation's `security` requirement and the Scopes table of each tag leave out the read scopes that only resolve references: `/v1/agents` names `supply-chains:write`, `/v1/countries` names `geo:write`, `/v1/stores` names `org:read` and `supply-chains:write`. A `:read` twin is named on the write operations of its collections as well, because the path answers under it. It does not mean the write lands.

---

### BankID and mobile credentials

Both are identifier-only: the record says which BankID personal number or which phone number belongs to this user, and the authentication happens elsewhere.

```bash
POST /v1/users/com.example.userId=U-1/bankIDCredentials
[{ "identifiers": { "personalNumber": "199001011234" } }]

POST /v1/users/com.example.userId=U-1/mobileCredentials
[{ "identifiers": { "phoneNumber": "+46701234567" } }]
```

---

### Entra ID credentials

Links a user to a Microsoft Entra ID (formerly Azure AD) principal.

```bash
POST /v1/users/com.example.userId=U-1/entraIdCredentials
[{
  "identifiers": {
    "subject": "00000000-0000-0000-0000-000000000001",
    "objectId": "22222222-2222-2222-2222-222222222222"
  },
  "email": "ada@contoso.onmicrosoft.com",
  "tenantId": "11111111-1111-1111-1111-111111111111",
  "issuer": "https://login.microsoftonline.com/11111111-1111-1111-1111-111111111111/v2.0"
}]
```

| Member | Notes |
|---|---|
| `subject` (identifier) | The OIDC `sub` claim — the canonical login identifier. Per-application and stable across logins for that user |
| `objectId` (identifier) | The Entra `oid` claim — the directory-unique principal id within a tenant |
| `email` | The email known when the credentials were provisioned |
| `tenantId` | The directory these credentials belong to. **Not** a per-user value — everyone in the tenant shares it; it pairs with `objectId` to disambiguate across tenants |
| `issuer` | The OIDC issuer URL |

No secret is stored: Entra ID authenticates the user and CommerceOS matches the resulting token to this record.

---

### OAuth2 clients

An OAuth2 client is how an integration obtains a token instead of presenting a static key. It is attached to a user like any other credential, and the token it obtains acts as that user.

```bash
POST /v1/users/com.example.userId=U-1/oauth2Clients
[{
  "identifiers": { "clientID": "erp-integration" },
  "secret": "generate-a-long-random-value-here",
  "grants": ["client_credentials"],
  "scopes": ["products:read", "trade-records:read"],
  "isConfidential": true,
  "accessTokenLifetimeSeconds": 3600
}]
```

| Member | Notes |
|---|---|
| `clientID` (identifier) | The `client_id` used in OAuth2 exchanges |
| `secret` | The client secret. Write-only — reads return `********` |
| `grants` | The grant types the client may use, e.g. `client_credentials` |
| `scopes` | The scopes the client may request — same names as [API-key scopes](#scope-names) |
| `redirectURIs` | Whitelisted redirect URIs, for flows that redirect |
| `isConfidential` | Whether the client is confidential |
| `accessTokenLifetimeSeconds` / `refreshTokenLifetimeSeconds` | Token lifetimes |
| `node` | The organizational node the client acts within. It decides where new products land, as for an [API key](#api-key-credentials); see [The default owner on create](working-with/assortments.md#the-default-owner-on-create) |

Using the resulting token is covered in [Overview → Authentication](overview.md#authentication). External Payment Integrations have their own client requirements — see [EPI Integrations & Configurations](../guide/examples/configuration.md#epi-integrations--configurations).

---

## Removing a credential

`DELETE` on a credentials record **purges** it. This is the opposite of `DELETE` on a user, which merely deactivates.

```bash
DELETE /v1/local-credentials/email=ada@example.com
```

That is the way to stop one specific login working while leaving the account and its other credentials intact — revoking an API key, retiring a lost QR card, removing an ex-employee's PIN.

To swap a user's whole set of one type in a single call, use `replace` on the sub-collection:

```bash
PATCH /v1/users/com.example.userId=U-1
{ "apikeyCredentials": { "replace": [
  { "identifiers": { "com.example.keyId": "erp-integration" },
    "apiKey": "the-new-value",
    "scopes": ["products:read"] }
] } }
```

`replace` makes the collection exactly the supplied set — anything unlisted is dropped. To detach some without touching the rest, use `remove`; to attach without disturbing what is there, use `add`. See [Array Write Operations](resource-patterns.md#array-write-operations).

---

## Auth providers

Credentials say *who someone is*. **Auth providers** say *which sign-in methods the login screen offers* and how an external identity provider is reached. They are separate resources, all under the `admin` scope:

| Collection | Configures |
|---|---|
| `/v1/auth-providers` | The polymorphic set — every provider, whatever its kind |
| `/v1/local-auth-providers` | Username/password sign-in |
| `/v1/retail-auth-providers` | Heads Retail sign-in |
| `/v1/entra-id-auth-providers` | Microsoft Entra ID |
| `/v1/oidc-generic-auth-providers` | Any other OIDC provider |

Every provider carries `active` (whether it appears as a login option), `displayName` and `rank` (sort order, higher first). The OIDC-based ones add the usual connection settings — `issuer`, `clientId`, `clientSecret` or `thumbprint`/`privateKey`, and `scopes` — plus two mapping mechanisms that are worth knowing about because they provision access automatically:

- **`claimToRoleMapping`** maps an ID-token claim to a CommerceOS role, in the form `claim:value=role@org`. Entra ID providers additionally offer `entraIdRoleToCosRole` and `entraIdGroupToCosRole` (`roleTemplateId=cosRole@orgNode,…` and `groupId=cosRole@orgNode,…`), so directory group membership can grant a role without anyone assigning it through the API.
- **`userClaimMap`** projects ID-token claims onto the signed-in user. It is keyed by claim name; each value says where the claim goes — `{"target": "com.example.employeeId", "id": true}` stores it as an external identifier under that namespace, and `id: false` writes it to a pre-registered user property instead.

```bash
GET /v1/auth-providers
GET /v1/entra-id-auth-providers~withAll
```

---

## Anti-patterns

- **Don't round-trip a credentials record.** Reads return `********` for every secret; writing it back sets the secret to that literal string, with a `200` and no visible change.
- **Don't expect to recover a key or secret.** Capture it when you write it. There is no read path that returns it.
- **Don't send a password to retail credentials.** The type has no password member; the value is ignored and the authentication still happens in Heads Retail.
- **Don't create credentials at the root collection and expect someone to be able to sign in.** An unattached credential belongs to no user. Post to the user's sub-collection.
- **Don't create PIN, scan-token or API-key credentials without a namespaced identifier.** Those types have no login principal to address them by, so without one you can only reach the record by database key.
- **Don't grant `write:api` to a key that only needs to read products.** It expands to every scope, `admin` included.

---

## Related

- [Users](users.md) — the account the credentials hang off
- [Roles, Permissions and Assignments](user-roles.md) — what a signed-in user may do in the applications
- [Provisioning Users and Access](../guide/provisioning-users.md) — the end-to-end walkthrough
- [Users & Authentication Examples](../guide/examples/users.md) — runnable curl
- [Array Write Operations](resource-patterns.md#array-write-operations) — `add` / `replace` / `remove` on credential sub-collections
