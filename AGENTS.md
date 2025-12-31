# Agent Instructions for CommerceOS API Reference

This document provides guidance for AI agents working with the CommerceOS API reference repository.

---

## Repository Purpose

This repository contains **external API reference documentation** for the CommerceOS REST API. It is designed for:

- Developers integrating with the CommerceOS API
- AI agents that need to understand API usage patterns
- Integration partners building on the platform

**Important:** This repository must NOT contain internal implementation details about API internals, Pillow framework internals, or CommerceOS platform internals.

---

## Repository Structure

```
commerceos-api-reference/
├── AGENTS.md                     # This file - agent instructions
├── README.md                     # Repository overview and quick start
├── getting-started/
│   └── learning-path.md          # Structured learning progression
├── guide/
│   ├── agent-guide.md            # Contextual usage guide, task recipes, troubleshooting
│   ├── examples.md               # Comprehensive curl examples
│   ├── examples/                 # Domain-specific example files
│   │   ├── advanced.md           # Advanced query patterns
│   │   ├── configuration.md      # System configuration examples
│   │   ├── discount-rules.md     # Discount and pricing rules
│   │   ├── inventory.md          # Stock and inventory management
│   │   ├── orders.md             # Order operations
│   │   ├── organization.md       # Agents, stores, companies
│   │   ├── pos.md                # Point-of-sale operations
│   │   ├── pricing.md            # Price management
│   │   ├── products.md           # Product CRUD examples
│   │   ├── query-operators.md    # Operator usage examples
│   │   └── users.md              # User and permission examples
│   ├── advanced-queries.md       # 300 advanced query examples
│   └── creating-skills.md        # How to create Claude skills
├── reference/
│   ├── overview.md               # API basics, auth, endpoints
│   ├── operators.md              # Query operators reference
│   ├── operators-catalog.md      # Complete operator catalog
│   ├── pagination.md             # Pagination patterns and strategies
│   ├── primitives.md             # Primitive types and values
│   ├── receipts.md               # Receipt data model and operations
│   ├── mapped-types.md           # Data transformation
│   ├── resource-patterns.md      # Common resource patterns
│   ├── type-members.md           # Type member reference
│   ├── common-gotchas.md         # Known pitfalls
│   ├── platform-takeaways.md     # Cross-cutting behaviors
│   ├── email-integrations.md     # Email provider config
│   ├── sync-webhooks.md          # Webhook synchronization
│   ├── working-with/             # Domain-specific guides
│   │   ├── customers.md          # Customer management
│   │   ├── orders.md             # Order lifecycle and operations
│   │   ├── prices.md             # Price configuration
│   │   ├── products.md           # Product catalog management
│   │   ├── stock.md              # Stock and inventory
│   │   └── vat.md                # VAT and tax handling
│   └── integration-templates/    # Comprehensive integration guides
│       ├── crm-customer-sync.md  # CRM customer synchronization
│       ├── pim-product-sync.md   # PIM product catalog sync
│       ├── orders-integration.md # External order system integration
│       ├── bi-receipts-analytics.md  # BI analytics for receipts
│       └── retail-implementation.md  # End-to-end retail setup
└── features/
    ├── sql-export.md             # SQL export specification
    └── config-import-export.md   # Config utility spec
```

---

## How to Use This Repository

### For Learning the API

1. Start with [`getting-started/learning-path.md`](getting-started/learning-path.md)
2. Review [`reference/overview.md`](reference/overview.md) for basics and authentication
3. Read [`guide/agent-guide.md`](guide/agent-guide.md) for task recipes and troubleshooting
4. Study [`guide/examples.md`](guide/examples.md) for practical patterns
5. Check [`reference/common-gotchas.md`](reference/common-gotchas.md) for pitfalls

### For Quick Reference

| Need | Location |
|------|----------|
| Authentication | [`reference/overview.md`](reference/overview.md) |
| Query syntax | [`reference/operators.md`](reference/operators.md) |
| Task recipes | [`guide/agent-guide.md`](guide/agent-guide.md) |
| Troubleshooting | [`guide/agent-guide.md`](guide/agent-guide.md) |
| Type members | [`reference/type-members.md`](reference/type-members.md) |
| Common pitfalls | [`reference/common-gotchas.md`](reference/common-gotchas.md) |
| Data transformation | [`reference/mapped-types.md`](reference/mapped-types.md) |
| Curl examples | [`guide/examples.md`](guide/examples.md) |
| Advanced queries | [`guide/advanced-queries.md`](guide/advanced-queries.md) |

### For Creating Claude Skills

See [`guide/creating-skills.md`](guide/creating-skills.md) for instructions on creating Claude Code skills from this documentation.

---

## Common API Patterns

### External Identifiers

Resources use reverse-domain notation for external IDs:

```
GET /v1/products/com.example.sku=WIDGET-001
```

### Query Operators

**Path operators** chain left-to-right as written in the URL:

```
GET /v1/products~where(status=Active)~take(10)~with(prices)
```

**Query parameters** (legacy format) are canonicalized to a fixed order regardless of how they appear in the URL:
`format → fields → where → orderBy → skip → take → simpleJust`

For example, `?orderby=name&limit=10` applies orderBy *before* skip/take internally, ensuring consistent pagination boundaries when sorting collections.

Common operators:
- `~where(predicate)` - Filter collections
- `~take(N)` / `~skip(N)` - Pagination
- `~with(field)` - Expand non-essential fields
- `~just(fields)` - Project specific fields only
- `~orderBy(field:desc)` - Sort results
- `~map(name)` - Apply mapped type transformation

See [`reference/operators.md`](reference/operators.md) for detailed sequencing rules.

### Field Expansion

Most responses include only essential fields. Use `~with()` or `~withAll` to expand:

```
GET /v1/agents/123~with(addresses,contactMethods)
GET /v1/products/ABC~withAll
```

---

## Content Guidelines

### What Belongs Here

- HTTP request/response examples
- Query operator usage and syntax
- Resource patterns and field expansion
- External identifier conventions
- Authentication and pagination patterns
- Error handling examples
- Feature specifications (from external perspective)

### What Does NOT Belong Here

- Internal class names or TypeScript interfaces
- Framework implementation details (Pillow internals)
- Database schema or internal data models
- Internal file paths or code references
- Test coverage or development plans
- Internal review documents

---

## Agent Tasks

When working with this repository, agents should:

1. **Reference only** - Use this repo to understand API usage, not to modify platform code
2. **Stay external** - Never add internal implementation details
3. **Keep examples practical** - Focus on HTTP requests/responses
4. **Update cross-references** - When moving files, update all relative links

---

## Maintenance Notes

### Adding New Documentation

1. Determine the appropriate folder:
   - `getting-started/` - Onboarding content
   - `guide/` - Practical guides and examples
   - `reference/` - API reference material
   - `features/` - Feature specifications

2. Use external-facing language only
3. Update README.md if adding major new sections
4. Update this file if changing structure

**Never add internal content to this repository.** Internal documents (test plans, implementation details, review docs) belong elsewhere.
