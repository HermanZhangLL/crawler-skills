import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let map = {};
let keys = [];
let mapReady = false;
try {
  map = JSON.parse(fs.readFileSync(path.join(__dirname, 't2s-map.json'), 'utf8'));
  keys = Object.keys(map).sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  mapReady = keys.length > 0;
} catch (err) {
  console.warn('[t2s] t2s-map.json could not be loaded; field-map display keeps source text unchanged.', err.message);
}

export function toSimplified(value) {
  if (typeof value === 'string') {
    if (!mapReady) return value;
    let out = '';
    for (let i = 0; i < value.length;) {
      let matched = false;
      for (const key of keys) {
        if (value.startsWith(key, i)) {
          out += map[key];
          i += key.length;
          matched = true;
          break;
        }
      }
      if (!matched) {
        out += value[i];
        i += 1;
      }
    }
    return out;
  }
  if (Array.isArray(value)) return value.map(toSimplified);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) out[key] = toSimplified(value[key]);
    return out;
  }
  return value;
}
