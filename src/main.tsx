import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { CloudApp } from './app/CloudApp';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/app.css';
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <CloudApp />
      </HashRouter>
    </ErrorBoundary>
  </StrictMode>,
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener(
    'load',
    () => {
      void navigator.serviceWorker
        .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
        .then((registration) => {
          const notifyUpdate = () => window.dispatchEvent(new Event('promptdesk:pwa-update'));
          if (registration.waiting) notifyUpdate();
          registration.addEventListener('updatefound', () => {
            registration.installing?.addEventListener('statechange', () => {
              if (registration.waiting && navigator.serviceWorker.controller) notifyUpdate();
            });
          });
        })
        .catch(() => undefined);
    },
    { once: true },
  );
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (window.sessionStorage.getItem('promptdesk:pwa-update-reload') === 'yes') {
      window.sessionStorage.removeItem('promptdesk:pwa-update-reload');
      window.location.reload();
    }
  });
}
