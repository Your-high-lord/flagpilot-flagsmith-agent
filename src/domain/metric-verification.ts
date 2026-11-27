import {isRecord} from "../flagsmith/api.js";

export interface ExpectedMetricConfiguration {
  id:number;
  name:string;
  eventName:string;
}

/**
 * Fail closed unless the live Flagsmith metric is exactly the metric tied to
 * the approved proposal. Used at provisioning read-back and again immediately
 * before an approved experiment start.
 */
export function verifyMetricConfiguration(value:unknown,expected:ExpectedMetricConfiguration):void {
  if(!Number.isSafeInteger(expected.id)||expected.id<=0) {
    throw new Error("Expected Flagsmith metric ID must be a positive safe integer.");
  }
  if(!isRecord(value)) {
    throw new Error("Flagsmith metric read-back did not return an object.");
  }
  if(!Number.isSafeInteger(Number(value.id))||Number(value.id)!==expected.id) {
    throw new Error("Live metric ID does not match the approved provisioning artifact.");
  }
  if(value.name!==expected.name) {
    throw new Error("Live metric name does not match the approved proposal.");
  }
  const definition=value.definition;
  if(!isRecord(definition)||definition.event!==expected.eventName) {
    throw new Error("Live metric event definition does not match the exact approved event name.");
  }
  if(value.aggregation!=="occurrence") {
    throw new Error("Live metric aggregation must remain occurrence.");
  }
  if(value.direction!=="up") {
    throw new Error("Live metric direction must remain up.");
  }
}

export interface MetricReader {
  getMetric(id:number):Promise<unknown>;
}

/** Fetch by the artifact-bound ID and verify the current live definition. */
export async function fetchAndVerifyLiveMetric(api:MetricReader,expected:ExpectedMetricConfiguration):Promise<void> {
  const liveMetric=await api.getMetric(expected.id);
  verifyMetricConfiguration(liveMetric,expected);
}
