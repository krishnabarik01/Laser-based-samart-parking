import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'smartpark.db');
export const db = new Database(dbPath);

// Enable WAL mode for high concurrency
db.pragma('journal_mode = WAL');

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'operator', 'viewer')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS slots (
      id TEXT PRIMARY KEY,
      zone TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('car', 'bike')),
      status TEXT NOT NULL CHECK(status IN ('available', 'occupied', 'blocked')),
      is_ev INTEGER DEFAULT 0,
      is_accessible INTEGER DEFAULT 0,
      is_adaptive INTEGER DEFAULT 0,
      current_vehicle TEXT,
      occupied_since DATETIME,
      sensor_id TEXT,
      x REAL NOT NULL,
      y REAL NOT NULL,
      w REAL NOT NULL,
      h REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_number TEXT NOT NULL,
      vehicle_type TEXT NOT NULL,
      slot_id TEXT NOT NULL,
      entry_time DATETIME NOT NULL,
      exit_time DATETIME,
      duration_minutes INTEGER DEFAULT 0,
      fee REAL DEFAULT 0.0,
      status TEXT NOT NULL CHECK(status IN ('active', 'completed'))
    );

    CREATE TABLE IF NOT EXISTS lasers (
      id TEXT PRIMARY KEY,
      zone TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('online', 'standby', 'active', 'fault')),
      intensity INTEGER DEFAULT 80,
      pulse_mode INTEGER DEFAULT 0,
      mode TEXT DEFAULT 'guidance' CHECK(mode IN ('guidance', 'calibration', 'test', 'disabled')),
      target_slot TEXT,
      last_ping DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      zone TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('online', 'offline', 'faulty')),
      battery INTEGER DEFAULT 100,
      signal_strength INTEGER DEFAULT -65,
      last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
      firmware_version TEXT DEFAULT 'v2.4.1'
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      severity TEXT NOT NULL CHECK(severity IN ('critical', 'warning', 'info')),
      source TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active', 'acknowledged', 'resolved')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS layout_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      current_mode TEXT DEFAULT 'balanced',
      demand_ratio_bike INTEGER DEFAULT 65,
      capacity_gain_percent INTEGER DEFAULT 45,
      transitioning INTEGER DEFAULT 0,
      transition_progress INTEGER DEFAULT 100,
      last_changed DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS layout_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_mode TEXT NOT NULL,
      to_mode TEXT NOT NULL,
      reason TEXT NOT NULL,
      capacity_before INTEGER NOT NULL,
      capacity_after INTEGER NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS layout_schedule (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      days TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      mode TEXT NOT NULL,
      enabled INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS guidance_rules (
      rule_key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      zone TEXT DEFAULT 'All Zones'
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS event_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed default users if empty
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount === 0) {
    const salt = bcrypt.genSaltSync(10);
    const hash = (pwd) => bcrypt.hashSync(pwd, salt);

    const insertUser = db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)');
    insertUser.run('Admin Operator', 'admin@smartpark.ai', hash('admin123'), 'admin');
    insertUser.run('Shift Operator', 'operator@smartpark.ai', hash('operator123'), 'operator');
    insertUser.run('Field Viewer', 'viewer@smartpark.ai', hash('viewer123'), 'viewer');
  }

  // Seed layout state
  const layoutState = db.prepare('SELECT COUNT(*) as count FROM layout_state').get().count;
  if (layoutState === 0) {
    db.prepare('INSERT INTO layout_state (id, current_mode, demand_ratio_bike, capacity_gain_percent, transitioning, transition_progress) VALUES (1, ?, ?, ?, 0, 100)')
      .run('balanced', 65, 45);

    db.prepare(`
      INSERT INTO layout_schedule (days, start_time, end_time, mode, enabled) VALUES 
      ('Mon, Tue, Wed, Thu, Fri', '08:00', '11:30', '2w-peak', 1),
      ('Sat, Sun', '16:00', '22:00', 'car-peak', 1),
      ('Mon, Tue, Wed, Thu, Fri', '12:00', '16:00', 'balanced', 1)
    `).run();

    db.prepare(`
      INSERT INTO layout_history (from_mode, to_mode, reason, capacity_before, capacity_after, timestamp) VALUES
      ('car-peak', 'balanced', 'AI Influx Engine shift', 72, 98, datetime('now', '-2 hours')),
      ('balanced', '2w-peak', 'Morning Commute Influx', 98, 128, datetime('now', '-5 hours')),
      ('2w-peak', 'balanced', 'Automated Daily Schedule', 128, 98, datetime('now', '-1 day'))
    `).run();
  }

  // Seed guidance rules
  const rulesCount = db.prepare('SELECT COUNT(*) as count FROM guidance_rules').get().count;
  if (rulesCount === 0) {
    const insertRule = db.prepare('INSERT INTO guidance_rules (rule_key, name, enabled, zone) VALUES (?, ?, ?, ?)');
    insertRule.run('ev_priority', 'EV Priority Charging Guidance', 1, 'Zone A');
    insertRule.run('accessible', 'Accessibility (Divyangjan) Priority', 1, 'Zone A');
    insertRule.run('no_entry', 'Dynamic No-Entry Hazard Barrier', 0, 'Zone B');
    insertRule.run('priority_corridors', 'Emergency Clear Corridor', 1, 'All Zones');
  }

  // Seed settings
  const settingsCount = db.prepare('SELECT COUNT(*) as count FROM settings').get().count;
  if (settingsCount === 0) {
    const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    insertSetting.run('lot_name', 'SmartPark AI — North Terminal Lot 01');
    insertSetting.run('car_rate_hourly', '40');
    insertSetting.run('bike_rate_hourly', '15');
    insertSetting.run('free_minutes', '15');
    insertSetting.run('simulator_enabled', 'true');
    insertSetting.run('simulator_interval_sec', '4');
    insertSetting.run('api_key', 'smartpark-sensor-key-2026');
  }

  // Seed Slots (120 slots across 3 zones)
  const slotCount = db.prepare('SELECT COUNT(*) as count FROM slots').get().count;
  if (slotCount === 0) {
    seedSlots();
  }

  // Seed Lasers & Devices if empty
  const laserCount = db.prepare('SELECT COUNT(*) as count FROM lasers').get().count;
  if (laserCount === 0) {
    seedLasersAndDevices();
  }

  // Seed Alerts if empty
  const alertCount = db.prepare('SELECT COUNT(*) as count FROM alerts').get().count;
  if (alertCount === 0) {
    seedAlerts();
  }

  // Seed Sessions & History
  const sessionCount = db.prepare('SELECT COUNT(*) as count FROM sessions').get().count;
  if (sessionCount === 0) {
    seedSessions();
  }
}

function seedSlots() {
  const insertSlot = db.prepare(`
    INSERT INTO slots (id, zone, type, status, is_ev, is_accessible, is_adaptive, current_vehicle, occupied_since, sensor_id, x, y, w, h)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const vehicles = ['KA-01-AB-1234', 'MH-12-PQ-9081', 'DL-04-CK-5521', 'HR-26-EE-9912', 'TN-07-BB-4102', 'TS-09-FA-8811', 'UP-16-DD-3312'];

  db.transaction(() => {
    // ZONE A: Fixed Car & EV Bays (A01 - A30)
    for (let i = 1; i <= 30; i++) {
      const id = `A${i.toString().padStart(2, '0')}`;
      const isEv = i <= 6 ? 1 : 0;
      const isAcc = i === 7 || i === 8 ? 1 : 0;
      const isOcc = i % 3 === 0;
      const veh = isOcc ? vehicles[i % vehicles.length] : null;
      const occTime = isOcc ? new Date(Date.now() - (i * 12 * 60000)).toISOString() : null;
      
      const col = (i - 1) % 15;
      const row = Math.floor((i - 1) / 15);
      const x = 50 + col * 42;
      const y = 60 + row * 80;

      insertSlot.run(id, 'Zone A', 'car', isOcc ? 'occupied' : 'available', isEv, isAcc, 0, veh, occTime, `US-${id}`, x, y, 36, 60);
    }

    // ZONE B: Bharat Adaptive Canvas (B01 - B60)
    for (let i = 1; i <= 60; i++) {
      const id = `B${i.toString().padStart(2, '0')}`;
      const isOcc = i % 2 === 0;
      const veh = isOcc ? `KA-05-BK-${1000 + i}` : null;
      const occTime = isOcc ? new Date(Date.now() - (i * 7 * 60000)).toISOString() : null;

      const col = (i - 1) % 20;
      const row = Math.floor((i - 1) / 20);
      const x = 50 + col * 32;
      const y = 240 + row * 60;

      insertSlot.run(id, 'Zone B', 'bike', isOcc ? 'occupied' : 'available', i <= 8 ? 1 : 0, 0, 1, veh, occTime, `US-${id}`, x, y, 26, 45);
    }

    // ZONE C: Standard Car & Commercial Bays (C01 - C30)
    for (let i = 1; i <= 30; i++) {
      const id = `C${i.toString().padStart(2, '0')}`;
      const isOcc = (i + 1) % 4 === 0;
      const veh = isOcc ? `DL-03-CR-${2000 + i}` : null;
      const occTime = isOcc ? new Date(Date.now() - (i * 15 * 60000)).toISOString() : null;

      const col = (i - 1) % 15;
      const row = Math.floor((i - 1) / 15);
      const x = 50 + col * 42;
      const y = 430 + row * 80;

      insertSlot.run(id, 'Zone C', 'car', isOcc ? 'occupied' : 'available', 0, i === 1 ? 1 : 0, 0, veh, occTime, `US-${id}`, x, y, 36, 60);
    }
  })();
}

function seedLasersAndDevices() {
  const insertLaser = db.prepare("INSERT INTO lasers (id, zone, status, intensity, pulse_mode, mode, target_slot, last_ping) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))");
  const insertDevice = db.prepare("INSERT INTO devices (id, type, zone, status, battery, signal_strength, last_seen, firmware_version) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)");

  db.transaction(() => {
    // 8 Laser Units
    for (let i = 1; i <= 8; i++) {
      const id = `LZ-0${i}`;
      const zone = i <= 2 ? 'Zone A' : i <= 6 ? 'Zone B' : 'Zone C';
      const status = i === 5 ? 'fault' : i % 2 === 0 ? 'active' : 'online';
      insertLaser.run(id, zone, status, 85, 0, 'guidance', i % 2 === 0 ? `B0${i}` : null);
      insertDevice.run(id, 'galvo_projector', zone, status === 'fault' ? 'faulty' : 'online', 100, -58, 'v2.4.1');
    }

    // Microcontrollers (ESP32)
    insertDevice.run('ESP32-CORE-ZA', 'mcu', 'Zone A', 'online', 100, -52, 'v2.4.1');
    insertDevice.run('ESP32-CORE-ZB', 'mcu', 'Zone B', 'online', 100, -48, 'v2.4.1');
    insertDevice.run('ESP32-CORE-ZC', 'mcu', 'Zone C', 'online', 100, -56, 'v2.4.1');
    insertDevice.run('ESP32-GATE-IN', 'mcu', 'Perimeter', 'online', 100, -45, 'v2.4.1');
    insertDevice.run('ESP32-GATE-OUT', 'mcu', 'Perimeter', 'online', 100, -50, 'v2.4.1');

    // Sample Sensors
    for (let i = 1; i <= 35; i++) {
      const id = `US-A${i.toString().padStart(2, '0')}`;
      const status = i === 14 ? 'offline' : i === 22 ? 'faulty' : 'online';
      insertDevice.run(id, 'ultrasonic', 'Zone A', status, 92 - (i % 20), -62 - (i % 15), 'v1.8.0');
    }
  })();
}

function seedAlerts() {
  const insertAlert = db.prepare("INSERT INTO alerts (severity, source, message, status, created_at) VALUES (?, ?, ?, ?, datetime('now', ?))");
  insertAlert.run('critical', 'LZ-05', 'Galvo mirror deflection error: Motor stalled on X-axis', 'active', '-12 minutes');
  insertAlert.run('warning', 'US-A14', 'Ultrasonic sensor no heartbeat signal for >15 mins', 'active', '-28 minutes');
  insertAlert.run('warning', 'Lot Capacity', 'Zone B Two-Wheeler occupancy surpassed 85%', 'active', '-45 minutes');
  insertAlert.run('info', 'AI Demand Engine', 'Auto AI calculated demand shift: +18% 2W influx', 'acknowledged', '-1 hour');
  insertAlert.run('info', 'ESP32-GATE-IN', 'FASTag boom barrier cycle count verified: 1,420 cycles', 'resolved', '-3 hours');
}

function seedSessions() {
  const insertSession = db.prepare(`
    INSERT INTO sessions (vehicle_number, vehicle_type, slot_id, entry_time, exit_time, duration_minutes, fee, status)
    VALUES (?, ?, ?, datetime('now', ?), datetime('now', ?), ?, ?, ?)
  `);

  const types = ['car', 'bike'];
  for (let i = 1; i <= 40; i++) {
    const isCar = i % 2 === 0;
    const vType = isCar ? 'car' : 'bike';
    const vNum = isCar ? `KA-02-MN-${1000 + i}` : `KA-05-BK-${2000 + i}`;
    const slot = isCar ? `A${(i % 25 + 1).toString().padStart(2, '0')}` : `B${(i % 50 + 1).toString().padStart(2, '0')}`;
    const mins = 35 + (i * 12);
    const fee = isCar ? Math.ceil((mins / 60) * 40) : Math.ceil((mins / 60) * 15);

    insertSession.run(
      vNum,
      vType,
      slot,
      `-${mins + 30} minutes`,
      `-${30} minutes`,
      mins,
      fee,
      'completed'
    );
  }
}
