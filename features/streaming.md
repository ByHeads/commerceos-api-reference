# Streaming

By default, the API buffers all results before sending the response. For large datasets or batch mutations, you can opt in to **streaming** to receive data incrementally as it becomes available. This lowers time-to-first-byte and lets clients begin processing results before the full response is ready.

`;stream=true` on the `Accept` header makes the *computation* incremental for every collection format — `application/json`, `application/x-ndjson`, `text/csv`, `application/sql` and `application/vnd.ms-sqlserver.csv`. Each item is serialized as it is sent, rather than the whole collection being built first.

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

```bash
curl -fsSL https://example.app.heads.com/api/v1/products \
  -H "Accept: application/x-ndjson;stream=true" \
  -u ":banana"
```

Each line is built and sent as the underlying collection advances, so time-to-first-byte stops growing with the size of the collection — a hundred products and a hundred thousand products both start arriving at about the same moment. (Almost: the first chunk follows a batch of 200 rather than a single item — see [The first chunk follows a batch](#the-first-chunk-follows-a-batch-not-an-item).) Requesting the same format without the parameter returns the same bytes, but the whole body is assembled before any of it is sent:

```bash
# Same lines, same order — just no incremental delivery
curl -fsSL https://example.app.heads.com/api/v1/products \
  -H "Accept: application/x-ndjson" \
  -u ":banana"
```

### Why Time-to-First-Byte Is the Point

The reason to reach for `stream=true` is **keeping the connection alive**, not parsing. A query that takes ninety seconds to assemble, sitting behind a proxy or an HTTP client with a sixty-second first-byte timeout, is killed having sent nothing at all. Streaming ships the first chunk long before the collection is finished, so the timeout never fires and the export completes.

Two things it is **not**:

- **Not a way to parse a JSON array incrementally.** `application/json;stream=true` delivers one well-formed JSON array in pieces, and a JSON array is only parseable once you hold all of it. If you want to process rows as they arrive, use NDJSON — one self-contained object per line, parseable a line at a time. That remains the best choice for very large exports.
- **Not a way to bound server memory.** Streaming spreads memory growth over the response window, but peak memory is still proportional to the size of the collection. Do not size an export on the assumption that streaming makes it constant-memory.

### What `stream=true` Does Per Format

| Accept Header | Response `Content-Type` | Body built |
|---------------|-------------------------|------------|
| `application/x-ndjson;stream=true` | `application/x-ndjson` | **Incrementally** — one line at a time, as the collection advances |
| `application/json;stream=true` | `application/json` | **Incrementally** — one array element at a time |
| `text/csv;stream=true` | `text/csv` | **Incrementally** — header row, then one row at a time |
| `application/sql;stream=true` | `application/sql` | **Incrementally** — one `batchSize` group of statements at a time |
| `application/vnd.ms-sqlserver.csv;stream=true` | `application/vnd.ms-sqlserver.csv` | **Incrementally** — header row, then one row at a time |
| *any of the above without `;stream=true`* | unchanged | Whole body first |

Without the parameter nothing has changed: the default path is byte-identical to what it always was, and still buffers.

`text/plain` and `text/html` have no collection path at all — they serialize a single string value — so `;stream=true` on those does nothing.

> **`application/json;stream=true` does not produce NDJSON.** The response stays `application/json` — a normal JSON array, delivered in pieces. Only an `x-ndjson` Accept header returns line-delimited output.

> **Fixed: `application/sql;stream=true` used to return an empty body.** The combination previously answered `200` with nothing in it. It now streams the statements. No client can have been depending on an empty body, so there is nothing to migrate — if you avoided the combination for that reason, it works now.

### The First Chunk Follows a Batch, Not an Item

Results are pulled through the collection **200 chunks at a time**, so the first byte waits for a whole batch rather than a single item. Two consequences worth planning around:

- **Below about 200 items, streamed and buffered are indistinguishable.** Someone testing the feature against twenty records will conclude it does nothing. Test on a collection large enough to matter.
- **For `application/sql`, a chunk is a whole `batchSize` group** (default 1000 statements), not one row — so the first byte needs roughly 200 × `batchSize` rows behind it. Lower `batchSize` if you want bytes sooner: `Accept: application/sql;stream=true;batchSize=100`.

### How It Works

Each batch of 200 is read within its own read transaction. The batch commits before its chunks are yielded, then the next batch begins.

```
[Batch 1: 200 chunks] → commit → stream → [Batch 2: 200 chunks] → commit → stream → ...
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

This applies to formats whose empty body is genuinely empty — NDJSON, CSV and SQL. JSON is the exception: an empty collection serializes to `[]`, which is not an empty body, so JSON answers `200` either way and never `204`.

**2. The buffered body carries one extra trailing newline.** The buffered path appends a newline to the body it sends; the streamed path passes chunks through untouched. Since NDJSON, CSV and SQL rows already end in a newline, a buffered body of those formats ends with two and a streamed one with one.

Compare **lines**, not raw bytes, if you diff the two forms — a byte-for-byte comparison of the same query fails on that single character.

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

HTTP headers (including the status code) are sent before the first item, so **the response says `200` even when it failed**. The error is delivered inside the body instead — and *where* it lands depends on the content type.

**Line-delimited formats** (`application/x-ndjson`, `text/csv`, `application/sql`) get one more line appended:

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

**`application/json`** cannot do that — a second JSON value after the closing `]` would make the body unparseable. So the array **closes itself** and the error becomes its **last element**:

```json
[
  { "@type": "product", "...": "..." },
  { "@type": "product", "...": "..." },
  {
    "@type": "mid-stream error",
    "error": "An error occured while streaming the response body. The status code and headers might still indicate success.",
    "processedCount": 2
  }
]
```

The body stays valid JSON, so you can parse it in one go and then inspect the last element. Note that the JSON form carries `processedCount` but **no `innerError`** — that is deliberate, not an oversight: the detail is in the server log, not in the body. If you need the underlying cause in the response, use a line-delimited format.

All data preceding the error object is valid and committed. `processedCount` and `failedAtIndex` tell a batch mutation exactly how far it got before the failure.

> **Important:** When consuming a streamed response, always check the **last line** (line-delimited formats) or the **last array element** (JSON) for `"@type": "mid-stream error"`, and treat it as a failure regardless of the `200`. Requests without `stream=true` never need this — they get a real error status instead.

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

On a read failure the appended wrapper carries `innerError` but no `failedAtIndex` — that describes how far a batch mutation got, and there is nothing being committed here. The lines already delivered are valid; the collection is simply incomplete.

A streaming client must check for that line. Reject the export rather than treating a truncated collection as complete — a partial export that looks successful is how stale rows end up in a warehouse:

```bash
curl -fsSL -H "Accept: application/x-ndjson;stream=true" -u ":banana" \
  "https://example.app.heads.com/api/v1/products~just(identifiers,stockLevels)" \
  | grep -q '"@type":"mid-stream error"' && echo "EXPORT INCOMPLETE — do not load"
```

The equivalent check on a streamed **JSON** export inspects the last array element rather than the last line — the body is a single well-formed array, so it parses normally and the marker is simply the final entry:

```bash
curl -fsSL -H "Accept: application/json;stream=true" -u ":banana" \
  "https://example.app.heads.com/api/v1/products~just(identifiers,stockLevels)" \
  | jq -e '.[-1]["@type"] == "mid-stream error"' >/dev/null \
  && echo "EXPORT INCOMPLETE — do not load"
```

The same request without `stream=true` fails cleanly: nothing has been sent yet, so the error is reported as a proper HTTP error status with no body to mistake for data. That is the reason to keep an export buffered when a reliable failure signal matters more than time-to-first-byte.

### Error Handling Checklist

| Mode | HTTP Status Accurate? | Error Location | Partial Data? |
|------|----------------------|----------------|---------------|
| Buffered | Yes | Response body | No — all or nothing per response |
| Streaming, line-delimited | May be 200 despite error | Last line of the stream | Yes — everything before the error is valid |
| Streaming, `application/json` | May be 200 despite error | Last element of the array | Yes — everything before the error is valid |

---

## 5. When to Use Streaming

### Good Use Cases

- **Long-running exports behind a timeout:** the first chunk ships early, so a proxy or client with a first-byte timeout does not kill the request while the collection is still being assembled. This is the case streaming is for.
- **Large exports you want to process row by row:** `Accept: application/x-ndjson;stream=true`. Lines arrive as the collection advances and each one parses on its own.
- **Bulk imports:** Importing large datasets where you want incremental progress feedback.
- **Memory-constrained clients:** Mobile or embedded clients that cannot buffer entire result sets. (This is about *client* memory — streaming does not reduce server memory.)
- **Pipeline processing:** When each item can be processed independently as it arrives.

### When to Avoid Streaming

- **Small requests:** For collections under a few hundred items, buffered mode is simpler with proper error handling — and below the 200-item batch there is no measurable difference anyway.
- **Atomic error handling:** When you need a clean HTTP status code on failure, use buffered mode. Or use `X-Transaction-Count: all` to ensure all-or-nothing semantics.
- **Clients keyed on `204`:** an empty streamed collection is `200` with an empty body (see [Two response differences](#two-response-differences-when-you-switch-to-streamtrue)).
- **Snapshot consistency:** Streaming reads use batched transactions; for a consistent point-in-time view, use the default buffered mode.
- **Client libraries that don't support NDJSON:** a standard JSON parser expects a complete array, so NDJSON needs a line-by-line reader. This is a reason to prefer `application/json;stream=true` over NDJSON — not a reason to avoid streaming: the JSON form still parses in one go, it just cannot be parsed incrementally.
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

# JSON, streamed — one well-formed array, delivered in pieces.
# Same win on time-to-first-byte; parse it in one go when it lands.
curl -fsSL "https://example.app.heads.com/api/v1/products~just(identifiers,stockLevels)" \
  -H "Accept: application/json;stream=true" \
  -u ":banana"

# CSV, streamed — header row first, then rows as the collection advances
curl -fsSL "https://example.app.heads.com/api/v1/products~just(identifiers,name)" \
  -H "Accept: text/csv;stream=true" \
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
| `Accept` | Response format | `application/json`, `application/x-ndjson`, `text/csv`, `application/sql`, `application/vnd.ms-sqlserver.csv` — each with an optional `;stream=true` | `application/json` |
| `Content-Type` | Request format | `application/json`, `application/json;stream=true`, `application/x-ndjson` | `application/json` |
| `X-Transaction-Count` | Chunk size | number, `all`, `-1`, `*` | `200` |

Not emitted on streamed responses: `Link`, `X-Cursor-Next`, `X-Has-More`. These are
[cursor-pagination](../reference/pagination.md#cursor-pagination) headers and require a buffered response.

Also different on a streamed response: an empty result is `200` with an empty body rather than `204 No Content`, and
there is no extra trailing newline. See [Two response differences](#two-response-differences-when-you-switch-to-streamtrue).
