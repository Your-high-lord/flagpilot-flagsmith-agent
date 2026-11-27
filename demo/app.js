(() => {
 const $=id=>document.getElementById(id),STORAGE_KEY="flagpilot-demo-identity-v1",CONFIG_KEY="flagpilot-demo-config-v1";
 const DEMO_CONVERSION_EVENT="demo_signup_completed";
 let identity=localStorage.getItem(STORAGE_KEY)||`fp-demo-${crypto.randomUUID()}`,connected=false,activeConfig=null,sdkInitialised=false,sdkEnvironmentKey=null,enrolled=false;
 const text=(id,value)=>{$(id).textContent=value;};
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
  const experiment=flag.experiment&&Number.isSafeInteger(Number(flag.experiment.id))?flag.experiment:null;
  enrolled=experiment?.inExperiment===true;
  const hasExperiment=!!experiment;
  text("result-value",value);
  text("result-exposure",enrolled
    ?`Enrolled · ${experiment.name} (#${experiment.id})`
    :hasExperiment
      ?`Not enrolled · ${experiment.name} (#${experiment.id})`
      :"No experiment metadata returned");
  text("connection-badge",enrolled?"ENROLLED":hasExperiment?"CONNECTED · NOT ENROLLED":"NO ACTIVE EXPERIMENT");
  $("connection-badge").className=enrolled?"status status-ready":"status status-off";$("identity-badge").className="status status-ready";
  connected=true;$("conversion-button").disabled=!enrolled;$("new-visitor").disabled=!hasExperiment;
  text("conversion-status",enrolled
    ?`Loaded '${label}' and confirmed enrolment in ${experiment.name} (#${experiment.id}).`
    :hasExperiment
      ?`Flagsmith returned experiment ${experiment.name} (#${experiment.id}), but this visitor is not enrolled. Confirm the experiment is running in this Development environment and check its rollout/audience before generating another visitor. No conversion can be sent until enrolment is confirmed.`
      :`The feature connection succeeded and '${label}' was loaded, but Flagsmith returned no experiment metadata. The experiment may still be a draft/not running or may not be linked to this feature in this environment. Verify the experiment is running before generating visitors. No exposure or conversion was recorded.`);
  localStorage.setItem(CONFIG_KEY,JSON.stringify(config));
 }
 async function newVisitor(){identity=`fp-demo-${crypto.randomUUID()}`;localStorage.setItem(STORAGE_KEY,identity);text("identity-value",identity);connected=false;enrolled=false;$("conversion-button").disabled=true;$("new-visitor").disabled=true;if(!activeConfig){text("conversion-status","New synthetic visitor created. Connect Flagsmith to evaluate.");return;}try{await connect(activeConfig);}catch(e){text("connection-error",e instanceof Error?e.message:String(e));text("conversion-status","New identity could not be evaluated.");}}
 $("connect-form").addEventListener("submit",async e=>{e.preventDefault();try{await connect(readConfig());}catch(error){connected=false;$("conversion-button").disabled=true;$("new-visitor").disabled=true;text("connection-badge","ERROR");$("connection-badge").className="status status-off";$("connection-error").textContent=error instanceof Error?error.message:String(error);text("result-exposure","Not verified");text("conversion-status","No conversion has been sent.");}});
 $("conversion-button").addEventListener("click",async()=>{if(!connected||!enrolled||!activeConfig)return;try{window.flagsmith.trackEvent("demo_signup_completed",{metadata:{source:"flagpilot_demo",synthetic:true}});await window.flagsmith.flushEvents();text("result-event","SDK flush completed");text("conversion-status",`Synthetic conversion '${DEMO_CONVERSION_EVENT}' passed to Flagsmith for ${identity}. Verify ingestion in the warehouse.`);}catch(e){text("result-event","Flush failed");text("conversion-status",e instanceof Error?e.message:String(e));}});
 $("new-visitor").addEventListener("click",()=>{void newVisitor();});text("identity-value",identity);
 try{const saved=JSON.parse(localStorage.getItem(CONFIG_KEY)||"null");if(saved&&typeof saved==="object"){$("environment-key").value=saved.environmentKey||"";$("feature-name").value=saved.featureName||"fp_signup_cta_test";$("control-label").value=saved.controlLabel||"Start free trial";$("event-name").value=DEMO_CONVERSION_EVENT;}}catch{}
})();