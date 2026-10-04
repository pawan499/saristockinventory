import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { User } from './models.js';
import { fail } from './validation.js';
export function tokenFor(user) { return jwt.sign({}, config.JWT_SECRET, { subject: user.id, expiresIn: '12h', algorithm: 'HS256' }); }
export function publicUser(user) { return { id: user.id, name: user.name, email: user.email, role: user.role }; }
export async function authenticate(req, res, next) {
  const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
  if (!token) fail(401, 'Login required');
  let payload;
  try { payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] }); }
  catch { fail(401, 'Invalid or expired token'); }
  const user = await User.findById(payload.sub);
  if (!user) fail(401, 'User no longer exists');
  req.user = user;
  next();
}
