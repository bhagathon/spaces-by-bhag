import { describe, expect, it, vi } from 'vitest';
import { orderByTopic } from '../src/shared/localModel';

const tabs = [
  { title: 'Inbox — Gmail', url: 'https://mail.google.com/mail/u/0/#inbox' },
  { title: 'react/useEffect', url: 'https://react.dev/reference/react/useEffect' },
  { title: 'Flights to Denver', url: 'https://www.google.com/travel/flights?q=den' },
  { title: 'useState', url: 'https://react.dev/reference/react/useState' },
];
const c = { url: 'http://localhost:11434', model: 'llama3.1:latest' };

const answer = (content: unknown, status = 200) =>
  vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify({ message: { content: JSON.stringify(content) } }), { status }),
  );

describe('orderByTopic (local model)', () => {
  it('orders by the model’s topics, keeping each topic’s tabs in their current order', async () => {
    const fetchFn = answer({
      topics: ['Web development', 'Email', 'Travel'],
      tabs: [
        { index: 3, topic: 'Web development' },
        { index: 0, topic: 'Email' },
        { index: 1, topic: 'Web development' },
        { index: 2, topic: 'Travel' },
      ],
    });
    expect(await orderByTopic(tabs, c, fetchFn)).toEqual({ order: [1, 3, 0, 2], topics: ['Web development', 'Email', 'Travel'] });
    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toBe('http://localhost:11434/api/chat');
    const body = JSON.parse(String(init!.body));
    expect(body.model).toBe('llama3.1:latest');
    expect(body.format.required).toEqual(['topics', 'tabs']);
    // Titles and short addresses go to the model; query strings don't.
    expect(body.messages[0].content).toContain('react.dev/reference/react/useEffect');
    expect(body.messages[0].content).not.toContain('q=den');
  });

  it('ignores invented and repeated indices and keeps unlabelled tabs at the end', async () => {
    const { order, topics } = await orderByTopic(
      tabs,
      c,
      answer({ topics: ['A', 'Unused'], tabs: [{ index: 3, topic: 'A' }, { index: 3, topic: 'B' }, { index: 9, topic: 'A' }, { index: 1, topic: 'A' }] }),
    );
    expect(order).toEqual([1, 3, 0, 2]);
    expect(topics).toEqual(['A']); // a listed topic no tab uses is dropped
  });

  it('explains a missing model', async () => {
    await expect(orderByTopic(tabs, c, answer({}, 404))).rejects.toThrow(/doesn’t have the model “llama3.1:latest”/);
  });
});
