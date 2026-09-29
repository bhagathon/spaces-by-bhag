import { useCallback, useEffect, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { windowIdAtom } from './atoms';
import { CloseIcon, DownIcon, LinkIcon, PlusIcon, UpIcon } from './Icons';
import { getStorage } from '../storage';
import { mergeResources } from '../storage/SyncingProvider';
import { newId } from '../shared/ids';
import type { ResourceItem, ResourceSection, ResourcesInput } from '../shared/types';
import { isSafeUrl } from '../shared/url';

const SAVE_DELAY_MS = 600;

/**
 * The verso of a Space's card: notes, tasks and saved links, like Workona's
 * resources. Edits save automatically; a concurrent change (another tab, another
 * device) is merged by item, with this editor's version winning where both changed.
 */
export function Verso({
  spaceId,
  workspaceId,
  spaceName,
  readOnly,
  onError,
}: {
  spaceId: string;
  workspaceId: string;
  spaceName: string;
  readOnly: boolean;
  onError: (e: string) => void;
}) {
  return (
    <>
      <header className="verso-head">
        <h2 className="verso-title">
          {spaceName}
          <small>resources</small>
        </h2>
        {readOnly && <span className="stamp">View only</span>}
      </header>
      <ResourceEditor spaceId={spaceId} workspaceId={workspaceId} readOnly={readOnly} onError={onError} />
    </>
  );
}

function ResourceEditor({ spaceId, workspaceId, readOnly, onError }: { spaceId: string; workspaceId: string; readOnly: boolean; onError: (e: string) => void }) {
  const [doc, setDoc] = useState<ResourcesInput | null>(null);
  const rev = useRef<number | undefined>(undefined);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef<ResourcesInput | null>(null);

  useEffect(() => {
    let unsub = () => {};
    let cancelled = false;
    void getStorage().then(async store => {
      const existing = await store.getResources(spaceId);
      if (cancelled) return;
      rev.current = existing?.rev;
      const initial = existing ? { spaceId, workspaceId, sections: existing.sections } : { spaceId, workspaceId, sections: [] };
      latest.current = initial;
      setDoc(initial);
      unsub = store.subscribe(workspaceId, e => {
        if (e.type !== 'resources.updated' || e.resources.spaceId !== spaceId) return;
        if (dirty.current || (rev.current !== undefined && e.resources.rev <= rev.current)) return;
        rev.current = e.resources.rev;
        const next = { spaceId, workspaceId, sections: e.resources.sections };
        latest.current = next;
        setDoc(next);
      });
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [spaceId, workspaceId]);

  const save = useCallback(async () => {
    const input = latest.current;
    if (!input) return;
    const store = await getStorage();
    let toWrite = input;
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await store.putResources(toWrite, rev.current ?? 0);
      if (r.ok) {
        rev.current = r.rev;
        if (latest.current === input) dirty.current = false;
        if (toWrite !== input) {
          latest.current = toWrite;
          setDoc(toWrite);
        }
        return;
      }
      rev.current = r.current.rev;
      toWrite = mergeResources(toWrite, { spaceId, workspaceId, sections: r.current.sections });
    }
    throw new Error('Could not save resources: they kept changing. Try again.');
  }, [spaceId, workspaceId]);

  // Flush a pending save when leaving this Space or closing the page.
  useEffect(() => {
    const flush = () => {
      if (dirty.current) {
        clearTimeout(timer.current);
        void save();
      }
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [save]);

  const update = (fn: (sections: ResourceSection[]) => ResourceSection[]) => {
    if (!latest.current || readOnly) return;
    const next = { ...latest.current, sections: fn(latest.current.sections) };
    latest.current = next;
    dirty.current = true;
    setDoc(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save().catch(e => onError(e instanceof Error ? e.message : String(e))), SAVE_DELAY_MS);
  };

  const updateSection = (id: string, fn: (s: ResourceSection) => ResourceSection | null) =>
    update(sections => sections.flatMap(s => (s.id === id ? (fn(s) ?? []) : [s])));

  if (!doc) return <p className="verso-empty">Turning the card over…</p>;

  return (
    <div className="resources">
      {!doc.sections.length && (
        <p className="verso-empty">
          {readOnly ? 'No resources for this Space.' : 'No resources yet. Add a section for the notes, tasks and links that go with this Space.'}
        </p>
      )}
      {doc.sections.map(section => (
        <Section key={section.id} section={section} readOnly={readOnly} onChange={fn => updateSection(section.id, fn)} onError={onError} />
      ))}
      {!readOnly && (
        <div className="res-add">
          <button className="text-button" onClick={() => update(sections => [...sections, { id: newId(), title: 'New section', items: [] }])}>
            <PlusIcon />
            Add section
          </button>
        </div>
      )}
    </div>
  );
}

function Section({
  section,
  readOnly,
  onChange,
  onError,
}: {
  section: ResourceSection;
  readOnly: boolean;
  onChange: (fn: (s: ResourceSection) => ResourceSection | null) => void;
  onError: (e: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const windowId = useAtomValue(windowIdAtom);

  const setItem = (id: string, patch: Partial<ResourceItem> | null) =>
    onChange(s => ({ ...s, items: s.items.flatMap(i => (i.id === id ? (patch ? [{ ...i, ...patch } as ResourceItem] : []) : [i])) }));
  const addItem = (item: ResourceItem) => onChange(s => ({ ...s, items: [...s.items, item] }));
  const move = (id: string, delta: number) =>
    onChange(s => {
      const items = [...s.items];
      const i = items.findIndex(x => x.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= items.length) return s;
      [items[i], items[j]] = [items[j], items[i]];
      return { ...s, items };
    });

  const addCurrentTab = async () => {
    const [tab] = await chrome.tabs.query({ active: true, windowId: windowId ?? undefined });
    if (!tab?.url || !/^https?:/.test(tab.url)) return onError('The active tab isn’t a web page. Open the page you want to save, then use the side panel.');
    addItem({ id: newId(), kind: 'link', url: tab.url, title: tab.title || tab.url, favIconUrl: tab.favIconUrl?.startsWith('data:') ? undefined : tab.favIconUrl });
  };

  const addUrl = () => {
    let url = linkUrl.trim();
    if (!url) return;
    if (!/^[a-z]+:/i.test(url)) url = `https://${url}`;
    try {
      new URL(url);
    } catch {
      return onError(`“${linkUrl}” isn’t a valid URL.`);
    }
    if (!isSafeUrl(url)) return onError('Script links (javascript:, data:) can’t be saved.');
    addItem({ id: newId(), kind: 'link', url, title: url });
    setLinkUrl('');
  };

  return (
    <section className={`res-section${section.items.length === 0 ? ' is-empty' : ''}`}>
      <header className="res-section-head">
        <input
          className="res-section-title"
          aria-label="Section title"
          value={section.title}
          readOnly={readOnly}
          onChange={e => onChange(s => ({ ...s, title: e.target.value }))}
        />
        {!readOnly &&
          (confirmDelete ? (
            <>
              <button className="text-button danger" onClick={() => onChange(() => null)}>
                Delete section
              </button>
              <button className="text-button" onClick={() => setConfirmDelete(false)}>
                Keep
              </button>
            </>
          ) : (
            <button className="text-button" onClick={() => setConfirmDelete(true)} aria-label={`Delete section ${section.title}`}>
              Delete
            </button>
          ))}
      </header>

      <ul className="res-items">
        {section.items.map((item, idx) => (
          <li key={item.id} className={`res-item res-${item.kind}`}>
            {item.kind === 'note' && (
              <textarea
                aria-label="Note"
                value={item.text}
                readOnly={readOnly}
                rows={Math.min(12, Math.max(2, item.text.split('\n').length))}
                placeholder="Write a note…"
                onChange={e => setItem(item.id, { text: e.target.value })}
              />
            )}
            {item.kind === 'task' && (
              <label className="res-task">
                <input type="checkbox" checked={item.done} disabled={readOnly} onChange={e => setItem(item.id, { done: e.target.checked })} />
                <input
                  aria-label="Task"
                  className={item.done ? 'done' : ''}
                  value={item.text}
                  readOnly={readOnly}
                  placeholder="Task"
                  onChange={e => setItem(item.id, { text: e.target.value })}
                />
              </label>
            )}
            {item.kind === 'link' && (
              <a className="res-link" href={isSafeUrl(item.url) ? item.url : undefined} target="_blank" rel="noreferrer">
                {item.favIconUrl && /^https?:/.test(item.favIconUrl) ? <img src={item.favIconUrl} alt="" width={14} height={14} /> : <span className="res-link-icon"><LinkIcon /></span>}
                <span>{item.title}</span>
              </a>
            )}
            {!readOnly && (
              <span className="res-item-actions">
                <button className="icon-button" onClick={() => move(item.id, -1)} disabled={idx === 0} aria-label="Move up">
                  <UpIcon />
                </button>
                <button className="icon-button" onClick={() => move(item.id, 1)} disabled={idx === section.items.length - 1} aria-label="Move down">
                  <DownIcon />
                </button>
                <button className="icon-button" onClick={() => setItem(item.id, null)} aria-label="Remove">
                  <CloseIcon />
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>

      {!readOnly && (
        <div className="res-add" style={{ marginLeft: 0 }}>
          <button className="text-button" onClick={() => addItem({ id: newId(), kind: 'note', text: '' })}>
            <PlusIcon />
            Note
          </button>
          <button className="text-button" onClick={() => addItem({ id: newId(), kind: 'task', text: '', done: false })}>
            <PlusIcon />
            Task
          </button>
          <button className="text-button" onClick={() => void addCurrentTab()}>
            <PlusIcon />
            Current tab
          </button>
          <form
            className="res-url"
            onSubmit={e => {
              e.preventDefault();
              addUrl();
            }}
          >
            <input className="typed-input" aria-label="Link URL" placeholder="Paste a link" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} />
            <button type="submit" className="text-button" disabled={!linkUrl.trim()}>
              Add
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
