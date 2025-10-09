import { describe, expect, it } from 'vitest';
import { parseVersionsLock } from '../scripts/validate-versions-lock.mjs';

describe('parseVersionsLock', () => {
  it('extracts version pins and optional fork overrides', () => {
    const contents = [
      '# comment',
      'SysML-v2-Release: 2025-07',
      'SysML-v2-API-Services: 2025-07',
      'SysML-v2-API-Services@fork=example/fork@abcdef',
    ].join('\n');

    const { versions, forks } = parseVersionsLock(contents);

    expect(versions.get('SysML-v2-Release')).toBe('2025-07');
    expect(versions.get('SysML-v2-API-Services')).toBe('2025-07');
    expect(forks.get('SysML-v2-API-Services')).toBe('example/fork@abcdef');
  });

  it('rejects malformed entries', () => {
    const malformed = 'not a valid line';

    expect(() => parseVersionsLock(malformed)).toThrowError(/Unrecognized line/);
  });
});
