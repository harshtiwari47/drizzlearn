import React, { useState, useEffect, useMemo, useDeferredValue } from "react";
import { Icon, parseMarkdownToHtml, prettyDate } from "../components/common.jsx";

function NotesPage(p) {
  const notesList = p.data?.notes || [];
  const [selected, setSelected] = useState(notesList[0]?.id || "");
  const [draft, setDraft] = useState(() => (notesList[0] ? { ...notesList[0] } : null));
  const [savingNote, setSavingNote] = useState(false);
  const [deletingNote, setDeletingNote] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCourse, setFilterCourse] = useState(() => p.routeQuery?.get?.("course") || "all");
  const deferredSearchQuery = useDeferredValue(searchQuery);

  // Default to preview mode when an existing note is selected/opened
  const [viewMode, setViewMode] = useState(() => (notesList[0] ? "preview" : "edit"));
  const [selectedCourseId, setSelectedCourseId] = useState(() => {
    const first = notesList[0];
    return first?.course_id || "";
  });
  const [sidebarOpen, setSidebarOpen] = useState(true);

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
    }
  }, [notesList, selected, allLessonsMap]);

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
    const textarea = document.querySelector(".note-body-input");
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
  const aiDraftCount = useMemo(() => notesList.filter(n => n.origin === "ai_draft").length, [notesList]);

  // Editor stats
  const wordCount = useMemo(() => {
    const text = (draft?.body || "").trim();
    return text ? text.split(/\s+/).length : 0;
  }, [draft?.body]);
  const readTimeMinutes = useMemo(() => Math.max(1, Math.ceil(wordCount / 200)), [wordCount]);

  return (
    <div className="notes-page-wrapper">
      {/* 1. Header Bar with Eyebrow, Title & Telemetry Chips */}
      <header className="notes-top-bar flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="notes-eyebrow">PERSONAL KNOWLEDGE BASE</span>
          <h1 className="notes-top-heading">Study Notes</h1>
          <p className="notes-top-subtext">
            Capture insights, organize lesson summaries, and synthesize concepts with markdown.
          </p>
        </div>

        <div className="notes-stats-row flex items-center gap-2 flex-wrap">
          <span className="notes-stat-pill">
            <Icon name="fileText" size={13} />
            <strong>{notesList.length}</strong> saved
          </span>
          <span className="notes-stat-pill">
            <Icon name="book" size={13} />
            <strong>{linkedCount}</strong> linked
          </span>
          {aiDraftCount > 0 && (
            <span className="notes-stat-pill ai-draft">
              <Icon name="spark" size={13} />
              <strong>{aiDraftCount}</strong> AI drafts
            </span>
          )}
        </div>
      </header>

      {/* 2. Workspace Grid Layout: Sidebar & Main Editor */}
      <div className={`notes-workspace-grid ${sidebarOpen ? "sidebar-open" : "sidebar-closed"}`}>
        {/* Left Sidebar: Note Library */}
        {sidebarOpen && (
          <aside className="notes-sidebar-glass">
            <div className="notes-sidebar-head">
              <div className="sidebar-title-row">
                <span className="sidebar-icon-box" aria-hidden="true">
                  <Icon name="notes" size={15} />
                </span>
                <span className="sidebar-title">All Notes</span>
                <span className="sidebar-count-badge">{notesList.length}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="notes-new-btn"
                  onClick={() => startNew()}
                  title="Create new note"
                >
                  <Icon name="plus" size={13} />
                  <span>New</span>
                </button>
                <button
                  type="button"
                  className="notes-sidebar-toggle-btn"
                  onClick={() => setSidebarOpen(false)}
                  aria-label="Collapse notes sidebar"
                  title="Collapse sidebar"
                >
                  <Icon name="chevronLeft" size={15} />
                </button>
              </div>
            </div>

            {/* Filter and Search Bar */}
            <div className="notes-sidebar-filters">
              <div className="notes-search-field">
                <Icon name="search" size={13} />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search in notes…"
                  aria-label="Search notes"
                  className="notes-search-input"
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="notes-clear-search-btn"
                    onClick={() => setSearchQuery("")}
                    aria-label="Clear search"
                  >
                    ×
                  </button>
                )}
              </div>

              {allCourses.length > 0 && (
                <div className="notes-filter-select-wrap">
                  <select
                    value={filterCourse}
                    onChange={e => setFilterCourse(e.target.value)}
                    aria-label="Filter notes by course"
                    className="notes-filter-dropdown"
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
            </div>

            {/* Scrollable Note Items */}
            <div className="notes-list-scroll">
              {notesList.length === 0 ? (
                <div className="notes-empty-sidebar-box">
                  <div className="empty-sidebar-orb">
                    <Icon name="fileText" size={18} />
                  </div>
                  <p>No notes saved yet.</p>
                  <button
                    type="button"
                    className="notes-quick-create-btn"
                    onClick={() => startNew()}
                  >
                    Create your first note ↗
                  </button>
                </div>
              ) : filteredNotes.length === 0 ? (
                <div className="notes-no-match-box">
                  <p>No notes match your filter.</p>
                  <button
                    type="button"
                    className="notes-reset-filter-btn"
                    onClick={() => {
                      setSearchQuery("");
                      setFilterCourse("all");
                    }}
                  >
                    Clear filter ↺
                  </button>
                </div>
              ) : (
                filteredNotes.map(n => {
                  const isSelected = selected === n.id;
                  const snippet = (n.body || "").replace(/#+\s|`+|\*+|_+/g, "").slice(0, 75);
                  return (
                    <button
                      key={n.id}
                      type="button"
                      className={`note-list-card ${isSelected ? "active" : ""}`}
                      onClick={() => open(n)}
                      aria-label={`Open note: ${n.title || "Untitled"}`}
                    >
                      <div className="note-card-title-row">
                        <strong className="note-card-title">{n.title || "Untitled note"}</strong>
                        <div className="flex items-center gap-1">
                          {n.origin === "ai_draft" && (
                            <span className="note-card-badge ai" title="Drafted by AI">
                              <Icon name="spark" size={9} /> AI DRAFT
                            </span>
                          )}
                          {n.origin === "roadmap" && (
                            <span className="note-card-badge roadmap" title="From roadmap">
                              <Icon name="spark" size={9} /> ROADMAP
                            </span>
                          )}
                          <button
                            type="button"
                            className="note-card-trash-btn"
                            onClick={e => {
                              e.stopPropagation();
                              handleDelete(n.id, n.title);
                            }}
                            title="Delete this note"
                            aria-label={`Delete note ${n.title || "Untitled"}`}
                          >
                            <Icon name="trash" size={11} />
                          </button>
                        </div>
                      </div>

                      {snippet && <p className="note-card-snippet">{snippet}…</p>}

                      <div className="note-card-meta-row">
                        <span className="note-card-source">
                          {n.lesson_title || n.source_ref || "Personal note"}
                        </span>
                        <span className="note-card-date">
                          {prettyDate(n.updated_at, { month: "short", day: "numeric" })}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </aside>
        )}

        {/* Right Area: Note Editor / Preview */}
        <section className="notes-editor-glass">
          {!sidebarOpen && (
            <div className="notes-collapsed-banner">
              <button
                type="button"
                className="notes-expand-trigger-btn"
                onClick={() => setSidebarOpen(true)}
              >
                <Icon name="chevronRight" size={14} />
                <span>Show all notes ({notesList.length})</span>
              </button>
              <button
                type="button"
                className="notes-new-btn compact"
                onClick={() => startNew()}
              >
                <Icon name="plus" size={13} />
                <span>New note</span>
              </button>
            </div>
          )}

          {draft ? (
            <div className="notes-active-editor-flow flex flex-col gap-4">
              {/* Top Controls: Tagging & Actions */}
              <div className="note-editor-topbar">
                {/* Left: Course & Lesson Tagging Selectors */}
                <div className="note-tagging-group">
                  <div className="note-tag-selector">
                    <span className="tag-icon" aria-hidden="true">
                      <Icon name="book" size={13} />
                    </span>
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
                      className="note-header-select"
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
                    <div className="note-tag-selector animate-fadeIn">
                      <span className="tag-icon" aria-hidden="true">
                        <Icon name="tag" size={13} />
                      </span>
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
                        className="note-header-select"
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

                  {(draft.origin === "ai_draft" || draft.origin === "roadmap") && (
                    <span className="note-header-badge">
                      <Icon name="spark" size={11} />
                      {draft.origin === "ai_draft" ? "AI DRAFT" : "ROADMAP"}
                    </span>
                  )}
                </div>

                {/* Right: View Toggle, Delete & Save */}
                <div className="note-actions-group">
                  <div className="note-view-toggle-pill" role="tablist">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={viewMode === "preview"}
                      className={`view-pill-btn ${viewMode === "preview" ? "active" : ""}`}
                      onClick={() => setViewMode("preview")}
                    >
                      <Icon name="eye" size={13} />
                      <span>Preview</span>
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={viewMode === "edit"}
                      className={`view-pill-btn ${viewMode === "edit" ? "active" : ""}`}
                      onClick={() => setViewMode("edit")}
                    >
                      <Icon name="edit" size={13} />
                      <span>Write</span>
                    </button>
                  </div>

                  {draft.id ? (
                    <button
                      type="button"
                      className="note-danger-btn"
                      disabled={deletingNote || savingNote}
                      onClick={() => handleDelete()}
                      title="Delete note"
                    >
                      {deletingNote ? <span className="btn-spinner" /> : <Icon name="trash" size={14} />}
                      <span>Delete</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="note-danger-btn"
                      onClick={() => {
                        const firstNote = notesList[0] || null;
                        if (firstNote) {
                          open(firstNote);
                        } else {
                          setSelected("");
                          setDraft(null);
                        }
                      }}
                      title="Discard new draft"
                    >
                      <Icon name="trash" size={14} />
                      <span>Discard</span>
                    </button>
                  )}

                  <button
                    type="button"
                    className="note-primary-save-btn"
                    disabled={savingNote || deletingNote}
                    onClick={handleSave}
                  >
                    {savingNote ? (
                      <>
                        <span className="btn-spinner" /> Saving…
                      </>
                    ) : (
                      <>
                        <Icon name="check" size={14} /> Save note
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Note Title Input */}
              <div className="note-title-wrap">
                <input
                  className="note-headline-input"
                  value={draft.title}
                  onChange={e => setDraft({ ...draft, title: e.target.value })}
                  placeholder="Untitled study note…"
                  aria-label="Note title"
                />
              </div>

              {/* Metadata strip: Word Count & Read Time */}
              <div className="note-meta-strip">
                <span className="meta-item">
                  <Icon name="fileText" size={12} />
                  <span>{wordCount} words</span>
                </span>
                <span className="meta-sep">·</span>
                <span className="meta-item">
                  <Icon name="clock" size={12} />
                  <span>~{readTimeMinutes} min read</span>
                </span>
                {draft.updated_at && (
                  <>
                    <span className="meta-sep">·</span>
                    <span className="meta-item text-slate-500">
                      Last edited {prettyDate(draft.updated_at, { month: "short", day: "numeric" })}
                    </span>
                  </>
                )}
              </div>

              {/* Markdown Toolbar in Edit Mode */}
              {viewMode === "edit" && (
                <div className="notes-markdown-toolbar">
                  <button
                    type="button"
                    className="toolbar-btn"
                    title="Bold (**text**)"
                    onClick={() => insertMarkdown("**", "**", "bold")}
                  >
                    <Icon name="bold" size={13} />
                  </button>
                  <button
                    type="button"
                    className="toolbar-btn"
                    title="Italic (*text*)"
                    onClick={() => insertMarkdown("*", "*", "italic")}
                  >
                    <Icon name="italic" size={13} />
                  </button>
                  <span className="toolbar-sep" />
                  <button
                    type="button"
                    className="toolbar-btn text-xs font-bold"
                    title="Heading 1 (# Heading)"
                    onClick={() => insertMarkdown("# ", "", "Heading 1")}
                  >
                    H1
                  </button>
                  <button
                    type="button"
                    className="toolbar-btn text-xs font-bold"
                    title="Heading 2 (## Heading)"
                    onClick={() => insertMarkdown("## ", "", "Heading 2")}
                  >
                    H2
                  </button>
                  <button
                    type="button"
                    className="toolbar-btn text-xs font-bold"
                    title="Heading 3 (### Heading)"
                    onClick={() => insertMarkdown("### ", "", "Heading 3")}
                  >
                    H3
                  </button>
                  <span className="toolbar-sep" />
                  <button
                    type="button"
                    className="toolbar-btn"
                    title="Bullet List (- item)"
                    onClick={() => insertMarkdown("- ", "", "List item")}
                  >
                    <Icon name="list" size={13} />
                  </button>
                  <button
                    type="button"
                    className="toolbar-btn"
                    title="Numbered List (1. item)"
                    onClick={() => insertMarkdown("1. ", "", "Numbered item")}
                  >
                    <span className="text-[11px] font-bold">1.</span>
                  </button>
                  <button
                    type="button"
                    className="toolbar-btn"
                    title="Blockquote (> quote)"
                    onClick={() => insertMarkdown("> ", "", "Quote")}
                  >
                    <Icon name="quote" size={13} />
                  </button>
                  <button
                    type="button"
                    className="toolbar-btn"
                    title="Inline Code (`code`)"
                    onClick={() => insertMarkdown("`", "`", "code")}
                  >
                    <Icon name="code" size={13} />
                  </button>
                  <button
                    type="button"
                    className="toolbar-btn text-xs"
                    title="Code Block (```)"
                    onClick={() => insertMarkdown("```\n", "\n```", "code here")}
                  >
                    <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-white/5">```</span>
                  </button>
                </div>
              )}

              {/* Editor Writing Area vs Markdown Preview */}
              {viewMode === "edit" ? (
                <div className="note-textarea-wrap">
                  <textarea
                    className="note-body-input"
                    value={draft.body}
                    onChange={e => setDraft({ ...draft, body: e.target.value })}
                    placeholder="Write down the concept in your own words using Markdown (headings, lists, code blocks)…"
                    aria-label="Note body"
                  />
                </div>
              ) : (
                <div
                  className="note-markdown-preview reading-copy"
                  dangerouslySetInnerHTML={{
                    __html:
                      parseMarkdownToHtml(draft.body) ||
                      "<p class='text-slate-500 italic'>No content written yet. Switch to Write mode to begin capturing notes.</p>",
                  }}
                />
              )}
            </div>
          ) : (
            /* Welcoming Empty State */
            <div className="notes-welcome-empty-state">
              <div className="welcome-empty-orb">
                <Icon name="notes" size={28} />
              </div>
              <h2 className="welcome-empty-title">Choose a note or write a fresh idea</h2>
              <p className="welcome-empty-copy">
                Select an existing note from the library, or start with one of the structured study templates below.
              </p>

              <div className="notes-templates-grid">
                <button
                  type="button"
                  className="template-card"
                  onClick={() =>
                    startNew(
                      "Lesson Summary & Insights",
                      "## Key Takeaways\n- Main concept:\n- Why it matters:\n\n## Core Principles\n1. \n2. \n\n## Follow-up Questions\n- [ ] "
                    )
                  }
                >
                  <span className="template-icon">
                    <Icon name="fileText" size={16} />
                  </span>
                  <div className="template-info">
                    <strong>Lesson Summary</strong>
                    <span>Key takeaways and follow-up items</span>
                  </div>
                </button>

                <button
                  type="button"
                  className="template-card"
                  onClick={() =>
                    startNew(
                      "Concept Deep Dive & Formulas",
                      "## Definition & Formulation\n`Formula / Theorem`\n\n## Practical Application\n> Example:\n\n## Common Pitfalls\n- Avoid: "
                    )
                  }
                >
                  <span className="template-icon">
                    <Icon name="code" size={16} />
                  </span>
                  <div className="template-info">
                    <strong>Concept & Formulas</strong>
                    <span>Equations, applications & pitfalls</span>
                  </div>
                </button>

                <button
                  type="button"
                  className="template-card"
                  onClick={() =>
                    startNew(
                      "Spaced Repetition Questions",
                      "## Self-Test Questions\nQ1: \nA1: \n\nQ2: \nA2: \n\n## Memory Hooks & Mnemonics\n- "
                    )
                  }
                >
                  <span className="template-icon">
                    <Icon name="cards" size={16} />
                  </span>
                  <div className="template-info">
                    <strong>SRS Self-Testing</strong>
                    <span>Q&A pairs and memory hooks</span>
                  </div>
                </button>
              </div>

              <button
                type="button"
                className="notes-create-cta-btn"
                onClick={() => startNew()}
              >
                <Icon name="plus" size={15} />
                <span>Create Blank Note ↗</span>
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export { NotesPage };
