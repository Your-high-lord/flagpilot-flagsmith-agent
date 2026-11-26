import {appendFile,writeFile,mkdir} from "node:fs/promises";import {collectRecords,parseCliJson,runFlagsmith} from "../flagsmith/cli.js";
const org=process.env.FLAGSMITH_ORGANISATION?.trim(),project=process.env.FLAGSMITH_PROJECT?.trim(),name=process.env.FLAGSMITH_ENVIRONMENT_NAME?.trim()||"FlagPilot Development";if(!org||!project)throw new Error("Set FLAGSMITH_ORGANISATION and FLAGSMITH_PROJECT.");if(!process.env.FLAGSMITH_API_KEY)throw new Error("FLAGSMITH_API_KEY is missing.");
const ctx=["--organisation",org,"--project",project,"--no-input","--json"];
const find=(v:unknown,n:string)=>collectRecords(v).find(r=>r.name===n);
const keyOf=(r:Record<string,unknown>|undefined)=>{if(!r)return undefined;for(const k of ["api_key","environment_key","environmentKey","key"]){const v=r[k];if(typeof v==="string"&&v.length>8)return v;}return undefined;};
const before=parseCliJson(await runFlagsmith(["environment","list",...ctx]));let env=find(before,name),created=false;
if(!env){await runFlagsmith(["environment","create",name,"--description","Dedicated environment for FlagPilot hackathon experiments and demo traffic.",...ctx]);created=true;}
const after=parseCliJson(await runFlagsmith(["environment","list",...ctx]));env=find(after,name);let envKey=keyOf(env);
if(!envKey){const detail=parseCliJson(await runFlagsmith(["environment","get",name,...ctx]));env=find(detail,name)??env;envKey=keyOf(env);}
if(!envKey)throw new Error("CLI did not return the new environment's client-side key. Stop; do not create duplicates or touch existing environments.");
const projectOut=parseCliJson(await runFlagsmith(["project","get",project,"--organisation",org,"--no-input","--json"]));const records=collectRecords(projectOut);const projectRecord=records.find(r=>r.name===project)??records[0];const projectId=projectRecord?.id;
if(!(typeof projectId==="number"||(typeof projectId==="string"&&/^\d+$/.test(projectId))))throw new Error("Could not resolve numeric project ID.");
await mkdir("artifacts",{recursive:true});await writeFile("artifacts/flagsmith-environment.json",JSON.stringify({organisation:org,project,projectId:String(projectId),environmentName:name,environmentKey:"[stored as repository variable]",created},null,2));
if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`project_id=${projectId}\nenvironment_key=${envKey}\ncreated=${created}\n`);
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,[ "## FlagPilot · Environment setup",`- Organisation: ${org}`,`- Project: ${project}`,`- Project ID: ${projectId}`,`- Environment: ${name}`,`- Created now: ${created?"yes":"no — exact name match reused"}`,"- Client key saved as repository variable; not printed.",""].join("\n"));
console.log(`Environment '${name}' is ready. Project ID: ${projectId}. Client key written to GITHUB_OUTPUT.`);