# Users & Authentication Examples

Curl examples for users, user roles, role assignments, and OAuth2 clients.

**Base URL:** `http://localhost:5000/api/v1`
**API Key:** `banana` (passed via Basic Auth with empty username: `-u ":banana"`)

> **See also:** [Examples Index](../examples.md) | [Reference Documentation](../../reference/)

---

## Users

```bash
# List all users
curl -X GET -u ":banana" "localhost:5000/api/v1/users"

# Get user by ID
curl -X GET -u ":banana" "localhost:5000/api/v1/users/com.heads.seedID=admin"

# Get user with role assignments
curl -X GET -u ":banana" "localhost:5000/api/v1/users/com.heads.seedID=admin~with(roleAssignments)"

# Get user's OAuth2 clients
curl -X GET -u ":banana" "localhost:5000/api/v1/users/com.heads.seedID=admin/oauth2Clients"

# Create a user (linked to an existing person/agent)
# Note: Users do NOT have a "name" field. The user's display name
# comes from the linked agent (person). Create the person first,
# then link them via the "agent" field.
curl -X POST -u ":banana" "localhost:5000/api/v1/users" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.myapp.userId": "USER-001"},
    "agent": {"identifiers": {"com.myapp.personId": "PERSON-001"}}
  }'

# Update user (change linked agent or credentials)
# To change a user's display name, update the linked person instead
curl -X PATCH -u ":banana" "localhost:5000/api/v1/users/com.myapp.userId=USER-001" \
  -H "Content-Type: application/json" \
  -d '{"agent": {"identifiers": {"com.myapp.personId": "PERSON-002"}}}'

# Update user to set POS mode
curl -X PATCH -u ":banana" "localhost:5000/api/v1/users/com.myapp.userId=USER-001" \
  -H "Content-Type: application/json" \
  -d '{"posMode": true}'

# Delete user (deactivates the user, does not purge)
# Note: DELETE deactivates the user (sets inactive) but does not remove the record.
# Subsequent GET by key still resolves the user (with inactive status).
curl -X DELETE -u ":banana" "localhost:5000/api/v1/users/com.myapp.userId=USER-001"
```

---

## User Roles

```bash
# List all user roles
curl -X GET -u ":banana" "localhost:5000/api/v1/user-roles"

# Get user role by ID
curl -X GET -u ":banana" "localhost:5000/api/v1/user-roles/userRoleID=admin"

# Create a user role
# Note: User roles only have identifiers, name, and permissions.
# There is no "description" field.
# Permissions are user permission objects (NOT string arrays).
curl -X POST -u ":banana" "localhost:5000/api/v1/user-roles" \
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
curl -X PATCH -u ":banana" "localhost:5000/api/v1/user-roles/userRoleID=cashier" \
  -H "Content-Type: application/json" \
  -d '{"name": "Senior Cashier"}'

# Update user role permissions
# Permissions are user permission objects (NOT string arrays)
curl -X PATCH -u ":banana" "localhost:5000/api/v1/user-roles/userRoleID=cashier" \
  -H "Content-Type: application/json" \
  -d '{
    "permissions": [
      {"identifiers": {"permissionName": "pos.read"}},
      {"identifiers": {"permissionName": "pos.write"}},
      {"identifiers": {"permissionName": "receipts.read"}},
      {"identifiers": {"permissionName": "returns.write"}}
    ]
  }'
```

---

## Role Assignments

```bash
# Get user's role assignments
curl -X GET -u ":banana" "localhost:5000/api/v1/users/com.myapp.userId=USER-001/roleAssignments"

# Assign role to user at a specific organizational node (e.g., store)
# Note: The organizational scope field is "node" (not "scope")
curl -X POST -u ":banana" "localhost:5000/api/v1/users/com.myapp.userId=USER-001/roleAssignments" \
  -H "Content-Type: application/json" \
  -d '{
    "role": {"identifiers": {"userRoleID": "cashier"}},
    "node": {"identifiers": {"com.heads.seedID": "store1"}}
  }'

# Assign role without a specific node (applies globally)
curl -X POST -u ":banana" "localhost:5000/api/v1/users/com.myapp.userId=USER-001/roleAssignments" \
  -H "Content-Type: application/json" \
  -d '{
    "role": {"identifiers": {"userRoleID": "admin"}}
  }'

# Remove role assignment
curl -X DELETE -u ":banana" "localhost:5000/api/v1/users/com.myapp.userId=USER-001/roleAssignments/key=assignment-key"
```

---

## OAuth2 Clients

```bash
# Get user's OAuth2 clients
curl -X GET -u ":banana" "localhost:5000/api/v1/users/com.heads.seedID=admin/oauth2Clients"

# Create OAuth2 client for user
curl -X POST -u ":banana" "localhost:5000/api/v1/users/com.heads.seedID=admin/oauth2Clients" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"clientID": "my-integration-client"},
    "redirectURIs": ["https://myapp.example.com/callback"],
    "scopes": ["read", "write"],
    "isConfidential": true
  }'

# Delete OAuth2 client
curl -X DELETE -u ":banana" "localhost:5000/api/v1/users/com.heads.seedID=admin/oauth2Clients/key=client-key"
```
