---
name: git-identity
description: >-
  The git author/committer identity to use in this repository. Use whenever you
  commit, amend, rebase, cherry-pick, or otherwise write git history here, and
  whenever you check or set git user config. Enforces committing as the personal
  account and never the work (Manus) email.
---

# Git identity for this repo

All commits in this repository must be authored **and** committed as the
personal account:

- **Name:** `Chris Frei`
- **Email:** `csf129@gmail.com`

**Never** use the work email `cfrei@manusbio.com` (or any `@manusbio.com`
address) for commits, amends, rebases, or tags in this project. This is a
personal project; the Manus identity does not belong on it.

## Before committing

The machine's global git identity defaults to the Manus email, so a fresh clone
will commit with the wrong address unless the repo-local identity is set. Set it
once per clone:

```bash
git config user.name "Chris Frei"
git config user.email "csf129@gmail.com"
```

Verify before/after committing:

```bash
git config user.email          # must print csf129@gmail.com
git log -1 --format='%an <%ae> / %cn <%ce>'
```

## If a commit landed under the wrong email

Re-author it before it merges. For unmerged commits on the current branch (base
= the upstream/main tip they branch from):

```bash
git config user.email "csf129@gmail.com"
git rebase <base-sha> --exec 'git commit --amend --no-edit --reset-author'
git push --force-with-lease
```

Only rewrite commits that are unique to a feature branch — do not rewrite shared
history on `main`.
