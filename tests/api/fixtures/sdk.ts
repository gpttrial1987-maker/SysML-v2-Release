import { SysMLSDK } from '../../../src/sysml-sdk';

const defaultBaseUrl = 'http://localhost:9000/api';

const baseUrl = process.env.SYSML_API_URL ?? defaultBaseUrl;
const token = process.env.SYSML_API_TOKEN;

export const sdk = new SysMLSDK({ baseUrl, token });

async function probeApi(): Promise<boolean> {
  try {
    await sdk.listProjects({ limit: 1 });
    return true;
  } catch (error) {
    console.warn('[sysml-sdk] Unable to reach SysML API:', error);
    return false;
  }
}

export const apiAvailablePromise: Promise<boolean> = probeApi();
