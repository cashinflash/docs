# Source-Site Attribution Registry

Canonical list of ghost-site slugs for the shared Cash in Flash apply pipeline.
Each row defines a `source_site` slug that `apply.cashinflash.com` captures
from `?source_site=<slug>` and persists to every application record in
`app.cashinflash.com` under the `source_site` field.

## Slug rules
- Server-side regex: `^[a-z0-9_]{3,40}$` (enforced in `cif-apply/server.py`).
- Lowercase only, underscores allowed, no hyphens or dots.
- One slug per marketing property. The slug is permanent — never reuse, even
  after a site is retired.
- Adding a new slug does **not** require a backend redeploy — any well-formed
  slug is accepted. The registry is the human-readable reference.

## How attribution flows
1. Ghost-site CTA links to `apply.cashinflash.com/?source_site=<slug>&utm_*=...`
2. `cif-apply/frontend/script.js` captures the slug into `sessionStorage`
   under key `cif_source_site` (validation: same regex, last-wins on
   subsequent navigations).
3. On submit, the form includes `source_site` in the payload.
4. `cif-apply/server.py` re-validates, rejects malformed values (400), and
   persists the slug on the `record` written to Firebase.
5. `cif-dashboard/app.html` renders the slug as "via &lt;slug&gt;" under the
   Source column and exposes a Source Site filter dropdown; an
   `__direct__` option isolates records with no `source_site` (direct
   submissions to apply.cashinflash.com).

## Registry

| Slug | Domain | GA4 property | Launch date | Status |
|------|--------|--------------|-------------|--------|
| `cashexpress_riverside` | cashexpressriverside.com | `[[GA4_ID]]` | (pending — embargoed) | Pre-launch |

## Adding a new ghost site
1. Pick a slug matching `^[a-z0-9_]{3,40}$`. Prefer `<brand>_<market>`
   format (e.g. `lendingfast_fresno`, `quickcash_sanbernardino`).
2. Add a row above with the domain, GA4 property, and launch date.
3. Hard-code the slug into every Apply CTA on the new site:
   `https://apply.cashinflash.com/?source_site=<slug>&utm_source=<domain>&utm_medium=referral&utm_campaign=<campaign>`
4. Verify end-to-end: submit from the new site and confirm the record lands
   in the dashboard tagged with the slug.
