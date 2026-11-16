import React, { useState } from "react";
import { parseLocation } from "../router.js";

function ResetPasswordPage(p){
  const [password,setPassword]=useState(""),[confirmation,setConfirmation]=useState(""),[message,setMessage]=useState(""),[error,setError]=useState(""),[done,setDone]=useState(false);
  async function submit(e){e.preventDefault();setError("");setMessage("");if(password!==confirmation){setError("The passwords do not match.");return;}const token=p.routeQuery?.get?.("token")||parseLocation(typeof window!=="undefined"?window.location:null).query.get("token");try{await p.request("auth/reset-password",{method:"POST",body:JSON.stringify({token,password})});setDone(true);setMessage("Your password was updated. You can sign in again.");}catch(e){setError(e.message);}}
  return <form className="panel reset-password-panel flex flex-col p-6 gap-4 max-w-md mx-auto" onSubmit={submit}><span className="eyebrow">ACCOUNT SECURITY</span><h2 className="text-xl font-bold">{done?"Password updated":"Choose a new password"}</h2><p className="text-sm text-learnos-muted">{message||"Choose a password with at least 10 characters."}</p>{!done&&<><label className="flex flex-col gap-1 text-sm font-semibold">New password<input type="password" minLength="10" required value={password} onChange={e=>setPassword(e.target.value)}/></label><label className="flex flex-col gap-1 text-sm font-semibold">Confirm password<input type="password" minLength="10" required value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label>{error&&<p className="form-error">{error}</p>}<button className="primary-btn" type="submit">Update password ↗</button></>}<button className="text-button self-start" type="button" onClick={p.openAccount}>Back to sign in</button></form>;
}

export { ResetPasswordPage };
