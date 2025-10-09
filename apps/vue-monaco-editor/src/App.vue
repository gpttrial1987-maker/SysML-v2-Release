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
        <section class="wizard-section">
          <div class="wizard-header">
            <h2>Modeling Wizards</h2>
            <p class="wizard-hint">
              Guided forms create common elements using the configured SysML API commit and append starter text to the editor.
            </p>
            <p v-if="!wizardApiReady" class="wizard-warning">
              Provide the API base URL, project ID, and commit ID before running a wizard.
            </p>
          </div>
          <details
            class="wizard-panel"
            :open="wizardOpenState.block"
            @toggle="handleWizardToggle('block', $event)"
          >
            <summary>
              <span>New Block</span>
              <span class="wizard-summary-meta">Creates a Block Definition</span>
            </summary>
            <form class="wizard-form" @submit.prevent="submitBlockWizard">
              <div class="wizard-field">
                <label for="block-name">Name</label>
                <input
                  id="block-name"
                  v-model="blockWizard.name"
                  type="text"
                  placeholder="WheelController"
                  autocomplete="off"
                  spellcheck="false"
                  required
                />
              </div>
              <div class="wizard-field">
                <label for="block-short-name">Short name (optional)</label>
                <input
                  id="block-short-name"
                  v-model="blockWizard.shortName"
                  type="text"
                  placeholder="WheelCtrl"
                  autocomplete="off"
                  spellcheck="false"
                />
              </div>
              <div class="wizard-field">
                <label for="block-doc">Documentation (optional)</label>
                <textarea
                  id="block-doc"
                  v-model="blockWizard.documentation"
                  rows="2"
                  placeholder="Describe the purpose of this block."
                />
              </div>
              <p class="wizard-context">
                Outline selection ·
                <span>{{ selectedOutlineNode?.label ?? 'None' }}</span>
              </p>
              <div class="wizard-actions">
                <button
                  type="submit"
                  :disabled="!wizardApiReady || !blockFormValid || wizardSubmitting.block"
                >
                  {{ wizardSubmitting.block ? 'Creating…' : 'Create block' }}
                </button>
                <span v-if="wizardSuccess.block" class="wizard-feedback success">
                  {{ wizardSuccess.block }}
                </span>
                <span v-else-if="wizardError.block" class="wizard-feedback error">
                  {{ wizardError.block }}
                </span>
              </div>
            </form>
          </details>

          <details
            class="wizard-panel"
            :open="wizardOpenState.requirement"
            @toggle="handleWizardToggle('requirement', $event)"
          >
            <summary>
              <span>New Requirement</span>
              <span class="wizard-summary-meta">Creates a Requirement Definition</span>
            </summary>
            <form class="wizard-form" @submit.prevent="submitRequirementWizard">
              <div class="wizard-field">
                <label for="requirement-name">Name</label>
                <input
                  id="requirement-name"
                  v-model="requirementWizard.name"
                  type="text"
                  placeholder="MaintainSpeed"
                  autocomplete="off"
                  spellcheck="false"
                  required
                />
              </div>
              <div class="wizard-field">
                <label for="requirement-short-name">Short name (optional)</label>
                <input
                  id="requirement-short-name"
                  v-model="requirementWizard.shortName"
                  type="text"
                  placeholder="MaintainSpd"
                  autocomplete="off"
                  spellcheck="false"
                />
              </div>
              <div class="wizard-field">
                <label for="requirement-id">Requirement ID</label>
                <input
                  id="requirement-id"
                  v-model="requirementWizard.identifier"
                  type="text"
                  placeholder="REQ-001"
                  autocomplete="off"
                  spellcheck="false"
                  required
                />
              </div>
              <div class="wizard-field">
                <label for="requirement-text">Text</label>
                <textarea
                  id="requirement-text"
                  v-model="requirementWizard.text"
                  rows="3"
                  placeholder="Describe the system requirement."
                  required
                />
              </div>
              <div class="wizard-field">
                <label for="requirement-doc">Documentation (optional)</label>
                <textarea
                  id="requirement-doc"
                  v-model="requirementWizard.documentation"
                  rows="2"
                  placeholder="Internal notes or rationale."
                />
              </div>
              <p class="wizard-context">
                Outline selection ·
                <span>{{ selectedOutlineNode?.label ?? 'None' }}</span>
              </p>
              <div class="wizard-actions">
                <button
                  type="submit"
                  :disabled="
                    !wizardApiReady ||
                    !requirementFormValid ||
                    wizardSubmitting.requirement
                  "
                >
                  {{ wizardSubmitting.requirement ? 'Creating…' : 'Create requirement' }}
                </button>
                <span v-if="wizardSuccess.requirement" class="wizard-feedback success">
                  {{ wizardSuccess.requirement }}
                </span>
                <span v-else-if="wizardError.requirement" class="wizard-feedback error">
                  {{ wizardError.requirement }}
                </span>
              </div>
            </form>
          </details>

          <details
            class="wizard-panel"
            :open="wizardOpenState.state"
            @toggle="handleWizardToggle('state', $event)"
          >
            <summary>
              <span>New State</span>
              <span class="wizard-summary-meta">Creates a State Definition</span>
            </summary>
            <form class="wizard-form" @submit.prevent="submitStateWizard">
              <div class="wizard-field">
                <label for="state-name">Name</label>
                <input
                  id="state-name"
                  v-model="stateWizard.name"
                  type="text"
                  placeholder="Idle"
                  autocomplete="off"
                  spellcheck="false"
                  required
                />
              </div>
              <div class="wizard-field">
                <label for="state-short-name">Short name (optional)</label>
                <input
                  id="state-short-name"
                  v-model="stateWizard.shortName"
                  type="text"
                  placeholder="IdleState"
                  autocomplete="off"
                  spellcheck="false"
                />
              </div>
              <div class="wizard-field">
                <label for="state-doc">Documentation (optional)</label>
                <textarea
                  id="state-doc"
                  v-model="stateWizard.documentation"
                  rows="2"
                  placeholder="Describe when this state is active."
                />
              </div>
              <p class="wizard-context">
                Outline selection ·
                <span>{{ selectedOutlineNode?.label ?? 'None' }}</span>
              </p>
              <div class="wizard-actions">
                <button
                  type="submit"
                  :disabled="!wizardApiReady || !stateFormValid || wizardSubmitting.state"
                >
                  {{ wizardSubmitting.state ? 'Creating…' : 'Create state' }}
                </button>
                <span v-if="wizardSuccess.state" class="wizard-feedback success">
                  {{ wizardSuccess.state }}
                </span>
                <span v-else-if="wizardError.state" class="wizard-feedback error">
                  {{ wizardError.state }}
                </span>
              </div>
            </form>
          </details>
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
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue';
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

interface ElementUpsert {
  classifierId: string;
  name?: string;
  documentation?: string;
  payload: Record<string, unknown>;
}

type WizardType = 'block' | 'requirement' | 'state';

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
let outlineDecorations: string[] = [];
let outlineAbortController: AbortController | null = null;
let outlineConfigTimer: ReturnType<typeof setTimeout> | null = null;
let ignoreEditorSelection = false;
const outlineNodeIndex = new Map<string, OutlineNode>();
const outlineNodesWithRange: OutlineNode[] = [];
const outlineNodesByElementId = new Map<string, OutlineNode[]>();
const outlineElementCache = new Map<string, ApiElementRecord>();
const outlineOwnedCache = new Map<string, ApiElementRecord[]>();
let outlinePendingFocusElementId: string | null = null;

const wizardOpenState = reactive<Record<WizardType, boolean>>({
  block: false,
  requirement: false,
  state: false,
});

const wizardSubmitting = reactive<Record<WizardType, boolean>>({
  block: false,
  requirement: false,
  state: false,
});

const wizardSuccess = reactive<Record<WizardType, string | null>>({
  block: null,
  requirement: null,
  state: null,
});

const wizardError = reactive<Record<WizardType, string | null>>({
  block: null,
  requirement: null,
  state: null,
});

const blockWizard = reactive({
  name: '',
  shortName: '',
  documentation: '',
});

const requirementWizard = reactive({
  name: '',
  shortName: '',
  identifier: '',
  text: '',
  documentation: '',
});

const stateWizard = reactive({
  name: '',
  shortName: '',
  documentation: '',
});

const wizardApiReady = computed(() => {
  const base = sysmlApiBaseUrl.value.trim();
  const project = outlineProjectId.value.trim();
  const commit = outlineCommitId.value.trim();
  return Boolean(base && project && commit);
});

const selectedOutlineNode = computed(() => {
  if (!outlineSelectedKey.value) {
    return null;
  }
  return outlineNodeIndex.get(outlineSelectedKey.value) ?? null;
});

const blockFormValid = computed(() => blockWizard.name.trim().length > 0);
const requirementFormValid = computed(
  () =>
    requirementWizard.name.trim().length > 0 &&
    requirementWizard.identifier.trim().length > 0 &&
    requirementWizard.text.trim().length > 0,
);
const stateFormValid = computed(() => stateWizard.name.trim().length > 0);

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

function handleWizardToggle(type: WizardType, event: Event) {
  const details = event.target as HTMLDetailsElement | null;
  const isOpen = Boolean(details?.open);
  wizardOpenState[type] = isOpen;
  if (isOpen) {
    wizardError[type] = null;
    wizardSuccess[type] = null;
    initializeWizard(type);
  }
}

function initializeWizard(type: WizardType) {
  switch (type) {
    case 'block': {
      if (!blockWizard.name.trim()) {
        const suggestion = `Block${generateSuffix()}`;
        blockWizard.name = suggestion;
      }
      if (!blockWizard.shortName.trim()) {
        blockWizard.shortName = blockWizard.name.trim();
      }
      break;
    }
    case 'requirement': {
      if (!requirementWizard.name.trim()) {
        const suggestion = `Requirement${generateSuffix()}`;
        requirementWizard.name = suggestion;
      }
      if (!requirementWizard.shortName.trim()) {
        requirementWizard.shortName = requirementWizard.name.trim();
      }
      if (!requirementWizard.identifier.trim()) {
        requirementWizard.identifier = `REQ-${generateSuffix(4)}`;
      }
      if (!requirementWizard.text.trim()) {
        requirementWizard.text = 'Describe the system requirement.';
      }
      break;
    }
    case 'state': {
      if (!stateWizard.name.trim()) {
        const suggestion = `State${generateSuffix()}`;
        stateWizard.name = suggestion;
      }
      if (!stateWizard.shortName.trim()) {
        stateWizard.shortName = stateWizard.name.trim();
      }
      break;
    }
    default:
      break;
  }
}

function resetWizardForm(type: WizardType) {
  switch (type) {
    case 'block':
      blockWizard.name = '';
      blockWizard.shortName = '';
      blockWizard.documentation = '';
      break;
    case 'requirement':
      requirementWizard.name = '';
      requirementWizard.shortName = '';
      requirementWizard.identifier = '';
      requirementWizard.text = '';
      requirementWizard.documentation = '';
      break;
    case 'state':
      stateWizard.name = '';
      stateWizard.shortName = '';
      stateWizard.documentation = '';
      break;
    default:
      break;
  }
  initializeWizard(type);
}

async function submitBlockWizard() {
  const input = {
    name: blockWizard.name.trim(),
    shortName: blockWizard.shortName.trim(),
    documentation: blockWizard.documentation.trim(),
  };
  await runWizardSubmission(
    'block',
    () => buildBlockUpsert(input),
    (record) => buildBlockSnippet(record, input),
    (record) => `Block ${input.name || record.id} created.`,
  );
}

async function submitRequirementWizard() {
  const input = {
    name: requirementWizard.name.trim(),
    shortName: requirementWizard.shortName.trim(),
    identifier: requirementWizard.identifier.trim(),
    text: requirementWizard.text.trim(),
    documentation: requirementWizard.documentation.trim(),
  };
  await runWizardSubmission(
    'requirement',
    () => buildRequirementUpsert(input),
    (record) => buildRequirementSnippet(record, input),
    (record) => `Requirement ${input.name || record.id} created.`,
  );
}

async function submitStateWizard() {
  const input = {
    name: stateWizard.name.trim(),
    shortName: stateWizard.shortName.trim(),
    documentation: stateWizard.documentation.trim(),
  };
  await runWizardSubmission(
    'state',
    () => buildStateUpsert(input),
    (record) => buildStateSnippet(record, input),
    (record) => `State ${input.name || record.id} created.`,
  );
}

async function runWizardSubmission(
  type: WizardType,
  buildBody: () => ElementUpsert,
  buildSnippet: (record: ApiElementRecord) => string,
  buildSuccessMessage: (record: ApiElementRecord) => string,
) {
  if (wizardSubmitting[type]) {
    return;
  }
  wizardError[type] = null;
  wizardSuccess[type] = null;
  if (!wizardApiReady.value) {
    wizardError[type] = 'Configure the SysML API connection before creating elements.';
    return;
  }

  try {
    wizardSubmitting[type] = true;
    const body = buildBody();
    const record = await createElementViaApi(body);
    const snippet = buildSnippet(record);
    if (snippet.trim().length) {
      appendEditorSnippet(snippet);
    }
    outlinePendingFocusElementId = record.id;
    try {
      await refreshOutline();
    } catch (error) {
      console.error('Wizard outline refresh failed', error);
    }
    wizardSuccess[type] = buildSuccessMessage(record);
    resetWizardForm(type);
  } catch (error) {
    wizardError[type] = error instanceof Error ? error.message : 'Request failed.';
  } finally {
    wizardSubmitting[type] = false;
  }
}

function buildBlockUpsert(input: {
  name: string;
  shortName: string;
  documentation: string;
}): ElementUpsert {
  const payload: Record<string, unknown> = {
    '@type': 'BlockDefinition',
  };
  if (input.name) {
    payload.declaredName = input.name;
  }
  if (input.shortName) {
    payload.declaredShortName = input.shortName;
  }
  return {
    classifierId: 'sysml:BlockDefinition',
    name: input.name || undefined,
    documentation: input.documentation || undefined,
    payload,
  };
}

function buildRequirementUpsert(input: {
  name: string;
  shortName: string;
  identifier: string;
  text: string;
  documentation: string;
}): ElementUpsert {
  const payload: Record<string, unknown> = {
    '@type': 'RequirementDefinition',
  };
  if (input.name) {
    payload.declaredName = input.name;
  }
  if (input.shortName) {
    payload.declaredShortName = input.shortName;
  }
  if (input.identifier) {
    payload.reqId = input.identifier;
  }
  if (input.text) {
    payload.text = [input.text];
  }
  return {
    classifierId: 'sysml:RequirementDefinition',
    name: input.name || undefined,
    documentation: input.documentation || undefined,
    payload,
  };
}

function buildStateUpsert(input: {
  name: string;
  shortName: string;
  documentation: string;
}): ElementUpsert {
  const payload: Record<string, unknown> = {
    '@type': 'StateDefinition',
  };
  if (input.name) {
    payload.declaredName = input.name;
  }
  if (input.shortName) {
    payload.declaredShortName = input.shortName;
  }
  return {
    classifierId: 'sysml:StateDefinition',
    name: input.name || undefined,
    documentation: input.documentation || undefined,
    payload,
  };
}

function buildBlockSnippet(record: ApiElementRecord, input: {
  name: string;
  documentation: string;
}): string {
  const identifier = toSnippetIdentifier(input.name, 'NewBlock');
  const lines = [`block ${identifier} {`, `  id = ${JSON.stringify(record.id)};`];
  if (input.documentation) {
    lines.push(`  documentation = ${JSON.stringify(input.documentation)};`);
  }
  lines.push('}');
  return lines.join('\n');
}

function buildRequirementSnippet(record: ApiElementRecord, input: {
  name: string;
  identifier: string;
  text: string;
}): string {
  const identifierName = toSnippetIdentifier(input.name, 'NewRequirement');
  const lines = [`requirement ${identifierName} {`, `  id = ${JSON.stringify(record.id)};`];
  if (input.identifier) {
    lines.push(`  reqId = ${JSON.stringify(input.identifier)};`);
  }
  if (input.text) {
    lines.push(`  text = ${JSON.stringify(input.text)};`);
  }
  lines.push('}');
  return lines.join('\n');
}

function buildStateSnippet(record: ApiElementRecord, input: { name: string }): string {
  const identifier = toSnippetIdentifier(input.name, 'NewState');
  const lines = [`state ${identifier} {`, `  id = ${JSON.stringify(record.id)};`, '}'];
  return lines.join('\n');
}

async function createElementViaApi(body: ElementUpsert): Promise<ApiElementRecord> {
  const config = getOutlineConfig();
  if (!config) {
    throw new Error('API base URL, project ID, and commit ID are required.');
  }
  const response = await fetch(buildElementUrl(config), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new Error('Response from element creation was not valid JSON.');
    }
  }
  if (!response.ok) {
    const message =
      isRecord(payload) && typeof payload.message === 'string'
        ? payload.message
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  const record = parseElementRecord(payload);
  outlineElementCache.set(record.id, record);
  return record;
}

function appendEditorSnippet(snippet: string) {
  if (!editorRef.value || !monacoApi) {
    return;
  }
  const editor = editorRef.value;
  const model = editor.getModel();
  if (!model) {
    return;
  }
  const existing = model.getValue();
  let prefix = '';
  if (existing.trim().length > 0) {
    if (existing.endsWith('\n\n')) {
      prefix = '';
    } else if (existing.endsWith('\n')) {
      prefix = '\n';
    } else {
      prefix = '\n\n';
    }
  }
  const text = `${prefix}${snippet}\n`;
  const lastLine = model.getLineCount();
  const lastColumn = model.getLineMaxColumn(lastLine);
  const range = new monacoApi.Range(lastLine, lastColumn, lastLine, lastColumn);
  editor.pushUndoStop();
  editor.executeEdits('wizard', [{ range, text }]);
  editor.pushUndoStop();
  scheduleValidation(true);
  const finalLine = model.getLineCount();
  editor.revealLine(finalLine);
  editor.focus();
}

function toSnippetIdentifier(name: string, fallback: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return fallback;
  }
  const sanitized = trimmed.replace(/[^A-Za-z0-9_]/g, '_');
  if (/^[A-Za-z_]/.test(sanitized)) {
    return sanitized;
  }
  return `${fallback}_${sanitized}`;
}

function generateSuffix(length = 3): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  let result = '';
  for (let index = 0; index < length; index += 1) {
    const next = Math.floor(Math.random() * chars.length);
    result += chars.charAt(next);
  }
  return result;
}

initializeWizard('block');
initializeWizard('requirement');
initializeWizard('state');

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
    if (outlinePendingFocusElementId) {
      const focusCandidates = outlineNodesByElementId.get(outlinePendingFocusElementId);
      if (focusCandidates && focusCandidates.length) {
        nextSelectionKey = focusCandidates[0].key;
      }
    }
    if (!nextSelectionKey && previousElementId) {
      const candidates = outlineNodesByElementId.get(previousElementId);
      if (candidates && candidates.length) {
        nextSelectionKey = candidates[0].key;
      }
    }
    if (!nextSelectionKey && rootNode.range) {
      nextSelectionKey = rootNode.key;
    }
    outlineSelectedKey.value = nextSelectionKey;
    outlinePendingFocusElementId = null;
  } catch (error) {
    if (signal.aborted) {
      return;
    }
    outlineError.value = error instanceof Error ? error.message : 'Failed to load outline.';
    outlineRoot.value = null;
    rebuildOutlineIndexes(null);
    outlineSelectedKey.value = null;
    outlinePendingFocusElementId = null;
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
  outlinePendingFocusElementId = null;
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
  const url = buildElementUrl(config, elementId);
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
  const url = buildElementUrl(config, elementId, 'owned-elements');
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

function buildElementUrl(config: OutlineConfig, elementId?: string, suffix?: string) {
  let url = `${config.baseUrl}/projects/${encodeURIComponent(config.projectId)}/commits/${encodeURIComponent(
    config.commitId,
  )}/elements`;
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
