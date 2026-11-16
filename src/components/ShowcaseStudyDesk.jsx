import React from 'react';

export function ShowcaseStudyDesk() {
  return (
    <div className="study-desk-showcase-panel relative flex flex-col overflow-hidden" aria-label="Virtual Learner Workspace Showcase">
      {/* Ambient Room Glow Behind Desk */}
      <div className="study-desk-ambient-halo" aria-hidden="true" />

      {/* Isometric / 3D Vector Isometric Illustration of the Study Desk */}
      <div className="study-desk-scene-container relative flex items-center justify-center p-3">
        <svg
          className="study-desk-svg w-full h-auto select-none"
          viewBox="0 0 540 370"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            {/* Monitor Bezel Gradient */}
            <linearGradient id="monitorBezel" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#1e293b" />
              <stop offset="50%" stopColor="#0f172a" />
              <stop offset="100%" stopColor="#020617" />
            </linearGradient>

            {/* Stand Gradient */}
            <linearGradient id="metalStand" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#94a3b8" />
              <stop offset="50%" stopColor="#475569" />
              <stop offset="100%" stopColor="#1e293b" />
            </linearGradient>

            {/* Desk Surface Gradient */}
            <linearGradient id="deskWood" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#1e1b18" />
              <stop offset="50%" stopColor="#292524" />
              <stop offset="100%" stopColor="#1c1917" />
            </linearGradient>

            {/* Desk Bevel Edge Gradient */}
            <linearGradient id="deskBevel" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#44403c" />
              <stop offset="100%" stopColor="#1c1917" />
            </linearGradient>

            {/* Lamp Metal Gradient */}
            <linearGradient id="lampGold" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fef08a" />
              <stop offset="60%" stopColor="#eab308" />
              <stop offset="100%" stopColor="#854d0e" />
            </linearGradient>

            {/* Warm Lamp Light Cone Radial Gradient */}
            <radialGradient id="lampGlowCone" cx="45%" cy="30%" r="70%">
              <stop offset="0%" stopColor="rgba(254, 240, 138, 0.45)" />
              <stop offset="35%" stopColor="rgba(234, 179, 8, 0.22)" />
              <stop offset="70%" stopColor="rgba(234, 179, 8, 0.06)" />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>

            {/* Screen Glow Radial Gradient */}
            <radialGradient id="screenAmbientGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(56, 189, 248, 0.35)" />
              <stop offset="60%" stopColor="rgba(14, 165, 233, 0.12)" />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>

            {/* Plant Pot Gradient */}
            <linearGradient id="potGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#b45309" />
              <stop offset="50%" stopColor="#d97706" />
              <stop offset="100%" stopColor="#78350f" />
            </linearGradient>

            {/* Coffee Mug Gradient */}
            <linearGradient id="mugGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="70%" stopColor="#0284c7" />
              <stop offset="100%" stopColor="#0369a1" />
            </linearGradient>

            {/* Keyboard Plate */}
            <linearGradient id="keyboardGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#334155" />
              <stop offset="100%" stopColor="#0f172a" />
            </linearGradient>
          </defs>

          {/* ================= BACKGROUND LAMP LIGHT CONE ================= */}
          <path
            d="M80 82 L0 320 L270 320 Z"
            fill="url(#lampGlowCone)"
            style={{ mixBlendMode: 'screen' }}
          />

          {/* ================= MONITOR AMBIENT ROOM CAST ================= */}
          <ellipse cx="280" cy="160" rx="190" ry="110" fill="url(#screenAmbientGlow)" style={{ mixBlendMode: 'screen' }} />

          {/* ================= DESK SURFACE ================= */}
          {/* Desk Main Top Surface */}
          <path
            d="M 20 250 L 520 250 L 540 310 L 0 310 Z"
            fill="url(#deskWood)"
            stroke="rgba(255, 255, 255, 0.08)"
            strokeWidth="1"
          />
          {/* Desk Front Edge Bevel */}
          <path
            d="M 0 310 L 540 310 L 540 330 L 0 330 Z"
            fill="url(#deskBevel)"
            stroke="rgba(0, 0, 0, 0.6)"
            strokeWidth="1"
          />
          {/* Desk Shadow Below */}
          <path d="M 0 330 L 540 330 L 520 360 L 20 360 Z" fill="rgba(0, 0, 0, 0.6)" filter="blur(6px)" />

          {/* Desk Mat (Wool felt desk pad under keyboard & mouse) */}
          <rect x="130" y="258" width="280" height="46" rx="6" fill="#0b111a" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />

          {/* ================= ARCHITECTURAL DESK LAMP (Left) ================= */}
          {/* Heavy Base */}
          <ellipse cx="78" cy="275" rx="22" ry="7" fill="url(#lampGold)" stroke="#713f12" strokeWidth="1" />
          <ellipse cx="78" cy="273" rx="18" ry="5" fill="#fef08a" opacity="0.4" />

          {/* Lower Stem (Hinged double strut) */}
          <line x1="74" y1="272" x2="62" y2="175" stroke="#ca8a04" strokeWidth="3.5" strokeLinecap="round" />
          <line x1="82" y1="272" x2="70" y2="175" stroke="#a16207" strokeWidth="2.5" strokeLinecap="round" />

          {/* Mid Joint Pivot Knob */}
          <circle cx="66" cy="175" r="5" fill="#fef08a" stroke="#854d0e" strokeWidth="1.5" />

          {/* Upper Arm angled over the desk */}
          <line x1="66" y1="175" x2="105" y2="108" stroke="#eab308" strokeWidth="3" strokeLinecap="round" />

          {/* Upper Head Swivel Joint */}
          <circle cx="105" cy="108" r="4.5" fill="#fef08a" stroke="#854d0e" strokeWidth="1.5" />

          {/* Lamp Shade Cone */}
          <path
            d="M 103 108 L 138 126 L 118 144 L 88 124 Z"
            fill="url(#lampGold)"
            stroke="#854d0e"
            strokeWidth="1"
          />
          {/* Glowing Inner Bulb Aperture */}
          <ellipse cx="128" cy="135" rx="14" ry="7" fill="#ffffff" filter="drop-shadow(0 0 8px #fef08a)" />

          {/* ================= COMPUTER MONITOR (Center) ================= */}
          {/* Monitor Aluminum Pedestal Base */}
          <path d="M 235 272 L 325 272 L 315 264 L 245 264 Z" fill="url(#metalStand)" stroke="rgba(255,255,255,0.15)" strokeWidth="0.8" />
          {/* Monitor Center Stem */}
          <rect x="272" y="195" width="16" height="70" rx="2" fill="url(#metalStand)" />

          {/* Monitor Outer Casing (Modern Ultra-thin Bezel) */}
          <rect
            x="145"
            y="52"
            width="270"
            height="158"
            rx="8"
            fill="url(#monitorBezel)"
            stroke="rgba(255, 255, 255, 0.15)"
            strokeWidth="1.5"
            filter="drop-shadow(0 14px 28px rgba(0,0,0,0.8))"
          />

          {/* Monitor Screen Glass (Where Drizzlearn is Open) */}
          <rect x="151" y="58" width="258" height="146" rx="5" fill="#040810" />

          {/* ================= DRIZZLEARN UI SHOWN ON SCREEN ================= */}
          {/* Top Navbar */}
          <rect x="151" y="58" width="258" height="15" fill="#0a101d" />
          {/* Mini Paperclip Brand Logo */}
          <path d="M 158 64 Q 158 61 161 61 Q 164 61 164 64 L 164 70 Q 164 72 161 72 Q 158 72 158 70 Z" stroke="#38bdf8" strokeWidth="0.8" fill="none" />
          <text x="167" y="69.5" fill="#f8fafc" fontSize="5.5" fontWeight="800" fontFamily="Space Grotesk, sans-serif" letterSpacing="0.4">DRIZZLEARN</text>
          
          {/* Mini Topbar Active Home Pill */}
          <rect x="238" y="61.5" width="24" height="8" rx="4" fill="rgba(56, 189, 248, 0.2)" stroke="rgba(56, 189, 248, 0.4)" strokeWidth="0.5" />
          <text x="250" y="67.5" fill="#38bdf8" fontSize="4.5" fontWeight="700" textAnchor="middle" fontFamily="Space Grotesk">Home</text>
          {/* User Avatar Circle */}
          <circle cx="398" cy="65.5" r="3.5" fill="rgba(56, 189, 248, 0.3)" stroke="#38bdf8" strokeWidth="0.6" />
          <text x="398" y="67" fill="#ffffff" fontSize="3" fontWeight="bold" textAnchor="middle">HT</text>

          {/* Screen Content: Hero Prompt Bar */}
          <rect x="180" y="78" width="200" height="13" rx="4" fill="rgba(15, 23, 42, 0.9)" stroke="rgba(56, 189, 248, 0.25)" strokeWidth="0.5" />
          <text x="188" y="86.5" fill="#94a3b8" fontSize="4.2" fontFamily="Space Grotesk">✦ Mastering English Tenses for Daily Communication</text>
          <rect x="345" y="80" width="32" height="9" rx="3" fill="#38bdf8" />
          <text x="361" y="86" fill="#020617" fontSize="3.8" fontWeight="bold" textAnchor="middle" fontFamily="Space Grotesk">Generate ↗</text>

          {/* 4 Feature Cards on Screen */}
          {/* Card 1: Roadmap */}
          <rect x="160" y="97" width="56" height="42" rx="4" fill="#0b1320" stroke="rgba(16, 185, 129, 0.3)" strokeWidth="0.5" />
          <circle cx="168" cy="105" r="3" fill="rgba(16, 185, 129, 0.2)" />
          <text x="165" y="132" fill="#e2e8f0" fontSize="4" fontWeight="bold" fontFamily="Space Grotesk">Roadmap</text>
          <text x="165" y="136" fill="#64748b" fontSize="3" fontFamily="Space Grotesk">Structured path</text>

          {/* Card 2: Flashcards (Highlighted with Cyan Glow) */}
          <rect x="222" y="95" width="56" height="44" rx="4" fill="#0e1b2f" stroke="#38bdf8" strokeWidth="0.8" filter="drop-shadow(0 0 4px rgba(56,189,248,0.4))" />
          <circle cx="230" cy="103" r="3" fill="rgba(56, 189, 248, 0.3)" />
          <rect x="260" y="100" width="14" height="6" rx="2" fill="rgba(56, 189, 248, 0.25)" />
          <text x="267" y="104.5" fill="#38bdf8" fontSize="3" fontWeight="bold" textAnchor="middle">78 due</text>
          <text x="227" y="132" fill="#ffffff" fontSize="4" fontWeight="bold" fontFamily="Space Grotesk">Flashcards</text>
          <text x="227" y="136" fill="#38bdf8" fontSize="3" fontFamily="Space Grotesk">Active recall</text>

          {/* Card 3: AI Notes */}
          <rect x="284" y="97" width="56" height="42" rx="4" fill="#0b1320" stroke="rgba(168, 85, 247, 0.3)" strokeWidth="0.5" />
          <circle cx="292" cy="105" r="3" fill="rgba(168, 85, 247, 0.2)" />
          <text x="289" y="132" fill="#e2e8f0" fontSize="4" fontWeight="bold" fontFamily="Space Grotesk">AI Notes</text>
          <text x="289" y="136" fill="#64748b" fontSize="3" fontFamily="Space Grotesk">Lesson ideas</text>

          {/* Card 4: Practice */}
          <rect x="346" y="97" width="56" height="42" rx="4" fill="#0b1320" stroke="rgba(59, 130, 246, 0.3)" strokeWidth="0.5" />
          <circle cx="354" cy="105" r="3" fill="rgba(59, 130, 246, 0.2)" />
          <text x="351" y="132" fill="#e2e8f0" fontSize="4" fontWeight="bold" fontFamily="Space Grotesk">Practice</text>
          <text x="351" y="136" fill="#64748b" fontSize="3" fontFamily="Space Grotesk">Tests & studio</text>

          {/* Dashboard Mini Blocks at bottom of screen */}
          {/* Left Course Progress Bar on screen */}
          <rect x="160" y="145" width="142" height="48" rx="4" fill="#090f1a" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
          <circle cx="178" cy="168" r="14" fill="#0f172a" stroke="#38bdf8" strokeWidth="0.8" />
          <text x="178" y="170" fill="#38bdf8" fontSize="5" fontWeight="bold" textAnchor="middle">4%</text>
          <text x="198" y="162" fill="#ffffff" fontSize="4.2" fontWeight="bold">Current Course</text>
          <rect x="198" y="168" width="80" height="3" rx="1.5" fill="#1e293b" />
          <rect x="198" y="168" width="16" height="3" rx="1.5" fill="#38bdf8" />

          {/* Right Progress Graph on screen */}
          <rect x="310" y="145" width="92" height="48" rx="4" fill="#090f1a" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
          <path d="M 318 178 Q 335 155 355 170 T 392 160" stroke="#f43f5e" strokeWidth="1.2" fill="none" />
          <text x="318" y="156" fill="#94a3b8" fontSize="3.8" fontWeight="bold">Your Velocity</text>

          {/* Screen Light Glare Reflection Line */}
          <path d="M 152 59 L 230 59 L 170 203 L 152 203 Z" fill="rgba(255, 255, 255, 0.025)" />

          {/* ================= KEYBOARD & MOUSE ================= */}
          {/* Slim Aluminum Keyboard */}
          <rect x="190" y="266" width="140" height="26" rx="3" fill="url(#keyboardGrad)" stroke="rgba(255,255,255,0.12)" strokeWidth="0.8" />
          {/* Key Rows Texture */}
          {[...Array(4)].map((_, r) => (
            <line
              key={r}
              x1="195"
              y1={271 + r * 5}
              x2="325"
              y2={271 + r * 5}
              stroke="rgba(255,255,255,0.15)"
              strokeWidth="2.5"
              strokeDasharray="4 2"
            />
          ))}

          {/* Precision Mouse */}
          <rect x="350" y="268" width="18" height="24" rx="9" fill="#1e293b" stroke="rgba(255,255,255,0.15)" strokeWidth="0.8" />
          <line x1="359" y1="268" x2="359" y2="277" stroke="#38bdf8" strokeWidth="0.8" />

          {/* ================= DESK ACCESSORIES ================= */}
          {/* Ceramic Coffee Mug (Right) */}
          <ellipse cx="440" cy="272" rx="10" ry="3.5" fill="rgba(0,0,0,0.5)" filter="blur(2px)" />
          <rect x="432" y="252" width="16" height="20" rx="3" fill="url(#mugGrad)" stroke="rgba(255,255,255,0.15)" strokeWidth="0.8" />
          {/* Mug Handle */}
          <path d="M 448 256 Q 454 262 448 268" stroke="#0284c7" strokeWidth="2.5" fill="none" />
          {/* Steaming Coffee Vapor */}
          <path d="M 437 248 Q 439 242 437 236" stroke="rgba(255,255,255,0.25)" strokeWidth="1" strokeLinecap="round" fill="none" />
          <path d="M 443 249 Q 441 243 444 237" stroke="rgba(255,255,255,0.25)" strokeWidth="1" strokeLinecap="round" fill="none" />

          {/* Potted Succulent Plant (Far Right) */}
          <ellipse cx="485" cy="268" rx="12" ry="4" fill="rgba(0,0,0,0.5)" filter="blur(2px)" />
          {/* Terracotta Pot */}
          <path d="M 474 256 L 496 256 L 492 270 L 478 270 Z" fill="url(#potGrad)" stroke="#78350f" strokeWidth="0.8" />
          {/* Succulent Leaves */}
          <circle cx="485" cy="251" r="5" fill="#10b981" />
          <circle cx="480" cy="253" r="4.5" fill="#059669" />
          <circle cx="490" cy="253" r="4.5" fill="#34d399" />
          <circle cx="485" cy="246" r="3.5" fill="#6ee7b7" />

          {/* Small Sticky Notes on Desk (Left of Keyboard) */}
          <rect x="145" y="268" width="22" height="20" rx="2" fill="#fef08a" stroke="#ca8a04" strokeWidth="0.5" transform="rotate(-6 145 268)" />
          <line x1="148" y1="274" x2="162" y2="274" stroke="#854d0e" strokeWidth="0.8" opacity="0.6" />
          <line x1="148" y1="278" x2="160" y2="278" stroke="#854d0e" strokeWidth="0.8" opacity="0.6" />
        </svg>
      </div>

      {/* Showcase Bottom Badge */}
      <div className="study-desk-footer-bar flex items-center justify-between px-5 py-2.5 border-t border-white/5 bg-slate-900/50">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-semibold text-slate-300 font-mono tracking-wide">STUDY STATION • ACTIVE</span>
        </div>
        <span className="text-[11px] font-mono text-learnos-muted">DRIZZLEARN WORKSPACE 2.0</span>
      </div>
    </div>
  );
}
