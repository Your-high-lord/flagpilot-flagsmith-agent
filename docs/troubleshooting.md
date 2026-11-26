# Troubleshooting

## GitHub setup workflow cannot find a project/environment

Check that organisation and project names match exactly. Do not create a second project to work around a lookup error. Inspect the CLI output and verify the selected account.

## Environment key missing after creation

The setup workflow must read the newly created environment back through the CLI. If it cannot locate the client-side key, stop. Do not infer it from an ID or paste an organisation token into a variable.

## Warehouse missing or Pending Connection

Experiments require a connected warehouse. Enable the managed Flagsmith warehouse in the target environment and send its first event. Pending Connection can persist while the first event is processed. Wait for Connected; contact the hackathon Discord if it errors or the managed warehouse is unavailable.

## Experiment API returns 401 or 403

Check that the organisation API key is valid and has access to the project. If Experimentation is not enabled for the hackathon account, ask the organiser/Flagsmith team for the promised licensing unblock. Do not try another account or undocumented endpoint to bypass access.

## No exposure events

- Ensure each treatment multivariate option has a non-empty unique key.
- Identify the user before calling `getExperimentFlag`.
- Call `getExperimentFlag` at the point the variation is displayed.
- Keep the same identity for exposure and conversion.
- Call `flushEvents()` after test conversions.

## Conversions are not counted

The event name is case-sensitive and must exactly match the metric definition. Conversions only count after the identity's first exposure. Ensure the demo sends the event using the same identity.

## CLI command fails

Check the Flagsmith/setup-cli installation step and confirm CLI v2.0.0 is installed. Review the exact command error. Do not blindly retry a write command after a timeout; inspect the Flagsmith project first.
