# Git workflow (AI SiteMaker Runner)

Opinionated flow for collaborating on this repo.

## Branching
- Base branch: `main`. Keep it releasable.
- Naming: `feature/<desc>`, `fix/<issue>`, `chore/<desc>`, `infra/<desc>`.
- Small, single-purpose branches; prefer stacked PRs over huge changes.

## Commits
- Write meaningful subjects (`verb + object`), e.g., `add sam deploy helper`, `fix launch quota check`.
- Avoid bundling unrelated changes; rebase to clean up before opening a PR.

## Local validation before PR
- Code/build: `npm run build`
- SAM template: `sam validate --template-file infra/template.yaml`
- Optional smoke tests (against a deployed API): `npm run test:api`
- If you touch OpenAPI, regenerate any artifacts that depend on it (or note if none).

## Pull requests
- Rebase on `main` before pushing (`git pull --rebase origin main`).
- Describe the why + what changed + how to validate (commands run, links to logs).
- Include any parameter sets or stack names used for infra deploys.
- Avoid force-pushing once review starts; if you must, call it out in the PR.

## Merging
- Squash-merge preferred to keep history tidy.
- Ensure CI (if configured) is green; if CI is absent, include local command output in the PR.
- Delete branches after merge unless they are long-lived release branches.

## Hotfixes
- Branch from the release branch you need to patch (usually `main`), keep the diff minimal, and include a postmortem note in the PR.
