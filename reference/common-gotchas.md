# Common API Gotchas

Known pitfalls and their solutions when working with the CommerceOS API. This is mainly for AI agents who tend do make mistakes with these things, but us humans can benefit too :)

---

## 1. No GTIN/PLU Indexer on Products

Products cannot be indexed by GTIN or PLU directly.

```bash
# WRONG - No GTIN indexer exists
GET /products/gtin=7312345678901

# RIGHT - Use ~where() to filter by GTIN
GET /products~where(gtin=7312345678901)~first
```

---

## 2. Nested Paths Use camelCase

Top-level collections use kebab-case, but nested member paths use camelCase:

```bash
# RIGHT - camelCase for member paths
GET /agents/{key}/customerRelations
GET /product-categories/{key}/childCategories

# WRONG - kebab-case for member paths
GET /agents/{key}/customer-relations  # Will not work
```

---

## 3. ~reverse() and ~any() Don't Exist

```bash
# WRONG - ~reverse() doesn't exist
GET /v1/products~orderBy(name)~reverse()

# RIGHT - Use :desc suffix
GET /v1/products~orderBy(name:desc)

# WRONG - ~any() doesn't exist (neither standalone nor inside ~where)
GET /v1/products~any(status=Active)
GET /v1/products~where(labels~any(identifiers/labelId=sale))

# RIGHT - Use ~where() for flat property filtering
GET /v1/products~where(status=Active)~first

# RIGHT - For sub-collection filtering (e.g. labels), expand and filter client-side
GET /v1/products~with(labels)~take(50)
```

---

## 4. Store Uses `owner`, Not `parent`

Stores use `owner` to reference the owning company:

```bash
# RIGHT
POST /stores '{"owner": {"identifiers": {...}}, ...}'

# WRONG
POST /stores '{"parent": {"identifiers": {...}}, ...}'
```

---

## 5. POS Terminal Uses `associatedNode`, Not `store`

```bash
# RIGHT
POST /pos-terminals '{"associatedNode": {"identifiers": {...}}, ...}'

# WRONG
POST /pos-terminals '{"store": {"identifiers": {...}}, ...}'
```

---

## 6. Trade Relationship Uses `supplierAgent`/`customerAgent`

```bash
# RIGHT
POST /trade-relationships '{
  "supplierAgent": {"identifiers": {...}},
  "customerAgent": {"identifiers": {...}}
}'

# WRONG - supplier/customer without "Agent" suffix
POST /trade-relationships '{"supplier": {...}, "customer": {...}}'
```

---

## 7. Currency Must Be Referenced by Identifier

```bash
# WRONG
POST /prices '{"currency": "SEK", ...}'

# RIGHT
POST /prices '{"currency": {"identifiers": {"currencyCode": "SEK"}}, ...}'
```

---

## 8. Agent References Require Nested identifiers

Agent references require the `identifiers` wrapper object. The `@type` is optional—include it when you want to be explicit or when creating the agent itself.

```bash
# WRONG - identifiers must be nested under identifiers
POST /stores '{"owner": {"com.myapp.id": "123"}}'

# RIGHT - identifiers only (no @type needed for references)
POST /stores '{"owner": {"identifiers": {"com.myapp.id": "123"}}}'

# ALSO OK - explicit @type
POST /stores '{"owner": {"@type": "company", "identifiers": {"com.myapp.id": "123"}}}'
```

> **When to include @type:** Use `@type` when creating the referenced entity itself (e.g., `POST /companies`), or when referencing a polymorphic type where the system cannot infer the subtype. For simple owner/customer/supplier references to existing entities, identifiers alone are sufficient.

---

## 9. Parameterless Operators: No Empty Parentheses

Operators without parameters must be used WITHOUT parentheses:

```bash
# WRONG - Empty parentheses break the query
GET /products~first()   # Returns "not found"
GET /products~count()   # Error

# RIGHT - No parentheses
GET /products~first
GET /products~count
GET /products~map(status)~distinct
```

---

## 10. Products Belong to Groups via `parentGroup`

To add a product to a group, set the product's `parentGroup`:

```bash
# WRONG - This doesn't persist
POST /product-groups/{key}/members '{"identifiers": {...}}'

# RIGHT - Set parentGroup on the product
PATCH /products/{key} '{"parentGroup": {"identifiers": {...}}}'
```

---

## 11. Companies Don't Have `stores` Member

Companies do NOT have a `stores` array. Use trade-relationships or query stores:

```bash
# WRONG
GET /companies~with(stores)

# RIGHT - Query stores by owner
GET /stores~where(owner/identifiers/key=COMPANY_KEY)
```

---

## 12. Agents Don't Have `tradeOrders` or `stockTransactions`

Stores and other agents don't have direct order/transaction members:

```bash
# WRONG
GET /stores~with(tradeOrders)

# RIGHT - Query orders directly
GET /trade-orders~where(sellers/identifiers/key=STORE_KEY)
```

---

## 13. ~distinct Only Works on Primitives

```bash
# WRONG - No effect on object streams
GET /products~distinct

# RIGHT - Use ~distinctBy for objects
GET /products~distinctBy(status)

# Or map to primitive first
GET /products~map(status)~distinct
```

---

## 14. Use `contactMethods`, Not `contactPoints`

Agent contact information is under `contactMethods`:

```bash
# RIGHT
GET /people/com.test.id=123~with(contactMethods)
PATCH /people/com.test.id=123 '{"contactMethods": {"email": "new@example.com"}}'

# WRONG - contactPoints doesn't exist
GET /people/com.test.id=123~with(contactPoints)
```

Slots: `landlinePhone`, `mobilePhone`, `workPhone`, `email`

---

## 15. SQL Serializers Require Mapped Types

SQL output is available via `Accept: application/sql` or `Accept: application/vnd.ms-sqlserver.csv`, but **only works with mapped types** that emit `SqlStatement[]` arrays. Direct queries return JSON—the SQL serializers require pre-structured SQL statement output.

```bash
# WRONG - Direct queries don't produce SQL
GET /receipts~take(10)
Accept: application/sql
# Returns error: arrays/objects rejected without flattening

# RIGHT - Use a mapped type that emits SqlStatement[]
GET /receipts~take(10)~map(com.example.receipt-sql-export)
Accept: application/sql
# Returns: INSERT INTO receipts (...) VALUES (...);
```

**Key behaviors:**
- Arrays and nested objects are **rejected** by the SQL serializer unless your mapped type flattens them first
- Use `batchSize` parameter for streaming: `Accept: application/sql;batchSize=100`
- SQL Server CSV (`application/vnd.ms-sqlserver.csv`) uses BCP-compatible escaping

See [SQL Export](../features/sql-export.md) for mapped type examples and value conversion rules.

---

## 16. Body Indicator Navigation Patterns

The `@` marker in a URL path targets the request body to a specific endpoint. Path segments after `@` navigate through the result.

```bash
# Basic pattern: @target/navigation
PUT /agents/@find/results           # Send body to /agents/find, navigate to results

# Navigate into results by index
PUT /agents/@find/results/0         # First match
PUT /agents/@find/results/0/name    # Name of first match

# Operators work after navigation
PUT /agents/@find/results~take(5)~just(name,identifiers)
```

**Common finder endpoints:**
- `/agents/@find` - Agent lookup by email, phone, nationalId, or metaphone-based name filtering
- `/trade-orders/@find` - Order lookup by modifiedTag, customer, supplier, buyer, seller

---

## 17. Single-Result Aggregation with `$prior` + `"$first"`

To aggregate collection data into a single result (e.g., bundling all receipts with items/payments), use an array-body mapped type with `$prior` and the `"$first"` sentinel:

```json
// Mapped type body - aggregates collection into single bundle
[
  {
    "receipts": "$prior",
    "items": "$prior~flatMap(items)",
    "payments": "$prior~flatMap(payments)"
  },
  "$first"
]
```

```bash
# Returns a single object (not an array)
GET /receipts~take(100)~map(com.example.receipt-bundle)
# → {"receipts": [...], "items": [...], "payments": [...]}
```

**Key points:**
- `$prior` references the entire source collection within the mapped type body
- `"$first"` as the final array element triggers single-result extraction
- Without `"$first"`, `~map` returns one result per source item (array output)

---

## 18. Ternary Conditions in Mapped Types Test Existence

In mapped type ternary expressions, the condition tests for **existence**, not value comparison:

```json
{
  "result": "someField ? 'has value' : 'empty'"
}
```

This returns `'has value'` if `someField` exists and is truthy, not if it equals a specific value. For value comparisons, use `~where()` filtering before mapping.

---

## 19. Query Parameter Normalization Order

Query parameters (`?limit=…&orderby=…`) are translated to operators in a **fixed canonical order**, regardless of how they appear in the URL:

```
format → where → orderBy → fields → skip → take → simpleJust
```

This means sorting (`orderBy`) always runs **before** pagination (`skip`/`take`) when using query params—ensuring consistent page boundaries.

**Examples:**

```bash
# Query params: orderBy applied BEFORE skip/take
GET /products?offset=2&limit=3&orderby=name
# → Sorts all by name, then skips 2, then takes 3

# Operators: explicit left-to-right chaining (same result)
GET /products~orderBy(name)~skip(2)~take(3)
# → Sorts all, then skips 2, then takes 3

# Query params can be mixed with path operators
GET /products~where(status=Active)?orderby=name&limit=10
# → Filters active, sorts by name, takes 10
```

**Best practice:** Query params and operators can be freely mixed. The system normalizes everything into the canonical pipeline order before execution.

---

## 20. Product Identifiers Require Fully Qualified Namespace

Product references in trade orders (and elsewhere) require a **fully qualified namespace** on identifiers. Using bare keys like `"sku"` will fail.

```bash
# WRONG - bare "sku" key is not a valid identifier
{
  "items": [
    {"product": {"identifiers": {"sku": "PHONE-001"}}, "quantity": 1}
  ]
}

# RIGHT - use reverse-domain namespace
{
  "items": [
    {"product": {"identifiers": {"com.example.sku": "PHONE-001"}}, "quantity": 1}
  ]
}
```

Always use a namespaced key like `com.yourcompany.sku`, `com.myapp.productId`, etc.

---

## 21. Instance-Tracked Items: Order and Type Requirements

When using instance tracking (IMEI, serial numbers), the item order matters:

```bash
# WRONG - MobilePlan before MobileDevice
{
  "items": [
    {"product": {"identifiers": {"com.example.sku": "PLAN-001"}}, "instances": [{"phoneImei": "123456789012345"}]},
    {"product": {"identifiers": {"com.example.sku": "PHONE-001"}}, "instances": [{"imei": "123456789012345"}]}
  ]
}

# RIGHT - MobileDevice before MobilePlan
{
  "items": [
    {"product": {"identifiers": {"com.example.sku": "PHONE-001"}}, "instances": [{"imei": "123456789012345"}]},
    {"product": {"identifiers": {"com.example.sku": "PLAN-001"}}, "instances": [{"phoneImei": "123456789012345"}]}
  ]
}
```

The `phoneImei` must reference an `imei` from an item that appears **earlier** in the items array.

> **Tip:** Products with instance tracking need the correct `instanceType` set during product creation (`"MobileDevice"` for devices, `"MobilePlan"` for plans). This is a product setup requirement, not something you specify on the order.

---

## 22. Clearing Array Properties

To remove all items from an array property (`stockRoots`, `labels`, `assortmentRoots`, `categories`, `prices`, etc.), use `PUT` with an empty array or `PATCH` with `replace: []`:

```bash
# Clear all stock roots from a store
PUT /v1/stores/{key}/stockRoots
[]

# Or equivalently via PATCH
PATCH /v1/stores/{key}/stockRoots
{"replace": []}

# WRONG - DELETE on the collection path removes a single item, not all
DELETE /v1/stores/{key}/stockRoots  # Not the same as clearing
```

This works for all `indexedArray` properties: `stockRoots`, `assortmentRoots`, `assortmentOwners`, `categories`, `labels`, `prices`, `users`, `customerGroups`, etc.

> **Note:** Individual items can be removed with `DELETE /v1/{collection}/{key}/{member}/{itemKey}`, and a specific subset with `PATCH {"remove": [...]}` — see gotcha 23 below and [Array Write Operations](resource-patterns.md#array-write-operations).

---

## 23. `replace` Can't Be Mixed with `add` or `remove`

`add` and `remove` may be sent together in one `PATCH` body — they are applied in a single transaction, and an element listed in both ends up **present** (`add` wins). `replace` sets the whole array, so it cannot be combined with either:

```bash
# RIGHT - add and remove together, one transaction
PATCH /v1/trade-orders/{key}/labels
{"add":    [{"identifiers": {"com.example.labelId": "vip"}}],
 "remove": [{"identifiers": {"com.example.labelId": "pending"}}]}

# RIGHT - replace on its own
PATCH /v1/trade-orders/{key}/labels
{"replace": [{"identifiers": {"com.example.labelId": "vip"}}]}

# WRONG - 400 Bad Request, and the array is left unchanged
PATCH /v1/trade-orders/{key}/labels
{"replace": [...], "remove": [...]}
```

Two more things that surprise people about `remove`:

- **It is idempotent.** Removing an element that isn't there — wrong identifier, or already removed — is a silent no-op: `200`, nothing changed, no error. Don't use the status code to detect "was it actually attached?"; read the array back if you need to know.
- **It matches by any identifier, not just the primary key.** `{"remove": [{"identifiers": {"com.example.labelId": "sync-pending"}}]}` resolves the element the same way `replace` does, so any namespaced identifier on the element works. Scalar `string[]` arrays (e.g. a label's `applicableOnlyTo`) take the raw values instead: `{"remove": ["Product"]}`.

---

## 24. Misspelled Operators Fail Silently

An operator the API doesn't recognize is **not** an error. It resolves to an empty value, and everything downstream of it in the pipe receives nothing. There is no 400, no diagnostic in the response, and — inside a sync webhook — no entry in the run log.

There are also **no operator aliases**: every operator must be spelled in full. `~array` is not `~arr`, `~first` is not `~one`, `~count` is not `~len`.

```bash
# WRONG - ~arr is not an operator; the payload silently becomes empty
"api/v1/stock-entries": "$this~map(com.example.entry)~arr"

# RIGHT
"api/v1/stock-entries": "$this~map(com.example.entry)~array"
```

This is a frequent cause of "the sync webhook reports success but no records were written" — the delivery succeeded, it just delivered nothing. When a mapped type or a webhook side-effect write produces an unexpectedly empty result, check the operator spelling against [`operators-catalog.md`](operators-catalog.md) before looking anywhere else.

Related: [gotcha 9](#9-parameterless-operators-no-empty-parentheses) — a parameterless operator written with empty parentheses (`~first()`) is a different failure and *does* misbehave visibly.

---

## 25. Stock Direction Works Differently on Adjustments and Entries

The two stock-writing resources take opposite kinds of input, and only one of them has a direction.

**`/v1/stock-adjustments` is delta-based and resolves a direction** from three inputs, highest precedence first:

1. the item's own `direction` (`"Increase"` / `"Decrease"`),
2. the `direction` on the item's `reason`,
3. the sign of `quantity` (positive ⇒ increase, negative ⇒ decrease).

The applied magnitude is always `|quantity|` — the sign is only ever read as a direction hint, never applied twice. A positive quantity with a `Decrease` reason means "decrease by N" and is perfectly valid. A **negative** quantity with an **`Increase`** direction — from the item or from the reason — is rejected with `400`, because a negative quantity can only decrease.

```bash
# RIGHT - explicit override on a bidirectional reason
{"reason": {...}, "quantity": 3, "direction": "Decrease"}   # removes 3

# RIGHT - sign decides when nothing above it does
{"reason": {...}, "quantity": -2}                            # removes 2

# WRONG - 400 Bad Request
{"reason": {...}, "quantity": -5, "direction": "Increase"}
```

**`/v1/stock-entries` is target-based and has no direction at all.** `physicalQuantity` is an absolute level; the server computes the signed delta against current stock. Sending a `direction` on an entry does nothing, and the submission's `reason` is audit metadata whose `direction` does **not** steer the movement — a `Decrease` reason used to raise a level from 4 to 8 simply increases to 8. `physicalQuantity` may itself be negative (negative balances are permitted): `-5` drives the level to −5, and a later `5` recovers it to 5. It is not a "decrease by 5" instruction.

Full rules: [Working with Stock → Direction and Sign Rules](working-with/stock.md#direction-and-sign-rules) and [Stock Entries → No direction on stock entries](stock-entries.md#no-direction-on-stock-entries).

---

## 26. Cursor Pagination Silently Skips Items on a Non-Unique Sort Field

A cursor walk asks for the next page with a strict `field > lastValue` filter and no secondary tiebreaker. Sort on a
field where several items share a value and every item on a page boundary except the last one is dropped — with no
error, and often with `X-Has-More: false` while records remain. The export just comes up short.

```bash
# WRONG - hundreds of products share each status value
GET /v1/products?limit=50&orderby=status

# RIGHT - unique per resource
GET /v1/products?limit=50&orderby=identifiers/key
```

`name` is not a safe substitute either: the same name can exist per currency or per store. Compound sorting is not a
workaround — an `orderby` listing more than one field is rejected with `400` once an `after` token is present.

Two related surprises in the same feature:

- **Streaming turns the walk off — and so does an export format.** With `Accept: application/json;stream=true` the body
  starts before the pagination headers could be computed, so `Link` / `X-Cursor-Next` / `X-Has-More` are never sent. The
  line-oriented formats (NDJSON, CSV, SQL) do not carry them either, streamed or buffered. An `after` token is still
  honored in every format, so the request succeeds and returns `limit` items — it just gives you nothing to continue
  from. Walk the pages with buffered JSON.
- **A `fields` projection may omit the sort field.** The API fetches it internally to compute the cursor and strips it
  back out, so `?orderby=identifiers/key&fields=name,status` paginates correctly and still returns only `name` and
  `status`.

Full rules: [Pagination → Cursor pagination](pagination.md#cursor-pagination).

---

## 27. Patching One Validity-Window Bound Can Invert the Window

A validity window is merged before it is validated: a bound you don't send keeps its stored value, and the check runs against the **resulting** window. So patching a single bound past its stored counterpart produces an inverted window and is rejected with `400` — `The end date, if specified, must be greater than the start date.` — leaving the stored window untouched.

```bash
# Rule currently valid 2026-03-01 → 2026-05-31

# WRONG - resulting window is 2026-09-01 → 2026-05-31; 400, nothing changes
PATCH /v1/discount-rules/com.example.discountRuleId=spring-sale
{"time": {"start": "2026-09-01T00:00:00"}}

# RIGHT - both bounds in one payload, validated and applied as a whole
PATCH /v1/discount-rules/com.example.discountRuleId=spring-sale
{"time": {"start": "2026-09-01T00:00:00", "end": "2026-11-30T23:59:59"}}
```

Sending both bounds together works no matter how far the window moves — there is no need to stage the change as "push `end` out first, then move `start`". (That two-step sequence is still valid; it is just extra round trips.)

**The same applies to every other start/end pair in the API**, even though the members are named differently and sit flat on the resource rather than inside a `time` object:

| Resource | Members |
|----------|---------|
| Price (`/v1/prices`) | `from` / `to` |
| Trade restriction (`/v1/trade-restrictions`) | `from` / `until` |
| Project reference (`/v1/trade-relationships/{key}/projectReferences`) | `validFrom` / `validTo` |
| Period window (`/v1/seasons`, `/v1/campaigns`) | `purchaseWindow.start` / `.end`, `salesWindow.start` / `.end` |

```bash
# Price valid 2026-02-01 → 2026-02-28, moved into June in one call
PATCH /v1/prices/com.example.priceId=PROD-001-PROMO
{"from": "2026-06-04T05:00:00Z", "to": "2026-06-16T21:59:00Z"}
```

One related detail: sending a bound as `null` **clears** it rather than leaving it alone, making the window open-ended in that direction.

Full rules: [Resource Patterns → Validity Windows](resource-patterns.md#validity-windows), and [Validity Window (`time`)](resource-patterns.md#validity-window-time) for the trade-rule form.

---

## 28. Commas Inside String Literals Split Operator Arguments

A single-quoted [string literal](primitives.md#string-literals-as-a-starting-point) can be used as a selector and continued with members (`'Brød & Melk'/ld`). But the URL is parsed before the literal is: a bare `,` inside the quotes still ends the current `~with(...)` argument, and a bare `?` still starts the query string.

```bash
# WRONG - the comma splits the argument list; 'Melk' is read as a second selector
GET /v1/new~with(label:'Brød, Melk'/upper)

# RIGHT - percent-encode the comma
GET /v1/new~with(label:'Brød%2C Melk'/upper)
```

Same for `?` in a ternary — write `%3F`:

```bash
GET /v1/products~with(tag:status %3F 'active'/upper : 'none')
```

Two related surprises:

- **A misspelled member on a literal resolves to `null`, not an error** — the same silent behaviour as [misspelled operators](#24-misspelled-operators-fail-silently). `'hello'/uppr` yields `null`.
- **`+` concatenation splits before members are applied**, so `'PRE'/lower+name` is `"pre"` concatenated with `name` — the `/lower` does not reach `name`.

---

## 29. A Limiter Before the Filter Truncates the Wrong Thing

`~` is a pipe and the chain runs exactly in the order you wrote it — there is no query planner that reorders it for you. Put `~take` or `~first` ahead of `~where` and the collection is cut down *first*, then filtered, so the answer is whatever survives from an arbitrary handful of rows.

```bash
# WRONG - "take the first product, then check whether it happens to be active"
#         Returns [] whenever the very first product isn't active.
GET /v1/products~take(1)~where(status=Active)

# RIGHT - "the first active product"
GET /v1/products~where(status=Active)~take(1)
```

The failure is quiet: the request succeeds with `200` and an empty (or short) collection, which reads exactly like "nothing matched". On a small test tenant, where the first few rows often *do* match, the wrong order can even appear to work.

Written the right way round it is also the faster form. A limiter stops pulling items through the chain once it is satisfied, so `~where(...)~take(10)` costs ten matches rather than a full scan, no matter how large the collection is. Two things to know about that:

- **`~orderBy` between the filter and the limiter cancels it.** `~where(...)~orderBy(name)~take(10)` has to sort every match before it can slice the first ten. That is unavoidable if you genuinely want the alphabetically-first ten; if any ten will do, drop the sort.
- **`~count` and `~last` never short-circuit** — both have to reach the end of the stream. To ask "does anything match?" without counting everything, use `~where(...)~take(1)~count`.
- **A filter or a sort in front of a `~skip` costs it the same way.** `~skip(N)~take(M)` on its own steps over the N skipped records without building them; `~where(...)~skip(N)~take(M)` cannot, because the skip is then counting matches and the earlier records have to be read to be counted ([details](operators.md#a-skip-is-only-cheap-while-nothing-filters-sorts-or-projects-before-it)). Order the filter first anyway — it is still the only order that answers the right question.
- **A *projection* in front of a `~skip` costs it too, and here the order is free to change.** `~just(name)~skip(1000)~take(10)` applies the projection to all 1010 records; `~skip(1000)~take(10)~just(name)` returns the same thing and applies it to ten. Watch for this with `?fields=`, which is always normalized ahead of the skip — `?fields=name&offset=1000&limit=10` pays the full cost and cannot be rewritten to avoid it without switching to path operators.

Full rules: [Operators → Limiters stop the scan early](operators.md#limiters-stop-the-scan-early).

---

## 30. An Outer Member Beats the Same Member Inside `@value`

A write body may use the `@value` envelope to separate identification from writing: the outer object says which element to write to, `@value` says what to apply. The two halves are merged before the write, and **the outer object wins** any member they both carry — which is the opposite of what the nesting suggests.

```bash
# WRONG - the envelope looks more specific, so it "should" win. It doesn't.
#         The title ends up "Outer".
PUT /v1/labels
[{"identifiers": {"com.example.labelId": "vip"}, "title": "Outer", "@value": {"title": "Inner"}}]

# RIGHT - each member appears in exactly one of the two halves
PUT /v1/labels
[{"identifiers": {"com.example.labelId": "vip"}, "@value": {"title": "Inner"}}]
```

The failure is quiet — `200`, and a stored value that came from the half you weren't looking at. It bites hardest in generated payloads, where a client that copies a source record into the outer object *and* into `@value` silently ignores everything the envelope was meant to apply.

Two related points about the same envelope:

- **`identifiers` inside `@value` are written, not matched.** That is the feature, not a trap: `{"identifiers": {"com.example.labelId": "old"}, "@value": {"identifiers": {"com.example.campaignId": "new"}}}` finds the object by the old identifier and **adds** the new one. It adds — it never removes the outer one.
- **`"@value": null` is a write, not a delete.** It sets the identified element to null so it stops resolving by its identifiers, and returns `200`. To remove a resource, use `DELETE /v1/{collection}/{key}`.

Full rules: [Resource Patterns → The `@value` Write Envelope](resource-patterns.md#the-value-write-envelope).

---

## 31. A Split Separator the URL Syntax Eats

`/={separator}` [splits a string into an array](primitives.md#splitting-a-string-into-an-array) — written `//=` in a path, because the member follows the usual `/`. The array operators chain onto the result, so `//=-~last` keeps the part after the last hyphen.

Most separators can be written bare. Four cannot, because the surrounding syntax consumes them before the separator is read:

```bash
# WRONG - the "/" ends the segment, so this splits on nothing (an empty
#         separator) and then treats "~last" as the next path step
GET /v1/products/com.example.sku=ABC/name//=/~last

# RIGHT - encode it
GET /v1/products/com.example.sku=ABC/name//=%2F~last
```

| Separator | Write it as | Otherwise it is read as |
|-----------|-------------|-------------------------|
| `/` | `%2F` | The start of the next path step |
| `+` | `%2B` | String concatenation |
| space | `%20` | Expression syntax |
| `?` | `%3F` | The start of the query string |

Inside an operator's argument list, `,` and `:` need `%2C` and `%3A` as well. Everything else — `-`, `=`, `<`, `!`, `~`, `.`, `_`, `|` — works bare or encoded, and encoding a character that did not need it is harmless.

**Why it is quiet:** a separator that never occurs in the string is not an error — the split returns a **one-element array holding the whole, unsplit string**, with a `200`. A mis-encoded separator therefore produces a well-formed array that looks like a successful split until you notice it has exactly one element. If a split "worked" but handed back the original value, suspect the separator before the data.

Two related points:

- **A literal `~` in a *member* operand still needs `%7E`** — `name/+=%7Ev2` appends `~v2`. The separator position is exempt: `//=~~last` splits on tildes and chains normally.
- **`/=` divides numbers and splits strings.** One token, two behaviours, chosen by the type of the value it lands on: `price/amount//=2` halves a price, `name//=-` splits a name.

Full rules: [Primitives → Splitting a String into an Array](primitives.md#splitting-a-string-into-an-array).

---

## 32. An Empty Streamed Collection Is `200`, Not `204`

`Accept: application/x-ndjson;stream=true` returns exactly the lines the buffered form returns, in the same order — but the response *envelope* differs in two ways, and both surface only after you switch an existing call over.

A buffered response with an empty body is `204 No Content`. A streamed one has already sent its status before it discovers there is nothing to send, so it is `200` with a zero-length body.

```bash
# 204 No Content
GET /v1/products~where(status=Nonexistent)
Accept: application/x-ndjson

# 200 OK, empty body — same query
GET /v1/products~where(status=Nonexistent)
Accept: application/x-ndjson;stream=true
```

A client that branches on `204` to mean "no results" reads the streamed `200` as a success carrying data, and then fails parsing an empty body. **Test for an empty body, not for a status code.** The same applies to `text/csv` and `application/sql`. JSON is the exception either way — an empty collection serializes to `[]`, which is not an empty body.

The second difference is JSON-only: **a buffered `application/json` body ends with a newline, a streamed one does not** (`[{...}]\n` vs `[{...}]`). NDJSON, CSV and SQL rows already end in a newline, so for those three the buffered and streamed bodies are byte-identical and an exact-comparison client can diff raw bytes across the switch.

Two related surprises, and the real cost of streaming:

- **A mid-stream failure cannot change the status code.** Once the first chunk is on the wire the response is `200`, so a failure part-way through is delivered inside the body and the collection is silently short. A streaming client must check for it before treating an export as complete. A buffered request fails cleanly with a proper error status instead.
- **Where that marker lands depends on the content type.** On the line-delimited formats (`application/x-ndjson`, `text/csv`, `application/sql`) it is one more line at the end. On `application/json` the array closes itself and the marker is its **last element** — so the body still parses, and a client that only checks "did `JSON.parse` succeed?" will load a truncated export as if it were complete. Check `.[-1]["@type"]`.
- **Key detection on `@type`, not on the other fields.** Both streamed markers carry `@type`, `error` and `innerError`, but `processedCount` is `application/json`-only and `failedAtIndex` is **reserved** — it is declared on the model, so a generated client and a schema browser both show it, but no response carries it on any content type. So `if (last.processedCount !== undefined)` never fires on an NDJSON, CSV or SQL export, and a check on `failedAtIndex` never fires anywhere — either one waves a truncated export through as complete. Test `"@type": "mid-stream error"` and read `innerError` for the cause ([field matrix](../features/streaming.md#which-fields-each-form-carries)).
- **`innerError` is an ordinary error body** — `@type` discriminator included, identical on every format to what the same failure would have returned as an HTTP error response. Whatever handler you already have for error bodies reads it unchanged. **Changed 2026-08-19:** it previously arrived *without* `@type`, and this page said so; a client written against that (especially one branching on the key's absence) needs revisiting.
- **A streamed response is not a point-in-time snapshot.** Batches are read in separate transactions, so a concurrent write can be invisible to the rows already sent and visible to the rows still to come. Run an export buffered when two records in the same file will be compared against each other.

Full rules: [Streaming](../features/streaming.md#two-response-differences-when-you-switch-to-streamtrue).

---

## 33. A Read-Modify-Write on Credentials Overwrites the Secret

Credential secrets are write-only: a read returns the fixed placeholder `"********"` where one is set, and omits the member where none is. Send that placeholder back and it is treated like any other value — the secret becomes those eight literal characters.

```bash
# WRONG - GET returned "password": "********". Sending the object back
#         sets the password to the string "********".
PATCH /v1/local-credentials/email=ada@example.com
{"identifiers": {"email": "ada@new.example.com"}, "password": "********"}

# RIGHT - patch only what is changing
PATCH /v1/local-credentials/email=ada@example.com
{"identifiers": {"email": "ada@new.example.com"}}
```

The failure is silent in both directions: the write returns `200`, and the next read is byte-identical to the one before it, because a set secret always renders as the same eight characters. Nothing in the API tells you the password changed — you find out when someone cannot sign in.

It bites read-modify-write clients hardest, and generic ones especially: fetch a record, change one field, `PUT` the whole object back is the normal shape of an ORM-style integration, and it is exactly the shape that breaks here. **Patch only the fields you are changing, and never include a secret member unless you intend to set it.**

Five members behave this way, across four resources:

| Member | On |
|---|---|
| `password` | `local credentials` |
| `pin` | `PIN credentials` |
| `token` | `scan token credentials` |
| `apiKey` | `apikey credentials` |
| `secret` | `oauth2 client` |

Two related points:

- **The value you send is the only copy.** No read returns a secret, so an API key or client secret that was not captured when it was written cannot be recovered — the credential has to be replaced.
- **`null` clears, the placeholder does not.** `{"password": null}` removes the secret; `{"password": "********"}` sets it.

Full rules: [Credentials → Secrets go in, they never come out](credentials.md#secrets-go-in-they-never-come-out).

---

## 34. `roleAssignments` Is Missing From the Default User Representation

A plain `GET` on a user returns its identifiers, its `agent`, and seven of the nine credential collections. It says **nothing about roles** — so a check for "what access does this user have?" reports none for a user who has several.

```bash
# WRONG - roleAssignments is not in the response, whatever the user has
GET /v1/users/com.example.userId=U-1

# RIGHT
GET /v1/users/com.example.userId=U-1~with(roleAssignments)
GET /v1/users/com.example.userId=U-1~withAll
```

Seven members are absent from the default view: `roleAssignments`, `pinCredentials`, `scanTokenCredentials`, `hidden`, `labels`, `config`, `posMode`. The two credential collections are the other half of the trap — an audit that lists "every credential on this account" from a plain `GET` misses PINs and QR cards entirely.

Two related points about reading users:

- **`inactive` is absent, not `false`, on an active user.** Filter with the falsy check — `~where(!inactive)` — because `~where(inactive=false)` compares against a member that is not there.
- **A deactivated user is still in the collection.** `DELETE` on a user deactivates rather than purges, and the record keeps appearing in `/v1/users` and counting in `~count`.

Full rules: [Users → Members](users.md#members).

---

## 35. A Bad `Accept` Parameter Value Empties the Response

An `Accept` parameter the format does not recognize is ignored. An **invalid value on one it does recognize** takes the whole response with it: the parameter set fails to apply, the serializer has nothing to write, and the request answers a success status with no data — `204 No Content` on a buffered request, with no error message anywhere.

```bash
# WRONG - 204 No Content from a collection full of products
Accept: application/json;skipNulls=1
Accept: application/json;stream=truex
Accept: application/sql;mode=upsert

# RIGHT
Accept: application/json;skipNulls=false
Accept: application/json;stream=true
Accept: application/sql;mode=merge
```

Booleans must be spelled `true` or `false` — `1`, `0`, `yes` and `on` are all rejected. The SQL `mode` enum accepts only `insert`, `sync` and `merge`.

The failure is quiet in the worst way: the status says success, and an empty body from a filtered collection is indistinguishable from "nothing matched". **If a request starts coming back empty right after you touched the `Accept` header, suspect the parameter before the query.**

Two related points:

- **A misspelled parameter *name* is ignored, not rejected.** `;strem=true` returns a perfectly successful buffered response, so a stream that never streams is usually a typo in the name rather than a platform limitation. Unknown parameters are ignored deliberately — `;charset=utf-8` and `;q=0.9` are absorbed on every collection format so that standards-compliant headers work.
- **The two failures look alike from outside.** Wrong name → full body, no parameter applied. Wrong value → empty body. Check the body before the header, then the header before the query.

Full rules: [Accept parameter tolerance](overview.md#accept-parameter-tolerance).

---

## 36. An Error Response Is JSON, Whatever Format You Asked For

`Accept` selects the format of a **successful** response. An error is always a JSON document — only its framing follows the header. So a failing CSV export does not answer with a header row and an error row; it answers with a JSON object.

```bash
# Asked for CSV. On failure the body is JSON, not CSV — a CSV parser chokes,
# or worse, reads the first line of the indented object as a header row.
curl -sS ".../v1/products~where(nosuchfield=1)" -H "Accept: text/csv" -u ":banana" -o products.csv
```

**Check the status code before handing a response to a format-specific parser.** The `Content-Type` on the response says which framing you got, so it works as the check too.

NDJSON is the case that looks fine and is not. An error there arrives as **one newline-terminated line**, which is exactly what a line-oriented reader expects — so a loader that parses every line and treats it as a record will parse the error object into its dataset without complaint:

```json
{"@type":"bad request","error":"The request was invalid and could not be processed.","details":"Malformed cursor token: invalid base64url or JSON"}
```

That framing is deliberate and it is what you want (an indented multi-line document would corrupt an `.ndjson` file outright), but it means **the line parsing successfully is not evidence the request succeeded**. Test the status code, or test the line for `@type`.

Two related points:

- **This is not the mid-stream error.** A `"@type": "mid-stream error"` element appears inside an otherwise successful `200` body when a failure strikes after the headers are sent — see [gotcha 32](#32-an-empty-streamed-collection-is-200-not-204). What is described here is the ordinary error response, where the status code is real. Both are one line on NDJSON, so the status code is what distinguishes them.
- **The document does not change with the format.** Same `@type`, same `error`, same `details`, same `Error-Info` header, whatever you accepted. Only the indentation and the `Content-Type` differ, so one error handler covers every export format you use.

Full rules: [Error response framing](overview.md#error-response-framing).

---

## 37. A Trade Order Can Attach Its Relationship to an Agent You Did Not Name

Posting a trade order establishes the trade relationship between its `customer` and `supplier` if none exists. Where an agent is configured to trade under a parent — a chain store buying on its company's account — **the relationship is attached to that parent**, not to the agent named on the order.

```bash
# Order posted for the store...
POST /v1/trade-orders
{ "customer": {"identifiers": {"com.example.storeId": "STORE-01"}},
  "supplier": {"identifiers": {"com.example.supplierId": "SUPPLIER-A"}}, "...": "..." }

# WRONG - looking for the relationship under the agent you sent
GET /v1/stores/com.example.storeId=STORE-01/supplierRelations      # empty

# RIGHT - it belongs to the store's owner
GET /v1/companies/com.example.companyId=COMPANY/supplierRelations
```

The failure is quiet: both requests answer `200`, and an empty collection reads exactly like "this store has no suppliers yet". On a flat setup with no owners configured the two agents *are* used verbatim, so a test tenant can make the wrong assumption look correct.

Two related points:

- **Explicit creation does not resolve owners.** `POST /v1/trade-relationships` uses exactly the two agents in the payload. Create one against the store and a trade order will neither find nor use it — you end up with a relationship nobody trades on. Name the owner instead.
- **The child never gets its own row.** `customerRelations` / `supplierRelations` list established relationships only, so a store trading under its parent shows an empty list by design, not a missing one.

Full rules: [Resource Patterns → Relationships created implicitly by a trade order](resource-patterns.md#relationships-created-implicitly-by-a-trade-order).

---

## API Response Behaviors

### Empty Collection Results

| Operation | Empty Result |
|-----------|--------------|
| `~count` | `0` |
| `~first` | `null` |
| `~take(N)` | `[]` |

### Person Name Fields

Person entities expose both computed and raw name fields:

| API Field | Description | Default? |
|-----------|-------------|----------|
| `givenName` | First/given name | ✓ Included |
| `familyName` | Last/family name | ✓ Included |
| `fullName` | Combined name (from givenName + familyName) | ✓ Included |
| `name` | Alias for fullName (via agent inheritance) | ✗ Use `~with(name)` |

**Key points:**
- `fullName` is included by default in person responses
- `name` (inherited from agent) requires `~with(name)` to include
- Both `name` and `fullName` can be used for sorting and filtering
- Setting name values directly is supported; computed values derive from givenName/familyName

```bash
# fullName is included by default
GET /v1/people/com.example.id=123
# → {"givenName": "John", "familyName": "Doe", "fullName": "John Doe", ...}

# name requires explicit inclusion (agent-level alias)
GET /v1/people~orderBy(name)~with(name)~take(10)

# Or use fullName directly (already included)
GET /v1/people~orderBy(fullName)~take(10)
```
