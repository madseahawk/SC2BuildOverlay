'use strict';

/**
 * Downloads the unit/building/upgrade icons into `assets/icons/` and writes a
 * manifest keyed by the Korean terms the build files actually use.
 *
 * Source: https://github.com/BurnySc2/sc2-planner (MIT), whose `src/icons/png`
 * holds the ladder button icons extracted from a StarCraft II install. The art
 * itself is Blizzard's — fine for personal, non-commercial use, not for resale.
 *
 * Run once:  node tools/fetch-icons.js
 * The manifest is what the app reads at runtime, so it is committed alongside
 * the images and this script does not need to run on every build.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { TERMS } = require('../src/main/translate');

const REPO = 'BurnySc2/sc2-planner';
const REF = 'master';
const DIR = 'src/icons/png';
const RAW = `https://raw.githubusercontent.com/${REPO}/${REF}/${DIR}/`;
const TREE = `https://api.github.com/repos/${REPO}/git/trees/${REF}?recursive=1`;

const OUT_DIR = path.join(__dirname, '..', 'assets', 'icons');
const MANIFEST = path.join(OUT_DIR, 'manifest.json');

/**
 * Keys whose in-game asset name differs from the dictionary key. Left to a
 * guess these would silently resolve to nothing, so every one is spelled out.
 */
const ALIASES = {
  SensorTower: 'btn-building-terran-sensordome',
  HellionTank: 'btn-unit-terran-hellionbattlemode',
  Hellbat: 'btn-unit-terran-hellionbattlemode',
  Viking: 'btn-unit-terran-vikingfighter',
  Stimpack: 'btn-ability-terran-stimpack-color',
  CombatShield: 'btn-techupgrade-terran-combatshield-color',
  ConcussiveShells: 'btn-ability-terran-punishergrenade-color',
  InfantryWeapons1: 'btn-upgrade-terran-infantryweaponslevel1',
  InfantryWeapons2: 'btn-upgrade-terran-infantryweaponslevel2',
  InfantryWeapons3: 'btn-upgrade-terran-infantryweaponslevel3',
  InfantryArmor1: 'btn-upgrade-terran-infantryarmorlevel1',
  InfantryArmor2: 'btn-upgrade-terran-infantryarmorlevel2',
  InfantryArmor3: 'btn-upgrade-terran-infantryarmorlevel3',
  VehicleWeapons1: 'btn-upgrade-terran-vehicleweaponslevel1',
  ShipWeapons1: 'btn-upgrade-terran-shipweaponslevel1',
  CloakingField: 'btn-ability-terran-cloak-color',
  PersonalCloaking: 'btn-ability-terran-cloak-color',
  BansheeSpeed: 'btn-upgrade-terran-hyperflightrotors',
  DrillingClaws: 'btn-upgrade-terran-researchdrillingclaws',
  SmartServos: 'btn-upgrade-terran-transformationservos',
  YamatoCannon: 'btn-ability-terran-yamatogun-color',

  MuscularAugments: 'btn-upgrade-zerg-evolvemuscularaugments',
  Burrow: 'btn-ability-zerg-burrow-color',
  MeleeAttacks1: 'btn-upgrade-zerg-meleeattacks-level1',
  MissileAttacks1: 'btn-upgrade-zerg-missileattacks-level1',
  GroundCarapace1: 'btn-upgrade-zerg-groundcarapace-level1',
  FlyerAttacks1: 'btn-upgrade-zerg-airattacks-level1',
  FlyerCarapace1: 'btn-upgrade-zerg-flyercarapace-level1',

  RoboticsBay: 'btn-building-protoss-roboticssupportbay',
  VoidRay: 'btn-unit-protoss-warpray',
  WarpGateResearch: 'btn-building-protoss-warpgate',
  Charge: 'btn-ability-protoss-charge-color',
  Blink: 'btn-ability-protoss-blink-color',
  PsiStorm: 'btn-ability-protoss-psistorm-color',
  GraviticBoosters: 'btn-upgrade-protoss-graviticbooster',
  AirWeapons1: 'btn-upgrade-protoss-airweaponslevel1',
  GroundWeapons1: 'btn-upgrade-protoss-groundweaponslevel1',
  GroundArmor1: 'btn-upgrade-protoss-groundarmorlevel1',
};

/**
 * Korean terms mapped by hand, for the two cases the filename guess cannot
 * reach: composed add-on names, and upgrade levels whose dictionary key does
 * not resemble the asset name (`MeleeAttacks2` vs `meleeattacks-level2`).
 *
 * Keyed by the Korean text rather than the dictionary key, so a term written by
 * hand in a build file gets the same icon as one that came from an import.
 */
const EXTRA_TERMS = [
  // Add-ons composed with the building they attach to, matching what
  // `translateKey` produces for imported builds (병영 기술실, not a bare 기술실).
  ['병영 기술실', 'btn-building-terran-barracks-techlab'],
  ['병영 반응로', 'btn-building-terran-barracks-reactor'],
  ['군수공장 기술실', 'btn-building-terran-factory-techlab'],
  ['군수공장 반응로', 'btn-building-terran-factory-reactor'],
  ['우주공항 기술실', 'btn-building-terran-starport-techlab'],
  ['우주공항 반응로', 'btn-building-terran-starport-reactor'],

  // Terran upgrade levels
  ['차량 무기 2단계', 'btn-upgrade-terran-vehicleweaponslevel2'],
  ['차량 무기 3단계', 'btn-upgrade-terran-vehicleweaponslevel3'],
  ['차량 및 우주선 장갑 1단계', 'btn-upgrade-terran-vehicleplatinglevel1'],
  ['차량 및 우주선 장갑 2단계', 'btn-upgrade-terran-vehicleplatinglevel2'],
  ['차량 및 우주선 장갑 3단계', 'btn-upgrade-terran-vehicleplatinglevel3'],
  ['우주선 무기 2단계', 'btn-upgrade-terran-shipweaponslevel2'],
  ['우주선 무기 3단계', 'btn-upgrade-terran-shipweaponslevel3'],

  // Researches whose asset name does not follow the usual convention:
  // a misspelt file, a co-op variant, or an ability icon standing in for the
  // research that grants it.
  ['첨단 탄도 시스템', 'btn-upgrade-terran-advanceballistics'],
  ['신경 기생충', 'btn-ability-zerg-neuralparasite-color'],
  ['음이온파 수정', 'btn-upgrade-protoss-phoenixrange'],
  ['구조 불안정장치', 'Tectonic_Destabilizers'],
  // The only Seismic Spines art in the pack is Kerrigan's co-op version. Same
  // upgrade, same name — unlike 궤도 사령부, standing it in misleads nobody.
  ['진동 가시뼈', 'btn-upgrade-kerrigan-seismicspines'],
  // Dark Templar blink: 'stealth-blink' is the Shadow Stride art, not 점멸's.
  ['그림자 걸음', 'btn-ability-protoss-stealth-blink'],
  // The pack predates the Cyclone research being renamed to Mag-Field
  // Accelerator; the art is the same tech lab upgrade either way.
  ['자기장 가속기', 'btn-upgrade-terran-cyclonerangeupgrade'],

  // Zerg upgrade levels
  ['근접 공격 2단계', 'btn-upgrade-zerg-meleeattacks-level2'],
  ['근접 공격 3단계', 'btn-upgrade-zerg-meleeattacks-level3'],
  ['발사 공격 2단계', 'btn-upgrade-zerg-missileattacks-level2'],
  ['발사 공격 3단계', 'btn-upgrade-zerg-missileattacks-level3'],
  ['지상 갑피 2단계', 'btn-upgrade-zerg-groundcarapace-level2'],
  ['지상 갑피 3단계', 'btn-upgrade-zerg-groundcarapace-level3'],
  ['비행체 공격 2단계', 'btn-upgrade-zerg-airattacks-level2'],
  ['비행체 공격 3단계', 'btn-upgrade-zerg-airattacks-level3'],
  ['비행체 갑피 2단계', 'btn-upgrade-zerg-flyercarapace-level2'],
  ['비행체 갑피 3단계', 'btn-upgrade-zerg-flyercarapace-level3'],
  // Zerg builds usually write 갑피 without 지상; the ground one is meant.
  ['갑피 1단계', 'btn-upgrade-zerg-groundcarapace-level1'],
  ['갑피 2단계', 'btn-upgrade-zerg-groundcarapace-level2'],
  ['갑피 3단계', 'btn-upgrade-zerg-groundcarapace-level3'],

  // Protoss upgrade levels
  ['지상 무기 2단계', 'btn-upgrade-protoss-groundweaponslevel2'],
  ['지상 무기 3단계', 'btn-upgrade-protoss-groundweaponslevel3'],
  ['지상 장갑 2단계', 'btn-upgrade-protoss-groundarmorlevel2'],
  ['지상 장갑 3단계', 'btn-upgrade-protoss-groundarmorlevel3'],
  ['공중 무기 2단계', 'btn-upgrade-protoss-airweaponslevel2'],
  ['공중 무기 3단계', 'btn-upgrade-protoss-airweaponslevel3'],
  ['공중 장갑 1단계', 'btn-upgrade-protoss-airarmorlevel1'],
  ['공중 장갑 2단계', 'btn-upgrade-protoss-airarmorlevel2'],
  ['공중 장갑 3단계', 'btn-upgrade-protoss-airarmorlevel3'],
  ['보호막 1단계', 'btn-upgrade-protoss-shieldslevel1'],
  ['보호막 2단계', 'btn-upgrade-protoss-shieldslevel2'],
  ['보호막 3단계', 'btn-upgrade-protoss-shieldslevel3'],
];

const RACES = ['terran', 'zerg', 'protoss'];
const KINDS = ['building', 'unit', 'research', 'upgrade', 'ability', 'techupgrade'];

function get(url, binary) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'sc2-build-overlay-icon-fetch' } },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return get(res.headers.location, binary).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} — ${url}`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          resolve(binary ? buf : buf.toString('utf8'));
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error(`시간 초과 — ${url}`)));
  });
}

/** PNG dimensions, so a source that quietly served an error page is caught. */
function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function main() {
  console.log(`아이콘 목록 조회: ${REPO}@${REF}`);
  const tree = JSON.parse(await get(TREE, false)).tree;
  const available = new Set(
    tree
      .map((n) => n.path)
      .filter((p) => p.startsWith(DIR + '/') && p.endsWith('.png'))
      .map((p) => p.slice(DIR.length + 1, -'.png'.length))
  );
  console.log(`  원본 아이콘 ${available.size}개`);

  // Korean term -> icon base name. Terms come from the same dictionary the
  // build files and the importer use, so anything writable is lookupable.
  const terms = {};
  const missing = [];

  const resolve = (key) => {
    if (ALIASES[key]) return available.has(ALIASES[key]) ? ALIASES[key] : null;
    const low = key.toLowerCase();
    for (const kind of KINDS) {
      for (const race of RACES) {
        const name = `btn-${kind}-${race}-${low}`;
        if (available.has(name)) return name;
      }
    }
    for (const kind of KINDS) {
      const name = `btn-${kind}-${low}`;
      if (available.has(name)) return name;
    }
    return null;
  };

  for (const [key, korean] of Object.entries(TERMS)) {
    const base = resolve(key);
    if (base) terms[korean] = base;
    else missing.push({ key, korean });
  }
  for (const [korean, base] of EXTRA_TERMS) {
    if (available.has(base)) terms[korean] = base;
    else missing.push({ key: korean, korean });
  }

  // A dictionary key can miss the filename pattern and still be covered, because
  // EXTRA_TERMS maps the same Korean term by hand. Reporting those as missing
  // would send someone looking for icons that are already there.
  const stillMissing = missing.filter((m) => !terms[m.korean]);

  const needed = [...new Set(Object.values(terms))];
  console.log(`  한글 용어 ${Object.keys(terms).length}개 -> 이미지 ${needed.length}개`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  let downloaded = 0;
  let reused = 0;
  const sizes = {};
  for (const base of needed) {
    const dest = path.join(OUT_DIR, base + '.png');
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      reused += 1;
      continue;
    }
    const buf = await get(RAW + encodeURIComponent(base) + '.png', true);
    const size = pngSize(buf);
    if (!size) throw new Error(`PNG 가 아닙니다: ${base}`);
    sizes[`${size.width}x${size.height}`] = (sizes[`${size.width}x${size.height}`] || 0) + 1;
    fs.writeFileSync(dest, buf);
    downloaded += 1;
    if (downloaded % 25 === 0) console.log(`  ${downloaded}/${needed.length}`);
  }
  console.log(`  내려받음 ${downloaded}개, 이미 있던 것 ${reused}개`);
  if (Object.keys(sizes).length) console.log(`  크기: ${JSON.stringify(sizes)}`);

  const manifest = {
    source: `https://github.com/${REPO} (${REF}/${DIR})`,
    note: '코드는 MIT. 아이콘 그림은 Blizzard Entertainment 저작물이며 개인·비상업 용도로만 사용합니다.',
    generated: new Date().toISOString().slice(0, 10),
    terms,
  };
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`매니페스트: ${path.relative(process.cwd(), MANIFEST)}`);

  if (stillMissing.length) {
    console.log(`\n아이콘 없는 용어 ${stillMissing.length}개 (오버레이에서 글자만 표시됩니다):`);
    stillMissing.forEach((m) => console.log(`  ${m.korean}`));
  } else {
    console.log('\n사전의 모든 용어에 아이콘이 있습니다.');
  }
}

main().catch((err) => {
  console.error('실패:', err.message);
  process.exit(1);
});
