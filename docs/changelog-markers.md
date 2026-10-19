# Changelog markers

CHANGELOG.md and CHANGELOG.en.md: one `## x.y.z` section per version, one `- ` bullet per change, newest first.
A bullet may start with one marker:

| Marker | Where the bullet shows |
|---|---|
| (none) | everywhere: phone, LG, Android TV, update feeds, GitHub release, Telegram post |
| `[phone]` | the phone app only (plus the release body and Telegram, without the marker) |
| `[tv]` | both TVs (LG and Android TV) |
| `[lg]` | LG webOS only |
| `[atv]` | Android TV only |
| `[tech]` | nowhere users look: technical or admin-only changes (billing internals, admin panel, CI, build, tests, servers) |

`[tech]` rules:

- Not shown in the in-app «Что нового» (`src/lib/changelog.ts` `isTech`), the update feeds `notes` / `notesTv` /
  `notesPhone` (`scripts/hb-lib.mjs` `changelogNotes`), the GitHub release body (`scripts/release-notes.mjs`, the
  «…и ещё N» count included) or the Telegram caption (`scripts/telegram-lib.mjs` `buildCaption`).
- The full changelog with `[tech]` bullets is for the administrator (GitHub, and the billing admin later).
- `[tech]` is never combined with a platform marker. A change with a user part and a technical part is two bullets.
- Put user bullets first: the release body takes the first 8 and the Telegram post the first 5 user bullets.
- A version with only `[tech]` bullets is still released: users see «Исправления и улучшения»
  («Fixes and improvements»), and the app skips the version in «Что нового».
- Mark the same bullets in CHANGELOG.md and CHANGELOG.en.md: a test checks equal `[tech]` counts per version.
- The repository is public, so `[tech]` hides a bullet from the apps and announcements, not from GitHub. No secrets.
