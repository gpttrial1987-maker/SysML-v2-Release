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
      <aside class="timeline-rail">
        <header class="timeline-header">
          <div>
            <h2>Timeline</h2>
            <p>Projects, branches, commits, and tags</p>
          </div>
          <button
            type="button"
            class="timeline-refresh"
            @click="refreshTimeline"
            :disabled="timelineBusy || !normalizedApiBaseUrl"
          >
            {{ timelineBusy ? 'Refreshing…' : 'Refresh' }}
          </button>
        </header>
        <div class="timeline-config">
          <label>
            Project
            <select
              v-model="timelineSelectedProjectId"
              :disabled="timelineLoadingProjects || !timelineProjects.length"
            >
              <option value="" disabled>Select a project</option>
              <option v-for="project in timelineProjects" :key="project.id" :value="project.id">
                {{ project.name || project.id }}
              </option>
            </select>
          </label>
          <label>
            Branch
            <select v-model="timelineSelectedBranchId" :disabled="!timelineBranchOptions.length">
              <option v-for="branch in timelineBranchOptions" :key="branch.id" :value="branch.id">
                {{ branch.id }} · {{ branch.commitCount }} commits
              </option>
            </select>
          </label>
        </div>
        <div class="timeline-body">
          <p v-if="!normalizedApiBaseUrl" class="timeline-hint">
            Provide the API base URL to load the project timeline.
          </p>
          <p v-else-if="timelineError" class="timeline-error">{{ timelineError }}</p>
          <p v-else-if="timelineLoadingProjects || timelineLoadingCommits" class="timeline-status">
            Loading timeline…
          </p>
          <p v-else-if="!timelineVisibleCommits.length" class="timeline-status">
            No commits were found for the selected branch.
          </p>
          <ul v-else class="timeline-list">
            <li v-for="commit in timelineVisibleCommits" :key="commit.id">
              <button
                type="button"
                class="timeline-entry"
                :class="{ active: timelineSelectedCommitId === commit.id }"
                @click="selectTimelineCommit(commit.id)"
              >
                <span class="timeline-entry-title">{{ commit.message }}</span>
                <span class="timeline-entry-meta">
                  {{ formatCommitTime(commit.createdAt) }} · {{ commit.author }}
                </span>
                <span class="timeline-entry-meta">Branch · {{ commit.branchId }}</span>
                <div v-if="commit.parentIds.length" class="timeline-parents">
                  <span v-for="parent in commit.parentIds" :key="parent">
                    Parent · {{ formatCommitShortId(parent) }}
                  </span>
                </div>
                <div v-if="(timelineTagsByCommitId.get(commit.id) ?? []).length" class="timeline-tags">
                  <span v-for="tag in timelineTagsByCommitId.get(commit.id) ?? []" :key="tag.id">
                    {{ tag.name }}
                  </span>
                </div>
              </button>
            </li>
          </ul>
          <p v-if="timelineTagsError" class="timeline-warning">{{ timelineTagsError }}</p>
        </div>
        <section v-if="timelineSelectedCommit" class="timeline-actions">
          <div class="timeline-commit-details">
            <h3>{{ timelineSelectedCommit.message }}</h3>
            <p>
              {{ formatCommitTime(timelineSelectedCommit.createdAt) }} · {{ timelineSelectedCommit.author }}
            </p>
            <p>Branch · {{ timelineSelectedCommit.branchId }}</p>
            <div
              v-if="(timelineTagsByCommitId.get(timelineSelectedCommit.id) ?? []).length"
              class="timeline-selected-tags"
            >
              <span v-for="tag in timelineTagsByCommitId.get(timelineSelectedCommit.id) ?? []" :key="tag.id">
                {{ tag.name }}
              </span>
            </div>
          </div>
          <div class="timeline-feedback">
            <p v-if="timelineActionStatus" class="timeline-status-message">{{ timelineActionStatus }}</p>
            <p v-if="timelineActionError" class="timeline-error-message">{{ timelineActionError }}</p>
          </div>
          <form class="timeline-form" @submit.prevent="handleCreateBranch">
            <label>
              Create branch from this commit
              <input
                v-model="timelineBranchDraft"
                type="text"
                placeholder="feature/new-branch"
                spellcheck="false"
              />
            </label>
            <div class="timeline-form-actions">
              <button
                type="submit"
                :disabled="
                  timelineActionLoading ||
                  !timelineBranchDraft ||
                  !timelineSelectedProject ||
                  !timelineSelectedCommit
                "
              >
                {{ timelineActionLoading ? 'Creating…' : 'Create branch' }}
              </button>
            </div>
          </form>
          <form class="timeline-form" @submit.prevent="handleCreateTag">
            <label>
              Tag this commit
              <input v-model="timelineTagDraft" type="text" placeholder="v1.0.0" spellcheck="false" />
            </label>
            <div class="timeline-form-actions">
              <button
                type="submit"
                :disabled="
                  timelineActionLoading || !timelineTagDraft || !timelineSelectedProject || !timelineSelectedCommit
                "
              >
                {{ timelineActionLoading ? 'Saving…' : 'Create tag' }}
              </button>
            </div>
          </form>
          <form class="timeline-form" @submit.prevent="handleComputeDiff">
            <label>
              Compare against
              <select v-model="timelineDiffTargetId" :disabled="timelineVisibleCommits.length < 2">
                <option
                  v-for="commit in timelineVisibleCommits"
                  :key="commit.id"
                  :value="commit.id"
                  :disabled="commit.id === timelineSelectedCommitId"
                >
                  {{ commit.message }} · {{ formatCommitShortId(commit.id) }}
                </option>
              </select>
            </label>
            <div class="timeline-form-actions">
              <button type="submit" :disabled="timelineDiffLoading || !timelineDiffTargetId">
                {{ timelineDiffLoading ? 'Diffing…' : 'Diff commits' }}
              </button>
            </div>
          </form>
          <div class="timeline-diff-result" v-if="timelineDiffLoading">
            <p class="timeline-status">Building diff…</p>
          </div>
          <div class="timeline-diff-result" v-else-if="timelineDiffError">
            <p class="timeline-error">{{ timelineDiffError }}</p>
          </div>
          <div class="timeline-diff-result" v-else-if="timelineDiffResult">
            <h4>Diff summary</h4>
            <p>
              {{ timelineDiffResult.added.length }} added ·
              {{ timelineDiffResult.removed.length }} removed ·
              {{ timelineDiffResult.changed.length }} changed
            </p>
            <p
              v-if="
                !timelineDiffResult.added.length &&
                !timelineDiffResult.removed.length &&
                !timelineDiffResult.changed.length
              "
            >
              No differences detected between the selected commits.
            </p>
            <div v-if="timelineDiffResult.added.length">
              <h5>Added</h5>
              <ul>
                <li v-for="item in timelineDiffResult.added.slice(0, 5)" :key="item.id">
                  {{ item.name ?? item.id }} ({{ item.classifierId }})
                </li>
              </ul>
            </div>
            <div v-if="timelineDiffResult.removed.length">
              <h5>Removed</h5>
              <ul>
                <li v-for="item in timelineDiffResult.removed.slice(0, 5)" :key="item.id">
                  {{ item.name ?? item.id }} ({{ item.classifierId }})
                </li>
              </ul>
            </div>
            <div v-if="timelineDiffResult.changed.length">
              <h5>Changed</h5>
              <ul>
                <li v-for="item in timelineDiffResult.changed.slice(0, 5)" :key="item.id">
                  {{ item.after.name ?? item.id }} ({{ item.after.classifierId }})
                </li>
              </ul>
            </div>
          </div>
          <div class="timeline-form-actions timeline-restore">
            <button type="button" @click="restoreSelectedCommit" :disabled="timelineActionLoading">
              Restore to editor
            </button>
          </div>
        </section>
      </aside>
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
import { SysMLSDK } from '../../../src/sysml-sdk';
import type { CommitSummary, ElementRecord, ProjectSummary } from '../../../src/generated/types';

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

interface TimelineTag {
  id: string;
  name: string;
  commitId: string;
  createdAt?: string;
}

interface TimelineBranchOption {
  id: string;
  commitCount: number;
  lastCommitAt: number;
}

interface TimelineElementSnapshot {
  id: string;
  name?: string;
  classifierId: string;
}

interface TimelineElementChange {
  id: string;
  before: TimelineElementSnapshot;
  after: TimelineElementSnapshot;
}

interface TimelineDiffResult {
  added: TimelineElementSnapshot[];
  removed: TimelineElementSnapshot[];
  changed: TimelineElementChange[];
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

const normalizedApiBaseUrl = computed(() => sysmlApiBaseUrl.value.trim().replace(/\/+$/, ''));

const timelineSdk = shallowRef<SysMLSDK | null>(null);
const timelineProjects = ref<ProjectSummary[]>([]);
const timelineLoadingProjects = ref(false);
const timelineCommits = ref<CommitSummary[]>([]);
const timelineLoadingCommits = ref(false);
const timelineTags = ref<TimelineTag[]>([]);
const timelineLoadingTags = ref(false);
const timelineError = ref<string | null>(null);
const timelineTagsError = ref<string | null>(null);
const timelineSelectedProjectId = ref('');
const timelineSelectedBranchId = ref('');
const timelineSelectedCommitId = ref('');
const timelineBranchDraft = ref('');
const timelineTagDraft = ref('');
const timelineActionStatus = ref<string | null>(null);
const timelineActionError = ref<string | null>(null);
const timelineActionLoading = ref(false);
const timelineDiffTargetId = ref<string | null>(null);
const timelineDiffLoading = ref(false);
const timelineDiffError = ref<string | null>(null);
const timelineDiffResult = ref<TimelineDiffResult | null>(null);

const timelineBusy = computed(
  () => timelineLoadingProjects.value || timelineLoadingCommits.value || timelineLoadingTags.value,
);
const timelineSelectedProject = computed(
  () => timelineProjects.value.find((project) => project.id === timelineSelectedProjectId.value) ?? null,
);
const timelineBranchOptions = computed<TimelineBranchOption[]>(() => {
  const project = timelineSelectedProject.value;
  const commits = timelineCommits.value;
  const map = new Map<string, TimelineBranchOption>();
  for (const commit of commits) {
    const timestamp = Date.parse(commit.createdAt);
    const createdAt = Number.isNaN(timestamp) ? 0 : timestamp;
    const existing = map.get(commit.branchId);
    if (existing) {
      existing.commitCount += 1;
      existing.lastCommitAt = Math.max(existing.lastCommitAt, createdAt);
    } else {
      map.set(commit.branchId, {
        id: commit.branchId,
        commitCount: 1,
        lastCommitAt: createdAt,
      });
    }
  }
  const options = Array.from(map.values());
  options.sort((a, b) => {
    if (project?.defaultBranch && a.id === project.defaultBranch) {
      return -1;
    }
    if (project?.defaultBranch && b.id === project.defaultBranch) {
      return 1;
    }
    return b.lastCommitAt - a.lastCommitAt;
  });
  return options;
});
const timelineVisibleCommits = computed<CommitSummary[]>(() => {
  const branchId = timelineSelectedBranchId.value;
  const source = branchId
    ? timelineCommits.value.filter((commit) => commit.branchId === branchId)
    : [...timelineCommits.value];
  return source.sort((a, b) => {
    const left = Date.parse(a.createdAt);
    const right = Date.parse(b.createdAt);
    const leftTs = Number.isNaN(left) ? 0 : left;
    const rightTs = Number.isNaN(right) ? 0 : right;
    return rightTs - leftTs;
  });
});
const timelineSelectedCommit = computed<CommitSummary | null>(
  () => timelineVisibleCommits.value.find((commit) => commit.id === timelineSelectedCommitId.value) ?? null,
);
const timelineTagsByCommitId = computed(() => {
  const map = new Map<string, TimelineTag[]>();
  for (const tag of timelineTags.value) {
    const bucket = map.get(tag.commitId);
    if (bucket) {
      bucket.push(tag);
    } else {
      map.set(tag.commitId, [tag]);
    }
  }
  for (const bucket of map.values()) {
    bucket.sort((a, b) => a.name.localeCompare(b.name));
  }
  return map;
});

let timelineProjectsRequestId = 0;
let timelineCommitsRequestId = 0;
let timelineTagsRequestId = 0;

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
  normalizedApiBaseUrl,
  (base) => {
    timelineProjectsRequestId = 0;
    timelineCommitsRequestId = 0;
    timelineTagsRequestId = 0;
    timelineProjects.value = [];
    timelineCommits.value = [];
    timelineTags.value = [];
    timelineError.value = null;
    timelineTagsError.value = null;
    timelineSelectedProjectId.value = '';
    timelineSelectedBranchId.value = '';
    timelineSelectedCommitId.value = '';
    timelineBranchDraft.value = '';
    timelineTagDraft.value = '';
    timelineDiffTargetId.value = null;
    timelineDiffResult.value = null;
    timelineDiffError.value = null;
    timelineActionStatus.value = null;
    timelineActionError.value = null;
    timelineSdk.value = base ? new SysMLSDK({ baseUrl: base }) : null;
    if (timelineSdk.value) {
      loadTimelineProjects().catch((error) => {
        console.error('Timeline project load error', error);
      });
    }
  },
  { immediate: true },
);

watch(timelineSelectedProjectId, (projectId) => {
  timelineSelectedBranchId.value = '';
  timelineSelectedCommitId.value = '';
  timelineDiffTargetId.value = null;
  timelineDiffResult.value = null;
  timelineDiffError.value = null;
  timelineBranchDraft.value = '';
  timelineTagDraft.value = '';
  timelineActionStatus.value = null;
  timelineActionError.value = null;
  if (!projectId || !timelineSdk.value) {
    timelineCommits.value = [];
    timelineTags.value = [];
    return;
  }
  loadTimelineCommits(projectId).catch((error) => {
    console.error('Timeline commit load error', error);
  });
  loadTimelineTags(projectId).catch((error) => {
    console.error('Timeline tag load error', error);
  });
});

watch(
  timelineBranchOptions,
  (options) => {
    if (!options.length) {
      if (timelineSelectedBranchId.value) {
        timelineSelectedBranchId.value = '';
      }
      return;
    }
    if (options.some((option) => option.id === timelineSelectedBranchId.value)) {
      return;
    }
    const defaultBranch = timelineSelectedProject.value?.defaultBranch;
    const fallback = (defaultBranch && options.find((option) => option.id === defaultBranch)) ?? options[0];
    if (fallback.id !== timelineSelectedBranchId.value) {
      timelineSelectedBranchId.value = fallback.id;
    }
  },
  { immediate: true },
);

watch(
  timelineVisibleCommits,
  (commits) => {
    if (!commits.length) {
      if (timelineSelectedCommitId.value) {
        timelineSelectedCommitId.value = '';
      }
      return;
    }
    if (!commits.some((commit) => commit.id === timelineSelectedCommitId.value)) {
      timelineSelectedCommitId.value = commits[0].id;
    }
  },
  { immediate: true },
);

watch(
  [timelineSelectedCommitId, timelineVisibleCommits],
  ([selectedId, commits]) => {
    if (!commits.length) {
      timelineDiffTargetId.value = null;
      return;
    }
    if (
      selectedId &&
      timelineDiffTargetId.value &&
      timelineDiffTargetId.value !== selectedId &&
      commits.some((commit) => commit.id === timelineDiffTargetId.value)
    ) {
      return;
    }
    const fallback = commits.find((commit) => commit.id !== selectedId);
    timelineDiffTargetId.value = fallback ? fallback.id : null;
  },
  { immediate: true },
);

watch(timelineSelectedCommitId, () => {
  timelineActionStatus.value = null;
  timelineActionError.value = null;
  timelineBranchDraft.value = '';
  timelineTagDraft.value = '';
});

watch(
  [timelineSelectedCommitId, timelineDiffTargetId],
  () => {
    timelineDiffResult.value = null;
    timelineDiffError.value = null;
  },
);

async function loadTimelineProjects(): Promise<void> {
  const sdk = timelineSdk.value;
  if (!sdk) {
    return;
  }
  const requestId = ++timelineProjectsRequestId;
  timelineLoadingProjects.value = true;
  timelineError.value = null;
  try {
    const response = await sdk.listProjects({ limit: 100 });
    if (requestId !== timelineProjectsRequestId) {
      return;
    }
    timelineProjects.value = response.items;
    if (!response.items.some((project) => project.id === timelineSelectedProjectId.value)) {
      timelineSelectedProjectId.value = response.items[0]?.id ?? '';
    }
  } catch (error) {
    if (requestId === timelineProjectsRequestId) {
      timelineProjects.value = [];
      timelineError.value = toErrorMessage(error);
      timelineSelectedProjectId.value = '';
    }
  } finally {
    if (requestId === timelineProjectsRequestId) {
      timelineLoadingProjects.value = false;
    }
  }
}

async function loadTimelineCommits(projectId: string): Promise<void> {
  const sdk = timelineSdk.value;
  if (!sdk) {
    return;
  }
  const requestId = ++timelineCommitsRequestId;
  timelineLoadingCommits.value = true;
  timelineError.value = null;
  try {
    const commits: CommitSummary[] = [];
    let cursor: string | undefined;
    const LIMIT = 100;
    const MAX_PAGES = 10;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const response = await sdk.listCommits({ projectId, cursor, limit: LIMIT });
      commits.push(...response.items);
      if (!response.cursor) {
        break;
      }
      cursor = response.cursor;
    }
    if (requestId !== timelineCommitsRequestId) {
      return;
    }
    timelineCommits.value = commits;
  } catch (error) {
    if (requestId === timelineCommitsRequestId) {
      timelineCommits.value = [];
      timelineError.value = toErrorMessage(error);
    }
  } finally {
    if (requestId === timelineCommitsRequestId) {
      timelineLoadingCommits.value = false;
    }
  }
}

async function loadTimelineTags(projectId: string): Promise<void> {
  const baseUrl = normalizedApiBaseUrl.value;
  if (!baseUrl) {
    timelineTags.value = [];
    timelineTagsError.value = null;
    return;
  }
  const requestId = ++timelineTagsRequestId;
  timelineLoadingTags.value = true;
  timelineTagsError.value = null;
  try {
    const response = await fetch(`${baseUrl}/projects/${encodeURIComponent(projectId)}/tags`);
    if (!response.ok) {
      throw new Error(`Failed to load tags (${response.status})`);
    }
    if (response.status === 204) {
      if (requestId === timelineTagsRequestId) {
        timelineTags.value = [];
      }
      return;
    }
    const payload = await response.json();
    if (requestId !== timelineTagsRequestId) {
      return;
    }
    timelineTags.value = parseTimelineTags(payload);
  } catch (error) {
    if (requestId === timelineTagsRequestId) {
      timelineTags.value = [];
      timelineTagsError.value = toErrorMessage(error);
    }
  } finally {
    if (requestId === timelineTagsRequestId) {
      timelineLoadingTags.value = false;
    }
  }
}

async function refreshTimeline(): Promise<void> {
  if (!timelineSdk.value) {
    timelineError.value = 'Provide a valid API base URL before refreshing the timeline.';
    return;
  }
  timelineError.value = null;
  await loadTimelineProjects();
  const projectId = timelineSelectedProjectId.value;
  if (projectId) {
    await Promise.all([loadTimelineCommits(projectId), loadTimelineTags(projectId)]);
  }
}

function selectTimelineCommit(commitId: string) {
  if (timelineSelectedCommitId.value !== commitId) {
    timelineSelectedCommitId.value = commitId;
  }
}

function formatCommitTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function formatCommitShortId(id: string): string {
  if (id.length <= 12) {
    return id;
  }
  return `${id.slice(0, 7)}…`;
}

async function handleCreateBranch(): Promise<void> {
  if (timelineActionLoading.value) {
    return;
  }
  const project = timelineSelectedProject.value;
  const commit = timelineSelectedCommit.value;
  const branchName = timelineBranchDraft.value.trim();
  const baseUrl = normalizedApiBaseUrl.value;
  if (!project || !commit) {
    timelineActionError.value = 'Select a project and commit before creating a branch.';
    return;
  }
  if (!branchName) {
    timelineActionError.value = 'Branch name is required.';
    return;
  }
  if (!baseUrl) {
    timelineActionError.value = 'Provide the API base URL before creating a branch.';
    return;
  }
  timelineActionLoading.value = true;
  timelineActionStatus.value = null;
  timelineActionError.value = null;
  try {
    const response = await fetch(`${baseUrl}/projects/${encodeURIComponent(project.id)}/branches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: branchName,
        name: branchName,
        fromCommitId: commit.id,
      }),
    });
    if (!response.ok && response.status !== 204) {
      const detail = await extractResponseMessage(response);
      throw new Error(detail ?? `Branch creation failed with status ${response.status}`);
    }
    timelineActionStatus.value = `Branch "${branchName}" created from commit ${formatCommitShortId(commit.id)}.`;
    timelineBranchDraft.value = '';
    await loadTimelineCommits(project.id);
  } catch (error) {
    timelineActionError.value = toErrorMessage(error);
  } finally {
    timelineActionLoading.value = false;
  }
}

async function handleCreateTag(): Promise<void> {
  if (timelineActionLoading.value) {
    return;
  }
  const project = timelineSelectedProject.value;
  const commit = timelineSelectedCommit.value;
  const tagName = timelineTagDraft.value.trim();
  const baseUrl = normalizedApiBaseUrl.value;
  if (!project || !commit) {
    timelineActionError.value = 'Select a project and commit before creating a tag.';
    return;
  }
  if (!tagName) {
    timelineActionError.value = 'Tag name is required.';
    return;
  }
  if (!baseUrl) {
    timelineActionError.value = 'Provide the API base URL before creating a tag.';
    return;
  }
  timelineActionLoading.value = true;
  timelineActionStatus.value = null;
  timelineActionError.value = null;
  try {
    const response = await fetch(`${baseUrl}/projects/${encodeURIComponent(project.id)}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: tagName,
        name: tagName,
        commitId: commit.id,
      }),
    });
    if (!response.ok && response.status !== 204) {
      const detail = await extractResponseMessage(response);
      throw new Error(detail ?? `Tag creation failed with status ${response.status}`);
    }
    timelineActionStatus.value = `Tag "${tagName}" added to commit ${formatCommitShortId(commit.id)}.`;
    timelineTagDraft.value = '';
    await loadTimelineTags(project.id);
  } catch (error) {
    timelineActionError.value = toErrorMessage(error);
  } finally {
    timelineActionLoading.value = false;
  }
}

async function handleComputeDiff(): Promise<void> {
  const project = timelineSelectedProject.value;
  const sourceCommit = timelineSelectedCommit.value;
  const targetCommitId = timelineDiffTargetId.value;
  const sdk = timelineSdk.value;
  if (!project || !sourceCommit || !targetCommitId) {
    timelineDiffError.value = 'Select two commits to compare.';
    timelineDiffResult.value = null;
    return;
  }
  if (!sdk) {
    timelineDiffError.value = 'Provide the API base URL before diffing commits.';
    timelineDiffResult.value = null;
    return;
  }
  if (sourceCommit.id === targetCommitId) {
    timelineDiffError.value = 'Choose a different commit to compare against.';
    timelineDiffResult.value = null;
    return;
  }
  timelineDiffLoading.value = true;
  timelineDiffError.value = null;
  timelineDiffResult.value = null;
  try {
    const [baseline, target] = await Promise.all([
      fetchAllElementsForCommit(project.id, sourceCommit.id, sdk),
      fetchAllElementsForCommit(project.id, targetCommitId, sdk),
    ]);
    timelineDiffResult.value = computeElementDiff(baseline, target);
  } catch (error) {
    timelineDiffError.value = toErrorMessage(error);
    timelineDiffResult.value = null;
  } finally {
    timelineDiffLoading.value = false;
  }
}

async function fetchAllElementsForCommit(
  projectId: string,
  commitId: string,
  sdk: SysMLSDK,
): Promise<ElementRecord[]> {
  const items: ElementRecord[] = [];
  let cursor: string | undefined;
  const LIMIT = 200;
  const MAX_PAGES = 15;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await sdk.listElements({ projectId, commitId, cursor, limit: LIMIT });
    items.push(...response.items);
    if (!response.cursor) {
      break;
    }
    cursor = response.cursor;
  }
  return items;
}

function computeElementDiff(
  baseline: ElementRecord[],
  target: ElementRecord[],
): TimelineDiffResult {
  const baselineMap = new Map<string, ElementRecord>();
  for (const element of baseline) {
    baselineMap.set(element.id, element);
  }
  const targetMap = new Map<string, ElementRecord>();
  for (const element of target) {
    targetMap.set(element.id, element);
  }
  const added: TimelineElementSnapshot[] = [];
  const removed: TimelineElementSnapshot[] = [];
  const changed: TimelineElementChange[] = [];
  for (const [id, element] of targetMap) {
    const previous = baselineMap.get(id);
    if (!previous) {
      added.push(toTimelineSnapshot(element));
      continue;
    }
    if (fingerprintElement(previous) !== fingerprintElement(element)) {
      changed.push({
        id,
        before: toTimelineSnapshot(previous),
        after: toTimelineSnapshot(element),
      });
    }
  }
  for (const [id, element] of baselineMap) {
    if (!targetMap.has(id)) {
      removed.push(toTimelineSnapshot(element));
    }
  }
  added.sort((a, b) => a.id.localeCompare(b.id));
  removed.sort((a, b) => a.id.localeCompare(b.id));
  changed.sort((a, b) => a.id.localeCompare(b.id));
  return { added, removed, changed };
}

function toTimelineSnapshot(element: ElementRecord): TimelineElementSnapshot {
  return {
    id: element.id,
    name: element.name,
    classifierId: element.classifierId,
  };
}

function fingerprintElement(element: ElementRecord): string {
  return stableSerialize(
    sortObject({
      name: element.name ?? null,
      documentation: element.documentation ?? null,
      classifierId: element.classifierId,
      payload: element.payload,
    }),
  );
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortObject(item));
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    const result: Record<string, unknown> = {};
    for (const [key, entryValue] of entries) {
      result[key] = sortObject(entryValue);
    }
    return result;
  }
  return value;
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(sortObject(value));
}

async function extractResponseMessage(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text();
    if (!text) {
      return undefined;
    }
    try {
      const payload = JSON.parse(text) as Record<string, unknown>;
      const message =
        payload.message ?? payload.error ?? payload.detail ?? payload.description ?? payload.title;
      if (typeof message === 'string' && message.trim()) {
        return message;
      }
    } catch {
      // Ignore JSON parse errors and fall back to the plain text body
    }
    return text;
  } catch {
    return undefined;
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'An unexpected error occurred.';
}

function parseTimelineTags(payload: unknown): TimelineTag[] {
  const source = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as Record<string, unknown>)?.items)
      ? ((payload as Record<string, unknown>).items as unknown[])
      : Array.isArray((payload as Record<string, unknown>)?.data)
        ? ((payload as Record<string, unknown>).data as unknown[])
        : [];
  const unique = new Map<string, TimelineTag>();
  for (const entry of source) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const nameCandidate = record.name ?? record.tag ?? record.label ?? record.id;
    const name = typeof nameCandidate === 'string' ? nameCandidate : undefined;
    const commitCandidate =
      record.commitId ?? record.targetCommitId ?? record.commit ?? record.referenceCommitId;
    const commitId = typeof commitCandidate === 'string' ? commitCandidate : undefined;
    if (!name || !commitId) {
      continue;
    }
    const idCandidate = record.id ?? `${commitId}:${name}`;
    const id = typeof idCandidate === 'string' ? idCandidate : `${commitId}:${name}`;
    const createdAtCandidate = record.createdAt ?? record.timestamp ?? record.created ?? record.date;
    const createdAt = typeof createdAtCandidate === 'string' ? createdAtCandidate : undefined;
    unique.set(id, { id, name, commitId, createdAt });
  }
  const result = Array.from(unique.values());
  result.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

function restoreSelectedCommit() {
  const project = timelineSelectedProject.value;
  const commit = timelineSelectedCommit.value;
  if (!project || !commit) {
    return;
  }
  outlineProjectId.value = project.id;
  outlineCommitId.value = commit.id;
  timelineActionStatus.value = `Outline configured to ${project.name || project.id} at ${formatCommitShortId(commit.id)}.`;
  timelineActionError.value = null;
}

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
