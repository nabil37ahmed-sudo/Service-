// Minimal .env loader (no external dependencies).
// Reads KEY=VALUE lines from a .env file in the project root, if present,
// and copies them into process.env without overwriting anything already set.

const fs = require('fs');
const path = require('path');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;

  const contents = fs.readFileSync(envPath, 'utf8');
  contents.split('\n').forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) return;

    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) return;

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  });
}

module.exports = { loadEnv };
