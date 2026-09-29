#!/usr/bin/env node
/**
 * Publie un résumé lisible du JSON Trivy dans le job summary et sous forme
 * d'annotations Checks API. L'artifact complet reste la source de vérité ; ce
 * résumé permet d'identifier les CVE bloquantes quand son téléchargement est
 * indisponible depuis un client GitHub.
 *
 * Usage : node scripts/summarize-trivy.mjs [trivy-results.json]
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];
const HIGH_SEVERITIES = new Set(['CRITICAL', 'HIGH']);
const MAX_SUMMARY_FINDINGS = 20;
// GitHub Actions permits at most ten warning annotations per step.
const MAX_ANNOTATIONS = 10;

const clean = (value) => String(value ?? '—').replace(/[\r\n|]/g, ' ').trim() || '—';
const escapeMarkdown = (value) => clean(value).replaceAll('\\', '\\\\').replaceAll('|', '\\|');
const escapeCommandData = (value) => String(value ?? '')
  .replaceAll('%', '%25')
  .replaceAll('\r', '%0D')
  .replaceAll('\n', '%0A');
const escapeCommandProperty = (value) => escapeCommandData(value)
  .replaceAll(':', '%3A')
  .replaceAll(',', '%2C');

function severityRank(severity) {
  const index = SEVERITIES.indexOf(String(severity ?? 'UNKNOWN').toUpperCase());
  return index < 0 ? SEVERITIES.length : index;
}

/** Normalise les rapports JSON Trivy (OS et bibliothèques) en une liste. */
export function collectTrivyFindings(report) {
  return (Array.isArray(report?.Results) ? report.Results : []).flatMap((result) => {
    const vulnerabilities = Array.isArray(result?.Vulnerabilities) ? result.Vulnerabilities : [];
    return vulnerabilities.map((vulnerability) => ({
      target: clean(result?.Target),
      severity: String(vulnerability?.Severity ?? 'UNKNOWN').toUpperCase(),
      id: clean(vulnerability?.VulnerabilityID),
      package: clean(vulnerability?.PkgName),
      installed: clean(vulnerability?.InstalledVersion),
      fixed: clean(vulnerability?.FixedVersion),
      title: clean(vulnerability?.Title),
    }));
  }).sort((a, b) => severityRank(a.severity) - severityRank(b.severity)
    || a.id.localeCompare(b.id)
    || a.package.localeCompare(b.package));
}

/** Construit les compteurs, le résumé Markdown et les annotations de scan. */
export function summarizeTrivyReport(report, app = 'image') {
  const findings = collectTrivyFindings(report);
  const counts = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0]));
  for (const finding of findings) {
    counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
  }
  const high = findings.filter((finding) => HIGH_SEVERITIES.has(finding.severity));
  const visible = high.slice(0, MAX_SUMMARY_FINDINGS);
  const lines = [
    `### Résumé Trivy — ${escapeMarkdown(app)}`,
    '',
    `Vulnérabilités : **${findings.length}** au total ; **${counts.CRITICAL} CRITICAL** et **${counts.HIGH} HIGH** (seuil bloquant).`,
    '',
    '| Sévérité | CVE / ID | Paquet | Installée | Version corrigée | Cible |',
    '|---|---|---|---|---|---|',
  ];

  if (visible.length === 0) {
    lines.push('| — | Aucune CRITICAL/HIGH dans le JSON | — | — | — | — |');
  } else {
    for (const finding of visible) {
      lines.push(`| ${escapeMarkdown(finding.severity)} | ${escapeMarkdown(finding.id)} | ${escapeMarkdown(finding.package)} | ${escapeMarkdown(finding.installed)} | ${escapeMarkdown(finding.fixed)} | ${escapeMarkdown(finding.target)} |`);
    }
    if (high.length > visible.length) {
      lines.push('', `Affichage limité aux ${visible.length} premières entrées sur ${high.length} HIGH/CRITICAL ; consulter le JSON complet dans l'artifact Trivy.`);
    }
  }

  lines.push('', 'Le résumé ne remplace pas le JSON complet archivé comme artifact.');
  const annotations = high.slice(0, MAX_ANNOTATIONS).map((finding) => {
    const title = escapeCommandProperty(`Trivy ${app} ${finding.severity} ${finding.id}`);
    const message = escapeCommandData(
      `${finding.package} ${finding.installed} → corrigée : ${finding.fixed}; cible : ${finding.target}${finding.title === '—' ? '' : `; ${finding.title}`}`,
    ).slice(0, 900);
    return `::warning title=${title}::${message}`;
  });

  return { counts, findings, markdown: `${lines.join('\n')}\n`, annotations };
}

function main(reportPath = 'trivy-results.json') {
  let report;
  try {
    if (!existsSync(reportPath)) throw new Error(`rapport absent : ${reportPath}`);
    report = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch (error) {
    const message = `### Résumé Trivy\n\nImpossible de lire le rapport JSON : ${clean(error.message)}. Le scan peut avoir échoué avant la génération du fichier.\n`;
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
    process.stdout.write(`${message}\n`);
    return;
  }

  const app = process.env.TRIVY_APP ?? 'image';
  const summary = summarizeTrivyReport(report, app);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary.markdown}\n`);
  }
  process.stdout.write(`${summary.markdown}\n`);
  if (process.env.GITHUB_ACTIONS === 'true') {
    for (const annotation of summary.annotations) process.stdout.write(`${annotation}\n`);
    if (summary.annotations.length === 0) {
      process.stdout.write(`::notice title=${escapeCommandProperty(`Trivy ${app}`)}::Aucune vulnérabilité CRITICAL/HIGH dans le JSON\n`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2] ?? 'trivy-results.json');
}
