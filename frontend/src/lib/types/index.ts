import type { RecordModel } from 'pocketbase';

// === Collection Types ===

export interface Player extends RecordModel {
	name: string;
	photo: string;
	position: PlayerPosition[];
	status: PlayerStatus;
	jersey_number?: number;
	email?: string;
	user_id?: string;
	bio?: string;
	/** Volleyball commitments outside this team, used for the load report. */
	extra_activities?: ExtraActivity[];
}

export type ExtraActivityType = 'training' | 'match' | 'strength' | 'other';

export const EXTRA_ACTIVITY_LABELS: Record<ExtraActivityType, string> = {
	training: 'Extra training',
	match: 'Extra wedstrijden',
	strength: 'Krachttraining',
	other: 'Overig / Andere sport',
};

/**
 * One recurring commitment next to the player's own team, e.g. training along
 * with a second team or filling in for its matches.
 */
export interface ExtraActivity {
	type: ExtraActivityType;
	/** Team relation id when it is a team inside the app. */
	team?: string;
	/** Free-text team name, for teams from another club. */
	team_name?: string;
	/** Hours per week this costs the player. */
	hours?: number;
	notes?: string;
	/**
	 * Who added this row: a coach via the player edit form, or the player
	 * themselves from their own dashboard. Missing means "coach" (rows
	 * created before this field existed). Only 'player' rows are editable
	 * from the player dashboard, so a player can't remove what a coach set.
	 */
	source?: 'coach' | 'player';
}

export interface Club extends RecordModel {
	name: string;
	short_name?: string;
	city?: string;
}

export interface Team extends RecordModel {
	club?: string;
	name: string;
	nevobo_code?: string; // Nevobo verenigingscode (e.g. CKM1H25)
	nevobo_team_type?: string; // e.g. 'hs', 'ds', 'mb', 'mj'
	nevobo_team_number?: number; // e.g. 1
	nevobo_url?: string; // URL to team page on volleybal.nl
	/** Team-specific AI system prompt; overrides the club prompt when set. */
	ai_system_prompt?: string;
	expand?: {
		club?: Club;
	};
}

export interface Season extends RecordModel {
	name: string;
	start_year: number;
	end_year: number;
}

export interface TeamPlayer extends RecordModel {
	team: string;
	season: string;
	player: string;
	expand?: {
		player?: Player;
		team?: Team;
		season?: Season;
	};
}

export type PlayerPosition =
	| 'setter'
	| 'outside_hitter'
	| 'opposite'
	| 'middle_blocker'
	| 'libero'
	| 'defensive_specialist';

export type PlayerStatus = 'active' | 'injured' | 'inactive';

export interface Competency extends RecordModel {
	name: string;
	category: CompetencyCategory;
	description?: string;
}

export type CompetencyCategory = 'technical' | 'tactical' | 'physical' | 'mental';

export interface PlayerCompetency extends RecordModel {
	player: string;
	competency: string;
	rating: number;
	date: string;
	notes?: string;
	created_by?: string;
	// Expanded relations
	expand?: {
		player?: Player;
		competency?: Competency;
		created_by?: { id: string; name: string; email: string };
	};
}

export interface Training extends RecordModel {
	date: string;
	overall_rating?: number;
	general_comments?: string;
	team?: string;
	season?: string;
	template?: string;
	status?: 'open' | 'active' | 'closed';
	content?: string;
	created_by?: string;
	trainer?: string[];
	checkout_question?: string;
	duration_minutes?: number;
	location?: string;
	expand?: {
		template?: TrainingTemplate;
		created_by?: { id: string; name: string; email: string };
		trainer?: { id: string; name: string; email: string }[];
	};
}

export interface TrainingAttendance extends RecordModel {
	training: string;
	player: string;
	status: AttendanceStatus;
	reason?: string;
	player_rating?: number;
	player_notes?: string;
	happiness?: number;
	fitness?: number;
	checkout_selected?: boolean;
	checkout_answer?: string;
	// Expanded relations
	expand?: {
		player?: Player;
		training?: Training;
	};
}

export interface MatchAttendance extends RecordModel {
	match: string;
	player: string;
	status: AttendanceStatus;
	reason?: string;
	expand?: {
		player?: Player;
	};
}

export type AttendanceStatus = 'present' | 'sick' | 'school' | 'absent' | 'late' | 'injured';

// Tap-to-cycle order used by the attendance status switcher (always starts
// on "present" as the default). Absent/late are the two statuses where a
// free-text reason can be given.
export const ATTENDANCE_CYCLE_ORDER: AttendanceStatus[] = ['present', 'sick', 'school', 'absent', 'late', 'injured'];

export const ATTENDANCE_STATUSES_WITH_REASON: AttendanceStatus[] = ['absent', 'late'];

export interface Match extends RecordModel {
	date: string;
	opponent: string;
	location?: string;
	status?: MatchStatus;
	home_away: 'home' | 'away';
	score_team?: number;
	score_opponent?: number;
	set_scores?: SetScore[];
	general_notes?: string;
	team?: string;
	season?: string;
	lineups?: SetLineup[];
	game_system?: SetGameSystem[];
	substitutions?: Substitution[];
	timeouts?: Timeout[];
	created_by?: string;
	coach?: string[];
	expand?: {
		created_by?: { id: string; name: string; email: string };
		coach?: { id: string; name: string; email: string }[];
	};
}

export interface SetScore {
	team: number | null;
	opponent: number | null;
}

/** open = record nog niet afgerond, played = uitslag ingevuld en afgerond */
export type MatchStatus = 'open' | 'played';

export const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
	open: 'Open',
	played: 'Gespeeld',
};

// Positions 1-6 mapped to player IDs
export interface SetLineup {
	set: number;
	positions: Record<string, string>; // "1"-"6" -> player ID
}

export type GameSystem = '5-1' | '6-2' | '4-2' | '6-0' | '';

export interface SetGameSystem {
	set: number;
	system: GameSystem;
}

export interface Substitution {
	set: number;
	playerIn: string;
	playerOut: string;
	atScore?: string; // e.g. "15-12"
}

export interface Timeout {
	set: number;
	team: 'own' | 'opponent';
	atScore?: string;
}

export const GAME_SYSTEM_LABELS: Record<string, string> = {
	'5-1': '5-1 (1 vaste spelverdeler)',
	'6-2': '6-2 (2 spelverdelers)',
	'4-2': '4-2 (2 spelverdelers vooraan)',
	'6-0': '6-0 (geen vaste spelverdeler)',
};

// Court position labels (1-6)
export const COURT_POSITION_LABELS: Record<string, string> = {
	'1': 'Pos 1 (RA)',
	'2': 'Pos 2 (RV)',
	'3': 'Pos 3 (MV)',
	'4': 'Pos 4 (LV)',
	'5': 'Pos 5 (LA)',
	'6': 'Pos 6 (MA)',
};

export interface PositionPoints {
	set: number;
	position: PlayerPosition;
	points: number;
}

export interface MatchPlayerStats extends RecordModel {
	match: string;
	player: string;
	position_points?: PositionPoints[];
	notes?: string;
	expand?: {
		player?: Player;
		match?: Match;
	};
}

// === UI Helper Types ===

export const POSITION_LABELS: Record<PlayerPosition, string> = {
	setter: 'Setter',
	outside_hitter: 'Buitenaanvaller',
	opposite: 'Diagonal',
	middle_blocker: 'Middenblokker',
	libero: 'Libero',
	defensive_specialist: 'Verdedigingsspecialist',
};

export const STATUS_LABELS: Record<PlayerStatus, string> = {
	active: 'Actief',
	injured: 'Geblesseerd',
	inactive: 'Inactief',
};

export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
	present: 'Aanwezig',
	sick: 'Ziek',
	school: 'School',
	absent: 'Afwezig',
	late: 'Later',
	injured: 'Geblesseerd',
};

// Tailwind classes for the attendance status switcher (card bg/border, badge, dot).
export const ATTENDANCE_STYLES: Record<AttendanceStatus, { card: string; badge: string; dot: string }> = {
	present: {
		card: 'bg-green-50 dark:bg-green-900/20 border-2 border-green-300 dark:border-green-700',
		badge: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
		dot: 'bg-green-500',
	},
	sick: {
		card: 'bg-yellow-50 dark:bg-yellow-900/20 border-2 border-yellow-300 dark:border-yellow-700',
		badge: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
		dot: 'bg-yellow-500',
	},
	school: {
		card: 'bg-blue-50 dark:bg-blue-900/20 border-2 border-blue-300 dark:border-blue-700',
		badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
		dot: 'bg-blue-500',
	},
	absent: {
		card: 'bg-red-50 dark:bg-red-900/20 border-2 border-red-300 dark:border-red-700',
		badge: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
		dot: 'bg-red-500',
	},
	late: {
		card: 'bg-orange-50 dark:bg-orange-900/20 border-2 border-orange-300 dark:border-orange-700',
		badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
		dot: 'bg-orange-500',
	},
	injured: {
		card: 'bg-purple-50 dark:bg-purple-900/20 border-2 border-purple-300 dark:border-purple-700',
		badge: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
		dot: 'bg-purple-500',
	},
};

export const CATEGORY_LABELS: Record<CompetencyCategory, string> = {
	technical: 'Technisch',
	tactical: 'Tactisch',
	physical: 'Fysiek',
	mental: 'Mentaal',
};

// === Training Templates & Plan ===

export type TrainingType = 'serve' | 'pass' | 'attack' | 'block' | 'defense' | 'setting' | 'all_round' | 'game' | 'conditioning';

export const TRAINING_TYPE_LABELS: Record<TrainingType, string> = {
	serve: 'Opslag',
	pass: 'Pass',
	attack: 'Aanval',
	block: 'Blok',
	defense: 'Verdediging',
	setting: 'Setup',
	all_round: 'All-round',
	game: 'Wedstrijdvorm',
	conditioning: 'Conditie/Kracht',
};

export const TRAINING_PHASES = ['warmup', 'technique', 'core1', 'core2', 'game'] as const;
export type TrainingPhase = typeof TRAINING_PHASES[number];

export const PHASE_LABELS: Record<TrainingPhase, string> = {
	warmup: 'Warm-up / Kracht',
	technique: 'Techniek',
	core1: 'Kern 1',
	core2: 'Kern 2',
	game: 'Game',
};

export interface TrainingTemplate extends RecordModel {
	name: string;
	type: TrainingType;
	content: string;
	notes: string;
	team: string;
	season: string;
}

export interface TrainingPlan extends RecordModel {
	date: string;
	template: string;
	title: string;
	content: string;
	notes: string;
	team: string;
	season: string;
	expand?: {
		template?: TrainingTemplate;
	};
}

// === Season Periodization ===

export type SeasonPhase = 'preparation' | 'competition_1' | 'winter_break' | 'competition_2' | 'playoffs' | 'off_season';

export const SEASON_PHASE_LABELS: Record<SeasonPhase, string> = {
	preparation: 'Voorbereiding',
	competition_1: 'Competitie 1e helft',
	winter_break: 'Winterstop',
	competition_2: 'Competitie 2e helft',
	playoffs: 'Playoffs / Nacompetitie',
	off_season: 'Rustperiode',
};

export const SEASON_PHASE_COLORS: Record<SeasonPhase, string> = {
	preparation: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
	competition_1: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
	winter_break: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
	competition_2: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
	playoffs: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
	off_season: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
};

// === Questionnaires ===

export type QuestionType = 'text' | 'choice' | 'scale';

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
	text: 'Open tekst',
	choice: 'Meerkeuze',
	scale: 'Schaal',
};

export interface QuestionnaireQuestion {
	id: string;
	type: QuestionType;
	text: string;
	options: string[]; // used for 'choice' (empty for other types)
	scale_min?: number; // for 'scale', default 1
	scale_max?: number; // for 'scale', default 5
}

export type QuestionnaireStatus = 'draft' | 'active' | 'closed';

export const QUESTIONNAIRE_STATUS_LABELS: Record<QuestionnaireStatus, string> = {
	draft: 'Concept',
	active: 'Actief',
	closed: 'Gesloten',
};

export interface Questionnaire extends RecordModel {
	team: string;
	name: string;
	status: QuestionnaireStatus;
	questions: QuestionnaireQuestion[];
	created_by?: string;
	expand?: {
		team?: Team;
		created_by?: { id: string; name: string; email: string };
	};
}

export interface QuestionnaireResponse extends RecordModel {
	questionnaire: string;
	player: string;
	answers: Record<string, string | number>;
	expand?: {
		player?: Player;
		questionnaire?: Questionnaire;
	};
}

export interface SeasonPeriod extends RecordModel {
	name: string;
	phase: SeasonPhase;
	start_date: string;
	end_date: string;
	goals_technical: string;
	goals_tactical: string;
	goals_physical: string;
	goals_mental: string;
	notes: string;
	team: string;
	season: string;
}
