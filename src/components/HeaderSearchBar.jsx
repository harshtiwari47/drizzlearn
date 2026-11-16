import React, { useState, useRef, useEffect } from "react";

/**
 * HeaderSearchBar
 * 
 * Animated glassmorphic search bar for the Drizzlearn topbar.
 * Resting state: Only the circular frosted glass search icon button is visible.
 * Active state: Clicking the icon smoothly slides out the elongated glass pill
 *               input matching the iridescent translucent design.
 */
export function HeaderSearchBar({
  queryText,
  setQueryText,
  onSubmit,
  placeholder = "Search..."
}) {
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef(null);
  const containerRef = useRef(null);

  // Auto-close on click outside if the search input is empty
  useEffect(() => {
    if (!isOpen) return;

    const handleOutsideClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        if (!queryText.trim()) {
          setIsOpen(false);
        }
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("touchstart", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("touchstart", handleOutsideClick);
    };
  }, [isOpen, queryText]);

  const handleToggle = (e) => {
    e.preventDefault();
    if (!isOpen) {
      setIsOpen(true);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 60);
    } else {
      if (queryText.trim()) {
        onSubmit?.(e);
      } else {
        setIsOpen(false);
      }
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Escape") {
      setIsOpen(false);
      inputRef.current?.blur();
    }
  };

  const handleClear = (e) => {
    e.stopPropagation();
    setQueryText("");
    inputRef.current?.focus();
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    if (!isOpen) {
      setIsOpen(true);
      setTimeout(() => inputRef.current?.focus(), 60);
      return;
    }
    if (queryText.trim()) {
      onSubmit?.(e);
    }
  };

  return (
    <form
      ref={containerRef}
      className={`header-animated-search flex items-center relative ${isOpen ? "is-open" : "is-collapsed"}`}
      onSubmit={handleFormSubmit}
      role="search"
      aria-expanded={isOpen}
    >
      {/* Sliding Glass Capsule Input Container */}
      <div className="search-slide-wrapper">
        <div className="glass-search-input-pill flex items-center">
          <input
            ref={inputRef}
            type="search"
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            aria-label="Search lessons and tools"
            className="glass-search-input flex-1 min-w-0"
            tabIndex={isOpen ? 0 : -1}
          />
          {queryText && (
            <button
              type="button"
              onClick={handleClear}
              className="search-clear-btn shrink-0"
              aria-label="Clear search"
              title="Clear search"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Circular Frosted Glass Search Button */}
      <button
        type="button"
        onClick={handleToggle}
        className={`glass-search-trigger-btn shrink-0 flex items-center justify-center ${isOpen ? "is-active" : ""}`}
        aria-label={isOpen ? (queryText.trim() ? "Submit search" : "Close search") : "Open search bar"}
        title={isOpen ? (queryText.trim() ? "Search" : "Close search") : "Search lessons and tools"}
      >
        <svg
          className="search-icon-svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="10.8" cy="10.8" r="6.8" />
          <line x1="21" y1="21" x2="15.8" y2="15.8" />
        </svg>
      </button>
    </form>
  );
}

export default HeaderSearchBar;
