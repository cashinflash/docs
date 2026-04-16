# Cash in Flash Docs

Source for [docs.cashinflash.com](https://docs.cashinflash.com), the public
documentation site for Cash in Flash. Built on [Mintlify](https://mintlify.com).

## Local preview

Install the Mintlify CLI once:

```bash
npm i -g mint
```

From the repo root:

```bash
mint dev
```

This serves the site at `http://localhost:3000` with hot reload. Schema
validation errors for `docs.json` appear in the terminal.

## Publishing

The Mintlify GitHub app watches the `main` branch. Any push to `main`
deploys to `docs.cashinflash.com` within ~60 seconds. Pull requests get
an auto-generated preview URL posted as a PR comment.

## Layout

- `docs.json` — site config (navbar, logo, navigation, theme colors).
- `style.css` — custom CSS that restyles Mintlify's chrome to match
  the [cif-apply](https://github.com/cashinflash/cif-apply) header.
- `index.mdx` — landing page.
- `logo/`, `images/`, `favicon.svg` — brand assets.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). For anything beyond small edits,
open a PR and grab a preview link to eyeball before merging.
