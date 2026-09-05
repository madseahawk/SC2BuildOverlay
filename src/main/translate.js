'use strict';

/**
 * English internal names (as used by build-order sites' exports) to the
 * official Korean SC2 terms. The vocabulary matches what the hand-written
 * builds in `builds/` already use, so imported builds read the same as ones
 * written by hand.
 *
 * Anything missing is reported rather than silently passed through: a build
 * that is half-translated without saying so is worse than one that is not.
 */

const TERMS = {
  // ---------------------------------------------------------------- Terran
  CommandCenter: '사령부',
  OrbitalCommand: '궤도 사령부',
  PlanetaryFortress: '행성 요새',
  SupplyDepot: '보급고',
  Refinery: '정제소',
  Barracks: '병영',
  EngineeringBay: '공학 연구소',
  Bunker: '벙커',
  MissileTurret: '미사일 포탑',
  SensorTower: '감지탑',
  Factory: '군수공장',
  GhostAcademy: '유령 사관학교',
  Armory: '무기고',
  Starport: '우주공항',
  FusionCore: '융합로',
  TechLab: '기술실',
  Reactor: '반응로',

  SCV: '건설로봇',
  MULE: '지게로봇',
  Marine: '해병',
  Marauder: '불곰',
  Reaper: '사신',
  Ghost: '유령',
  Hellion: '화염차',
  HellionTank: '화염기갑병',
  Hellbat: '화염기갑병',
  WidowMine: '땅거미 지뢰',
  SiegeTank: '공성 전차',
  Cyclone: '사이클론',
  Thor: '토르',
  Viking: '바이킹',
  Medivac: '의료선',
  Liberator: '해방선',
  Raven: '밤까마귀',
  Banshee: '밴시',
  Battlecruiser: '전투순양함',

  Stimpack: '전투 자극제',
  CombatShield: '전투 방패',
  ConcussiveShells: '충격탄',
  InfantryWeapons1: '보병 무기 1단계',
  InfantryWeapons2: '보병 무기 2단계',
  InfantryWeapons3: '보병 무기 3단계',
  InfantryArmor1: '보병 장갑 1단계',
  InfantryArmor2: '보병 장갑 2단계',
  InfantryArmor3: '보병 장갑 3단계',
  VehicleWeapons1: '차량 무기 1단계',
  VehicleWeapons2: '차량 무기 2단계',
  VehicleWeapons3: '차량 무기 3단계',
  VehicleAndShipPlating1: '차량 및 우주선 장갑 1단계',
  VehicleAndShipPlating2: '차량 및 우주선 장갑 2단계',
  VehicleAndShipPlating3: '차량 및 우주선 장갑 3단계',
  VehicleAndShipArmor1: '차량 및 우주선 장갑 1단계',
  VehicleAndShipArmor2: '차량 및 우주선 장갑 2단계',
  VehicleAndShipArmor3: '차량 및 우주선 장갑 3단계',
  ShipWeapons1: '우주선 무기 1단계',
  ShipWeapons2: '우주선 무기 2단계',
  ShipWeapons3: '우주선 무기 3단계',
  HiSecAutoTracking: '정밀 보안 자동추적기',
  BuildingArmor: '신소재 강철 장갑',
  NeosteelArmor: '신소재 강철 장갑',
  CloakingField: '은폐장',
  BansheeSpeed: '초비행 회전날개',
  DrillingClaws: '천공 발톱',
  SmartServos: '지능형 제어 장치',
  InfernalPreigniter: '지옥불 조기점화기',
  YamatoCannon: '무기 재장비',
  PersonalCloaking: '개인 은폐',
  MagFieldAccelerator: '자기장 가속기',
  InterferenceMatrix: '방해 매트릭스',
  CaduceusReactor: '카두세우스 반응로',
  AdvancedBallistics: '첨단 탄도 시스템',

  // ---------------------------------------------------------------- Zerg
  Hatchery: '부화장',
  Lair: '번식지',
  Hive: '군락',
  Extractor: '추출장',
  SpawningPool: '산란못',
  EvolutionChamber: '진화장',
  SpineCrawler: '가시 촉수',
  SporeCrawler: '포자 촉수',
  RoachWarren: '바퀴 소굴',
  BanelingNest: '맹독충 둥지',
  HydraliskDen: '히드라리스크 굴',
  LurkerDen: '가시지옥 굴',
  InfestationPit: '감염 구덩이',
  Spire: '둥지탑',
  GreaterSpire: '거대 둥지탑',
  NydusNetwork: '땅굴망',
  UltraliskCavern: '울트라리스크 동굴',
  CreepTumor: '점막 종양',

  Larva: '애벌레',
  Drone: '일벌레',
  Overlord: '대군주',
  Overseer: '감시 군주',
  Queen: '여왕',
  Zergling: '저글링',
  Baneling: '맹독충',
  Roach: '바퀴',
  Ravager: '궤멸충',
  Hydralisk: '히드라리스크',
  Lurker: '가시지옥',
  Infestor: '감염충',
  SwarmHost: '군단 숙주',
  Mutalisk: '뮤탈리스크',
  Corruptor: '타락귀',
  BroodLord: '무리 군주',
  Viper: '살모사',
  Ultralisk: '울트라리스크',

  MetabolicBoost: '대사 촉진',
  AdrenalGlands: '아드레날린 분비선',
  CentrifugalHooks: '원심 고리',
  GlialReconstitution: '신경 재구성',
  TunnelingClaws: '땅굴 발톱',
  GroovedSpines: '가시 홈',
  MuscularAugments: '근육 보강',
  Burrow: '잠복',
  PneumatizedCarapace: '기낭 갑피',
  ChitinousPlating: '키틴질 장갑',
  AnabolicSynthesis: '합성 동화 작용',
  AdaptiveTalons: '적응형 발톱',
  SeismicSpines: '진동 가시뼈',
  NeuralParasite: '신경 기생충',
  MeleeAttacks1: '근접 공격 1단계',
  MeleeAttacks2: '근접 공격 2단계',
  MeleeAttacks3: '근접 공격 3단계',
  MissileAttacks1: '발사 공격 1단계',
  MissileAttacks2: '발사 공격 2단계',
  MissileAttacks3: '발사 공격 3단계',
  GroundCarapace1: '지상 갑피 1단계',
  GroundCarapace2: '지상 갑피 2단계',
  GroundCarapace3: '지상 갑피 3단계',
  FlyerAttacks1: '비행체 공격 1단계',
  FlyerAttacks2: '비행체 공격 2단계',
  FlyerAttacks3: '비행체 공격 3단계',
  FlyerCarapace1: '비행체 갑피 1단계',
  FlyerCarapace2: '비행체 갑피 2단계',
  FlyerCarapace3: '비행체 갑피 3단계',

  // ---------------------------------------------------------------- Protoss
  Nexus: '연결체',
  Pylon: '수정탑',
  Assimilator: '융화소',
  Gateway: '관문',
  WarpGate: '차원 관문',
  Forge: '제련소',
  PhotonCannon: '광자포',
  ShieldBattery: '보호막 충전소',
  CyberneticsCore: '인공제어소',
  RoboticsFacility: '로봇공학 시설',
  RoboticsBay: '로봇공학 지원소',
  Stargate: '우주관문',
  FleetBeacon: '함대 신호소',
  TwilightCouncil: '황혼 의회',
  TemplarArchives: '기사단 기록보관소',
  DarkShrine: '암흑 성소',

  Probe: '탐사정',
  Zealot: '광전사',
  Stalker: '추적자',
  Sentry: '파수기',
  Adept: '사도',
  HighTemplar: '고위 기사',
  DarkTemplar: '암흑 기사',
  Archon: '집정관',
  Immortal: '불멸자',
  Colossus: '거신',
  Disruptor: '분열기',
  Observer: '관측선',
  WarpPrism: '차원 분광기',
  Phoenix: '불사조',
  VoidRay: '공허 포격기',
  Oracle: '예언자',
  Tempest: '폭풍함',
  Carrier: '우주모함',
  Mothership: '모선',

  WarpGateResearch: '차원 관문 연구',
  Charge: '돌진',
  Blink: '점멸',
  ResonatingGlaives: '공명 파열포',
  PsiStorm: '사이오닉 폭풍',
  GraviticBoosters: '중력 가속',
  GraviticDrive: '중력 구동',
  ExtendedThermalLance: '열 광선 사거리',
  ShadowStride: '그림자 걸음',
  AnionPulseCrystals: '음이온파 수정',
  FluxVanes: '유동성 추진기',
  TectonicDestabilizers: '구조 불안정장치',
  AirWeapons1: '공중 무기 1단계',
  AirWeapons2: '공중 무기 2단계',
  AirWeapons3: '공중 무기 3단계',
  GroundWeapons1: '지상 무기 1단계',
  GroundWeapons2: '지상 무기 2단계',
  GroundWeapons3: '지상 무기 3단계',
  AirArmor1: '공중 장갑 1단계',
  AirArmor2: '공중 장갑 2단계',
  AirArmor3: '공중 장갑 3단계',
  GroundArmor1: '지상 장갑 1단계',
  GroundArmor2: '지상 장갑 2단계',
  GroundArmor3: '지상 장갑 3단계',
  ShieldsLevel1: '보호막 1단계',
  ShieldsLevel2: '보호막 2단계',
  ShieldsLevel3: '보호막 3단계',
};

/** Buildings whose add-on name is composed, e.g. Barracks + TechLab. */
const ADDONS = new Set(['TechLab', 'Reactor']);

const RACES = { Terran: 'T', Zerg: 'Z', Protoss: 'P', Random: 'R' };

/** `TvZ` → { race: 'T', vs: 'Z' } */
function parseMatchup(matchup) {
  const m = /^([TZPR])v([TZPR])$/i.exec(String(matchup || '').trim());
  if (!m) return null;
  return { race: m[1].toUpperCase(), vs: m[2].toUpperCase() };
}

function raceCode(race) {
  return RACES[race] || (race && RACES[race[0].toUpperCase() + race.slice(1).toLowerCase()]) || null;
}

/**
 * Upgrade keys come through race-prefixed in some exports, because that is how
 * the game names them internally: `ZergMissileAttacks1` for what the dictionary
 * has as `MissileAttacks1`. The suffixes are already race-unique (Terran has
 * 보병 무기, Protoss 지상 무기, Zerg 근접/발사 공격), so dropping the prefix
 * cannot land on another race's upgrade.
 *
 * Only reached when the whole key missed, so `Zergling` is never mangled into
 * `ling` — and a key that stays unknown is still reported under its original
 * spelling.
 */
const RACE_PREFIX = /^(Terran|Zerg|Protoss)(?=[A-Z])/;

function lookup(key) {
  if (TERMS[key]) return TERMS[key];
  const stripped = key.replace(RACE_PREFIX, '');
  return stripped === key ? undefined : TERMS[stripped];
}

/**
 * Translates one step key. `parentKey` is the building an add-on attaches to,
 * so a bare `TechLab` becomes 병영 기술실 rather than a nameless 기술실.
 *
 * Returns { text, missing } — `missing` lists keys with no Korean term, which
 * the caller is expected to surface rather than swallow.
 */
function translateKey(key, parentKey) {
  const missing = [];
  const term = lookup(key);
  if (!term) missing.push(key);

  if (ADDONS.has(key) && parentKey) {
    const parent = lookup(parentKey);
    if (!parent) missing.push(parentKey);
    if (parent && term) return { text: `${parent} ${term}`, missing };
  }

  return { text: term || key, missing };
}

module.exports = { TERMS, ADDONS, translateKey, parseMatchup, raceCode };
