---
name: dependency-security
description: >-
  Dependency hygiene for this app — vetting npm packages before adding them,
  handling `npm audit` findings, and the specific gotcha that the npm-published
  `xlsx` (SheetJS) is permanently vulnerable and must come from the SheetJS CDN.
  Use whenever you add or upgrade a dependency, parse an uploaded file, or triage
  `npm audit` output.
---

# Dependency security

## `xlsx` (SheetJS) must come from the CDN, not npm

The npm `xlsx` package (`0.18.5` and earlier) has unpatched **prototype
pollution (CVE-2023-30533)** and **ReDoS** advisories and will never be fixed on
npm. This app parses **user-uploaded** spreadsheets (`budget-import`), so this is
directly reachable. `package.json` must therefore pin the CDN build:

```json
"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
```

Reinstall with:

```bash
npm install --save-exact "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
```

The import (`import * as XLSX from "xlsx"`) and API are identical — never
"fix" a lockfile conflict by reverting to the npm version. When bumping, take the
latest from https://cdn.sheetjs.com.

## Running `npm audit`

```bash
npm audit                 # full picture (prod + dev)
npm audit --omit=dev      # only what ships to users — triage these first
npm audit fix             # safe, semver-compatible fixes — prefer this
```

- **Do NOT run `npm audit fix --force`.** It bumps `next` past the pinned
  `16.2.2`. This project uses a customized Next build (see `AGENTS.md`); a forced
  major/minor bump can break it. Upgrade Next deliberately, not via audit.
- Prioritize advisories in packages reachable from **request-handling / prod**
  code (parsers, `axios`/HTTP, `form-data`) over build-time dev deps.
- Some advisories are transitive (e.g. `axios` via `plaid`); fix at the top of
  the tree or wait for the parent to update rather than force-resolving.

## Before adding a new dependency

- Check `npm audit` and the advisory database for the exact version.
- Prefer packages that are actively maintained and already in the tree.
- For anything that parses untrusted input (files, tokens, markup), prefer a
  vetted, maintained parser and keep it patched.

## Checklist

- [ ] `xlsx` still points at the SheetJS CDN tarball, not the npm registry.
- [ ] `npm audit --omit=dev` reviewed after any dependency change.
- [ ] Used `npm audit fix` (never `--force`) for auto-fixes.
- [ ] New deps vetted for known CVEs and maintenance status.
