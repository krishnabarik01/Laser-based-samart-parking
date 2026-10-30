import { db } from './db.js';
import { broadcast } from './ws.js';

export function getLayoutState() {
  const state = db.prepare('SELECT * FROM layout_state WHERE id = 1').get();
  const rules = db.prepare('SELECT * FROM guidance_rules').all();
  const history = db.prepare('SELECT * FROM layout_history ORDER BY id DESC LIMIT 10').all();
  const schedule = db.prepare('SELECT * FROM layout_schedule WHERE enabled = 1').all();

  // Compute live demand ratio from active sessions
  const activeSessions = db.prepare("SELECT vehicle_type, count(*) as count FROM sessions WHERE status = 'active' GROUP BY vehicle_type").all();
  let carCount = 0;
  let bikeCount = 0;
  activeSessions.forEach(s => {
    if (s.vehicle_type === 'car') carCount = s.count;
    if (s.vehicle_type === 'bike') bikeCount = s.count;
  });
  const total = carCount + bikeCount;
  const demandRatioBike = total > 0 ? Math.round((bikeCount / total) * 100) : state.demand_ratio_bike;

  return {
    ...state,
    live_demand_ratio_bike: demandRatioBike,
    live_demand_ratio_car: 100 - demandRatioBike,
    rules,
    history,
    schedule
  };
}

export function previewLayout(targetMode) {
  const currentSlots = db.prepare('SELECT count(*) as total, type FROM slots GROUP BY type').all();
  const currentTotal = db.prepare('SELECT count(*) as total FROM slots').get().total;
  
  let predictedCars = 0;
  let predictedBikes = 0;
  let predictedTotal = 0;
  let capacityGain = 0;

  // Base fixed configuration had only 60 total slots (all standard car bays)
  const baseCapacity = 60;

  if (targetMode === '2w-peak') {
    predictedCars = 30; // Zone A
    predictedBikes = 80; // Zone B subdivided into dense bike bays
    predictedTotal = predictedCars + predictedBikes + 30; // Zone C
    capacityGain = Math.round(((predictedTotal - baseCapacity) / baseCapacity) * 100);
  } else if (targetMode === 'car-peak') {
    predictedCars = 30 + 20 + 30; // Zone B kept as car bays
    predictedBikes = 0;
    predictedTotal = 80;
    capacityGain = Math.round(((predictedTotal - baseCapacity) / baseCapacity) * 100);
  } else if (targetMode === 'balanced') {
    predictedCars = 30 + 10 + 30;
    predictedBikes = 40;
    predictedTotal = 110;
    capacityGain = Math.round(((predictedTotal - baseCapacity) / baseCapacity) * 100);
  } else {
    // Custom / Auto default
    predictedCars = 40;
    predictedBikes = 60;
    predictedTotal = 100;
    capacityGain = Math.round(((predictedTotal - baseCapacity) / baseCapacity) * 100);
  }

  return {
    targetMode,
    current: {
      total: currentTotal,
      slots: currentSlots,
    },
    predicted: {
      total: predictedTotal,
      cars: predictedCars,
      bikes: predictedBikes,
      capacityGainPercent: capacityGain,
    }
  };
}

export function applyLayout(targetMode, reason = 'Operator manual trigger') {
  const currentState = db.prepare('SELECT * FROM layout_state WHERE id = 1').get();
  const preview = previewLayout(targetMode);

  // Set transitioning state
  db.prepare('UPDATE layout_state SET transitioning = 1, transition_progress = 0 WHERE id = 1').run();

  broadcast('layout.changing', {
    fromMode: currentState.current_mode,
    toMode: targetMode,
    durationSeconds: 15,
    reason
  });

  // Reconfigure Zone B slots based on new mode
  db.transaction(() => {
    // Clear old Zone B adaptive slots
    db.prepare('DELETE FROM slots WHERE is_adaptive = 1').run();

    const insertSlot = db.prepare(`
      INSERT INTO slots (id, zone, type, status, is_ev, is_accessible, is_adaptive, current_vehicle, occupied_since, sensor_id, x, y, w, h)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    if (targetMode === '2w-peak') {
      // 60 dense bike bays
      for (let i = 1; i <= 60; i++) {
        const id = `B${i.toString().padStart(2, '0')}`;
        const isOcc = i % 2 === 0;
        const col = (i - 1) % 20;
        const row = Math.floor((i - 1) / 20);
        const x = 50 + col * 32;
        const y = 240 + row * 60;
        insertSlot.run(id, 'Zone B', 'bike', isOcc ? 'occupied' : 'available', i <= 8 ? 1 : 0, 0, 1, isOcc ? `KA-05-BK-${2000 + i}` : null, isOcc ? new Date().toISOString() : null, `US-${id}`, x, y, 26, 45);
      }
    } else if (targetMode === 'car-peak') {
      // 24 spacious car bays
      for (let i = 1; i <= 24; i++) {
        const id = `B${i.toString().padStart(2, '0')}`;
        const isOcc = i % 3 === 0;
        const col = (i - 1) % 12;
        const row = Math.floor((i - 1) / 12);
        const x = 55 + col * 52;
        const y = 240 + row * 85;
        insertSlot.run(id, 'Zone B', 'car', isOcc ? 'occupied' : 'available', i <= 4 ? 1 : 0, 0, 1, isOcc ? `KA-01-CR-${3000 + i}` : null, isOcc ? new Date().toISOString() : null, `US-${id}`, x, y, 44, 70);
      }
    } else {
      // Balanced: 12 cars + 30 bikes
      for (let i = 1; i <= 12; i++) {
        const id = `BC${i.toString().padStart(2, '0')}`;
        const isOcc = i % 2 === 0;
        const col = (i - 1) % 12;
        const x = 55 + col * 52;
        const y = 240;
        insertSlot.run(id, 'Zone B', 'car', isOcc ? 'occupied' : 'available', 0, 0, 1, isOcc ? `KA-01-CR-${3000 + i}` : null, isOcc ? new Date().toISOString() : null, `US-${id}`, x, y, 44, 65);
      }
      for (let i = 1; i <= 30; i++) {
        const id = `B${i.toString().padStart(2, '0')}`;
        const isOcc = i % 2 === 0;
        const col = (i - 1) % 15;
        const row = Math.floor((i - 1) / 15);
        const x = 50 + col * 42;
        const y = 320 + row * 55;
        insertSlot.run(id, 'Zone B', 'bike', isOcc ? 'occupied' : 'available', i <= 4 ? 1 : 0, 0, 1, isOcc ? `KA-05-BK-${2000 + i}` : null, isOcc ? new Date().toISOString() : null, `US-${id}`, x, y, 28, 45);
      }
    }

    // Insert history
    db.prepare(`
      INSERT INTO layout_history (from_mode, to_mode, reason, capacity_before, capacity_after)
      VALUES (?, ?, ?, ?, ?)
    `).run(currentState.current_mode, targetMode, reason, preview.current.total, preview.predicted.total);

    // Update layout state
    db.prepare(`
      UPDATE layout_state 
      SET current_mode = ?, capacity_gain_percent = ?, transitioning = 0, transition_progress = 100, last_changed = datetime('now')
      WHERE id = 1
    `).run(targetMode, preview.predicted.capacityGainPercent);
  })();

  broadcast('layout.changed', {
    newMode: targetMode,
    capacityGainPercent: preview.predicted.capacityGainPercent,
    totalSlots: preview.predicted.total,
    timestamp: new Date().toISOString()
  });

  broadcast('lot.state', {
    slots: db.prepare('SELECT * FROM slots').all()
  });

  return { success: true, newMode: targetMode, capacityGainPercent: preview.predicted.capacityGainPercent };
}
