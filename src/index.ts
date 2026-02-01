/**
 * Gravito GitHub Action - Release Gate for AI
 * 
 * "Install Gravito into your CI and it becomes your release gate for AI."
 * 
 * This action:
 * 1. Runs preflightReview() on PR diffs + artifacts
 * 2. Fails check run if block_release=true (COMPILER SEMANTICS)
 * 3. Posts issues + patches inline as PR comments
 * 4. Optional auto-apply patches (behind flag)
 * 5. Links to /admin/audit for traceability
 * 6. ALWAYS generates proof block artifacts (even on failure)
 */

import * as core from '@actions/core';
import * as github from '@actions/github';
import * as glob from '@actions/glob';
import artifact from '@actions/artifact';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// =============================================================================
// TYPES
// =============================================================================

interface ReviewResult {
  artifact_id: string;
  file_path: string;
  score: number;
  decision: 'PASS' | 'BLOCK' | 'WARN';
  issues: Issue[];
  patches: Patch[];
  proof_block: ProofBlock;
}

interface Issue {
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  message: string;
  line?: number;
  column?: number;
  fix_suggestion?: string;
}

interface Patch {
  id: string;
  category: string;
  description: string;
  original: string;
  replacement: string;
  line_start?: number;
  line_end?: number;
  auto_applicable: boolean;
}

interface ProofBlock {
  decision_id: string;
  artifact_hash: string;
  score: number;
  decision: string;
  timestamp: string;
  model_version: string;
  rubric_version: string;
  signature: string;
}

interface GravitoResponse {
  success: boolean;
  results: ReviewResult[];
  summary: {
    total: number;
    passed: number;
    blocked: number;
    warned: number;
    average_score: number;
  };
  audit_url: string;
  proof_block_url: string;
}

interface GateReport {
  proof_id: string;
  timestamp: string;
  content_hash: string;
  decision: 'PASS' | 'BLOCK' | 'ERROR';
  github_context: {
    repository: string;
    run_id: string;
    sha: string;
    ref: string;
    actor: string;
    workflow: string;
    job: string;
  };
  gate_config: {
    surface: string;
    pack: string;
    threshold: number;
    fail_on_block: boolean;
  };
  summary: {
    total_artifacts: number;
    passed: number;
    blocked: number;
    warned: number;
    average_score: number;
  };
  artifacts: Array<{
    path: string;
    artifact_id: string;
    score: number;
    decision: string;
    issue_count: number;
    patch_count: number;
    proof_block?: ProofBlock;
  }>;
  decision_trace: {
    reason: string;
    conditions: Array<{
      name: string;
      expected: string;
      actual: string;
      passed: boolean;
    }>;
  };
  signature: string;
}

// =============================================================================
// API CLIENT
// =============================================================================

async function callGravitoAPI(
  apiKey: string,
  apiUrl: string,
  artifacts: Array<{ path: string; content: string }>,
  options: {
    surface: string;
    pack: string;
    threshold: number;
  }
): Promise<GravitoResponse> {
  const response = await fetch(`${apiUrl}/api/v1/review/batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'X-GitHub-Run-Id': process.env.GITHUB_RUN_ID || '',
      'X-GitHub-Repository': process.env.GITHUB_REPOSITORY || '',
      'X-GitHub-SHA': process.env.GITHUB_SHA || '',
    },
    body: JSON.stringify({
      artifacts,
      surface: options.surface,
      pack: options.pack,
      threshold: options.threshold,
      generate_patches: true,
      generate_proof_blocks: true,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gravito API error: ${response.status} - ${error}`);
  }

  return response.json() as Promise<GravitoResponse>;
}

// =============================================================================
// FILE DISCOVERY
// =============================================================================

async function discoverArtifacts(patterns: string[]): Promise<Array<{ path: string; content: string }>> {
  const artifacts: Array<{ path: string; content: string }> = [];
  
  for (const pattern of patterns) {
    const globber = await glob.create(pattern, {
      followSymbolicLinks: false,
    });
    
    for await (const file of globber.globGenerator()) {
      // Skip node_modules and other common excludes
      if (file.includes('node_modules') || 
          file.includes('.git') || 
          file.includes('dist/') ||
          file.includes('build/')) {
        continue;
      }
      
      try {
        const content = fs.readFileSync(file, 'utf-8');
        artifacts.push({
          path: path.relative(process.cwd(), file),
          content,
        });
      } catch (err) {
        core.warning(`Could not read file: ${file}`);
      }
    }
  }
  
  return artifacts;
}

// =============================================================================
// PR COMMENTS
// =============================================================================

async function postInlineComments(
  octokit: ReturnType<typeof github.getOctokit>,
  results: ReviewResult[]
): Promise<void> {
  const context = github.context;
  
  if (!context.payload.pull_request) {
    core.info('Not a pull request, skipping inline comments');
    return;
  }
  
  const prNumber = context.payload.pull_request.number;
  const owner = context.repo.owner;
  const repo = context.repo.repo;
  const commitId = context.payload.pull_request.head.sha;
  
  // Create review with comments
  const comments: Array<{
    path: string;
    line: number;
    body: string;
  }> = [];
  
  for (const result of results) {
    // Add issue comments
    for (const issue of result.issues) {
      if (issue.line) {
        const emoji = issue.severity === 'critical' ? '🚨' : 
                      issue.severity === 'high' ? '⚠️' : 
                      issue.severity === 'medium' ? '📝' : 'ℹ️';
        
        comments.push({
          path: result.file_path,
          line: issue.line,
          body: `${emoji} **Gravito ${issue.severity.toUpperCase()}** (${issue.category})\n\n${issue.message}${issue.fix_suggestion ? `\n\n**Suggested fix:** ${issue.fix_suggestion}` : ''}`,
        });
      }
    }
    
    // Add patch comments
    for (const patch of result.patches) {
      if (patch.line_start) {
        comments.push({
          path: result.file_path,
          line: patch.line_start,
          body: `🔧 **Gravito Patch Available** (${patch.category})\n\n${patch.description}\n\n\`\`\`diff\n- ${patch.original}\n+ ${patch.replacement}\n\`\`\`\n\n${patch.auto_applicable ? '✅ Auto-applicable' : '⚠️ Manual review required'}`,
        });
      }
    }
  }
  
  if (comments.length === 0) {
    core.info('No inline comments to post');
    return;
  }
  
  // Create the review
  try {
    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      commit_id: commitId,
      event: 'COMMENT',
      comments: comments.slice(0, 50), // GitHub limits to 50 comments per review
    });
    
    core.info(`Posted ${Math.min(comments.length, 50)} inline comments`);
  } catch (err) {
    core.warning(`Failed to post inline comments: ${err}`);
  }
}

// =============================================================================
// PATCH APPLICATION
// =============================================================================

async function applyPatches(
  octokit: ReturnType<typeof github.getOctokit>,
  results: ReviewResult[]
): Promise<number> {
  let appliedCount = 0;
  
  for (const result of results) {
    for (const patch of result.patches) {
      if (!patch.auto_applicable) continue;
      
      try {
        const filePath = path.resolve(process.cwd(), result.file_path);
        let content = fs.readFileSync(filePath, 'utf-8');
        
        // Apply the patch
        content = content.replace(patch.original, patch.replacement);
        fs.writeFileSync(filePath, content);
        
        appliedCount++;
        core.info(`Applied patch ${patch.id} to ${result.file_path}`);
      } catch (err) {
        core.warning(`Failed to apply patch ${patch.id}: ${err}`);
      }
    }
  }
  
  return appliedCount;
}

// =============================================================================
// PROOF BLOCK GENERATION (MANDATORY - ALWAYS RUNS)
// =============================================================================

function generateGateReport(
  results: ReviewResult[],
  summary: GravitoResponse['summary'],
  config: { surface: string; pack: string; threshold: number; failOnBlock: boolean }
): GateReport {
  const timestamp = new Date().toISOString();
  const proofId = `proof_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  
  const decision: 'PASS' | 'BLOCK' = summary.blocked > 0 ? 'BLOCK' : 'PASS';
  
  const report: Omit<GateReport, 'content_hash' | 'signature'> = {
    proof_id: proofId,
    timestamp,
    decision,
    github_context: {
      repository: process.env.GITHUB_REPOSITORY || 'unknown',
      run_id: process.env.GITHUB_RUN_ID || 'unknown',
      sha: process.env.GITHUB_SHA || 'unknown',
      ref: process.env.GITHUB_REF || 'unknown',
      actor: process.env.GITHUB_ACTOR || 'unknown',
      workflow: process.env.GITHUB_WORKFLOW || 'unknown',
      job: process.env.GITHUB_JOB || 'unknown',
    },
    gate_config: {
      surface: config.surface,
      pack: config.pack,
      threshold: config.threshold,
      fail_on_block: config.failOnBlock,
    },
    summary: {
      total_artifacts: summary.total,
      passed: summary.passed,
      blocked: summary.blocked,
      warned: summary.warned,
      average_score: summary.average_score,
    },
    artifacts: results.map(r => ({
      path: r.file_path,
      artifact_id: r.artifact_id,
      score: r.score,
      decision: r.decision,
      issue_count: r.issues.length,
      patch_count: r.patches.length,
      proof_block: r.proof_block,
    })),
    decision_trace: {
      reason: decision === 'PASS' 
        ? `All ${summary.total} artifacts passed threshold ${config.threshold}`
        : `${summary.blocked} artifact(s) blocked (below threshold ${config.threshold})`,
      conditions: [
        {
          name: 'blocked_count',
          expected: '0',
          actual: String(summary.blocked),
          passed: summary.blocked === 0,
        },
        {
          name: 'average_score',
          expected: `>= ${config.threshold}`,
          actual: String(summary.average_score.toFixed(1)),
          passed: summary.average_score >= config.threshold,
        },
      ],
    },
  };

  // Calculate content hash
  const contentHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(report))
    .digest('hex');

  // Generate signature (HMAC with secret)
  const secret = process.env.GRAVITO_SIGNING_SECRET || 'gravito-action-default-key';
  const signature = crypto
    .createHmac('sha256', secret)
    .update(contentHash)
    .digest('hex');

  return {
    ...report,
    content_hash: contentHash,
    signature,
  };
}

function generateMarkdownReport(report: GateReport): string {
  const passEmoji = report.decision === 'PASS' ? '✅' : '❌';
  
  return `# Gravito Gate Report

**Proof ID:** \`${report.proof_id}\`  
**Timestamp:** ${report.timestamp}  
**Decision:** ${passEmoji} **${report.decision}**

---

## GitHub Context

| Field | Value |
|-------|-------|
| Repository | ${report.github_context.repository} |
| Run ID | ${report.github_context.run_id} |
| SHA | \`${report.github_context.sha.substring(0, 8)}\` |
| Ref | ${report.github_context.ref} |
| Actor | ${report.github_context.actor} |
| Workflow | ${report.github_context.workflow} |

---

## Gate Configuration

| Setting | Value |
|---------|-------|
| Surface | ${report.gate_config.surface} |
| Pack | ${report.gate_config.pack} |
| Threshold | ${report.gate_config.threshold} |
| Fail on Block | ${report.gate_config.fail_on_block} |

---

## Summary

| Metric | Value |
|--------|-------|
| Total Artifacts | ${report.summary.total_artifacts} |
| Passed | ${report.summary.passed} |
| Blocked | ${report.summary.blocked} |
| Warned | ${report.summary.warned} |
| Average Score | ${report.summary.average_score.toFixed(1)} |

---

## Decision Trace

**Reason:** ${report.decision_trace.reason}

### Conditions Checked

| Condition | Expected | Actual | Result |
|-----------|----------|--------|--------|
${report.decision_trace.conditions.map(c => `| ${c.name} | ${c.expected} | ${c.actual} | ${c.passed ? '✅' : '❌'} |`).join('\n')}

---

## Artifacts Reviewed

| Path | Score | Decision | Issues | Patches |
|------|-------|----------|--------|---------|
${report.artifacts.map(a => `| ${a.path} | ${a.score} | ${a.decision} | ${a.issue_count} | ${a.patch_count} |`).join('\n')}

---

## Verification

**Content Hash:** \`${report.content_hash}\`  
**Signature:** \`${report.signature.substring(0, 16)}...\`

_This proof block can be verified using the Gravito audit API._
`;
}

/**
 * Write proof block files and upload as GitHub Action artifacts
 * CRITICAL: This runs ALWAYS - even on gate failure
 */
async function emitProofBlockArtifacts(
  report: GateReport
): Promise<{ jsonPath: string; mdPath: string }> {
  const outputDir = process.env.GITHUB_WORKSPACE || process.cwd();
  
  // Write JSON proof block
  const jsonPath = path.join(outputDir, 'gate_report.json');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');
  core.info(`📄 Proof block JSON written to: ${jsonPath}`);
  
  // Write Markdown summary
  const mdPath = path.join(outputDir, 'gate_report.md');
  const markdown = generateMarkdownReport(report);
  fs.writeFileSync(mdPath, markdown, 'utf-8');
  core.info(`📄 Proof block Markdown written to: ${mdPath}`);
  
  // Upload as GitHub Action artifacts
  const artifactName = `gravito-proof-block-${report.proof_id}`;
  
  try {
    const uploadResponse = await artifact.uploadArtifact(
      artifactName,
      [jsonPath, mdPath],
      outputDir
    );
    
    core.info(`📦 Proof block artifacts uploaded: ${artifactName}`);
    if (uploadResponse.size) {
      core.info(`   Size: ${uploadResponse.size} bytes`);
    }
    if (uploadResponse.id) {
      core.info(`   Artifact ID: ${uploadResponse.id}`);
    }
  } catch (err) {
    // Don't fail the action if artifact upload fails
    core.warning(`Failed to upload proof block artifacts: ${err}`);
  }
  
  return { jsonPath, mdPath };
}

// =============================================================================
// SUMMARY GENERATION
// =============================================================================

function generateSummary(
  results: ReviewResult[],
  summary: GravitoResponse['summary'],
  auditUrl: string,
  proofBlockUrl: string,
  gateReport: GateReport
): string {
  const passed = summary.blocked === 0;
  const emoji = passed ? '✅' : '❌';
  
  let md = `## ${emoji} Gravito Review Gate\n\n`;
  
  // Summary table
  md += `| Metric | Value |\n`;
  md += `|--------|-------|\n`;
  md += `| **Gate Decision** | ${passed ? '✅ PASSED' : '❌ BLOCKED'} |\n`;
  md += `| Total Artifacts | ${summary.total} |\n`;
  md += `| Passed | ${summary.passed} |\n`;
  md += `| Blocked | ${summary.blocked} |\n`;
  md += `| Warnings | ${summary.warned} |\n`;
  md += `| Average Score | ${summary.average_score.toFixed(1)} |\n`;
  md += `| Proof ID | \`${gateReport.proof_id}\` |\n\n`;
  
  // Blocked artifacts
  const blocked = results.filter(r => r.decision === 'BLOCK');
  if (blocked.length > 0) {
    md += `### 🚨 Blocked Artifacts\n\n`;
    for (const result of blocked) {
      md += `<details>\n<summary><strong>${result.file_path}</strong> (Score: ${result.score})</summary>\n\n`;
      
      for (const issue of result.issues) {
        const emoji = issue.severity === 'critical' ? '🚨' : 
                      issue.severity === 'high' ? '⚠️' : '📝';
        md += `${emoji} **${issue.severity.toUpperCase()}** (${issue.category}): ${issue.message}\n`;
      }
      
      if (result.patches.length > 0) {
        md += `\n**Suggested Patches:**\n`;
        for (const patch of result.patches) {
          md += `- ${patch.description}\n`;
        }
      }
      
      md += `\n</details>\n\n`;
    }
  }
  
  // Links
  md += `### 📋 Audit Trail\n\n`;
  md += `- [View Audit Trail](${auditUrl})\n`;
  md += `- [View Proof Block](${proofBlockUrl})\n`;
  md += `- **Proof Block Artifact:** \`gravito-proof-block-${gateReport.proof_id}\`\n`;
  
  return md;
}

// =============================================================================
// MAIN
// =============================================================================

async function run(): Promise<void> {
  let gateReport: GateReport | null = null;
  
  try {
    // Get inputs
    const apiKey = core.getInput('api-key', { required: true });
    const apiUrl = core.getInput('api-url');
    const surface = core.getInput('surface');
    const pack = core.getInput('pack');
    const pathsInput = core.getInput('paths');
    const failOnBlock = core.getBooleanInput('fail-on-block');
    const autoApplyPatches = core.getBooleanInput('auto-apply-patches');
    const postComments = core.getBooleanInput('post-inline-comments');
    const threshold = parseInt(core.getInput('threshold'), 10);
    
    core.info('🚀 Starting Gravito Review Gate');
    core.info(`Surface: ${surface}`);
    core.info(`Pack: ${pack}`);
    core.info(`Threshold: ${threshold}`);
    
    // Discover artifacts
    const patterns = pathsInput.split(',').map(p => p.trim());
    core.info(`Discovering artifacts matching: ${patterns.join(', ')}`);
    
    const artifacts = await discoverArtifacts(patterns);
    core.info(`Found ${artifacts.length} artifacts to review`);
    
    if (artifacts.length === 0) {
      core.info('No artifacts found, skipping review');
      core.setOutput('passed', 'true');
      core.setOutput('total-reviewed', '0');
      return;
    }
    
    // Call Gravito API
    core.info('Calling Gravito API...');
    const response = await callGravitoAPI(apiKey, apiUrl, artifacts, {
      surface,
      pack,
      threshold,
    });
    
    core.info(`Review complete: ${response.summary.passed} passed, ${response.summary.blocked} blocked`);
    
    // ALWAYS generate proof block (even before potential failure)
    gateReport = generateGateReport(response.results, response.summary, {
      surface,
      pack,
      threshold,
      failOnBlock,
    });
    
    // ALWAYS emit proof block artifacts (CRITICAL - runs before any failure)
    await emitProofBlockArtifacts(gateReport);
    
    // Post inline comments
    if (postComments) {
      const token = process.env.GITHUB_TOKEN;
      if (token) {
        const octokit = github.getOctokit(token);
        await postInlineComments(octokit, response.results);
      } else {
        core.warning('GITHUB_TOKEN not available, skipping inline comments');
      }
    }
    
    // Auto-apply patches
    if (autoApplyPatches) {
      const token = process.env.GITHUB_TOKEN;
      if (token) {
        const octokit = github.getOctokit(token);
        const appliedCount = await applyPatches(octokit, response.results);
        core.info(`Applied ${appliedCount} patches`);
      }
    }
    
    // Generate summary
    const summary = generateSummary(
      response.results,
      response.summary,
      response.audit_url,
      response.proof_block_url,
      gateReport
    );
    await core.summary.addRaw(summary).write();
    
    // Set outputs
    core.setOutput('passed', response.summary.blocked === 0 ? 'true' : 'false');
    core.setOutput('total-reviewed', response.summary.total.toString());
    core.setOutput('passed-count', response.summary.passed.toString());
    core.setOutput('blocked-count', response.summary.blocked.toString());
    core.setOutput('warned-count', response.summary.warned.toString());
    core.setOutput('average-score', response.summary.average_score.toString());
    core.setOutput('audit-url', response.audit_url);
    core.setOutput('proof-block-url', response.proof_block_url);
    core.setOutput('proof-id', gateReport.proof_id);
    
    // Fail if blocked (COMPILER SEMANTICS - no bypass)
    if (failOnBlock && response.summary.blocked > 0) {
      core.setFailed(`❌ GATE BLOCKED: ${response.summary.blocked} artifact(s) failed threshold ${threshold}. Proof block: ${gateReport.proof_id}`);
    } else {
      core.info('✅ Gravito Review Gate passed');
    }
    
  } catch (error) {
    // Even on error, try to emit a proof block
    if (!gateReport) {
      gateReport = {
        proof_id: `proof_error_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
        timestamp: new Date().toISOString(),
        content_hash: '',
        decision: 'ERROR',
        github_context: {
          repository: process.env.GITHUB_REPOSITORY || 'unknown',
          run_id: process.env.GITHUB_RUN_ID || 'unknown',
          sha: process.env.GITHUB_SHA || 'unknown',
          ref: process.env.GITHUB_REF || 'unknown',
          actor: process.env.GITHUB_ACTOR || 'unknown',
          workflow: process.env.GITHUB_WORKFLOW || 'unknown',
          job: process.env.GITHUB_JOB || 'unknown',
        },
        gate_config: {
          surface: core.getInput('surface') || 'unknown',
          pack: core.getInput('pack') || 'unknown',
          threshold: parseInt(core.getInput('threshold'), 10) || 75,
          fail_on_block: true,
        },
        summary: {
          total_artifacts: 0,
          passed: 0,
          blocked: 0,
          warned: 0,
          average_score: 0,
        },
        artifacts: [],
        decision_trace: {
          reason: `Error during gate execution: ${error instanceof Error ? error.message : String(error)}`,
          conditions: [],
        },
        signature: '',
      };
      
      // Calculate hash and signature for error report
      const contentHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(gateReport))
        .digest('hex');
      gateReport.content_hash = contentHash;
      gateReport.signature = crypto
        .createHmac('sha256', process.env.GRAVITO_SIGNING_SECRET || 'gravito-action-default-key')
        .update(contentHash)
        .digest('hex');
      
      // Try to emit proof block even on error
      try {
        await emitProofBlockArtifacts(gateReport);
      } catch (artifactError) {
        core.warning(`Failed to emit error proof block: ${artifactError}`);
      }
    }
    
    if (error instanceof Error) {
      core.setFailed(`❌ GATE ERROR: ${error.message}. Proof block: ${gateReport?.proof_id || 'none'}`);
    } else {
      core.setFailed('An unexpected error occurred');
    }
  }
}

run();
