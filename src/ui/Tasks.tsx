import { useCallback, useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import { currentSpaceIdAtom, spacesAtom } from './atoms';
import {
  addTask,
  ensureSpaceProject,
  getVikunjaConfig,
  inboxProjectId,
  knownSpaceProject,
  listOpenTasks,
  setTaskDone,
  type VikunjaConfig,
  type VikunjaTask,
} from '../shared/vikunja';

const REFRESH_MS = 60_000;

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

  const load = useCallback(async () => {
    const c = await getVikunjaConfig();
    setConfig(c);
    if (!c) return;
    try {
      // Looking never creates a project; a known one is kept named after its Space.
      let id: number | undefined;
      if (space) id = (await knownSpaceProject(space.id)) !== undefined ? await ensureSpaceProject(space) : undefined;
      else id = await inboxProjectId();
      setProjectId(id ?? null);
      setTasks(id ? await listOpenTasks(id) : []);
      setProblem(null);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  }, [space?.id, space?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    const onVisible = () => document.visibilityState === 'visible' && void load();
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && 'vikunja' in changes) void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, [load]);

  const check = async (t: VikunjaTask) => {
    setChecking(s => new Set(s).add(t.id));
    try {
      await setTaskDone(t.id, true);
      // Struck through first, then the row folds away.
      setTimeout(() => setLeaving(s => new Set(s).add(t.id)), 380);
      setTimeout(() => setTasks(list => list?.filter(x => x.id !== t.id) ?? null), 380 + 260);
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
      const id = projectId ?? (space ? await ensureSpaceProject(space) : await inboxProjectId());
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
  const where = space ? space.name : 'Inbox';

  return (
    <section className="tasks" aria-label={`Tasks for ${where}`}>
      <div className="divider">
        <h2 className="drawer-title">Tasks</h2>
        <span className="divider-rule" />
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
            <ul className="entries task-list">
              {tasks.map(t => (
                <li
                  key={t.id}
                  className={`entry task-row${checking.has(t.id) ? ' is-done' : ''}${leaving.has(t.id) ? ' is-leaving' : ''}${fresh.has(t.id) ? ' is-new' : ''}`}
                >
                  <input type="checkbox" checked={checking.has(t.id)} onChange={() => void check(t)} aria-label={`Done: ${t.title}`} />
                  <span className="entry-title">{t.title}</span>
                </li>
              ))}
            </ul>
          )}
          {tasks && tasks.length === 0 && !problem && <p className="drawer-note">No open tasks {space ? 'for this Space' : 'in your Inbox'}.</p>}
          <form
            className="task-add"
            onSubmit={e => {
              e.preventDefault();
              void add();
            }}
          >
            <span className="task-add-plus" aria-hidden>
              +
            </span>
            <input className="task-add-input" value={draft} onChange={e => setDraft(e.target.value)} placeholder={`Add a task to ${where}`} aria-label={`Add a task to ${where}`} />
          </form>
        </>
      )}
    </section>
  );
}
