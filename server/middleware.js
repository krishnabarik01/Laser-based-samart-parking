import jwt from 'jsonwebtoken';
import { db } from './db.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'smartpark-super-secret-jwt-key-2026';

export function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. No token provided.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

export function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: `Forbidden. Role '${req.user.role}' lacks permission.` });
    }
    next();
  };
}

export function apiKeyAuth(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.apiKey;
  const expectedKey = db.prepare("SELECT value FROM settings WHERE key = 'api_key'").get()?.value || 'smartpark-sensor-key-2026';
  
  if (!key || key !== expectedKey) {
    return res.status(401).json({ error: 'Unauthorized hardware sensor. Invalid or missing X-API-Key header.' });
  }
  next();
}
