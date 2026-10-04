import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { config } from '../src/config.js';
import { User } from '../src/models.js';
import { userInput } from '../src/validation.js';
// Pass password through environment, not a command-line argument.
const input = userInput.parse({ name: process.env.ADMIN_NAME, email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
try {
  await mongoose.connect(config.MONGODB_URI);
  await User.init();
  if (await User.exists({ email: input.email })) throw new Error('Email already exists; existing users are never overwritten');
  await User.create({ name: input.name, email: input.email, passwordHash: await bcrypt.hash(input.password, 12), role: 'admin' });
  console.log('Admin created. Use /api/auth/login to sign in.');
} finally { await mongoose.disconnect(); }
