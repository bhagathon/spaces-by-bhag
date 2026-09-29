/**
 * Gemini, for sorting a window's tabs by topic. The API key stays in
 * chrome.storage.local on this device; it is never synced or built into Spaces.
 */

const KEY = 'gemini';
const MODEL = 'gemini-flash-latest';

export interface GeminiConfig {
  apiKey?: string;
  /** Re-sort a window a few seconds after tabs are opened or navigated. */
  autoSort: boolean;
}

export async function getGeminiConfig(): Promise<GeminiConfig> {
  const c = (await chrome.storage.local.get(KEY))[KEY] as Partial<GeminiConfig> | undefined;
  return { autoSort: false, ...c, apiKey: c?.apiKey?.trim() || undefined };
}

export async function setGeminiConfig(patch: Partial<GeminiConfig>) {
  await chrome.storage.local.set({ [KEY]: { ...(await getGeminiConfig()), ...patch } });
}

export interface TabInfo {
  title: string;
  url: string;
}

/** A short, model-friendly description of a tab: its title and where it is, minus query noise. */
function describe(t: TabInfo) {
  let where = t.url;
  try {
    const u = new URL(t.url);
    where = `${u.hostname.replace(/^www\./, '')}${u.pathname === '/' ? '' : u.pathname}`.slice(0, 120);
  } catch {}
  return `${(t.title || 'Untitled').slice(0, 120)} — ${where}`;
}

/**
 * Asks Gemini for an order that keeps related tabs together. Returns a permutation of
 * the tabs' indices: anything the model leaves out keeps its place at the end, and
 * anything invented or repeated is dropped, so the result is always safe to apply.
 */
export async function orderByTopic(tabs: TabInfo[], apiKey: string, fetchFn: typeof fetch = fetch): Promise<{ order: number[]; topics: string[] }> {
  const list = tabs.map((t, i) => `${i}. ${describe(t)}`).join('\n');
  const prompt = `Sort these open browser tabs so related tabs sit next to each other.
Group them by topic or task (for example the same project, site, or subject). Order the groups
so the most substantial group comes first, and keep tabs in a group in their current relative
order unless another order is clearly more natural. Use every index exactly once.

Tabs:
${list}`;
  const res = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            groups: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: { topic: { type: 'STRING' }, tabs: { type: 'ARRAY', items: { type: 'INTEGER' } } },
                required: ['topic', 'tabs'],
              },
            },
          },
          required: ['groups'],
        },
      },
    }),
  });
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    const detail = ((await res.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message;
    throw new Error(`Gemini rejected the request${detail ? `: ${detail.slice(0, 160)}` : ''}. Check the API key in Settings.`);
  }
  if (res.status === 429) throw new Error('Gemini’s rate limit was hit. Try sorting again in a minute.');
  if (!res.ok) throw new Error(`Gemini: ${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`);
  const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = body.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? '';
  let groups: { topic: string; tabs: number[] }[] = [];
  try {
    groups = (JSON.parse(text) as { groups?: typeof groups }).groups ?? [];
  } catch {
    throw new Error('Gemini’s answer couldn’t be read. Try sorting again.');
  }
  const seen = new Set<number>();
  const order: number[] = [];
  for (const g of groups) for (const i of g.tabs ?? []) if (Number.isInteger(i) && i >= 0 && i < tabs.length && !seen.has(i)) seen.add(i), order.push(i);
  for (let i = 0; i < tabs.length; i++) if (!seen.has(i)) order.push(i);
  return { order, topics: groups.filter(g => g.tabs?.length).map(g => g.topic) };
}
