# Threat Model

## Purpose

This document explains the trust boundary and the main residual risks for `chatgpt-subagent-bridge`.

The current package posture is a public GitHub repository under the MIT License. npm publication is still disabled with `private: true` in `package.json` and remains a separate release decision.

## Trust Boundary

The bridge is designed to keep ChatGPT on the far side of a packet boundary, not inside your local environment:

- the operator chooses the task text,
- the bridge redacts a limited set of patterns,
- the bridge sends only the resulting packet text through Chrome,
- ChatGPT returns plain text,
- the bridge stores and validates that plain text locally.

The bridge does not expose local shell, filesystem, or local network tools to ChatGPT.

## Assets To Protect

- local files and repository contents,
- secrets and credentials,
- local-only endpoints and workspace paths,
- operator privacy,
- the integrity of downstream workflows that might consume bridge output.

## Threats Considered

### Sensitive data leaves in the packet

Cause:
- redaction misses a secret or private detail,
- the operator routes sensitive content that should not have been sent.

Mitigation:
- best-effort pattern redaction,
- confirmation gates for some higher-risk content,
- operator review before sending.

Residual risk:
- high. Regex redaction is incomplete by design, so private details can still slip through.

### ChatGPT output overstates its access or invents actions

Cause:
- the model hallucinates local reads, edits, tests, commits, or other execution.

Mitigation:
- prompt instructions deny local access,
- post-capture validation fails obvious execution or local-access claims.

Residual risk:
- medium. The model can still produce misleading text without triggering every heuristic.

### Browser automation misroutes or miscaptures content

Cause:
- ChatGPT DOM changes,
- login or CAPTCHA page appears,
- wrong account is active,
- send/capture selectors drift,
- stable polling accepts incomplete output.

Mitigation:
- fail on obvious blocked states,
- require repeated stable reads before capture completes,
- keep a human in the loop.

Residual risk:
- medium to high. This is a heuristic browser adapter.

### Chrome Apple Events broadens local automation

Cause:
- the required Chrome setting enables page JavaScript execution through Apple Events.

Mitigation:
- keep it explicit and opt-in,
- document the capability clearly,
- allow operators to turn it off when not needed.

Residual risk:
- medium. The capability is broader than this single package and can be used by other trusted local automation while enabled.

## Non-goals

- complete DLP or secret detection,
- strong confidentiality guarantees,
- unattended secure automation,
- proof that a passing validation verdict means the response is safe to execute,
- stable browser automation across all future ChatGPT UI changes.

## Recommended Operating Posture

- Use only for attended, low-sensitivity tasks.
- Assume anything sent may be retained by ChatGPT.
- Keep Chrome account state and permissions under operator control.
- Treat bridge output as untrusted until reviewed by a human or another trusted local tool.
- Treat npm publication as a separate release decision from the public MIT source repository.
