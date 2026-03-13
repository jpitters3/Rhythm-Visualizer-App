/**
 * fix-webm-duration.js
 * Minimal inline replacement for the 'fix-webm-duration' npm package.
 *
 * MediaRecorder WebM blobs often lack a Duration element in their SegmentInfo,
 * making browsers unable to seek. This patches the EBML binary to inject the
 * correct duration so playback is fully seekable.
 *
 * Based on the EBML / WebM spec:
 *  - TimecodeScale default = 1,000,000 ns → 1 unit = 1 ms
 *  - Duration element ID  = 0x4489 (float64, big-endian)
 *  - SegmentInfo ID       = 0x1549A966
 */

/**
 * @param {Blob}   blob       - Raw WebM blob from MediaRecorder
 * @param {number} durationMs - Recording duration in milliseconds
 * @returns {Promise<Blob>}    - Blob with Duration metadata patched in
 */
export default async function fixWebmDuration(blob, durationMs) {
  if (typeof durationMs !== 'number' || durationMs <= 0 || !blob?.size) return blob;

  try {
    const buffer  = await blob.arrayBuffer();
    const bytes   = new Uint8Array(buffer);
    const view    = new DataView(buffer);

    // ── EBML helpers ──────────────────────────────────────────────────────────

    /** Read a variable-length EBML integer (VINT), return { value, len }. */
    function readVint(pos) {
      const first = bytes[pos];
      if (first === 0) return { value: -1, len: 1 };
      let mask = 0x80, len = 1;
      while ((first & mask) === 0 && len < 8) { mask >>= 1; len++; }
      let value = first & (mask - 1);
      for (let i = 1; i < len; i++) value = (value * 256) + bytes[pos + i];
      return { value, len };
    }

    /** Read a 4-byte EBML element ID (high bits encode length). */
    function readId(pos) {
      const first = bytes[pos];
      if ((first & 0x80) !== 0) return { id: bytes[pos],                                              len: 1 };
      if ((first & 0x40) !== 0) return { id: (bytes[pos] << 8)  | bytes[pos+1],                      len: 2 };
      if ((first & 0x20) !== 0) return { id: (bytes[pos] << 16) | (bytes[pos+1] << 8) | bytes[pos+2], len: 3 };
      return {
        id:  (bytes[pos] << 24) | (bytes[pos+1] << 16) | (bytes[pos+2] << 8) | bytes[pos+3],
        len: 4
      };
    }

    // ── Find SegmentInfo (EBML ID 0x1549A966) ────────────────────────────────
    const INFO_PATTERN = [0x15, 0x49, 0xA9, 0x66];
    let infoPos = -1;
    search: for (let i = 0; i < bytes.length - 4; i++) {
      for (let j = 0; j < 4; j++) {
        if (bytes[i + j] !== INFO_PATTERN[j]) continue search;
      }
      infoPos = i;
      break;
    }
    if (infoPos === -1) return blob; // No SegmentInfo found

    // Skip past ID (4 bytes) + VINT size field → start of SegmentInfo content
    const sizeVint = readVint(infoPos + 4);
    const infoContentStart = infoPos + 4 + sizeVint.len;
    const infoContentEnd   = infoContentStart + sizeVint.value;

    // ── Scan SegmentInfo content for an existing Duration element (0x4489) ───
    let pos = infoContentStart;
    let timecodeScaleMs = 1; // default TimecodeScale = 1,000,000 ns = 1 ms/unit

    while (pos < infoContentEnd && pos < bytes.length - 4) {
      const el   = readId(pos);
      const size = readVint(pos + el.len);
      const dataPos = pos + el.len + size.len;

      if (el.id === 0x2AD7B1 && size.value <= 8) {
        // TimecodeScale element — read actual scale in nanoseconds
        let scaleNs = 0;
        for (let i = 0; i < size.value; i++) scaleNs = scaleNs * 256 + bytes[dataPos + i];
        timecodeScaleMs = scaleNs / 1_000_000; // convert ns → ms
      }

      if (el.id === 0x4489) {
        // Duration element found — overwrite in-place (float64, big-endian)
        const durationInUnits = durationMs / timecodeScaleMs;
        if (size.value === 8) {
          view.setFloat64(dataPos, durationInUnits, false);
        } else if (size.value === 4) {
          view.setFloat32(dataPos, durationInUnits, false);
        }
        return new Blob([buffer], { type: blob.type });
      }

      if (size.value < 0) break; // malformed EBML, bail
      pos = dataPos + size.value;
    }

    // ── Duration element not present — insert it before the first child ──────
    // Build: Duration ID (0x4489) + size VINT (0x88 = 8 bytes) + float64
    const durationInUnits = durationMs / timecodeScaleMs;
    const patch = new Uint8Array(10);
    patch[0] = 0x44; patch[1] = 0x89; // Duration ID
    patch[2] = 0x88;                    // Size: 8 bytes (VINT encoding for 8)
    const patchView = new DataView(patch.buffer);
    patchView.setFloat64(3, durationInUnits, false);

    // Stitch: everything before infoContentStart | patch | rest
    const head = bytes.subarray(0, infoContentStart);
    const tail = bytes.subarray(infoContentStart);

    // Also update the SegmentInfo size field to include the 10 extra bytes.
    // Re-encode the new size into the same number of VINT bytes (hope it fits).
    const newSize = sizeVint.value + patch.length;
    const sizePos = infoPos + 4;
    // Most recorders use an 8-byte VINT with length marker 0x01
    if (bytes[sizePos] === 0x01 && sizeVint.len === 8) {
      const newSizeBytes = new Uint8Array(8);
      const dv = new DataView(newSizeBytes.buffer);
      // High byte keeps 0x01 marker; remaining 7 bytes carry the size
      let remaining = newSize;
      for (let i = 7; i >= 1; i--) { newSizeBytes[i] = remaining & 0xFF; remaining >>= 8; }
      newSizeBytes[0] = 0x01;
      buffer.slice(0); // just to keep buffer live
      const combined = new Uint8Array(head.length + patch.length + tail.length);
      combined.set(head, 0);
      combined.set(patch, head.length);
      combined.set(tail, head.length + patch.length);
      // Patch the Info size field
      combined.set(newSizeBytes, sizePos);
      return new Blob([combined], { type: blob.type });
    }

    // Simple fallback: just prepend the patch without updating size
    const combined = new Uint8Array(head.length + patch.length + tail.length);
    combined.set(head, 0);
    combined.set(patch, head.length);
    combined.set(tail, head.length + patch.length);
    return new Blob([combined], { type: blob.type });

  } catch (err) {
    console.warn('[fixWebmDuration] Failed to patch, returning original blob:', err);
    return blob;
  }
}
