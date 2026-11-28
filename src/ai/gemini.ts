import { validateProposal, withDeterministicNames, type ExperimentProposal } from "../domain/proposal.js";
const SYSTEM_INSTRUCTION=`You are FlagPilot's cautious Flagsmith experiment planner. Return one JSON object only with exactly these fields: experimentName, featureName, hypothesis, timeframeDays (1-90 integer), targetAudience ("all"), rolloutPercentage (1-100 integer), controlLabel, treatment {key,value,allocation (1-99 integer)}, metric {name,eventName}. This MVP supports one control and one treatment, all users, an occurrence metric. The base flag value is literal "control"; controlLabel is its human label. Treatment key is lowercase snake_case and not "control". Use the user's stated success event exactly, with a clear case-sensitive eventName. Never invent arbitrary API operations, segments, extra variants, deletions or shell commands. If essential information is missing, return {"error":"Explain what must be clarified"}. Never claim a winner without data.`;
const transientStatuses=new Set([500,502,503,504]);
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
interface ModelResult { text?:string; status?:number; error?:string }
async function callModel(model:string,key:string,request:string):Promise<ModelResult>{
 const url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
 for(let attempt=0;attempt<2;attempt++){
  let response:Response;
  try{
   response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},body:JSON.stringify({systemInstruction:{parts:[{text:SYSTEM_INSTRUCTION}]},contents:[{role:"user",parts:[{text:`Create a safe experiment proposal from this request:\n\n${request}`}]}],generationConfig:{responseMimeType:"application/json",temperature:0.1}}),signal:AbortSignal.timeout(45000)});
  }catch(e){
   if(attempt===0){await delay(1500);continue;}
   return{error:`Network error calling ${model}: ${e instanceof Error?e.message:String(e)}`};
  }
  if(response.ok){
   const data=await response.json() as {candidates?:Array<{content?:{parts?:Array<{text?:string}>}}>};
   const text=data.candidates?.[0]?.content?.parts?.map(p=>p.text??"").join("").trim();
   return text?{text}:{error:`${model} returned no proposal text.`};
  }
  const body=(await response.text()).slice(0,700);
  if(transientStatuses.has(response.status)&&attempt===0){await delay(2000);continue;}
  return{status:response.status,error:`Gemini ${model} returned HTTP ${response.status}: ${body}`};
 }
 return{error:`Gemini ${model} failed after retries.`};
}
export async function createProposal(request:string):Promise<ExperimentProposal>{
 const key=process.env.GEMINI_API_KEY;if(!key)throw new Error("GEMINI_API_KEY is not configured in GitHub Secrets.");
 const primary=process.env.GEMINI_MODEL||"gemini-3.8-flash";
 const fallback=process.env.GEMINI_FALLBACK_MODEL||"gemini-3.5-flash-lite";
 let result=await callModel(primary,key,request);
 if(!result.text&&(result.status===503||Boolean(result.error?.startsWith("Network error calling ")))&&fallback!==primary){
  console.warn(`Primary model ${primary} is temporarily overloaded; retrying with fallback ${fallback}.`);
  result=await callModel(fallback,key,request);
 }
 if(!result.text)throw new Error(result.error||"Gemini could not generate a proposal.");
 let parsed:unknown;try{parsed=JSON.parse(result.text);}catch{throw new Error("Gemini returned malformed JSON. No Flagsmith changes were made.");}
 if(typeof parsed==="object"&&parsed!==null&&"error" in parsed)throw new Error(`Request needs clarification: ${String((parsed as {error:unknown}).error)}`);
 return withDeterministicNames(validateProposal(parsed),request);
}
