#!/usr/bin/env node
/**
 * 4.2 — Générateur de specs de validation DTO pour apps/api.
 *
 * Introspecte chaque DTO exporté (class-validator), génère une spec qui
 * vérifie : (1) une instance valide passe, (2) chaque propriété requise
 * manquante échoue, (3) chaque propriété typée rejette les valeurs invalides.
 *
 * Les specs générées sont volontairement déterministes et lisibles — elles
 * documentent le contrat métier de chaque endpoint (un invariant de
 * validation est une décision de produit).
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'C:/Users/pc/Desktop/finished app creche/apps/api/src/modules';
const out = [];

function listDir(d) { try { return readdirSync(d); } catch { return []; } }

/**
 * Extrait les classes exportées avec un compteur d'accolades — une regex
 * non-gourmande s'arrête au premier `\n}` et fusionne les classes one-liner
 * (`class X { @IsUUID() id!: string; }`) avec la classe suivante.
 */
function extractClasses(txt) {
  const classes = [];
  const re = /export class (\w+) \{/g;
  let m;
  while ((m = re.exec(txt)) !== null) {
    const name = m[1];
    let i = m.index + m[0].length;
    let depth = 1;
    const start = i;
    while (i < txt.length && depth > 0) {
      const c = txt[i];
      if (c === '/' && txt[i + 1] !== '/' && txt[i + 1] !== '*' && /[,(=:[!&|?+~-]/.test(txt[i - 1] ?? '')) {
        // littéral regex (précédé d'un opérateur) : saute jusqu'au / fermant
        let k = i + 1;
        while (k < txt.length && txt[k] !== '/' && txt[k] !== '\n') {
          if (txt[k] === '\\') k++;
          k++;
        }
        if (k < txt.length && txt[k] === '/') { i = k + 1; continue; }
      }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      i++;
    }
    classes.push({ name, body: txt.slice(start, i - 1) });
    re.lastIndex = i;
  }
  return classes;
}

/**
 * Extrait les décorateurs d'une déclaration de propriété par marche arrière
 * caractère par caractère — gère les regex littérales (`/^(a|b)$/`) que
 * `[^()]*` cassait en s'arrêtant à la première parenthèse.
 */
function extractDecorators(body, propStart) {
  const decos = [];
  let i = propStart;
  while (i > 0) {
    let j = i;
    // skip whitespace AND comment lines backwards (`// ...` entre décorateurs)
    while (j > 0) {
      if (/\s/.test(body[j - 1])) { j--; continue; }
      // commentaire de fin de ligne : remonte jusqu'au `//`
      const lineStart = body.lastIndexOf('\n', j - 1);
      const line = body.slice(lineStart + 1, j);
      if (/^\s*\/\//.test(line)) { j = lineStart + 1; continue; }
      break;
    }
    if (body[j - 1] !== ')') break;
    let depth = 0;
    let k = j;
    while (k > 0) {
      const c = body[k - 1];
      if (c === ')') depth++;
      else if (c === '(') {
        depth--;
        if (depth === 0) break;
      }
      k--;
    }
    let m = k - 1;
    while (m > 0 && /[\w.]/.test(body[m - 1])) m--;
    if (body[m - 1] !== '@') break;
    decos.unshift({ name: body.slice(m, k - 1), args: body.slice(k, j - 1) });
    i = m - 1;
  }
  return decos;
}

for (const mod of listDir(ROOT).sort()) {
  const dtoDir = join(ROOT, mod, 'dto');
  if (!existsSync(dtoDir)) continue;
  const files = listDir(dtoDir).filter(f => f.endsWith('.ts') && !f.endsWith('.spec.ts')).sort();
  if (!files.length) continue;
  const classes = [];
  for (const f of files) {
    const txt = readFileSync(join(dtoDir, f), 'utf8');
    for (const { name, body } of extractClasses(txt)) {
      // propriété = `name!: type` — le type peut être une union de littéraux
      // (`'a' | 'b'`) ; on capture juste le nom et les décorateurs.
      // On borne le type à la ligne pour éviter que `[^;]+` n'absorbe la
      // propriété suivante, et on exclut les fausses propriétés qui vivent
      // À L'INTÉRIEUR d'un décorateur (`message: '…'` de `@Matches(...)`).
      const decoSpans = [...body.matchAll(/@\w+\s*\(/g)].map(d => {
        let k = d.index + d[0].length, depth = 1, q = null;
        while (k < body.length && depth > 0) {
          const c = body[k];
          if (q) { if (c === '\\') k++; else if (c === q) q = null; }
          else if (c === '\'' || c === '"') q = c;
          else if (c === '/' && /[,(=:[!&|?+~-]/.test(body[k - 1] ?? '')) {
            // littéral regex : saute jusqu'au / fermant en ignorant les
            // échappements (un `/` dans `[\w\-./]` n'est pas la fin)
            let n = k + 1;
            while (n < body.length && body[n] !== '/' && body[n] !== '\n') {
              if (body[n] === '\\') n++;
              n++;
            }
            if (n < body.length && body[n] === '/') { k = n + 1; continue; }
          }
          else if (c === '(') depth++;
          else if (c === ')') depth--;
          k++;
        }
        return [d.index, k];
      });
      const propMatches = [...body.matchAll(/(?:^|[;})])\s*(\w+)([!?]?):\s*([^\n;]+)/gm)]
        .filter(pm => {
          const nameAt = pm.index + pm[0].indexOf(pm[1]);
          return !decoSpans.some(([a, b]) => nameAt >= a && nameAt < b);
        });
      const seen = new Set();
      const rich = propMatches.map(pm => {
        const nameStart = pm.index + pm[0].indexOf(pm[1]);
        return { nameStart, name: pm[1], type: pm[3].trim() };
      }).filter(p => {
        if (seen.has(p.name)) return false;
        seen.add(p.name);
        return true;
      }).map(p => ({
        decos: extractDecorators(body, p.nameStart),
        name: p.name,
        type: p.type,
      }));
      classes.push({ name, file: f.replace('.ts', ''), props: rich });
      if (name === 'CreateRoomDto') console.error('CreateRoomDto props:', rich.map(p => p.name));
    }
  }
  if (!classes.length) continue;
  out.push({ mod, classes });
}
console.log(JSON.stringify(out.map(o => ({ mod: o.mod, n: o.classes.length })), null, 0));
writeFileSync(join(process.env.TMPDIR || 'C:/Users/pc/AppData/Local/Temp', 'dto-catalog.json'), JSON.stringify(out, null, 1));
console.log('total classes:', out.reduce((a, o) => a + o.classes.length, 0));
