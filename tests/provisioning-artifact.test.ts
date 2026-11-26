import test from "node:test";
import assert from "node:assert/strict";
import {validateProvisioningArtifact} from "../src/domain/provisioning-artifact.js";

const proposal={
  experimentName:"FlagPilot: Signup CTA test",
  featureName:"fp_signup_cta_1234567890",
  hypothesis:"Clearer copy increases completed signups.",
  timeframeDays:7,
  targetAudience:"all",
  rolloutPercentage:25,
  controlLabel:"Start free trial",
  treatment:{key:"try_it_free",value:"Try it free",allocation:50},
  metric:{name:"Signup completed 1234567890",eventName:"demo_signup_completed"}
};
const artifact=()=>({
  target:{projectId:55341,environmentKey:"public-development-key"},
  proposal,
  result:{
    feature:{id:305244,name:proposal.featureName},
    treatment:{id:37135,key:"try_it_free",value:"Try it free",allocation:50},
    metric:{id:589,name:proposal.metric.name,eventName:proposal.metric.eventName},
    experiment:{id:596,name:proposal.experimentName,status:"created"}
  },
  createdAt:"2026-11-27T00:00:00.000Z"
});
const expected={projectId:55341,environmentKey:"public-development-key",experimentId:596};

test("accepts matching successful provisioning evidence",()=>{
 const value=validateProvisioningArtifact(artifact(),expected);
 assert.equal(value.result.experiment.id,596);
 assert.equal(value.result.feature.id,305244);
});
test("rejects an experiment ID that does not belong to the selected run",()=>{
 assert.throws(()=>validateProvisioningArtifact(artifact(),{...expected,experimentId:597}),/does not match the selected/);
});
test("rejects an artifact from a different Flagsmith project",()=>{
 assert.throws(()=>validateProvisioningArtifact(artifact(),{...expected,projectId:999}),/different Flagsmith project/);
});
test("rejects an artifact from a different environment",()=>{
 assert.throws(()=>validateProvisioningArtifact(artifact(),{...expected,environmentKey:"other-environment"}),/different Flagsmith environment/);
});
test("rejects a mismatched feature or experiment name",()=>{
 const value=artifact();value.result.feature.name="unrelated";
 assert.throws(()=>validateProvisioningArtifact(value,expected),/resource names do not match/);
});
test("rejects treatment drift",()=>{
 const value=artifact();value.result.treatment.allocation=25;
 assert.throws(()=>validateProvisioningArtifact(value,expected),/treatment does not match/);
});
test("rejects metric drift",()=>{
 const value=artifact();value.result.metric.eventName="other_event";
 assert.throws(()=>validateProvisioningArtifact(value,expected),/metric does not match/);
});
test("rejects a started or stopped experiment in a provisioning artifact",()=>{
 const value=artifact();value.result.experiment.status="running";
 assert.throws(()=>validateProvisioningArtifact(value,expected),/newly provisioned draft/);
});
test("rejects incomplete artifacts without target metadata",()=>{
 const value=artifact();delete value.target;
 assert.throws(()=>validateProvisioningArtifact(value,expected),/complete FlagPilot provisioning artifact/);
});
