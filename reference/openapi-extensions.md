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

**Purpose:** Describes the members available on array types, such as `count`, `add`, `replace`, and `remove`. These describe how the array can be operated on via field selectors and PATCH operations.

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
      },
      "remove": {
        "type": "array",
        "items": { "$ref": "#/components/schemas/product" },
        "description": "Patch this array to remove elements from the array."
      }
    }
  }
}
```

**Usage:**

| Member | Type | Description |
|--------|------|-------------|
| `count` | number (read-only) | Returns the number of elements in the collection |
| `add` | array of the collection's own element type | PATCH with this member to append elements |
| `replace` | array of the collection's own element type | PATCH with this member to replace all elements |
| `remove` | array of the collection's own element type | PATCH with this member to detach the listed elements, leaving the rest in place |

**The three patch members are typed as what the collection holds.** They name the same type as `items` and as [`x-conceptOf`](#x-conceptof), and a collection that narrows what it holds publishes the narrowed type — `stores.add` takes a `store`, `surcharge rule effects.add` takes a `surcharge rule effect`. Each carries that type's own examples.

That is also exactly what the API accepts, wherever these members appear. Sending anything other than the array's element type, or a subtype of it, is a `400` naming that element — an unrelated type and the one a collection narrows *from* alike, so `{"@type": "agent"}` into `stores.add` is refused just as `product` is here:

```bash
PATCH /products/{key}/labels
{"add": [{"@type": "product", "identifiers": {"com.example.labelId": "vip"}}]}
→ 400  Invalid type annotation 'product'.
       Type is not assignable to parent relation return type 'label'
```

Omitting `@type` is the safe form — the element type is implied by where you are writing. One wrong type is *not* refused: a sibling that happens to declare everything the element declares is accepted, built as the element, and whatever it declared on top of that is dropped. See [gotcha 47](common-gotchas.md#47-a-declared-type-key-is-not-always-one-you-can-write).

> **Regenerate a client built before 2026-08-23.** Until then a narrowed collection published these three members with the type it narrows from, so an older generated client types them too widely and carries an example to match. Sending the wider type is the loud `400` above; for the two rule-effect collections the example named a sibling, which is the quiet case.

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

These write to a writable array **member** of an entity — a product's `labels`, a store's `stockRoots`, a customer group's `members`:

```bash
# Attach labels, leaving the ones already there in place
PATCH /products/com.example.sku=WIDGET-001/labels
{"add": [{"identifiers": {"com.example.labelId": "vip"}},
         {"identifiers": {"com.example.labelId": "new"}}]}

# Make the array exactly this set
PATCH /products/com.example.sku=WIDGET-001/labels
{"replace": [{"identifiers": {"com.example.labelId": "vip"}}]}

# Detach one element, leaving the rest in place
PATCH /products/com.example.sku=WIDGET-001/labels
{"remove": [{"identifiers": {"com.example.labelId": "vip"}}]}

# Add and remove in one transaction
PATCH /products/com.example.sku=WIDGET-001/labels
{"add":    [{"identifiers": {"com.example.labelId": "new"}}],
 "remove": [{"identifiers": {"com.example.labelId": "vip"}}]}

# Clear the array
PATCH /products/com.example.sku=WIDGET-001/labels
{"replace": []}
```

> **A root collection is not one of these arrays.** `x-array-members` is published on `/products` and `/stores` as well, but a `PATCH` there does not behave like a member array: measured, `replace` and `remove` change nothing, and `add` updates every element it matches but creates only the **last** new one in the list — all at `200`, with nothing in the response to say so. Create into a root collection with `POST`, and address one record with `DELETE /{collection}/{key}` where the resource supports it.

Each member is also addressable as an explicit sub-path — `PATCH /products/{key}/labels/remove` with the element array as the body is equivalent to the envelope form above. `remove` is idempotent (removing an absent element is a `200` no-op), and `replace` cannot be combined with `add`/`remove` in the same body (`400`). See [Array Write Operations](resource-patterns.md#array-write-operations) for the full semantics.

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
- Collection types (schemas with `conceptOf`) carry the members of the array they extend, plus any additional members defined on the collection type — with `add`, `replace` and `remove` typed to the collection's own element rather than the wider one
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
  "baseUrl": {
    "$ref": "#/components/schemas/url",
    "description": "The base URL at which CommerceOS can reach the integration.",
    "readOnly": false,
    "nullable": false,
    "x-cos-required": true,
    "x-cos-essential": true
  }
}
```

**Notes:**
- Emitted only where the member states it, and spelled both `true` and `false`. Most properties carry no `x-cos-required` at all, so an **absent** one means "not stated" rather than `false`
- Two other places carry the same fact and are the ones worth reading: the schema's standard OpenAPI `required` array (`"required": ["baseUrl"]`), and `x-pillow-type.requiredOnCreate`

---

### `x-cos-essential`

**Applies to:** Property schemas

**Purpose:** Indicates whether the property is included in the default response (without needing `~with`).

**Example:**

```json
{
  "nationality": {
    "$ref": "#/components/schemas/country code",
    "description": "The [ISO 3166-1 alpha-2](https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2) country code representing the agent's nationality.",
    "readOnly": false,
    "nullable": true,
    "x-cos-essential": false
  }
}
```

**Notes:**
- Emitted only where the member states it, and spelled both `true` and `false`. Most properties carry no `x-cos-essential` at all, so an **absent** one means "not stated" rather than `false`
- It is the one of the three with no second home in the spec — required-on-create is also in the `required` array, and read-only is also in `readOnly`, but nothing else carries essentialness. The member lists in [Type members](type-members.md) are the reference's own record of it

---

### `x-cos-readonly`

**Applies to:** Property schemas

**Purpose:** Indicates whether the property is read-only (cannot be set via POST/PUT/PATCH).

**Example:**

```json
{
  "timestamp": {
    "$ref": "#/components/schemas/date-time",
    "description": "The time at which the record was created.",
    "readOnly": true,
    "nullable": false,
    "x-cos-readonly": true
  }
}
```

**Notes:**
- Unlike its two siblings this one is emitted **only when `true`** — there is no `x-cos-readonly: false`, so absence carries no information
- The standard `readOnly` keyword carries the same fact and is on every `$ref`-typed property whether the answer is `true` or `false`. Read that instead

---

### Properties With a Fixed Set of Values Carry None of These

A property whose type is a fixed set of literal values — a product status, a receipt type, a stock movement's direction — is published as an **inline schema with an `enum`** rather than as a `$ref` to a model, and that changes what comes with it:

```json
{
  "status": {
    "type": "string",
    "description": "The status of the product, indicating whether it is active, inactive, or pending.",
    "enum": ["Active", "Inactive", "Pending"],
    "examples": [],
    "nullable": false
  }
}
```

That is the whole property. **None of the four extensions above appears on it**, and neither does the standard `readOnly` keyword — where a `$ref`-typed property such as `product.name` carries `x-pillow-type` and its `readOnly` flag alongside the type reference. On a property with an `enum`, `enum` and `nullable` are the only machine-readable facts, and the `description` is where the meaning of the individual values is written down.

Two other property shapes are bare in the same way, and neither is likely to matter: the `@type` discriminator, which is a fixed synthetic string on every polymorphic type, and the handful of properties published as an `anyOf` union of several models.

**Three of the four cost you nothing** — two are recorded elsewhere in the spec, and the third has no instances to record:

| Extension | Read this instead on an `enum` property |
|---|---|
| `x-cos-required` | The schema's standard `required` array. It is built from the member rather than from the property's shape, so it is unaffected — and no member with a fixed value set is required on create today, so no `required` array currently names one. |
| `x-pillow-type.nullable` | The property's own `nullable` flag, which is always present and spelled both `true` and `false`. |
| `x-cos-readonly` | The standard `readOnly` keyword — except that it is absent here too. No member with a fixed value set is read-only today. |
| `x-cos-essential` | **Nothing.** This is the one with live instances. |

**Three members with a fixed set of values are non-essential**, and nothing in the spec says so:

- `receipt.type`
- `receipt item.type`
- `product family.status`

They are not in the default representation, so ask for them with `~with(type)` or a `fields=` list. Nothing in the spec records that — on a property with an `enum` the extension is not emitted at all, and an absent one is indistinguishable from a member that simply never stated the flag. The member lists in [Type members](type-members.md) mark all three, and are the fallback for anything the spec cannot say.

**Two `enum` properties are also `nullable`** — `SQL settings.mode` and `numberHandling` on the JSON settings types. Their `enum` lists the named values only; the acceptance of JSON `null` is carried by `nullable: true` and explained in the `description`. See [The literal `null` as a parameter value](overview.md#the-literal-null-as-a-parameter-value) for what `null` means on those two.

---

## Using Extensions

### For Code Generators

When generating client code:

1. **Array operations:** Use `x-array-members` to generate helper methods for `count`, `add`, `replace`, and `remove` on collection types
2. **Type relationships:** Use `x-conceptOf` to understand collection-to-element relationships
3. **Required fields:** Prefer the standard `required` array, or `x-pillow-type.requiredOnCreate` — `x-cos-required` is absent from most properties and from every property with a fixed set of values
4. **Field expansion:** Use `x-cos-essential` to understand default vs. expanded field sets, but treat an **absent** one as unknown rather than as `false` — most properties do not carry it, and no property with an `enum` ever does (see [Properties with a fixed set of values](#properties-with-a-fixed-set-of-values-carry-none-of-these))
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

> **The four property extensions apply to `$ref`-typed properties.** A property published as an inline schema with an `enum` carries none of them — see [Properties with a fixed set of values](#properties-with-a-fixed-set-of-values-carry-none-of-these).
