import type { ElementUpsert } from '../../../src/sysml-sdk';
import { uniqueName } from './test-helpers';

export interface ElementFixture {
  create: ElementUpsert;
  update: ElementUpsert;
}

export function requirementDefinitionFixture(): ElementFixture {
  const baseName = uniqueName('sdk-requirement');
  return {
    create: {
      classifierId: 'sysml:RequirementDefinition',
      name: `${baseName}-create`,
      documentation: 'Initial requirement definition created via integration test.',
      payload: {
        '@type': 'RequirementDefinition',
        declaredName: `${baseName}-Create`,
        declaredShortName: `${baseName}-C`,
        text: ['The system shall demonstrate integration coverage.'],
        reqId: `${baseName}-001`,
      },
    },
    update: {
      classifierId: 'sysml:RequirementDefinition',
      name: `${baseName}-update`,
      documentation: 'Updated requirement definition via integration test.',
      payload: {
        '@type': 'RequirementDefinition',
        declaredName: `${baseName}-Updated`,
        declaredShortName: `${baseName}-U`,
        text: ['The system shall demonstrate updated integration coverage.'],
        reqId: `${baseName}-002`,
      },
    },
  };
}
