import React, { useState, useEffect } from "react";
import { Icon, minuteLabel } from "../components/common.jsx";
import { TutorMarkdown } from "../tutor-markdown.jsx";

const LESSON_DEPTH_STORAGE_KEY = "learnos.lesson_depth.v1";

/**
 * Sanitize internal UUID citations (e.g., (lesson:uuid), [lesson:uuid], (note:uuid))
 * so raw database IDs do not pollute learner reading prose.
 */
export function sanitizeLessonReading(raw) {
  if (!raw) return "";
  return String(raw)
    .replace(/\s*[\(\[]\s*(?:lesson|note|attempt|flashcard):[a-f0-9-]+\s*[\)\]]/gi, "")
    .replace(/ {2,}/g, " ")
    .trim();
}

export function readStoredDepths(lessonId) {
  if (!lessonId || typeof window === "undefined" || typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(LESSON_DEPTH_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === "object" && parsed[lessonId]) || {};
  } catch {
    return {};
  }
}

export function writeStoredDepth(lessonId, depthKey, content) {
  if (!lessonId || !depthKey || typeof window === "undefined" || typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(LESSON_DEPTH_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed[lessonId]) parsed[lessonId] = {};
    parsed[lessonId][depthKey] = content;
    localStorage.setItem(LESSON_DEPTH_STORAGE_KEY, JSON.stringify(parsed));
  } catch {}
}

export function clearStoredDepth(lessonId, depthKey) {
  if (!lessonId || !depthKey || typeof window === "undefined" || typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(LESSON_DEPTH_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && parsed[lessonId]) {
      delete parsed[lessonId][depthKey];
      localStorage.setItem(LESSON_DEPTH_STORAGE_KEY, JSON.stringify(parsed));
    }
  } catch {}
}

export function LessonPage(p) {
  const lesson = p.activeLesson;
  const [selected, setSelected] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [saving, setSaving] = useState(false);
  const [depth, setDepth] = useState("standard");
  const [tailored, setTailored] = useState(() => readStoredDepths(lesson?.id));
  const [loadingDepth, setLoadingDepth] = useState(false);

  useEffect(() => {
    setSelected(null);
    setFeedback(null);
    setDepth("standard");
    setTailored(readStoredDepths(lesson?.id));
    setLoadingDepth(false);
  }, [lesson?.id]);

  if (!lesson) {
    return (
      <div className="lesson-empty-wrapper">
        <div className="lesson-empty-card">
          <div className="lesson-empty-icon">
            <Icon name="book" size={24} />
          </div>
          <h2>Choose a lesson to begin</h2>
          <p>Open a course roadmap or choose a lesson from today’s schedule.</p>
          <button type="button" className="lesson-primary-btn" onClick={() => p.go("courses")}>
            View courses
          </button>
        </div>
      </div>
    );
  }

  const checkpoint = lesson.checkpoint || {};
  const paragraphs = String(
    lesson.content_markdown ||
      lesson.content ||
      "Start with the objective, then connect the key idea to a small example. Check your understanding before moving on."
  ).split(/\n\n+/);
  const all = p.lessons || [];
  const at = all.findIndex(l => l.id === lesson.id);
  const previous = all[at - 1];
  const next = all[at + 1];

  const answer = async () => {
    if (selected === null) return;
    p.setActiveLessonId(lesson.id);
    setSaving(true);
    const result = await p.submitCheckpoint(selected);
    setFeedback(result);
    setSaving(false);
  };

  const handleDepthChange = async (newDepth, force = false) => {
    setDepth(newDepth);
    if (newDepth === "standard") return;

    const stored = readStoredDepths(lesson.id);
    const existingContent = !force ? (tailored[newDepth] || stored[newDepth]) : null;
    if (existingContent) {
      if (!tailored[newDepth]) {
        setTailored(prev => ({ ...prev, [newDepth]: existingContent }));
      }
      return;
    }

    if (force) {
      clearStoredDepth(lesson.id, newDepth);
      setTailored(prev => {
        const nextState = { ...prev };
        delete nextState[newDepth];
        return nextState;
      });
    }

    const courseTitle = p.activeCourse?.title || "";
    if (p.remote) {
      setLoadingDepth(true);
      const promptText =
        newDepth === "simpler"
          ? `Explain "${lesson.title}" (${lesson.objective}) from the course "${courseTitle}" in simpler terms using a natural, human everyday analogy (such as everyday conversations, cooking, storytelling, or daily habits). Break down the core intuition so it is easy to visualize and grasp immediately. Match the natural communicative nature of ${courseTitle}, do NOT use mechanical, computer, or programming analogies, and do NOT include lesson IDs, topic IDs, or bracketed codes.`
          : `Provide an in-depth, thorough breakdown of "${lesson.title}" (${lesson.objective}) from the course "${courseTitle}". Explore core concepts, subtle nuances, common misconceptions or pitfalls, and practical real-world applications. Ensure your explanation is fully completed, tailored to the subject domain of ${courseTitle}, contains zero computer/programming code or system architecture analogies, and does NOT include lesson IDs, topic IDs, or bracketed codes.`;

      try {
        const reply = await p.sendTutor({
          mode: "Explain",
          prompt: promptText,
          lessonId: lesson.id,
          courseId: p.activeCourse?.id,
        });
        const text = typeof reply === "string" ? reply : reply?.text;
        if (text) {
          setTailored(prev => ({ ...prev, [newDepth]: text }));
          writeStoredDepth(lesson.id, newDepth, text);
        }
      } catch (err) {
        p.flashToast?.(err?.message || "Could not generate explanation.");
      } finally {
        setLoadingDepth(false);
      }
    } else {
      const localAnalogy =
        newDepth === "simpler"
          ? `Intuitive Analogy for ${lesson.title}:\nThink of this concept like an everyday routine within ${courseTitle}: ${lesson.objective}. Before worrying about intricate rules, imagine the natural flow and why each element connects logically to the next.`
          : `Deep Dive into ${lesson.title}:\nExploring ${lesson.objective} in depth: Notice how the core principles coordinate, what edge cases or subtleties arise in real-world application, and how this bridges to advanced fluency in ${courseTitle}.`;
      setTailored(prev => ({ ...prev, [newDepth]: localAnalogy }));
      writeStoredDepth(lesson.id, newDepth, localAnalogy);
    }
  };

  const currentMarkdownContent = sanitizeLessonReading(
    depth === "simpler"
      ? (tailored.simpler || "")
      : depth === "deep"
      ? (tailored.deep || "")
      : (lesson.content_markdown || lesson.content || paragraphs.join("\n\n"))
  );

  return (
    <div className="lesson-workspace-page">
      {/* 1. Header & Navigation Breadcrumb Bar (Full Page Width) */}
      <header className="lesson-top-bar">
        <div className="lesson-top-left">
          <button
            type="button"
            className="lesson-circle-back-btn"
            onClick={() => p.go("course", { params: { courseId: p.activeCourse?.id } })}
            title="Back to Course roadmap"
            aria-label="Back to Course roadmap"
          >
            <Icon name="arrowLeft" size={16} />
          </button>
          <div className="lesson-breadcrumb-trail">
            <span
              className="lesson-course-name"
              onClick={() => p.go("course", { params: { courseId: p.activeCourse?.id } })}
              role="button"
              tabIndex={0}
              title="View course roadmap"
            >
              {p.activeCourse?.title || "Course Roadmap"}
            </span>
            <span className="lesson-crumb-slash">/</span>
            <span className="lesson-module-name">{lesson.moduleTitle || "Module"}</span>
          </div>
        </div>

        <div className="lesson-top-actions">
          <button
            type="button"
            className="lesson-tool-pill tool-notes"
            onClick={() => p.draftNote(lesson.id)}
            title="Draft lesson notes"
          >
            <Icon name="fileText" size={13} />
            <span>Notes</span>
          </button>
          <button
            type="button"
            className="lesson-tool-pill tool-flashcard"
            onClick={() =>
              p.addFlashcard({
                front: `What is the key idea in "${lesson.title}"?`,
                back: lesson.objective,
                lessonId: lesson.id,
                courseId: p.activeCourse?.id,
              })
            }
            title="Make flashcard"
          >
            <Icon name="cards" size={13} />
            <span>Flashcard</span>
          </button>
          <button
            type="button"
            className="lesson-tool-pill tool-practice"
            onClick={() => p.go("practice", { params: { lessonId: lesson.id } })}
            title="Practice Studio"
          >
            <Icon name="practice" size={13} />
            <span>Practice</span>
          </button>
          <button
            type="button"
            className="lesson-tool-pill tool-tutor"
            onClick={() => p.go("tutor")}
            title="Ask AI Tutor"
          >
            <Icon name="spark" size={13} />
            <span>Ask Tutor</span>
          </button>
        </div>
      </header>

      {/* 2. Main Full-Width Content Grid */}
      <div className="lesson-main-grid">
        {/* Left Column: Reading Canvas */}
        <main className="lesson-reading-column">
          {/* Title & Metadata Strip with Designed Bottom Borders */}
          <div className="lesson-header-section">
            <div className="lesson-meta-strip">
              <span className="lesson-meta-item module-item">{lesson.moduleTitle}</span>
              <span className="lesson-meta-item duration-item">
                <Icon name="clock" size={12} />
                <span>{minuteLabel(lesson.estimated_minutes || 25)}</span>
              </span>
              <span className="lesson-meta-item count-item">
                Lesson {at + 1} of {all.length}
              </span>
              {feedback?.correct && (
                <span className="lesson-meta-item passed-item">
                  <Icon name="check" size={12} /> Checkpoint passed
                </span>
              )}
            </div>

            <h1 className="lesson-page-title">{lesson.title}</h1>

            {/* Clean Learning Objective (Warm lead callout quote) */}
            {lesson.objective && (
              <div className="lesson-lead-objective">
                <p>{sanitizeLessonReading(lesson.objective)}</p>
              </div>
            )}

            {/* Explanation Depth Selector */}
            <div className="lesson-depth-control-row">
              <span className="lesson-depth-caption">Explanation depth:</span>
              <div className="lesson-depth-pill-group" role="group" aria-label="Explanation depth">
                <button
                  type="button"
                  aria-pressed={depth === "standard"}
                  className={`lesson-depth-btn ${depth === "standard" ? "active" : ""}`}
                  onClick={() => handleDepthChange("standard")}
                >
                  Standard
                </button>
                <button
                  type="button"
                  aria-pressed={depth === "simpler"}
                  className={`lesson-depth-btn ${depth === "simpler" ? "active" : ""}`}
                  onClick={() => handleDepthChange("simpler")}
                >
                  <Icon name="spark" size={12} />
                  <span>Simpler (with analogy)</span>
                </button>
                <button
                  type="button"
                  aria-pressed={depth === "deep"}
                  className={`lesson-depth-btn ${depth === "deep" ? "active" : ""}`}
                  onClick={() => handleDepthChange("deep")}
                >
                  <Icon name="spark" size={12} />
                  <span>Deep dive</span>
                </button>
              </div>
              {depth !== "standard" && (
                <button
                  type="button"
                  className="lesson-depth-refresh-btn"
                  disabled={loadingDepth}
                  onClick={() => handleDepthChange(depth, true)}
                  title="Regenerate explanation"
                >
                  ↻ Regenerate
                </button>
              )}
            </div>
          </div>

          {/* Reading Content */}
          <article className="lesson-content-body">
            {loadingDepth ? (
              <div className="lesson-loading-state">
                <span className="btn-spinner" />
                <span>
                  {depth === "simpler"
                    ? "Consulting AI tutor for an intuitive analogy and simpler breakdown…"
                    : "Consulting AI tutor for deep dive and edge cases…"}
                </span>
              </div>
            ) : (
              <div className="lesson-markdown-wrap">
                {depth === "simpler" && (
                  <div className="lesson-depth-banner simpler">
                    <Icon name="spark" size={14} />
                    <span>Simpler explanation (with everyday analogy)</span>
                  </div>
                )}
                {depth === "deep" && (
                  <div className="lesson-depth-banner deep">
                    <Icon name="spark" size={14} />
                    <span>Deep dive breakdown & edge cases</span>
                  </div>
                )}
                <TutorMarkdown content={currentMarkdownContent} />
              </div>
            )}
          </article>

          {/* Worked Example (if available) */}
          {(lesson.worked_example || lesson.workedExample) && (
            <section className="lesson-example-card">
              <div className="example-badge">
                <Icon name="spark" size={14} />
                <span>Worked example</span>
              </div>
              <div className="example-text lesson-example-content">
                <TutorMarkdown content={sanitizeLessonReading(lesson.worked_example || lesson.workedExample)} />
              </div>
            </section>
          )}

          {/* Clean Understanding Checkpoint (No unnecessary labels or helper text) */}
          <section className="lesson-checkpoint-card">
            <h2 className="checkpoint-question">
              {checkpoint.question || "Explain the main idea in your own words."}
            </h2>

            {checkpoint.options?.length ? (
              <div className="checkpoint-options-grid">
                {checkpoint.options.map((option, i) => {
                  const isSelected = selected === i;
                  const isCorrect = feedback?.correct && i === checkpoint.answerIndex;
                  const isIncorrect = feedback && !feedback.correct && isSelected;
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`checkpoint-choice-btn ${isSelected ? "selected" : ""} ${isCorrect ? "correct" : ""} ${isIncorrect ? "incorrect" : ""}`}
                      onClick={() => {
                        setSelected(i);
                        setFeedback(null);
                      }}
                    >
                      <span className="choice-letter">{String.fromCharCode(65 + i)}</span>
                      <span className="choice-text">{option}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <textarea
                className="checkpoint-textarea"
                value={selected || ""}
                onChange={e => setSelected(e.target.value)}
                placeholder="Write your explanation in your own words…"
                rows={4}
              />
            )}

            {feedback && (
              <div className={`checkpoint-feedback ${feedback.correct ? "feedback-passed" : "feedback-retry"}`} role="status">
                <Icon name={feedback.correct ? "check" : "alert"} size={16} />
                <div className="feedback-content">
                  <strong>{feedback.correct ? "Checkpoint passed" : "Review the concept"}</strong>
                  <p>{feedback.explanation}</p>
                </div>
              </div>
            )}

            <div className="checkpoint-footer">
              <button
                type="button"
                className="checkpoint-submit-action"
                disabled={selected === null || saving}
                onClick={answer}
              >
                {saving ? (
                  <>
                    <span className="btn-spinner" /> Checking…
                  </>
                ) : feedback?.correct ? (
                  <>Passed ✓</>
                ) : (
                  <>Check understanding</>
                )}
              </button>
            </div>
          </section>

          {/* Bottom Lesson Navigation */}
          <nav className="lesson-bottom-nav-bar" aria-label="Lesson navigation">
            <button
              type="button"
              className="lesson-nav-card prev"
              disabled={!previous}
              onClick={() => previous && p.openLesson(previous.id)}
            >
              <Icon name="chevronLeft" size={16} />
              <div className="nav-card-info">
                <span className="nav-card-sub">Previous Lesson</span>
                <span className="nav-card-name">{previous?.title || "Start of course"}</span>
              </div>
            </button>

            <button
              type="button"
              className="lesson-nav-card next"
              disabled={!next}
              onClick={() => (next ? p.openLesson(next.id) : p.go("course", { params: { courseId: p.activeCourse?.id } }))}
            >
              <div className="nav-card-info right">
                <span className="nav-card-sub">{next ? "Next Lesson" : "Course Milestone"}</span>
                <span className="nav-card-name">{next?.title || "Back to course roadmap"}</span>
              </div>
              <Icon name="chevronRight" size={16} />
            </button>
          </nav>
        </main>

        {/* Right Column: Sleek Course Outline / Index */}
        <aside className="lesson-curriculum-rail">
          <div className="curriculum-rail-card">
            <div className="curriculum-rail-header">
              <div className="rail-header-title">
                <Icon name="book" size={14} />
                <span>Course Outline</span>
              </div>
              <span className="rail-header-badge">{all.length} lessons</span>
            </div>

            <div className="curriculum-rail-scroll">
              {p.activeCourse?.modules?.map((m, mIdx) => (
                <div key={m.id || mIdx} className="curriculum-module-section">
                  <div className="module-title-row">
                    <span className="module-number">{mIdx + 1}</span>
                    <span className="module-title-text">{m.title}</span>
                  </div>
                  <div className="module-lessons-group">
                    {m.lessons?.map(l => {
                      const isActive = l.id === lesson.id;
                      return (
                        <button
                          key={l.id}
                          type="button"
                          className={`rail-lesson-row ${isActive ? "active-lesson" : ""}`}
                          onClick={() => p.openLesson(l.id)}
                        >
                          <span className="lesson-indicator-dot">{isActive ? "▶" : "•"}</span>
                          <span className="rail-lesson-title">{l.title}</span>
                          {l.estimated_minutes && (
                            <span className="rail-lesson-duration">{l.estimated_minutes}m</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
