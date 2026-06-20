# ChatGPT Subagent Bridge

`chatgpt-subagent-bridge` is a packet-only local CLI for sending an operator-selected task through ChatGPT in Chrome without giving ChatGPT direct access to your local filesystem, shell, or local network tools.

Current posture: public GitHub repository under the MIT License, intended for local source-checkout use. The package remains marked `private: true` in `package.json`, so npm publication is intentionally disabled until a separate release decision is made.

It is meant for attended drafting, summarizing, planning, and review-style handoffs. It is not a safe way to handle secrets, regulated data, or anything you would not be willing to send to ChatGPT itself.

## Security Model In Plain English

- The bridge sends only the packet text you choose to route.
- ChatGPT does not get direct local tool access through this package.
- The packet still goes to a third-party ChatGPT service and may be retained or used under that service's terms and your account settings.
- Redaction is best-effort and incomplete. It uses fixed patterns and can miss sensitive data.
- Validation happens after capture. It is a tripwire for suspicious output, not a containment boundary.

Read [SECURITY.md](./SECURITY.md) and [THREAT_MODEL.md](./THREAT_MODEL.md) before using this outside harmless sample tasks.

## When To Use It

Use it for:

- harmless drafting or rewriting tasks,
- naming and brainstorming packets,
- summary or planning requests,
- source-bound deep research brief planning,
- attended ChatGPT Deep Research report launches where the operator reviews the proposed approach before confirmation,
- review comments that do not require local execution.

Do not use it for:

- secrets, credentials, API keys, or private keys,
- personal, medical, legal, payroll, or other sensitive records,
- anything that depends on a guarantee that all sensitive details were removed,
- unattended workflows that treat ChatGPT output as trusted execution.

## Requirements

- Node `22.6.0` or later.
- macOS with Google Chrome signed into ChatGPT for live `route` runs.
- Manual operator oversight.
- Chrome's `View > Developer > Allow JavaScript from Apple Events` setting enabled if you want live browser routing.

See [docs/chrome-apple-events-setting.md](./docs/chrome-apple-events-setting.md) for the approval boundary and browser risk.

## Local Use

From a local checkout:

```bash
npm install
npm run bridge -- help
```

If you prefer to skip the npm script wrapper, you can also run the checked-in entrypoint directly:

```bash
node ./bin/chatgpt-bridge.mjs help
```

If you want to invoke the checked-in wrapper from another project folder, point at this package's `bin/chatgpt-bridge.mjs` entrypoint and pass `--workspace-root` so `bridge_runs/` lands in the workspace you actually want to record:

```bash
node /path/to/chatgpt-subagent-bridge/bin/chatgpt-bridge.mjs route \
  --workspace-root /path/to/other-project \
  --title "Reply with BRIDGE_OK" \
  --task "Reply with exactly this text and nothing else: BRIDGE_OK"
```

## Commands

- `chatgpt-bridge prepare`: build and print a redacted task packet as Markdown.
- `chatgpt-bridge route`: prepare, send, capture, validate, and store a run under `bridge_runs/` in the chosen workspace.
- `chatgpt-bridge research-start`: prepare a packet, open a new ChatGPT chat, request Deep Research, submit the plan, and store ChatGPT's proposed research approach without confirming it.
- `chatgpt-bridge research-complete`: optionally send feedback on the proposed approach, confirm the Deep Research run, poll until the final report is ready, and store the report plus validation verdict.
- `chatgpt-bridge capture`: store a manually captured response against an existing packet and validate it.
- `chatgpt-bridge validate`: validate a response against an existing packet without routing it through Chrome.

`prepare` and `route` support `--mode advice-only`, `--mode github-only-code`, `--mode deep-research-brief`, and `--mode deep-research-report`. The deep research brief mode asks ChatGPT for a structured future-tense research plan with source strategy, evidence criteria, separate research/synthesis/implementation/review thread routing, and suggested 5.4 High, 5.4 Mini High, and 5.5 High model roles. It does not create threads, invoke models, inspect repositories, or perform research by itself.

`research-start` defaults to `deep-research-report` mode. This mode asks ChatGPT Deep Research to propose an approach first, then write a source-cited Markdown report after confirmation. The bridge stores the proposed approach in `research-approach.md` so the operator or Codex can review it before running `research-complete`. When ChatGPT renders the approach or report as an artifact that normal page text cannot expose, the Chrome adapter falls back to ChatGPT's `Export to Markdown` action and captures the downloaded Markdown file.

By default, `route`, `capture`, and `validate` exit non-zero when validation fails. Use `--allow-failed-verdict` only when you deliberately want to inspect or preserve a failing output.

Release note: this repository is public and MIT-licensed for source use, modification, and forking. npm publication remains a separate decision and is still disabled with `private: true`. See [docs/release-posture-and-launch.md](./docs/release-posture-and-launch.md) for the current launch posture.

## Example

Example task:

```text
Title: Summarize release notes
Task: Please summarize these release notes in three bullets.
Attachment: Version 1.2.0 adds exports and fixes a date formatting bug.
```

Example command:

```bash
chatgpt-bridge prepare \
  --title "Summarize release notes" \
  --task "Please summarize these release notes in three bullets." \
  --attachment notes=./sample-release-notes.txt
```

Example deep research brief packet:

```bash
chatgpt-bridge prepare \
  --title "Market map research brief" \
  --mode deep-research-brief \
  --task "Plan a source-bound research brief for this market map."
```

Example attended Deep Research report flow:

```bash
chatgpt-bridge research-start \
  --title "Subscription usage research" \
  --task-file ./research-plan.md \
  --workspace-root .

chatgpt-bridge research-complete \
  --run-directory ./bridge_runs/... \
  --approach-feedback-file ./approach-feedback.md \
  --poll-ms 900000
```

All examples in this repository use fake paths and sample data only.

## Run Artifacts

The bridge writes local run artifacts to `bridge_runs/` under the selected workspace root. Those artifacts are local operator records, not part of any public package surface.

Typical files:

- `task-packet.json`
- `task-packet.md`
- `result-raw.md`
- `result-packet.json`
- `validation-verdict.json`
- `research-approach.md` and `research-approach.json` for Deep Research start runs
- `research-approach-revised.md` when `research-complete` sends feedback before confirmation
- `route-error.json` when routing fails before capture completes

## Operational Limits

- The Chrome adapter depends on Apple Events plus DOM selectors and polling. ChatGPT UI changes can break it.
- Deep Research routing depends on ChatGPT's current Deep Research UI labels and may fail if the tool is unavailable, renamed, hidden behind account limits, or blocked by an interstitial.
- `research-complete` defaults to checking every 15 minutes. It can still time out, mis-detect a running report, or require manual intervention if ChatGPT changes the report view or export menu.
- Deep Research Markdown export is captured from the browser's Downloads folder. If Chrome is configured to ask where to save every file, or another download changes the newest Markdown file during capture, export capture can fail or need manual review.
- Login prompts, CAPTCHAs, browser permission prompts, or the wrong ChatGPT account can block or invalidate a run.
- Validation can catch obvious bad outputs, but it cannot prove a response is safe.
- This package is designed for attended text handoff, not trustworthy automation.
