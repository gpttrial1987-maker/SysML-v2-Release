import type { CommitResponse } from '../../../src/sysml-sdk';
import { sdk } from './sdk';

export async function ensureLatestCommit(projectId: string, branchId: string): Promise<CommitResponse['data']> {
  const commits = await sdk.listCommits({ projectId, branchId, limit: 1 });
  const latest = commits.items.at(0);
  if (latest) {
    return latest;
  }

  const created = await sdk.createCommit({
    projectId,
    body: {
      message: 'Initialize branch for integration testing',
      branchId,
      operations: [],
    },
  });

  return created.data;
}
