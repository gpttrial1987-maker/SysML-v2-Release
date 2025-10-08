import type { CreateProjectParams } from '../../../src/sysml-sdk';
import { uniqueName } from './test-helpers';

export function createProjectParams(): CreateProjectParams {
  return {
    body: {
      name: uniqueName('sdk-integration-project'),
      description: 'Integration test project created by SysML SDK Vitest suite.',
    },
  };
}
