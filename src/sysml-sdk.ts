import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { SysMLApiClient, SysMLRequestError, type SysMLClientConfig } from './generated/client';
import packageJson from '../package.json' assert { type: 'json' };
import type {
  CommitListResponse,
  CommitResponse,
  CommitSummary,
  CreateCommitParams,
  CreateElementParams,
  CreateProjectParams,
  DeleteElementParams,
  DeleteProjectParams,
  ElementResponse,
  ElementRecord,
  GetCommitParams,
  GetElementParams,
  GetProjectParams,
  ListCommitsParams,
  ListElementsParams,
  ListElementsResponse,
  ListProjectsParams,
  ProjectListResponse,
  ProjectResponse,
  ProjectSummary,
  UpdateElementParams,
} from './generated/types';
import { ZodError } from './utils/zod-lite';

export type { SysMLClientConfig } from './generated/client';
export type {
  CommitListResponse,
  CommitResponse,
  CommitSummary,
  CreateCommitParams,
  CreateElementParams,
  CreateProjectParams,
  DeleteElementParams,
  DeleteProjectParams,
  ElementResponse,
  ElementRecord,
  GetCommitParams,
  GetElementParams,
  GetProjectParams,
  ListCommitsParams,
  ListElementsParams,
  ListElementsResponse,
  ListProjectsParams,
  ProjectListResponse,
  ProjectSummary,
  ProjectResponse,
  UpdateElementParams,
} from './generated/types';

const CHECKSUM_ALGORITHM = 'sha256' as const;
const SYSML_TEXT_FORMAT = 'sysml-text' as const;
const API_JSON_FORMAT = 'api-json' as const;
const ELEMENT_DIRECTORY = 'elements';
const MANIFEST_FILE_NAME = 'manifest.json';
const API_BUNDLE_FILE_NAME = 'api-bundle.json';
const DEFAULT_BUNDLE_VERSION = '1.0.0';
const DEFAULT_LIST_LIMIT = 100;
const SDK_VERSION: string = (packageJson as { version: string }).version ?? 'unknown';

export type BundleFormat = typeof SYSML_TEXT_FORMAT | typeof API_JSON_FORMAT;

export interface BundleFile {
  path: string;
  contents: string;
}

export interface BundleManifestEntry {
  path: string;
  checksum: string;
  size: number;
}

export interface BundleManifest {
  format: BundleFormat;
  bundleVersion: string;
  sdkVersion: string;
  generatedAt: string;
  checksumAlgorithm: typeof CHECKSUM_ALGORITHM;
  project: ProjectSummary;
  commit: CommitSummary;
  elementCount: number;
  files: BundleManifestEntry[];
}

export interface ExportBundle {
  manifest: BundleManifest;
  files: BundleFile[];
}

export interface ExportBundleParams {
  projectId: string;
  commitId: string;
}

interface BundleContext {
  project: ProjectSummary;
  commit: CommitSummary;
  elements: ElementRecord[];
  generatedAt: string;
}

function computeChecksum(contents: string): string {
  return createHash(CHECKSUM_ALGORITHM).update(contents, 'utf8').digest('hex');
}

function computeSize(contents: string): number {
  return Buffer.byteLength(contents, 'utf8');
}

function sortElements(elements: ElementRecord[]): ElementRecord[] {
  return [...elements].sort((a, b) => {
    const nameA = (a.name ?? '').toLocaleLowerCase();
    const nameB = (b.name ?? '').toLocaleLowerCase();
    const nameCompare = nameA.localeCompare(nameB);
    if (nameCompare !== 0) {
      return nameCompare;
    }
    const classifierCompare = a.classifierId.localeCompare(b.classifierId);
    if (classifierCompare !== 0) {
      return classifierCompare;
    }
    return a.id.localeCompare(b.id);
  });
}

function sortFilesByPath(files: BundleFile[]): BundleFile[] {
  return [...files].sort((a, b) => a.path.localeCompare(b.path));
}

function escapeTripleQuotes(value: string): string {
  return value.replace(/"""/g, '\\"""');
}

function serializeElementToSysMLText(element: ElementRecord): string {
  const lines: string[] = [];
  lines.push(`/// Element ${element.id}`);
  const displayName = element.name ?? element.id;
  lines.push(`element ${element.classifierId} ${JSON.stringify(displayName)} {`);
  lines.push(`  id = ${JSON.stringify(element.id)}`);
  lines.push(`  project = ${JSON.stringify(element.projectId)}`);
  lines.push(`  commit = ${JSON.stringify(element.commitId)}`);
  lines.push(`  classifier = ${JSON.stringify(element.classifierId)}`);
  if (element.name) {
    lines.push(`  name = ${JSON.stringify(element.name)}`);
  }
  if (element.documentation) {
    lines.push('  documentation = """');
    for (const docLine of element.documentation.split(/\r?\n/)) {
      lines.push(`    ${escapeTripleQuotes(docLine)}`);
    }
    lines.push('  """');
  }

  const payloadJson = JSON.stringify(element.payload, null, 2) ?? '{}';
  const payloadLines = payloadJson.split('\n');
  if (payloadLines.length === 0) {
    lines.push('  payload = {}');
  } else if (payloadLines.length === 1) {
    lines.push(`  payload = ${payloadLines[0]}`);
  } else {
    lines.push(`  payload = ${payloadLines[0]}`);
    for (const payloadLine of payloadLines.slice(1, -1)) {
      lines.push(`    ${payloadLine}`);
    }
    lines.push(`  ${payloadLines[payloadLines.length - 1]}`);
  }
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

function createSysMLTextFiles(elements: ElementRecord[]): BundleFile[] {
  return elements.map((element) => ({
    path: `${ELEMENT_DIRECTORY}/${element.id}.sysml`,
    contents: serializeElementToSysMLText(element),
  }));
}

function createApiBundleFile(context: BundleContext): BundleFile {
  const payload = {
    format: API_JSON_FORMAT,
    bundleVersion: DEFAULT_BUNDLE_VERSION,
    sdkVersion: SDK_VERSION,
    generatedAt: context.generatedAt,
    project: { ...context.project },
    commit: { ...context.commit },
    elementCount: context.elements.length,
    elements: context.elements.map((element) => ({
      id: element.id,
      classifierId: element.classifierId,
      name: element.name,
      documentation: element.documentation,
      payload: element.payload,
    })),
  };
  return {
    path: API_BUNDLE_FILE_NAME,
    contents: `${JSON.stringify(payload, null, 2)}\n`,
  };
}

function buildManifest(format: BundleFormat, context: BundleContext, files: BundleFile[]): BundleManifest {
  const sortedFiles = sortFilesByPath(files);
  return {
    format,
    bundleVersion: DEFAULT_BUNDLE_VERSION,
    sdkVersion: SDK_VERSION,
    generatedAt: context.generatedAt,
    checksumAlgorithm: CHECKSUM_ALGORITHM,
    project: { ...context.project },
    commit: { ...context.commit },
    elementCount: context.elements.length,
    files: sortedFiles.map((file) => ({
      path: file.path,
      checksum: computeChecksum(file.contents),
      size: computeSize(file.contents),
    })),
  };
}

function serializeManifest(manifest: BundleManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function createManifestFile(manifest: BundleManifest): BundleFile {
  return {
    path: MANIFEST_FILE_NAME,
    contents: serializeManifest(manifest),
  };
}

export abstract class SysMLError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'SysMLError';
  }
}

export class SysMLValidationError extends SysMLError {
  constructor(public readonly issues: ZodError['issues']) {
    super('Validation failed', issues);
    this.name = 'SysMLValidationError';
  }
}

export class SysMLHttpError extends SysMLError {
  constructor(public readonly status: number, public readonly body?: unknown) {
    super(`HTTP ${status}`);
    this.name = 'SysMLHttpError';
  }
}

export class SysMLNetworkError extends SysMLError {
  constructor(public readonly original: Error) {
    super(original.message, original);
    this.name = 'SysMLNetworkError';
  }
}

export interface SysMLSDKConfig extends SysMLClientConfig {}

export class SysMLSDK {
  private readonly client: SysMLApiClient;

  constructor(config: SysMLSDKConfig) {
    this.client = new SysMLApiClient(config);
  }

  private transformError(error: unknown): never {
    if (error instanceof SysMLRequestError) {
      const detail = error.causeDetail;
      if (detail.type === 'validation') {
        throw new SysMLValidationError(detail.error.issues);
      }
      if (detail.type === 'http') {
        throw new SysMLHttpError(detail.status, detail.body);
      }
      if (detail.type === 'network') {
        throw new SysMLNetworkError(detail.error);
      }
    }
    throw error;
  }

  async listProjects(params?: ListProjectsParams): Promise<ProjectListResponse> {
    try {
      return await this.client.listProjects(params);
    } catch (error) {
      this.transformError(error);
    }
  }

  async createProject(params: CreateProjectParams): Promise<ProjectResponse> {
    try {
      return await this.client.createProject(params);
    } catch (error) {
      this.transformError(error);
    }
  }

  async getProject(params: GetProjectParams): Promise<ProjectResponse> {
    try {
      return await this.client.getProject(params);
    } catch (error) {
      this.transformError(error);
    }
  }

  async deleteProject(params: DeleteProjectParams): Promise<void> {
    try {
      await this.client.deleteProject(params);
    } catch (error) {
      this.transformError(error);
    }
  }

  async listCommits(params: ListCommitsParams): Promise<CommitListResponse> {
    try {
      return await this.client.listCommits(params);
    } catch (error) {
      this.transformError(error);
    }
  }

  async createCommit(params: CreateCommitParams): Promise<CommitResponse> {
    try {
      return await this.client.createCommit(params);
    } catch (error) {
      this.transformError(error);
    }
  }

  async getCommit(params: GetCommitParams): Promise<CommitResponse> {
    try {
      return await this.client.getCommit(params);
    } catch (error) {
      this.transformError(error);
    }
  }

  async listElements(params: ListElementsParams): Promise<ListElementsResponse> {
    try {
      return await this.client.listElements(params);
    } catch (error) {
      this.transformError(error);
    }
  }

  async createElement(params: CreateElementParams): Promise<ElementResponse> {
    try {
      return await this.client.createElement(params);
    } catch (error) {
      this.transformError(error);
    }
  }

  async getElement(params: GetElementParams): Promise<ElementResponse> {
    try {
      return await this.client.getElement(params);
    } catch (error) {
      this.transformError(error);
    }
  }

  async updateElement(params: UpdateElementParams): Promise<ElementResponse> {
    try {
      return await this.client.updateElement(params);
    } catch (error) {
      this.transformError(error);
    }
  }

  async deleteElement(params: DeleteElementParams): Promise<void> {
    try {
      await this.client.deleteElement(params);
    } catch (error) {
      this.transformError(error);
    }
  }

  async exportSysMLTextBundle(params: ExportBundleParams): Promise<ExportBundle> {
    try {
      const context = await this.buildBundleContext(params);
      const dataFiles = sortFilesByPath(createSysMLTextFiles(context.elements));
      const manifest = buildManifest(SYSML_TEXT_FORMAT, context, dataFiles);
      const manifestFile = createManifestFile(manifest);
      return {
        manifest,
        files: [...dataFiles, manifestFile],
      };
    } catch (error) {
      this.transformError(error);
    }
  }

  async exportApiBundle(params: ExportBundleParams): Promise<ExportBundle> {
    try {
      const context = await this.buildBundleContext(params);
      const dataFile = createApiBundleFile(context);
      const dataFiles = sortFilesByPath([dataFile]);
      const manifest = buildManifest(API_JSON_FORMAT, context, dataFiles);
      const manifestFile = createManifestFile(manifest);
      return {
        manifest,
        files: [...dataFiles, manifestFile],
      };
    } catch (error) {
      this.transformError(error);
    }
  }

  private async buildBundleContext(params: ExportBundleParams): Promise<BundleContext> {
    const { projectId, commitId } = params;
    try {
      const [projectResponse, commitResponse, elements] = await Promise.all([
        this.getProject({ projectId }),
        this.getCommit({ projectId, commitId }),
        this.fetchAllElementsForBundle(projectId, commitId),
      ]);

      return {
        project: projectResponse.data,
        commit: commitResponse.data,
        elements: sortElements(elements),
        generatedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.transformError(error);
    }
  }

  private async fetchAllElementsForBundle(projectId: string, commitId: string): Promise<ElementRecord[]> {
    const elements: ElementRecord[] = [];
    let cursor: string | undefined;
    const seenCursors = new Set<string>();

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const response = await this.listElements({ projectId, commitId, cursor, limit: DEFAULT_LIST_LIMIT });
      elements.push(...response.items);

      if (!response.cursor) {
        break;
      }

      if (seenCursors.has(response.cursor)) {
        break;
      }

      seenCursors.add(response.cursor);
      cursor = response.cursor;
    }

    return elements;
  }
}

export * from './graph';
