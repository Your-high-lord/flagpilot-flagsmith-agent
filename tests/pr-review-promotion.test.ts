import test from "node:test";
import assert from "node:assert/strict";
import {prepareProposalFromReview} from "../src/domain/pr-review-promotion.js";
const repositoryFullName="Your-high-lord/flagpilot-flagsmith-agent";
const changedFiles=["src/components/Checkout.tsx"];
const goodReview={
  verdict:"ready_for_experiment",
  changeSummary:"The PR adds a new checkout CTA option.",
  experimentOpportunity:"The copy change can be compared using an existing click event.",
  hypothesis:"The clearer checkout call to action increases checkout starts.",
  flag:{name:"checkout_cta_copy",purpose:"Choose which CTA copy is displayed.",safeDefault:"control"},
  variants:[
    {key:"control",label:"Continue to checkout",allocation:50},
    {key:"treatment",label:"Review your order",allocation:50}
  ],
  metric:{name:"Checkout started",eventName:"checkout_started",trigger:"A user advances from cart to checkout.",instrumentation:"present"},
  codeTargets:[{file:"src/components/Checkout.tsx",reason:"Contains the changed CTA.",suggestedChange:"Select the label through the proposed feature flag."}],
  risks:["Keep the checkout route and payment flow identical."],
  approvalQuestions:["Confirm the existing event fires after a successful navigation."],
  manualStepsSaved:3,
  nextStep:"Review the proposed experiment and approve draft creation.",
  instrumentationPlan:{status:"verified",eventName:"checkout_started",trigger:"Successful cart-to-checkout navigation.",properties:["variant","device_type"],recommendation:"Reuse the verified checkout_started event."},
  implementationPlan:{status:"manual_review_required",summary:"Review the current SDK binding before changing the CTA code.",steps:["Inspect the existing Flagsmith provider.","Add the approved flag check around the label only."],tests:["Control shows the current label.","Treatment shows the alternative label."],patch:"",patchNote:"A manual code review is required before applying the feature flag."}
};
function report(review:unknown=goodReview,overrides:Record<string,unknown>={}){return{
  pullRequest:{url:"https://github.com/acme/shop/pull/42",title:"Improve checkout CTA copy",changedFiles},
  review,
  createdAt:"2026-11-27T00:00:00.000Z",
  workflowRunUrl:`https://github.com/${repositoryFullName}/actions/runs/12345`,
  ...overrides
};}
const options={reviewRunId:12345,repositoryFullName,rolloutPercentage:10,timeframeDays:7};
test("converts an eligible PR review into a deterministic Flagsmith experiment proposal",()=>{
  const result=prepareProposalFromReview(report(),options);
  assert.match(result.proposal.featureName,/^fp_checkout_cta_copy_[a-f0-9]{6}$/);
  assert.match(result.proposal.experimentName,/^FlagPilot: PR #42:/);
  assert.equal(result.proposal.targetAudience,"all");
  assert.equal(result.proposal.rolloutPercentage,10);
  assert.equal(result.proposal.timeframeDays,7);
  assert.equal(result.proposal.treatment.allocation,50);
  assert.equal(result.proposal.metric.eventName,"checkout_started");
  assert.equal(result.source.reviewRunId,12345);
});
test("refuses a PR review that says not a good experiment",()=>assert.throws(()=>prepareProposalFromReview(report({...goodReview,verdict:"not_a_good_experiment"}),options),/Only ready_for_experiment reviews/));
test("refuses a PR review that needs engineering work",()=>assert.throws(()=>prepareProposalFromReview(report({...goodReview,verdict:"needs_engineering_work"}),options),/Only ready_for_experiment reviews/));
test("refuses missing instrumentation",()=>assert.throws(()=>prepareProposalFromReview(report({...goodReview,metric:{...goodReview.metric,instrumentation:"missing"}}),options),/event must be present/));
test("refuses unverified instrumentation",()=>assert.throws(()=>prepareProposalFromReview(report({...goodReview,instrumentationPlan:{...goodReview.instrumentationPlan,status:"unclear"}}),options),/event must be present/));
test("refuses a report with no concrete changed code location",()=>assert.throws(()=>prepareProposalFromReview(report({...goodReview,codeTargets:[]}),options),/concrete changed code location/));
test("refuses implementation marked not applicable",()=>assert.throws(()=>prepareProposalFromReview(report({...goodReview,implementationPlan:{...goodReview.implementationPlan,status:"not_applicable"}}),options),/implementation as not applicable/));
test("refuses a report URL pointing to another run",()=>assert.throws(()=>prepareProposalFromReview(report(),{...options,reviewRunId:12346}),/does not belong to the selected/));
test("refuses report run URL from another repository",()=>assert.throws(()=>prepareProposalFromReview(report(goodReview,{workflowRunUrl:"https://github.com/attacker/repo/actions/runs/12345"}),options),/does not belong to the selected/));
test("validates rollout and measurement window",()=>{
  assert.throws(()=>prepareProposalFromReview(report(),{...options,rolloutPercentage:0}),/rolloutPercentage/);
  assert.throws(()=>prepareProposalFromReview(report(),{...options,timeframeDays:91}),/timeframeDays/);
});
