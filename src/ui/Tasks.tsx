import { useCallback, useEffect, useRef, useState } from 'react';
import { PlusIcon, RefreshIcon } from './Icons';
import { useAtomValue } from 'jotai';
import { currentSpaceIdAtom, spacesAtom } from './atoms';
import {
  addTask,
  ensureSpaceProject,
  getVikunjaConfig,
  inboxProjectId,
  getTasksBySpace,
  knownSpaceProject,
  listAllOpenTasks,
  listOpenTasks,
  TASKS_BY_SPACE_KEY,
  setTaskDone,
  type VikunjaConfig,
  type VikunjaTask,
} from '../shared/vikunja';

/** Often enough that a task checked off in Vikunja or BusyCal shows here within seconds of looking back. */
const REFRESH_MS = 15_000;
/** The check-off sequence: the tick draws, the strike sweeps the title, then the row folds. */
const STRUCK_MS = 440;
const FOLD_MS = 260;

/**
 * The Space's tasks, straight from Vikunja (and so from BusyCal, through CalDAV).
 * A window without a Space shows the Vikunja Inbox. A Space gets its own project
 * the first time a task is added to it.
 */
export function Tasks({ onSetUp, onError }: { onSetUp: () => void; onError: (e: string) => void }) {
  const currentId = useAtomValue(currentSpaceIdAtom);
  const space = useAtomValue(spacesAtom).find(s => s.id === currentId);
  const [config, setConfig] = useState<VikunjaConfig | null | undefined>(undefined);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [tasks, setTasks] = useState<VikunjaTask[] | null>(null);
  const [checking, setChecking] = useState<Set<number>>(new Set());
  const [leaving, setLeaving] = useState<Set<number>>(new Set());
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [bySpace, setBySpace] = useState(false);
  /** Arrived from Vikunja or BusyCal while the panel was open: rises in with a brief glow. */
  const [arrived, setArrived] = useState<Set<number>>(new Set());
  /** The list's first appearance: rows settle in one after another. */
  const [entering, setEntering] = useState(false);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const listKey = useRef<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const inFlight = useRef(false);
  const checkingRef = useRef(checking);
  checkingRef.current = checking;

  const load = useCallback(async () => {
    if (inFlight.current) return; // a slow server never stacks overlapping refreshes
    inFlight.current = true;
    const c = await getVikunjaConfig();
    setConfig(c);
    if (!c) {
      inFlight.current = false;
      return;
    }
    setRefreshing(true);
    try {
      const separate = await getTasksBySpace();
      setBySpace(separate);
      let id: number | undefined;
      let open: VikunjaTask[];
      if (separate && space) {
        // Looking never creates a project; a known one is kept named after its Space.
        id = (await knownSpaceProject(space.id)) !== undefined ? await ensureSpaceProject(space) : undefined;
        open = id ? await listOpenTasks(id) : [];
      } else {
        // One list everywhere, so switching Spaces never hides a task.
        const all = await listAllOpenTasks();
        id = all.inbox;
        open = all.tasks;
      }
      setProjectId(id ?? null);
      const key = separate && space ? `space:${space.id}` : 'all';
      const prev = tasksRef.current;
      if (!prev || listKey.current !== key) {
        // A different list (first load, or another Space's): shown as a list arriving, not as changes.
        listKey.current = key;
        setArrived(new Set());
        setEntering(true);
        setTimeout(() => setEntering(false), 600);
        setTasks(open);
      } else {
        // The same list refreshed: say what changed elsewhere instead of snapping.
        const openIds = new Set(open.map(t => t.id));
        const gone = prev.filter(t => !openIds.has(t.id) && !checkingRef.current.has(t.id)).map(t => t.id);
        const fresh = open.filter(t => !prev.some(p => p.id === t.id)).map(t => t.id);
        if (fresh.length) setArrived(s => new Set([...s, ...fresh]));
        if (gone.length) {
          setLeaving(s => new Set([...s, ...gone]));
          setTimeout(() => setTasks(list => list?.filter(x => !gone.includes(x.id)) ?? null), FOLD_MS);
        }
        // Rows mid-check or folding stay in place until their animation ends.
        const kept = prev.filter(t => !openIds.has(t.id) && (checkingRef.current.has(t.id) || gone.includes(t.id)));
        setTasks([...open, ...kept].sort((a, b) => a.id - b.id));
      }
      setProblem(null);
      setUpdatedAt(Date.now());
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  }, [space?.id, space?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void load();
    // Every 15s while the panel is visible; paused when it's hidden.
    const timer = setInterval(() => document.visibilityState === 'visible' && void load(), REFRESH_MS);
    const onVisible = () => document.visibilityState === 'visible' && void load();
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && ('vikunja' in changes || TASKS_BY_SPACE_KEY in changes)) void load();
    };
    // Coming back from another tab or window (say, Vikunja or BusyCal) refreshes right away.
    let soon: ReturnType<typeof setTimeout> | undefined;
    const onReturn = () => {
      clearTimeout(soon);
      soon = setTimeout(() => void load(), 400);
    };
    document.addEventListener('visibilitychange', onVisible);
    chrome.storage.onChanged.addListener(onChanged);
    chrome.tabs.onActivated.addListener(onReturn);
    chrome.windows.onFocusChanged.addListener(onReturn);
    return () => {
      clearInterval(timer);
      clearTimeout(soon);
      document.removeEventListener('visibilitychange', onVisible);
      chrome.storage.onChanged.removeListener(onChanged);
      chrome.tabs.onActivated.removeListener(onReturn);
      chrome.windows.onFocusChanged.removeListener(onReturn);
    };
  }, [load]);

  const check = async (t: VikunjaTask) => {
    setChecking(s => new Set(s).add(t.id));
    try {
      await setTaskDone(t.id, true);
      // Struck through first, then the row folds away.
      setTimeout(() => setLeaving(s => new Set(s).add(t.id)), STRUCK_MS);
      setTimeout(() => setTasks(list => list?.filter(x => x.id !== t.id) ?? null), STRUCK_MS + FOLD_MS);
    } catch (e) {
      setChecking(s => {
        const n = new Set(s);
        n.delete(t.id);
        return n;
      });
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  const add = async () => {
    const title = draft.trim();
    if (!title) return;
    setDraft('');
    try {
      const id = projectId ?? (bySpace && space ? await ensureSpaceProject(space) : await inboxProjectId());
      setProjectId(id);
      const t = await addTask(id, title);
      setFresh(s => new Set(s).add(t.id));
      setTasks(list => [...(list ?? []), t]);
    } catch (e) {
      setDraft(title);
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  if (config === undefined) return null;
  const where = bySpace && space ? space.name : 'Inbox';

  return (
    <section className="tasks" aria-label={`Tasks for ${where}`}>
      <div className="divider">
        <h2 className="drawer-title">Tasks</h2>
        <span className="divider-rule" />
        {config && (
          <button
            type="button"
            className={`icon-button small refresh${refreshing ? ' is-spinning' : ''}`}
            aria-label="Refresh tasks"
            title={updatedAt ? `Updated ${new Date(updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}` : 'Refresh tasks'}
            onClick={() => void load()}
          >
            <RefreshIcon />
          </button>
        )}
        {config && projectId && (
          <a className="divider-action" href={`${config.url}/projects/${projectId}`} target="_blank" rel="noreferrer">
            Open in Vikunja
          </a>
        )}
      </div>

      {!config ? (
        <div className="tasks-empty">
          <p className="drawer-note">Connect Vikunja to keep each Space’s tasks here. They also show up in BusyCal through Vikunja’s calendar sync.</p>
          <button type="button" className="text-button pull" onClick={onSetUp}>
            Connect Vikunja
          </button>
        </div>
      ) : (
        <>
          {problem && <p className="drawer-note">{problem}</p>}
          {tasks && tasks.length > 0 && (
            <ul className={`entries task-list${entering ? ' is-entering' : ''}`}>
              {tasks.map((t, i) => (
                <li
                  key={t.id}
                  style={entering ? ({ '--i': Math.min(i, 6) } as React.CSSProperties) : undefined}
                  className={`entry task-row${checking.has(t.id) ? ' is-done' : ''}${leaving.has(t.id) ? ' is-leaving' : ''}${fresh.has(t.id) ? ' is-new' : ''}${arrived.has(t.id) ? ' is-arrived' : ''}`}
                >
                  <span className="task-check">
                    <input type="checkbox" checked={checking.has(t.id)} disabled={checking.has(t.id)} onChange={() => void check(t)} aria-label={`Done: ${t.title}`} />
                    <svg viewBox="0 0 16 16" aria-hidden>
                      <path d="M4.6 8.4l2.3 2.3 4.6-4.9" pathLength={1} />
                    </svg>
                  </span>
                  <span className="entry-title">
                    <span className="task-text">{t.title}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {tasks && tasks.length === 0 && !problem && <p className="drawer-note">No open tasks {bySpace && space ? 'for this Space' : 'in your Inbox'}.</p>}
          <form
            className="task-add"
            onSubmit={e => {
              e.preventDefault();
              void add();
            }}
          >
            <span className="task-add-plus" aria-hidden>
              <PlusIcon />
            </span>
            <input className="task-add-input" value={draft} onChange={e => setDraft(e.target.value)} placeholder={`Add a task to ${where}`} aria-label={`Add a task to ${where}`} />
          </form>
        </>
      )}
    </section>
  );
}
