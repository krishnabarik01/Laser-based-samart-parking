import express from 'express';
import { db } from '../db.js';
import { broadcast } from '../ws.js';
import { authenticate, authorize } from '../middleware.js';

const router = express.Router();

// GET parking sessions with filters & pagination
router.get('/sessions', authenticate, (req, res) => {
  const { status, type, search, page = 1, limit = 20, exportCsv } = req.query;
  
  let baseQuery = 'SELECT * FROM sessions WHERE 1=1';
  const params = [];

  if (status) {
    baseQuery += ' AND status = ?';
    params.push(status);
  }
  if (type) {
    baseQuery += ' AND vehicle_type = ?';
    params.push(type);
  }
  if (search) {
    baseQuery += ' AND (vehicle_number LIKE ? OR slot_id LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  if (exportCsv === 'true') {
    const allRecords = db.prepare(`${baseQuery} ORDER BY id DESC LIMIT 500`).all(...params);
    let csv = 'ID,Vehicle Number,Type,Slot ID,Entry Time,Exit Time,Duration (Mins),Fee (INR),Status\n';
    allRecords.forEach(r => {
      csv += `${r.id},"${r.vehicle_number}",${r.vehicle_type},${r.slot_id},"${r.entry_time}","${r.exit_time || ''}",${r.duration_minutes},${r.fee},${r.status}\n`;
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="smartpark_sessions.csv"');
    return res.send(csv);
  }

  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const totalCount = db.prepare(`SELECT count(*) as count FROM (${baseQuery})`).get(...params).count;

  baseQuery += ' ORDER BY id DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit, 10), offset);

  const sessions = db.prepare(baseQuery).all(...params);

  res.json({
    sessions,
    pagination: {
      total: totalCount,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      totalPages: Math.ceil(totalCount / parseInt(limit, 10))
    }
  });
});

// Manual Vehicle Entry
router.post('/entry', authenticate, authorize('admin', 'operator'), (req, res) => {
  const { vehicleNumber, vehicleType = 'car', slotId } = req.body;

  if (!vehicleNumber) {
    return res.status(400).json({ error: 'vehicleNumber is required.' });
  }

  let targetSlot = null;
  if (slotId) {
    targetSlot = db.prepare('SELECT * FROM slots WHERE id = ?').get(slotId);
    if (!targetSlot || targetSlot.status !== 'available') {
      return res.status(400).json({ error: `Slot ${slotId} is not available.` });
    }
  } else {
    // Find nearest free slot
    targetSlot = db.prepare("SELECT * FROM slots WHERE type = ? AND status = 'available' ORDER BY id ASC LIMIT 1").get(vehicleType);
  }

  if (!targetSlot) {
    return res.status(400).json({ error: `No vacant slots available for ${vehicleType.toUpperCase()}.` });
  }

  const now = new Date().toISOString();

  db.transaction(() => {
    db.prepare("UPDATE slots SET status = 'occupied', current_vehicle = ?, occupied_since = ? WHERE id = ?")
      .run(vehicleNumber.toUpperCase().trim(), now, targetSlot.id);

    db.prepare(`
      INSERT INTO sessions (vehicle_number, vehicle_type, slot_id, entry_time, status)
      VALUES (?, ?, ?, ?, 'active')
    `).run(vehicleNumber.toUpperCase().trim(), vehicleType, targetSlot.id, now);

    db.prepare('INSERT INTO event_logs (event_type, message) VALUES (?, ?)')
      .run('entry', `Vehicle ${vehicleNumber} manually entered Slot ${targetSlot.id}`);
  })();

  const updatedSlot = db.prepare('SELECT * FROM slots WHERE id = ?').get(targetSlot.id);
  broadcast('vehicle.entered', {
    vehicleNumber,
    vehicleType,
    slotId: targetSlot.id,
    entryTime: now
  });
  broadcast('slot.updated', updatedSlot);

  res.json({ success: true, slot: updatedSlot, vehicleNumber, slotId: targetSlot.id });
});

// Manual Vehicle Exit
router.post('/exit', authenticate, authorize('admin', 'operator'), (req, res) => {
  const { slotId, vehicleNumber } = req.body;

  let session = null;
  let slot = null;

  if (slotId) {
    slot = db.prepare('SELECT * FROM slots WHERE id = ?').get(slotId);
    session = db.prepare("SELECT * FROM sessions WHERE slot_id = ? AND status = 'active' LIMIT 1").get(slotId);
  } else if (vehicleNumber) {
    session = db.prepare("SELECT * FROM sessions WHERE vehicle_number = ? AND status = 'active' LIMIT 1").get(vehicleNumber.toUpperCase().trim());
    if (session) {
      slot = db.prepare('SELECT * FROM slots WHERE id = ?').get(session.slot_id);
    }
  }

  if (!slot && !session) {
    return res.status(404).json({ error: 'No active session or occupied slot found with provided identifier.' });
  }

  const exitTime = new Date().toISOString();
  let durationMinutes = 30;
  if (session?.entry_time) {
    const diffMs = new Date(exitTime) - new Date(session.entry_time);
    durationMinutes = Math.max(10, Math.round(diffMs / 60000));
  }

  const carRate = parseInt(db.prepare("SELECT value FROM settings WHERE key = 'car_rate_hourly'").get()?.value || '40', 10);
  const bikeRate = parseInt(db.prepare("SELECT value FROM settings WHERE key = 'bike_rate_hourly'").get()?.value || '15', 10);
  const rate = (slot?.type === 'bike' || session?.vehicle_type === 'bike') ? bikeRate : carRate;
  const fee = Math.ceil((durationMinutes / 60) * rate);

  const activeSlotId = slot?.id || session?.slot_id;

  db.transaction(() => {
    db.prepare("UPDATE slots SET status = 'available', current_vehicle = NULL, occupied_since = NULL WHERE id = ?")
      .run(activeSlotId);

    if (session) {
      db.prepare("UPDATE sessions SET status = 'completed', exit_time = ?, duration_minutes = ?, fee = ? WHERE id = ?")
        .run(exitTime, durationMinutes, fee, session.id);
    }

    db.prepare('INSERT INTO event_logs (event_type, message) VALUES (?, ?)')
      .run('exit', `Vehicle ${vehicleNumber || slot?.current_vehicle} manually exited Slot ${activeSlotId}. Fee: ₹${fee}`);
  })();

  const updatedSlot = db.prepare('SELECT * FROM slots WHERE id = ?').get(activeSlotId);
  broadcast('vehicle.exited', {
    slotId: activeSlotId,
    durationMinutes,
    fee
  });
  broadcast('slot.updated', updatedSlot);

  res.json({ success: true, slot: updatedSlot, durationMinutes, fee });
});

export default router;
