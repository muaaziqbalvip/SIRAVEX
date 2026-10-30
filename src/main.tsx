import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from '@/app/App';
import { AppProvider } from '@/app/store';
import { AuthProvider } from '@/services/firebase/AuthContext';
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
    <BrowserRouter>
      <AuthProvider>
        <AppProvider>
          <App />
        </AppProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
