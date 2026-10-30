import express from 'express';
import { db } from '../db.js';
import { broadcast } from '../ws.js';
import { apiKeyAuth } from '../middleware.js';

const router = express.Router();

// Real hardware edge endpoint called by Arduino / ESP32 nodes
router.post('/reading', apiKeyAuth, (req, res) => {
  const { sensorId, occupied, distanceCm, voltage } = req.body;

  if (!sensorId || typeof occupied !== 'boolean') {
    return res.status(400).json({ error: 'sensorId (string) and occupied (boolean) are required.' });
  }

  // Find slot associated with sensor
  const slot = db.prepare('SELECT * FROM slots WHERE sensor_id = ? OR id = ?').get(sensorId, sensorId);
  if (!slot) {
    return res.status(404).json({ error: `No slot mapped to sensor ID '${sensorId}'.` });
  }

  const now = new Date().toISOString();
  const newStatus = occupied ? 'occupied' : 'available';

  db.transaction(() => {
    // Update slot
    if (occupied && slot.status !== 'occupied') {
      db.prepare("UPDATE slots SET status = 'occupied', occupied_since = ? WHERE id = ?").run(now, slot.id);
    } else if (!occupied && slot.status === 'occupied') {
      db.prepare("UPDATE slots SET status = 'available', current_vehicle = NULL, occupied_since = NULL WHERE id = ?").run(slot.id);
      db.prepare("UPDATE sessions SET status = 'completed', exit_time = ? WHERE slot_id = ? AND status = 'active'").run(now, slot.id);
    }

    // Update device heartbeat in devices table
    db.prepare("UPDATE devices SET last_seen = datetime('now'), status = 'online' WHERE id = ?").run(sensorId);
  })();

  const updatedSlot = db.prepare('SELECT * FROM slots WHERE id = ?').get(slot.id);
  broadcast('slot.updated', updatedSlot);

  res.json({
    success: true,
    sensorId,
    slotId: slot.id,
    status: updatedSlot.status,
    timestamp: now
  });
});

export default router;
