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
          <div class="library-import">
            <div class="library-import-header">
              <h3>Import official library</h3>
              <button
                type="button"
                class="import-button"
                @click="triggerLibraryImport"
                :disabled="importInProgress || !libraryImportReady"
              >
                {{ importInProgress ? 'Importing…' : 'Import Library' }}
              </button>
            </div>
            <p class="library-import-hint">
              Load the <code>sysml.library</code> package from the official release repository into the
              configured project. A new commit will be created by the API.
            </p>
            <p
              v-if="importStatusMessage"
              class="import-status"
              :class="importState"
              aria-live="polite"
            >
              {{ importStatusMessage }}
            </p>
            <ul v-if="importLogs.length" class="import-progress">
              <li v-for="(entry, index) in importLogs" :key="index">{{ entry }}</li>
            </ul>
            <pre v-if="importErrorDetails" class="import-error-details">{{ importErrorDetails }}</pre>
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
            <div
              v-if="selectedOutlineNode"
              class="outline-rename-panel"
              role="group"
              aria-labelledby="outline-rename-label"
            >
              <div class="outline-rename-header">
                <h3 id="outline-rename-label">Rename element</h3>
                <p class="outline-rename-hint">Updates the element and all references via the API.</p>
              </div>
              <label class="outline-rename-field" for="outline-rename-input">
                New name
                <input
                  id="outline-rename-input"
                  v-model="renameDraft"
                  type="text"
                  :disabled="renameBusy"
                  spellcheck="false"
                />
              </label>
              <div class="outline-rename-actions">
                <button
                  type="button"
                  class="outline-rename-submit"
                  @click="submitRename"
                  :disabled="renameBusy || !renameHasChanges"
                >
                  {{ renameBusy ? 'Renaming…' : 'Rename' }}
                </button>
                <button
                  type="button"
                  class="outline-rename-reset"
                  @click="resetRenameDraft"
                  :disabled="renameBusy"
                >
                  Reset
                </button>
              </div>
              <p v-if="renameError" class="outline-error">{{ renameError }}</p>
            </div>
          </div>
        </section>
        <section class="plantuml-section">
          <div class="plantuml-header">
            <h2>PlantUML Preview</h2>
            <button
              type="button"
              class="plantuml-refresh"
              @click="refreshPlantUmlPreview"
              :disabled="plantUmlLoading || !plantUmlCanRender"
            >
              {{ plantUmlLoading ? 'Rendering…' : 'Refresh' }}
            </button>
          </div>
          <div class="plantuml-config">
            <label>
              Server endpoint
              <input
                v-model="plantUmlServerUrl"
                type="url"
                placeholder="https://www.plantuml.com/plantuml/svg"
                spellcheck="false"
              />
            </label>
          </div>
          <div class="plantuml-body">
            <p v-if="!selectedOutlineNode" class="plantuml-hint">
              Select an outline element to generate a diagram.
            </p>
            <p v-else-if="!plantUmlCanRender" class="plantuml-hint">
              Provide the PlantUML server endpoint to render diagrams.
            </p>
            <p v-else-if="plantUmlError" class="plantuml-error">{{ plantUmlError }}</p>
            <p v-else-if="plantUmlLoading" class="plantuml-status">Rendering diagram…</p>
            <div v-else-if="plantUmlImageUrl" class="plantuml-preview">
              <img :src="plantUmlImageUrl" alt="PlantUML diagram preview" />
            </div>
            <p v-else class="plantuml-status">Diagram preview unavailable.</p>
          </div>
          <details v-if="plantUmlSource" class="plantuml-source">
            <summary>PlantUML source</summary>
            <pre>{{ plantUmlSource }}</pre>
          </details>
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
import { SysMLSDK } from '../../../src/sysml-sdk';
import type { CommitSummary, ElementRecord, ProjectSummary } from '../../../src/generated/types';

import { mergeChanges, formatLineRange, type MergeConflict } from './diff-utils';

type MonacoApi = typeof import('monaco-editor');

type ValidationState = 'idle' | 'running' | 'success' | 'error' | 'info';

type IssueSeverity = 'error' | 'warning' | 'info';

type ImportState = 'idle' | 'running' | 'success' | 'error';

const OFFICIAL_LIBRARY_REPOSITORY_URL = 'https://github.com/Systems-Modeling/SysML-v2-Release.git';
const OFFICIAL_LIBRARY_REFERENCE = 'main';
const OFFICIAL_LIBRARY_DIRECTORY = 'sysml.library';

interface ImportOperationStatus {
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';
  message?: string;
  logs: string[];
  result: unknown;
  error: unknown;
}

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
interface TextEditPatch {
  range: NormalizedRange;
  text: string;
}

interface RenameRefactorResult {
  patches: TextEditPatch[];
  elements: ApiElementRecord[];
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

const importState = ref<ImportState>('idle');
const importStatusMessage = ref('');
const importLogs = ref<string[]>([]);
const importErrorDetails = ref<string | null>(null);
const importAbortController = ref<AbortController | null>(null);

const libraryImportReady = computed(
  () => sysmlApiBaseUrl.value.trim().length > 0 && outlineProjectId.value.trim().length > 0,
);

const outlineReadyToLoad = computed(
  () =>
    sysmlApiBaseUrl.value.trim().length > 0 &&
    outlineProjectId.value.trim().length > 0 &&
    outlineCommitId.value.trim().length > 0 &&
    outlineRootElementId.value.trim().length > 0,
);

const outlineItems = computed<OutlineListItem[]>(() => {
  // track updates to existing outline nodes without rebuilding the tree
  // eslint-disable-next-line no-unused-expressions
  outlineRevision.value;
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
const importInProgress = computed(() => importState.value === 'running');
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
const outlineRevision = ref(0);
const renameDraft = ref('');
const renameBusy = ref(false);
const renameError = ref<string | null>(null);

const plantUmlServerUrl = ref(
  import.meta.env.VITE_PLANTUML_SERVER_URL ?? 'https://www.plantuml.com/plantuml/svg',
);
const plantUmlSource = ref('');
const plantUmlImageUrl = ref<string | null>(null);
const plantUmlError = ref<string | null>(null);
const plantUmlLoading = ref(false);
const normalizedPlantUmlServerUrl = computed(() => plantUmlServerUrl.value.trim());
const plantUmlCanRender = computed(
  () => !!selectedOutlineNode.value && !!normalizedPlantUmlServerUrl.value,
);

let plantUmlAbortController: AbortController | null = null;
let plantUmlObjectUrl: string | null = null;
let plantUmlRequestId = 0;

const selectedOutlineNode = computed(() =>
  outlineSelectedKey.value ? outlineNodeIndex.get(outlineSelectedKey.value) ?? null : null,
);

const renameHasChanges = computed(() => {
  const node = selectedOutlineNode.value;
  if (!node) {
    return false;
  }
  const draft = renameDraft.value.trim();
  if (!draft) {
    return false;
  }
  return draft !== node.label.trim();
});

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

watch([sysmlApiBaseUrl, outlineProjectId], () => {
  if (importAbortController.value) {
    importAbortController.value.abort();
    importAbortController.value = null;
  }
  resetImportState();
});

onBeforeUnmount(() => {
  if (validationTimer) {
    clearTimeout(validationTimer);
  }
  if (outlineConfigTimer) {
    clearTimeout(outlineConfigTimer);
    outlineConfigTimer = null;
  }
  cancelPlantUmlRequest();
  clearPlantUmlDiagram();
  if (outlineAbortController) {
    outlineAbortController.abort();
    outlineAbortController = null;
  }
  if (importAbortController.value) {
    importAbortController.value.abort();
    importAbortController.value = null;
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

function triggerLibraryImport() {
  if (importInProgress.value) {
    return;
  }
  importOfficialLibrary().catch((error) => {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return;
    }
    console.error('Library import error', error);
  });
}

async function importOfficialLibrary() {
  const baseUrl = sysmlApiBaseUrl.value.trim();
  const projectId = outlineProjectId.value.trim();

  if (!baseUrl || !projectId) {
    importState.value = 'error';
    importStatusMessage.value = 'API base URL and project ID are required to import the library.';
    importErrorDetails.value = null;
    return;
  }

  if (importAbortController.value) {
    importAbortController.value.abort();
    importAbortController.value = null;
  }

  const controller = new AbortController();
  importAbortController.value = controller;

  importLogs.value = [];
  importErrorDetails.value = null;
  importState.value = 'running';
  importStatusMessage.value = 'Submitting library import request…';
  appendImportLog('Requesting import from official SysML v2 release repository…');

  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const targetUrl = `${normalizedBaseUrl}/projects/${encodeURIComponent(projectId)}/library-imports`;

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source: {
          type: 'git',
          repositoryUrl: OFFICIAL_LIBRARY_REPOSITORY_URL,
          directory: OFFICIAL_LIBRARY_DIRECTORY,
          reference: OFFICIAL_LIBRARY_REFERENCE,
        },
      }),
      signal: controller.signal,
    });

    const payload = await safeJson(response);
    const location = response.headers.get('location');

    if (!response.ok && response.status !== 202) {
      const message =
        isRecord(payload) && typeof payload.message === 'string'
          ? payload.message
          : `Import request failed with status ${response.status}`;
      importState.value = 'error';
      importStatusMessage.value = message;
      importErrorDetails.value = formatImportErrorDetail(payload);
      return;
    }

    if (response.status === 202 && location) {
      appendImportLog('Import queued on server. Monitoring progress…');
      const statusUrl = resolveStatusUrl(location, normalizedBaseUrl);
      await pollImportStatus(statusUrl, controller.signal);
      return;
    }

    appendImportLog('Import completed.');
    const successMessage =
      extractImportMessage(payload) ?? 'Library import completed successfully.';
    importStatusMessage.value = successMessage;
    importState.value = 'success';
    const summary = extractImportSummary(payload);
    if (summary) {
      appendImportLog(summary);
    }
  } catch (error) {
    if (controller.signal.aborted) {
      return;
    }
    importState.value = 'error';
    importStatusMessage.value =
      error instanceof Error ? error.message : 'Library import failed.';
    importErrorDetails.value = formatImportErrorDetail(error);
    throw error;
  } finally {
    if (importAbortController.value === controller) {
      importAbortController.value = null;
    }
  }
}

async function pollImportStatus(statusUrl: string, signal: AbortSignal) {
  let attempt = 0;
  const maxAttempts = 120;

  while (attempt < maxAttempts) {
    if (signal.aborted) {
      return;
    }

    if (attempt > 0) {
      await sleep(Math.min(2000, 500 + attempt * 250));
      if (signal.aborted) {
        return;
      }
    }

    attempt += 1;
    const response = await fetch(statusUrl, { signal });

    if (response.status === 204) {
      importState.value = 'success';
      importStatusMessage.value = 'Library import completed successfully.';
      return;
    }

    const payload = await safeJson(response);

    if (!response.ok) {
      const message =
        isRecord(payload) && typeof payload.message === 'string'
          ? payload.message
          : `Failed to retrieve import status (status ${response.status}).`;
      importState.value = 'error';
      importStatusMessage.value = message;
      importErrorDetails.value = formatImportErrorDetail(payload);
      return;
    }

    const statusInfo = interpretImportStatus(payload);

    if (statusInfo.logs) {
      for (const entry of statusInfo.logs) {
        appendImportLog(entry);
      }
    }

    if (statusInfo.message) {
      importStatusMessage.value = statusInfo.message;
    }

    if (statusInfo.status === 'succeeded') {
      importState.value = 'success';
      const message =
        extractImportMessage(statusInfo.result) ??
        statusInfo.message ??
        'Library import completed successfully.';
      importStatusMessage.value = message;
      const summary = extractImportSummary(statusInfo.result);
      if (summary) {
        appendImportLog(summary);
      }
      return;
    }

    if (statusInfo.status === 'failed' || statusInfo.status === 'cancelled') {
      importState.value = 'error';
      importStatusMessage.value =
        statusInfo.message ??
        (statusInfo.status === 'cancelled'
          ? 'Library import was cancelled by the server.'
          : 'Library import failed.');
      importErrorDetails.value = formatImportErrorDetail(
        statusInfo.error ?? statusInfo.result ?? payload,
      );
      return;
    }

    importState.value = 'running';
  }

  throw new Error('Timed out while waiting for library import to finish.');
}

function interpretImportStatus(payload: unknown): ImportOperationStatus {
  if (!isRecord(payload)) {
    return { status: 'unknown', logs: [], result: null, error: null };
  }

  const statusCandidate = firstString(
    payload.status,
    payload.state,
    payload.phase,
    payload.stage,
  );
  const done = payload.done === true || payload.completed === true || payload.success === true;
  const failed = payload.failed === true || payload.error != null || payload.cancelled === true;

  let status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown' = 'unknown';
  if (statusCandidate) {
    const normalized = statusCandidate.toLowerCase();
    if (['pending', 'queued', 'accepted', 'waiting'].includes(normalized)) {
      status = 'pending';
    } else if (['running', 'in_progress', 'processing', 'executing', 'working'].includes(normalized)) {
      status = 'running';
    } else if (['succeeded', 'success', 'completed', 'complete', 'done'].includes(normalized)) {
      status = 'succeeded';
    } else if (['failed', 'error', 'aborted'].includes(normalized)) {
      status = 'failed';
    } else if (['cancelled', 'canceled'].includes(normalized)) {
      status = 'cancelled';
    } else {
      status = 'running';
    }
  }

  if (done && !failed) {
    status = 'succeeded';
  } else if (failed) {
    status = payload.cancelled === true ? 'cancelled' : 'failed';
  }

  const message = firstString(
    payload.message,
    payload.detail,
    payload.description,
    payload.statusMessage,
    payload.info,
    payload.progress?.message,
  );

  const logs: string[] = [];
  const logSources = [payload.logs, payload.history, payload.messages];
  for (const source of logSources) {
    if (Array.isArray(source)) {
      for (const entry of source) {
        if (typeof entry === 'string') {
          logs.push(entry);
        } else if (isRecord(entry)) {
          const label = firstString(entry.message, entry.detail, entry.description, entry.label);
          if (label) {
            logs.push(label);
          }
        }
      }
    }
  }

  if (isRecord(payload.progress) && Array.isArray(payload.progress.steps)) {
    for (const step of payload.progress.steps) {
      if (typeof step === 'string') {
        logs.push(step);
      } else if (isRecord(step)) {
        const label = firstString(step.message, step.detail, step.description, step.label);
        if (label) {
          logs.push(label);
        }
      }
    }
  }

  const result = payload.result ?? payload.data ?? payload.output ?? payload.payload ?? null;
  const error = payload.error ?? payload.failure ?? payload.reason ?? payload.details?.error ?? null;

  return { status, message, logs, result, error };
}

function resetImportState() {
  importState.value = 'idle';
  importStatusMessage.value = '';
  importLogs.value = [];
  importErrorDetails.value = null;
}

function appendImportLog(message: string) {
  const normalized = message.trim();
  if (!normalized) {
    return;
  }
  const entries = importLogs.value;
  if (entries.includes(normalized)) {
    return;
  }
  entries.push(normalized);
  if (entries.length > 25) {
    entries.splice(0, entries.length - 25);
  }
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveStatusUrl(location: string, baseUrl: string): string {
  if (/^https?:/i.test(location)) {
    return location;
  }
  if (location.startsWith('/')) {
    return `${baseUrl}${location}`;
  }
  return `${baseUrl}/${location}`;
}

function extractImportSummary(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }
  const data = isRecord(payload.data) ? (payload.data as Record<string, unknown>) : payload;
  const commitId = typeof data.id === 'string' ? data.id : undefined;
  const message = firstString(
    data.message,
    data.commitMessage,
    data.description,
    data.detail,
  );
  if (commitId && message) {
    return `Commit ${commitId}: ${message}`;
  }
  if (commitId) {
    return `Commit ${commitId} created.`;
  }
  return message ?? null;
}

function extractImportMessage(payload: unknown): string | undefined {
  if (typeof payload === 'string') {
    return payload;
  }
  if (!isRecord(payload)) {
    return undefined;
  }
  const summary = extractImportSummary(payload);
  if (summary) {
    return `Library import completed. ${summary}`;
  }
  return firstString(payload.message, payload.detail, payload.description, payload.statusMessage);
}

function formatImportErrorDetail(value: unknown): string | null {
  if (!value) {
    return null;
  }
  if (value instanceof Error) {
    return value.stack ?? value.message;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (isRecord(value)) {
    const message = firstString(value.message, value.detail, value.description);
    if (message) {
      try {
        return `${message}\n${JSON.stringify(value, null, 2)}`;
      } catch (error) {
        return message;
      }
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return String(value);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  outlineRevision.value += 1;
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

async function submitRename(): Promise<void> {
  const node = selectedOutlineNode.value;
  if (!node) {
    return;
  }
  const proposed = renameDraft.value.trim();
  if (!proposed) {
    renameError.value = 'Provide a non-empty name.';
    renameDraft.value = node.label;
    return;
  }
  if (proposed === node.label.trim()) {
    renameDraft.value = node.label;
    return;
  }

  const config = getOutlineConfig();
  if (!config) {
    renameError.value = 'Provide API configuration before renaming.';
    return;
  }

  renameBusy.value = true;
  renameError.value = null;

  const revertOutline = applyOutlineRenameOptimistic(node.id, proposed);

  try {
    const result = await requestRenameRefactor(node.id, proposed, config);
    if (result.elements.length) {
      updateOutlineFromRecords(result.elements);
      const refreshed = selectedOutlineNode.value;
      if (refreshed) {
        renameDraft.value = refreshed.label;
      }
    } else {
      const cached = outlineElementCache.get(node.id);
      if (cached) {
        outlineElementCache.set(node.id, { ...cached, name: proposed });
      }
      renameDraft.value = proposed;
    }
    if (result.patches.length) {
      applyTextPatches(result.patches);
    }
  } catch (error) {
    revertOutline();
    const current = selectedOutlineNode.value;
    renameDraft.value = current ? current.label : '';
    if (!isAbortError(error)) {
      renameError.value = error instanceof Error ? error.message : 'Rename failed.';
    }
    return;
  } finally {
    renameBusy.value = false;
  }
}

function resetRenameDraft(): void {
  const node = selectedOutlineNode.value;
  renameDraft.value = node ? node.label : '';
  renameError.value = null;
}

async function requestRenameRefactor(
  elementId: string,
  newName: string,
  config: OutlineConfig,
): Promise<RenameRefactorResult> {
  const url = `${config.baseUrl}/projects/${encodeURIComponent(config.projectId)}/commits/${encodeURIComponent(
    config.commitId,
  )}/refactorings/rename`;
  const controller = new AbortController();
  const payload = await requestJson(url, controller.signal, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      elementId,
      newName,
      includeReferences: true,
      updateReferences: true,
    }),
  });
  if (!payload) {
    return { patches: [], elements: [] };
  }
  return parseRenameResponse(payload);
}

function parseRenameResponse(payload: unknown): RenameRefactorResult {
  if (!payload) {
    return { patches: [], elements: [] };
  }
  if (!isRecord(payload)) {
    throw new Error('Unexpected rename response shape.');
  }
  const root = isRecord(payload.data) ? (payload.data as Record<string, unknown>) : payload;
  const container = isRecord(root.result) ? (root.result as Record<string, unknown>) : root;

  const patchSources: unknown[] = [];
  for (const key of ['patches', 'textEdits', 'edits', 'textChanges']) {
    const candidate = container[key];
    if (Array.isArray(candidate)) {
      patchSources.push(...candidate);
    }
  }
  const patches: TextEditPatch[] = [];
  for (const entry of patchSources) {
    const normalized = normalizeTextPatch(entry);
    if (normalized) {
      patches.push(normalized);
    }
  }

  const elementSources: unknown[] = [];
  for (const key of ['element', 'updatedElement', 'targetElement']) {
    const candidate = container[key];
    if (candidate) {
      elementSources.push(candidate);
    }
  }
  const list = container.updatedElements;
  if (Array.isArray(list)) {
    elementSources.push(...list);
  }

  const elements: ApiElementRecord[] = [];
  for (const entry of elementSources) {
    const normalized = normalizeElementRecordFromResponse(entry);
    if (normalized) {
      elements.push(normalized);
    }
  }

  return { patches, elements };
}

function normalizeElementRecordFromResponse(value: unknown): ApiElementRecord | null {
  if (!value) {
    return null;
  }
  if (isRecord(value) && isRecord(value.data)) {
    try {
      return parseElementRecord({ data: value.data });
    } catch (error) {
      return null;
    }
  }
  if (!isRecord(value) || typeof value.id !== 'string') {
    return null;
  }
  return sanitizeElementRecord({
    id: value.id,
    name: typeof value.name === 'string' ? value.name : undefined,
    classifierId: typeof value.classifierId === 'string' ? value.classifierId : undefined,
    documentation: typeof value.documentation === 'string' ? value.documentation : undefined,
    payload: isRecord(value.payload) ? (value.payload as Record<string, unknown>) : undefined,
  });
}

function normalizeTextPatch(value: unknown): TextEditPatch | null {
  if (!isRecord(value)) {
    return null;
  }
  const text = firstString(value.newText, value.text, value.replacementText, value.replacement, value.insertText, value.value);
  if (typeof text !== 'string') {
    return null;
  }
  const rangeSource = isRecord(value.range) ? (value.range as Record<string, unknown>) : value;
  const start = extractPosition(rangeSource, ['start', 'from', 'begin']);
  const end = extractPosition(rangeSource, ['end', 'to', 'finish']);
  if (!start || !end) {
    return null;
  }
  return {
    range: {
      startLineNumber: start.line,
      startColumn: start.column,
      endLineNumber: end.line,
      endColumn: end.column,
    },
    text,
  };
}

function extractPosition(source: Record<string, unknown>, keys: string[]): OutlinePosition | null {
  for (const key of keys) {
    const line = toInteger(
      source[`${key}LineNumber`] ??
        source[`${key}Line`] ??
        source[`${key}Row`] ??
        (isRecord(source[key]) ? (source[key] as Record<string, unknown>).line : undefined) ??
        (isRecord(source[key]) ? (source[key] as Record<string, unknown>).lineNumber : undefined) ??
        (isRecord(source[key]) ? (source[key] as Record<string, unknown>).row : undefined),
    );
    const column = toInteger(
      source[`${key}Column`] ??
        source[`${key}Character`] ??
        source[`${key}Char`] ??
        source[`${key}Offset`] ??
        (isRecord(source[key]) ? (source[key] as Record<string, unknown>).column : undefined) ??
        (isRecord(source[key]) ? (source[key] as Record<string, unknown>).character : undefined) ??
        (isRecord(source[key]) ? (source[key] as Record<string, unknown>).char : undefined) ??
        (isRecord(source[key]) ? (source[key] as Record<string, unknown>).offset : undefined),
    );
    if (line !== null && column !== null) {
      return { line, column };
    }
    const nested = source[key];
    if (isRecord(nested)) {
      const nestedLine = toInteger(nested.line ?? nested.lineNumber ?? nested.row);
      const nestedColumn = toInteger(nested.column ?? nested.character ?? nested.char ?? nested.offset);
      if (nestedLine !== null && nestedColumn !== null) {
        return { line: nestedLine, column: nestedColumn };
      }
    }
  }
  return null;
}

function toInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const normalized = Math.trunc(value);
    return normalized >= 1 ? normalized : 1;
  }
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      const normalized = Math.trunc(parsed);
      return normalized >= 1 ? normalized : 1;
    }
  }
  return null;
}

function applyOutlineRenameOptimistic(elementId: string, label: string): () => void {
  const nodes = outlineNodesByElementId.get(elementId) ?? [];
  const previousNodes = nodes.map((node) => ({ node, label: node.label }));
  const previousRecord = outlineElementCache.get(elementId);
  if (nodes.length) {
    for (const entry of previousNodes) {
      entry.node.label = label;
    }
    outlineRevision.value += 1;
  }
  if (previousRecord) {
    outlineElementCache.set(elementId, { ...previousRecord, name: label });
  }
  return () => {
    if (previousRecord) {
      outlineElementCache.set(elementId, previousRecord);
    }
    for (const entry of previousNodes) {
      entry.node.label = entry.label;
    }
    if (previousNodes.length) {
      outlineRevision.value += 1;
    }
  };
}

function updateOutlineFromRecords(records: ApiElementRecord[]): void {
  if (!records.length) {
    return;
  }
  let dirty = false;
  for (const record of records) {
    outlineElementCache.set(record.id, record);
    const nodes = outlineNodesByElementId.get(record.id);
    if (!nodes || !nodes.length) {
      continue;
    }
    const nextLabel = computeOutlineLabel(record);
    const nextType = computeOutlineType(record);
    const nextRange = extractOutlineRange(record);
    for (const node of nodes) {
      node.label = nextLabel;
      node.type = nextType;
      node.range = nextRange;
    }
    dirty = true;
  }
  if (dirty) {
    outlineRevision.value += 1;
  }
}

function applyTextPatches(edits: TextEditPatch[]): void {
  if (!edits.length || !editorRef.value || !monacoApi) {
    return;
  }
  const editor = editorRef.value;
  const operations = edits
    .map((edit) => ({
      range: toMonacoRange(edit.range, monacoApi!),
      text: edit.text,
      forceMoveMarkers: true,
    }))
    .sort((a, b) => {
      if (a.range.startLineNumber === b.range.startLineNumber) {
        return b.range.startColumn - a.range.startColumn;
      }
      return b.range.startLineNumber - a.range.startLineNumber;
    });
  const selections = editor.getSelections();
  editor.pushUndoStop();
  editor.executeEdits('rename-refactor', operations);
  editor.pushUndoStop();
  if (selections) {
    editor.setSelections(selections);
  }
  scheduleValidation(true);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
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

async function requestJson(url: string, signal: AbortSignal, init?: RequestInit): Promise<unknown> {
  const headers = new Headers(init?.headers ?? undefined);
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }
  const response = await fetch(url, { ...init, signal, headers });
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
  outlineRevision.value += 1;
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

watch(
  selectedOutlineNode,
  (node) => {
    renameError.value = null;
    renameDraft.value = node ? node.label : '';
  },
  { immediate: true },
);

watch(
  [selectedOutlineNode, outlineRevision],
  ([node]) => {
    if (!node) {
      cancelPlantUmlRequest();
      plantUmlLoading.value = false;
      plantUmlSource.value = '';
      plantUmlError.value = null;
      clearPlantUmlDiagram();
      return;
    }
    refreshPlantUmlPreview();
  },
  { immediate: true },
);

watch(normalizedPlantUmlServerUrl, () => {
  cancelPlantUmlRequest();
  clearPlantUmlDiagram();
  plantUmlError.value = null;
  plantUmlLoading.value = false;
});

function cancelPlantUmlRequest(): void {
  if (plantUmlAbortController) {
    plantUmlAbortController.abort();
    plantUmlAbortController = null;
  }
}

function clearPlantUmlDiagram(): void {
  if (plantUmlObjectUrl) {
    URL.revokeObjectURL(plantUmlObjectUrl);
    plantUmlObjectUrl = null;
  }
  plantUmlImageUrl.value = null;
}

async function refreshPlantUmlPreview(): Promise<void> {
  const node = selectedOutlineNode.value;
  const serverUrl = normalizedPlantUmlServerUrl.value;
  const requestId = ++plantUmlRequestId;
  cancelPlantUmlRequest();

  if (!node) {
    plantUmlLoading.value = false;
    plantUmlSource.value = '';
    plantUmlError.value = null;
    clearPlantUmlDiagram();
    return;
  }

  const source = buildPlantUmlSource(node);
  plantUmlSource.value = source;

  if (!serverUrl) {
    plantUmlLoading.value = false;
    plantUmlError.value = 'Provide the PlantUML server endpoint before rendering.';
    clearPlantUmlDiagram();
    return;
  }

  plantUmlLoading.value = true;
  plantUmlError.value = null;

  try {
    await renderPlantUmlDiagram(serverUrl, source, requestId);
  } catch (error) {
    if (requestId === plantUmlRequestId) {
      plantUmlError.value = toErrorMessage(error);
      clearPlantUmlDiagram();
    }
  } finally {
    if (requestId === plantUmlRequestId) {
      plantUmlLoading.value = false;
    }
  }
}

async function renderPlantUmlDiagram(
  serverUrl: string,
  source: string,
  requestId: number,
): Promise<void> {
  const controller = new AbortController();
  plantUmlAbortController = controller;

  try {
    const response = await fetch(serverUrl, {
      method: 'POST',
      headers: {
        Accept: 'image/svg+xml, image/png;q=0.8, */*;q=0.5',
        'Content-Type': 'text/plain; charset=UTF-8',
      },
      body: source,
      signal: controller.signal,
    });

    if (controller.signal.aborted || requestId !== plantUmlRequestId) {
      return;
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(detail || `PlantUML server responded with status ${response.status}`);
    }

    const contentType = response.headers.get('Content-Type') ?? '';
    if (contentType.includes('svg') || contentType.includes('png')) {
      const blob = await response.blob();
      if (controller.signal.aborted || requestId !== plantUmlRequestId) {
        return;
      }
      const objectUrl = URL.createObjectURL(blob);
      clearPlantUmlDiagram();
      plantUmlObjectUrl = objectUrl;
      plantUmlImageUrl.value = objectUrl;
      return;
    }

    const message = await response.text().catch(() => '');
    throw new Error(message || 'PlantUML server returned unexpected content.');
  } catch (error) {
    if (controller.signal.aborted || requestId !== plantUmlRequestId) {
      return;
    }
    throw error;
  } finally {
    if (plantUmlAbortController === controller) {
      plantUmlAbortController = null;
    }
  }
}

function buildPlantUmlSource(root: OutlineNode): string {
  const MAX_DEPTH = 2;
  const MAX_NODES = 24;
  const queue: Array<{ node: OutlineNode; depth: number; parent: OutlineNode | null }> = [
    { node: root, depth: 0, parent: null },
  ];
  const nodes: OutlineNode[] = [];
  const aliasMap = new Map<string, string>();
  const edges: Array<{ from: string; to: string; label?: string }> = [];

  while (queue.length && nodes.length < MAX_NODES) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    const { node, depth, parent } = current;
    nodes.push(node);
    const alias = `N${aliasMap.size}`;
    aliasMap.set(node.key, alias);
    if (parent) {
      edges.push({ from: parent.key, to: node.key, label: formatOutlineType(node.type) });
    }
    if (depth < MAX_DEPTH) {
      for (const child of node.children) {
        queue.push({ node: child, depth: depth + 1, parent: node });
      }
    }
  }

  const omittedCount = queue.length;
  const lines: string[] = [];
  lines.push('@startuml');
  lines.push('skinparam shadowing false');
  lines.push('skinparam classAttributeIconSize 0');
  lines.push('hide empty members');

  const rootLabel = root.label.trim() ? root.label : root.id;
  const rootType = formatOutlineType(root.type);
  const titleParts = [rootLabel];
  if (rootType) {
    titleParts.push(`«${rootType}»`);
  }
  lines.push(`title ${escapePlantUmlLabel(titleParts.join(' '))}`);

  for (const node of nodes) {
    const alias = aliasMap.get(node.key);
    if (!alias) {
      continue;
    }
    const label = (node.label.trim() ? node.label : node.id) ?? node.id;
    const stereotype = formatOutlineType(node.type);
    const typeSuffix = stereotype ? ` <<${escapePlantUmlStereotype(stereotype)}>>` : '';
    lines.push(`class "${escapePlantUmlLabel(label)}" as ${alias}${typeSuffix}`);

    const record = outlineElementCache.get(node.id);
    const documentation = record?.documentation?.trim();
    if (documentation) {
      const docLines = documentation.split(/\r?\n/);
      const limited = docLines.slice(0, 8).map((entry) => escapePlantUmlNoteLine(entry));
      lines.push(`note right of ${alias}`);
      for (const entry of limited) {
        lines.push(`  ${entry}`);
      }
      if (docLines.length > limited.length) {
        lines.push('  …');
      }
      lines.push('end note');
    }
  }

  for (const edge of edges) {
    const fromAlias = aliasMap.get(edge.from);
    const toAlias = aliasMap.get(edge.to);
    if (!fromAlias || !toAlias) {
      continue;
    }
    const label = edge.label ? escapePlantUmlRelationLabel(edge.label) : 'owns';
    lines.push(`${fromAlias} *-- ${toAlias} : ${label}`);
  }

  if (omittedCount > 0) {
    lines.push(`' ${omittedCount} owned element(s) omitted from preview.`);
  }

  lines.push('@enduml');
  return lines.join('\n');
}

function escapePlantUmlLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n');
}

function escapePlantUmlStereotype(value: string): string {
  return value.replace(/[<>«»]/g, '').trim();
}

function escapePlantUmlNoteLine(value: string): string {
  const sanitized = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return sanitized.length ? sanitized : ' ';
}

function escapePlantUmlRelationLabel(value: string): string {
  return value.replace(/:/g, '\\:').replace(/"/g, '\\"');
}

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
    tags:
      issue.quickFixes.length || inferImportCandidates(issue).length
        ? [monacoApi!.MarkerTag.Unnecessary]
        : undefined,
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
            : deriveHeuristicFixes(issue, model);

          const fallbackFixes =
            fixes.length > 0
              ? fixes
              : [
                  {
                    title: 'Review issue in validation service',
                  },
                ];

          for (let idx = 0; idx < fallbackFixes.length; idx += 1) {
            const fix = fallbackFixes[idx];
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

function deriveHeuristicFixes(
  issue: NormalizedIssue,
  model: Monaco.editor.ITextModel,
): NormalizedFix[] {
  const candidates = inferImportCandidates(issue);
  if (!candidates.length) {
    return [];
  }

  const insertionPoint = computeImportInsertionRange(model);
  if (!insertionPoint) {
    return [];
  }

  const eol = model.getEOL();
  const fixes: NormalizedFix[] = [];

  for (const identifier of candidates) {
    if (modelHasImport(model, identifier)) {
      continue;
    }

    fixes.push({
      title: `Insert public import ${identifier}`,
      replacementText: `public import ${identifier};${eol}`,
      range: { ...insertionPoint },
    });

    fixes.push({
      title: `Insert private import ${identifier}`,
      replacementText: `private import ${identifier};${eol}`,
      range: { ...insertionPoint },
    });
  }

  return fixes;
}

function inferImportCandidates(issue: NormalizedIssue): string[] {
  const message = issue.message;
  const matches: string[] = [];

  const patterns = [
    /missing\s+(?:public\s+)?import(?:\s+(?:for|of))?\s+(?:element\s+)?['"]?([\w.:]+)['"]?/i,
    /unresolved\s+(?:reference|ref(?:erence)?|identifier|element)\s+(?:to|for|of)?\s*(?:element\s+)?['"]?([\w.:]+)['"]?/i,
    /cannot\s+resolve\s+(?:reference|ref(?:erence)?|identifier|element)\s+(?:to|for|of)?\s*(?:element\s+)?['"]?([\w.:]+)['"]?/i,
    /no\s+import\s+(?:for|of)\s+(?:element\s+)?['"]?([\w.:]+)['"]?/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(message);
    if (match && match[1]) {
      const sanitized = sanitizeImportCandidate(match[1]);
      if (sanitized) {
        matches.push(sanitized);
      }
    }
  }

  return Array.from(new Set(matches));
}

function sanitizeImportCandidate(value: string): string | null {
  const trimmed = value.trim().replace(/[.;:]+$/, '').replace(/^:+/, '');
  if (!trimmed) {
    return null;
  }
  return trimmed;
}

function computeImportInsertionRange(model: Monaco.editor.ITextModel): NormalizedRange | null {
  const lineCount = model.getLineCount();
  if (lineCount === 0) {
    return {
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 1,
    };
  }

  let insertBefore = 1;

  for (let line = 1; line <= lineCount; line += 1) {
    const content = model.getLineContent(line);
    const trimmed = content.trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (trimmed.startsWith('--')) {
      insertBefore = line + 1;
      continue;
    }
    if (/^(?:public|private)?\s*import\b/i.test(trimmed)) {
      insertBefore = line + 1;
      continue;
    }
    if (/^package\b/i.test(trimmed)) {
      insertBefore = line + 1;
      continue;
    }
    break;
  }

  if (insertBefore > lineCount) {
    const lastLine = lineCount;
    const column = model.getLineLength(lastLine) + 1;
    return {
      startLineNumber: lastLine,
      startColumn: column,
      endLineNumber: lastLine,
      endColumn: column,
    };
  }

  return {
    startLineNumber: insertBefore,
    startColumn: 1,
    endLineNumber: insertBefore,
    endColumn: 1,
  };
}

function modelHasImport(model: Monaco.editor.ITextModel, identifier: string): boolean {
  const escaped = escapeRegExp(identifier);
  const regex = new RegExp(`\\b(?:public|private)?\\s*import\\s+${escaped}\\b`);
  return regex.test(model.getValue());
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  if (issue.quickFixes.length) {
    return issue.quickFixes.map((fix) => fix.title);
  }
  const inferred = inferImportCandidates(issue);
  if (inferred.length) {
    return inferred.map((identifier) => `Insert public import ${identifier}`);
  }
  return ['Quick fix available on hover'];
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
