import React, { useState } from "react";
import { Icon, emptyWorkspace, LOCAL_STORAGE_KEY, LEGACY_STORAGE_KEY } from "../components/common.jsx";
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
  const flashcardsCount = p.data?.flashcards?.length || 0;

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
    if (!confirm("Are you sure you want to delete your account? This permanently removes all your learning data.")) return;
    setDeletingAccount(true);
    try {
      if (p.remote) {
        const password = prompt("Enter your password to confirm:");
        if (!password) return;
        try {
          await p.request("settings/account", { method: "DELETE", body: JSON.stringify({ password }) });
          if (p.setUser) p.setUser(null);
          if (p.setRemote) p.setRemote(false);
          if (p.setData) p.setData(emptyWorkspace());
          p.flashToast("Account deleted.");
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
      {/* Top Header Bar with Clean Circular Back Button */}
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
          <h1 className="profile-top-heading">Profile</h1>
        </div>
      </header>

      {/* Hero Profile Card — Simple, Clean, Ethereal Pink & Blue Accents */}
      <section className="profile-hero-card" aria-label="Learner Profile">
        <div className="profile-hero-main-row">
          <div className="profile-avatar-ring">
            <div className="profile-avatar-core">
              <span className="profile-avatar-initials">{userInitials}</span>
            </div>
          </div>

          <div className="profile-identity-details">
            <h2 className="profile-display-name">{displayName}</h2>
            {p.user?.email && (
              <span className="profile-email-line">{p.user.email}</span>
            )}
          </div>
        </div>

        {/* 4 Clean Metric Cards (Values + Titles only, No extra noise) */}
        <div className="profile-hero-stats-grid">
          <div className="profile-hero-stat-card card-pink">
            <div className="stat-card-header">
              <span className="stat-icon-tile icon-pink"><Icon name="clock" size={14} /></span>
              <span className="stat-label">Weekly Budget</span>
            </div>
            <strong className="stat-value">{Math.round(weekly / 60 * 10) / 10}h</strong>
            <div className="stat-accent-bar bar-pink" />
          </div>

          <div className="profile-hero-stat-card card-blue">
            <div className="stat-card-header">
              <span className="stat-icon-tile icon-blue"><Icon name="play" size={14} /></span>
              <span className="stat-label">Focus Session</span>
            </div>
            <strong className="stat-value">{session}m</strong>
            <div className="stat-accent-bar bar-blue" />
          </div>

          <div className="profile-hero-stat-card card-violet">
            <div className="stat-card-header">
              <span className="stat-icon-tile icon-violet"><Icon name="cards" size={14} /></span>
              <span className="stat-label">Flashcards</span>
            </div>
            <strong className="stat-value">{flashcardsCount}</strong>
            <div className="stat-accent-bar bar-violet" />
          </div>

          <div className="profile-hero-stat-card card-cyan">
            <div className="stat-card-header">
              <span className="stat-icon-tile icon-cyan"><Icon name="book" size={14} /></span>
              <span className="stat-label">Courses</span>
            </div>
            <strong className="stat-value">{coursesCount}</strong>
            <div className="stat-accent-bar bar-cyan" />
          </div>
        </div>
      </section>

      {/* Main Settings & Preferences Content Grid */}
      <div className="profile-content-grid">
        {/* Left Column: Preferences Form */}
        <div className="profile-main-col">
          <form className="profile-glass-card profile-form-card" onSubmit={save}>
            <div className="profile-card-head">
              <div className="card-head-title">
                <span className="card-head-icon-box"><Icon name="tutor" size={16} /></span>
                <h3>Preferences</h3>
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
                    placeholder="Not signed in"
                    readOnly
                  />
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
              </label>

              {/* Study Rhythm */}
              <div className="profile-sub-section">
                <div className="sub-section-header">
                  <span className="sub-section-icon"><Icon name="clock" size={14} /></span>
                  <h4>Study Rhythm</h4>
                </div>

                <div className="profile-form-two-col">
                  <label className="profile-field-label">
                    <span className="label-text">Weekly budget (minutes)</span>
                    <input
                      className="profile-text-input"
                      type="number"
                      min="30"
                      max="2400"
                      step="30"
                      value={weekly}
                      onChange={e => setWeekly(e.target.value)}
                    />
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
                  </label>
                </div>
              </div>

              {/* Preferred Study Days */}
              <div className="profile-sub-section">
                <div className="sub-section-header">
                  <span className="sub-section-icon"><Icon name="calendar" size={14} /></span>
                  <h4>Preferred Study Days</h4>
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
                        {day}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Notifications */}
              <div className="profile-sub-section">
                <div className="sub-section-header">
                  <span className="sub-section-icon"><Icon name="spark" size={14} /></span>
                  <h4>Notifications</h4>
                </div>

                <div className="profile-toggles-list">
                  <label className="profile-toggle-card">
                    <span className="toggle-label-text">Study session reminders</span>
                    <input
                      type="checkbox"
                      className="profile-toggle-switch"
                      checked={studyNotify}
                      onChange={e => setStudyNotify(e.target.checked)}
                    />
                  </label>

                  <label className="profile-toggle-card">
                    <span className="toggle-label-text">Review reminders</span>
                    <input
                      type="checkbox"
                      className="profile-toggle-switch"
                      checked={reviewNotify}
                      onChange={e => setReviewNotify(e.target.checked)}
                    />
                  </label>
                </div>
              </div>

              <div className="profile-form-footer">
                <button className="profile-save-btn" type="submit">
                  {saved ? "Saved ✓" : "Save Changes"}
                </button>
              </div>
            </div>
          </form>
        </div>

        {/* Right Column: Account & Workspace Data */}
        <div className="profile-side-col">
          {/* Account Card */}
          <div className="profile-glass-card profile-side-card">
            <div className="profile-card-head">
              <div className="card-head-title">
                <span className="card-head-icon-box"><Icon name="people" size={16} /></span>
                <h3>Account</h3>
              </div>
            </div>

            <div className="profile-side-card-body">
              <div className="account-user-banner">
                <div className="account-user-avatar">{userInitials}</div>
                <div className="account-user-meta">
                  <strong>{p.user?.fullName || displayName}</strong>
                  <span>{p.user?.email || "Local storage"}</span>
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
                <button
                  className="profile-danger-btn"
                  type="button"
                  disabled={deletingAccount}
                  onClick={deleteAccount}
                >
                  {deletingAccount ? "Deleting…" : "Delete account"}
                </button>
              </div>
            </div>
          </div>

          {/* Workspace Data Card */}
          <div className="profile-glass-card profile-side-card">
            <div className="profile-card-head">
              <div className="card-head-title">
                <span className="card-head-icon-box"><Icon name="notes" size={16} /></span>
                <h3>Workspace Data</h3>
              </div>
            </div>

            <div className="profile-side-card-body">
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
                  Export cloud data ↗
                </button>
              ) : (
                <button type="button" className="profile-action-btn secondary" onClick={exportWorkspace}>
                  Export workspace data ↗
                </button>
              )}
            </div>
          </div>

          {/* AI Engine Panel */}
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
