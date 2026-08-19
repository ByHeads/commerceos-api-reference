# Operator Catalog

A complete reference of all CommerceOS API operators.

> **Quick Reference:** See [`operators.md`](operators.md) for usage patterns and recipes, or [`../guide/examples.md`](../guide/examples.md) for practical curl examples.

---

## Public Operators (URL-Pipeable)

These operators can be used directly in URLs via the `~` syntax. Think of them as pipe operators: each step consumes the output of the previous step.

**Example:** `GET /v1/products~where(status=Active)~orderBy(name)~take(10)`

---

### Projection Operators

#### ~with(selectors)

Include additional non-essential fields on each object.

**Signature:** `~with(selector1,selector2,...)`

**Example:**
```
GET /v1/products~with(prices,categories)
```

**Query param equivalent:** `?fields=default,prices,categories`

**Notes:**
- Selectors support nested paths: `~with(items~with(product))`
- Multiple fields are comma-separated
- Use for expanding relations without fetching all fields
- **A name the resource does not declare comes back as `null` rather than as an error**, so `"X": null` is not evidence that `X` exists. Same for `~just` and for a `~where` predicate. To settle it, [sort on the name](common-gotchas.md#39-a-null-in-a-response-does-not-prove-the-field-exists)
- A selector may be a single-quoted **string literal**, optionally continued with a `/` member chain or a `~` pipe: `~with(slug:'Brød & Melk'/ld)` → `"brød-melk"`. Percent-encode `,` as `%2C` and `?` as `%3F` inside the quotes — the URL is split before the literal is read. See [String Literals as a Starting Point](primitives.md#string-literals-as-a-starting-point)

---

#### ~withAll

Include all fields on each object (expands all non-essential fields).

**Signature:** `~withAll` (no parameters)

**Example:**
```
GET /v1/products~withAll
```

**Query param equivalent:** `?fields=all`

**Notes:**
- May be expensive for resources with many relations
- Prefer `~with(...)` for targeted expansion
- **It is not a member list.** A declared member the object leaves empty is omitted rather than returned as `null`, so a member's absence here says something about that object, not about the resource ([why this matters](common-gotchas.md#39-a-null-in-a-response-does-not-prove-the-field-exists))

---

#### ~without(selectors)

Exclude specified fields from each object.

**Signature:** `~without(selector1,selector2,...)`

**Example:**
```
GET /v1/products~without(createdAt,updatedAt,createdBy)
```

**Notes:**
- Useful for removing audit fields or other clutter
- Works on default fields and expanded fields
- **A name the resource does not declare is a silent no-op**, so a typo ships the very field you meant to drop — for the audit-field case above, the clutter is still in the response and nothing says so:
  ```
  GET /v1/products~without(status)~take(1)       # status is gone
  GET /v1/products~without(statuS)~take(1)       # status is still there; 200, no error
  GET /v1/products~without(nosuchfield)~take(1)  # unchanged
  ```
  [`~orderBy` is the test](#orderbyselectordesc) for whether the name exists. The same silence covers [`~where`](#wherepredicates), which at least leaves a `null` behind to notice ([why](common-gotchas.md#39-a-null-in-a-response-does-not-prove-the-field-exists)), and [`~distinctBy`](#distinctbyselector), which leaves nothing at all — and discards every item but one
- **A nested path removes its first segment, not its leaf.** `~without(identifiers/com.example.sku)` drops the entire `identifiers` object — the primary `key` with it — and it does so whether or not that identifier exists. There is no *path* spelling that keeps part of a nested object: the projections all act on the root ([details](#orderbyselectordesc)), so `~just(name,identifiers/key)` does not give you a trimmed object either; it returns the key hoisted under the name `identifiers`
- **Nesting the operator does keep the rest.** Write `~without` inside the projection instead of writing a path, and it acts on the nested object rather than on its root:
  ```
  GET /v1/products~just(name,identifiers~without(com.heads.seedID))~take(1)
  → [{"@type":"product","name":"1 kr",
      "identifiers":{"@type":"common identifiers","key":"5347b808…"}}]
  ```
  One identifier dropped, the rest kept — primary `key` included. The same nesting works under `~with` (leaving the rest of the default representation intact), under an alias (`ids:identifiers~without(...)`), and composed with itself. It is not specific to `identifiers`: a `localized text` member trims the same way, so `~just(name,receiptText~without(sv-SE))` comes back carrying the `en-US` entry and nothing else
- **Put the nesting inside `fields=`, not alongside it.** A `fields=` list re-projects the member whole, so it undoes a narrowing written as a path operator — `~with(identifiers~without(com.heads.seedID))?fields=name,identifiers` brings `com.heads.seedID` back. That is [`fields=` deciding the response shape](#justselectors) working as documented, and it is silent. Write `?fields=name,identifiers~without(com.heads.seedID)` instead, or send no `fields=` at all
- **A nested name is no better validated than a top-level one**, and on the construction above that costs something concrete: `identifiers~without(com.heads.seedId)` — one character of case — is a `200` that ships the internal identifier you were stripping for a partner. An invented namespaced name, and a locale spelled with the wrong case, are the same silent no-op. Reaching for the keep-only form first is the natural move and is the one that does not work here — see the [`~just` notes](#justselectors)

---

#### ~just(selectors)

Include only the specified fields; clears all other fields first.

**Signature:** `~just(selector1,selector2,...)`

**Example:**
```
GET /v1/products~just(name,status)
```

**Query param equivalent:** `?fields=name,status` (note: also applies `~simpleJust`)

**Notes:**
- Clears existing subunits before applying
- Use for strict whitelisting of fields
- `~just()` with empty args returns minimal object
- A name the resource does not declare is projected as `null` rather than rejected — see the [`~with` note](#withselectors)
- **It cannot filter a key out of an open type.** Nested inside another operator it behaves normally on an ordinary object — `/v1/stores~with(owner~just(name,vatId))~take(1)` returns `@type`, `name` and `vatId`, against a control of `@type`, `identifiers` and `name`. But an open type's keys are rendered whatever you project, so naming one keeps nothing out:
  ```
  GET /v1/products~with(identifiers~just(key))~take(1)
  → "identifiers":{"@type":"common identifiers","key":"5347b808…","com.heads.seedID":"1 SEK"}   # seedID survives
  GET /v1/products~with(identifiers~just(com.heads.seedID))~take(1)
  → "identifiers":{"@type":"common identifiers","com.heads.seedID":"1 SEK"}                     # key dropped
  GET /v1/products~with(identifiers~just(com.heads.seedId))~take(1)                             # one character of case
  → "identifiers":{"@type":"common identifiers","com.heads.seedID":"1 SEK"}                     # identical response
  ```
  Rows 2 and 3 are the same body: the inner `~just` never selected the identifier at all, it merely declined to name `key`. So a misspelled namespaced key is invisible here, with none of the [`null` a bad name usually echoes](common-gotchas.md#39-a-null-in-a-response-does-not-prove-the-field-exists) — that echo only appears for a name outside [reverse-domain form](#orderbyselectordesc). `identifiers~just(key)` therefore hands back the whole object and reads as proof the nesting syntax does not work. It does — reach for [`~without`](#withoutselectors) instead, which drops the key you name and keeps the rest
- **The same holds for every open type, and `identifiers` is not the one you will meet first.** A `localized text` member — `receiptText`, `signText`, `promotionTitle` and the rest — behaves identically on both halves: `receiptText~just(en-US)` returns both locales, `receiptText~without(sv-SE)` returns the one. In the keep-only form a name that is not a valid language tag is a `500` (`Incorrect locale information provided`) rather than a `null`; the `~without` form takes it at `200` as an ordinary silent no-op. What separates an open type from an ordinary one is not that it holds a declared member: `payment-methods~with(identifiers~just(key))~take(1)` does drop the declared `methodId`, while the namespaced key on `products` survives the same request. The line is **open types that render as typed objects**, and the `@type` in the body is the tell — `instanceProperties` has none (`{"currencyCode":"SEK","divisible":false,"faceValue":1}`) and no nested operator reaches into it at all, `~just`, `~without` and an invented name alike returning it whole
- It is not interchangeable with `?fields=` on a [cursor walk](pagination.md#requirements-and-notes), because the sort
  value is fetched behind the scenes only for a request carrying a `fields=` list. Without one the cursor is minted
  only if the `orderby` selector can be read from what you projected: `~just(name)` alongside `orderby=identifiers/key`
  never starts the walk, while the same request with `&fields=name` does, and so does `~just(name,identifiers)` at the
  cost of an extra object per item. Send both and `fields=` decides the response shape

---

#### ~simpleJust(names)

Keep only the given property names (no selector parsing, just property name matching).

**Signature:** `~simpleJust(name1,name2,...)`

**Example:**
```
GET /v1/products~simpleJust(name,status,gtin)
```

**Query param equivalent:** Part of `?fields=a,b` (which maps to `~just(a,b)~simpleJust(a,b)`)

**Notes:**
- Unlike `~just`, does not resolve selectors or nested paths
- Faster for simple property name filtering
- Operates on the output object's property names directly
- A name that is not on the object is simply absent from the result — `~simpleJust(name,statuS)~take(1)` returns `name` and no `statuS`. It is not an error, but unlike [`~just`](#justselectors), which projects an unrecognised name as `null`, the mistake is at least visible

---

### Filtering Operators

#### ~where(predicates)

Filter objects by predicate conditions.

**Signature:** `~where(predicate1,predicate2,...)`

**Predicate operators:**
- `=` equals
- `!=` not equals
- `>` greater than
- `<` less than
- `>=` greater than or equals
- `<=` less than or equals
- `=~` includes (for strings/arrays)
- `!~` not includes

**Truthy/falsy checks:**
- `field` — truthy check (field exists and is truthy)
- `!field` — falsy check (field is null/undefined/false/empty)

**Examples:**
```
GET /v1/products~where(status=Active)
GET /v1/products~where(status!=Discontinued)
GET /v1/products~where(gtin=~7312345)
GET /v1/products~where(hidden)
GET /v1/products~where(!hidden)
GET /v1/people~where(addresses/main/countryCode=SE)
GET /v1/products~where(status=Active,hidden=false)
```

**Query param equivalent:** `?field=value` (each param becomes a predicate)

**Notes:**
- Multiple predicates within `~where(...)` are AND-ed together
- Separators: `,` or `&` within the operator
- Multiple `~where` clauses also combine as AND
- Value parsing: `null`, `undefined`, `true`, `false` are parsed as literals; numbers and ISO dates are coerced
- Date comparison uses `.getTime()` for both sides
- For OR semantics across predicates, use [`~either(...)`](#eitherpredicates)
- **A field name is never validated — an unrecognised one is read as `null`.** The predicate still runs; it just compares against nothing. So a typo does not fail, it quietly matches the whole collection or none of it, decided only by the value you wrote against it:
  ```
  GET /v1/products~where(hidden=false)~count   # 137 - hidden is a product member
  GET /v1/stores~where(hidden=false)~count     # 0   - hidden is not a store member; 200, no error
  GET /v1/stores~where(hidden=null)~count      # 5   - every store; the same wrong name, inverted by the value alone
  ```
  Every one of those is a `200`. The `=null` form is the benign half — it passes everything through, which at least looks wrong — while a real-looking value silently returns an empty collection that reads exactly like "nothing matched". A name that filters therefore proves nothing about whether the resource declares it; [`~orderBy` is the test](#orderbyselectordesc) ([why](common-gotchas.md#39-a-null-in-a-response-does-not-prove-the-field-exists)). Misspelled *operators* fail the same quiet way — see [gotcha 24](common-gotchas.md#24-misspelled-operators-fail-silently).

---

#### ~either(predicates)

Filter objects by predicate conditions, combined with **OR**. The companion to `~where`: `~where(A,B,C)` keeps rows matching **all** predicates (AND); `~either(A,B,C)` keeps rows matching **any** predicate (OR).

**Signature:** `~either(predicate1,predicate2,...)`

**Predicate syntax:** identical to [`~where`](#wherepredicates) — the same comparison operators (`=`, `!=`, `>`, `<`, `>=`, `<=`, `=~`, `!~`), the same truthy/falsy checks, the same nested-path support, and the same value parsing.

**Examples:**
```
GET /v1/products~either(status=Active,status=Pending)
GET /v1/products~either(status=Inactive,name=~Apple)
GET /v1/products~either(status=Inactive,name=~Apple)~where(name=~Pro)
```

The third example expresses `(status=Inactive OR name=~Apple) AND name=~Pro`. Operators are applied in URL order, so `~either(A,B)~where(C)` is `(A OR B) AND C`, not `A OR (B AND C)`.

**Notes:**
- Predicates within `~either(...)` are OR-ed; use `~where` for AND semantics
- Predicates may reference the same field (set-membership) or different fields
- An empty predicate list (`~either()`) defaults to a truthy check on `$this`, matching `~where()`
- On a single-unit target, behaves as a pass/drop gate (returns `[]` to drop), matching `~where`
- Chain `~either` and `~where` to express combinations of AND and OR

---

### Ordering Operators

#### ~orderBy(selector[:desc])

> **Note (v26.1+):** the `/before/` and `/after/` time-relative endpoints already return results in timestamp order, so chaining `~orderBy(timestamp)` after them is redundant. For every other query — including `~where(timestamp...)` filters, plain collection listings, and any sort by a non-timestamp field — `~orderBy(...)` is still required when you want a specific order.

Sort a collection by a selector (ascending by default).

**Signature:** `~orderBy(selector)` or `~orderBy(selector:desc)`

**Examples:**
```
GET /v1/products~orderBy(name)
GET /v1/products~orderBy(name:desc)
GET /v1/trade-orders~orderBy(customer/name)
```

**Query param equivalent:** `?orderby=name` or `?orderby=name:desc`

> **What you can sort on.** `~orderBy(field)` — and the `?orderby=field` form — accepts any member the resource
> declares, whether or not every item has a value for it. Items missing a value sort first ascending and last
> descending. A key the resource does not declare is a `400 Invalid sort key '<field>': field not found`. There is no
> compound sort — `~orderBy(status,name)` asks for one member named `status,name` and is rejected on those grounds.
>
> A sort is a property of the collection, not of whichever item happens to come first, so `~skip`, `~take`, a preceding
> `~where` and a `fields=` projection all leave a sort's admissibility alone. A member that **filters**, though, tells
> you nothing about whether it sorts — the filter layer validates no names at all and reads one it does not recognise
> as null, so every name filters, including one you invented:
>
> ```
> GET /v1/stores~where(hidden=null)~take(5)        → 200   (hidden is a product member, not a store member)
> GET /v1/stores~where(nosuchfield=null)~take(5)   → 200   ← any name at all is accepted here
> GET /v1/stores~orderBy(hidden)~take(5)           → 400   Invalid sort key 'hidden': field not found
> ```
>
> That is the benign half of the filter's silence. Written against a real-looking value the same typo returns an empty
> collection instead of the whole one — see the [`~where` notes](#wherepredicates).
>
> **The sort itself is the test.** `~orderBy(X)~take(1)` against a non-empty collection is a `400` if and only if the
> resource does not declare `X`. No response body answers that question: naming an undeclared member in a projection
> returns `"X": null` — the operator echoes back the name you gave it — while `fields=all` *omits* a declared member
> that happens to be empty. So a `null` proves nothing and an absence proves nothing
> ([worked example](common-gotchas.md#39-a-null-in-a-response-does-not-prove-the-field-exists)). Two cases the `400`
> does not reach are in the notes below.

**Where the empty ones land.** An item with no value for the sort field sorts **first** ascending and **last**
descending. It is a straight reversal, not a "nulls always last" convention:

```
GET /v1/stores~orderBy(organizationNumber)       → Shade Stockholm (no number), then 5566391237 … 5566397388
GET /v1/stores~orderBy(organizationNumber:desc)  → 5566397388 … 5566391237, then Shade Stockholm
```

On a sparsely-populated member that puts every blank record in one block at the head of an ascending sort, and the
block can fill the whole first page — `products~orderBy(unit)~take(6)` comes back as six products with no `unit` at
all. The sort will not drop them for you. If you want only the records that *have* the field, say so before you sort:

```
GET /v1/products~where(unit!=null)~orderBy(unit)~take(3)
```

On a cursor walk the direction decides where the [no-cursor stall](pagination.md#requirements-and-notes) bites:
ascending, the empty block is at the head, so a walk over a sparse member can stall on its very first page.

**Notes:**
- **There is no compound sort.** `~orderBy` accepts a single selector, and a comma does not start a second sort key — it becomes part of the selector, which then names a member no type declares, so `~orderBy(status,name)` (or `?orderby=status,name`) is a `400` with `details` of `Invalid sort key 'status,name': field not found`. That is the ordinary unknown-key rejection, so it inherits the empty-collection exception below: over a collection with nothing in it, `~orderBy(status,name)` is a `200`. With a cursor `after` token present the request is rejected one layer earlier, with `Cursor pagination with compound sort not yet supported`, and that layer has no such exception — it refuses an empty collection too ([both layers side by side](pagination.md#requirements-and-notes))
- Nested paths supported: `~orderBy(customer/name)`
- **A sort key names a member, and `$this` is the one spelling that does not.** `$this` means the item itself, so
  `~orderBy($this)` is [`~order`](#orderascdesc) under another name: on a collection of scalars it works and matches
  `~order(asc)`, and on a collection of resources it is a `400` — the same rejection, with the operator named after
  itself:
  ```
  GET /v1/people/{key}/languages~order(desc)~orderBy($this)  → 200  ["en","sv"]
  GET /v1/products~orderBy($this)~take(2)                    → 400
  ```
  ```
  orderBy($this) sorts items by their own value, which needs a collection of scalars:
  these items are objects — use orderBy(<member>) to sort on a member
  ```
  The alias form `~orderBy(x:$this)`, the descending form `~orderBy($this:desc)` and the query parameter
  `?orderby=$this` all reach the same place. If you meant to sort objects, name the member.
- **An empty collection validates nothing.** With no items to sort the check short-circuits and any key is accepted, so a sort key confirmed against a test set that happens to be empty can still fail against real data:
  ```
  GET /v1/products~where(name=__nope__)~orderBy(nosuchfield)~take(5)  → 200, []
  GET /v1/products~orderBy(nosuchfield)~take(5)                       → 400
  ```
- **A key under `identifiers/` is checked for its shape, not for its existence.** The identifier namespace is open, so there is no member list to check a name against. What is checked instead is that the key is written as **exactly three dot-separated segments, with no dash in the first** — `com.example.sku`. Nothing is looked up, so the shape is the whole test, and which side of it your key falls on decides which of two failures you get:
  ```
  GET /v1/products~orderBy(identifiers/com.example.nope)~take(4)       → 200  well formed, so admitted — and sorted by nothing
  GET /v1/products~orderBy(identifiers/nope)~take(4)                   → 400  one segment
  GET /v1/products~orderBy(identifiers/com.example.orders.id)~take(4)  → 400  four segments
  GET /v1/products~orderBy(identifiers/com-example.a.b)~take(4)        → 400  dash in the first segment
  ```
  Both halves cost something, and the answer to "why didn't my sort work" is the same sentence in both cases — the key was never looked up.

  **The shape is checked here and nowhere else.** `~orderBy` is the only operator that rejects on it: `~where`, `~just`, `~with`, `~without` and `~distinctBy` all take `identifiers/com.example.orders.id` at `200`. What they do with it differs, and no two of them agree. `~where` adds the literal path as a member name and leaves the real `identifiers` object alone. `~distinctBy` reads the path without projecting it, so the items come back exactly as they would have without the operator — but the key resolves to nothing on every one of them, so they all count as duplicates and [only a single item survives](#distinctbyselector). The projections act on the path's **first segment** instead — `~just`, `~with` and `fields=` render whatever the path resolved to *under the root's name*, so a leaf that resolves to nothing replaces the whole `identifiers` object with `null`, and `~without` drops that object outright. That last one is the same collapse that turns `identifiers` into a bare key string on a `fields=identifiers/key` walk. So a key that a filter or a projection accepts can still be a `400` on a sort — and accepting it is not free: under `~with` or `~without` it costs you the object you already had, and under `~distinctBy` all but one of your items.

  A `null` root is not itself a diagnosis, though: `~just(name,parentGroup/name)` renders `"parentGroup": null` on a product with no parent group, and sorting on that same path is a `200`. The sort is still the only test.

  **Well formed, so silent.** A misspelling *inside* a valid key is invisible: no error, a `200`, and the collection in its natural order. `com.example.itemId` and `com.example.itemID` differ by one character's case, are both admitted, and nothing in the response distinguishes the one that sorted from the one that did not. This is the realistic mistake, because reaching for your own namespace instead of `identifiers/key` is a reasonable thing to do — for your own records it is unique and always populated. Verify a sort like this by checking that the first and last items actually differ in the value you sorted on. On a cursor walk it surfaces as the [no-cursor stall](pagination.md#requirements-and-notes) instead, since no item has a value to resume from.

  **Malformed, so `400` — and the message misattributes the cause.** `com.example.orders.id` is perfectly ordinary reverse-domain notation, and it is rejected on shape alone, before any identifier is consulted. The `details` read `Invalid sort key 'identifiers/com.example.orders.id': field not found`, which sounds like "you have no such identifier" when it means "that is not a key I will accept". Count the segments before you go looking for the data. Typos *inside* a typed path are caught the same way — `identifiers/kye`, `prices/nosuchthing` and `nosuchparent/key` are all `400`.
- Collects all items in memory before sorting — not suitable for very large collections
- **Blocks the short-circuit.** A `~take`/`~first` after a sort still waits for the whole collection to be sorted; that is inherent, since the top N cannot be known without seeing every row. If you need *any* N rows rather than the *first* N, leave `~orderBy` out and the request stops early ([details](operators.md#limiters-stop-the-scan-early)).

---

#### ~order(asc|desc)

Sort a collection of **scalars** by the items themselves. Where [`~orderBy`](#orderbyselectordesc) takes a member to
sort on, `~order` has none to take — the item *is* the value — so this is the operator for a collection of strings or
numbers, and `~orderBy` is the one for a collection of objects.

**Signature:** `~order(asc)`, `~order(desc)`, or `~order()` for the ascending default. The parentheses are not
optional; see the first note below.

**Examples:**
```
GET /v1/people/{key}/languages             → ["en","sv"]
GET /v1/people/{key}/languages~order(asc)  → ["en","sv"]
GET /v1/people/{key}/languages~order(desc) → ["sv","en"]
```

Scalar collections are thinner on the ground than they look: a person's `languages` and a product's `gtin` are the two
you can navigate to directly. The result is an ordinary array, so the array operators chain onto it —
`languages~order(desc)~first` is `"sv"`.

> **Over a collection of resources it is a `400`, and the message names what to write instead.** `/v1/products` holds
> objects, not scalars, so `~order(asc)` on it is rejected with `details` of:
>
> ```
> order sorts items by their own value, which needs a collection of scalars:
> these items are objects — use orderBy(<member>) to sort on a member
> ```
>
> An object has no one value to be sorted *by*, so name the member you mean: `~orderBy(name)`.

**Notes:**
- **The parentheses are not optional, and leaving them off fails quietly.** A bare `~order` is not the ascending
  default — it returns the operator itself as an object, `200`, and everything downstream then applies to *that*
  rather than to your collection. `languages~order` is `{"@type":"order"}`, `languages~order~count` answers `1`, and
  `products~order~take(2)` answers `{"@type":"take"}` — a request that looks like it ran. Write `~order()` for
  ascending. This is not an `~order` quirk: [every argument-taking operator](operators.md#parameter-rules) does the
  same when written bare, and `~order` is only the one whose optional-sounding argument invites it
  ([gotcha 9](common-gotchas.md#9-parentheses-required-on-argument-taking-operators-forbidden-on-the-rest)).
- The argument is `asc` or `desc` exactly. Anything else — including a case slip — is a `404`, not a silent no-op:
  `~order(ASC)`, `~order(Desc)` and `~order(nonsense)` are all "The requested resource was not found."
- **An empty collection accepts it**, the same way it accepts any [sort key](#orderbyselectordesc):
  `products~where(name=__nope__)~order(asc)` is `200 []`. So a shape mismatch confirmed against a test set that
  happens to be empty can still be a `400` against real data.
- `~orderBy($this)` is the same read under another spelling — see the [`~orderBy` notes](#orderbyselectordesc).

---

### Distinct Operators

#### ~distinct

Deduplicate streams by value identity.

**Signature:** `~distinct` (no parameters)

**Example:**
```
GET /v1/products/status~distinct
```

**Notes:**
- Works on primitives (strings, numbers)
- For objects, use `~distinctBy(selector)`
- Maintains first occurrence, drops subsequent duplicates

---

#### ~distinctBy(selector)

Deduplicate objects by a selector value.

**Signature:** `~distinctBy(selector)`

**Examples:**
```
GET /v1/products~distinctBy(status)
GET /v1/trade-orders~distinctBy(customer/identifiers/key)
```

**Notes:**
- Evaluates selector per item
- Drops subsequent items with duplicate selector values
- Supports nested paths
- **The selector is never validated, and an unrecognised one collapses the collection to a single item.** Every item evaluates it to nothing, so they all count as duplicates of each other and exactly one survives — a `200`, no error, and the rest silently discarded:
  ```
  GET /v1/products~count                          # 156
  GET /v1/products~distinctBy(name)~count         # 147
  GET /v1/products~distinctBy(nosuchfield)~count  # 1   - 200, and 155 items are gone
  ```
  **Nothing in the response says so.** `~distinctBy` reads its selector without projecting it, so the item that survives is byte-identical to the one the same request returns without the operator — no stray member named after the selector, and no `null` to notice. The count is the only signal you get, and it cannot tell you which happened either: a genuinely single-valued member answers `1` too, so `~distinctBy(status)~count` is also `1` on a catalogue where every product is Active. [`~orderBy` is the test](#orderbyselectordesc) for whether the resource declares the name. The same silence covers [`~where`](#wherepredicates), which does leave a `null` behind ([why](common-gotchas.md#39-a-null-in-a-response-does-not-prove-the-field-exists)), and [`~without`](#withoutselectors), which does not

---

### Transformation Operators

#### ~map(typeName)

Apply a registered mapped type to transform each object.

**Signature:** `~map(mappedTypeName)`

**Example:**
```
GET /v1/products~map(com.example.export)
```

**Notes:**
- Looks up a mapped type by name in `/mapped-types`
- The name must match the `mappedTypeName` identifier exactly
- Strips `@type` annotations from output
- Map always returns **one result per source item**
- For single-result aggregation (collapsing multiple inputs to one), use an array-body mapped type with `$prior` and a trailing `"$first"` sentinel:
  ```json
  {
    "body": [{ "total": "$prior/totalAmount", "items": "$prior/items" }, "$first"]
  }
  ```

> **Note:** `"$first"` limits the mapped stream to the first result, but collection responses still serialize as a single-element array. Use `~first` after `~map(...)` if you need a single object.

---

#### ~array

Wrap a single item in an array.

**Signature:** `~array` (no parameters)

**Example:**
```
GET /v1/products/com.example.sku=ABC~array
```

**Notes:**
- Useful for ensuring consistent array output
- Input: single object; Output: array with one element
- Common in sync-webhook side-effect writes, where a collection target expects an array even for a single item: `"api/v1/stock-entries": "$this~map(com.example.entry)~array"` (see [`then.set` key routing](sync-webhooks.md#thenset-key-routing))
- **The name is `~array` — there is no `~arr` alias.** A misspelled operator resolves silently to an empty value rather than erroring; see [Misspelled Operators Fail Silently](common-gotchas.md#24-misspelled-operators-fail-silently)

---

#### ~flat

Flatten nested arrays one level deep.

**Signature:** `~flat` (no parameters)

**Example:**
```
GET /v1/products~with(categories)~flat
```

**Notes:**
- Flattens one level of nesting
- Input: `[[a, b], [c, d]]`; Output: `[a, b, c, d]`

---

#### ~entries

Convert a keyed **object** into an array of its key-value pairs — the way to walk a member whose keys you do not know
ahead of time.

**Signature:** `~entries` (no parameters)

**Example:**
```
GET /v1/agents/{key}/addresses~entries
→ [{"@type":"entry","key":"main","value":{"@type":"address","line1":"Kungsgatan 10", ...}},
   {"@type":"entry","key":"home"},
   {"@type":"entry","key":"invoice"}]
```

**Output format:** `[{key, value}, ...]`. A slot the object leaves empty keeps its `key` and simply has no `value`,
which is the ordinary [null omission](overview.md#format-specific-behaviors) rather than anything to do with this
operator.

**Notes:**
- `@type` is not one of the entries — the operator walks the object's members, not its type annotation. Each entry
  carries an `@type` of its own (`"entry"`).
- **`index` is not in the output unless you ask for it.** `~entries~with(index)` adds a 1-based position to every
  entry; a plain `~entries` has no `index` member at all.
- **It needs an object, and over a collection it silently discards everything.** Given a collection — of scalars or of
  resources, it makes no difference — `~entries` returns one wrapper per element carrying **neither key nor value**:

  ```
  GET /v1/people/{key}/languages       → ["en","sv"]
  GET /v1/people/{key}/languages~entries → [{"@type":"entry"},{"@type":"entry"}]

  GET /v1/products~count               → 156
  GET /v1/products~entries~count       → 156        ← the count survives
  GET /v1/products~entries~first       → {"@type":"entry"}   ← and nothing else does
  ```

  The element count is preserved and every value is gone, at `200`, with no error. So reaching for `~entries` to index
  a collection is the one shape to avoid: to pair a scalar collection with positions, request the index
  (`~entries~with(index)`) and you get `[{"@type":"entry","index":null}, ...]` — the positions are lost too.
- **The tell is a missing `key`.** An entry with a `key` and no `value` is an empty slot on a real object; an entry
  with *neither* means `~entries` had nothing to key on and you handed it a collection. Asking the entries directly
  will not tell you — `~just(key,value)` answers `{"key":null,"value":null}` whether or not those members ever held
  anything, the same silence as [naming a member that does not exist](common-gotchas.md#39-a-null-in-a-response-does-not-prove-the-field-exists).

---

#### ~typeless

Set context flag to strip `@type` from output.

**Signature:** `~typeless` (no parameters)

**Example:**
```
GET /v1/agents~typeless
```

**Notes:**
- Removes `@type` discriminators from polymorphic types
- Affects all items in the output stream

---

#### ~join(separator)

Join array elements into a string.

**Signature:** `~join(separator)`

**Example:**
```
GET /v1/products/com.example.sku=ABC/gtin~join(,)

# Re-punctuate a value: split on ":", join with "_"
GET /v1/products/com.example.sku=ABC/name//=%3A~join(_)
```

**Notes:**
- Default separator is `,` if not specified
- Input must be an array
- The inverse of the string [`/={separator}`](primitives.md#splitting-a-string-into-an-array) split member, so the two compose into a single-request re-punctuation

---

#### ~toLower

Convert string to lowercase.

**Signature:** `~toLower` (no parameters)

**Example:**
```
GET /v1/products/com.example.sku=ABC/name~toLower
```

**Notes:**
- Returns `undefined` for non-string values

---

#### ~toUpper

Convert string to uppercase.

**Signature:** `~toUpper` (no parameters)

**Example:**
```
GET /v1/products/com.example.sku=ABC/name~toUpper
```

**Notes:**
- Returns `undefined` for non-string values

---

#### ~toString

Convert value to its string representation.

**Signature:** `~toString` (no parameters)

**Example:**
```
GET /v1/products~count~toString
```

**Notes:**
- Uses `.toString()` on the value
- Useful for converting numeric results for `text/plain` output

---

### Pagination Operators

#### ~take(n)

Take first N items from the stream.

**Signature:** `~take(N)`

**Example:**
```
GET /v1/products~take(10)

# Stable pagination with sorting
GET /v1/products~orderBy(name)~take(50)
```

**Query param equivalent:** `?limit=10`

**Notes:**
- `~take(0)` returns empty result
- `~take(1)` returns first item as part of a collection
- **Short-circuits the scan.** `~take` stops pulling items through the pipeline once it has N of them, so an upstream `~where` is never evaluated against the rest of the collection. Put the filter **before** the limiter — `~take(1)~where(...)` truncates first and then filters, which usually returns `[]`. See [Limiters stop the scan early](operators.md#limiters-stop-the-scan-early).
- An upstream `~orderBy` cancels the benefit: the sort has to consume everything before `~take` can slice it.
- Pair with `~orderBy(selector[:desc])` for stable pages (single selector only)
- Query params **can** be mixed with operators. See [Query Parameter Normalization](#query-parameter-normalization) below.

---

#### ~skip(n)

Skip first N items from the stream.

**Signature:** `~skip(N)`

**Example:**
```
GET /v1/products~skip(20)~take(10)

# Page 3 with stable sort
GET /v1/products~orderBy(name)~skip(100)~take(50)
```

**Query param equivalent:** `?offset=20`

**Notes:**
- `~skip(0)` is a no-op
- Combine with `~take` for pagination — `~skip(N)~take(M)` stops after N + M items rather than walking the whole collection
- **Skipped records are stepped over, not built** — but only when nothing filters, sorts or projects in front of the skip. `~skip(N)~take(M)` builds the M records it returns; `~where(...)~skip(N)~take(M)` and `~orderBy(...)~skip(N)~take(M)` have to read the earlier records to know which ones they are. See [A skip is only cheap while nothing filters, sorts or projects before it](operators.md#a-skip-is-only-cheap-while-nothing-filters-sorts-or-projects-before-it)
- **Write a projection after the skip, not before.** `~skip(1000)~take(10)~just(name)` projects the ten records returned; `~just(name)~skip(1000)~take(10)` projects all 1010. `?fields=` always produces the second shape — it is normalized ahead of the skip and cannot be moved
- The saving applies per record, not to the count — a page still starts by walking N records, so deep offsets stay proportional to the offset. Prefer a cursor or a time window for whole-collection exports
- Works the same on a member or relation collection: `GET /v1/products/com.example.sku=ABC/categories~skip(2)`
- Skipping past the end returns an empty collection (`[]` in JSON), not an error
- Use the same `~orderBy` selector on every page to avoid duplicates or gaps

---

#### ~repeat(n)

Repeat the input N times.

**Signature:** `~repeat(N)`

**Example:**
```
GET /v1/products/com.example.sku=ABC~repeat(3)
```

**Notes:**
- Repeats the input item N times in the output stream
- Default is 1 if not specified

---

### Reducer Operators

Reducers collapse a collection to a single value.

#### ~first

Return the first item from a collection.

**Signature:** `~first` (no parameters)

**Example:**
```
GET /v1/products~orderBy(name)~first

# Filter first, then reduce — stops at the first match
GET /v1/products~where(gtin=7312345678901)~first
```

**Notes:**
- Returns `null` if collection is empty
- Returns a single object, not an array
- **Short-circuits the scan** like `~take(1)`: an upstream `~where` stops being evaluated as soon as one item matches. Keep the filter on the left of `~first`. See [Limiters stop the scan early](operators.md#limiters-stop-the-scan-early).

---

#### ~last

Return the last item from a collection.

**Signature:** `~last` (no parameters)

**Example:**
```
GET /v1/products~orderBy(name)~last

# Split a composite value and keep the tail
GET /v1/products/com.example.sku=ABC/name//=-~last
GET /v1/new~with(tail:'32891238%3Awdajdi21jdj2j123'//=%3A~last)
```

**Notes:**
- Returns `null` if collection is empty
- Returns a single object, not an array
- **Consumes the whole collection** — it has to reach the end to know which item is last. `~orderBy(selector:desc)~first` often answers the same question and stops at the first item.
- Applies to any array, including one produced by [splitting a string](primitives.md#splitting-a-string-into-an-array) with `/={separator}` — that pairing is the usual way to pull the tail off a composite identifier

---

#### ~count

Return the count of items as a number.

**Signature:** `~count` (no parameters)

**Example:**
```
GET /v1/products~where(status=Active)~count
```

**Notes:**
- Returns `0` for empty collections
- Returns a number, not an array
- **Consumes the whole collection** — unlike `~take`/`~first` there is nothing to short-circuit, since every matching item has to be seen to be counted. Use `~where(...)~take(1)~count` when all you need to know is whether *any* item matches.
- Use `~count~toString` for `text/plain` output

---

### Diagnostic Operators

These operators are for debugging and testing purposes.

#### ~test(flag)

Print metadata about the passed stream of objects.

**Signature:** `~test(flag)`

**Example:**
```
GET /v1/products~test(debug)
```

**Notes:**
- For diagnostic use only
- Logs stream metadata to console
- Does not affect output

---

#### ~throwAt(n)

Throw an exception after N elements have passed through.

**Signature:** `~throwAt(N)`

**Example:**
```
GET /v1/products~throwAt(5)
```

**Notes:**
- For testing error handling
- Zero-indexed: `~throwAt(0)` throws immediately
- Not for production use

---

## Query Parameter Equivalents Reference

| Operator | Query Parameter | Notes |
|----------|-----------------|-------|
| `~take(n)` | `?limit=n` | |
| `~skip(n)` | `?offset=n` | |
| `~orderBy(field)` | `?orderby=field` | |
| `~orderBy(field:desc)` | `?orderby=field:desc` | |
| `~withAll` | `?fields=all` | |
| `~just(a,b)` | `?fields=a,b` | Also applies `~simpleJust` |
| `~just()` | `?fields=none` | Empty selection |
| `~with(extra)` | `?fields=default,extra` | |
| `~where(field=value)` | `?field=value` | Each param becomes a predicate |

---

## Query Parameter Normalization

Query parameters and path operators **can be mixed** in the same request. The system normalizes all query parameters into operators and appends them after any path operators in the following **canonical order**:

```
format → where → orderBy → fields → skip → take → simpleJust
```

**Example - mixing works:**
```
GET /v1/products~orderBy(name)?limit=2
```
This is equivalent to:
```
GET /v1/products~orderBy(name)~take(2)
```

**Important:** Because query parameters are translated after path operators, the canonical order ensures:
- Sorting (`orderBy`) always runs **before** pagination (`skip`/`take`)
- This happens regardless of URL parameter order

**Example - parameter order doesn't matter:**
```
GET /v1/products?limit=10&orderby=name
GET /v1/products?orderby=name&limit=10
```
Both produce identical results because `orderBy` is applied before `take` in the canonical pipeline.

**Best practice:** For maximum clarity, prefer explicit operators when order matters:
```
GET /v1/products~orderBy(name)~skip(20)~take(10)
```

---

## See Also

- [Operators Reference](operators.md) — Usage patterns and recipes
- [Mapped Types](mapped-types.md) — Custom type transformations for `~map`
- [Examples](../guide/examples.md) — Practical curl examples
- [Overview](overview.md) — API basics and authentication
