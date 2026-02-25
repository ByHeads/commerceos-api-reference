# Streaming

By default, the API buffers all results before sending the response. For large datasets or batch mutations, you can opt in to **streaming** to receive data incrementally as it becomes available. This reduces memory usage, lowers time-to-first-byte, and lets clients begin processing results before the full response is ready.

Streaming uses the same JSON format — results are delivered as newline-delimited JSON (NDJSON), one object per line.

> **See also:** [`reference/overview.md`](../reference/overview.md) for content type basics and serializer parameters.

---

## Table of Contents

1. [Output Streaming (GET Responses)](#1-output-streaming-get-responses)
2. [Input Streaming (Batch Mutations)](#2-input-streaming-batch-mutations)
3. [Transaction Chunking](#3-transaction-chunking)
4. [Error Handling](#4-error-handling)
5. [When to Use Streaming](#5-when-to-use-streaming)
6. [Quick Reference](#6-quick-reference)

---

## 1. Output Streaming (GET Responses)

To stream a `GET` response, add `;stream=true` to the `Accept` header:

```bash
curl -fsSL http://localhost:5000/api/v1/products \
  -H "Accept: application/json;stream=true" \
  -u ":banana"
```

The response is sent as `application/x-ndjson` — one JSON object per line, streamed as items are read from the database in batches. This is especially useful for large collections where buffering the entire result set would be slow or memory-intensive.

You can also request NDJSON directly:

```bash
curl -fsSL http://localhost:5000/api/v1/products \
  -H "Accept: application/x-ndjson" \
  -u ":banana"
```

### How It Works

Items are read from the database in batches (default 200 items per batch), each within its own read transaction. After each batch commits, its items are yielded to the output stream before the next batch begins.

```
[Batch 1: 200 items] → commit → stream → [Batch 2: 200 items] → commit → stream → ...
```

> **Note:** Because each batch uses a separate read transaction, the result set may not reflect a single point-in-time snapshot when data is changing concurrently. For snapshot-consistent reads, use the default buffered mode.

### Output Formats

| Accept Header | Behavior |
|---------------|----------|
| `application/json` | Buffered (all items read, then full JSON array sent) |
| `application/json;stream=true` | Items read in batches, streamed as NDJSON after each batch |
| `application/x-ndjson` | Always streams — one JSON object per line |
| `text/csv` | Streams — header row + one row per item |

---

## 2. Input Streaming (Batch Mutations)

When sending large arrays in `PUT`, `POST`, or `PATCH` requests, the API splits the input into transaction chunks (default 200 items per chunk). Each chunk is committed in its own database transaction.

By default, all chunks are processed and results are buffered before the response is sent. To stream results back as each chunk commits, add `;stream=true` to the `Content-Type` header:

```bash
curl -fsSL -X PATCH http://localhost:5000/api/v1/products -u ":banana" \
  -H "Content-Type: application/json;stream=true" \
  -H "Accept: application/json;stream=true" \
  -d '[{"identifiers":{"com.example.id":"1"},"name":"A"}, {"identifiers":{"com.example.id":"2"},"name":"B"}]'
```

You can also send input as NDJSON, which always streams:

```bash
curl -fsSL -X PATCH http://localhost:5000/api/v1/products -u ":banana" \
  -H "Content-Type: application/x-ndjson" \
  -H "Accept: application/json;stream=true" \
  --data-binary @- << 'EOF'
{"identifiers":{"com.example.id":"1"},"name":"A"}
{"identifiers":{"com.example.id":"2"},"name":"B"}
EOF
```

### Input Content Types That Stream

| Content-Type | Streaming |
|--------------|-----------|
| `application/json` | Buffered (default); add `;stream=true` to stream |
| `application/json;stream=true` | Streams — results sent after each chunk commits |
| `application/x-ndjson` | Always streams |
| `text/csv` | Always streams |

> **Tip:** When streaming input, also set `Accept: application/json;stream=true` (or `Accept: application/x-ndjson`) to stream the response. Otherwise the output is buffered even though the input was processed in streaming mode.

---

## 3. Transaction Chunking

Batch mutations are always split into transaction chunks, regardless of streaming. Each chunk is committed atomically — if a chunk fails, items from that chunk are rolled back, but previously committed chunks remain.

The default chunk size is **200 items**.

### Controlling Chunk Size

Use the `X-Transaction-Count` header to control how many items are processed per transaction:

```bash
# Process 50 items per transaction
curl -X PATCH http://localhost:5000/api/v1/products -u ":banana" \
  -H "X-Transaction-Count: 50" \
  -d '[...]'

# Process all items in a single transaction (all succeed or all fail)
curl -X PATCH http://localhost:5000/api/v1/products -u ":banana" \
  -H "X-Transaction-Count: all" \
  -d '[...]'
```

| Header Value | Behavior |
|--------------|----------|
| *(not set)* | 200 items per transaction (default) |
| `50` | 50 items per transaction |
| `all` | All items in one transaction |
| `-1` | All items in one transaction |
| `*` | All items in one transaction |

### Chunking Behavior

```
Input: [item1, item2, ..., item500]
X-Transaction-Count: 200 (default)

Transaction 1: items 1–200   → commit ✓
Transaction 2: items 201–400 → commit ✓
Transaction 3: items 401–500 → commit ✓ (or rollback on error)
```

If transaction 3 fails, items 1–400 remain committed. Only the items in the failing chunk are rolled back.

---

## 4. Error Handling

How errors are reported depends on whether streaming is enabled.

### Without Streaming (Default)

The API buffers all results, so if an error occurs at any point, a proper HTTP error response is returned with the correct status code. The error body includes `processedCount` (number of items committed before the failure) and `failedAtIndex` (the 0-based index of the item that caused the error):

```json
{
  "@type": "bad request",
  "error": "Invalid value for field 'name'.",
  "processedCount": 200,
  "failedAtIndex": 200
}
```

The HTTP status code (e.g., 400) is set correctly because headers hadn't been sent yet.

### With Streaming

HTTP headers (including the status code) are sent before the first item. If an error occurs mid-stream, the status code cannot be changed — it may still show 200. Instead, a `mid-stream error` JSON object is appended to the response stream:

```json
{
  "@type": "mid-stream error",
  "error": "An error occured while streaming the response body. The status code and headers might still indicate success.",
  "processedCount": 200,
  "failedAtIndex": 200,
  "innerError": {
    "@type": "bad request",
    "error": "Invalid value for field 'name'."
  }
}
```

All data preceding the error object is valid and committed. The `processedCount` and `failedAtIndex` fields help clients understand exactly how far processing got before the failure.

> **Important:** When consuming streaming responses, always check the last line for `"@type": "mid-stream error"`. A 200 status code does not guarantee all items were processed successfully.

### Error Handling Checklist

| Mode | HTTP Status Accurate? | Error Location | Partial Data? |
|------|----------------------|----------------|---------------|
| Buffered | Yes | Response body | No — all or nothing per response |
| Streaming | May be 200 despite error | Last line of stream | Yes — all lines before the error are committed |

---

## 5. When to Use Streaming

### Good Use Cases

- **Large exports:** Streaming large collections (thousands of items) to reduce memory pressure and get results faster.
- **Bulk imports:** Importing large datasets where you want incremental progress feedback.
- **Memory-constrained clients:** Mobile or embedded clients that cannot buffer entire result sets.
- **Pipeline processing:** When each item can be processed independently as it arrives.

### When to Avoid Streaming

- **Small requests:** For collections under a few hundred items, buffered mode is simpler with proper error handling.
- **Atomic error handling:** When you need a clean HTTP status code on failure, use buffered mode. Or use `X-Transaction-Count: all` to ensure all-or-nothing semantics.
- **Snapshot consistency:** Streaming reads use batched transactions; for a consistent point-in-time view, use the default buffered mode.
- **Client libraries that don't support NDJSON:** Standard JSON parsers expect a complete JSON array. Streaming requires a line-by-line parser.

### Decision Guide

```
Need to process > 1000 items?
  ├── Yes → Use streaming (Accept/Content-Type with stream=true)
  │   └── Need all-or-nothing? → Add X-Transaction-Count: all
  └── No  → Use default buffered mode
```

---

## 6. Quick Reference

### Stream a Large GET Response

```bash
# NDJSON output
curl -fsSL http://localhost:5000/api/v1/products \
  -H "Accept: application/x-ndjson" \
  -u ":banana"

# JSON with streaming
curl -fsSL http://localhost:5000/api/v1/products \
  -H "Accept: application/json;stream=true" \
  -u ":banana"
```

### Bulk Import with Streaming

```bash
# NDJSON input + output
curl -fsSL -X PUT http://localhost:5000/api/v1/products -u ":banana" \
  -H "Content-Type: application/x-ndjson" \
  -H "Accept: application/x-ndjson" \
  --data-binary @- << 'EOF'
{"identifiers":{"com.example.sku":"PROD-001"},"name":"Widget","status":"Active"}
{"identifiers":{"com.example.sku":"PROD-002"},"name":"Gadget","status":"Active"}
{"identifiers":{"com.example.sku":"PROD-003"},"name":"Gizmo","status":"Active"}
EOF
```

### Bulk Import in a Single Transaction

```bash
curl -fsSL -X PUT http://localhost:5000/api/v1/products -u ":banana" \
  -H "Content-Type: application/x-ndjson" \
  -H "Accept: application/x-ndjson" \
  -H "X-Transaction-Count: all" \
  --data-binary @- << 'EOF'
{"identifiers":{"com.example.sku":"PROD-001"},"name":"Widget","status":"Active"}
{"identifiers":{"com.example.sku":"PROD-002"},"name":"Gadget","status":"Active"}
EOF
```

### Stream With Custom Chunk Size

```bash
# 50 items per transaction, streamed
curl -fsSL -X PATCH http://localhost:5000/api/v1/products -u ":banana" \
  -H "Content-Type: application/json;stream=true" \
  -H "Accept: application/json;stream=true" \
  -H "X-Transaction-Count: 50" \
  -d '[...]'
```

### Headers Reference

| Header | Direction | Values | Default |
|--------|-----------|--------|---------|
| `Accept` | Response format | `application/json`, `application/json;stream=true`, `application/x-ndjson` | `application/json` |
| `Content-Type` | Request format | `application/json`, `application/json;stream=true`, `application/x-ndjson` | `application/json` |
| `X-Transaction-Count` | Chunk size | number, `all`, `-1`, `*` | `200` |
