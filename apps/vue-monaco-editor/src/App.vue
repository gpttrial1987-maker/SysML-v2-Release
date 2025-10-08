<template>
  <div class="app-shell">
    <header class="app-header">
      <h1>SysML v2 Monaco Editor</h1>
      <div class="spacer" />
      <div class="control-group">
        <label for="validation-endpoint">Validation endpoint</label>
        <input
          id="validation-endpoint"
          v-model="validationEndpoint"
          type="url"
          placeholder="https://api.example.com/validation"
          spellcheck="false"
        />
        <button type="button" @click="triggerValidation" :disabled="isValidating">
          {{ isValidating ? 'Validating…' : 'Validate now' }}
        </button>
      </div>
    </header>

    <main class="main-content">
      <section class="editor-container">
        <div ref="monacoRoot" class="monaco-container" />
      </section>
      <aside class="sidebar">
        <section>
          <div class="status-pill" :class="status">
            <span class="dot">●</span>
            <span>{{ statusMessage }}</span>
          </div>
          <p v-if="lastValidated" class="last-run">Last checked {{ lastValidated }}</p>
        </section>
        <section>
          <h2>Diagnostics</h2>
          <ul v-if="diagnostics.length" class="validation-list">
            <li v-for="(issue, index) in diagnostics" :key="index" class="validation-item">
              <h3>{{ severityLabel(issue.severity) }}</h3>
              <p>{{ issue.message }}</p>
              <span class="range">
                Lines {{ issue.range.startLineNumber }}:{{ issue.range.startColumn }}
                –
                {{ issue.range.endLineNumber }}:{{ issue.range.endColumn }}
              </span>
              <div v-if="issue.elementId" class="range">Element ID · {{ issue.elementId }}</div>
              <div class="quick-fix-badges">
                <span v-for="(fix, idx) in badgeFixes(issue)" :key="idx">{{ fix }}</span>
              </div>
            </li>
          </ul>
          <p v-else>No diagnostics reported.</p>
        </section>
      </aside>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import loader from '@monaco-editor/loader';

import type * as Monaco from 'monaco-editor';

type MonacoApi = typeof import('monaco-editor');

type ValidationState = 'idle' | 'running' | 'success' | 'error' | 'info';

type IssueSeverity = 'error' | 'warning' | 'info';

interface NormalizedRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

interface NormalizedFix {
  title: string;
  replacementText?: string;
  range?: NormalizedRange;
}

interface NormalizedIssue {
  message: string;
  severity: IssueSeverity;
  range: NormalizedRange;
  quickFixes: NormalizedFix[];
  elementId?: string;
}

const defaultModel = `package Example::DriveUnit {
  part controller : Controller { id = ctrl_controller; }
  part motor : Motor { id = motor_primary; }

  interface Controller {
    id = ctrl_controller;
    attribute torqueCommand : Real;
    attribute desiredSpeed : Real;
  }

  interface Motor {
    id = motor_primary;
    attribute actualSpeed : Real;
  }

  requirement MaintainSpeed {
    id = req_speed_limit;
    constraint actualSpeed <= desiredSpeed;
  }
}`;

const status = ref<ValidationState>('idle');
const statusMessage = ref('Waiting for validation.');
const diagnostics = ref<NormalizedIssue[]>([]);
const lastValidatedAt = ref<Date | null>(null);

const validationEndpoint = ref(
  import.meta.env.VITE_VALIDATION_URL ?? 'http://localhost:9000/api/validation',
);

const monacoRoot = ref<HTMLDivElement | null>(null);
const editorRef = shallowRef<Monaco.editor.IStandaloneCodeEditor | null>(null);

const isValidating = computed(() => status.value === 'running');
const lastValidated = computed(() =>
  lastValidatedAt.value ? lastValidatedAt.value.toLocaleTimeString() : '',
);

let monacoApi: MonacoApi | null = null;
let validationTimer: ReturnType<typeof setTimeout> | undefined;
let modelDisposables: Monaco.IDisposable[] = [];
let quickFixCommandId: string | null = null;
let currentDiagnostics: NormalizedIssue[] = [];
let idIndex = new Map<string, NormalizedRange>();

onMounted(async () => {
  loader.config({
    paths: {
      vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.47.0/min/vs',
    },
  });

  monacoApi = await loader.init();
  const monaco = monacoApi;

  registerSysmlLanguage(monaco);

  await nextTick();
  if (!monacoRoot.value) {
    return;
  }

  const editor = monaco.editor.create(monacoRoot.value, {
    automaticLayout: true,
    language: 'sysml',
    theme: 'vs-dark',
    value: defaultModel,
    fontFamily: 'JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
    fontSize: 14,
    minimap: { enabled: true },
    wordWrap: 'on',
    smoothScrolling: true,
  });
  editorRef.value = editor;

  const model = editor.getModel();
  if (!model) {
    return;
  }

  quickFixCommandId = editor.addCommand(0, (_, label: string, detail: string) => {
    status.value = 'info';
    statusMessage.value = `Quick fix placeholder for "${label}"`;
  });

  modelDisposables.push(
    model.onDidChangeContent(() => {
      updateIdIndex(model.getValue());
      scheduleValidation();
    }),
  );

  registerLanguageProviders(monaco);

  updateIdIndex(model.getValue());
  scheduleValidation(true);
});

onBeforeUnmount(() => {
  if (validationTimer) {
    clearTimeout(validationTimer);
  }
  for (const disposable of modelDisposables) {
    disposable.dispose();
  }
  modelDisposables = [];
  const editor = editorRef.value;
  if (editor) {
    const model = editor.getModel();
    if (model && monacoApi) {
      monacoApi.editor.setModelMarkers(model, 'sysml-validation', []);
    }
    editor.dispose();
    editorRef.value = null;
  }
});

function scheduleValidation(immediate = false) {
  if (!editorRef.value) {
    return;
  }

  if (validationTimer) {
    clearTimeout(validationTimer);
  }

  const run = () => {
    const content = editorRef.value?.getValue() ?? '';
    runValidation(content).catch((error) => {
      console.error('Validation error', error);
    });
  };

  if (immediate) {
    run();
  } else {
    validationTimer = setTimeout(run, 600);
  }
}

async function runValidation(content: string) {
  if (!monacoApi || !editorRef.value) {
    return;
  }

  if (!validationEndpoint.value) {
    status.value = 'error';
    statusMessage.value = 'Validation endpoint URL is required.';
    clearMarkers();
    diagnostics.value = [];
    currentDiagnostics = [];
    return;
  }

  status.value = 'running';
  statusMessage.value = 'Sending model to validation service…';

  try {
    const response = await fetch(validationEndpoint.value, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    });

    if (!response.ok) {
      throw new Error(`Validation request failed with status ${response.status}`);
    }

    const payload = await safeJson(response);
    const parsed = normalizeIssues(payload);
    currentDiagnostics = parsed;
    diagnostics.value = parsed;
    applyMarkers(parsed);

    lastValidatedAt.value = new Date();
    if (parsed.length === 0) {
      status.value = 'success';
      statusMessage.value = 'No diagnostics returned by the service.';
    } else {
      status.value = 'info';
      statusMessage.value = `${parsed.length} diagnostic${parsed.length === 1 ? '' : 's'} reported.`;
    }
  } catch (error) {
    currentDiagnostics = [];
    diagnostics.value = [];
    clearMarkers();
    status.value = 'error';
    statusMessage.value = error instanceof Error ? error.message : 'Validation failed.';
  }
}

async function safeJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    console.warn('Validation response was not JSON', error);
    return null;
  }
}

function applyMarkers(issues: NormalizedIssue[]) {
  if (!monacoApi || !editorRef.value) {
    return;
  }
  const model = editorRef.value.getModel();
  if (!model) {
    return;
  }

  const markers = issues.map((issue) => ({
    severity: toMarkerSeverity(monacoApi!, issue.severity),
    message: issue.message,
    startLineNumber: issue.range.startLineNumber,
    startColumn: issue.range.startColumn,
    endLineNumber: issue.range.endLineNumber,
    endColumn: issue.range.endColumn,
    tags: issue.quickFixes.length ? [monacoApi!.MarkerTag.Unnecessary] : undefined,
    relatedInformation: issue.elementId
      ? [
          {
            resource: model.uri,
            message: `Element ${issue.elementId}`,
            startLineNumber: issue.range.startLineNumber,
            startColumn: issue.range.startColumn,
            endLineNumber: issue.range.endLineNumber,
            endColumn: issue.range.endColumn,
          },
        ]
      : undefined,
  }));

  monacoApi.editor.setModelMarkers(model, 'sysml-validation', markers);
}

function clearMarkers() {
  if (!monacoApi || !editorRef.value) {
    return;
  }
  const model = editorRef.value.getModel();
  if (model) {
    monacoApi.editor.setModelMarkers(model, 'sysml-validation', []);
  }
}

function registerSysmlLanguage(monaco: MonacoApi) {
  monaco.languages.register({ id: 'sysml' });
  monaco.languages.setLanguageConfiguration('sysml', {
    comments: {
      lineComment: '--',
      blockComment: ['/*', '*/'],
    },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"', notIn: ['string'] },
      { open: "'", close: "'", notIn: ['string'] },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '"', close: '"' },
      { open: '(', close: ')' },
    ],
  });

  monaco.languages.setMonarchTokensProvider('sysml', {
    keywords: [
      'package',
      'import',
      'part',
      'interface',
      'requirement',
      'constraint',
      'state',
      'transition',
      'action',
      'attribute',
      'behavior',
      'subject',
      'view',
      'viewpoint',
      'usage',
      'occurrence',
      'end',
    ],
    operators: ['=', '::', ':', ';'],
    symbols: /[=><!~?:&|+\-*\/%^]+/,
    tokenizer: {
      root: [
        [/[a-zA-Z_][\w\-]*/, {
          cases: {
            '@keywords': 'keyword',
            '@default': 'identifier',
          },
        }],
        { include: '@whitespace' },
        [/[{}()[\]]/, '@brackets'],
        [/\d+(\.\d+)?/, 'number'],
        [/"([^"\\]|\\.)*"/, 'string'],
        [/\-\-.*$/, 'comment'],
      ],
      whitespace: [[/[\s]+/, 'white']],
    },
  });
}

function registerLanguageProviders(monaco: MonacoApi) {
  modelDisposables.push(
    monaco.languages.registerCodeActionProvider('sysml', {
      provideCodeActions(model, range, context) {
        const actions: Monaco.languages.CodeAction[] = [];
        for (const issue of currentDiagnostics) {
          const issueRange = toMonacoRange(issue.range, monaco);
          if (!monaco.Range.areIntersecting(issueRange, range)) {
            continue;
          }

          const markers = context.markers
            .filter((marker) =>
              monaco.Range.areIntersecting(
                issueRange,
                new monaco.Range(
                  marker.startLineNumber,
                  marker.startColumn,
                  marker.endLineNumber,
                  marker.endColumn,
                ),
              ),
            )
            .map((marker) => ({ ...marker }));

          const fixes = issue.quickFixes.length
            ? issue.quickFixes
            : [
                {
                  title: 'Review issue in validation service',
                },
              ];

          for (let idx = 0; idx < fixes.length; idx += 1) {
            const fix = fixes[idx];
            const editRange = toMonacoRange(fix.range ?? issue.range, monaco);
            const edit =
              typeof fix.replacementText === 'string'
                ? {
                    edits: [
                      {
                        resource: model.uri,
                        edit: {
                          range: editRange,
                          text: fix.replacementText,
                        },
                      },
                    ],
                  }
                : undefined;

            actions.push({
              title: fix.title,
              kind: monaco.languages.CodeActionKind.QuickFix,
              diagnostics: markers,
              edit,
              command:
                !edit && quickFixCommandId
                  ? {
                      id: quickFixCommandId,
                      title: fix.title,
                      arguments: [fix.title, issue.message],
                    }
                  : undefined,
              isPreferred: idx === 0,
            });
          }
        }

        return {
          actions,
          dispose: () => undefined,
        };
      },
      providedCodeActionKinds: [monaco.languages.CodeActionKind.QuickFix],
    }),
  );

  modelDisposables.push(
    monaco.languages.registerDefinitionProvider('sysml', {
      provideDefinition(model, position) {
        const word = model.getWordAtPosition(position);
        if (!word) {
          return null;
        }
        const range = idIndex.get(word.word);
        if (!range) {
          return null;
        }
        return {
          uri: model.uri,
          range: toMonacoRange(range, monaco),
        };
      },
    }),
  );

  modelDisposables.push(
    monaco.languages.registerHoverProvider('sysml', {
      provideHover(model, position) {
        const word = model.getWordAtPosition(position);
        if (!word) {
          return null;
        }
        const range = idIndex.get(word.word);
        if (!range) {
          return null;
        }
        const related = currentDiagnostics.filter((issue) => issue.elementId === word.word);
        const lines: Monaco.IMarkdownString[] = [
          { value: `**Element ID**\\n\\n\`${word.word}\`` },
        ];
        if (related.length) {
          lines.push({
            value: related
              .map((issue) => `• ${issue.message}`)
              .join('\n'),
          });
        }
        return {
          range: toMonacoRange(range, monaco),
          contents: lines,
        };
      },
    }),
  );
}

function toMonacoRange(range: NormalizedRange, monaco: MonacoApi) {
  return new monaco.Range(
    range.startLineNumber,
    range.startColumn,
    range.endLineNumber,
    range.endColumn,
  );
}

function updateIdIndex(content: string) {
  const pattern = /\b(?:id|elementId)\s*[:=]\s*("?)([A-Za-z_][\w.\-]*)\1/g;
  const lines = content.split(/\r?\n/);
  const nextIndex = new Map<string, NormalizedRange>();

  for (let lineNo = 0; lineNo < lines.length; lineNo += 1) {
    const line = lines[lineNo];
    let match: RegExpExecArray | null;
    // eslint-disable-next-line no-cond-assign
    while ((match = pattern.exec(line)) !== null) {
      const identifier = match[2];
      const offset = match.index + match[0].indexOf(identifier);
      const startColumn = offset + 1;
      nextIndex.set(identifier, {
        startLineNumber: lineNo + 1,
        startColumn,
        endLineNumber: lineNo + 1,
        endColumn: startColumn + identifier.length,
      });
    }
  }

  idIndex = nextIndex;
}

function normalizeIssues(payload: unknown): NormalizedIssue[] {
  const list = extractIssueList(payload);
  const normalized: NormalizedIssue[] = [];
  for (const raw of list) {
    const issue = normalizeIssue(raw);
    if (issue) {
      normalized.push(issue);
    }
  }
  return normalized;
}

function extractIssueList(value: unknown): unknown[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'object') {
    const container = value as Record<string, unknown>;
    for (const key of ['issues', 'diagnostics', 'results', 'messages']) {
      const candidate = container[key];
      if (Array.isArray(candidate)) {
        return candidate;
      }
    }
  }
  return [];
}

function normalizeIssue(value: unknown): NormalizedIssue | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const source = value as Record<string, unknown>;
  const message = firstString(source.message, source.detail, source.description, source.text);
  if (!message) {
    return undefined;
  }
  const severity = normalizeSeverity(source.severity, source.level, source.type);
  const range = normalizeRange(source.range ?? source.span ?? source.location ?? source, message);
  const quickFixes = normalizeFixes(source.quickFixes ?? source.fixes ?? source.actions);
  const elementId = firstString(source.elementId, source.elementID, source.id, source.identifier);
  return { message, severity, range, quickFixes, elementId: elementId ?? undefined };
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

function normalizeSeverity(...candidates: unknown[]): IssueSeverity {
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const normalized = candidate.toLowerCase();
      if (normalized.includes('warn')) {
        return 'warning';
      }
      if (normalized.includes('info')) {
        return 'info';
      }
      if (normalized.includes('error') || normalized.includes('fatal')) {
        return 'error';
      }
    }
    if (typeof candidate === 'number' && !Number.isNaN(candidate)) {
      if (candidate <= 1) {
        return 'error';
      }
      if (candidate === 2) {
        return 'warning';
      }
      if (candidate >= 3) {
        return 'info';
      }
    }
  }
  return 'error';
}

function normalizeRange(raw: unknown, fallback: string): NormalizedRange {
  const object = (typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}) as Record<
    string,
    unknown
  >;

  const startLine = coerceNumber(
    object.startLine ?? object.start?.line ?? object.line ?? object.lineNumber,
    1,
  );
  const startColumn = coerceNumber(
    object.startColumn ?? object.start?.column ?? object.column ?? object.character ?? object.offset,
    1,
  );

  let endLine = coerceNumber(
    object.endLine ?? object.end?.line ?? object.toLine ?? object.lineEnd,
    startLine,
  );
  let endColumn = coerceNumber(
    object.endColumn ?? object.end?.column ?? object.toColumn ?? object.columnEnd ?? object.length,
    startColumn + Math.max(1, fallback.length),
  );

  if (typeof object.length === 'number' && !Number.isNaN(object.length)) {
    const length = Math.max(1, Math.floor(object.length));
    endLine = startLine;
    endColumn = startColumn + length;
  }

  if (endLine < startLine || (endLine === startLine && endColumn <= startColumn)) {
    endLine = startLine;
    endColumn = startColumn + Math.max(1, fallback.length);
  }

  return {
    startLineNumber: startLine,
    startColumn,
    endLineNumber: endLine,
    endColumn,
  };
}

function coerceNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value));
  }
  return Math.max(1, Math.floor(fallback));
}

function normalizeFixes(raw: unknown): NormalizedFix[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const fixes: NormalizedFix[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const data = entry as Record<string, unknown>;
    const title = firstString(data.title, data.label, data.name);
    if (!title) {
      continue;
    }
    const replacementText = firstString(data.replacement, data.text, data.insert, data.editText);
    const rangeSource = data.range ?? data.location ?? data.span;
    const range = rangeSource ? normalizeRange(rangeSource, title) : undefined;
    fixes.push({ title, replacementText, range });
  }
  return fixes;
}

function toMarkerSeverity(monaco: MonacoApi, severity: IssueSeverity) {
  switch (severity) {
    case 'warning':
      return monaco.MarkerSeverity.Warning;
    case 'info':
      return monaco.MarkerSeverity.Info;
    default:
      return monaco.MarkerSeverity.Error;
  }
}

function badgeFixes(issue: NormalizedIssue): string[] {
  if (issue.quickFixes.length === 0) {
    return ['Quick fix available on hover'];
  }
  return issue.quickFixes.map((fix) => fix.title);
}

function severityLabel(severity: IssueSeverity) {
  switch (severity) {
    case 'warning':
      return 'Warning';
    case 'info':
      return 'Information';
    default:
      return 'Error';
  }
}

function triggerValidation() {
  if (!editorRef.value) {
    return;
  }
  scheduleValidation(true);
}
</script>
