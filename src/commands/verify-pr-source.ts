import {readFile} from "node:fs/promises";
import {parsePullRequestUrl} from "../domain/pr-review.js";
import {assertSourcePullRequestCurrent} from "../domain/pr-source-current.js";
function required(name:string):string{const value=process.env[name]?.trim();if(!value)throw new Error(`${name} is required.`);return value;}
const plan=JSON.parse(await readFile("artifacts/plan.json","utf8")) as {source?:{pullRequestUrl?:string;sourceHeadSha?:string;sourceBaseSha?:string}};
const source=plan.source;
if(!source?.pullRequestUrl||!source.sourceHeadSha||!source.sourceBaseSha)throw new Error("The validated plan is missing its source pull request and immutable commit SHAs.");
const target=parsePullRequestUrl(source.pullRequestUrl);
const response=await fetch(`https://api.github.com/repos/${target.owner}/${target.repo}/pulls/${target.number}`,{
  headers:{Accept:"application/vnd.github+json","User-Agent":"FlagPilot-PR-Experiment-Agent","X-GitHub-Api-Version":"2022-11-28",Authorization:`Bearer ${required("GITHUB_TOKEN")}`},
  signal:AbortSignal.timeout(20000)
});
if(!response.ok)throw new Error(`Could not recheck source PR immediately before provisioning (HTTP ${response.status}).`);
const current=await response.json() as {state?:string;head?:{sha?:string};base?:{sha?:string}};
assertSourcePullRequestCurrent({headSha:source.sourceHeadSha,baseSha:source.sourceBaseSha},current);
console.log(`Source PR is still open and unchanged at head ${source.sourceHeadSha} and base ${source.sourceBaseSha}.`);
