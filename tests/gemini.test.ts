import { describe, expect, it, vi } from 'vitest';
import { orderByTopic } from '../src/shared/gemini';

const tabs = [
  { title: 'Inbox — Gmail', url: 'https://mail.google.com/mail/u/0/#inbox' },
  { title: 'react/useEffect', url: 'https://react.dev/reference/react/useEffect' },
  { title: 'Flights to Denver', url: 'https://www.google.com/travel/flights?q=den' },
  { title: 'useState', url: 'https://react.dev/reference/react/useState' },
];

const answer = (groups: unknown, status = 200) =>
  vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify(status === 200 ? { candidates: [{ content: { parts: [{ text: JSON.stringify({ groups }) }] } }] } : { error: { message: 'API key not valid' } }), { status }),
  );

describe('orderByTopic', () => {
  it('returns the groups’ order and topics, and sends the key in a header, not the URL', async () => {
    const fetchFn = answer([
      { topic: 'React', tabs: [1, 3] },
      { topic: 'Email', tabs: [0] },
      { topic: 'Travel', tabs: [2] },
    ]);
    expect(await orderByTopic(tabs, 'k', fetchFn)).toEqual({ order: [1, 3, 0, 2], topics: ['React', 'Email', 'Travel'] });
    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).not.toContain('k=');
    expect((init!.headers as Record<string, string>)['x-goog-api-key']).toBe('k');
    // Titles and short addresses go to the model; query strings don't.
    expect(String(init!.body)).toContain('react.dev/reference/react/useEffect');
    expect(String(init!.body)).not.toContain('q=den');
  });

  it('drops invented and repeated indices and keeps left-out tabs at the end', async () => {
    const { order } = await orderByTopic(tabs, 'k', answer([{ topic: 'A', tabs: [3, 3, 9, -1, 1.5, 1] }]));
    expect(order).toEqual([3, 1, 0, 2]);
  });

  it('explains a rejected key', async () => {
    await expect(orderByTopic(tabs, 'bad', answer(null, 400))).rejects.toThrow(/API key not valid.*Settings/);
  });
});
