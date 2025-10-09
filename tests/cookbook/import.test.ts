import { describe, expect, it, vi } from 'vitest';
import {
  CookbookImportSession,
  SysMLSDK,
  parseCookbookNotebook,
  type CookbookNotebook,
} from '../../src/sysml-sdk';

describe('Cookbook notebook import', () => {
  const notebookFixture = {
    cells: [
      {
        cell_type: 'markdown',
        source: ['# Sample Cookbook Notebook\n', '\n', 'This notebook records API requests.'],
      },
      {
        cell_type: 'code',
        source: ['api_calls'],
        outputs: [
          {
            output_type: 'display_data',
            data: {
              'application/json': {
                apiCalls: [
                  {
                    method: 'POST',
                    url: 'https://sysml2.example/api/projects',
                    body: { name: 'Demo Project', defaultBranch: 'main' },
                  },
                  {
                    request: {
                      method: 'POST',
                      url: 'https://sysml2.example/api/projects/demo/commits',
                      payload: {
                        message: 'Initial import',
                        operations: [],
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    ],
  } satisfies CookbookNotebook['raw'];

  it('parses API calls from notebook outputs', () => {
    const parsed = parseCookbookNotebook(notebookFixture);

    expect(parsed.title).toBe('Sample Cookbook Notebook');
    expect(parsed.apiCalls).toHaveLength(2);
    expect(parsed.apiCalls[0]).toMatchObject({
      method: 'POST',
      url: 'https://sysml2.example/api/projects',
    });
    expect(parsed.apiCalls[0].body).toMatchObject({ name: 'Demo Project' });
    expect(parsed.apiCalls[1]).toMatchObject({
      method: 'POST',
      url: 'https://sysml2.example/api/projects/demo/commits',
    });
  });

  it('appends dryRun to mutating requests and preserves headers', async () => {
    const parsed = parseCookbookNotebook(notebookFixture);

    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response('{}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const session = new CookbookImportSession(
      { baseUrl: 'http://localhost:9000/api', token: 'local-token' },
      parsed,
      fetchMock,
    );

    const dryRun = await session.dryRun();
    expect(dryRun.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(parsed.apiCalls.length);

    for (const call of fetchMock.mock.calls) {
      const [url, init] = call;
      expect(typeof url).toBe('string');
      if (typeof url === 'string') {
        expect(url.startsWith('http://localhost:9000/api')).toBe(true);
        expect(url.includes('dryRun=true')).toBe(true);
      }
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer local-token');
      expect(headers.Accept).toBe('application/json');
    }

    fetchMock.mockClear();

    const persist = await session.persist();
    expect(persist.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(parsed.apiCalls.length);
    for (const call of fetchMock.mock.calls) {
      const [url] = call;
      if (typeof url === 'string') {
        expect(url.includes('dryRun=')).toBe(false);
      }
    }
  });

  it('runs dry-run first and then persists when confirmed', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response('{}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const sdk = new SysMLSDK({ baseUrl: 'http://localhost:9000/api', fetchImpl: fetchMock });
    const confirmPersist = vi.fn().mockResolvedValue(true);

    const result = await sdk.importCookbookNotebook({
      notebook: JSON.stringify(notebookFixture),
      confirmPersist,
    });

    expect(confirmPersist).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(parseCookbookNotebook(notebookFixture).apiCalls.length * 2);
    expect(result.persisted).toBe(true);
    expect(result.persistResult?.success).toBe(true);
  });

  it('skips persistence when confirmation denies', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response('{}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const sdk = new SysMLSDK({ baseUrl: 'http://localhost:9000/api', fetchImpl: fetchMock });
    const confirmPersist = vi.fn().mockResolvedValue(false);

    const result = await sdk.importCookbookNotebook({
      notebook: JSON.stringify(notebookFixture),
      confirmPersist,
    });

    expect(confirmPersist).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(parseCookbookNotebook(notebookFixture).apiCalls.length);
    expect(result.persisted).toBe(false);
    expect(result.persistResult).toBeUndefined();
  });
});
