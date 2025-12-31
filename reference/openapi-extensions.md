# OpenAPI Extensions Reference

The CommerceOS API OpenAPI specification uses vendor extensions (`x-*` properties) to describe API-specific metadata that standard OpenAPI 3.1 cannot express. This document describes these extensions for API consumers building tooling or code generators.

---

## Specification-Level Extensions

### `x-tagGroups`

**Applies to:** OpenAPI root object (top-level)

**Purpose:** Groups tags for Scalar UI organization. Tags are grouped by scope (e.g., Products, POS, Configuration), making navigation easier in documentation UIs that support this extension.

**Structure:** An array of objects, each with a `name` (group display name) and `tags` (array of tag names in that group).

**Example:**

```json
{
  "openapi": "3.1.0",
  "info": { ... },
  "x-tagGroups": [
    { "name": "Products", "tags": ["Products", "Product groups", "Product categories"] },
    { "name": "POS", "tags": ["POS terminals", "POS functions", "Payment terminals"] },
    { "name": "Configuration", "tags": ["OAuth2", "BankID", "Root order"] }
  ]
}
```

**Behavior:**
- Each tag appears in exactly **one** group (highest-priority scope wins if a resource belongs to multiple scopes)
- Groups are sorted alphabetically by name
- Utility tags (Utilities, System, Key-value store, Schema introspection, Administration) are placed in their own groups

---

## Info Object Extensions

### `x-buildDate`

**Applies to:** `info` object

**Purpose:** ISO 8601 timestamp indicating when the OpenAPI specification was generated. Useful for debugging and cache invalidation.

**Example:**

```json
{
  "info": {
    "title": "CommerceOS API",
    "version": "COS 2.0.0",
    "x-buildDate": "2026-01-26T12:34:56.000Z"
  }
}
```

**Notes:**
- May be `undefined` in local development builds
- Format: ISO 8601 date-time string (e.g., `"2026-01-26T12:34:56.000Z"`)

---

### `x-environment`

**Applies to:** `info` object

**Purpose:** Indicates the deployment environment for the spec (e.g., `"global"`, `"staging"`, `"local"`).

**Example:**

```json
{
  "info": {
    "title": "CommerceOS API",
    "version": "COS 2.0.0",
    "x-environment": "global"
  }
}
```

**Notes:**
- May be `undefined` in local development builds
- Affects base URL examples in the spec description

---

## Schema Extensions

### `x-array-members`

**Applies to:** Array-type schemas (collections and pure arrays)

**Purpose:** Describes the members available on array types, such as `count`, `add`, and `replace`. These describe how the array can be operated on via field selectors and PATCH operations.

**Structure:** An object where each key is a member name and the value is a standard OpenAPI schema object describing that member.

**Example:** The `products` collection schema includes:

```json
{
  "products": {
    "type": "array",
    "items": { "$ref": "#/components/schemas/product" },
    "x-array-members": {
      "count": {
        "type": "number",
        "description": "The number of elements in the array.",
        "readOnly": true
      },
      "add": {
        "type": "array",
        "items": { "$ref": "#/components/schemas/product" },
        "description": "Patch this array to add elements to the array."
      },
      "replace": {
        "type": "array",
        "items": { "$ref": "#/components/schemas/product" },
        "description": "Patch this array to replace the elements of the array."
      }
    }
  }
}
```

**Usage:**

| Member | Type | Description |
|--------|------|-------------|
| `count` | number (read-only) | Returns the number of elements in the collection |
| `add` | array of element type | PATCH with this member to append elements |
| `replace` | array of element type | PATCH with this member to replace all elements |

**Accessing Array Members:**

Array members are accessed via **field selectors**, not standalone endpoints:

```bash
# Get count using field selector (correct)
GET /products~with(productCount:count)
# or
GET /products?fields=default,productCount:count

# Include nested count in parent object
GET /trade-orders~with(itemCount:items/count)
```

**PATCH Operations:**

```bash
# Add products to collection (append)
PATCH /products
{"add": [{"name": "New Product", "identifiers": {"com.example.sku": "NEW-001"}}]}

# Replace entire collection
PATCH /products
{"replace": [{"name": "Only Product", "identifiers": {"com.example.sku": "ONLY-001"}}]}

# Clear all items from collection (replace with empty array)
PATCH /products
{"replace": []}
```

**Clearing Collections:**

To remove all items from an array property, use `PUT` with an empty array or `PATCH` with `replace: []`:

```bash
# Clear via PUT (empty array)
PUT /stores/{key}/stockRoots
[]

# Clear via PATCH replace
PATCH /stores/{key}/stockRoots
{"replace": []}
```

Both approaches trigger the replace handler with an empty whitelist, removing all existing items.

**Notes:**
- `x-array-members` is only present on array schemas where members exist
- The member schemas follow standard OpenAPI schema conventions (`type`, `items`, `description`, `readOnly`, etc.)
- Collection types (schemas with `conceptOf`) inherit array members plus any additional members defined on the collection type
- **Important:** `count` is accessed via field selectors (e.g., `~with(count)` or `?fields=count`), not as a standalone `/products/count` endpoint

---

### `x-additionalPropertiesName`

**Applies to:** `additionalProperties` schemas on map-like object types

**Purpose:** Provides a human-readable name for the key type of dictionary/map-style objects. This helps documentation UIs display meaningful labels instead of generic "additional properties" text.

**Structure:** A string describing the key type, typically in brackets like `"[string]"` or `"[namespaced key]"`.

**Example:** The `kvp store` type (key-value store) uses this extension:

```json
{
  "kvp store": {
    "type": "object",
    "additionalProperties": {
      "allOf": [{ "$ref": "#/components/schemas/kvp set" }],
      "nullable": true,
      "x-additionalPropertiesName": "[namespaced key]",
      "examples": []
    }
  }
}
```

**Notes:**
- Used when `wrapRefWithAllOf()` is applied to avoid `$ref` siblings (OpenAPI 3.0 compatibility)
- The value typically mirrors the key type from the schema (e.g., `"[string]"`, `"[language code]"`)
- Helps code generators create meaningful dictionary type names

---

### `x-conceptOf`

**Applies to:** Collection schemas (array types representing API collections)

**Purpose:** Indicates the singular concept type that this collection contains. For example, the `products` collection has `x-conceptOf: "product"`.

**Example:**

```json
{
  "products": {
    "type": "array",
    "items": { "$ref": "#/components/schemas/product" },
    "x-conceptOf": "product"
  }
}
```

**Usage:** Useful for code generators to understand the relationship between collections and their element types.

---

### `x-indexer`

**Applies to:** Schemas with indexer support (collections that support lookup by identifier)

**Purpose:** Describes how the schema can be indexed/accessed. Includes the index type, return type, and default index behavior.

**Example:**

```json
{
  "products": {
    "type": "array",
    "items": { "$ref": "#/components/schemas/product" },
    "x-indexer": {
      "indexType": "common identifiers",
      "returnType": "product?",
      "description": "Access a product by its identifier"
    }
  }
}
```

**Fields:**

| Field | Description |
|-------|-------------|
| `indexType` | The type accepted as an index (e.g., `common identifiers`, `number`) |
| `returnType` | The type returned when indexing (may include `?` for optional) |
| `description` | Human-readable description of the indexer |
| `defaultIndex` | Default index value when none provided |
| `tryExtractMembers` | Members to attempt extraction from when parsing indexes |

---

## Property Extensions

### `x-pillow-type`

**Applies to:** Property schemas within object types

**Purpose:** Provides additional type metadata from the internal Pillow type system.

**Structure:**

```json
{
  "x-pillow-type": {
    "typeKey": "string",
    "readonly": false,
    "nullable": true,
    "requiredOnCreate": true,
    "dynamic": false,
    "elementType": "product"
  }
}
```

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `typeKey` | string | Internal type key |
| `readonly` | boolean | Whether the property is read-only |
| `nullable` | boolean | Whether the property accepts null |
| `requiredOnCreate` | boolean | Whether required when creating resources |
| `dynamic` | boolean | Whether this is a dynamic type |
| `elementType` | string | For array types, the element type key |

---

### `x-cos-required`

**Applies to:** Property schemas

**Purpose:** Indicates whether the property is required when creating a resource.

**Example:**

```json
{
  "name": {
    "type": "string",
    "x-cos-required": true
  }
}
```

---

### `x-cos-essential`

**Applies to:** Property schemas

**Purpose:** Indicates whether the property is included in the default response (without needing `~with`).

**Example:**

```json
{
  "identifiers": {
    "type": "object",
    "x-cos-essential": true
  }
}
```

---

### `x-cos-readonly`

**Applies to:** Property schemas

**Purpose:** Indicates whether the property is read-only (cannot be set via POST/PUT/PATCH).

**Example:**

```json
{
  "createdAt": {
    "type": "string",
    "format": "date-time",
    "x-cos-readonly": true
  }
}
```

---

## Using Extensions

### For Code Generators

When generating client code:

1. **Array operations:** Use `x-array-members` to generate helper methods for `count`, `add`, and `replace` on collection types
2. **Type relationships:** Use `x-conceptOf` to understand collection-to-element relationships
3. **Required fields:** Use `x-cos-required` to generate validation for create operations
4. **Field expansion:** Use `x-cos-essential` to understand default vs. expanded field sets
5. **Tag grouping:** Use `x-tagGroups` to organize generated client modules by domain
6. **Map types:** Use `x-additionalPropertiesName` for meaningful dictionary type names

### For Documentation Tools

When generating documentation:

1. **Array members:** Show `x-array-members` as available operations on collections
2. **Indexer info:** Use `x-indexer` to document how to access individual items
3. **Tag groups:** Use `x-tagGroups` to organize endpoint navigation by scope/domain
4. **Build metadata:** Use `x-buildDate` and `x-environment` to display spec version info

---

## Extensions Summary

| Extension | Location | Purpose |
|-----------|----------|---------|
| `x-tagGroups` | OpenAPI root | Tag grouping for UI |
| `x-buildDate` | `info` object | Spec generation timestamp |
| `x-environment` | `info` object | Deployment environment |
| `x-array-members` | Array schemas | Available array operations |
| `x-additionalPropertiesName` | `additionalProperties` | Key type label for maps |
| `x-conceptOf` | Collection schemas | Singular element type |
| `x-indexer` | Indexable schemas | Index type and behavior |
| `x-pillow-type` | Property schemas | Internal type metadata |
| `x-cos-required` | Property schemas | Required on create |
| `x-cos-essential` | Property schemas | Included in default response |
| `x-cos-readonly` | Property schemas | Read-only property |
