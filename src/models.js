import mongoose from 'mongoose';
const { Schema } = mongoose;
const userSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['admin', 'user'], default: 'user' },
}, { timestamps: true });
const sariSchema = new Schema({
  companyName: { type: String, required: true },
  sariName: { type: String, required: true },
  price: { type: Number, required: true, min: 0 },
  quantity: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  image: { type: String, default: null },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  bill: { type: Schema.Types.ObjectId, ref: 'Bill', default: null },
}, { timestamps: true });
sariSchema.index({ createdBy: 1, createdAt: -1 });
sariSchema.index({ bill: 1 });
const billSchema = new Schema({
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  image: { type: String, required: true },
  rawText: { type: String, required: true },
  confidence: Number,
  suggestedItems: { type: [Schema.Types.Mixed], default: [] },
  status: { type: String, enum: ['pending', 'imported'], default: 'pending' },
  importedAt: Date,
}, { timestamps: true });
export const User = mongoose.model('User', userSchema);
export const Sari = mongoose.model('Sari', sariSchema);
export const Bill = mongoose.model('Bill', billSchema);
