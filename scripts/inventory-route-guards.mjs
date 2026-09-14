#!/usr/bin/env node
/**
 * Inventaire des routes HTTP SANS garde de rôle explicite — audit 2026-09 C1.
 *
 * RolesGuard est fail-open (`if (!roles || roles.length === 0) return true`) :
 * toute route authentifiée qui n'a ni @Roles ni @Public est ouverte à TOUS les
 * rôles du tenant. C'est ce qui a permis le finding C1 (staff : salaires lus
 * par n'importe quel parent). Ce script liste ces routes pour décider,
 * contrôleur par contrôleur, si l'absence de garde est voulue (scoping en
 * service — ex. /parent/*) ou un oubli.
 *
 * Sortie : tableau `garde|module/contrôleur|route`. Exit 0 dans tous les cas
 * (outil d'inventaire, pas un gate) ; le gate de non-régression est la suite
 * tests/tenant-isolation/phase25-security-audit-c.api.test.mjs.
 *
 * Usage : npm run check:routes-inventory
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODULES = join(REPO, 'apps', 'api', 'src', 'modules');
const HTTP_METHODS = new Set(['Get', 'Post', 'Patch', 'Put', 'Delete']);
const GUARDS = new Set(['Roles', 'Public']);

const rows = [];

for (const mod of readdirSync(MODULES)) {
  const dir = join(MODULES, mod);
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.controller.ts'));
  } catch {
    continue;
  }
  for (const f of files) {
    const src = readFileSync(join(dir, f), 'utf8');
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const controllers = [];
    for (const stmt of sf.statements) {
      if (ts.isClassDeclaration(stmt) && stmt.name) {
        const ctrlDecorator = (ts.getDecorators(stmt) ?? [])
          .map((d) => decoratorName(d))
          .find((n) => n === 'Controller');
        if (ctrlDecorator) controllers.push(stmt);
      }
    }
    for (const cls of controllers) {
      for (const member of cls.members) {
        if (!ts.isMethodDeclaration(member) || !member.name) continue;
        const decorators = (ts.getDecorators(member) ?? []).map((d) => decoratorName(d));
        const http = decorators.find((n) => HTTP_METHODS.has(n));
        if (!http) continue;
        const hasGuard = decorators.some((n) => GUARDS.has(n));
        const routeArg = (ts.getDecorators(member) ?? [])
          .map((d) => decoratorArgs(d))
          .find(({ name }) => HTTP_METHODS.has(name))?.arg;
        const route = routeArg ? `@${http}('${routeArg}')` : `@${http}()`;
        rows.push({
          guard: hasGuard ? (decorators.includes('Public') ? 'PUBLIC' : 'ROLES') : 'NONE',
          file: `${mod}/${f}`,
          route,
          method: member.name.text,
        });
      }
    }
  }
}

function decoratorName(decorator) {
  const expr = decorator.expression;
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) return expr.expression.text;
  if (ts.isIdentifier(expr)) return expr.text;
  return '';
}
function decoratorArgs(decorator) {
  const expr = decorator.expression;
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
    const arg = expr.arguments[0];
    return { name: expr.expression.text, arg: arg && ts.isStringLiteral(arg) ? arg.text : undefined };
  }
  return { name: '', arg: undefined };
}

rows.sort((a, b) => (a.file + a.route).localeCompare(b.file + b.route));
for (const r of rows) {
  console.log(`${r.guard.padEnd(7)} ${r.file.padEnd(42)} ${r.route.padEnd(28)} ${r.method}`);
}
const none = rows.filter((r) => r.guard === 'NONE');
console.log(`\n${rows.length} routes HTTP inventoriées — ${none.length} sans @Roles ni @Public (à revoir, module par module)`);
