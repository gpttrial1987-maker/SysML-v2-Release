import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(new URL(import.meta.url)));
const lockPath = resolve(__dirname, '..', 'versions.lock');

const BLESSED_FORKS = new Map([
  ['SysML-v2-Release', new Set(['Systems-Modeling/SysML-v2-Release'])],
  ['SysML-v2-API-Services', new Set(['Systems-Modeling/SysML-v2-API-Services'])],
  ['SysML-v2-Pilot-Implementation', new Set(['Systems-Modeling/SysML-v2-Pilot-Implementation'])],
]);

const modeArg = process.argv.find((arg) => arg.startsWith('--mode='));
const modeFromArg = modeArg ? modeArg.split('=')[1] : undefined;
const isProduction =
  (modeFromArg && modeFromArg.toLowerCase() === 'production') ||
  process.env.NODE_ENV === 'production';

const lockContents = readFileSync(lockPath, 'utf8');
const { versions, forks } = parseVersionsLock(lockContents);

if (isProduction) {
  enforceBlessedForks(forks);
}

if (process.argv.includes('--json')) {
  const summary = {
    versions: Object.fromEntries(versions),
    forks: Object.fromEntries(forks),
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

function parseVersionsLock(contents) {
  const versions = new Map();
  const forks = new Map();

  const lines = contents.split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    if (line.includes(':')) {
      const [name, version] = line.split(':');
      if (!name || !version) {
        throw new Error(formatParseError('Expected `name: version` pair', index + 1, rawLine));
      }
      const key = name.trim();
      const value = version.trim();
      if (!key || !value) {
        throw new Error(formatParseError('Component name or version is empty', index + 1, rawLine));
      }
      if (versions.has(key)) {
        throw new Error(formatParseError(`Duplicate component entry for ${key}`, index + 1, rawLine));
      }
      versions.set(key, value);
      continue;
    }

    if (line.includes('@fork=')) {
      const [component, override] = line.split('@fork=');
      const name = component.trim();
      const forkValue = override.trim();
      if (!name || !forkValue) {
        throw new Error(formatParseError('Fork override must include a component and value', index + 1, rawLine));
      }
      if (forks.has(name)) {
        throw new Error(formatParseError(`Duplicate fork override for ${name}`, index + 1, rawLine));
      }
      forks.set(name, forkValue);
      continue;
    }

    throw new Error(formatParseError('Unrecognized line', index + 1, rawLine));
  }

  return { versions, forks };
}

function enforceBlessedForks(forks) {
  const violations = [];

  for (const [component, forkValue] of forks.entries()) {
    const [repoId] = forkValue.split('@');
    const blessedSet = BLESSED_FORKS.get(component);
    if (!blessedSet || !blessedSet.has(repoId)) {
      violations.push({ component, forkValue });
    }
  }

  if (violations.length > 0) {
    const formatted = violations
      .map(({ component, forkValue }) => ` - ${component}@fork=${forkValue}`)
      .join('\n');
    const error = [
      'Production builds must use blessed forks defined in scripts/validate-versions-lock.mjs.',
      'The following overrides are not allowed:',
      formatted,
    ].join('\n');
    throw new Error(error);
  }
}

function formatParseError(message, lineNumber, rawLine) {
  return `${message} at line ${lineNumber}: ${rawLine.trim()}`;
}

export { parseVersionsLock };
