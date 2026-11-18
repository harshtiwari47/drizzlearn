import React, { useState, useMemo } from "react";
import { Icon, Panel, emptyWorkspace, LOCAL_STORAGE_KEY, LEGACY_STORAGE_KEY } from "../components/common.jsx";
import { AiEngineRagPanel } from "./TutorPage.jsx";

const COMMON_TIMEZONES = [
  "UTC",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Africa/Lagos",
  "America/Anchorage",
  "America/Argentina/Buenos_Aires",
  "America/Bogota",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Mexico_City",
  "America/New_York",
  "America/Phoenix",
  "America/Santiago",
  "America/Sao_Paulo",
  "America/Toronto",
  "America/Vancouver",
  "Asia/Bangkok",
  "Asia/Calcutta",
  "Asia/Dubai",
  "Asia/Hong_Kong",
  "Asia/Jakarta",
  "Asia/Jerusalem",
  "Asia/Karachi",
  "Asia/Kathmandu",
  "Asia/Kolkata",
  "Asia/Kuala_Lumpur",
  "Asia/Manila",
  "Asia/Riyadh",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Taipei",
  "Asia/Tokyo",
  "Australia/Melbourne",
  "Australia/Perth",
  "Australia/Sydney",
  "Europe/Amsterdam",
  "Europe/Berlin",
  "Europe/Dublin",
  "Europe/Istanbul",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Paris",
  "Europe/Rome",
  "Europe/Zurich",
  "Pacific/Auckland",
  "Pacific/Honolulu"
];

function getAllTimezones() {
  let list = [];
  try {
    if (typeof Intl !== "undefined" && typeof Intl.supportedValuesOf === "function") {
      list = Intl.supportedValuesOf("timeZone");
    }
  } catch (_) {}
  return Array.from(new Set(["UTC", "Asia/Kolkata", ...COMMON_TIMEZONES, ...list])).sort((a, b) => a.localeCompare(b));
}

const ALL_TIMEZONES = getAllTimezones();

function SettingsPage(p) {
  const [saved, setSaved] = useState(false);
  const [name, setName] = useState(p.data?.settings?.fullName || p.user?.fullName || "");
  const [timezone, setTimezone] = useState(p.data?.settings?.timezone || "UTC");
  const [weekly, setWeekly] = useState(p.data?.settings?.weeklyMinutes || 360);
  const [session, setSession] = useState(p.data?.settings?.sessionMinutes || 120);
  const [days, setDays] = useState(p.data?.settings?.preferredStudyDays || []);
  const [studyNotify, setStudyNotify] = useState(Boolean(p.data?.settings?.notificationPreferences?.study));
  const [reviewNotify, setReviewNotify] = useState(Boolean(p.data?.settings?.notificationPreferences?.review));
  const [deletingAccount, setDeletingAccount] = useState(false);

  const coursesCount = p.data?.courses?.length || 0;
  const activeCoursesCount = p.data?.courses?.filter(c => c.status === "active")?.length || 0;
  const flashcardsCount = p.data?.flashcards?.length || 0;
  const notesCount = p.data?.notes?.length || 0;
  const pendingTasksCount = p.data?.tasks?.filter(t => t.status !== "completed")?.length || 0;

  const displayName = name || p.user?.fullName || "Learner";
  const userInitials = (displayName || "L")
    .split(/\s+/)
    .map(x => x[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  async function save(e) {
    e.preventDefault();
    const settings = {
      fullName: name,
      timezone,
      weeklyMinutes: Number(weekly),
      sessionMinutes: Number(session),
      preferredStudyDays: days,
      notificationPreferences: { study: studyNotify, review: reviewNotify }
    };
    try {
      if (p.remote) {
        const result = await p.request("settings", { method: "PUT", body: JSON.stringify(settings) });
        settings.fullName = result.user.fullName;
      }
      p.updateData(d => ({ ...d, settings: { ...d.settings, ...settings } }));
      setSaved(true);
      p.flashToast("Settings saved.");
      setTimeout(() => setSaved(false), 2400);
    } catch (error) {
      p.flashToast(error.message);
    }
  }

  function exportWorkspace() {
    const payload = { exportedAt: new Date().toISOString(), workspace: p.data };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "drizzlearn-workspace.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function toggleDay(day) {
    setDays(current => current.includes(day) ? current.filter(d => d !== day) : [...current, day].sort());
  }

  async function deleteAccount() {
    if (!confirm("Are you sure you want to delete your account? This will permanently delete all your courses, tasks, notes, and learning evidence. This action cannot be undone.")) return;
    setDeletingAccount(true);
    try {
      if (p.remote) {
        const password = prompt("Enter your account password to confirm permanent deletion:");
        if (!password) return;
        try {
          await p.request("settings/account", { method: "DELETE", body: JSON.stringify({ password }) });
          if (p.setUser) p.setUser(null);
          if (p.setRemote) p.setRemote(false);
          if (p.setData) p.setData(emptyWorkspace());
          p.flashToast("Account permanently deleted.");
          p.go("home");
        } catch (error) {
          p.flashToast(error.message || "Could not delete account.");
        }
      } else {
        localStorage.removeItem(LOCAL_STORAGE_KEY);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        if (p.setData) p.setData(emptyWorkspace());
        p.flashToast("Local workspace deleted.");
        p.go("home");
      }
    } finally {
      setDeletingAccount(false);
    }
  }

  return (
    <div className="profile-page-wrapper">
      {/* Top Header Bar with Circular Back Button */}
      <header className="profile-top-bar">
        <div className="profile-top-left">
          <button
            type="button"
            className="profile-circle-back-btn"
            onClick={() => p.go("home")}
            aria-label="Back to home"
            title="Back to home"
          >
            <Icon name="arrowLeft" size={19} />
          </button>
          <div className="profile-top-title-group">
            <span className="profile-kicker-pill">LEARNER PROFILE &amp; PREFERENCES</span>
            <h1 className="profile-top-heading">Learner Profile</h1>
          </div>
        </div>
        <div className="profile-top-right">
          <div className={`profile-sync-indicator ${p.remote ? "synced" : "local"}`}>
            <span className="sync-pulse-dot" />
            <span>{p.remote ? "Cloud Synced" : "Local Workspace"}</span>
          </div>
        </div>
      </header>

      {/* Signature Pink & Blue Aurora Hero Card */}
      <section className="profile-hero-card" aria-label="Learner Profile Summary">
        {/* Ambient Radial Mesh Glows */}
        <div className="profile-aurora-glow glow-pink" />
        <div className="profile-aurora-glow glow-blue" />
        <div className="profile-aurora-glow glow-violet" />

        <div className="profile-hero-main-row">
          {/* Avatar Showcase with Pink/Blue Luminous Ring */}
          <div className="profile-avatar-container">
            <div className="profile-avatar-ring">
              <div className="profile-avatar-core">
                <span className="profile-avatar-initials">{userInitials}</span>
                <span className="profile-avatar-flower-badge" title="Drizzlearn Active Scholar">🌸</span>
              </div>
            </div>
            <span className="profile-status-badge">✦ Active</span>
          </div>

          {/* Identity & Display Details */}
          <div className="profile-identity-details">
            <div className="profile-identity-top-row">
              <span className="profile-role-chip">
                <Icon name="spark" size={12} />
                <span>Drizzlearn Scholar</span>
              </span>
              {p.user?.email && (
                <span className="profile-email-chip" title={p.user.email}>
                  {p.user.email}
                </span>
              )}
            </div>

            <h2 className="profile-display-name">{displayName}</h2>

            {/* Frosted Tag Capsules (Inspired by Angela Robinson / Sarah Connor) */}
            <div className="profile-tag-capsules">
              <span className="profile-capsule-tag capsule-pink">
                <Icon name="clock" size={13} />
                <span>{session}m Focus Rhythm</span>
              </span>
              <span className="profile-capsule-tag capsule-blue">
                <Icon name="progress" size={13} />
                <span>{Math.round(weekly / 60 * 10) / 10}h Weekly Target</span>
              </span>
              <span className="profile-capsule-tag capsule-violet">
                <Icon name="calendar" size={13} />
                <span>{days.length || 7} Days / Week</span>
              </span>
              <span className="profile-capsule-tag capsule-cyan">
                <Icon name="book" size={13} />
                <span>{coursesCount} {coursesCount === 1 ? "Track" : "Tracks"}</span>
              </span>
            </div>
          </div>
        </div>

        {/* Floating Quick Stats Cards Row */}
        <div className="profile-hero-stats-grid">
          <div className="profile-hero-stat-card card-pink">
            <div className="stat-card-header">
              <span className="stat-icon-tile icon-pink"><Icon name="clock" size={14} /></span>
              <span className="stat-label">Weekly Budget</span>
            </div>
            <strong className="stat-value">{Math.round(weekly / 60 * 10) / 10}h</strong>
            <small className="stat-caption">{weekly}m planned cadence</small>
            <div className="stat-accent-bar bar-pink" />
          </div>

          <div className="profile-hero-stat-card card-blue">
            <div className="stat-card-header">
              <span className="stat-icon-tile icon-blue"><Icon name="play" size={14} /></span>
              <span className="stat-label">Focus Session</span>
            </div>
            <strong className="stat-value">{session}m</strong>
            <small className="stat-caption">Optimal Pomodoro rhythm</small>
            <div className="stat-accent-bar bar-blue" />
          </div>

          <div className="profile-hero-stat-card card-violet">
            <div className="stat-card-header">
              <span className="stat-icon-tile icon-violet"><Icon name="cards" size={14} /></span>
              <span className="stat-label">Spaced Retention</span>
            </div>
            <strong className="stat-value">{flashcardsCount}</strong>
            <small className="stat-caption">Cards in memory loop</small>
            <div className="stat-accent-bar bar-violet" />
          </div>

          <div className="profile-hero-stat-card card-cyan">
            <div className="stat-card-header">
              <span className="stat-icon-tile icon-cyan"><Icon name="book" size={14} /></span>
              <span className="stat-label">Active Tracks</span>
            </div>
            <strong className="stat-value">{coursesCount}</strong>
            <small className="stat-caption">{pendingTasksCount} pending steps</small>
            <div className="stat-accent-bar bar-cyan" />
          </div>
        </div>
      </section>

      {/* Main Settings & Preferences Content Grid */}
      <div className="profile-content-grid">
        {/* Left Column: Primary Preferences Form */}
        <div className="profile-main-col">
          <form className="profile-glass-card profile-form-card" onSubmit={save}>
            <div className="profile-card-head">
              <div className="card-head-title">
                <span className="card-head-icon-box"><Icon name="tutor" size={16} /></span>
                <div>
                  <h3>Learner Preferences</h3>
                  <p>Fine-tune your personal identity, focus schedule, and reminders.</p>
                </div>
              </div>
            </div>

            <div className="profile-form-body">
              <div className="profile-form-two-col">
                <label className="profile-field-label">
                  <span className="label-text">Display name</span>
                  <input
                    className="profile-text-input"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Your name"
                    minLength="2"
                  />
                </label>

                <label className="profile-field-label">
                  <span className="label-text">Email address</span>
                  <input
                    className="profile-text-input"
                    value={p.user?.email || ""}
                    placeholder="Sign in to attach an email"
                    readOnly
                  />
                  <small className="label-helper-text">
                    {p.remote ? "Primary account email (cloud verified)" : "Sign in to associate an email account"}
                  </small>
                </label>
              </div>

              <label className="profile-field-label">
                <span className="label-text">Time zone</span>
                <select
                  className="profile-select-input"
                  value={timezone}
                  onChange={e => setTimezone(e.target.value)}
                >
                  {!ALL_TIMEZONES.includes(timezone) && <option key={timezone} value={timezone}>{timezone}</option>}
                  {ALL_TIMEZONES.map(tz => (
                    <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
                  ))}
                </select>
                <small className="label-helper-text">Used to schedule your daily review milestones.</small>
              </label>

              {/* Weekly Study Rhythm Section */}
              <div className="profile-sub-section">
                <div className="sub-section-header">
                  <span className="sub-section-icon"><Icon name="clock" size={14} /></span>
                  <div>
                    <h4>Study Rhythm &amp; Time Budget</h4>
                    <p>Course roadmaps adapt around the exact study blocks you allocate.</p>
                  </div>
                </div>

                <div className="profile-form-two-col">
                  <label className="profile-field-label">
                    <span className="label-text">Weekly study budget (minutes)</span>
                    <input
                      className="profile-text-input"
                      type="number"
                      min="30"
                      max="2400"
                      step="30"
                      value={weekly}
                      onChange={e => setWeekly(e.target.value)}
                    />
                    <small className="label-helper-text">~{Math.round(weekly / 60 * 10) / 10} hours every week</small>
                  </label>

                  <label className="profile-field-label">
                    <span className="label-text">Session length (minutes)</span>
                    <input
                      className="profile-text-input"
                      type="number"
                      min="15"
                      max="240"
                      step="5"
                      value={session}
                      onChange={e => setSession(e.target.value)}
                    />
                    <small className="label-helper-text">Recommended: 25m or 50m Pomodoro</small>
                  </label>
                </div>
              </div>

              {/* Preferred Study Days Section */}
              <div className="profile-sub-section">
                <div className="sub-section-header">
                  <span className="sub-section-icon"><Icon name="calendar" size={14} /></span>
                  <div>
                    <h4>Preferred Study Days</h4>
                    <p>Select which days you want study sessions planned.</p>
                  </div>
                </div>

                <div className="profile-day-picker" role="group" aria-label="Preferred study days">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, i) => {
                    const isSelected = days.includes(i);
                    return (
                      <button
                        key={day}
                        type="button"
                        className={`profile-day-chip ${isSelected ? "selected" : ""}`}
                        onClick={() => toggleDay(i)}
                        aria-pressed={isSelected}
                      >
                        <span className="day-name">{day}</span>
                        {isSelected && <span className="day-check">✓</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Notification Preferences */}
              <div className="profile-sub-section">
                <div className="sub-section-header">
                  <span className="sub-section-icon"><Icon name="spark" size={14} /></span>
                  <div>
                    <h4>Smart Notifications</h4>
                    <p>Gentle nudges before planned study rhythms and spaced review windows.</p>
                  </div>
                </div>

                <div className="profile-toggles-list">
                  <label className="profile-toggle-card">
                    <div className="toggle-text-group">
                      <strong>Study session reminders</strong>
                      <small>Notifies you right before an allocated focus session begins.</small>
                    </div>
                    <input
                      type="checkbox"
                      className="profile-toggle-switch"
                      checked={studyNotify}
                      onChange={e => setStudyNotify(e.target.checked)}
                    />
                  </label>

                  <label className="profile-toggle-card">
                    <div className="toggle-text-group">
                      <strong>Spaced review alerts</strong>
                      <small>Reminds you when retention flashcards reach memory checkpoints.</small>
                    </div>
                    <input
                      type="checkbox"
                      className="profile-toggle-switch"
                      checked={reviewNotify}
                      onChange={e => setReviewNotify(e.target.checked)}
                    />
                  </label>
                </div>
              </div>

              {/* Save Submit Button */}
              <div className="profile-form-footer">
                <button className="profile-save-btn" type="submit">
                  {saved ? (
                    <><span className="save-check">✓</span> Changes Saved</>
                  ) : (
                    "Save Preferences"
                  )}
                </button>
              </div>
            </div>
          </form>
        </div>

        {/* Right Column: Account, Data Backups & AI Engine */}
        <div className="profile-side-col">
          {/* Account & Security Card */}
          <div className="profile-glass-card profile-side-card">
            <div className="profile-card-head">
              <div className="card-head-title">
                <span className="card-head-icon-box"><Icon name="people" size={16} /></span>
                <div>
                  <h3>Account &amp; Security</h3>
                  <p>{p.remote ? "Signed in with cloud sync" : "Running on local device storage"}</p>
                </div>
              </div>
            </div>

            <div className="profile-side-card-body">
              <div className="account-user-banner">
                <div className="account-user-avatar">{userInitials}</div>
                <div className="account-user-meta">
                  <strong>{p.user?.fullName || displayName}</strong>
                  <span>{p.user?.email || "Guest Learner"}</span>
                </div>
              </div>

              <div className="account-action-row">
                {p.remote ? (
                  <button type="button" className="profile-action-btn secondary" onClick={p.logout}>
                    Sign out ↗
                  </button>
                ) : (
                  <button type="button" className="profile-action-btn primary" onClick={p.openAccount}>
                    Sign in or create account ↗
                  </button>
                )}
              </div>

              <div className="account-danger-zone">
                <div className="danger-zone-copy">
                  <small>Permanently delete your account and wipe all courses, notes, and retention data.</small>
                </div>
                <button
                  className="profile-danger-btn"
                  type="button"
                  disabled={deletingAccount}
                  onClick={deleteAccount}
                >
                  {deletingAccount ? <><span className="btn-spinner" /> Deleting…</> : "Delete account"}
                </button>
              </div>
            </div>
          </div>

          {/* Workspace Data & Backups */}
          <div className="profile-glass-card profile-side-card">
            <div className="profile-card-head">
              <div className="card-head-title">
                <span className="card-head-icon-box"><Icon name="notes" size={16} /></span>
                <div>
                  <h3>Workspace Data</h3>
                  <p>Export all notes, cards, sessions, and course evidence as portable JSON.</p>
                </div>
              </div>
            </div>

            <div className="profile-side-card-body">
              <p className="data-card-description">
                Download a clean, structured JSON archive containing your full study history, flashcards, and course syllabus.
              </p>
              {p.remote ? (
                <button
                  type="button"
                  className="profile-action-btn secondary"
                  onClick={async () => {
                    try {
                      const result = await p.request("settings/export");
                      const b = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(b);
                      a.download = "drizzlearn-export.json";
                      a.click();
                      URL.revokeObjectURL(a.href);
                    } catch (e) {
                      p.flashToast(e.message);
                    }
                  }}
                >
                  Download cloud export ↗
                </button>
              ) : (
                <button type="button" className="profile-action-btn secondary" onClick={exportWorkspace}>
                  Download workspace data ↗
                </button>
              )}
            </div>
          </div>

          {/* Grounded AI Engine & RAG Status Panel */}
          <AiEngineRagPanel
            remote={p.remote}
            request={p.request}
            openAccount={p.openAccount}
            flashToast={p.flashToast}
          />
        </div>
      </div>
    </div>
  );
}

export { SettingsPage };
