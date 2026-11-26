# Architecture

## Trust boundaries

- Browser demo: public Flagsmith environment key only. No organisation token, Gemini key or GitHub token.
- Gemini planner: receives the experiment request only. It returns structured data; it cannot execute commands or select arbitrary API paths.
- Plan job: validates and uploads the proposal. It has no Flagsmith credentials.
- Protected setup/provision job: waits for the `flagsmith-create` Environment approval. The Management API key is scoped to protected steps only.
- Preflight: after approval and before writes, read-only checks verify the warehouse is Connected and experimentation endpoints are readable.
- Provision: CLI creates the feature and keyed variant; API creates metric and draft experiment.
- Start job: separate manual workflow and `flagsmith-start` approval. It starts only an allowed pre-start state and verifies running.

## Resource lifecycle

`request -> proposal -> schema validation -> create approval -> read-only warehouse/API preflight -> feature + keyed treatment -> metric -> draft experiment -> read-back verification -> demo instrumentation -> start approval -> running verification`

The base flag value is the string `control`. The treatment is a keyed multivariate option created with initial weight zero. Experiment rollout and variation allocation are separate: rollout controls the proportion entering the experiment; treatment allocation controls the split among enrolled identities, with control receiving the remainder.

## Idempotency and recovery

Resource names are derived deterministically from the request, so an identical retry can find the same feature/metric/experiment. Existing matching resources are reused. Existing mismatched resources cause a hard stop. The implementation never deletes resources or blindly retries a write after an uncertain response. If a run is interrupted after a partial write, inspect the report and Flagsmith dashboard before re-running.
