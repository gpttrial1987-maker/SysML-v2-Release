import { beforeAll, afterAll, expect } from 'vitest';
import { sdk } from './fixtures/sdk';
import { describeIfApi, testIfApi } from './fixtures/test-helpers';
import { createProjectParams } from './fixtures/project';
import { requirementDefinitionFixture } from './fixtures/element';
import { ensureLatestCommit } from './fixtures/commit';

describeIfApi('Element CRUD operations', () => {
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

  testIfApi('creates an element in the workspace commit', async () => {
    const element = await sdk.createElement({
      projectId,
      commitId,
      body: elementFixture.create,
    });

    elementId = element.data.id;
    expect(element.data.classifierId).toBe(elementFixture.create.classifierId);
    expect(element.data.name).toBe(elementFixture.create.name);
  });

  testIfApi('retrieves the created element', async () => {
    const response = await sdk.getElement({ projectId, commitId, elementId });
    expect(response.data.id).toBe(elementId);
    expect(response.data.name).toBe(elementFixture.create.name);
  });

  testIfApi('updates the element metadata', async () => {
    const response = await sdk.updateElement({
      projectId,
      commitId,
      elementId,
      body: elementFixture.update,
    });

    expect(response.data.id).toBe(elementId);
    expect(response.data.name).toBe(elementFixture.update.name);
    expect(response.data.documentation).toBe(elementFixture.update.documentation);
  });

  testIfApi('lists elements filtered by classifier', async () => {
    const response = await sdk.listElements({
      projectId,
      commitId,
      classifierId: elementFixture.update.classifierId,
      limit: 20,
    });

    const ids = response.items.map((item) => item.id);
    expect(ids).toContain(elementId);
  });

  testIfApi('deletes the element from the workspace', async () => {
    await sdk.deleteElement({ projectId, commitId, elementId });

    const response = await sdk.listElements({
      projectId,
      commitId,
      classifierId: elementFixture.update.classifierId,
    });

    const ids = response.items.map((item) => item.id);
    expect(ids).not.toContain(elementId);
  });
});
