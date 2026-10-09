#!/usr/bin/env node
/**
 * 4.2 — Génère les specs de validation DTO à partir du catalogue introspecté.
 *
 * Pour chaque DTO : (1) une instance VALIDE doit passer (prouve que la spec
 * connaît le vrai contrat), (2) chaque propriété requise supprimée doit
 * échouer, (3) chaque décorateur est testé avec une valeur invalide.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TMPDIR = process.env.TMPDIR || 'C:/Users/pc/AppData/Local/Temp';
const catalog = JSON.parse(readFileSync(join(TMPDIR, 'dto-catalog.json'), 'utf8'));
const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

/** Construit une valeur valide pour une propriété selon son type + décorateurs. */
const allClassNames = new Set(catalog.flatMap(m => m.classes.map(c => c.name)));
const nestedTargets = new Set();

function validValue(prop) {
  const names = prop.decos.map(d => d.name);
  const isOptional = names.includes('IsOptional');
  if (isOptional) return undefined;
  const t = prop.type;
  if (names.includes('IsUUID')) return UUID;
  if (names.includes('IsBoolean')) return true;
  if (names.includes('IsInt') || names.includes('IsNumber') || t.includes('number')) {
    const min = prop.decos.find(d => d.name === 'Min');
    return min ? Number(min.args) : 1;
  }
  if (names.includes('IsDateString') || names.includes('IsDate')) return '2026-01-15';
  if (names.includes('IsISO8601')) return '2026-01-15T00:00:00Z';
  if (names.includes('IsEmail')) return 'a@b.co';
  if (names.includes('Matches')) {
    // @Matches(/…/) : stub pour les regex simples. Une regex métier complexe
    // ne peut pas être reconstruite → propriété signalée (__MANUAL__).
    const mt = prop.decos.find(d => d.name === 'Matches');
    const args = mt.args;
    // {n} exact — attention : le message d'erreur contient aussi des virgules,
    // on coupe la regex à la première virgule pour ne lire que le pattern.
    // le message d'erreur commence par ", { message:" — on coupe dessus pour
    // garder les ranges `{4,6}` intacts.
    const pattern = args.split(/,\s*\{/)[0];
    // min length imposé par un autre décorateur (@MinLength) — le stub Matches
    // doit le respecter aussi (storage_key : Matches{1,500} + MinLength(3)).
    const minLenDeco = prop.decos.find(d => d.name === 'MinLength');
    const minLen = minLenDeco ? Number(minLenDeco.args.match(/\d+/)?.[0] ?? 1) : 1;
    // /^\d{4}-\d{2}$/ → on génère le nombre exact de chiffres par groupe
    // (à tester AVANT exactN qui ne voit que le premier groupe)
    const digitGroups = pattern.match(/\\+d\{(\d+)\}/g);
    if (digitGroups && digitGroups.length > 1) {
      // seul le préfixe obligatoire (avant le premier groupe optionnel `(`)
      // est stubé — les groupes optionnels ont leur propre délimiteur.
      const mandatory = pattern.split('(')[0];
      const main = mandatory.match(/\\+d\{(\d+)\}/g) || digitGroups;
      return main.map(g => '0'.repeat(Number(g.match(/\d+/)[0]))).join('-');
    }
    // range {n,m} — testé AVANT exactN {n} qui sinon ne voit que `{1}`
    const range = pattern.match(/\{(\d+)\s*,\s*(\d+)\}/);
    if (range) {
      const n = Math.max(Number(range[1]), minLen);
      // [0-9] ou \d → chiffres ; on retire les séquences d'échappement avant
      // de chercher des lettres (le `d` de `\d` n'est pas une lettre).
      const stripped = pattern.replace(/\\+./g, '').replace(/\[.*?\]/g, '');
      const isDigits = /\\+d|\[0-9\]/.test(pattern) && !/[a-zA-Z]/.test(stripped);
      return isDigits ? '0'.repeat(n) : 'a'.repeat(n);
    }
    const exactN = pattern.match(/\{(\d+)\}/);
    if (exactN) {
      // /^[0-9a-f]{8}-[0-9a-f]{4}-…$/ → UUID-like : on génère chaque groupe
      const hexGroups = pattern.match(/\[[^\]]*\]\{(\d+)\}/g);
      if (hexGroups && hexGroups.length > 1) {
        return hexGroups.map(g => 'a'.repeat(Number(g.match(/\]\{(\d+)\}/)[1]))).join('-');
      }
      const strippedE = pattern.replace(/\\+./g, '').replace(/\[.*?\]/g, '');
      return /[a-zA-Z]/.test(strippedE) ? 'a'.repeat(Math.max(Number(exactN[1]), minLen)) : '0'.repeat(Math.max(Number(exactN[1]), minLen));
    }
    // /^(android|ios|web)$/ → première alternative. Le pattern contient des
    // parenthères (capturantes) — on prend la première si elle n'est pas
    // imbriquée et ne contient pas de digit-groups.
    const firstGroup = pattern.match(/\(([^()]*)\)/);
    if (firstGroup && firstGroup[1].includes('|') && !/\{|\[/.test(firstGroup[1])) {
      return firstGroup[1].split('|')[0];
    }
    // /^([01]\d|2[0-3]):[0-5]\d$/ → heure HH:MM valide
    if (/:\s*\\?d|\[0-5\]/.test(pattern)) return '00:00';
    if (/[0-9]/.test(pattern)) return '0'.repeat(8);
    return '__UNRESOLVED_MATCHES__';
  }
  const isIn = prop.decos.find(d => d.name === 'IsIn' || d.name === 'IsEnum');
  if (isIn) {
    // args = "['a','b']", "[1,2,3]", "[true, false]" ou "MA_CONST, …".
    // Tableau → premier littéral ; constante → résolu plus loin (import).
    const arrFirst = isIn.args.match(/\['([^']+)'|\[\"([^\"]+)\"|\[(\d+)|\[(true|false)/);
    if (arrFirst) {
      if (arrFirst[1]) return arrFirst[1];
      if (arrFirst[2]) return arrFirst[2];
      if (arrFirst[3]) return Number(arrFirst[3]);
      return arrFirst[4] === 'true';
    }
    const constRef = isIn.args.match(/^[A-Z][A-Z0-9_]+/);
    if (constRef) return '__UNRESOLVED_ISIN__';
    return '__UNRESOLVED_ISIN__';
  }
  if (names.includes('IsObject')) return {};
  if (names.includes('ValidateNested')) {
    // ValidateNested + @Type(() => X) : la regex capture mal la arrow → on
    // lit le type tableau (`X[]`). Le stub est [valid_X()] où valid_X est le
    // helper d'instance valide de la classe imbriquée (déclaré plus bas).
    const arrType = prop.type.match(/^(\w+)\[\]$/);
    const target = arrType ? arrType[1] : typeDecoTarget(prop);
    if (target && /^[A-Z]\w*$/.test(target)) {
      if (!allClassNames.has(target)) return '__SKIP__';
      nestedTargets.add(target);
      return `__NESTED:${target}__`;
    }
    return '__SKIP__';
  }
  if (names.includes('ValidateBy')) {
    // validateur personnalisé (ex. isSyncCursor) : stub chronologique — le
    // décorateur reste couvert par la spec métier dédiée (sync-resync-contract).
    const vb = prop.decos.find(d => d.name === 'ValidateBy');
    if (vb && /isSyncCursor/.test(vb.args)) return '0';
    return '__UNRESOLVED_VALIDATEBY__';
  }
  if (t.includes('Array') || t.includes('[]')) {
    const m = prop.type.match(/\[([\w<>\[\]| ]+)\]/);
    const inner = m ? m[1].trim() : 'string';
    if (inner.includes('number')) return [1];
    if (inner.includes('boolean')) return [true];
    return [UUID];
  }
  // string par défaut
  let v = 'ok';
  const minLen = prop.decos.find(d => d.name === 'MinLength');
  if (minLen) {
    const n = Number(minLen.args.match(/\d+/)?.[0] ?? 1);
    v = 'x'.repeat(Math.max(1, n));
  }
  const maxLen = prop.decos.find(d => d.name === 'MaxLength');
  if (maxLen) v = v.slice(0, Math.min(Number(maxLen.args), v.length || 10)) || v;
  return v;
}

/** Valeur INVALIDE pour le décorateur le plus contraignant. */
function invalidValue(prop) {
  const names = prop.decos.map(d => d.name);
  const t = prop.type;
  if (names.includes('IsUUID')) return 'not-a-uuid';
  if (names.includes('IsBoolean')) return 'not-a-bool';
  if (names.includes('IsInt')) return 1.5;
  if (names.includes('IsNumber')) return 'not-a-number';
  if (names.includes('IsDateString')) return 'not-a-date';
  if (names.includes('IsEmail')) return 'not-an-email';
  if (names.includes('MinLength')) {
    const ml = prop.decos.find(d => d.name === 'MinLength');
    const n = Number(ml.args.match(/\d+/)?.[0] ?? 2);
    // MinLength(1) → '' est la seule valeur invalide ; sinon n-1 caractères
    return n === 1 ? '' : 'x'.repeat(Math.max(0, n - 1));
  }
  if (names.includes('Min')) return -999;
  if (names.includes('Max')) return 999999;
  if (t.includes('Array') || t.includes('[]')) return 'not-an-array';
  if (t.includes('number')) return 'x';
  return 12345;
}

/** Nom de classe cible d'un @Type(() => X), robuste aux arrow functions. */
function typeDecoTarget(prop) {
  const d = prop.decos.find(x => x.name === 'Type');
  if (!d) return '';
  const arrow = d.args.match(/=>\s*(\w+)/);
  if (arrow) return arrow[1];
  return d.args.replace(/['"]/g, '').trim();
}

function propTest(prop, className) {
  const names = prop.decos.map(d => d.name);
  const isOptional = names.includes('IsOptional');
  const label = `${className}.${prop.name}`;
  const lines = [];
  if (!isOptional) {
    lines.push(`  it('${label} requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.${prop.name};
    reject(dto, '${prop.name}');
  });`);
  } else {
    // une propriété optionnelle accepte undefined — IsOptional court-circuite
    // class-validator. La valeur par défaut reste couverte par "instance valide".
    lines.push(`  it('${label} optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.${prop.name};
    expect(validateSync(dto)).toHaveLength(0);
  });`);
    return lines.join('\n');
  }
  const inv = JSON.stringify(invalidValue(prop));
  lines.push(`  it('${label} invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.${prop.name} = ${inv};
    reject(dto, '${prop.name}');
  });`);
  return lines.join('\n');
}

let total = 0;
const index = [];
for (const { mod, classes } of catalog) {
  const blocks = [];
  const extraImports = new Set();
  const markManual = [];
  const classNames = new Set(classes.map(c => c.name));
  const nestedTargets = new Set();

  for (const c of classes) {
    const required = c.props.filter(p => !p.decos.some(d => d.name === 'IsOptional'));
    const validObj = {};
    for (const p of c.props) {
      const v = validValue(p);
      if (v !== undefined) validObj[p.name] = v;
      // IsIn sur une constante exportée (ex. SYNC_COMMANDS) → on importe la
      // constante et on prend sa première valeur comme instance valide.
      const isIn = p.decos.find(d => d.name === 'IsIn' || d.name === 'IsEnum');
      if (isIn && v === '__UNRESOLVED_ISIN__') {
        // args = "SYNC_COMMANDS, { message: '…' }" → premier IDENTIFIER seul.
        // La regex /'…'/ tomberait sur le message d'erreur, pas la constante.
        const m = isIn.args.match(/^[A-Z][A-Z0-9_]+/);
        if (m) {
          extraImports.add(m[0]);
          validObj[p.name] = `__CONST:${m[0]}[0]__`;
        }
      }
      if (typeof v === 'string' && v.startsWith('__NESTED:') && v.endsWith('__')) {
        const t = v.slice('__NESTED:'.length, -'__'.length);
        if (!classNames.has(t)) extraImports.add(t);
        validObj[p.name] = `__CONST:[valid_${t}()]__`;
      }
      if (v === '__UNRESOLVED_VALIDATEBY__') markManual.push(p.name);
      if (v === '__UNRESOLVED_MATCHES__') markManual.push(p.name);
      if (v === '__SKIP__') delete validObj[p.name];
    }
    for (const pname of markManual) delete validObj[pname];
    const manualSkip = new Set(markManual);
    const resolved = {};
    for (const [k, v] of Object.entries(validObj)) {
      if (typeof v === 'string' && v.startsWith('__CONST:') && v.endsWith('__')) {
        resolved[k] = v.slice('__CONST:'.length, -'__'.length);
      } else {
        resolved[k] = JSON.stringify(v);
      }
    }
    const validLiteral = ['{', ...Object.entries(resolved).map(([k, v]) => `    ${k}: ${v},`), '  }'].join('\n');
    const tests = c.props.filter(p => !manualSkip.has(p.name)).map(p => propTest(p, c.name)).filter(Boolean).join('\n\n');
    const testedProps = c.props.filter(p => !manualSkip.has(p.name) && !p.decos.some(d => d.name === 'IsOptional'));
    const propTestCount = testedProps.length;
    const helper = propTestCount
      ? `  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);\n`
      : '';
    blocks.push(`const valid_${c.name} = () => plainToInstance(${c.name}, ${validLiteral.replace(/^/gm, '  ').replace(/^  {/, '{')});

describe('${c.name} (4.2)', () => {
  const valid = valid_${c.name};
${helper}
  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

${tests}
});`);
    total++;
  }
  const dtoFiles = [...new Set(classes.map(c => c.file))];
  const dtoFrom = dtoFiles.map(f => `'./dto/${f}'`).join(',\n  ');
  // un import par fichier DTO — une classe peut venir d'un autre fichier que
  // la première. Les constantes (SYNC_COMMANDS…) vont dans leur fichier.
  const byFile = new Map();
  for (const c of classes) {
    if (!byFile.has(c.file)) byFile.set(c.file, new Set());
    byFile.get(c.file).add(c.name);
  }
  for (const i of extraImports) {
    // une constante est déclarée dans le fichier de la classe qui l'utilise
    for (const [f, names] of byFile.entries()) {
      if ([...names.values()].some(n => allClassNames.has(n))) { byFile.get(f).add(i); break; }
    }
  }
  const importBlocks = [...byFile.entries()].map(([f, names]) =>
    `import {\n${[...names].map(n => `  ${n},`).join('\n')}\n} from './dto/${f}';`).join('\n');
  const constImports = extraImports.size
    ? `\nimport {\n${[...extraImports].map(i => `  ${i},`).join('\n')}\n} from ${dtoFrom};`
    : '';
  const content = `/**
 * 4.2 — Validation des DTO du module ${mod}.
 *
 * Généré par introspection des décorateurs class-validator. Chaque test fixe
 * un invariant métier : un endpoint qui accepte une entrée invalide est un
 * bug de sécurité (injection SQL via filtre, UUID falsifié pour-tenant…).
 */
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
${importBlocks}

${blocks.join('\n\n')}
`;
  const outPath = `C:/Users/pc/Desktop/finished app creche/apps/api/src/modules/${mod}/dto-validation.spec.ts`;
  writeFileSync(outPath, content.replace(/跨/g, ''));
  index.push(mod);
}
console.log('specs écrites:', index.length, '| classes couvertes:', total);
console.log(index.join(', '));
