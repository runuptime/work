'use strict';
// In-memory state persisted to a JSON file. BigInts are tagged so they survive the round trip.
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

function emptyState() {
  return { users: {}, sessions: {}, coins: [], trades: {}, comments: {}, seq: 1 };
}

function replacer(_k, v) {
  return typeof v === 'bigint' ? { __b: v.toString() } : v;
}

function reviver(_k, v) {
  return v && typeof v === 'object' && typeof v.__b === 'string' && Object.keys(v).length === 1 ? BigInt(v.__b) : v;
}

function load() {
  fs.mkdirSync(path.join(DATA_DIR, 'images'), { recursive: true });
  try {
    return Object.assign(emptyState(), JSON.parse(fs.readFileSync(DB_FILE, 'utf8'), reviver));
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('db load failed, starting fresh:', e.message);
    return emptyState();
  }
}

let timer = null;
function scheduleSave(state) {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    saveNow(state);
  }, 500);
}

function saveNow(state) {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, replacer));
  fs.renameSync(tmp, DB_FILE);
}

module.exports = { DATA_DIR, load, scheduleSave, saveNow };
