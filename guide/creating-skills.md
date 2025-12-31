# Creating Claude Skills from API Reference

This guide explains how to create Claude Code skills using content from this API reference repository.

---

## What is a Claude Skill?

A Claude skill is a markdown file with YAML frontmatter that provides specialized knowledge to Claude Code. When invoked, the skill content is loaded as context to help Claude assist with specific tasks.

---

## Skill File Format

Skills are markdown files with a YAML frontmatter header:

```markdown
---
name: my-skill-name
description: Brief description of when to use this skill
---

# Skill Title

Content goes here...
```

### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier (kebab-case) |
| `description` | Yes | When the skill should be invoked |

---

## Creating a CommerceOS API Skill

### Step 1: Define the Scope

Decide what API tasks the skill should help with:
- General API usage (queries, CRUD operations)
- Specific domain (orders, inventory, POS)
- Integration patterns (webhooks, mapped types)

### Step 2: Select Source Content

Use content from this repository:

| Source File | Use For |
|-------------|---------|
| `reference/overview.md` | Authentication, endpoints, basics |
| `reference/operators.md` | Query operator syntax |
| `reference/mapped-types.md` | Data transformation |
| `reference/type-members.md` | Type member reference |
| `guide/examples.md` | Curl examples |
| `guide/advanced-queries.md` | Complex query patterns |

### Step 3: Structure the Skill

A good API skill includes:

1. **Overview** - What the API does
2. **Authentication** - How to connect
3. **Common Endpoints** - Key resources
4. **Query Syntax** - Operators and filtering
5. **Examples** - Request/response patterns
6. **Common Gotchas** - Known pitfalls

---

## Example Skill Structure

```markdown
---
name: commerceos-api
description: Expert assistant for the CommerceOS ERP/POS API
---

# CommerceOS API Usage Guide

## API Overview
[From reference/overview.md - basics, auth, base URL]

## Common Endpoints
[From reference/overview.md - endpoint tables]

## Query Operators
[From reference/operators.md - operator tables]

## Examples
[From guide/examples.md - curl examples]

## Common Gotchas
[Pitfalls and workarounds]
```

---

## Content to Include

### Essential Sections

1. **Authentication**
```markdown
### API Key
curl -H "X-Api-Key: MySecretKey" localhost:5000/api/v1/void

### OAuth 2.0
curl -X POST localhost:5000/oauth2/v1/token \
  -d "grant_type=client_credentials&client_id=ID&client_secret=SECRET"
```

2. **Path Casing Rules**
```markdown
- Top-level: kebab-case (`/trade-orders`)
- Nested members: camelCase (`/customerRelations`)
```

3. **Operator Reference**
```markdown
| Operator | Description | Example |
|----------|-------------|---------|
| ~where(...) | Filter | `/api/v1/products~where(status=Active)` |
| ~with(...) | Expand fields | `/api/v1/products~with(prices)` |
| ~take(...) | Limit results | `/api/v1/products~take(10)` |
```

4. **Common Gotchas**

Include pitfalls like:
- Parameterless operators don't use `()`
- Store uses `owner`, not `parent`
- Currency must be referenced by identifier
- Agent references need `identifiers`; `@type` is optional

---

## Type Members Reference

Include relevant type members for the skill's domain:

### Agent Members (person, company, store)
```
identifiers, name, nationality, addresses, contactMethods,
customerRelations, supplierRelations, labels, timeline,
stockRoots, assortment, preferredCurrency
```

### Product Members
```
identifiers, name, status, gtin, plu, hidden,
categories, prices, images, labels, stockLevels
```

### Trade Order Members
```
identifiers, supplier, customer, sellers, currency,
items, timestamp, totalAmount, payments, shipments
```

---

## Best Practices

### Do Include
- Authentication examples
- Endpoint tables
- Operator syntax with examples
- Common pitfalls and solutions
- Type member references

### Don't Include
- Internal implementation details
- Framework internals or internal class names
- Test coverage plans
- Development notes

### Keep It Focused
- One skill per domain or use case
- Include only relevant endpoints
- Provide working examples
- Document known limitations

---

## Testing Your Skill

1. Place skill file in your Claude Code skills directory
2. Invoke the skill by name
3. Ask Claude to perform API tasks
4. Verify responses use correct syntax and patterns
5. Iterate on content based on results

---

## Example: Minimal API Skill

```markdown
---
name: commerceos-api-mini
description: Quick reference for CommerceOS API basics
---

# CommerceOS API Quick Reference

## Authentication
curl -H "X-Api-Key: KEY" localhost:5000/api/v1/products

## Common Endpoints
- /api/v1/products - Products
- /api/v1/trade-orders - Orders
- /api/v1/receipts - POS receipts

## Query Operators
- ~where(cond) - Filter
- ~take(N) - Limit
- ~with(field) - Expand

## Examples
GET /api/v1/products~where(status=Active)~take(10)
GET /api/v1/trade-orders~with(items,customer)~first
```
