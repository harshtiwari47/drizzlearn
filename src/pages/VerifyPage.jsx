import React, { useState, useEffect } from "react";
import { Icon } from "../components/common.jsx";
import { parseLocation } from "../router.js";

function VerifyPage(p){
  const [state,setState]=useState("checking"),[message,setMessage]=useState("Checking your verification link…");
  useEffect(()=>{const token=p.routeQuery?.get?.("token")||parseLocation(typeof window!=="undefined"?window.location:null).query.get("token");if(!token){setState("error");setMessage("This verification link is missing its token.");return;}p.request("auth/verify",{method:"POST",body:JSON.stringify({token})}).then(()=>{setState("success");setMessage("Your email is verified. Your account is ready.");}).catch(error=>{setState("error");setMessage(error.message);});},[]);
  return <div className="panel auth-result flex flex-col items-center justify-center p-8 gap-4 max-w-md mx-auto text-center"><span className={`empty-orb ${state}`}><Icon name={state==="success"?"check":"spark"}/></span><h2 className="text-xl font-bold">{state==="checking"?"Checking your link":state==="success"?"Email verified":"Could not verify email"}</h2><p className="text-learnos-muted text-sm">{message}</p><button className="primary-btn" onClick={()=>p.go("home")}>Return to Drizzlearn ↗</button></div>;
}

export { VerifyPage };
