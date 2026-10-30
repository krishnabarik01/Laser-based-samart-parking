import express from 'express';
import { db } from '../db.js';
import { broadcast } from '../ws.js';
import { authenticate, authorize } from '../middleware.js';

const router = express.Router();

router.get('/', (req, res) => {
  const lasers = db.prepare('SELECT * FROM lasers ORDER BY id ASC').all();
  res.json(lasers);
});

router.patch('/:id', authenticate, authorize('admin', 'operator'), (req, res) => {
  const { id } = req.params;
  const { intensity, pulse_mode, mode, status } = req.body;

  const laser = db.prepare('SELECT * FROM lasers WHERE id = ?').get(id);
  if (!laser) {
    return res.status(404).json({ error: `Laser unit ${id} not found.` });
  }

  db.transaction(() => {
    if (typeof intensity === 'number') {
      db.prepare('UPDATE lasers SET intensity = ? WHERE id = ?').run(Math.min(100, Math.max(0, intensity)), id);
    }
    if (typeof pulse_mode === 'boolean' || pulse_mode === 0 || pulse_mode === 1) {
      db.prepare('UPDATE lasers SET pulse_mode = ? WHERE id = ?').run(pulse_mode ? 1 : 0, id);
    }
    if (mode && ['guidance', 'calibration', 'test', 'disabled'].includes(mode)) {
      db.prepare('UPDATE lasers SET mode = ? WHERE id = ?').run(mode, id);
    }
    if (status && ['online', 'standby', 'active', 'fault'].includes(status)) {
      db.prepare('UPDATE lasers SET status = ? WHERE id = ?').run(status, id);
    }
  })();

  const updated = db.prepare('SELECT * FROM lasers WHERE id = ?').get(id);
  broadcast('laser.updated', updated);

  res.json({ success: true, laser: updated });
});

router.post('/test-pattern', authenticate, authorize('admin', 'operator'), (req, res) => {
  const { unitId } = req.body;
  if (unitId) {
    db.prepare("UPDATE lasers SET mode = 'test', last_ping = datetime('now') WHERE id = ?").run(unitId);
  } else {
    db.prepare("UPDATE lasers SET mode = 'test', last_ping = datetime('now') WHERE status != 'fault'").run();
  }

  const lasers = db.prepare('SELECT * FROM lasers ORDER BY id ASC').all();
  broadcast('laser.test_pattern', { active: true, timestamp: new Date().toISOString() });

  res.json({ success: true, message: 'Test pattern active on selected units for 15s.', lasers });
});

export default router;
