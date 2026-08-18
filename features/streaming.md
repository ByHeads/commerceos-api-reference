# Streaming

By default, the API buffers all results before sending the response. For large datasets or batch mutations, you can opt in to **streaming** to receive data incrementally as it becomes available. This reduces memory usage, lowers time-to-first-byte, and lets clients begin processing results before the full response is ready.

For responses, the format that streams incrementally is **NDJSON** — newline-delimited JSON, one object per line, requested as `Accept: application/x-ndjson;stream=true`. Other formats accept `stream=true` but still assemble the whole body first; see [What `stream=true` does per format](#what-streamtrue-does-per-format).

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

Streaming is opt-in per request: add `;stream=true` to the `Accept` header. Without that parameter the response is buffered, whatever the format.

The combination that genuinely streams is **NDJSON with `;stream=true`**:

```bash
curl -fsSL https://example.app.heads.com/api/v1/products \
  -H "Accept: application/x-ndjson;stream=true" \
  -u ":banana"
```

Each line is built and sent as the underlying collection advances, so time-to-first-byte is roughly constant no matter how large the collection is — a hundred products and a hundred thousand products both start arriving immediately. Use it for large exports.

Requesting NDJSON without the parameter returns the same bytes, but the whole body is assembled before any of it is sent:

```bash
# Same lines, same order — just no incremental delivery
curl -fsSL https://example.app.heads.com/api/v1/products \
  -H "Accept: application/x-ndjson" \
  -u ":banana"
```

### What `stream=true` Does Per Format

Only NDJSON builds its body lazily. Every other format assembles the complete body first, and `stream=true` then hands it to the client in chunks rather than as one string — which saves a final concatenation and changes how a mid-response failure is reported, but does **not** improve time-to-first-byte.

| Accept Header | Response `Content-Type` | Body built |
|---------------|-------------------------|------------|
| `application/x-ndjson;stream=true` | `application/x-ndjson` | **Lazily** — one line at a time, as the collection advances |
| `application/x-ndjson` | `application/x-ndjson` | Whole body first |
| `application/json` | `application/json` | Whole body first |
| `application/json;stream=true` | `application/json` | Whole body first, then sent as array-element chunks |
| `text/csv` | `text/csv` | Whole body first |
| `application/sql` | `application/sql` | Whole body first |

> **`application/json;stream=true` does not produce NDJSON.** The response stays `application/json` — a normal JSON array, delivered in pieces. Only an `x-ndjson` Accept header returns line-delimited output.

### How It Works

When streaming, items are pulled through the collection in batches (default 200 items per batch), each within its own read transaction. A batch commits before its lines are yielded, then the next batch begins.

```
[Batch 1: 200 items] → commit → stream → [Batch 2: 200 items] → commit → stream → ...
```

Streaming composes with the query operators normally — `~where`, `~skip`, `~take` and projections such as `~just(...)` all behave exactly as they do on a buffered request, and a filter still narrows the collection before any line is built.

> **`~orderBy` cancels the head start.** A sort has to see every element before it can emit the first one, so
> `~orderBy(name)` on a streamed export delays the first line until the whole collection has been read. The same
> goes for the other draining operators, `~count` and `~last`. If the source is already in a usable order — the
> [time-relative endpoints](../reference/operators.md#time-relative-queries-before-and-after) return records in time order — drop
> the sort and keep the incremental delivery.

> **Note:** Because each batch uses a separate read transaction, the result set may not reflect a single point-in-time snapshot when data is changing concurrently. For snapshot-consistent reads, use the default buffered mode.

> **Streaming responses carry no pagination headers.** The body starts before `Link`, `X-Cursor-Next` and `X-Has-More`
> could be computed, so a streamed response never emits them. An `after` cursor token is still honored — the response
> is exactly `limit` items starting after that token — but there is no next cursor to continue from, so a page walk
> must use buffered requests. See [Cursor pagination](../reference/pagination.md#cursor-pagination).

### Two Response Differences When You Switch to `stream=true`

Streaming changes *when* bytes arrive, not what they say — the same lines, in the same order. But the response envelope differs in two ways, and both bite when an integrator switches an existing buffered call over.

**1. An empty result is `200`, not `204`.** A buffered response whose body would be empty is returned as `204 No Content`. A streamed response has already committed to `200` before it discovers there is nothing to send, so an empty collection arrives as `200` with a zero-length body.

```bash
# Buffered: 204 No Content, empty body
curl -isS -H "Accept: application/x-ndjson" -u ":banana" \
  "https://example.app.heads.com/api/v1/products~where(status=Nonexistent)"

# Streamed: 200 OK, empty body
curl -isS -H "Accept: application/x-ndjson;stream=true" -u ":banana" \
  "https://example.app.heads.com/api/v1/products~where(status=Nonexistent)"
```

A client that treats `204` as its "no results" signal will read the streamed `200` as a success carrying data and try to parse an empty body. Test for an empty body, not for a status code.

This applies to formats whose empty body is genuinely empty — NDJSON and CSV. JSON is unaffected: an empty collection serializes to `[]`, which is not an empty body, so it is `200` either way.

**2. The buffered body carries one extra trailing newline.** The buffered path appends a newline to the body it sends; the streamed path passes lines through untouched. Since NDJSON lines already end in a newline, a buffered NDJSON body ends with two and a streamed one with one.

Compare NDJSON **lines**, not raw bytes, if you diff the two forms — a byte-for-byte comparison of the same query fails on that single character.

---

## 2. Input Streaming (Batch Mutations)

When sending large arrays in `PUT`, `POST`, or `PATCH` requests, the API splits the input into transaction chunks (default 200 items per chunk). Each chunk is committed in its own database transaction.

By default, all chunks are processed and results are buffered before the response is sent. To stream results back as each chunk commits, add `;stream=true` to the `Content-Type` header:

```bash
curl -fsSL -X PATCH https://example.app.heads.com/api/v1/products -u ":banana" \
  -H "Content-Type: application/json;stream=true" \
  -H "Accept: application/json;stream=true" \
  -d '[{"identifiers":{"com.example.id":"1"},"name":"A"}, {"identifiers":{"com.example.id":"2"},"name":"B"}]'
```

You can also send input as NDJSON, which always streams:

```bash
curl -fsSL -X PATCH https://example.app.heads.com/api/v1/products -u ":banana" \
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
curl -X PATCH https://example.app.heads.com/api/v1/products -u ":banana" \
  -H "X-Transaction-Count: 50" \
  -d '[...]'

# Process all items in a single transaction (all succeed or all fail)
curl -X PATCH https://example.app.heads.com/api/v1/products -u ":banana" \
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

### Mid-Stream Errors on a Streamed Export

This is the practical cost of streaming a `GET`, and it applies to reads as much as to mutations. Once the first line is on the wire the status is already `200`, so a failure part-way through the collection cannot change it. It arrives as a final line instead:

```json
{
  "@type": "mid-stream error",
  "error": "An error occured while streaming the response body. The status code and headers might still indicate success.",
  "innerError": {
    "@type": "bad request",
    "error": "Invalid value for field 'name'."
  }
}
```

On a read failure the wrapper carries `innerError` but no `processedCount` / `failedAtIndex` — those describe how far a batch mutation got, and there is nothing being committed here. The lines already delivered are valid; the collection is simply incomplete.

A streaming client must check for that line. Reject the export rather than treating a truncated collection as complete — a partial export that looks successful is how stale rows end up in a warehouse:

```bash
curl -fsSL -H "Accept: application/x-ndjson;stream=true" -u ":banana" \
  "https://example.app.heads.com/api/v1/products~just(identifiers,stockLevels)" \
  | grep -q '"@type":"mid-stream error"' && echo "EXPORT INCOMPLETE — do not load"
```

The same request without `stream=true` fails cleanly: nothing has been sent yet, so the error is reported as a proper HTTP error status with no body to mistake for data. That is the reason to keep an export buffered when a reliable failure signal matters more than time-to-first-byte.

### Error Handling Checklist

| Mode | HTTP Status Accurate? | Error Location | Partial Data? |
|------|----------------------|----------------|---------------|
| Buffered | Yes | Response body | No — all or nothing per response |
| Streaming | May be 200 despite error | Last line of stream | Yes — all lines before the error are committed |

---

## 5. When to Use Streaming

### Good Use Cases

- **Large exports:** `Accept: application/x-ndjson;stream=true` on a large collection. Lines arrive as the collection advances, so the first row is available immediately instead of after the whole export has been assembled. This is the case streaming is for.
- **Bulk imports:** Importing large datasets where you want incremental progress feedback.
- **Memory-constrained clients:** Mobile or embedded clients that cannot buffer entire result sets.
- **Pipeline processing:** When each item can be processed independently as it arrives.

### When to Avoid Streaming

- **Small requests:** For collections under a few hundred items, buffered mode is simpler with proper error handling.
- **Atomic error handling:** When you need a clean HTTP status code on failure, use buffered mode. Or use `X-Transaction-Count: all` to ensure all-or-nothing semantics.
- **Formats other than NDJSON:** JSON, CSV and SQL build the whole body before sending either way, so `stream=true` buys no earlier first byte — it only costs you the clean error status and the `204` on an empty result.
- **Clients keyed on `204`:** an empty streamed collection is `200` with an empty body (see [Two response differences](#two-response-differences-when-you-switch-to-streamtrue)).
- **Snapshot consistency:** Streaming reads use batched transactions; for a consistent point-in-time view, use the default buffered mode.
- **Client libraries that don't support NDJSON:** Standard JSON parsers expect a complete JSON array. Streaming requires a line-by-line parser.
- **Cursor-paginated walks:** streamed responses never emit `Link` / `X-Cursor-Next` / `X-Has-More`, so there is no token to follow. Use buffered requests for the walk (see [Cursor pagination](../reference/pagination.md#cursor-pagination)).

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
# Recommended for large exports — lines arrive as the collection advances
curl -fsSL "https://example.app.heads.com/api/v1/products~just(identifiers,stockLevels)" \
  -H "Accept: application/x-ndjson;stream=true" \
  -u ":banana"

# NDJSON without streaming — same lines, whole body assembled first
curl -fsSL https://example.app.heads.com/api/v1/products \
  -H "Accept: application/x-ndjson" \
  -u ":banana"
```

### Bulk Import with Streaming

```bash
# NDJSON input + output
curl -fsSL -X PUT https://example.app.heads.com/api/v1/products -u ":banana" \
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
curl -fsSL -X PUT https://example.app.heads.com/api/v1/products -u ":banana" \
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
curl -fsSL -X PATCH https://example.app.heads.com/api/v1/products -u ":banana" \
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

Not emitted on streamed responses: `Link`, `X-Cursor-Next`, `X-Has-More`. These are
[cursor-pagination](../reference/pagination.md#cursor-pagination) headers and require a buffered response.

Also different on a streamed response: an empty result is `200` with an empty body rather than `204 No Content`, and
there is no extra trailing newline. See [Two response differences](#two-response-differences-when-you-switch-to-streamtrue).
