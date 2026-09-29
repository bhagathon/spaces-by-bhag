import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import { useAtomValue } from 'jotai';
import { currentSpaceIdAtom, openSpacesAtom, presenceAtom, spacesAtom, windowIdAtom, windowStatesAtom, workspacesAtom } from './atoms';
import { Agenda } from './Agenda';
import { getStorage, PERSONAL_WORKSPACE_ID } from '../storage';
import { send } from './api';
import { canEdit, SPACE_COLORS, type GroupColor, type PresenceUser, type Space, type SpaceEdit, type Workspace } from '../shared/types';
import type { Notice } from './notice';
import { Verso } from './Resources';
import { CloseIcon, DownIcon, FlipIcon, GlobeIcon, UpIcon } from './Icons';

/** Chrome's own tab-group colours: data, not decoration. */
/** Chrome's tab-group colours, as theme tokens (app.css defines light and dark values). */
const groupInk = (c: GroupColor = 'grey') => `var(--gc-${c})`;

const ENTRY_LIMIT = 14;
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

function ago(ts: number) {
  const s = Math.round((ts - Date.now()) / 1000);
  const abs = Math.abs(s);
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  return rtf.format(Math.round(s / 86400), 'day');
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const vtName = (id: string) => `card-${id.replace(/[^a-zA-Z0-9-]/g, '')}`;

function matches(space: Space, q: string) {
  if (!q) return { hit: true as const };
  if (space.name.toLowerCase().includes(q)) return { hit: true as const };
  const tab = space.tabs.find(t => t.title?.toLowerCase().includes(q) || t.url.toLowerCase().includes(q));
  return tab ? { hit: true as const, via: tab.title || tab.url } : { hit: false as const };
}

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

function Favicon({ url }: { url?: string }) {
  return url && /^https?:/.test(url) ? <img className="favicon" src={url} alt="" width={16} height={16} /> : <GlobeIcon className="icon favicon-blank" />;
}

/** Stamped state marks, always in the same cell. `single` keeps one stamp (card tops have one fixed cell). */
function Stamps({ here, elsewhere, others, single }: { here?: boolean; elsewhere?: boolean; others?: PresenceUser[]; single?: boolean }) {
  const devices = others ?? [];
  if (single) {
    if (devices.length) return <Stamps others={devices} />;
    return <span className="stamps">{here ? <span className="stamp stamp-here">Here</span> : elsewhere ? <span className="stamp">Open</span> : null}</span>;
  }
  return (
    <span className="stamps">
      {here && <span className="stamp stamp-here">Here</span>}
      {elsewhere && <span className="stamp">Open</span>}
      {devices.length > 0 && (
        <span className="stamp stamp-device" title={devices.map(d => d.name).join(', ')}>
          {devices[0].name.split(' · ').at(-1)}
          {devices.length > 1 ? ` +${devices.length - 1}` : ''}
        </span>
      )}
    </span>
  );
}

interface Filed {
  workspace: Workspace;
  spaces: { space: Space; via?: string; callNo?: number }[];
}

export function Drawer({
  view,
  onError,
  onNotice,
}: {
  view: 'panel' | 'dashboard';
  onError: (e: string) => void;
  onNotice: (n: Notice) => void;
}) {
  const spaces = useAtomValue(spacesAtom);
  const workspaces = useAtomValue(workspacesAtom);
  const windowId = useAtomValue(windowIdAtom);
  const currentId = useAtomValue(currentSpaceIdAtom);
  const openIn = useAtomValue(openSpacesAtom);
  const presence = useAtomValue(presenceAtom);
  const [pulling, setPulling] = useState<string | null>(null);
  const [inspected, setInspected] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const q = ''; // searching moved to the command bar; the drawer always lists every Space

  const current = spaces.find(s => s.id === currentId);
  // Panel: the pulled card is this window's Space. Dashboard: whichever card you opened.
  const shownId = view === 'dashboard' ? (inspected ?? currentId) : currentId;
  const shown = spaces.find(s => s.id === shownId);

  useEffect(() => setPulling(null), [currentId]);

  // Call numbers belong to the card, not its row: assigned across every filed card in
  // drawer order (guide, then name), before pulling or filtering, so they never shift.
  const { filed, callNumbers } = useMemo(() => {
    const known = new Set(workspaces.map(w => w.id));
    const orphans = spaces.filter(s => !known.has(s.workspaceId));
    const groups = workspaces.map(w => ({ workspace: w, all: spaces.filter(s => s.workspaceId === w.id).sort((a, b) => a.name.localeCompare(b.name)) }));
    if (orphans.length) groups.push({ workspace: { id: '_unfiled', name: 'Unfiled', kind: 'personal' }, all: orphans.sort((a, b) => a.name.localeCompare(b.name)) });
    const numbers = new Map<string, number>();
    let n = 0;
    for (const g of groups) for (const s of g.all) if (++n <= 9) numbers.set(s.id, n);
    const result: Filed[] = groups
      .map(({ workspace, all }) => ({
        workspace,
        spaces: all
          .filter(s => view === 'dashboard' || s.id !== shownId)
          .flatMap(space => {
            const m = matches(space, q);
            return m.hit ? [{ space, via: 'via' in m ? m.via : undefined, callNo: numbers.get(space.id) }] : [];
          }),
      }))
      .filter(f => f.spaces.length || (!q && f.workspace.kind === 'personal'));
    return { filed: result, callNumbers: numbers };
  }, [spaces, workspaces, shownId, q, view]);

  const flat = filed.flatMap(f => f.spaces);

  const pull = async (space: Space) => {
    if (windowId == null) return;
    setPulling(space.id);
    try {
      const result = await send<'switched' | 'focused' | 'unchanged'>({ type: 'switchSpace', windowId, spaceId: space.id });
      if (result === 'focused') {
        setPulling(null);
        onNotice({ text: `“${space.name}” is open in another window, so that window was brought to the front.` });
      }
    } catch (e) {
      setPulling(null);
      onError(errText(e));
    }
  };

  const activate = (space: Space) => {
    if (view === 'dashboard') setInspected(space.id);
    else void pull(space);
  };

  // The command bar opens a card on the dashboard.
  useEffect(() => {
    const onOpen = (e: Event) => setInspected((e as CustomEvent<string>).detail);
    window.addEventListener('spaces:open-card', onOpen);
    return () => window.removeEventListener('spaces:open-card', onOpen);
  }, []);

  // Keyboard: 1–9 pulls by call number; arrows walk the drawer; Enter in the filter takes the first card.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"]') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[1-9]$/.test(e.key)) {
        const hit = flat.find(x => x.callNo === Number(e.key));
        if (hit) {
          e.preventDefault();
          activate(hit.space);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const walk = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const tops = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('.card-top') ?? [])];
    const i = tops.indexOf(e.currentTarget);
    const next = tops[i + (e.key === 'ArrowDown' ? 1 : -1)];
    next?.focus();
  };

  const pulledCard =
    view === 'panel' ? (
      current ? (
        <PulledCard key={current.id} space={current} callNo={callNumbers.get(current.id)} view={view} isHere onError={onError} onNotice={onNotice} />
      ) : (
        <UnfiledCard onError={onError} />
      )
    ) : shown ? (
      <PulledCard key={shown.id} space={shown} callNo={callNumbers.get(shown.id)} view={view} isHere={shown.id === currentId} onPull={() => void pull(shown)} pulling={pulling === shown.id} onError={onError} onNotice={onNotice} />
    ) : (
      <UnfiledCard onError={onError} />
    );

  const drawer = (
    <section className="drawer" aria-label="Other Spaces">
      <div className="divider">
        <h2 className="drawer-title">{view === 'panel' ? 'Other Spaces' : 'Spaces'}</h2>
        <span className="divider-rule" />
        <button
          className="divider-action"
          title="Suspend background tabs now to free memory"
          onClick={() =>
            void send<number>({ type: 'suspendNow' })
              .then(n => onNotice({ text: n ? `Suspended ${plural(n, 'background tab')}.` : 'No background tabs to suspend.' }))
              .catch(e => onError(errText(e)))
          }
        >
          Suspend tabs
        </button>
      </div>
      {spaces.length === 0 ? (
        <p className="drawer-note">No Spaces yet. Name this window above and it becomes your first Space; each Space gets a number key.</p>
      ) : (
        <ul className="drawer-list" ref={listRef}>
          {filed.map(({ workspace, spaces: items }) => (
            <li key={workspace.id}>
              {/* A lone Personal workspace needs no guide card: there's nothing to tell it apart from. */}
              {(filed.length > 1 || workspace.kind !== 'personal') && (
                <div className="guide">
                  <span className="guide-name">{workspace.name}</span>
                  {workspace.role === 'viewer' && <span className="stamp">View only</span>}
                  <span className="guide-rule" />
                </div>
              )}
              {items.length === 0 ? (
                <p className="drawer-note">{view === 'panel' && current?.workspaceId === workspace.id ? 'No other Spaces here.' : 'No Spaces here yet.'}</p>
              ) : (
                <ul className="drawer-list">
                  {items.map(({ space, via, callNo }) => {
                    const elsewhere = (openIn.get(space.id) ?? []).some(w => w !== windowId);
                    const here = space.id === currentId;
                    const next = !!q && flat[0]?.space.id === space.id;
                    return (
                      <li key={space.id} className="card-top-wrap">
                        <button
                          className={`card-top${pulling === space.id ? ' pulling' : ''}${next ? ' next' : ''}`}
                          style={{ viewTransitionName: view === 'panel' ? vtName(space.id) : undefined }}
                          aria-current={view === 'dashboard' && space.id === shownId ? 'true' : undefined}
                          aria-label={`${view === 'panel' ? 'Switch to' : 'Open'} ${space.name}${callNo ? `, key ${callNo}` : ''}`}
                          onClick={() => activate(space)}
                          onKeyDown={walk}
                        >
                          <span className={`callno${callNo ? '' : ' callno-empty'}`}>{callNo ?? ''}</span>
                          <span style={{ minWidth: 0 }}>
                            <span className="top-name">
                              {space.color && <span className="swatch" style={{ background: groupInk(space.color) }} aria-hidden />}
                              <Highlight text={space.name} q={q} />
                            </span>
                            {via && (
                              <span className="top-sub">
                                <Highlight text={via} q={q} />
                              </span>
                            )}
                          </span>
                          <span className="top-count">{plural(space.tabs.length, 'tab')}</span>
                          <Stamps single here={view === 'dashboard' && here} elsewhere={elsewhere && !here} others={presence[space.id]} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="drawer-hint">
        <span className="key-entry">
          <kbd>⌘K</kbd> search
        </span>
        <span className="key-entry">
          <kbd>1</kbd>–<kbd>9</kbd> {view === 'panel' ? 'switch' : 'open'}
        </span>
        {view === 'panel' && (
          <span className="key-entry">
            <kbd>V</kbd> resources
          </span>
        )}
      </p>
    </section>
  );

  if (view === 'dashboard') {
    return (
      <div className="dash-grid">
        <div className="dash-side">{drawer}</div>
        <div className="dash-main">{pulledCard}</div>
        <Agenda />
      </div>
    );
  }
  return (
    <>
      {pulledCard}
      {drawer}
    </>
  );
}

/** The card pulled up out of the drawer: recto (tabs) and verso (resources). */
function PulledCard({
  space,
  callNo,
  view,
  isHere,
  onPull,
  pulling,
  onError,
  onNotice,
}: {
  space: Space;
  callNo?: number;
  view: 'panel' | 'dashboard';
  isHere: boolean;
  onPull?: () => void;
  pulling?: boolean;
  onError: (e: string) => void;
  onNotice: (n: Notice) => void;
}) {
  const workspaces = useAtomValue(workspacesAtom);
  const windowId = useAtomValue(windowIdAtom);
  const presence = useAtomValue(presenceAtom)[space.id];
  const openIn = useAtomValue(openSpacesAtom).get(space.id) ?? [];
  const workspace = workspaces.find(w => w.id === space.workspaceId);
  const editable = canEdit(workspace);
  const [side, setSide] = useState<'recto' | 'verso'>('recto');
  const [flipPhase, setFlipPhase] = useState<'idle' | 'out' | 'in'>('idle');
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(space.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState(false);

  // The command bar's "Edit this Space" and "Resources" act on this window's card.
  useEffect(() => {
    if (!isHere) return;
    const onEdit = () => {
      setSide('recto');
      setEditing(true);
    };
    const onFlip = () => turn();
    window.addEventListener('spaces:edit', onEdit);
    window.addEventListener('spaces:flip', onFlip);
    return () => {
      window.removeEventListener('spaces:edit', onEdit);
      window.removeEventListener('spaces:flip', onFlip);
    };
  });

  /** Card edits go through the worker, which applies them to the window if the Space is open. */
  const applyEdit = async (edit: SpaceEdit, undoText?: string) => {
    const before = space;
    try {
      await send({ type: 'editSpace', edit });
      // A shelved Space can be put back exactly; an open one's closed tab is in History.
      if (undoText && !isHere && openIn.length === 0) {
        onNotice({
          text: undoText,
          action: {
            label: 'Undo',
            run: async () => {
              const store = await getStorage();
              const latest = await store.getSpace(before.id);
              if (!latest) return;
              const { rev, updatedAt: _u, ...input } = latest;
              await store.putSpace({ ...input, tabs: before.tabs, groups: before.groups, activeIndex: before.activeIndex }, rev);
            },
          },
        });
      }
    } catch (e) {
      onError(errText(e));
    }
  };

  const cardRef = useRef<HTMLElement>(null);
  // The card keeps its height through the turn, so the list below doesn't jump mid-rotation.
  const [heldHeight, setHeldHeight] = useState<number | null>(null);
  const turn = () => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return setSide(s => (s === 'recto' ? 'verso' : 'recto'));
    setHeldHeight(cardRef.current?.offsetHeight ?? null);
    setFlipPhase('out');
  };

  useEffect(() => {
    if (view !== 'panel') return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        turn();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const rename = async () => {
    const trimmed = name.trim();
    setRenaming(false);
    if (!trimmed || trimmed === space.name) return setName(space.name);
    try {
      const store = await getStorage();
      for (let attempt = 0; attempt < 3; attempt++) {
        const latest = (await store.getSpace(space.id)) ?? space;
        const { rev: _rev, updatedAt: _u, ...input } = latest;
        if ((await store.putSpace({ ...input, name: trimmed }, latest.rev)).ok) {
          void send({ type: 'refreshSpaceGroups' }).catch(() => {}); // retitle the Space's tab group
          return;
        }
      }
      throw new Error('Could not rename: the Space kept changing. Try again.');
    } catch (e) {
      setName(space.name);
      onError(errText(e));
    }
  };

  const remove = async () => {
    try {
      const store = await getStorage();
      const resources = await store.getResources(space.id);
      if (isHere && windowId != null) await send({ type: 'detachWindow', windowId });
      await store.deleteSpace(space.id);
      void send({ type: 'refreshSpaceGroups' }).catch(() => {}); // ungroup it in any other window
      const { rev: _rev, updatedAt: _u, ...input } = space;
      onNotice({
        text: `Deleted “${space.name}”.`,
        action: {
          label: 'Undo',
          run: async () => {
            await store.putSpace(input);
            if (resources) await store.putResources({ spaceId: resources.spaceId, workspaceId: resources.workspaceId, sections: resources.sections });
          },
        },
      });
    } catch (e) {
      onError(errText(e));
    }
  };

  const detach = async () => {
    if (windowId == null) return;
    try {
      await send({ type: 'detachWindow', windowId });
    } catch (e) {
      onError(errText(e));
    }
  };

  const groupsByKey = new Map(space.groups.map(g => [g.key, g]));
  const entries: ReactNode[] = [];
  let lastGroup: string | undefined;
  const visibleTabs = showAll || editing ? space.tabs : space.tabs.slice(0, ENTRY_LIMIT);
  visibleTabs.forEach((t, i) => {
    if (t.groupKey && t.groupKey !== lastGroup) {
      const g = groupsByKey.get(t.groupKey);
      if (g) {
        entries.push(
          <li key={`g-${t.groupKey}-${i}`} className="entry entry-group">
            <span className="swatch" style={{ background: groupInk(g.color) }} aria-hidden />
            <span>{g.title || 'Untitled group'}</span>
          </li>,
        );
      }
    }
    lastGroup = t.groupKey;
    const label = t.title || t.url;
    entries.push(
      <li key={i} className={`entry${t.groupKey ? ' entry-grouped' : ''}${i === space.activeIndex ? ' entry-active' : ''}${editing ? ' entry-editing' : ''}`} title={t.url}>
        <Favicon url={t.favIconUrl} />
        <span className="entry-title">{label}</span>
        {editing && (
          <span className="entry-tools">
            <button className="icon-button small" aria-label={`Move ${label} up`} disabled={i === 0} onClick={() => void applyEdit({ spaceId: space.id, op: 'moveTab', index: i, to: i - 1 })}>
              <UpIcon />
            </button>
            <button className="icon-button small" aria-label={`Move ${label} down`} disabled={i === space.tabs.length - 1} onClick={() => void applyEdit({ spaceId: space.id, op: 'moveTab', index: i, to: i + 1 })}>
              <DownIcon />
            </button>
            <button className="icon-button small" aria-label={`Remove ${label}`} onClick={() => void applyEdit({ spaceId: space.id, op: 'removeTab', index: i }, `Removed “${label}”.`)}>
              <CloseIcon />
            </button>
          </span>
        )}
      </li>,
    );
  });

  const meta = [
    plural(space.tabs.length, 'tab'),
    space.groups.length ? plural(space.groups.length, 'group') : null,
    workspace && workspace.kind === 'team' ? `in ${workspace.name}` : null,
    `updated ${ago(space.updatedAt)}`,
  ]
    .filter(Boolean)
    .join(' · ');

  const recto = (
    <>
      {editing && (
        <div className="color-row" role="radiogroup" aria-label={`Color for ${space.name}`}>
          <span className="field-label">Color</span>
          <button
            className={`color-chip none${!space.color ? ' chosen' : ''}`}
            role="radio"
            aria-checked={!space.color}
            aria-label="No color"
            onClick={() => void applyEdit({ spaceId: space.id, op: 'setColor', color: undefined })}
          />
          {SPACE_COLORS.map(c => (
            <button
              key={c}
              className={`color-chip${space.color === c ? ' chosen' : ''}`}
              style={{ background: groupInk(c) }}
              role="radio"
              aria-checked={space.color === c}
              aria-label={c}
              onClick={() => void applyEdit({ spaceId: space.id, op: 'setColor', color: c })}
            />
          ))}
        </div>
      )}
      <ol className={`entries${editing ? ' editing' : ''}`} aria-label={`Tabs in ${space.name}`}>
        {entries}
      </ol>
      {isHere && <LooseTabs spaceName={space.name} onError={onError} />}
      {space.tabs.length === 0 && <p className="blank-lede">No tabs in this Space yet. Pages you open in this window can be added to it.</p>}
      {space.tabs.length > ENTRY_LIMIT && !editing && (
        <div className="entries-more">
          <button className="text-button" onClick={() => setShowAll(v => !v)}>
            {showAll ? 'Show fewer' : `${space.tabs.length - ENTRY_LIMIT} more entries`}
          </button>
        </div>
      )}
    </>
  );

  const head = (
    <header className="card-head">
      {callNo !== undefined && (
        <span className="callno" aria-label={`Key ${callNo}`}>
          {callNo}
        </span>
      )}
      {renaming ? (
        <input
          className="card-name-input"
          aria-label="Space name"
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onBlur={() => void rename()}
          onKeyDown={e => {
            if (e.key === 'Enter') void rename();
            if (e.key === 'Escape') {
              setName(space.name);
              setRenaming(false);
            }
          }}
        />
      ) : (
        <h2 className="card-name">
          {space.color && <span className="swatch swatch-lg" style={{ background: groupInk(space.color) }} aria-hidden />}
          {space.name}
        </h2>
      )}
      <Stamps here={isHere} elsewhere={!isHere && openIn.length > 0} others={presence} />
    </header>
  );

  // Rename and Delete live in Edit mode, so the everyday footer stays one short line.
  const actions = editing ? (
    <footer className="card-actions">
      {!renaming && (
        <button className="text-button" onClick={() => setRenaming(true)}>
          Rename
        </button>
      )}
      {confirmDelete ? (
        <>
          <button className="text-button danger" onClick={() => void remove()} aria-label={`Confirm delete ${space.name}`}>
            Delete Space
          </button>
          <button className="text-button" onClick={() => setConfirmDelete(false)}>
            Keep
          </button>
        </>
      ) : (
        <button className="text-button" onClick={() => setConfirmDelete(true)} aria-label={`Delete ${space.name}`}>
          Delete
        </button>
      )}
      <button className="plate-button outline" onClick={() => { setEditing(false); setConfirmDelete(false); }}>
        Done
      </button>
    </footer>
  ) : (
    <footer className="card-actions">
      {view === 'panel' && (
        <button className="text-button" onClick={turn} aria-label={side === 'recto' ? 'Turn over to resources' : 'Turn back to tabs'}>
          <FlipIcon />
          {side === 'recto' ? 'Resources' : 'Tabs'}
        </button>
      )}
      {!isHere && onPull && (
        <button className="plate-button pull" onClick={onPull} disabled={pulling}>
          {pulling ? 'Switching…' : 'Switch this window'}
        </button>
      )}
      {editable && (
        <button
          className="text-button"
          onClick={() => {
            setSide('recto'); // editing happens on the tabs side
            setEditing(true);
          }}
        >
          Edit
        </button>
      )}
      {isHere && (
        <button className="text-button" onClick={() => void detach()}>
          Detach
        </button>
      )}
    </footer>
  );

  if (view === 'dashboard') {
    return (
      <div className="dash-card">
        <article className="card pulled" aria-label={`${space.name}: tabs`}>
          {head}
          <p className="card-meta">{meta}</p>
          {recto}
          {actions}
        </article>
        <article className="card pulled verso-card" aria-label={`${space.name}: resources`}>
          <Verso key={space.id} spaceId={space.id} workspaceId={space.workspaceId} spaceName={space.name} readOnly={!editable} onError={onError} />
        </article>
      </div>
    );
  }

  return (
    <article
      ref={cardRef}
      className={`card pulled${flipPhase === 'out' ? ' flip-out' : flipPhase === 'in' ? ' flip-in' : ''}`}
      style={{ viewTransitionName: vtName(space.id), minHeight: heldHeight ?? undefined }}
      aria-label={`${space.name}, this window's Space`}
      onAnimationEnd={() => {
        if (flipPhase === 'out') {
          setSide(s => (s === 'recto' ? 'verso' : 'recto'));
          setFlipPhase('in');
        } else if (flipPhase === 'in') {
          setFlipPhase('idle');
          setHeldHeight(null);
        }
      }}
    >
      {side === 'recto' ? (
        <>
          {head}
          <p className="card-meta">{meta}</p>
          {recto}
        </>
      ) : (
        <Verso key={space.id} spaceId={space.id} workspaceId={space.workspaceId} spaceName={space.name} readOnly={!editable} onError={onError} />
      )}
      {actions}
    </article>
  );
}

/**
 * Tabs open in this window that aren't in its Space. They're left out of saves and
 * close on the next switch (History keeps them), so they stay listed until added.
 */
function LooseTabs({ spaceName, onError }: { spaceName: string; onError: (e: string) => void }) {
  const windowId = useAtomValue(windowIdAtom);
  const ids = useAtomValue(windowStatesAtom)[String(windowId)]?.looseTabIds ?? [];
  const [tabs, setTabs] = useState<chrome.tabs.Tab[]>([]);
  const key = ids.join(',');

  useEffect(() => {
    const own = chrome.runtime.getURL('');
    // Spaces' own pages can't be saved into a Space, so they're never offered.
    const load = () =>
      void Promise.all(ids.map(id => chrome.tabs.get(id).catch(() => undefined))).then(t =>
        setTabs(t.filter((x): x is chrome.tabs.Tab => !!x && !(x.url || x.pendingUrl || '').startsWith(own))),
      );
    load();
    const onUpdated = (id: number) => ids.includes(id) && load();
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => chrome.tabs.onUpdated.removeListener(onUpdated);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!tabs.length || windowId == null) return null;
  const add = (tabIds?: number[]) => void send({ type: 'addLooseTabs', windowId, tabIds }).catch(e => onError(errText(e)));
  return (
    <section className="loose" aria-label={`Tabs not in ${spaceName}`}>
      <div className="entry entry-group">
        <span>Not in this Space</span>
        {tabs.length > 1 && (
          <button className="text-button" onClick={() => add()}>
            Add all
          </button>
        )}
      </div>
      <ol className="entries">
        {tabs.map(t => (
          <li key={t.id} className="entry entry-loose" title={t.url}>
            <Favicon url={t.favIconUrl} />
            <span className="entry-title">{t.title || t.pendingUrl || t.url || 'New tab'}</span>
            <button className="text-button" aria-label={`Add ${t.title || 'tab'} to ${spaceName}`} onClick={() => add([t.id!])}>
              Add
            </button>
          </li>
        ))}
      </ol>
      <p className="loose-note">Tabs you don’t add close when you switch Spaces. History keeps a copy.</p>
    </section>
  );
}

/** This window isn't in any Space yet: a blank card to type a name onto. */
function UnfiledCard({ onError }: { onError: (e: string) => void }) {
  const windowId = useAtomValue(windowIdAtom);
  const workspaces = useAtomValue(workspacesAtom);
  const editable = workspaces.filter(w => canEdit(w));
  const [name, setName] = useState('');
  const [workspaceId, setWorkspaceId] = useState(PERSONAL_WORKSPACE_ID);
  const [busy, setBusy] = useState(false);
  const [tabCount, setTabCount] = useState<number | null>(null);

  useEffect(() => {
    if (windowId == null) return;
    void chrome.tabs.query({ windowId }).then(t => setTabCount(t.filter(x => !x.pinned).length));
  }, [windowId]);

  const file = async () => {
    const trimmed = name.trim();
    if (!trimmed || windowId == null) return;
    setBusy(true);
    try {
      await send({ type: 'createSpaceFromWindow', windowId, name: trimmed, workspaceId });
      setName('');
    } catch (e) {
      onError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="card pulled blank-card" aria-label="This window isn't in a Space">
      <header className="card-head">
        <h2 className="card-name">New Space</h2>
      </header>
      <p className="blank-lede">
        {tabCount === null ? 'This window isn’t in any Space.' : `${plural(tabCount, 'tab')} open here, not in any Space.`} Name it to make it a Space; its tabs are
        kept from then on.
      </p>
      <form
        className="typed-field"
        onSubmit={e => {
          e.preventDefault();
          void file();
        }}
      >
        <label>
          Name
          <input className="typed-input" placeholder="e.g. Quarterly review" value={name} onChange={e => setName(e.target.value)} aria-label="New Space name" />
        </label>
        {editable.length > 1 && (
          <label style={{ flex: '0 1 140px' }}>
            Workspace
            <select className="typed-input" value={workspaceId} onChange={e => setWorkspaceId(e.target.value)}>
              {editable.map(w => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="submit" className="plate-button" disabled={busy || !name.trim()}>
          {busy ? 'Creating…' : 'Create Space'}
        </button>
      </form>
    </article>
  );
}
