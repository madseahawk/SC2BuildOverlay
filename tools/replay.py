"""SC2 replay -> this app's build-order format.

Every step carries the time production *started*, never the time it finished.
That is what a build order is for: at 2:20 you press the button, and the unit
turns up whenever it turns up.

Where each time comes from:

- Buildings, and units warped in: `SUnitInitEvent` is the moment it was placed
  or the warp began. Already the press.
- Trained units: the tracker only records the birth. The press is in
  `replay.game.events`, but commands there name their ability by a numeric id
  that no decoder ships a table for, so the id is *derived*: an ability used N
  times is followed by N units of one kind after a consistent gap, and the
  shortest of those gaps is the build time. Derived beats tabulated when it
  works, because it sees the Chrono Boost that was actually used.
- Everything the derivation cannot pin down — a unit built once, every research
  — falls back to BUILD_TIME / RESEARCH_TIME below.

The report says which of the two produced each number, so a wrong table entry
is visible rather than silently believed.
"""
import argparse
import collections
import glob
import html
import io
import json
import os
import re
import statistics
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import impshim  # noqa: F401  (installs the `imp` stand-in s2protocol needs)

try:
    from mpyq import MPQArchive
    from s2protocol import versions
except ImportError:
    raise SystemExit('\n'.join([
        '리플레이를 읽는 데 필요한 것이 없습니다. 아래 두 줄을 실행하세요:',
        r'  python -m venv .venv-replay',
        r'  .venv-replay\Scripts\python.exe -m pip install -r tools\replay-requirements.txt',
        r'그 다음부터는 python 이 아니라 .venv-replay\Scripts\python.exe 로 이 스크립트를 실행합니다.',
    ]))

LOOPS = 22.4  # Legacy of the Void, 'Faster'
FOOD_SCALE = 4096

MIN_GAP, MAX_GAP = 4 * LOOPS, 110 * LOOPS
MAX_SPREAD = 15 * LOOPS
MAX_BUILD = 90 * LOOPS
# A derived build time this far from the table is a mis-match, not a Chrono
# Boost. Chrono takes a third off; nothing doubles a build time.
DERIVED_TOLERANCE = 0.55
# Fewer instances than this and any ability used nearby appears to fit.
MIN_TRUSTED = 3

WORKERS = {'Probe', 'SCV', 'Drone'}

NOISE = re.compile(
    r'^(Beacon|LabMineralField|MineralField|RichMineralField|VespeneGeyser|'
    r'RichVespeneGeyser|XelNaga|AdeptPhaseShift|Interceptor|Locust|Broodling|'
    r'Changeling|.*Cocoon|.*Egg|Larva|KD8Charge|AutoTurret|ForceField|'
    r'DisruptorPhased|OracleStasisTrap|CreepTumor|PurificationNova|'
    r'ParasiticBombDummy|InfestedTerran|MULE|PointDefenseDrone|'
    r'RavenScramblerMissile|RavenRepairDrone)')
NOISE_UPGRADE = re.compile(r'(Reward|Spray|GameHeart|Dance|Emote)')

RACE_CODE = {'프로토스': 'P', '테란': 'T', '저그': 'Z',
             'Protoss': 'P', 'Terran': 'T', 'Zerg': 'Z'}

# Seconds at normal speed. Only reached when the replay itself cannot say — a
# unit built once, or a research, which happens once and so gives the matcher
# nothing to lock onto. Where both exist the two agree (Stalker 27, Sentry 23),
# which is the check that these numbers are right.
BUILD_TIME = {
    # Protoss
    'Probe': 12, 'Zealot': 27, 'Stalker': 27, 'Sentry': 23, 'Adept': 27,
    'HighTemplar': 39, 'DarkTemplar': 39, 'Archon': 9, 'Observer': 21,
    'WarpPrism': 36, 'Immortal': 39, 'Colossus': 54, 'Disruptor': 36,
    'Phoenix': 25, 'VoidRay': 43, 'Oracle': 37, 'Tempest': 43, 'Carrier': 64,
    'Mothership': 89,
    # Terran
    'SCV': 12, 'Marine': 18, 'Marauder': 21, 'Reaper': 32, 'Ghost': 29,
    'Hellion': 21, 'HellionTank': 21, 'WidowMine': 21, 'SiegeTank': 32,
    'Cyclone': 32, 'Thor': 43, 'VikingFighter': 30, 'Medivac': 30,
    'Liberator': 43, 'Raven': 34, 'Banshee': 43, 'Battlecruiser': 64,
    # Zerg
    'Drone': 12, 'Overlord': 18, 'Queen': 36, 'Zergling': 17, 'Baneling': 14,
    'Roach': 19, 'Ravager': 9, 'Hydralisk': 24, 'Lurker': 18, 'Infestor': 29,
    'SwarmHostMP': 29, 'Mutalisk': 24, 'Corruptor': 29, 'BroodLord': 24,
    'Viper': 29, 'Ultralisk': 39, 'Overseer': 12,
}

# Research times in seconds at normal speed, keyed the way normalize() files
# them (race prefix and `Level` stripped), so one entry covers every spelling a
# replay might use. Unlike BUILD_TIME these cannot be cross-checked against the
# replay — a research happens once, so there is nothing to derive from — which
# is why a step built on one of these is reported rather than just trusted.
RESEARCH_TIME = {
    # Protoss
    'WarpGate': 100, 'Charge': 100, 'Blink': 121, 'ResonatingGlaives': 100,
    'PsiStorm': 79, 'GraviticBoosters': 57, 'GraviticDrive': 57,
    'ExtendedThermalLance': 100, 'ShadowStride': 100,
    'AnionPulseCrystals': 64, 'FluxVanes': 57, 'TectonicDestabilizers': 100,
    'GroundWeapons1': 129, 'GroundWeapons2': 154, 'GroundWeapons3': 179,
    'GroundArmor1': 129, 'GroundArmor2': 154, 'GroundArmor3': 179,
    'ShieldsLevel1': 129, 'ShieldsLevel2': 154, 'ShieldsLevel3': 179,
    'AirWeapons1': 129, 'AirWeapons2': 154, 'AirWeapons3': 179,
    'AirArmor1': 129, 'AirArmor2': 154, 'AirArmor3': 179,
    # Terran
    'Stimpack': 100, 'CombatShield': 79, 'ConcussiveShells': 43,
    'InfernalPreigniter': 79, 'DrillingClaws': 79, 'SmartServos': 79,
    'MagFieldAccelerator': 79,
    'CloakingField': 79, 'BansheeSpeed': 121,
    'AdvancedBallistics': 79, 'YamatoCannon': 100, 'PersonalCloaking': 100,
    'HiSecAutoTracking': 57, 'BuildingArmor': 100, 'NeosteelArmor': 100,
    'InfantryWeapons1': 114, 'InfantryWeapons2': 136, 'InfantryWeapons3': 157,
    'InfantryArmor1': 114, 'InfantryArmor2': 136, 'InfantryArmor3': 157,
    'VehicleWeapons1': 114, 'VehicleWeapons2': 136, 'VehicleWeapons3': 157,
    'ShipWeapons1': 114, 'ShipWeapons2': 136, 'ShipWeapons3': 157,
    # The dictionary files this one under both names, so both need a time.
    'VehicleAndShipArmor1': 114, 'VehicleAndShipArmor2': 136,
    'VehicleAndShipArmor3': 157,
    'VehicleAndShipPlating1': 114, 'VehicleAndShipPlating2': 136,
    'VehicleAndShipPlating3': 157,
    # Zerg
    'MetabolicBoost': 100, 'AdrenalGlands': 93, 'CentrifugalHooks': 79,
    'GlialReconstitution': 79, 'TunnelingClaws': 79,
    'GroovedSpines': 71, 'MuscularAugments': 71,
    'AdaptiveTalons': 57, 'SeismicSpines': 57,
    'PneumatizedCarapace': 43, 'Burrow': 71,
    'ChitinousPlating': 79, 'AnabolicSynthesis': 79,
    'NeuralParasite': 79,
    'MeleeAttacks1': 114, 'MeleeAttacks2': 136, 'MeleeAttacks3': 157,
    'MissileAttacks1': 114, 'MissileAttacks2': 136, 'MissileAttacks3': 157,
    'GroundCarapace1': 114, 'GroundCarapace2': 136, 'GroundCarapace3': 157,
    'FlyerAttacks1': 114, 'FlyerAttacks2': 136, 'FlyerAttacks3': 157,
    'FlyerCarapace1': 114, 'FlyerCarapace2': 136, 'FlyerCarapace3': 157,
}

ALIASES = {
    # Only names no rule can reach: an internal name that looks nothing like
    # the displayed one. Anything differing by a race prefix, a `Level` before
    # the number, or a building-plus-add-on pairing is handled by normalize().
    # Protoss
    'BlinkTech': 'Blink', 'PsiStormTech': 'PsiStorm',
    'ObserverGraviticBooster': 'GraviticBoosters',
    'DarkTemplarBlinkUpgrade': 'ShadowStride',
    'PhoenixRangeUpgrade': 'AnionPulseCrystals',
    'VoidRaySpeedUpgrade': 'FluxVanes',
    'TempestGroundAttackUpgrade': 'TectonicDestabilizers',
    'AdeptPiercingAttack': 'ResonatingGlaives',
    'WarpGateResearch': 'WarpGate',
    # Terran
    'PunisherGrenades': 'ConcussiveShells',
    'ShieldWall': 'CombatShield',
    'BansheeCloak': 'CloakingField',
    'HighCapacityBarrels': 'InfernalPreigniter',
    'LiberatorAGRangeUpgrade': 'AdvancedBallistics',
    'BattlecruiserEnableSpecializations': 'YamatoCannon',
    'VikingFighter': 'Viking', 'SwarmHostMP': 'SwarmHost',
    # Zerg
    'ZerglingMovementSpeed': 'MetabolicBoost',
    'ZerglingAttackSpeed': 'AdrenalGlands',
    'CentrificalHooks': 'CentrifugalHooks',
    'EvolveGroovedSpines': 'GroovedSpines',
    'EvolveMuscularAugments': 'MuscularAugments',
    'overlordspeed': 'PneumatizedCarapace',
    'anabolicsynthesis': 'AnabolicSynthesis',
    'DiggingClaws': 'AdaptiveTalons',
    'LurkerRange': 'SeismicSpines',
    'InfestorEnergyUpgrade': 'PathogenGlands',
}


def txt(value):
    return value.decode('utf8', 'replace') if isinstance(value, bytes) else value


CLAN_TAG = re.compile(r'<[^>]*>')


def player_name(raw):
    """The name without the clan-tag markup the replay stores it with.

    A name in a clan arrives as '&lt;TAG&gt;<sp/>Name': the clan tag, escaped,
    then a marker standing in for the space, then the name itself.
    """
    return CLAN_TAG.sub(' ', html.unescape(txt(raw))).strip()


def clock(loop):
    total = int(round(loop / LOOPS))
    return '%d:%02d' % (total // 60, total % 60)


def write_lines(path, lines):
    """One place, so the line ending is right once rather than three times.

    Text mode already turns \\n into the platform ending; joining with
    os.linesep on top of that wrote every line as \\r\\r\\n.
    """
    with io.open(path, 'w', encoding='utf-8') as out:
        out.write('\n'.join(lines) + '\n')


def expand(paths):
    """Turns whatever was typed into a list of replay files.

    A folder, or a wildcard, or plain file names. PowerShell hands wildcards
    through unexpanded — unlike a POSIX shell — so the script has to do it, or
    `replay/*.SC2Replay` reaches us as a literal filename and fails to open.
    """
    out = []
    for item in paths:
        if os.path.isdir(item):
            out += sorted(glob.glob(os.path.join(item, '*.SC2Replay')))
        elif any(c in item for c in '*?['):
            out += sorted(glob.glob(item))
        else:
            out.append(item)
    if not out:
        raise SystemExit('리플레이 파일을 찾지 못했습니다: %s' % ' '.join(paths))
    return out


def load_terms(repo):
    path = os.path.join(repo, 'src', 'main', 'translate.js')
    text = io.open(path, encoding='utf-8').read()
    start = text.index('const TERMS = {')
    return dict(re.findall(r"^\s{2}(\w+):\s*'([^']+)'",
                           text[start:text.index('\n};', start)], re.M))


def load_buildings(repo):
    """The Korean terms that name a building.

    Only needed to count them: buildings go 2개, units go 2기. The icon
    manifest already sorts the two — its asset names are btn-building-* and
    btn-unit-* — so there is no second list here to fall out of step with it.
    """
    path = os.path.join(repo, 'assets', 'icons', 'manifest.json')
    try:
        terms = json.load(io.open(path, encoding='utf-8'))['terms']
    except (IOError, OSError, ValueError, KeyError):
        return set()
    return {korean for korean, asset in terms.items() if '-building-' in asset}


def decoder_for(base_build):
    """The decoder for this game build, or the newest one we have.

    s2protocol ships one generated decoder per game build, so a replay from a
    patch newer than the installed s2protocol has none and raises ImportError.
    Falling back to the newest is nearly always right — the event streams this
    reads change rarely, and far less often than the build number does — and it
    beats refusing to open the replay at all. The fallback is reported, so a
    build that came out wrong has somewhere to point.

    @returns (module, the build actually used, or None when it was an exact match)
    """
    try:
        return versions.build(base_build), None
    except (ImportError, KeyError, AttributeError):
        newest = versions.latest()
        used = newest.__name__.rsplit('.', 1)[-1].replace('protocol', '')
        return newest, used or 'latest'


class Replay(object):
    def __init__(self, path):
        self.path = path
        archive = MPQArchive(path)
        self.header = versions.latest().decode_replay_header(
            archive.header['user_data_header']['content'])
        proto, self.fell_back_to = decoder_for(self.header['m_version']['m_baseBuild'])
        self.details = proto.decode_replay_details(archive.read_file('replay.details'))
        self.tracker = list(proto.decode_replay_tracker_events(
            archive.read_file('replay.tracker.events')))
        self.game = list(proto.decode_replay_game_events(
            archive.read_file('replay.game.events')))

    @property
    def version(self):
        v = self.header['m_version']
        return '%d.%d.%d.%d' % (v['m_major'], v['m_minor'], v['m_revision'], v['m_build'])

    @property
    def seconds(self):
        return self.header['m_elapsedGameLoops'] / LOOPS

    def players(self):
        """One row per player, with the ids needed to read their events.

        `SPlayerSetupEvent` is what ties a tracker player to the user whose
        commands appear in the game events; guessing that link from the order of
        the lists happens to work in a game against the AI and breaks the moment
        both sides are human.
        """
        users = {}
        for event in self.tracker:
            if event['_event'].endswith('SPlayerSetupEvent'):
                users[event['m_playerId']] = event.get('m_userId')
        out = []
        for index, player in enumerate(self.details['m_playerList'], start=1):
            out.append({
                'id': index,
                'user': users.get(index),
                'name': player_name(player['m_name']),
                'race': txt(player['m_race']),
                'human': player.get('m_control') == 2,
                'won': player['m_result'] == 1,
            })
        return out


def train_commands(replay, user):
    out = {}
    if user is None:
        return out
    for event in replay.game:
        if not event['_event'].endswith('SCmdEvent'):
            continue
        if (event.get('_userid') or {}).get('m_userId') != user:
            continue
        ability = event.get('m_abil')
        if not ability or ability.get('m_abilLink') is None:
            continue
        out.setdefault((ability['m_abilLink'], ability.get('m_abilCmdIndex')),
                       []).append(event['_gameloop'])
    for loops in out.values():
        loops.sort()
    return out


def pair(cmd_loops, born_loops):
    """Match births to commands the way a production queue does: first in, first
    out. Pairing a birth with the *nearest* preceding command instead makes the
    gaps meaningless, since that is whatever was ordered last.

    @returns (spread, build_time, count) or None.
    """
    if len(cmd_loops) < len(born_loops) or not born_loops:
        return None
    gaps = []
    at = 0
    for born in sorted(born_loops):
        while at < len(cmd_loops) and (cmd_loops[at] >= born
                                       or born - cmd_loops[at] > MAX_GAP):
            at += 1
        if at >= len(cmd_loops):
            return None
        gap = born - cmd_loops[at]
        if gap < MIN_GAP:
            return None
        gaps.append(gap)
        at += 1
    spread = statistics.pstdev(gaps) if len(gaps) > 1 else 0.0
    if spread > MAX_SPREAD:
        return None
    # The shortest gap waited for nothing ahead of it: that is the build time.
    return spread, min(gaps), len(gaps)


def births(replay, player):
    out = {}
    for event in replay.tracker:
        if not event['_event'].endswith('SUnitBornEvent'):
            continue
        if event.get('m_controlPlayerId') != player['id'] or event['_gameloop'] == 0:
            continue
        name = txt(event['m_unitTypeName'])
        if not NOISE.match(name):
            out.setdefault(name, []).append(event['_gameloop'])
    return out


def derive_build_times(replays_and_players):
    """Build times read off the replays, one ability to one unit.

    Decided over every replay at once. Inside a single replay the ability that
    trains Probes has enough commands to also 'explain' the Zealots, and the
    leftover gaps pass for a 70-second build time — which put Stalkers on the
    timeline ahead of the Cybernetics Core that allows them.
    """
    pooled = collections.defaultdict(list)
    for replay, player in replays_and_players:
        commands = train_commands(replay, player['user'])
        for name, loops in births(replay, player).items():
            for key, cmd_loops in commands.items():
                got = pair(cmd_loops, loops)
                if got and got[1] <= MAX_BUILD:
                    pooled[(name, key)].append(got)

    ranked = []
    for (name, key), rows in pooled.items():
        builds = [r[1] for r in rows]
        ranked.append({
            'unit': name, 'ability': key, 'replays': len(rows),
            'spread': statistics.mean(r[0] for r in rows),
            'build': statistics.median(builds),
            'drift': (max(builds) - min(builds)) if len(builds) > 1 else 0.0,
            'count': sum(r[2] for r in rows),
        })
    ranked.sort(key=lambda r: (-r['replays'], r['drift'], r['spread']))

    chosen = {}
    used = set()
    for row in ranked:
        if row['unit'] in chosen or row['ability'] in used:
            continue
        if row['count'] < MIN_TRUSTED:
            continue
        table = BUILD_TIME.get(row['unit'])
        if table:
            ratio = (row['build'] / LOOPS) / table
            # Chrono Boost shortens; nothing lengthens a build time, and a
            # doubled one means the ability was not the right one.
            if not (DERIVED_TOLERANCE <= ratio <= 1.25):
                continue
        chosen[row['unit']] = row
        used.add(row['ability'])
    return chosen


def build_time(name, derived):
    """(loops, source) — the replay's own number when it earned trust."""
    if name in derived:
        return derived[name]['build'], 'derived'
    table = in_table(BUILD_TIME, name)
    if table:
        return table * LOOPS, 'table'
    return 0, 'unknown'


def research_time(name):
    table = in_table(RESEARCH_TIME, name)
    return (table * LOOPS, 'table') if table else (0, 'unknown')


def supply_curve(replay, player):
    out = []
    for event in replay.tracker:
        if event['_event'].endswith('SPlayerStatsEvent') and event['m_playerId'] == player['id']:
            used = (event.get('m_stats') or {}).get('m_scoreValueFoodUsed')
            if used is not None:
                out.append((event['_gameloop'], used // FOOD_SCALE))
    return out


def supply_at(curve, loop):
    """Supply at that moment, from the periodic stats samples.

    A step can land before the first sample — a build time subtracted off an
    early unit clamps to 0:00 — and there the first sample is the answer, since
    nothing has been built yet and supply is still what the game started with.
    Returning nothing instead dropped the `@N` from exactly the first step.
    """
    if not curve:
        return None
    found = curve[0][1]
    for at, value in curve:
        if at > loop:
            break
        found = value
    return found


def collapse(steps):
    """One line per decision. Workers run all game, so they become one line."""
    out = []
    seen = set()
    index = 0
    while index < len(steps):
        step = steps[index]
        if step['name'] in WORKERS and step['kind'] == 'unit':
            if step['name'] not in seen:
                seen.add(step['name'])
                out.append(dict(step, count=1, filler=True))
            index += 1
            continue
        count = 1
        while (index + count < len(steps)
               and steps[index + count]['name'] == step['name']
               and steps[index + count]['loop'] - step['loop'] <= 12 * LOOPS):
            count += 1
        out.append(dict(step, count=count, filler=False))
        index += count
    return out


RACE_PREFIX = re.compile(r'^(Terran|Zerg|Protoss)(?=[A-Z])')
LEVEL_SUFFIX = re.compile(r'Level(\d)$')
ADDON = re.compile(r'^(\w+?)(TechLab|Reactor)$')


def normalize(name):
    """The spellings a replay's name might be filed under, best first.

    Replays and the rest of the app spell the same thing differently often
    enough that listing every pair by hand guarantees gaps — the first Terran
    replay turned up eleven missing names and nine missing times. So the
    differences that follow a rule are rules, and ALIASES holds only the
    genuinely irregular ones.

    The rules: an alias; a race prefix (`TerranInfantryWeaponsLevel1`); a
    `Level` before the number (`...WeaponsLevel1` vs `...Weapons1`); and those
    combined. Yielded rather than resolved, so one walk serves the Korean
    dictionary and both time tables.
    """
    # A function, not a backreference: a replacement string of one backslash
    # and a 1 is a transcription slip away from the control character it
    # resembles, and it silently produced 'GroundWeapons\x01' once already.
    def drop_level(word):
        return LEVEL_SUFFIX.sub(lambda m: m.group(1), word)

    stem = ALIASES.get(name, name)
    plain = RACE_PREFIX.sub('', stem)
    flat = drop_level(plain)

    # 'ProtossGroundArmorsLevel1' -> 'GroundArmor1'. The replay pluralises the
    # thing being upgraded, the dictionary does not, and the difference sits
    # behind the number rather than at the end where it could just be stripped.
    singular = None
    if flat[-1:].isdigit() and flat[-2:-1] == 's':
        singular = flat[:-2] + flat[-1]

    # Zerg names the same upgrades differently: armour is 갑피 (carapace) and
    # attack is 공격 (attacks), where the other two races say 장갑 and 무기. Both
    # `ProtossGroundArmorsLevel1` and `ZergGroundArmorsLevel1` strip to the same
    # word, so the race cannot be dropped before this is applied — and Zerg is
    # the race that renames, so Zerg carries the rule.
    zergish = None
    if name.startswith('Zerg') and flat[-1:].isdigit():
        head, level = flat[:-1], flat[-1]
        for was, becomes in (('Armors', 'Carapace'), ('Armor', 'Carapace'),
                             ('Weapons', 'Attacks'), ('Weapon', 'Attacks')):
            if head.endswith(was):
                zergish = head[:-len(was)] + becomes + level
                break

    # Same shape, but where the singular is itself irregular.
    numbered = None
    if flat[-1:].isdigit() and flat[:-1] in ALIASES:
        numbered = ALIASES[flat[:-1]] + flat[-1:]

    seen = set()
    for candidate in (name, stem, zergish, plain, flat, singular, numbered,
                      ALIASES.get(plain), ALIASES.get(flat),
                      drop_level(ALIASES.get(plain, plain))):
        if candidate and candidate not in seen:
            seen.add(candidate)
            yield candidate



def in_table(table, name):
    """The table's value for a replay's name, under any of its spellings."""
    for candidate in normalize(name):
        if candidate in table:
            return table[candidate]
    return None


def korean_for(name, terms):
    """The dictionary's word for a replay's name, or None."""
    found = in_table(terms, name)
    if found:
        return found

    # `BarracksTechLab` -> 병영 + 기술실. The dictionary keeps the building and
    # the add-on apart, because that is how the two are named in game.
    addon = ADDON.match(ALIASES.get(name, name))
    if addon and addon.group(1) in terms and addon.group(2) in terms:
        return '%s %s' % (terms[addon.group(1)], terms[addon.group(2)])
    return None


def steps_for(replay, player, derived):
    """Every step, timed at the moment it was started."""
    steps = []
    unknown = set()

    for event in replay.tracker:
        kind = event['_event'].rsplit('.', 1)[-1]
        loop = event['_gameloop']
        if kind == 'SUnitInitEvent' and event.get('m_controlPlayerId') == player['id']:
            name = txt(event['m_unitTypeName'])
            if not NOISE.match(name):
                # Placement, or the start of a warp-in. Already the press.
                steps.append({'loop': loop, 'name': name, 'kind': 'built',
                              'source': 'event'})
        elif kind == 'SUpgradeEvent' and event['m_playerId'] == player['id']:
            name = txt(event['m_upgradeTypeName'])
            if loop > 0 and not NOISE_UPGRADE.search(name):
                span, source = research_time(name)
                if source == 'unknown':
                    unknown.add(name)
                steps.append({'loop': max(0, loop - span), 'name': name,
                              'kind': 'upgrade', 'source': source})

    for name, loops in births(replay, player).items():
        span, source = build_time(name, derived)
        if source == 'unknown':
            unknown.add(name)
        for loop in loops:
            steps.append({'loop': max(0, loop - span), 'name': name,
                          'kind': 'unit', 'source': source})

    steps.sort(key=lambda s: s['loop'])
    return steps, unknown



def label(step, terms, buildings, missing):
    korean = korean_for(step['name'], terms)
    if korean is None:
        missing.add(step['name'])
        korean = step['name']
    if step.get('filler'):
        return '%s 계속 생산' % korean
    if step['count'] > 1:
        return '%s %d%s' % (korean, step['count'],
                            '개' if korean in buildings else '기')
    return korean


def build_text(replay, player, derived, terms, buildings, limit=None):
    """The build file's text, plus what went into it.

    @returns (lines, step count, {time source: n}, unknown names, no-build-time names)
    """
    steps, unknown = steps_for(replay, player, derived)
    if limit:
        steps = [s for s in steps if s['loop'] <= limit]
    rows = collapse(steps)
    curve = supply_curve(replay, player)

    missing = set()
    opponents = [p for p in replay.players() if p['id'] != player['id']]
    lines = [
        'name: %s' % os.path.splitext(os.path.basename(replay.path))[0],
        'race: %s' % RACE_CODE.get(player['race'], '?'),
        'vs: %s' % (RACE_CODE.get(opponents[0]['race'], '*') if opponents else '*'),
        'notes: 리플레이 추출 · SC2 %s · %s · %s · %d:%02d' % (
            replay.version, txt(replay.details['m_title']), player['name'],
            replay.seconds // 60, replay.seconds % 60),
        '',
    ]
    for step in rows:
        food = supply_at(curve, step['loop'])
        lines.append(('%s %s %s' % (
            clock(step['loop']).ljust(5),
            ('@%d' % food if food is not None else '').ljust(4),
            label(step, terms, buildings, missing))).rstrip())

    # Counted over the lines actually written, not the units behind them: with
    # `추적자 3기` on one line, counting units made the sources add up to far
    # more than the step count and the report unreadable.
    sources = collections.Counter(r['source'] for r in rows)
    return lines, len(rows), sources, missing, unknown


def choose(players, want):
    if want is None:
        humans = [p for p in players if p['human']]
        return humans[0] if humans else players[0]
    if want.isdigit():
        for player in players:
            if player['id'] == int(want):
                return player
        raise SystemExit('그런 번호의 플레이어가 없습니다: %s' % want)
    for player in players:
        if want.lower() in player['name'].lower():
            return player
    raise SystemExit('이름이 맞는 플레이어가 없습니다: %s' % want)


REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def emit_json(payload):
    """The app's side of this script.

    stdout is the channel, so nothing else may be printed on it — the caller
    parses the whole stream. Windows consoles default to cp949, hence the
    explicit encode rather than print().
    """
    raw = json.dumps(payload, ensure_ascii=False)
    sys.stdout.buffer.write(raw.encode('utf-8'))
    sys.stdout.buffer.flush()


def run_json(args):
    """--json: everything comes back on stdout, nothing is written to disk.

    The app has its own places for builds and shows its own report, so writing
    files here would just leave a second copy going stale.
    """
    loaded = [Replay(path) for path in expand(args.replays)]

    if args.list:
        return emit_json({'ok': True, 'replays': [{
            'file': replay.path,
            'name': os.path.splitext(os.path.basename(replay.path))[0],
            'version': replay.version,
            'map': txt(replay.details['m_title']),
            # Floored, matching the `notes:` line the build file gets, so the
            # panel and the file never disagree about the same game's length.
            'seconds': int(replay.seconds),
            'fellBackTo': replay.fell_back_to,
            'players': replay.players(),
        } for replay in loaded]})

    picked = [(replay, choose(replay.players(), args.player)) for replay in loaded]
    derived = derive_build_times(picked)
    terms = load_terms(args.repo)
    buildings = load_buildings(args.repo)
    limit = args.minutes * 60 * LOOPS if args.minutes else None

    out = []
    for replay, player in picked:
        lines, count, sources, missing, unknown = build_text(
            replay, player, derived, terms, buildings, limit)
        out.append({
            'file': replay.path,
            'name': os.path.splitext(os.path.basename(replay.path))[0],
            'player': player,
            'text': '\n'.join(lines) + '\n',
            'steps': count,
            'sources': dict(sources),
            'missing': sorted(missing),
            'noBuildTime': sorted(unknown),
        })
    return emit_json({'ok': True, 'builds': out, 'derived': [{
        'unit': unit,
        'seconds': round(row['build'] / LOOPS, 1),
        'table': BUILD_TIME.get(unit),
        'count': row['count'],
    } for unit, row in sorted(derived.items())]})


def main():
    ap = argparse.ArgumentParser(description='리플레이에서 빌드오더를 뽑습니다.')
    ap.add_argument('replays', nargs='+', help='리플레이 파일, 와일드카드, 또는 폴더')
    ap.add_argument('--out', help='결과를 넣을 폴더 (--json 이면 필요 없습니다)')
    ap.add_argument('--player', help='플레이어 번호 또는 이름 일부 (기본: 사람)')
    ap.add_argument('--list', action='store_true', help='플레이어만 보여주고 끝냅니다')
    ap.add_argument('--minutes', type=float, help='앞 N분까지만')
    ap.add_argument('--json', action='store_true',
                    help='사람이 읽는 파일 대신 JSON 을 stdout 으로 (앱이 씁니다)')
    ap.add_argument('--repo', default=REPO,
                    help='용어 사전과 아이콘 매니페스트를 찾을 곳')
    args = ap.parse_args()

    if args.json:
        # The app gets a message it can show, not a traceback it cannot.
        try:
            return run_json(args)
        except SystemExit as err:
            return emit_json({'ok': False, 'message': str(err)})
        except Exception as err:
            return emit_json({'ok': False,
                              'message': '%s: %s' % (type(err).__name__, err)})
    if not args.out:
        raise SystemExit('--out 으로 결과를 넣을 폴더를 지정하세요.')

    os.makedirs(args.out, exist_ok=True)
    loaded = [Replay(path) for path in expand(args.replays)]

    if args.list:
        report = []
        for replay in loaded:
            report.append('%s  (SC2 %s, %s)' % (
                os.path.basename(replay.path), replay.version,
                txt(replay.details['m_title'])))
            for player in replay.players():
                report.append('   %d. %-24s %-8s %s %s' % (
                    player['id'], player['name'], player['race'],
                    '사람' if player['human'] else 'AI',
                    '승' if player['won'] else '패'))
        write_lines(os.path.join(args.out, '_players.txt'), report)
        return

    picked = [(replay, choose(replay.players(), args.player)) for replay in loaded]
    derived = derive_build_times(picked)
    terms = load_terms(args.repo)
    buildings = load_buildings(args.repo)
    limit = args.minutes * 60 * LOOPS if args.minutes else None

    report = ['리플레이에서 유도한 빌드 시간 (표 대신 이 값을 씀):']
    for unit in sorted(derived):
        row = derived[unit]
        table = BUILD_TIME.get(unit)
        report.append('  %-20s %-11s %5.1f초  (표 %s)  %d기 %d판' % (
            unit, str(row['ability']), row['build'] / LOOPS,
            '%d초' % table if table else '없음', row['count'], row['replays']))
    report.append('')

    for replay, player in picked:
        name = os.path.splitext(os.path.basename(replay.path))[0]
        lines, count, sources, missing, unknown = build_text(
            replay, player, derived, terms, buildings, limit)
        write_lines(os.path.join(args.out, name + '.txt'), lines)
        report.append('%s  <- %s (%s)' % (name, player['name'], player['race']))
        if replay.fell_back_to:
            report.append('   ⚠ 이 패치(%s)의 해독표가 없어 %s 것으로 읽었습니다'
                          % (replay.version, replay.fell_back_to))
        report.append('   %d단계 · 시각 출처 %s' % (count, dict(sources)))
        if unknown:
            report.append('   빌드 시간을 모르는 것 (완성 시각 그대로): %s'
                          % ', '.join(sorted(unknown)))
        if missing:
            report.append('   사전에 없는 이름: %s' % ', '.join(sorted(missing)))

    write_lines(os.path.join(args.out, '_report.txt'), report)


if __name__ == '__main__':
    main()
