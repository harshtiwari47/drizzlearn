import React from "react";
import { Icon } from "./common.jsx";

/**
 * AppFooter
 * 
 * Adaptive, calm footer for Drizzlearn:
 * - Organically adapts to any page background (translucent frosted glass, zero color clash)
 * - Clean architectural layout with zero SVG waves or artificial cutoffs
 * - Accurate workspace navigation and study tools
 * - Features the 3D study companion mascot
 * - Multi-breakpoint responsive (480px, 768px, 1024px, 1280px, 1536px, 1920px)
 */
export function AppFooter({ go }) {
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleNav = (target) => {
    if (typeof go === "function") {
      go(target);
    } else {
      window.location.hash = `#/${target}`;
    }
  };

  return (
    <footer className="app-footer-adaptive" role="contentinfo">
      <div className="footer-adaptive-container">
        {/* Main Grid: Brand + Navigation Columns + Companion Mascot */}
        <div className="footer-adaptive-grid">
          
          {/* Column 1: Brand & Philosophy */}
          <div className="footer-col-brand">
            <div className="footer-brand-header">
              <button
                type="button"
                onClick={() => handleNav("home")}
                className="footer-brand-link"
                aria-label="Drizzlearn Home"
              >
                <span className="footer-brand-logo-text">
                  <span className="footer-brand-drizz">DRIZZ</span>
                  <span className="footer-brand-learn">LEARN</span>
                </span>
              </button>
            </div>

            <p className="footer-brand-desc">
              A calm, structured workspace for curious minds. Build demonstrated capabilities through personalized roadmaps, spaced repetition, and deliberate daily practice.
            </p>
          </div>

          {/* Column 2: Workspace Links */}
          <div className="footer-col-nav">
            <h4 className="footer-nav-heading">Workspace</h4>
            <ul className="footer-nav-list">
              <li>
                <button type="button" onClick={() => handleNav("courses")} className="footer-nav-link">
                  My Courses
                </button>
              </li>
              <li>
                <button type="button" onClick={() => handleNav("today")} className="footer-nav-link">
                  Today's Plan
                </button>
              </li>
              <li>
                <button type="button" onClick={() => handleNav("study-together")} className="footer-nav-link">
                  Study Together
                </button>
              </li>
              <li>
                <button type="button" onClick={() => handleNav("progress")} className="footer-nav-link">
                  Your Progress
                </button>
              </li>
            </ul>
          </div>

          {/* Column 3: Study Tools */}
          <div className="footer-col-nav">
            <h4 className="footer-nav-heading">Study Tools</h4>
            <ul className="footer-nav-list">
              <li>
                <button type="button" onClick={() => handleNav("tutor")} className="footer-nav-link">
                  AI Tutor
                </button>
              </li>
              <li>
                <button type="button" onClick={() => handleNav("flashcards")} className="footer-nav-link">
                  Flashcards
                </button>
              </li>
              <li>
                <button type="button" onClick={() => handleNav("practice")} className="footer-nav-link">
                  Practice
                </button>
              </li>
              <li>
                <button type="button" onClick={() => handleNav("notes")} className="footer-nav-link">
                  Notes
                </button>
              </li>
            </ul>
          </div>

          {/* Column 4: Companion Mascot & Quick Start */}
          <div className="footer-col-mascot">
            <div className="footer-mascot-card">
              <div className="footer-mascot-glow" aria-hidden="true" />
              <img
                src="/images/footer-robot-mascot.png"
                alt="Drizzlearn study robot companion"
                className="footer-mascot-img"
                loading="lazy"
              />
              <div className="footer-mascot-content">
                <span className="footer-mascot-title">Ready for your next skill?</span>
                <button
                  type="button"
                  onClick={() => handleNav("create-course")}
                  className="footer-mascot-btn"
                >
                  <Icon name="plus" size={13} />
                  <span>Start a course</span>
                </button>
              </div>
            </div>
          </div>

        </div>

        {/* Bottom Bar: Copyright, Secondary Links, Back to top */}
        <div className="footer-adaptive-bottom">
          <p className="footer-copyright">
            © {new Date().getFullYear()} Drizzlearn. Crafted for focused, self-paced learners.
          </p>

          <div className="footer-bottom-actions">
            <button
              type="button"
              onClick={() => handleNav("settings")}
              className="footer-bottom-link"
            >
              Settings
            </button>
            <span className="footer-bottom-sep" aria-hidden="true">·</span>
            <button
              type="button"
              onClick={scrollToTop}
              className="footer-back-to-top-btn"
              aria-label="Back to top of page"
            >
              <span>Back to top</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m18 15-6-6-6 6" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default AppFooter;
