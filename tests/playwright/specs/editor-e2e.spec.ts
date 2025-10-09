import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { buildBlockConnectorGraph, layoutBlockConnectorGraph } from '../../../src/graph';

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

let runtimeConfig: RuntimeConfig;

async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const configPath = path.resolve(__dirname, '..', '.runtime', 'runtime-config.json');
  const buffer = await fs.readFile(configPath, 'utf-8');
  return JSON.parse(buffer) as RuntimeConfig;
}

test.beforeAll(async () => {
  runtimeConfig = await loadRuntimeConfig();
});

test('authoring and modeling workflow', async ({ page }) => {
  const { apiBaseUrl, validationUrl, project } = runtimeConfig;

  await page.goto('/');

  await page.getByLabel('Validation endpoint').fill(validationUrl);

  const sysmlSnippet = [
    'package Playwright::Example {',
    '  part controller : Controller { id = ctrl_controller; }',
    '',
    '  block Controller {',
    '    attribute desiredSpeed : Real;',
    '  }',
    '}',
  ].join('\n');

  const editorTextArea = page.locator('.monaco-editor textarea').first();
  await editorTextArea.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(sysmlSnippet, { delay: 10 });

  await page.getByRole('button', { name: /Validate now/i }).click();
  await expect(page.locator('.status-pill')).toContainText(/No diagnostics|diagnostic/i);

  await page.getByLabel('API base URL').fill(apiBaseUrl);
  await page.getByLabel('Project ID').fill(project.projectId);
  await page.getByLabel('Commit ID').fill(project.commitId);
  await page.getByLabel('Root element ID').fill(project.rootElementId);
  await page.locator('.outline-refresh').click();

  await expect(page.getByRole('treeitem', { name: /PlaywrightRoot/i })).toBeVisible();

  const blockPanel = page.locator('.wizard-panel').filter({ hasText: 'New Block' });
  await blockPanel.locator('summary').click();
  await blockPanel.getByLabel('Name').fill('WheelController');
  await blockPanel.getByLabel('Short name (optional)').fill('WheelCtrl');
  await blockPanel.getByLabel('Documentation (optional)').fill('Created during Playwright test run.');

  await page.getByRole('treeitem', { name: /PlaywrightRoot/i }).click();
  await blockPanel.getByRole('button', { name: /Create block/i }).click();
  await expect(blockPanel.locator('.wizard-feedback.success')).toContainText(/created|commit/i);

  await expect(page.getByRole('treeitem', { name: /WheelController/i })).toBeVisible();

  const response = await page.request.get(
    `${apiBaseUrl}/projects/${encodeURIComponent(project.projectId)}/commits/${encodeURIComponent(project.commitId)}/elements?classifierId=sysml:BlockDefinition&limit=100`,
  );
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  const items = Array.isArray(payload.items) ? payload.items : [];
  const graph = buildBlockConnectorGraph(items);
  const layout = await layoutBlockConnectorGraph(graph, { direction: 'RIGHT' });

  const diagramInfo = await page.evaluate(({ nodes, layoutNodes, edgeCount }) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('id', 'playwright-block-diagram');
    svg.setAttribute('viewBox', '0 0 800 600');
    svg.style.width = '480px';
    svg.style.height = '360px';
    svg.style.border = '1px solid currentColor';

    for (const node of nodes) {
      const layoutNode = layoutNodes[node.id];
      if (!layoutNode) continue;
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('transform', `translate(${layoutNode.x}, ${layoutNode.y})`);
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('width', String(layoutNode.width));
      rect.setAttribute('height', String(layoutNode.height));
      rect.setAttribute('rx', '8');
      rect.setAttribute('fill', '#1f2937');
      rect.setAttribute('stroke', '#60a5fa');
      rect.setAttribute('stroke-width', '2');
      group.appendChild(rect);

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.textContent = node.label;
      label.setAttribute('x', '12');
      label.setAttribute('y', '28');
      label.setAttribute('fill', '#f9fafb');
      label.setAttribute('font-size', '18');
      label.setAttribute('font-family', 'Inter, sans-serif');
      group.appendChild(label);

      svg.appendChild(group);
    }

    document.body.appendChild(svg);
    return { nodeCount: nodes.length, edgeCount };
  }, {
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      label: node.label ?? node.elementId,
    })),
    layoutNodes: layout.nodes,
    edgeCount: graph.edges.length,
  });

  await expect(page.locator('#playwright-block-diagram')).toBeVisible();
  expect(diagramInfo.nodeCount).toBeGreaterThan(0);
});
