---
name: github-workflow
description: >-
  How to perform GitHub operations (opening pull requests, viewing PRs/issues)
  for this repo on this machine. Use whenever you would reach for the `gh` CLI,
  want to open or reference a pull request, or are about to hand the user a
  GitHub command. `gh` IS installed and authenticated here — this skill covers
  how to use it, and the web fallback.
---

# GitHub workflow

The GitHub CLI (`gh`) **is installed and authenticated** on this machine. Use it
from the **Bash tool** (it lives at `/c/Program Files/GitHub CLI/gh`). It is
logged in via its keyring as account `csf129` (active, personal) with
`repo` / `workflow` / `read:org` / `gist` scopes; a second account
`cfrei-manus` is also logged in but not active. The `GH_TOKEN` / `GITHUB_TOKEN`
env vars are unset — that does **not** mean unauthenticated; `gh` reads its own
keyring. Confirm with `gh auth status` if in doubt.

> The user's **PowerShell** terminal may not have `gh` on its PATH even though
> the Bash tool does — run `gh` through the Bash tool.

## Opening a pull request

Opening a PR is an outward action — confirm with the user first (or act on an
explicit request like "open the PR"). Push the branch, then create the PR
directly:

```bash
git push -u origin <branch>
gh pr create --repo csf129/household-budget --base main --head <branch> \
  --title "<title>" --body-file <path-to-markdown-file>
```

Use `--body-file` (not `--body`) for anything with backticks, apostrophes, or
newlines — it avoids shell-quoting breakage. `gh pr create` prints the new PR's
URL on success.

### Web fallback

If `gh` is ever unavailable or unauthenticated, push the branch and give the
user the compare URL instead:

```
https://github.com/csf129/household-budget/compare/main...<branch>?expand=1
```

`git push` also prints a ready-made
`https://github.com/csf129/household-budget/pull/new/<branch>` link. The page
opens the PR form pre-filled with base `main` ← `<branch>`; the user adds a
title/body and clicks **Create pull request**.

## Viewing PRs / issues

Use `gh` (`gh pr view <n>`, `gh pr list`, `gh issue list`) or link the user to
the web UI (`https://github.com/csf129/household-budget/pulls`, `…/issues`, or a
specific `…/pull/<n>`).

## Identity

Commit as the personal account (`csf129@gmail.com`), never the Manus work email
— see the `git-identity` skill.
