# Users

A **user** is an account that can sign in. It holds credentials (email/password, PIN, API key, …) and role assignments, and it points at an **agent** — the person, company, or store that the account represents in the real world. When someone operates a POS terminal or creates an order, their user account is recorded as the one responsible.

> **A user is not a person.** The account and the human are two separate objects: the user carries the login, the linked `agent` carries the name and contact details. Users have no `name` member at all — to change a display name you update the linked person. Create (or find) the person first, then create the user pointing at it.

---

## Access requirements

Read the [scope story](#scopes) before you start — it determines what a given API key can do here, and it is the first thing that goes wrong.

| You want to | Scope you need |
|---|---|
| Read users, and read local / retail / Entra ID credentials | `users:read` |
| Read users, systems, OAuth2 clients and every credential collection, secrets masked | `admin:read` |
| Anything else in this area — create a user, attach credentials, set a password, define a role, assign a role | `admin` |

**There is no `users:write` scope.** User provisioning is an administrative operation, not something an ordinary integration key can do. A key scoped to `products:write` and `orders.sales:write` cannot create a user, and the failure arrives as an authorization error rather than a validation error — check the scope before you debug the request body.

---

## The user object

```bash
GET /v1/users/com.example.userId=U-1
```

```json
{
  "@type": "user",
  "identifiers": {
    "@type": "user identifiers",
    "key": "6a76af1c…",
    "userId": "U00001",
    "com.example.userId": "U-1"
  },
  "agent": { "@type": "person", "identifiers": { "…": "…" } },
  "localCredentials": [ … ],
  "retailCredentials": [],
  "bankIDCredentials": [],
  "mobileCredentials": [],
  "entraIdCredentials": [],
  "oauth2Clients": [],
  "apikeyCredentials": []
}
```

### Members

| Member | Type | In the default representation | Notes |
|---|---|---|---|
| `identifiers` | `user identifiers` | ✓ | `key`, the system-assigned `userId`, plus your own namespaced identifiers |
| `agent` | `agent?` | ✓ | The person/company/store this account represents. Settable |
| `localCredentials` | `local credentials[]` | ✓ | Email or username + password |
| `retailCredentials` | `retail credentials[]` | ✓ | Username known to Heads Retail |
| `bankIDCredentials` | `bankid credentials[]` | ✓ | |
| `mobileCredentials` | `mobile credentials[]` | ✓ | |
| `entraIdCredentials` | `entraid credentials[]` | ✓ | Microsoft Entra ID (formerly Azure AD) |
| `oauth2Clients` | `oauth2 client[]` | ✓ | |
| `apikeyCredentials` | `apikey credentials[]` | ✓ | |
| `pinCredentials` | `PIN credentials[]` | — | Request with `~with(pinCredentials)` |
| `scanTokenCredentials` | `scan token credentials[]` | — | QR-card credentials |
| `roleAssignments` | `user role assignment[]` | — | **Not** in the default representation — see below |
| `inactive` | `boolean?` | — | Absent when the user is active |
| `hidden` | `boolean?` | — | Advisory flag; collection reads do not filter on it |
| `labels` | `label[]` | — | |
| `config` | `user config?` | — | `darkModeActive` and `preferredLocale`, a locale tag such as `sv-se` or `en-US`; a tag that is not one (`sv_SE`) is `400`. Stored on create and on a `PATCH` of a user that has none — see [Updating a user](#updating-a-user) |
| `posMode` | `boolean` | — | Whether the account is in POS mode |

Every credential member is documented in [Credentials](credentials.md).

> **`roleAssignments` is not in the default representation.** A plain `GET /v1/users/{id}` returns the identifiers, the agent and seven of the nine credential collections — and nothing about roles. Checking "what roles does this user have?" against the default view will tell you "none" for a user who has several. Ask for it explicitly:
>
> ```bash
> GET /v1/users/com.example.userId=U-1~with(roleAssignments)
> GET /v1/users/com.example.userId=U-1~withAll
> ```
>
> The same applies to `pinCredentials`, `scanTokenCredentials`, `hidden`, `labels`, `config` and `posMode`. See [gotcha 34](common-gotchas.md#34-roleassignments-is-missing-from-the-default-user-representation).

---

## Creating a user

Two requests: the agent, then the account that points at it.

```bash
# 1. The person the account represents
POST /v1/agents
[{
  "@type": "person",
  "identifiers": { "com.example.personId": "P-1" },
  "givenName": "Ada",
  "familyName": "Lovelace"
}]

# 2. The user account
POST /v1/users
[{
  "identifiers": { "com.example.userId": "U-1" },
  "agent": { "identifiers": { "com.example.personId": "P-1" } }
}]
```

`agent` accepts any agent, not just a person — a store or a company is legitimate for a service account. The reference is resolved by identifier like every other agent reference; see [Agent References Require Nested identifiers](common-gotchas.md#8-agent-references-require-nested-identifiers).

The account's preferences go in the same request when you have them: `"config": { "preferredLocale": "sv-se", "darkModeActive": true }` on the user object is stored on create, exactly as a later `PATCH` stores it.

Credentials and role assignments are attached afterwards, as sub-collections of the user. The whole flow end to end — person, user, credentials, role, permissions, assignment — is walked through in [Provisioning Users and Access](../guide/provisioning-users.md).

### `identifiers.userId` is assigned by the system

Every user gets a sequential `userId` (`U00001`, `U00002`, …) when it is created, whether or not you supply your own external identifier. It is read-only: you can address a user by it, but you cannot choose it.

```bash
GET /v1/users/userId=U00001
```

Use your own namespaced identifier (`com.example.userId`) as the stable handle for an integration — that is the one you control and the one that survives a re-seed. See [External Identifiers](overview.md#external-identifiers).

---

## Updating a user

```bash
# Re-point the account at a different person
PATCH /v1/users/com.example.userId=U-1
{ "agent": { "identifiers": { "com.example.personId": "P-2" } } }

# Put the account in POS mode
PATCH /v1/users/com.example.userId=U-1
{ "posMode": true }

# User preferences
PATCH /v1/users/com.example.userId=U-1
{ "config": { "preferredLocale": "sv-se", "darkModeActive": true } }
```

To change a display name, patch the linked person — not the user.

`preferredLocale` is a locale tag: "The locale tag for the language that the user prefers, e.g. 'en-us' or 'sv-se'. A tag Intl.Locale rejects (such as 'sv_SE') is refused." The refusal is a `400 failed coercion` whose `failedCoercions[].path` is `/config/preferredLocale` (`:0/config/preferredLocale` in an array body), `targetType` `locale`, and nothing is stored. A `PATCH` of `config` on a user that has none stores it, as above — there is no member to create first.

---

## Deactivating a user

`DELETE` on a user **deactivates** it. The record is not purged, and a subsequent `GET` by the same key still resolves.

```bash
DELETE /v1/users/com.example.userId=U-1

# Equivalent, and more explicit about what it does
PATCH /v1/users/com.example.userId=U-1
{ "inactive": true }

# Reactivate
PATCH /v1/users/com.example.userId=U-1
{ "inactive": false }
```

Two consequences worth planning around:

- **A deactivated user still appears in `/v1/users` and still counts in `~count`.** If your integration needs an active-users list, filter for it yourself.
- **`inactive` is absent rather than `false` for an active user.** Use the falsy check, which matches an absent member; a predicate written as `inactive=false` compares against a value that is not there.

```bash
# Active users only
GET /v1/users~where(!inactive)~take(100)

# Deactivated users only
GET /v1/users~where(inactive)~take(100)
```

**A deactivated user's credentials stop working at once, and they are not removed.** Its API keys answer `401`; the token endpoint answers `401 invalid_client` (`"Client authentication failed"`, `"Client has been revoked or is invalid."`) for its OAuth2 clients; and a token issued before the deactivation answers `401` on every request. Setting `inactive` back to `false` brings all of them back, since the records are still there. `hidden` changes nothing about credentials. To stop one login for good while the account stays active, delete that credentials record — see [Credentials → Removing a credential](credentials.md#removing-a-credential).

---

## Scopes

The API authorizes a request from the **scopes carried by the credential that made it** — the `scopes` array on an API key, or the scopes granted to an OAuth2 client. Two things follow that are easy to conflate:

- **User roles and permissions do not govern API access.** They govern what a signed-in user can do inside the CommerceOS applications (which POS functions appear, what the back office exposes). An API key's reach is set by its scope list and nothing else. See [Roles, Permissions and Assignments](user-roles.md).
- **The `admin` scope is what gates this whole area.** The broad legacy `write:api` scope expands to every fine-grained scope, `admin` included, so a key holding `write:api` can provision users. A key holding `read:api` cannot: that expands to the `:read` scopes only, of which `users:read` is one.

| Scope on the credential | What it can reach here |
|---|---|
| `users:read` | `GET` on `/v1/users`, `/v1/local-credentials`, `/v1/retail-credentials`, `/v1/entraid-credentials` (plus read-only agents/people/companies/stores) |
| `admin:read` | `GET` on `/v1/users`, `/v1/systems`, `/v1/oauth2-clients` and all eight credential collections, secrets masked; and every config panel and key-value store under `/v1/context`, secrets masked `********`. No roles, permissions, role assignments or auth providers, and no writes. The OpenAPI description: "Read access to users, systems, OAuth2 clients, credential sets, and every config panel and key-value store under /v1/context; secrets stay masked (restricted)." See [Credentials → The two restricted twins](credentials.md#the-two-restricted-twins-integrationsread-and-adminread) and [Working with the Configuration Store → Scopes](working-with/configuration-store.md#scopes) |
| `admin` | Everything in this area, read and write; and every config panel and key-value store under `/v1/context`, in clear and writable — "Administrative access to system management, and read and write access to every config panel and key-value store under /v1/context, secrets in clear; creating or deleting a panel or store needs config (restricted)." |
| `read:api` (legacy, broad) | Expands to a fixed set of read scopes, `users:read` among them — but not `admin:read`, and it does not reach `/v1/context` at all |
| `write:api` (legacy, broad) | Expands to every fine-grained scope, `admin` included |

> **These endpoints are not in the generated OpenAPI spec.** `admin` and `admin:read` are excluded from the published schema, so `/openapi/spec.json` and your tenant's `/api-docs` do not describe the write side of users, credentials, roles or permissions. This documentation is the contract for them.

---

## Anti-patterns

- **Don't create a user without an agent.** The account has no name of its own; a user with an empty `agent` cannot be displayed sensibly, and authorization rejects a credential whose user has no holder.
- **Don't read a user, edit the object, and PUT it back.** Credential secrets read back as a `********` placeholder, and writing that placeholder sets the secret *to those eight characters*. Patch only what you are changing — see [gotcha 33](common-gotchas.md#33-a-read-modify-write-on-credentials-overwrites-the-secret).
- **Don't treat `DELETE` as a purge.** It deactivates. The user, its identifiers and its credentials all remain (refused while the account is inactive, working again when it is reactivated) — and the response is `{"deletedCount": 1, "info": "Deleted 1 items"}` either way, because the count reports that a setter ran rather than that a record is gone ([What a `DELETE` reports](overview.md#what-a-delete-reports)).
- **Don't assume the default representation is complete.** Roles, PIN and scan-token credentials, labels and config all need `~with(...)` or `~withAll`.
- **Don't expect a user's roles to constrain an API key.** Attaching a narrow role to a user does not narrow what its API key can reach; the key's `scopes` array does that.

---

## Related

- [Credentials](credentials.md) — the nine credential types and the write-only-secret contract
- [Roles, Permissions and Assignments](user-roles.md) — `user-roles`, `user-permissions`, `user-role-assignments`
- [Provisioning Users and Access](../guide/provisioning-users.md) — the end-to-end walkthrough
- [Users & Authentication Examples](../guide/examples/users.md) — runnable curl
- [Overview → Authentication](overview.md#authentication) — how a request is authenticated in the first place
