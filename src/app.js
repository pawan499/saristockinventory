import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { createWorker } from 'tesseract.js';
import { ZodError, z } from 'zod';
import { config } from './config.js';
import { User, Sari, Bill } from './models.js';
import { authenticate, tokenFor, publicUser } from './auth.js';
import { userInput, loginInput, sariInput, bulkInput, idInput, fail } from './validation.js';
import { upload, saveImage, removeImage } from './uploads.js';
import { parseBillText } from './bill-parser.js';

export async function recognizeBill(filename) {
  const worker = await createWorker(config.OCR_LANGUAGES);
  try { return (await worker.recognize(path.join(config.uploadDir, filename))).data; }
  finally { await worker.terminate(); }
}
export function createApp({ recognize = recognizeBill } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.origins }));
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 120 }));
  app.get('/health', (req, res) => res.status(mongoose.connection.readyState === 1 ? 200 : 503).json({ status: mongoose.connection.readyState === 1 ? 'ok' : 'unavailable' }));
  app.post('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 20 }), async (req, res) => {
    const input = loginInput.parse(req.body);
    const user = await User.findOne({ email: input.email }).select('+passwordHash');
    // Compare even on an unknown email to reduce account discovery through timing.
    const valid = await bcrypt.compare(input.password, user?.passwordHash ?? '$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW');
    if (!user || !valid) fail(401, 'Invalid email or password');
    res.json({ token: tokenFor(user), user: publicUser(user) });
  });
  app.use('/api', authenticate);
  app.get('/api/auth/me', (req, res) => res.json({ user: publicUser(req.user) }));
  app.post('/api/users', async (req, res) => {
    const input = userInput.parse(req.body);
    const user = await User.create({ name: input.name, email: input.email, passwordHash: await bcrypt.hash(input.password, 12) });
    res.status(201).json({ user: publicUser(user) });
  });
  app.get('/api/users', async (req, res) => {
    if (req.user.role !== 'admin') fail(403, 'Admin access required');
    res.json({ users: (await User.find().sort({ createdAt: -1 }).limit(500)).map(publicUser) });
  });
  app.post('/api/saris/bulk', upload.single('file'), async (req, res) => {
    let rows = req.body?.items;
    if (req.file) {
      try { rows = parse(req.file.buffer.toString('utf8'), { columns: true, skip_empty_lines: true, trim: true, bom: true }); }
      catch { fail(400, 'Invalid CSV; use companyName,sariName,price,quantity columns'); }
    }
    const items = bulkInput.parse(rows);
    const saris = await Sari.insertMany(items.map(item => ({ ...item, createdBy: req.user.id })), { ordered: true });
    res.status(201).json({ count: saris.length, saris });
  });
  app.post('/api/saris', upload.single('image'), async (req, res) => {
    const input = sariInput.parse(req.body);
    const filename = req.file ? await saveImage(req.file) : null;
    try {
      const sari = await Sari.create({ ...input, image: filename, createdBy: req.user.id });
      res.status(201).json({ sari });
    } catch (err) { await removeImage(filename); throw err; }
  });
  app.get('/api/saris', async (req, res) => {
    const query = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20), search: z.string().trim().max(100).optional() }).parse(req.query);
    const filter = { createdBy: req.user.id };
    if (query.search) {
      const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [{ sariName: { $regex: escaped, $options: 'i' } }, { companyName: { $regex: escaped, $options: 'i' } }];
    }
    const [saris, total] = await Promise.all([Sari.find(filter).sort({ createdAt: -1 }).skip((query.page - 1) * query.limit).limit(query.limit), Sari.countDocuments(filter)]);
    res.json({ saris, total, page: query.page, limit: query.limit });
  });
  app.get('/api/saris/:id', async (req, res) => {
    const sari = await Sari.findOne({ _id: idInput.parse(req.params.id), createdBy: req.user.id });
    if (!sari) fail(404, 'Sari not found');
    res.json({ sari });
  });
  app.patch('/api/saris/:id', upload.single('image'), async (req, res) => {
    const input = sariInput.partial().parse(req.body);
    if (!Object.keys(input).length && !req.file) fail(400, 'Provide a field or image to update');
    const sari = await Sari.findOne({ _id: idInput.parse(req.params.id), createdBy: req.user.id });
    if (!sari) fail(404, 'Sari not found');
    const oldImage = sari.image;
    const filename = req.file ? await saveImage(req.file) : null;
    try {
      Object.assign(sari, input, ...(filename ? [{ image: filename }] : []));
      await sari.save();
    } catch (err) { await removeImage(filename); throw err; }
    if (filename) await removeImage(oldImage);
    res.json({ sari });
  });
  app.get('/api/images/:filename', async (req, res) => {
    const filename = z.string().uuid().parse(req.params.filename.replace(/\.jpg$/, '')) + '.jpg';
    if (req.params.filename !== filename) fail(400, 'Invalid image filename');
    const owned = await Sari.exists({ image: filename, createdBy: req.user.id }) || await Bill.exists({ image: filename, createdBy: req.user.id });
    if (!owned) fail(404, 'Image not found');
    res.sendFile(filename, { root: config.uploadDir });
  });
  // Device OCR has already populated the review table. Register the photo
  // without repeating OCR; clientId makes a lost-response retry idempotent.
  app.post('/api/bills/draft', upload.single('image'), async (req, res) => {
    const clientId = z.string().uuid().parse(req.body?.clientId);
    const existing = await Bill.findOne({ createdBy: req.user.id, clientId });
    if (existing) return res.json({ bill: existing });
    const filename = await saveImage(req.file);
    try {
      const bill = await Bill.create({ createdBy: req.user.id, clientId, image: filename, rawText: 'Read on device', suggestedItems: [] });
      res.status(201).json({ bill });
    } catch (error) {
      await removeImage(filename);
      if (error.code === 11000) {
        const bill = await Bill.findOne({ createdBy: req.user.id, clientId });
        if (bill) return res.json({ bill });
      }
      throw error;
    }
  });
  let ocrBusy = false;
  app.post('/api/bills/extract', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10 }), upload.single('image'), async (req, res) => {
    const companyName = z.string().trim().max(150).default('').parse(req.body?.companyName);
    if (ocrBusy) fail(429, 'OCR is busy; retry shortly');
    ocrBusy = true;
    let filename;
    try {
      filename = await saveImage(req.file);
      let result;
      try { result = await recognize(filename); }
      catch { fail(502, 'OCR failed. Check language-data connectivity and retry with a clear image'); }
      const bill = await Bill.create({ createdBy: req.user.id, image: filename, rawText: result.text || ' ', confidence: result.confidence, suggestedItems: parseBillText(result.text || '', companyName) });
      res.status(201).json({ bill, needsReview: true, message: 'Review companyName, sariName, Pcs quantity and pre-GST Rate. Add 5% GST once to each unit rate before submitting final prices to the confirm endpoint.' });
    } catch (err) { await removeImage(filename); throw err; }
    finally { ocrBusy = false; }
  });
  app.get('/api/bills/:id', async (req, res) => {
    const bill = await Bill.findOne({ _id: idInput.parse(req.params.id), createdBy: req.user.id });
    if (!bill) fail(404, 'Bill not found');
    res.json({ bill });
  });
  app.post('/api/bills/:id/confirm', async (req, res) => {
    const id = idInput.parse(req.params.id);
    const { items } = z.object({ items: bulkInput }).strict().parse(req.body);
    const session = await mongoose.startSession();
    let saris;
    try {
      await session.withTransaction(async () => {
        const bill = await Bill.findOneAndUpdate({ _id: id, createdBy: req.user.id, status: 'pending' }, { $set: { status: 'imported', importedAt: new Date() } }, { session, returnDocument: 'after' });
        if (!bill) {
          const exists = await Bill.exists({ _id: id, createdBy: req.user.id }).session(session);
          fail(exists ? 409 : 404, exists ? 'Bill already imported' : 'Bill not found');
        }
        saris = await Sari.insertMany(items.map(item => ({ ...item, createdBy: req.user.id, bill: id })), { session });
      });
    } finally { await session.endSession(); }
    res.status(201).json({ count: saris.length, saris });
  });
  app.use((req, res) => res.status(404).json({ message: 'Route not found' }));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof ZodError) return res.status(400).json({ message: 'Validation failed', errors: err.issues });
    if (err.code === 11000) return res.status(409).json({ message: 'Email already exists' });
    if (err.name === 'MulterError') return res.status(400).json({ message: err.code === 'LIMIT_FILE_SIZE' ? 'Maximum upload size is 8 MB' : err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'Invalid JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ message: 'Request body too large' });
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ message: status >= 500 ? 'Server error; check server logs' : err.message });
  });
  return app;
}
