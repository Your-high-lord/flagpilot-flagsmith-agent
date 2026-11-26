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
