import React from "react";

/**
 * AppFooter
 * 
 * Beautifully designed footer for Drizzlearn featuring:
 * - Left side: Cozy study desk setup illustration (/images/footer-study-desk.png)
 * - Right side: Friendly, human, simple copy about Drizzlearn (zero AI buzzword slop)
 * - Multi-layer wave gradients and ambient glowing crests in the background
 * - Top & bottom generous paddings with multi-breakpoint responsiveness (480px, 768px, 1024px, 1280px, 1536px, 1920px)
 */
export function AppFooter({ go }) {
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const navLinks = [
    { label: "Home", page: "home" },
    { label: "Courses", page: "courses" },
    { label: "Today's Plan", page: "today" },
    { label: "Flashcards", page: "flashcards" },
    { label: "Practice", page: "practice" },
    { label: "AI Tutor", page: "tutor" },
    { label: "Settings", page: "settings" },
  ];

  return (
    <footer className="app-footer-redesign relative w-full overflow-hidden text-slate-300" role="contentinfo">
      {/* Background Layer: Multi-tiered Wave Gradients */}
      <div className="footer-wave-canvas absolute inset-0 pointer-events-none" aria-hidden="true">
        {/* Layer 1: Ambient mesh glows */}
        <div className="footer-mesh-glow glow-cyan absolute" />
        <div className="footer-mesh-glow glow-violet absolute" />
        <div className="footer-mesh-glow glow-amber absolute" />

        {/* Layer 2: Organic SVG Wave Paths */}
        <svg
          className="footer-wave-svg-backdrop absolute inset-0 w-full h-full"
          viewBox="0 0 1440 600"
          preserveAspectRatio="none"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="footerWaveGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#083344" stopOpacity="0.45" />
              <stop offset="45%" stopColor="#0f172a" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#1e1b4b" stopOpacity="0.4" />
            </linearGradient>
            <linearGradient id="footerWaveGrad2" x1="100%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#0e7490" stopOpacity="0.3" />
              <stop offset="50%" stopColor="#064e3b" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#312e81" stopOpacity="0.25" />
            </linearGradient>
            <linearGradient id="footerWaveCrest1" x1="0%" y1="50%" x2="100%" y2="50%">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0" />
              <stop offset="25%" stopColor="#38bdf8" stopOpacity="0.4" />
              <stop offset="60%" stopColor="#818cf8" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="footerWaveCrest2" x1="100%" y1="50%" x2="0%" y2="50%">
              <stop offset="0%" stopColor="#00e5ff" stopOpacity="0" />
              <stop offset="40%" stopColor="#00e5ff" stopOpacity="0.35" />
              <stop offset="75%" stopColor="#a78bfa" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#00e5ff" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Deep flowing back wave */}
          <path
            d="M0,90 C280,160 520,30 840,110 C1120,180 1320,60 1440,90 L1440,600 L0,600 Z"
            fill="url(#footerWaveGrad1)"
          />
          {/* Wave 1 highlight crest line */}
          <path
            d="M0,90 C280,160 520,30 840,110 C1120,180 1320,60 1440,90"
            stroke="url(#footerWaveCrest1)"
            strokeWidth="1.8"
          />

          {/* Middle undulating wave */}
          <path
            d="M0,170 C360,90 680,220 1040,130 C1260,75 1380,140 1440,160 L1440,600 L0,600 Z"
            fill="url(#footerWaveGrad2)"
          />
          {/* Wave 2 highlight crest line */}
          <path
            d="M0,170 C360,90 680,220 1040,130 C1260,75 1380,140 1440,160"
            stroke="url(#footerWaveCrest2)"
            strokeWidth="1.5"
          />
        </svg>

        {/* Top border hairline with gradient shimmer */}
        <div className="footer-top-edge-line absolute top-0 left-0 right-0 h-[1px]" />
      </div>

      {/* Main Footer Content Container */}
      <div className="footer-inner-container relative z-10 mx-auto w-full px-5 sm:px-8 md:px-12 lg:px-16 py-14 sm:py-16 md:py-20 lg:py-24">
        {/* Top Section: Left Study Desk Image + Right Friendly Brand Story */}
        <div className="footer-main-grid grid grid-cols-1 lg:grid-cols-12 items-center gap-10 lg:gap-14">
          
          {/* Left Column: Cozy Study Desk Illustration */}
          <div className="footer-desk-col lg:col-span-5 flex justify-center lg:justify-start">
            <div className="footer-desk-frame relative group w-full max-w-[480px] flex items-center justify-center">
              {/* Soft warm desk lamp glow aura */}
              <div className="footer-desk-ambient-glow" aria-hidden="true" />
              
              <img
                src="/images/footer-study-desk.png"
                alt="Cozy Drizzlearn study desk setup with books, plants, and monitor"
                className="footer-desk-img relative z-10 w-full h-auto object-contain transition-transform duration-500 ease-out group-hover:scale-[1.02]"
                loading="lazy"
              />
            </div>
          </div>

          {/* Right Column: Friendly Copy About Drizzlearn */}
          <div className="footer-copy-col lg:col-span-7 flex flex-col items-start gap-5">
            {/* Brand Logo Tag */}
            <div className="flex items-center gap-3">
              <div className="footer-brand-pill flex items-center gap-2 px-3.5 py-1.5 rounded-full">
                <span className="text-cyan-400 font-bold text-sm">✦</span>
                <span className="brand-logo-text text-sm tracking-widest font-extrabold">
                  <span className="brand-text-drizz">DRIZZ</span>
                  <span className="brand-text-learn">LEARN</span>
                </span>
              </div>
              <span className="text-xs text-slate-400 font-mono tracking-wider uppercase">Your quiet study corner</span>
            </div>

            {/* Friendly Headline */}
            <h2 className="footer-headline font-display text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-white leading-tight">
              Build real skills, one calm day at a time.
            </h2>

            {/* Simple, Non-AI-Slop, Warm & Human Description */}
            <p className="footer-body text-slate-300 text-sm sm:text-base leading-relaxed max-w-xl">
              Learning something new should feel encouraging, not overwhelming. Drizzlearn gives you structured roadmaps, spaced repetition flashcards, and a quiet desk to make meaningful progress at your own pace.
            </p>

            {/* Friendly Micro-Perks */}
            <div className="footer-perks-grid grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-xl pt-2">
              <div className="footer-perk-card flex items-start gap-2.5 p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
                <span className="text-amber-400 text-base leading-none shrink-0 mt-0.5">☕</span>
                <div>
                  <h3 className="text-xs font-bold text-white mb-0.5">At Your Pace</h3>
                  <p className="text-[11px] text-slate-400 leading-snug">Small daily sessions that fit your routine.</p>
                </div>
              </div>

              <div className="footer-perk-card flex items-start gap-2.5 p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
                <span className="text-cyan-400 text-base leading-none shrink-0 mt-0.5">📚</span>
                <div>
                  <h3 className="text-xs font-bold text-white mb-0.5">All-In-One Desk</h3>
                  <p className="text-[11px] text-slate-400 leading-snug">Notes, cards, and roadmaps in one place.</p>
                </div>
              </div>

              <div className="footer-perk-card flex items-start gap-2.5 p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
                <span className="text-emerald-400 text-base leading-none shrink-0 mt-0.5">🌿</span>
                <div>
                  <h3 className="text-xs font-bold text-white mb-0.5">Zero Clutter</h3>
                  <p className="text-[11px] text-slate-400 leading-snug">Clean design that respects your focus.</p>
                </div>
              </div>
            </div>

            {/* Quick Navigation Links */}
            <nav className="footer-nav-strip flex flex-wrap items-center gap-2 sm:gap-3 pt-3" aria-label="Footer navigation">
              {navLinks.map((item) => (
                <button
                  key={item.page}
                  type="button"
                  onClick={() => go?.(item.page)}
                  className="footer-nav-btn text-xs font-medium text-slate-300 hover:text-cyan-300 px-3 py-1.5 rounded-lg hover:bg-white/[0.06] transition-colors cursor-pointer"
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </div>

        </div>

        {/* Bottom Bar: Copyright & Back to Top */}
        <div className="footer-bottom-bar flex flex-col sm:flex-row items-center justify-between gap-4 pt-10 mt-12 border-t border-white/[0.08]">
          <p className="text-xs text-slate-400 font-medium text-center sm:text-left">
            © {new Date().getFullYear()} Drizzlearn. Made with care for curious minds everywhere.
          </p>

          <button
            type="button"
            onClick={scrollToTop}
            className="footer-back-to-top flex items-center gap-2 text-xs font-mono font-semibold text-slate-400 hover:text-white px-3.5 py-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.06] transition-all cursor-pointer"
            aria-label="Back to top of page"
          >
            <span>Back to top</span>
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 15l-6-6-6 6" />
            </svg>
          </button>
        </div>
      </div>
    </footer>
  );
}

export default AppFooter;
