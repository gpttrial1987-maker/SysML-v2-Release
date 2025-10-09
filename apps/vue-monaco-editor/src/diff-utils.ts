export interface DiffOperation {
  start: number;
  end: number;
  replacement: string[];
}

export interface MergeConflict {
  left: DiffOperation;
  right: DiffOperation;
}

export interface MergeResult {
  mergedText: string;
  leftOperations: DiffOperation[];
  rightOperations: DiffOperation[];
  conflicts: MergeConflict[];
}

function splitLines(text: string): string[] {
  if (!text) {
    return [];
  }
  const normalized = text.replace(/\r\n?/g, '\n');
  if (normalized.endsWith('\n')) {
    return normalized.slice(0, -1).split('\n').concat('');
  }
  return normalized.split('\n');
}

function diffOpKey(op: DiffOperation): string {
  return `${op.start}:${op.end}:${op.replacement.join('\u0000')}`;
}

function applyOperations(baseLines: string[], operations: DiffOperation[]): string[] {
  if (!operations.length) {
    return baseLines.slice();
  }
  const sorted = operations
    .filter((op) => op.start >= 0 && op.end >= op.start)
    .sort((a, b) => {
      if (a.start !== b.start) {
        return b.start - a.start;
      }
      return b.end - a.end;
    });

  const result = baseLines.slice();
  for (const op of sorted) {
    const removeCount = op.end - op.start;
    result.splice(op.start, removeCount, ...op.replacement);
  }
  return result;
}

function coalesceOperations(operations: DiffOperation[]): DiffOperation[] {
  const filtered = operations.filter((op) => op.start !== op.end || op.replacement.length > 0);
  if (filtered.length <= 1) {
    return filtered;
  }
  const merged: DiffOperation[] = [];
  let current = filtered[0];
  for (let index = 1; index < filtered.length; index += 1) {
    const next = filtered[index];
    if (current.end === next.start) {
      current = {
        start: current.start,
        end: next.end,
        replacement: current.replacement.concat(next.replacement),
      };
    } else {
      merged.push(current);
      current = next;
    }
  }
  merged.push(current);
  return merged;
}

export function computeDiffOperations(baseText: string, otherText: string): DiffOperation[] {
  const baseLines = splitLines(baseText);
  const otherLines = splitLines(otherText);
  const n = baseLines.length;
  const m = otherLines.length;

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      if (baseLines[i] === otherLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const operations: DiffOperation[] = [];
  let i = 0;
  let j = 0;
  let current: DiffOperation | null = null;

  const flush = () => {
    if (current) {
      if (current.start !== current.end || current.replacement.length > 0) {
        operations.push(current);
      }
      current = null;
    }
  };

  while (i < n || j < m) {
    if (i < n && j < m && baseLines[i] === otherLines[j]) {
      flush();
      i += 1;
      j += 1;
      continue;
    }

    const down = i < n ? dp[i + 1][j] : -1;
    const right = j < m ? dp[i][j + 1] : -1;

    if (j < m && (i === n || right >= down)) {
      if (!current) {
        current = { start: i, end: i, replacement: [] };
      }
      current.replacement.push(otherLines[j]);
      j += 1;
      continue;
    }

    if (i < n) {
      if (!current) {
        current = { start: i, end: i, replacement: [] };
      }
      current.end += 1;
      i += 1;
      continue;
    }

    break;
  }

  flush();

  return coalesceOperations(operations);
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return Math.max(aStart, bStart) < Math.min(aEnd, bEnd);
}

function operationsConflict(left: DiffOperation, right: DiffOperation): boolean {
  const leftEmpty = left.start === left.end;
  const rightEmpty = right.start === right.end;

  if (!leftEmpty && !rightEmpty) {
    return rangesOverlap(left.start, left.end, right.start, right.end);
  }

  if (leftEmpty && rightEmpty) {
    return left.start === right.start;
  }

  if (leftEmpty) {
    return left.start >= right.start && left.start <= right.end;
  }

  return right.start >= left.start && right.start <= left.end;
}

export function detectConflicts(leftOps: DiffOperation[], rightOps: DiffOperation[]): MergeConflict[] {
  const conflicts: MergeConflict[] = [];
  for (const left of leftOps) {
    for (const right of rightOps) {
      if (operationsConflict(left, right)) {
        conflicts.push({ left, right });
      }
    }
  }
  return conflicts;
}

function mergePreferRight(
  baseLines: string[],
  leftOps: DiffOperation[],
  rightOps: DiffOperation[],
  conflicts: MergeConflict[],
): string[] {
  const conflictLeftKeys = new Set(conflicts.map((conflict) => diffOpKey(conflict.left)));
  const operationsMap = new Map<string, DiffOperation>();

  for (const op of rightOps) {
    operationsMap.set(diffOpKey(op), op);
  }

  for (const op of leftOps) {
    const key = diffOpKey(op);
    if (conflictLeftKeys.has(key)) {
      continue;
    }
    if (!operationsMap.has(key)) {
      operationsMap.set(key, op);
    }
  }

  return applyOperations(baseLines, Array.from(operationsMap.values()));
}

export function mergeChanges(baseText: string, leftText: string, rightText: string): MergeResult {
  const baseLines = splitLines(baseText);
  const leftOps = computeDiffOperations(baseText, leftText);
  const rightOps = computeDiffOperations(baseText, rightText);
  const conflicts = detectConflicts(leftOps, rightOps);
  const mergedLines = mergePreferRight(baseLines, leftOps, rightOps, conflicts);

  return {
    mergedText: mergedLines.join('\n'),
    leftOperations: leftOps,
    rightOperations: rightOps,
    conflicts,
  };
}

export function formatLineRange(start: number, end: number): string {
  const first = start + 1;
  const last = Math.max(end, start + 1);
  if (first === last) {
    return `line ${first}`;
  }
  return `lines ${first}-${last}`;
}
