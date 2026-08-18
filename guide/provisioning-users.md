# Provisioning Users and Access

How to create an account someone (or something) can sign in with, and give it the access it needs — from the person record through to the role assignment.

**Base URL:** `https://example.app.heads.com/api/v1`
**API Key:** `banana` (passed via Basic Auth with an empty username: `-u ":banana"`)

> **See also:** [Users](../reference/users.md) | [Credentials](../reference/credentials.md) | [Roles, Permissions and Assignments](../reference/user-roles.md) | [Curl examples](examples/users.md)

---

## Before you start

**You need the `admin` scope.** There is no `users:write`. A `users:read` key can read users and their local, retail and Entra ID credentials; everything else on this page — creating a user, attaching credentials, setting a password, defining a role, assigning it — requires `admin`.

That is worth checking first, because the failure is an authorization error rather than a validation error, and it is easy to spend a while debugging a request body that was never the problem. The broad legacy `write:api` scope expands to every fine-grained scope including `admin`, so a key holding it will work too.

> **These endpoints are not in the generated OpenAPI spec.** The `admin` scope is excluded from the published schema, so your tenant's `/api-docs` does not describe the write side of users, credentials, roles or permissions. This documentation is the contract for them.

---

## The shape of the model

Six objects, in the order you create them:

```
person (agent)          who they are in the real world
    ↑
user                    the account — has no name of its own
    ↑
credentials             how they sign in (nine types; a user can hold several)

user permission         a named capability
    ↑
user role               a bundle of permissions
    ↑
user role assignment    gives this user that role, optionally at one store
```

The single most common mistake is treating the user *as* the person. It is not: the user holds the login, and the linked **agent** holds the name and contact details. Users have no `name` member at all.

---

## Step 1 — The person

Create the agent the account will represent, or find the one that already exists.

```bash
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/agents" \
  -H "Content-Type: application/json" \
  -d '[{
    "@type": "person",
    "identifiers": {"com.example.personId": "P-1"},
    "givenName": "Ada",
    "familyName": "Lovelace"
  }]'
```

For a service account — an ERP integration, a self-checkout terminal — a store or company is a legitimate holder instead of a person.

---

## Step 2 — The user account

```bash
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/users" \
  -H "Content-Type: application/json" \
  -d '[{
    "identifiers": {"com.example.userId": "U-1"},
    "agent": {"identifiers": {"com.example.personId": "P-1"}}
  }]'
```

The account comes back with a system-assigned `identifiers.userId` (`U00001`, `U00002`, …) alongside the identifier you supplied. It is read-only — you can address the user by it, but you cannot choose it. Use your own namespaced identifier as the handle your integration stores.

---

## Step 3 — Credentials

Credentials are attached as a sub-collection of the user. Pick the type that matches how this account will actually sign in; a user can hold several.

**Email and password**, for someone using the back office:

```bash
curl -X POST -u ":banana" \
  "https://example.app.heads.com/api/v1/users/com.example.userId=U-1/localCredentials" \
  -H "Content-Type: application/json" \
  -d '[{
    "identifiers": {"email": "ada@example.com"},
    "password": "Secret1!"
  }]'
```

**A PIN**, for someone unlocking a POS terminal:

```bash
curl -X POST -u ":banana" \
  "https://example.app.heads.com/api/v1/users/com.example.userId=U-1/pinCredentials" \
  -H "Content-Type: application/json" \
  -d '[{
    "identifiers": {"com.example.pinId": "cashier-01"},
    "pin": "1234",
    "userPrefix": "C01"
  }]'
```

**An API key**, for an integration:

```bash
curl -X POST -u ":banana" \
  "https://example.app.heads.com/api/v1/users/com.example.userId=U-1/apikeyCredentials" \
  -H "Content-Type: application/json" \
  -d '[{
    "identifiers": {"com.example.keyId": "erp-integration"},
    "apiKey": "generate-a-long-random-value-here",
    "scopes": ["products:read", "products:write", "stock:read"]
  }]'
```

The full set of nine types, and what identifies each one, is in the [Credentials reference](../reference/credentials.md#the-nine-types).

### Two things to get right the first time

**Secrets go in and never come out.** A read returns the fixed placeholder `"********"` where a secret is set, and omits the member where none is. There is no read path that returns the real value — so **capture an API key or client secret at the moment you write it**, because if it is lost the credential has to be replaced.

**Never round-trip a credentials record.** Fetch it, edit a field, send the whole object back, and the `********` you read goes to the setter like any other value — the password becomes those eight literal characters, with a `200` and a subsequent read that looks unchanged. Patch only what you are changing:

```bash
# Change the email; say nothing about the password
curl -X PATCH -u ":banana" \
  "https://example.app.heads.com/api/v1/local-credentials/email=ada@example.com" \
  -H "Content-Type: application/json" \
  -d '{"identifiers": {"email": "ada@new.example.com"}}'
```

---

## Step 4 — Permissions

A permission is a named capability. **There is no built-in catalogue** — the collection holds whatever the deployment's applications have registered, and it can legitimately be empty on a fresh instance. Read it before assuming anything exists.

```bash
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/user-permissions"
```

Create what you need:

```bash
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/user-permissions" \
  -H "Content-Type: application/json" \
  -d '[
    {"identifiers": {"permissionName": "cos.pos.operate"}},
    {"identifiers": {"permissionName": "cos.receipts.view"}}
  ]'
```

> **Permissions govern the applications, not the API.** They decide which POS functions a signed-in user sees and what the back office exposes. What an API request may reach is decided by the `scopes` on the credential that made it. Giving a user a narrow role does not narrow what their API key can do.

---

## Step 5 — The role

A role bundles permissions under a name.

```bash
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/user-roles" \
  -H "Content-Type: application/json" \
  -d '[{
    "identifiers": {"userRoleID": "cashier"},
    "name": "Cashier",
    "permissions": [
      {"identifiers": {"permissionName": "cos.pos.operate"}},
      {"identifiers": {"permissionName": "cos.receipts.view"}}
    ]
  }]'
```

`permissions` holds **objects, not strings** — each element is a user-permission reference. A role has `name` and nothing else human-readable; there is no `description`.

---

## Step 6 — The assignment

The assignment joins the user to the role, and `node` scopes it to a part of the organization.

```bash
curl -X POST -u ":banana" \
  "https://example.app.heads.com/api/v1/users/com.example.userId=U-1/roleAssignments" \
  -H "Content-Type: application/json" \
  -d '[{
    "role": {"identifiers": {"userRoleID": "cashier"}},
    "node": {"identifiers": {"com.example.storeId": "S-1"}}
  }]'
```

Omit `node` and the role is not tied to a particular store or company. The same user can hold several assignments — Manager at one store, Cashier at another.

---

## Verify what you built

```bash
# Everything on the account, including roles and PIN credentials
curl -X GET -u ":banana" \
  "https://example.app.heads.com/api/v1/users/com.example.userId=U-1~withAll"

# Just the roles
curl -X GET -u ":banana" \
  "https://example.app.heads.com/api/v1/users/com.example.userId=U-1~with(roleAssignments)"
```

**Use `~withAll` or `~with(roleAssignments)` — a plain `GET` will not show you the roles.** The default user representation carries the identifiers, the agent and seven of the nine credential collections, and nothing about roles. Checking a plain `GET` will tell you the user has no roles when it has several. `pinCredentials`, `scanTokenCredentials`, `labels`, `config`, `posMode` and `hidden` are absent from it too.

---

## Day-two operations

**Reset a password:**

```bash
curl -X PATCH -u ":banana" \
  "https://example.app.heads.com/api/v1/local-credentials/email=ada@example.com" \
  -H "Content-Type: application/json" \
  -d '{"password": "NewSecret2!"}'
```

**Revoke one API key, leaving the account and its other logins intact.** `DELETE` on a credentials record purges it:

```bash
curl -X DELETE -u ":banana" \
  "https://example.app.heads.com/api/v1/apikey-credentials/com.example.keyId=erp-integration"
```

**Re-scope a key** — narrow what an integration may reach, without reissuing the key:

```bash
curl -X PATCH -u ":banana" \
  "https://example.app.heads.com/api/v1/apikey-credentials/com.example.keyId=erp-integration" \
  -H "Content-Type: application/json" \
  -d '{"scopes": ["products:read"]}'
```

**Deactivate someone who has left.** `DELETE` on a *user* deactivates rather than purges — the record stays, and a `GET` by the same key still resolves:

```bash
curl -X PATCH -u ":banana" \
  "https://example.app.heads.com/api/v1/users/com.example.userId=U-1" \
  -H "Content-Type: application/json" \
  -d '{"inactive": true}'
```

A deactivated user still appears in `/v1/users` and still counts in `~count`. Filter for active users yourself — and use the falsy check, because `inactive` is *absent* rather than `false` on an active account:

```bash
curl -X GET -u ":banana" \
  "https://example.app.heads.com/api/v1/users~where(!inactive)~take(100)"
```

Deactivating does not remove credentials. If the point is to stop a specific login working immediately, delete that credentials record too.

---

## Doing it in fewer requests

The person and the user still need separate calls, but a user and its credentials can be created or updated in one `PATCH` against the collection — matched on identifiers, so it works as an upsert and is safe to re-run:

```bash
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/users" \
  -H "Content-Type: application/json" \
  -d '[{
    "identifiers": {"com.example.userId": "U-1"},
    "agent": {"identifiers": {"com.example.personId": "P-1"}},
    "apikeyCredentials": {
      "replace": [{
        "identifiers": {"com.example.keyId": "erp-integration"},
        "apiKey": "generate-a-long-random-value-here",
        "scopes": ["products:read", "stock:read"],
        "node": {"@type": "company", "identifiers": {"com.example.companyId": "C-1"}}
      }]
    }
  }]'
```

`replace` makes that credential collection exactly the supplied set, dropping anything unlisted — which is what makes the call idempotent. Use `add` to attach without disturbing what is there, and `remove` to detach specific entries. See [Array Write Operations](../reference/resource-patterns.md#array-write-operations).

---

## Checklist

- [ ] The key you are provisioning *with* has `admin` (or the broad `write:api`)
- [ ] The person or other agent exists before the user
- [ ] The user's `agent` is set — an account with no holder cannot be used to authenticate
- [ ] Any generated API key or client secret is stored on your side; the API will not give it back
- [ ] No secret member was sent unless it was meant to be set
- [ ] The permissions the role references exist
- [ ] The assignment's `node` is right — or deliberately omitted
- [ ] Verified with `~withAll`, not a plain `GET`

---

## Related

- [Users](../reference/users.md) — the account object, lifecycle, and the scope story in full
- [Credentials](../reference/credentials.md) — the nine types, the write-only-secret contract, auth providers
- [Roles, Permissions and Assignments](../reference/user-roles.md) — the authorization objects
- [Users & Authentication Examples](examples/users.md) — runnable curl for every operation here
- [Overview → Authentication](../reference/overview.md#authentication) — how a request authenticates in the first place
