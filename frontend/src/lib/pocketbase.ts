import PocketBase from 'pocketbase';
import { writable } from 'svelte/store';
import type {
	Player,
	Competency,
	PlayerCompetency,
	Training,
	TrainingAttendance,
	Match,
	MatchStatus,
	MatchPlayerStats,
	MatchAttendance,
	Club,
	Team,
	Season,
	TeamPlayer,
	TrainingTemplate,
	TrainingPlan,
	SeasonPeriod,
	AttendanceStatus,
	Questionnaire,
	QuestionnaireStatus,
	QuestionnaireQuestion,
	QuestionnaireResponse,
} from '$lib/types';

// PocketBase URL: in production same origin (proxied via Caddy), in local dev use port 8090
const pbUrl = typeof window !== 'undefined'
	? (window.location.port === '3000' ? 'http://localhost:8090' : window.location.origin)
	: import.meta.env.PUBLIC_POCKETBASE_URL || 'http://localhost:8090';

export const pb = new PocketBase(pbUrl);

// Disable auto-cancellation for concurrent requests
pb.autoCancellation(false);

// === Players ===

export async function getPlayers(filter = ''): Promise<Player[]> {
	return pb.collection('players').getFullList<Player>({
		sort: 'name',
		filter,
	});
}

export async function getPlayer(id: string): Promise<Player> {
	return pb.collection('players').getOne<Player>(id);
}

export async function createPlayer(data: FormData): Promise<Player> {
	return pb.collection('players').create<Player>(data);
}

export async function updatePlayer(id: string, data: FormData): Promise<Player> {
	return pb.collection('players').update<Player>(id, data);
}

export async function deletePlayer(id: string): Promise<boolean> {
	// Delete related records first to avoid foreign key constraints
	const [attendanceRecords, matchAttendanceRecords, scoreRecords] = await Promise.all([
		pb.collection('training_attendance').getFullList({ filter: `player = "${id}"`, fields: 'id' }),
		pb.collection('match_attendance').getFullList({ filter: `player = "${id}"`, fields: 'id' }).catch(() => []),
		pb.collection('competency_scores').getFullList({ filter: `player = "${id}"`, fields: 'id' }).catch(() => []),
	]);
	await Promise.all([
		...attendanceRecords.map(r => pb.collection('training_attendance').delete(r.id)),
		...matchAttendanceRecords.map(r => pb.collection('match_attendance').delete(r.id)),
		...scoreRecords.map(r => pb.collection('competency_scores').delete(r.id)),
	]);
	return pb.collection('players').delete(id);
}

// === Competencies ===

export async function getCompetencies(): Promise<Competency[]> {
	return pb.collection('competencies').getFullList<Competency>({ sort: 'category,name' });
}

export async function createCompetency(data: {
	name: string;
	category: string;
}): Promise<Competency> {
	return pb.collection('competencies').create<Competency>(data);
}

export async function updateCompetency(id: string, data: Partial<Competency>): Promise<Competency> {
	return pb.collection('competencies').update<Competency>(id, data);
}

export async function deleteCompetency(id: string): Promise<boolean> {
	return pb.collection('competencies').delete(id);
}

export async function getPlayerCompetencies(
	playerId: string,
	competencyId?: string
): Promise<PlayerCompetency[]> {
	let filter = `player = "${playerId}"`;
	if (competencyId) filter += ` && competency = "${competencyId}"`;

	return pb.collection('player_competencies').getFullList<PlayerCompetency>({
		filter,
		sort: 'date',
		expand: 'competency,created_by',
	});
}

export async function createPlayerCompetency(data: {
	player: string;
	competency: string;
	rating: number;
	date: string;
	notes?: string;
	created_by?: string;
}): Promise<PlayerCompetency> {
	return pb.collection('player_competencies').create<PlayerCompetency>(data);
}

// === Trainings ===

export async function getTrainings(): Promise<Training[]> {
	return pb.collection('trainings').getFullList<Training>({ sort: '-date', expand: 'created_by' });
}

export async function createTraining(data: {
	date: string;
	overall_rating?: number;
	general_comments?: string;
	team?: string;
	season?: string;
	template?: string;
	status?: string;
	content?: string;
	warmup?: string;
	technique?: string;
	core1?: string;
	core2?: string;
	game?: string;
	created_by?: string;
	trainer?: string[];
	duration_minutes?: number;
	location?: string;
}): Promise<Training> {
	return pb.collection('trainings').create<Training>(data);
}

export async function updateTraining(
	id: string,
	data: Partial<Training>
): Promise<Training> {
	return pb.collection('trainings').update<Training>(id, data);
}

export async function getTrainingAttendance(trainingId: string): Promise<TrainingAttendance[]> {
	return pb.collection('training_attendance').getFullList<TrainingAttendance>({
		filter: `training = "${trainingId}"`,
		expand: 'player',
	});
}

export async function createTrainingAttendance(data: {
	training: string;
	player: string;
	status: string;
	reason?: string;
	player_rating?: number;
	player_notes?: string;
}): Promise<TrainingAttendance> {
	return pb.collection('training_attendance').create<TrainingAttendance>(data);
}

export async function updateTrainingAttendance(
	id: string,
	data: Partial<TrainingAttendance>
): Promise<TrainingAttendance> {
	return pb.collection('training_attendance').update<TrainingAttendance>(id, data);
}

// === Matches ===

export async function getMatches(): Promise<Match[]> {
	return pb.collection('matches').getFullList<Match>({ sort: '-date', expand: 'created_by' });
}

export async function createMatch(data: {
	date: string;
	opponent: string;
	location?: string;
	status?: MatchStatus;
	home_away: string;
	coach?: string[];
	score_team?: number;
	score_opponent?: number;
	set_scores?: any;
	general_notes?: string;
	team?: string;
	season?: string;
	lineups?: any;
	game_system?: any;
	substitutions?: any;
	timeouts?: any;
	created_by?: string;
}): Promise<Match> {
	const match = await pb.collection('matches').create<Match>(data);

	// Auto-create attendance (present) for all team players
	if (data.team && data.season) {
		try {
			const teamPlayers = await pb.collection('team_players').getFullList({
				filter: `team = "${data.team}" && season = "${data.season}"`,
				fields: 'player',
			});
			await Promise.all(
				teamPlayers.map(async (tp) => {
					try {
						await pb.collection('match_attendance').create({
							match: match.id,
							player: tp.player,
							status: 'present',
						});
					} catch { /* skip */ }
				})
			);
		} catch (e) {
			console.error('Failed to create match attendance:', e);
		}
	}

	return match;
}

export async function updateMatch(
	id: string,
	data: Partial<Match>
): Promise<Match> {
	return pb.collection('matches').update<Match>(id, data);
}

export async function getMatchPlayerStats(matchId: string): Promise<MatchPlayerStats[]> {
	return pb.collection('match_player_stats').getFullList<MatchPlayerStats>({
		filter: `match = "${matchId}"`,
		expand: 'player',
	});
}

export async function createMatchPlayerStats(data: {
	match: string;
	player: string;
	position_points?: any;
	notes?: string;
}): Promise<MatchPlayerStats> {
	return pb.collection('match_player_stats').create<MatchPlayerStats>(data);
}

export async function updateMatchPlayerStats(
	id: string,
	data: Partial<MatchPlayerStats>
): Promise<MatchPlayerStats> {
	return pb.collection('match_player_stats').update<MatchPlayerStats>(id, data);
}

export async function deleteMatchPlayerStats(id: string): Promise<boolean> {
	return pb.collection('match_player_stats').delete(id);
}

export async function deleteTrainingAttendance(id: string): Promise<boolean> {
	return pb.collection('training_attendance').delete(id);
}

// === Match Attendance ===

export async function getMatchAttendance(matchId: string): Promise<MatchAttendance[]> {
	return pb.collection('match_attendance').getFullList<MatchAttendance>({
		filter: `match = "${matchId}"`,
		expand: 'player',
	});
}

export async function createMatchAttendance(data: {
	match: string;
	player: string;
	status: string;
	reason?: string;
}): Promise<MatchAttendance> {
	return pb.collection('match_attendance').create<MatchAttendance>(data);
}

export async function updateMatchAttendance(id: string, data: Partial<MatchAttendance>): Promise<MatchAttendance> {
	return pb.collection('match_attendance').update<MatchAttendance>(id, data);
}

// Upsert a player's own attendance status ahead of a training/match — used by
// the player dashboard so a player can declare their own status (present by
// default), which the trainer can later confirm/adjust during check-in or
// check-out. Same `training_attendance`/`match_attendance` records/statuses
// as the trainer flow — there is no separate "availability" concept anymore.
export async function setPlayerAttendance(data: {
	player: string;
	training?: string;
	match?: string;
	status: AttendanceStatus;
	reason?: string;
}): Promise<TrainingAttendance | MatchAttendance> {
	if (data.training) {
		const filter = `player = "${data.player}" && training = "${data.training}"`;
		try {
			const existing = await pb.collection('training_attendance').getFirstListItem<TrainingAttendance>(filter);
			return updateTrainingAttendance(existing.id, { status: data.status, reason: data.reason });
		} catch {
			return createTrainingAttendance({ training: data.training, player: data.player, status: data.status, reason: data.reason });
		}
	}
	if (data.match) {
		const filter = `player = "${data.player}" && match = "${data.match}"`;
		try {
			const existing = await pb.collection('match_attendance').getFirstListItem<MatchAttendance>(filter);
			return updateMatchAttendance(existing.id, { status: data.status, reason: data.reason });
		} catch {
			return createMatchAttendance({ match: data.match, player: data.player, status: data.status, reason: data.reason });
		}
	}
	throw new Error('setPlayerAttendance requires either training or match');
}

// Fetch a player's own attendance records across all trainings + matches
// (used by the player dashboard). Combines training_attendance and
// match_attendance since availability is no longer a separate concept.
export async function getAttendanceForPlayer(playerId: string): Promise<{ training: TrainingAttendance[]; match: MatchAttendance[] }> {
	const [training, match] = await Promise.all([
		pb.collection('training_attendance').getFullList<TrainingAttendance>({
			filter: `player = "${playerId}"`,
			expand: 'training',
		}),
		pb.collection('match_attendance').getFullList<MatchAttendance>({
			filter: `player = "${playerId}"`,
			expand: 'match',
		}),
	]);
	return { training, match };
}

export async function getPlayerTotalPlayingTime(playerId: string): Promise<number> {
	const stats = await pb.collection('match_player_stats').getFullList<MatchPlayerStats>({
		filter: `player = "${playerId}"`,
	});
	return stats.reduce((sum, s) => sum + (s.playing_time || 0), 0);
}

// === Questionnaires ===
// A coach builds a questionnaire (mix of text/choice/scale questions) for a
// team. Players see active questionnaires in their Inbox / on the dashboard
// and submit one response each, stored per-player so a coach can review who
// answered what (and a player's response history lives with their profile).

export async function getQuestionnaires(teamId: string): Promise<Questionnaire[]> {
	if (!teamId) return [];
	return pb.collection('questionnaires').getFullList<Questionnaire>({
		filter: `team = "${teamId}"`,
	});
}

export async function getQuestionnaire(id: string): Promise<Questionnaire> {
	return pb.collection('questionnaires').getOne<Questionnaire>(id);
}

export async function createQuestionnaire(data: {
	team: string;
	name: string;
	status?: QuestionnaireStatus;
	questions: QuestionnaireQuestion[];
	created_by?: string;
}): Promise<Questionnaire> {
	return pb.collection('questionnaires').create<Questionnaire>({ status: 'draft', ...data });
}

export async function updateQuestionnaire(id: string, data: Partial<Pick<Questionnaire, 'name' | 'status' | 'questions'>>): Promise<Questionnaire> {
	return pb.collection('questionnaires').update<Questionnaire>(id, data);
}

export async function deleteQuestionnaire(id: string): Promise<boolean> {
	// Clean up responses first — PocketBase doesn't cascade-delete by default.
	const responses = await pb.collection('questionnaire_responses').getFullList({
		filter: `questionnaire = "${id}"`,
	});
	await Promise.all(responses.map((r) => pb.collection('questionnaire_responses').delete(r.id)));
	return pb.collection('questionnaires').delete(id);
}

// Active questionnaires for a team that a given player has NOT answered yet
// (used for the Inbox / dashboard "nieuw" badge).
export async function getPendingQuestionnaires(teamId: string, playerId: string): Promise<Questionnaire[]> {
	if (!teamId || !playerId) return [];
	const active = await pb.collection('questionnaires').getFullList<Questionnaire>({
		filter: `team = "${teamId}" && status = "active"`,
	});
	if (active.length === 0) return [];
	const responses = await pb.collection('questionnaire_responses').getFullList<QuestionnaireResponse>({
		filter: `player = "${playerId}" && (${active.map((q) => `questionnaire = "${q.id}"`).join(' || ')})`,
	});
	const answeredIds = new Set(responses.map((r) => r.questionnaire));
	return active.filter((q) => !answeredIds.has(q.id));
}

// All questionnaires for a team + the player's own response (if any) — used
// by the Inbox to show both pending and already-answered items.
export async function getQuestionnairesForPlayer(teamId: string, playerId: string): Promise<{ questionnaire: Questionnaire; response: QuestionnaireResponse | null }[]> {
	if (!teamId || !playerId) return [];
	const list = await pb.collection('questionnaires').getFullList<Questionnaire>({
		filter: `team = "${teamId}" && status != "draft"`,
	});
	if (list.length === 0) return [];
	const responses = await pb.collection('questionnaire_responses').getFullList<QuestionnaireResponse>({
		filter: `player = "${playerId}" && (${list.map((q) => `questionnaire = "${q.id}"`).join(' || ')})`,
	});
	return list.map((questionnaire) => ({
		questionnaire,
		response: responses.find((r) => r.questionnaire === questionnaire.id) || null,
	}));
}

export async function getQuestionnaireResponses(questionnaireId: string): Promise<QuestionnaireResponse[]> {
	return pb.collection('questionnaire_responses').getFullList<QuestionnaireResponse>({
		filter: `questionnaire = "${questionnaireId}"`,
		expand: 'player',
	});
}

export async function getQuestionnaireResponsesForPlayer(playerId: string): Promise<QuestionnaireResponse[]> {
	return pb.collection('questionnaire_responses').getFullList<QuestionnaireResponse>({
		filter: `player = "${playerId}"`,
		expand: 'questionnaire',
	});
}

// Upsert — a player can only submit a questionnaire once, editing overwrites
// their previous answers.
export async function submitQuestionnaireResponse(data: {
	questionnaire: string;
	player: string;
	answers: Record<string, string | number>;
}): Promise<QuestionnaireResponse> {
	const filter = `questionnaire = "${data.questionnaire}" && player = "${data.player}"`;
	try {
		const existing = await pb.collection('questionnaire_responses').getFirstListItem<QuestionnaireResponse>(filter);
		return pb.collection('questionnaire_responses').update<QuestionnaireResponse>(existing.id, { answers: data.answers });
	} catch {
		return pb.collection('questionnaire_responses').create<QuestionnaireResponse>(data);
	}
}

// === Helpers ===

export function getFileUrl(record: Player, filename: string): string {
	return pb.files.getUrl(record, filename, { thumb: '200x200' });
}

// === Clubs, Teams & Seasons ===

export async function getClubs(): Promise<Club[]> {
	return pb.collection('clubs').getFullList<Club>({ sort: 'name' });
}

export async function createClub(data: { name: string; short_name?: string; city?: string; locations?: string[] }): Promise<Club> {
	return pb.collection('clubs').create<Club>(data);
}

export async function updateClub(id: string, data: Partial<Club>): Promise<Club> {
	return pb.collection('clubs').update<Club>(id, data);
}

export async function deleteClub(id: string): Promise<void> {
	await pb.collection('clubs').delete(id);
}

export async function getTeams(clubId?: string): Promise<Team[]> {
	return pb.collection('teams').getFullList<Team>({
		sort: 'name',
		...(clubId ? { filter: `club = "${clubId}"` } : {}),
	});
}

export async function createTeam(name: string, clubId?: string): Promise<Team> {
	return pb.collection('teams').create<Team>({ name, ...(clubId ? { club: clubId } : {}) });
}

export async function updateTeam(id: string, data: Partial<Team>): Promise<Team> {
	return pb.collection('teams').update<Team>(id, data);
}

export async function deleteTeam(id: string): Promise<void> {
	await pb.collection('teams').delete(id);
}

export async function getSeasons(): Promise<Season[]> {
	return pb.collection('seasons').getFullList<Season>({ sort: '-start_year' });
}

export async function createSeason(data: {
	name: string;
	start_year: number;
	end_year: number;
}): Promise<Season> {
	return pb.collection('seasons').create<Season>(data);
}

export async function getTeamPlayers(teamId: string, seasonId: string): Promise<TeamPlayer[]> {
	return pb.collection('team_players').getFullList<TeamPlayer>({
		filter: `team = "${teamId}" && season = "${seasonId}"`,
		expand: 'player',
		sort: 'player',
	});
}

/**
 * Players for the given team/season context. No team means no roster — a club
 * without a team, or a team without a season, sees zero players rather than
 * falling back to every player in the database (which used to leak another
 * club's squad into an empty context).
 */
export async function getContextPlayers(
	teamId: string,
	seasonId: string,
	options: { activeOnly?: boolean } = {}
): Promise<Player[]> {
	const activeOnly = options.activeOnly ?? false;

	if (!teamId || !seasonId) {
		return [];
	}

	const teamPlayers = await getTeamPlayers(teamId, seasonId);
	return teamPlayers
		.map((tp) => tp.expand?.player)
		.filter((p): p is Player => !!p && (!activeOnly || p.status === 'active'))
		.sort((a, b) => a.name.localeCompare(b.name));
}

export async function addPlayerToTeam(data: {
	team: string;
	season: string;
	player: string;
}): Promise<TeamPlayer> {
	const result = await pb.collection('team_players').create<TeamPlayer>(data);
	const today = new Date().toISOString().split('T')[0];

	// Auto-create attendance (status=present) for all non-closed/future trainings from today onwards
	try {
		const trainings = await pb.collection('trainings').getFullList({
			filter: `team = "${data.team}" && season = "${data.season}" && status != "closed" && date >= "${today}"`,
			fields: 'id',
		});
		await Promise.all(
			trainings.map(async (t) => {
				try {
					await pb.collection('training_attendance').create({
						training: t.id,
						player: data.player,
						status: 'present',
					});
				} catch { /* already exists */ }
			})
		);
	} catch (e) {
		console.error('Failed to create default attendance:', e);
	}

	// Auto-create attendance (status=present) for all upcoming/open matches from today onwards
	try {
		const matches = await pb.collection('matches').getFullList({
			filter: `team = "${data.team}" && season = "${data.season}" && status != "played" && date >= "${today}"`,
			fields: 'id',
		});
		await Promise.all(
			matches.map(async (m) => {
				try {
					await pb.collection('match_attendance').create({
						match: m.id,
						player: data.player,
						status: 'present',
					});
				} catch { /* already exists */ }
			})
		);
	} catch (e) {
		console.error('Failed to create default match attendance:', e);
	}

	return result;
}

export async function removePlayerFromTeam(id: string): Promise<boolean> {
	return pb.collection('team_players').delete(id);
}

// === Team Access (multi-user) ===

export interface TeamAccess {
	id: string;
	user: string;
	team: string;
	role: 'admin' | 'coach' | 'player';
	is_trainer?: boolean;
	is_player?: boolean;
	is_parent?: boolean;
	expand?: {
		user?: { id: string; email: string; name: string };
		team?: Team;
	};
}

export async function getTeamAccessForUser(userId: string): Promise<TeamAccess[]> {
	return pb.collection('team_access').getFullList<TeamAccess>({
		filter: `user = "${userId}"`,
		expand: 'team',
	});
}

export async function getTeamAccessForTeam(teamId: string): Promise<TeamAccess[]> {
	return pb.collection('team_access').getFullList<TeamAccess>({
		filter: `team = "${teamId}"`,
		expand: 'user',
	});
}

export async function grantTeamAccess(data: { user: string; team: string; role: string }): Promise<TeamAccess> {
	return pb.collection('team_access').create<TeamAccess>(data);
}

export async function updateTeamAccess(id: string, data: Partial<Pick<TeamAccess, 'role' | 'is_trainer' | 'is_player' | 'is_parent'>>): Promise<TeamAccess> {
	return pb.collection('team_access').update<TeamAccess>(id, data);
}

export async function revokeTeamAccess(id: string): Promise<boolean> {
	return pb.collection('team_access').delete(id);
}

// === Club Access (multi-user, club-scoped) ===
// Replaces team_access: a role granted on a club applies to every team under
// it. default_team is used when a person has access to more than one team
// (within the club, or across clubs) to pick which one loads initially.

export interface ClubAccess {
	id: string;
	user: string;
	club: string;
	role: 'admin' | 'user' | 'viewer';
	default_team?: string;
	is_trainer?: boolean;
	is_player?: boolean;
	is_parent?: boolean;
	expand?: {
		user?: { id: string; email: string; name: string };
		club?: Club;
		default_team?: Team;
	};
}

export async function getClubAccessForUser(userId: string): Promise<ClubAccess[]> {
	return pb.collection('club_access').getFullList<ClubAccess>({
		filter: `user = "${userId}"`,
		expand: 'club,default_team',
	});
}

export async function getClubAccessForClub(clubId: string): Promise<ClubAccess[]> {
	return pb.collection('club_access').getFullList<ClubAccess>({
		filter: `club = "${clubId}"`,
		expand: 'user,default_team',
	});
}

export async function grantClubAccess(data: { user: string; club: string; role: string; default_team?: string }): Promise<ClubAccess> {
	return pb.collection('club_access').create<ClubAccess>(data);
}

export async function updateClubAccess(
	id: string,
	data: Partial<Pick<ClubAccess, 'role' | 'default_team' | 'is_trainer' | 'is_player' | 'is_parent'>>
): Promise<ClubAccess> {
	return pb.collection('club_access').update<ClubAccess>(id, data);
}

export async function revokeClubAccess(id: string): Promise<boolean> {
	return pb.collection('club_access').delete(id);
}

export async function createUserAsAdmin(data: { name: string; email: string }): Promise<{ id: string; email: string; name: string }> {
	const password = crypto.randomUUID().slice(0, 16);
	const result = await pb.collection('users').create({
		name: data.name,
		email: data.email,
		password,
		passwordConfirm: password,
		emailVisibility: true,
	});
	return { id: result.id, email: result.email, name: result.name };
}

export async function findUserByEmail(email: string): Promise<{ id: string; email: string; name: string } | null> {
	try {
		const result = await pb.collection('users').getFirstListItem(`email = "${email}"`);
		return result ? { id: result.id, email: result.email, name: result.name } : null;
	} catch {
		return null;
	}
}

// === Training Templates ===

export async function getTrainingTemplates(filter = ''): Promise<TrainingTemplate[]> {
	return pb.collection('training_templates').getFullList<TrainingTemplate>({
		sort: 'type,name',
		filter,
	});
}

export async function getTrainingTemplate(id: string): Promise<TrainingTemplate> {
	return pb.collection('training_templates').getOne<TrainingTemplate>(id);
}

export async function createTrainingTemplate(data: Partial<TrainingTemplate>): Promise<TrainingTemplate> {
	return pb.collection('training_templates').create<TrainingTemplate>(data);
}

export async function updateTrainingTemplate(id: string, data: Partial<TrainingTemplate>): Promise<TrainingTemplate> {
	return pb.collection('training_templates').update<TrainingTemplate>(id, data);
}

export async function deleteTrainingTemplate(id: string): Promise<boolean> {
	return pb.collection('training_templates').delete(id);
}

// === Training Plan ===

export async function getTrainingPlans(filter = ''): Promise<TrainingPlan[]> {
	return pb.collection('training_plan').getFullList<TrainingPlan>({
		sort: 'date',
		filter,
		expand: 'template',
	});
}

export async function createTrainingPlan(data: Partial<TrainingPlan>): Promise<TrainingPlan> {
	return pb.collection('training_plan').create<TrainingPlan>(data);
}

export async function updateTrainingPlan(id: string, data: Partial<TrainingPlan>): Promise<TrainingPlan> {
	return pb.collection('training_plan').update<TrainingPlan>(id, data);
}

export async function deleteTrainingPlan(id: string): Promise<boolean> {
	return pb.collection('training_plan').delete(id);
}

// === Season Periods (Periodization) ===

export async function getSeasonPeriods(filter = ''): Promise<SeasonPeriod[]> {
	return pb.collection('season_periods').getFullList<SeasonPeriod>({
		sort: 'start_date',
		filter,
	});
}

export async function createSeasonPeriod(data: Partial<SeasonPeriod>): Promise<SeasonPeriod> {
	return pb.collection('season_periods').create<SeasonPeriod>(data);
}

export async function updateSeasonPeriod(id: string, data: Partial<SeasonPeriod>): Promise<SeasonPeriod> {
	return pb.collection('season_periods').update<SeasonPeriod>(id, data);
}

export async function deleteSeasonPeriod(id: string): Promise<boolean> {
	return pb.collection('season_periods').delete(id);
}


// === Player-User Linking ===

export async function getPlayerByUserId(userId: string): Promise<Player | null> {
	try {
		return await pb.collection('players').getFirstListItem<Player>(`user_id = "${userId}"`);
	} catch {
		return null;
	}
}

export async function getPlayerByEmail(email: string): Promise<Player | null> {
	try {
		return await pb.collection('players').getFirstListItem<Player>(`email = "${email}"`);
	} catch {
		return null;
	}
}

export async function linkPlayerToUser(playerId: string, userId: string): Promise<Player> {
	return pb.collection('players').update<Player>(playerId, { user_id: userId });
}

/**
 * Players on a team/season roster that aren't linked to any user account yet
 * (user_id is empty). Used by the self-service "link my account" flow on
 * /profile, so a player can find and claim their own roster entry without
 * needing a coach to set it up for them.
 */
export async function getUnlinkedTeamPlayers(teamId: string, seasonId: string): Promise<Player[]> {
	if (!teamId || !seasonId) return [];
	const teamPlayers = await pb.collection('team_players').getFullList<TeamPlayer>({
		filter: `team = "${teamId}" && season = "${seasonId}"`,
		expand: 'player',
		sort: 'player',
	});
	return teamPlayers
		.map((tp) => tp.expand?.player)
		.filter((p): p is Player => !!p && !p.user_id)
		.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Self-service profile update for the linked player record: photo and bio
 * only — name/position/jersey/status stay coach-managed via /players.
 */
export async function updatePlayerProfile(id: string, data: FormData): Promise<Player> {
	return pb.collection('players').update<Player>(id, data);
}

/**
 * Self-service update of the player's own extra activities (used from the
 * player dashboard to add/remove their own "extra training per week" rows).
 * The caller is responsible for keeping coach-added rows in the array intact.
 */
export async function updatePlayerExtraActivities(
	id: string,
	extra_activities: Player['extra_activities']
): Promise<Player> {
	return pb.collection('players').update<Player>(id, { extra_activities });
}
