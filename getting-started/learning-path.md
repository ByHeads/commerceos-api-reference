# CommerceOS API Learning Path

Use this as a structured path for building API proficiency.

## 1) Orientation (why + where)

- Read [`../reference/overview.md`](../reference/overview.md) for the API graph and resource model.
- Read [`../reference/platform-takeaways.md`](../reference/platform-takeaways.md) for key API patterns.

## 2) Core operator fluency (how to query)

- Study [`../reference/operators.md`](../reference/operators.md).
- Practice with [`../guide/examples.md`](../guide/examples.md).
- Exercise: reproduce a `~where` query using both `~where(...)` and query params to compare behavior.

## 3) Mapped types and transforms (how to reshape)

- Read [`../reference/mapped-types.md`](../reference/mapped-types.md).
- Exercise: create a mapped type with variables and null coalescing, then `~map(...)` it on `receipts`.
- Exercise: use an array-body mapped type with `$this` and `"$first"` to build a bundle (receipts + items) from a collection.

**Example bundle mapped type:**
```json
{
  "identifiers": { "mappedTypeName": "com.example.receipt-bundle" },
  "active": true,
  "body": [
    {
      "receipt": "$this",
      "items": "$this/items",
      "payments": "$this/payments"
    },
    "$first"
  ]
}
```

This creates a mapped type that:
1. Uses `$this` to reference the current receipt being mapped
2. Uses the array-body pipeline format
3. Ends with `"$first"` to return a single result instead of an array when mapping a collection

**Note on `$this` vs `$prior`:** When mapping a collection, `$this` resolves to the current item being mapped (e.g., the individual receipt), while `$prior` resolves to the parent collection. Use `$prior` when you need aggregate data from the collection (e.g., `$prior~count`).

## 4) Resource patterns (how to navigate)

- Read [`../reference/resource-patterns.md`](../reference/resource-patterns.md).
- Exercise: pick 3 resources and list their typical sub-collections (members, relations, labels).

## 5) Cross-cutting behaviors

- Review [`../reference/platform-takeaways.md`](../reference/platform-takeaways.md) for cross-cutting API behaviors.

## 6) Targeted practice

- Create new examples in [`../guide/examples.md`](../guide/examples.md) when you learn a new pattern.
- Explore the features in [`../features/`](../features/) for advanced use cases.
