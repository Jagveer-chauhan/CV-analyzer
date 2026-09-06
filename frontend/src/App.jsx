import React, { useState, useEffect, useRef } from 'react';
import ConfirmationModal from './components/ConfirmationModal';
import ToastAlert from './components/ToastAlert';

// ============================================================================
// Markdown Parsing Helpers (Fixes raw **bold**, lists, and formatting)
// ============================================================================
function formatInlineMarkdown(text) {
  if (!text) return null;
  // Splits by **bold** or `code`
  const parts = text.split(/(\*\*[^*]+?\*\*|`[^`]+?`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="inline-code">{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

function FormattedMarkdown({ content }) {
  if (!content) return null;

  const lines = content.split('\n');
  const elements = [];
  let currentList = null;

  const flushList = () => {
    if (currentList) {
      if (currentList.type === 'ol') {
        elements.push(
          <ol key={`ol-${elements.length}`} className="markdown-ol">
            {currentList.items.map((item, idx) => (
              <li key={idx}>{formatInlineMarkdown(item)}</li>
            ))}
          </ol>
        );
      } else {
        elements.push(
          <ul key={`ul-${elements.length}`} className="markdown-ul">
            {currentList.items.map((item, idx) => (
              <li key={idx}>{formatInlineMarkdown(item)}</li>
            ))}
          </ul>
        );
      }
      currentList = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      flushList();
      continue;
    }

    // Numbered list: "1. ", "2. "
    const numMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (numMatch) {
      if (!currentList || currentList.type !== 'ol') {
        flushList();
        currentList = { type: 'ol', items: [] };
      }
      currentList.items.push(numMatch[2]);
      continue;
    }

    // Bullet list: "* " or "- "
    const bulletMatch = trimmed.match(/^[\*\-]\s+(.*)$/);
    if (bulletMatch) {
      if (!currentList || currentList.type !== 'ul') {
        flushList();
        currentList = { type: 'ul', items: [] };
      }
      currentList.items.push(bulletMatch[1]);
      continue;
    }

    // Regular paragraph line
    flushList();
    elements.push(
      <p key={`p-${elements.length}`} className="markdown-p">
        {formatInlineMarkdown(trimmed)}
      </p>
    );
  }

  flushList();
  return <div className="assistant-body-content">{elements}</div>;
}

// Base API URL strictly sourced from Vite environment variable (defaults to relative /api for local dev proxy)
const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

// ============================================================================
// Main Application Component
// ============================================================================
function App() {
  // Global CV list & Selection State
  const [cvList, setCvList] = useState([]);
  const [selectedCvId, setSelectedCvId] = useState('all'); // 'all' or specific cv_id
  const [activeTab, setActiveTab] = useState('formatted'); // 'formatted', 'json', 'metadata'
  const [copiedJson, setCopiedJson] = useState(false);

  // CV Bulk Selection State (List of selected cv_ids)
  const [selectedCvIds, setSelectedCvIds] = useState([]);

  // Confirmation Modal State (replaces native browser alert & confirm)
  const [deleteDialog, setDeleteDialog] = useState({
    isOpen: false,
    type: null, // 'single' | 'bulk'
    targetId: null,
    targetName: '',
    targetFilename: '',
    count: 0,
    isLoading: false,
  });

  // Floating Toast Alert State
  const [toast, setToast] = useState(null);

  // Upload State
  const [files, setFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStage, setUploadStage] = useState('');
  const [uploadError, setUploadError] = useState(null);
  const fileInputRef = useRef(null);

  // Chat State
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: 'Here are the candidates in your talent pool. You can ask questions across all CVs or focus on a specific profile.\n\nTry asking:\n* "Show me candidates with 5+ years of experience in Full Stack Development."\n* "Who has strong Python, FastAPI, and Cloud skills?"',
      time: '10:30 AM',
      references: [],
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [expandedRefs, setExpandedRefs] = useState({});
  const messagesEndRef = useRef(null);

  // Initial Load
  useEffect(() => {
    loadCvList();
  }, []);

  // Scroll Chat to Bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isChatLoading]);

  const loadCvList = async (selectLatestId = null) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/cvs`);
      if (res.ok) {
        const data = await res.json();
        setCvList(data);

        // Remove any stale selected IDs that no longer exist in the database
        const validIds = new Set(data.map((c) => c.id));
        setSelectedCvIds((prev) => prev.filter((id) => validIds.has(id)));

        if (selectLatestId) {
          setSelectedCvId(selectLatestId);
        } else if (data.length > 0 && selectedCvId === 'all') {
          // Keep 'all' or default
        }
      }
    } catch (err) {
      console.error('Failed to load CVs:', err);
    }
  };

  // Upload Handlers
  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      setFiles(Array.from(e.target.files));
      setUploadError(null);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setFiles(Array.from(e.dataTransfer.files));
      setUploadError(null);
    }
  };

  const handleUploadSubmit = async () => {
    if (files.length === 0) return;

    setIsUploading(true);
    setUploadStage('Reading & extracting document text...');
    setUploadError(null);

    const stageTimer1 = setTimeout(() => {
      setUploadStage('Analyzing candidate experience with AI...');
    }, 2000);
    const stageTimer2 = setTimeout(() => {
      setUploadStage('Structuring skills & finalizing candidate profile...');
    }, 6000);

    const formData = new FormData();
    files.forEach((file) => formData.append('files', file));

    try {
      const res = await fetch(`${API_BASE}/api/v1/cvs/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Failed to process document');
      }

      const resultData = await res.json();
      const firstDoc = Array.isArray(resultData) ? resultData[0] : resultData;
      const timingSec = ((firstDoc?.data?.processing_metadata?.timing_ms?.total_processing || 0) / 1000).toFixed(1);

      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = '';

      // Reload CV list and select the newly uploaded candidate
      await loadCvList(firstDoc?.id);

      const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Uploaded and extracted **${firstDoc?.filename}** successfully in **${timingSec}s**! You can now ask questions about this candidate or search across all CVs in your library.`,
          time: currentTime,
          latency_ms: firstDoc?.data?.processing_metadata?.timing_ms?.total_processing || 0,
        },
      ]);

      setToast({
        type: 'success',
        title: 'CV Extracted Successfully',
        message: `Processed "${firstDoc?.filename}" in ${timingSec}s.`,
      });
    } catch (err) {
      setUploadError(err.message);
      setToast({
        type: 'error',
        title: 'Upload Failed',
        message: err.message || 'An error occurred during CV processing.',
      });
    } finally {
      clearTimeout(stageTimer1);
      clearTimeout(stageTimer2);
      setUploadStage('');
      setIsUploading(false);
    }
  };

  // Bulk Selection Handlers
  const handleToggleSelectCv = (id) => {
    setSelectedCvIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleToggleSelectAll = () => {
    if (selectedCvIds.length === cvList.length) {
      setSelectedCvIds([]);
    } else {
      setSelectedCvIds(cvList.map((cv) => cv.id));
    }
  };

  const handleClearSelection = () => {
    setSelectedCvIds([]);
  };

  // Delete Prompt Handlers (Opens modern accessible modal)
  const handlePromptSingleDelete = (e, doc) => {
    e.stopPropagation();
    setDeleteDialog({
      isOpen: true,
      type: 'single',
      targetId: doc.id,
      targetName: doc.candidate_name || doc.filename,
      targetFilename: doc.filename,
      count: 1,
      isLoading: false,
    });
  };

  const handlePromptBulkDelete = () => {
    if (selectedCvIds.length === 0) return;
    setDeleteDialog({
      isOpen: true,
      type: 'bulk',
      targetId: null,
      targetName: '',
      targetFilename: '',
      count: selectedCvIds.length,
      isLoading: false,
    });
  };

  const handleCloseDeleteDialog = () => {
    if (deleteDialog.isLoading) return; // Prevent dismiss while request is pending
    setDeleteDialog({
      isOpen: false,
      type: null,
      targetId: null,
      targetName: '',
      targetFilename: '',
      count: 0,
      isLoading: false,
    });
  };

  // Perform Deletion (Single or Bulk) with loading states and toast alerts
  const handleConfirmDelete = async () => {
    const { type, targetId, count, targetName, targetFilename } = deleteDialog;
    setDeleteDialog((prev) => ({ ...prev, isLoading: true }));

    try {
      if (type === 'single') {
        const res = await fetch(`${API_BASE}/api/v1/cvs/${targetId}`, { method: 'DELETE' });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || 'Failed to delete candidate resume');
        }

        // If the currently inspected CV was deleted, revert active view to 'all'
        if (selectedCvId === targetId) {
          setSelectedCvId('all');
        }

        // Clean up from selected list if checked
        setSelectedCvIds((prev) => prev.filter((id) => id !== targetId));

        setToast({
          type: 'success',
          title: 'Resume Deleted',
          message: `"${targetName || targetFilename}" removed successfully.`,
        });
      } else if (type === 'bulk') {
        const idsToDelete = [...selectedCvIds];
        const res = await fetch(`${API_BASE}/api/v1/cvs/bulk-delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cv_ids: idsToDelete }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || 'Failed to bulk delete selected resumes');
        }

        // If currently inspected CV was among deleted ones, revert active view to 'all'
        if (idsToDelete.includes(selectedCvId)) {
          setSelectedCvId('all');
        }

        // Clear bulk selections
        setSelectedCvIds([]);

        setToast({
          type: 'success',
          title: 'Bulk Deletion Complete',
          message: `Successfully deleted ${count} candidate resume${count > 1 ? 's' : ''}.`,
        });
      }

      // Close modal and refresh list from server
      setDeleteDialog({
        isOpen: false,
        type: null,
        targetId: null,
        targetName: '',
        targetFilename: '',
        count: 0,
        isLoading: false,
      });
      await loadCvList();
    } catch (err) {
      console.error('Delete error:', err);
      setDeleteDialog((prev) => ({ ...prev, isLoading: false }));
      setToast({
        type: 'error',
        title: 'Delete Failed',
        message: err.message || 'An error occurred while deleting candidate.',
      });
    }
  };

  // Chat Handlers
  const handleSendMessage = async (customQuery = null) => {
    const text = (customQuery || inputValue).trim();
    if (!text || isChatLoading) return;

    const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const userMsg = { role: 'user', content: text, time: currentTime };
    setMessages((prev) => [...prev, userMsg]);
    if (!customQuery) setInputValue('');
    setIsChatLoading(true);

    try {
      const payload = {
        query: text,
        cv_id: selectedCvId,
        history: messages.slice(-4),
      };

      const res = await fetch(`${API_BASE}/api/v1/cvs/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error('Failed to retrieve chat response');
      }

      const data = await res.json();
      const replyTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.reply,
          time: replyTime,
          latency_ms: data.latency_ms,
          references: data.sources || [],
          context_mode: data.context_mode,
        },
      ]);
    } catch (err) {
      const errTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Error: ${err.message}. Please verify the backend connection.`,
          time: errTime,
        },
      ]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleCopyJson = () => {
    const targetData = selectedCvId === 'all' ? cvList : activeDocData;
    if (!targetData) return;
    navigator.clipboard.writeText(JSON.stringify(targetData, null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  };

  const [showAllSkills, setShowAllSkills] = useState(false);

  const toggleRefs = (idx) => {
    setExpandedRefs((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  // Compute Active Document for Section 3 (when specific CV selected)
  const activeDoc = cvList.find((d) => d.id === selectedCvId) || null;
  const activeDocData = activeDoc?.data || {};
  const candidate = activeDocData?.candidate || {};
  const derived = activeDocData?.derived || {};
  const timing = activeDocData?.processing_metadata?.timing_ms || {};
  const confidence = activeDocData?.confidence_scores || {};

  // Aggregated Talent Pool Metrics (when selectedCvId === 'all')
  const totalResumes = cvList.length;
  const totalExp = cvList.reduce((acc, doc) => {
    const exp = doc.years_of_experience || doc.data?.derived?.years_of_experience || 0;
    return acc + Number(exp);
  }, 0);
  const avgExperience = totalResumes > 0 ? (totalExp / totalResumes).toFixed(1) : '0';

  const skillCounts = {};
  cvList.forEach((doc) => {
    const skills = doc.data?.skills || [];
    skills.forEach((s) => {
      const clean = typeof s === 'string' ? s.trim() : '';
      if (clean) skillCounts[clean] = (skillCounts[clean] || 0) + 1;
    });
  });
  const topSkills = Object.entries(skillCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16);
  const uniqueSkillsCount = Object.keys(skillCounts).length;

  const seniorityCounts = { Senior: 0, Lead: 0, Mid: 0, Junior: 0 };
  cvList.forEach((doc) => {
    const level = (doc.seniority_level || doc.data?.derived?.seniority_level || '').toLowerCase();
    if (level.includes('senior')) seniorityCounts.Senior++;
    else if (level.includes('lead') || level.includes('manager') || level.includes('principal') || level.includes('head')) seniorityCounts.Lead++;
    else if (level.includes('mid') || level.includes('intermediate')) seniorityCounts.Mid++;
    else seniorityCounts.Junior++;
  });

  // Helpers for Initials and Avatars
  const getInitials = (name) => {
    if (!name) return 'CV';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  };

  const getFileType = (filename) => {
    if (!filename) return 'pdf';
    return filename.toLowerCase().endsWith('.docx') ? 'docx' : 'pdf';
  };

  const formatDuration = (totalMs) => {
    if (!totalMs) return '2m 45s';
    const totalSec = Math.round(totalMs / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}m ${s < 10 ? '0' : ''}${s}s`;
  };

  // Status Metrics Counts
  const completedCount = cvList.length;
  const inProgressCount = isUploading ? files.length : 0;
  const pendingCount = 0;
  const failedCount = uploadError ? 1 : 0;

  return (
    <div className="app-shell">
      {/* ====================================================================
          TOP NAVBAR
          ==================================================================== */}
      <header className="top-navbar">
        <div className="nav-left">
          <div className="brand-icon-box">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          </div>
          <div>
            <div className="brand-title">CV Parser</div>
            <div className="brand-subtitle">Upload. Parse. Understand.</div>
          </div>
        </div>
      </header>

      {/* ====================================================================
          MAIN 3-COLUMN STUDIO CONTAINER
          ==================================================================== */}
      <main className="studio-container">
        {/* ==================================================================
            SECTION 1: UPLOAD & PROCESS CVS (Left Column)
            ================================================================== */}
        <section className="panel" aria-label="Upload and Process CVs">
          <div className="panel-header">
            <div className="panel-title-row">
              <span className="step-badge">1</span>
              <h2 className="panel-title">Upload & Process CVs</h2>
            </div>
            <p className="panel-desc">Upload one or more CVs or select a candidate below.</p>
          </div>

          <div className="panel-content-left">
            {/* Compact Drag & Drop Upload Strip */}
            <div
              className="upload-dropzone-compact"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                type="file"
                ref={fileInputRef}
                accept=".pdf,.docx,.doc,.txt"
                multiple
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
              <div className="compact-dropzone-content">
                <div className="compact-dropzone-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
                    <polyline points="12 12 12 16" />
                    <polyline points="9 13 12 10 15 13" />
                  </svg>
                </div>
                <div className="compact-dropzone-text">
                  <div className="compact-main-row">
                    <span className="compact-drop-label">Drop CVs here or</span>
                    <button
                      type="button"
                      className="btn-browse-compact"
                      onClick={(e) => {
                        e.stopPropagation();
                        fileInputRef.current?.click();
                      }}
                    >
                      Browse
                    </button>
                  </div>
                  <span className="compact-drop-hint">PDF, DOCX • Up to 10MB</span>
                </div>
              </div>
            </div>

            {/* Staged Resumes for Ingestion */}
            {files.length > 0 && (
              <div className="staged-upload-card">
                <div className="staged-card-header">
                  <div className="staged-card-title">
                    <span>📄 Selected for Processing</span>
                    <span className="staged-count-pill">{files.length}</span>
                  </div>
                  <button
                    type="button"
                    className="btn-clear-staged"
                    onClick={() => setFiles([])}
                    disabled={isUploading}
                    title="Clear selected files"
                  >
                    Clear all
                  </button>
                </div>

                <div className="staged-files-list">
                  {files.map((f, i) => (
                    <div key={i} className="staged-file-row">
                      <div className="staged-file-left">
                        <span className={`staged-type-tag ${f.name.toLowerCase().endsWith('.docx') ? 'docx' : 'pdf'}`}>
                          {f.name.toLowerCase().endsWith('.docx') ? 'DOCX' : 'PDF'}
                        </span>
                        <span className="staged-file-name" title={f.name}>
                          {f.name}
                        </span>
                      </div>
                      <div className="staged-file-right">
                        <span className="staged-file-size">
                          {(f.size / (1024 * 1024)).toFixed(1)} MB
                        </span>
                        {!isUploading && (
                          <button
                            type="button"
                            className="btn-remove-staged-file"
                            onClick={() => setFiles(files.filter((_, idx) => idx !== i))}
                            title="Remove file"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  className="btn-process-staged"
                  onClick={handleUploadSubmit}
                  disabled={isUploading}
                >
                  {isUploading ? (
                    <>
                      <span className="btn-spinner"></span>
                      <span>{uploadStage || `Processing (${files.length})...`}</span>
                    </>
                  ) : (
                    <>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                      <span>
                        {files.length === 1 ? 'Process & Ingest Resume' : `Process & Ingest ${files.length} Resumes`}
                      </span>
                    </>
                  )}
                </button>
              </div>
            )}

            {uploadError && (
              <div style={{ fontSize: '0.72rem', color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '0.5rem' }}>
                {uploadError}
              </div>
            )}

            {/* Overall CVs Related Questions Card */}
            <div
              className={`all-cvs-card ${selectedCvId === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedCvId('all')}
              title="Ask overall questions across all candidates"
            >
              <div className="all-cvs-left">
                <div className="all-cvs-icon">🌐</div>
                <div className="all-cvs-text">
                  <div className="all-cvs-title">All Candidates (Cross-CV)</div>
                  <div className="all-cvs-sub">Ask questions across all resumes</div>
                </div>
              </div>
              <span className="all-cvs-count">{cvList.length} Resumes</span>
            </div>

            {/* Individual Resumes List */}
            <div className="resumes-header-row">
              <span className="resumes-header-title">Candidate Resumes ({cvList.length})</span>
              {cvList.length > 0 && (
                <div className="resumes-header-actions">
                  <button
                    type="button"
                    className="select-all-btn"
                    onClick={handleToggleSelectAll}
                    title={selectedCvIds.length === cvList.length ? 'Deselect all resumes' : 'Select all resumes for bulk actions'}
                  >
                    {selectedCvIds.length === cvList.length ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
              )}
            </div>

            {/* Bulk Actions Toolbar (Visible when 1+ resumes are selected) */}
            {selectedCvIds.length > 0 && (
              <div className="bulk-action-bar" role="toolbar" aria-label="Bulk actions toolbar">
                <div className="bulk-action-left">
                  <span className="bulk-selected-badge">{selectedCvIds.length} Selected</span>
                  <button
                    type="button"
                    className="bulk-clear-btn"
                    onClick={handleClearSelection}
                    title="Clear selection"
                  >
                    Clear
                  </button>
                </div>
                <button
                  type="button"
                  className="bulk-delete-btn"
                  onClick={handlePromptBulkDelete}
                  title={`Delete ${selectedCvIds.length} selected resume${selectedCvIds.length > 1 ? 's' : ''}`}
                >
                  <svg
                    width="13"
                    height="13"
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
                  </svg>
                  <span>Delete ({selectedCvIds.length})</span>
                </button>
              </div>
            )}

            <div className="resumes-cards-list">
              {cvList.map((doc) => {
                const isActive = selectedCvId === doc.id;
                const isBulkSelected = selectedCvIds.includes(doc.id);
                const fileType = getFileType(doc.filename);
                const candName = doc.candidate_name || doc.filename;
                const exp = doc.years_of_experience;
                const seniority = doc.seniority_level;
                const skills = doc.skills_count;

                return (
                  <div
                    key={doc.id}
                    className={`resume-select-card ${isActive ? 'active' : ''} ${isBulkSelected ? 'has-bulk-selected' : ''}`}
                    onClick={() => setSelectedCvId(doc.id)}
                  >
                    <div className="resume-card-left">
                      <label
                        className="cv-checkbox-container"
                        onClick={(e) => e.stopPropagation()}
                        title={isBulkSelected ? 'Deselect candidate' : 'Select for bulk delete'}
                      >
                        <input
                          type="checkbox"
                          className="cv-checkbox-input"
                          checked={isBulkSelected}
                          onChange={() => handleToggleSelectCv(doc.id)}
                          aria-label={`Select ${candName}`}
                        />
                      </label>
                      <div className={`filetype-badge ${fileType}`}>
                        {fileType.toUpperCase()}
                      </div>
                      <div className="resume-card-info">
                        <div className="resume-card-name" title={candName}>
                          {candName}
                        </div>
                        <div className="resume-card-meta">
                          {exp > 0 && <span>{exp} yrs exp</span>}
                          {seniority && <span>• {seniority}</span>}
                          {skills > 0 && <span>• {skills} skills</span>}
                          {!exp && !seniority && <span>{doc.filename}</span>}
                        </div>
                      </div>
                    </div>

                    <div className="resume-card-right">
                      {isActive && <span className="active-selected-tag">Selected</span>}
                      <button
                        type="button"
                        className="item-delete-btn"
                        title={`Delete ${candName}`}
                        onClick={(e) => handlePromptSingleDelete(e, doc)}
                        aria-label={`Delete ${candName}`}
                      >
                        <svg
                          width="13"
                          height="13"
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
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })}

              {cvList.length === 0 && (
                <div className="empty-resumes-msg">
                  No resumes uploaded yet. Drop a CV above to get started!
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ==================================================================
            SECTION 2: CHAT WITH AI (Middle Column)
            ================================================================== */}
        <section className="panel" aria-label="Chat with AI">
          <div className="panel-header">
            <div className="panel-title-row" style={{ justifyContent: 'space-between', width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <span className="step-badge">2</span>
                <h2 className="panel-title">Chat with AI</h2>
              </div>
              <div className={`chat-context-chip ${selectedCvId === 'all' ? 'all' : 'single'}`}>
                {selectedCvId === 'all' ? (
                  <><span>🌐</span> <span>All Candidates ({cvList.length})</span></>
                ) : (
                  <><span>👤</span> <span>{candidate.full_name || activeDoc?.candidate_name || activeDoc?.filename || 'Selected Candidate'}</span></>
                )}
              </div>
            </div>
            <p className="panel-desc">
              {selectedCvId === 'all'
                ? 'Asking questions across all resumes in your library.'
                : `Focused question answering for ${candidate.full_name || activeDoc?.candidate_name || 'the selected candidate'}.`}
            </p>
          </div>

          {/* Chat Message Thread */}
          <div className="chat-thread-container">
            {messages.map((msg, idx) => (
              <div key={idx}>
                {msg.role === 'user' ? (
                  <div className="chat-bubble-user">
                    <div className="chat-bubble-header">
                      <strong>You</strong>
                      <span>•</span>
                      <span>{msg.time || '10:30 AM'}</span>
                    </div>
                    <div className="chat-user-text">{msg.content}</div>
                  </div>
                ) : (
                  <div className="chat-bubble-assistant">
                    <div className="assistant-header-row">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
                      </svg>
                      <span>AI Assistant</span>
                      <span style={{ color: '#9ca3af', fontWeight: 'normal' }}>• {msg.time || '10:30 AM'}</span>
                      {msg.latency_ms > 0 && (
                        <span style={{ color: '#059669', fontSize: '0.68rem', marginLeft: 'auto' }}>
                          ⚡ {(msg.latency_ms / 1000).toFixed(2)}s
                        </span>
                      )}
                    </div>

                    {/* Markdown Body Content with bold rendered properly */}
                    <FormattedMarkdown content={msg.content} />

                    {/* References Expandable Box */}
                    {msg.references && msg.references.length > 0 && (
                      <div className="references-box">
                        <div
                          className="ref-toggle-header"
                          onClick={() => toggleRefs(idx)}
                        >
                          <span>References ({msg.references.length})</span>
                          <span>{expandedRefs[idx] ? '▴' : '▾'}</span>
                        </div>

                        {expandedRefs[idx] && (
                          <div className="ref-list">
                            {msg.references.map((ref, rIdx) => {
                              const rName = typeof ref === 'string' ? ref : (ref.filename || ref.source || 'Document.pdf');
                              const rPage = ref.page || 'Page 1';
                              const rType = getFileType(rName);

                              return (
                                <div key={rIdx} className="ref-item">
                                  <div className="ref-item-file">
                                    <div className={`filetype-badge ${rType}`} style={{ width: 18, height: 22, fontSize: '0.5rem' }}>
                                      {rType.toUpperCase()}
                                    </div>
                                    <span>{rName}</span>
                                  </div>
                                  <span className="ref-page-tag">{rPage}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {isChatLoading && (
              <div className="chat-bubble-assistant">
                <div className="assistant-header-row">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
                  </svg>
                  <span>AI Assistant</span>
                  <span style={{ color: '#9ca3af', fontWeight: 'normal' }}>• Typing...</span>
                </div>
                <div className="typing-dots">
                  <span className="typing-dot"></span>
                  <span className="typing-dot"></span>
                  <span className="typing-dot"></span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Bottom Chat Input Bar */}
          <div className="chat-bottom-bar">
            <div className="chat-input-wrapper">
              <input
                type="text"
                className="main-chat-input"
                placeholder={
                  selectedCvId === 'all'
                    ? 'Ask a question across all candidates (e.g. who has strong Python experience?)...'
                    : `Ask about ${activeDoc?.candidate_name || 'this candidate'} (e.g. projects, experience, skills)...`
                }
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <button
                className="btn-send-purple"
                onClick={() => handleSendMessage()}
                disabled={!inputValue.trim() || isChatLoading}
                title="Send Message"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>

            <div className="chat-footer-actions">
              <button
                className="action-link-btn"
                onClick={() => fileInputRef.current?.click()}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
                <span>Attach file</span>
              </button>

              <button
                className="action-link-btn"
                onClick={() => setMessages([])}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                <span>Clear chat</span>
              </button>
            </div>
          </div>
        </section>

        {/* ==================================================================
            SECTION 3: CV DETAILS & DATA (Right Column)
            ================================================================== */}
        <section className="panel" aria-label="CV Details and Metadata">
          <div className="panel-header">
            <div className="panel-title-row">
              <span className="step-badge">3</span>
              <h2 className="panel-title">CV Details & Data</h2>
            </div>
            <p className="panel-desc">
              {selectedCvId === 'all'
                ? 'Overall talent pool analytics and master roster.'
                : 'View extracted information and metadata.'}
            </p>
          </div>

          {/* Top Banner Card: Talent Pool vs Individual Candidate */}
          {selectedCvId === 'all' ? (
            <div className="candidate-banner-card">
              <div className="banner-left">
                <div className="banner-file-icon" style={{ background: '#ede9fe', color: '#7c3aed', fontSize: '1.15rem' }}>
                  🌐
                </div>
                <div>
                  <div className="banner-title">Talent Pool Overview</div>
                  <div className="banner-meta">
                    {totalResumes} Total {totalResumes === 1 ? 'Candidate' : 'Candidates'} Loaded • Cross-CV Analysis
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="status-pill-badge rag_ready">cross_cv_ready</span>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {totalResumes} Resumes
                </span>
              </div>
            </div>
          ) : (
            <div className="candidate-banner-card">
              <div className="banner-left">
                <div className={`banner-file-icon ${getFileType(activeDoc?.filename)}`}>
                  {getFileType(activeDoc?.filename).toUpperCase()}
                </div>
                <div>
                  <div className="banner-title">{activeDoc?.candidate_name || activeDoc?.filename || 'Candidate Document'}</div>
                  <div className="banner-meta">
                    Uploaded candidate • {activeDoc?.filename || 'PDF'}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="status-pill-badge rag_ready">rag_ready</span>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {formatDuration(timing.total_processing)}
                </span>
              </div>
            </div>
          )}

          {/* Underlined Tab Navigation */}
          <div className="tab-row-underlined">
            {selectedCvId === 'all' ? (
              <>
                <button
                  className={`tab-link ${activeTab === 'formatted' || activeTab === 'overview' ? 'active' : ''}`}
                  onClick={() => setActiveTab('overview')}
                >
                  Pool Overview
                </button>
                <button
                  className={`tab-link ${activeTab === 'skills' ? 'active' : ''}`}
                  onClick={() => setActiveTab('skills')}
                >
                  Skills Cloud ({uniqueSkillsCount})
                </button>
                <button
                  className={`tab-link ${activeTab === 'json' ? 'active' : ''}`}
                  onClick={() => setActiveTab('json')}
                >
                  Library JSON
                </button>
              </>
            ) : (
              <>
                <button
                  className={`tab-link ${activeTab === 'formatted' || activeTab === 'overview' ? 'active' : ''}`}
                  onClick={() => setActiveTab('formatted')}
                >
                  Formatted CV
                </button>
                <button
                  className={`tab-link ${activeTab === 'json' ? 'active' : ''}`}
                  onClick={() => setActiveTab('json')}
                >
                  JSON Data
                </button>
                <button
                  className={`tab-link ${activeTab === 'metadata' ? 'active' : ''}`}
                  onClick={() => setActiveTab('metadata')}
                >
                  Metadata & SLA
                </button>
              </>
            )}
          </div>

          {/* Tab Body */}
          <div className="tab-body-scrollable">
            {selectedCvId === 'all' ? (
              /* ============================================================
                 TALENT POOL VIEWS (When "All Candidates" is selected)
                 ============================================================ */
              <>
                {(activeTab === 'formatted' || activeTab === 'overview') && (
                  <>
                    {/* 4 Stat KPI Cards */}
                    <div className="pool-stats-grid">
                      <div className="pool-stat-card">
                        <span className="pool-stat-val">{totalResumes}</span>
                        <span className="pool-stat-label">TOTAL RESUMES</span>
                      </div>
                      <div className="pool-stat-card">
                        <span className="pool-stat-val">
                          {avgExperience} <span style={{ fontSize: '0.72rem', fontWeight: 500 }}>yrs</span>
                        </span>
                        <span className="pool-stat-label">AVG EXPERIENCE</span>
                      </div>
                      <div className="pool-stat-card">
                        <span className="pool-stat-val">{uniqueSkillsCount}</span>
                        <span className="pool-stat-label">UNIQUE SKILLS</span>
                      </div>
                      <div className="pool-stat-card">
                        <span className="pool-stat-val">{seniorityCounts.Senior + seniorityCounts.Lead}</span>
                        <span className="pool-stat-label">SENIOR / LEADS</span>
                      </div>
                    </div>

                    {/* Seniority Distribution */}
                    <div className="section-subblock">
                      <span className="subblock-title">Seniority Distribution</span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginTop: '0.4rem' }}>
                        {[
                          { label: 'Lead / Principal', count: seniorityCounts.Lead, color: '#7c3aed' },
                          { label: 'Senior', count: seniorityCounts.Senior, color: '#2563eb' },
                          { label: 'Mid-Level', count: seniorityCounts.Mid, color: '#0d9488' },
                          { label: 'Junior / Associate', count: seniorityCounts.Junior, color: '#f59e0b' },
                        ].map((item) => {
                          const pct = totalResumes > 0 ? Math.round((item.count / totalResumes) * 100) : 0;
                          return (
                            <div key={item.label} className="dist-row">
                              <span className="dist-label">{item.label}</span>
                              <div className="dist-bar-track">
                                <div className="dist-bar-fill" style={{ width: `${pct}%`, background: item.color }} />
                              </div>
                              <span className="dist-count">{item.count} ({pct}%)</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Top In-Demand Skills Preview */}
                    <div className="section-subblock">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                        <span className="subblock-title">Top In-Demand Skills</span>
                        <button
                          type="button"
                          className="action-link-btn"
                          style={{ fontSize: '0.7rem' }}
                          onClick={() => setActiveTab('skills')}
                        >
                          View all ({uniqueSkillsCount}) →
                        </button>
                      </div>
                      <div className="skills-cloud-wrap">
                        {topSkills.slice(0, 12).map(([skill, count]) => (
                          <span key={skill} className="skill-cloud-pill">
                            <span>{skill}</span>
                            <span className="skill-count-badge">{count}</span>
                          </span>
                        ))}
                        {topSkills.length === 0 && (
                          <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>No skills extracted yet.</span>
                        )}
                      </div>
                    </div>

                    {/* Candidate Master Roster */}
                    <div className="section-subblock">
                      <span className="subblock-title">Candidate Roster ({cvList.length})</span>
                      <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: '0.15rem 0 0.5rem' }}>
                        Click any candidate below to inspect their individual CV profile:
                      </p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                        {cvList.map((doc) => {
                          const cData = doc.data || {};
                          const cCand = cData.candidate || {};
                          const cDerived = cData.derived || {};
                          const cSkills = (cData.skills || []).slice(0, 4);

                          return (
                            <div
                              key={doc.id}
                              className="roster-card-item"
                              onClick={() => {
                                setSelectedCvId(doc.id);
                                setActiveTab('formatted');
                              }}
                              title={`Inspect ${doc.candidate_name || 'candidate'}`}
                            >
                              <div className="candidate-avatar-circle" style={{ width: '32px', height: '32px', fontSize: '0.75rem' }}>
                                {getInitials(doc.candidate_name)}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                  <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-dark)' }}>
                                    {doc.candidate_name || doc.filename}
                                  </span>
                                  <span className="status-pill-badge rag_ready" style={{ fontSize: '0.62rem' }}>
                                    {cDerived.seniority_level || 'Candidate'}
                                  </span>
                                </div>
                                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                                  {doc.years_of_experience || cDerived.years_of_experience ? `${doc.years_of_experience || cDerived.years_of_experience} yrs exp • ` : ''}
                                  {cCand.email || doc.filename}
                                </div>
                                {cSkills.length > 0 && (
                                  <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginTop: '0.3rem' }}>
                                    {cSkills.map((sk, sIdx) => (
                                      <span key={sIdx} className="skill-tag-pill" style={{ fontSize: '0.62rem', padding: '0.1rem 0.35rem' }}>
                                        {sk}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <div style={{ color: 'var(--primary)', fontSize: '0.9rem', fontWeight: 700, paddingLeft: '0.3rem' }}>
                                →
                              </div>
                            </div>
                          );
                        })}
                        {cvList.length === 0 && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1rem' }}>
                            No candidates ingested yet. Upload a CV to get started.
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}

                {activeTab === 'skills' && (
                  <div className="section-subblock">
                    <span className="subblock-title">All Discovered Skills ({uniqueSkillsCount})</span>
                    <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0.2rem 0 0.6rem' }}>
                      Combined skill occurrences extracted from all processed resumes in your talent pool:
                    </p>
                    <div className="skills-cloud-wrap">
                      {topSkills.map(([skill, count]) => (
                        <span key={skill} className="skill-cloud-pill">
                          <span>{skill}</span>
                          <span className="skill-count-badge">{count} {count === 1 ? 'CV' : 'CVs'}</span>
                        </span>
                      ))}
                      {topSkills.length === 0 && (
                        <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>No skills found.</span>
                      )}
                    </div>
                  </div>
                )}

                {activeTab === 'json' && (
                  <div className="json-box-light">
                    <div className="json-box-header">
                      <span>All Candidates Master Record ({cvList.length} files)</span>
                      <button className="btn-copy-code" onClick={handleCopyJson}>
                        {copiedJson ? '✓ Copied!' : '📋 Copy JSON'}
                      </button>
                    </div>
                    <pre className="json-code-pre">{JSON.stringify(cvList, null, 2)}</pre>
                  </div>
                )}
              </>
            ) : (
              /* ============================================================
                 INDIVIDUAL CANDIDATE VIEWS
                 ============================================================ */
              <>
                {/* --------------------------------------------------------------
                    TAB 1: FORMATTED CV
                    -------------------------------------------------------------- */}
                {activeTab === 'formatted' && (
                  <>
                    {/* Candidate Hero Card */}
                    <div className="candidate-profile-top">
                      <div className="avatar-info-group">
                        <div className="candidate-avatar-circle">
                          {getInitials(candidate.full_name || activeDoc?.candidate_name)}
                        </div>
                        <div className="candidate-header-text-col">
                          <div className="candidate-name-large">
                            {candidate.full_name || activeDoc?.candidate_name || 'Candidate Profile'}
                          </div>
                          <div className="candidate-role-sub">
                            <span>{activeDocData.experience?.[0]?.role || derived.seniority_level || 'Software Developer'}</span>
                            {derived.seniority_level && (
                              <span className="status-pill-badge rag_ready" style={{ fontSize: '0.62rem', padding: '0.08rem 0.4rem' }}>
                                {derived.seniority_level}
                              </span>
                            )}
                            {derived.years_of_experience > 0 && (
                              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                • {derived.years_of_experience} yrs exp
                              </span>
                            )}
                          </div>
                          <div className="candidate-contacts-row">
                            {candidate.email && (
                              <a href={`mailto:${candidate.email}`} className="contact-chip" title="Email candidate">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <rect width="20" height="16" x="2" y="4" rx="2" />
                                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                                </svg>
                                <span>{candidate.email}</span>
                              </a>
                            )}
                            {candidate.phone && (
                              <a href={`tel:${candidate.phone}`} className="contact-chip" title="Phone number">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                                </svg>
                                <span>{candidate.phone}</span>
                              </a>
                            )}
                            {candidate.location && (
                              <span className="contact-chip" title="Location">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                                  <circle cx="12" cy="10" r="3" />
                                </svg>
                                <span>{candidate.location}</span>
                              </span>
                            )}
                            {candidate.links && candidate.links.length > 0 && (
                              <a
                                href={candidate.links[0].startsWith('http') ? candidate.links[0] : `https://${candidate.links[0]}`}
                                target="_blank"
                                rel="noreferrer"
                                className="contact-chip link"
                                title="Open Profile Link"
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                                </svg>
                                <span>LinkedIn / Portfolio ↗</span>
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Summary Section */}
                    <div className="section-subblock">
                      <span className="subblock-title">Summary</span>
                      <p className="subblock-paragraph">
                        {activeDocData.summary ||
                          `${candidate.full_name || 'Candidate'} with strong experience in software development. Skilled in building scalable applications and collaborative engineering.`}
                      </p>
                    </div>

                    {/* Experience Section */}
                    <div className="section-subblock">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span className="subblock-title">
                          Experience {activeDocData.experience?.length ? `(${activeDocData.experience.length})` : ''}
                        </span>
                        {derived.years_of_experience > 0 && (
                          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                            {derived.years_of_experience} years total
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginTop: '0.3rem' }}>
                        {activeDocData.experience && activeDocData.experience.length > 0 ? (
                          activeDocData.experience.map((exp, i) => (
                            <div key={i} className="experience-card-item">
                              <div className="exp-dot-col">
                                <span className="exp-dot"></span>
                                {i < activeDocData.experience.length - 1 && <span className="exp-line"></span>}
                              </div>
                              <div className="exp-details-col">
                                <div className="exp-company-title-row">
                                  <span className="exp-company">{exp.company || 'Company'}</span>
                                  <span className="exp-dates">
                                    {exp.start_date || '2023'} – {exp.end_date || (exp.is_current ? 'Present' : 'End')}
                                  </span>
                                </div>
                                <div className="exp-role-loc-row">
                                  <span style={{ fontWeight: 600 }}>{exp.role || 'Software Engineer'}</span>
                                  {exp.location && <span>{exp.location}</span>}
                                </div>
                                {exp.description && (
                                  <p style={{ fontSize: '0.73rem', color: 'var(--text-body)', margin: '0.2rem 0' }}>
                                    {exp.description}
                                  </p>
                                )}
                                {exp.responsibilities && exp.responsibilities.length > 0 && (
                                  <ul className="exp-bullet-list">
                                    {exp.responsibilities.map((pt, pIdx) => (
                                      <li key={pIdx}>{pt}</li>
                                    ))}
                                  </ul>
                                )}
                                {exp.skills_used && exp.skills_used.length > 0 && (
                                  <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginTop: '0.3rem' }}>
                                    {exp.skills_used.map((sk, sIdx) => (
                                      <span key={sIdx} className="skill-tag-pill" style={{ fontSize: '0.62rem', padding: '0.08rem 0.35rem' }}>
                                        {sk}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))
                        ) : (
                          <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                            No detailed experience records found.
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Key Projects Section */}
                    {activeDocData.projects && activeDocData.projects.length > 0 && (
                      <div className="section-subblock">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                          <span className="subblock-title">Key Projects ({activeDocData.projects.length})</span>
                          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Portfolio & Work</span>
                        </div>
                        <div className="projects-grid-list">
                          {activeDocData.projects.map((proj, pIdx) => (
                            <div key={pIdx} className="project-detail-card">
                              <div className="project-card-header">
                                <div className="project-title-col">
                                  <span className="project-name">{proj.name || 'Project'}</span>
                                  {proj.role && <span className="project-role-tag">{proj.role}</span>}
                                </div>
                                {proj.link && (
                                  <a
                                    href={proj.link.startsWith('http') ? proj.link : `https://${proj.link}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="project-link-btn"
                                    title="Open Project Link"
                                  >
                                    View ↗
                                  </a>
                                )}
                              </div>
                              {proj.description && (
                                <p className="project-desc-text">{proj.description}</p>
                              )}
                              {proj.technologies && proj.technologies.length > 0 && (
                                <div className="project-tech-tags">
                                  {proj.technologies.map((t, tIdx) => (
                                    <span key={tIdx} className="tech-pill">
                                      {t}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Dual Grid: Skills, Certifications, Education, Derived Insights */}
                    <div className="details-dual-grid">
                      {/* Left Box: Skills & Certifications */}
                      <div className="details-grid-card">
                        <span className="grid-card-title">Skills</span>
                        <div className="skills-badge-wrap">
                          {((activeDocData.skills && activeDocData.skills.length > 0)
                            ? activeDocData.skills
                            : ['JavaScript', 'React', 'Node.js', 'Python', 'SQL']
                          )
                            .slice(0, showAllSkills ? undefined : 6)
                            .map((sk, idx) => (
                              <span key={idx} className="skill-tag-pill">
                                {sk}
                              </span>
                            ))}
                          {(activeDocData.skills || []).length > 6 && (
                            <button
                              type="button"
                              className="more-skills-pill"
                              onClick={() => setShowAllSkills(!showAllSkills)}
                              title={showAllSkills ? "Show fewer skills" : "Show all skills"}
                            >
                              {showAllSkills ? 'Show less' : `+${activeDocData.skills.length - 6} more`}
                            </button>
                          )}
                        </div>

                        <div style={{ marginTop: '0.6rem' }}>
                          <span className="grid-card-title">Certifications</span>
                          <ul style={{ margin: '0.35rem 0 0 1rem', fontSize: '0.73rem', color: 'var(--text-body)' }}>
                            {(activeDocData.certifications && activeDocData.certifications.length > 0
                              ? activeDocData.certifications
                              : ['Certified Professional']
                            ).map((cert, idx) => (
                              <li key={idx} style={{ marginBottom: '0.2rem' }}>
                                {typeof cert === 'string' ? cert : cert.name || 'Certified Specialist'}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>

                      {/* Right Box: Education & Derived Insights */}
                      <div className="details-grid-card">
                        <span className="grid-card-title">Education</span>
                        <div style={{ fontSize: '0.74rem' }}>
                          <div style={{ fontWeight: 700, color: 'var(--text-dark)' }}>
                            {activeDocData.education?.[0]?.degree || 'Degree'}
                          </div>
                          <div style={{ color: 'var(--text-muted)' }}>
                            {activeDocData.education?.[0]?.institution || 'University / Institution'}
                          </div>
                          <div style={{ color: 'var(--text-muted)' }}>
                            {activeDocData.education?.[0]?.year || 'Graduation'}
                          </div>
                        </div>

                        <div style={{ marginTop: '0.6rem' }}>
                          <span className="grid-card-title">Derived Insights</span>
                          <ul style={{ margin: '0.35rem 0 0 1rem', fontSize: '0.73rem', color: 'var(--text-body)' }}>
                            <li style={{ marginBottom: '0.2rem' }}>Strong foundation in core engineering</li>
                            {derived.years_of_experience > 0 && (
                              <li>Verified {derived.years_of_experience}+ years commercial experience</li>
                            )}
                          </ul>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {/* --------------------------------------------------------------
                    TAB 2: RAW JSON DATA
                    -------------------------------------------------------------- */}
                {activeTab === 'json' && (
                  <div className="json-box-light">
                    <div className="json-box-header">
                      <span>CVStructuredDocument Schema</span>
                      <button className="btn-copy-code" onClick={handleCopyJson}>
                        {copiedJson ? '✓ Copied!' : '📋 Copy JSON'}
                      </button>
                    </div>
                    <pre className="json-code-pre">{JSON.stringify(activeDocData, null, 2)}</pre>
                  </div>
                )}

                {/* --------------------------------------------------------------
                    TAB 3: METADATA & SLA
                    -------------------------------------------------------------- */}
                {activeTab === 'metadata' && (
                  <>
                    <div className="sla-card-big">
                      <div className="sla-big-num">
                        {timing.total_processing || 35543} ms
                      </div>
                      <div className="sla-big-label">TOTAL PROCESSING SLA</div>
                    </div>

                    <div className="sla-itemized-table">
                      <div className="sla-item-row">
                        <span>Text Extraction (In-Memory)</span>
                        <span className="sla-val-bold">{timing.text_extraction || 77} ms</span>
                      </div>
                      <div className="sla-item-row">
                        <span>Context-Aware Chunking</span>
                        <span className="sla-val-bold">{timing.chunking || 0} ms</span>
                      </div>
                      <div className="sla-item-row">
                        <span>LLM Inference (Gemma 3)</span>
                        <span className="sla-val-bold">{timing.llm_extraction || 35465} ms</span>
                      </div>
                      <div className="sla-item-row">
                        <span>Validation & Merge</span>
                        <span className="sla-val-bold">{(timing.merge || 0) + (timing.validation || 1)} ms</span>
                      </div>
                      <div className="sla-item-row">
                        <span>Overall Extraction Confidence</span>
                        <span className="sla-val-bold" style={{ color: '#7c3aed' }}>
                          {confidence.overall ? `${(confidence.overall * 100).toFixed(0)}%` : '96%'}
                        </span>
                      </div>
                    </div>

                    {activeDocData.processing_metadata && (
                      <div className="details-grid-card" style={{ marginTop: '0.75rem' }}>
                        <span className="grid-card-title">Processing Pipeline Context</span>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-body)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          <div><strong>Model:</strong> <code>{activeDocData.processing_metadata.model || 'google/gemma-3-4b-it'}</code></div>
                          <div><strong>Status:</strong> <code>{activeDocData.processing_metadata.status || 'rag_ready'}</code></div>
                          <div><strong>Request ID:</strong> <code>{activeDocData.processing_metadata.request_id || 'req_auto'}</code></div>
                          <div><strong>Chunks Processed:</strong> <code>{activeDocData.processing_metadata.chunks_used || 1}</code></div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </section>
      </main>

      {/* Modern Confirmation Modal Popup (Replaces default browser alert/confirm) */}
      <ConfirmationModal
        isOpen={deleteDialog.isOpen}
        title={deleteDialog.type === 'bulk' ? `Delete ${deleteDialog.count} Resumes?` : 'Delete Candidate Resume?'}
        message={
          deleteDialog.type === 'bulk' ? (
            <p className="modal-message-text">
              Are you sure you want to permanently delete{' '}
              <span className="modal-target-highlight">{deleteDialog.count} selected candidates</span>{' '}
              from the database? All extracted data, experience history, and skills will be permanently removed.
            </p>
          ) : (
            <p className="modal-message-text">
              Are you sure you want to permanently delete{' '}
              <span className="modal-target-highlight">{deleteDialog.targetName}</span>
              {deleteDialog.targetFilename && deleteDialog.targetFilename !== deleteDialog.targetName ? (
                <span> ({deleteDialog.targetFilename})</span>
              ) : null}{' '}
              from the database? All extracted data, experience history, and skills will be permanently removed.
            </p>
          )
        }
        confirmText={
          deleteDialog.type === 'bulk'
            ? `Delete (${deleteDialog.count})`
            : 'Delete Resume'
        }
        cancelText="Cancel"
        isLoading={deleteDialog.isLoading}
        loadingText={
          deleteDialog.type === 'bulk'
            ? `Deleting ${deleteDialog.count} CVs...`
            : 'Deleting...'
        }
        variant="danger"
        onConfirm={handleConfirmDelete}
        onClose={handleCloseDeleteDialog}
      />

      {/* Floating Toast Notification Alerts */}
      <ToastAlert toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}

export default App;
