import { db } from './db.js';
import { broadcast } from './ws.js';

let simulatorTimer = null;

export function startSimulator() {
  if (simulatorTimer) return;

  const getInterval = () => {
    try {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'simulator_interval_sec'").get();
      return (parseInt(row?.value, 10) || 5) * 1000;
    } catch {
      return 5000;
    }
  };

  const isEnabled = () => {
    try {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'simulator_enabled'").get();
      return row?.value === 'true';
    } catch {
      return true;
    }
  };

  simulatorTimer = setInterval(() => {
    if (!isEnabled()) return;

    try {
      const actionRoll = Math.random();

      if (actionRoll < 0.45) {
        // VEHICLE ENTRY
        simulateVehicleEntry();
      } else if (actionRoll < 0.8) {
        // VEHICLE DEPARTURE
        simulateVehicleExit();
      } else {
        // SENSOR PING / HEARTBEAT
        simulateSensorHeartbeat();
      }
    } catch (err) {
      console.error('Simulator step error:', err.message);
    }
  }, 4500);

  console.log('✅ SmartPark AI Influx Simulator initialized and running.');
}

export function stopSimulator() {
  if (simulatorTimer) {
    clearInterval(simulatorTimer);
    simulatorTimer = null;
  }
}

function simulateVehicleEntry() {
  // Determine car vs bike based on demand ratio
  const layout = db.prepare('SELECT demand_ratio_bike FROM layout_state WHERE id = 1').get();
  const isBike = Math.random() * 100 < (layout?.demand_ratio_bike || 60);
  const type = isBike ? 'bike' : 'car';

  // Find an available slot of matching type
  const slot = db.prepare("SELECT * FROM slots WHERE type = ? AND status = 'available' ORDER BY id ASC LIMIT 1").get(type);
  if (!slot) return;

  const states = ['KA', 'MH', 'DL', 'TN', 'HR', 'TS'];
  const stateCode = states[Math.floor(Math.random() * states.length)];
  const num = Math.floor(1000 + Math.random() * 8999);
  const series = String.fromCharCode(65 + Math.floor(Math.random() * 26)) + String.fromCharCode(65 + Math.floor(Math.random() * 26));
  const vehicleNumber = `${stateCode}-${Math.floor(10 + Math.random() * 89)}-${series}-${num}`;

  const entryTime = new Date().toISOString();

  db.transaction(() => {
    // 1. Mark slot occupied
    db.prepare("UPDATE slots SET status = 'occupied', current_vehicle = ?, occupied_since = ? WHERE id = ?")
      .run(vehicleNumber, entryTime, slot.id);

    // 2. Create session
    db.prepare(`
      INSERT INTO sessions (vehicle_number, vehicle_type, slot_id, entry_time, status)
      VALUES (?, ?, ?, ?, 'active')
    `).run(vehicleNumber, type, slot.id, entryTime);

    // 3. Log event
    db.prepare('INSERT INTO event_logs (event_type, message) VALUES (?, ?)')
      .run('entry', `Vehicle ${vehicleNumber} (${type.toUpperCase()}) docked at Slot ${slot.id}`);

    // 4. Activate a laser unit in that zone if available
    db.prepare("UPDATE lasers SET status = 'active', target_slot = ?, last_ping = datetime('now') WHERE zone = ? AND status IN ('online', 'standby') LIMIT 1")
      .run(slot.id, slot.zone);
  })();

  const updatedSlot = db.prepare('SELECT * FROM slots WHERE id = ?').get(slot.id);

  broadcast('vehicle.entered', {
    vehicleNumber,
    vehicleType: type,
    slotId: slot.id,
    zone: slot.zone,
    entryTime
  });

  broadcast('slot.updated', updatedSlot);
}

function simulateVehicleExit() {
  // Find an occupied slot that has been parked for a while
  const occupiedSlot = db.prepare("SELECT * FROM slots WHERE status = 'occupied' ORDER BY RANDOM() LIMIT 1").get();
  if (!occupiedSlot) return;

  // Find active session
  const session = db.prepare("SELECT * FROM sessions WHERE slot_id = ? AND status = 'active' LIMIT 1").get(occupiedSlot.id);
  
  const exitTime = new Date().toISOString();
  let durationMinutes = 45;
  if (session?.entry_time) {
    const diffMs = new Date(exitTime) - new Date(session.entry_time);
    durationMinutes = Math.max(15, Math.round(diffMs / 60000));
  }

  // Get rates
  const carRate = parseInt(db.prepare("SELECT value FROM settings WHERE key = 'car_rate_hourly'").get()?.value || '40', 10);
  const bikeRate = parseInt(db.prepare("SELECT value FROM settings WHERE key = 'bike_rate_hourly'").get()?.value || '15', 10);
  const rate = occupiedSlot.type === 'bike' ? bikeRate : carRate;
  const fee = Math.ceil((durationMinutes / 60) * rate);

  db.transaction(() => {
    // 1. Mark slot available
    db.prepare("UPDATE slots SET status = 'available', current_vehicle = NULL, occupied_since = NULL WHERE id = ?")
      .run(occupiedSlot.id);

    // 2. Complete session
    if (session) {
      db.prepare("UPDATE sessions SET status = 'completed', exit_time = ?, duration_minutes = ?, fee = ? WHERE id = ?")
        .run(exitTime, durationMinutes, fee, session.id);
    }

    // 3. Log event
    db.prepare('INSERT INTO event_logs (event_type, message) VALUES (?, ?)')
      .run('exit', `Vehicle ${occupiedSlot.current_vehicle || 'Unknown'} exited Slot ${occupiedSlot.id}. Fee: ₹${fee}`);

    // 4. Return laser to standby
    db.prepare("UPDATE lasers SET status = 'online', target_slot = NULL WHERE target_slot = ?")
      .run(occupiedSlot.id);
  })();

  const updatedSlot = db.prepare('SELECT * FROM slots WHERE id = ?').get(occupiedSlot.id);

  broadcast('vehicle.exited', {
    slotId: occupiedSlot.id,
    vehicleNumber: occupiedSlot.current_vehicle,
    durationMinutes,
    fee
  });

  broadcast('slot.updated', updatedSlot);
}

function simulateSensorHeartbeat() {
  const device = db.prepare('SELECT id, type, status FROM devices ORDER BY RANDOM() LIMIT 1').get();
  if (!device) return;

  db.prepare("UPDATE devices SET last_seen = datetime('now'), battery = MAX(40, battery - 1) WHERE id = ?")
    .run(device.id);

  broadcast('device.status', {
    id: device.id,
    type: device.type,
    status: device.status,
    lastSeen: new Date().toISOString()
  });
}
