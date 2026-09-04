#!/usr/bin/env node
// Syncs card data + any new theme CSS from the full "foil-eleven" source app into this
// (drucker) print-only app.
//
// Usage:
//   node scripts/sync-cards.js <path-to-new-cards.json> <path-to-source-index.html>
//
// <new-cards.json> = the array produced by running EXTRACT_SNIPPET (see below) in a real
//   browser against the source index.html, with pool mapping already applied.
// <source-index.html> = the full source app file, used only to pull in CSS for any
//   brand-new variant/theme that doesn't exist here yet.
//
// Why a browser step is unavoidable: the source app computes its final card list (BY_ID)
// from dozens of pool-merging/derivation functions (e.g. Black Hole cards are generated
// from Blackout cards at runtime). Re-implementing that in Node would drift from the
// source; running the source's own JS and reading out BY_ID is what actually stays correct.
//
// To produce new-cards.json without hand-copying megabytes of JSON out of the browser:
//   1. node scripts/dev-server.js <path-to-source-repo> scripts/new-cards.json
//   2. open http://127.0.0.1:8934/index.html (loads the source app)
//   3. run EXTRACT_SNIPPET in the page, but replace its `copy(...)` line with:
//        fetch('/save', {method:'POST', body: json})
//      (dev-server.js's /save endpoint writes the POST body straight to new-cards.json)
//
// This script does NOT diff CSS for themes/variants it already knows about - only brand-new
// variant values get flagged. If an existing theme's look changes in the source (e.g. a
// pattern-layer redesign), this script stays silent about it; check for that by hand.

const fs = require('fs');
const path = require('path');

const VARIANT_TO_POOL = {
  base: "Base",
  icon: "Special", showdown: "Special", tots: "Special", flashback: "Special", iron_curtain: "Special",
  otw: "Special", fut_star: "Special", derby: "Special", rising_phenom: "Special", setpiece: "Special",
  the_wall: "Special", hall_of_fame: "Special", golden_boot: "Special", playmaker: "Special",
  galactico: "Special", wonderkid: "Special", centurion: "Special", golden_glove: "Special",
  worldcup: "Exclusive", blackout: "Exclusive",
  blackhole: "Black Hole",
  goat: "GOAT",
  golden_ball: "WM", goldenglove_wm: "WM", young_player: "WM", wc_champion: "WM", semifinalist: "WM", quarterfinalist: "WM",
  legende_ikone: "Legends", legende_wm: "Legends", legende_national: "Legends",
  derby_icon: "Derby",
  underdog: "Underdog",
  uclw: "UCL Winners",
  ballondor: "Ballon d'Or",
  prime: "Prime",
  iconswap: "Icon Swap",
  signature_icon: "Signature Season", era_definer: "Signature Season", signature_season: "Signature Season",
  poet: "Poeten",
  ogicon: "OG Icons",
  saph: "Kronjuwelen", rub: "Kronjuwelen", dia: "Kronjuwelen",
  week_mvp: "Wochen Pass",
  mysteryrare: "Mystery Elite",
  sbcexclusive: "SBC Karten",
  wmquestreward: "PROMO", promoquestreward: "PROMO",
  kapitaen: "Kapitäne",
};

// Paste this into the browser console (or via the Claude Browser tool's javascript_exec)
// on the SOURCE app once it's loaded, to produce new-cards.json:
const EXTRACT_SNIPPET = `
(function(){
  const VARIANT_TO_POOL = ${JSON.stringify(VARIANT_TO_POOL)};
  const all = [...BY_ID.values()].filter(c=>!c.isManager);
  const unmapped = new Set();
  const out = all.map(c=>{
    const pool = VARIANT_TO_POOL[c.variant];
    if(!pool) unmapped.add(c.variant);
    const card = {
      id:c.id, n:c.n, pos:c.pos, ov:c.ov, pot:c.pot, nat:c.nat, lg:c.lg, club:c.club,
      pac:c.pac, sho:c.sho, pas:c.pas, dri:c.dri, defn:c.defn, phy:c.phy, foot:c.foot,
      img:c.img, gk:c.gk, variant:c.variant,
    };
    if(c.variantLabel) card.variantLabel = c.variantLabel;
    if(c.theme) card.theme = c.theme;
    if(c.baseId) card.baseId = c.baseId;
    card.pool = pool || 'Special';
    return card;
  });
  if(unmapped.size) console.warn('UNMAPPED VARIANTS - add to VARIANT_TO_POOL:', [...unmapped]);
  copy(JSON.stringify(out)); // Chrome DevTools: copies to clipboard
  return {total: out.length, unmappedVariants: [...unmapped]};
})()
`.trim();

function main() {
  const [, , newCardsPath, sourceHtmlPath] = process.argv;
  if (!newCardsPath) {
    console.log('Run this in a browser against the source app first:\n');
    console.log(EXTRACT_SNIPPET);
    console.log('\nThen: node scripts/sync-cards.js <new-cards.json> [source-index.html]');
    process.exit(0);
  }

  const druckerPath = path.join(__dirname, '..', 'index.html');
  let drucker = fs.readFileSync(druckerPath, 'utf8');
  const newCards = JSON.parse(fs.readFileSync(newCardsPath, 'utf8'));

  const oldCards = JSON.parse(
    drucker.match(/<script type="application\/json" id="cards-data">(.*?)<\/script>/s)[1]
  );
  console.log(`old: ${oldCards.length} cards, new: ${newCards.length} cards`);

  const unmapped = new Set(newCards.filter(c => !c.pool).map(c => c.variant));
  if (unmapped.size) {
    console.error('ERROR: cards with no pool mapping found:', [...unmapped]);
    console.error('Add these to VARIANT_TO_POOL in this script and re-run.');
    process.exit(1);
  }

  // detect brand-new themes (variant values not present in the old data) so we know
  // whether CSS/VARIANT_ICON/PATTERN_FAMILY porting is needed
  const oldVariants = new Set(oldCards.map(c => c.variant));
  const newVariants = [...new Set(newCards.map(c => c.variant))].filter(v => !oldVariants.has(v));
  if (newVariants.length) {
    console.log('New variant(s) not seen before:', newVariants);
    const newThemes = [...new Set(newCards.filter(c => newVariants.includes(c.variant)).map(c => c.theme).filter(Boolean))];
    console.log('  -> theme(s):', newThemes);

    if (sourceHtmlPath) {
      const source = fs.readFileSync(sourceHtmlPath, 'utf8');
      for (const theme of newThemes) {
        const hasCss = new RegExp(`\\.pcard\\.theme-${theme}\\b`).test(drucker);
        if (hasCss) { console.log(`  [ok] .theme-${theme} CSS already present`); continue; }
        console.log(`  [ACTION NEEDED] .theme-${theme} CSS missing - port by hand from source:`);
        console.log(`    grep -n "theme-${theme}\\b" "${sourceHtmlPath}"`);
        console.log(`    grep -n "  ${theme}:" "${sourceHtmlPath}"   # VARIANT_ICON / PATTERN_FAMILY entries`);
      }
    } else {
      console.log('  Pass source-index.html as the 2nd argument to check for missing theme CSS.');
    }
  } else {
    console.log('No new variants - pure data update, no CSS porting needed.');
  }

  // Collector numbers are stable, not positional: a card's number, once assigned,
  // must never change on a later sync, or physically-printed cards go out of sync
  // with the digital catalog. Carry every existing id's num forward untouched, and
  // hand out the next free integers only to ids that are genuinely new.
  let nextNum = Math.max(0, ...oldCards.map(c => c.num || 0)) + 1;
  const oldNumById = new Map(oldCards.map(c => [c.id, c.num]));
  let assignedCount = 0;
  for (const c of newCards) {
    if (oldNumById.has(c.id)) {
      c.num = oldNumById.get(c.id);
    } else {
      c.num = nextNum++;
      assignedCount++;
    }
  }
  console.log(`Collector numbers: kept ${newCards.length - assignedCount} existing, assigned ${assignedCount} new (next free: ${nextNum}).`);

  const newJson = JSON.stringify(newCards);
  drucker = drucker.replace(
    /<script type="application\/json" id="cards-data">.*?<\/script>/s,
    '<script type="application/json" id="cards-data">' + newJson + '</script>'
  );
  fs.writeFileSync(druckerPath, drucker);
  console.log(`\nWrote ${newCards.length} cards into ${druckerPath}`);

  // sanity: report pool count deltas
  const poolCounts = (cards) => cards.reduce((m, c) => (m[c.pool] = (m[c.pool] || 0) + 1, m), {});
  const oldPools = poolCounts(oldCards), newPools = poolCounts(newCards);
  const allPools = [...new Set([...Object.keys(oldPools), ...Object.keys(newPools)])].sort();
  for (const p of allPools) {
    const o = oldPools[p] || 0, n = newPools[p] || 0;
    if (o !== n) console.log(`  ${p}: ${o} -> ${n}`);
  }
}

main();
