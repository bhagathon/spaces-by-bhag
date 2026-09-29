import { createRoot } from 'react-dom/client';
import { Provider } from 'jotai';
import { App, CommandWindow } from './App';
import './app.css';
import { initTextScale } from './textScale';
import { initMotion } from './motion';

initMotion();
const dataView = document.body.dataset.view;
const view = dataView === 'dashboard' ? 'dashboard' : 'panel';
if (view === 'panel') {
  initTextScale();
  // Tell the worker this window's panel is open (for Control+S). Reconnect if the worker restarts.
  void chrome.windows.getCurrent().then(w => {
    const connect = () => chrome.runtime.connect({ name: `panel:${w.id}` }).onDisconnect.addListener(() => setTimeout(connect, 500));
    connect();
  });
}
createRoot(document.getElementById('root')!).render(
  <Provider>
    {dataView === 'command' ? <CommandWindow /> : <App view={view} />}
  </Provider>,
);
