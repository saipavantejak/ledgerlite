import { UnprocessableEntityException } from '@nestjs/common';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_BIGINT = 9223372036854775807n;

export function invalid(message: string): never {
  throw new UnprocessableEntityException(message);
}

export function asObject(v: unknown, what = 'body'): Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) invalid(`${what} must be a JSON object`);
  return v as Record<string, unknown>;
}

export function str(v: unknown, field: string, max = 500): string {
  if (typeof v !== 'string' || v.trim() === '') invalid(`${field} must be a non-empty string`);
  if (v.length > max) invalid(`${field} must be at most ${max} characters`);
  return v;
}

export function optStr(v: unknown, field: string, max = 500): string | null {
  return v === undefined || v === null ? null : str(v, field, max);
}

export function uuid(v: unknown, field: string): string {
  if (typeof v !== 'string' || !UUID_RE.test(v)) invalid(`${field} must be a UUID`);
  return v.toLowerCase();
}

/** Integer cents. Accepts a digit string (preferred) or a safe integer number. Always returns a positive bigint. */
export function cents(v: unknown, field: string): bigint {
  let n: bigint;
  if (typeof v === 'string' && /^-?\d+$/.test(v)) n = BigInt(v);
  else if (typeof v === 'number' && Number.isSafeInteger(v)) n = BigInt(v);
  else return invalid(`${field} must be an integer number of cents (send a string for large values)`);
  if (n <= 0n) invalid(`${field} must be greater than zero`);
  if (n > MAX_BIGINT) invalid(`${field} exceeds the maximum amount`);
  return n;
}
