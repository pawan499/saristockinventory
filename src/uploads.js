import multer from 'multer';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { fail } from './validation.js';
export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 10, fieldSize: 256 * 1024 } });
export async function saveImage(file) {
  if (!file) fail(400, 'Image file is required');
  let buffer;
  try {
    const instance = sharp(file.buffer, { limitInputPixels: 25000000 });
    const metadata = await instance.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format)) fail(400, 'Only JPEG, PNG and WebP images are supported');
    buffer = await instance.rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
  } catch (err) { if (err.status) throw err; fail(400, 'Invalid or oversized image'); }
  await mkdir(config.uploadDir, { recursive: true });
  const filename = `${randomUUID()}.jpg`;
  await writeFile(path.join(config.uploadDir, filename), buffer);
  return filename;
}
export async function removeImage(filename) { if (filename) await unlink(path.join(config.uploadDir, filename)).catch(() => {}); }
