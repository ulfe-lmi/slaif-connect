# Continuous Integration

## Purpose

GitHub Actions CI validates the safe local SLAIF Connect test matrix on pull
requests to `main`, pushes to `main`, and manual workflow dispatches. It does
not use repository secrets and does not run real-HPC tests.

## Workflows And Jobs

Workflow: `.github/workflows/ci.yml`

Required job names to consider for branch protection after the workflow has run
successfully at least once:

- `ci / lightweight`
- `ci / redis-token-store`
- `ci / relay-e2e`
- `ci / browser-e2e`

`lightweight` runs build, policy, launcher, diagnostic result, token,
deployment, observability, relay unit, maintainer static/config, and `npm test`
checks.

`redis-token-store` uses a GitHub Actions Redis service container and runs the
Redis-backed token-store tests with `REDIS_URL=redis://127.0.0.1:6379`.

`relay-e2e` runs the Docker-backed local sshd relay E2E test.

`browser-e2e` builds the extension, installs Playwright Chromium/dependencies,
and runs the browser OpenSSH/WASM relay, launch-flow, signed-policy,
job-reporting, token, observability, and diagnostic-result E2E tests. It uploads
Playwright artifacts on failure.

## What CI Does Not Do

CI must not:

- run real-HPC maintainer tests;
- run YOLO tests against real systems;
- use real SSH credentials;
- use real verified host keys;
- contact Vega, Arnes, or NSC;
- claim production readiness.

Do not add `pull_request_target` for untrusted PR code and do not add steps
that require GitHub Actions secrets for this validation path.

## Local Equivalence

Core local commands:

```bash
npm ci
npm run upstream:init
npm run vendor:libapps
npm run plugin:install
npm run plugin:verify
npm run build:extension
npm test
npm run test:redis-token-store
npm run test:relay:e2e
npm run browser:install
npm run test:browser
npm run test:browser:diagnostic-results
```

## Docker, Redis, And Playwright Notes

On this local host Docker may require a temporary PATH wrapper that delegates to
`sudo -n /usr/bin/docker`. GitHub-hosted Ubuntu runners should not need that
wrapper.

Redis tests use the Actions Redis service in CI. No real Redis credentials are
used.

Playwright installs Chromium and needed dependencies in CI. Browser tests still
exercise the local mock stack and disposable sshd container, not a real HPC
system.
