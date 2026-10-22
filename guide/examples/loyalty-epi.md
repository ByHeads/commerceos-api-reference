# Loyalty EPI reference

A loyalty integration is one kind of EPI (External Partner Interface) integration: CommerceOS calls *your* service when a cashier identifies a member, reserves a reward or completes a sale, and your service answers from the loyalty provider's data. This page is the contract. It is modelled on the [payment EPI reference](payment-epi/reference.md), and everything the two kinds share is linked there rather than repeated.

**Base URL:** `https://example.app.heads.com/api/v1`
**API Key:** `banana` (passed via Basic Auth with empty username: `-u ":banana"`)

> **See also:** [Build a payment integration](payment-epi.md) | [Payment EPI reference](payment-epi/reference.md) | [Examples Index](../examples.md)

---

## 1. What is shared with every EPI integration

| Topic | Where |
|---|---|
| The lifecycle routes `POST {baseUrl}/install`, `POST {baseUrl}/uninstall`, `GET {baseUrl}/config-schema`, `POST {baseUrl}/test` | [Payment EPI reference § 2](payment-epi/reference.md#2-lifecycle-endpoints) |
| The three context headers on every contextful call, `X-EPI-Context-Config-Id` first | [§ 3](payment-epi/reference.md#3-context-headers) |
| The configuration schema and the administrator's configuration on an organization node | [§ 4](payment-epi/reference.md#4-configuration) |
| The error body `{ "errors": [ { "message", "code"?, "params"? } ] }` on a non-2xx | [§ 7](payment-epi/reference.md#7-errors) |
| The calls your integration makes back: token, the configuration behind a context id, your key-value store | [§ 8](payment-epi/reference.md#8-calls-from-your-integration-to-commerceos) |

On the CommerceOS side the integration is a record on `/v1/loyalty-integrations` with the members every EPI integration has: `name`, `baseUrl`, `status`, `configurations`, and the actions `install`, `uninstall` and `test`. It does not expose your providers or their capability flags: those are visible only in your own answer to `GET {baseUrl}/methods`. The same record reads on `/v1/epi-integrations`, which lists every kind at once. Setup follows the payment tutorial's [Connect it to CommerceOS](payment-epi.md#5-connect-it-to-commerceos) with `loyalty-integrations` for `payment-integrations`, and without the POS-profile step: a loyalty integration has no payment method to allow.

```bash
# The integration record; name and baseUrl are required
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/loyalty-integrations" \
  -H "Content-Type: application/json" \
  -d '[{"identifiers": {"com.myapp.integrationId": "loyalty"}, "name": "My loyalty", "baseUrl": "https://loyalty.example.com/epi"}]'

# Install, then configure one organization node (see the payment tutorial, steps 2-6)
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/loyalty-integrations/com.myapp.integrationId=loyalty" \
  -H "Content-Type: application/json" -d '{"install": true}'
```

## 2. The session key

A member session at the till is identified by `{key}`, a UUID the POS application issues and owns. It appears in the path of the member routes, and the application also stores it on the order as the external id `com.loyalty.key`, so a receipt or order read through the API can be matched to the session your service saw. The same key runs from `identify` through `complete` or `cancel`; the reward routes under it refer to the same session.

## 3. The calls CommerceOS makes to your integration

Every call carries the three context headers of § 3 of the payment reference. `?` marks an optional field; a decimal is a string.

| Call | Body → answer | When |
|---|---|---|
| `GET /methods` | → an array of providers: `{ providerId, name, supports: { tiers, rewards, search?, onIdentify? }, customerExternalIdNamespace, customerGroupExternalIdNamespace, storeExternalIdNamespace, terminalExternalIdNamespace }` | the `configure` action on a configuration |
| `POST /members/{key}/identify` | `{ memberIdentifier, identifierType? }` → `{ customerId, customerGroupExternalIds?, displayName? }`; an identifier that belongs to no member is a non-2xx with `errors[].code` `UnknownMember` | a code is scanned, a card tapped (`identifierType: "cardToken"`, the terminal's alias of the card) or text typed at the till. `memberIdentifier` is whatever was scanned, tapped or typed; `identifierType` is sent for a card alias only |
| `POST /member-search` | `{ name, limit? }` → `{ hits: [{ customerId, displayName?, email?, mobilePhone? }], total }`; a hit's `customerId` identifies through `identify`; `limit` defaults to 10 and your service caps it | announced with `supports.search`. No till calls it yet |
| `POST /on-identify` | `{ customerKey, customerId?, loyaltyKey?, storeId, terminalId }` → any 2xx, body ignored | announced with `supports.onIdentify`; sent in the background whenever a customer is attached to a till order, however they were picked: identified, found in the till's customer search, created at the till, or picked in the order wizard. A failure is logged and never shown to the cashier; there is no retry |
| `POST /members/{key}/complete` | `{ receiptContext?: { storeId, terminalId, receiptId, timestamp } }` → any 2xx | after payment |
| `POST /members/{key}/cancel` | empty → any 2xx | the cart is cleared |
| `POST /members/{key}/rewards/reserve` | `{ couponIdentifier, storeId }` → `{ couponDescription?, lineItemCodes?, member?, data? }` | a coupon is scanned |
| `POST /members/{key}/rewards/complete`, `POST /members/{key}/rewards/cancel` | empty → any 2xx | the reward is used, or released |

The fields of `on-identify`:

| Field | Value |
|---|---|
| `customerKey` | the customer's CommerceOS agent key; `GET /v1/agents/key=<key>` reads the customer |
| `customerId` | the customer's external id in your `customerExternalIdNamespace`; absent when the customer carries none |
| `loyaltyKey` | the session key, when the customer came through `identify` or a reward; absent otherwise |
| `storeId`, `terminalId` | the external ids of the till's store and terminal in your `storeExternalIdNamespace` and `terminalExternalIdNamespace`; `""` when the node carries none |

The namespaces in the `GET /methods` answer are the external-id namespaces your provider uses for customers, customer groups, stores and terminals: CommerceOS reads the id under that namespace from the agent, group, store or terminal and sends it to you, and `identify`'s `customerId` and `customerGroupExternalIds` are matched against the same namespaces.

```bash
# What CommerceOS sends when a cashier scans a member's app code
POST {baseUrl}/members/4f2c1e9a-6c2b-4a5e-9d0e-1b7f3c8a2d10/identify
X-EPI-Context-Config-Id: v5EX
{ "memberIdentifier": "M-100234" }
→ 200 { "customerId": "100234", "customerGroupExternalIds": ["gold"], "displayName": "Anna Andersson" }

# A card tapped on the terminal
{ "memberIdentifier": "tok_8f1…", "identifierType": "cardToken" }

# An identifier no member has
→ 404 { "errors": [ { "code": "UnknownMember", "message": "No member has M-100234" } ] }
```

## 4. Capability flags

`supports` in the `GET /methods` answer says what the till may call. `tiers` and `rewards` govern the reward routes and the member tier shown to the cashier. `search` announces `POST /member-search`; `onIdentify` announces `POST /on-identify`, which the till then sends for every customer attached to an order, members or not. A flag left out is `false`.

## 5. Checklist

- [ ] Every contextful route checks `X-EPI-Context-Config-Id` and refuses a call without it with a 400 and an error body.
- [ ] `identify` answers an unknown identifier with a non-2xx and `errors[].code` `UnknownMember`; the cashier sees `<code>: <message>`.
- [ ] `on-identify` answers quickly and never depends on `customerId` or `loyaltyKey` being present.
- [ ] `complete` and `cancel` are idempotent on `{key}`: the till can repeat them.
- [ ] `member-search` caps `limit` and answers `total` for the whole match, not the page.
- [ ] Provider credentials are typed `secret` in your configuration schema.
