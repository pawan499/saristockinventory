import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import sharp from 'sharp';
import { parseBillText } from '../src/bill-parser.js';
let directory, mongo, app, token, otherToken, User, Sari, Bill, image;
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'sari-api-test-'));
  process.env.JWT_SECRET = 'test-secret-with-at-least-32-characters';
  process.env.MONGODB_URI = 'mongodb://127.0.0.1:27931/sari_test?replicaSet=test';
  process.env.UPLOAD_DIR = path.join(directory, 'uploads');
  mongo = spawn('mongod', ['--dbpath', directory, '--port', '27931', '--bind_ip', '127.0.0.1', '--replSet', 'test', '--quiet'], { stdio: 'ignore' });
  mongo.on('error', () => {});
  const direct = mongoose.createConnection();
  for (let attempt = 0; attempt < 60; attempt++) {
    try { await direct.openUri('mongodb://127.0.0.1:27931/admin?directConnection=true', { serverSelectionTimeoutMS: 500 }); break; }
    catch { if (attempt === 59) throw new Error('Test mongod could not start'); }
  }
  await direct.db.admin().command({ replSetInitiate: { _id: 'test', members: [{ _id: 0, host: '127.0.0.1:27931' }] } });
  await direct.close();
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  ({ User, Sari, Bill } = await import('../src/models.js'));
  await Promise.all([User.init(), Sari.init(), Bill.init()]);
  const { createApp } = await import('../src/app.js');
  app = createApp({ recognize: async () => ({ text: 'Silk Sari  2  450.50\nTotal 901.00', confidence: 85 }) });
  await User.create({ name: 'Admin', email: 'admin@example.com', role: 'admin', passwordHash: await bcrypt.hash('password123', 12) });
  const login = await request(app).post('/api/auth/login').send({ email: 'admin@example.com', password: 'password123' });
  assert.equal(login.status, 200);
  token = login.body.token;
  image = await sharp({ create: { width: 100, height: 100, channels: 3, background: 'white' } }).png().toBuffer();
});
after(async () => {
  await mongoose.disconnect();
  if (mongo && mongo.exitCode === null) { const stopped = once(mongo, 'exit'); mongo.kill('SIGTERM'); await stopped; }
  if (directory) await rm(directory, { recursive: true, force: true });
});
const auth = () => ({ Authorization: `Bearer ${token}` });
test('unauthenticated writes and bad credentials are denied', async () => {
  assert.equal((await request(app).post('/api/users').send({})).status, 401);
  assert.equal((await request(app).post('/api/auth/login').send({ email: 'admin@example.com', password: 'wrongpass' })).status, 401);
});
test('logged in user can create a user; password hashes never returned', async () => {
  const result = await request(app).post('/api/users').set(auth()).send({ name: 'Staff', email: 'staff@example.com', password: 'password123' });
  assert.equal(result.status, 201);
  assert.equal(result.body.user.role, 'user');
  assert.equal(result.body.user.passwordHash, undefined);
  assert.equal((await request(app).post('/api/users').set(auth()).send({ name: 'Staff', email: 'staff@example.com', password: 'password123' })).status, 409);
  otherToken = (await request(app).post('/api/auth/login').send({ email: 'staff@example.com', password: 'password123' })).body.token;
  assert.equal((await request(app).get('/api/users').set('Authorization', `Bearer ${otherToken}`)).status, 403);
  assert.equal((await request(app).post('/api/users').set('Authorization', `Bearer ${otherToken}`).send({ name: 'New User', email: 'new@example.com', password: 'password123' })).status, 201);
});
test('sari upload, private image, search and edit work', async () => {
  const result = await request(app).post('/api/saris').set(auth()).field('companyName', 'ABC').field('sariName', 'Silk').field('price', '450.50').field('quantity', '2').attach('image', image, 'sari.png');
  assert.equal(result.status, 201);
  const { sari } = result.body;
  assert.equal((await request(app).get(`/api/images/${sari.image}`).set(auth())).status, 200);
  assert.equal((await request(app).get(`/api/saris/${sari._id}`).set('Authorization', `Bearer ${otherToken}`)).status, 404);
  assert.equal((await request(app).get(`/api/images/${sari.image}`).set('Authorization', `Bearer ${otherToken}`)).status, 404);
  assert.equal((await request(app).get('/api/saris?search=Silk').set(auth())).body.total, 1);
  assert.equal((await request(app).patch(`/api/saris/${sari._id}`).set(auth()).send({ quantity: 9 })).body.sari.quantity, 9);
  assert.equal((await request(app).post('/api/saris').set(auth()).send({ companyName: 'ABC', sariName: 'Invalid', price: -1, quantity: 2 })).status, 400);
  assert.equal((await request(app).post('/api/saris').set(auth()).field('companyName', 'ABC').field('sariName', 'Bad').field('price', '2').field('quantity', '1').attach('image', Buffer.from('not an image'), 'fake.png')).status, 400);
});
test('JSON and CSV bulk insertion validate every row before saving', async () => {
  const item = { companyName: 'ABC', sariName: 'Cotton', price: 50, quantity: 5 };
  assert.equal((await request(app).post('/api/saris/bulk').set(auth()).send({ items: [item, item] })).body.count, 2);
  const beforeCount = await Sari.countDocuments();
  for (const price of ['', true, null]) {
    assert.equal((await request(app).post('/api/saris/bulk').set(auth()).send({ items: [{ ...item, price }] })).status, 400);
  }
  assert.equal((await request(app).post('/api/saris/bulk').set(auth()).send({ items: [item, { ...item, quantity: -1 }] })).status, 400);
  assert.equal(await Sari.countDocuments(), beforeCount);
  const csv = 'companyName,sariName,price,quantity\nABC,Printed,650,25\n';
  assert.equal((await request(app).post('/api/saris/bulk').set(auth()).attach('file', Buffer.from(csv), 'saris.csv')).body.count, 1);
});
test('bill extraction requires review; confirmation is transactional and cannot duplicate', async () => {
  const result = await request(app).post('/api/bills/extract').set(auth()).field('companyName', 'ABC').attach('image', image, 'bill.png');
  assert.equal(result.status, 201);
  assert.equal(result.body.needsReview, true);
  const bill = result.body.bill;
  assert.equal(bill.suggestedItems.length, 1);
  const endpoint = `/api/bills/${bill._id}/confirm`;
  assert.equal((await request(app).post(endpoint).set('Authorization', `Bearer ${otherToken}`).send({ items: bill.suggestedItems })).status, 404);
  assert.equal((await request(app).post(endpoint).set(auth()).send({ items: [{ ...bill.suggestedItems[0], price: -2 }] })).status, 400);
  assert.equal((await Bill.findById(bill._id)).status, 'pending');
  const responses = await Promise.all([request(app).post(endpoint).set(auth()).send({ items: bill.suggestedItems }), request(app).post(endpoint).set(auth()).send({ items: bill.suggestedItems })]);
  assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
  assert.equal(await Sari.countDocuments({ bill: bill._id }), 1);
});
test('OCR parser skips totals and handles table separators', () => {
  assert.deepEqual(parseBillText('1. Silk Sari | 3 | 1,200.50 | 3601.50\nGST 5 100\nTotal 3601.50', 'ABC'), [{ companyName: 'ABC', sariName: 'Silk Sari', quantity: 3, price: 1200.5 }]);
});
