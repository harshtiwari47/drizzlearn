import React, { useState, useEffect } from "react";
import { Icon } from "../components/common.jsx";

export function LoginPage({loginMode,setLoginMode,authSubmit,authError,authMessage,setAuthError,setAuthMessage,go,user,logout,returnPage="home",authBusy=false}){
  const switchAuthMode=mode=>{
    if(setLoginMode)setLoginMode(mode);
    if(setAuthError)setAuthError("");
    if(setAuthMessage)setAuthMessage("");
    if(mode==="signup")go("signup");
    else if(mode==="login")go("login");
  };
  const backTarget=returnPage&&returnPage!=="login"&&returnPage!=="signup"&&returnPage!=="auth"?returnPage:"home";
  return <div className="login-fullpage">
    <header className="login-fullpage-header">
      <button type="button" className="login-brand-link" onClick={()=>go("home")} aria-label="Drizzlearn Home">
        <div className="brand-mark grid place-items-center">✦</div>
        <div className="brand-name font-bold text-lg">Drizzlearn</div>
      </button>
      <button type="button" className="login-back-btn" onClick={()=>go(backTarget)} aria-label="Back to workspace">
        <Icon name="arrowLeft" size={15}/>
        <span>Back to workspace</span>
      </button>
    </header>
    <main className="login-fullpage-main">
      {user?<section className="auth-page-card panel flex flex-col items-center text-center gap-4">
        <span className="auth-kicker eyebrow">LOGGED IN</span>
        <h2 className="text-2xl font-bold">You are signed in</h2>
        <p className="text-sm text-learnos-muted">Signed in as <strong>{user.fullName||user.email}</strong> ({user.email}).</p>
        <div className="flex items-center gap-3 mt-3 w-full">
          <button type="button" className="secondary-btn flex-1" onClick={logout}>Sign out</button>
          <button type="button" className="primary-btn flex-1" onClick={()=>go("home")}>Open workspace ↗</button>
        </div>
      </section>:(
        <div className="auth-master-card">
          {/* Left Column: Interactive Auth Form */}
          <section className="auth-form-column" aria-labelledby="authTitle">
            <div className="auth-heading">
              <span className="auth-kicker">ACCOUNT</span>
              <h1 id="authTitle">
                {loginMode==="login"?"Welcome back":loginMode==="signup"?"Create an account":"Reset password"}
              </h1>
              <p className="auth-subtitle">
                {loginMode==="login"
                  ?"Continue with one of the following options"
                  :loginMode==="signup"
                  ?"Save your courses, flashcards, notes, and study progress."
                  :"Enter your email address and we’ll send a reset link."}
              </p>
            </div>

            {loginMode!=="forgot"&&(
              <div className="auth-tabs" role="group" aria-label="Account type">
                {["login","signup"].map(id=>(
                  <button
                    key={id}
                    type="button"
                    aria-pressed={loginMode===id}
                    className={`auth-tab-btn ${loginMode===id?"active":""}`}
                    onClick={()=>switchAuthMode(id)}
                  >
                    {id==="login"?"Sign in":"Create account"}
                  </button>
                ))}
              </div>
            )}

            {loginMode==="forgot"&&(
              <button className="auth-back text-button text-sm self-start" type="button" onClick={()=>switchAuthMode("login")}>
                ← Back to sign in
              </button>
            )}

            <form id="auth-form" className="auth-form" onSubmit={authSubmit}>
              {loginMode==="signup"&&(
                <label className="auth-field-label">
                  <span>Full name</span>
                  <input name="fullName" autoComplete="name" minLength="2" required placeholder="Your name" />
                </label>
              )}

              <label className="auth-field-label">
                <span>Email</span>
                <input name="email" type="email" autoComplete="email" required placeholder="Email Address" autoFocus />
              </label>

              {loginMode!=="forgot"&&(
                <label className="auth-field-label">
                  <span>Password</span>
                  <input
                    name="password"
                    type="password"
                    autoComplete={loginMode==="login"?"current-password":"new-password"}
                    minLength="10"
                    required
                    placeholder="Password 8-16 characters"
                  />
                </label>
              )}

              {loginMode==="login"&&(
                <div className="auth-remember-row">
                  <label className="auth-checkbox-label">
                    <input type="checkbox" defaultChecked />
                    <span>Remember me</span>
                  </label>
                  <button className="auth-forgot-link" type="button" onClick={()=>switchAuthMode("forgot")}>
                    Forgot Password?
                  </button>
                </div>
              )}

              {authError&&<p className="form-error" role="alert">{authError}</p>}
              {authMessage&&<p className="form-success" role="status">{authMessage}</p>}

              <button className="auth-submit-btn" type="submit" disabled={authBusy}>
                {authBusy?(
                  <><span className="btn-spinner"/> {loginMode==="signup"?"Creating account…":loginMode==="forgot"?"Sending link…":"Signing in…"}</>
                ):(
                  loginMode==="login"?"Sign in":loginMode==="signup"?"Create account":"Send reset link"
                )}
              </button>
            </form>

            <div className="auth-switch-note">
              {loginMode==="login"?(
                <span>Already have an account? <button type="button" className="auth-mode-link" onClick={()=>switchAuthMode("signup")}>Sign up</button></span>
              ):loginMode==="signup"?(
                <span>Already have an account? <button type="button" className="auth-mode-link" onClick={()=>switchAuthMode("login")}>Log In</button></span>
              ):(
                <button type="button" className="auth-mode-link" onClick={()=>switchAuthMode("login")}>Return to Log In</button>
              )}
            </div>
          </section>

          {/* Right Column: 3D Robot Mascot & Floating Books Showcase Window */}
          <aside className="auth-showcase-column" aria-hidden="true">
            <div className="auth-showcase-window">
              {/* Radial ambient glow orbs */}
              <div className="showcase-ambient-glow glow-top-right" />
              <div className="showcase-ambient-glow glow-bottom-left" />
              <div className="showcase-ambient-glow glow-center" />

              {/* Realistic Cute Robot Floating with Weightless Books */}
              <div className="robot-mascot-wrapper">
                <img
                  src="/images/auth-robot-mascot.jpg"
                  alt="Realistic 3D cute learning robot floating with books"
                  className="robot-mascot-img"
                  loading="eager"
                />
              </div>

              {/* Zero-gravity Floating Study Badges */}
              <div className="floating-badge badge-1">
                <span className="badge-icon-wrap icon-book">
                  <Icon name="book" size={14} />
                </span>
                <div className="badge-text-group">
                  <strong>Deep Focus</strong>
                  <small className="badge-sub-lime">Weightless Study</small>
                </div>
              </div>

              <div className="floating-badge badge-2">
                <span className="badge-icon-wrap icon-companion">
                  <Icon name="spark" size={14} />
                </span>
                <div className="badge-text-group">
                  <strong>AI Companion</strong>
                  <small className="badge-sub-yellow">Real-time Knowledge</small>
                </div>
              </div>

              <div className="floating-badge badge-3">
                <span className="badge-icon-wrap icon-mastery">
                  <Icon name="cards" size={14} />
                </span>
                <div className="badge-text-group">
                  <strong>Mastery Loops</strong>
                  <small className="badge-sub-blue">Spaced Retention</small>
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}
    </main>
    <footer className="login-fullpage-footer">
      <span>✦ Drizzlearn Learning Platform</span>
    </footer>
  </div>;
}

export function Modal({modal,onClose,onApprove,onDeleteCourse,deletingCourse=false,deleteCourseError="",loginMode,setLoginMode,authSubmit,authError,authMessage,setAuthError,setAuthMessage,logout,authBusy=false}){
  const switchAuthMode=mode=>{setLoginMode(mode);setAuthError("");setAuthMessage("");};
  useEffect(()=>{const close=e=>{if(e.key==="Escape"&&!deletingCourse)onClose();};window.addEventListener("keydown",close);return()=>window.removeEventListener("keydown",close);},[onClose,deletingCourse]);
  const isProposalDelete=modal.type==="delete-course"&&modal.course?.status==="proposal";
  const modalHeading=modal.type==="overload"?"This plan needs more time":modal.type==="delete-course"?(isProposalDelete?"Delete course proposal?":"Delete course?"):modal.type==="account"?"Your Drizzlearn account":"Drizzlearn";
  return <div className="modal-backdrop open fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget&&!deletingCourse)onClose();}}><section className={`modal ${modal.type==="account"?"auth-modal":""} panel flex flex-col max-w-lg w-full overflow-hidden`} role="dialog" aria-modal="true" aria-labelledby="modalTitle"><div className="modal-head flex items-center justify-between p-4 border-b border-learnos-line"><h2 id="modalTitle" className="text-lg font-bold">{modalHeading}</h2><button className="modal-close p-1 cursor-pointer text-learnos-muted hover:text-learnos-text" disabled={deletingCourse} onClick={onClose} aria-label="Close">×</button></div><div className={`modal-body ${modal.type==="account"?"auth-modal-body p-5 sm:p-6":"p-6"} flex flex-col gap-4`}>
    {modal.type==="overload"&&<div className="overload-copy flex flex-col gap-3"><p>This plan is estimated at <strong>{Math.round((modal.details?.neededPerWeek||0)/60*10)/10} hours per week</strong>, above the current budget of <strong>{Math.round((modal.details?.weeklyMinutes||0)/60)} hours</strong>.</p><p>You can adjust the goal details or continue with the plan as written.</p><div className="modal-actions flex justify-end gap-3 mt-3"><button className="secondary-btn" onClick={onClose}>Review schedule</button><button className="primary-btn" onClick={onApprove}>Approve anyway</button></div></div>}
    {modal.type==="delete-course"&&modal.course&&<div className="delete-course-copy flex flex-col gap-3"><div className="delete-course-target"><strong>{modal.course.title}</strong><span>{modal.course.status==="proposal"?"Draft proposal":`${modal.course.modules?.length||0} modules · ${modal.course.modules?.reduce((n,m)=>n+(m.lessons?.length||0),0)||0} lessons`}</span></div><p>This permanently deletes the {isProposalDelete?"proposal":"course"}, its modules, lessons, and scheduled study sessions.</p><p>Any notes or flashcards you saved stay in your workspace.</p>{deleteCourseError&&<p className="form-error" role="alert">{deleteCourseError}</p>}<div className="modal-actions flex justify-end gap-3 mt-2"><button type="button" className="secondary-btn" disabled={deletingCourse} onClick={onClose}>Cancel</button><button type="button" className="danger-btn" disabled={deletingCourse} onClick={()=>onDeleteCourse?.(modal.course,modal.redirectTo)}>{deletingCourse?<><span className="btn-spinner"/> Deleting…</>:(isProposalDelete?"Delete proposal":"Delete course")}</button></div></div>}
    {modal.type==="account"&&<div className="auth-panel flex flex-col gap-3.5">
      <div className="auth-heading flex flex-col items-start gap-1">
        <span className="auth-kicker eyebrow self-start">ACCOUNT</span>
        <h3 className="text-xl font-bold">{loginMode==="login"?"Welcome back":loginMode==="signup"?"Create your account":"Reset your password"}</h3>
        <p className="text-sm text-learnos-muted">{loginMode==="login"?"Sign in to continue.":loginMode==="signup"?"Save your courses and progress.":"Enter your email address and we’ll send a reset link."}</p>
      </div>
      {loginMode!=="forgot"&&<div className="auth-tabs" role="group" aria-label="Account type">{["login","signup"].map(id=><button key={id} type="button" aria-pressed={loginMode===id} className={`auth-tab-btn ${loginMode===id?"active":""}`} onClick={()=>switchAuthMode(id)}>{id==="login"?"Sign in":"Create account"}</button>)}</div>}
      {loginMode==="forgot"&&<button className="auth-back text-button text-sm self-start" type="button" onClick={()=>switchAuthMode("login")}>← Back to sign in</button>}
      <form id="auth-form" className="auth-form flex flex-col gap-2.5" onSubmit={authSubmit}>
        {loginMode==="signup"&&<label className="flex flex-col gap-1 text-sm font-semibold">Full name<input name="fullName" autoComplete="name" minLength="2" required placeholder="Your name"/></label>}
        <label className="flex flex-col gap-1 text-sm font-semibold">Email address<input name="email" type="email" autoComplete="email" required placeholder="you@example.com" autoFocus/></label>
        {loginMode!=="forgot"&&<label className="flex flex-col gap-1 text-sm font-semibold">Password<input name="password" type="password" autoComplete={loginMode==="login"?"current-password":"new-password"} minLength="10" required placeholder="At least 10 characters"/></label>}
        {loginMode==="login"&&<button className="auth-forgot text-button text-sm self-start" type="button" onClick={()=>switchAuthMode("forgot")}>Forgot password?</button>}
        {authError&&<p className="form-error" role="alert">{authError}</p>}
        {authMessage&&<p className="form-success" role="status">{authMessage}</p>}
        <button className="primary-btn mt-1.5" type="submit" disabled={authBusy}>{authBusy?<><span className="btn-spinner"/> {loginMode==="signup"?"Creating account…":loginMode==="forgot"?"Sending link…":"Signing in…"}</>:loginMode==="login"?"Sign in":loginMode==="signup"?"Create account":"Send reset link"}</button>
      </form>
    </div>}
    {modal.type==="account-actions"&&<div className="flex justify-end"><button className="secondary-btn" onClick={logout}>Sign out</button></div>}
  </div></section></div>;
}


