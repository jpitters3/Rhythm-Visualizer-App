# Staging environment & ship flow

Panafide has two fully separate Supabase projects — production and staging —
and two deploy pipelines, both owned by GitHub Actions.

| | Production | Staging |
|---|---|---|
| Git branch | `main` | `staging` |
| Supabase project ref | `ycdlqkaymkgpbpgtqubs` | `mececymulqnvmaqbcnok` |
| Deploy target | GitHub Pages | A dedicated Netlify site (CLI-deployed, no Netlify Git integration) |
| Workflow | `.github/workflows/deploy.yml` | `.github/workflows/deploy-staging.yml` |

Every push to `staging` builds the app against the staging Supabase project
and tests it **on the GitHub Actions runner itself**: the job serves the
build at `http://localhost:3000` on that machine and points Playwright at it,
so test traffic never touches Netlify. Only if the tests pass is that same
build deployed to the staging Netlify site, followed by a health check
(`scripts/check-site.js`: the site loads with no JavaScript errors and the
Studio renders). Pushes that only change `docs/` or `*.md` files skip the
workflow. Results show up on the run in the **Actions** tab, with a summary
of tests and deploy, and the HTML report as an artifact.

| Tier | Tests | Projects | When |
|---|---|---|---|
| smoke | `@smoke` | chromium, Mobile Chrome | manual (**Run workflow** → `smoke`) |
| core | `@smoke` + `@core` | chromium, Mobile Chrome, Mobile Safari | every push to `staging`, then deploy if green; or manual |
| full | everything | all CI projects, 4 shards | daily at 08:00 UTC; or manual |

Manual runs (**Actions → Deploy to Staging → Run workflow**) build and test
the branch picked in "Use workflow from" and never deploy.

Locally: `npm run test:smoke`, `npm run test:core`, or `npm test` for everything.

## Day-to-day flow

1. Branch off `staging` for a feature or fix.
2. Write the feature and its tests; run them as you go, e.g.
   `npx playwright test tests/my-feature.spec.js`.
3. Commit (`eslint` runs on staged files automatically).
4. `git checkout staging && git merge my-feature`
5. `git push origin staging` — the pre-push hook (`.husky/pre-push`) runs the
   core tier locally first (about 5 minutes) and cancels the push if anything
   fails. GitHub then runs core again on its runner and deploys to Netlify
   only if it passes.
6. Once that run is green (and the latest daily full run too):
   `git checkout main && git merge --ff-only staging && git push origin main`.
   `deploy.yml` deploys to GitHub Pages, then health-checks panafide.com.

Never commit directly to `main`. The pre-push hook refuses a push to `main`
containing commits that aren't on `origin/staging` yet, and `--ff-only`
refuses to create a merge commit, so `main` is always exactly what was
tested on staging. `git push --no-verify` skips the hook in an emergency.

## Schema (SQL migration) changes

New migration files are written the same as always, but never pushed
straight to production:

```bash
npm run db:push:staging   # applies pending migrations to the staging project, verify there first
npm run db:push:prod      # only after staging looks right — applies them to production
```

Both scripts explicitly re-link before pushing, so there's no "accidentally
pushed to the wrong project because of whatever I had linked last" risk.

## One-time setup (already done, documented for reference)

- Staging Supabase project created, schema restored from a production
  `pg_dump`, migration history baselined so new migrations apply cleanly on
  top going forward.
- `js/supabase-client.js` no longer falls back to the production project
  when env vars are missing — it throws instead, so a misconfigured staging
  build can never silently touch prod data.
- `playwright.config.js` reads `PLAYWRIGHT_BASE_URL` when set (the staging
  workflow sets it to the build it serves on the runner) and otherwise starts
  the dev server on `localhost:3000`.
- `vite.config.js` fails the build if `VITE_SUPABASE_URL` or
  `VITE_SUPABASE_ANON_KEY` is missing, instead of shipping a blank site.

### GitHub repo secrets the staging workflow needs

| Secret | Value |
|---|---|
| `NETLIFY_AUTH_TOKEN` | Netlify personal access token |
| `NETLIFY_SITE_ID` | Site ID of the staging Netlify site |
| `VITE_SUPABASE_URL_STAGING` | `https://mececymulqnvmaqbcnok.supabase.co` |
| `VITE_SUPABASE_ANON_KEY_STAGING` | staging project's anon/publishable key |
| `SUPABASE_SERVICE_ROLE_KEY_STAGING` | staging project's service role key (used by tests that create/delete users) |
| `RESEND_API_KEY` | used by the email-delivery smoke test |

Plus one repository **variable** (not a secret): `STAGING_URL` =
`https://panafide-staging.netlify.app`, which the deploy job health-checks.

### Manual Netlify setup

Create a new Netlify site (e.g. "panafide-staging") as a plain site with
**no Git integration** — GitHub Actions pushes builds to it via the Netlify
CLI, the same way `deploy.yml` already owns the entire production pipeline.
Note its Site ID from Site settings → General → Site details.

## Not set up yet

A branch-protection rule requiring the staging workflow to pass before a PR
can merge into `main`. Worth adding once this flow has been proven out a
few times.
