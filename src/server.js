import mongoose from 'mongoose';
import { config } from './config.js';
import { createApp } from './app.js';
import { User, Sari, Bill } from './models.js';
await mongoose.connect(config.MONGODB_URI);
await Promise.all([User.init(), Sari.init(), Bill.init()]);
const server = createApp().listen(config.PORT, () => console.log(`Sari API listening on http://localhost:${config.PORT}`));
async function shutdown() { server.close(async () => { await mongoose.disconnect(); process.exit(0); }); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
