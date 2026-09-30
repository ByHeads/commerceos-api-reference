# Working with Assortments

> **Availability:** `assortmentOwner`, `assortmentOwners`, `assortmentContexts` and the default owner on create are in every current release. `discontinued` on an assortment context is v26.1.9 and later. `hiddenInPos` is v26.1.5 and later. `minimumOrderQuantity` on an assortment context was removed in v26.1.5; it exists on v26.1.0.1 and earlier only.

This guide covers how a tenant runs one assortment for the whole chain, one per company or region, one per store, or a mix. It explains how a store finds its assortment, what decides where a new product lands, what makes a product show up in the back office and sell at the till, and how to read, edit and remove assortment entries.

---

## Table of Contents

1. [Overview](#overview)
2. [Glossary](#glossary)
3. [How a Store Finds Its Assortment](#how-a-store-finds-its-assortment)
4. [Choosing a Setup](#choosing-a-setup)
5. [Putting Products into Assortments](#putting-products-into-assortments)
6. [What Makes a Product Show Up and Sell](#what-makes-a-product-show-up-and-sell)
7. [The Agent-Side Lists: `assortment` and `assortmentRoots`](#the-agent-side-lists-assortment-and-assortmentroots)
8. [Reading Assortments](#reading-assortments)
9. [Editing a Context](#editing-a-context)
10. [Removing a Product from an Assortment](#removing-a-product-from-an-assortment)
11. [Changing the Owner of a Store](#changing-the-owner-of-a-store)
12. [Suppliers and Manufacturers as Owners](#suppliers-and-manufacturers-as-owners)
13. [Scopes](#scopes)
14. [Error Responses](#error-responses)
15. [Endpoint Matrix](#endpoint-matrix)
16. [Pitfalls](#pitfalls)
17. [Related Guides](#related-guides)

---

## Overview

An **assortment** is the set of product nodes an agent offers. Every agent has one: companies, stores, suppliers, people. A store does not have to keep its own. It can use the assortment of its company, or of any other agent, and most setups work that way.

**Key characteristics:**

- An assortment decides what is offered. It does not decide the price or the stock; see [Prices](prices.md) and [Stock](stock.md)
- What has been assigned to the owner that a store uses decides what the store sees in the back office and what its tills can sell
- The same product can be in many assortments, with a different article number in each
- Suppliers are owners too. A supplier's assortment is what that supplier offers, and the context under the supplier carries the supplier's article number

Three API members carry all of this:

| Member | On | What it says |
|---|---|---|
| `assortmentOwner` | stores, companies | Whose assortment this store or company uses |
| `assortmentOwners` | products and every other product node | The owners this node has been assigned to |
| `assortmentContexts` | products and every other product node | What each owner records about this node: article number, primary supplier, discontinued flag |

---

## Glossary

| Term | Meaning |
|---|---|
| **Assortment** | The product nodes an agent offers. Every agent has one. |
| **Assortment owner** | The agent whose assortment a store or company uses. Each store and company resolves to exactly one. |
| **Assortment context** | What one owner records about one product node: `owner`, `articleNumber`, `primarySupplier`, `discontinued`. |
| **Own entry** | The node itself has been assigned to the owner. The owner is listed in the node's `assortmentOwners`. |
| **Covered** | The node is in the assortment only because a group, family, category or brand above it is. |
| **Product node** | Product, family, group, category, brand, set, package. All of them can be in an assortment. |

---

## How a Store Finds Its Assortment

### Organization first

The owner is resolved through the organization tree, so the tree has to be right before anything else.

- A store's `owner` and a company's `parent` build the tree
- The top company's `parent` is the root organization, an agent named `System`
- Both members accept a reference by external identifier or by database key

```bash
GET /v1/agents~where(name=System)                  # the root organization, with its key

POST /v1/companies                                 # a top company, under the root organization
[{"identifiers": {"com.example.companyId": "GROUP"}, "name": "Group",
  "parent": {"identifiers": {"key": "<database key of the root organization>"}}}]

POST /v1/companies
[{"identifiers": {"com.example.companyId": "NORTH"}, "name": "North",
  "parent": {"identifiers": {"com.example.companyId": "GROUP"}}}]

POST /v1/stores
[{"identifiers": {"com.example.storeId": "N1"}, "name": "North 1",
  "owner": {"identifiers": {"com.example.companyId": "NORTH"}}}]

PATCH /v1/stores/com.example.storeId=N1            # move a store to another company
{"owner": {"identifiers": {"com.example.companyId": "SOUTH"}}}
```

| Fact | Consequence |
|---|---|
| A company is put under the root organization by naming it as `parent`, on create or later with `PATCH` | The tenant-wide default reaches it |
| A company created without `parent` is not under the root organization | The tenant-wide default reaches neither it nor its stores. Suppliers are in this position on purpose |
| A store created without `owner` has no owner, also when the key has a node | It is outside the tree and uses its own assortment |
| Moving a store to another company | Changes the owner it follows at once |

> **Read the reference back.** A `parent` or `owner` whose identifier matches nothing is not refused. The write answers `200`, a nameless agent is created, and the company or store hangs under it. Check that the response names the agent you meant. An identifier key that is not [exactly three segments](../overview.md#a-malformed-identifier-key-is-discarded-not-rejected) is one way to get there: the key is dropped, and the reference then matches nothing.

### The rule

1. Start at the store or company.
2. If an owner is set there, that is the owner.
3. Otherwise go to the level above (`owner`, then `parent`, up to the root organization) and repeat.
4. If nothing is set anywhere, the agent is its own owner.

The rule stops at the owner it finds. A setting on that owner is not followed; see [An owner must use its own assortment](#an-owner-must-use-its-own-assortment).

### Reading the owner

`assortmentOwner` is not in the default response. Ask with `~with(assortmentOwner)` or the path. It reads `null` when the agent uses its own assortment, otherwise the owner.

```bash
GET /v1/stores/com.example.storeId=N1~with(assortmentOwner)

# uses its own assortment
{"@type": "store", "identifiers": {…}, "name": "North 1", "assortmentOwner": null}

# uses North's assortment, whether set on the store or inherited
{"@type": "store", "identifiers": {…}, "name": "North 1",
 "assortmentOwner": {"@type": "company", "identifiers": {"com.example.companyId": "NORTH", …}, "name": "North"}}
```

```bash
GET /v1/stores/com.example.storeId=N1/assortmentOwner              # the owner, or null (200)
GET /v1/stores~just(name,assortmentOwner~just(name))               # the whole picture in one request

GET /v1/stores~where(assortmentOwner/identifiers/com.example.companyId=NORTH)~just(name)
GET /v1/stores~where(assortmentOwner/identifiers/key=<database key>)~just(name)
GET /v1/stores~where(assortmentOwner/name=North)~just(name)
GET /v1/stores~where(assortmentOwner)~just(name)                   # stores that use another owner's
GET /v1/stores~where(!assortmentOwner)~just(name)                  # stores that use their own
```

`assortmentOwner` is a single reference, so the filter goes through `identifiers/`. The array members on a product do not; see [Forms that match nothing](#forms-that-match-nothing).

### Setting the owner

Scope `supply-chains:write`.

```bash
PATCH /v1/companies/com.example.companyId=NORTH    # North uses its own assortment, and so does everything below it
{"assortmentOwner": {"identifiers": {"com.example.companyId": "NORTH"}}}

PUT /v1/stores/com.example.storeId=S1/assortmentOwner
{"identifiers": {"com.example.companyId": "SOUTH"}}

PATCH /v1/stores/com.example.storeId=N2            # the store uses its own assortment
{"assortmentOwner": null}
```

| Fact | Detail |
|---|---|
| A setting on a company applies to every store and company below it that has no setting of its own | |
| The nearest setting wins | |
| `null` means "this agent itself". It is a setting, not "inherit" | `PUT …/assortmentOwner` with `null` answers `200 null` and means the same |
| There is no way to clear a setting on an agent | To follow the level above again, set the same owner explicitly |
| When the agent is set to itself, the response to the write has no `assortmentOwner` member | Read it back with `~with(assortmentOwner)`; it reads `null` |
| Changing the owner moves no products | See [Changing the owner of a store](#changing-the-owner-of-a-store) |

> **Current behaviour.** `DELETE /v1/stores/{id}/assortmentOwner` answers `200 {"deletedCount": 1, "info": "Deleted 1 items"}` and clears nothing. The owner is also not validated: an identifier that matches nothing creates a nameless agent and makes it the owner, `200`. Read the owner back after every write. Both may change.

### The tenant-wide default

The default for every store and company under the root organization is `assortmentOwner` on `/v1/config/root-trade-relationship`. Scope `config`.

```bash
GET /v1/config/root-trade-relationship
{"@type": "root trade relationship config", …,
 "customerOwner": {…}, "supplierOwner": {…},
 "assortmentOwner": {"@type": "company", "identifiers": {…}, "name": "Group"}}

PATCH /v1/config/root-trade-relationship
{"assortmentOwner": {"identifiers": {"com.example.companyId": "GROUP"}}}

PATCH /v1/config/root-trade-relationship           # here null does clear the setting
{"assortmentOwner": null}
```

It sits beside `supplierOwner` and `customerOwner`, which work the same way for trade relationships; see [Relationships Created Implicitly by a Trade Order](../resource-patterns.md#relationships-created-implicitly-by-a-trade-order).

---

## Choosing a Setup

The scenario used below: `GROUP` above `NORTH` and `SOUTH`; stores `N1` and `N2` under `NORTH`; `S1` under `SOUTH`.

| Setup | What to set | Result |
|---|---|---|
| **A. One assortment for the chain** | Tenant-wide default = `GROUP` | Every store and company below the root uses `GROUP` |
| **B. One per company** | `NORTH` = `NORTH`, `SOUTH` = `SOUTH` | `N1`, `N2` use `NORTH`; `S1` uses `SOUTH` |
| **C. Store-owned** | `N2` = `null` | `N2` uses its own, whatever is set above |
| **Mixed** | Any combination | The nearest setting wins per store |

A standard single-company tenant is usually setup A: the default names the company, every store reads that company as `assortmentOwner`, the company reads `null`, and every store's own `assortment` is empty.

### An owner must use its own assortment

Resolution stops at the owner it finds. If that owner itself follows another owner, what is assigned to it lands elsewhere and its stores do not get it.

With `S1` set to `SOUTH` explicitly and `SOUTH` set to `GROUP`:

| Request | Result |
|---|---|
| `GET` the owner of `S1` | `SOUTH` |
| `GET` the owner of `SOUTH` | `GROUP` |
| A product assigned to `SOUTH` | lands on `GROUP` |
| A product assigned to `S1` | lands on `SOUTH` |
| `/stores/S1/assortmentOwner/assortment` | the second product only |
| The till of `S1` | accepts the second, refuses the first |

**The rule:** point stores and companies only at an owner that uses its own assortment.

- Setups A, B and C as written all keep the rule
- The likely way to break it: a tenant default is set, and a store is pointed at its company without the company being set to itself. The company then follows the default. Set the company to itself first, as in setup B
- To check an owner: `GET /v1/companies/{owner}~with(assortmentOwner)` must read `null`

---

## Putting Products into Assortments

### The default owner on create

A new product node whose body has no `assortmentOwners` array is put into the assortment of the owner of the key's node.

- The key's node is `node` on the [API key](../credentials.md#api-key-credentials) or [OAuth2 client](../credentials.md#oauth2-clients). [The key's own node and its owner](#the-keys-own-node-and-its-owner) shows how to read it
- A key on a store that follows a company puts the product on the company. A key on a company that uses its own assortment puts it on that company
- A key without a node gives no default. The product is in no assortment
- `"assortmentOwners": null` counts as no member
- The default applies when the request creates the node: `POST`, `PUT` on the collection and `PUT` on the element. A later `PATCH`, or a `POST` that matches an existing product, adds nothing
- It holds for every kind of node: products, families and the variants created inside them, groups, categories, brands, sets and packages
- The entry made by the default is a full one. The till accepts it

| Body on create, key whose node uses `NORTH`'s assortment | Lands in |
|---|---|
| no `assortmentOwners`, no `assortmentContexts` | `NORTH` |
| `"assortmentOwners": null` | `NORTH` |
| `assortmentContexts: [SOUTH]` only | `NORTH` **and** `SOUTH` |
| `"assortmentOwners": []` | none |
| `assortmentOwners: [SOUTH]` | `SOUTH` |
| `"assortmentOwners": []` and `assortmentContexts: [SOUTH]` | `SOUTH` |

**The rule:** only an `assortmentOwners` array switches the default off. To place a product in named assortments with article numbers, send `"assortmentOwners": []` together with `assortmentContexts`.

### Naming the owners

```bash
POST /v1/products
[{
  "identifiers": {"com.example.sku": "P1"}, "name": "P1", "status": "Active",
  "assortmentOwners": [],
  "assortmentContexts": [
    {"owner": {"identifiers": {"com.example.companyId": "NORTH"}}, "articleNumber": "N-100"},
    {"owner": {"identifiers": {"com.example.companyId": "SOUTH"}}, "articleNumber": "S-900"}
  ]
}]

# 200
[{"@type": "product", "identifiers": {…}, "name": "P1", "gtin": [], "status": "Active",
  "assortmentOwners": [{"@type": "company", "identifiers": {…}, "name": "North"},
                       {"@type": "company", "identifiers": {…}, "name": "South"}],
  "assortmentContexts": [
    {"@type": "assortment context", "owner": {"@type": "company", "identifiers": {…}, "name": "North"}, "articleNumber": "N-100"},
    {"@type": "assortment context", "owner": {"@type": "company", "identifiers": {…}, "name": "South"}, "articleNumber": "S-900"}]}]
```

On an existing product:

```bash
POST  /v1/products/com.example.sku=P1/assortmentContexts          # add, one element per owner
[{"owner": {"identifiers": {"com.example.companyId": "NORTH"}}, "articleNumber": "N-100"}]

PATCH /v1/products/com.example.sku=P1/assortmentContexts/com.example.companyId=NORTH
{"articleNumber": "N-101"}                                         # adds the product if it was not there

POST  /v1/products/com.example.sku=P1/assortmentOwners             # add without any context data
[{"identifiers": {"com.example.companyId": "SOUTH"}}]
```

| Fact | Detail |
|---|---|
| A `PATCH` on a context of an owner that does not have the product adds the product to that owner | |
| Arrays in a product `PUT` or `PATCH` body only add, for both members | Owners left out stay. `"assortmentOwners": []` in such a body changes nothing |
| The owner in a path can be an external identifier or the database key | |
| `owner` in the body of a context `PATCH` is ignored | The rest of the body is stored |
| Two products can carry the same article number under one owner | Nothing enforces uniqueness |
| A person can be an owner | |
| A context without `owner` answers `500` | Nothing is stored; see [Error responses](#error-responses) |

**Name the owner, not a store that follows it.** Naming a store that uses another owner's assortment writes to that owner:

| Request naming such a store | Answer |
|---|---|
| Product create | The response shows the owner the store uses |
| `POST …/assortmentContexts` | The response shows the store as `owner` and no `articleNumber`. The data is on the owner the store uses |
| `GET …/assortmentContexts/{store}` | `200` with `owner` only. The owner's id returns the data |

> **Current behaviour.** An unknown owner identifier creates a nameless agent and assigns the product to it, `200`. `GET` the owner first, or read the product's `assortmentOwners` back. [Scopes](#traps) has what a narrower key gets. This may change.

### Groups, families, categories and brands

The product paths in this guide work the same on `/v1/product-groups`, `/v1/product-families`, `/v1/product-categories` and `/v1/brands`.

| What happens | Result |
|---|---|
| A group, family, category or brand is assigned to an owner from the product side | Each node under it at that time gets its own entry for that owner |
| A node is created under it later | Covered only |
| A node is moved under it later | Covered only |
| A node without its own entry is moved out of it | No longer in the assortment |

- "From the product side" means `assortmentOwners` or `assortmentContexts` on the group, family, category or brand, or the default owner when it is created
- A covered node gets its own entry when any context field is written for the owner, or when the owner is posted to its `assortmentOwners`

---

## What Makes a Product Show Up and Sell

"Assigned" means from the product side: `assortmentOwners`, `assortmentContexts`, or the default owner on create.

| | Assigned | Covered only | Not in the assortment |
|---|---|---|---|
| Listed in `/{owner}/assortment` | yes | yes | no |
| A context for the owner is listed on the node | yes | yes, without data of its own | no |
| Owner listed in the node's `assortmentOwners` | yes | no | no |
| Node listed in the owner's `assortmentRoots` | yes | no | no |
| Shown in the back-office product list | yes | no | no |
| Accepted by the till | yes | no | no |

A covered node that once had its own entry shows the article number of that entry in its context. A covered node that never had one shows none.

The till has three more conditions. For a product that is assigned:

| Product | Till |
|---|---|
| `status` `Active`, not hidden | accepts |
| `status` `Inactive` | refuses |
| `hidden: true` | refuses |
| `hiddenInPos: true` | refuses |
| `discontinued: true` on the owner's context | accepts in an ordinary sale; see [Editing a context](#editing-a-context) |

**The rule:** a product sells in a store when it is `Active`, not `hidden`, not `hiddenInPos`, and has been assigned to the owner that the store uses. Do not rely on the group. Assign each new product explicitly, also when its group is already in the assortment.

```bash
GET /v1/products/com.example.sku=P1/assortmentOwners/com.example.companyId=NORTH
# the owner object = own entry; null (200) = no own entry
```

---

## The Agent-Side Lists: `assortment` and `assortmentRoots`

| Member | What it lists | Write |
|---|---|---|
| `assortment` | Every node in the agent's assortment: assigned and covered | Read-only |
| `assortmentRoots` | The nodes with their own entry. "Roots" is a misleading name: it is not only top-level nodes | Do not write; see below |

On an agent whose nodes all have their own entry, the two lists are the same length. A supplier that was given families and groups has a long `assortment` and a short `assortmentRoots`.

### Do not write `assortmentRoots`

> **Current behaviour.** This is a known platform defect and may change.

The API accepts `POST`, `DELETE` and `PUT` on `assortmentRoots`. What it changes is the list that the API and the back office show. It does not change what the till accepts.

| Write | The API | The back-office product list | The till |
|---|---|---|---|
| `POST /v1/companies/{owner}/assortmentRoots` with a product | own entry everywhere: `assortmentRoots`, `assortmentOwners`, a context | lists it | refuses it |
| `DELETE /v1/companies/{owner}/assortmentRoots/{product}` on an assigned product | gone everywhere, contexts `[]` | does not list it | still accepts it |
| `PUT /v1/companies/{owner}/assortmentRoots` with `[]` | everything gone, `assortment` empty | | still accepts all of it |
| `POST /v1/stores/{store}/assortmentRoots` on a store that follows another owner | lands on the store itself, not on the owner | | refuses it |

Once an entry has been written this way, the product-side requests no longer correct it:

| After | Request | Answer | Effect |
|---|---|---|---|
| a `POST` to `assortmentRoots` | `DELETE /v1/products/{id}/assortmentOwners/{owner}` | `200 {"deletedCount": 1, "info": "Deleted 1 items"}` | none, the entry stays |
| a `POST` to `assortmentRoots` | `PATCH …/assortmentOwners {"remove": […]}`, `PUT …/assortmentOwners []` | `200`, the owner still in the list | none |
| a `POST` to `assortmentRoots` | `POST /v1/products/{id}/assortmentOwners` naming the same owner | `200` | none, the till still refuses |
| a `DELETE` on `assortmentRoots` | `POST /v1/products/{id}/assortmentOwners` naming the owner | `200`, the owner echoed | none: not back in the lists |
| a `DELETE` on `assortmentRoots` | `DELETE /v1/products/{id}/assortmentOwners/{owner}` | `200 null` | none, the till still accepts |

None of the queries in [Reading assortments](#reading-assortments) can see the difference. A product added through `assortmentRoots` reads as assigned in every one of them.

**If an integration already writes `assortmentRoots`, the two repairs are:**

| State | Repair |
|---|---|
| Added through `assortmentRoots`: listed, refused by the till | `PATCH /v1/products/{id}/assortmentContexts/{owner}` with any field, for example the article number |
| Removed through `assortmentRoots`: not listed, still sold | `POST /v1/companies/{owner}/assortmentRoots` with the node. The article number is kept. After that, remove it from the product side if it should go |

### Writes on `assortment`

> **Current behaviour.** The `500` is a known defect and may change. Nothing is stored in any of these.

| Request | Answer |
|---|---|
| `POST …/assortment` with a node that is not in the assortment | `500` `Property 'assortment' is readonly.` |
| `POST …/assortment` with a node that is already in it | `200`, the node |
| `PUT …/assortment`, `PATCH …/assortment {"add": […]}` | `500`, the same message |
| `DELETE …/assortment/{node}` | `500`, the same message |
| `DELETE …/assortment` | `200 {"deletedCount": 0, "info": "Nothing happened"}` |

---

## Reading Assortments

### The assortment a store actually uses

```bash
GET /v1/stores/com.example.storeId=N1~with(assortmentOwner)
# assortmentOwner is an agent  ->  GET /v1/stores/com.example.storeId=N1/assortmentOwner/assortment
# assortmentOwner is null      ->  GET /v1/stores/com.example.storeId=N1/assortment
```

| Request | Store uses another owner's | Store uses its own |
|---|---|---|
| `/stores/{id}/assortment` | the store's own entries: `[]` for most stores, old entries for a store that once had its own | the list |
| `/stores/{id}/assortmentOwner/assortment` | the list | `null`, `200` |

- `/stores/{id}/assortment` is not a test for which owner the store uses. Read `assortmentOwner`
- Reading an assortment needs a products scope. Without one the list is `[]`; see [Scopes](#scopes)

### Forms that work

```bash
# an assortment with the owner's own article number and flag per row
GET /v1/companies/{owner}/assortment~just(name,articleNumber:assortmentContexts/com.example.companyId=NORTH/articleNumber,discontinued:assortmentContexts/com.example.companyId=NORTH/discontinued)
# -> [{"@type":"product group","name":"Group G","articleNumber":null,"discontinued":false},
#     {"@type":"product","name":"OWN","articleNumber":"N-OWN","discontinued":false}, …]

GET /v1/companies/{owner}/assortment~where(status)                  # keeps products and families
GET /v1/companies/{owner}/assortment~where(status=Active)
GET /v1/companies/{owner}/assortment~count
GET /v1/companies/{owner}/assortment/com.example.sku=P1             # the product, or null (200)

# paging and order
GET /v1/companies/{owner}/assortment~orderBy(name)~take(50)~just(name)
GET /v1/companies/{owner}/assortment~orderBy(name)~skip(50)~take(50)~just(name)
GET /v1/companies/{owner}/assortment~orderBy(name:desc)~just(name)
GET /v1/stores/{id}/assortmentOwner/assortment~where(status=Active)~orderBy(name)~take(50)~just(name)

# products by owner and by article number
GET /v1/products~where(assortmentOwners/com.example.companyId=NORTH)              # own entry under NORTH
GET /v1/products~where(assortmentOwners/key=<database key>)                       # the same, by key
GET /v1/products~where(assortmentContexts/com.example.companyId=NORTH/articleNumber=N-3)   # by article number
GET /v1/products~where(assortmentContexts/<database key>/articleNumber=N-3)       # the same, owner by key
GET /v1/products~where(assortmentContexts/com.example.companyId=NORTH/articleNumber)       # has one
GET /v1/products~where(assortmentContexts~where(articleNumber=S-3)~count>0)       # any owner
GET /v1/products~where(assortmentOwners~count>1)
GET /v1/products~either(assortmentContexts/com.example.companyId=NORTH/articleNumber=N-3,assortmentContexts/com.example.companyId=SOUTH/articleNumber=S-2)

# discontinued under one owner
GET /v1/companies/{owner}/assortment~where(assortmentContexts/com.example.companyId=NORTH/discontinued=true)
GET /v1/companies/{owner}/assortment~where(assortmentContexts/com.example.companyId=NORTH/discontinued=false)

# one product's contexts
GET /v1/products/{id}/assortmentContexts~just(articleNumber,owner/name)
GET /v1/products/{id}/assortmentContexts/com.example.companyId=NORTH/articleNumber   # "N-3"
GET /v1/products/{id}/assortmentContexts~where(discontinued=true)

# which agents have an assortment at all
GET /v1/companies~where(assortment~count>0)~just(name,n:assortment~count)
```

- `assortmentOwners` follows [gotcha 56](../common-gotchas.md#56-a-filter-through-an-array-relation-takes-the-identifier-directly-under-the-relation-name): the identifier sits directly under the name
- `~where(status)` keeps the nodes that have a status, which are products and families. Groups, categories and packages are dropped
- `discontinued=false` also returns covered nodes and groups. Their flag reads `false`
- `discontinued=true` returns the nodes that carry the flag themselves. A product under a discontinued group is not among them
- On a context, `owner` and `articleNumber` come by default. `primarySupplier` and `discontinued` need `~with(primarySupplier,discontinued)` or `~withAll`
- In an assortment a brand is listed with `"@type": "product node"`
- An assortment has no `keys` array: `/assortment/keys` answers `404`

### Finding the products that nobody sees

```bash
# no own entry under any owner: missing from every back office and every till
GET /v1/products~where(assortmentOwners~count=0)~just(name)

# in no assortment at all, not even covered by a group
GET /v1/products~where(assortmentContexts~count=0)~just(name)

# in an owner's assortment, but with no own entry under any owner
GET /v1/companies/{owner}/assortment~where(status)~where(assortmentOwners~count=0)~just(name)

# an owner's assortment with a marker per row: "own" is present for an own entry, absent for a covered node
GET /v1/companies/{owner}/assortment~just(name,own:assortmentOwners/com.example.companyId=NORTH/name)
# -> [{"@type":"product","name":"OWN","own":"North"}, {"@type":"product","name":"COVERED"}, …]
```

The third query counts own entries under any owner. For one owner use the fourth.

### Forms that match nothing

These answer `200 []` whatever the data:

| Form | Use instead |
|---|---|
| `~where(assortmentOwners/identifiers/com.example.companyId=NORTH)` | `assortmentOwners/com.example.companyId=NORTH` |
| `~where(assortmentOwners/name=North)`, `~where(assortmentOwners/name=~Nor)` | the owner's identifier |
| `~where(assortmentContexts/owner/name=South)` | `assortmentContexts/{owner id}/…` |
| `~where(assortmentContexts/articleNumber=S-900)` | `assortmentContexts/{owner id}/articleNumber=S-900`, or the nested `~where` for any owner |
| `~where(assortmentContexts/discontinued=true)` | `assortmentContexts/{owner id}/discontinued=true` |
| `~where(!assortmentOwners/com.example.companyId=NORTH)` | the `own` marker above, filtered in the client |
| `~where(!assortmentContexts/com.example.companyId=NORTH/discontinued)` | `…/discontinued=false` |
| `~where(@type=product)` inside an assortment | `~where(status)` |

- `~where(assortmentContexts/com.example.companyId=NORTH/owner)` matches every product
- Negation works on the single reference of a store or company, `~where(!assortmentOwner)`. It does not work through the two array members

### What is not a membership test

`GET /v1/products/{id}/assortmentContexts/{owner}` answers `200` for an owner that does not have the product, with `owner` only. To test membership use one of these:

```bash
GET /v1/companies/{owner}/assortment/com.example.sku=P1                          # in the assortment: the product, or null
GET /v1/products/com.example.sku=P1/assortmentOwners/com.example.companyId=NORTH # own entry: the owner, or null
```

---

## Editing a Context

```bash
PATCH /v1/products/com.example.sku=P1/assortmentContexts/com.example.companyId=NORTH
{"articleNumber": "N-101", "discontinued": true,
 "primarySupplier": {"identifiers": {"com.example.companyId": "SUP"}}}

# 200
{"@type": "assortment context",
 "owner": {"@type": "company", "identifiers": {…}, "name": "North"},
 "articleNumber": "N-101",
 "primarySupplier": {"@type": "company", "identifiers": {…}, "name": "Supplier"},
 "discontinued": true}
```

| Member | Type | Notes |
|---|---|---|
| `owner` | agent | The address of the context. Cannot be changed |
| `articleNumber` | string | The owner's own number for the node. `null` clears it |
| `primarySupplier` | company | Who this owner buys the node from. `null` clears it |
| `discontinued` | boolean | A flag per owner. v26.1.9 and later |

| Fact | Detail |
|---|---|
| Other owners' contexts are untouched | |
| `{"articleNumber": null}` and `{"primarySupplier": null}` clear the member | The product stays in the assortment |
| `discontinued` does not remove anything | The product stays in `/assortment` |
| The till still sells a discontinued product in an ordinary sale | |
| The till refuses to put a discontinued product on a customer order (collect in store, ship to customer) | The flag on a group counts for the products under it |
| The flag on a group is not shown on the contexts of the products under it | They read `false` |
| `minimumOrderQuantity` is gone (v26.1.5 and later) | A write is accepted and dropped; naming it in `~just` reads `null` |

`discontinued` is a member of the context, not of the product. `GET /v1/products~where(discontinued)` does not find discontinued products; filter through the context of a named owner as in [Forms that work](#forms-that-work).

---

## Removing a Product from an Assortment

Only `assortmentOwners` removes:

```bash
DELETE /v1/products/com.example.sku=P1/assortmentOwners/com.example.companyId=SOUTH
# 200 {"deletedCount": 1, "info": "Deleted 1 items"}

PATCH  /v1/products/com.example.sku=P1/assortmentOwners
{"remove": [{"identifiers": {"com.example.companyId": "SOUTH"}}]}

PUT    /v1/products/com.example.sku=P1/assortmentOwners      # replaces the whole owner list
[{"identifiers": {"com.example.companyId": "NORTH"}}]

PUT    /v1/products/com.example.sku=P1/assortmentOwners      # removes the product from every assortment
[]
```

Nothing on `assortmentContexts` removes:

| Request | Answer | Effect |
|---|---|---|
| `DELETE …/assortmentContexts/{owner}` | `200 {"deletedCount": 0, "info": "Nothing happened"}` | none |
| `PATCH …/assortmentContexts` with `{"remove": […]}` | `200`, the unchanged list | none |
| `PUT …/assortmentContexts/{owner}` with `null` | `204` | none |
| `PUT …/assortmentContexts` with an array | `200 [null]` | none, not even an update |

| Fact | Detail |
|---|---|
| Remove and add again | `articleNumber` and `primarySupplier` come back, `discontinued` is reset to `false` |
| After a removal the context list no longer has the owner | A `GET` on that owner's context still shows the old values. It is [not a membership test](#what-is-not-a-membership-test) |
| The owner list includes suppliers and manufacturers | A `PUT` naming only your own companies drops the supplier, and the product leaves the supplier's assortment |
| `PUT …/assortmentOwners` with `[]` and `PATCH …/assortmentOwners {"replace": []}` empty the list | |
| Removing a group from an owner | Leaves the own entries below it in place |
| An entry made through `assortmentRoots` is not removed by any of the requests above | See [the two repairs](#do-not-write-assortmentroots) |

---

## Changing the Owner of a Store

When a store moves from its own assortment to another owner's and back:

- Nothing moves. The store's old entries stay on the store and are out of use while it follows the other owner
- `/stores/{id}/assortment` still lists them. `/stores/{id}/assortmentOwner/assortment` lists the owner's
- Switching back brings the old entries into use again, unchanged
- While the store follows the other owner, a `GET` on a context addressed by the store's id shows the store's old context, and a `PATCH` on the same address writes the owner's context

**What to do:** after a switch, assign the products to the new owner yourself, and always address contexts by the owner's id, never the store's.

The owner a store follows also changes when the store is moved to another company, or when a setting above it changes. The same applies.

---

## Suppliers and Manufacturers as Owners

A product's `assortmentOwners` mixes own companies, stores, suppliers and manufacturers. One product can read like this:

```bash
GET /v1/products/{id}~just(name,assortmentOwners~just(name),assortmentContexts~just(owner/name,articleNumber))

{"@type": "product", "name": "Phone 128GB Black",
 "assortmentOwners": [{"@type": "company", "name": "Our Company"},
                      {"@type": "company", "name": "Phone Distributor"}],
 "assortmentContexts": [
   {"@type": "assortment context", "owner": "Our Company", "articleNumber": "6436987911"},
   {"@type": "assortment context", "owner": "Phone Distributor", "articleNumber": "7675798231"},
   {"@type": "assortment context", "owner": "Phone Manufacturer", "articleNumber": null}]}
```

- Our number, the distributor's number, and a third context without a number: the manufacturer was given the product's family, so the product is covered there
- `primarySupplier` on your context names who you buy from. Setting it does not put the product into the supplier's assortment and creates no supplier relation
- Filter by owner when reading, and never replace the owner list with your own companies only; see [Removing a product](#removing-a-product-from-an-assortment)
- Supply relations themselves are in [Purchasing](purchasing.md)

---

## Scopes

### What each task needs

| Task | Scopes that work |
|---|---|
| Set `assortmentOwner` on a store or company | `supply-chains:write` |
| Tenant-wide default, read and write | `config` |
| Create products that take the default owner | `products:write` |
| Name owners or write contexts | `products:write` plus one of `supply-chains:read`, `suppliers:read`, `customers:read`, `users:read`, `supply-chains:write` |
| Read contexts with their owners | `products:read` plus `supply-chains:read` or `suppliers:read`; or `read:api` |
| Read an assortment | a scope that reaches the agent, plus `products:read` |
| Address any company or agent by id | `supply-chains:write`. No read scope does |

### The key's own node and its owner

| Request | Scopes | Answer |
|---|---|---|
| `GET /v1/store~with(assortmentOwner)`, `GET /v1/company~with(assortmentOwner)` | `org:read` plus `supply-chains:read`; or `read:api` | the node with its owner |
| `GET /v1/store/assortmentOwner/assortment` | the same plus `products:read`; or `read:api` | the assortment the store uses |
| `GET /v1/us~with(assortmentOwner)` | `me` plus `supply-chains:read` | the node with its owner |
| `GET /v1/us` | `read:api` | `404` |

### Which stores a read key reaches

| Key | Request | Answer |
|---|---|---|
| `org:read` alone, key on company `NORTH` | `GET /v1/stores` | the stores of `NORTH` |
| `org:read` plus one of `supply-chains:read`, `suppliers:read`, `customers:read`, `users:read`; or `read:api`. Key on a company, on a store, or without a node | `GET /v1/stores` | every store |
| the same, key on store `N1` | `GET /v1/stores/{S1}` | the store |
| the same plus `products:read`, key on store `N1` | `GET /v1/stores/{S1}/assortmentOwner/assortment` | the list |

### Traps

All `200` unless stated.

| Key | Request | What happens |
|---|---|---|
| `products:write` alone | create with `assortmentContexts` | `500` `Cannot read properties of undefined (reading 'identifiers')`, nothing created |
| `products:write` + `org:read` | create with `assortmentContexts`, owner inside the key's own company | the same `500` |
| `products:write` alone | create with `assortmentOwners: [SOUTH]` | created, in no assortment, and no default either |
| `products:write` + `supply-chains:read` | create with an unknown owner in `assortmentOwners` | `400` `Found no matching 'agent' using this index. Check identifiers.`, nothing created |
| `products:write` + `supply-chains:read` | create with an unknown owner in `assortmentContexts` | created, a nameless agent is created and made the owner |
| `products:read` alone | read contexts | contexts come without `owner`, `assortmentOwners` is `[]` |
| `products:read` + `org:read` | read contexts | `owner` only where the owner is the key's own node; none at all for a key on a store |
| `org:read` alone, or `me` alone, key on a store | read `assortmentOwner` | `null`, although the store follows a company |
| `supply-chains:write` alone | `GET /v1/companies/{id}/assortment` | `[]`, although the assortment has nodes |
| `supply-chains:write` alone | `POST` or `DELETE` on `assortmentRoots` | `200 [[]]` or `deletedCount 0`, nothing stored |
| any read scope | write | nothing stored ([gotcha 41](../common-gotchas.md#41-a-write-under-a-read-only-scope-is-a-silent-200)) |
| `supply-chains:read` alone | `PATCH /v1/stores/{id}` | `404` |

Three of them read as success and matter most. With too narrow a key:

- "uses its own assortment" and "owner not visible to this key" look the same
- an empty assortment and "no products scope" look the same
- a product can be created into no assortment at all

The `500`s are current behaviour and may change.

---

## Error Responses

```json
{"@type": "internal error", "error": "Internal server error.",
 "details": "Property 'assortment' is readonly."}

{"@type": "internal error", "error": "Internal server error.",
 "details": "Cannot read properties of undefined (reading 'identifiers')"}

{"@type": "failed indexing",
 "error": "Found no matching 'agent' using this index. Check identifiers.",
 "usedIndex": {"com.example.companyId": "TYPO"},
 "suggestion": "Check 'usedIndex' above. Ensure that those are the correct identifiers and that an object of type 'agent' exists with those identifiers.",
 "indexerOwner": "agents",
 "indexType": "'COS database key' or 'common identifiers'"}

{"@type": "not found", "error": "The requested resource was not found.",
 "url": "/v1/companies/com.example.companyId=NORTH"}
```

| Status | When |
|---|---|
| `500`, first body | a write on `/assortment` |
| `500`, second body | a context without `owner`; a context whose owner the key cannot reach |
| `400` | an unknown owner in `assortmentOwners`, for a key that cannot create agents |
| `404` | a company or agent by id under a read scope; `PATCH` on a product that does not exist; `/v1/us` under `read:api` |

Both `500`s are current behaviour and may change. Do not match on the `details` text.

---

## Endpoint Matrix

| Task | Method and path |
|---|---|
| Read a store's owner | `GET /v1/stores/{id}~with(assortmentOwner)` |
| Set the owner of a store or company | `PATCH /v1/stores/{id}` or `/v1/companies/{id}`, body `{"assortmentOwner": {…}}` |
| Make a store use its own | `PATCH /v1/stores/{id}` `{"assortmentOwner": null}` |
| Tenant-wide default | `GET`, `PATCH /v1/config/root-trade-relationship` |
| The key's own node and owner | [The key's own node and its owner](#the-keys-own-node-and-its-owner) |
| An owner's assortment | `GET /v1/stores/{id}/assortment` or `/v1/companies/{id}/assortment` |
| A store's effective assortment | [The assortment a store actually uses](#the-assortment-a-store-actually-uses) |
| Add a product to an owner, with data | `POST /v1/products/{id}/assortmentContexts` |
| Add a product to an owner, no data | `POST /v1/products/{id}/assortmentOwners` |
| Edit one owner's data | `PATCH /v1/products/{id}/assortmentContexts/{owner}` |
| Remove a product from an owner | `DELETE /v1/products/{id}/assortmentOwners/{owner}` |
| Is it in the assortment | `GET /v1/companies/{id}/assortment/{product}`, same under `/v1/stores/{id}` |
| Does it have its own entry | `GET /v1/products/{id}/assortmentOwners/{owner}` |
| Which products nobody sees | [Finding the products that nobody sees](#finding-the-products-that-nobody-sees) |

The product paths work the same on `/v1/product-groups`, `/v1/product-families`, `/v1/product-categories` and `/v1/brands`.

---

## Pitfalls

1. A product created by a key without a node, or with `"assortmentOwners": []`, is in no assortment. It is missing from the back office and the till. This is the likely cause of "I created it through the API and cannot find it". [Finding the products that nobody sees](#finding-the-products-that-nobody-sees) finds them.
2. `assortmentContexts` in a create body does not switch the default owner off. Only an `assortmentOwners` array does.
3. A product covered by its group is not enough. It needs its own entry.
4. A write to `assortmentRoots` changes what the API and the back office list, and not what the till sells.
5. A product also has to be `Active`, not `hidden` and not `hiddenInPos` to sell.
6. `/stores/{id}/assortment` lists the store's own entries, not the assortment it uses.
7. `assortmentOwner: null` means "itself", not "inherit". `DELETE` on it reports a deletion and clears nothing.
8. An owner that follows another owner gets nothing of what is assigned to it.
9. A company without `parent`, or a store without `owner`, is outside the tree. The tenant default does not reach it.
10. A misspelt owner identifier creates a nameless agent, `200`. Read the owner back, or `GET` it first.
11. A context addressed by a store's id reads one record and writes another.
12. Nothing on `assortmentContexts` removes.
13. `PUT …/assortmentOwners` replaces the list, suppliers included.
14. `minimumOrderQuantity` is gone. A write is accepted and dropped; naming it in `~just` reads `null`.
15. Filters through `assortmentOwners` and `assortmentContexts` by anything but an identifier match nothing, and so does a negation through them.
16. Writes on `/assortment` answer `500`. A context without `owner` answers `500`.
17. Too narrow a key reads as an empty assortment or as "uses its own"; see [Traps](#traps).
18. Article numbers are not unique within an owner.
19. Changing the owner that a store follows moves no products.
20. `discontinued` on a group does not show on the products under it, and the till counts it for them all the same.

The numbered versions with `RIGHT` / `WRONG` requests are [gotchas 62–72](../common-gotchas.md#62-a-product-created-through-the-api-can-land-in-no-assortment).

---

## Related Guides

- [Products](products.md) — the product nodes themselves, `status`, `hidden`, `hiddenInPos`
- [Customers](customers.md) — companies, stores and the other agents that own assortments
- [Purchasing](purchasing.md) — supply relations and purchase orders
- [Prices](prices.md) and [Stock](stock.md) — what an assortment does not decide
- [Resource Patterns → Relationships Created Implicitly by a Trade Order](../resource-patterns.md#relationships-created-implicitly-by-a-trade-order) — `supplierOwner` and `customerOwner`, the siblings of `assortmentOwner` on the same config resource
- [Credentials](../credentials.md#api-key-credentials) — the `node` of a key, which decides where new products land
- [Common Gotchas 62–72](../common-gotchas.md#62-a-product-created-through-the-api-can-land-in-no-assortment)
