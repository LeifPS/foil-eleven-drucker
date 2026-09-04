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
  wmquestreward: "PROMO", promoquestreward: "PROMO", marcelolegacy: "PROMO",
  kapitaen: "Kapitäne",
  wm26_variante: "WM 2026", wm26_kapitaen: "WM 2026",
  breakout: "Breakout",
  ratings27: "27 Ratings", ratings27reload: "27 Ratings",
  iconpromo: "Icon Promo",
  siege_trophy: "Erfolge", liga_champion: "Erfolge", wep_trophy: "Erfolge",
  // deliberately excluded, matching source's own adminFullCardPool() catalog filter:
  //  - legacy/legacystar: source's own comment says these are "not yet in the index" -
  //    hidden:true/admin-test only, roster/photos not finalized.
  //  - admin: debug/easter-egg cards, "kein regulärer Erhalt im Spiel möglich".
  //  - kontrahent: bot-only opponent filler, never obtainable.
};
// variants that must NEVER be printed even if they show up in adminFullCardPool()'s output -
// see the comment above. Cards with these variants are dropped before pool-mapping, not just
// left unmapped, so they never trip the "unmapped variant" error either.
const EXCLUDED_VARIANTS = new Set(['legacy', 'legacystar', 'admin', 'kontrahent']);

// Manager cards (MGR_BY_ID, isManager:true) are a separate catalog from the player pools above -
// source's own Karten-Index concatenates both (see buildCardIndexUniverse), so drucker's total
// should match that combined count, not just adminFullCardPool()'s player-only count. Pooled by
// what each variant is actually a reward FOR, mirroring its player-card counterpart's pool.
const MGR_VARIANT_TO_POOL = {
  manager: "Trainer",
  meistertrainer: "Meistertrainer",
  uclw_mgr: "UCL Winners",
  legende_mgr: "Legends",
  wm_mgr: "WM",
  zidane_mgr: "Kapitäne",
  og_mgr: "OG Icons",
};

// Paste this into the browser console (or via the Claude Browser tool's javascript_exec)
// on the SOURCE app once it's loaded, to produce new-cards.json:
const EXTRACT_SNIPPET = `
(function(){
  const VARIANT_TO_POOL = ${JSON.stringify(VARIANT_TO_POOL)};
  const MGR_VARIANT_TO_POOL = ${JSON.stringify(MGR_VARIANT_TO_POOL)};
  const EXCLUDED_VARIANTS = new Set(${JSON.stringify([...EXCLUDED_VARIANTS])});
  // adminFullCardPool() is the source app's OWN "every real, obtainable card" helper - it force-
  // builds every lazily-cached pool (WM26 Variante/Kapitän, Breakout, trophy cards, ...) and
  // already excludes bot-filler/phantom cards by id range. Falls back to raw BY_ID if source is
  // an older version without it (pre-lazy-pools).
  const players = (typeof adminFullCardPool === 'function' ? adminFullCardPool() : [...BY_ID.values()].filter(c=>!c.isManager))
    .filter(c=>!EXCLUDED_VARIANTS.has(c.variant));
  // Managers (MGR_BY_ID) are a wholly separate catalog the player-only helper above never
  // includes - source's own Karten-Index concatenates both (see buildCardIndexUniverse), so this
  // must too or the total count silently undershoots the real one by however many managers exist.
  const managers = typeof MGR_BY_ID !== 'undefined' ? [...MGR_BY_ID.values()] : [];
  const all = [...players, ...managers];
  const unmapped = new Set();
  const out = all.map(c=>{
    const pool = c.isManager ? (MGR_VARIANT_TO_POOL[c.variant] || 'Special') : VARIANT_TO_POOL[c.variant];
    if(!pool) unmapped.add(c.variant);
    // cdn.sofifa.net image URLs are systematically broken (anti-hotlink protection blocks even
    // the wsrv.nl proxy's own fetch - confirmed 0/20 loading in a sample, and most are outright
    // 404 even with a browser referer) - treated as no photo at all, same as a card with no img
    // field, rather than let every one of these silently fail to load at render/print/PDF time.
    const img = (c.img && c.img.includes('cdn.sofifa.net')) ? undefined : c.img;
    const card = {
      id:c.id, n:c.n, pos:c.pos, ov:c.ov, pot:c.pot, nat:c.nat, lg:c.lg, club:c.club,
      pac:c.pac, sho:c.sho, pas:c.pas, dri:c.dri, defn:c.defn, phy:c.phy, foot:c.foot,
      img, gk:c.gk, variant:c.variant,
    };
    // real-database import cards carry their own clubImg straight from the source (CLUB_LOGO only
    // hand-covers the biggest clubs) - captured for every card, not just managers, since the
    // 11k+-player real DB relies on it too.
    if(c.clubImg) card.clubImg = c.clubImg;
    if(c.variantLabel) card.variantLabel = c.variantLabel;
    if(c.theme) card.theme = c.theme;
    if(c.baseId) card.baseId = c.baseId;
    if(c.isManager){
      card.isManager = true;
      card.tier = c.tier;
      card.boostType = c.boostType;
      card.boostValue = c.boostValue;
    }
    card.pool = pool || 'Special';
    return card;
  });
  if(unmapped.size) console.warn('UNMAPPED VARIANTS - add to VARIANT_TO_POOL/MGR_VARIANT_TO_POOL:', [...unmapped]);
  copy(JSON.stringify(out)); // Chrome DevTools: copies to clipboard
  return {total: out.length, players: players.length, managers: managers.length, unmappedVariants: [...unmapped]};
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
