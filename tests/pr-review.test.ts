import test from "node:test";
import assert from "node:assert/strict";
import {parsePullRequestUrl,validatePrReview} from "../src/domain/pr-review.js";
const files=["src/components/Checkout.tsx","src/analytics.ts"];
const good={verdict:"ready_for_experiment",changeSummary:"The PR changes the checkout CTA and its click handler.",experimentOpportunity:"The alternate label can be compared without changing the payment flow.",hypothesis:"A clearer checkout CTA increases completed checkout starts.",flag:{name:"checkout_cta",purpose:"Choose the checkout CTA copy.",safeDefault:"control"},variants:[{key:"control",label:"Continue to checkout",allocation:50},{key:"treatment",label:"Review your order",allocation:50}],metric:{name:"Checkout started",eventName:"checkout_started",trigger:"User successfully advances from cart to checkout.",instrumentation:"missing"},codeTargets:[{file:"src/components/Checkout.tsx",reason:"Contains the changed CTA.",suggestedChange:"Keep the current label as the control and resolve the treatment label from the Flagsmith value."}],risks:["Do not alter payment processing or eligibility."],approvalQuestions:["Confirm the event fires only after a successful transition."],manualStepsSaved:4,nextStep:"Review the code target and approve a flag proposal.",instrumentationPlan:{status:"missing",eventName:"checkout_started",trigger:"User successfully advances from cart to checkout.",properties:["variant","device_type"],recommendation:"Add the event after the successful route transition."},implementationPlan:{status:"manual_review_required",summary:"Confirm the existing Flagsmith SDK integration before editing.",steps:["Inspect the app SDK provider.","Confirm the flag lookup API."],tests:["Test control fallback.","Test both variants."],patch:"",patchNote:"The PR diff does not include the existing SDK initialisation."}};
test("parses a direct public GitHub pull request URL",()=>assert.deepEqual(parsePullRequestUrl("https://github.com/acme/shop/pull/42"),{owner:"acme",repo:"shop",number:42,url:"https://github.com/acme/shop/pull/42"}));
test("rejects non-GitHub URLs",()=>assert.throws(()=>parsePullRequestUrl("https://evil.example/acme/shop/pull/42"),/github.com/));
test("rejects non-pull-request paths",()=>assert.throws(()=>parsePullRequestUrl("https://github.com/acme/shop/issues/42"),/pull request/));
test("normalises feature flag names and validates code paths",()=>assert.equal(validatePrReview(good,files).flag.name,"fp_checkout_cta"));
test("rejects code suggestions outside changed files",()=>assert.throws(()=>validatePrReview({...good,codeTargets:[{...good.codeTargets[0],file:"src/secrets.ts"}]},files),/not present/));
test("rejects unsafe non-control default",()=>assert.throws(()=>validatePrReview({...good,flag:{...good.flag,safeDefault:"treatment"}},files),/safe default/));
test("rejects invalid allocations",()=>assert.throws(()=>validatePrReview({...good,variants:[good.variants[0],{...good.variants[1],allocation:30}]},files),/add up to 100/));
test("rejects reserved metric event names",()=>assert.throws(()=>validatePrReview({...good,metric:{...good.metric,eventName:"$exposure"}},files),/invalid or reserved/));

test("accepts an implementation plan without inventing an SDK patch",()=>assert.equal(validatePrReview(good,files).implementationPlan.status,"manual_review_required"));
test("rejects a patch that targets a file outside the PR",()=>assert.throws(()=>validatePrReview({...good,implementationPlan:{...good.implementationPlan,status:"patch_ready",patch:"--- a/src/secrets.ts\\n+++ b/src/secrets.ts\\n@@ -1 +1 @@\\n-old\\n+new"}},files),/exactly one file/));
test("requires instrumentation event to match primary metric",()=>assert.throws(()=>validatePrReview({...good,instrumentationPlan:{...good.instrumentationPlan,eventName:"other_event"}},files),/must match/));

test("accepts a unified patch limited to one changed file",()=>assert.equal(validatePrReview({...good,implementationPlan:{...good.implementationPlan,status:"patch_ready",patch:`--- a/src/components/Checkout.tsx
+++ b/src/components/Checkout.tsx
@@ -1 +1 @@
-old
+new`}},files).implementationPlan.status,"patch_ready"));
test("rejects patches that touch more than one changed file",()=>assert.throws(()=>validatePrReview({...good,implementationPlan:{...good.implementationPlan,status:"patch_ready",patch:`--- a/src/components/Checkout.tsx
+++ b/src/components/Checkout.tsx
@@ -1 +1 @@
-old
+new
--- a/src/analytics.ts
+++ b/src/analytics.ts
@@ -1 +1 @@
-old
+new`}},files),/exactly one file/));
