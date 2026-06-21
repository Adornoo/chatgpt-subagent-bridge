# Security Notes

## Summary

This project creates a packet boundary, not a containment boundary.

It helps an operator send a selected text packet through ChatGPT in Chrome without giving ChatGPT direct local filesystem, shell, or local tunnel access through this package. That is useful, but it is not the same thing as strong confidentiality, complete redaction, or trusted execution.

## What This Project Does

- prepares a task packet from operator-supplied text,
- applies best-effort redaction for a limited set of known patterns,
- routes the packet through Chrome only when the operator chooses to do so,
- captures the returned text,
- validates the captured response for a few suspicious patterns.

## What This Project Does Not Do

- It does not guarantee that all secrets or sensitive data were removed.
- It does not prevent ChatGPT from receiving anything left in the packet after redaction.
- It does not stop ChatGPT from retaining or using the packet under that service's own terms and your account settings.
- It does not provide sandboxing inside Chrome.
- It does not protect you from other trusted local automation on the same Mac using Chrome's Apple Events capability.
- It does not prove that a captured response is trustworthy or safe to execute.

## Main Risks

### Third-party data handling

Anything you route is still sent to ChatGPT, which is a third-party service from the bridge's point of view. Only route data you would be comfortable sending to ChatGPT directly.

### Best-effort redaction

Redaction is regex-based and incomplete. It is designed to catch a limited set of obvious secrets, local paths, local endpoints, and a few sensitive markers. It will miss some sensitive content.

### Post-capture validation

Validation happens after the response is captured and written locally. It is a post-hoc tripwire, not a prevention mechanism. A passing verdict means "nothing suspicious was detected by these checks," not "this response is safe."

### Chrome Apple Events

The live Chrome adapter requires `View > Developer > Allow JavaScript from Apple Events`. That is a persistent browser capability that broadens what trusted local automation can do in Chrome while it remains enabled.

### DOM fragility

The Chrome route depends on selectors, button labels, and polling heuristics. ChatGPT UI changes, login pages, CAPTCHAs, wrong-account states, or Deep Research availability limits can break the route or capture the wrong thing.

The Deep Research workflow is intentionally attended and two-stage. `research-start` stores ChatGPT's proposed research approach for review before confirmation. `research-complete` can send one feedback message, then confirms the run and polls for a final report. If ChatGPT renders the approach or report as an artifact that page text cannot expose, the adapter uses ChatGPT's Markdown export menu and reads the resulting file from the browser's Downloads folder. This is convenience automation for ChatGPT's UI, not a guarantee that the report is complete, correct, or safe to act on without review.

## Safe Use Guidance

- Keep tasks harmless and text-only when possible.
- Review the packet before routing.
- Treat all redaction as partial.
- Treat all validation as advisory.
- Re-check the active ChatGPT account before sending.
- Do not use this for secrets, private keys, regulated data, or sensitive personal information.

## Reporting

If you discover a security problem, do not publish live secrets, tokens, or personal data in an issue. Share only the minimum reproduction details needed to explain the problem.
