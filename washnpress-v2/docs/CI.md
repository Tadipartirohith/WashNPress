# Continuous integration

Two workflows are included. Each is self-contained so it works whether the projects
live in separate repositories or as folders in one.

## Backend, .github/workflows/backend-ci.yml

On every pull request and every push to main:

1. quality: `npm ci`, `npm run typecheck`, `npm test`, `npm run build`.
2. docker: build the production image, start the container, wait for `/health`, and
   run `scripts/smoke-test.sh` against it. On main only, it then logs in to the GitHub
   Container Registry and pushes the image tagged `latest` and the commit sha.

The push uses the built-in `GITHUB_TOKEN`, so no extra secrets are required to publish
to `ghcr.io/<owner>/<repo>/washnpress-backend`. To deploy elsewhere, add your registry
login and a deploy step after the push.

## Mobile, .github/workflows/mobile-ci.yml

On every pull request and every push to main: `npm ci`, then type check the
framework-agnostic layer (the API client, response types, and the offline queue) with
`tsconfig.check.json`. The full Expo app is validated locally with `expo start` and in
release with EAS builds.

## Notes

- If both projects are in one repository, move each workflow to the repository's
  `.github/workflows/` and set a `working-directory` (or `paths:` filter) per job so the
  right project is built.
- The smoke test needs `curl`, `openssl`, and `python3`, all present on the default
  Ubuntu runner.
