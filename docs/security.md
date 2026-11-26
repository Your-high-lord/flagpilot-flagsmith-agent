# Security notes

- `FLAGSMITH_API_KEY` is a privileged organisation Management API token. Store only in GitHub Actions Secrets/protected Environments.
- `GEMINI_API_KEY` is stored as a GitHub Actions Secret. Do not include secrets in prompts, generated plan JSON or logs.
- `FLAGSMITH_ENVIRONMENT_KEY` is a public client-side key. It can be used in the demo browser; it is not an organisation API token.
- Never use workflow inputs for secrets.
- Do not run secret-bearing workflows from untrusted pull requests or forks.
- Plan generation and validation do not receive Flagsmith credentials.
- Resource creation and experiment start are separate approvals.
- Commands are executed with argument arrays via `execFile`, not interpolated shell strings.
- No AI-generated shell commands or API URLs are executed.
- Do not print request headers or access tokens. Rotate a key immediately if it appears in a log, commit, screenshot or browser bundle.
- Use a dedicated hackathon key and revoke it after the event.

## PR review promotion safeguards

- PR review artifacts record the source PR head and base commit SHAs. Promotion rejects truncated diffs, incomplete changed-file counts, missing patches, missing source SHAs and incomplete source scans.
- The source scanner checks the exact proposed metric event against a supported tracking call in source files fetched at the reviewed head SHA. A match is code evidence only; it does not establish event delivery or warehouse ingestion.
- The operator must explicitly confirm that the exact event was delivered to Flagsmith and the connected warehouse. This is a human attestation, not an automated claim.
- The promotion workflow re-fetches the source PR before preparing the proposal and again after the protected `flagsmith-create` approval, immediately before provisioning. Closed or changed PRs are rejected.
- The source review artifact must come from a successful run of the FlagPilot PR-review workflow on the default branch. The artifact is downloaded by run ID rather than from the mutable latest-report page.
- Browser code never receives `FLAGSMITH_API_KEY`. The only browser credential is the user-provided, repository-scoped GitHub token used to request GitHub Actions workflows and read workflow status.

- Deterministic instrumentation checks use the TypeScript AST parser and accept only case-sensitive `trackEvent("event")` calls on an official `@flagsmith/flagsmith` imported client, an instance created by `createFlagsmithInstance`, or the documented `window.flagsmith` global. Comments, strings, generic tracking methods, unrelated objects, dynamic event arguments, unsupported languages and syntax errors do not count as verified calls.
- Existing experiment reuse is read-back gated: feature and variation identity, exact metric, expected direction, hypothesis, created status, enabled rollout percentage, control value, treatment option/allocation and all-identities audience must match. Unknown or mismatched configuration fails closed.
- PR promotions include reviewed head/base SHAs and the approved configuration in the deterministic resource identity. Repeated identical proposals are idempotent; changed commits or settings receive a distinct identity.
- The measurement window is metadata only. No automatic stop or end-date enforcement is implemented.
- Newly created project-level features default to disabled. The experiment's rollout is configured only in the selected target environment, avoiding accidental exposure in other environments.
