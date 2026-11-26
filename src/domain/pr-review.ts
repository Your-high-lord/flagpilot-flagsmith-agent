export interface PullRequestTarget {
  owner: string;
  repo: string;
  number: number;
  url: string;
}
export interface PrReview {
  verdict: "ready_for_experiment" | "needs_engineering_work" | "not_a_good_experiment";
  changeSummary: string;
  experimentOpportunity: string;
  hypothesis: string;
  flag: { name: string; purpose: string; safeDefault: "control" };
  variants: Array<{ key: "control" | "treatment"; label: string; allocation: number }>;
  metric: { name: string; eventName: string; trigger: string; instrumentation: "present" | "missing" | "unclear" };
  codeTargets: Array<{ file: string; reason: string; suggestedChange: string }>;
  risks: string[];
  approvalQuestions: string[];
  manualStepsSaved: number;
  nextStep: string;
  instrumentationPlan: {
    status: "verified" | "missing" | "unclear";
    eventName: string;
    trigger: string;
    properties: string[];
    recommendation: string;
  };
  implementationPlan: {
    status: "patch_ready" | "manual_review_required" | "not_applicable";
    summary: string;
    steps: string[];
    tests: string[];
    patch: string;
    patchNote: string;
  };
}
const record=(v:unknown):v is Record<string,unknown>=>typeof v==="object"&&v!==null&&!Array.isArray(v);
const str=(v:unknown,n:string,max=500):string=>{if(typeof v!=="string"||!v.trim()||v.trim().length>max)throw new Error(`PR review field '${n}' must be non-empty text of at most ${max} characters.`);return v.trim();};
const list=(v:unknown,n:string,maxItems=8):string[]=>{if(!Array.isArray(v)||v.length>maxItems)throw new Error(`PR review field '${n}' must be an array with at most ${maxItems} items.`);return v.map((x,i)=>str(x,`${n}[${i}]`,300));};
export function parsePullRequestUrl(input:string):PullRequestTarget {
  let url:URL;try{url=new URL(input.trim());}catch{throw new Error("Enter a full GitHub pull request URL, such as https://github.com/owner/repo/pull/123.");}
  if(url.protocol!=="https:"||url.hostname!=="github.com"||url.search||url.hash)throw new Error("Only a direct HTTPS URL from github.com is supported.");
  const m=url.pathname.match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9][0-9]*)\/?$/);
  if(!m)throw new Error("URL must point to a GitHub pull request: /owner/repository/pull/number.");
  const number=Number(m[3]);if(!Number.isSafeInteger(number))throw new Error("Pull request number is invalid.");
  return{owner:m[1]!,repo:m[2]!,number,url:`https://github.com/${m[1]}/${m[2]}/pull/${number}`};
}
export function validatePrReview(value:unknown,changedFiles:string[]):PrReview {
  if(!record(value))throw new Error("Gemini PR review must be a JSON object.");
  const allowed=["verdict","changeSummary","experimentOpportunity","hypothesis","flag","variants","metric","codeTargets","risks","approvalQuestions","manualStepsSaved","nextStep","instrumentationPlan","implementationPlan"];
  const extra=Object.keys(value).filter(k=>!allowed.includes(k));if(extra.length)throw new Error(`Unexpected PR review fields: ${extra.join(", ")}.`);
  const verdict=value.verdict;if(!["ready_for_experiment","needs_engineering_work","not_a_good_experiment"].includes(String(verdict)))throw new Error("PR review verdict is invalid.");
  if(!record(value.flag))throw new Error("PR review flag is missing.");
  let name=str(value.flag.name,"flag.name",60).toLowerCase();if(!/^[a-z][a-z0-9_]*$/.test(name))throw new Error("Suggested flag name must be lowercase snake_case.");
  if(!name.startsWith("fp_"))name=`fp_${name}`;
  if(value.flag.safeDefault!=="control")throw new Error("The safe default must be the current control experience.");
  if(!record(value.metric))throw new Error("PR review metric is missing.");
  const eventName=str(value.metric.eventName,"metric.eventName",64);
  if(eventName.startsWith("$")||!/^[A-Za-z][A-Za-z0-9_.:-]*$/.test(eventName))throw new Error("Suggested metric event name is invalid or reserved by Flagsmith.");
  const instrumentation=value.metric.instrumentation;if(!["present","missing","unclear"].includes(String(instrumentation)))throw new Error("Metric instrumentation status is invalid.");
  if(!Array.isArray(value.variants)||value.variants.length!==2)throw new Error("This MVP requires exactly two variants.");
  const variants=value.variants.map((v,i)=>{if(!record(v))throw new Error("Variant entry must be an object.");const key=v.key;if(key!==(i===0?"control":"treatment"))throw new Error("Variant keys must be control then treatment.");const allocation=v.allocation;if(typeof allocation!=="number"||!Number.isInteger(allocation)||allocation<1||allocation>99)throw new Error("Variant allocation must be between 1 and 99.");return{key:key as "control"|"treatment",label:str(v.label,`variants[${i}].label`,120),allocation};});
  if(variants[0]!.allocation+variants[1]!.allocation!==100)throw new Error("Control and treatment allocations must add up to 100.");
  if(!Array.isArray(value.codeTargets)||value.codeTargets.length>5)throw new Error("PR review codeTargets must contain at most five entries.");
  const codeTargets=value.codeTargets.map((v,i)=>{if(!record(v))throw new Error("Code target must be an object.");const file=str(v.file,`codeTargets[${i}].file`,240);if(!changedFiles.includes(file))throw new Error(`Code target '${file}' was not present in the reviewed pull request.`);return{file,reason:str(v.reason,"codeTarget.reason",300),suggestedChange:str(v.suggestedChange,"codeTarget.suggestedChange",500)};});
  if(!record(value.instrumentationPlan))throw new Error("PR review instrumentationPlan is missing.");
  const instrumentationPlan=value.instrumentationPlan;
  const instrumentationStatus=instrumentationPlan.status;
  if(!["verified","missing","unclear"].includes(String(instrumentationStatus)))throw new Error("Instrumentation plan status is invalid.");
  const planEvent=str(instrumentationPlan.eventName,"instrumentationPlan.eventName",64);
  if(planEvent!==eventName)throw new Error("Instrumentation plan eventName must match the primary metric eventName.");
  const properties=list(instrumentationPlan.properties,"instrumentationPlan.properties",6);
  if(!record(value.implementationPlan))throw new Error("PR review implementationPlan is missing.");
  const implementation=value.implementationPlan;
  const implementationStatus=implementation.status;
  if(!["patch_ready","manual_review_required","not_applicable"].includes(String(implementationStatus)))throw new Error("Implementation plan status is invalid.");
  const patch=str(implementation.patch||"No patch generated.", "implementationPlan.patch",20000);
  const rawPatchNote=implementation.patchNote;
  const patchNote=typeof rawPatchNote==="string"&&rawPatchNote.trim()
    ? rawPatchNote.trim().slice(0,700)
    : implementationStatus==="patch_ready"
      ? "Review the suggested patch carefully against the target repository before applying it."
      : "No safe patch was supplied; follow the manual review steps before implementation.";
  if(implementationStatus==="patch_ready"){
    if(patch==="No patch generated."||!patch.includes("@@"))throw new Error("A patch-ready implementation must contain a unified diff.");
    const paths=[...patch.matchAll(/^(?:\+\+\+|---) [ab]\/([^\r\n]+)$/gm)].map(m=>m[1]);
    const unique=[...new Set(paths)];
    if(unique.length!==1||!changedFiles.includes(unique[0]!))throw new Error("Implementation patch must target exactly one file from the reviewed PR.");
    if(patch.includes("GIT binary patch")||patch.includes("\\0"))throw new Error("Binary implementation patches are not supported.");
    if(unique[0]!.includes(".."))throw new Error("Implementation patch contains an unsafe path.");
  } else if(patch!=="No patch generated." && patch.trim()!=="") {
    throw new Error("A patch must not be supplied when implementation status is not patch_ready.");
  }
  const saved=value.manualStepsSaved;if(typeof saved!=="number"||!Number.isInteger(saved)||saved<0||saved>20)throw new Error("manualStepsSaved must be a number from 0 to 20.");
  return{
    verdict:verdict as PrReview["verdict"],changeSummary:str(value.changeSummary,"changeSummary",700),
    experimentOpportunity:str(value.experimentOpportunity,"experimentOpportunity",700),hypothesis:str(value.hypothesis,"hypothesis",500),
    flag:{name,purpose:str(value.flag.purpose,"flag.purpose",300),safeDefault:"control"},
    variants,metric:{name:str(value.metric.name,"metric.name",100),eventName,trigger:str(value.metric.trigger,"metric.trigger",300),instrumentation:instrumentation as PrReview["metric"]["instrumentation"]},
    codeTargets,risks:list(value.risks,"risks"),approvalQuestions:list(value.approvalQuestions,"approvalQuestions"),
    manualStepsSaved:saved,nextStep:str(value.nextStep,"nextStep",500),
    instrumentationPlan:{
      status:instrumentationStatus as PrReview["instrumentationPlan"]["status"],
      eventName:planEvent,
      trigger:str(instrumentationPlan.trigger,"instrumentationPlan.trigger",300),
      properties,
      recommendation:str(instrumentationPlan.recommendation,"instrumentationPlan.recommendation",700)
    },
    implementationPlan:{
      status:implementationStatus as PrReview["implementationPlan"]["status"],
      summary:str(implementation.summary,"implementationPlan.summary",700),
      steps:list(implementation.steps,"implementationPlan.steps",6),
      tests:list(implementation.tests,"implementationPlan.tests",6),
      patch:patch==="No patch generated."?"":patch,
      patchNote
    }
  };
}
