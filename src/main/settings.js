'use strict';

// Tiny JSON settings store kept in the user's AppData folder.
const fs = require('fs');
const path = require('path');

let file = null;
let data = {};
let timer = null;

function init(dir) {
  file = path.join(dir, 'settings.json');
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    data = {};
  }
}

function get(key, def) {
  return key in data ? data[key] : def;
}

function set(key, value) {
  data[key] = value;
  clearTimeout(timer);
  timer = setTimeout(flush, 300);
  return true;
}

function flush() {
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch {
    // Settings are a convenience; failing to persist them must not break the app.
  }
}

module.exports = { init, get, set, flush };
