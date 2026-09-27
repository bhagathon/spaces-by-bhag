import type { Request, Response } from '../shared/types';

export async function send<T = unknown>(msg: Request): Promise<T> {
  const res = (await chrome.runtime.sendMessage(msg)) as Response<T> | undefined;
  if (!res) throw new Error('No response from background');
  if (!res.ok) throw new Error(res.error);
  return res.value as T;
}
