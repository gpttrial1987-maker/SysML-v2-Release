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
        <div ref="monacoRoot" class="monaco-container" v-show="editorView === 'editor'" />
        <div ref="diffRoot" class="monaco-container diff-view" v-show="editorView === 'diff'" />
        <div class="merge-container" v-show="editorView === 'merge'">
          <div class="merge-pane">
            <div class="merge-pane-label">Base commit</div>
            <div ref="mergeLeftRoot" class="merge-editor" />
          </div>
          <div class="merge-pane">
            <div class="merge-pane-label">Server (resolved)</div>
            <div ref="mergeCenterRoot" class="merge-editor" />
          </div>
          <div class="merge-pane">
            <div class="merge-pane-label">Target commit</div>
            <div ref="mergeRightRoot" class="merge-editor" />
          </div>
        </div>
      </section>
      <aside class="sidebar">
        <section>
          <div class="status-pill" :class="status">
            <span class="dot">●</span>
            <span>{{ statusMessage }}</span>
          </div>
          <p v-if="lastValidated" class="last-run">Last checked {{ lastValidated }}</p>
        </section>
        <section class="outline-section">
          <div class="outline-header">
            <h2>Outline</h2>
            <button
              type="button"
              class="outline-refresh"
              @click="refreshOutline"
              :disabled="outlineLoading || !outlineReadyToLoad"
            >
              {{ outlineLoading ? 'Refreshing…' : 'Refresh' }}
            </button>
          </div>
          <div class="outline-config">
            <label>
              API base URL
              <input
                v-model="sysmlApiBaseUrl"
                type="url"
                placeholder="http://localhost:9000/api"
                spellcheck="false"
              />
            </label>
            <label>
              Project ID
              <input
                v-model="outlineProjectId"
                type="text"
                placeholder="project-id"
                spellcheck="false"
              />
            </label>
            <label>
              Commit ID
              <input
                v-model="outlineCommitId"
                type="text"
                placeholder="commit-id"
                spellcheck="false"
              />
            </label>
            <label>
              Root element ID
              <input
                v-model="outlineRootElementId"
                type="text"
                placeholder="element identifier"
                spellcheck="false"
              />
            </label>
          </div>
          <div class="outline-body">
            <p v-if="!outlineReadyToLoad" class="outline-hint">
              Provide the API base URL, project ID, commit ID, and root element ID to load the outline.
            </p>
            <p v-else-if="outlineError" class="outline-error">{{ outlineError }}</p>
            <p v-else-if="outlineLoading && !outlineItems.length" class="outline-status">Loading outline…</p>
            <ul
              v-else-if="outlineItems.length"
              class="outline-list"
              role="tree"
              aria-label="Model outline"
            >
              <li
                v-for="item in outlineItems"
                :key="item.node.key"
                role="treeitem"
                :aria-level="item.depth + 1"
                :aria-selected="outlineSelectedKey === item.node.key"
              >
                <button
                  type="button"
                  class="outline-node"
                  :class="{ active: outlineSelectedKey === item.node.key }"
                  :style="{ paddingLeft: `${item.depth * 16 + 12}px` }"
                  :disabled="!item.node.range"
                  @click="handleOutlineClick(item.node)"
                  :data-outline-key="item.node.key"
                  :title="outlineNodeTooltip(item.node)"
                >
                  <span class="outline-label">{{ item.node.label }}</span>
                  <span v-if="formatOutlineType(item.node.type)" class="outline-meta">
                    {{ formatOutlineType(item.node.type) }}
                  </span>
                </button>
              </li>
            </ul>
            <p v-else class="outline-status">No owned elements were returned.</p>
          </div>
        </section>
        <section class="diff-section">
          <div class="diff-header">
            <h2>Diff &amp; Merge</h2>
            <button type="button" class="diff-clear" @click="clearDiff" :disabled="!diffActive">
              Clear
            </button>
          </div>
          <div class="diff-config">
            <label>
              Project ID
              <input
                v-model="diffProjectId"
                type="text"
                placeholder="project-id"
                spellcheck="false"
              />
            </label>
            <label>
              Base commit ID
              <input
                v-model="diffBaseCommitId"
                type="text"
                placeholder="base commit"
                spellcheck="false"
              />
            </label>
            <label>
              Target commit ID
              <input
                v-model="diffTargetCommitId"
                type="text"
                placeholder="target commit"
                spellcheck="false"
              />
            </label>
            <label>
              .sysml path
              <input
                v-model="diffFilePath"
                type="text"
                placeholder="path/to/model.sysml"
                spellcheck="false"
              />
            </label>
          </div>
          <div class="diff-actions">
            <button
              type="button"
              class="diff-primary"
              @click="loadSysmlDiff"
              :disabled="!diffReadyToLoad || diffLoading"
            >
              {{ diffLoading ? 'Loading…' : diffActive ? 'Reload diff' : 'Show diff' }}
            </button>
            <button type="button" class="diff-secondary" @click="reconcileActiveMerge" :disabled="!canReconcile">
              Reconcile IDs
            </button>
          </div>
          <p v-if="!diffReadyToLoad" class="diff-hint">
            Provide the project, base commit, target commit, and .sysml path to compare revisions.
          </p>
          <p v-else-if="diffError" class="diff-error">{{ diffError }}</p>
          <p v-else-if="diffActive && editorView === 'diff'" class="diff-status">
            No conflicting changes detected between the selected commits.
          </p>
          <p v-else-if="diffActive && editorView === 'merge' && !mergeConflicts.length" class="diff-status">
            All changes merged using server IDs.
          </p>
          <div v-if="mergeConflicts.length" class="diff-conflicts">
            <h3>Conflicts (server version shown in the middle editor)</h3>
            <ul>
              <li v-for="(conflict, index) in mergeConflicts" :key="index">
                <strong>{{ conflict.baseRangeLabel }}</strong>
                <p>
                  Base commit {{ conflict.leftRangeLabel }} · {{ conflict.leftPreview }}
                </p>
                <p>
                  Server {{ conflict.rightRangeLabel }} · {{ conflict.rightPreview }}
                </p>
              </li>
            </ul>
          </div>
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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import loader from '@monaco-editor/loader';

import type * as Monaco from 'monaco-editor';

import { mergeChanges, formatLineRange, type MergeConflict } from './diff-utils';

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

interface ApiElementRecord {
  id: string;
  name?: string;
  classifierId?: string;
  documentation?: string;
  payload?: Record<string, unknown>;
}

interface OutlineNode {
  key: string;
  id: string;
  label: string;
  type?: string;
  range?: NormalizedRange;
  children: OutlineNode[];
}

interface OutlineListItem {
  node: OutlineNode;
  depth: number;
}

interface OutlineConfig {
  baseUrl: string;
  projectId: string;
  commitId: string;
}

interface OutlinePosition {
  line: number;
  column: number;
}

interface MergeConflictSummary {
  baseRangeLabel: string;
  leftRangeLabel: string;
  rightRangeLabel: string;
  leftPreview: string;
  rightPreview: string;
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

const sysmlApiBaseUrl = ref(import.meta.env.VITE_SYSML_API_URL ?? 'http://localhost:9000/api');
const outlineProjectId = ref(import.meta.env.VITE_SYSML_PROJECT_ID ?? '');
const outlineCommitId = ref(import.meta.env.VITE_SYSML_COMMIT_ID ?? '');
const outlineRootElementId = ref(import.meta.env.VITE_SYSML_ROOT_ELEMENT_ID ?? '');
const outlineLoading = ref(false);
const outlineError = ref<string | null>(null);
const outlineRoot = ref<OutlineNode | null>(null);
const outlineSelectedKey = ref<string | null>(null);

const editorView = ref<'editor' | 'diff' | 'merge'>('editor');
const diffProjectId = ref(outlineProjectId.value);
const diffBaseCommitId = ref(outlineCommitId.value);
const diffTargetCommitId = ref('');
const diffFilePath = ref('');
const diffLoading = ref(false);
const diffError = ref<string | null>(null);
const mergeConflicts = ref<MergeConflictSummary[]>([]);

const outlineReadyToLoad = computed(
  () =>
    sysmlApiBaseUrl.value.trim().length > 0 &&
    outlineProjectId.value.trim().length > 0 &&
    outlineCommitId.value.trim().length > 0 &&
    outlineRootElementId.value.trim().length > 0,
);

const outlineItems = computed<OutlineListItem[]>(() => {
  const rootNode = outlineRoot.value;
  if (!rootNode) {
    return [];
  }
  const items: OutlineListItem[] = [];
  const visit = (node: OutlineNode, depth: number) => {
    items.push({ node, depth });
    for (const child of node.children) {
      visit(child, depth + 1);
    }
  };
  visit(rootNode, 0);
  return items;
});

const diffActive = computed(() => editorView.value !== 'editor');
const diffReadyToLoad = computed(
  () =>
    sysmlApiBaseUrl.value.trim().length > 0 &&
    diffProjectId.value.trim().length > 0 &&
    diffBaseCommitId.value.trim().length > 0 &&
    diffTargetCommitId.value.trim().length > 0 &&
    diffFilePath.value.trim().length > 0,
);
const canReconcile = computed(() => editorView.value === 'merge' && !diffLoading.value);

const monacoRoot = ref<HTMLDivElement | null>(null);
const diffRoot = ref<HTMLDivElement | null>(null);
const mergeLeftRoot = ref<HTMLDivElement | null>(null);
const mergeCenterRoot = ref<HTMLDivElement | null>(null);
const mergeRightRoot = ref<HTMLDivElement | null>(null);
const editorRef = shallowRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
const diffEditorRef = shallowRef<Monaco.editor.IStandaloneDiffEditor | null>(null);
const mergeLeftEditorRef = shallowRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
const mergeCenterEditorRef = shallowRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
const mergeRightEditorRef = shallowRef<Monaco.editor.IStandaloneCodeEditor | null>(null);

let diffOriginalModel: Monaco.editor.ITextModel | null = null;
let diffModifiedModel: Monaco.editor.ITextModel | null = null;
let mergeBaseModel: Monaco.editor.ITextModel | null = null;
let mergeResolvedModel: Monaco.editor.ITextModel | null = null;
let mergeTargetModel: Monaco.editor.ITextModel | null = null;

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
let outlineDecorations: string[] = [];
let outlineAbortController: AbortController | null = null;
let outlineConfigTimer: ReturnType<typeof setTimeout> | null = null;
let ignoreEditorSelection = false;
let cleanupResize: (() => void) | null = null;
const outlineNodeIndex = new Map<string, OutlineNode>();
const outlineNodesWithRange: OutlineNode[] = [];
const outlineNodesByElementId = new Map<string, OutlineNode[]>();
const outlineElementCache = new Map<string, ApiElementRecord>();
const outlineOwnedCache = new Map<string, ApiElementRecord[]>();
let diffAbortController: AbortController | null = null;
const diffElementCache = new Map<string, ApiElementRecord>();

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

  if (diffRoot.value) {
    diffEditorRef.value = monaco.editor.createDiffEditor(diffRoot.value, {
      automaticLayout: true,
      readOnly: true,
      renderSideBySide: true,
      originalEditable: false,
      theme: 'vs-dark',
      enableSplitViewResizing: true,
      ignoreTrimWhitespace: false,
    });
  }

  if (mergeLeftRoot.value && mergeCenterRoot.value && mergeRightRoot.value) {
    mergeLeftEditorRef.value = monaco.editor.create(mergeLeftRoot.value, {
      automaticLayout: true,
      language: 'sysml',
      theme: 'vs-dark',
      readOnly: true,
      minimap: { enabled: false },
    });
    mergeCenterEditorRef.value = monaco.editor.create(mergeCenterRoot.value, {
      automaticLayout: true,
      language: 'sysml',
      theme: 'vs-dark',
      readOnly: false,
      minimap: { enabled: false },
    });
    mergeRightEditorRef.value = monaco.editor.create(mergeRightRoot.value, {
      automaticLayout: true,
      language: 'sysml',
      theme: 'vs-dark',
      readOnly: true,
      minimap: { enabled: false },
    });
  }

  const handleResize = () => layoutActiveEditor();
  window.addEventListener('resize', handleResize);
  cleanupResize = () => window.removeEventListener('resize', handleResize);

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
  modelDisposables.push(
    editor.onDidChangeCursorSelection((event) => {
      if (ignoreEditorSelection) {
        return;
      }
      const position: OutlinePosition = {
        line: event.selection.startLineNumber,
        column: event.selection.startColumn,
      };
      const node = findOutlineNodeByPosition(position);
      if (node) {
        if (outlineSelectedKey.value !== node.key) {
          outlineSelectedKey.value = node.key;
        }
      } else if (outlineSelectedKey.value) {
        outlineSelectedKey.value = null;
      }
    }),
  );
});

watch(
  [sysmlApiBaseUrl, outlineProjectId, outlineCommitId, outlineRootElementId],
  () => {
    if (outlineConfigTimer) {
      clearTimeout(outlineConfigTimer);
    }
    outlineConfigTimer = setTimeout(() => {
      if (outlineReadyToLoad.value) {
        refreshOutline().catch((error) => {
          console.error('Outline refresh error', error);
        });
      } else {
        resetOutlineState();
      }
    }, 400);
  },
  { immediate: true },
);

watch([diffProjectId, diffBaseCommitId, diffTargetCommitId, diffFilePath], () => {
  diffError.value = null;
});

watch(editorView, () => {
  layoutActiveEditor();
});

onBeforeUnmount(() => {
  if (validationTimer) {
    clearTimeout(validationTimer);
  }
  if (outlineConfigTimer) {
    clearTimeout(outlineConfigTimer);
    outlineConfigTimer = null;
  }
  if (outlineAbortController) {
    outlineAbortController.abort();
    outlineAbortController = null;
  }
  for (const disposable of modelDisposables) {
    disposable.dispose();
  }
  modelDisposables = [];
  if (cleanupResize) {
    cleanupResize();
    cleanupResize = null;
  }
  disposeDiffModels();
  disposeMergeModels();
  if (diffEditorRef.value) {
    diffEditorRef.value.dispose();
    diffEditorRef.value = null;
  }
  if (mergeLeftEditorRef.value) {
    mergeLeftEditorRef.value.dispose();
    mergeLeftEditorRef.value = null;
  }
  if (mergeCenterEditorRef.value) {
    mergeCenterEditorRef.value.dispose();
    mergeCenterEditorRef.value = null;
  }
  if (mergeRightEditorRef.value) {
    mergeRightEditorRef.value.dispose();
    mergeRightEditorRef.value = null;
  }
  const editor = editorRef.value;
  if (editor) {
    const model = editor.getModel();
    if (model && monacoApi) {
      monacoApi.editor.setModelMarkers(model, 'sysml-validation', []);
    }
    if (outlineDecorations.length) {
      editor.deltaDecorations(outlineDecorations, []);
      outlineDecorations = [];
    }
    editor.dispose();
    editorRef.value = null;
  }
});

async function refreshOutline(): Promise<void> {
  const config = getOutlineConfig();
  const elementId = outlineRootElementId.value.trim();
  if (!config || !elementId) {
    resetOutlineState();
    return;
  }

  const previousElementId = outlineSelectedKey.value
    ? outlineNodeIndex.get(outlineSelectedKey.value)?.id ?? null
    : null;

  outlineError.value = null;
  outlineLoading.value = true;
  outlineElementCache.clear();
  outlineOwnedCache.clear();

  if (outlineAbortController) {
    outlineAbortController.abort();
  }
  const controller = new AbortController();
  outlineAbortController = controller;
  const { signal } = controller;

  try {
    const rootRecord = await fetchElementRecord(elementId, config, signal);
    const rootNode = await buildOutlineNodeFromRecord(
      rootRecord,
      createOutlineKey(null, rootRecord.id, 0),
      config,
      signal,
      new Set<string>(),
    );
    if (signal.aborted || outlineAbortController !== controller) {
      return;
    }

    outlineRoot.value = rootNode;
    rebuildOutlineIndexes(rootNode);

    let nextSelectionKey: string | null = null;
    if (previousElementId) {
      const candidates = outlineNodesByElementId.get(previousElementId);
      if (candidates && candidates.length) {
        nextSelectionKey = candidates[0].key;
      }
    }
    if (!nextSelectionKey && rootNode.range) {
      nextSelectionKey = rootNode.key;
    }
    outlineSelectedKey.value = nextSelectionKey;
  } catch (error) {
    if (signal.aborted) {
      return;
    }
    outlineError.value = error instanceof Error ? error.message : 'Failed to load outline.';
    outlineRoot.value = null;
    rebuildOutlineIndexes(null);
    outlineSelectedKey.value = null;
  } finally {
    if (outlineAbortController === controller) {
      outlineLoading.value = false;
      outlineAbortController = null;
    }
  }
}

function resetOutlineState() {
  outlineError.value = null;
  outlineRoot.value = null;
  outlineSelectedKey.value = null;
  outlineLoading.value = false;
  rebuildOutlineIndexes(null);
  applyOutlineHighlight(undefined);
}

function getOutlineConfig(): OutlineConfig | null {
  const base = sysmlApiBaseUrl.value.trim();
  const project = outlineProjectId.value.trim();
  const commit = outlineCommitId.value.trim();
  if (!base || !project || !commit) {
    return null;
  }
  return {
    baseUrl: base.replace(/\/+$/, ''),
    projectId: project,
    commitId: commit,
  };
}

async function buildOutlineNodeFromRecord(
  record: ApiElementRecord,
  key: string,
  config: OutlineConfig,
  signal: AbortSignal,
  visited: Set<string>,
): Promise<OutlineNode> {
  if (signal.aborted) {
    throw new DOMException('Outline request aborted', 'AbortError');
  }

  const sanitized = sanitizeElementRecord(record);
  const node: OutlineNode = {
    key,
    id: sanitized.id,
    label: computeOutlineLabel(sanitized),
    type: computeOutlineType(sanitized),
    range: extractOutlineRange(sanitized),
    children: [],
  };

  if (visited.has(node.id)) {
    return node;
  }
  visited.add(node.id);

  const children = await fetchOwnedElementRecords(node.id, config, signal);
  const childNodes: OutlineNode[] = [];
  for (let index = 0; index < children.length; index += 1) {
    const childRecord = children[index];
    const childKey = createOutlineKey(key, childRecord.id, index);
    const childNode = await buildOutlineNodeFromRecord(childRecord, childKey, config, signal, visited);
    childNodes.push(childNode);
  }
  node.children = childNodes;
  return node;
}

async function fetchElementRecord(
  elementId: string,
  config: OutlineConfig,
  signal: AbortSignal,
): Promise<ApiElementRecord> {
  const cached = outlineElementCache.get(elementId);
  if (cached) {
    return cached;
  }
  const url = buildCommitElementUrl(config.baseUrl, config.projectId, config.commitId, elementId);
  const payload = await requestJson(url, signal);
  const record = parseElementRecord(payload);
  outlineElementCache.set(record.id, record);
  return record;
}

async function fetchOwnedElementRecords(
  elementId: string,
  config: OutlineConfig,
  signal: AbortSignal,
): Promise<ApiElementRecord[]> {
  const cached = outlineOwnedCache.get(elementId);
  if (cached) {
    return cached;
  }
  const url = buildCommitElementUrl(config.baseUrl, config.projectId, config.commitId, elementId, 'owned-elements');
  const payload = await requestJson(url, signal);
  const records = parseOwnedElements(payload);
  outlineOwnedCache.set(elementId, records);
  for (const record of records) {
    if (!outlineElementCache.has(record.id)) {
      outlineElementCache.set(record.id, record);
    }
  }
  return records;
}

function buildCommitElementUrl(
  baseUrl: string,
  projectId: string,
  commitId: string,
  elementId?: string,
  suffix?: string,
) {
  let url = `${baseUrl}/projects/${encodeURIComponent(projectId)}/commits/${encodeURIComponent(commitId)}/elements`;
  if (elementId) {
    url += `/${encodeURIComponent(elementId)}`;
  }
  if (suffix) {
    url += `/${suffix}`;
  }
  return url;
}

async function requestJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (response.status === 204) {
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }
    return null;
  }
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      throw new Error(`Response from ${url} was not valid JSON.`);
    }
  }
  if (!response.ok) {
    const message = isRecord(data) && typeof data.message === 'string'
      ? data.message
      : `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return data;
}

function parseElementRecord(payload: unknown): ApiElementRecord {
  if (!isRecord(payload) || !isRecord(payload.data) || typeof payload.data.id !== 'string') {
    throw new Error('Unexpected element response shape.');
  }
  const data = payload.data as Record<string, unknown>;
  return sanitizeElementRecord({
    id: data.id as string,
    name: typeof data.name === 'string' ? data.name : undefined,
    classifierId: typeof data.classifierId === 'string' ? data.classifierId : undefined,
    documentation: typeof data.documentation === 'string' ? data.documentation : undefined,
    payload: isRecord(data.payload) ? (data.payload as Record<string, unknown>) : undefined,
  });
}

function parseOwnedElements(payload: unknown): ApiElementRecord[] {
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    return [];
  }
  const results: ApiElementRecord[] = [];
  for (const entry of payload.items) {
    if (!isRecord(entry) || typeof entry.id !== 'string') {
      continue;
    }
    results.push(
      sanitizeElementRecord({
        id: entry.id,
        name: typeof entry.name === 'string' ? entry.name : undefined,
        classifierId: typeof entry.classifierId === 'string' ? entry.classifierId : undefined,
        documentation: typeof entry.documentation === 'string' ? entry.documentation : undefined,
        payload: isRecord(entry.payload) ? (entry.payload as Record<string, unknown>) : undefined,
      }),
    );
  }
  return results;
}

function sanitizeElementRecord(record: ApiElementRecord): ApiElementRecord {
  return {
    id: record.id,
    name: typeof record.name === 'string' ? record.name : undefined,
    classifierId: typeof record.classifierId === 'string' ? record.classifierId : undefined,
    documentation: typeof record.documentation === 'string' ? record.documentation : undefined,
    payload: isRecord(record.payload) ? record.payload : undefined,
  };
}

function createOutlineKey(parentKey: string | null, elementId: string, index: number): string {
  const safeId = elementId.replace(/[^A-Za-z0-9_-]/g, '_');
  if (parentKey) {
    return `${parentKey}-${index}-${safeId}`;
  }
  return `root-${safeId}`;
}

function computeOutlineLabel(record: ApiElementRecord): string {
  const payload = record.payload;
  const nested = payload && isRecord(payload.payload) ? (payload.payload as Record<string, unknown>) : undefined;
  return (
    firstString(
      record.name,
      payload?.declaredName,
      payload?.declaredShortName,
      payload?.name,
      nested?.declaredName,
      nested?.declaredShortName,
      nested?.name,
    ) ?? record.id
  );
}

function computeOutlineType(record: ApiElementRecord): string | undefined {
  const payload = record.payload;
  const nested = payload && isRecord(payload.payload) ? (payload.payload as Record<string, unknown>) : undefined;
  return (
    firstString(
      record.classifierId,
      payload?.classifierId,
      nested?.classifierId,
      payload?.['@type'],
      nested?.['@type'],
    ) ?? undefined
  );
}

function extractOutlineRange(record: ApiElementRecord): NormalizedRange | undefined {
  const payload = record.payload;
  if (!payload) {
    return undefined;
  }
  const candidate = findRangeCandidate(payload);
  if (!candidate || !isRecord(candidate)) {
    return undefined;
  }
  try {
    return normalizeRange(candidate, record.name ?? record.id);
  } catch (error) {
    return undefined;
  }
}

function findRangeCandidate(value: unknown, visited = new Set<unknown>()): unknown {
  if (!value || typeof value !== 'object' || visited.has(value)) {
    return undefined;
  }
  visited.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      const candidate = findRangeCandidate(entry, visited);
      if (candidate) {
        return candidate;
      }
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const hasStartLine = 'startLine' in record || 'start' in record || 'line' in record || 'lineNumber' in record;
  const hasEndLine = 'endLine' in record || 'end' in record || 'toLine' in record || 'lineEnd' in record;
  const hasColumnInfo = 'startColumn' in record || 'column' in record || 'character' in record || 'offset' in record;
  const hasLength = 'length' in record || 'endColumn' in record;
  if (hasStartLine && (hasEndLine || hasColumnInfo || hasLength)) {
    return record;
  }
  const preferredKeys = [
    'source',
    'textRange',
    'range',
    'span',
    'location',
    'ownedSource',
    'body',
    'ownedBody',
    'ownedTextualRepresentation',
    'textualRepresentation',
  ];
  for (const key of preferredKeys) {
    if (key in record) {
      const candidate = findRangeCandidate(record[key], visited);
      if (candidate) {
        return candidate;
      }
    }
  }
  for (const entry of Object.values(record)) {
    const candidate = findRangeCandidate(entry, visited);
    if (candidate) {
      return candidate;
    }
  }
  return undefined;
}

function rebuildOutlineIndexes(root: OutlineNode | null) {
  outlineNodeIndex.clear();
  outlineNodesWithRange.length = 0;
  outlineNodesByElementId.clear();
  if (!root) {
    return;
  }
  const visit = (node: OutlineNode) => {
    outlineNodeIndex.set(node.key, node);
    const existing = outlineNodesByElementId.get(node.id);
    if (existing) {
      existing.push(node);
    } else {
      outlineNodesByElementId.set(node.id, [node]);
    }
    if (node.range) {
      outlineNodesWithRange.push(node);
    }
    for (const child of node.children) {
      visit(child);
    }
  };
  visit(root);
}

function handleOutlineClick(node: OutlineNode) {
  outlineSelectedKey.value = node.key;
  if (node.range) {
    revealOutlineNode(node);
  }
}

function revealOutlineNode(node: OutlineNode) {
  if (!node.range) {
    return;
  }
  focusEditorOnRange(node.range);
}

function focusEditorOnRange(range: NormalizedRange) {
  if (!editorRef.value || !monacoApi) {
    return;
  }
  const editor = editorRef.value;
  const monacoRange = toMonacoRange(range, monacoApi);
  ignoreEditorSelection = true;
  editor.setSelection(monacoRange);
  editor.revealRangeInCenterIfOutsideViewport(monacoRange, 2);
  applyOutlineHighlight(range);
  queueMicrotask(() => {
    ignoreEditorSelection = false;
  });
}

function applyOutlineHighlight(range: NormalizedRange | undefined) {
  if (!editorRef.value || !monacoApi) {
    return;
  }
  const editor = editorRef.value;
  if (!range) {
    if (outlineDecorations.length) {
      outlineDecorations = editor.deltaDecorations(outlineDecorations, []);
    }
    return;
  }
  const monacoRange = toMonacoRange(range, monacoApi);
  outlineDecorations = editor.deltaDecorations(outlineDecorations, [
    {
      range: monacoRange,
      options: {
        isWholeLine: true,
        className: 'outline-highlight',
        linesDecorationsClassName: 'outline-glyph',
      },
    },
  ]);
}

watch(outlineSelectedKey, (key) => {
  const node = key ? outlineNodeIndex.get(key) ?? null : null;
  applyOutlineHighlight(node?.range);
  if (key) {
    nextTick(() => {
      const button = document.querySelector<HTMLButtonElement>(`[data-outline-key="${key}"]`);
      button?.scrollIntoView({ block: 'nearest' });
    });
  }
});

function formatOutlineType(type?: string): string {
  if (!type) {
    return '';
  }
  const trimmed = type.trim();
  if (!trimmed) {
    return '';
  }
  const parts = trimmed.split(':');
  return parts[parts.length - 1];
}

function outlineNodeTooltip(node: OutlineNode): string {
  const parts = [node.label];
  const type = formatOutlineType(node.type);
  if (type) {
    parts.push(type);
  }
  if (node.range) {
    parts.push(
      `Lines ${node.range.startLineNumber}:${node.range.startColumn}–${node.range.endLineNumber}:${node.range.endColumn}`,
    );
  }
  return parts.join(' · ');
}

async function loadSysmlDiff(): Promise<void> {
  if (!diffReadyToLoad.value) {
    diffError.value = 'Provide the project, commit IDs, and file path before loading a diff.';
    return;
  }
  if (!monacoApi) {
    diffError.value = 'Editor environment is still loading. Try again in a moment.';
    return;
  }

  if (diffAbortController) {
    diffAbortController.abort();
    diffAbortController = null;
  }

  const baseUrl = sysmlApiBaseUrl.value.trim().replace(/\/+$/, '');
  const projectId = diffProjectId.value.trim();
  const baseCommit = diffBaseCommitId.value.trim();
  const targetCommit = diffTargetCommitId.value.trim();
  const filePath = diffFilePath.value.trim();

  const controller = new AbortController();
  diffAbortController = controller;
  diffLoading.value = true;
  diffError.value = null;
  mergeConflicts.value = [];

  try {
    const [baseRaw, targetRaw] = await Promise.all([
      fetchSysmlFile(baseUrl, projectId, baseCommit, filePath, controller.signal),
      fetchSysmlFile(baseUrl, projectId, targetCommit, filePath, controller.signal),
    ]);

    if (controller.signal.aborted) {
      return;
    }

    const [baseText, targetText] = await Promise.all([
      reconcileModelIds(baseRaw, projectId, baseCommit, baseUrl, controller.signal),
      reconcileModelIds(targetRaw, projectId, targetCommit, baseUrl, controller.signal),
    ]);

    if (controller.signal.aborted) {
      return;
    }

    let view: 'diff' | 'merge' = 'diff';
    let mergedText = targetText;
    let conflictSummaries: MergeConflictSummary[] = [];

    const ancestorCommit = await findCommonAncestor(baseUrl, projectId, baseCommit, targetCommit, controller.signal);
    if (controller.signal.aborted) {
      return;
    }

    if (ancestorCommit) {
      const ancestorRaw = await fetchSysmlFile(baseUrl, projectId, ancestorCommit, filePath, controller.signal);
      const ancestorText = await reconcileModelIds(
        ancestorRaw,
        projectId,
        ancestorCommit,
        baseUrl,
        controller.signal,
      );

      if (controller.signal.aborted) {
        return;
      }

      const mergeResult = mergeChanges(ancestorText, baseText, targetText);
      mergedText = mergeResult.mergedText;

      if (mergeResult.conflicts.length) {
        conflictSummaries = summarizeConflicts(ancestorText, mergeResult.conflicts);
        setMergeModels(baseText, mergedText, targetText);
        disposeDiffModels();
        view = 'merge';
      } else {
        setDiffModels(baseText, targetText);
        disposeMergeModels();
        view = 'diff';
      }
    } else {
      setDiffModels(baseText, targetText);
      disposeMergeModels();
      view = 'diff';
    }

    mergeConflicts.value = conflictSummaries;
    editorView.value = view;
    await nextTick();
    layoutActiveEditor();
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'AbortError')) {
      diffError.value = error instanceof Error ? error.message : 'Failed to compute diff.';
      disposeDiffModels();
      disposeMergeModels();
      mergeConflicts.value = [];
      editorView.value = 'editor';
      await nextTick();
      layoutActiveEditor();
    }
  } finally {
    if (diffAbortController === controller) {
      diffAbortController = null;
    }
    diffLoading.value = false;
  }
}

function clearDiff(): void {
  if (diffAbortController) {
    diffAbortController.abort();
    diffAbortController = null;
  }
  diffLoading.value = false;
  diffError.value = null;
  mergeConflicts.value = [];
  disposeDiffModels();
  disposeMergeModels();
  editorView.value = 'editor';
  layoutActiveEditor();
}

async function reconcileActiveMerge(): Promise<void> {
  if (editorView.value !== 'merge' || !mergeCenterEditorRef.value) {
    return;
  }
  const baseUrl = sysmlApiBaseUrl.value.trim().replace(/\/+$/, '');
  const projectId = diffProjectId.value.trim();
  const commitId = diffTargetCommitId.value.trim();
  if (!baseUrl || !projectId || !commitId) {
    return;
  }
  const content = mergeCenterEditorRef.value.getValue();
  diffLoading.value = true;
  try {
    const controller = new AbortController();
    const reconciled = await reconcileModelIds(content, projectId, commitId, baseUrl, controller.signal);
    mergeCenterEditorRef.value.setValue(reconciled);
    diffError.value = null;
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'AbortError')) {
      diffError.value = error instanceof Error ? error.message : 'Failed to reconcile model IDs.';
    }
  } finally {
    diffLoading.value = false;
    layoutActiveEditor();
  }
}

function setDiffModels(original: string, modified: string): void {
  if (!monacoApi || !diffEditorRef.value) {
    return;
  }
  if (diffOriginalModel) {
    diffOriginalModel.dispose();
  }
  if (diffModifiedModel) {
    diffModifiedModel.dispose();
  }
  diffOriginalModel = monacoApi.editor.createModel(original, 'sysml');
  diffModifiedModel = monacoApi.editor.createModel(modified, 'sysml');
  diffEditorRef.value.setModel({ original: diffOriginalModel, modified: diffModifiedModel });
}

function disposeDiffModels(): void {
  if (diffEditorRef.value) {
    diffEditorRef.value.setModel(null);
  }
  if (diffOriginalModel) {
    diffOriginalModel.dispose();
    diffOriginalModel = null;
  }
  if (diffModifiedModel) {
    diffModifiedModel.dispose();
    diffModifiedModel = null;
  }
}

function setMergeModels(baseText: string, resolvedText: string, targetText: string): void {
  if (!monacoApi || !mergeLeftEditorRef.value || !mergeCenterEditorRef.value || !mergeRightEditorRef.value) {
    return;
  }
  if (mergeBaseModel) {
    mergeBaseModel.dispose();
  }
  if (mergeResolvedModel) {
    mergeResolvedModel.dispose();
  }
  if (mergeTargetModel) {
    mergeTargetModel.dispose();
  }

  mergeBaseModel = monacoApi.editor.createModel(baseText, 'sysml');
  mergeResolvedModel = monacoApi.editor.createModel(resolvedText, 'sysml');
  mergeTargetModel = monacoApi.editor.createModel(targetText, 'sysml');

  mergeLeftEditorRef.value.setModel(mergeBaseModel);
  mergeCenterEditorRef.value.setModel(mergeResolvedModel);
  mergeRightEditorRef.value.setModel(mergeTargetModel);
}

function disposeMergeModels(): void {
  if (mergeLeftEditorRef.value) {
    mergeLeftEditorRef.value.setModel(null);
  }
  if (mergeCenterEditorRef.value) {
    mergeCenterEditorRef.value.setModel(null);
  }
  if (mergeRightEditorRef.value) {
    mergeRightEditorRef.value.setModel(null);
  }
  if (mergeBaseModel) {
    mergeBaseModel.dispose();
    mergeBaseModel = null;
  }
  if (mergeResolvedModel) {
    mergeResolvedModel.dispose();
    mergeResolvedModel = null;
  }
  if (mergeTargetModel) {
    mergeTargetModel.dispose();
    mergeTargetModel = null;
  }
}

function summarizeConflicts(ancestorText: string, conflicts: MergeConflict[]): MergeConflictSummary[] {
  const baseLines = normalizeNewlines(ancestorText).split('\n');
  return conflicts.map((conflict) => {
    const combinedStart = Math.min(conflict.left.start, conflict.right.start);
    const combinedEnd = Math.max(conflict.left.end, conflict.right.end);
    return {
      baseRangeLabel: formatLineRange(combinedStart, combinedEnd),
      leftRangeLabel: formatLineRange(conflict.left.start, conflict.left.end),
      rightRangeLabel: formatLineRange(conflict.right.start, conflict.right.end),
      leftPreview: truncatePreview(previewOperation(conflict.left, baseLines)),
      rightPreview: truncatePreview(previewOperation(conflict.right, baseLines)),
    };
  });
}

function previewOperation(operation: MergeConflict['left'], baseLines: string[]): string {
  if (operation.replacement.length) {
    return operation.replacement.join(' ⏎ ');
  }
  const removed = baseLines.slice(operation.start, operation.end);
  return removed.length ? removed.join(' ⏎ ') : '(no content)';
}

function truncatePreview(value: string, maxLength = 160): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength)}…`;
}

async function fetchSysmlFile(
  baseUrl: string,
  projectId: string,
  commitId: string,
  filePath: string,
  signal: AbortSignal,
): Promise<string> {
  const sanitizedPath = filePath.replace(/^\/+/, '');
  const segments = sanitizedPath
    .split('/')
    .filter((segment) => segment.length)
    .map((segment) => encodeURIComponent(segment));
  const encodedPath = segments.join('/');
  const candidates = [
    `${baseUrl}/projects/${encodeURIComponent(projectId)}/commits/${encodeURIComponent(commitId)}/files/${encodedPath}`,
    `${baseUrl}/projects/${encodeURIComponent(projectId)}/commits/${encodeURIComponent(commitId)}/artifacts/${encodedPath}`,
  ];

  let lastError: Error | null = null;
  for (const url of candidates) {
    try {
      const response = await fetch(url, { signal, headers: { Accept: 'text/plain' } });
      if (response.ok) {
        const text = await response.text();
        return normalizeNewlines(text);
      }
      if (response.status !== 404) {
        throw new Error(`Request failed with status ${response.status}`);
      }
      lastError = new Error(`File not found at ${url}`);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error;
      }
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError ?? new Error('Unable to fetch SysML file.');
}

async function reconcileModelIds(
  text: string,
  projectId: string,
  commitId: string,
  baseUrl: string,
  signal: AbortSignal,
): Promise<string> {
  const identifiers = extractModelIdentifiers(text);
  if (!identifiers.length) {
    return text;
  }

  const replacements = new Map<string, string>();
  await Promise.all(
    identifiers.map(async (identifier) => {
      const cacheKey = `${commitId}::${identifier}`;
      if (diffElementCache.has(cacheKey)) {
        replacements.set(identifier, diffElementCache.get(cacheKey)!.id);
        return;
      }
      try {
        const url = buildCommitElementUrl(baseUrl, projectId, commitId, identifier);
        const payload = await requestJson(url, signal);
        const record = parseElementRecord(payload);
        diffElementCache.set(cacheKey, record);
        replacements.set(identifier, record.id);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          throw error;
        }
      }
    }),
  );

  let reconciled = normalizeNewlines(text);
  for (const [source, canonical] of replacements) {
    if (source === canonical) {
      continue;
    }
    const before = '(?<![A-Za-z0-9_.-])';
    const after = '(?![A-Za-z0-9_.-])';
    const pattern = new RegExp(`${before}${escapeRegExp(source)}${after}`, 'g');
    reconciled = reconciled.replace(pattern, canonical);
  }
  return reconciled;
}

function extractModelIdentifiers(text: string): string[] {
  const pattern = /\b(?:id|elementId)\s*[:=]\s*(["']?)([A-Za-z_][\w.\-]*)\1/g;
  const identifiers = new Set<string>();
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(line)) !== null) {
      identifiers.add(match[2]);
    }
  }
  return Array.from(identifiers);
}

async function findCommonAncestor(
  baseUrl: string,
  projectId: string,
  commitA: string,
  commitB: string,
  signal: AbortSignal,
): Promise<string | null> {
  if (commitA === commitB) {
    return commitA;
  }

  const visitedA = new Set<string>([commitA]);
  const visitedB = new Set<string>([commitB]);
  const frontierA: string[] = [commitA];
  const frontierB: string[] = [commitB];
  const parentCache = new Map<string, string[]>();

  const expand = async (
    frontier: string[],
    visited: Set<string>,
    otherVisited: Set<string>,
  ): Promise<string | null> => {
    const next: string[] = [];
    for (const id of frontier) {
      if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      const parents = await fetchCommitParents(id);
      for (const parent of parents) {
        if (otherVisited.has(parent)) {
          return parent;
        }
        if (!visited.has(parent)) {
          visited.add(parent);
          next.push(parent);
        }
      }
    }
    frontier.splice(0, frontier.length, ...next);
    return null;
  };

  const fetchCommitParents = async (commitId: string): Promise<string[]> => {
    if (parentCache.has(commitId)) {
      return parentCache.get(commitId)!;
    }
    const summary = await fetchCommitSummary(baseUrl, projectId, commitId, signal);
    parentCache.set(commitId, summary.parentIds);
    return summary.parentIds;
  };

  let iterations = 0;
  const maxIterations = 200;
  while ((frontierA.length || frontierB.length) && iterations < maxIterations) {
    iterations += 1;
    if (frontierA.length) {
      const candidate = await expand(frontierA, visitedA, visitedB);
      if (candidate) {
        return candidate;
      }
    }
    if (frontierB.length) {
      const candidate = await expand(frontierB, visitedB, visitedA);
      if (candidate) {
        return candidate;
      }
    }
  }

  return null;
}

async function fetchCommitSummary(
  baseUrl: string,
  projectId: string,
  commitId: string,
  signal: AbortSignal,
): Promise<{ id: string; parentIds: string[] }> {
  const url = `${baseUrl}/projects/${encodeURIComponent(projectId)}/commits/${encodeURIComponent(commitId)}`;
  const payload = await requestJson(url, signal);
  return parseCommitSummary(payload);
}

function parseCommitSummary(payload: unknown): { id: string; parentIds: string[] } {
  if (!isRecord(payload) || !isRecord(payload.data) || typeof payload.data.id !== 'string') {
    throw new Error('Unexpected commit response shape.');
  }
  const data = payload.data as Record<string, unknown>;
  const parents = Array.isArray(data.parentIds)
    ? data.parentIds.filter((value): value is string => typeof value === 'string')
    : [];
  return {
    id: data.id as string,
    parentIds: parents,
  };
}

function layoutActiveEditor(): void {
  nextTick(() => {
    if (editorView.value === 'editor') {
      editorRef.value?.layout();
    } else if (editorView.value === 'diff') {
      diffEditorRef.value?.layout();
    } else if (editorView.value === 'merge') {
      mergeLeftEditorRef.value?.layout();
      mergeCenterEditorRef.value?.layout();
      mergeRightEditorRef.value?.layout();
    }
  });
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findOutlineNodeByPosition(position: OutlinePosition): OutlineNode | null {
  let candidate: OutlineNode | null = null;
  for (const node of outlineNodesWithRange) {
    const range = node.range;
    if (!range) {
      continue;
    }
    if (!rangeContainsPosition(range, position)) {
      continue;
    }
    if (!candidate) {
      candidate = node;
      continue;
    }
    const currentRange = candidate.range!;
    if (rangeContainsRange(currentRange, range)) {
      candidate = node;
      continue;
    }
    if (!rangeContainsRange(range, currentRange) && rangeArea(range) <= rangeArea(currentRange)) {
      candidate = node;
    }
  }
  return candidate;
}

function rangeContainsPosition(range: NormalizedRange, position: OutlinePosition): boolean {
  if (position.line < range.startLineNumber || position.line > range.endLineNumber) {
    return false;
  }
  if (position.line === range.startLineNumber && position.column < range.startColumn) {
    return false;
  }
  if (position.line === range.endLineNumber && position.column > range.endColumn) {
    return false;
  }
  return true;
}

function rangeContainsRange(outer: NormalizedRange, inner: NormalizedRange): boolean {
  return (
    rangeContainsPosition(outer, { line: inner.startLineNumber, column: inner.startColumn }) &&
    rangeContainsPosition(outer, { line: inner.endLineNumber, column: inner.endColumn })
  );
}

function rangeArea(range: NormalizedRange): number {
  const lineSpan = range.endLineNumber - range.startLineNumber;
  const columnSpan = range.endColumn - range.startColumn;
  return lineSpan * 1000 + columnSpan;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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
