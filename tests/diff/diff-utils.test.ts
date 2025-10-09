import { describe, expect, test } from 'vitest';

import {
  computeDiffOperations,
  detectConflicts,
  formatLineRange,
  mergeChanges,
  type DiffOperation,
} from '../../apps/vue-monaco-editor/src/diff-utils';

function toText(lines: string[]): string {
  return lines.join('\n');
}

describe('diff utilities', () => {
  test('computes diff operations for insertions and replacements', () => {
    const base = toText(['alpha', 'beta', 'gamma']);
    const modified = toText(['alpha', 'beta', 'gamma', 'delta']);
    const replacement = toText(['alpha', 'BETA', 'gamma']);

    const insertOps = computeDiffOperations(base, modified);
    expect(insertOps).toHaveLength(1);
    expect(insertOps[0]).toEqual({ start: 3, end: 3, replacement: ['delta'] });

    const replaceOps = computeDiffOperations(base, replacement);
    expect(replaceOps).toHaveLength(1);
    expect(replaceOps[0]).toEqual({ start: 1, end: 2, replacement: ['BETA'] });
  });

  test('detects conflicting operations', () => {
    const base = toText(['a', 'b', 'c']);
    const leftOps: DiffOperation[] = [{ start: 1, end: 2, replacement: ['B'] }];
    const rightOps: DiffOperation[] = [{ start: 1, end: 2, replacement: ['beta'] }];

    const conflicts = detectConflicts(leftOps, rightOps);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toEqual({ left: leftOps[0], right: rightOps[0] });
  });

  test('detects conflicts for competing insertions', () => {
    const leftOps: DiffOperation[] = [{ start: 1, end: 1, replacement: ['left'] }];
    const rightOps: DiffOperation[] = [{ start: 1, end: 1, replacement: ['right'] }];

    const conflicts = detectConflicts(leftOps, rightOps);
    expect(conflicts).toHaveLength(1);
  });

  test('merges non-conflicting changes from both sides', () => {
    const base = toText(['a', 'b', 'c']);
    const left = toText(['a', 'B', 'c']);
    const right = toText(['a', 'b', 'c', 'd']);

    const result = mergeChanges(base, left, right);
    expect(result.conflicts).toHaveLength(0);
    expect(result.mergedText).toBe(toText(['a', 'B', 'c', 'd']));
  });

  test('prefers right side when conflicts occur', () => {
    const base = toText(['a', 'b', 'c']);
    const left = toText(['a', 'B', 'c']);
    const right = toText(['a', 'beta', 'c']);

    const result = mergeChanges(base, left, right);
    expect(result.conflicts).toHaveLength(1);
    expect(result.mergedText).toBe(right);
  });

  test('formats line ranges for summaries', () => {
    expect(formatLineRange(0, 1)).toBe('line 1');
    expect(formatLineRange(2, 5)).toBe('lines 3-5');
  });
});
