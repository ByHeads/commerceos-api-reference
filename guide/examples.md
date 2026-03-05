# CommerceOS API Examples

Comprehensive curl examples demonstrating the full capabilities of the CommerceOS API.

**Base URL:** `http://localhost:5000/api/v1`
**API Key:** `banana` (passed via Basic Auth with empty username: `-u ":banana"`)

> **See also:** The [reference documentation](../reference/) for detailed API specifications.

---

## Examples by Topic

| Topic | Description | File |
|-------|-------------|------|
| [Organization](./examples/organization.md) | People, companies, stores, and generic agents | CRUD, relations, addresses |
| [Products & Catalog](./examples/products.md) | Products, categories, families, groups, labels, images | GTIN/PLU lookup, assortment contexts |
| [Pricing](./examples/pricing.md) | Prices, currencies, VAT codes | Validity periods, buyer restrictions |
| [Orders & Fulfillment](./examples/orders.md) | Trade orders, relationships, shipments, payments | Order lifecycle, fulfillment |
| [Labels](./examples/labels.md) | Labels across all entity types | Type restrictions, filtering, integration patterns |
| [Discount Rules](./examples/discount-rules.md) | Discount rules, manual discounts, trade restrictions | Promotions, bundles, volume tiers |
| [Inventory](./examples/inventory.md) | Stock places, adjustments, resets | Stock queries, warehouse zones |
| [Point of Sale](./examples/pos.md) | Terminals, profiles, receipts, devices, printers | Receipt creation, payment terminals |
| [Users & Auth](./examples/users.md) | Users, roles, role assignments, OAuth2 | User management, authentication |
| [Configuration](./examples/configuration.md) | Countries, languages, templates, mapped types, webhooks | System settings, integrations |
| [Query Operators](./examples/query-operators.md) | Operators reference | Filtering, pagination, projection |
| [Advanced Patterns](./examples/advanced.md) | Complex queries, bulk operations, SQL export | Aggregations, NDJSON, mapped types |
| [Streaming](../features/streaming.md) | Output streaming, input streaming, transaction chunking | NDJSON, `X-Transaction-Count`, error handling |

---

## Quick Reference

### HTTP Methods

| Method | Purpose | Example |
|--------|---------|---------|
| GET | Read | `GET /products` |
| POST | Create | `POST /products {...}` |
| PUT | Upsert (create or replace) | `PUT /products/key=123 {...}` |
| PATCH | Partial update | `PATCH /products/key=123 {"name": "..."}` |
| DELETE | Remove | `DELETE /products/key=123` |

### Parameterless Operators (NO parentheses!)

| Operator | Purpose |
|----------|---------|
| `~first` | First element |
| `~last` | Last element |
| `~count` | Count elements |
| `~distinct` | Unique primitive values (use after `~map`) |
| `~flat` | Flatten arrays |
| `~typeless` | Remove @type |

### Common Identifier Patterns

| Resource | Identifier Pattern |
|----------|-------------------|
| Products | `com.myapp.sku=SKU-001` |
| People | `com.myapp.customerId=CUST-001` |
| Companies | `com.myapp.companyId=COMP-001` |
| Stores | `com.myapp.storeId=STORE-001` |
| Orders | `com.myapp.orderId=ORD-001` |
| Currencies | `currencyCode=SEK` |
| Countries | `countryCode=SE` |
| Languages | `languageCode=sv` |
| POS Terminals | `posTerminalName=Kassa%201` |
| POS Profiles | `posProfileId=default` |
| User Roles | `userRoleID=admin` |
| Receipts | `receiptID=RCP-2024-00001` |

### Receipt Date Filtering

Receipt `/after` and `/before` endpoints accept Date-parsable timestamps only:

```bash
# ISO 8601 (recommended)
GET /v1/receipts/after/2024-01-01T00:00:00.000Z
GET /v1/receipts/before/2024-12-31T23:59:59.999Z

# RFC 2822
GET /v1/receipts/after/Mon, 01 Jan 2024 00:00:00 GMT
```

> **Note:** Invalid timestamps return empty arrays (not errors). Relative syntax like `-=24` is not supported.

---

## Notes

1. **External IDs**: Use reverse domain notation for namespacing (e.g., `com.myapp.customerId`)
2. **URL Encoding**: Special characters must be URL-encoded (space = `%20`, etc.)
3. **camelCase Paths**: Nested members use camelCase: `customerRelations`, `childCategories`, `assortmentContexts`
4. **Agent References**: Use `{"identifiers": {...}}` to reference existing agents in relationships
5. **Store Owner**: Stores use `owner` (not `parent`) to reference the owning company
6. **Product Groups**: Assign products via `parentGroup` on the product, NOT via the group's `members`
