/** High watermark: once the retained window exceeds this, oldest chunks are evicted. */
export const MAX_BUF = 1.5 * 1024 * 1024;
/** Post-eviction floor: oldest whole chunks are dropped until the window is back to ~this. */
export const TRIM_BUF = 1.0 * 1024 * 1024;

/**
 * Rolling byte window of a pty's output stream, shared by the host (history for replay) and
 * the web client (scrollback for re-render). `endOffset` is the total bytes produced so far
 * (offset of the first byte is the universal stream origin, 0); `retainedStart` (private) is
 * where the retained window currently begins. All size management happens in `write`.
 */
export class TtyBuffer {
  /** Cumulative offset just past the last byte ever written; the resume position. */
  endOffset = 0;
  /** Number of retained bytes. */
  size = 0;

  private chunks: Uint8Array[] = [];
  /** Cumulative offset of the first retained byte (chunks[0][0]); advances on eviction/clear. */
  private retainedStart = 0;

  /** Resets the buffer; the next chunk is expected to start at `offset`. */
  clear(offset = 0) {
    this.chunks = [];
    this.size = 0;
    this.retainedStart = offset;
    this.endOffset = offset;
  }

  /** Appends a whole chunk starting at stream position `start`, evicting oldest over the cap.
   * The caller guarantees contiguity (a non-empty buffer expects `start === endOffset`). */
  write(chunk: Uint8Array, start: number) {
    if (this.chunks.length === 0) this.retainedStart = start;
    this.chunks.push(chunk);
    this.size += chunk.length;
    this.endOffset = start + chunk.length;
    if (this.size > MAX_BUF) {
      // Evict whole oldest chunks down to the floor; never drop a lone oversized chunk.
      while (this.chunks.length > 1 && this.size - this.chunks[0].length >= TRIM_BUF) {
        this.retainedStart += this.chunks[0].length;
        this.size -= this.chunks[0].length;
        this.chunks.shift();
      }
    }
  }

  /** Returns the retained bytes in [from, to), clipped to the window, as boundary-sliced
   * views (no copies). `startOffset`/`endOffset` report the actual clipped range. */
  slice(
    from?: number,
    to?: number,
  ): { pieces: Uint8Array[]; startOffset: number; endOffset: number } {
    const start = Math.max(from ?? this.retainedStart, this.retainedStart);
    const end = Math.min(to ?? this.endOffset, this.endOffset);
    if (start >= end) return { pieces: [], startOffset: start, endOffset: end };
    const pieces: Uint8Array[] = [];
    let cursor = this.retainedStart;
    for (const chunk of this.chunks) {
      const chunkEnd = cursor + chunk.length;
      if (chunkEnd > start && cursor < end) {
        pieces.push(
          chunk.subarray(Math.max(0, start - cursor), Math.min(chunk.length, end - cursor)),
        );
      }
      cursor = chunkEnd;
    }
    return { pieces, startOffset: start, endOffset: end };
  }

  /**
   * Where a stream should start given the position a client already has. `since` absent means a
   * fresh terminal (whole window); inside the window resumes there; anything outside (evicted, or
   * the client ahead of the stream) restarts at the window start so the client discards its buffer.
   */
  resolveReplayStart(since?: number) {
    const earliest = this.retainedStart;
    if (since === undefined || since < earliest || since > this.endOffset) return earliest;
    return since;
  }
}
