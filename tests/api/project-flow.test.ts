import { beforeAll, afterAll, expect } from 'vitest';
import { sdk } from './fixtures/sdk';
import { createProjectParams } from './fixtures/project';
import { describeIfApi, testIfApi } from './fixtures/test-helpers';
import { ensureLatestCommit } from './fixtures/commit';

describeIfApi('Project and commit flows', () => {
  const projectParams = createProjectParams();
  let projectId: string;
  let defaultBranch: string;
  let latestCommitId: string | undefined;

  beforeAll(async () => {
    const project = await sdk.createProject(projectParams);
    projectId = project.data.id;
    defaultBranch = project.data.defaultBranch;
  });

  afterAll(async () => {
    if (projectId) {
      try {
        await sdk.deleteProject({ projectId });
      } catch (error) {
        console.warn('Failed to delete test project', error);
      }
    }
  });

  testIfApi('lists the created project via search', async () => {
    const response = await sdk.listProjects({ search: projectParams.body.name });
    const ids = response.items.map((item) => item.id);
    expect(ids).toContain(projectId);
  });

  testIfApi('retrieves project metadata', async () => {
    const response = await sdk.getProject({ projectId });
    expect(response.data.id).toBe(projectId);
    expect(response.data.defaultBranch).toBe(defaultBranch);
  });

  testIfApi('creates and fetches a commit on the default branch', async () => {
    const latest = await ensureLatestCommit(projectId, defaultBranch);
    const commit = await sdk.createCommit({
      projectId,
      body: {
        message: 'Integration test commit',
        branchId: defaultBranch,
        parentCommitId: latest.id,
        operations: [],
      },
    });

    latestCommitId = commit.data.id;
    expect(commit.data.branchId).toBe(defaultBranch);

    const fetched = await sdk.getCommit({ projectId, commitId: latestCommitId });
    expect(fetched.data.id).toBe(latestCommitId);
  });

  testIfApi('lists commits including the new commit', async () => {
    if (!latestCommitId) {
      fail('Commit was not created in previous step');
    }
    const commits = await sdk.listCommits({ projectId, branchId: defaultBranch, limit: 5 });
    const ids = commits.items.map((item) => item.id);
    expect(ids).toContain(latestCommitId);
  });
});
