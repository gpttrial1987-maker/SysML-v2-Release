import { execSync } from 'node:child_process';
import path from 'node:path';

export default async function globalTeardown(): Promise<void> {
  const rootDir = path.resolve(__dirname, '../../..');
  const composeFile = path.join(rootDir, 'tests', 'playwright', 'docker-compose.playwright.yml');
  try {
    execSync(`docker compose -f ${composeFile} down --remove-orphans --volumes`, {
      stdio: 'inherit',
    });
  } catch (error) {
    // Ignore teardown failures so they do not mask test results.
  }
}
