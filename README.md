# Gravito Review Gate

> **Install Gravito into your CI and it becomes your release gate for AI.**

The Gravito GitHub Action reviews AI-generated content before it ships, blocking releases that fail quality gates. Like Snyk for security, SonarQube for code quality, or Datadog for observability—but for AI governance.

## 10-Minute Install

### Step 1: Get Your API Key (2 min)

1. Go to [gravito.ai/dashboard](https://gravito.ai/dashboard)
2. Create a new project or select existing
3. Copy your API key from Settings → API

### Step 2: Add Secret to Repository (1 min)

1. Go to your GitHub repository
2. Navigate to **Settings → Secrets and variables → Actions**
3. Click **New repository secret**
4. Name: `GRAVITO_API_KEY`
5. Value: Paste your API key

### Step 3: Add Workflow File (2 min)

Create `.github/workflows/gravito-review.yml`:

```yaml
name: Gravito Review Gate

on:
  pull_request:
    branches: [main]

jobs:
  gravito-review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    
    steps:
      - uses: actions/checkout@v4
      
      - uses: gravito/gravito-action@v1
        with:
          api-key: ${{ secrets.GRAVITO_API_KEY }}
          surface: website
          threshold: 75
          fail-on-block: true
          post-inline-comments: true
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Step 4: Open a PR (5 min)

Push any change and open a pull request. Gravito will:

1. ✅ Review all matching artifacts
2. ✅ Post inline comments with issues and patches
3. ✅ Block merge if quality gate fails
4. ✅ Generate proof block for audit trail

**That's it. You now have AI governance in your CI.**

---

## What It Does

```
┌─────────────────────────────────────────────────────────────────┐
│                        PR Opened                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Gravito Action                                                 │
│  ─────────────────────────────────────────────────────────────  │
│  1. Discover artifacts (*.tsx, *.ts, *.md, *.html)             │
│  2. Call preflightReview() on each artifact                     │
│  3. Score against rubric pack                                   │
│  4. Generate patches for issues                                 │
│  5. Create proof block for audit trail                          │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────┐
│  Score ≥ 75             │     │  Score < 75             │
│  ─────────────────────  │     │  ─────────────────────  │
│  ✅ Check passes        │     │  ❌ Check fails         │
│  ✅ Merge allowed       │     │  ❌ Merge blocked       │
│  📝 Warnings posted     │     │  🔧 Patches suggested   │
└─────────────────────────┘     └─────────────────────────┘
```

---

## Configuration

### Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `api-key` | Gravito API key (required) | - |
| `api-url` | Gravito API endpoint | `https://api.gravito.ai` |
| `surface` | Surface type: `website`, `support`, `sales`, `email` | `website` |
| `pack` | Rubric pack: `default`, `strict`, `enterprise` | `default` |
| `paths` | Glob patterns for files to review | `**/*.tsx,**/*.ts,**/*.md` |
| `threshold` | Minimum score to pass (0-100) | `75` |
| `fail-on-block` | Fail check if any artifact blocked | `true` |
| `post-inline-comments` | Post issues as PR comments | `true` |
| `auto-apply-patches` | Auto-apply safe patches | `false` |
| `generate-proof-block` | Generate audit artifact | `true` |

### Outputs

| Output | Description |
|--------|-------------|
| `passed` | Whether all artifacts passed |
| `total-reviewed` | Number of artifacts reviewed |
| `passed-count` | Artifacts that passed |
| `blocked-count` | Artifacts that were blocked |
| `average-score` | Average score across artifacts |
| `audit-url` | Link to audit trail |
| `proof-block-url` | Link to proof block |
| `proof-id` | Unique proof block ID |

---

## Surfaces

Configure the `surface` input based on what you're reviewing:

| Surface | Use For | Key Rubrics |
|---------|---------|-------------|
| `website` | Marketing pages, landing pages, docs | Identity coherence, CTA hierarchy, proof coverage |
| `support` | Help articles, FAQ, chatbot responses | Accuracy, empathy, escalation paths |
| `sales` | Outreach emails, proposals, decks | Value prop clarity, social proof, urgency |
| `email` | Transactional emails, newsletters | Subject lines, CTAs, unsubscribe compliance |

---

## Rubric Packs

| Pack | Threshold | Use Case |
|------|-----------|----------|
| `default` | 75 | Standard quality gate |
| `strict` | 85 | High-stakes content |
| `enterprise` | 90 | Regulated industries |

---

## Auto-Apply Patches

Enable `auto-apply-patches: true` to automatically fix safe issues:

```yaml
- uses: gravito/gravito-action@v1
  with:
    api-key: ${{ secrets.GRAVITO_API_KEY }}
    auto-apply-patches: true
```

The action will:
1. Apply patches marked as `auto_applicable: true`
2. Create a commit with the fixes
3. Push to the PR branch

**Note:** Requires `contents: write` permission.

---

## Proof Blocks

**ALWAYS generated** - even on gate failure or error.

Every review generates a cryptographically signed proof block:

```json
{
  "version": "1.0.0",
  "generated_at": "2024-01-15T10:30:00Z",
  "github": {
    "repository": "your-org/your-repo",
    "run_id": "12345678",
    "sha": "abc123..."
  },
  "summary": {
    "total_artifacts": 15,
    "passed": 14,
    "blocked": 1,
    "average_score": 82.5,
    "gate_decision": "BLOCKED"
  },
  "artifacts": [...]
}
```

Use this for:
- **SOC 2 compliance** - Evidence of review process
- **Audit trails** - Traceability of what was reviewed
- **Debugging** - Understanding why something was blocked

---

## Examples

### Basic Website Review

```yaml
- uses: gravito/gravito-action@v1
  with:
    api-key: ${{ secrets.GRAVITO_API_KEY }}
    surface: website
```

### Strict Enterprise Review

```yaml
- uses: gravito/gravito-action@v1
  with:
    api-key: ${{ secrets.GRAVITO_API_KEY }}
    surface: website
    pack: enterprise
    threshold: 90
    fail-on-block: true
```

### Support Content Review

```yaml
- uses: gravito/gravito-action@v1
  with:
    api-key: ${{ secrets.GRAVITO_API_KEY }}
    surface: support
    paths: |
      docs/**/*.md
      help/**/*.md
```

### Review with Auto-Fix

```yaml
- uses: gravito/gravito-action@v1
  with:
    api-key: ${{ secrets.GRAVITO_API_KEY }}
    auto-apply-patches: true
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## Troubleshooting

### "API key invalid"

1. Check the key in Settings → API on gravito.ai
2. Ensure the secret is named exactly `GRAVITO_API_KEY`
3. Verify the secret has no trailing whitespace

### "No artifacts found"

1. Check your `paths` patterns match your files
2. Ensure files aren't in excluded directories (node_modules, dist)
3. Try a broader pattern like `**/*`

### "Check failed but content looks fine"

1. Review the inline comments for specific issues
2. Check the proof block artifact for detailed scores
3. Consider adjusting the `threshold` if appropriate

---

## Support

- **Documentation:** [gravito.ai/docs](https://gravito.ai/docs)
- **Issues:** [github.com/gravito/gravito-action/issues](https://github.com/gravito/gravito-action/issues)
- **Email:** support@gravito.ai

---

## License

MIT License - see [LICENSE](LICENSE) for details.
