---
name: safe-html-output
description: >-
  How to safely put user- or AI-controlled data into generated HTML in this app
  — chiefly the summary emails (src/lib/email-summary-template.ts) and any other
  hand-built HTML string, PDF, or `dangerouslySetInnerHTML`. Use whenever you
  build an HTML/email template, interpolate values into markup, or send generated
  HTML to a recipient. Covers escaping to prevent HTML/attribute injection.
---

# Escaping data in generated HTML

React escapes text nodes for you. **Hand-built HTML strings do not.** The email
templates and any raw-HTML builder concatenate values straight into markup, so
every value that isn't a literal you wrote must be escaped.

## What counts as untrusted

Anything a user or model can influence: category names, transaction
descriptions, plan/card names, household name, AI-generated insight text, and
even a stored **color** (it lands inside a `style="..."` attribute). Only
numbers you format yourself (`fmt(n)`) and hard-coded string literals are safe.

## Use `esc()` on every interpolation

`src/lib/email-summary-template.ts` defines `esc()`, which encodes
`& < > " '`. Wrap every non-literal value — including ones inside attributes:

```ts
`<td>${esc(row.name)}</td>`                       // text content
`<div style="background:${esc(barColor)};"></div>` // attribute value
`<p>${esc(line)}</p>`                              // AI-generated text
```

Escaping inside `style="..."` matters: an unescaped value containing a `"` can
break out of the attribute and inject event handlers or new tags.

If you build a **new** HTML template, add an `esc()` helper (or import one) and
apply the same rule; do not rely on the data "probably" being clean.

## Also guard the recipients / destination

HTML injection in an email is amplified if the email can be sent to arbitrary
addresses. Outbound-send routes must restrict recipients to a stored allow-list
(see `email-summary/send/route.ts`), never to addresses taken raw from the
request body.

## Checklist

- [ ] Every interpolated value in a raw HTML/email string is `esc()`-wrapped.
- [ ] Values inside `style=`/`href=`/other attributes are escaped too.
- [ ] AI-generated text is treated as untrusted and escaped.
- [ ] New templates define/import an escape helper rather than trusting input.
- [ ] Outbound email/webhook destinations come from an allow-list, not the body.
