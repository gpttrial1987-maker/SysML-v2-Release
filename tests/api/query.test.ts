import { beforeAll, afterAll, expect } from 'vitest';
import { sdk } from './fixtures/sdk';
import { describeIfApi, testIfApi } from './fixtures/test-helpers';
import { createProjectParams } from './fixtures/project';
import { requirementDefinitionFixture } from './fixtures/element';
import { ensureLatestCommit } from './fixtures/commit';

describeIfApi('Element query patterns', () => {
  const projectParams = createProjectParams();
  const elementFixture = requirementDefinitionFixture();

  let projectId: string;
  let commitId: string;
  let elementId: string;

  beforeAll(async () => {
    const project = await sdk.createProject(projectParams);
    projectId = project.data.id;

    const latestCommit = await ensureLatestCommit(projectId, project.data.defaultBranch);
    commitId = latestCommit.id;

    const element = await sdk.createElement({ projectId, commitId, body: elementFixture.create });
    elementId = element.data.id;
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

  testIfApi('supports cursor-based pagination', async () => {
    const firstPage = await sdk.listElements({ projectId, commitId, limit: 1 });
    expect(firstPage.items.length).toBeGreaterThanOrEqual(1);

    if (firstPage.cursor) {
      const secondPage = await sdk.listElements({ projectId, commitId, cursor: firstPage.cursor, limit: 1 });
      expect(secondPage.items).toBeDefined();
    }
  });

  testIfApi('filters elements by classifier id', async () => {
    const filtered = await sdk.listElements({
      projectId,
      commitId,
      classifierId: elementFixture.create.classifierId,
    });

    const ids = filtered.items.map((item) => item.id);
    expect(ids).toContain(elementId);
  });
});
