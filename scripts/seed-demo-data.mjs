#!/usr/bin/env node
// SetBaas showcase / demo data set — ONLY for the test and demo environments.
//
// Loads a complete, realistic data set that touches every feature (clubs, teams,
// roles, players, competencies, periodization, templates, trainings in every
// status, matches with lineups/stats, questionnaires, inbox, invitations,
// documents). Dates are relative to "today", so the data always looks fresh.
//
// !! KEEP IN SYNC: when you add a feature or collection, extend this file. !!
//
// Usage (normally via ./scripts/deploy.sh <test|demo> seed):
//   SEED_ENV=test PB_URL=http://localhost:8090 node scripts/seed-demo-data.mjs
import PocketBase from '../frontend/node_modules/pocketbase/dist/pocketbase.es.mjs';

const SEED_ENV = process.env.SEED_ENV;
if (!['test', 'demo'].includes(SEED_ENV)) {
  console.error('❌ Refusing to seed: set SEED_ENV=test or SEED_ENV=demo (never production).');
  process.exit(1);
}
const PB_URL = process.env.PB_URL || 'http://localhost:8090';
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL || 'admin@teamtracker.nl';
const ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD || 'TeamTracker2026!';
const DEMO_PASSWORD = 'SetBaas2026!';

const pb = new PocketBase(PB_URL);
pb.autoCancellation(false);

// ---------- helpers ----------
let seed = 20260101;
const rnd = () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (min, max) => Math.floor(rnd() * (max - min + 1)) + min;
const pick = (arr) => arr[int(0, arr.length - 1)];
const chance = (p) => rnd() < p;

const now = new Date();
const startOfDay = (d) => { const x = new Date(d); x.setUTCHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };
const at = (d, h, m = 0) => { const x = startOfDay(d); x.setUTCHours(h, m); return x; };
const pbDate = (d) => d.toISOString().replace('T', ' ');
const today = startOfDay(now);

const seasonStartYear = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
const seasonStart = new Date(Date.UTC(seasonStartYear, 8, 1));
const seasonEnd = new Date(Date.UTC(seasonStartYear + 1, 5, 30));

async function wipe(collection) {
  const records = await pb.collection(collection).getFullList({ fields: 'id' });
  for (const r of records) await pb.collection(collection).delete(r.id);
  if (records.length) console.log(`  ✓ cleared ${records.length} from ${collection}`);
}
async function upsertUser(email, name, extra = {}) {
  try {
    const u = await pb.collection('users').getFirstListItem(`email = "${email}"`);
    return await pb.collection('users').update(u.id, { name, ...extra });
  } catch {
    return pb.collection('users').create({
      email, name, password: DEMO_PASSWORD, passwordConfirm: DEMO_PASSWORD, verified: true, ...extra,
    });
  }
}
const create = (c, data) => pb.collection(c).create(data);

// ---------- content ----------
const CLUBS = [
  { name: 'Zovoc', short_name: 'ZOVOC', city: 'Zoetermeer', locations: ['Sporthal De Veur - Zaal 1', 'Sporthal De Veur - Zaal 2', 'Sporthal De Oosterpoort'] },
  { name: 'ZVH', short_name: 'ZVH', city: 'Zevenhuizen', locations: ['Swanla Sporthal - Veld 1', 'Swanla Sporthal - Veld 2'] },
];

const ROSTERS = {
  'Zovoc Dames 1': [
    ['Emma van Dijk', 'setter', 1], ['Sophie de Boer', 'outside_hitter', 2], ['Julia Bakker', 'outside_hitter', 3],
    ['Lieke Visser', 'middle_blocker', 4], ['Fleur Smit', 'middle_blocker', 5], ['Lotte Meijer', 'opposite', 6],
    ['Mila de Jong', 'libero', 7], ['Noa Bos', 'setter', 8], ['Tess Vos', 'outside_hitter', 9],
    ['Roos Hendriks', 'defensive_specialist', 10], ['Anna Kramer', 'middle_blocker', 11], ['Lynn Dekker', 'opposite', 12],
    ['Fenna Mol', 'outside_hitter', 13], ['Isa Willems', 'libero', 14],
  ],
  'Zovoc Heren 1': [
    ['Daan Jansen', 'setter', 1], ['Sem van Leeuwen', 'outside_hitter', 2], ['Lucas Dekker', 'outside_hitter', 3],
    ['Milan Brouwer', 'middle_blocker', 4], ['Levi de Wit', 'middle_blocker', 5], ['Finn van den Berg', 'opposite', 6],
    ['Jesse Willems', 'libero', 7], ['Ruben Mulder', 'setter', 8], ['Thijs van Dam', 'outside_hitter', 9],
    ['Bram Schouten', 'defensive_specialist', 10], ['Joris Kuipers', 'middle_blocker', 11], ['Max Hoogland', 'opposite', 12],
  ],
  'ZVH Dames 1': [
    ['Eva Kok', 'setter', 1], ['Iris Jacobs', 'outside_hitter', 2], ['Sanne van Vliet', 'outside_hitter', 3],
    ['Maud de Graaf', 'middle_blocker', 4], ['Amber Peters', 'middle_blocker', 5], ['Luna van Loon', 'opposite', 6],
    ['Vera Sanders', 'libero', 7], ['Yara Koster', 'setter', 8], ['Lynn Prins', 'outside_hitter', 9],
    ['Eline Hoekstra', 'defensive_specialist', 10], ['Demi Roos', 'outside_hitter', 11], ['Sara Bouman', 'middle_blocker', 12],
  ],
  'ZVH Heren 1': [
    ['Luuk van Beek', 'setter', 1], ['Stijn Maas', 'outside_hitter', 2], ['Lars Verhoeven', 'outside_hitter', 3],
    ['Niek Kuijpers', 'middle_blocker', 4], ['Guus Martens', 'middle_blocker', 5], ['Casper Driessen', 'opposite', 6],
    ['Koen Postma', 'libero', 7], ['Jens van Rijn', 'setter', 8], ['Bastiaan Blom', 'outside_hitter', 9],
    ['Niels Groen', 'defensive_specialist', 10], ['Tim Aarts', 'middle_blocker', 11],
  ],
};

const COMPETENCIES = [
  ['Opslag', 'technical'], ['Pass', 'technical'], ['Set-up', 'technical'], ['Aanval', 'technical'],
  ['Blok', 'technical'], ['Verdediging', 'technical'], ['Spelsysteem', 'tactical'], ['Positiekeuze', 'tactical'],
  ['Communicatie', 'tactical'], ['Conditie', 'physical'], ['Sprongkracht', 'physical'], ['Snelheid', 'physical'],
  ['Focus', 'mental'], ['Teamspirit', 'mental'], ['Veerkracht', 'mental'],
];

const TEMPLATES = [
  ['Servicetraining: float & jump', 'serve', 'Opslag-accuratesse en variatie', '## Opslag\n\n- Warming-up: 10 min dynamisch\n- Float serve op zones (3 x 10)\n- Jump float: tempo en worptechniek\n- Wedstrijdvorm: serveer-en-verdedig, 15 min\n\n**Focus:** zone 1 en 5 aanserveren.'],
  ['Passen & side-out', 'pass', 'Opvang op de service', '## Pass\n\n- Platform en voetenwerk (10 min)\n- 3-persoons ontvangst met setter-target\n- Side-out spel 6 tegen 6, punten tellen dubbel bij side-out\n\n**Focus:** pass naar positie 2/3.'],
  ['Aanvalsvariaties', 'attack', 'Tempo-aanval en lijn/diagonaal', '## Aanval\n\n- Aanloop en armzwaai\n- Hoge bal vs. tempobal\n- Aanval vanuit pass, 3 vs 3 + 6 vs 6\n\n**Focus:** shot kiezen op basis van blok.'],
  ['Blok & verdediging', 'block', 'Blokopstelling en floordefense', '## Blok-verdediging\n\n- Blok-verplaatsing (middenblokkers)\n- Read-defense: wie dekt wat\n- Dig-to-target oefeningen\n\n**Focus:** communicatie "ik blok lijn!".'],
  ['Setters & tempo', 'setting', 'Setter-techniek en beslissingen', '## Set-up\n\n- Handen boven het voorhoofd, voetenwerk\n- Back set en jump set\n- Beslissingen onder druk\n\n**Focus:** variëren in tempo.'],
  ['Conditie & kracht', 'conditioning', 'Conditie, kracht en blessurepreventie', '## Fysiek\n\n- Circuit: squats, lunges, core (3 rondes)\n- Sprongserie (plyo)\n- Schouder-prehab met elastiek\n\n**Focus:** techniek boven snelheid.'],
  ['Wedstrijdvorm', 'game', 'Spelen onder druk', '## Wedstrijdvorm\n\n- 6 vs 6 tot 25, rotatie bij side-out\n- Wisselspel: verliezer doet 10 squats\n- Eindigen met serve-challenge\n\n**Focus:** wedstrijdhardheid.'],
  ['All-round basis', 'all_round', 'Basistechnieken herhalen', '## All-round\n\n- Pass, set, aanval ketens\n- Mini-games 3 vs 3\n- Cooling-down en stretch\n\n**Focus:** plezier en herhaling.'],
];

const OPPONENTS = ['Volley2B', 'Inter Rijswijk', 'Kalinko', 'VCN', 'Wilhelmus', 'Set-Up 65', 'Taurus', 'Targos', 'Olympia', 'Spirit'];
const COMMENTS = [
  'Goede intensiteit bij pass- en aanvalsoefeningen.', 'Blok-verdediging en side-out patronen.',
  'Veel energie, mooie rally’s in het spel.', 'Focus op servicedruk, tweede helft wat slapjes.',
  'Sterke teamspirit, communicatie werd steeds beter.', 'Technisch zwaar, maar iedereen bleef scherp.',
];
const PLAYER_NOTES = ['Voelde me fit!', 'Beetje moe van school.', 'Passen ging super.', 'Aanval nog wisselvallig.', 'Leuke training!'];
const ABSENCE_REASONS = { sick: 'Griep', school: 'Toets morgen', absent: 'Werkafspraak', late: 'Verkeer', injured: 'Enkel verstuikt' };

// ---------- main ----------
async function main() {
  console.log(`🏐 SetBaas ${SEED_ENV} showcase seed → ${PB_URL}`);
  await pb.collection('_superusers').authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD);

  console.log('🧹 Cleaning existing data...');
  for (const c of [
    'messages', 'attendance_notices', 'questionnaire_responses', 'questionnaires', 'team_documents',
    'training_attendance', 'match_attendance', 'match_player_stats', 'player_competencies', 'team_players',
    'training_plan', 'training_templates', 'season_periods', 'invitations', 'club_ai_config',
    'trainings', 'matches', 'players', 'club_access', 'team_access', 'teams', 'clubs', 'seasons', 'competencies',
  ]) {
    try { await wipe(c); } catch (e) { console.log(`  ℹ ${c}: ${e.message}`); }
  }

  // Users — one per role so every view can be demonstrated.
  console.log('👤 Users...');
  const admin = await upsertUser('coach@setbaas.nl', 'Coach SetBaas', { is_platform_admin: true });
  const coach2 = await upsertUser('trainer@setbaas.nl', 'Marloes Hofman', { is_platform_admin: false });
  const player = await upsertUser('speler@setbaas.nl', 'Emma van Dijk', { is_platform_admin: false });
  const parent = await upsertUser('ouder@setbaas.nl', 'Peter van Dijk', { is_platform_admin: false });
  const viewer = await upsertUser('kijker@setbaas.nl', 'Karin Kijker', { is_platform_admin: false });
  let platformAdmin;
  try { platformAdmin = await pb.collection('users').getFirstListItem(`email = "${ADMIN_EMAIL}"`); } catch {
    platformAdmin = await upsertUser(ADMIN_EMAIL, 'Admin User', { password: ADMIN_PASSWORD, passwordConfirm: ADMIN_PASSWORD, is_platform_admin: true });
  }

  const season = await create('seasons', { name: `${seasonStartYear}-${seasonStartYear + 1}`, start_year: seasonStartYear, end_year: seasonStartYear + 1 });
  const clubs = [];
  for (const c of CLUBS) clubs.push(await create('clubs', c));
  const [zovoc, zvh] = clubs;

  console.log('🏐 Teams & access...');
  const mkTeam = (name, club, code, type, num) => create('teams', {
    name, club: club.id, nevobo_code: code, nevobo_team_type: type, nevobo_team_number: num,
    nevobo_url: `https://www.volleybal.nl/competitie/vereniging/${code}/${type}/${num}`,
    trainers: [admin.id, ...(name.includes('Heren') ? [coach2.id] : [])],
  });
  const teams = [
    await mkTeam('Zovoc Dames 1', zovoc, 'CKL9N3N', 'dames', 1),
    await mkTeam('Zovoc Heren 1', zovoc, 'CKL9N3N', 'heren', 1),
    await mkTeam('ZVH Dames 1', zvh, 'CKL9W2F', 'dames', 1),
    await mkTeam('ZVH Heren 1', zvh, 'CKL9W2F', 'heren', 1),
  ];
  const clubOf = (t) => (t.club === zovoc.id ? zovoc : zvh);
  const firstTeam = (club) => teams.find((t) => t.club === club.id);

  const grant = async (user, role, flags, clubList = clubs) => {
    for (const club of clubList) {
      await create('club_access', { user: user.id, club: club.id, role, default_team: firstTeam(club).id, ...flags });
    }
    for (const t of teams.filter((t) => clubList.some((c) => c.id === t.club))) {
      await create('team_access', { user: user.id, team: t.id, role, ...flags });
    }
  };
  await grant(admin, 'admin', { is_trainer: true, is_player: false });
  await grant(platformAdmin, 'admin', { is_trainer: true, is_player: false });
  await grant(coach2, 'user', { is_trainer: true, is_player: false });
  await grant(player, 'user', { is_trainer: false, is_player: true }, [zovoc]);
  await grant(parent, 'user', { is_parent: true }, [zovoc]);
  await grant(viewer, 'viewer', {}, [zovoc]);

  console.log('⭐ Competencies...');
  const competencies = [];
  for (const [name, category] of COMPETENCIES) competencies.push(await create('competencies', { name, category }));

  // Periodization & templates per team
  console.log('📆 Periodization & templates...');
  const y = seasonStartYear;
  const phases = [
    ['Voorbereiding', 'preparation', [y, 7, 15], [y, 8, 30], 'Servicetechniek en pass verbeteren', 'Side-out systeem inslijpen', 'Opbouw conditie en kracht', 'Teamgevoel en gezamenlijke doelen'],
    ['Competitie 1', 'competition_1', [y, 9, 1], [y, 11, 20], 'Aanvalsvariatie en blok', 'Spelsysteem 5-1 stabiliseren', 'Onderhoud, blessurepreventie', 'Omgaan met druk'],
    ['Winterstop', 'winter_break', [y, 11, 21], [y + 1, 0, 10], 'Individuele techniek', 'Videoanalyse', 'Rust en herstel', 'Resetten'],
    ['Competitie 2', 'competition_2', [y + 1, 0, 11], [y + 1, 3, 15], 'Verfijnen, tempo-aanval', 'Wissel- en timeoutstrategie', 'Piekconditie', 'Focus'],
    ['Play-offs', 'playoffs', [y + 1, 3, 16], [y + 1, 5, 15], 'Fouten minimaliseren', 'Tegenstander analyseren', 'Fris blijven', 'Zelfvertrouwen'],
  ];
  const templatesByTeam = {};
  for (const t of teams) {
    for (const [name, phase, s, e, gt, gta, gp, gm] of phases) {
      await create('season_periods', {
        team: t.id, season: season.id, name, phase,
        start_date: pbDate(new Date(Date.UTC(...s))), end_date: pbDate(new Date(Date.UTC(...e))),
        goals_technical: gt, goals_tactical: gta, goals_physical: gp, goals_mental: gm,
        notes: `Periodisering ${name} voor ${t.name}.`,
      });
    }
    templatesByTeam[t.id] = [];
    for (const [name, type, notes, content] of TEMPLATES) {
      templatesByTeam[t.id].push(await create('training_templates', { name, type, notes, content, team: t.id, season: season.id }));
    }
  }

  // Players, rosters, competencies
  console.log('👥 Players & competencies...');
  const roster = {};
  for (const t of teams) {
    roster[t.id] = [];
    const list = ROSTERS[t.name];
    for (let i = 0; i < list.length; i++) {
      const [name, pos, nr] = list[i];
      const isEmma = t.name === 'Zovoc Dames 1' && name === 'Emma van Dijk';
      const data = {
        name, position: [pos], jersey_number: nr,
        status: i === 5 && t.name === 'Zovoc Dames 1' ? 'injured' : i === list.length - 1 && !t.name.includes('Zovoc') ? 'inactive' : 'active',
        email: isEmma ? 'speler@setbaas.nl' : `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`,
        bio: `${name} speelt als ${pos.replace('_', ' ')} en staat graag in de beslissende rally’s.`,
      };
      if (isEmma) {
        data.user_id = player.id;
        data.parent_users = [parent.id];
        data.extra_activities = [
          { type: 'training', hours: 2, team_name: 'Zovoc Dames 2', notes: 'Mee-trainen op donderdag', source: 'coach' },
          { type: 'strength', hours: 1.5, team_name: 'Basic-Fit Zoetermeer', notes: 'Krachttraining', source: 'player' },
        ];
      }
      if (t.name === 'Zovoc Heren 1' && name === 'Daan Jansen') {
        data.user_id = admin.id;
        data.extra_activities = [{ type: 'training', hours: 1.5, team_name: 'Selectietraining', notes: 'Regionale selectie', source: 'player' }];
      }
      const p = await create('players', data);
      await create('team_players', { team: t.id, season: season.id, player: p.id });
      roster[t.id].push(p);
    }

    // 4 measurements per season with visible progress
    const dates = [0, 1, 2, 3].map((q) => addDays(seasonStart, q * 75 + 7)).filter((d) => d <= addDays(today, 1));
    for (const p of roster[t.id]) {
      const base = int(4, 7);
      const strong = pick(competencies).id;
      for (let q = 0; q < dates.length; q++) {
        for (const c of competencies) {
          const rating = Math.max(1, Math.min(10, base + q * (chance(0.7) ? 1 : 0) + (c.id === strong ? 2 : 0) + int(-1, 1)));
          await create('player_competencies', {
            player: p.id, competency: c.id, rating, date: pbDate(at(dates[q], 10)),
            notes: q === dates.length - 1 && c.id === strong ? 'Belangrijkste sterkte op dit moment.' : '',
            created_by: admin.id,
          });
        }
      }
    }
    console.log(`  ✓ ${t.name}: ${roster[t.id].length} players`);
  }

  // Trainings
  console.log('📋 Trainings...');
  const trainingsOf = {};
  for (const t of teams) {
    const main = t.name === 'Zovoc Dames 1';
    const hall = clubOf(t).locations[0];
    const from = main ? seasonStart : addDays(today, -84);
    const players = roster[t.id].filter((p) => p.status !== 'inactive');
    trainingsOf[t.id] = [];
    const tpls = templatesByTeam[t.id];
    let n = 0;
    for (let d = new Date(Math.max(from, seasonStart)); d <= addDays(today, 35) && d <= seasonEnd; d = addDays(d, 1)) {
      const dow = d.getUTCDay();
      if (dow !== 2 && dow !== 4) continue;
      const tpl = tpls[n++ % tpls.length];
      const past = d < today;
      const isToday = d.getTime() === today.getTime();
      const status = past ? 'closed' : isToday ? 'active' : 'open';
      const tr = await create('trainings', {
        team: t.id, season: season.id, date: pbDate(at(d, 18, 30)), duration_minutes: 90, status,
        trainer: [admin.id, ...(t.name.includes('Heren') ? [coach2.id] : [])],
        created_by: admin.id, location: hall, template: tpl.id, content: tpl.content,
        checkout_question: n % 3 === 0 ? 'Wat ging vandaag het beste?' : '',
        ...(past ? { overall_rating: int(6, 9), general_comments: pick(COMMENTS) } : {}),
      });
      trainingsOf[t.id].push(tr);
      if (past || isToday) {
        for (const p of players) {
          const roll = rnd();
          const status = roll < 0.78 ? 'present' : roll < 0.84 ? 'late' : roll < 0.9 ? 'sick' : roll < 0.95 ? 'school' : p.status === 'injured' ? 'injured' : 'absent';
          const here = status === 'present' || status === 'late';
          await create('training_attendance', {
            training: tr.id, player: p.id, status: p.status === 'injured' ? 'injured' : status,
            ...(here ? {} : { reason: ABSENCE_REASONS[status] || '' }),
            ...(here ? { happiness: int(3, 5), fitness: int(2, 5) } : {}),
            ...(past && here ? { player_rating: int(6, 9), player_notes: chance(0.3) ? pick(PLAYER_NOTES) : '', checkout_selected: !!(n % 3 === 0 && chance(0.5)), checkout_answer: n % 3 === 0 && chance(0.5) ? 'Mijn service!' : '' } : {}),
          });
        }
      }
    }
    // Planned training plan entries (preparation flow)
    for (let w = 0; w < 4; w++) {
      const d = addDays(today, 3 + w * 7);
      const tpl = tpls[(w + 2) % tpls.length];
      await create('training_plan', { team: t.id, season: season.id, date: pbDate(at(d, 18, 30)), template: tpl.id, title: tpl.name, content: tpl.content, notes: 'Voorbereid via het trainingsplan.' });
    }
  }

  // Matches
  console.log('🏆 Matches...');
  const SYSTEMS = ['5-1', '6-2', '4-2'];
  for (const t of teams) {
    const main = t.name === 'Zovoc Dames 1';
    const players = roster[t.id].filter((p) => p.status === 'active');
    const hall = t.club === zovoc.id ? 'Sporthal De Veur - Zaal 1' : 'Swanla Sporthal - Veld 1';
    let n = 0;
    const from = main ? seasonStart : addDays(today, -56);
    for (let d = new Date(Math.max(from, seasonStart)); d <= addDays(today, 42) && d <= seasonEnd; d = addDays(d, 1)) {
      if (d.getUTCDay() !== 6) continue;
      const home = n % 2 === 0;
      const opp = `${OPPONENTS[(n + teams.indexOf(t)) % OPPONENTS.length]} ${t.name.includes('Dames') ? 'Dames' : 'Heren'} ${int(1, 3)}`;
      n++;
      const base = {
        team: t.id, season: season.id, date: pbDate(at(d, home ? 13 : 14)), opponent: opp,
        home_away: home ? 'home' : 'away', location: home ? hall : `Sporthal ${opp.split(' ')[0]}`,
        coach: [admin.id], created_by: admin.id,
      };
      if (d >= today) {
        await create('matches', { ...base, status: 'open' });
        continue;
      }
      // Played: generate consistent set scores (best of 5)
      const win = chance(0.65);
      const lost = int(0, 2);
      const results = [...Array(lost).fill(!win), ...Array(2).fill(win)].sort(() => rnd() - 0.5);
      results.push(win);
      const sets = [];
      let ours = 0;
      let theirs = 0;
      results.forEach((ourWin, i) => {
        const cap = i === 4 ? 15 : 25;
        const loser = int(cap - 10, cap - 2);
        if (ourWin) { ours++; sets.push({ team: cap, opponent: loser }); } else { theirs++; sets.push({ team: loser, opponent: cap }); }
      });
      const lineupPlayers = players.slice(0, 7);
      const lineups = sets.map((_, i) => ({
        set: i + 1,
        positions: Object.fromEntries([1, 2, 3, 4, 5, 6].map((pos, k) => [String(pos), lineupPlayers[(k + i) % 6].id])),
      }));
      const match = await create('matches', {
        ...base, status: 'played', score_team: ours, score_opponent: theirs,
        set_scores: sets,
        general_notes: win ? 'Sterke service en stabiele side-out!' : 'Veel eigen fouten in de eerste sets, wel goede reactie.',
        lineups, game_system: sets.map((_, i) => ({ set: i + 1, system: SYSTEMS[(n + i) % 2] })),
        substitutions: [{ set: 2, playerIn: lineupPlayers[6].id, playerOut: lineupPlayers[2].id, atScore: `${int(8, 16)}-${int(8, 16)}` }],
        timeouts: [{ set: 1, team: 'own', atScore: '12-15' }, { set: 2, team: 'opponent', atScore: '16-14' }],
      });
      for (const p of players) {
        const st = chance(0.9) ? 'present' : pick(['sick', 'school', 'absent']);
        await create('match_attendance', { match: match.id, player: p.id, status: st, ...(st === 'present' ? {} : { reason: ABSENCE_REASONS[st] }) });
      }
      for (const p of lineupPlayers) {
        const pp = [];
        sets.forEach((s, i) => { pp.push({ set: i + 1, position: String(int(1, 6)), points: int(0, 6) }); });
        await create('match_player_stats', { match: match.id, player: p.id, position_points: pp.filter((x) => x.points > 0), playing_time: int(45, 90), notes: chance(0.2) ? 'Sterke wedstrijd.' : '' });
      }
    }
  }

  // Questionnaires
  console.log('📝 Questionnaires...');
  const mainTeam = teams[0];
  const mainPlayers = roster[mainTeam.id];
  const questions = [
    { id: 'q1', type: 'scale', text: 'Hoe tevreden ben je over de trainingen?', options: [], scale_min: 1, scale_max: 5 },
    { id: 'q2', type: 'choice', text: 'Welk onderdeel wil je het meest trainen?', options: ['Service', 'Pass', 'Aanval', 'Blok', 'Conditie'] },
    { id: 'q3', type: 'text', text: 'Wat zou je graag anders zien?', options: [] },
  ];
  const active = await create('questionnaires', { team: mainTeam.id, name: 'Seizoensevaluatie', status: 'active', questions, created_by: admin.id });
  const closed = await create('questionnaires', { team: mainTeam.id, name: 'Voorbereiding — doelen', status: 'closed', questions, created_by: admin.id });
  await create('questionnaires', { team: mainTeam.id, name: 'Teamuitje (concept)', status: 'draft', questions: [{ id: 'q1', type: 'choice', text: 'Welke activiteit?', options: ['Bowlen', 'Escape room', 'BBQ'] }], created_by: admin.id });
  const answerPool = ['Meer wedstrijdvormen', 'Graag meer video-analyse', 'Alles goed zo!', 'Wat vaker serveertraining'];
  for (const [qn, count] of [[closed, mainPlayers.length], [active, Math.ceil(mainPlayers.length * 0.6)]]) {
    for (const p of mainPlayers.slice(0, count)) {
      await create('questionnaire_responses', { questionnaire: qn.id, player: p.id, answers: { q1: int(3, 5), q2: pick(['Service', 'Pass', 'Aanval', 'Blok', 'Conditie']), q3: pick(answerPool) } });
    }
  }

  // Inbox
  console.log('📬 Inbox...');
  const lastClosed = trainingsOf[mainTeam.id].filter((t) => t.status === 'closed').pop();
  const nextOpen = trainingsOf[mainTeam.id].find((t) => t.status === 'open');
  await create('messages', { recipient: admin.id, sender: player.id, kind: 'absence', subject: 'Emma van Dijk heeft zich afgemeld', body: 'Ik ben ziek en kan donderdag niet trainen.', link: nextOpen ? `/trainings/${nextOpen.id}` : '', read: false, emailed: true, club: zovoc.id, team: mainTeam.id, player: mainPlayers[0].id, training: nextOpen?.id, ref: `demo-${nextOpen?.id}`, ref_status: 'absent' });
  await create('messages', { recipient: admin.id, sender: player.id, kind: 'attendance_restored', subject: 'Julia Bakker is er toch bij', body: 'De afmelding is ingetrokken.', read: true, emailed: false, club: zovoc.id, team: mainTeam.id, player: mainPlayers[2].id, training: lastClosed?.id });
  await create('messages', { recipient: admin.id, kind: 'system', subject: 'Welkom bij de SetBaas demo', body: 'Dit is een demo-omgeving met voorbeelddata. Verken trainingen, wedstrijden, rapporten en vragenlijsten.', read: false, emailed: false });
  await create('messages', { recipient: player.id, kind: 'system', subject: 'Nieuwe vragenlijst: Seizoensevaluatie', body: 'Je coach heeft een vragenlijst voor je klaargezet.', link: '/inbox', read: false, emailed: false, club: zovoc.id, team: mainTeam.id });

  // Invitations
  console.log('✉️ Invitations...');
  for (const [email, status, days] of [['nieuwe.speler@example.com', 'pending', 7], ['assistent.coach@example.com', 'pending', 3], ['oud.lid@example.com', 'expired', -10], ['ex.trainer@example.com', 'accepted', 20]]) {
    await create('invitations', { email, token: `demo-${status}-${email.split('@')[0]}`, club: zovoc.id, role: 'user', status, invited_by: admin.id, expires_at: pbDate(addDays(today, days)) });
  }

  // Team documents
  console.log('📎 Team documents...');
  const docs = [
    ['Wedstrijdreglement', 'Samenvatting van de Nevobo-regels voor dit seizoen.', 'wedstrijdreglement.txt', 'Wedstrijdreglement (demo)\n\n1. Best of five, sets tot 25 punten.\n2. Beslissende set tot 15.\n'],
    ['Reisschema uitwedstrijden', 'Wie rijdt wanneer? Vertrek 45 minuten voor aanvang.', 'reisschema.csv', 'datum,vertrek,chauffeur\n+7d,12:15,Ouder A\n+21d,12:45,Ouder B\n'],
    ['Trainingsschema seizoen', 'Overzicht van alle trainingsdagen en locaties.', 'trainingsschema.txt', 'Dinsdag en donderdag 19:30-21:00, Sporthal De Veur Zaal 1.\n'],
  ];
  for (const [name, description, filename, text] of docs) {
    const form = new FormData();
    form.append('team', mainTeam.id);
    form.append('name', name);
    form.append('description', description);
    form.append('created_by', admin.id);
    form.append('file', new Blob([text], { type: filename.endsWith('.csv') ? 'text/csv' : 'text/plain' }), filename);
    await pb.collection('team_documents').create(form);
  }

  console.log('\n🎉 Showcase data loaded.');
  console.log(`  Season ${seasonStartYear}-${seasonStartYear + 1}, 2 clubs, ${teams.length} teams, ${Object.values(roster).flat().length} players`);
  console.log('  Logins (password for all: ' + DEMO_PASSWORD + '):');
  console.log('    coach@setbaas.nl   — platform admin + coach (both clubs)');
  console.log('    trainer@setbaas.nl — trainer of the men’s teams');
  console.log('    speler@setbaas.nl  — player Emma van Dijk (Zovoc Dames 1)');
  console.log('    ouder@setbaas.nl   — parent of Emma');
  console.log('    kijker@setbaas.nl  — read-only viewer');
}

main().catch((err) => {
  console.error('❌ Error seeding database:', err?.response ? JSON.stringify(err.response) : err);
  process.exit(1);
});
