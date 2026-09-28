import { createRoot } from 'react-dom/client';
import { Provider } from 'jotai';
import { App } from './App';
import './app.css';
import { initTextScale } from './textScale';

const view = document.body.dataset.view === 'dashboard' ? 'dashboard' : 'panel';
if (view === 'panel') initTextScale();
createRoot(document.getElementById('root')!).render(
  <Provider>
    <App view={view} />
  </Provider>,
);
