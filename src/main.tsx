import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/barlow-semi-condensed/500.css';
import '@fontsource/barlow-semi-condensed/600.css';
import '@fontsource/barlow-semi-condensed/700.css';
import '@fontsource/rajdhani/500.css';
import '@fontsource/rajdhani/600.css';
import '@fontsource/rajdhani/700.css';
import './styles/base.css';
import './styles/chassis.css';
import './styles/controls.css';
import './styles/keyboard.css';
import './styles/lcd.css';
import './styles/help.css';
import './styles/academy.css';
import { App } from './App';
import { createServices, services } from './services';
import * as actions from './state/actions';
import * as params from './state/params';

const root = createRoot(document.getElementById('root')!);

try {
  createServices();
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) {
    // Handle for the automated tests and for poking around in the console.
    (window as unknown as { __pva: unknown }).__pva = { ...services(), act: actions, params };
  }
} catch (err) {
  // No Web Audio at all: say so plainly instead of showing a dead instrument.
  const message = err instanceof Error ? err.message : String(err);
  root.render(
    <div className="fatal">
      <h1>This browser cannot run the instrument</h1>
      <p>{message}</p>
      <p>Use a current version of Chrome, Edge, Firefox or Safari.</p>
    </div>,
  );
}
