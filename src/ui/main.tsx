import { createRoot } from 'react-dom/client';
import { Provider } from 'jotai';
import { App } from './App';
import './app.css';

const view = document.body.dataset.view === 'dashboard' ? 'dashboard' : 'panel';
createRoot(document.getElementById('root')!).render(
  <Provider>
    <App view={view} />
  </Provider>,
);
