#!/usr/bin/env node
// One-off/reusable helper: diffs per-theme CSS between the source foil-eleven app and
// drucker, since sync-cards.js only flags brand-new variants, not redesigns of existing
// ones. Usage: node scripts/diff-theme-css.js <source-index.html> [theme1 theme2 ...]
// With no theme names given, diffs every theme name found in drucker's own CSS.
//
// Matches selectors exactly (theme-X / pattern-X / pattern-Xpattern / gem-facets scoped to
// theme-X), then resolves the @keyframes those rules actually reference by name - rather than
// guessing keyframe ownership by substring, which produced false positives for short theme
// names (e.g. "fs" matching inside "gfShiftA", "flash" matching "goalFlashIn").

const fs = require('fs');
const path = require('path');

function extractStyle(html) {
  const m = html.match(/<style>([\s\S]*?)<\/style>/);
  return m[1];
}

function splitRules(css) {
  const rules = [];
  let depth = 0, start = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      if (depth === 0) start = css.lastIndexOf('\n', i) + 1 || 0;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) rules.push(css.slice(start, i + 1).trim());
    }
  }
  return rules;
}

function selectorRulesForTheme(rules, theme) {
  const re = new RegExp(`[.\\s](theme|pattern)-${theme}(pattern)?([.\\s:{]|$)`, 'i');
  return rules.filter(r => re.test(r.split('{')[0]));
}

function animationNamesIn(rules) {
  const names = new Set();
  for (const r of rules) {
    for (const m of r.matchAll(/animation(?:-name)?\s*:\s*([^;{}]+)/g)) {
      // animation: <name> <duration> <timing> <iter> [, <name2> ...] - names are the
      // non-numeric, non-keyword tokens in each comma-separated group
      for (const group of m[1].split(',')) {
        for (const tok of group.trim().split(/\s+/)) {
          if (/^[A-Za-z_-][A-Za-z0-9_-]*$/.test(tok) && !/^(infinite|linear|ease|ease-in|ease-out|ease-in-out|normal|reverse|alternate|forwards|backwards|both|none)$/i.test(tok)) {
            names.add(tok);
          }
        }
      }
    }
  }
  return names;
}

function keyframeRulesByName(rules, names) {
  return rules.filter(r => {
    const m = r.match(/@keyframes\s+([A-Za-z0-9_-]+)/);
    return m && names.has(m[1]);
  });
}

function main() {
  const [, , sourcePath, ...themeArgs] = process.argv;
  if (!sourcePath) {
    console.error('Usage: node scripts/diff-theme-css.js <source-index.html> [theme1 theme2 ...]');
    process.exit(1);
  }
  const druckerPath = path.join(__dirname, '..', 'index.html');
  const drucker = fs.readFileSync(druckerPath, 'utf8');
  const source = fs.readFileSync(sourcePath, 'utf8');

  const druckerRules = splitRules(extractStyle(drucker));
  const sourceRules = splitRules(extractStyle(source));

  let themes = themeArgs;
  if (!themes.length) {
    const set = new Set();
    [...drucker.matchAll(/\.pcard\.theme-([a-z_]+)/g)].forEach(m => set.add(m[1]));
    themes = [...set].sort();
  }

  let anyDiff = false;
  for (const theme of themes) {
    const dSel = selectorRulesForTheme(druckerRules, theme);
    const sSel = selectorRulesForTheme(sourceRules, theme);
    const dNames = animationNamesIn(dSel);
    const sNames = animationNamesIn(sSel);
    const allNames = new Set([...dNames, ...sNames]);
    const dKf = keyframeRulesByName(druckerRules, allNames);
    const sKf = keyframeRulesByName(sourceRules, allNames);

    const dText = [...dSel, ...dKf].join('\n\n');
    const sText = [...sSel, ...sKf].join('\n\n');
    if (dText !== sText) {
      anyDiff = true;
      console.log(`\n=== DIFFERS: theme-${theme} ===`);
      console.log(`--- drucker (${dText.length} chars) ---`);
      console.log(dText || '(none found)');
      console.log(`--- source (${sText.length} chars) ---`);
      console.log(sText || '(none found)');
    }
  }
  if (!anyDiff) console.log('No CSS differences found for any checked theme.');
}

main();
