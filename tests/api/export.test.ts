import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, expect } from 'vitest';
import { sdk } from './fixtures/sdk';
import { describeIfApi, testIfApi } from './fixtures/test-helpers';
import { createProjectParams } from './fixtures/project';
import { requirementDefinitionFixture } from './fixtures/element';
import { ensureLatestCommit } from './fixtures/commit';

describeIfApi('Bundle exports', () => {
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

  testIfApi('exports SysML text bundle with manifest and checksums', async () => {
    const bundle = await sdk.exportSysMLTextBundle({ projectId, commitId });

    expect(bundle.manifest.format).toBe('sysml-text');
    expect(bundle.manifest.project.id).toBe(projectId);
    expect(bundle.manifest.commit.id).toBe(commitId);
    expect(bundle.manifest.elementCount).toBeGreaterThan(0);

    const manifestFile = bundle.files.find((file) => file.path === 'manifest.json');
    expect(manifestFile).toBeDefined();

    const manifestFromFile = JSON.parse(manifestFile!.contents);
    expect(manifestFromFile).toStrictEqual(bundle.manifest);

    const dataFiles = bundle.files.filter((file) => file.path !== 'manifest.json');
    expect(bundle.manifest.files).toHaveLength(dataFiles.length);

    for (const entry of bundle.manifest.files) {
      const file = dataFiles.find((item) => item.path === entry.path);
      expect(file).toBeDefined();
      expect(entry.checksum).toBe(createChecksum(file!.contents));
      expect(entry.size).toBe(Buffer.byteLength(file!.contents, 'utf8'));
    }

    const sysmlFilePath = `elements/${elementId}.sysml`;
    const sysmlFile = dataFiles.find((file) => file.path === sysmlFilePath);
    expect(sysmlFile).toBeDefined();
    expect(sysmlFile!.contents).toContain('RequirementDefinition');
    expect(sysmlFile!.contents).toContain(elementFixture.create.payload.text[0]);
  });

  testIfApi('exports API bundle suitable for re-import', async () => {
    const bundle = await sdk.exportApiBundle({ projectId, commitId });

    expect(bundle.manifest.format).toBe('api-json');
    expect(bundle.manifest.project.id).toBe(projectId);
    expect(bundle.manifest.commit.id).toBe(commitId);
    expect(bundle.manifest.elementCount).toBeGreaterThan(0);

    const manifestFile = bundle.files.find((file) => file.path === 'manifest.json');
    expect(manifestFile).toBeDefined();
    const manifestFromFile = JSON.parse(manifestFile!.contents);
    expect(manifestFromFile).toStrictEqual(bundle.manifest);

    const apiBundleFile = bundle.files.find((file) => file.path === 'api-bundle.json');
    expect(apiBundleFile).toBeDefined();

    const apiPayload = JSON.parse(apiBundleFile!.contents);
    expect(apiPayload.format).toBe('api-json');
    expect(apiPayload.bundleVersion).toBe(bundle.manifest.bundleVersion);
    expect(Array.isArray(apiPayload.elements)).toBe(true);
    expect(apiPayload.elements.length).toBe(bundle.manifest.elementCount);

    const elementFromBundle = apiPayload.elements.find((item: any) => item.id === elementId);
    expect(elementFromBundle).toBeDefined();
    expect(elementFromBundle.classifierId).toBe(elementFixture.create.classifierId);
    expect(elementFromBundle.payload).toStrictEqual(elementFixture.create.payload);

    const dataFiles = bundle.files.filter((file) => file.path !== 'manifest.json');
    for (const entry of bundle.manifest.files) {
      const file = dataFiles.find((item) => item.path === entry.path);
      expect(file).toBeDefined();
      expect(entry.checksum).toBe(createChecksum(file!.contents));
      expect(entry.size).toBe(Buffer.byteLength(file!.contents, 'utf8'));
    }
  });
});

function createChecksum(contents: string): string {
  return createHash('sha256').update(contents, 'utf8').digest('hex');
}
