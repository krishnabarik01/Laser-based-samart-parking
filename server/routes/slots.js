import express from 'express';
import { db } from '../db.js';
import { broadcast } from '../ws.js';
import { authenticate, authorize } from '../middleware.js';

const router = express.Router();

// GET all slots with optional filters
router.get('/', (req, res) => {
  const { zone, type, status, search } = req.query;
  let query = 'SELECT * FROM slots WHERE 1=1';
  const params = [];

  if (zone) {
    query += ' AND zone = ?';
    params.push(zone);
  }
  if (type) {
    query += ' AND type = ?';
    params.push(type);
  }
  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  if (search) {
    query += ' AND (id LIKE ? OR current_vehicle LIKE ? OR sensor_id LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  query += ' ORDER BY id ASC';
  const slots = db.prepare(query).all(...params);
  res.json(slots);
});

// GET complete lot snapshot
router.get('/state', (req, res) => {
  const slots = db.prepare('SELECT * FROM slots ORDER BY id ASC').all();
  const layout = db.prepare('SELECT * FROM layout_state WHERE id = 1').get();
  
  const total = slots.length;
  const occupied = slots.filter(s => s.status === 'occupied').length;
  const available = slots.filter(s => s.status === 'available').length;
  const blocked = slots.filter(s => s.status === 'blocked').length;
  const cars = slots.filter(s => s.type === 'car').length;
  const bikes = slots.filter(s => s.type === 'bike').length;
  const evSlots = slots.filter(s => s.is_ev === 1).length;

  res.json({
    summary: {
      total,
      occupied,
      available,
      blocked,
      cars,
      bikes,
      evSlots,
      occupancyRate: total > 0 ? Math.round((occupied / total) * 100) : 0,
      activeMode: layout.current_mode,
      capacityGainPercent: layout.capacity_gain_percent
    },
    slots
  });
});

// PATCH update slot status, toggle EV, toggle accessible, or force free
router.patch('/:id', authenticate, authorize('admin', 'operator'), (req, res) => {
  const { id } = req.params;
  const { status, is_ev, is_accessible, action } = req.body;

  const slot = db.prepare('SELECT * FROM slots WHERE id = ?').get(id);
  if (!slot) {
    return res.status(404).json({ error: `Slot ${id} not found.` });
  }

  db.transaction(() => {
    if (action === 'force_free') {
      db.prepare("UPDATE slots SET status = 'available', current_vehicle = NULL, occupied_since = NULL WHERE id = ?").run(id);
      db.prepare("UPDATE sessions SET status = 'completed', exit_time = datetime('now') WHERE slot_id = ? AND status = 'active'").run(id);
      db.prepare('INSERT INTO event_logs (event_type, message) VALUES (?, ?)').run('slot', `Slot ${id} force freed by operator`);
    } else if (action === 'block') {
      db.prepare("UPDATE slots SET status = 'blocked', current_vehicle = NULL WHERE id = ?").run(id);
      db.prepare('INSERT INTO event_logs (event_type, message) VALUES (?, ?)').run('slot', `Slot ${id} marked BLOCKED by operator`);
    } else if (action === 'unblock') {
      db.prepare("UPDATE slots SET status = 'available' WHERE id = ?").run(id);
      db.prepare('INSERT INTO event_logs (event_type, message) VALUES (?, ?)').run('slot', `Slot ${id} unblocked`);
    }

    if (status && ['available', 'occupied', 'blocked'].includes(status)) {
      db.prepare('UPDATE slots SET status = ? WHERE id = ?').run(status, id);
    }
    if (typeof is_ev === 'boolean' || is_ev === 0 || is_ev === 1) {
      db.prepare('UPDATE slots SET is_ev = ? WHERE id = ?').run(is_ev ? 1 : 0, id);
    }
    if (typeof is_accessible === 'boolean' || is_accessible === 0 || is_accessible === 1) {
      db.prepare('UPDATE slots SET is_accessible = ? WHERE id = ?').run(is_accessible ? 1 : 0, id);
    }
  })();

  const updated = db.prepare('SELECT * FROM slots WHERE id = ?').get(id);
  broadcast('slot.updated', updated);

  res.json({ success: true, slot: updated });
});

// POST add new slot (Settings only)
router.post('/', authenticate, authorize('admin'), (req, res) => {
  const { id, zone, type, is_ev, is_accessible, x, y, w, h } = req.body;
  if (!id || !zone || !type) {
    return res.status(400).json({ error: 'id, zone, and type are required.' });
  }

  const existing = db.prepare('SELECT id FROM slots WHERE id = ?').get(id);
  if (existing) {
    return res.status(400).json({ error: `Slot ${id} already exists.` });
  }

  db.prepare(`
    INSERT INTO slots (id, zone, type, status, is_ev, is_accessible, is_adaptive, sensor_id, x, y, w, h)
    VALUES (?, ?, ?, 'available', ?, ?, 0, ?, ?, ?, ?, ?)
  `).run(id, zone, type, is_ev ? 1 : 0, is_accessible ? 1 : 0, `US-${id}`, x || 100, y || 100, w || 36, h || 60);

  const slot = db.prepare('SELECT * FROM slots WHERE id = ?').get(id);
  broadcast('slot.updated', slot);
  res.status(201).json(slot);
});

// DELETE remove slot
router.delete('/:id', authenticate, authorize('admin'), (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM slots WHERE id = ?').run(id);
  broadcast('lot.state', { deletedSlotId: id });
  res.json({ success: true, message: `Slot ${id} deleted.` });
});

export default router;
