import { useEffect, useState } from 'react';
import { getTabModelConfig } from '../shared/localModel';
import { send } from './api';

/** Whether tab sorting is set up, so Sort only shows when it can work. */
export function useCanSort() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const read = () => void getTabModelConfig().then(c => setOk(c.enabled));
    read();
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => area === 'local' && 'tabModel' in changes && read();
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);
  return ok;
}

/** Sorts the window's tabs by topic and says what happened, in a sentence. */
export async function sortTabs(windowId: number): Promise<string> {
  const { moved, topics } = await send<{ moved: boolean; topics: string[] }>({ type: 'sortTabs', windowId });
  if (!topics.length) return 'Sorting needs at least 3 tabs outside pinned tabs and your own groups.';
  if (!moved) return 'Your tabs are already in order.';
  const names = topics.slice(0, 4).join(', ') + (topics.length > 4 ? ', …' : '');
  return `Sorted into ${topics.length} topic${topics.length === 1 ? '' : 's'}: ${names}.`;
}
