import PocketBase from '../frontend/node_modules/pocketbase/dist/pocketbase.es.mjs';

const PB_URL = process.env.PB_URL || 'http://localhost:8090';
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL || 'admin@teamtracker.nl';
const ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD || 'TeamTracker2026!';

const pb = new PocketBase(PB_URL);
pb.autoCancellation(false);

async function main() {
  console.log(`🏐 Connecting to PocketBase at ${PB_URL}...`);
  await pb.collection('_superusers').authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD);
  console.log(`✅ Authenticated as superuser ${ADMIN_EMAIL}`);

  // 1. Collections to clean in order (leaf to root)
  const collectionsToClean = [
    'training_attendance',
    'match_attendance',
    'match_player_stats',
    'player_competencies',
    'questionnaire_responses',
    'questionnaires',
    'team_players',
    'training_plan',
    'training_templates',
    'season_periods',
    'invitations',
    'trainings',
    'matches',
    'players',
    'club_access',
    'team_access',
    'teams',
    'clubs',
    'seasons',
    'competencies',
  ];

  console.log('🧹 Cleaning existing test data...');
  for (const colName of collectionsToClean) {
    try {
      const records = await pb.collection(colName).getFullList({ fields: 'id' });
      if (records.length > 0) {
        for (const record of records) {
          await pb.collection(colName).delete(record.id);
        }
        console.log(`  ✓ Cleared ${records.length} records from ${colName}`);
      }
    } catch (e) {
      console.log(`  ℹ Note on ${colName}: ${e.message}`);
    }
  }

  // 2. Ensure test user coach@setbaas.nl exists
  let coachUser;
  try {
    coachUser = await pb.collection('users').getFirstListItem('email = "coach@setbaas.nl"');
    console.log(`  ✓ User coach@setbaas.nl exists (${coachUser.id})`);
  } catch {
    coachUser = await pb.collection('users').create({
      email: 'coach@setbaas.nl',
      password: 'SetBaas2026!',
      passwordConfirm: 'SetBaas2026!',
      name: 'Coach SetBaas',
      verified: true,
      is_platform_admin: true,
    });
    console.log(`  ✓ User coach@setbaas.nl created (${coachUser.id})`);
  }

  // Ensure superuser in users collection if exists
  let adminUser;
  try {
    adminUser = await pb.collection('users').getFirstListItem(`email = "${ADMIN_EMAIL}"`);
  } catch {
    adminUser = await pb.collection('users').create({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      passwordConfirm: ADMIN_PASSWORD,
      name: 'Admin User',
      verified: true,
      is_platform_admin: true,
    });
  }

  // Ensure test player user speler@setbaas.nl exists
  let spelerUser;
  try {
    spelerUser = await pb.collection('users').getFirstListItem('email = "speler@setbaas.nl"');
    console.log(`  ✓ User speler@setbaas.nl exists (${spelerUser.id})`);
  } catch {
    spelerUser = await pb.collection('users').create({
      email: 'speler@setbaas.nl',
      password: 'SetBaas2026!',
      passwordConfirm: 'SetBaas2026!',
      name: 'Emma van Dijk',
      verified: true,
      is_platform_admin: false,
    });
    console.log(`  ✓ User speler@setbaas.nl created (${spelerUser.id})`);
  }

  // 3. Create Season
  console.log('📅 Creating Season 2026-2027...');
  const season = await pb.collection('seasons').create({
    name: '2026-2027',
    start_year: 2026,
    end_year: 2027,
  });
  console.log(`  ✓ Season '2026-2027' created (${season.id})`);

  // 4. Create 2 Clubs
  console.log('🏛 Creating 2 Clubs...');
  const clubZovoc = await pb.collection('clubs').create({
    name: 'Zovoc',
    short_name: 'ZOVOC',
    city: 'Zoetermeer',
  });
  const clubZVH = await pb.collection('clubs').create({
    name: 'ZVH',
    short_name: 'ZVH',
    city: 'Zevenhuizen',
  });
  console.log(`  ✓ Club 'Zovoc' created (${clubZovoc.id})`);
  console.log(`  ✓ Club 'ZVH' created (${clubZVH.id})`);

  // 5. Create 2 Teams per Club (4 teams total)
  console.log('🏐 Creating 2 Teams per Club...');
  const zovocTeams = [
    await pb.collection('teams').create({
      name: 'Zovoc Dames 1',
      club: clubZovoc.id,
      nevobo_team_type: 'ds',
      nevobo_team_number: 1,
    }),
    await pb.collection('teams').create({
      name: 'Zovoc Heren 1',
      club: clubZovoc.id,
      nevobo_team_type: 'hs',
      nevobo_team_number: 1,
    }),
  ];

  const zvhTeams = [
    await pb.collection('teams').create({
      name: 'ZVH Dames 1',
      club: clubZVH.id,
      nevobo_team_type: 'ds',
      nevobo_team_number: 1,
    }),
    await pb.collection('teams').create({
      name: 'ZVH Heren 1',
      club: clubZVH.id,
      nevobo_team_type: 'hs',
      nevobo_team_number: 1,
    }),
  ];

  const allTeams = [...zovocTeams, ...zvhTeams];
  console.log(`  ✓ Created ${allTeams.length} teams across 2 clubs`);

  // 6. Grant club & team access to users
  console.log('🔐 Setting up Club & Team access...');
  for (const user of [coachUser, adminUser]) {
    for (const club of [clubZovoc, clubZVH]) {
      const defaultTeam = club.id === clubZovoc.id ? zovocTeams[0].id : zvhTeams[0].id;
      await pb.collection('club_access').create({
        user: user.id,
        club: club.id,
        role: 'admin',
        default_team: defaultTeam,
        is_trainer: true,
        is_player: true,
      });
    }

    for (const team of allTeams) {
      await pb.collection('team_access').create({
        user: user.id,
        team: team.id,
        role: 'admin',
        is_trainer: true,
        is_player: true,
      });
    }
  }

  // Access for player user
  for (const club of [clubZovoc, clubZVH]) {
    const defaultTeam = club.id === clubZovoc.id ? zovocTeams[0].id : zvhTeams[0].id;
    await pb.collection('club_access').create({
      user: spelerUser.id,
      club: club.id,
      role: 'user',
      default_team: defaultTeam,
      is_trainer: false,
      is_player: true,
    });
  }
  for (const team of allTeams) {
    await pb.collection('team_access').create({
      user: spelerUser.id,
      team: team.id,
      role: 'user',
      is_trainer: false,
      is_player: true,
    });
  }

  // 7. Create Standard Competencies
  console.log('⭐ Creating Standard Competencies...');
  const compDefs = [
    { name: 'Opslag', category: 'technical' },
    { name: 'Pass', category: 'technical' },
    { name: 'Set-up', category: 'technical' },
    { name: 'Aanval', category: 'technical' },
    { name: 'Blok', category: 'technical' },
    { name: 'Verdediging', category: 'technical' },
    { name: 'Spelsysteem', category: 'tactical' },
    { name: 'Positiekeuze', category: 'tactical' },
    { name: 'Communicatie', category: 'tactical' },
    { name: 'Conditie', category: 'physical' },
    { name: 'Sprongkracht', category: 'physical' },
    { name: 'Snelheid', category: 'physical' },
    { name: 'Focus', category: 'mental' },
    { name: 'Teamspirit', category: 'mental' },
    { name: 'Veerkracht', category: 'mental' },
  ];

  const competencies = [];
  for (const def of compDefs) {
    const comp = await pb.collection('competencies').create(def);
    competencies.push(comp);
  }
  console.log(`  ✓ Created ${competencies.length} competencies`);

  // 8. 10 Players per Team (40 players total)
  console.log('👥 Creating 10 Players per Team (40 players total)...');

  const playerPool = {
    'Zovoc Dames 1': [
      { name: 'Emma van Dijk', position: ['setter'], jersey_number: 1 },
      { name: 'Sophie de Boer', position: ['outside_hitter'], jersey_number: 2 },
      { name: 'Julia Bakker', position: ['outside_hitter'], jersey_number: 3 },
      { name: 'Lieke Visser', position: ['middle_blocker'], jersey_number: 4 },
      { name: 'Fleur Smit', position: ['middle_blocker'], jersey_number: 5 },
      { name: 'Lotte Meijer', position: ['opposite'], jersey_number: 6 },
      { name: 'Mila de Jong', position: ['libero'], jersey_number: 7 },
      { name: 'Noa Bos', position: ['setter'], jersey_number: 8 },
      { name: 'Tess Vos', position: ['outside_hitter'], jersey_number: 9 },
      { name: 'Roos Hendriks', position: ['defensive_specialist'], jersey_number: 10 },
    ],
    'Zovoc Heren 1': [
      { name: 'Daan Jansen', position: ['setter'], jersey_number: 1 },
      { name: 'Sem van Leeuwen', position: ['outside_hitter'], jersey_number: 2 },
      { name: 'Lucas Dekker', position: ['outside_hitter'], jersey_number: 3 },
      { name: 'Milan Brouwer', position: ['middle_blocker'], jersey_number: 4 },
      { name: 'Levi de Wit', position: ['middle_blocker'], jersey_number: 5 },
      { name: 'Finn van den Berg', position: ['opposite'], jersey_number: 6 },
      { name: 'Jesse Willems', position: ['libero'], jersey_number: 7 },
      { name: 'Ruben Mulder', position: ['setter'], jersey_number: 8 },
      { name: 'Thijs van Dam', position: ['outside_hitter'], jersey_number: 9 },
      { name: 'Bram Schouten', position: ['defensive_specialist'], jersey_number: 10 },
    ],
    'ZVH Dames 1': [
      { name: 'Eva Kok', position: ['setter'], jersey_number: 1 },
      { name: 'Iris Jacobs', position: ['outside_hitter'], jersey_number: 2 },
      { name: 'Sanne van Vliet', position: ['outside_hitter'], jersey_number: 3 },
      { name: 'Maud de Graaf', position: ['middle_blocker'], jersey_number: 4 },
      { name: 'Amber Peters', position: ['middle_blocker'], jersey_number: 5 },
      { name: 'Luna van Loon', position: ['opposite'], jersey_number: 6 },
      { name: 'Vera Sanders', position: ['libero'], jersey_number: 7 },
      { name: 'Yara Koster', position: ['setter'], jersey_number: 8 },
      { name: 'Lynn Prins', position: ['outside_hitter'], jersey_number: 9 },
      { name: 'Eline Hoekstra', position: ['defensive_specialist'], jersey_number: 10 },
    ],
    'ZVH Heren 1': [
      { name: 'Luuk van Beek', position: ['setter'], jersey_number: 1 },
      { name: 'Stijn Maas', position: ['outside_hitter'], jersey_number: 2 },
      { name: 'Lars Verhoeven', position: ['outside_hitter'], jersey_number: 3 },
      { name: 'Niek Kuijpers', position: ['middle_blocker'], jersey_number: 4 },
      { name: 'Guus Martens', position: ['middle_blocker'], jersey_number: 5 },
      { name: 'Casper Driessen', position: ['opposite'], jersey_number: 6 },
      { name: 'Koen Postma', position: ['libero'], jersey_number: 7 },
      { name: 'Jens van Rijn', position: ['setter'], jersey_number: 8 },
      { name: 'Bastiaan Blom', position: ['outside_hitter'], jersey_number: 9 },
      { name: 'Niels Groen', position: ['defensive_specialist'], jersey_number: 10 },
    ],
  };

  const teamPlayersMap = {};

  for (const team of allTeams) {
    const list = playerPool[team.name] || [];
    teamPlayersMap[team.id] = [];

    for (const p of list) {
      let linkedUserId = '';
      let extraActivities = null;

      if (p.name === 'Emma van Dijk') {
        linkedUserId = spelerUser.id;
        extraActivities = [
          { type: 'training', hours: 2, team_name: 'Zovoc Dames 2', notes: 'Mee-trainen op donderdag', source: 'coach' },
          { type: 'strength', hours: 1.5, team_name: 'Basic-Fit Zoetermeer', notes: 'Krachttraining', source: 'player' },
        ];
      } else if (p.name === 'Daan Jansen') {
        linkedUserId = coachUser.id;
        extraActivities = [
          { type: 'training', hours: 1.5, team_name: 'Selectietraining', notes: 'Regionale selectie', source: 'player' },
        ];
      }

      const playerRecord = await pb.collection('players').create({
        name: p.name,
        position: p.position,
        jersey_number: p.jersey_number,
        status: 'active',
        email: p.name === 'Emma van Dijk' ? 'speler@setbaas.nl' : `${p.name.toLowerCase().replace(/[^a-z0-9]/g, '.')}@example.com`,
        user_id: linkedUserId || undefined,
        extra_activities: extraActivities || undefined,
      });

      await pb.collection('team_players').create({
        team: team.id,
        season: season.id,
        player: playerRecord.id,
      });

      teamPlayersMap[team.id].push(playerRecord);
    }
    console.log(`  ✓ Added 10 players to ${team.name}`);
  }

  // 9. Create Sample Trainings & Matches for Zovoc Dames 1 (and others)
  console.log('📋 Adding sample trainings, matches, attendance and competency scores...');

  for (const team of allTeams) {
    const players = teamPlayersMap[team.id];
    const defaultHall = team.name.includes('Zovoc') ? 'Sporthal De Veur - Zaal 1' : 'Sporthal Swanla, Zevenhuizen';

    // Closed Training 1 (Afgerond)
    const t1 = await pb.collection('trainings').create({
      team: team.id,
      season: season.id,
      date: '2026-09-08 19:30:00.000Z',
      duration_minutes: 90,
      status: 'closed',
      overall_rating: 8,
      trainer: [coachUser.id],
      location: defaultHall,
      general_comments: 'Goede intensiteit bij pass- en aanvalsoefeningen.',
    });

    // Closed Training 2 (Afgerond)
    const t2 = await pb.collection('trainings').create({
      team: team.id,
      season: season.id,
      date: '2026-09-11 19:30:00.000Z',
      duration_minutes: 90,
      status: 'closed',
      overall_rating: 7,
      trainer: [coachUser.id],
      location: defaultHall,
      general_comments: 'Blok-verdediging en side-out patronen.',
    });

    // Open/Planned Training 3
    await pb.collection('trainings').create({
      team: team.id,
      season: season.id,
      date: '2026-09-18 19:30:00.000Z',
      duration_minutes: 90,
      status: 'open',
      trainer: [coachUser.id],
      location: defaultHall,
      general_comments: 'Voorbereiding op de zaterdagwedstrijd.',
    });

    // Training Attendance for t1 and t2
    for (let idx = 0; idx < players.length; idx++) {
      const p = players[idx];
      // Most present, 1 sick, 1 school
      const status1 = idx === 8 ? 'sick' : idx === 9 ? 'school' : 'present';
      await pb.collection('training_attendance').create({
        training: t1.id,
        player: p.id,
        status: status1,
        fitness: status1 === 'present' ? 4 : undefined,
        happiness: status1 === 'present' ? 5 : undefined,
      });

      const status2 = idx === 7 ? 'absent' : 'present';
      await pb.collection('training_attendance').create({
        training: t2.id,
        player: p.id,
        status: status2,
        fitness: status2 === 'present' ? 4 : undefined,
        happiness: status2 === 'present' ? 4 : undefined,
      });
    }

    // Match 1: Played (Won 3-1)
    const m1 = await pb.collection('matches').create({
      team: team.id,
      season: season.id,
      date: '2026-09-06 14:00:00.000Z',
      opponent: team.name.includes('Dames') ? 'Volley2B Dames 2' : 'Volley2B Heren 2',
      home_away: 'home',
      location: 'Sporthal Olympus, Zoetermeer',
      status: 'played',
      coach: [coachUser.id],
      score_team: 3,
      score_opponent: 1,
      set_scores: [
        { team: 25, opponent: 21 },
        { team: 22, opponent: 25 },
        { team: 25, opponent: 18 },
        { team: 25, opponent: 19 },
      ],
      general_notes: 'Sterke service en stabiele side-out!',
    });

    // Match 2: Played (Won 3-2)
    const m2 = await pb.collection('matches').create({
      team: team.id,
      season: season.id,
      date: '2026-09-13 16:30:00.000Z',
      opponent: team.name.includes('Dames') ? 'Inter Rijswijk Dames 1' : 'Inter Rijswijk Heren 1',
      home_away: 'away',
      location: 'Marimbahal, Rijswijk',
      status: 'played',
      coach: [coachUser.id],
      score_team: 3,
      score_opponent: 2,
      set_scores: [
        { team: 23, opponent: 25 },
        { team: 25, opponent: 20 },
        { team: 25, opponent: 17 },
        { team: 20, opponent: 25 },
        { team: 15, opponent: 12 },
      ],
      general_notes: 'Knappe overwinning in de vijfde set na achterstand.',
    });

    // Match 3: Open / Upcoming
    await pb.collection('matches').create({
      team: team.id,
      season: season.id,
      date: '2026-09-20 15:00:00.000Z',
      opponent: team.name.includes('Dames') ? 'Kalinko Dames 2' : 'Kalinko Heren 2',
      home_away: 'home',
      location: 'Sporthal Olympus, Zoetermeer',
      status: 'open',
      coach: [coachUser.id],
    });

    // Match Attendance & Stats for m1 and m2
    for (let idx = 0; idx < players.length; idx++) {
      const p = players[idx];
      const matchAttStatus1 = idx === 9 ? 'absent' : 'present';
      await pb.collection('match_attendance').create({
        match: m1.id,
        player: p.id,
        status: matchAttStatus1,
      });

      const matchAttStatus2 = 'present';
      await pb.collection('match_attendance').create({
        match: m2.id,
        player: p.id,
        status: matchAttStatus2,
      });

      // Sample position points
      if (idx < 7) {
        await pb.collection('match_player_stats').create({
          match: m1.id,
          player: p.id,
          playing_time: 75,
          position_points: {
            'pos-1': Math.floor(Math.random() * 4) + 1,
            'pos-2': Math.floor(Math.random() * 5) + 1,
            'pos-4': Math.floor(Math.random() * 6) + 1,
          },
        });
      }
    }

    // Sample player competencies (ratings 6-9)
    for (const p of players.slice(0, 5)) {
      for (const comp of competencies.slice(0, 4)) {
        await pb.collection('player_competencies').create({
          player: p.id,
          competency: comp.id,
          rating: 6 + Math.floor(Math.random() * 4),
          date: '2026-09-01 10:00:00.000Z',
          created_by: coachUser.id,
        });
      }
    }
  }

  console.log('\n🎉 Test database successfully cleaned and seeded!');
  console.log('Summary:');
  console.log('  - Clubs: 2 (Zovoc, ZVH)');
  console.log('  - Teams: 4 (Zovoc Dames 1, Zovoc Heren 1, ZVH Dames 1, ZVH Heren 1)');
  console.log('  - Players: 40 (10 per team)');
  console.log('  - Competencies: 15 standard competencies');
  console.log('  - Season: 2026-2027');
  console.log('  - Sample trainings and matches with attendance and scores created.');
}

main().catch((err) => {
  console.error('❌ Error seeding database:', err);
  process.exit(1);
});
