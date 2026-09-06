import React, { useEffect } from 'react';

/**
 * ConfirmationModal
 *
 * A reusable, accessible modal dialog that replaces browser-native alert/confirm popups.
 * Designed with modern styling, animated entrance, focus handling, and loading states.
 *
 * @param {boolean} isOpen - Whether the modal is visible.
 * @param {string} title - Heading for the confirmation dialog.
 * @param {React.ReactNode} message - Descriptive text or details about the action.
 * @param {string} confirmText - Label for the primary confirmation button.
 * @param {string} cancelText - Label for the cancel button.
 * @param {boolean} isLoading - Shows spinner and disables buttons while operation executes.
 * @param {string} loadingText - Text displayed during active loading.
 * @param {'danger' | 'warning'} variant - Theme styling (default 'danger').
 * @param {Function} onConfirm - Callback executed when confirming.
 * @param {Function} onClose - Callback executed when canceling or closing.
 */
export default function ConfirmationModal({
  isOpen,
  title = 'Confirm Action',
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  isLoading = false,
  loadingText = 'Processing...',
  variant = 'danger',
  onConfirm,
  onClose,
}) {
  // Listen for the Escape key to close the modal when not actively loading
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !isLoading) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isLoading, onClose]);

  if (!isOpen) return null;

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget && !isLoading) {
      onClose();
    }
  };

  return (
    <div
      className="modal-backdrop-overlay"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirmation-modal-title"
    >
      <div className={`modal-card-container modal-variant-${variant}`}>
        {/* Modal Header */}
        <div className="modal-header-row">
          <div className="modal-icon-badge">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 6h18" />
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
          </div>
          <div className="modal-title-col">
            <h3 id="confirmation-modal-title" className="modal-title-text">
              {title}
            </h3>
            <p className="modal-subtitle-text">This action cannot be undone.</p>
          </div>
          {!isLoading && (
            <button
              type="button"
              className="modal-close-btn"
              onClick={onClose}
              title="Close modal"
              aria-label="Close"
            >
              ✕
            </button>
          )}
        </div>

        {/* Modal Body */}
        <div className="modal-body-content">
          {typeof message === 'string' ? (
            <p className="modal-message-text">{message}</p>
          ) : (
            message
          )}
        </div>

        {/* Modal Footer / Actions */}
        <div className="modal-actions-row">
          <button
            type="button"
            className="modal-btn modal-btn-cancel"
            onClick={onClose}
            disabled={isLoading}
          >
            {cancelText}
          </button>
          <button
            type="button"
            className={`modal-btn modal-btn-confirm modal-btn-${variant}`}
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <span className="modal-btn-spinner" aria-hidden="true" />
                <span>{loadingText}</span>
              </>
            ) : (
              confirmText
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
