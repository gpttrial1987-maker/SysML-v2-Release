import { apiAvailablePromise } from './sdk';

const availability = await apiAvailablePromise;

export const describeIfApi = availability ? describe : describe.skip;
export const itIfApi = availability ? it : it.skip;
export const testIfApi = itIfApi;

export function uniqueName(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 8);
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `${prefix}-${timestamp}-${random}`;
}
