import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { FullConfig } from '@playwright/test';

import { SysMLSDK } from '../../../src/sysml-sdk';
import type { CommitSummary } from '../../../src/generated/types';

const API_BASE_URL = 'http://localhost:9000/api';
const VALIDATION_ENDPOINT = `${API_BASE_URL}/validation`;

interface RuntimeProjectConfig {
  projectId: string;
  branchId: string;
  commitId: string;
  rootElementId: string;
}

interface RuntimeConfig {
  apiBaseUrl: string;
  validationUrl: string;
  project: RuntimeProjectConfig;
}

async function ensureDirectory(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

function runDockerCommand(rootDir: string, args: string[]): void {
  const composeFile = path.join(rootDir, 'tests', 'playwright', 'docker-compose.playwright.yml');
  const command = ['docker', 'compose', '-f', composeFile, ...args].join(' ');
  execSync(command, { stdio: 'inherit' });
}

async function waitForApiReady(url: string, attempts = 60, delayMs = 2000): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${url}/projects?limit=1`);
      if (response.ok) {
        return;
      }
    } catch (error) {
      // ignore until max attempts
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error('SysML API did not become ready in time.');
}

async function ensureSeedProject(sdk: SysMLSDK): Promise<RuntimeProjectConfig> {
  const seedName = 'playwright-seed-project';
  const projects = await sdk.listProjects({ search: seedName, limit: 10 });
  for (const project of projects.items) {
    if (project.name === seedName) {
      await sdk.deleteProject({ projectId: project.id });
    }
  }

  const projectResponse = await sdk.createProject({
    body: {
      name: seedName,
      description: 'Playwright integration tests for SysML editor.',
      defaultBranch: 'main',
    },
  });

  const project = projectResponse.data;
  const commit = await ensureLatestCommit(sdk, project.id, project.defaultBranch);

  const rootElement = await sdk.createElement({
    projectId: project.id,
    commitId: commit.id,
    body: {
      classifierId: 'sysml:Package',
      name: 'PlaywrightRoot',
      documentation: 'Root package created for Playwright UI tests.',
      payload: {
        '@type': 'Package',
        declaredName: 'PlaywrightRoot',
        declaredShortName: 'Playwright',
      },
    },
  });

  return {
    projectId: project.id,
    branchId: project.defaultBranch,
    commitId: commit.id,
    rootElementId: rootElement.data.id,
  };
}

async function ensureLatestCommit(
  sdk: SysMLSDK,
  projectId: string,
  branchId: string,
): Promise<CommitSummary> {
  const commits = await sdk.listCommits({ projectId, branchId, limit: 1 });
  const latest = commits.items.at(0);
  if (latest) {
    return latest;
  }
  const created = await sdk.createCommit({
    projectId,
    body: {
      message: 'Initialize branch for Playwright integration tests',
      branchId,
      operations: [],
    },
  });
  return created.data;
}

async function globalSetup(_config: FullConfig): Promise<void> {
  const rootDir = path.resolve(__dirname, '../../..');
  const runtimeDir = path.join(rootDir, 'tests', 'playwright', '.runtime');
  await ensureDirectory(runtimeDir);

  try {
    runDockerCommand(rootDir, ['down', '--remove-orphans', '--volumes']);
  } catch (error) {
    // The first run will fail because nothing is running yet. Ignore.
  }

  runDockerCommand(rootDir, ['up', '-d', '--wait']);
  await waitForApiReady(API_BASE_URL);

  const sdk = new SysMLSDK({ baseUrl: API_BASE_URL });
  const project = await ensureSeedProject(sdk);

  const runtimeConfig: RuntimeConfig = {
    apiBaseUrl: API_BASE_URL,
    validationUrl: VALIDATION_ENDPOINT,
    project,
  };

  const configPath = path.join(runtimeDir, 'runtime-config.json');
  await fs.writeFile(configPath, JSON.stringify(runtimeConfig, null, 2), 'utf-8');
}

export default globalSetup;
