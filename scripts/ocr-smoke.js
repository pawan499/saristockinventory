// Runs actual OCR on a generated clean bill, without MongoDB.
import sharp from 'sharp';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
const directory = await mkdtemp(path.join(tmpdir(), 'sari-ocr-'));
process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/sari_inventory';
process.env.JWT_SECRET ||= 'smoke-test-secret-at-least-32-characters';
process.env.UPLOAD_DIR = directory;
try {
  const { recognizeBill } = await import('../src/app.js');
  await sharp(Buffer.from('<svg width="1600" height="500" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><g font-family="DejaVu Sans" font-size="48" fill="black"><text x="60" y="90">ABC TEXTILES</text><text x="60" y="180">Silk Sari | 2 | 450.50 | 901.00</text><text x="60" y="280">Total 901.00</text></g></svg>')).png().toFile(path.join(directory, 'bill.png'));
  const result = await recognizeBill('bill.png');
  assert.match(result.text, /Silk Sari/i);
  assert.match(result.text, /450\.50/);
  console.log('Actual OCR smoke test passed:', result.text.trim());
} finally { await rm(directory, { recursive: true, force: true }); }
