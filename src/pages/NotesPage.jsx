import React, { useState, useEffect, useMemo, useDeferredValue } from "react";
import { Icon, parseMarkdownToHtml, prettyDate } from "../components/common.jsx";

function NotesBackgroundRibbons() {
  return (
    <div className="notes-ambient-ribbons-wrap" aria-hidden="true">
      <svg
        className="notes-ambient-ribbons-svg"
        viewBox="0 0 1440 900"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          {/* Top-Right Golden Radial Glow */}
          <radialGradient id="goldGlowTR" cx="88%" cy="10%" r="55%">
            <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.18" />
            <stop offset="40%" stopColor="#D97706" stopOpacity="0.06" />
            <stop offset="100%" stopColor="#1C1817" stopOpacity="0" />
          </radialGradient>

          {/* Bottom-Left Golden Radial Glow */}
          <radialGradient id="goldGlowBL" cx="10%" cy="90%" r="50%">
            <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.15" />
            <stop offset="35%" stopColor="#D97706" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#1C1817" stopOpacity="0" />
          </radialGradient>

          {/* Top-Right Ribbon Linear Gradient */}
          <linearGradient id="goldRibbonTR" x1="560" y1="20" x2="1420" y2="70" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#F59E0B" stopOpacity="0" />
            <stop offset="20%" stopColor="#FBBF24" stopOpacity="0.6" />
            <stop offset="50%" stopColor="#FFFBEB" stopOpacity="0.95" />
            <stop offset="75%" stopColor="#F59E0B" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#D97706" stopOpacity="0" />
          </linearGradient>

          {/* Bottom-Left Ribbon Linear Gradient */}
          <linearGradient id="goldRibbonBL" x1="0" y1="880" x2="680" y2="820" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#F59E0B" stopOpacity="0" />
            <stop offset="25%" stopColor="#FFFBEB" stopOpacity="0.9" />
            <stop offset="60%" stopColor="#FBBF24" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#F59E0B" stopOpacity="0" />
          </linearGradient>

          <filter id="ribbonCrispGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur1" />
            <feGaussianBlur stdDeviation="8" result="blur2" />
            <feMerge>
              <feMergeNode in="blur2" />
              <feMergeNode in="blur1" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <filter id="ribbonAtmosphere" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="14" />
          </filter>
        </defs>

        {/* Ambient Glows */}
        <rect width="1440" height="900" fill="url(#goldGlowTR)" />
        <rect width="1440" height="900" fill="url(#goldGlowBL)" />

        {/* Top-Right Elegant Luminous Golden Ribbon Wave */}
        <path
          d="M 540 -20 C 740 160 1000 145 1220 45 C 1320 -5 1410 20 1480 -10"
          stroke="rgba(245, 158, 11, 0.08)"
          strokeWidth="16"
          filter="url(#ribbonAtmosphere)"
        />
        <path
          d="M 540 -20 C 740 160 1000 145 1220 45 C 1320 -5 1410 20 1480 -10"
          stroke="rgba(251, 191, 36, 0.25)"
          strokeWidth="6"
          filter="url(#ribbonCrispGlow)"
        />
        <path
          d="M 540 -20 C 740 160 1000 145 1220 45 C 1320 -5 1410 20 1480 -10"
          stroke="url(#goldRibbonTR)"
          strokeWidth="2.5"
          filter="url(#ribbonCrispGlow)"
        />

        {/* Bottom-Left Elegant Luminous Golden Ribbon Wave */}
        <path
          d="M -40 760 C 130 700 280 810 440 865 C 540 900 640 915 760 925"
          stroke="rgba(245, 158, 11, 0.07)"
          strokeWidth="16"
          filter="url(#ribbonAtmosphere)"
        />
        <path
          d="M -40 760 C 130 700 280 810 440 865 C 540 900 640 915 760 925"
          stroke="rgba(251, 191, 36, 0.22)"
          strokeWidth="5"
          filter="url(#ribbonCrispGlow)"
        />
        <path
          d="M -40 760 C 130 700 280 810 440 865 C 540 900 640 915 760 925"
          stroke="url(#goldRibbonBL)"
          strokeWidth="2.2"
          filter="url(#ribbonCrispGlow)"
        />
      </svg>
    </div>
  );
}

function NotesPage(p) {
  const notesList = p.data?.notes || [];
  const [selected, setSelected] = useState(notesList[0]?.id || "");
  const [draft, setDraft] = useState(() => (notesList[0] ? { ...notesList[0] } : null));
  const [savingNote, setSavingNote] = useState(false);
  const [deletingNote, setDeletingNote] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCourse, setFilterCourse] = useState(() => p.routeQuery?.get?.("course") || "all");
  const deferredSearchQuery = useDeferredValue(searchQuery);

  // Default to preview mode for reading-first experience
  const [viewMode, setViewMode] = useState(() => (notesList[0] ? "preview" : "edit"));
  const [selectedCourseId, setSelectedCourseId] = useState(() => {
    const first = notesList[0];
    return first?.course_id || "";
  });

  // Group all courses and their modules/lessons for structured selection
  const allCourses = p.data?.courses || [];
  const allLessonsMap = useMemo(() => {
    const map = new Map();
    allCourses.forEach(c => {
      (c.modules || []).forEach(m => {
        (m.lessons || []).forEach(l => {
          map.set(l.id, { ...l, courseId: c.id, courseTitle: c.title, moduleTitle: m.title });
        });
      });
    });
    return map;
  }, [allCourses]);

  // Keep selected and draft synchronized with p.data.notes if notes change externally
  useEffect(() => {
    if (selected) {
      const stillExists = notesList.find(n => n.id === selected);
      if (!stillExists) {
        const next = notesList[0] || null;
        if (next) {
          setSelected(next.id);
          setDraft({ ...next });
          const meta = next.lesson_id ? allLessonsMap.get(next.lesson_id) : null;
          setSelectedCourseId(meta?.courseId || next.course_id || "");
          setViewMode("preview");
        } else {
          setSelected("");
          setDraft(null);
          setSelectedCourseId("");
        }
      }
    } else if (notesList.length > 0 && !draft) {
      const first = notesList[0];
      setSelected(first.id);
      setDraft({ ...first });
      const meta = first.lesson_id ? allLessonsMap.get(first.lesson_id) : null;
      setSelectedCourseId(meta?.courseId || first.course_id || "");
      setViewMode("preview");
    }
  }, [notesList, selected, draft, allLessonsMap]);

  const startNew = (templateTitle = "", templateBody = "") => {
    const activeLessonMeta = p.activeLesson ? allLessonsMap.get(p.activeLesson.id) : null;
    setSelected("");
    setSelectedCourseId(activeLessonMeta?.courseId || p.activeCourse?.id || "");
    setDraft({
      title: templateTitle || "",
      body: templateBody || "",
      lesson_id: p.activeLesson?.id || "",
      source_ref: activeLessonMeta?.title || "",
      origin: "learner",
    });
    setViewMode("edit");
  };

  const open = n => {
    setSelected(n.id);
    setDraft({ ...n });
    const lessonMeta = n.lesson_id ? allLessonsMap.get(n.lesson_id) : null;
    setSelectedCourseId(lessonMeta?.courseId || n.course_id || "");
    setViewMode("preview");
  };

  const insertMarkdown = (prefix, suffix = "", placeholder = "text") => {
    const textarea = document.querySelector(".notes-minimal-body-input");
    if (!textarea || !draft) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const sel = draft.body.slice(start, end);
    const replacement = prefix + (sel || placeholder) + suffix;
    const nextBody = draft.body.slice(0, start) + replacement + draft.body.slice(end);
    setDraft({ ...draft, body: nextBody });
    setTimeout(() => {
      textarea.focus();
      const cursorStart = start + prefix.length;
      const cursorEnd = cursorStart + (sel ? sel.length : placeholder.length);
      textarea.setSelectionRange(cursorStart, cursorEnd);
    }, 10);
  };

  const handleSave = async () => {
    if (!draft) return;
    setSavingNote(true);
    try {
      await p.saveNote({
        id: draft.id,
        title: draft.title || "Untitled note",
        body: draft.body,
        lessonId: draft.lesson_id || null,
        sourceRef: draft.source_ref || "",
        origin: draft.origin || "learner",
      });
      setViewMode("preview");
    } finally {
      setSavingNote(false);
    }
  };

  const handleDelete = async (idToDelete = null, titleToDelete = null) => {
    const targetId = idToDelete || draft?.id;
    const targetTitle = titleToDelete || draft?.title || "this note";
    if (!targetId) return;
    if (!confirm(`Delete "${targetTitle}"? This cannot be undone.`)) return;
    setDeletingNote(true);
    try {
      await p.deleteNote(targetId);
      const remaining = notesList.filter(n => n.id !== targetId);
      if (selected === targetId || draft?.id === targetId) {
        const nextNote = remaining[0] || null;
        if (nextNote) {
          setSelected(nextNote.id);
          setDraft({ ...nextNote });
          const meta = nextNote.lesson_id ? allLessonsMap.get(nextNote.lesson_id) : null;
          setSelectedCourseId(meta?.courseId || nextNote.course_id || "");
          setViewMode("preview");
        } else {
          setSelected("");
          setDraft(null);
          setSelectedCourseId("");
        }
      }
    } finally {
      setDeletingNote(false);
    }
  };

  // Filter notes by search query and course
  const filteredNotes = useMemo(() => {
    return notesList.filter(n => {
      if (deferredSearchQuery.trim()) {
        const q = deferredSearchQuery.toLowerCase();
        const matchTitle = (n.title || "").toLowerCase().includes(q);
        const matchBody = (n.body || "").toLowerCase().includes(q);
        const matchSource = (n.lesson_title || n.source_ref || "").toLowerCase().includes(q);
        if (!matchTitle && !matchBody && !matchSource) return false;
      }
      if (filterCourse !== "all") {
        if (filterCourse === "unlinked") return !n.lesson_id && !n.course_id;
        const meta = n.lesson_id ? allLessonsMap.get(n.lesson_id) : null;
        const cId = meta?.courseId || n.course_id;
        if (cId !== filterCourse) return false;
      }
      return true;
    });
  }, [notesList, deferredSearchQuery, filterCourse, allLessonsMap]);

  // Available lessons for the currently selected course in the editor
  const availableLessons = useMemo(() => {
    if (!selectedCourseId) return [];
    const crs = allCourses.find(c => c.id === selectedCourseId);
    if (!crs) return [];
    const list = [];
    (crs.modules || []).forEach((m, mIdx) => {
      (m.lessons || []).forEach(l => {
        list.push({ ...l, label: `M${mIdx + 1}: ${l.title}` });
      });
    });
    return list;
  }, [allCourses, selectedCourseId]);

  // Telemetry counts
  const linkedCount = useMemo(() => notesList.filter(n => n.course_id || n.lesson_id).length, [notesList]);

  // Editor stats
  const wordCount = useMemo(() => {
    const text = (draft?.body || "").trim();
    return text ? text.split(/\s+/).length : 0;
  }, [draft?.body]);
  const readTimeMinutes = useMemo(() => Math.max(1, Math.ceil(wordCount / 200)), [wordCount]);

  return (
    <div className="notes-reading-page">
      {/* Background Golden Ribbon Waves */}
      <NotesBackgroundRibbons />

      {/* 1. Header Bar: Minimal Study Notes title with amber "Notes" + top-right telemetry badges */}
      <header className="notes-reading-header">
        <h1 className="notes-reading-title">
          Study <span className="notes-accent-gold">Notes</span>
        </h1>

        <div className="notes-header-badges">
          <span className="notes-minimal-badge" title={`${notesList.length} notes saved`}>
            <Icon name="fileText" size={13} />
            <span>{notesList.length}</span>
          </span>
          <span className="notes-minimal-badge" title={`${linkedCount} notes linked to curriculum`}>
            <Icon name="link" size={13} />
            <span>{linkedCount}</span>
          </span>
        </div>
      </header>

      {/* 2. Workspace: Minimal sidebar on the left + borderless reading area on the right */}
      <div className="notes-reading-grid">
        {/* Left Column: Minimal Note List */}
        <aside className="notes-reading-sidebar">
          {/* Row 1: All Notes label + count, and + New button */}
          <div className="notes-sidebar-header-row">
            <div className="notes-sidebar-label-cluster">
              <span className="notes-amber-icon" aria-hidden="true">
                <Icon name="layers" size={15} />
              </span>
              <span className="notes-sidebar-heading">All Notes</span>
              <span className="notes-sidebar-count-chip">{notesList.length}</span>
            </div>

            <button
              type="button"
              className="notes-new-action-btn"
              onClick={() => startNew()}
              title="Create new note"
            >
              <Icon name="plus" size={13} />
              <span>New</span>
            </button>
          </div>

          {/* Row 2: Search Bar */}
          <div className="notes-search-container">
            <Icon name="search" size={14} />
            <input
              type="search"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search notes..."
              aria-label="Search notes"
              className="notes-minimal-search-input"
            />
            {searchQuery && (
              <button
                type="button"
                className="notes-search-clear"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>

          {/* Course filter if courses exist */}
          {allCourses.length > 1 && (
            <div className="notes-course-filter-strip">
              <select
                value={filterCourse}
                onChange={e => setFilterCourse(e.target.value)}
                className="notes-minimal-filter-select"
                aria-label="Filter notes by course"
              >
                <option value="all">All courses ({notesList.length})</option>
                {allCourses.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
                <option value="unlinked">Personal / Unlinked</option>
              </select>
            </div>
          )}

          {/* Row 3+: Minimal Note List with Separators */}
          <div className="notes-compact-list">
            {notesList.length === 0 ? (
              <div className="notes-sidebar-empty">
                <p>No notes created yet.</p>
                <button type="button" onClick={() => startNew()} className="notes-link-action">
                  + Create note
                </button>
              </div>
            ) : filteredNotes.length === 0 ? (
              <div className="notes-sidebar-empty">
                <p>No matches found.</p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setFilterCourse("all");
                  }}
                  className="notes-link-action"
                >
                  Clear search
                </button>
              </div>
            ) : (
              filteredNotes.map(n => {
                const isSelected = selected === n.id;
                return (
                  <div
                    key={n.id}
                    className={`notes-list-item-clean ${isSelected ? "selected-amber" : ""}`}
                    onClick={() => open(n)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => e.key === "Enter" && open(n)}
                    aria-label={`Open note: ${n.title || "Untitled"}`}
                  >
                    <div className="notes-item-icon-box">
                      <Icon name="fileText" size={16} />
                    </div>
                    <div className="notes-item-text-box">
                      <span className="notes-item-title">{n.title || "Untitled note"}</span>
                      <span className="notes-item-date">
                        {prettyDate(n.updated_at || n.created_at, { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="notes-item-trash-btn"
                      onClick={e => {
                        e.stopPropagation();
                        handleDelete(n.id, n.title);
                      }}
                      title="Delete note"
                      aria-label={`Delete note ${n.title || "Untitled"}`}
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* Right Column: Borderless Main Reading & Editing Area */}
        <main className="notes-reading-main">
          {draft ? (
            <div className="notes-reading-content-flow">
              {/* Row 1: Contextual Course and Lesson Tag Selectors */}
              <div className="notes-context-tags-row">
                <div className="notes-context-tag">
                  <Icon name="layers" size={13} />
                  <select
                    value={selectedCourseId}
                    onChange={e => {
                      const nextCourseId = e.target.value;
                      setSelectedCourseId(nextCourseId);
                      if (!nextCourseId) {
                        setDraft({ ...draft, lesson_id: "", lesson_title: "", course_id: null });
                      } else {
                        setDraft({ ...draft, course_id: nextCourseId, lesson_id: "", lesson_title: "" });
                      }
                    }}
                    className="notes-tag-select"
                    aria-label="Course link"
                  >
                    <option value="">Personal note (no course)</option>
                    {allCourses.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                </div>

                {Boolean(selectedCourseId) && (
                  <div className="notes-context-tag">
                    <Icon name="tag" size={13} />
                    <select
                      value={draft.lesson_id || ""}
                      onChange={e => {
                        const lId = e.target.value;
                        const meta = allLessonsMap.get(lId);
                        setDraft({
                          ...draft,
                          lesson_id: lId || "",
                          lesson_title: meta?.title || "",
                          source_ref: meta?.title || draft.source_ref || "",
                        });
                      }}
                      className="notes-tag-select"
                      aria-label="Lesson link"
                    >
                      <option value="">General course note</option>
                      {availableLessons.map(l => (
                        <option key={l.id} value={l.id}>
                          {l.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Row 2: Minimal Action Toolbar Row */}
              <div className="notes-reading-actions-row">
                <button
                  type="button"
                  className={`notes-action-pill ${viewMode === "preview" ? "active-amber" : "ghost"}`}
                  onClick={() => setViewMode("preview")}
                >
                  <Icon name="eye" size={13} />
                  <span>Preview</span>
                </button>
                <button
                  type="button"
                  className={`notes-action-pill ${viewMode === "edit" ? "active-amber" : "ghost"}`}
                  onClick={() => setViewMode("edit")}
                >
                  <Icon name="edit" size={13} />
                  <span>Write</span>
                </button>

                {draft.id ? (
                  <button
                    type="button"
                    className="notes-action-pill ghost delete"
                    disabled={deletingNote || savingNote}
                    onClick={() => handleDelete()}
                    title="Delete note"
                  >
                    {deletingNote ? <span className="btn-spinner" /> : <Icon name="trash" size={13} />}
                    <span>Delete</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="notes-action-pill ghost delete"
                    onClick={() => {
                      const firstNote = notesList[0] || null;
                      if (firstNote) open(firstNote);
                      else {
                        setSelected("");
                        setDraft(null);
                      }
                    }}
                    title="Discard new draft"
                  >
                    <Icon name="trash" size={13} />
                    <span>Discard</span>
                  </button>
                )}

                <span className="notes-action-sep" aria-hidden="true" />

                <button
                  type="button"
                  className="notes-action-pill solid-amber"
                  disabled={savingNote || deletingNote}
                  onClick={handleSave}
                >
                  {savingNote ? (
                    <>
                      <span className="btn-spinner" /> Saving…
                    </>
                  ) : (
                    <>
                      <Icon name="check" size={14} /> Save
                    </>
                  )}
                </button>
              </div>

              {/* Row 3: Prominent Document Title */}
              <div className="notes-reading-title-wrap">
                {viewMode === "preview" ? (
                  <h1 className="notes-reading-doc-title">
                    {draft.title || "Untitled note"}
                  </h1>
                ) : (
                  <input
                    className="notes-reading-doc-title-input"
                    value={draft.title}
                    onChange={e => setDraft({ ...draft, title: e.target.value })}
                    placeholder="Note title..."
                    aria-label="Note title"
                  />
                )}
              </div>

              {/* Row 4: Compact Metadata Row */}
              <div className="notes-reading-metadata-row">
                <span className="meta-point">
                  <Icon name="calendar" size={13} />
                  <span>
                    {prettyDate(draft.updated_at || draft.created_at || new Date().toISOString(), {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </span>
                <span className="meta-bullet">·</span>
                <span className="meta-point">
                  <Icon name="clock" size={13} />
                  <span>~ {readTimeMinutes} minutes</span>
                </span>
                {draft.updated_at && (
                  <>
                    <span className="meta-vertical-bar">|</span>
                    <span className="meta-point meta-faint">
                      Last edited {prettyDate(draft.updated_at, { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                  </>
                )}
              </div>

              {/* Minimal Markdown Toolbar in Edit Mode only */}
              {viewMode === "edit" && (
                <div className="notes-minimal-markdown-toolbar">
                  <button
                    type="button"
                    className="minimal-tool-btn"
                    title="Bold (**text**)"
                    onClick={() => insertMarkdown("**", "**", "bold")}
                  >
                    <Icon name="bold" size={12} />
                  </button>
                  <button
                    type="button"
                    className="minimal-tool-btn"
                    title="Italic (*text*)"
                    onClick={() => insertMarkdown("*", "*", "italic")}
                  >
                    <Icon name="italic" size={12} />
                  </button>
                  <span className="minimal-tool-sep" />
                  <button
                    type="button"
                    className="minimal-tool-btn text-xs font-bold"
                    title="Heading 2 (## Heading)"
                    onClick={() => insertMarkdown("## ", "", "Heading")}
                  >
                    H2
                  </button>
                  <button
                    type="button"
                    className="minimal-tool-btn text-xs font-bold"
                    title="Heading 3 (### Heading)"
                    onClick={() => insertMarkdown("### ", "", "Subheading")}
                  >
                    H3
                  </button>
                  <span className="minimal-tool-sep" />
                  <button
                    type="button"
                    className="minimal-tool-btn"
                    title="Bullet List (- item)"
                    onClick={() => insertMarkdown("- ", "", "Item")}
                  >
                    <Icon name="list" size={12} />
                  </button>
                  <button
                    type="button"
                    className="minimal-tool-btn"
                    title="Blockquote (> quote)"
                    onClick={() => insertMarkdown("> ", "", "Quote")}
                  >
                    <Icon name="quote" size={12} />
                  </button>
                  <button
                    type="button"
                    className="minimal-tool-btn"
                    title="Inline Code (`code`)"
                    onClick={() => insertMarkdown("`", "`", "code")}
                  >
                    <Icon name="code" size={12} />
                  </button>
                </div>
              )}

              {/* Reading Content or Writing Textarea */}
              {viewMode === "edit" ? (
                <div className="notes-minimal-textarea-wrap">
                  <textarea
                    className="notes-minimal-body-input"
                    value={draft.body}
                    onChange={e => setDraft({ ...draft, body: e.target.value })}
                    placeholder="Write your study notes here using Markdown..."
                    aria-label="Note body"
                  />
                </div>
              ) : (
                <article
                  className="notes-reading-prose"
                  dangerouslySetInnerHTML={{
                    __html:
                      parseMarkdownToHtml(draft.body) ||
                      "<p class='notes-reading-empty-copy'>No content written yet. Switch to Write to begin capturing notes.</p>",
                  }}
                />
              )}
            </div>
          ) : (
            /* Minimal Empty State when no note selected */
            <div className="notes-reading-welcome">
              <div className="notes-reading-welcome-orb">
                <Icon name="fileText" size={24} />
              </div>
              <h2 className="notes-reading-welcome-heading">Select a note or begin writing</h2>
              <p className="notes-reading-welcome-copy">
                Choose an existing study note from the left sidebar, or create a new document.
              </p>
              <button
                type="button"
                className="notes-new-action-btn large"
                onClick={() => startNew()}
              >
                <Icon name="plus" size={14} />
                <span>Create new note</span>
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export { NotesPage };
