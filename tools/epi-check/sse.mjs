// Server-sent events, read the way CommerceOS reads them (`decodeSSE`) and written the way the
// integrations that Heads hosts write them (`event()`). Both at the contract commit named in run.mjs.

/**
 * Splits a byte stream into `{ event?, data? }` records exactly as `decodeSSE` does:
 * UTF-8 with `fatal: true`, records end at a blank line (`\n\n`, never `\r\n\r\n`), a `data:`
 * line contributes `line.substring(6).trim()` and several join with a newline, an `event:`
 * line sets `line.substring(7).trim()`, and every other field (`id:`, `retry:`, comments)
 * is ignored. The CommerceOS offsets assume one space after the colon, so `data:x` loses
 * its first character here as it does in CommerceOS. Bytes after the last blank line are
 * dropped, as in the source.
 */
export async function* decodeSSE(bytes) {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let buffer = "";
    for await (const chunk of bytes) {
        buffer += decoder.decode(chunk, { stream: true });
        let position;
        while ((position = buffer.indexOf("\n\n")) !== -1) {
            const record = buffer.substring(0, position);
            buffer = buffer.substring(position + 2);
            const parsed = {};
            for (const line of record.split("\n")) {
                if (line.startsWith("data:")) {
                    parsed.data ??= "";
                    parsed.data += line.substring(6).trim() + "\n";
                } else if (line.startsWith("event:")) {
                    parsed.event = line.substring(7).trim();
                }
            }
            parsed.data = parsed.data?.trim();
            yield parsed;
        }
    }
}

/**
 * Yields `{ type: <event>, ...JSON.parse(data) }` per record, as `fetchEventStream` does.
 * A record without data yields `{ type }` only.
 */
export async function* parseEvents(bytes) {
    for await (const item of decodeSSE(bytes)) {
        const parsed = item.data ? JSON.parse(item.data) : undefined;
        yield { type: item.event, ...parsed };
    }
}

/** One SSE message: `event: <type>\n`, then `data: <JSON>\n` when data is present, then a blank line. */
export function formatEvent(type, data) {
    let result = `event: ${type}\n`;
    if (data != null) result += `data: ${JSON.stringify(data)}\n`;
    result += "\n";
    return result;
}

/** Collects every event of a byte stream into an array. */
export async function collectEvents(bytes) {
    const events = [];
    for await (const event of parseEvents(bytes)) events.push(event);
    return events;
}
