export interface ProjectSummary {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  defaultBranch: string;
}

export interface ProjectListResponse {
  items: ProjectSummary[];
}

export interface CreateProjectRequest {
  name: string;
  description?: string;
  defaultBranch?: string;
}

export interface CommitSummary {
  id: string;
  message: string;
  author: string;
  createdAt: string;
  parentIds: string[];
  branchId: string;
}

export interface CommitListResponse {
  items: CommitSummary[];
  cursor?: string;
}

export interface CreateCommitRequest {
  message: string;
  parentCommitId?: string;
  branchId?: string;
  operations: ChangeOperation[];
}

export type ChangeOperation =
  | { type: 'create'; element: ElementUpsert }
  | { type: 'update'; elementId: string; patch: ElementUpsert }
  | { type: 'delete'; elementId: string };

export interface ElementUpsert {
  classifierId: string;
  name?: string;
  documentation?: string;
  payload: Record<string, unknown>;
}

export interface ElementRecord {
  id: string;
  projectId: string;
  commitId: string;
  classifierId: string;
  name?: string;
  documentation?: string;
  payload: Record<string, unknown>;
}

export interface ErrorResponse {
  errorCode: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ListCommitsParams {
  projectId: string;
  branchId?: string;
  cursor?: string;
  limit?: number;
}

export interface CreateCommitParams {
  projectId: string;
  body: CreateCommitRequest;
}

export interface GetCommitParams {
  projectId: string;
  commitId: string;
}

export interface ListProjectsParams {
  search?: string;
  limit?: number;
  cursor?: string;
}

export interface CreateProjectParams {
  body: CreateProjectRequest;
}

export interface GetProjectParams {
  projectId: string;
}

export interface DeleteProjectParams {
  projectId: string;
}

export interface ListElementsParams {
  projectId: string;
  commitId: string;
  classifierId?: string;
  limit?: number;
  cursor?: string;
}

export interface ListElementsResponse {
  items: ElementRecord[];
  cursor?: string;
}

export interface GetElementParams {
  projectId: string;
  commitId: string;
  elementId: string;
}

export interface CreateElementParams {
  projectId: string;
  commitId: string;
  body: ElementUpsert;
}

export interface UpdateElementParams {
  projectId: string;
  commitId: string;
  elementId: string;
  body: ElementUpsert;
}

export interface DeleteElementParams {
  projectId: string;
  commitId: string;
  elementId: string;
}

export interface ElementResponse {
  data: ElementRecord;
}

export interface ProjectResponse {
  data: ProjectSummary;
}

export interface CommitResponse {
  data: CommitSummary;
}
