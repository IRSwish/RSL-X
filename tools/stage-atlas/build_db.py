#!/usr/bin/env python3
"""
Build stages.db from rsl game data file.
Usage: python build_db.py
Output: stages.db in the same folder as this script.
"""

import json
import sqlite3
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

DAT_FILE = r'C:\Users\total\OneDrive\Desktop\rsl11.30.0.dat'
DB_OUT   = Path(__file__).parent / 'stages.db'
FP       = 4294967296  # 2^32 fixed-point

# Stat formula: converted = base * MULTI1[grade] * MULTI2[grade]^((level-1)/(10*grade-1))
# HP = Round(converted) * 15 ; ATK/DEF = Round(converted)
_GM1 = {1: 1.0, 2: 1.60000002, 3: 2.43199992, 4: 3.5020796, 5: 4.76282883, 6: 6.47744703}
_GM2 = {1: 2.0, 2: 1.89999998, 3: 1.79999995, 4: 1.70000005, 5: 1.70000005, 6: 1.70000005}

def _conv(base, grade, level):
    m1 = _GM1.get(grade, 1.0)
    m2 = _GM2.get(grade, 2.0)
    exp = (level - 1) / max(10 * grade - 1, 1)
    return round(base * m1 * (m2 ** exp))

# ---------------------------------------------------------------------------
# Load
# ---------------------------------------------------------------------------
print("Loading dat file (~37 MB)...")
with open(DAT_FILE, 'r', encoding='latin-1') as f:
    data = json.loads(f.read())
print("  done.")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
heroes_by_id = {h['Id']: h for h in data['HeroData']['HeroTypes']}

# Localization
loc_map: dict[str, str] = {}
for entry in data.get('StaticDataLocalization', {}).get('Localizations', []):
    key = entry.get('Key', '')
    val = (entry.get('DefaultValue')
           or entry.get('En')
           or entry.get('Value', ''))
    if key:
        loc_map[key] = val

def loc(key: str, fallback: str = '') -> str:
    return loc_map.get(key, fallback or key)

def get_hero_name(h: dict) -> str:
    """Return the English name for a hero entry."""
    name = h.get('Name', '')
    # Name may be a localization dict: {'Key': '...', 'DefaultValue': 'Vergis'}
    if isinstance(name, dict):
        return name.get('DefaultValue') or name.get('En') or f"Hero {h['Id']}"
    if name:
        return name
    name_key = h.get('NameKey', '')
    return loc(name_key, f"Hero {h['Id']}")

ELEMENT_TO_AFFINITY = {1: 'Magic', 2: 'Force', 3: 'Spirit', 4: 'Void'}
RARITY_NAMES = {1: 'Common', 2: 'Uncommon', 3: 'Rare', 4: 'Epic', 5: 'Legendary', 6: 'Mythical'}

def get_hero_info(hero_id: int) -> dict | None:
    h = heroes_by_id.get(hero_id)
    if not h or not h.get('Forms'):
        return None
    f0   = h['Forms'][0]
    bs   = f0['BaseStats']
    elem = f0.get('Element')
    return {
        'hp':        round(bs.get('Health',           0) / FP),
        'atk':       round(bs.get('Attack',           0) / FP),
        'def':       round(bs.get('Defence',          0) / FP),
        'spd':       round(bs.get('Speed',            0) / FP),
        'crit_rate': round(bs.get('CriticalChance',   0) / FP),
        'crit_dmg':  round(bs.get('CriticalDamage',   0) / FP),
        'res':       round(bs.get('Resistance',       0) / FP),
        'acc':       round(bs.get('Accuracy',         0) / FP),
        'affinity':  ELEMENT_TO_AFFINITY.get(elem, ''),
        'rarity':    RARITY_NAMES.get(h.get('Rarity'), ''),
    }

# kept for compat
def get_base_stats(hero_id): return get_hero_info(hero_id)

# ---------------------------------------------------------------------------
# Stage lookup
# ---------------------------------------------------------------------------
stages_by_id = {s['Id']: s for s in data['StageData']['Stages']}

DIFFICULTIES = {1: 'Normal', 2: 'Hard', 3: 'Brutal', 4: 'Nightmare', 9: 'Normal'}

# Display names for areas and regions
AREA_NAMES = {
    1:  'Campaign',
    2:  'Dungeons',
    4:  'Clan Boss',
    5:  'Faction Wars',
    7:  'Doom Tower',
    8:  'Hydra Clan Boss',
    10: 'Cursed City',
    13: 'Chimera',
    14: 'Grim Forest',
}

# Areas to skip entirely (no meaningful stage data)
SKIP_AREAS = {3, 6, 9, 11}  # Arena, Tag Team Arena, Live Arena, Siege

REGION_NAMES = {
    # Campaign Acts
    101: 'Act 1 – Kaerok Castle',
    102: 'Act 2 – Sewers of Arnoc',
    103: 'Act 3 – Catacombs of Narbuk',
    104: 'Act 4 – Durham Forest',
    105: 'Act 5 – Felwin\'s Gate',
    106: 'Act 6 – Palace of Aravia',
    107: 'Act 7 – Tilshire',
    108: 'Act 8 – Valdemar Strait',
    109: 'Act 9 – The Deadlands',
    110: 'Act 10 – Godfrey\'s Crossing',
    111: 'Act 11 – Hallowed Halls',
    112: 'Act 12 – Brimstone Path',
    # Dungeons
    201: 'Void Keep',         202: 'Spirit Keep',       203: 'Magic Keep',
    204: 'Force Keep',        205: 'Arcane Keep',
    206: "Dragon's Lair",     207: "Ice Golem's Peak",
    208: "Fire Knight's Castle", 209: "Spider's Den",   210: "Minotaur's Labyrinth",
    211: 'Iron Twins (Void)',  212: 'Iron Twins (Spirit)', 213: 'Iron Twins (Magic)',
    214: 'Iron Twins (Force)', 216: "Sand Devil's Necropolis", 217: "Phantom Shogun's Grove",
    218: 'Event Dungeon',
    # Faction Wars
    501: 'Banner Lords',      502: 'High Elves',        503: 'Sacred Order',
    505: 'Ogryn Tribes',      506: 'Lizardmen',         507: 'Skinwalkers',
    508: 'Orcs',              509: 'Demonspawn',        510: 'Undead Hordes',
    511: 'Dark Elves',        512: 'Knights Revenant',  513: 'Barbarians',
    514: 'Sylvan Watchers',   515: 'Shadowkin',         516: 'Dwarves',
    # Doom Tower (each region = one rotation, 132 floors incl. 12 secret rooms)
    701: 'Rotation 1 – Sorath',
    702: 'Rotation 2 – Iragoth',
    703: 'Rotation 3 – Astranyx',
    # Hydra
    801: 'Rotation 1', 802: 'Rotation 2', 803: 'Rotation 3',
    804: 'Rotation 4', 805: 'Rotation 5', 806: 'Rotation 6',
    # Clan Boss
    401: 'Clan Boss',
    # Arena
    301: 'Classic Arena',     601: 'Tag Team Arena',
    # Live Arena
    901: 'Live Arena',
    # Cursed City
    1001: 'Cobblemarket', 1002: 'Deadrise', 1003: 'Plagueholme',
    1004: 'Soulcross',   1005: 'Amius',
    # Siege
    1101: 'Siege',
    # Chimera
    1301: 'Rotation 1', 1302: 'Rotation 2', 1303: 'Rotation 3', 1304: 'Rotation 4',
    # Grim Forest
    1401: 'Rotation 1', 1402: 'Rotation 2',
    1403: 'Rotation 3', 1404: 'Rotation 4',
}

def resolve_name(obj, fallback: str) -> str:
    """Extract display name from a raw name field (string or loc dict)."""
    if isinstance(obj, dict):
        return obj.get('DefaultValue') or obj.get('En') or fallback
    return obj or fallback

# ---------------------------------------------------------------------------
# DB
# ---------------------------------------------------------------------------
print(f"Creating {DB_OUT} ...")
conn = sqlite3.connect(str(DB_OUT))
cur  = conn.cursor()

cur.executescript("""
    DROP TABLE IF EXISTS stages;
    DROP TABLE IF EXISTS waves;
    DROP TABLE IF EXISTS heroes;

    CREATE TABLE stages (
        id          INTEGER PRIMARY KEY,
        area_id     INTEGER,
        area_name   TEXT,
        region_id   INTEGER,
        region_name TEXT,
        difficulty  INTEGER,
        diff_name   TEXT,
        stage_num   INTEGER
    );

    CREATE TABLE waves (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        stage_id  INTEGER,
        wave      INTEGER,
        slot      INTEGER,
        hero_id   INTEGER,
        grade     INTEGER,
        level     INTEGER,
        eff_hp    INTEGER,
        eff_atk   INTEGER,
        eff_def   INTEGER,
        eff_res   INTEGER,
        eff_acc   INTEGER
    );

    CREATE TABLE heroes (
        id        INTEGER PRIMARY KEY,
        name      TEXT,
        base_hp   INTEGER,
        base_atk  INTEGER,
        base_def  INTEGER,
        spd       INTEGER,
        crit_rate REAL,
        crit_dmg  REAL,
        res       INTEGER,
        acc       INTEGER,
        affinity  TEXT,
        rarity    TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_waves_stage   ON waves(stage_id);
    CREATE INDEX IF NOT EXISTS idx_stages_region ON stages(region_id, difficulty);
""")

hero_ids_seen: set[int] = set()
stage_rows  = []
wave_rows   = []

# ---------------------------------------------------------------------------
# Walk areas → regions → difficulties → stages
# ---------------------------------------------------------------------------
print("Processing stage data...")

for area in data['StageData']['Areas']:
    area_id   = area['Id']
    if area_id in SKIP_AREAS:
        continue
    area_name = AREA_NAMES.get(area_id,
                    resolve_name(area.get('Name', ''), f'Area {area_id}'))

    for region in area.get('Regions', []):
        region_id   = region['Id']
        region_name = REGION_NAMES.get(region_id,
                          resolve_name(region.get('Name', ''), f'Region {region_id}'))

        for diff_key, stage_ids in region.get('StageIdsByDifficulty', {}).items():
            diff_num  = int(diff_key)
            diff_name = DIFFICULTIES.get(diff_num, f'Diff {diff_num}')

            for stage_num, stage_id in enumerate(stage_ids, 1):
                stage = stages_by_id.get(stage_id)
                if not stage:
                    continue

                stage_rows.append(
                    (stage_id, area_id, area_name,
                     region_id, region_name,
                     diff_num, diff_name, stage_num)
                )

                # Waves are stored as Round field inside HeroSlotsSetup
                # (all formations share one Formation entry for campaign)
                all_slots = []
                for formation in stage.get('Formations', []):
                    all_slots.extend(formation.get('HeroSlotsSetup', []))

                # Parse stage modifiers: {(wave, boss_only): {kind_id: [(value, is_abs)]}}
                stage_mods = {}
                for mod in stage.get('Modifiers', []):
                    key = (mod.get('Round', 0), bool(mod.get('BossOnly', 0)))
                    kind_id = mod['KindId']
                    stage_mods.setdefault(key, {}).setdefault(kind_id, []).append(
                        (mod['Value'], bool(mod.get('IsAbsolute', 0)))
                    )

                # Identify boss slot: sole hero in the last (highest) wave
                wave_slot_counts = {}
                for sl in all_slots:
                    w = sl.get('Round', 1)
                    wave_slot_counts[w] = wave_slot_counts.get(w, 0) + 1
                boss_wave = max(wave_slot_counts) if wave_slot_counts else None
                boss_is_single = boss_wave is not None and wave_slot_counts[boss_wave] == 1

                for slot in all_slots:
                    hero_id = slot.get('HeroTypeId', 0)
                    if not hero_id:
                        continue
                    grade    = slot.get('Grade', 0)
                    level    = slot.get('Level', 1)
                    wave_idx = slot.get('Round', 1)
                    slot_idx = slot.get('Slot', 1)
                    is_boss  = boss_is_single and wave_idx == boss_wave

                    # Compute effective stats with stage modifiers applied
                    info = get_hero_info(hero_id)
                    if info and grade > 0:
                        eff_hp  = _conv(info['hp'],  grade, level) * 15
                        eff_atk = _conv(info['atk'], grade, level)
                        eff_def = _conv(info['def'], grade, level)
                        eff_res = info['res']
                        eff_acc = info['acc']

                        # Collect applicable mods for this hero (boss overrides non-boss)
                        applied = {}
                        for (w, boss_only), kinds in stage_mods.items():
                            if w != wave_idx:
                                continue
                            if boss_only and not is_boss:
                                continue
                            for kk, mods in kinds.items():
                                if boss_only:
                                    applied[kk] = mods  # boss-specific overrides
                                elif kk not in applied:
                                    applied[kk] = mods

                        for kk, mods in applied.items():
                            for val, is_abs in mods:
                                if kk == 1:   # HP
                                    eff_hp  = round(val) if is_abs else round(eff_hp  * (1 + val))
                                elif kk == 2: # ATK
                                    eff_atk = round(val) if is_abs else round(eff_atk * (1 + val))
                                elif kk == 3: # DEF
                                    eff_def = round(val) if is_abs else round(eff_def * (1 + val))
                                elif kk == 5: # RES (absolute = add to base)
                                    eff_res = (eff_res + round(val)) if is_abs else round(eff_res * (1 + val))
                                elif kk == 6: # ACC (absolute = add to base)
                                    eff_acc = (eff_acc + round(val)) if is_abs else round(eff_acc * (1 + val))
                    else:
                        eff_hp = eff_atk = eff_def = eff_res = eff_acc = None

                    wave_rows.append(
                        (stage_id, wave_idx, slot_idx, hero_id, grade, level,
                         eff_hp, eff_atk, eff_def, eff_res, eff_acc)
                    )
                    hero_ids_seen.add(hero_id)

cur.executemany(
    "INSERT OR IGNORE INTO stages VALUES (?,?,?,?,?,?,?,?)", stage_rows)
cur.executemany(
    "INSERT INTO waves (stage_id,wave,slot,hero_id,grade,level,eff_hp,eff_atk,eff_def,eff_res,eff_acc) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    wave_rows)

print(f"  {len(stage_rows)} stages | {len(wave_rows)} wave slots | {len(hero_ids_seen)} unique heroes")

# ---------------------------------------------------------------------------
# Heroes
# ---------------------------------------------------------------------------
print("Processing hero base stats...")
hero_rows = []
missing   = 0

for hero_id in hero_ids_seen:
    h = heroes_by_id.get(hero_id)
    if not h:
        missing += 1
        continue
    info = get_hero_info(hero_id)
    if not info:
        missing += 1
        continue
    name = get_hero_name(h)
    hero_rows.append((
        hero_id, name,
        info['hp'], info['atk'], info['def'], info['spd'],
        info['crit_rate'], info['crit_dmg'],
        info['res'], info['acc'],
        info['affinity'], info['rarity'],
    ))

cur.executemany("INSERT OR IGNORE INTO heroes VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", hero_rows)

if missing:
    print(f"  WARNING: {missing} hero IDs not found in HeroData")

conn.commit()
conn.close()

size_kb = DB_OUT.stat().st_size // 1024
print(f"\nDone! stages.db → {size_kb} KB")
