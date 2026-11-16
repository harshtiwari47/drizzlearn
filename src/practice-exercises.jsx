import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TutorMarkdown } from "./tutor-markdown.jsx";

const EXERCISE_TYPE_LABELS = {
  fill_blank: "Fill in the Blanks",
  quiz: "Quiz",
  order: "Correct Order",
  word_scramble: "Word Builder",
};

function normalizeBlankAnswer(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function rotateOrShuffleRack(items) {
  if (items.length < 2) return items;
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  const sameOrder = copy.every((tile, idx) => tile.id === items[idx].id);
  return sameOrder ? [...copy.slice(1), copy[0]] : copy;
}

/**
 * Interactive fill-in-the-blank drill with word-bank chips, clickable slots, and optional keyboard typing.
 */
export function FillBlankExercise({ exercise, initialState = null, onResult, onStateChange }) {
  const blanks = Array.isArray(exercise?.blanks) ? exercise.blanks : [];
  // Expand word bank so that duplicate answers have enough chips even if generated with unique set
  const effectiveWordBank = useMemo(() => {
    const rawBank = Array.isArray(exercise?.wordBank) ? [...exercise.wordBank] : [];
    // Count occurrences needed by the blanks
    const neededCounts = {};
    for (const b of blanks) {
      const text = String(b.answer || "").trim();
      if (!text) continue;
      const key = text.toLocaleLowerCase();
      neededCounts[key] = (neededCounts[key] || 0) + 1;
    }
    // Count occurrences already in rawBank
    const bankCounts = {};
    for (const chip of rawBank) {
      const key = String(chip || "").trim().toLocaleLowerCase();
      bankCounts[key] = (bankCounts[key] || 0) + 1;
    }
    // Append missing duplicate instances of correct answers
    const expanded = [...rawBank];
    for (const b of blanks) {
      const text = String(b.answer || "").trim();
      if (!text) continue;
      const key = text.toLocaleLowerCase();
      if ((bankCounts[key] || 0) < neededCounts[key]) {
        expanded.push(text);
        bankCounts[key] = (bankCounts[key] || 0) + 1;
      }
    }
    return expanded;
  }, [exercise?.wordBank, blanks]);
  const segments = useMemo(() => String(exercise?.template || "").split("___"), [exercise?.template]);

  const buildInitialAnswers = useCallback(
    (state) => {
      if (Array.isArray(state?.answers) && state.answers.length === blanks.length) {
        return [...state.answers];
      }
      return blanks.map(() => "");
    },
    [blanks.length]
  );

  const buildInitialChips = useCallback(
    (state) => {
      if (Array.isArray(state?.slotChips) && state.slotChips.length === blanks.length) {
        return [...state.slotChips];
      }
      return blanks.map(() => null);
    },
    [blanks.length]
  );

  const [answers, setAnswers] = useState(() => buildInitialAnswers(initialState));
  const [slotChips, setSlotChips] = useState(() => buildInitialChips(initialState));
  const [activeBlank, setActiveBlank] = useState(() =>
    Number.isInteger(initialState?.activeBlank) ? initialState.activeBlank : 0
  );
  const [checked, setChecked] = useState(() => Boolean(initialState?.checked));
  const [showHint, setShowHint] = useState(() => Boolean(initialState?.showHint));

  useEffect(() => {
    setAnswers(buildInitialAnswers(initialState));
    setSlotChips(buildInitialChips(initialState));
    setActiveBlank(Number.isInteger(initialState?.activeBlank) ? initialState.activeBlank : 0);
    setChecked(Boolean(initialState?.checked));
    setShowHint(Boolean(initialState?.showHint));
  }, [exercise?.id, buildInitialAnswers, buildInitialChips, initialState]);

  const emitState = (next) => {
    onStateChange?.({
      answers: next.answers ?? answers,
      slotChips: next.slotChips ?? slotChips,
      activeBlank: next.activeBlank ?? activeBlank,
      checked: next.checked ?? checked,
      showHint: next.showHint ?? showHint,
    });
  };

  const nextEmptyBlankIndex = (nextAnswers, currentIdx) => {
    for (let offset = 1; offset <= blanks.length; offset += 1) {
      const idx = (currentIdx + offset) % blanks.length;
      if (!String(nextAnswers[idx] || "").trim()) return idx;
    }
    return currentIdx;
  };

  const handleSlotClick = (idx) => {
    if (checked) return;
    if (activeBlank === idx && String(answers[idx] || "").trim()) {
      const nextAnswers = [...answers];
      const nextChips = [...slotChips];
      nextAnswers[idx] = "";
      nextChips[idx] = null;
      setAnswers(nextAnswers);
      setSlotChips(nextChips);
      emitState({ answers: nextAnswers, slotChips: nextChips, activeBlank: idx });
      return;
    }
    setActiveBlank(idx);
    emitState({ activeBlank: idx });
  };

  const handleChipClick = (chipIdx, chipText) => {
    if (checked || blanks.length === 0) return;
    const existingSlot = slotChips.findIndex((id) => id === chipIdx);
    if (existingSlot >= 0) {
      const nextAnswers = [...answers];
      const nextChips = [...slotChips];
      nextAnswers[existingSlot] = "";
      nextChips[existingSlot] = null;
      setAnswers(nextAnswers);
      setSlotChips(nextChips);
      setActiveBlank(existingSlot);
      emitState({ answers: nextAnswers, slotChips: nextChips, activeBlank: existingSlot });
      return;
    }
    const targetIdx =
      activeBlank >= 0 && activeBlank < blanks.length
        ? activeBlank
        : Math.max(
            0,
            answers.findIndex((val) => !String(val || "").trim())
          );
    const nextAnswers = [...answers];
    const nextChips = [...slotChips];
    nextAnswers[targetIdx] = chipText;
    nextChips[targetIdx] = chipIdx;
    const nextActive = nextEmptyBlankIndex(nextAnswers, targetIdx);
    setAnswers(nextAnswers);
    setSlotChips(nextChips);
    setActiveBlank(nextActive);
    emitState({ answers: nextAnswers, slotChips: nextChips, activeBlank: nextActive });
  };

  const handleSlotKeyDown = (idx, event) => {
    if (checked) return;
    if (event.key === "Backspace") {
      event.preventDefault();
      const nextAnswers = [...answers];
      const nextChips = [...slotChips];
      if (nextChips[idx] !== null) {
        nextAnswers[idx] = "";
        nextChips[idx] = null;
      } else {
        nextAnswers[idx] = String(nextAnswers[idx] || "").slice(0, -1);
      }
      setAnswers(nextAnswers);
      setSlotChips(nextChips);
      emitState({ answers: nextAnswers, slotChips: nextChips, activeBlank: idx });
      return;
    }
    if (event.key === "ArrowLeft" && idx > 0) {
      event.preventDefault();
      setActiveBlank(idx - 1);
      return;
    }
    if (event.key === "ArrowRight" && idx < blanks.length - 1) {
      event.preventDefault();
      setActiveBlank(idx + 1);
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const nextAnswers = [...answers];
      const nextChips = [...slotChips];
      if (nextChips[idx] !== null) {
        nextAnswers[idx] = event.key;
        nextChips[idx] = null;
      } else {
        nextAnswers[idx] = `${nextAnswers[idx] || ""}${event.key}`.slice(0, 60);
      }
      setAnswers(nextAnswers);
      setSlotChips(nextChips);
      emitState({ answers: nextAnswers, slotChips: nextChips, activeBlank: idx });
    }
  };

  const allFilled = blanks.length > 0 && answers.every((val) => String(val || "").trim().length > 0);
  const blankCorrectness = blanks.map(
    (blank, idx) => normalizeBlankAnswer(answers[idx]) === normalizeBlankAnswer(blank.answer)
  );
  const allCorrect = checked && blankCorrectness.length > 0 && blankCorrectness.every(Boolean);

  const handleCheck = () => {
    if (!allFilled) return;
    const isCorrect = blankCorrectness.every(Boolean);
    const nextState = { answers, slotChips, activeBlank, checked: true, showHint };
    setChecked(true);
    emitState(nextState);
    onResult?.({
      correct: isCorrect,
      score: isCorrect ? 100 : 0,
      answer: answers.join(" | "),
      explanation: exercise?.explanation || "",
      state: nextState,
    });
  };

  const handleReset = () => {
    const emptyAnswers = blanks.map(() => "");
    const emptyChips = blanks.map(() => null);
    const nextState = { answers: emptyAnswers, slotChips: emptyChips, activeBlank: 0, checked: false, showHint };
    setAnswers(emptyAnswers);
    setSlotChips(emptyChips);
    setActiveBlank(0);
    setChecked(false);
    emitState(nextState);
  };

  const hintText = blanks
    .map((b, i) => `Blank ${i + 1}: starts with "${String(b.answer || "")[0] || "?"}" (${String(b.answer || "").length} chars)`)
    .join(" · ");

  return (
    <div className="practice-exercise-card flex flex-col gap-3">
      <div className="practice-exercise-head flex items-center justify-between gap-2">
        <span className="eyebrow">{EXERCISE_TYPE_LABELS.fill_blank}</span>
        <button
          type="button"
          className="quiet-btn compact"
          aria-expanded={showHint}
          onClick={() => {
            const next = !showHint;
            setShowHint(next);
            emitState({ showHint: next });
          }}
        >
          {showHint ? "Hide hint" : "Show hint"}
        </button>
      </div>

      <p className="practice-exercise-prompt">{exercise?.prompt}</p>

      <div className="practice-blank-sentence" role="group" aria-label="Fill in the blanks sentence">
        {segments.map((segment, idx) => (
          <React.Fragment key={idx}>
            <span>{segment}</span>
            {idx < blanks.length && (
              <button
                type="button"
                className={[
                  "practice-blank-slot",
                  String(answers[idx] || "").trim() ? "filled" : "",
                  !checked && activeBlank === idx ? "active" : "",
                  checked ? (blankCorrectness[idx] ? "correct" : "wrong") : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-label={`Blank ${idx + 1}: ${answers[idx] || "empty"}`}
                aria-pressed={!checked && activeBlank === idx}
                onClick={() => handleSlotClick(idx)}
                onKeyDown={(e) => handleSlotKeyDown(idx, e)}
              >
                {answers[idx] || `Blank ${idx + 1}`}
              </button>
            )}
          </React.Fragment>
        ))}
      </div>

      {showHint && (
        <div className="practice-hint-box" role="note">
          <strong>Hint:</strong> {hintText}
        </div>
      )}

      <div className="practice-word-bank" role="group" aria-label="Word bank">
        {effectiveWordBank.map((chip, chipIdx) => {
          const isUsed = slotChips.includes(chipIdx);
          return (
            <button
              key={`${chip}-${chipIdx}`}
              type="button"
              className={`practice-bank-chip ${isUsed ? "used" : ""}`}
              aria-pressed={isUsed}
              disabled={checked}
              onClick={() => handleChipClick(chipIdx, chip)}
            >
              {chip}
            </button>
          );
        })}
      </div>

      <div className="practice-exercise-controls flex flex-wrap items-center gap-2">
        <button type="button" className="primary-btn" disabled={!allFilled || checked} onClick={handleCheck}>
          Check answer
        </button>
        <button type="button" className="quiet-btn" onClick={handleReset}>
          Reset
        </button>
      </div>

      {checked && (
        <div className={`feedback-box ${allCorrect ? "correct" : "incorrect"}`} role="status">
          <strong>{allCorrect ? "Correct!" : `Expected: ${blanks.map((b) => b.answer).join(", ")}`}</strong>
          {exercise?.explanation && <p>{exercise.explanation}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * Interactive multiple-choice quiz drill with optional code block, hint toggle, and explanation feedback.
 */
export function QuizExercise({ exercise, initialState = null, onResult, onStateChange }) {
  const options = Array.isArray(exercise?.options) ? exercise.options : [];
  const [selectedIndex, setSelectedIndex] = useState(() =>
    Number.isInteger(initialState?.selectedIndex) ? initialState.selectedIndex : null
  );
  const [checked, setChecked] = useState(() => Boolean(initialState?.checked));
  const [showHint, setShowHint] = useState(() => Boolean(initialState?.showHint));

  useEffect(() => {
    setSelectedIndex(Number.isInteger(initialState?.selectedIndex) ? initialState.selectedIndex : null);
    setChecked(Boolean(initialState?.checked));
    setShowHint(Boolean(initialState?.showHint));
  }, [exercise?.id, initialState]);

  const emitState = (next) => {
    onStateChange?.({
      selectedIndex: next.selectedIndex !== undefined ? next.selectedIndex : selectedIndex,
      checked: next.checked ?? checked,
      showHint: next.showHint ?? showHint,
    });
  };

  const isCorrect = checked && selectedIndex === Number(exercise?.answerIndex);

  const handleSelect = (idx) => {
    if (checked) return;
    setSelectedIndex(idx);
    emitState({ selectedIndex: idx });
  };

  const handleCheck = () => {
    if (selectedIndex === null || checked) return;
    const correct = selectedIndex === Number(exercise?.answerIndex);
    const nextState = { selectedIndex, checked: true, showHint };
    setChecked(true);
    emitState(nextState);
    onResult?.({
      correct,
      score: correct ? 100 : 0,
      answer: options[selectedIndex] || String(selectedIndex),
      explanation: exercise?.explanation || "",
      state: nextState,
    });
  };

  const handleReset = () => {
    const nextState = { selectedIndex: null, checked: false, showHint };
    setSelectedIndex(null);
    setChecked(false);
    emitState(nextState);
  };

  return (
    <div className="practice-exercise-card flex flex-col gap-3">
      <div className="practice-exercise-head flex items-center justify-between gap-2">
        <span className="eyebrow">{EXERCISE_TYPE_LABELS.quiz}</span>
        {exercise?.hint && (
          <button
            type="button"
            className="quiet-btn compact"
            aria-expanded={showHint}
            onClick={() => {
              const next = !showHint;
              setShowHint(next);
              emitState({ showHint: next });
            }}
          >
            {showHint ? "Hide hint" : "Show hint"}
          </button>
        )}
      </div>

      <div className="practice-exercise-prompt">
        <TutorMarkdown content={exercise?.prompt || ""} />
      </div>

      {exercise?.codeSnippet && (
        <pre className="practice-code-snippet">
          <code>{exercise.codeSnippet}</code>
        </pre>
      )}

      {showHint && exercise?.hint && (
        <div className="practice-hint-box" role="note">
          <strong>Hint:</strong> {exercise.hint}
        </div>
      )}

      <div className="answer-options flex flex-col gap-2" role="group" aria-label="Quiz options">
        {options.map((choice, idx) => {
          const isSelected = selectedIndex === idx;
          const optionCorrect = checked && idx === Number(exercise?.answerIndex);
          const optionWrong = checked && isSelected && idx !== Number(exercise?.answerIndex);
          const classes = [
            "answer-option flex items-center gap-3 p-3 text-left cursor-pointer",
            isSelected ? "selected" : "",
            optionCorrect ? "answer-correct is-correct" : "",
            optionWrong ? "answer-wrong" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={idx}
              type="button"
              className={classes}
              aria-pressed={isSelected}
              disabled={checked}
              onClick={() => handleSelect(idx)}
            >
              <span className="answer-badge">{String.fromCharCode(65 + idx)}</span>
              <span className="answer-text flex-1">{choice}</span>
            </button>
          );
        })}
      </div>

      <div className="practice-exercise-controls flex flex-wrap items-center gap-2">
        <button type="button" className="primary-btn" disabled={selectedIndex === null || checked} onClick={handleCheck}>
          Check answer
        </button>
        {checked && (
          <button type="button" className="quiet-btn" onClick={handleReset}>
            Try again
          </button>
        )}
      </div>

      {checked && (
        <div className={`feedback-box ${isCorrect ? "correct" : "incorrect"}`} role="status">
          <strong>{isCorrect ? "Correct!" : "Not quite"}</strong>
          {exercise?.explanation && <p>{exercise.explanation}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * Interactive sequencing drill where learners reorder steps using accessible Move Up / Move Down controls.
 */
export function OrderExercise({ exercise, initialState = null, onResult, onStateChange }) {
  const correctSteps = Array.isArray(exercise?.correctSteps) ? exercise.correctSteps : [];
  const defaultSteps = useMemo(
    () => (Array.isArray(exercise?.shuffledSteps) && exercise.shuffledSteps.length ? exercise.shuffledSteps : correctSteps),
    [exercise?.shuffledSteps, correctSteps]
  );

  const [steps, setSteps] = useState(() =>
    Array.isArray(initialState?.steps) && initialState.steps.length === defaultSteps.length
      ? [...initialState.steps]
      : [...defaultSteps]
  );
  const [checked, setChecked] = useState(() => Boolean(initialState?.checked));

  useEffect(() => {
    setSteps(
      Array.isArray(initialState?.steps) && initialState.steps.length === defaultSteps.length
        ? [...initialState.steps]
        : [...defaultSteps]
    );
    setChecked(Boolean(initialState?.checked));
  }, [exercise?.id, defaultSteps, initialState]);

  const emitState = (next) => {
    onStateChange?.({
      steps: next.steps ?? steps,
      checked: next.checked ?? checked,
    });
  };

  const moveStep = (index, delta) => {
    if (checked) return;
    const target = index + delta;
    if (target < 0 || target >= steps.length) return;
    const nextSteps = [...steps];
    const tmp = nextSteps[index];
    nextSteps[index] = nextSteps[target];
    nextSteps[target] = tmp;
    setSteps(nextSteps);
    emitState({ steps: nextSteps });
  };

  const stepMatches = steps.map((step, idx) => step === correctSteps[idx]);
  const allCorrect = checked && stepMatches.length > 0 && stepMatches.every(Boolean);

  const handleCheck = () => {
    if (!steps.length || checked) return;
    const correct = stepMatches.every(Boolean);
    const nextState = { steps, checked: true };
    setChecked(true);
    emitState(nextState);
    onResult?.({
      correct,
      score: correct ? 100 : 0,
      answer: steps.join(" -> "),
      explanation: exercise?.explanation || "",
      state: nextState,
    });
  };

  const handleReset = () => {
    const resetSteps = [...defaultSteps];
    setSteps(resetSteps);
    setChecked(false);
    emitState({ steps: resetSteps, checked: false });
  };

  return (
    <div className="practice-exercise-card flex flex-col gap-3">
      <div className="practice-exercise-head flex items-center justify-between gap-2">
        <span className="eyebrow">{EXERCISE_TYPE_LABELS.order}</span>
      </div>

      <p className="practice-exercise-prompt">{exercise?.prompt}</p>

      <ol className="practice-order-list" aria-label="Steps to order">
        {steps.map((step, idx) => {
          const cardState = checked ? (stepMatches[idx] ? "correct" : "wrong") : "";
          return (
            <li key={`${step}-${idx}`} className={`practice-order-card ${cardState}`.trim()}>
              <span className="practice-order-num">{idx + 1}</span>
              <span className="practice-order-text">{step}</span>
              <div className="practice-order-move">
                <button
                  type="button"
                  className="quiet-btn compact"
                  aria-label={`Move step ${idx + 1} up`}
                  disabled={checked || idx === 0}
                  onClick={() => moveStep(idx, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="quiet-btn compact"
                  aria-label={`Move step ${idx + 1} down`}
                  disabled={checked || idx === steps.length - 1}
                  onClick={() => moveStep(idx, 1)}
                >
                  ↓
                </button>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="practice-exercise-controls flex flex-wrap items-center gap-2">
        <button type="button" className="primary-btn" disabled={!steps.length || checked} onClick={handleCheck}>
          Check order
        </button>
        <button type="button" className="quiet-btn" onClick={handleReset}>
          Reset
        </button>
      </div>

      {checked && (
        <div className={`feedback-box ${allCorrect ? "correct" : "incorrect"}`} role="status">
          <strong>{allCorrect ? "Order is correct!" : "Not quite in sequence"}</strong>
          {!allCorrect && (
            <p>
              Correct sequence: {correctSteps.map((s, i) => `${i + 1}. ${s}`).join(" → ")}
            </p>
          )}
          {exercise?.explanation && <p>{exercise.explanation}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * Interactive word builder / scramble drill with clickable tiles, slot removal, shuffle, hint, and keyboard typing.
 */
export function WordScrambleExercise({ exercise, initialState = null, onResult, onStateChange }) {
  const targetWord = String(exercise?.word || "").trim().toUpperCase();
  const baseLetters = useMemo(
    () =>
      (Array.isArray(exercise?.scrambledLetters) && exercise.scrambledLetters.length
        ? exercise.scrambledLetters
        : targetWord.split("")
      ).map((char, idx) => ({ id: idx, char: String(char).toUpperCase() })),
    [exercise?.scrambledLetters, targetWord]
  );

  const [rack, setRack] = useState(() =>
    Array.isArray(initialState?.rack) && initialState.rack.length === baseLetters.length
      ? initialState.rack
      : baseLetters
  );
  const [placedIds, setPlacedIds] = useState(() =>
    Array.isArray(initialState?.placedIds) ? [...initialState.placedIds] : []
  );
  const [checked, setChecked] = useState(() => Boolean(initialState?.checked));
  const [showHint, setShowHint] = useState(() => Boolean(initialState?.showHint));
  const containerRef = useRef(null);

  useEffect(() => {
    setRack(
      Array.isArray(initialState?.rack) && initialState.rack.length === baseLetters.length
        ? initialState.rack
        : baseLetters
    );
    setPlacedIds(Array.isArray(initialState?.placedIds) ? [...initialState.placedIds] : []);
    setChecked(Boolean(initialState?.checked));
    setShowHint(Boolean(initialState?.showHint));
  }, [exercise?.id, baseLetters, initialState]);

  const emitState = useCallback(
    (next) => {
      onStateChange?.({
        rack: next.rack ?? rack,
        placedIds: next.placedIds ?? placedIds,
        checked: next.checked ?? checked,
        showHint: next.showHint ?? showHint,
      });
    },
    [onStateChange, rack, placedIds, checked, showHint]
  );

  const tileById = useMemo(() => new Map(rack.map((tile) => [tile.id, tile])), [rack]);
  const guess = placedIds.map((id) => tileById.get(id)?.char || "").join("");
  const isComplete = targetWord.length > 0 && placedIds.length === targetWord.length;
  const isCorrect = checked && guess === targetWord;

  const addTileById = useCallback(
    (tileId) => {
      if (checked || placedIds.length >= targetWord.length || placedIds.includes(tileId)) return;
      const nextPlaced = [...placedIds, tileId];
      setPlacedIds(nextPlaced);
      emitState({ placedIds: nextPlaced });
    },
    [checked, placedIds, targetWord.length, emitState]
  );

  const removeSlotAt = useCallback(
    (slotIdx) => {
      if (checked || slotIdx < 0 || slotIdx >= placedIds.length) return;
      const nextPlaced = placedIds.filter((_, idx) => idx !== slotIdx);
      setPlacedIds(nextPlaced);
      emitState({ placedIds: nextPlaced });
    },
    [checked, placedIds, emitState]
  );

  const handleKeyInput = useCallback(
    (key) => {
      if (checked) return false;
      if (key === "Backspace") {
        if (!placedIds.length) return false;
        const nextPlaced = placedIds.slice(0, -1);
        setPlacedIds(nextPlaced);
        emitState({ placedIds: nextPlaced });
        return true;
      }
      if (/^[a-zA-Z]$/.test(key) && placedIds.length < targetWord.length) {
        const upper = key.toUpperCase();
        const availableTile = rack.find((tile) => tile.char === upper && !placedIds.includes(tile.id));
        if (!availableTile) return false;
        const nextPlaced = [...placedIds, availableTile.id];
        setPlacedIds(nextPlaced);
        emitState({ placedIds: nextPlaced });
        return true;
      }
      return false;
    },
    [checked, placedIds, targetWord.length, rack, emitState]
  );

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onWindowKeyDown = (event) => {
      if (checked || event.ctrlKey || event.metaKey || event.altKey) return;
      if (containerRef.current && containerRef.current.contains(event.target)) return;
      const tag = event.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || event.target?.isContentEditable) return;
      if (handleKeyInput(event.key)) {
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [checked, handleKeyInput]);

  const handleCheck = () => {
    if (!isComplete || checked) return;
    const correct = guess === targetWord;
    const nextState = { rack, placedIds, checked: true, showHint };
    setChecked(true);
    emitState(nextState);
    onResult?.({
      correct,
      score: correct ? 100 : 0,
      answer: guess,
      explanation: exercise?.explanation || "",
      state: nextState,
    });
  };

  const handleClear = () => {
    setPlacedIds([]);
    setChecked(false);
    emitState({ placedIds: [], checked: false });
  };

  const handleShuffle = () => {
    if (checked) return;
    const nextRack = rotateOrShuffleRack(rack);
    setRack(nextRack);
    emitState({ rack: nextRack });
  };

  const firstLetterClue = targetWord ? `Starts with "${targetWord[0]}" (${targetWord.length} letters)` : "";

  return (
    <div
      ref={containerRef}
      className="practice-exercise-card flex flex-col gap-3"
      tabIndex={0}
      aria-label="Word builder exercise"
      onKeyDown={(e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (handleKeyInput(e.key)) {
          e.preventDefault();
        }
      }}
    >
      <div className="practice-exercise-head flex items-center justify-between gap-2">
        <span className="eyebrow">{EXERCISE_TYPE_LABELS.word_scramble}</span>
        <button
          type="button"
          className="quiet-btn compact"
          aria-expanded={showHint}
          onClick={() => {
            const next = !showHint;
            setShowHint(next);
            emitState({ showHint: next });
          }}
        >
          {showHint ? "Hide hint" : "Hint"}
        </button>
      </div>

      <p className="practice-exercise-prompt">{exercise?.prompt}</p>

      <div className="practice-scramble-slots" role="group" aria-label="Word slots">
        {Array.from({ length: targetWord.length }, (_, idx) => {
          const tileId = placedIds[idx];
          const tile = tileId !== undefined ? tileById.get(tileId) : null;
          const slotClasses = [
            "practice-scramble-slot",
            tile ? "filled" : "",
            checked ? (isCorrect ? "correct" : "wrong") : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={idx}
              type="button"
              className={slotClasses}
              aria-label={tile ? `Letter ${idx + 1}: ${tile.char}` : `Empty letter slot ${idx + 1}`}
              disabled={checked || !tile}
              onClick={() => removeSlotAt(idx)}
            >
              {tile ? tile.char : ""}
            </button>
          );
        })}
      </div>

      {showHint && (
        <div className="practice-hint-box" role="note">
          <strong>Hint:</strong> {exercise?.hint ? `${exercise.hint} (${firstLetterClue})` : firstLetterClue}
        </div>
      )}

      <div className="practice-letter-rack" role="group" aria-label="Letter tiles">
        {rack.map((tile) => {
          const isUsed = placedIds.includes(tile.id);
          return (
            <button
              key={tile.id}
              type="button"
              className={`practice-letter-tile ${isUsed ? "used" : ""}`}
              aria-label={`Letter ${tile.char}`}
              disabled={checked || isUsed}
              onClick={() => addTileById(tile.id)}
            >
              {tile.char}
            </button>
          );
        })}
      </div>

      <div className="practice-exercise-controls flex flex-wrap items-center gap-2">
        <button type="button" className="primary-btn" disabled={!isComplete || checked} onClick={handleCheck}>
          Check word
        </button>
        <button type="button" className="quiet-btn" disabled={checked} onClick={handleShuffle}>
          Shuffle
        </button>
        <button type="button" className="quiet-btn" onClick={handleClear}>
          Clear
        </button>
      </div>

      {checked && (
        <div className={`feedback-box ${isCorrect ? "correct" : "incorrect"}`} role="status">
          <strong>{isCorrect ? "Exact match!" : `Word: ${targetWord}`}</strong>
          {exercise?.explanation && <p>{exercise.explanation}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * Multi-exercise Practice Studio runner with stepper dots, per-exercise persistence, and attempt sync.
 */
export function PracticeStudioRunner({
  exercises = [],
  mode = "mixed",
  lesson = null,
  initialProgress = null,
  onPersistProgress,
  onRecordAttempt,
}) {
  const [activeIndex, setActiveIndex] = useState(() => {
    const raw = Number(initialProgress?.activeIndex);
    return Number.isInteger(raw) && raw >= 0 && raw < exercises.length ? raw : 0;
  });
  const [resultsById, setResultsById] = useState(() => initialProgress?.resultsById || {});
  const [statesById, setStatesById] = useState(() => initialProgress?.statesById || {});
  const [savedAttemptIds, setSavedAttemptIds] = useState(() => initialProgress?.savedAttemptIds || {});
  const [saving, setSaving] = useState(false);

  const exerciseSignature = useMemo(() => exercises.map((e) => e.id).join("|"), [exercises]);

  useEffect(() => {
    const raw = Number(initialProgress?.activeIndex);
    setActiveIndex(Number.isInteger(raw) && raw >= 0 && raw < exercises.length ? raw : 0);
    setResultsById(initialProgress?.resultsById || {});
    setStatesById(initialProgress?.statesById || {});
    setSavedAttemptIds(initialProgress?.savedAttemptIds || {});
  }, [exerciseSignature, mode, lesson?.id]);

  if (!exercises.length) return null;

  const safeIndex = Math.max(0, Math.min(activeIndex, exercises.length - 1));
  const current = exercises[safeIndex];
  const checkedCount = exercises.filter((ex) => Boolean(resultsById[ex.id])).length;
  const correctCount = exercises.filter((ex) => resultsById[ex.id]?.correct === true).length;

  const persistSnapshot = (next) => {
    onPersistProgress?.({
      activeIndex: next.activeIndex ?? safeIndex,
      resultsById: next.resultsById ?? resultsById,
      statesById: next.statesById ?? statesById,
      savedAttemptIds: next.savedAttemptIds ?? savedAttemptIds,
    });
  };

  const goToIndex = (idx) => {
    const bounded = Math.max(0, Math.min(idx, exercises.length - 1));
    setActiveIndex(bounded);
    persistSnapshot({ activeIndex: bounded });
  };

  const handleStateChange = (exerciseId, state) => {
    const nextStates = { ...statesById, [exerciseId]: state };
    setStatesById(nextStates);
    persistSnapshot({ statesById: nextStates });
  };

  const handleExerciseResult = async (exercise, outcome) => {
    const nextResults = {
      ...resultsById,
      [exercise.id]: {
        correct: Boolean(outcome.correct),
        score: Number.isFinite(Number(outcome.score)) ? Number(outcome.score) : outcome.correct ? 100 : 0,
        answer: outcome.answer || "",
        explanation: outcome.explanation || exercise.explanation || "",
        checkedAt: Date.now(),
      },
    };
    const nextStates = outcome.state ? { ...statesById, [exercise.id]: outcome.state } : statesById;
    setResultsById(nextResults);
    setStatesById(nextStates);
    persistSnapshot({ resultsById: nextResults, statesById: nextStates });

    if (onRecordAttempt) {
      const ok = await onRecordAttempt({
        exercise,
        correct: Boolean(outcome.correct),
        score: nextResults[exercise.id].score,
        answer: outcome.answer || "",
        explanation: outcome.explanation || exercise.explanation || "",
      });
      if (ok !== false) {
        const nextSaved = { ...savedAttemptIds, [exercise.id]: true };
        setSavedAttemptIds(nextSaved);
        persistSnapshot({ resultsById: nextResults, statesById: nextStates, savedAttemptIds: nextSaved });
      }
    }
  };

  const handleSaveProgress = async () => {
    setSaving(true);
    try {
      let nextSaved = { ...savedAttemptIds };
      for (const ex of exercises) {
        const res = resultsById[ex.id];
        if (res && !nextSaved[ex.id] && onRecordAttempt) {
          const ok = await onRecordAttempt({
            exercise: ex,
            correct: res.correct,
            score: res.score,
            answer: res.answer,
            explanation: res.explanation,
          });
          if (ok !== false) nextSaved[ex.id] = true;
        }
      }
      setSavedAttemptIds(nextSaved);
      persistSnapshot({ savedAttemptIds: nextSaved });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="practice-runner flex flex-col gap-4">
      <div className="practice-stepper flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Exercise steps">
          {exercises.map((ex, idx) => {
            const res = resultsById[ex.id];
            const dotClasses = [
              "practice-dot",
              idx === safeIndex ? "active" : "",
              res ? (res.correct ? "done" : "wrong") : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                key={ex.id}
                type="button"
                role="tab"
                aria-selected={idx === safeIndex}
                aria-label={`Exercise ${idx + 1}: ${EXERCISE_TYPE_LABELS[ex.type] || ex.type}`}
                className={dotClasses}
                onClick={() => goToIndex(idx)}
              >
                {idx + 1}
              </button>
            );
          })}
        </div>
        <span className="muted-copy text-sm" aria-live="polite">
          {checkedCount}/{exercises.length} checked · {correctCount} correct
        </span>
      </div>

      {current.type === "fill_blank" && (
        <FillBlankExercise
          key={current.id}
          exercise={current}
          initialState={statesById[current.id] || null}
          onStateChange={(st) => handleStateChange(current.id, st)}
          onResult={(out) => handleExerciseResult(current, out)}
        />
      )}
      {current.type === "quiz" && (
        <QuizExercise
          key={current.id}
          exercise={current}
          initialState={statesById[current.id] || null}
          onStateChange={(st) => handleStateChange(current.id, st)}
          onResult={(out) => handleExerciseResult(current, out)}
        />
      )}
      {current.type === "order" && (
        <OrderExercise
          key={current.id}
          exercise={current}
          initialState={statesById[current.id] || null}
          onStateChange={(st) => handleStateChange(current.id, st)}
          onResult={(out) => handleExerciseResult(current, out)}
        />
      )}
      {current.type === "word_scramble" && (
        <WordScrambleExercise
          key={current.id}
          exercise={current}
          initialState={statesById[current.id] || null}
          onStateChange={(st) => handleStateChange(current.id, st)}
          onResult={(out) => handleExerciseResult(current, out)}
        />
      )}

      <div className="practice-actions-row flex flex-wrap items-center justify-between gap-2 pt-2">
        <div className="flex items-center gap-2">
          <button type="button" className="quiet-btn" disabled={safeIndex === 0} onClick={() => goToIndex(safeIndex - 1)}>
            Prev
          </button>
          <button
            type="button"
            className="quiet-btn"
            disabled={safeIndex >= exercises.length - 1}
            onClick={() => goToIndex(safeIndex + 1)}
          >
            Next
          </button>
        </div>
        <button type="button" className="quiet-btn" disabled={saving} onClick={handleSaveProgress}>
          {saving ? "Saving…" : "Save progress"}
        </button>
      </div>
    </div>
  );
}
