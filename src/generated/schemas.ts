import { z } from '../utils/zod-lite';
import type {
  ChangeOperation,
  CommitListResponse,
  CommitResponse,
  CommitSummary,
  CreateCommitRequest,
  CreateProjectRequest,
  ElementRecord,
  ElementResponse,
  ElementUpsert,
  ErrorResponse,
  ListElementsResponse,
  ProjectListResponse,
  ProjectResponse,
  ProjectSummary,
} from './types';

export const ErrorResponseSchema = z.object({
  errorCode: z.string(),
  message: z.string(),
  details: z.record(z.any()).optional(),
});

export const ProjectSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  defaultBranch: z.string(),
});

export const ProjectListResponseSchema = z.object({
  items: ProjectSummarySchema.array(),
});

export const ProjectResponseSchema = z.object({
  data: ProjectSummarySchema,
});

export const CreateProjectRequestSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  defaultBranch: z.string().optional(),
});

export const CommitSummarySchema = z.object({
  id: z.string(),
  message: z.string(),
  author: z.string(),
  createdAt: z.string(),
  parentIds: z.array(z.string()),
  branchId: z.string(),
});

export const CommitListResponseSchema = z.object({
  items: CommitSummarySchema.array(),
  cursor: z.string().optional(),
});

export const CommitResponseSchema = z.object({
  data: CommitSummarySchema,
});

export const ElementUpsertSchema = z.object({
  classifierId: z.string(),
  name: z.string().optional(),
  documentation: z.string().optional(),
  payload: z.record(z.any()),
});

export const ChangeOperationSchema = z.union([
  z.object({ type: z.literal('create'), element: ElementUpsertSchema }),
  z.object({ type: z.literal('update'), elementId: z.string(), patch: ElementUpsertSchema }),
  z.object({ type: z.literal('delete'), elementId: z.string() }),
]);

export const CreateCommitRequestSchema = z.object({
  message: z.string(),
  parentCommitId: z.string().optional(),
  branchId: z.string().optional(),
  operations: ChangeOperationSchema.array(),
});

export const ElementRecordSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  commitId: z.string(),
  classifierId: z.string(),
  name: z.string().optional(),
  documentation: z.string().optional(),
  payload: z.record(z.any()),
});

export const ElementResponseSchema = z.object({
  data: ElementRecordSchema,
});

export const ListElementsResponseSchema = z.object({
  items: ElementRecordSchema.array(),
  cursor: z.string().optional(),
});

export type {
  ErrorResponse,
  ProjectSummary,
  ProjectListResponse,
  ProjectResponse,
  CreateProjectRequest,
  CommitSummary,
  CommitListResponse,
  CommitResponse,
  ChangeOperation,
  CreateCommitRequest,
  ElementUpsert,
  ElementRecord,
  ElementResponse,
  ListElementsResponse,
};
