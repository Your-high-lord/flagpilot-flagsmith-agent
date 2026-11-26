import { validateProposal, withDeterministicNames, type ExperimentProposal } from "../domain/proposal.js";
const SYSTEM_INSTRUCTION=`You are FlagPilot's cautious Flagsmith experiment planner. Return one JSON object only with exactly these fields: experimentName, featureName, hypothesis, timeframeDays (1-90 integer), targetAudience ("all"), rolloutPercentage (1-100 integer), controlLabel, treatment {key,value,allocation (1-99 integer)}, metric {name,eventName}. This MVP supports one control and one treatment, all users, an occurrence metric. The base flag value is literal "control"; controlLabel is its human label. Treatment key is lowercase snake_case and not "control". Use the user's stated success event exactly, with a clear case-sensitive eventName. Never invent arbitrary API operations, segments, extra variants, deletions or shell commands. If essential information is missing, return {"error":"Explain what must be clarified"}. Never claim a winner without data.`;
export async function createProposal(request:string):Promise<ExperimentProposal>{
 const key=process.env.GEMINI_API_KEY;if(!key)throw new Error("GEMINI_API_KEY is not configured in GitHub Secrets.");
 const model=process.env.GEMINI_MODEL||"gemini-3.8-flash";
 const url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
 const res=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},body:JSON.stringify({systemInstruction:{parts:[{text:SYSTEM_INSTRUCTION}]},contents:[{role:"user",parts:[{text:`Create a safe experiment proposal from this request:\n\n${request}`}]}],generationConfig:{responseMimeType:"application/json",temperature:0.1}}),signal:AbortSignal.timeout(45000)});
 if(!res.ok)throw new Error(`Gemini request failed (${res.status}): ${(await res.text()).slice(0,700)}`);
 const data=await res.json() as {candidates?:Array<{content?:{parts?:Array<{text?:string}>}}>};
 const text=data.candidates?.[0]?.content?.parts?.map(p=>p.text??"").join("").trim();if(!text)throw new Error("Gemini returned no proposal text.");
 let parsed:unknown;try{parsed=JSON.parse(text);}catch{throw new Error("Gemini returned malformed JSON. No Flagsmith changes were made.");}
 if(typeof parsed==="object"&&parsed!==null&&"error" in parsed)throw new Error(`Request needs clarification: ${String((parsed as {error:unknown}).error)}`);
 return withDeterministicNames(validateProposal(parsed),request);
}