# docs

Mintlify product docs at https://docs.cashinflash.com.

## Deploy

- **Host**: Netlify, auto-deploys from `main`
- **URL**: https://docs.cashinflash.com
- **In-flight branch**: `claude/project-review-YLvks`

## Architecture

- Mintlify static docs site.
- Key files: `index.html`, `app.js`, `styles.css`, `netlify.toml`.
- Branding kept loosely in sync with Cif-website manually (no shared stylesheet).

## Conventions

- `AGENTS.md` and `CONTRIBUTING.md` at repo root document the content style.
- When updating styles, check both this repo AND Cif-website to keep drift small.
