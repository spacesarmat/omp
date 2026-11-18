# Store channels implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare winget, Scoop, Homebrew, Flathub, Snap and IzzyOnDroid for OMP and update them from stable release CI without publishing anything externally in this change.

**Architecture:** Pure renderer `scripts/stores/lib.mjs` turns a GitHub release into manifest text. Committed files for `v0.30.0` match that renderer. Workflow `Stores` is separate from Release and Desktop. Those workflows only dispatch it, and a missing secret skips with a notice.

**Tech Stack:** GitHub Actions, winget manifest 1.10, Scoop JSON, Homebrew cask, Flatpak, snapcraft, fastlane metadata.

**Spec:** the task that asked for stage 1 of the store plan. No separate design doc.

## Global Constraints

- ASCII hyphen only. No em dash and no en dash.
- One PR to `main`. Do not merge. Do not publish a release. Do not push to winget-pkgs, Flathub, Snap, Homebrew or Izzy.
- New jobs must not fail Release or Desktop. Missing secrets skip with a notice.
- No secrets in the git tree.
- `[tech]` changelog bullets in `CHANGELOG.md` and `CHANGELOG.en.md`.

## Tasks

- [ ] Render manifests from the `v0.30.0` release assets and test the renderer.
- [ ] Add ABI APK names to the release workflow without dropping the old names.
- [ ] Dispatch `Stores` from Release and Desktop only for a stable tag, exit 0 otherwise.
- [ ] Skip winget until `WINGET_LISTED=true` and a token exist. Skip Snap, Flathub and external taps when their secrets are missing.
- [ ] Add fastlane metadata and the Izzy request text.
- [ ] Document what Andy does by hand.
- [ ] Validate with vitest, actionlint, the winget schema, and appstream when the tools are present.
