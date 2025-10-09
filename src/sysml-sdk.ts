import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
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
  private readonly config: SysMLSDKConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: SysMLSDKConfig) {
    this.config = { ...config };
    this.client = new SysMLApiClient(config);
    this.fetchImpl = config.fetchImpl ?? fetch;
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

  async prepareCookbookImport(options: CookbookNotebookSource): Promise<CookbookImportSession> {
    const notebookData = await resolveCookbookNotebookInput(options);
    const parsedNotebook = parseCookbookNotebook(notebookData);
    return new CookbookImportSession(this.config, parsedNotebook, this.fetchImpl);
  }

  async importCookbookNotebook(options: CookbookNotebookImportOptions): Promise<CookbookImportResult> {
    const session = await this.prepareCookbookImport(options);
    const dryRunResult = await session.dryRun();

    if (!dryRunResult.success) {
      return { session, dryRun: dryRunResult, persisted: false };
    }

    let shouldPersist = options.persist ?? false;
    if (!shouldPersist && options.confirmPersist) {
      shouldPersist = await options.confirmPersist({
        session,
        notebook: session.notebook,
        dryRunResult,
      });
    }

    if (!shouldPersist) {
      return { session, dryRun: dryRunResult, persisted: false };
    }

    const persistResult = await session.persist();
    return { session, dryRun: dryRunResult, persistResult, persisted: persistResult.success };
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

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

interface RawNotebookOutput {
  output_type?: string;
  data?: Record<string, unknown>;
  text?: string[] | string;
  name?: string;
}

interface RawNotebookCell {
  cell_type?: string;
  source?: string[] | string;
  metadata?: Record<string, unknown>;
  outputs?: RawNotebookOutput[];
}

interface RawNotebook {
  cells?: RawNotebookCell[];
  metadata?: Record<string, unknown>;
}

export interface CookbookApiCall {
  method: HttpMethod;
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  description?: string;
}

export interface CookbookReplayCallResult {
  call: CookbookApiCall;
  dryRun: boolean;
  ok: boolean;
  status?: number;
  url: string;
  responseBody?: unknown;
  responseHeaders?: Record<string, string>;
  error?: unknown;
}

export interface CookbookReplayReport {
  dryRun: boolean;
  success: boolean;
  results: CookbookReplayCallResult[];
}

export interface CookbookNotebook {
  title?: string;
  description?: string;
  apiCalls: CookbookApiCall[];
  raw: RawNotebook;
}

export interface CookbookNotebookSource {
  notebookPath?: string;
  notebook?: string | RawNotebook;
}

type MaybePromise<T> = T | Promise<T>;

export interface CookbookImportConfirmationContext {
  session: CookbookImportSession;
  notebook: CookbookNotebook;
  dryRunResult: CookbookReplayReport;
}

export interface CookbookNotebookImportOptions extends CookbookNotebookSource {
  persist?: boolean;
  confirmPersist?: (context: CookbookImportConfirmationContext) => MaybePromise<boolean>;
}

export interface CookbookImportResult {
  session: CookbookImportSession;
  dryRun: CookbookReplayReport;
  persisted: boolean;
  persistResult?: CookbookReplayReport;
}

const MUTATING_HTTP_METHODS: ReadonlySet<HttpMethod> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const POTENTIAL_CALL_CONTAINER_KEYS = ['apiCalls', 'calls', 'requests', 'items', 'data', 'value'];

export class SysMLCookbookImportError extends SysMLError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'SysMLCookbookImportError';
  }
}

export class CookbookImportSession {
  constructor(
    private readonly config: SysMLSDKConfig,
    private readonly notebookData: CookbookNotebook,
    private readonly fetchImpl: typeof fetch,
  ) {}

  get notebook(): CookbookNotebook {
    return this.notebookData;
  }

  get calls(): CookbookApiCall[] {
    return this.notebookData.apiCalls;
  }

  async dryRun(): Promise<CookbookReplayReport> {
    return this.replay(true);
  }

  async persist(): Promise<CookbookReplayReport> {
    return this.replay(false);
  }

  private async replay(dryRun: boolean): Promise<CookbookReplayReport> {
    const results: CookbookReplayCallResult[] = [];

    for (const call of this.notebookData.apiCalls) {
      const url = buildReplayUrl(this.config.baseUrl, call.url, call.query, dryRun && isMutatingMethod(call.method));
      const headers = buildRequestHeaders(call.headers, this.config.token);
      const body = buildRequestBody(call, headers);

      try {
        const response = await this.fetchImpl(url.toString(), {
          method: call.method,
          headers,
          body,
        });

        const rawText = await response.text();
        const responseHeaders = Object.fromEntries(response.headers.entries());

        const result: CookbookReplayCallResult = {
          call,
          dryRun,
          ok: response.ok,
          status: response.status,
          url: url.toString(),
          responseHeaders,
        };

        if (rawText) {
          const contentType = response.headers.get('content-type') ?? '';
          if (contentType.includes('application/json')) {
            try {
              result.responseBody = JSON.parse(rawText);
            } catch (error) {
              result.responseBody = rawText;
              result.error = error;
            }
          } else {
            result.responseBody = rawText;
          }
        }

        results.push(result);

        if (!response.ok) {
          return { dryRun, success: false, results };
        }
      } catch (error) {
        results.push({ call, dryRun, ok: false, error, url: url.toString() });
        return { dryRun, success: false, results };
      }
    }

    return { dryRun, success: true, results };
  }
}

export async function resolveCookbookNotebookInput(options: CookbookNotebookSource): Promise<RawNotebook> {
  if (options.notebook !== undefined) {
    return ensureNotebook(options.notebook);
  }

  if (options.notebookPath) {
    const contents = await readFile(options.notebookPath, 'utf8');
    return ensureNotebook(contents);
  }

  throw new SysMLCookbookImportError('A notebook path or contents must be provided for import.');
}

export function parseCookbookNotebook(notebook: RawNotebook): CookbookNotebook {
  if (!Array.isArray(notebook.cells)) {
    throw new SysMLCookbookImportError('The notebook is missing a cells array.');
  }

  const title = extractNotebookTitle(notebook);
  const description = extractNotebookDescription(notebook);
  const apiCalls = extractCookbookApiCalls(notebook);

  if (apiCalls.length === 0) {
    throw new SysMLCookbookImportError('Unable to locate any API calls within the provided notebook.');
  }

  return { title, description, apiCalls, raw: notebook };
}

function ensureNotebook(value: string | RawNotebook): RawNotebook {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return ensureNotebook(parsed);
    } catch (error) {
      throw new SysMLCookbookImportError('Failed to parse notebook JSON.', error);
    }
  }

  if (!isRecord(value) || !Array.isArray(value.cells)) {
    throw new SysMLCookbookImportError('The provided notebook value is not a valid Jupyter notebook.');
  }

  return value;
}

function extractNotebookTitle(notebook: RawNotebook): string | undefined {
  for (const cell of notebook.cells ?? []) {
    if (cell.cell_type !== 'markdown') {
      continue;
    }
    const text = joinLines(cell.source);
    if (!text) {
      continue;
    }
    const match = text.match(/^#\s+(.+)$/m);
    if (match) {
      return match[1].trim();
    }
  }
  return undefined;
}

function extractNotebookDescription(notebook: RawNotebook): string | undefined {
  for (const cell of notebook.cells ?? []) {
    if (cell.cell_type !== 'markdown') {
      continue;
    }
    const lines = toStringArray(cell.source).map((line) => line.trim());
    const filtered = lines.filter((line) => line && !line.startsWith('#'));
    if (filtered.length > 0) {
      return filtered.join(' ').trim();
    }
  }
  return undefined;
}

function extractCookbookApiCalls(notebook: RawNotebook): CookbookApiCall[] {
  const calls: CookbookApiCall[] = [];

  for (const cell of notebook.cells ?? []) {
    if (cell.cell_type === 'code' && Array.isArray(cell.outputs)) {
      for (const output of cell.outputs) {
        calls.push(...extractCallsFromOutput(output));
      }
    }

    calls.push(...extractCallsFromValue(cell.metadata));

    const sourceCalls = extractCallsFromSource(cell.source);
    calls.push(...sourceCalls);
  }

  calls.push(...extractCallsFromValue(notebook.metadata));

  return calls;
}

function extractCallsFromOutput(output: RawNotebookOutput): CookbookApiCall[] {
  const results: CookbookApiCall[] = [];
  const seen = new Set<string>();

  if (output.data) {
    for (const value of Object.values(output.data)) {
      for (const call of extractCallsFromValue(value)) {
        const key = buildCallKey(call);
        if (!seen.has(key)) {
          seen.add(key);
          results.push(call);
        }
      }
    }
  }

  if (output.text !== undefined) {
    const text = joinLines(output.text);
    if (text) {
      for (const call of extractCallsFromValue(text)) {
        const key = buildCallKey(call);
        if (!seen.has(key)) {
          seen.add(key);
          results.push(call);
        }
      }
    }
  }

  return results;
}

function extractCallsFromSource(source?: string[] | string): CookbookApiCall[] {
  const text = joinLines(source)?.trim();
  if (!text) {
    return [];
  }

  if (!looksLikeJson(text)) {
    return [];
  }

  return extractCallsFromValue(text);
}

function extractCallsFromValue(value: unknown, depth = 0): CookbookApiCall[] {
  if (depth > 6 || value === undefined || value === null) {
    return [];
  }

  if (Array.isArray(value)) {
    const results: CookbookApiCall[] = [];
    for (const item of value) {
      results.push(...extractCallsFromValue(item, depth + 1));
    }
    return results;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!looksLikeJson(trimmed)) {
      return [];
    }
    try {
      const parsed = JSON.parse(trimmed);
      return extractCallsFromValue(parsed, depth + 1);
    } catch {
      return [];
    }
  }

  if (!isRecord(value)) {
    return [];
  }

  const directCall = convertToCookbookCall(value);
  const results: CookbookApiCall[] = [];

  if (directCall) {
    results.push(directCall);
  }

  for (const key of POTENTIAL_CALL_CONTAINER_KEYS) {
    if (key in value) {
      results.push(...extractCallsFromValue(value[key], depth + 1));
    }
  }

  if (results.length > 0) {
    return results;
  }

  for (const nested of Object.values(value)) {
    results.push(...extractCallsFromValue(nested, depth + 1));
  }

  return results;
}

function convertToCookbookCall(value: Record<string, unknown>): CookbookApiCall | undefined {
  const methodValue = findString(value, ['method', 'httpMethod', 'http_method', 'verb']);
  const request = isRecord(value.request) ? (value.request as Record<string, unknown>) : undefined;
  const method = (methodValue ?? (request ? findString(request, ['method', 'httpMethod', 'http_method', 'verb']) : undefined))?.toUpperCase();

  if (!method || !isHttpMethod(method)) {
    return undefined;
  }

  const urlValue =
    findString(value, ['url', 'uri', 'path', 'endpoint']) ??
    (request ? findString(request, ['url', 'uri', 'path', 'endpoint']) : undefined);

  if (!urlValue) {
    return undefined;
  }

  const bodyValue =
    value.body ??
    value.requestBody ??
    value.request_body ??
    value.payload ??
    value.data ??
    value.json ??
    (request ? request.body ?? request.payload ?? request.data ?? request.json : undefined);

  const headersValue =
    value.headers ??
    value.requestHeaders ??
    value.request_headers ??
    (request ? request.headers ?? request.requestHeaders ?? request.request_headers : undefined);

  const queryValue =
    value.query ??
    value.params ??
    (request ? request.query ?? request.params : undefined);

  const description = findString(value, ['description', 'label', 'summary']);

  const headers = normalizeKeyValueRecord(headersValue);
  const query = normalizeKeyValueRecord(queryValue);
  const body = normalizeBody(bodyValue);

  const call: CookbookApiCall = {
    method,
    url: String(urlValue),
  };

  if (description) {
    call.description = description;
  }

  if (headers && Object.keys(headers).length > 0) {
    call.headers = headers;
  }

  if (query && Object.keys(query).length > 0) {
    call.query = query;
  }

  if (body !== undefined) {
    call.body = body;
  }

  return call;
}

function buildReplayUrl(
  baseUrl: string,
  callUrl: string,
  query: Record<string, string> | undefined,
  includeDryRun: boolean,
): URL {
  const base = new URL(baseUrl);
  const call = parseCallUrl(callUrl);
  const finalUrl = new URL(base.toString());
  finalUrl.pathname = combinePaths(base.pathname, call.pathname);

  const params = call.searchParams;

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        params.set(key, String(value));
      }
    }
  }

  if (includeDryRun) {
    params.set('dryRun', 'true');
  }

  finalUrl.search = params.toString() ? `?${params.toString()}` : '';
  return finalUrl;
}

function parseCallUrl(value: string): { pathname: string; searchParams: URLSearchParams } {
  if (!value) {
    return { pathname: '/', searchParams: new URLSearchParams() };
  }

  try {
    const parsed = new URL(value);
    return { pathname: parsed.pathname || '/', searchParams: new URLSearchParams(parsed.search) };
  } catch {
    const [pathPart, queryPart] = value.split('?');
    return { pathname: pathPart || '/', searchParams: new URLSearchParams(queryPart ?? '') };
  }
}

function combinePaths(basePath: string, callPath: string): string {
  const normalizedBase = normalizeBasePath(basePath);
  const normalizedCall = normalizeCallPath(callPath);

  if (!normalizedBase) {
    return normalizedCall;
  }

  if (normalizedCall === '/') {
    return normalizedBase;
  }

  if (normalizedCall === normalizedBase || normalizedCall.startsWith(`${normalizedBase}/`)) {
    return normalizedCall;
  }

  return `${normalizedBase}${normalizedCall}`;
}

function normalizeBasePath(path: string): string {
  if (!path || path === '/') {
    return '';
  }
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function normalizeCallPath(path: string): string {
  if (!path) {
    return '/';
  }
  return path.startsWith('/') ? path : `/${path}`;
}

function buildRequestHeaders(headers: Record<string, string> | undefined, token?: string): Record<string, string> {
  const normalized: Record<string, string> = {};

  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      if (value === undefined || value === null) {
        continue;
      }
      normalized[key] = String(value);
    }
  }

  if (!hasHeader(normalized, 'accept')) {
    normalized.Accept = 'application/json';
  }

  if (token && !hasHeader(normalized, 'authorization')) {
    normalized.Authorization = `Bearer ${token}`;
  }

  return normalized;
}

function buildRequestBody(call: CookbookApiCall, headers: Record<string, string>): string | undefined {
  if (!methodAllowsBody(call.method)) {
    return undefined;
  }

  if (call.body === undefined) {
    return undefined;
  }

  if (call.body === null) {
    if (!hasHeader(headers, 'content-type')) {
      headers['Content-Type'] = 'application/json';
    }
    return 'null';
  }

  if (typeof call.body === 'string') {
    if (!hasHeader(headers, 'content-type') && looksLikeJson(call.body)) {
      headers['Content-Type'] = 'application/json';
    }
    return call.body;
  }

  if (!hasHeader(headers, 'content-type')) {
    headers['Content-Type'] = 'application/json';
  }

  return JSON.stringify(call.body);
}

function methodAllowsBody(method: HttpMethod): boolean {
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}

function isMutatingMethod(method: HttpMethod): boolean {
  return MUTATING_HTTP_METHODS.has(method);
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lower);
}

function normalizeBody(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    if (looksLikeJson(trimmed)) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }

  return value;
}

function normalizeKeyValueRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined || entry === null) {
      continue;
    }
    if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') {
      result[key] = String(entry);
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function isHttpMethod(value: string): value is HttpMethod {
  switch (value) {
    case 'GET':
    case 'POST':
    case 'PUT':
    case 'PATCH':
    case 'DELETE':
    case 'HEAD':
    case 'OPTIONS':
      return true;
    default:
      return false;
  }
}

function joinLines(value?: string[] | string): string | undefined {
  if (Array.isArray(value)) {
    return value.join('');
  }
  return typeof value === 'string' ? value : undefined;
}

function toStringArray(value?: string[] | string): string[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string') {
    return value.split('\n');
  }
  return [];
}

function looksLikeJson(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function findString(value: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const entry = value[key];
    if (typeof entry === 'string') {
      return entry;
    }
  }
  return undefined;
}

function buildCallKey(call: CookbookApiCall): string {
  return JSON.stringify({
    method: call.method,
    url: call.url,
    body: call.body ?? null,
    headers: call.headers ?? null,
    query: call.query ?? null,
  });
}

export * from './graph';
