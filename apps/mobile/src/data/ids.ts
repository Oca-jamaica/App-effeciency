/**
 * Deterministic UUID-shaped ids from a string. Used where two devices independently create "the same"
 * row (e.g. the scheduler's block for a task at a given time), so the rows merge on sync instead of
 * duplicating. Two independent 64-bit FNV-1a hashes → 128 bits, formatted as an RFC 9562 v8 UUID.
 */
function fnv1a64(input: string, seed: bigint): bigint {
  let hash = 0xcbf29ce484222325n ^ seed;
  const prime = 0x100000001b3n;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash;
}

export function stableId(input: string): string {
  const hi = fnv1a64(input, 0n).toString(16).padStart(16, '0');
  const lo = fnv1a64(input, 0x9e3779b97f4a7c15n).toString(16).padStart(16, '0');
  const hex = (hi + lo).split('');
  hex[12] = '8'; // version 8 (custom)
  hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16); // RFC 9562 variant
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
