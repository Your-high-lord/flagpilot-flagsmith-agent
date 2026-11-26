export interface SourcePullRequestSnapshot{
  state?:string;
  head?:{sha?:string};
  base?:{sha?:string};
}
export function assertSourcePullRequestCurrent(expected:{headSha:string;baseSha:string},current:SourcePullRequestSnapshot):void{
  if(current.state!=="open")throw new Error("FlagPilot refused provisioning: the source pull request is no longer open.");
  if(current.head?.sha!==expected.headSha||current.base?.sha!==expected.baseSha)throw new Error("FlagPilot refused provisioning: the source pull request changed after approval. Run a fresh review and request approval again.");
}
