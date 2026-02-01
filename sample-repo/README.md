# Gravito Demo Repo

This is a sample repository to test the Gravito GitHub Action.

## Quick Start

1. Fork this repo
2. Add your `GRAVITO_API_KEY` to repository secrets
3. Create a PR with a change to `website/index.html`
4. Watch Gravito review your PR

## What's Inside

- `website/index.html` - A sample landing page with intentional issues
- `.github/workflows/gravito.yml` - Pre-configured Gravito workflow

## Test PRs

### PR 1: Passing Review
Change the headline to something clear and benefit-focused:
```html
<h1>Ship AI features your users trust</h1>
```

### PR 2: Blocked Review
Change the headline to something that violates proof constraints:
```html
<h1>The #1 AI governance platform in the world</h1>
```

Gravito will block this PR and suggest a patch.

## Expected Results

When you create a PR, Gravito will:
1. Review the changed files against the configured rubrics
2. Post a comment with the review results
3. Block or pass the PR based on the score
4. Generate a proof block artifact

## Learn More

- [Gravito Documentation](https://gravito.ai/docs)
- [GitHub Action Reference](https://github.com/gravito/gravito-action)
