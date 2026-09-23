// Simple file-backed JSON store. No native/compiled database dependency,
// so this runs on any host that has Node.js — shared hosting, a small VPS,
// Render, Railway, etc. Fine for a small-to-mid security company's volume
// of attendance rows. If you outgrow it, swap this file for a real
// database (Postgres/MySQL) behind the same load()/save() interface.

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'db.json');

function ensureFile() {
  if (!fs.existsSync(path.dirname(DB_PATH))) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ users: [], attendance: [] }, null, 2));
  }
}

function load() {
  ensureFile();
  const raw = fs.readFileSync(DB_PATH, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    // Corrupt file — back it up and start fresh rather than crash the server.
    fs.copyFileSync(DB_PATH, DB_PATH + '.bak-' + Date.now());
    return { users: [], attendance: [] };
  }
}

let writeQueue = Promise.resolve();
function save(db) {
  // Serialize writes so two near-simultaneous submissions can't clobber each other.
  writeQueue = writeQueue.then(() => {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  });
  return writeQueue;
}

function nextId(items) {
  return items.reduce((max, i) => Math.max(max, i.id || 0), 0) + 1;
}

module.exports = { load, save, nextId };
