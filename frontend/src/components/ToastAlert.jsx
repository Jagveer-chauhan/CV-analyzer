import React, { useEffect } from 'react';

/**
 * ToastAlert
 *
 * A modern, floating notification toast that replaces default browser alert() popups.
 * Displays success, error, or info messages with automatic timeout and manual dismiss.
 *
 * @param {{ message: string, type?: 'success' | 'error' | 'info', title?: string } | null} toast
 * @param {Function} onClose - Callback invoked when closing or auto-dismissing.
 * @param {number} duration - Auto-dismiss timeout in ms (default: 3500ms).
 */
export default function ToastAlert({ toast, onClose, duration = 3500 }) {
  useEffect(() => {
    if (!toast) return;

    const timer = setTimeout(() => {
      onClose();
    }, duration);

    return () => clearTimeout(timer);
  }, [toast, onClose, duration]);

  if (!toast) return null;

  const type = toast.type || 'info';

  return (
    <div className={`toast-notification-banner toast-${type}`} role="alert" aria-live="assertive">
      <div className="toast-icon-wrapper">
        {type === 'success' && (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
        {type === 'error' && (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        )}
        {type === 'info' && (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        )}
      </div>

      <div className="toast-content-col">
        {toast.title && <div className="toast-title-text">{toast.title}</div>}
        <div className="toast-message-text">{toast.message}</div>
      </div>

      <button
        type="button"
        className="toast-dismiss-btn"
        onClick={onClose}
        title="Dismiss notification"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
