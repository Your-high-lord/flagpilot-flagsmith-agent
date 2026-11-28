(() => {
 const $=id=>document.getElementById(id),STORAGE_KEY="flagpilot-demo-identity-v1",CONFIG_KEY="flagpilot-demo-config-v1";
 const DEMO_CONVERSION_EVENT="demo_signup_completed",ATTEMPT_DB="flagpilot-demo-safety",ATTEMPT_STORE="conversion-attempts";
 let identity=localStorage.getItem(STORAGE_KEY)||`fp-demo-${crypto.randomUUID()}`,connected=false,activeConfig=null,sdkInitialised=false,sdkEnvironmentKey=null,enrolled=false,conversionAttempted=false,resumeRefreshBusy=false,lastResumeRefreshAt=0;
 // Persist the first identity immediately so reloads and other tabs reuse the same visitor.
 localStorage.setItem(STORAGE_KEY,identity);
 const text=(id,value)=>{$(id).textContent=value;};
 function openAttemptDb(){
  return new Promise((resolve,reject)=>{
   if(!window.indexedDB){reject(new Error("This browser does not provide IndexedDB; conversion tracking is disabled to prevent duplicate attempts."));return;}
   let request;
   try{request=window.indexedDB.open(ATTEMPT_DB,1);}catch(error){reject(error);return;}
   request.onupgradeneeded=()=>{
    const db=request.result;
    if(!db.objectStoreNames.contains(ATTEMPT_STORE))db.createObjectStore(ATTEMPT_STORE,{keyPath:"identity"});
   };
   request.onerror=()=>reject(request.error||new Error("Could not open the persistent conversion safety store."));
   request.onblocked=()=>reject(new Error("The persistent conversion safety store is blocked by another tab. Close older FlagPilot tabs and reconnect."));
   request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();resolve(db);};
  });
 }
 async function hasConversionAttempt(eventIdentity){
  const db=await openAttemptDb();
  try{
   return await new Promise((resolve,reject)=>{
    const tx=db.transaction(ATTEMPT_STORE,"readonly"),request=tx.objectStore(ATTEMPT_STORE).get(eventIdentity);
    request.onsuccess=()=>resolve(Boolean(request.result));
    request.onerror=()=>reject(request.error||new Error("Could not read the persistent conversion safety state."));
    tx.onabort=()=>reject(tx.error||new Error("The persistent conversion safety read was aborted."));
   });
  }finally{db.close();}
 }
 async function reserveConversionAttempt(eventIdentity){
  const db=await openAttemptDb();
  try{
   return await new Promise((resolve,reject)=>{
    const tx=db.transaction(ATTEMPT_STORE,"readwrite"),store=tx.objectStore(ATTEMPT_STORE);
    let reserved=false;
    // A single unique-key add is the atomic reservation. IndexedDB serializes
    // read/write transactions across tabs; a duplicate key is an expected
    // "already reserved" result, not a failed transaction.
    const add=store.add({identity:eventIdentity,attemptedAt:new Date().toISOString()});
    add.onsuccess=()=>{reserved=true;};
    add.onerror=event=>{
     if(add.error?.name==="ConstraintError"){
      event.preventDefault();
      event.stopPropagation();
      return;
     }
    };
    tx.oncomplete=()=>resolve(reserved);
    tx.onerror=()=>reject(tx.error||new Error("Could not reserve this identity's conversion attempt."));
    tx.onabort=()=>reject(tx.error||new Error("The conversion attempt reservation was aborted."));
   });
  }finally{db.close();}
 }
 function readConfig(){return{environmentKey:$("environment-key").value.trim(),featureName:$("feature-name").value.trim(),controlLabel:$("control-label").value.trim(),eventName:DEMO_CONVERSION_EVENT};}
 async function connect(config){
  if(!window.flagsmith)throw new Error("Flagsmith SDK did not load. Refresh and try again.");
  if(!config.environmentKey||!config.featureName||!config.controlLabel||!config.eventName)throw new Error("Complete all connection fields.");
  // Flagsmith SDK v12.5.0 sends environmentID as the X-Environment-Key HTTP header.
  // Reject hidden Unicode/control characters locally so XMLHttpRequest cannot throw a ByteString error.
  if(!/^[\x21-\x7E]+$/.test(config.environmentKey))throw new Error("The Environment Key contains whitespace, hidden characters or non-ASCII text. Clear the field and copy the Client-side Environment Key directly from Flagsmith → Development → SDK Keys. Paste only the key, without quotes or labels. The value was not sent.");
  if(config.eventName.startsWith("$")||!/^[A-Za-z][A-Za-z0-9_.:-]*$/.test(config.eventName))throw new Error("Event name is invalid or reserved.");
  connected=false;activeConfig=config;$("conversion-button").disabled=true;$("new-visitor").disabled=true;$("connection-error").textContent="";
  text("connection-badge","CONNECTING");$("connection-badge").className="status status-off";text("identity-value",identity);text("result-feature",config.featureName);text("result-value","Loading from Flagsmith…");text("result-exposure","Waiting");text("result-event",config.eventName);
  if(!sdkInitialised){await window.flagsmith.init({environmentID:config.environmentKey,enableEvents:true,onError:sdkError=>{const message=sdkError instanceof Error?sdkError.message:String(sdkError);text("connection-error",message);}});sdkInitialised=true;sdkEnvironmentKey=config.environmentKey;}
  else if(sdkEnvironmentKey!==config.environmentKey)throw new Error("Already connected to a different environment. Refresh before switching.");
  await window.flagsmith.identify(identity);
  const flag=window.flagsmith.getExperimentFlag(config.featureName);
  if(!flag||!flag.enabled)throw new Error(`Flag '${config.featureName}' was not returned as enabled. Check environment key, feature and experiment status.`);
  const value=String(flag.value??"");if(!value)throw new Error("Flagsmith returned an empty variation; no fallback was fabricated.");
  const label=value==="control"?config.controlLabel:value;
  $("conversion-button").textContent=label;
  const candidate=flag.experiment;
  const experiment=candidate&&typeof candidate==="object"&&typeof candidate.id==="number"&&Number.isSafeInteger(candidate.id)&&candidate.id>0&&typeof candidate.name==="string"&&candidate.name.trim().length>0?candidate:null;
  enrolled=experiment?.inExperiment===true;
  const hasExperiment=!!experiment;
  // If durable deduplication state cannot be read, connection fails closed.
  conversionAttempted=enrolled?await hasConversionAttempt(identity):false;
  text("result-value",value);
  text("result-exposure",enrolled
    ?`Enrolled · ${experiment.name} (#${experiment.id})`
    :hasExperiment
      ?`Not enrolled · ${experiment.name} (#${experiment.id})`
      :"No experiment metadata returned");
  text("connection-badge",enrolled?"ENROLLED":hasExperiment?"CONNECTED · NOT ENROLLED":"NO ACTIVE EXPERIMENT");
  $("connection-badge").className=enrolled?"status status-ready":"status status-off";$("identity-badge").className="status status-ready";
  connected=true;$("conversion-button").disabled=!enrolled||conversionAttempted;$("new-visitor").disabled=!hasExperiment;
  text("conversion-status",enrolled
    ?conversionAttempted
      ?`A conversion attempt for ${identity} is already recorded. Generate a new synthetic visitor before testing another conversion.`
      :`Loaded '${label}' and confirmed enrolment in ${experiment.name} (#${experiment.id}).`
    :hasExperiment
      ?`Flagsmith returned experiment ${experiment.name} (#${experiment.id}), but this visitor is not enrolled. Confirm the experiment is running in this Development environment and check its rollout/audience before generating another visitor. No conversion can be sent until enrolment is confirmed.`
      :`The feature connection succeeded and '${label}' was loaded, but Flagsmith returned no experiment metadata. The experiment may still be a draft/not running or may not be linked to this feature in this environment. Verify the experiment is running before generating visitors. No exposure or conversion was recorded.`);
  localStorage.setItem(CONFIG_KEY,JSON.stringify(config));
 }
 async function newVisitor(){identity=`fp-demo-${crypto.randomUUID()}`;localStorage.setItem(STORAGE_KEY,identity);conversionAttempted=false;text("identity-value",identity);connected=false;enrolled=false;$("conversion-button").disabled=true;$("new-visitor").disabled=true;if(!activeConfig){text("conversion-status","New synthetic visitor created. Connect Flagsmith to evaluate.");return;}try{await connect(activeConfig);}catch(e){text("connection-error",e instanceof Error?e.message:String(e));text("conversion-status","New identity could not be evaluated.");}}
 $("connect-form").addEventListener("submit",async e=>{e.preventDefault();try{await connect(readConfig());}catch(error){connected=false;$("conversion-button").disabled=true;$("new-visitor").disabled=true;text("connection-badge","ERROR");$("connection-badge").className="status status-off";$("connection-error").textContent=error instanceof Error?error.message:String(error);text("result-exposure","Not verified");text("conversion-status","No conversion has been sent.");}});
 $("conversion-button").addEventListener("click",async()=>{
  if(!connected||!enrolled||!activeConfig||conversionAttempted)return;
  conversionAttempted=true;$("conversion-button").disabled=true;$("new-visitor").disabled=true;
  const eventIdentity=identity;let reserved=false;
  try{
   // The unique IndexedDB key is reserved atomically before any SDK call; browser tabs share this ledger.
   reserved=await reserveConversionAttempt(eventIdentity);
   if(!reserved){
    text("result-event","Already attempted for this identity");
    text("conversion-status",`A conversion attempt for ${eventIdentity} is already recorded in this browser. No second event was sent. Generate a new synthetic visitor for another test.`);
    return;
   }
   window.flagsmith.trackEvent(DEMO_CONVERSION_EVENT,{metadata:{source:"flagpilot_demo",synthetic:true}});
   await window.flagsmith.flushEvents();
   text("result-event","SDK flush completed");
   text("conversion-status",`One synthetic conversion attempt '${DEMO_CONVERSION_EVENT}' was flushed for ${eventIdentity}. Verify ingestion in the warehouse; do not retry this identity.`);
  }catch(e){
   if(!reserved){
    text("result-event","Persistent safety reservation failed");
    text("conversion-status",`No conversion was sent for ${eventIdentity} because its persistent one-shot reservation could not be stored: ${e instanceof Error?e.message:String(e)}. Resolve browser storage access before trying again.`);
   }else{
    text("result-event","Delivery uncertain · do not retry");
    text("conversion-status",`The conversion attempt for ${eventIdentity} could not be confirmed: ${e instanceof Error?e.message:String(e)}. The one-shot reservation remains stored because Flagsmith may already have received the event. Create a new synthetic visitor for another test.`);
   }
  }finally{$("new-visitor").disabled=false;}
 });
 $("new-visitor").addEventListener("click",()=>{void newVisitor();});text("identity-value",identity);
 async function refreshIfNeeded(){
  if(document.visibilityState==="hidden"||!activeConfig||!connected||enrolled||resumeRefreshBusy)return;
  const now=Date.now();if(now-lastResumeRefreshAt<5000)return;
  lastResumeRefreshAt=now;resumeRefreshBusy=true;
  try{await connect(activeConfig);}
  catch(error){text("connection-error",error instanceof Error?error.message:String(error));}
  finally{resumeRefreshBusy=false;}
 }
 document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")void refreshIfNeeded();});
 window.addEventListener("focus",()=>{void refreshIfNeeded();});
 window.addEventListener("message",event=>{
  if(event.origin!==window.location.origin||event.source!==window.parent||event.data?.type!=="flagpilot-refresh-demo")return;
  void refreshIfNeeded();
 });
 async function restoreLatestDemoConfig(){
  let saved=null;
  try{saved=JSON.parse(localStorage.getItem(CONFIG_KEY)||"null");}catch{}
  if(saved&&typeof saved==="object"){
   $("environment-key").value=typeof saved.environmentKey==="string"?saved.environmentKey:"";
   $("feature-name").value=typeof saved.featureName==="string"?saved.featureName:"fp_signup_button_label_2f6d0eaad3";
   $("control-label").value=typeof saved.controlLabel==="string"?saved.controlLabel:"Start free trial";
  }
  $("event-name").value=DEMO_CONVERSION_EVENT;
  try{
   const response=await fetch("data/latest-provisioning.json?ts="+Date.now(),{cache:"no-store"});
   if(response.ok){
    const data=await response.json(),artifact=data.artifact||{},feature=artifact.result?.feature,metric=artifact.result?.metric,proposal=artifact.proposal;
    if(typeof feature?.name==="string"&&/^[a-z][a-z0-9_]*$/.test(feature.name)){
     if(metric?.eventName!==DEMO_CONVERSION_EVENT)throw new Error("The latest provisioned metric is not the fixed Demo Store event. The SDK demo will not send a different event name.");
     $("feature-name").value=feature.name;
     if(typeof proposal?.controlLabel==="string"&&proposal.controlLabel.trim())$("control-label").value=proposal.controlLabel;
     if(saved&&typeof saved==="object"){
      saved.featureName=feature.name;
      saved.controlLabel=$("control-label").value;
      saved.eventName=DEMO_CONVERSION_EVENT;
      localStorage.setItem(CONFIG_KEY,JSON.stringify(saved));
     }
    }
   }
  }catch(error){text("connection-error",error instanceof Error?error.message:String(error));}
  const config=readConfig();
  if(config.environmentKey){
   try{await connect(config);}
   catch(error){connected=false;$("conversion-button").disabled=true;$("new-visitor").disabled=true;text("connection-badge","ERROR");$("connection-badge").className="status status-off";text("result-exposure","Not verified");text("connection-error",error instanceof Error?error.message:String(error));text("conversion-status","Saved settings were restored, but the SDK connection could not be revalidated.");}
  }
 }
 void restoreLatestDemoConfig();
 function reportEmbeddedHeight(){
  if(window.parent===window)return;
  const height=Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight||0);
  window.parent.postMessage({type:"flagpilot-store-height",height},window.location.origin);
 }
 if(window.parent!==window){
  if(typeof ResizeObserver!=="undefined")new ResizeObserver(reportEmbeddedHeight).observe(document.body);
  window.addEventListener("load",reportEmbeddedHeight);
  window.addEventListener("resize",reportEmbeddedHeight);
  setTimeout(reportEmbeddedHeight,300);
  setTimeout(reportEmbeddedHeight,1200);
 }
})();