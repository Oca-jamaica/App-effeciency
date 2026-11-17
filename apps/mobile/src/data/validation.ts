import { z } from 'zod';

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date');
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a valid time');
export const optionalText = (max: number) =>
  z
    .string()
    .max(max, `Keep this under ${max} characters`)
    .transform((s) => (s.trim() === '' ? null : s.trim()))
    .nullable()
    .optional();
export const requiredTitle = (max = 200) => z.string().trim().min(1, 'Give it a name').max(max, `Keep this under ${max} characters`);
export const url = z
  .string()
  .trim()
  .transform((s) => (/^https?:\/\//i.test(s) ? s : `https://${s}`))
  .pipe(z.string().url('Enter a valid link').max(2048).regex(/^https?:\/\/[^\s]+$/i, 'Enter a valid link'));

/** Turns a Zod error into `{ field: message }` for forms. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export class ValidationError extends Error {
  readonly fields: Record<string, string>;
  constructor(fields: Record<string, string>) {
    super(Object.values(fields)[0] ?? 'Invalid input');
    this.fields = fields;
  }
}

export function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new ValidationError(fieldErrors(r.error));
  return r.data;
}
