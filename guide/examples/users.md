# Users & Authentication Examples

Curl examples for users, user roles, role assignments, and OAuth2 clients.

**Base URL:** `https://example.app.heads.com/api/v1`
**API Key:** `banana` (passed via Basic Auth with empty username: `-u ":banana"`)

> **See also:** [Examples Index](../examples.md) | [Provisioning guide](../provisioning-users.md) | [Users](../../reference/users.md) | [Credentials](../../reference/credentials.md) | [Roles & Permissions](../../reference/user-roles.md)

> **Every write on this page needs the `admin` scope.** `users:read` is read-only and covers users plus local, retail and Entra ID credentials; there is no `users:write`. See [Users → Scopes](../../reference/users.md#scopes).

---

## Users

```bash
# List all users
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/users"

# Get user by ID
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/users/com.heads.seedID=admin"

# Get user with role assignments
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/users/com.heads.seedID=admin~with(roleAssignments)"

# Get user's OAuth2 clients
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/users/com.heads.seedID=admin/oauth2Clients"

# Create a user (linked to an existing person/agent)
# Note: Users do NOT have a "name" field. The user's display name
# comes from the linked agent (person). Create the person first,
# then link them via the "agent" field.
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/users" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.userId": "USER-001"},
    "agent": {"identifiers": {"com.myapp.personId": "PERSON-001"}}
  }'

# Update user (change linked agent or credentials)
# To change a user's display name, update the linked person instead
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/users/com.myapp.userId=USER-001" \
  -H "Content-Type: application/json" \
  -d '{"agent": {"identifiers": {"com.myapp.personId": "PERSON-002"}}}'

# Update user to set POS mode
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/users/com.myapp.userId=USER-001" \
  -H "Content-Type: application/json" \
  -d '{"posMode": true}'

# Delete user (deactivates the user, does not purge)
# Note: DELETE deactivates the user (sets inactive) but does not remove the record.
# Subsequent GET by key still resolves the user (with inactive status).
curl -X DELETE -u ":banana" "https://example.app.heads.com/api/v1/users/com.myapp.userId=USER-001"

# Everything on the account — a plain GET shows NO roles, and no PIN or
# scan-token credentials. Use ~withAll or ~with(roleAssignments).
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/users/com.myapp.userId=USER-001~withAll"

# Active users only. "inactive" is ABSENT (not false) on an active user,
# so use the falsy check — ~where(inactive=false) matches nothing.
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/users~where(!inactive)~take(100)"

# Deactivated users only
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/users~where(inactive)~take(100)"
```

---

## Credentials

Credentials attach as a sub-collection of a user; each is also a root collection you can address directly afterwards. All nine types and their members are in the [Credentials reference](../../reference/credentials.md).

> **Secrets are write-only.** Reads return `"********"` where a secret is set. Sending that placeholder back sets the secret *to those eight characters* — patch only what you are changing, and never include a secret member unless you mean to set it.

```bash
# Email + password
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/users/com.myapp.userId=USER-001/localCredentials" \
  -H "Content-Type: application/json" \
  -d '[{
    "identifiers": {"email": "ada@example.com"},
    "password": "Secret1!"
  }]'

# Username instead of email (both are login principals; either may be used)
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/users/com.myapp.userId=USER-001/localCredentials" \
  -H "Content-Type: application/json" \
  -d '[{"identifiers": {"username": "ada"}, "password": "Secret1!"}]'

# Read it back — the password reads as "********", which only tells you one is set
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/local-credentials/email=ada@example.com"

# Change a password
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/local-credentials/email=ada@example.com" \
  -H "Content-Type: application/json" \
  -d '{"password": "NewSecret2!"}'

# Change the email WITHOUT touching the password — say nothing about it
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/local-credentials/email=ada@example.com" \
  -H "Content-Type: application/json" \
  -d '{"identifiers": {"email": "ada@new.example.com"}}'

# Retail credentials carry NO password — Heads Retail holds the secret and
# performs the authentication. A password sent here is simply ignored.
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/users/com.myapp.userId=USER-001/retailCredentials" \
  -H "Content-Type: application/json" \
  -d '[{"identifiers": {"username": "cashier001"}}]'

# PIN, for unlocking a POS terminal
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/users/com.myapp.userId=USER-001/pinCredentials" \
  -H "Content-Type: application/json" \
  -d '[{
    "identifiers": {"com.myapp.pinId": "cashier-01"},
    "pin": "1234",
    "userPrefix": "C01"
  }]'

# Scan token (the QR card scanned at a self-checkout terminal)
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/users/com.myapp.userId=USER-001/scanTokenCredentials" \
  -H "Content-Type: application/json" \
  -d '[{"identifiers": {"com.myapp.cardId": "card-01"}, "token": "ABCDEFGHJKMNPQRS"}]'

# PIN and scan-token credentials are NOT in the default user representation
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/users/com.myapp.userId=USER-001~with(pinCredentials,scanTokenCredentials)"

# API key. You supply the value — the API does not generate one, and no read
# ever returns it. Capture it now or the credential has to be replaced.
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/users/com.myapp.userId=USER-001/apikeyCredentials" \
  -H "Content-Type: application/json" \
  -d '[{
    "identifiers": {"com.myapp.keyId": "erp-integration"},
    "apiKey": "generate-a-long-random-value-here",
    "scopes": ["products:read", "products:write", "stock:read"],
    "node": {"@type": "store", "identifiers": {"com.heads.seedID": "store1"}}
  }]'

# Narrow what an integration may reach, without reissuing the key
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/apikey-credentials/com.myapp.keyId=erp-integration" \
  -H "Content-Type: application/json" \
  -d '{"scopes": ["products:read"]}'

# Check what a key can actually do — run this AS that key, not as the admin key.
# A GET succeeds under a read-only scope and its writable twin alike, so no
# endpoint probe can answer this; /v1/scopes answers it directly.
curl -X GET -u ":generate-a-long-random-value-here" "https://example.app.heads.com/api/v1/scopes"

# Same question, one scope: ["products:write"] when granted, [] when not.
# Leave ~count off - on a mistyped path ~count answers 1, which reads as granted.
curl -X GET -u ":generate-a-long-random-value-here" "https://example.app.heads.com/api/v1/scopes~where(\$this=products:write)"

# Revoke one key. DELETE on a CREDENTIAL purges it (unlike DELETE on a user,
# which only deactivates). The account and its other logins are untouched.
curl -X DELETE -u ":banana" "https://example.app.heads.com/api/v1/apikey-credentials/com.myapp.keyId=erp-integration"

# BankID and mobile — identifier-only, no secret stored
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/users/com.myapp.userId=USER-001/bankIDCredentials" \
  -H "Content-Type: application/json" \
  -d '[{"identifiers": {"personalNumber": "199001011234"}}]'

curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/users/com.myapp.userId=USER-001/mobileCredentials" \
  -H "Content-Type: application/json" \
  -d '[{"identifiers": {"phoneNumber": "+46701234567"}}]'

# Microsoft Entra ID. Note the sub-collection casing: entraIdCredentials
# (and bankIDCredentials above — the two irregular ones).
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/users/com.myapp.userId=USER-001/entraIdCredentials" \
  -H "Content-Type: application/json" \
  -d '[{
    "identifiers": {
      "subject": "00000000-0000-0000-0000-000000000001",
      "objectId": "22222222-2222-2222-2222-222222222222"
    },
    "email": "ada@contoso.onmicrosoft.com",
    "tenantId": "11111111-1111-1111-1111-111111111111",
    "issuer": "https://login.microsoftonline.com/11111111-1111-1111-1111-111111111111/v2.0"
  }]'

# Swap a user's whole set of one credential type in one call
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/users/com.myapp.userId=USER-001" \
  -H "Content-Type: application/json" \
  -d '{"apikeyCredentials": {"replace": [{
    "identifiers": {"com.myapp.keyId": "erp-integration"},
    "apiKey": "the-new-value",
    "scopes": ["products:read"]
  }]}}'
```

---

## Auth Providers

Auth providers configure which sign-in methods the login screen offers, and how an external identity provider is reached. See [Credentials → Auth providers](../../reference/credentials.md#auth-providers).

```bash
# Every configured provider, whatever its kind
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/auth-providers"

# Provider-kind collections
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/local-auth-providers"
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/retail-auth-providers"
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/entra-id-auth-providers~withAll"
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/oidc-generic-auth-providers~withAll"

# Take a provider off the login screen without deleting its configuration
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/auth-providers/key=PROVIDER-KEY" \
  -H "Content-Type: application/json" \
  -d '{"active": false}'
```

---

## User Permissions

```bash
# What permissions exist. There is NO built-in catalogue — this collection
# holds whatever the deployment's applications have registered, and it can
# legitimately be empty. Read it before assuming a permission exists.
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/user-permissions"

# Create permissions
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/user-permissions" \
  -H "Content-Type: application/json" \
  -d '[
    {"identifiers": {"permissionName": "cos.pos.operate"}},
    {"identifiers": {"permissionName": "cos.receipts.view"}}
  ]'

# /v1/authz-permissions is the polymorphic parent set — user permissions are
# one kind among others. For roles, you want /v1/user-permissions.
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/authz-permissions"
```

---

## User Roles

```bash
# List all user roles
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/user-roles"

# Roles with their permissions expanded (permissions is not in the default view)
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/user-roles~with(permissions)"

# Get user role by ID
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/user-roles/userRoleID=admin"

# Create a user role
# Note: User roles only have identifiers, name, and permissions.
# There is no "description" field.
# Permissions are user permission objects (NOT string arrays).
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/user-roles" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"userRoleID": "cashier"},
    "name": "Cashier",
    "permissions": [
      {"identifiers": {"permissionName": "pos.read"}},
      {"identifiers": {"permissionName": "pos.write"}},
      {"identifiers": {"permissionName": "receipts.read"}}
    ]
  }'

# Update user role (name or permissions)
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/user-roles/userRoleID=cashier" \
  -H "Content-Type: application/json" \
  -d '{"name": "Senior Cashier"}'

# Update user role permissions
# Permissions are user permission objects (NOT string arrays).
# A bare array REPLACES the whole set — anything left out is dropped.
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/user-roles/userRoleID=cashier" \
  -H "Content-Type: application/json" \
  -d '{
    "permissions": [
      {"identifiers": {"permissionName": "pos.read"}},
      {"identifiers": {"permissionName": "pos.write"}},
      {"identifiers": {"permissionName": "receipts.read"}},
      {"identifiers": {"permissionName": "returns.write"}}
    ]
  }'

# Grant one more capability, leaving the rest of the role alone
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/user-roles/userRoleID=cashier" \
  -H "Content-Type: application/json" \
  -d '{"permissions": {"add": [{"identifiers": {"permissionName": "returns.write"}}]}}'

# Withdraw one
curl -X PATCH -u ":banana" "https://example.app.heads.com/api/v1/user-roles/userRoleID=cashier" \
  -H "Content-Type: application/json" \
  -d '{"permissions": {"remove": [{"identifiers": {"permissionName": "returns.write"}}]}}'
```

---

## Role Assignments

```bash
# Get user's role assignments.
# A plain GET on the user shows NONE of these — roleAssignments is not in
# the default representation. Use this path, or ~with(roleAssignments).
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/users/com.myapp.userId=USER-001/roleAssignments"

# Every assignment in the tenant
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/user-role-assignments"

# Assign role to user at a specific organizational node (e.g., store)
# Note: The organizational scope field is "node" (not "scope")
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/users/com.myapp.userId=USER-001/roleAssignments" \
  -H "Content-Type: application/json" \
  -d '{
    "role": {"identifiers": {"userRoleID": "cashier"}},
    "node": {"identifiers": {"com.heads.seedID": "store1"}}
  }'

# Assign role without a specific node (applies globally)
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/users/com.myapp.userId=USER-001/roleAssignments" \
  -H "Content-Type: application/json" \
  -d '{
    "role": {"identifiers": {"userRoleID": "admin"}}
  }'

# Remove role assignment
curl -X DELETE -u ":banana" "https://example.app.heads.com/api/v1/users/com.myapp.userId=USER-001/roleAssignments/key=assignment-key"
```

---

## OAuth2 Clients

```bash
# Get user's OAuth2 clients
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/users/com.heads.seedID=admin/oauth2Clients"

# Create OAuth2 client for user.
# "scopes" takes the same fine-grained scope names as an API key —
# see reference/credentials.md#scope-names. "secret" is write-only.
curl -X POST -u ":banana" "https://example.app.heads.com/api/v1/users/com.heads.seedID=admin/oauth2Clients" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"clientID": "my-integration-client"},
    "secret": "generate-a-long-random-value-here",
    "grants": ["client_credentials"],
    "redirectURIs": ["https://myapp.example.com/callback"],
    "scopes": ["products:read", "trade-records:read"],
    "isConfidential": true,
    "accessTokenLifetimeSeconds": 3600
  }'

# Delete OAuth2 client
curl -X DELETE -u ":banana" "https://example.app.heads.com/api/v1/users/com.heads.seedID=admin/oauth2Clients/key=client-key"
```

---

## Trade Relationships — Time-relative queries

Trade relationships (the long-lived supplier/customer linkage between two agents — see [Trade Orders & Fulfillment](./orders.md#trade-relationships) for create examples) support `/before/` and `/after/` for picking up newly added or recently amended relationships during a CRM sync.

```bash
# Default mode: relationships modified at or after the given ISO timestamp
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/trade-relationships/after/2025-02-01T00:00:00.000Z~take(200)"

# Relationships modified before a cutoff (exclusive end)
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/trade-relationships/before/2025-03-01T00:00:00.000Z~take(200)"
```

> **Default:** `modify` — and it is the **only** supported mode for trade relationships. Asking for `(create)` returns a 404 because trade relationships are not modelled as discrete events. See [Operators → Time-relative queries](../../reference/operators.md#time-relative-queries-before-and-after).
>
> **Recommended:** use `/after/` and `/before/` for any time-windowed read of trade relationships — they are index-backed and the canonical pattern. Use `~where(timestamp...)` only when you need to combine the time filter with a non-time predicate.

### Agent-scoped variants

The same `/before/` and `/after/` filters are available on an agent's `customerRelations` and `supplierRelations` sub-collections, scoped to that agent's role:

```bash
# Our customers (this company is the supplier) amended since the last sync
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/companies/com.example.companyId=OUR-COMPANY/customerRelations/after/2025-02-01T00:00:00.000Z~take(200)"

# Our suppliers (this company is the customer) amended before a window end
curl -X GET -u ":banana" "https://example.app.heads.com/api/v1/companies/com.example.companyId=OUR-COMPANY/supplierRelations/before/2025-03-01T00:00:00.000Z~take(200)"
```

The mode-parameter rules are identical to the global endpoint (`modify` only; `(create)` returns 404). See [Resource Patterns → Trade Relationships → Time-Relative Queries](../../reference/resource-patterns.md#time-relative-queries-on-agent-sub-collections) for the full contract.
