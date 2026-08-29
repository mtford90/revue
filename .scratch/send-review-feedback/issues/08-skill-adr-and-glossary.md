# 08 — Skill, ADR 0020, and glossary

Status: ready-for-agent

## Parent

.scratch/send-review-feedback/PRD.md

## What to build

The revue skill's feedback step lists the wake-up prompt as a trigger. Its orient section
documents `handoff`, `resolvedThreadIds`, and `--wait`, and says which commands record the agent
origin and why. ADR 0020 records the handoff design: a repo-level record separate from threads,
delivery as a nudge only, origin recorded on agent-side commands, `handoffId` as identity. (ADR
0019 is referenced by older ADRs but missing; leave it alone.) `CONTEXT.md` gains **handoff**,
**unsent**, and **agent origin**. Written in Simplified Technical English, as the other ADRs and
PRDs are.

## Acceptance criteria

- [ ] The skill routes the wake-up prompt to the feedback step and documents the new status fields and flags
- [ ] `revue show --check` and the skill install still pass
- [ ] ADR 0020 exists in the house format with status accepted
- [ ] `CONTEXT.md` defines the three terms

## Blocked by

- 03-revue-status-wait
- 05-orca-delivery-to-the-agent-terminal
- 06-terminal-picker-and-session-target
- 07-clipboard-fallback-outside-a-host
