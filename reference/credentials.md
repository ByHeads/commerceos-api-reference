# Credentials

A **credential** is one way for a [user](users.md) to prove who they are. A user can hold any number of them, of any mix of types — the same account might sign in to the back office with an email and password, unlock a POS terminal with a PIN, and drive an integration with an API key.

There are nine credential types. They differ in what identifies the record and what secret (if any) the API stores.

> **Every write here needs the `admin` scope.** `users:read` grants read-only access to local, retail and Entra ID credentials and nothing else. There is no `users:write`. See [Users → Scopes](users.md#scopes).

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
| `node` | The organizational node the key acts within. Optional |

**Capture the key value when you write it.** The API never hands it back, so if the value is lost the credential has to be replaced with a new one.

**A key with no usable scope cannot authenticate.** The request fails as unauthorized rather than as forbidden, which reads like a bad key rather than a bad scope list — check `scopes` before you suspect the value.

#### Scope names

`scopes` takes fine-grained scope names. These are the ones an integration will want:

| Kind | Values |
|---|---|
| Read | `org:read`, `geo:read`, `suppliers:read`, `customers:read`, `supply-chains:read`, `users:read`, `products:read`, `prices:read`, `prices.sales:read`, `surcharges:read`, `pos:read`, `retail:read`, `logistics:read`, `trade-records:read`, `payment-means:read`, `labels:read`, `stock:read`, `media:read`, `wallet:read` |
| Write | `geo:write`, `supply-chains:write`, `products:write`, `prices:write`, `discounts.system:write`, `discounts.manual:write`, `surcharges:write`, `pos:write`, `retail:write`, `receipts:write`, `pos-slips:write`, `logistics:write`, `payment-records:write`, `shipment-records:write`, `orders.sales:write`, `orders.payments:write`, `labels:write`, `stock:write`, `periods:write`, `media:write`, `wallet:write`, `links:write` |
| Other | `me`, `advanced`, `config`, `integrations`, `admin` |

Note there is no `orders:read`: order data is read through `trade-records:read` and `logistics:read`, while `orders.sales:write` and `orders.payments:write` cover the write side.

Two broad legacy scopes are also accepted, and they do not mean what their names suggest:

- **`read:api`** expands to a fixed set of read scopes — `org:read`, `geo:read`, `suppliers:read`, `supply-chains:read`, `users:read`, `products:read`, `prices:read`, `pos:read`, `retail:read`, `stock:read`, `media:read`, `surcharges:read`. It is not "every `:read` scope": `customers:read`, `prices.sales:read`, `logistics:read`, `trade-records:read`, `payment-means:read`, `labels:read` and `wallet:read` are **not** included, so those collections stay out of reach for a `read:api` key. List them explicitly if you need them.
- **`write:api`** expands to **every** fine-grained scope, `admin` included. A key created with it can create users, set passwords and define roles.

Grant the narrowest set that works. A key that only reads the catalogue should carry `products:read` and nothing else.

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
| `node` | The organizational node the client acts within |

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
