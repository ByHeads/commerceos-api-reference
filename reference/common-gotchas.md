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

## 9. Parentheses Are Forbidden on Parameterless Operators, and a Missing Argument Is Not Always an Error

Two mistakes, pointing in opposite directions, and neither reliably announces itself. Adding empty parentheses to an
operator that takes no arguments breaks it. Leaving the argument off an operator that takes one usually does *not*
break it — it quietly runs the operator with nothing to work on.

**Empty parentheses on a parameterless operator are a mistake, but not always a visible one.** Four of them fail
loudly whatever you applied them to:

```bash
# WRONG - a failure you will see
GET /products~first()   # 404 "The requested resource was not found."
GET /products~last()    # 404
GET /products~flat()    # 404
GET /products~count()   # 404

# RIGHT - No parentheses
GET /products~first
GET /products~count
GET /v1/people/{key}/languages~distinct   # ["en","sv"]
```

The rest depend on what you applied them to. Over a **collection** they are a silent `200 null`, and they only become
a `404` when the target is a single object or a string:

```bash
# WRONG - 200, and the body is null
GET /products~distinct()    # 200 null
GET /products~typeless()    # 200 null
GET /products~withAll()     # 200 null
GET /products~toLower()     # 200 null
```

`~entries()` is the one that never announces itself: it is a `200 null` on a collection, on a single object and on a
string alike, so there is no target you can retry it against to surface the mistake.

That `null` then flows downstream and takes the rest of the chain with it: `products~distinct()~count` answers `1` —
the count of one null, not of your products — and `products~typeless()~take(2)` answers `{"@type":"take"}`, an object
naming an operator you wrote correctly. Neither response points back at the parentheses, so when a chain answers with
a plausible-looking `1` or with a `{"@type":"<some operator>"}` object, read it from the left for a parameterless
operator carrying empty parentheses.

> **`~array()` is not on either list, and is not a mistake.** `~array` takes arguments, so its empty parentheses are
> an empty argument list rather than a typo: `products~first/name~array()` and `products~first/name~array` are the
> same request and both answer `["1 kr"]`. If you are carrying the habit of reading `~array()` as a mistake, it is on
> the other side of this line — see [`~array`](operators-catalog.md#array) and the half of the rule below.

**An argument-taking operator with its parentheses left off is read as that operator with no arguments**, and the
bare and empty-parens spellings mean exactly the same request. Four operators cannot do anything without an argument
and say so, naming themselves and the shape they want:

```bash
# WRONG - 400, and the message tells you what to write
GET /v1/products~take        # "Operator 'take' requires an argument — write '~take(<number>)'."
GET /v1/products~orderBy     # "Operator 'orderBy' requires an argument — write '~orderBy(<resource selector>)'."
GET /v1/products~distinctBy  # "Operator 'distinctBy' requires an argument — write '~distinctBy(<resource selector>)'."
GET /v1/products~map         # "Operator 'map' requires an argument — write '~map(<namespaced key>)'."
```

**Every other argument-taking operator answers `200` and applies its no-argument default**, which is where the quiet
failures live. For some that default is the thing you wanted — `~order` sorts ascending, `~join` joins on `,`,
`~array` wraps. For the filtering and projection family it is a filter that does not filter and a projection with
nothing in it:

```bash
# WRONG - 200, and nothing was filtered
GET /v1/products~where~count                 # 156 - the whole collection, no predicate applied
GET /v1/products~where(hidden=true)~count    # 19  - what you meant to ask

# WRONG - 200, and every member is gone
GET /v1/products~just~take(2)                # [{"@type":"product"},{"@type":"product"}]
GET /v1/products~just(name)~take(2)          # what you meant to ask
```

`~either` behaves like `~where`, `~simpleJust` like `~just`, and `~with`, `~without` and `~skip` add, remove and skip
nothing. None of them errors, so a bare projection or predicate is only visible in the body — an unfiltered count, or
items stripped to their `@type`.

`~order` is the one most often typed bare, and it is on the harmless side: `languages~order`, `languages~order()`
and `languages~order(asc)` all answer `["en","sv"]`. The argument is strict in the other direction — `asc` and `desc`
are the only two values, and a case slip (`~order(ASC)`) is a `404`. See
[`~order`](operators-catalog.md#orderascdesc), and [Parameter Rules](operators.md#parameter-rules) for which
operators fall on which side of the line.

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

# ~distinct is for a collection that already holds scalars
GET /v1/people/{key}/languages~distinct   # ["en","sv"]
```

**There is no operator that turns a collection of resources into a stream of one of their members**, so there is
nothing to convert before applying `~distinct`. `products/status` is a `404` — a member path applies to one object,
not across a collection — and so is `products~map(status)`, because [`~map`](operators-catalog.md#maptypename)
applies a registered mapped type by name rather than projecting a member. `~just(status)` keeps the objects, so
`products~just(status)~distinct` dedupes nothing and returns all 156. `~distinctBy(status)` is the operator that
answers "one per distinct value", and `~distinctBy(status)~just(status)` renders just the values.

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

# WRONG - DELETE on the collection path removes nothing
DELETE /v1/stores/{key}/stockRoots  # 200 {"deletedCount": 0, "info": "Nothing happened"}
```

This works for all `indexedArray` properties: `stockRoots`, `assortmentRoots`, `assortmentOwners`, `categories`, `labels`, `prices`, `users`, `customerGroups`, etc.

**`DELETE` addresses one element, so a collection path has nothing to address.** It leaves the array exactly as it was and says so in the response — a product carrying two labels still carries two after `DELETE /v1/products/{key}/labels`. The zero is the tell; it is not a partial clear.

> **Note:** Individual items can be removed with `DELETE /v1/{collection}/{key}/{member}/{itemKey}`, and a specific subset with `PATCH {"remove": [...]}` — see gotcha 23 below and [Array Write Operations](resource-patterns.md#array-write-operations). What the count in a `DELETE` response does and does not promise is in [What a `DELETE` reports](overview.md#what-a-delete-reports).

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

Related: [gotcha 9](#9-parentheses-are-forbidden-on-parameterless-operators-and-a-missing-argument-is-not-always-an-error) — a parameterless operator written with empty parentheses is a different mistake that lands on both sides of this line. `~first()` and `~count()` misbehave visibly; `~distinct()` and `~typeless()` answer `200 null` over a collection, which is the same silence as a misspelling.

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

## 26. Cursor Pagination Stops Early on a Non-Unique Sort Field

A cursor walk asks for the next page with a strict `field > lastValue` filter and no secondary tiebreaker, so it
cannot resume *inside* a run of items sharing a value. Rather than skip that run, the walk stops: a page whose last
item shares its sort value with the item that would follow it mints no token and reports `X-Has-More: true`. On a
low-cardinality member that is usually the first page, so the export is a fraction of the collection.

```bash
# WRONG - hundreds of products share each status value, so the walk stops on page one
GET /v1/products?limit=50&orderby=status

# RIGHT - unique per resource
GET /v1/products?limit=50&orderby=identifiers/key
```

The stop is loud — it is the same no-cursor-with-more state described three paragraphs down, so a walk that tests for
the cursor catches it. Do not retry: nothing about the request will change. And note that only the pagination headers
are withheld; the page itself is untouched, so `limit` and `orderby` with `offset`, or `limit` on its own, keep
working on any sort field.

`name` is not a safe substitute either: the same name can exist per currency or per store. Compound sorting is not a
workaround — there is no compound sort, and an `orderby` listing more than one field is a `400`
([why, and the one shape that answers `200`](pagination.md#requirements-and-notes)).

**A sort field holding more than one value is refused outright, and that one is not silent.** A cursor carries your
position as a single value, so a member that renders as a list, an object or a boolean is a `400` on the *first*
request — `Cursor pagination requires a sort field holding a single text or numeric value: 'gtin' holds a list`, and
likewise `'identifiers' holds an object` or `'hidden' holds a boolean`. The object case is the easy mistake: sort on
`identifiers/key`, not on `identifiers`. The refusal needs the sort value to have been resolved, so on a member outside
the resource's default representation you see it only once the request carries a `fields=` parameter; without one it
stalls silently instead, as above. It fires on every page, including a `limit` bigger than the whole collection,
so a list-valued sort field cannot appear to work until the data outgrows one page. Only the query-parameter form is
affected — `~orderBy(gtin)~take(2)` is a plain sort, not a walk, and still returns `200`.

**A sort field that is sometimes empty fails a second way, and it is worth checking for explicitly.** When the last
item on a page has no value for the sort field, no next cursor can be minted, so the response carries
`X-Has-More: true` with **no** `X-Cursor-Next`. A walk written as "repeat while `X-Has-More` is true" spins on a
request it cannot advance; one written as "repeat while a cursor is present" stops mid-collection and reports success.
Test for the cursor, and treat its absence while `X-Has-More` is `true` as an error. `identifiers/key` is unique *and*
always populated, which is why it is the recommendation for both failures.

**Sorting `:desc` on such a field is the one case a cursor test does not catch, and it is the only silent failure
left.** Descending, the items holding no value sort last — but the resume request filters on the sort field
(`field < lastValue`), and an item holding no value does not pass that filter, so the walk never reaches them. It ends
on the last item that has a value and reports `X-Has-More: false`, which looks exactly like a complete walk.
`GET /v1/stores?limit=2&orderby=organizationNumber:desc&fields=none` returns four of five stores this way; the one
store with no `organizationNumber` never appears. Ascending is safe from it, because those items sort first and are
read before there is any boundary to resume past.

**A `~just(...)` projection can land you in that same no-cursor state on the first request, where a `fields=` one
cannot — and the `fields=` parameter is the whole of the difference.** The sort value is fetched under a name of its
own and removed again only for a request that carries a `fields=` list, so such a list can be as narrow as you like
whatever you sort on: `fields=name` alongside `orderby=identifiers/key` walks to the end of the collection, and so does
`fields=none`. With no `fields=` the cursor is minted only if the `orderby` selector can be read from whatever the rest
of the request rendered. `~just(name)` with `orderby=identifiers/key` never starts the walk; adding `&fields=name` to
that exact request starts it and returns the same items, and `~just(name,identifiers)` starts it too at the cost of an
extra object per item. Widening has to reach the selector's own path — an alias does not count
(`~just(name,k:identifiers/key)` carries the value under a different name and still stalls). Prefer `fields=` on a
request you intend to walk. See [Cursor pagination](pagination.md#requirements-and-notes).

Three related surprises in the same feature:

- **`limit` is required to start a walk — it does not default to 100 on the first request.** With `orderby` alone you
  get a `200` carrying the *whole* collection and no pagination headers at all, so there is no first page and nothing
  to follow. The 100 default applies only once an `after` token is present. Send the same `limit` on every request.
- **Streaming turns the walk off — and so does an export format.** With `Accept: application/json;stream=true` the body
  starts before the pagination headers could be computed, so `Link` / `X-Cursor-Next` / `X-Has-More` are never sent. The
  line-oriented formats (NDJSON, CSV, SQL) do not carry them either, streamed or buffered. An `after` token is still
  honored in every format, so the request succeeds and returns at most `limit` items — it just gives you nothing to
  continue from. Walk the pages with buffered JSON.
- **A stored token cannot outlive a change of sort.** Replaying a token minted under `orderby=name` with
  `orderby=price` — or with `:desc` flipped — is a `400`, not a silently wrong page. The natural client bug is exactly
  this: a token kept in state and re-sent after the user changed the sort control.

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
- **`~count` and `~last` never short-circuit** — both have to reach the end of the stream. To ask "does anything match?" without counting everything, use `~where(...)~take(1)~count`: it stops at the first match and answers `1`, or reaches the end and answers `0`.
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

## 35. A Misspelled `Accept` Parameter Name Is Silent; a Bad Value Is Not

The two ways of getting an `Accept` parameter wrong fail in opposite directions, and only one of them tells you. A parameter **name** the format does not recognize is absorbed and ignored — no error, full body, and the setting you meant to apply simply is not applied. A bad **value** on a name it does recognize is a `400` naming the parameter.

```bash
# SILENT - 200 with the whole collection, and nothing streaming
Accept: application/x-ndjson;strem=true

# LOUD - 400, and the `details` names the parameter and what it would have taken
Accept: application/json;skipNulls=1      # ...'skipNulls=1', which takes boolean?
Accept: application/json;stream=truex     # ...'stream=truex', which takes boolean?
Accept: application/sql;mode=upsert       # ...'mode=upsert', which takes 'insert' or 'sync' or 'merge' or null

# RIGHT
Accept: application/x-ndjson;stream=true
Accept: application/json;skipNulls=false
Accept: application/sql;mode=merge
```

Booleans must be spelled `true` or `false` — `1`, `0`, `yes` and `on` are all rejected. The two enums accept their named values plus the literal token `null`: `mode` takes `insert`, `sync`, `merge`, `null`, and `numberHandling` takes `string`, `number`, `null`.

**So a setting that appears to do nothing is a name problem, and there is no status code that will tell you.** A stream that never streams, a `skipNulls` that keeps skipping, a `delimiter` that stays a comma — check the spelling of the name before concluding the parameter is unsupported. (A `delimiter` that comes back as *nothing* is the opposite problem: the name landed and the value could not be written — see [gotcha 45](#45-three-csv-delimiters-have-no-spelling-in-an-accept-header).) Unknown names are ignored deliberately, so that `;charset=utf-8` and `;q=0.9` work on every collection format.

Two related points:

- **A parameter declared as nullable takes the literal `null`; a merely optional one does not.** `;mode=null` and `;numberHandling=null` mean "use the default". `;skipNulls=null` is a `400` — `boolean?` accepts the flag or nothing, never the token — and on a string-valued parameter the token is just text, so `;nullValue=null` sets the six characters as the placeholder rather than unsetting anything.
- **Changed 2026-08-22 — the loud half used to be silent too.** A bad value previously answered a success status with an **empty body** (`204 No Content` when buffered) and no mention of the parameter. A `204` therefore has exactly one cause again: the collection was empty. If you carry a check for "an empty response right after I touched the `Accept` header", it can go.

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

## 38. A Failed Array Write Has Usually Written Part of the Array

A `POST`, `PATCH` or `PUT` with an array body is committed in chunks of **200 items**, not as one transaction. A failure on item 401 rolls back items 401–500 and leaves items 1–400 committed — and the response is an ordinary error status, which reads exactly like nothing happened.

```bash
# WRONG - treating the error as "the write did not land"
POST /v1/prices  [ ...500 prices... ]     # 400 → assume nothing changed, move on
                                          # 400 prices are live at their new amounts

# RIGHT - either replay the whole array after fixing the bad item...
PUT /v1/prices  [ ...500 corrected prices... ]   # PUT upserts, so re-applying is harmless

# ...or refuse the partial write in the first place
POST /v1/prices -H "X-Transaction-Count: all"  [ ...500 prices... ]
```

The error body will not tell you how far it got: there is no `failedAtIndex` and no per-item counter on it. What you can rely on is the chunk boundary, not an item index — so recovery is either an idempotent replay of the whole array or a read-back, never an attempt to resume from the failure point.

Two related points:

- **`X-Transaction-Count: all` costs more the larger the array**, because one transaction stays open for the whole request. Use it where atomicity is the actual requirement — a price list that must not go live half-updated — not as a default for every import.
- **It does nothing to a `GET`.** Streamed reads batch 200 at a time as well, but that is a separate mechanism with a fixed size that no header changes.

Full rules: [Transaction chunking](../features/streaming.md#3-transaction-chunking).

---

## 39. A `null` in a Response Does Not Prove the Field Exists

`~with(X)`, `~just(...,X)` and `~where(X=null)` all **add** `X` to the output, and for a name the resource does not declare they add `null` rather than failing. So all three report `"X": null` whether or not `X` is a member of that resource — which is also exactly what a declared member the record happens to leave empty reports.

```bash
# organizationNumber proves itself real on row 2; on row 1 it is indistinguishable from a member
# that does not exist on this resource at all
GET /v1/stores~just(name,organizationNumber,hidden)~take(2)
→ [{"@type":"store","name":"Shade Stockholm","organizationNumber":null,"hidden":null},
   {"@type":"store","name":"Shade Göteborg","organizationNumber":"5566391237","hidden":null}]
```

`organizationNumber` is declared on `store` — the second row proves it. `hidden` belongs to `product` and does not exist on a store at all, so it is `null` on every row, and nothing in the first row distinguishes the two.

Not every operator that names a member projects it: [`~orderBy`](operators-catalog.md#orderbyselectordesc) reads its selector without adding it to the output, [`~without`](operators-catalog.md#withoutselectors) removes, and [`~simpleJust`](operators-catalog.md#simplejustnames) filters the object it was already given. Of the operators named here, the three above are the ones that add.

**`fields=all` does not settle it either** — it omits a declared member the record leaves empty, so an absence is a property of that record rather than of the type. One request over the store collection shows both halves at once:

```bash
GET /v1/stores?fields=all
→ Shade Stockholm   … no organizationNumber key at all
  Shade Göteborg    … "organizationNumber": "5566391237"
```

**The sort is the test.** `~orderBy(X)~take(1)` against a collection with rows in it is a `400` if and only if the resource does not declare `X`, whatever any individual record holds:

```bash
# RIGHT - ask the sort, not the body
GET /v1/stores~orderBy(organizationNumber)~take(1)   # 200 - declared, though the first store has none
GET /v1/stores~orderBy(hidden)~take(1)               # 400 Invalid sort key 'hidden': field not found
```

Two related points:

- **Ask over a collection that has rows in it.** With nothing to sort, the check short-circuits and any key passes: `products~where(status=__nope__)~orderBy(nosuchfieldxyz)~take(1)` is a `200` with an empty body.
- **It cannot answer for `identifiers/<namespace>`.** That namespace is open, so what is checked there is the key's **shape**, not its existence: exactly three dot-separated segments with no dash in the first. `identifiers/com.example.nope` is admitted on those grounds alone and returns the collection in its natural order, while `identifiers/nope` and `identifiers/com.example.orders.id` are both a `400` reading `field not found` — which here means "not a key I will accept" rather than "you have no such identifier". The realistic mistake lands on the silent side, since a case slip inside a namespace you own is still well formed. Verify a sort like that by checking that the first and last items actually differ in the value you sorted on.

Full rules: [What you can sort on](operators-catalog.md#orderbyselectordesc).

---

## 40. A Malformed Identifier Key Is Dropped, and Every Retry Then Creates Another Record

An identifier key that is not [exactly three dot-separated segments](overview.md#external-identifiers) is discarded on write. The request is a `200`, every other member lands, and the key is simply absent. Nothing in the status, and nothing in an error, says so.

```bash
# WRONG - four segments; the key never reaches storage
POST /v1/products
[{"identifiers": {"com.example.orders.id": "ORD-1"}, "name": "Widget"}]
→ 200  {"identifiers": {"key": "3550a3df…"}, "name": "Widget", …}

# RIGHT - three segments
POST /v1/products
[{"identifiers": {"com.example.orderId": "ORD-1"}, "name": "Widget"}]
→ 200  {"identifiers": {"key": "3550a3df…", "com.example.orderId": "ORD-1"}, "name": "Widget", …}
```

**The cost is not the missing key, it is the missing match.** An upsert recognises an incoming record by its identifiers. Discard the only one and there is nothing left to match on, so the same payload creates a new record every time it is sent — a scheduled sync that retries grows the collection without bound:

```bash
3 × POST [{"identifiers": {"com.example.orders.id": "DUP-1"}, "name": "Dup Probe"}]    → 3 products
3 × POST [{"identifiers": {"com.example.ordersid":  "DUP-2"}, "name": "Dup Control"}]  → 1 product
```

**Reading the record back does not diagnose it.** `GET /v1/products/com.example.orders.id=ORD-1` is a `404`, which is also what "not created yet" looks like, so a client polling for its own write sees nothing unusual. Check the **write's own response** instead — if the key you sent is not in the `identifiers` it echoes back, it was refused.

Three related points:

- **Four segments is the likely mistake, not one.** It is what you get by nesting a namespace a level deeper (`com.acme.orders.id`), and it reads as more than satisfying a "reverse domain notation" rule rather than less. It is also what reversing a `co.uk` or `com.au` domain gives you before you have named anything: `uk.co.acme.customerId`.
- **A path segment fails loudly instead.** The same key in a URL does not route — `PUT /v1/kv/com.test` is a `404` where the identical key in a body is a silent `200`.
- **One resource is strict.** `sync-webhooks` rejects a bad `secrets` or `variables` key with a `400` naming it, and persists nothing from that request. Do not generalise from it — `identifiers` on every resource, that resource included, takes the lenient path.

Related: [gotcha 39](#39-a-null-in-a-response-does-not-prove-the-field-exists) (a `null` is not proof a field exists), [External Identifiers](overview.md#external-identifiers).

---

## 41. A Write Under a Read-Only Scope Is a Silent `200`

Several resources come as a pair: a read-only collection under `<area>:read` and a writable twin under `<area>:write`, both mounted at the same path. Which one a request lands on is decided by the scopes the token holds — and **being on the wrong one is not an error**.

```bash
# The token holds trade-records:read only
PATCH /v1/trade-records/{key}   {"com.example.synced": true}
→ 200

GET /v1/trade-records/{key}~with(com.example.synced)
→ {"@type": "trade record", …}          # the marker is not there
```

The endpoint is in the read scope's graph, so the request routes normally; it just arrives at members that have no setter, and a write with nowhere to go is discarded rather than refused.

**A scope problem answers `200` or `404` — never `403`.** Nothing in the API raises a `forbidden` error, and there is nowhere for it to: scopes decide which resources are in a token's graph at all, so a request the scopes do not cover never reaches a permission check that could refuse it. Four situations, and no permission error among them:

| The token's scopes… | Result |
|---|---|
| cover the resource, writable | `200`, and the change persists |
| cover it read-only | `200`, and **nothing persists** — the request routes onto members that have no setter |
| cover it read-only, and the write is a `POST` whose identifiers name no existing record | `400`, reported as a lookup failure against your own identifiers |
| do not cover it at all | `404` — in every path spelling, on every method but `DELETE` |

> **Changed 2026-08-22.** A path the token does not reach used to answer something other than `404` in two spellings; both answer `404` now, like every other one. A *write* answered `400` for `PATCH /v1/products/com.example.sku=…`, where the trailing identifier segment was read as a comparison rather than as a lookup — only relevant if you branched on that `400`, and it was never a payload problem. A *read* ending in `~count` answered `200 1`, which made a count unusable as an answer about your own data. It is an ordinary count again, so `~where(...)~take(1)~count` can be read at face value and a gate built on `/v1/scopes~where(…)~count` is sound. Separately, a **`DELETE`** reported `deletedCount: 1` whenever a removal was attempted, whether or not anything could be removed — so the count claimed a deletion for every request in this entry. It counts the removals that reached a setter now, which is what makes the paragraph below a reliable check rather than a warning.

**The surviving `400` is the expensive one**, because it is the status an integrator reads as "my payload is wrong" and never as "my token is wrong" — and this one goes further and blames a specific field. A `POST` for a product that does not exist yet, from a token holding `products:read`:

```bash
POST /v1/products   [{"identifiers": {"com.example.sku": "NEW-1"}, "name": "New"}]
→ 400 {"@type": "failed indexing",
       "error": "Found no matching 'product' using this index. Check identifiers.",
       "usedIndex": {"com.example.sku": "NEW-1"},
       "indexerOwner": "products", "indexType": "…", "suggestion": "…"}
```

The identifiers are correct. A `POST` is an upsert, so it looks the record up first: the lookup runs against the read-only collection and finds nothing, and there is no writable collection behind it to create with — so the only failure it can report is the lookup. Send that same `POST` for a product that *does* exist and it is a plain `200` that changes nothing, the ordinary read-only-twin outcome. **If a write answers `failed indexing` and the identifiers look right, check the token's scopes before you start rewriting the payload.**

**`DELETE` sits outside all of this, and it is the one method whose response answers the question.** It never answers `404` — not for a path the token cannot reach, not for a key that does not exist, not even for a collection no scope declares:

```bash
DELETE /v1/no-such-collection/anything    → 200, empty body
```

But where it does route, the body **is** evidence, and this is the one place a scope gap reports itself. `DELETE` counts the removals that reached a setter, so a target the token cannot write reports zero rather than claiming a deletion. The sharpest case is a token that reaches the parent but not the member hanging off it — nothing in the status distinguishes these three:

```bash
DELETE /v1/products/{sku}/prices/{key}
# products:read                  → {"deletedCount": 0, "info": "Nothing happened"}   2 prices, still 2
# products:write                 → {"deletedCount": 0, "info": "Nothing happened"}   2 prices, still 2
# products:write + prices:write  → {"deletedCount": 1, "info": "Deleted 1 items"}    2 prices, now 1
```

`products:write` reaches the product and not the price, so the removal is a genuine no-op and the count says so. A response with **no body at all** means the same thing as a zero — nothing was removed. See [What a `DELETE` reports](overview.md#what-a-delete-reports) for the full contract, including why a count of `1` still means *a setter ran* rather than *a record is gone*.

So the status code cannot distinguish "written" from "silently dropped", and a scope problem never looks like a permission problem. **Read the value back after any write whose target might be read-only** — that round-trip, not the `200`, is the confirmation. It matters most for an exactly-once sync marker: a dedup that trusts the `200` re-sends the same records on every run, forever, with no error anywhere to show for it. `DELETE` is the one method exempt from this, because its count already is the round-trip.

**What no status can tell you, [`/v1/scopes`](overview.md#checking-what-a-key-can-do-v1scopes) can.** A read-only resource and its writable twin sit at the same path and answer a `GET` identically, so probing an endpoint cannot answer "may this key write products?". Asking directly can, in one request and without touching data:

```bash
GET /v1/scopes                                # every fine-grained scope this key holds
GET /v1/scopes~where($this=products:write)    # ["products:write"] when granted, [] when not
```

Worth doing at start-up in anything that syncs: it is the difference between finding out now and finding out from a month of markers that never landed.

Three related points:

- **A write to a read-only *member* behaves the same way**, even when the token holds the write scope. `PATCH /v1/trade-records/{key} {"items": []}` is a `200` that changes nothing, as is a member the type does not declare at all. Only the writable members of the resource you landed on take a value; everything else in the payload is quietly ignored.
- **A marker sent alongside a rejected member still lands.** The payload is not rejected as a whole, so a mixed body applies its writable half — see [gotcha 30](#30-an-outer-member-beats-the-same-member-inside-value) for the other way a payload's halves can disagree.
- **A `403` that does reach your client did not come from the API.** Since nothing in the error layer raises one, it came from whatever sits in front of the API — a gateway, proxy or load balancer — and it will not carry the `@type` error body every API error carries. See [Error Types](overview.md#error-types).

Related: [`/v1/scopes`](overview.md#checking-what-a-key-can-do-v1scopes), [Trade Records → Scopes](trade-records.md#scopes), [gotcha 39](#39-a-null-in-a-response-does-not-prove-the-field-exists), [Credentials → Scopes](credentials.md#scope-names).

---

## 42. A Positional Index on a Keyed Collection Is a `404`

`/{collection}/0` reads as "the element whose key is `0`", not "the first element". On a collection whose elements are addressed by database key or common identifiers — a trade order's `items`, and every collection you reach an element of as `/items/{itemKey}` — no element has that key, so the request is a `404`.

```bash
# WRONG - 0 is not a key
GET /v1/trade-orders/{id}/items/0/statusDetails

# RIGHT - reach the element with an operator
GET /v1/trade-orders/{id}/items~first/statusDetails

# RIGHT - or name the element
GET /v1/trade-orders/{id}/items/{itemKey}/statusDetails
```

**A plain array of scalars does take an index**, which is why the mistake is easy to make: `GET /v1/products/{id}/gtin/0` returns the first GTIN, and `/gtin/-1` the last. The two kinds of collection look identical in a response — both render as a JSON array — so nothing about the output tells you which rule applies.

The reliable move is not to work out which kind you are on. `~first`, `~last`, `~take(n)` and `~skip(n)` work on both, so use them whenever you are not naming a specific element, and the distinction stops mattering.

**Positional indexing inside a nested array still works.** The rule is about the collection you are indexing, not about how deep you are: `.../items~first/statusDetails/1` returns the second status row, because `statusDetails` is an ordinary array even though `items` is not.

Related: [Array Index Access](resource-patterns.md#array-index-access), [Accessing Order Items](working-with/orders.md#accessing-order-items).

---

## 43. Registering a Dynamic Property Under a Read Scope Is a Silent `200`

`PATCH /v1/{collection}/properties/dynamic` needs that collection's **write** scope. Under a read scope the registry is get-only, and the refusal is indistinguishable from success:

```bash
# the token holds products:read
PATCH /v1/products/properties/dynamic
{"com.example.tracking": {"propertyType": "string", "description": "Carrier tracking id"}}
→ 200 {"@type": "dynamic properties"}          # registered nothing
```

Everything downstream then fails quietly too. An unregistered key is not a member of the type, so writing its value on a record is another silent `200` and the value never appears on a readback. A deploy that registers its properties and then starts syncing reports success end to end and stores nothing.

**Check the response body, not the status.** A `PATCH` on the registry answers with the registry as it stands, so the property is in the response if it registered and absent if it did not — a deploy script can assert on that without a second request.

**Two endpoints do not need the write scope their name suggests**, and they fail in different ways:

| Registry | Needs | The scope you would guess |
|---|---|---|
| `/v1/receipts/properties/dynamic` | `receipts:write` | `retail:write` → silent `200`, registers nothing |
| `/v1/picking-orders/properties/dynamic` | `logistics:write` | `shipment-records:write` → `404`, that scope does not reach the collection at all |

Both are endpoints an existing integration may already be registering on, so this is a change that arrives without a code change: a key holding only the guessed scope stops registering, and only one of the two failures has a status code to catch.

Two related points:

- **`.../description` and `.../requiredOnCreate` answer `204`** when the write is dropped, which makes them the one part of this surface where the status alone tells you. Every other refusal here is a `200`.
- **Some concepts cannot be registered on at all.** `z-reports`, `x-reports`, `cash-register-reports`, `payment-cards`, `payment-means`, `singleton-payment-means`, `picking-records` and `trade-record-items` have no writable collection anywhere, so a registration there is a `200` that registers nothing, even under `write:api`.

Related: [Dynamic Properties](resource-patterns.md#dynamic-properties), [gotcha 41](#41-a-write-under-a-read-only-scope-is-a-silent-200), [gotcha 44](#44-retyping-a-dynamic-property-blanks-it-on-every-record), [Credentials → Scope names](credentials.md#scope-names).

---

## 44. Retyping a Dynamic Property Blanks It on Every Record

Re-registering an existing dynamic property with a different `propertyType` — or removing it — makes its stored values stop reading. Every record of the concept answers `null`, from one `PATCH`, with a `200`:

```bash
# com.example.tracking is registered as a string, and set on the whole catalogue
PATCH /v1/products/properties/dynamic
{"com.example.tracking": {"propertyType": "number", "description": "Carrier tracking id"}}
→ 200

GET /v1/products/com.example.sku=WIDGET-001~with(com.example.tracking)
→ {"@type": "product", …, "com.example.tracking": null}
```

**And the `null` says nothing about what happened.** It is the same answer you get for a property that was never registered and for a record that simply has no value — see [gotcha 39](#39-a-null-in-a-response-does-not-prove-the-field-exists). Nothing in the response distinguishes "this was blanked by a retype" from "this was never set", so before concluding the data was never written, read the registry and check the property's current `propertyType` against the one your integration writes.

**Re-registering with the same `propertyType` is safe for the values** — they keep reading, so correcting a description costs no data. It is not free for the definition, though: a registration replaces rather than merges, so a body that leaves `requiredOnCreate` out sets it back to `false`. Change a description through its own leaf instead, `PATCH /v1/products/properties/dynamic/com.example.tracking/description`, which is the operation that means what it says and touches nothing else. A `PATCH` at the property URL itself is a full re-registration and needs the whole definition; a partial body there is a `400` about the missing `propertyType`.

**Naming one property does not disturb the others.** The registry body is applied key by key, so this is a hazard for the property you name and for nothing else.

**It is a disappearance, not a deletion.** A stored value is read through whatever `propertyType` is registered at the time, so putting the original type back under the same name makes the values readable again. The one condition: there is a single value slot per property, so anything written while the wrong type was registered has replaced what was there. Restore the type before the next sync run writes to the property, not after.

Related: [Dynamic Properties](resource-patterns.md#re-registering-and-what-it-costs), [gotcha 43](#43-registering-a-dynamic-property-under-a-read-scope-is-a-silent-200).

---

## 45. Three CSV Delimiters Have No Spelling in an `Accept` Header

A comma, a semicolon and whitespace cannot be written as a `delimiter` — and they are the three an integrator is most likely to want. The comma separates the media types in the header, the semicolon separates the parameters, and an all-whitespace value is trimmed away before it is read.

```bash
# WRONG - semicolon-separated CSV, the Excel default across most of Europe
Accept: text/csv;delimiter=;                    # 400 - the only one of the three that ever says so

# WRONG - the same thing with a parameter after it, and now it is silent
Accept: text/csv;delimiter=;arrayDelimiter=/    # 200, and the fields run together

# WRONG - the documented default, written out
Accept: text/csv;delimiter=,                    # 200, and the fields run together

# WRONG - tab-separated, or any all-whitespace value: it is trimmed to nothing
Accept: text/csv;delimiter=<a literal tab>      # 200, and the fields run together

# WRONG - percent-encoding does not help; nothing decodes a parameter value
Accept: text/csv;delimiter=%3B                  # 200, and the delimiter is the literal text %3B

# RIGHT - any other string, of any length
Accept: text/csv;delimiter=|
```

**The semicolon is the one that can tell you, and only when nothing follows it.** `;delimiter=;` leaves an empty parameter behind the semicolon and is rejected; `;delimiter=;` with another parameter after it leaves nothing empty to reject, so it answers `200` with the delimiter gone. A comma or whitespace is quiet either way.

**The failure is not a broken file, it is a plausible one.** With an empty delimiter every field is quoted, the quotes run together, and a CSV reader takes the whole line as a single column:

```
"@type""name""gtin""unit"
"product""Shirt, Blue""7312345678901[+]7312345678902"
```

That parses cleanly as one column named `@type"name"gtin"unit`. There is no error to catch and nothing in the body says the delimiter was dropped — **count the columns of the first row you load.**

Neither of the two loud spellings names the parameter you wrote, so the message is no help in finding it. `;delimiter=;` reports the empty parameter behind the semicolon, and the standard quoted-string form — the RFC spelling for exactly this problem — is rejected because the quote is read as part of the parameter *name*:

```
Accept: text/csv;delimiter=;      → 400  Invalid content type parameter '=', which takes string
Accept: text/csv;delimiter=";"    → 400  Invalid content type parameter '"=', which takes string
```

Three related points:

- **A comma also swallows every parameter after it**, because the two are lost at different stages: a semicolon reaches the parameters and ends one assignment, while a comma never reaches them at all — the header is a comma-separated list of media types and is cut there first. So `;delimiter=;arrayDelimiter=/` loses the delimiter and keeps the array delimiter, and `;delimiter=,;quoteChar=~~` loses both.
- **`arrayDelimiter` has the same three holes, and fails more quietly.** `;arrayDelimiter=,` joins an array's elements with nothing at all — `["7312345678901", "7312345678902"]` comes back as `"73123456789017312345678902"`, with no boundary left to recover.
- **This is not the same thing as a misspelled parameter name.** A name the format does not recognize is ignored and the default applies, so `delimiter` silently stays a comma — see [gotcha 35](#35-a-misspelled-accept-parameter-name-is-silent-a-bad-value-is-not). Here the name is right and the *value* is the problem, and in the quiet cases the delimiter does not stay a comma: it becomes nothing at all. The two produce different bodies, so the column count tells you which one you hit.

It applies to a CSV **upload** as well, since `Content-Type` is parsed the same way, and to `application/vnd.ms-sqlserver.csv`, which takes a `delimiter` of its own.

Full rules: [CSV serializer parameters](overview.md#csv-serializer-parameters).

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

> **A name member sorts, but it is not a dependable key for walking a collection.** A person with neither a
> `givenName` nor a `familyName` has no `fullName` either, and two people can share one — so a paginated walk sorted on
> a name can **stop at a page boundary** or stall on one that has none, reporting `X-Has-More: true` with no next
> cursor rather than coming back short. Sort a full walk on `identifiers/key`, which is unique and populated on every
> record, and keep name sorts for the case where the alphabetical order is itself the point.
> See [cursor requirements](pagination.md#requirements-and-notes).
