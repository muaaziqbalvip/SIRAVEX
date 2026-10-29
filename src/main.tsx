import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from '@/app/App';
import { AppProvider } from '@/app/store';
import { registerSW } from 'virtual:pwa-register';
import '@/styles/globals.css';

const updateSW = registerSW({
  immediate: false,
  onNeedRefresh() {
    window.dispatchEvent(new Event('siravex-sw-update'));
    window.addEventListener('siravex-sw-update-accepted', () => { void updateSW(true); }, { once: true });
  },
  onRegisterError(error) { console.warn('SIRAVEX: service worker registration failed (non-fatal in dev).'); void error; },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <AppProvider>
        <App />
      </AppProvider>
    </HashRouter>
  </StrictMode>,
);
