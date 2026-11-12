import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TutorMarkdown } from "./tutor-markdown.jsx";

const CARD_TYPES = [
  { id: "qa", label: "Concept Q&A", icon: "💡", desc: "Atomic question & crisp factual explanation" },
  { id: "formula", label: "Formula / Math", icon: "📐", desc: "Mathematical derivation, theorem, or equation" },
  { id: "application", label: "Applied Scenario", icon: "⚡", desc: "Real-world trade-off, edge case, or debugging scenario" },
  { id: "cloze", label: "Recall Cloze", icon: "🧩", desc: "Fill-in-the-blank or missing key phrase" },
];

const DECK_PAGE_SIZE = 40;

const AI_STYLES = [
  { id: "mixed", label: "Balanced Mix (Active Recall)" },
  { id: "formula", label: "Formulas & Equations ($LaTeX$)" },
  { id: "application", label: "Why / When & Edge Cases" },
  { id: "qa", label: "Crisp Atomic Q&A" },
];

const QUICK_FORMULAS = [
  { label: "Fraction", latex: "\\frac{a}{b}", desc: "a over b" },
  { label: "Square root", latex: "\\sqrt{x}", desc: "sqrt" },
  { label: "Exponent", latex: "x^{2}", desc: "power" },
  { label: "Subscript", latex: "x_{i}", desc: "sub" },
  { label: "Bayes Rule", latex: "P(A \\mid B) = \\frac{P(B \\mid A)P(A)}{P(B)}", desc: "Bayesian probability" },
  { label: "Summation", latex: "\\sum_{i=1}^{n} x_i", desc: "sum" },
  { label: "Limits", latex: "\\lim_{x \\to \\infty} f(x)", desc: "limit" },
  { label: "Integral", latex: "\\int_{a}^{b} f(x) \\, dx", desc: "integral" },
  { label: "Approx", latex: "\\approx", desc: "approximately" },
  { label: "Vector", latex: "\\vec{v} \\cdot \\vec{w} = 0", desc: "dot product" },
];

export function FcIcon({ name, size = 15, className = "" }) {
  const p = {
    bold: <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />,
    code: <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />,
    math: (
      <>
        <path d="M4 14l3 3 5-11h8" />
        <path d="M16 12l4 5M20 12l-4 5" />
      </>
    ),
    formula: (
      <>
        <path d="M4 6h16M4 6l6 6-6 6h16" />
      </>
    ),
    image: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </>
    ),
    edit: (
      <>
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </>
    ),
    trash: (
      <>
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <line x1="10" y1="11" x2="10" y2="17" />
        <line x1="14" y1="11" x2="14" y2="17" />
      </>
    ),
    eye: (
      <>
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    eyeOff: (
      <>
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
        <line x1="1" y1="1" x2="23" y2="23" />
      </>
    ),
    play: <polygon points="6 4 19 12 6 20 6 4" />,
    spark: <path d="m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" />,
    search: (
      <>
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </>
    ),
    check: <polyline points="20 6 9 17 4 12" />,
    close: (
      <>
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </>
    ),
    flip: (
      <>
        <path d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
      </>
    ),
    lightbulb: (
      <>
        <path d="M9 18h6m-4 4h2a2 2 0 0 0 2-2v-1a8 8 0 1 0-8 0v1a2 2 0 0 0 2 2Z" />
      </>
    ),
    cards: (
      <>
        <rect x="4" y="5" width="14" height="16" rx="2" />
        <path d="M8 3h12a2 2 0 0 1 2 2v13M8 10h6M8 14h6" />
      </>
    ),
    plus: (
      <>
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {p[name] || p.spark}
    </svg>
  );
}

function insertSnippet(ref, currentValue, setValue, snippet) {
  const el = ref?.current;
  if (!el || typeof el.selectionStart !== "number") {
    setValue((currentValue ? `${currentValue}\n` : "") + snippet);
    return;
  }
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const next = currentValue.slice(0, start) + snippet + currentValue.slice(end);
  setValue(next);
  if (typeof window !== "undefined") {
    window.setTimeout(() => {
      try {
        el.focus();
        el.setSelectionRange(start + snippet.length, start + snippet.length);
      } catch {}
    }, 10);
  }
}

function FormatToolbar({ targetRef, value, onChange, fieldName, onOpenImageModal, onToggleFormulaPalette }) {
  const buttons = [
    { label: "Bold", icon: "bold", title: "Insert bold text", snippet: "**key term**" },
    { label: "Code", icon: "code", title: "Insert inline code", snippet: "`code`" },
    { label: "Math $x$", icon: "math", title: "Insert inline math formula", snippet: "$E = mc^2$" },
    { label: "Block $$", icon: "formula", title: "Insert block equation", snippet: "\n$$\n\\frac{a}{b} = c\n$$\n" },
    { label: "Image", icon: "image", title: "Insert bounded image with preview", snippet: "\n![Diagram description|360](https://example.com/diagram.png)\n", isImage: true },
  ];
  return (
    <div className="fc-format-toolbar flex items-center gap-1" role="toolbar" aria-label={`${fieldName} formatting tools`}>
      {buttons.map((b) => (
        <button
          key={b.label}
          type="button"
          className="fc-format-btn"
          title={b.title}
          onClick={() => {
            if (b.isImage && onOpenImageModal) {
              onOpenImageModal();
            } else {
              insertSnippet(targetRef, value, onChange, b.snippet);
            }
          }}
        >
          <FcIcon name={b.icon} size={13} />
          <span>{b.label}</span>
        </button>
      ))}
      {onToggleFormulaPalette && (
        <button
          type="button"
          className="fc-format-btn fc-formula-quick-btn"
          title="Open Math & Formula Palette"
          onClick={onToggleFormulaPalette}
        >
          <FcIcon name="spark" size={13} />
          <span>Formulas ▾</span>
        </button>
      )}
    </div>
  );
}

/**
 * Visual Image Inserter Popover / Modal
 */
function ImageInserterModal({ open, onClose, onInsert }) {
  const [url, setUrl] = useState("");
  const [alt, setAlt] = useState("");
  const [size, setSize] = useState("360");
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (open) {
      setUrl("");
      setAlt("");
      setSize("360");
      setLoadError(false);
    }
  }, [open]);

  if (!open) return null;

  const validUrl = url.trim().startsWith("http://") || url.trim().startsWith("https://");

  function handleSubmit(e) {
    e?.preventDefault();
    if (!validUrl) return;
    const cleanAlt = alt.trim() || "Diagram";
    const snippet = size === "full"
      ? `\n![${cleanAlt}](${url.trim()})\n`
      : `\n![${cleanAlt}|${size}](${url.trim()})\n`;
    onInsert(snippet);
    onClose();
  }

  return (
    <div className="fc-image-dialog-overlay" onClick={onClose} role="presentation">
      <div className="fc-image-dialog-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Insert image into flashcard">
        <div className="flex items-center justify-between pb-2 border-b border-learnos-line">
          <div className="flex items-center gap-2">
            <FcIcon name="image" size={16} />
            <strong className="text-sm">Insert diagram or image</strong>
          </div>
          <button type="button" className="fc-icon-btn close" onClick={onClose} aria-label="Close image inserter">
            <FcIcon name="close" size={14} />
          </button>
        </div>

        <form className="flex flex-col gap-3 pt-2" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-1 text-xs text-learnos-muted">
            <span>Image Web URL (HTTPS)</span>
            <input
              type="url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setLoadError(false);
              }}
              placeholder="https://example.com/diagram.png"
              required
              autoFocus
              className="fc-modal-input"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-learnos-muted">
            <span>Description / Caption (Alt text)</span>
            <input
              type="text"
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              placeholder="e.g. Neural network architecture or flowchart"
              className="fc-modal-input"
            />
          </label>

          <div className="flex flex-col gap-1 text-xs text-learnos-muted">
            <span>Display width bound</span>
            <div className="flex items-center gap-2 flex-wrap">
              {[
                { id: "240", label: "Small (240px)" },
                { id: "360", label: "Medium (360px)" },
                { id: "480", label: "Large (480px)" },
                { id: "full", label: "Responsive (100%)" },
              ].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`filter-chip compact ${size === s.id ? "selected" : ""}`}
                  onClick={() => setSize(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="fc-image-preview-box">
            {validUrl && !loadError ? (
              <div className="fc-image-preview-inner">
                <img
                  src={url.trim()}
                  alt={alt || "Preview"}
                  style={{ maxWidth: size === "full" ? "100%" : `${size}px`, maxHeight: "160px" }}
                  onError={() => setLoadError(true)}
                  className="rounded border border-learnos-line object-contain"
                />
                <span className="text-[11px] text-learnos-muted">Live preview</span>
              </div>
            ) : (
              <div className="fc-image-preview-empty">
                <FcIcon name="image" size={24} />
                <span className="text-xs text-learnos-muted">
                  {loadError ? "Could not load image from this URL." : "Paste a valid image URL to see live preview."}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-learnos-line">
            <button type="button" className="secondary-btn compact" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-btn compact" disabled={!validUrl}>
              Insert Image
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Full modal portal for creating, editing, previewing (Markdown/Math/Images),
 * AI-generating personal or course-linked flashcards, and managing large decks cleanly.
 */
export function FlashcardPortalModal({
  open,
  initialMode = "manual",
  editingCard = null,
  currentCard = null,
  flashcards = [],
  initialCourseId = "",
  initialCourseFilter = "all",
  allCourses = [],
  allLessons = [],
  notes = [],
  remote = false,
  request,
  onClose,
  onSaveCard,
  onSaveGeneratedBatch,
  onDeleteCard,
  onJumpToCard,
  onOpenAccount,
  flashToast,
}) {
  const [activeEditingCard, setActiveEditingCard] = useState(editingCard);
  const [openedEditFromDeck, setOpenedEditFromDeck] = useState(false);
  const isEditing = Boolean(activeEditingCard?.id);
  const [tab, setTab] = useState(() => (editingCard?.id ? "manual" : initialMode || "manual"));
  const [previewMode, setPreviewMode] = useState(false);
  const [simulatorFlipped, setSimulatorFlipped] = useState(false);
  const [simulatorShowHint, setSimulatorShowHint] = useState(false);

  // Synchronize tab and active card synchronously whenever the modal opens or initialMode changes
  const prevOpenRef = useRef(open);
  const prevModeRef = useRef(initialMode);
  const prevEditingCardRef = useRef(editingCard);

  if (open && (!prevOpenRef.current || prevModeRef.current !== initialMode || prevEditingCardRef.current !== editingCard)) {
    prevOpenRef.current = true;
    prevModeRef.current = initialMode;
    prevEditingCardRef.current = editingCard;
    const targetTab = editingCard?.id ? "manual" : (initialMode || "manual");
    if (tab !== targetTab) {
      setTab(targetTab);
    }
    if (activeEditingCard !== (editingCard || null)) {
      setActiveEditingCard(editingCard || null);
    }
  } else if (!open && prevOpenRef.current) {
    prevOpenRef.current = false;
  }

  // Manual / Edit fields
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [hint, setHint] = useState("");
  const [cardType, setCardType] = useState("qa");
  const [courseId, setCourseId] = useState("");
  const [lessonId, setLessonId] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Visual dialogs & palettes
  const [imageModalTarget, setImageModalTarget] = useState(null); // 'front' | 'back' | null
  const [showFormulaPalette, setShowFormulaPalette] = useState(null); // 'front' | 'back' | null

  // AI generator fields
  const [aiScope, setAiScope] = useState("personal");
  const [aiTopic, setAiTopic] = useState("");
  const [aiSourceText, setAiSourceText] = useState("");
  const [aiNoteId, setAiNoteId] = useState("");
  const [aiCourseId, setAiCourseId] = useState("");
  const [aiLessonId, setAiLessonId] = useState("");
  const [aiCount, setAiCount] = useState(6);
  const [aiStyle, setAiStyle] = useState("mixed");
  const [aiIncludeMath, setAiIncludeMath] = useState(true);
  const [aiFocus, setAiFocus] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiMeta, setAiMeta] = useState(null);
  const [draftCards, setDraftCards] = useState([]);
  const [savingBatch, setSavingBatch] = useState(false);

  // Manage deck filters & pagination (40 cards per page)
  const [deckSearch, setDeckSearch] = useState("");
  const [deckCourseFilter, setDeckCourseFilter] = useState(initialCourseFilter || "all");
  const [deckStatusFilter, setDeckStatusFilter] = useState("all");
  const [deckOriginFilter, setDeckOriginFilter] = useState("all");
  const [deckTypeFilter, setDeckTypeFilter] = useState("all");
  const [deckSort, setDeckSort] = useState("due");
  const [visibleLimit, setVisibleLimit] = useState(DECK_PAGE_SIZE);
  const [expandedDeckIds, setExpandedDeckIds] = useState({});
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const frontRef = useRef(null);
  const backRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setFormError("");
    setAiError("");
    setPreviewMode(false);
    setSimulatorFlipped(false);
    setSimulatorShowHint(false);
    setOpenedEditFromDeck(false);
    setActiveEditingCard(editingCard || null);
    setConfirmDeleteId(null);
    setExpandedDeckIds({});
    setImageModalTarget(null);
    setShowFormulaPalette(null);

    if (editingCard?.id) {
      setTab("manual");
      setFront(editingCard.front || "");
      setBack(editingCard.back || "");
      setHint(editingCard.hint || "");
      setCardType(editingCard.card_type || editingCard.cardType || "qa");
      const matchedLesson = editingCard.lesson_id ? allLessons.find((l) => l.id === editingCard.lesson_id) : null;
      setCourseId(editingCard.course_id || matchedLesson?.courseId || "");
      setLessonId(editingCard.lesson_id || "");
    } else {
      setTab(initialMode || "manual");
      setFront("");
      setBack("");
      setHint("");
      setCardType("qa");
      setCourseId(initialCourseId || "");
      setLessonId("");
      setAiScope(initialCourseId ? "course" : "personal");
      setAiCourseId(initialCourseId || allCourses[0]?.id || "");
      setAiLessonId("");
      setDraftCards([]);
      setAiMeta(null);
      setDeckCourseFilter(initialCourseFilter || "all");
      setDeckSearch("");
      setDeckStatusFilter("all");
      setDeckOriginFilter("all");
      setDeckTypeFilter("all");
      setDeckSort("due");
      setVisibleLimit(DECK_PAGE_SIZE);
    }
  }, [open, editingCard, initialMode, initialCourseId, initialCourseFilter, allCourses, allLessons]);

  useEffect(() => {
    setVisibleLimit(DECK_PAGE_SIZE);
  }, [deckSearch, deckCourseFilter, deckStatusFilter, deckOriginFilter, deckTypeFilter, deckSort]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const onKey = (e) => {
      if (e.key === "Escape" && !saving && !aiGenerating && !savingBatch) {
        if (imageModalTarget) {
          setImageModalTarget(null);
          return;
        }
        onClose?.();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && tab === "manual") {
        e.preventDefault();
        handleSaveManual();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, saving, aiGenerating, savingBatch, imageModalTarget, tab, front, back, onClose]);

  const allLessonsMap = useMemo(() => {
    const map = new Map();
    allLessons.forEach((l) => map.set(l.id, l));
    return map;
  }, [allLessons]);

  const manualCourseLessons = useMemo(
    () => allLessons.filter((l) => !courseId || l.courseId === courseId),
    [allLessons, courseId]
  );

  const aiCourseLessons = useMemo(
    () => allLessons.filter((l) => !aiCourseId || l.courseId === aiCourseId),
    [allLessons, aiCourseId]
  );

  const resolvedCurrentCard = useMemo(() => {
    if (!currentCard?.id) return null;
    return flashcards.find((c) => c.id === currentCard.id) || currentCard;
  }, [currentCard, flashcards]);

  // Status counts for quick segmented filter pills
  const statusCounts = useMemo(() => {
    const now = Date.now();
    let dueCount = 0;
    let schedCount = 0;
    let leechCount = 0;
    flashcards.forEach((item) => {
      const isDue = !item.due_at || new Date(item.due_at).getTime() <= now;
      if (isDue) dueCount++;
      else schedCount++;
      if (Number(item.lapses || 0) >= 6) leechCount++;
    });
    return {
      all: flashcards.length,
      due: dueCount,
      scheduled: schedCount,
      leech: leechCount,
    };
  }, [flashcards]);

  const filteredDeckCards = useMemo(() => {
    const now = Date.now();
    const q = deckSearch.trim().toLowerCase();
    const list = flashcards.filter((item) => {
      if (resolvedCurrentCard?.id && item.id === resolvedCurrentCard.id) return false;
      const cLessonId = item.lesson_id || item.lessonId;
      const meta = cLessonId ? allLessonsMap.get(cLessonId) : null;
      const cId = meta?.courseId || item.course_id || item.courseId || "";
      if (deckCourseFilter === "unlinked") {
        if (cId || cLessonId) return false;
      } else if (deckCourseFilter !== "all") {
        if (cId !== deckCourseFilter) return false;
      }
      const isDueNow = !item.due_at || new Date(item.due_at).getTime() <= now;
      if (deckStatusFilter === "due" && !isDueNow) return false;
      if (deckStatusFilter === "scheduled" && isDueNow) return false;
      if (deckStatusFilter === "leech" && Number(item.lapses || 0) < 6) return false;
      if (deckOriginFilter !== "all") {
        const orig = item.origin === "ai_generated" ? "ai_generated" : "learner";
        if (orig !== deckOriginFilter) return false;
      }
      if (deckTypeFilter !== "all") {
        const tp = item.card_type || item.cardType || "qa";
        if (tp !== deckTypeFilter) return false;
      }
      if (q) {
        const hay = `${item.front || ""} ${item.back || ""} ${item.hint || ""} ${meta?.title || ""} ${meta?.courseTitle || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const sorted = [...list];
    if (deckSort === "newest") {
      sorted.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
    } else if (deckSort === "lapses") {
      sorted.sort((a, b) => (Number(b.lapses) || 0) - (Number(a.lapses) || 0));
    } else {
      sorted.sort((a, b) => new Date(a.due_at || 0).getTime() - new Date(b.due_at || 0).getTime());
    }
    return sorted;
  }, [flashcards, resolvedCurrentCard?.id, allLessonsMap, deckCourseFilter, deckStatusFilter, deckOriginFilter, deckTypeFilter, deckSearch, deckSort]);

  const pagedDeckCards = useMemo(
    () => filteredDeckCards.slice(0, visibleLimit),
    [filteredDeckCards, visibleLimit]
  );
  const remainingDeckCards = Math.max(0, filteredDeckCards.length - pagedDeckCards.length);

  if (!open) return null;

  function beginEditFromDeck(card) {
    setFormError("");
    setPreviewMode(false);
    setSimulatorFlipped(false);
    setOpenedEditFromDeck(true);
    setActiveEditingCard(card);
    setFront(card.front || "");
    setBack(card.back || "");
    setHint(card.hint || "");
    setCardType(card.card_type || card.cardType || "qa");
    const matchedLesson = card.lesson_id ? allLessonsMap.get(card.lesson_id) : null;
    setCourseId(card.course_id || matchedLesson?.courseId || "");
    setLessonId(card.lesson_id || "");
    setTab("manual");
  }

  async function handleSaveManual(e) {
    e?.preventDefault();
    setFormError("");
    if (!front.trim() || !back.trim()) {
      setFormError("Add both a Question and an Answer.");
      return;
    }
    setSaving(true);
    try {
      await onSaveCard?.({
        id: activeEditingCard?.id || null,
        front: front.trim(),
        back: back.trim(),
        hint: hint.trim(),
        cardType,
        courseId: courseId || null,
        lessonId: lessonId || null,
        origin: activeEditingCard?.origin || "learner",
      });
      if (openedEditFromDeck) {
        setActiveEditingCard(null);
        setOpenedEditFromDeck(false);
        setTab("deck");
      } else {
        onClose?.();
      }
    } catch (err) {
      setFormError(err?.message || "Could not save flashcard.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteInDeck(id) {
    if (!id || deletingId) return;
    setDeletingId(id);
    try {
      await onDeleteCard?.(id);
      setConfirmDeleteId(null);
    } finally {
      setDeletingId(null);
    }
  }

  async function handleGenerateAi(e) {
    e?.preventDefault();
    setAiError("");
    if (!remote) {
      setAiError("Sign in to generate AI flashcards.");
      return;
    }
    if (aiScope === "personal" && !aiTopic.trim() && !aiSourceText.trim() && !aiNoteId) {
      setAiError("Enter a personal topic, paste notes, or choose a saved note.");
      return;
    }
    if (aiScope === "course" && !aiCourseId && !aiLessonId) {
      setAiError("Select a course or topic first.");
      return;
    }

    setAiGenerating(true);
    setDraftCards([]);
    setAiMeta(null);
    try {
      const payload = {
        topic: aiTopic.trim(),
        sourceText: aiSourceText.trim(),
        noteId: aiScope === "personal" && aiNoteId ? aiNoteId : null,
        courseId: aiScope === "course" && aiCourseId ? aiCourseId : null,
        lessonId: aiScope === "course" && aiLessonId ? aiLessonId : null,
        count: Number(aiCount) || 6,
        cardStyle: aiStyle,
        includeMath: aiIncludeMath,
        focusHint: aiFocus.trim(),
        save: false,
      };
      const res = await request("flashcards/generate", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const list = Array.isArray(res?.flashcards) ? res.flashcards : [];
      if (!list.length) {
        throw new Error("AI did not return any flashcards. Try refining your topic.");
      }
      setDraftCards(
        list.map((card, idx) => ({
          ...card,
          _id: `gen-${Date.now()}-${idx}`,
          selected: true,
          courseId: res.courseId || (aiScope === "course" ? aiCourseId || null : null),
          lessonId: res.lessonId || (aiScope === "course" ? aiLessonId || null : null),
        }))
      );
      setAiMeta({
        model: res.model || res.source || "AI",
        courseId: res.courseId || null,
        lessonId: res.lessonId || null,
      });
    } catch (err) {
      setAiError(err?.message || "Failed to generate flashcards. Please try again.");
    } finally {
      setAiGenerating(false);
    }
  }

  async function handleSaveSelectedBatch() {
    const chosen = draftCards.filter((c) => c.selected && c.front.trim() && c.back.trim());
    if (!chosen.length) {
      setAiError("Select at least one generated flashcard to save.");
      return;
    }
    setSavingBatch(true);
    setAiError("");
    try {
      await onSaveGeneratedBatch?.(
        chosen.map((c) => ({
          front: c.front.trim(),
          back: c.back.trim(),
          hint: (c.hint || "").trim(),
          cardType: c.cardType || "qa",
          courseId: c.courseId || null,
          lessonId: c.lessonId || null,
          origin: "ai_generated",
        }))
      );
      flashToast?.(`Added ${chosen.length} AI flashcard${chosen.length === 1 ? "" : "s"} to your deck.`);
      onClose?.();
    } catch (err) {
      setAiError(err?.message || "Could not save generated flashcards.");
    } finally {
      setSavingBatch(false);
    }
  }

  const modalNode = (
    <div
      className="modal-backdrop open fc-portal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={() => {
        if (!saving && !aiGenerating && !savingBatch) onClose?.();
      }}
      role="presentation"
    >
      <div
        className="modal-card fc-portal-modal flex flex-col w-full"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fc-portal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head fc-portal-head flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="fc-head-icon-box">
              <FcIcon name={isEditing ? "edit" : "cards"} size={20} />
            </div>
            <div>
              <span className="eyebrow">{isEditing ? "CARD EDITOR" : "FLASHCARD STUDIO PORTAL"}</span>
              <h2 id="fc-portal-title" className="text-xl font-bold tracking-tight">
                {isEditing ? "Update flashcard" : "Create or generate flashcards"}
              </h2>
            </div>
          </div>
          <button
            type="button"
            className="modal-close grid place-items-center"
            onClick={onClose}
            disabled={saving || aiGenerating || savingBatch}
            aria-label="Close flashcard portal"
          >
            ×
          </button>
        </div>

        <div className="modal-body fc-portal-body flex flex-col gap-4">
          {!isEditing ? (
            <div className="fc-portal-tabs fc-portal-tabs-3" role="tablist" aria-label="Flashcard studio tabs">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "manual"}
                className={`fc-portal-tab ${tab === "manual" ? "active" : ""}`}
                onClick={() => setTab("manual")}
              >
                <FcIcon name="edit" size={14} />
                <span>Write manually</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "ai"}
                className={`fc-portal-tab ${tab === "ai" ? "active" : ""}`}
                onClick={() => setTab("ai")}
              >
                <FcIcon name="spark" size={14} />
                <span>Generate with AI</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "deck"}
                className={`fc-portal-tab ${tab === "deck" ? "active" : ""}`}
                onClick={() => setTab("deck")}
              >
                <FcIcon name="cards" size={14} />
                <span>Manage deck ({flashcards.length})</span>
              </button>
            </div>
          ) : openedEditFromDeck && (
            <div className="flex items-center justify-between">
              <button
                type="button"
                className="quiet-action flex items-center gap-1.5"
                onClick={() => {
                  setActiveEditingCard(null);
                  setOpenedEditFromDeck(false);
                  setTab("deck");
                }}
              >
                ← Back to deck
              </button>
            </div>
          )}

          {tab === "manual" ? (
            <form className="fc-portal-form flex flex-col gap-4" onSubmit={handleSaveManual}>
              {/* Studio Mode Toolbar */}
              <div className="fc-portal-mode-bar flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="fc-studio-badge">
                    <FcIcon name="cards" size={13} />
                    <span>Two-sided physical card canvas</span>
                  </span>
                  <span className="text-xs text-learnos-muted hidden sm:inline">
                    Supports Markdown, <code>$inline math$</code>, <code>$$block math$$</code>, and bounded <code>![alt](https://...)</code> images.
                  </span>
                </div>
                <div className="note-view-toggle" role="group" aria-label="Preview toggle">
                  <button
                    type="button"
                    className={`note-toggle-btn ${!previewMode ? "active" : ""}`}
                    onClick={() => setPreviewMode(false)}
                  >
                    <FcIcon name="edit" size={13} />
                    <span>Write</span>
                  </button>
                  <button
                    type="button"
                    className={`note-toggle-btn ${previewMode ? "active" : ""}`}
                    onClick={() => setPreviewMode(true)}
                  >
                    <FcIcon name="flip" size={13} />
                    <span>Live 3D Preview</span>
                  </button>
                </div>
              </div>

              {previewMode ? (
                /* Interactive 3D Card Simulator */
                <div className="fc-card-simulator-container">
                  <div className="fc-simulator-controls flex items-center justify-between gap-2 pb-2">
                    <span className="text-xs text-learnos-muted flex items-center gap-1.5">
                      <FcIcon name="flip" size={14} />
                      Click card or use the button below to test flip & hint interactivity
                    </span>
                    <button
                      type="button"
                      className="secondary-btn compact flex items-center gap-1"
                      onClick={() => setSimulatorFlipped((s) => !s)}
                    >
                      <FcIcon name="flip" size={13} />
                      <span>{simulatorFlipped ? "Flip to Question (Front)" : "Flip to Answer (Back)"}</span>
                    </button>
                  </div>

                  <div
                    className={`fc-live-card-3d ${simulatorFlipped ? "is-flipped" : ""}`}
                    onClick={() => setSimulatorFlipped((s) => !s)}
                    role="button"
                    tabIndex={0}
                    aria-label="Click to flip simulated flashcard"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSimulatorFlipped((s) => !s);
                      }
                    }}
                  >
                    {/* Front Face */}
                    <div className="fc-live-card-face fc-live-card-front">
                      <div className="fc-live-face-header flex items-center justify-between">
                        <span className="fc-face-tag front">QUESTION (FRONT)</span>
                        <span className="fc-face-chip">{CARD_TYPES.find((t) => t.id === cardType)?.label || "Concept Q&A"}</span>
                      </div>
                      <div className="fc-live-face-body">
                        {front.trim() ? (
                          <TutorMarkdown content={front} />
                        ) : (
                          <p className="text-learnos-muted italic">Type your question on the Front face…</p>
                        )}
                      </div>
                      {hint.trim() && (
                        <div
                          className="fc-live-face-hint-container"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSimulatorShowHint((s) => !s);
                          }}
                        >
                          <button type="button" className="text-button text-xs flex items-center gap-1">
                            <FcIcon name="lightbulb" size={13} />
                            <span>{simulatorShowHint ? "Hide hint" : "Show hint"}</span>
                          </button>
                          {simulatorShowHint && (
                            <div className="fc-live-face-hint-box">
                              <TutorMarkdown content={hint} />
                            </div>
                          )}
                        </div>
                      )}
                      <div className="fc-live-face-footer">
                        <span>Click card to reveal Answer</span>
                      </div>
                    </div>

                    {/* Back Face */}
                    <div className="fc-live-card-face fc-live-card-back">
                      <div className="fc-live-face-header flex items-center justify-between">
                        <span className="fc-face-tag back">ANSWER (BACK)</span>
                        <span className="fc-face-chip">{CARD_TYPES.find((t) => t.id === cardType)?.label || "Concept Q&A"}</span>
                      </div>
                      <div className="fc-live-face-body">
                        {back.trim() ? (
                          <TutorMarkdown content={back} />
                        ) : (
                          <p className="text-learnos-muted italic">Type your explanation and evidence on the Back face…</p>
                        )}
                      </div>
                      <div className="fc-live-face-footer">
                        <span>Click card to flip back</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                /* Two-Sided Physical Card Editor */
                <div className="fc-card-canvas flex flex-col gap-4">
                  {/* FACE 1: Question (Front) */}
                  <div className="fc-face-card fc-face-card-front">
                    <div className="fc-face-card-header flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="fc-face-indicator front">1</span>
                        <div>
                          <label htmlFor="fc-question-input" className="fc-field-label">Question (Front)</label>
                          <span className="fc-face-sublabel">Prompt shown during active recall</span>
                        </div>
                      </div>
                      <FormatToolbar
                        targetRef={frontRef}
                        value={front}
                        onChange={setFront}
                        fieldName="Question"
                        onOpenImageModal={() => setImageModalTarget("front")}
                        onToggleFormulaPalette={() => setShowFormulaPalette((p) => (p === "front" ? null : "front"))}
                      />
                    </div>

                    {showFormulaPalette === "front" && (
                      <div className="fc-formula-palette flex items-center gap-1.5 flex-wrap">
                        <span className="text-[11px] font-semibold text-learnos-muted flex items-center gap-1">
                          <FcIcon name="math" size={13} /> Quick formulas:
                        </span>
                        {QUICK_FORMULAS.map((f) => (
                          <button
                            key={f.label}
                            type="button"
                            className="fc-formula-chip"
                            title={f.desc}
                            onClick={() => insertSnippet(frontRef, front, setFront, `$${f.latex}$`)}
                          >
                            <span>{f.label}</span>
                            <code>${f.latex}$</code>
                          </button>
                        ))}
                      </div>
                    )}

                    <textarea
                      id="fc-question-input"
                      ref={frontRef}
                      rows={3}
                      value={front}
                      onChange={(e) => setFront(e.target.value)}
                      placeholder="Ask one crisp active-recall question… e.g. Why does Bayes' theorem update $P(H \mid E)$?"
                      required
                      className="fc-card-textarea front"
                    />
                  </div>

                  {/* FACE 2: Answer (Back) */}
                  <div className="fc-face-card fc-face-card-back">
                    <div className="fc-face-card-header flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="fc-face-indicator back">2</span>
                        <div>
                          <label htmlFor="fc-answer-input" className="fc-field-label">Answer (Back)</label>
                          <span className="fc-face-sublabel">Clear explanation, proof, or key result revealed upon flipping</span>
                        </div>
                      </div>
                      <FormatToolbar
                        targetRef={backRef}
                        value={back}
                        onChange={setBack}
                        fieldName="Answer"
                        onOpenImageModal={() => setImageModalTarget("back")}
                        onToggleFormulaPalette={() => setShowFormulaPalette((p) => (p === "back" ? null : "back"))}
                      />
                    </div>

                    {showFormulaPalette === "back" && (
                      <div className="fc-formula-palette flex items-center gap-1.5 flex-wrap">
                        <span className="text-[11px] font-semibold text-learnos-muted flex items-center gap-1">
                          <FcIcon name="math" size={13} /> Quick formulas:
                        </span>
                        {QUICK_FORMULAS.map((f) => (
                          <button
                            key={f.label}
                            type="button"
                            className="fc-formula-chip"
                            title={f.desc}
                            onClick={() => insertSnippet(backRef, back, setBack, `\n$$\n${f.latex}\n$$\n`)}
                          >
                            <span>{f.label}</span>
                            <code>{f.latex}</code>
                          </button>
                        ))}
                      </div>
                    )}

                    <textarea
                      id="fc-answer-input"
                      ref={backRef}
                      rows={4}
                      value={back}
                      onChange={(e) => setBack(e.target.value)}
                      placeholder={"Clear explanation + concrete example or formula:\n$$P(H \\mid E) = \\frac{P(E \\mid H)P(H)}{P(E)}$$"}
                      required
                      className="fc-card-textarea back"
                    />
                  </div>

                  {/* Retrieval Hint Block */}
                  <div className="fc-hint-card">
                    <div className="flex items-center gap-2">
                      <FcIcon name="lightbulb" size={16} className="text-amber-400" />
                      <label htmlFor="fc-hint-input" className="fc-field-label">Retrieval Hint (Optional)</label>
                    </div>
                    <input
                      id="fc-hint-input"
                      value={hint}
                      onChange={(e) => setHint(e.target.value)}
                      placeholder="Short cue shown before flipping without giving away the answer…"
                      maxLength={600}
                      className="fc-modal-input"
                    />
                  </div>
                </div>
              )}

              {/* Visual Card Type Chips & Metadata */}
              <div className="fc-card-type-section flex flex-col gap-2">
                <span className="fc-field-label">Card Type & Learning Objective</span>
                <div className="fc-type-chips-grid grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {CARD_TYPES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`fc-type-card-chip ${cardType === t.id ? "selected" : ""}`}
                      onClick={() => setCardType(t.id)}
                    >
                      <span className="fc-type-chip-icon">{t.icon}</span>
                      <strong className="fc-type-chip-title">{t.label}</strong>
                      <span className="fc-type-chip-desc">{t.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Course & Lesson Association */}
              <div className="fc-meta-grid grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <label className="fc-field-block flex flex-col gap-1.5">
                  <span className="fc-field-label">Link to Course (Optional)</span>
                  <select
                    value={courseId}
                    onChange={(e) => {
                      setCourseId(e.target.value);
                      setLessonId("");
                    }}
                  >
                    <option value="">Personal / Unlinked deck</option>
                    {allCourses.map((c) => (
                      <option key={c.id} value={c.id}>{c.title}</option>
                    ))}
                  </select>
                </label>

                <label className="fc-field-block flex flex-col gap-1.5">
                  <span className="fc-field-label">Link to Lesson / Topic</span>
                  <select
                    value={lessonId}
                    disabled={!courseId}
                    onChange={(e) => setLessonId(e.target.value)}
                  >
                    <option value="">{courseId ? "Whole course review" : "Personal deck"}</option>
                    {manualCourseLessons.map((l) => (
                      <option key={l.id} value={l.id}>{l.title}</option>
                    ))}
                  </select>
                </label>
              </div>

              {formError && <p className="form-error" role="alert">{formError}</p>}

              <div className="modal-actions flex items-center justify-between gap-3 pt-3 border-t border-learnos-line">
                <span className="text-xs text-learnos-muted hidden sm:inline">
                  Tip: Press <code>Ctrl + Enter</code> to save immediately.
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => {
                      if (openedEditFromDeck) {
                        setActiveEditingCard(null);
                        setOpenedEditFromDeck(false);
                        setTab("deck");
                      } else {
                        onClose?.();
                      }
                    }}
                    disabled={saving}
                  >
                    {openedEditFromDeck ? "Back to deck" : "Cancel"}
                  </button>
                  <button type="submit" className="primary-btn" disabled={saving}>
                    {saving ? (
                      <>
                        <span className="btn-spinner" /> Saving…
                      </>
                    ) : (
                      <>
                        <FcIcon name="check" size={14} />
                        <span>{isEditing ? "Save changes" : "Save flashcard"}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>
          ) : tab === "deck" ? (
            <div className="fc-deck-portal flex flex-col gap-3.5">
              {/* Elevated Pinned Current Card */}
              {resolvedCurrentCard && (
                <div className="fc-deck-current-pin">
                  <div className="fc-deck-current-pin-head flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="fc-current-badge">
                        <FcIcon name="spark" size={12} />
                        <span>Current card</span>
                      </span>
                      <span className="text-xs text-learnos-muted">Currently active in your study session</span>
                    </div>
                    <div className="fc-deck-row-actions flex items-center gap-1.5">
                      <button
                        type="button"
                        className="fc-icon-btn edit"
                        title="Edit card"
                        onClick={() => beginEditFromDeck(resolvedCurrentCard)}
                      >
                        <FcIcon name="edit" size={14} />
                        <span className="fc-btn-label">Edit</span>
                      </button>
                      {confirmDeleteId === resolvedCurrentCard.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="danger-btn compact"
                            disabled={deletingId === resolvedCurrentCard.id}
                            onClick={() => handleDeleteInDeck(resolvedCurrentCard.id)}
                          >
                            {deletingId === resolvedCurrentCard.id ? "…" : "Confirm"}
                          </button>
                          <button
                            type="button"
                            className="quiet-btn compact"
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="fc-icon-btn delete"
                          title="Delete card"
                          onClick={() => setConfirmDeleteId(resolvedCurrentCard.id)}
                        >
                          <FcIcon name="trash" size={14} />
                          <span className="fc-btn-label">Delete</span>
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="fc-deck-row-badges flex items-center gap-1.5 flex-wrap">
                    {resolvedCurrentCard.origin === "ai_generated" && <span className="fc-badge-ai">AI✦</span>}
                    {resolvedCurrentCard.card_type && resolvedCurrentCard.card_type !== "qa" && (
                      <span className="fc-badge-type">{resolvedCurrentCard.card_type}</span>
                    )}
                    {Number(resolvedCurrentCard.lapses || 0) >= 6 && <span className="fc-badge-leech">Needs rewrite</span>}
                  </div>
                  <strong className="fc-deck-q text-base tracking-tight">{resolvedCurrentCard.front}</strong>
                  <small className="fc-deck-a text-learnos-muted">
                    {String(resolvedCurrentCard.back || "").replace(/\s+/g, " ").slice(0, 160)}
                    {String(resolvedCurrentCard.back || "").length > 160 ? "…" : ""}
                  </small>
                </div>
              )}

              {/* Streamlined Search and Segmented Status Filters */}
              <div className="fc-deck-filter-bar flex flex-col gap-2.5">
                <div className="fc-deck-search-wrapper relative">
                  <FcIcon name="search" size={16} className="fc-search-icon" />
                  <input
                    type="search"
                    value={deckSearch}
                    onChange={(e) => setDeckSearch(e.target.value)}
                    placeholder="Search questions, answers, hints…"
                    aria-label="Search flashcards in deck"
                    className="fc-deck-search-input w-full"
                  />
                  {deckSearch && (
                    <button
                      type="button"
                      className="fc-search-clear-btn"
                      onClick={() => setDeckSearch("")}
                      aria-label="Clear search"
                    >
                      <FcIcon name="close" size={13} />
                    </button>
                  )}
                </div>

                {/* Quick Segmented Filter Pills */}
                <div className="fc-quick-filters flex items-center gap-1.5 flex-wrap" role="group" aria-label="Quick status filters">
                  <button
                    type="button"
                    className={`fc-quick-pill ${deckStatusFilter === "all" ? "active" : ""}`}
                    onClick={() => setDeckStatusFilter("all")}
                  >
                    <span>All cards</span>
                    <span className="fc-pill-count">{statusCounts.all}</span>
                  </button>
                  <button
                    type="button"
                    className={`fc-quick-pill due ${deckStatusFilter === "due" ? "active" : ""}`}
                    onClick={() => setDeckStatusFilter("due")}
                  >
                    <span className="fc-pill-dot due" />
                    <span>Due now</span>
                    <span className="fc-pill-count">{statusCounts.due}</span>
                  </button>
                  <button
                    type="button"
                    className={`fc-quick-pill scheduled ${deckStatusFilter === "scheduled" ? "active" : ""}`}
                    onClick={() => setDeckStatusFilter("scheduled")}
                  >
                    <span className="fc-pill-dot scheduled" />
                    <span>Scheduled</span>
                    <span className="fc-pill-count">{statusCounts.scheduled}</span>
                  </button>
                  {statusCounts.leech > 0 && (
                    <button
                      type="button"
                      className={`fc-quick-pill leech ${deckStatusFilter === "leech" ? "active" : ""}`}
                      onClick={() => setDeckStatusFilter("leech")}
                    >
                      <span className="fc-pill-dot leech" />
                      <span>Needs review</span>
                      <span className="fc-pill-count">{statusCounts.leech}</span>
                    </button>
                  )}
                </div>

                {/* Compact Secondary Dropdowns */}
                <div className="fc-secondary-filter-row grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <select
                    value={deckCourseFilter}
                    onChange={(e) => setDeckCourseFilter(e.target.value)}
                    aria-label="Filter deck by course"
                    className="fc-compact-select"
                  >
                    <option value="all">All courses</option>
                    {allCourses.map((c) => (
                      <option key={c.id} value={c.id}>{c.title}</option>
                    ))}
                    <option value="unlinked">Personal / Unlinked</option>
                  </select>

                  <select
                    value={deckOriginFilter}
                    onChange={(e) => setDeckOriginFilter(e.target.value)}
                    aria-label="Filter deck by source"
                    className="fc-compact-select"
                  >
                    <option value="all">All sources</option>
                    <option value="ai_generated">AI Generated</option>
                    <option value="learner">Created by me</option>
                  </select>

                  <select
                    value={deckTypeFilter}
                    onChange={(e) => setDeckTypeFilter(e.target.value)}
                    aria-label="Filter deck by card type"
                    className="fc-compact-select"
                  >
                    <option value="all">All card types</option>
                    {CARD_TYPES.map((t) => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                  </select>

                  <select
                    value={deckSort}
                    onChange={(e) => setDeckSort(e.target.value)}
                    aria-label="Sort deck"
                    className="fc-compact-select"
                  >
                    <option value="due">Sort: Due soonest</option>
                    <option value="newest">Sort: Newest first</option>
                    <option value="lapses">Sort: Most missed</option>
                  </select>
                </div>
              </div>

              <div className="fc-deck-summary flex items-center justify-between gap-2 text-xs text-learnos-muted">
                <span>
                  Showing {pagedDeckCards.length} of {filteredDeckCards.length} other cards
                  {resolvedCurrentCard ? " (+1 current card pinned above)" : ""}
                </span>
                {(deckSearch || deckCourseFilter !== "all" || deckStatusFilter !== "all" || deckOriginFilter !== "all" || deckTypeFilter !== "all") && (
                  <button
                    type="button"
                    className="text-button text-xs flex items-center gap-1"
                    onClick={() => {
                      setDeckSearch("");
                      setDeckCourseFilter("all");
                      setDeckStatusFilter("all");
                      setDeckOriginFilter("all");
                      setDeckTypeFilter("all");
                    }}
                  >
                    Reset filters
                  </button>
                )}
              </div>

              {/* Elevated Card Rows with Modern Icon Action Buttons */}
              <div className="fc-deck-portal-list flex flex-col gap-2.5 max-h-[360px] overflow-y-auto pr-1">
                {pagedDeckCards.length === 0 ? (
                  <div className="fc-deck-empty-state text-center p-6 border border-dashed border-learnos-line rounded-xl">
                    <FcIcon name="cards" size={28} className="mx-auto mb-2 text-learnos-muted" />
                    <p className="text-sm font-semibold text-learnos-text">
                      {flashcards.length === 0
                        ? "Your deck is empty."
                        : "No cards match the current filters."}
                    </p>
                    <p className="text-xs text-learnos-muted mt-1">
                      {flashcards.length === 0
                        ? "Use Write manually to craft your first card or Generate with AI."
                        : "Try adjusting your search terms or quick filter pills."}
                    </p>
                  </div>
                ) : (
                  pagedDeckCards.map((item) => {
                    const metaLesson = item.lesson_id ? allLessonsMap.get(item.lesson_id) : null;
                    const metaCourse = allCourses.find((c) => c.id === (metaLesson?.courseId || item.course_id));
                    const isDue = !item.due_at || new Date(item.due_at).getTime() <= Date.now();
                    const isExpanded = Boolean(expandedDeckIds[item.id]);
                    return (
                      <div key={item.id} className="fc-deck-row">
                        <div className="fc-deck-row-main">
                          <div className="fc-deck-row-badges flex items-center gap-1.5 flex-wrap">
                            <span className={`fc-due-pill ${isDue ? "due" : "later"}`}>
                              <span className={`fc-due-dot ${isDue ? "due" : "later"}`} />
                              {isDue ? "Due now" : new Date(item.due_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                            </span>
                            {item.origin === "ai_generated" && <span className="fc-badge-ai">AI✦</span>}
                            {item.card_type && item.card_type !== "qa" && <span className="fc-badge-type">{item.card_type}</span>}
                            {Number(item.lapses || 0) >= 6 && <span className="fc-badge-leech">Needs rewrite</span>}
                            {metaCourse?.title && <span className="fc-course-chip">{metaCourse.title}</span>}
                            {metaLesson?.title && <span className="fc-lesson-chip">{metaLesson.title}</span>}
                          </div>
                          <strong className="fc-deck-q">{item.front}</strong>
                          {isExpanded ? (
                            <div className="fc-deck-expanded">
                              <TutorMarkdown content={item.back} />
                              {item.hint && <small className="fc-generated-hint">Hint: {item.hint}</small>}
                            </div>
                          ) : (
                            <small className="fc-deck-a">
                              {String(item.back || "").replace(/\s+/g, " ").slice(0, 140)}
                              {String(item.back || "").length > 140 ? "…" : ""}
                            </small>
                          )}
                        </div>

                        {/* Modern Icon Action Buttons */}
                        <div className="fc-deck-row-actions flex items-center gap-1">
                          <button
                            type="button"
                            className={`fc-icon-btn preview ${isExpanded ? "active" : ""}`}
                            title={isExpanded ? "Hide answer" : "Preview answer"}
                            onClick={() => setExpandedDeckIds((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                            aria-label={isExpanded ? "Hide answer" : "Preview answer"}
                          >
                            <FcIcon name={isExpanded ? "eyeOff" : "eye"} size={14} />
                            <span className="fc-btn-label">{isExpanded ? "Hide" : "Preview"}</span>
                          </button>

                          {isDue && onJumpToCard && (
                            <button
                              type="button"
                              className="fc-icon-btn study"
                              title="Study this card now"
                              onClick={() => {
                                onJumpToCard(item);
                                onClose?.();
                              }}
                              aria-label="Study this card now"
                            >
                              <FcIcon name="play" size={13} />
                              <span className="fc-btn-label">Study</span>
                            </button>
                          )}

                          <button
                            type="button"
                            className="fc-icon-btn edit"
                            title="Edit card"
                            onClick={() => beginEditFromDeck(item)}
                            aria-label="Edit card"
                          >
                            <FcIcon name="edit" size={14} />
                            <span className="fc-btn-label">Edit</span>
                          </button>

                          {confirmDeleteId === item.id ? (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                className="danger-btn compact"
                                disabled={deletingId === item.id}
                                onClick={() => handleDeleteInDeck(item.id)}
                              >
                                {deletingId === item.id ? "…" : "Confirm"}
                              </button>
                              <button
                                type="button"
                                className="quiet-btn compact"
                                onClick={() => setConfirmDeleteId(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="fc-icon-btn delete"
                              title="Delete card"
                              onClick={() => setConfirmDeleteId(item.id)}
                              aria-label="Delete card"
                            >
                              <FcIcon name="trash" size={14} />
                              <span className="fc-btn-label">Delete</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {remainingDeckCards > 0 && (
                <div className="fc-deck-load-more flex justify-center pt-1">
                  <button
                    type="button"
                    className="secondary-btn compact fc-deck-load-more-btn"
                    onClick={() => setVisibleLimit((limit) => limit + DECK_PAGE_SIZE)}
                  >
                    Load {Math.min(DECK_PAGE_SIZE, remainingDeckCards)} more ({remainingDeckCards} remaining)
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* AI Studio Tab */
            <div className="fc-ai-studio flex flex-col gap-4">
              {!remote ? (
                <div className="practice-status-banner is-error">
                  <span>Sign in to generate personalized AI flashcards from any topic, note, or lesson.</span>
                  <button type="button" className="quiet-btn compact" onClick={() => { onClose?.(); onOpenAccount?.(); }}>
                    Sign in
                  </button>
                </div>
              ) : (
                <form className="flex flex-col gap-3.5" onSubmit={handleGenerateAi}>
                  <div className="fc-scope-pills flex flex-wrap gap-2" role="group" aria-label="Generation source">
                    <button
                      type="button"
                      className={`filter-chip ${aiScope === "personal" ? "selected" : ""}`}
                      onClick={() => setAiScope("personal")}
                    >
                      Personal topic / Notes
                    </button>
                    {allCourses.length > 0 && (
                      <button
                        type="button"
                        className={`filter-chip ${aiScope === "course" ? "selected" : ""}`}
                        onClick={() => setAiScope("course")}
                      >
                        Course / Lesson
                      </button>
                    )}
                  </div>

                  {aiScope === "personal" ? (
                    <div className="flex flex-col gap-3">
                      <label className="fc-field-block flex flex-col gap-1.5">
                        <span className="fc-field-label">What topic do you want flashcards for?</span>
                        <input
                          value={aiTopic}
                          onChange={(e) => setAiTopic(e.target.value)}
                          placeholder="e.g. Bayes' Theorem, Dynamic Programming, French irregular verbs…"
                          maxLength={300}
                          className="fc-modal-input"
                        />
                      </label>
                      {notes.length > 0 && (
                        <label className="fc-field-block flex flex-col gap-1.5">
                          <span className="fc-field-label">Or ground from a saved note (Optional)</span>
                          <select value={aiNoteId} onChange={(e) => setAiNoteId(e.target.value)}>
                            <option value="">None — use my topic / text below</option>
                            {notes.map((n) => (
                              <option key={n.id} value={n.id}>{n.title}</option>
                            ))}
                          </select>
                        </label>
                      )}
                      <label className="fc-field-block flex flex-col gap-1.5">
                        <span className="fc-field-label">Paste notes, formulas, or key material (Optional)</span>
                        <textarea
                          rows={3}
                          value={aiSourceText}
                          onChange={(e) => setAiSourceText(e.target.value)}
                          placeholder="Paste definitions, lecture notes, equations, or paragraphs to turn into atomic active-recall cards…"
                        />
                      </label>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <label className="fc-field-block flex flex-col gap-1.5">
                        <span className="fc-field-label">Course</span>
                        <select
                          value={aiCourseId}
                          onChange={(e) => {
                            setAiCourseId(e.target.value);
                            setAiLessonId("");
                          }}
                        >
                          {allCourses.map((c) => (
                            <option key={c.id} value={c.id}>{c.title}</option>
                          ))}
                        </select>
                      </label>
                      <label className="fc-field-block flex flex-col gap-1.5">
                        <span className="fc-field-label">Topic / Lesson (Optional)</span>
                        <select value={aiLessonId} onChange={(e) => setAiLessonId(e.target.value)}>
                          <option value="">Whole course overview</option>
                          {aiCourseLessons.map((l) => (
                            <option key={l.id} value={l.id}>{l.title}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                    <label className="fc-field-block flex flex-col gap-1.5">
                      <span className="fc-field-label">Cards to generate</span>
                      <select value={aiCount} onChange={(e) => setAiCount(Number(e.target.value))}>
                        <option value={4}>4 cards (quick set)</option>
                        <option value={6}>6 cards (recommended)</option>
                        <option value={8}>8 cards (deep review)</option>
                      </select>
                    </label>
                    <label className="fc-field-block flex flex-col gap-1.5">
                      <span className="fc-field-label">Focus style</span>
                      <select value={aiStyle} onChange={(e) => setAiStyle(e.target.value)}>
                        {AI_STYLES.map((s) => (
                          <option key={s.id} value={s.id}>{s.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="fc-checkbox-row flex items-center gap-2 text-xs text-learnos-text">
                      <input
                        type="checkbox"
                        checked={aiIncludeMath}
                        onChange={(e) => setAiIncludeMath(e.target.checked)}
                      />
                      <span>Include math formulas (<code>$...$</code>)</span>
                    </label>
                  </div>

                  <label className="fc-field-block flex flex-col gap-1.5">
                    <span className="fc-field-label">Extra guidance (Optional)</span>
                    <input
                      value={aiFocus}
                      onChange={(e) => setAiFocus(e.target.value)}
                      placeholder="e.g. Emphasize common mistakes, time complexity, or step-by-step intuition"
                      maxLength={300}
                    />
                  </label>

                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <span className="text-xs text-learnos-muted">
                      Uses Minimum Information Principle: 1 atomic concept + retrieval hint per card.
                    </span>
                    <button type="submit" className="primary-btn" disabled={aiGenerating}>
                      {aiGenerating ? <><span className="btn-spinner" /> Designing cards…</> : "Generate preview cards ↗"}
                    </button>
                  </div>
                </form>
              )}

              {aiError && <p className="form-error" role="alert">{aiError}</p>}

              {draftCards.length > 0 && (
                <div className="fc-generated-preview flex flex-col gap-3 pt-3 border-t border-learnos-line">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <span className="eyebrow">REVIEW GENERATED CARDS</span>
                      <p className="text-xs text-learnos-muted">
                        {draftCards.filter((c) => c.selected).length} of {draftCards.length} selected
                        {aiMeta?.model ? ` · via ${aiMeta.model}` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="primary-btn"
                      disabled={savingBatch || !draftCards.some((c) => c.selected)}
                      onClick={handleSaveSelectedBatch}
                    >
                      {savingBatch ? <><span className="btn-spinner" /> Saving…</> : `Save ${draftCards.filter((c) => c.selected).length} to deck ↗`}
                    </button>
                  </div>

                  <div className="fc-generated-list flex flex-col gap-2.5 max-h-[300px] overflow-y-auto pr-1">
                    {draftCards.map((card, idx) => (
                      <article key={card._id} className={`fc-generated-item ${card.selected ? "selected" : ""}`}>
                        <div className="flex items-center justify-between gap-2">
                          <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                            <input
                              type="checkbox"
                              checked={card.selected}
                              onChange={(e) =>
                                setDraftCards((prev) =>
                                  prev.map((x, j) => (j === idx ? { ...x, selected: e.target.checked } : x))
                                )
                              }
                            />
                            <span>Question {idx + 1}</span>
                            <span className="fc-type-badge">{card.cardType || "qa"}</span>
                          </label>
                          <button
                            type="button"
                            className="text-button text-xs"
                            onClick={() => {
                              setTab("manual");
                              setFront(card.front);
                              setBack(card.back);
                              setHint(card.hint || "");
                              setCardType(card.cardType || "qa");
                              setCourseId(card.courseId || "");
                              setLessonId(card.lessonId || "");
                            }}
                          >
                            Edit in editor
                          </button>
                        </div>
                        <div className="fc-generated-qa">
                          <div className="fc-generated-q">
                            <TutorMarkdown content={card.front} />
                          </div>
                          <div className="fc-generated-a">
                            <TutorMarkdown content={card.back} />
                          </div>
                          {card.hint && <small className="fc-generated-hint">Hint: {card.hint}</small>}
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Visual Image Inserter Modal */}
        <ImageInserterModal
          open={Boolean(imageModalTarget)}
          onClose={() => setImageModalTarget(null)}
          onInsert={(snippet) => {
            if (imageModalTarget === "front") {
              insertSnippet(frontRef, front, setFront, snippet);
            } else if (imageModalTarget === "back") {
              insertSnippet(backRef, back, setBack, snippet);
            }
          }}
        />
      </div>
    </div>
  );

  if (typeof document !== "undefined" && document.body) {
    return createPortal(modalNode, document.body);
  }
  return modalNode;
}
