/* eslint-disable react-refresh/only-export-components */
import { useEffect, useState } from 'react';
import './SystemConfirm.css';

let requestHandler = null;
let activeRequest = false;
const pendingRequests = [];

function showNextRequest() {
  if (!requestHandler || activeRequest || pendingRequests.length === 0) return;
  activeRequest = true;
  requestHandler(pendingRequests.shift());
}

export function systemConfirm(message, options = {}) {
  return new Promise(resolve => {
    pendingRequests.push({ message: String(message || ''), options, resolve });
    showNextRequest();
  });
}

function registerRequestHandler(handler) {
  requestHandler = handler;
  showNextRequest();
  return () => {
    if (requestHandler === handler) requestHandler = null;
  };
}

function settleRequest(request, accepted) {
  request.resolve(Boolean(accepted));
  activeRequest = false;
  queueMicrotask(showNextRequest);
}

function dialogTitle(message, options) {
  if (options.title) return options.title;
  if (/supprim/i.test(message)) return 'Confirmer suppression';
  if (/verrouill/i.test(message)) return 'Confirmer verrouillage';
  if (/session/i.test(message)) return 'Confirmer déconnexion';
  return 'Confirmation requise';
}

export function SystemConfirmHost() {
  const [request, setRequest] = useState(null);

  useEffect(() => registerRequestHandler(setRequest), []);

  useEffect(() => {
    if (!request) return undefined;
    const onKeyDown = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setRequest(null);
      settleRequest(request, false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [request]);

  if (!request) return null;
  const { message, options } = request;
  const danger = options.danger !== false && /supprim|irréversible|définit|verrouill|retour/i.test(message);

  const answer = accepted => {
    setRequest(null);
    settleRequest(request, accepted);
  };

  return (
    <div className="system-confirm-overlay">
      <section className={`system-confirm-dialog${danger ? ' danger' : ''}`} role="alertdialog" aria-modal="true" aria-labelledby="system-confirm-title" aria-describedby="system-confirm-message">
        <div className="system-confirm-mark" aria-hidden="true">!</div>
        <div className="system-confirm-copy">
          <h2 id="system-confirm-title">{dialogTitle(message, options)}</h2>
          <p id="system-confirm-message">{message}</p>
        </div>
        <div className="system-confirm-actions">
          <button type="button" className="system-confirm-cancel" onClick={() => answer(false)}>{options.cancelLabel || 'Annuler'}</button>
          <button type="button" className="system-confirm-accept" onClick={() => answer(true)} autoFocus>{options.confirmLabel || 'Confirmer'}</button>
        </div>
      </section>
    </div>
  );
}
