// What: K-06 VK Storage format: the save JSON deflated, base64, cut into parts of at most chunkChars under `<key>_<i>`, a head `<key>` with the count and a checksum.
// Called by: platform/vk.ts; tests/platform/vk.test.ts.
// Keep: pure, no DOM and no bridge; a value never exceeds 4 096 characters (VK Storage limit); keys only [A-Za-z0-9_] (VK key rule); unpack never throws (null).

import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';

/** VK Storage: a value is at most 4 096 characters. */
export const VALUE_MAX = 4096;
const HEAD_VERSION = 'v1';

/** The cloud key of a pace slot: classic — `s`, another pace — `s_<slot>` (dots are not allowed in a VK key). */
export function cloudKey(slot?: string | undefined): string {
  return slot ? `s_${slot.replace(/[^A-Za-z0-9_]/g, '_')}` : 's';
}

export const partKey = (key: string, i: number): string => `${key}_${i}`;

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** A short checksum of the packed text (FNV-1a), so a half-written set of parts is never read as a save. */
function sum(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function packSave(json: string, chunkChars: number): { head: string; parts: string[] } {
  const size = Math.max(1, Math.min(chunkChars, VALUE_MAX));
  const packed = toBase64(deflateSync(strToU8(json), { level: 9 }));
  const parts: string[] = [];
  for (let i = 0; i < packed.length; i += size) parts.push(packed.slice(i, i + size));
  if (parts.length === 0) parts.push('');
  return { head: `${HEAD_VERSION}:${parts.length}:${sum(packed)}`, parts };
}

/** The number of parts the head names (0 — no head or not ours). */
export function headParts(head: string): number {
  const m = /^v1:(\d+):[0-9a-z]+$/.exec(head);
  return m ? Number(m[1]) : 0;
}

export function unpackSave(head: string, parts: Array<string | null>): string | null {
  const n = headParts(head);
  if (!n || parts.length !== n || parts.some((p) => p === null)) return null;
  const packed = parts.join('');
  if (`${HEAD_VERSION}:${n}:${sum(packed)}` !== head) return null;
  try {
    return strFromU8(inflateSync(fromBase64(packed)));
  } catch {
    return null;
  }
}
