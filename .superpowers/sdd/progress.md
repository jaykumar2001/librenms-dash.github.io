# Progress Ledger — GitHub Pages Demo Site

Plan: /home/jkumar/Librenms-dash/docs/superpowers/plans/2026-07-05-github-pages-demo-site.md

Status: shipped. Built via Subagent-Driven Development (9 planned tasks + 3
follow-ups: device-count randomization, ARP-device curation, GitHub Pages
asset-path fix), each implemented and independently reviewed, plus a final
whole-branch audit (SHIP verdict). History was later squashed to a single
commit on `main`, so per-task commit SHAs from the original build-out no
longer exist — this ledger no longer references them.

Live at https://librenms-dash.github.io/ (repo transferred to the
`librenms-dash` org; deployed via `.github/workflows/deploy-pages.yml`,
which publishes the committed `docs/` folder on every push to `main`).

To regenerate the anonymized data snapshot from the real running app:
`cd /home/jkumar/Librenms-dash && docker compose up -d`, then
`npm run anonymize` in this repo (needs `.env.local` — see
`.env.local.example`), then `npm run build` and commit the result.
