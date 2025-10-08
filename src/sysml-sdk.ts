import { SysMLApiClient, SysMLRequestError, type SysMLClientConfig } from './generated/client';
import type {
  CommitListResponse,
  CommitResponse,
  CreateCommitParams,
  CreateElementParams,
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
} from './generated/types';
import { ZodError } from './utils/zod-lite';

export type { SysMLClientConfig } from './generated/client';
export type {
  CommitListResponse,
  CommitResponse,
  CreateCommitParams,
  CreateElementParams,
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
} from './generated/types';

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
}

export * from './graph';
