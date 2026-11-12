import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  formatReviewIntervalLabel,
  previewFlashcardIntervals,
  scheduleFlashcardReview,
} from "../src/srs.js";
import { normalizeGeneratedFlashcards } from "../server/ai.js";

let vite;
let App;
let TutorMarkdown;
let FlashcardPortalModal;

const storage = new Map();

before(async () => {
  globalThis.localStorage = {
    getItem: (k) => storage.get(k) || null,
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  };
  globalThis.sessionStorage = {
    getItem: (k) => storage.get(`s:${k}`) || null,
    setItem: (k, v) => storage.set(`s:${k}`, String(v)),
    removeItem: (k) => storage.delete(`s:${k}`),
  };
  vite = await createServer({
    configFile: "./vite.config.js",
    logLevel: "silent",
    server: { middlewareMode: true },
    appType: "custom",
  });
  ({ default: App } = await vite.ssrLoadModule("/src/App.jsx"));
  ({ TutorMarkdown } = await vite.ssrLoadModule("/src/tutor-markdown.jsx"));
  ({ FlashcardPortalModal } = await vite.ssrLoadModule("/src/flashcard-portal.jsx"));
});

after(async () => {
  await vite?.close();
  delete globalThis.window;
  delete globalThis.localStorage;
  delete globalThis.sessionStorage;
});

describe("Evidence-based Spaced Repetition Scheduler (src/srs.js)", () => {
  test("schedules new/learning cards through cognitive steps and previews intervals cleanly", () => {
    const now = new Date("2026-11-12T10:00:00.000Z");
    const newCard = { interval_days: 0, ease: 2.5, repetitions: 0, lapses: 0, state: "new" };

    const again = scheduleFlashcardReview(newCard, "Again", now);
    assert.equal(again.interval_days, 0);
    assert.equal(again.state, "learning");
    assert.equal(again.lapses, 0);
    assert.equal(formatReviewIntervalLabel(again.interval_days, again.due_at, now), "10m");

    const hard = scheduleFlashcardReview(newCard, "Hard", now);
    assert.equal(hard.interval_days, 0);
    assert.equal(formatReviewIntervalLabel(hard.interval_days, hard.due_at, now), "12h");

    const good = scheduleFlashcardReview(newCard, "Good", now);
    assert.equal(good.interval_days, 1);
    assert.equal(good.state, "learning");

    const easy = scheduleFlashcardReview(newCard, "Easy", now);
    assert.equal(easy.interval_days, 4);
    assert.equal(easy.state, "review");

    const previews = previewFlashcardIntervals(newCard, now);
    assert.deepEqual(previews, { Again: "10m", Hard: "12h", Good: "1d", Easy: "4d" });
  });

  test("tracks lapses, flags leeches on graduated cards, and preserves test compatibility", () => {
    const now = new Date("2026-11-12T10:00:00.000Z");
    const legacyCard = { interval_days: 2, ease: 2.5, repetitions: 0, lapses: 0 };
    const good = scheduleFlashcardReview(legacyCard, "Good", now);
    assert.equal(good.interval_days, 4);
    assert.equal(good.state, "review");

    const lapsed = scheduleFlashcardReview({ interval_days: 10, ease: 2.4, repetitions: 4, lapses: 5, state: "review" }, "Again", now);
    assert.equal(lapsed.interval_days, 0);
    assert.equal(lapsed.state, "relearning");
    assert.equal(lapsed.lapses, 6);
    assert.equal(lapsed.is_leech, true);
  });
});

describe("Pure-React Markdown Math Formulas & Bounded Image Rendering", () => {
  test("renders inline and block LaTeX formulas while keeping currency literal and blocking unsafe image URLs", () => {
    const md = [
      "Solve $E = mc^2$ and pay \\$50 cleanly (not $5 to $10).",
      "",
      "$$",
      "P(H \\mid E) = \\frac{P(E \\mid H) P(H)}{\\sqrt{P(E)}}",
      "$$",
      "",
      "![Bayes Tree|320x200](https://example.com/bayes.png)",
      "",
      "![Bad Image](javascript:alert(1))",
    ].join("\n");

    const html = renderToStaticMarkup(React.createElement(TutorMarkdown, { content: md }));
    assert.match(html, /class="tutor-math-inline"/);
    assert.match(html, /class="tutor-math-block"/);
    assert.match(html, /class="tutor-math-frac"/);
    assert.match(html, /class="tutor-math-sqrt"/);
    assert.ok(html.includes("$50"));
    assert.ok(html.includes("$5 to $10"));
    assert.match(html, /class="tutor-md-figure"/);
    assert.match(html, /class="tutor-md-img"/);
    assert.match(html, /max-width:320px;max-height:200px/);
    assert.doesNotMatch(html, /javascript:/i);
    assert.match(html, /class="tutor-md-img-blocked"/);
  });
});

describe("AI Flashcard Generation Normalization", () => {
  test("normalizes valid cards, preserves hints and cardTypes, and deduplicates against existingFronts", () => {
    const out = normalizeGeneratedFlashcards(
      {
        flashcards: [
          { front: "Existing question?", back: "Old answer", cardType: "qa" },
          { front: "Why use $O(n \\log n)$ sort?", back: "Optimal comparison bound.", hint: "Think decision tree", cardType: "formula" },
          { front: "Missing back", back: "" },
        ],
      },
      ["existing question?"]
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].cardType, "formula");
    assert.equal(out[0].hint, "Think decision tree");
    assert.equal(out[0].origin, "ai_generated");
  });
});

describe("FlashcardsPage & FlashcardPortalModal UI", () => {
  test("displays QUESTION on front face, empty Due later guidance, proper Review lesson pill, and deck management", async () => {
    storage.clear();
    storage.set(
      "learnos.local.v2",
      JSON.stringify({
        courses: [
          {
            id: "c1",
            title: "Linear Algebra",
            status: "active",
            modules: [
              { id: "m1", title: "Vectors", lessons: [{ id: "l1", title: "Dot Product", objective: "Compute angles" }] },
            ],
          },
        ],
        activeCourseId: "c1",
        goals: [],
        tasks: [],
        notes: [],
        flashcards: [
          {
            id: "card-1",
            course_id: "c1",
            lesson_id: "l1",
            front: "What is $a \\cdot b$ for orthogonal vectors?",
            back: "$$a \\cdot b = 0$$",
            hint: "Recall $\\cos(90^\\circ)$",
            card_type: "formula",
            origin: "ai_generated",
            due_at: "2025-01-01T00:00:00Z",
          },
        ],
        attempts: [],
        settings: {},
      })
    );

    globalThis.window = {
      location: { pathname: "/flashcards", search: "", hash: "" },
      addEventListener() {},
      removeEventListener() {},
    };
    const html = renderToStaticMarkup(React.createElement(App));
    assert.match(html, /class="flashcard-label">QUESTION<\/span>/);
    assert.doesNotMatch(html, /class="flashcard-label">PROMPT<\/span>/);
    assert.match(html, /class="tutor-math-inline"/);
    assert.match(html, /Show hint/);
    assert.match(html, /AI✦/);
    assert.match(html, /<button[^>]*class="flashcard-source-link"/);
    assert.match(html, /Review lesson:/);
    assert.match(html, /Dot Product/);
    assert.match(html, /No upcoming cards scheduled yet\./);
    assert.doesNotMatch(html, /class="panel fc-deck-manager/, "Manage deck list must open inside portal instead of bloating page bottom");
    assert.match(html, /class="flashcard-controls flex items-center justify-between gap-3 w-full"[^>]*>[^]*Manage deck \(1\)[^]*Reveal answer/);
    assert.match(html, /Edit<\/button>/);
    assert.match(html, /Delete<\/button>/);

    const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
    assert.match(css, /\.flashcard-source-link\s*\{[^}]*padding:\s*8px 14px;[^}]*border-radius:\s*12px;/s);
  });

  test("FlashcardPortalModal renders manual formatting/preview and AI generation modes", async () => {
    const manualHtml = renderToStaticMarkup(
      React.createElement(FlashcardPortalModal, {
        open: true,
        initialMode: "manual",
        allCourses: [{ id: "c1", title: "ML" }],
        allLessons: [],
        notes: [],
        remote: true,
      })
    );
    assert.match(manualHtml, /Create or generate flashcards/);
    assert.match(manualHtml, /Question \(Front\)/);
    assert.match(manualHtml, /Answer \(Back\)/);
    assert.match(manualHtml, /Retrieval Hint/);
    assert.match(manualHtml, /Math \$x\$/);
    assert.match(manualHtml, /Generate with AI/);

    const aiHtml = renderToStaticMarkup(
      React.createElement(FlashcardPortalModal, {
        open: true,
        initialMode: "ai",
        allCourses: [{ id: "c1", title: "ML" }],
        allLessons: [],
        notes: [{ id: "n1", title: "My Bayes Note" }],
        remote: true,
      })
    );
    assert.match(aiHtml, /Personal topic \/ Notes/);
    assert.match(aiHtml, /What topic do you want flashcards for\?/);
    assert.match(aiHtml, /Or ground from a saved note/);
    assert.match(aiHtml, /My Bayes Note/);
    assert.match(aiHtml, /Minimum Information Principle/);
    assert.match(aiHtml, /Generate preview cards/);

    const currentCard = { id: "card-cur", front: "Pinned Active Question?", back: "Pinned Answer", origin: "ai_generated", card_type: "formula" };
    const manyCards = [
      currentCard,
      ...Array.from({ length: 65 }, (_, i) => ({
        id: `card-${i + 1}`,
        front: `Question #${i + 1}`,
        back: `Answer #${i + 1}`,
        due_at: "2025-01-01T00:00:00Z",
        origin: i % 2 === 0 ? "ai_generated" : "learner",
        card_type: "qa",
      })),
    ];
    const deckHtml = renderToStaticMarkup(
      React.createElement(FlashcardPortalModal, {
        open: true,
        initialMode: "deck",
        currentCard,
        flashcards: manyCards,
        allCourses: [{ id: "c1", title: "ML" }],
        allLessons: [],
        notes: [],
        remote: true,
      })
    );
    assert.match(deckHtml, /class="modal-backdrop open fc-portal-backdrop/);
    assert.match(deckHtml, /class="fc-deck-current-pin"/);
    assert.match(deckHtml, /Current card/);
    assert.match(deckHtml, /Pinned Active Question\?/);
    assert.match(deckHtml, /Showing 40 of 65 other cards/);
    assert.match(deckHtml, /Load 25 more \(25 remaining\)/);
    assert.match(deckHtml, /aria-label="Filter deck by source"/);
    assert.match(deckHtml, /aria-label="Filter deck by card type"/);
    assert.match(deckHtml, /aria-label="Sort deck"/);

    const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
    assert.match(css, /\.fc-portal-backdrop\s*\{[^}]*display:\s*flex !important;[^}]*z-index:\s*80 !important;/s);
  });
});
