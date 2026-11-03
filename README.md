# Ponganoid

Lobomotor Studio’s neon Pong/brick-breaking game, built with React, TypeScript and Vite. Originally created in Google AI Studio.

## Development and checks

Use Node 24. Run `npm ci`, then `npm run dev` and open http://localhost:3000.

- `npm run lint` checks TypeScript.
- `npm run build` creates the static site in `dist/`.
- `npm test` runs browser tests (install Chromium first with `npx playwright install chromium`).
- `npm audit --audit-level=high` checks dependencies.

The game itself makes no Gemini API requests and needs no API key to play or build.

## Controls

Start Game plays against the AI; AI Mode watches two bots. W/S or arrows move the player paddle. Drag on the playfield with a mouse or touch to position it. Space or tap serves, releases a magnetized ball, or fires an active laser. P or the toolbar pauses/resumes. Switching away automatically pauses. The menu button returns to the start screen; E exits AI Mode.

The canvas retains its original 800 × 500 game coordinates while its displayed size follows the available viewport. Physics runs at 60 updates per second regardless of display refresh rate. The original ten levels, scoring and neon artwork are preserved.

## Preview and publishing

Pull requests and `maintenance/**` branches run type checks, build, dependency audit and browser tests, including desktop, compact iframe, portrait phone and landscape sizes. GitHub Actions attaches `ponganoid-preview` (the static `dist/` build) and a browser report with screenshots. To view the downloaded build locally, run `python3 -m http.server 8080` in the extracted preview folder and open http://localhost:8080.

The studio website is maintained separately in [Lobomotor-web](https://github.com/Lobomotor/Lobomotor-web). It currently embeds https://ponganoid-777006893258.us-west1.run.app. This repository contains no Cloud Run deployment workflow; a GitHub merge alone is not verified to update that service. Before publishing, the owner must approve the exact tested commit and confirm the existing AI Studio/Cloud Run deployment path. Deploy the approved game build through that path and verify it at the embedded URL. Keep website and game approvals explicit; do not change Cloud Run, DNS or email settings during code preparation.
