# FlagPilot

**AI-assisted, approval-gated experiment provisioning for Flagsmith.** Built for WeMakeDevs × Flagsmith Toggle Wars 2026, Track 02.

FlagPilot turns a natural-language experiment request into a validated proposal, checks the target environment, creates the multivariate feature, keyed variation, metric and draft experiment with the Flagsmith Management API, and verifies the resources. Starting the experiment is a separate workflow with a second human approval.

> **Safety rule:** the AI plans; deterministic application code validates and executes a small allowlist of operations. Gemini never receives credentials and never chooses arbitrary commands or API URLs.

## Current scope

- One control and one treatment variation.
- All-users audience only (segment targeting is deliberately out of scope for this first version).
- 1–100% experiment rollout; 1–99% treatment allocation, with control receiving the remainder.
- Occurrence metric with expected direction `increase`.
- Resource names are deterministic for an identical request so reruns can recognise resources created by an interrupted run.
- Existing resources are reused only when their values match; mismatches stop without overwriting.
- No automatic deletion or blind retry of resource-creation requests.
- The experiment is created as a draft. Starting requires a different workflow and a second approval.

## Architecture

1. **Plan:** GitHub Actions sends the user request to Gemini. The response is parsed and validated against a strict schema. This job has no Flagsmith credentials and makes no Flagsmith writes.
2. **Create approval:** the `flagsmith-create` GitHub Environment pauses the protected setup/provisioning job for human approval.
3. **Preflight:** after approval and before any writes, a read-only Management API check verifies the warehouse is `Connected` and that the metric and experiment endpoints are readable.
4. **Provision:** the Management API creates the multivariate feature, keyed variation, metric and draft experiment. Flagsmith CLI v2 is installed and used for resource inspection; it is not the writer for these resources. The code reads resources back and records their IDs.
5. **Instrument and verify:** configure the demo with the public environment key, feature name, control label and exact conversion event. `getExperimentFlag` records exposure; `trackEvent` records the conversion; `flushEvents` sends buffered events.
6. **Start approval:** a separate `start-experiment.yml` workflow requires an explicit checkbox and the protected `flagsmith-start` Environment approval. It starts the experiment and verifies `running` status.

## First-time setup (owner actions)

### 1. Create the GitHub repository

Create a **public** repository named `flagpilot-flagsmith-agent`. The competition repository and source code must start after the official kickoff. 
### 2. Create protected environments and add the management secret

In **Settings → Environments**, create `flagsmith-create` and `flagsmith-start`. Add your GitHub account as a required reviewer for both, restrict deployments to `main`, and disable **Prevent self-review** so a solo participant can approve their own deployment.

In the `flagsmith-create` environment, add the secret `FLAGSMITH_API_KEY`. Add the same secret to `flagsmith-start`. Do not store this privileged key as an unrestricted repository secret.

In **Settings → Secrets and variables → Actions → New repository secret**, add only:

| Secret | Purpose |
|---|---|
| `GEMINI_API_KEY` | Gemini Developer API key used only by the planning job. |

Create a Gemini key at [Google AI Studio](https://aistudio.google.com/apikey). The primary model defaults to `gemini-3.8-flash` and falls back to `gemini-3.5-flash-lite` if the primary returns a sustained HTTP 503. Both can be changed with repository variables `GEMINI_MODEL` and `GEMINI_FALLBACK_MODEL`.

Create the Flagsmith organisation API key in **Flagsmith → Organisation settings → API Access → Create API Key**. Treat it as a privileged secret. Do not paste it into this repository or into a chat.

### 3. Create or reuse the dedicated environment

Open **Actions → Set up FlagPilot environment → Run workflow**. Defaults are:

- Organisation: `Asir's Org`
- Project: `My first project`
- Environment: `FlagPilot Development`

The workflow uses Flagsmith CLI v2 to create the environment if it does not exist, or reuses an exact name match. It reports the project ID and the newly created/reused environment's client SDK key. It does not delete or modify `Development` or `Production`. GitHub's workflow `GITHUB_TOKEN` cannot write Actions repository variables, so add the identifiers manually under **Settings → Secrets and variables → Actions → Variables**.

If the CLI cannot resolve the organisation/project or cannot return the new environment's client key, stop and inspect the job error; do not create a duplicate environment manually.

### 4. Add the Flagsmith repository variables

After the setup workflow completes, add these **repository variables** under **Settings → Secrets and variables → Actions → Variables** (not Secrets):

| Variable | Value |
|---|---|
| `FLAGSMITH_ORGANISATION` | `Asir's Org` |
| `FLAGSMITH_PROJECT` | `My first project` |
| `FLAGSMITH_PROJECT_ID` | The numeric project ID shown in the setup workflow summary |
| `FLAGSMITH_ENVIRONMENT_KEY` | The public client-side SDK key shown in the setup workflow output |
| `GEMINI_MODEL` | `gemini-3.8-flash` (optional; default used if omitted) |

Do not put `FLAGSMITH_API_KEY` in repository variables. It remains an environment secret.

### 5. Connect the Flagsmith managed warehouse

In the Flagsmith dashboard, select **FlagPilot Development → Environment Settings → Warehouse**. Choose the managed Flagsmith warehouse, enable it and use **Send your first event**. The status can remain `Pending Connection` while the first event is processed; the documented first-event processing time can be up to a few hours. Wait until the status is `Connected` before provisioning an experiment.

Native Flagsmith Experimentation is currently documented as beta/Enterprise beta. Toggle Wars organisers said participants should contact the dedicated Discord channel if licensing blocks them. Ask for hackathon access rather than trying to bypass a restriction.

### 6. Approval and credential boundary

The `flagsmith-create` environment protects environment creation, read-only preflight and resource provisioning. The `flagsmith-start` environment independently protects starting the experiment. The Gemini planning job has no Flagsmith credential. The Management API key is available only inside the protected environments and is never sent to Gemini or the browser demo.

## PR-to-Experiment AI agent

FlagPilot also provides a read-only code-review workflow. Submit a public GitHub pull-request URL through the operator console or run `.github/workflows/review-pull-request.yml`. The workflow fetches the PR title, description, changed-file list and textual diff, then asks Gemini to assess whether the code change is a meaningful experiment opportunity. It returns a validated hypothesis, safe control/treatment proposal, metric and trigger, instrumentation status, code locations limited to changed files, risks, human approval questions and a JSON evidence artifact (`flagpilot-pr-review`).

This is deliberately analysis-only: it does not commit code, modify the pull request, create Flagsmith resources or start an experiment. The existing separately approved provisioning and start workflows remain responsible for Flagsmith writes. The PR-review workflow must first be present on the default branch before GitHub enables manual `workflow_dispatch` from the console.

## FlagPilot operator console

The GitHub Pages site is the FlagPilot operator console. It provides the natural-language request form, proposal/resource summary, workflow timeline, evidence links and navigation to the Flagsmith SDK demo. To submit a new request from the page, connect a fine-grained GitHub personal access token restricted to this repository with **Actions: read and write** permission. The token is kept in the browser tab's session storage and is sent only to `api.github.com`; it is never sent to FlagPilot or Flagsmith servers. The Flagsmith organisation Management API key remains a protected GitHub Environment secret.

GitHub Environment approvals still happen on GitHub's protected deployment review screen. The dashboard links to those workflows; it does not bypass or simulate approval. Live workflow status is read from the GitHub Actions API. The current experiment/resource summary is a verified snapshot and is not presented as a live Flagsmith API query.

The original visitor-facing SDK demo is preserved at `store.html`.

## Run the workflows

### A. Create or reuse the Flagsmith environment

Run **Actions → Set up FlagPilot environment → Run workflow**. Check that the job reports the project ID and stores `FLAGSMITH_ENVIRONMENT_KEY` as a repository Variable.

### B. Plan and provision a draft experiment

Run **Actions → FlagPilot · Plan and provision experiment → Run workflow**. Enter a request such as:

> Test two signup button labels: “Start free trial” and “Try it free”. Use a 100% rollout, split the experiment 50/50, and measure completed demo signups. The hypothesis is that clearer CTA wording will increase completed signups within seven days.

Review the AI proposal in the planning job summary and artifact. The protected job pauses at `flagsmith-create`; after you approve, its first step runs the read-only preflight. If preflight fails, the workflow stops before any Flagsmith writes. After provisioning, download `flagpilot-provision-result` and note the feature name, metric event name and experiment ID. The experiment remains a draft.

### C. Instrument and test the demo before starting

Deploy **Actions → Deploy FlagPilot demo to GitHub Pages**. If Pages is not yet enabled, go to **Settings → Pages → Build and deployment** and choose **GitHub Actions**.

Open the deployed demo. Enter:

- The **client-side Environment Key** from FlagPilot Development → SDK Settings (public key only).
- The feature name from the provisioning report.
- The control label from the proposal.
- The exact metric event name from the provisioning report.

Connect, confirm that Flagsmith returns a variation and confirms experiment enrolment, generate another demo visitor and confirm identity stability, then click the demo conversion button. The page uses `getExperimentFlag`, `trackEvent` and `flushEvents`. No organisation Management API key belongs in the page.

### D. Start the experiment (second approval)

Only after the demo and events have been smoke-tested, run **Actions → FlagPilot · Start experiment (second approval)**. Enter the numeric experiment ID and set `demo_verified` to `true`. Review and approve the protected `flagsmith-start` job. The workflow starts the experiment and checks that the returned status is `running`.

## Testing

```bash
npm install
npm run build
npm test
```

Automated tests use deterministic fixtures and do not require Flagsmith or Gemini credentials. A real Flagsmith integration test is deliberately separate and should only run after the read-only preflight succeeds.

## Synthetic QA traffic

Synthetic visitors can be used to verify instrumentation, as confirmed in the Toggle Wars webinar. Label them clearly as synthetic QA traffic. Each visitor must have a distinct stable identity; call `getExperimentFlag` before tracking conversions and flush buffered events before exit. Never present synthetic conversions as real customers or claim statistical significance from a small demo sample.

## Official references

- [Toggle Wars hackathon](https://www.wemakedevs.org/hackathons/flagsmith)
- [Flagsmith experiment setup with a coding agent](https://docs.flagsmith.com/experimentation/set-up-with-a-coding-agent)
- [Create an experiment](https://docs.flagsmith.com/experimentation/create-an-experiment)
- [Run an experiment](https://docs.flagsmith.com/experimentation/run-an-experiment)
- [Connect a warehouse](https://docs.flagsmith.com/experimentation/connect-a-warehouse)
- [Management API authentication](https://docs.flagsmith.com/integrating-with-flagsmith/flagsmith-api-overview/management-api/authentication)
- [Flagsmith CLI v2](https://github.com/Flagsmith/flagsmith-cli)
- [Flagsmith CLI setup GitHub Action](https://github.com/Flagsmith/setup-cli)

## Competition disclosure

FlagPilot uses Gemini for natural-language proposal generation, GitHub Actions for automation and the Flagsmith CLI/Management API/JavaScript SDK for real feature flag and experiment operations. All resource writes and experiment start operations require human approval. Any synthetic demo data is explicitly labelled.
