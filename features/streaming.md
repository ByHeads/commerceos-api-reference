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

Without the parameter the response is buffered, whatever the format: the body is assembled in full before any of it is written. (`application/x-ndjson` is the one format whose lines are built on demand either way, but the buffered path drains them into a single body before sending, so there is nothing observable to it — the parameter is what changes delivery.)

`text/plain` and `text/html` have no collection path at all — they serialize a single string value — so `;stream=true` on those does nothing.

> **`application/json;stream=true` does not produce NDJSON.** The response stays `application/json` — a normal JSON array, delivered in pieces. Only an `x-ndjson` Accept header returns line-delimited output.

> **Fixed: `application/sql;stream=true` used to return an empty body.** The combination previously answered `200` with nothing in it. It now streams the statements. No client can have been depending on an empty body, so there is nothing to migrate — if you avoided the combination for that reason, it works now.

### Getting the Parameter Wrong Fails Two Different Ways

A misspelled parameter **name** is ignored; a bad **value** on a name the format does recognize empties the response.

```bash
# Ignored — no such parameter, so the response is buffered. No error.
Accept: application/x-ndjson;strem=true

# Empty body under a success status — `stream` is recognized, `truex` is not a boolean
Accept: application/x-ndjson;stream=truex
```

Neither one tells you it happened, and they look the same from the outside until you look at the body. If a request that should be streaming is arriving all at once, check the spelling of the name; if it is arriving as `204 No Content` from a collection you know is not empty, check the value. Full rules, including which parameters each format recognizes: [Accept parameter tolerance](../reference/overview.md#accept-parameter-tolerance).

### The First Chunk Follows a Batch, Not an Item

Results are pulled through the collection **200 chunks at a time**, so the first byte waits for a whole batch rather than a single item. Two consequences worth planning around:

- **Below about 200 items, streamed and buffered are indistinguishable.** Someone testing the feature against twenty records will conclude it does nothing. Test on a collection large enough to matter.
- **For `application/sql`, a chunk is a whole `batchSize` group** (default 1000 statements), not one row — so the first byte needs roughly 200 × `batchSize` rows behind it. Lower `batchSize` if you want bytes sooner, or when 200 × `batchSize` rows in one read transaction is more than the export should be holding open: `Accept: application/sql;stream=true;batchSize=100`.

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

### A Streamed Response Is Not a Point-in-Time Snapshot

This is the one correctness property streaming gives up, and it is worth deciding about deliberately rather than discovering later.

- **Buffered:** the whole collection is read inside a single read transaction, so the response is a consistent snapshot — every record is as it stood at one moment.
- **Streamed:** each batch of 200 is read in its own read transaction. A write that lands between two batches is invisible to the parts of the body already sent and visible to the parts still to come, so one response can mix two states of the data.

In practice that means a record updated mid-export can appear with its new values while an earlier, related record in the same body still shows the old ones. Nothing is corrupted and nothing is lost — the body is just not a single instant.

**Run an export buffered when it has to be internally consistent** — a reconciliation extract, a financial period close, anything where two records in the same file are compared against each other. Stream it when time-to-first-byte matters more than that, which is the usual case for a bulk catalogue or inventory pull.

> **Streaming responses carry no pagination headers.** The body starts before `Link`, `X-Cursor-Next` and `X-Has-More`
> could be computed, so a streamed response never emits them — and neither do the line-oriented formats even when
> buffered, since those bodies are not in a shape the header post-processing can annotate. An `after` cursor token is
> still honored — the response is exactly `limit` items starting after that token — but there is no next cursor to
> continue from, so a page walk must use buffered JSON.
> See [Cursor pagination](../reference/pagination.md#cursor-pagination).

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

**2. A buffered JSON body ends with a newline; a streamed one does not.** The buffered path terminates the body it sends with a newline unless it already ends in one. A JSON array ends `]`, so the buffered form gains a character the streamed form does not have:

```text
application/json              → [{...},{...}]\n
application/json;stream=true  → [{...},{...}]
```

The line-oriented formats already end each row with a newline, so for `application/x-ndjson`, `text/csv` and `application/sql` the two forms are **byte-identical** — an exact-comparison client can diff raw bytes across the switch. Only JSON needs the trailing newline trimmed (or the comparison done on parsed values rather than text). If you are carrying a line-normalizing comparison for one of the other three formats, it still works and is simply no longer necessary.

---

## 2. Input Streaming (Batch Mutations)

When sending large arrays in `PUT`, `POST`, or `PATCH` requests, the API splits the input into transaction chunks (default 200 items per chunk). Each chunk is committed in its own database transaction — see [Transaction chunking](#3-transaction-chunking) for what that means when one of them fails, and for the `X-Transaction-Count` header that resizes them.

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

A `POST`, `PATCH` or `PUT` whose body is an **array** is split into transaction chunks, and each chunk is committed on its own. The default chunk size is **200 items**.

Despite living on this page, chunking is not a streaming feature. It applies to every array write — buffered or streamed, JSON or NDJSON or CSV. A body that is a single object is a single transaction and none of this applies to it.

### An Error Status Does Not Mean Nothing Was Written

This is the part to design around, and the explanation for an outcome that is otherwise baffling. Because each chunk commits independently, a failure part-way through an array leaves everything before it in the database:

```
Input: [item1, item2, ..., item500]
X-Transaction-Count: 200 (default)

Transaction 1: items 1–200   → commit ✓
Transaction 2: items 201–400 → commit ✓
Transaction 3: items 401–500 → rollback ✗
```

The request answers with an ordinary HTTP error status — a mutation finishes all of its writing before the response body starts, so the failure is reported the usual way, with a real status code and an error body ([Error handling](#4-error-handling)). But items 1–400 are committed and stay committed. Only the failing chunk is rolled back.

So a `4xx` on an array write is not evidence that the write did not happen, and the error body will not tell you how far it got: there is no index and no per-item counter in it. What you know is a chunk boundary, not an item. Two ways to handle that:

- **Make the write idempotent and replay the whole array.** `PUT` upserts by identifier, so re-sending the full array after fixing the bad item re-applies the already-committed items harmlessly and lands the rest. This is the simpler option and the one to reach for by default.
- **Put the whole array in one transaction**, below, when a partial write would be worse than no write.

### Controlling Chunk Size

Use the `X-Transaction-Count` request header to set how many items go in one transaction:

```bash
# Commit every 50 items
curl -X PATCH https://example.app.heads.com/api/v1/products -u ":banana" \
  -H "X-Transaction-Count: 50" \
  -d '[...]'

# Commit the whole array at once — either every item lands or none does
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

**`all` is the setting for when a partial write is worse than no write** — a price list that must not go live half-updated, a set of records that only makes sense together. It is not free: one transaction stays open for the whole request, so the cost grows with the size of the array. Reach for it on the arrays where atomicity is the requirement, not as a default for every import.

Lowering the number goes the other way: more transactions, each one cheaper, and a smaller window of work to lose when one fails. That is worth doing when individual items are expensive to apply, not as a general tuning knob — the default suits most imports.

### Sending the Header From a Browser

`X-Transaction-Count` is one of the four request headers the API allows cross-origin (with `Content-Type`, `Accept` and `Authorization`), so a browser client can set it without tripping the CORS preflight.

### Streamed Reads Batch Too — This Header Does Not Change Them

A streamed `GET` also works 200 items at a time, each batch in its own read transaction, which is why a streamed response is not a point-in-time snapshot ([A streamed response is not a point-in-time snapshot](#a-streamed-response-is-not-a-point-in-time-snapshot)).

That is a **separate mechanism that happens to share the same default.** Streamed reads use their own fixed 200-item batches; `X-Transaction-Count` does not change them. The header is read once, on the write path, and only ever splits an array request body — it has no effect on a `GET`, and there is no header, query parameter or `Accept` parameter that resizes a read batch.

---

## 4. Error Handling

How errors are reported depends on whether streaming is enabled.

Independently of that, **the framing of an error body follows the `Accept` header**. Ask for `application/x-ndjson` and an ordinary HTTP error response arrives as a single newline-terminated line, with `content-type: application/x-ndjson`; every other content type gets the same document indented, as `application/json`. So on an NDJSON export both failure shapes below — the ordinary error response and the appended `mid-stream error` line — are one line each, and one line-oriented reader handles both. The status code is what tells them apart. Full rules: [Error response framing](../reference/overview.md#error-response-framing).

### Without Streaming (Default)

The API buffers all results, so if an error occurs at any point, a proper HTTP error response is returned with the correct status code:

```json
{
  "@type": "bad request",
  "error": "The request was invalid and could not be processed.",
  "details": "Invalid value for field 'name'."
}
```

`error` is the general category of the failure and `details` the occurrence-specific message. The HTTP status code (e.g., 400) is set correctly because headers hadn't been sent yet.

A buffered error body carries **no per-item counters** — neither `processedCount` nor `failedAtIndex`. If what you need is how far a batch write got before it failed, the answer is the chunk boundary rather than an index: the failing chunk rolls back and every chunk before it stays committed ([Transaction chunking](#3-transaction-chunking)).

### With Streaming

**Streaming does not change how a request fails.** Everything decided before the first byte of the body — authentication, scopes, an unknown resource or key, a malformed query or cursor token, an unsupported content type, and **every mutation** — still produces an ordinary HTTP error response with the correct status code and the usual error body, exactly as it would without `stream=true`. A `GET` for a product that does not exist is a `404` whether or not you asked for streaming, and a batch mutation that fails on its 200th item still answers with a normal `4xx`: a mutation does all of its writing before the response body starts, so the status line is still free to carry the failure.

The one exception is a failure that strikes *while the collection is being read out*, after the `200` status line and headers have already gone on the wire. There is no status code left to change at that point, so the failure is appended to the body instead. That is an internal fault — a record that cannot be built, a read that fails part-way through a collection — rather than something a client can provoke with a bad request, and it is correspondingly rare. Handle it because it is the one failure a `200` will not tell you about, not because you should expect to see it. The response is **truncated, not corrupted**: everything delivered before the marker is valid.

**The marker covers the read machinery too, not just the data.** A streamed collection is read one 200-item batch at a time, each in its own read transaction ([How it works](#how-it-works)), and a failure of one of *those* transactions between batches produces exactly the same marker — array closed for `application/json`, one more line for everything else. There is nothing extra for a client to do: "check the last line" already covers it. It is worth knowing only because it means the marker is the complete account of how a streamed `GET` can go wrong after the `200`.

*Where* the marker lands depends on the content type. **Line-delimited formats** (`application/x-ndjson`, `text/csv`, `application/sql`) get one more line appended:

```json
{
  "@type": "mid-stream error",
  "error": "An error occured while streaming the response body. The status code and headers might still indicate success.",
  "innerError": {
    "@type": "internal error",
    "error": "Internal server error.",
    "details": "A description of what went wrong while reading the collection."
  }
}
```

Note what is **not** there: `processedCount` is carried only by the `application/json` form below, and `failedAtIndex` is carried by nothing at all — see [Which fields each form carries](#which-fields-each-form-carries).

**`application/json`** cannot do that — a second JSON value after the closing `]` would make the body unparseable. So the array **closes itself** and the error becomes its **last element**:

```json
[
  { "@type": "product", "...": "..." },
  { "@type": "product", "...": "..." },
  {
    "@type": "mid-stream error",
    "error": "An error occured while streaming the response body. The status code and headers might still indicate success.",
    "innerError": {
      "@type": "internal error",
      "error": "Internal server error.",
      "details": "A description of what went wrong while reading the collection."
    },
    "processedCount": 2
  }
]
```

The body stays valid JSON, so you can parse it in one go and then inspect the last element. Apart from the JSON-only `processedCount`, the two markers are the same object — the NDJSON response for the same failure is byte-identical with that one field removed.

All data preceding the error object is valid and committed.

#### `innerError` Is an Ordinary Error Body

`innerError` is **exactly the error body the same failure would have produced as an ordinary HTTP error response**, `@type` discriminator included, on every content type. There is nothing special to parse: whatever your client already does with an error body applies unchanged, you just reach one level deeper to find it.

| Member | Meaning |
|--------|---------|
| `@type` | The error's discriminator — `"internal error"`, `"bad request"`, `"conflict"`, … Exactly what the same failure would carry as a top-level error body. |
| `error` | The general category of the failure — `"Internal server error."` |
| `details` | The occurrence-specific message — `"A description of what went wrong while reading the collection."` |
| `suggestion` | Present on errors that carry one; absent otherwise. |

The specific type may add its own members on top of those (a `"conflict"` carries `conflictingResource`, for example) — again, the same ones it would carry as a top-level error body.

> **Changed 2026-08-19 — this reverses earlier guidance.** Until this shipped, `innerError` arrived *without* its `@type`: the discriminator was joined to the body only on the HTTP error path, and a mid-stream failure by definition never reaches that path. Earlier versions of this page documented that absence as a rule to parse around. If you wrote a client that matches on `error`/`details` because the type key was missing — or worse, branches on its absence — the key is there now, on every format.

`innerError` is sanitized rather than raw. An unexpected server-side failure surfaces as `{"@type": "internal error", "error": "Internal server error.", "details": "<message>"}` — never a stack trace or an internal frame.

**It is never absent, and it always has a `@type`.** If a cause cannot be sanitized into a body at all, a generic `{"@type": "internal error", "error": "Internal server error."}` goes out in its place rather than the key being dropped — so a discriminated-union parser over `innerError`'s `@type` is safe to write, on every content type, without a fallback branch for a missing key. Only `details` is optional.

The generated OpenAPI spec reflects this: `innerError` is declared as the error model rather than as an untyped value, so `<base-uri>/openapi/spec.json` describes its members and a generated client types it like any other error.

#### Which Fields Each Form Carries

The three error bodies do not carry the same fields, and **`"@type": "mid-stream error"` is the one to branch on** — it is the only field that both identifies a truncated stream and is present on every streamed form:

| Field | Buffered error body | Streamed, line-delimited | Streamed, `application/json` |
|-------|---------------------|--------------------------|------------------------------|
| `@type` | Yes | Yes | Yes |
| `error` | Yes | Yes | Yes |
| `details` | Yes | — (it is inside `innerError`) | — (it is inside `innerError`) |
| `innerError` | — (it *is* the error) | Yes | Yes |
| `processedCount` | — | — | Yes |
| `failedAtIndex` | — | — | — |

The absences are the ones that catch people out. A completeness check written as `if (last.processedCount !== undefined)` never fires on an NDJSON, CSV or SQL export, and one written on `failedAtIndex` never fires at all — either check waves a truncated export through as complete. Key detection on `@type` and read `innerError` for the cause.

**`failedAtIndex` is reserved.** It is declared on the `mid-stream error` model in the OpenAPI spec, so a generated client will have a field for it and a schema browser will list it — but no response currently carries it, on any content type or in any form. Treat its absence as the norm rather than as a signal, and do not write a branch that depends on it appearing.

The rows above describe the **outer** marker. `innerError` itself always carries its own `@type`, on both streamed forms — see [`innerError` Is an Ordinary Error Body](#innererror-is-an-ordinary-error-body).

> **Important:** When consuming a streamed response, always check the **last line** (line-delimited formats) or the **last array element** (JSON) for `"@type": "mid-stream error"`, and treat it as a failure regardless of the `200`. Requests without `stream=true` never need this — they get a real error status instead.

### Mid-Stream Errors on a Streamed Export

This is the practical cost of streaming a `GET`. Once the first line is on the wire the status is already `200`, so a fault that strikes while the rest of the collection is being read out cannot change it. It arrives as a final line instead:

```json
{
  "@type": "mid-stream error",
  "error": "An error occured while streaming the response body. The status code and headers might still indicate success.",
  "innerError": {
    "@type": "internal error",
    "error": "Internal server error.",
    "details": "A description of what went wrong while reading the collection."
  }
}
```

The appended wrapper carries `innerError` but neither `processedCount` (which only the streamed `application/json` form carries) nor `failedAtIndex` (which nothing carries) — see the [field matrix](#which-fields-each-form-carries). The lines already delivered are valid; the collection is simply incomplete. Note that this is the *only* failure mode streaming introduces: a mutation, or anything rejected before the read starts, still fails with a real HTTP status. It covers a failure of the read transaction between batches as well as a failure to build a record, so the one check below is the whole of what a streaming client owes this.

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

In every row the error is a JSON document, and on an NDJSON request it is a single line — so the check is the same shape whichever row you are in: read the last line (or last array element), then decide from the status code whether you are looking at a failed request or a truncated successful one.

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
- **Snapshot consistency:** streaming reads use batched transactions, so one response can mix two states of the data. For a consistent point-in-time view — a reconciliation extract, a period close — use the default buffered mode (see [A streamed response is not a point-in-time snapshot](#a-streamed-response-is-not-a-point-in-time-snapshot)).
- **Client libraries that don't support NDJSON:** a standard JSON parser expects a complete array, so NDJSON needs a line-by-line reader. This is a reason to prefer `application/json;stream=true` over NDJSON — not a reason to avoid streaming: the JSON form still parses in one go, it just cannot be parsed incrementally.
- **Cursor-paginated walks:** streamed responses never emit `Link` / `X-Cursor-Next` / `X-Has-More`, so there is no token to follow — and neither do NDJSON, CSV or SQL responses even when buffered. Walk the pages with buffered JSON (see [Cursor pagination](../reference/pagination.md#cursor-pagination)).

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
[cursor-pagination](../reference/pagination.md#cursor-pagination) headers and require a buffered `application/json`
response — the line-oriented formats do not carry them even when buffered.

Also different on a streamed response: an empty result is `200` with an empty body rather than `204 No Content`, and a
streamed `application/json` body does not end with the newline the buffered one carries (the line-oriented formats are
byte-identical either way). See [Two response differences](#two-response-differences-when-you-switch-to-streamtrue).
