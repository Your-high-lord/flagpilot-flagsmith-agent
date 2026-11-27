import test from "node:test";
import assert from "node:assert/strict";
import {createGitHubApiClient,fetchPublicSourceFile,GitHubApiError,type FetchLike} from "../src/domain/github-api.js";

const endpoint="https://api.github.com/repos/Flagsmith/flagsmith/pulls/9115";
function json(body:unknown,status=200,headers:Record<string,string>={}):Response{
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json",...headers}});
}
test("GitHub API requests carry bearer auth and the required API headers",async()=>{
  let seen:RequestInit|undefined;
  const fake:FetchLike=async(_url,init)=>{seen=init;return json({number:9115});};
  const get=createGitHubApiClient("read-only-token",fake,async()=>{});
  assert.deepEqual(await get<{number:number}>(endpoint),{number:9115});
  const headers=new Headers(seen?.headers);
  assert.equal(headers.get("Authorization"),"Bearer read-only-token");
  assert.equal(headers.get("X-GitHub-Api-Version"),"2022-11-28");
  assert.equal(seen?.redirect,"error");
});
test("GitHub API client refuses to send credentials to another host",async()=>{
  let called=false;
  const fake:FetchLike=async()=>{called=true;return json({});};
  const get=createGitHubApiClient("token",fake,async()=>{});
  await assert.rejects(()=>get("https://raw.githubusercontent.com/Flagsmith/flagsmith/main/README.md"),/only be sent to/);
  assert.equal(called,false);
});
test("GitHub API client requires a token",()=>assert.throws(()=>createGitHubApiClient(" "),/GITHUB_TOKEN is required/));
test("GitHub API client retries a primary rate-limit 403 and succeeds",async()=>{
  let calls=0,waits:number[]=[];
  const fake:FetchLike=async()=>++calls===1
    ?json({message:"API rate limit exceeded"},403,{"x-ratelimit-remaining":"0","retry-after":"1"})
    :json({number:9115});
  const get=createGitHubApiClient("token",fake,async ms=>{waits.push(ms);});
  assert.deepEqual(await get<{number:number}>(endpoint),{number:9115});
  assert.equal(calls,2);
  assert.deepEqual(waits,[1000]);
});
test("GitHub API client retries a transient 503 within a bounded attempt count",async()=>{
  let calls=0,waits:number[]=[];
  const fake:FetchLike=async()=>++calls===1?json({message:"temporarily unavailable"},503):json({ok:true});
  const get=createGitHubApiClient("token",fake,async ms=>{waits.push(ms);});
  assert.deepEqual(await get<{ok:boolean}>(endpoint),{ok:true});
  assert.equal(calls,2);
  assert.deepEqual(waits,[500]);
});
test("GitHub API client does not retry ordinary permission-denied 403 responses",async()=>{
  let calls=0;
  const fake:FetchLike=async()=>{calls++;return json({message:"Resource not accessible by integration"},403);};
  const get=createGitHubApiClient("token",fake,async()=>{});
  await assert.rejects(()=>get(endpoint),(error:unknown)=>{
    assert.ok(error instanceof GitHubApiError);
    assert.equal(error.status,403);
    assert.match(error.message,/pull-requests: read/);
    return true;
  });
  assert.equal(calls,1);
});
test("GitHub API client retries 429 using Retry-After",async()=>{
  let calls=0,waits:number[]=[];
  const fake:FetchLike=async()=>++calls===1?json({message:"slow down"},429,{"retry-after":"2"}):json({ok:true});
  const get=createGitHubApiClient("token",fake,async ms=>{waits.push(ms);});
  assert.deepEqual(await get<{ok:boolean}>(endpoint),{ok:true});
  assert.deepEqual(waits,[2000]);
});
test("GitHub API client fails clearly after bounded retries",async()=>{
  let calls=0,waits:number[]=[];
  const fake:FetchLike=async()=>{calls++;return json({message:"still unavailable"},503);};
  const get=createGitHubApiClient("token",fake,async ms=>{waits.push(ms);});
  await assert.rejects(()=>get(endpoint),/HTTP 503/);
  assert.equal(calls,3);
  assert.deepEqual(waits,[500,1000]);
});
test("public source retrieval never receives GitHub API credentials",async()=>{
  let seen:RequestInit|undefined;
  const fake:FetchLike=async(_url,init)=>{seen=init;return new Response("export const value = 1;",{status:200});};
  const value=await fetchPublicSourceFile("https://raw.githubusercontent.com/Flagsmith/flagsmith/main/src/index.ts",fake);
  assert.equal(value,"export const value = 1;");
  const headers=new Headers(seen?.headers);
  assert.equal(headers.has("Authorization"),false);
});
test("public source retrieval rejects non-raw hosts",async()=>{
  let called=false;
  const fake:FetchLike=async()=>{called=true;return new Response("no");};
  await assert.rejects(()=>fetchPublicSourceFile("https://api.github.com/repos/a/b",fake),/restricted to raw.githubusercontent.com/);
  assert.equal(called,false);
});
test("public source retrieval reports deleted or inaccessible files clearly",async()=>{
  const fake:FetchLike=async()=>new Response("Not Found",{status:404});
  await assert.rejects(()=>fetchPublicSourceFile("https://raw.githubusercontent.com/Flagsmith/flagsmith/main/deleted.ts",fake),/HTTP 404/);
});
