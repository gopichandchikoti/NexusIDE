import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AppErrorBoundary } from './components/ui/AppErrorBoundary';
import { registerServiceWorker } from './pwa/register';
import { scheduleSandboxWarmUp } from './pwa/warm';
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/panels.css';
import './styles/overlays.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>
);

registerServiceWorker();
scheduleSandboxWarmUp();
