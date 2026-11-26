(() => {
 const $=id=>document.getElementById(id),STORAGE_KEY="flagpilot-demo-identity-v1",CONFIG_KEY="flagpilot-demo-config-v1";
 let identity=localStorage.getItem(STORAGE_KEY)||`fp-demo-${crypto.randomUUID()}`,connected=false,activeConfig=null,sdkInitialised=false,sdkEnvironmentKey=null,enrolled=false;
 const text=(id,value)=>{$(id).textContent=value;};
 function readConfig(){return{environmentKey:$("environment-key").value.trim(),featureName:$("feature-name").value.trim(),controlLabel:$("control-label").value.trim(),eventName:$("event-name").value.trim()};}
 async function connect(config){
  if(!window.flagsmith)throw new Error("Flagsmith SDK did not load. Refresh and try again.");
  if(!config.environmentKey||!config.featureName||!config.controlLabel||!config.eventName)throw new Error("Complete all connection fields.");
  if(config.eventName.startsWith("$")||!/^[A-Za-z][A-Za-z0-9_.:-]*$/.test(config.eventName))throw new Error("Event name is invalid or reserved.");
  connected=false;activeConfig=config;$("conversion-button").disabled=true;$("new-visitor").disabled=true;$("connection-error").textContent="";
  text("connection-badge","CONNECTING");$("connection-badge").className="status status-off";text("identity-value",identity);text("result-feature",config.featureName);text("result-value","Loading from Flagsmith…");text("result-exposure","Waiting");text("result-event",config.eventName);
  if(!sdkInitialised){await window.flagsmith.init({environmentID:config.environmentKey,enableEvents:true});sdkInitialised=true;sdkEnvironmentKey=config.environmentKey;}
  else if(sdkEnvironmentKey!==config.environmentKey)throw new Error("Already connected to a different environment. Refresh before switching.");
  await window.flagsmith.identify(identity);
  const flag=window.flagsmith.getExperimentFlag(config.featureName);
  if(!flag||!flag.enabled)throw new Error(`Flag '${config.featureName}' was not returned as enabled. Check environment key, feature and experiment status.`);
  const value=String(flag.value??"");if(!value)throw new Error("Flagsmith returned an empty variation; no fallback was fabricated.");
  const label=value==="control"?config.controlLabel:value;
  $("conversion-button").textContent=label;
  enrolled=flag.experiment?.inExperiment===true;
  text("result-value",value);text("result-exposure",enrolled?"Exposure recorded by Flagsmith":"Not enrolled — no exposure recorded");
  text("connection-badge",enrolled?"ENROLLED":"CONNECTED · NOT ENROLLED");$("connection-badge").className=enrolled?"status status-ready":"status status-off";$("identity-badge").className="status status-ready";
  connected=true;$("conversion-button").disabled=!enrolled;$("new-visitor").disabled=false;
  text("conversion-status",enrolled?`Loaded '${label}' and confirmed experiment enrolment.`:`Loaded '${label}', but identity is outside the rollout. Generate another visitor.`);
  localStorage.setItem(CONFIG_KEY,JSON.stringify(config));
 }
 async function newVisitor(){identity=`fp-demo-${crypto.randomUUID()}`;localStorage.setItem(STORAGE_KEY,identity);text("identity-value",identity);connected=false;enrolled=false;$("conversion-button").disabled=true;$("new-visitor").disabled=true;if(!activeConfig){text("conversion-status","New synthetic visitor created. Connect Flagsmith to evaluate.");return;}try{await connect(activeConfig);}catch(e){text("connection-error",e instanceof Error?e.message:String(e));text("conversion-status","New identity could not be evaluated.");}}
 $("connect-form").addEventListener("submit",async e=>{e.preventDefault();try{await connect(readConfig());}catch(error){connected=false;$("conversion-button").disabled=true;$("new-visitor").disabled=true;text("connection-badge","ERROR");$("connection-badge").className="status status-off";$("connection-error").textContent=error instanceof Error?error.message:String(error);text("result-exposure","Not verified");text("conversion-status","No conversion has been sent.");}});
 $("conversion-button").addEventListener("click",async()=>{if(!connected||!enrolled||!activeConfig)return;try{window.flagsmith.trackEvent(activeConfig.eventName,{metadata:{source:"flagpilot_demo",synthetic:true}});await window.flagsmith.flushEvents();text("result-event","SDK flush completed");text("conversion-status",`Synthetic conversion '${activeConfig.eventName}' passed to Flagsmith for ${identity}. Verify ingestion in the warehouse.`);}catch(e){text("result-event","Flush failed");text("conversion-status",e instanceof Error?e.message:String(e));}});
 $("new-visitor").addEventListener("click",()=>{void newVisitor();});text("identity-value",identity);
 try{const saved=JSON.parse(localStorage.getItem(CONFIG_KEY)||"null");if(saved&&typeof saved==="object"){$("environment-key").value=saved.environmentKey||"";$("feature-name").value=saved.featureName||"fp_signup_cta_test";$("control-label").value=saved.controlLabel||"Start free trial";$("event-name").value=saved.eventName||"demo_signup_completed";}}catch{}
})();