---
name: github-workflow
description: >-
  How to perform GitHub operations (opening pull requests, viewing PRs/issues)
  for this repo on this machine. Use whenever you would reach for the `gh` CLI,
  want to open or reference a pull request, or are about to hand the user a
  GitHub command. The `gh` CLI is NOT installed here — this skill gives the
  working alternative.
---

# GitHub workflow (no `gh` CLI on this machine)

The GitHub CLI (`gh`) is **not installed** in this environment — not in the
user's PowerShell terminal and not in the Bash tool. Any `gh …` command fails
with `The term 'gh' is not recognized`. **Do not suggest or run `gh` commands.**

## Opening a pull request

Push the branch, then open the PR from the browser using the compare URL. Never
tell the user to run `gh pr create`.

```bash
git push -u origin <branch>
```

Then give the user this link (fill in the branch):

```
https://github.com/csf129/household-budget/compare/main...<branch>?expand=1
```

`git push` also prints a ready-made
`https://github.com/csf129/household-budget/pull/new/<branch>` link — either
works. The page opens the PR form pre-filled with base `main` ← `<branch>`; the
user adds a title/body and clicks **Create pull request**.

## Viewing PRs / issues

Link the user to the web UI (`https://github.com/csf129/household-budget/pulls`,
`…/issues`, or a specific `…/pull/<n>`) rather than `gh pr view` / `gh issue`.

## If GitHub automation is ever needed

There is no `gh` and no exposed token here, and opening a PR is an outward
action the user should confirm — so route it through the web URL and let the
user click, rather than hunting for another CLI path. If `gh` gets installed
later, verify it with `gh --version` before relying on it.
