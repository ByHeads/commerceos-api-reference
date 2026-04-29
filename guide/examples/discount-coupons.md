# Discount Coupons Examples

Curl examples for discount coupons — the codes that gate when a [discount rule](./discount-rules.md) fires.

**Base URL:** `https://example.app.heads.com/api/v1`
**API Key:** `banana` (passed via Basic Auth with empty username: `-u ":banana"`)

> **See also:** [Examples Index](../examples.md) | [Discount Rules](./discount-rules.md) | [Receipt Discounts & Surcharges](./receipt-discounts-surcharges.md) | [Reference Documentation](../../reference/)

---

## What a Coupon Is, and How It Activates a Rule

A **discount coupon** is a token — usually a code presented at checkout — that activates one or more [discount rules](./discount-rules.md). The coupon does not grant a discount on its own; it is a **precondition** that the rule engine checks before evaluating the rule's effects.

The link between a coupon and a rule is the rule's `coupon` field:

```jsonc
// Excerpt from a discount rule body
{
  "coupon": {
    "include": [
      { "identifiers": { "com.heads.seedID": "summer-single" } }
    ],
    "exclude": []
  }
}
```

When a cart presents a coupon code, the engine resolves the code to a coupon, checks whether the coupon appears in the rule's `coupon.include` (and not in `coupon.exclude`), and — if the rule's other conditions match — applies the rule's `effects[]` to the matching items.

> **Coupon ≠ effect.** The coupon decides *whether* the rule fires. The rule still defines *what* the discount does (percentage, fixed amount, package price, etc.) and *which items* it targets via the `items` map and `effects[].items`.

---

## Discount Coupon Anatomy

| Property | Type | Purpose |
|----------|------|---------|
| `identifiers` | object | Common identifiers (e.g., `com.heads.seedID`). Use these to reference the coupon from a rule's `coupon.include`/`exclude`. |
| `issuer` | agent? | The party that minted the coupon — typically the company itself; for franchise/multi-tenant scenarios, a specific store or partner. Determines which sellers can resolve the code (a store can use coupons issued by its parent company, but not by sibling stores). |
| `name` | string? | Optional human-readable label (see [Code-less Coupons](#code-less-coupons-back-office-only)). |
| `code` | string? | The literal code customers enter (`SUMMER2026`), or — when `pattern` is `true` — a regular expression that defines a set of matching codes. |
| `pattern` | boolean | When `false` (default), `code` is matched exactly. When `true`, `code` is treated as a regular expression anchored at both ends. |
| `stackable` | boolean | When `false` (default), the rule engine picks the single most favorable application of the rule per cart. When `true`, the rule may fire on every qualifying line in the same cart. See [Stackable](#stackable). |
| `maxRedemptions` | number? | Total redemption cap across **all** carts and customers. Omit (or set `null`) for unlimited. |
| `redemptions` | number (read-only) | How many times the coupon has activated a rule on a finalized order. Incremented automatically. |
| `exhausted` | boolean (read-only) | Derived: `true` once `redemptions >= maxRedemptions`. An exhausted coupon stops activating rules even if its code matches. |

> **Read-only fields.** Do not include `redemptions` or `exhausted` in `POST`/`PUT`/`PATCH` bodies — they are maintained by the system.

```bash
# List all discount coupons
curl -X GET -u ":banana" "example.app.heads.com/api/v1/discount-coupons"

# Get a coupon by seed identifier
curl -X GET -u ":banana" "example.app.heads.com/api/v1/discount-coupons/com.heads.seedID=summer-single"

# Look up a coupon by literal code (no dedicated code indexer — use ~where)
curl -X GET -u ":banana" "example.app.heads.com/api/v1/discount-coupons~where(code=SUMMER2026)"
```

### Code-less Coupons (Back Office Only)

A coupon does not have to carry a `code`. A coupon with only `identifiers` (and optionally `name`) can still be added to a discount rule's `coupon.include` to gate that rule, but it cannot be activated by a customer typing a code at checkout — it is only reachable from internal/back-office workflows that attach the coupon directly. For typical customer-facing campaigns you will always want a `code`.

```bash
# A code-less coupon for back-office use
curl -X PUT -u ":banana" \
  "example.app.heads.com/api/v1/discount-coupons/com.heads.seedID=internal-token" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.heads.seedID": "internal-token"},
    "issuer": {"identifiers": {"com.heads.seedID": "ourcompany"}},
    "name": "Back-office override token"
  }'
```

---

## Literal Codes vs Pattern Codes

The `pattern` flag on the coupon controls how the engine matches a customer-supplied code against `code`.

### `pattern: false` (default) — literal match

`code` is matched **string-equal**. `SUMMER2026` matches only `SUMMER2026`.

Use literal codes for:
- One-off campaign codes printed on a flyer
- Manually administered numbered series (`PROMO-A`, `PROMO-B`, …)
- Single-use voucher codes

### `pattern: true` — regex match

`code` is a regular expression. The engine anchors the pattern to the **entire code** — that is, it matches as if the regex were wrapped in `^` and `$`. Examples:

| Pattern (`code`) | Matches | Does NOT match |
|---|---|---|
| `STUDENT\d{4}` | `STUDENT1234`, `STUDENT9999` | `MYSTUDENT12345`, `STUDENT12`, `STUDENT12345` |
| `PERSONAL-\d{4}` | `PERSONAL-0001`, `PERSONAL-9876` | `PERSONAL-12`, `PERSONAL-12345` |
| `SPRING202[0-9]` | `SPRING2024`, `SPRING2027` | `SPRING2030`, `MYSPRING2024` |

> **Anchor behaviour pinned.** Patterns are full-match. A pattern of `STUDENT` (no digits) would only match the exact code `STUDENT` — *not* `STUDENT1234`. If you want to match anywhere within the code, write the pattern explicitly: `.*STUDENT.*`.

Use pattern codes for:
- Verified-student or partner programmes that distribute many distinct codes
- Magazine/email partnerships that issue per-recipient codes
- Any case where you want one coupon record to cover a family of codes

---

## `maxRedemptions` and the `redemptions` Counter

`maxRedemptions` caps the total number of redemptions across **all carts, all customers, and (for pattern coupons) all matching codes**. The `redemptions` counter increments on each finalized order in which the coupon activated a rule. A coupon counts as **one redemption per finalized order**, regardless of how many discount lines it produced (see [Stackable](#stackable)).

| `maxRedemptions` | Behaviour |
|---|---|
| `null` / omitted | Unlimited — the coupon never exhausts. |
| Positive integer | The coupon stops activating rules once `redemptions >= maxRedemptions`. |
| `0` | The coupon is permanently inert (matches nothing — useful for force-disabling without unlinking from rules). |

The derived `exhausted` flag becomes `true` automatically once the cap is reached. You do not need to check `exhausted` manually before applying a coupon — the **checkout client (POS terminal) refuses to attach exhausted coupons** to a new cart. Reading `~with(exhausted)` on a coupon is useful for admin UIs and reporting.

```bash
# Check current redemption count and exhaustion state
curl -X GET -u ":banana" "example.app.heads.com/api/v1/discount-coupons/com.heads.seedID=summer-single~with(redemptions,exhausted)"
```

> **Drafts in progress do not consume redemptions.** A coupon attached to an unfinalised draft order is "tentatively applied" — it influences the running totals but only increments `redemptions` once the order finalises. The checkout client refuses to attach exhausted coupons to **new** carts, but a coupon already attached to an in-flight draft will keep applying through recalcs even if the cap is reached on another order in the meantime.

---

## Stackable

The `stackable` flag controls how the rule engine handles a cart where the same coupon could activate the rule on multiple line items.

| `stackable` | Behaviour |
|---|---|
| `false` (default) | The engine picks the **single most favorable** application per cart. The customer benefits once even if multiple lines would qualify. |
| `true` | The rule fires on **every qualifying line** in the cart. |

Either way, the coupon's `redemptions` counter increments by **one per finalized order** — stackable does not multiply the redemption count.

Use `stackable: false` for one-shot promotional codes (`WELCOME10`) — the customer should not be able to apply the same code five times to a 5-item cart. Use `stackable: true` for permanent discounts where each line should benefit (an employee discount that should reduce every line, not just the most expensive one).

---

## The `issuer`

The `issuer` is the agent (usually a company or store) that minted the coupon. For single-tenant deployments, this is typically the company itself. For franchise or multi-tenant deployments, a store may issue its own coupons.

The issuer scope matters at code lookup time: when a cart at store **B** resolves a customer-supplied code, the engine considers coupons issued by **B itself** and by **B's organizational ancestors** (for example, B's parent company). It does **not** consider coupons issued by sibling stores. This means:

- A company-issued coupon works at every store under that company.
- A store-issued coupon works at that store only.
- Sibling stores cannot use each other's store-specific coupons.

Set `issuer` to the company seed (e.g., `ourcompany`) for company-wide coupons; set it to a specific store seed for store-only coupons.

---

## Where Coupon Rules Sit in the Discount Stack

A coupon-driven rule still uses the rule machinery — its `phase`, `priority`, `seller`, `currency`, `items`, and `effects` work exactly as in the [rule examples](./discount-rules.md). The `coupon.include`/`exclude` field simply adds **a coupon presence requirement** on top of the rest.

> **Best practice:** put coupon-driven rules in their own `discount phase`. Otherwise a customer-supplied `WELCOME10` coupon competes in the same phase as automatic rules like a Black Friday promo, and the engine's "minimize total price" selection can let one suppress the other in surprising ways. The reference seed places coupon rules in a dedicated phase named `Discount Coupon` at priority 500 — high enough to apply on top of phase-200/300/400 promotions.

```bash
# Create a dedicated phase for coupon-driven discounts
curl -X PUT -u ":banana" \
  "example.app.heads.com/api/v1/discount-phases/com.heads.seedID=dc-phase" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.heads.seedID": "dc-phase"},
    "name": "Discount Coupon",
    "priority": 500
  }'
```

---

## Examples

The five examples below mirror the reference seed bundle. All five coupons are bound to a single rule (`dc-coupon-rule`, "10% off") via its `coupon.include` array — that one rule body works for any of the five coupons, and is shown once in [The Rule Body](#the-rule-body).

### Example A: Single-Use Campaign Code (Literal, Capped at 1)

A literal code, redeemable exactly once across all customers. Use case: "free pen with the first order on the campaign landing page."

```bash
curl -X PUT -u ":banana" \
  "example.app.heads.com/api/v1/discount-coupons/com.heads.seedID=dc-single" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.heads.seedID": "dc-single"},
    "issuer": {"identifiers": {"com.heads.seedID": "ourcompany"}},
    "code": "ONESHOT",
    "pattern": false,
    "maxRedemptions": 1
  }'
```

After the first finalized order using `ONESHOT`, `redemptions` becomes `1` and `exhausted` becomes `true`. Subsequent attempts return an "exhausted" failure (see [Failure Modes](#failure-modes-when-a-coupon-does-not-apply)).

---

### Example B: Multi-Use Limited Code (Literal, Capped at N)

A literal code redeemable a small number of times — e.g., "first two customers to use this code get the discount."

```bash
curl -X PUT -u ":banana" \
  "example.app.heads.com/api/v1/discount-coupons/com.heads.seedID=dc-multi" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.heads.seedID": "dc-multi"},
    "issuer": {"identifiers": {"com.heads.seedID": "ourcompany"}},
    "code": "MULTI",
    "pattern": false,
    "maxRedemptions": 2
  }'
```

The cap is across **all carts** — this is not "two redemptions per customer." If you need per-customer caps, scope the rule with a `buyer` condition that limits eligibility to a customer group, and rely on out-of-band issuance (one code per customer).

---

### Example C: Stackable Permanent Code (Literal, Uncapped, Per-Line)

A literal code with no redemption cap and `stackable: true`. Use case: an employee discount card — the discount should apply to every line in the cart, not just one.

```bash
curl -X PUT -u ":banana" \
  "example.app.heads.com/api/v1/discount-coupons/com.heads.seedID=dc-stackable" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.heads.seedID": "dc-stackable"},
    "issuer": {"identifiers": {"com.heads.seedID": "ourcompany"}},
    "code": "STACKABLE",
    "pattern": false,
    "stackable": true
  }'
```

A 3-item cart with `STACKABLE` produces three discount lines (one per item) but increments `redemptions` by `1`.

---

### Example D: Pattern Code, Uncapped (Regex, Every Match Fires)

A pattern coupon with no redemption cap. Use case: a verified-student programme that issues codes like `STUDENT1234`, `STUDENT9999`, etc. — every code matching `STUDENT\d{4}` activates the rule.

```bash
curl -X PUT -u ":banana" \
  "example.app.heads.com/api/v1/discount-coupons/com.heads.seedID=dc-student" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.heads.seedID": "dc-student"},
    "issuer": {"identifiers": {"com.heads.seedID": "ourcompany"}},
    "code": "STUDENT\\d{4}",
    "pattern": true
  }'
```

Note the JSON-escaped backslash (`\\d`) — the JSON layer eats one level. The actual stored regex is `STUDENT\d{4}`. The engine anchors it, so:

- `STUDENT1234` ✅ matches
- `STUDENT9999` ✅ matches
- `STUDENT12` ❌ (only two digits)
- `MYSTUDENT1234` ❌ (extra prefix — patterns are anchored)

---

### Example E: Pattern Code with Shared Cap (Regex + maxRedemptions)

A pattern coupon with a redemption cap shared across **all matching codes**. Use case: 20 personal codes distributed via a magazine partner — the partner gets to pick 20 winners total, not 20 per code.

```bash
curl -X PUT -u ":banana" \
  "example.app.heads.com/api/v1/discount-coupons/com.heads.seedID=dc-personal" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.heads.seedID": "dc-personal"},
    "issuer": {"identifiers": {"com.heads.seedID": "ourcompany"}},
    "code": "PERSONAL-\\d{4}",
    "pattern": true,
    "maxRedemptions": 20
  }'
```

The `maxRedemptions: 20` cap is **across the pattern as a whole**. The 21st redemption — regardless of which `PERSONAL-NNNN` code is used — fails with the exhausted error.

---

### Example F: Stackable Pattern Code (Regex + per-line fire)

A pattern coupon that fires on every qualifying line in the cart. Use case: an employee-discount card scheme where every employee gets a unique code matching `EMP-\d{4}`, and the discount should reduce every line they buy in a single transaction.

```bash
curl -X PUT -u ":banana" \
  "example.app.heads.com/api/v1/discount-coupons/com.heads.seedID=dc-employee" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.heads.seedID": "dc-employee"},
    "issuer": {"identifiers": {"com.heads.seedID": "ourcompany"}},
    "code": "EMP-\\d{4}",
    "pattern": true,
    "stackable": true
  }'
```

A 5-line cart with `EMP-0042` produces five discount lines and increments `redemptions` by `1`.

---

### The Rule Body

A single rule binds all five coupons via its `coupon.include` array. Any cart that resolves to one of these five coupons activates the rule (10% off the matched item). The rule's other fields (`seller`, `currency`, `phase`, `items`, `effects`) work exactly as in the [rule examples](./discount-rules.md#discount-rule-anatomy).

```bash
curl -X PUT -u ":banana" \
  "example.app.heads.com/api/v1/discount-rules/com.heads.seedID=dc-coupon-rule" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.heads.seedID": "dc-coupon-rule"},
    "name": "Discount Coupon Test Rule (10% off)",
    "seller": {"include": [{"identifiers": {"com.heads.seedID": "ourcompany"}}]},
    "currency": {"include": [{"identifiers": {"currencyCode": "SEK"}}]},
    "phase": {"identifiers": {"com.heads.seedID": "dc-phase"}},
    "includesTax": true,
    "coupon": {
      "include": [
        {"identifiers": {"com.heads.seedID": "dc-single"}},
        {"identifiers": {"com.heads.seedID": "dc-multi"}},
        {"identifiers": {"com.heads.seedID": "dc-stackable"}},
        {"identifiers": {"com.heads.seedID": "dc-student"}},
        {"identifiers": {"com.heads.seedID": "dc-personal"}}
      ]
    },
    "items": {
      "product": {
        "@type": "product condition",
        "includeAll": true,
        "atLeast": 1,
        "atMost": 1
      }
    },
    "effects": [{
      "@type": "percentage discount rule effect",
      "items": ["product"],
      "percentage": "10"
    }],
    "reason": {"identifiers": {"com.heads.seedID": "dc-reason"}}
  }'
```

You can equally split this into one rule per coupon — useful when each coupon should grant a different effect (different percentage, different item scope, etc.). Bundling all five into one rule is shorthand for "every code in this list grants the same 10%-off discount."

---

## Lifecycle and Operations

### Creating a Coupon

```bash
curl -X PUT -u ":banana" \
  "example.app.heads.com/api/v1/discount-coupons/com.heads.seedID=spring-launch" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.heads.seedID": "spring-launch"},
    "issuer": {"identifiers": {"com.heads.seedID": "ourcompany"}},
    "name": "Spring 2026 launch",
    "code": "SPRING2026",
    "pattern": false,
    "maxRedemptions": 500
  }'
```

`POST /v1/discount-coupons` (without an explicit key in the URL) is also supported — the server allocates a key. `redemptions` and `exhausted` are read-only and must not be included.

### Linking to a Rule

Either include the coupon ref at rule-create time:

```bash
curl -X PUT -u ":banana" \
  "example.app.heads.com/api/v1/discount-rules/com.heads.seedID=spring-launch-rule" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": {"com.heads.seedID": "spring-launch-rule"},
    "name": "Spring launch -10%",
    "currency": {"include": [{"identifiers": {"currencyCode": "SEK"}}]},
    "phase": {"identifiers": {"com.heads.seedID": "dc-phase"}},
    "coupon": {
      "include": [{"identifiers": {"com.heads.seedID": "spring-launch"}}]
    },
    "items": {"product": {"includeAll": true}},
    "effects": [{
      "@type": "percentage discount rule effect",
      "items": ["product"],
      "percentage": "10"
    }]
  }'
```

…or PATCH an existing rule to add the coupon later:

```bash
curl -X PATCH -u ":banana" \
  "example.app.heads.com/api/v1/discount-rules/com.heads.seedID=existing-rule" \
  -H "Content-Type: application/json" \
  -d '{
    "coupon": {
      "include": [{"identifiers": {"com.heads.seedID": "spring-launch"}}]
    }
  }'
```

### Looking Up a Coupon by Code

There is no dedicated code indexer — look up by code with `~where`:

```bash
# Exact match against the code field
curl -X GET -u ":banana" "example.app.heads.com/api/v1/discount-coupons~where(code=SPRING2026)"

# For pattern coupons, the engine itself does the regex matching at activation time.
# To find candidate pattern coupons (issuer-scoped) for inspection, fetch by issuer:
curl -X GET -u ":banana" \
  "example.app.heads.com/api/v1/discount-coupons~where(pattern=true,issuer.identifiers.com.heads.seedID=ourcompany)"
```

A customer-supplied code is matched against **every** coupon issued in the seller's organizational scope: the engine returns each literal coupon whose `code` equals the input string and each pattern coupon whose `code` regex matches it. If a single input matches more than one coupon (for example, a literal `EMP-1234` and a pattern `EMP-\d{4}` both issued by the same company), every matching coupon is considered, and any rule whose `coupon.include` lists any of them can fire. To avoid surprises, do not issue overlapping literal-and-pattern coupons in the same issuer scope unless you intend them to fire together.

In a POS or web checkout, hand the customer-supplied code to the cart and the engine handles resolution within the seller's organizational scope. You do not need to do the regex match yourself.

### Disabling a Coupon Early

A coupon with `maxRedemptions` set will exhaust naturally. To force-disable a still-uncapped or under-cap coupon early, set `maxRedemptions` to `0` (or to a value `<= redemptions`):

```bash
# Force-disable: the next attempt will fail with exhausted
curl -X PATCH -u ":banana" \
  "example.app.heads.com/api/v1/discount-coupons/com.heads.seedID=summer-single" \
  -H "Content-Type: application/json" \
  -d '{"maxRedemptions": 0}'
```

This is preferable to unlinking the coupon from every rule's `coupon.include` because:

- It is a single, atomic change.
- The coupon record stays around for reporting (you keep the historical `redemptions` count).
- Re-enabling later only requires raising `maxRedemptions` again.

Unlinking is appropriate when the campaign is permanently over and you want the coupon's code to be reusable for a future campaign.

### Inspecting Redemption History on Receipts

Every receipt-line discount carries a `coupons` array listing the coupons that activated the discount on that line:

```bash
curl -X GET -u ":banana" \
  "example.app.heads.com/api/v1/receipts/com.example.receiptId=R-12345~with(items)"
```

Excerpt of the response:

```jsonc
{
  "items": [{
    "discounts": [{
      "reason": { "name": "Discount Coupon" },
      "amountInclVat": "5.00",
      "rule": { "identifiers": { "com.heads.seedID": "dc-coupon-rule" } },
      "coupons": [
        { "identifiers": { "com.heads.seedID": "dc-single" } }
      ]
    }]
  }]
}
```

A stackable coupon that fires on multiple lines appears once per line — each line's `discounts[].coupons[]` independently lists the coupon that activated that line's discount. To aggregate "how often did this coupon redeem," consult the coupon's own `redemptions` counter (one increment per finalized order, regardless of line count).

### Deleting a Coupon

```bash
curl -X DELETE -u ":banana" "example.app.heads.com/api/v1/discount-coupons/com.heads.seedID=summer-single"
```

Deletion is rejected if the coupon is still referenced by any rule's `coupon.include`/`exclude`. Unlink it first (PATCH each rule) or, more typically, force-disable via `maxRedemptions: 0` and leave it linked for historical reporting.

---

## Failure Modes (When a Coupon Does Not Apply)

When a customer enters a code at checkout, the engine can fail to apply the discount for several reasons:

| Reason | What the customer sees | What to check |
|---|---|---|
| **Code does not match any coupon** | "Invalid coupon code" (or equivalent) | Typo in the code; or the code's coupon was deleted; or the customer is at a sibling store and the coupon is store-issued elsewhere. |
| **Coupon is exhausted** (`redemptions >= maxRedemptions`) | "Coupon fully redeemed" | The cap has been hit — increase `maxRedemptions` or issue a new coupon. |
| **Coupon already used on this draft order** | "Coupon already used on this order" | The same coupon is already attached to the cart. This check is enforced by the checkout client (the POS terminal) before the coupon is applied a second time, not by the coupon resource itself. |
| **Rule's other conditions do not match** | No discount appears (no error) | The cart's currency/seller/items/`worthAtLeast`/`atLeast` conditions on the rule are unmet. The coupon resolved fine, but the rule's other gates failed. |

> The "already used" guard is a **checkout-client concern**, not a server-side rejection. Either way, a coupon's `redemptions` counter increments at most once per finalised order regardless of how many times it might be re-applied during cart edits.

The first three are **coupon-level** failures and surface at code entry. The fourth is a **rule-level** miss — the rule simply does not fire and no discount line appears on the receipt. To diagnose, fetch the rule and verify its `seller`, `currency`, `time`, `items`, and effect conditions against the cart contents.

---

## Common Pitfalls

- **Regex special chars in literal codes.** A code like `SUMMER+2026` (literal `+` from a marketing team) is fine if `pattern: false` — the engine treats the string as-is. But if someone flips `pattern: true` later, the `+` becomes a regex quantifier. Either escape it (`SUMMER\+2026`) or keep `pattern: false`.
- **Unanchored intent on pattern codes.** Patterns are anchored at both ends — a pattern of `STUDENT` matches **only** the literal string `STUDENT`, not codes containing `STUDENT`. If you want substring behaviour, write the wildcards explicitly: `.*STUDENT.*`.
- **Forgetting to put coupon-driven rules in a dedicated phase.** Without their own phase, coupon rules compete with automatic promotions in the same phase — the engine's "minimize total price" optimisation can let one suppress the other unexpectedly. Use a dedicated `discount phase` for coupon rules (the seed uses priority 500).
- **Reusing a coupon across multiple rules.** This is allowed — the same coupon can appear in many rules' `coupon.include`. Each rule activation increments the coupon's `redemptions` counter. Make the bookkeeping explicit so admins do not double-count.
- **Writing `redemptions` or `exhausted`.** Both are read-only. Including them in `PUT`/`PATCH` bodies is rejected (or silently ignored — the result is the same: your value is not stored).
- **Confusing `coupon` (rule field) with `coupons` (receipt field).** On a [discount rule](./discount-rules.md), `coupon` is a singular condition object with `include`/`exclude` arrays of coupon refs. On a [receipt](../../reference/receipts.md) item discount, `coupons` is a plural read-only array of coupon refs that activated that specific discount line.

---

## See Also

- [Discount Rules](./discount-rules.md) — the rules that coupons activate, including `coupon.include`/`exclude` as a precondition on any rule.
- [Receipt Discounts & Surcharges](./receipt-discounts-surcharges.md) — how coupon redemptions surface on completed receipts.
- [Reference Documentation](../../reference/) — schema, operators, and pagination.
