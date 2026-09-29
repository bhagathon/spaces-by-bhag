/**
 * A model running on this Mac (Ollama), for sorting a window's tabs by topic. Tab titles
 * and addresses go to it and nowhere else.
 */

const KEY = 'tabModel';
/** Removed: the Gemini settings (and its API key) from before sorting went local. */
const LEGACY_KEY = 'gemini';
const RULE_ID = 1;

export interface TabModelConfig {
  enabled: boolean;
  /** The Ollama server. */
  url: string;
  model: string;
  /** Re-sort a window a few seconds after tabs are opened or navigated. */
  autoSort: boolean;
}

export const TAB_MODEL_DEFAULTS: TabModelConfig = { enabled: false, url: 'http://localhost:11434', model: 'llama3.1:latest', autoSort: false };

export async function getTabModelConfig(): Promise<TabModelConfig> {
  const c = (await chrome.storage.local.get(KEY))[KEY] as Partial<TabModelConfig> | undefined;
  return { ...TAB_MODEL_DEFAULTS, ...c };
}

export async function setTabModelConfig(patch: Partial<TabModelConfig>) {
  const next = { ...(await getTabModelConfig()), ...patch };
  next.url = next.url.trim().replace(/\/+$/, '');
  await chrome.storage.local.set({ [KEY]: next });
  await allowOllama(next);
}

/** Forget the old Gemini settings, API key included. */
export async function dropLegacyGemini() {
  await chrome.storage.local.remove(LEGACY_KEY);
}

/**
 * Ollama refuses requests from origins it doesn't know, and a chrome-extension:// origin
 * isn't one. Drop the Origin header on this extension's own requests to the server only,
 * so websites stay blocked from the local model as before.
 */
export async function allowOllama(c?: TabModelConfig) {
  const { enabled, url } = c ?? (await getTabModelConfig());
  if (!chrome.declarativeNetRequest) return;
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [RULE_ID],
    addRules: enabled
      ? [
          {
            id: RULE_ID,
            priority: 1,
            action: { type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS, requestHeaders: [{ header: 'origin', operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE }] },
            condition: { urlFilter: `|${url}/`, initiatorDomains: [chrome.runtime.id], resourceTypes: [chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST, chrome.declarativeNetRequest.ResourceType.OTHER] },
          },
        ]
      : [],
  });
}

/** The models installed on the server, for the Settings picker. */
export async function listModels(url: string, fetchFn: typeof fetch = fetch): Promise<string[]> {
  const res = await fetchFn(`${url.replace(/\/+$/, '')}/api/tags`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
  if (!res?.ok) throw new Error(`Couldn’t reach Ollama at ${url}. Is it running?`);
  const { models = [] } = (await res.json()) as { models?: { name: string }[] };
  return models.map(m => m.name).filter(n => !/embed/i.test(n));
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
 * Asks the model for a few broad topics and a topic for each tab (small local models
 * group far better this way than when asked for an order). Returns a permutation of the
 * tabs' indices: topics in the model's order, tabs in their current order within one, and
 * anything unlabelled or invented handled so the result is always safe to apply.
 */
export async function orderByTopic(tabs: TabInfo[], c: Pick<TabModelConfig, 'url' | 'model'>, fetchFn: typeof fetch = fetch): Promise<{ order: number[]; topics: string[] }> {
  const most = Math.max(2, Math.min(8, Math.floor((tabs.length + 2) / 3)));
  const prompt = `Group these open browser tabs into a few broad topics so related tabs sit together.
First choose between 2 and ${most} broad topics (for example "Web development", "Travel", "Cooking", "Email"). Prefer fewer, broader topics: tabs about the same trip, project, subject or site belong together.
Then assign every tab to exactly one of those topics, using the topic's exact name.

Tabs:
${tabs.map((t, i) => `${i}. ${describe(t)}`).join('\n')}`;
  const res = await fetchFn(`${c.url}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // The first request after a while also loads the model into memory.
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({
      model: c.model,
      stream: false,
      options: { temperature: 0 },
      format: {
        type: 'object',
        properties: {
          topics: { type: 'array', items: { type: 'string' } },
          tabs: { type: 'array', items: { type: 'object', properties: { index: { type: 'integer' }, topic: { type: 'string' } }, required: ['index', 'topic'] } },
        },
        required: ['topics', 'tabs'],
      },
      messages: [{ role: 'user', content: prompt }],
    }),
  }).catch(e => {
    throw new Error(e?.name === 'TimeoutError' ? 'The local model took too long. Try again once it has loaded.' : `Couldn’t reach Ollama at ${c.url}. Is it running?`);
  });
  if (res.status === 403) throw new Error('Ollama refused the request. Turn sorting off and on again in Settings.');
  if (res.status === 404) throw new Error(`Ollama doesn’t have the model “${c.model}”. Pick another in Settings.`);
  if (!res.ok) throw new Error(`Ollama: ${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`);
  let answer: { topics?: string[]; tabs?: { index: number; topic: string }[] };
  try {
    answer = JSON.parse(((await res.json()) as { message?: { content?: string } }).message?.content ?? '');
  } catch {
    throw new Error('The local model’s answer couldn’t be read. Try sorting again.');
  }
  const topicOf = new Map<number, string>();
  for (const e of answer.tabs ?? []) {
    if (Number.isInteger(e.index) && e.index >= 0 && e.index < tabs.length && !topicOf.has(e.index) && e.topic?.trim()) topicOf.set(e.index, e.topic.trim());
  }
  // Topics in the model's order, then any it used without listing, in order of first use.
  const topics = [...new Set([...(answer.topics ?? []).map(t => t.trim()), ...[...topicOf.values()]])].filter(t => [...topicOf.values()].includes(t));
  const order = topics.flatMap(t => tabs.map((_, i) => i).filter(i => topicOf.get(i) === t));
  for (let i = 0; i < tabs.length; i++) if (!topicOf.has(i)) order.push(i);
  return { order, topics };
}
