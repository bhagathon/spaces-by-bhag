import { createRoot } from 'react-dom/client';
import { Provider } from 'jotai';
import { App } from './App';
import './app.css';
import { initTextScale } from './textScale';

const view = document.body.dataset.view === 'dashboard' ? 'dashboard' : 'panel';
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
    <App view={view} />
  </Provider>,
);
