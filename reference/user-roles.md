# Roles, Permissions and Assignments

Three separate objects make up the authorization side of a [user](users.md) account:

```
user permission        a single named capability            "cos.products.edit"
        ↑
   user role           a named bundle of permissions        "Store Manager"
        ↑
user role assignment   gives a user that role at a node     Ada is Manager at Store 2
```

A permission is a capability. A role bundles permissions. An assignment gives one user one role, optionally scoped to one organizational node — so the same person can be a Manager at one store and a Cashier at another.

> **All three collections are `admin`-scoped, read *and* write.** Unlike users and their credentials, there is no read-only variant: a `users:read` key cannot list roles, permissions or assignments at all. See [Users → Scopes](users.md#scopes).

---

## What roles do *not* control

**Roles and permissions do not govern API access.** They govern what a signed-in user can do inside the CommerceOS applications — which POS functions appear on a terminal, what the back office exposes.

What an API request may reach is decided by the **scopes on the credential that made it** — the `scopes` array on an API key, or the scopes granted to an OAuth2 client. Attaching a narrow role to a user does not narrow what that user's API key can do, and removing a role does not revoke a key.

To restrict an integration, edit its [credential's scope list](credentials.md#scope-names). To restrict a person using the applications, edit their roles.

---

## User permissions

A permission is little more than a name.

```bash
GET  /v1/user-permissions
POST /v1/user-permissions
[{ "identifiers": { "permissionName": "cos.products.edit" } }]
```

| Member | Notes |
|---|---|
| `identifiers.permissionName` | The permission's name — a free-form string, e.g. `cos.products.edit` or `can_process_refunds`. Plus `key` and any namespaced identifiers you add |

The name has no meaning to the API itself: it is a token that the applications interpret. **There is no built-in catalogue to pick from** — the collection holds whatever the deployment's applications have registered, and it can legitimately be empty on a fresh instance. Read it before you assume a permission exists, and create the ones your own integration or application needs.

### `user-permissions` vs `authz-permissions`

`/v1/authz-permissions` is the polymorphic parent collection: user permissions are one kind of authorization permission among others. Reading it returns the whole mixed set.

**Use `/v1/user-permissions`.** That is the collection whose elements go into a role, and it is almost certainly what you want.

---

## User roles

```bash
GET  /v1/user-roles
GET  /v1/user-roles/userRoleID=cashier
POST /v1/user-roles
[{
  "identifiers": { "userRoleID": "cashier" },
  "name": "Cashier",
  "permissions": [
    { "identifiers": { "permissionName": "cos.pos.operate" } },
    { "identifiers": { "permissionName": "cos.receipts.view" } }
  ]
}]
```

| Member | Type | In the default representation | Notes |
|---|---|---|---|
| `identifiers.userRoleID` | string | ✓ | Your handle for the role |
| `name` | `string?` | ✓ | Display name |
| `permissions` | `user permission[]` | — | Request with `~with(permissions)` |

Two things trip people up:

- **`permissions` holds objects, not strings.** Each element is a user-permission reference — `{"identifiers": {"permissionName": "…"}}` — not the bare name. A `["cos.pos.operate"]` array is not the same thing.
- **There is no `description` member.** `name` is the only human-readable field.

```bash
# Roles with their permissions expanded
GET /v1/user-roles~with(permissions)

# Rename
PATCH /v1/user-roles/userRoleID=cashier
{ "name": "Senior Cashier" }
```

### Changing a role's permissions

`permissions` is an array, so the [array write operations](resource-patterns.md#array-write-operations) apply. Prefer `add`/`remove` for a partial change — sending a bare `permissions` array replaces the whole set, and anything you left out is dropped.

```bash
# Grant one more capability, leave the rest alone
PATCH /v1/user-roles/userRoleID=cashier
{ "permissions": { "add": [ { "identifiers": { "permissionName": "cos.returns.process" } } ] } }

# Withdraw one
PATCH /v1/user-roles/userRoleID=cashier
{ "permissions": { "remove": [ { "identifiers": { "permissionName": "cos.returns.process" } } ] } }

# Set the exact set (drops anything unlisted)
PATCH /v1/user-roles/userRoleID=cashier
{ "permissions": { "replace": [
  { "identifiers": { "permissionName": "cos.pos.operate" } },
  { "identifiers": { "permissionName": "cos.receipts.view" } }
] } }
```

---

## Role assignments

An assignment is the join: it gives one user one role.

```bash
POST /v1/users/com.example.userId=U-1/roleAssignments
[{
  "role": { "identifiers": { "userRoleID": "cashier" } },
  "node": { "identifiers": { "com.example.storeId": "S-1" } }
}]
```

| Member | Type | Notes |
|---|---|---|
| `identifiers` | `common identifiers` | `key`, plus any namespaced identifiers you add |
| `role` | `user role?` | The role being granted |
| `node` | `agent?` | The organizational node the role applies at |

The subject — which user is being granted the role — comes from the URL you post to. Creating an assignment through `/v1/users/{id}/roleAssignments` is what attaches it to that user.

Reading one back expands the role inline. Here for an assignment created without a `node` — when one is set it appears alongside, expanded the same way:

```bash
GET /v1/users/com.example.userId=U-1/roleAssignments
```

```json
[{
  "@type": "user role assignment",
  "identifiers": { "@type": "common identifiers", "key": "6a76af1c…" },
  "role": {
    "@type": "user role",
    "identifiers": { "key": "6bfbe6b4…", "userRoleID": "cashier" },
    "name": "Cashier"
  }
}]
```

> **`roleAssignments` is not in a user's default representation.** `GET /v1/users/{id}` says nothing about roles — ask with `~with(roleAssignments)` or `~withAll`. See [gotcha 34](common-gotchas.md#34-roleassignments-is-missing-from-the-default-user-representation).

### The `node` scopes the assignment

"Role assignment" on its own suggests a plain user↔role pair; `node` is what makes it more than that. It names the agent — usually a store or a company — that the role's permissions apply at.

```bash
# Manager at one store, Cashier at another
POST /v1/users/com.example.userId=U-1/roleAssignments
[
  { "role": { "identifiers": { "userRoleID": "manager" } },
    "node": { "identifiers": { "com.example.storeId": "S-2" } } },
  { "role": { "identifiers": { "userRoleID": "cashier" } },
    "node": { "identifiers": { "com.example.storeId": "S-1" } } }
]
```

Omit `node` and the assignment is not tied to a particular part of the organization:

```bash
POST /v1/users/com.example.userId=U-1/roleAssignments
[{ "role": { "identifiers": { "userRoleID": "admin" } } }]
```

To name the top of the organization explicitly rather than by omission, `/v1/root-organization` is a singleton resolving to the root agent.

`node` is an agent reference like any other, so it needs the nested `identifiers` form — see [gotcha 8](common-gotchas.md#8-agent-references-require-nested-identifiers).

### Listing and removing assignments

```bash
# Every assignment in the tenant
GET /v1/user-role-assignments

# One user's assignments
GET /v1/users/com.example.userId=U-1/roleAssignments

# Withdraw one
DELETE /v1/users/com.example.userId=U-1/roleAssignments/key=6a76af1c…
```

Give assignments your own namespaced identifier when you create them if an integration will need to remove them later — otherwise the database `key` from the read-back is the only handle you have.

---

## Anti-patterns

- **Don't use roles to restrict an API key.** They constrain the applications, not API scopes. The key's `scopes` array is the control.
- **Don't send permission names as strings.** `permissions` takes user-permission objects.
- **Don't assume a permission exists.** There is no built-in catalogue; read `/v1/user-permissions` or create what you need.
- **Don't replace a role's permissions when you mean to add one.** A bare `permissions` array is a full replacement — use `add` / `remove` for partial changes.
- **Don't check a user's roles against the default representation.** They are absent from it, so every user looks role-less.
- **Don't reach for `/v1/authz-permissions`** unless you specifically want the polymorphic set. `/v1/user-permissions` is the one roles are built from.

---

## Related

- [Users](users.md) — the account being granted roles
- [Credentials](credentials.md) — how a request is authenticated, and the scopes that govern it
- [Provisioning Users and Access](../guide/provisioning-users.md) — the end-to-end walkthrough
- [Users & Authentication Examples](../guide/examples/users.md) — runnable curl
- [Array Write Operations](resource-patterns.md#array-write-operations) — `add` / `replace` / `remove` on `permissions`
