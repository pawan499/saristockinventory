import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';
const env = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  MONGODB_URI: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:5173'),
  UPLOAD_DIR: z.string().default('uploads'),
  OCR_LANGUAGES: z.string().regex(/^[a-z]+(?:\+[a-z]+)*$/).default('eng'),
}).parse(process.env);
export const config = { ...env, uploadDir: path.resolve(env.UPLOAD_DIR), origins: env.CORS_ORIGINS.split(',').map(s => s.trim()) };
