# Contributing & deploy workflow

Two people work on this repo. GitHub access is shared; **Vercel access is not** — the
project runs on a Hobby plan, and Hobby explicitly does not support team members
("Hobby teams do not support collaboration"). Any deployment triggered by a git push
whose commit author isn't the Vercel account owner gets blocked, regardless of who
has push access to the repo. This document is the workaround: GitHub stays fully
collaborative, Vercel deploys go through one person's CLI session only.

## Why this exists

The first time a teammate's PR was merged, the resulting production deploy showed
**"Deployment Blocked"** on Vercel — not a bug, a Hobby-plan limitation on multi-
contributor commit authorship. Upgrading to Pro (~$20/seat/month) would remove this
restriction entirely and give every contributor their own dashboard access; until
that's decided, use the process below.

## 1. Code — normal GitHub flow

- Branch, commit, open a PR against `main` as usual. No special rules here.
- Reviews and merges happen on GitHub exactly as they would on any repo.

## 2. Preview deploys from a teammate's branch — expected to be blocked

When anyone other than the Vercel account owner pushes a branch, Vercel will attempt
a preview deployment and show **"Deployment Blocked"**. This is expected — not an
error to debug.

- For day-to-day iteration, just run the app locally instead of relying on a preview
  URL:
  ```bash
  npm install
  cp .env.example .env.local   # add your own API key
  npm run dev                  # http://localhost:3000
  ```
- If a real preview URL is genuinely needed before merge, the Vercel-account owner
  can pull that branch and push an empty commit under their own authorship to
  trigger a preview under their identity:
  ```bash
  git fetch origin <their-branch>
  git checkout -b tmp-preview origin/<their-branch>
  git commit --allow-empty -m "trigger preview"
  git push
  ```
  Use this only when actually needed — it's overhead, not the default path.

## 3. Production deploy — manual, from the Vercel-account owner's machine only

Auto-deploy-on-merge is not relied upon, since the merge commit's authorship can
still trip the same block. Instead, after a PR is merged:

```bash
git checkout main
git pull origin main
npx vercel deploy --prod --yes
```

This deploys directly via the CLI under the owner's authenticated session — not
through the GitHub webhook — so commit authorship doesn't matter here.

**Known flaky behavior, not a real failure — just retry:**
- Transient `"fetch failed"` or `"Not authorized"` errors: run the command again.
- Deploy stuck "in queue" with `Builds […] [0ms]` and no progress for several
  minutes: kill the process and retry the same command.

## 4. Sharing results with teammates who don't have Vercel access

Since only the account owner can see the Vercel dashboard, after each deploy
(especially a failed one) they should relay:
- the production deployment URL,
- the build log — copied from the CLI output, or via
  `npx vercel inspect --logs <deployment-url>`,
- relevant (non-secret) env var names via `npx vercel env ls`, if config is in
  question.

## When to revisit this

If deploy-blocking friction or the manual relay step becomes a real bottleneck,
upgrading to Vercel Pro and adding teammates directly is the durable fix — it
removes the commit-author restriction and gives everyone their own dashboard,
logs, and deploy access.
