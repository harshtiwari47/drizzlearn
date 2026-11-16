import React, { useEffect } from "react";
import { Icon } from "./common.jsx";

/**
 * MobileNavDrawer
 * 
 * Slide-over frosted glass navigation drawer for mobile & tablet screens.
 * Provides accessible navigation for Workspace items and Study Tools when
 * the topbar header-nav is collapsed on smaller screens.
 */
export function MobileNavDrawer({
  isOpen,
  onClose,
  primaryNavItems = [],
  toolNavItems = [],
  activeNav,
  go,
  user,
  settings,
  openAccount
}) {
  // Close drawer on Escape key press
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        onClose?.();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Lock body scroll while drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleNavClick = (name) => {
    onClose?.();
    go?.(name);
  };

  const displayName = user?.fullName || settings?.fullName || "Guest Learner";
  const initials = (displayName || "?")
    .split(/\s+/)
    .map((x) => x[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="mobile-nav-drawer-root fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Navigation Menu">
      {/* Backdrop Scrim with Blur */}
      <div
        className="mobile-nav-drawer-scrim fixed inset-0 bg-black/65 backdrop-blur-md transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over Drawer Panel */}
      <div className="mobile-nav-drawer-panel relative z-10 w-[290px] max-w-[85vw] h-full flex flex-col p-5 bg-[#09101a]/95 border-r border-white/10 backdrop-blur-2xl shadow-2xl overflow-y-auto">
        {/* Drawer Header with Drizzlearn Logo and Close Button */}
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <span className="brand-mark grid place-items-center text-cyan-400 font-bold text-lg">✦</span>
            <div className="brand-logo-text">
              <span className="brand-text-drizz">DRIZZ</span>
              <span className="brand-text-learn">LEARN</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="drawer-close-btn p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Close menu"
            title="Close menu"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Navigation Sections */}
        <div className="flex flex-col gap-5 flex-1">
          {/* Workspace Links */}
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-3 mb-2 font-mono">
              Workspace
            </div>
            <nav className="flex flex-col gap-1" aria-label="Workspace navigation">
              {primaryNavItems.map(([name, label, glyph]) => {
                const isActive = activeNav === name;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => handleNavClick(name)}
                    className={`drawer-nav-item flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all text-left w-full cursor-pointer ${
                      isActive
                        ? "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-semibold shadow-xs shadow-cyan-500/10"
                        : "text-slate-300 hover:text-white hover:bg-white/5 border border-transparent"
                    }`}
                  >
                    <Icon name={glyph} size={18} />
                    <span>{label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Study Tools Links */}
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-3 mb-2 font-mono">
              Study Tools
            </div>
            <nav className="flex flex-col gap-1" aria-label="Study tools navigation">
              {toolNavItems.map(([name, label, glyph]) => {
                const isActive = activeNav === name;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => handleNavClick(name)}
                    className={`drawer-nav-item flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all text-left w-full cursor-pointer ${
                      isActive
                        ? "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-semibold shadow-xs shadow-cyan-500/10"
                        : "text-slate-300 hover:text-white hover:bg-white/5 border border-transparent"
                    }`}
                  >
                    <Icon name={glyph} size={18} />
                    <span>{label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </div>

        {/* Drawer Footer with Account & Settings */}
        <div className="pt-4 mt-auto border-t border-white/10 flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              onClose?.();
              if (user) go("settings");
              else openAccount?.();
            }}
            className="flex items-center gap-2.5 text-xs text-slate-300 hover:text-white transition-colors"
          >
            <div className="avatar w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold bg-linear-to-br from-cyan-400 to-blue-500 text-slate-950">
              {initials}
            </div>
            <span className="font-medium max-w-[120px] truncate">{displayName}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              onClose?.();
              go?.("settings");
            }}
            className="text-xs text-slate-400 hover:text-cyan-300 font-mono transition-colors"
          >
            Settings
          </button>
        </div>
      </div>
    </div>
  );
}

export default MobileNavDrawer;
