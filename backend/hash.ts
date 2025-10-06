import { createHash } from 'crypto';

// Canonical JSON hash: sort object keys recursively.
export function canonicalJson(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(v => canonicalJson(v)).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
}

export function hashPayload(payload: any): string {
  const canon = canonicalJson(payload);
  return createHash('sha3-256').update(canon).digest('hex');
}