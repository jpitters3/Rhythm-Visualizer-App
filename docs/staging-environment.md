# Staging environment & ship flow

Panafide has two fully separate Supabase projects — production and staging —
and two deploy pipelines, both owned by GitHub Actions.

| | Production | Staging |
|---|---|---|
| Git branch | `main` | `staging` |
| Supabase project ref | `ycdlqkaymkgpbpgtqubs` | `mececymulqnvmaqbcnok` |
| Deploy target | GitHub Pages | A dedicated Netlify site (CLI-deployed, no Netlify Git integration) |
| Workflow | `.github/workflows/deploy.yml` | `.github/workflows/deploy-staging.yml` |

Every push to `staging` builds the app against the staging Supabase project,
deploys it to the staging Netlify site, then runs the full Playwright suite
against that live URL. Results (pass/fail, HTML report) show up on that
workflow's run in the **Actions** tab — that run history is the dashboard,
nothing extra to check.

## Day-to-day flow

1. Branch off `staging` (or `main`, your call) for a feature/fix.
2. Merge into `staging` (PR or direct push).
3. Watch the **Deploy to Staging** Actions run: it deploys, then runs
   Playwright against the deployed staging URL. Fix anything red before
   moving on — the HTML report artifact on that run has full traces.
4. Once staging is green, merge `staging` → `main`. `deploy.yml` deploys to
   GitHub Pages exactly as it does today.

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
- `playwright.config.js` reads `PLAYWRIGHT_BASE_URL` when set (used by the
  staging workflow to point the suite at the deployed Netlify URL) and
  otherwise defaults to `localhost:3000` as before.

### GitHub repo secrets the staging workflow needs

| Secret | Value |
|---|---|
| `NETLIFY_AUTH_TOKEN` | Netlify personal access token |
| `NETLIFY_SITE_ID` | Site ID of the staging Netlify site |
| `VITE_SUPABASE_URL_STAGING` | `https://mececymulqnvmaqbcnok.supabase.co` |
| `VITE_SUPABASE_ANON_KEY_STAGING` | staging project's anon/publishable key |
| `SUPABASE_SERVICE_ROLE_KEY_STAGING` | staging project's service role key (used by tests that create/delete users) |
| `TEST_EMAIL`, `TEST_PASSWORD` | test account credentials (same as used locally) |
| `RESEND_API_KEY` | used by the email-delivery smoke test |

### Manual Netlify setup

Create a new Netlify site (e.g. "panafide-staging") as a plain site with
**no Git integration** — GitHub Actions pushes builds to it via the Netlify
CLI, the same way `deploy.yml` already owns the entire production pipeline.
Note its Site ID from Site settings → General → Site details.

## Not set up yet

A branch-protection rule requiring the staging workflow to pass before a PR
can merge into `main`. Worth adding once this flow has been proven out a
few times.
