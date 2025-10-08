import {
  CommitListResponseSchema,
  CommitResponseSchema,
  CreateCommitRequestSchema,
  CreateProjectRequestSchema,
  ElementResponseSchema,
  ElementUpsertSchema,
  ErrorResponseSchema,
  ListElementsResponseSchema,
  ProjectListResponseSchema,
  ProjectResponseSchema,
} from './schemas';
import type {
  CommitListResponse,
  CommitResponse,
  CreateCommitParams,
  CreateProjectParams,
  DeleteElementParams,
  DeleteProjectParams,
  ElementResponse,
  GetCommitParams,
  GetElementParams,
  GetProjectParams,
  ListCommitsParams,
  ListElementsParams,
  ListElementsResponse,
  ListProjectsParams,
  ProjectListResponse,
  ProjectResponse,
  UpdateElementParams,
  CreateElementParams,
} from './types';
import { ZodError, z, type ZodType } from '../utils/zod-lite';

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
}

export interface SysMLClientConfig {
  baseUrl: string;
  token?: string;
  retry?: RetryOptions;
  fetchImpl?: typeof fetch;
}

export type RequestErrorCause =
  | { type: 'network'; error: Error }
  | { type: 'validation'; error: ZodError }
  | { type: 'http'; status: number; body?: unknown };

export class SysMLRequestError extends Error {
  constructor(
    message: string,
    public readonly causeDetail: RequestErrorCause,
    public readonly response?: Response,
  ) {
    super(message);
    this.name = 'SysMLRequestError';
  }
}

const QueryParamSchema = z.record(z.any());

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildQuery(params?: Record<string, unknown>): string {
  if (!params) {
    return '';
  }
  const qp = QueryParamSchema.parse(params);
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(qp)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        searchParams.append(key, String(item));
      }
    } else {
      searchParams.append(key, String(value));
    }
  }
  const result = searchParams.toString();
  return result ? `?${result}` : '';
}

interface RequestOptions<TResponse> {
  path: string;
  method: HttpMethod;
  query?: Record<string, unknown>;
  requestBody?: unknown;
  requestSchema?: ZodType<any>;
  responseSchema: { parse(value: unknown): TResponse };
}

export class SysMLApiClient {
  private readonly fetchImpl: typeof fetch;
  private readonly retry: Required<RetryOptions>;

  constructor(private readonly config: SysMLClientConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.retry = {
      retries: config.retry?.retries ?? 3,
      baseDelayMs: config.retry?.baseDelayMs ?? 300,
      maxDelayMs: config.retry?.maxDelayMs ?? 4000,
      backoffFactor: config.retry?.backoffFactor ?? 2,
    };
  }

  private async request<TResponse>({
    path,
    method,
    query,
    requestBody,
    requestSchema,
    responseSchema,
  }: RequestOptions<TResponse>): Promise<TResponse> {
    const url = `${this.config.baseUrl}${path}${buildQuery(query)}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.token) {
      headers.Authorization = `Bearer ${this.config.token}`;
    }

    let parsedBody: unknown = requestBody;
    if (requestSchema) {
      try {
        parsedBody = requestSchema.parse(requestBody);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new SysMLRequestError('Request body validation failed', { type: 'validation', error: err });
        }
        throw err;
      }
    }

    let attempt = 0;
    let delay = this.retry.baseDelayMs;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      attempt += 1;
      try {
        const response = await this.fetchImpl(url, {
          method,
          headers,
          body: parsedBody !== undefined ? JSON.stringify(parsedBody) : undefined,
        });

        if (!response.ok) {
          let errorBody: unknown;
          try {
            const text = await response.text();
            errorBody = text ? JSON.parse(text) : undefined;
          } catch (err) {
            errorBody = undefined;
          }

          const parsedError = errorBody ? ErrorResponseSchema.safeParse(errorBody) : undefined;
          const message = parsedError?.success
            ? `${parsedError.data.errorCode}: ${parsedError.data.message}`
            : `Request failed with status ${response.status}`;

          throw new SysMLRequestError(message, { type: 'http', status: response.status, body: errorBody }, response);
        }

        if (response.status === 204) {
          return undefined as TResponse;
        }

        const raw = await response.json();
        try {
          return responseSchema.parse(raw);
        } catch (err) {
          if (err instanceof ZodError) {
            throw new SysMLRequestError('Response validation failed', { type: 'validation', error: err }, response);
          }
          throw err;
        }
      } catch (error) {
        const isRetryable =
          error instanceof SysMLRequestError &&
          error.causeDetail.type === 'http' &&
          error.causeDetail.status >= 500 &&
          attempt <= this.retry.retries;

        if (isRetryable) {
          await sleep(Math.min(delay, this.retry.maxDelayMs));
          delay *= this.retry.backoffFactor;
          continue;
        }

        if (error instanceof SysMLRequestError) {
          throw error;
        }

        if (attempt <= this.retry.retries) {
          await sleep(Math.min(delay, this.retry.maxDelayMs));
          delay *= this.retry.backoffFactor;
          continue;
        }

        throw new SysMLRequestError('Network request failed', { type: 'network', error: error as Error });
      }
    }
  }

  listProjects(params?: ListProjectsParams): Promise<ProjectListResponse> {
    return this.request({
      path: '/projects',
      method: 'GET',
      query: params,
      responseSchema: ProjectListResponseSchema,
    });
  }

  createProject(params: CreateProjectParams): Promise<ProjectResponse> {
    return this.request({
      path: '/projects',
      method: 'POST',
      requestBody: params.body,
      requestSchema: CreateProjectRequestSchema,
      responseSchema: ProjectResponseSchema,
    });
  }

  getProject(params: GetProjectParams): Promise<ProjectResponse> {
    return this.request({
      path: `/projects/${encodeURIComponent(params.projectId)}`,
      method: 'GET',
      responseSchema: ProjectResponseSchema,
    });
  }

  deleteProject(params: DeleteProjectParams): Promise<void> {
    return this.request({
      path: `/projects/${encodeURIComponent(params.projectId)}`,
      method: 'DELETE',
      responseSchema: { parse: () => undefined },
    });
  }

  listCommits(params: ListCommitsParams): Promise<CommitListResponse> {
    const { projectId, ...query } = params;
    return this.request({
      path: `/projects/${encodeURIComponent(projectId)}/commits`,
      method: 'GET',
      query,
      responseSchema: CommitListResponseSchema,
    });
  }

  createCommit(params: CreateCommitParams): Promise<CommitResponse> {
    const { projectId, body } = params;
    return this.request({
      path: `/projects/${encodeURIComponent(projectId)}/commits`,
      method: 'POST',
      requestBody: body,
      requestSchema: CreateCommitRequestSchema,
      responseSchema: CommitResponseSchema,
    });
  }

  getCommit(params: GetCommitParams): Promise<CommitResponse> {
    const { projectId, commitId } = params;
    return this.request({
      path: `/projects/${encodeURIComponent(projectId)}/commits/${encodeURIComponent(commitId)}`,
      method: 'GET',
      responseSchema: CommitResponseSchema,
    });
  }

  listElements(params: ListElementsParams): Promise<ListElementsResponse> {
    const { projectId, commitId, ...query } = params;
    return this.request({
      path: `/projects/${encodeURIComponent(projectId)}/commits/${encodeURIComponent(commitId)}/elements`,
      method: 'GET',
      query,
      responseSchema: ListElementsResponseSchema,
    });
  }

  createElement(params: CreateElementParams): Promise<ElementResponse> {
    const { projectId, commitId, body } = params;
    return this.request({
      path: `/projects/${encodeURIComponent(projectId)}/commits/${encodeURIComponent(commitId)}/elements`,
      method: 'POST',
      requestBody: body,
      requestSchema: ElementUpsertSchema,
      responseSchema: ElementResponseSchema,
    });
  }

  getElement(params: GetElementParams): Promise<ElementResponse> {
    const { projectId, commitId, elementId } = params;
    return this.request({
      path: `/projects/${encodeURIComponent(projectId)}/commits/${encodeURIComponent(commitId)}/elements/${encodeURIComponent(
        elementId,
      )}`,
      method: 'GET',
      responseSchema: ElementResponseSchema,
    });
  }

  updateElement(params: UpdateElementParams): Promise<ElementResponse> {
    const { projectId, commitId, elementId, body } = params;
    return this.request({
      path: `/projects/${encodeURIComponent(projectId)}/commits/${encodeURIComponent(commitId)}/elements/${encodeURIComponent(
        elementId,
      )}`,
      method: 'PUT',
      requestBody: body,
      requestSchema: ElementUpsertSchema,
      responseSchema: ElementResponseSchema,
    });
  }

  deleteElement(params: DeleteElementParams): Promise<void> {
    const { projectId, commitId, elementId } = params;
    return this.request({
      path: `/projects/${encodeURIComponent(projectId)}/commits/${encodeURIComponent(commitId)}/elements/${encodeURIComponent(
        elementId,
      )}`,
      method: 'DELETE',
      responseSchema: { parse: () => undefined },
    });
  }
}
