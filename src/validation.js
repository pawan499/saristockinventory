import { z } from 'zod';
const numericInput = z.union([z.number(), z.string().trim().regex(/^\d+(?:\.\d+)?$/, 'Expected a non-negative number')]).pipe(z.coerce.number());
const money = numericInput.pipe(z.number().finite().min(0).max(100000000)).refine(n => Math.abs(n * 100 - Math.round(n * 100)) < 0.00001, 'Price supports at most two decimal places');
export const userInput = z.object({ name: z.string().trim().min(2).max(100), email: z.string().trim().email().max(254).transform(s => s.toLowerCase()), password: z.string().min(8).max(72).refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 UTF-8 bytes') }).strict();
export const loginInput = userInput.pick({ email: true, password: true });
export const sariInput = z.object({
  companyName: z.string().trim().min(1).max(150),
  sariName: z.string().trim().min(1).max(150),
  price: money,
  quantity: numericInput.pipe(z.number().int().min(0).max(1000000)),
}).strict();
export const bulkInput = z.array(sariInput).min(1).max(500);
export const idInput = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid ID');
export function fail(status, message) { const err = new Error(message); err.status = status; throw err; }
