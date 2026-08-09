import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Hand off from the HTML boot splash (see index.html) to the app. Waits for
// the frame after React's first paint before fading, so the splash never
// disappears onto a half-drawn page -- and the app's own auth-check loader
// (FullPageLoader in App.jsx) picks up from here, so there's no bare gap
// between "splash gone" and "workspace ready".
const splash = document.getElementById('app-splash');
if (splash) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      splash.classList.add('is-hidden');
      setTimeout(() => splash.remove(), 400);
    });
  });
}
