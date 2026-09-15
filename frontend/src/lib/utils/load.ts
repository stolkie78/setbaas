import { pb } from '$lib/pocketbase';
import { EXTRA_ACTIVITY_LABELS } from '$lib/types';
import type { ExtraActivity } from '$lib/types';

/** Fallback voor trainingen zonder ingevulde duur; wedstrijden tellen als vast blok. */
export const TRAINING_HOURS = 1.5;
export const MATCH_HOURS = 1.5;

/** Gemiddeld aantal weken per maand, om de per-week ingestelde extra activiteiten om te rekenen. */
export const WEEKS_PER_MONTH = 52 / 12;

export interface LoadLine {
	label: string;
	detail?: string;
	hours: number;
}

export interface MonthRange {
	/** 0-based month offset from the current month (-1 = vorige maand). */
	offset: number;
	label: string;
	startIso: string;
	endIso: string;
}

export interface PlayerLoad {
	month: MonthRange;
	trainingCount: number;
	trainingAbsences: number;
	trainingHours: number;
	matchCount: number;
	matchAbsences: number;
	matchHours: number;
	extraHoursPerWeek: number;
	extraHours: number;
	totalHours: number;
	lines: LoadLine[];
}

function round(value: number): number {
	return Math.round(value * 10) / 10;
}

export function extraActivityLabel(activity: ExtraActivity, teamNames: Record<string, string> = {}): string {
	const type = EXTRA_ACTIVITY_LABELS[activity.type] || activity.type;
	const team = (activity.team && teamNames[activity.team]) || activity.team_name;
	return team ? `${type} — ${team}` : type;
}

/** Start/eind (als PocketBase-datumstring) en label van een kalendermaand, met een offset t.o.v. nu. */
export function getMonthRange(offset = 0): MonthRange {
	const now = new Date();
	const start = new Date(now.getFullYear(), now.getMonth() + offset, 1, 0, 0, 0);
	const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0, 23, 59, 59);
	const toIso = (d: Date) =>
		`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
	const label = start.toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' });
	return { offset, label, startIso: toIso(start), endIso: toIso(end) };
}

/**
 * Belasting voor één kalendermaand: de geplande uren van teamtrainingen en
 * -wedstrijden, min de uren van trainingen/wedstrijden waar de speler
 * afwezig was, plus de zelf/coach ingestelde extra activiteiten (die per
 * week staan en hier naar deze maand worden omgerekend).
 */
export async function fetchPlayerLoad(
	playerId: string,
	extras: ExtraActivity[],
	options: { teamId?: string; seasonId?: string; monthOffset?: number } = {}
): Promise<PlayerLoad> {
	const month = getMonthRange(options.monthOffset || 0);

	let trainingCount = 0;
	let trainingAbsences = 0;
	let trainingPlannedHours = 0;
	let trainingAbsentHours = 0;
	let matchCount = 0;
	let matchAbsences = 0;

	if (options.teamId) {
		try {
			const filters = [`team = "${options.teamId}"`, `date >= "${month.startIso}"`, `date <= "${month.endIso}"`];
			if (options.seasonId) filters.push(`season = "${options.seasonId}"`);
			const filter = filters.join(' && ');

			const [trainings, matches] = await Promise.all([
				pb.collection('trainings').getFullList({ filter, fields: 'id,duration_minutes' }),
				pb.collection('matches').getFullList({ filter, fields: 'id' }),
			]);
			trainingCount = trainings.length;
			matchCount = matches.length;
			const trainingHoursById = new Map(
				trainings.map((training: any) => [
					training.id,
					round(((Number(training.duration_minutes) || TRAINING_HOURS * 60) / 60)),
				])
			);
			trainingPlannedHours = round([...trainingHoursById.values()].reduce((sum, hours) => sum + hours, 0));

			if (trainingCount > 0) {
				const idFilter = trainings.map((t) => `training = "${t.id}"`).join(' || ');
				const records = await pb.collection('training_attendance').getFullList({
					filter: `player = "${playerId}" && (${idFilter})`,
				});
				// Geen record betekent "normaal aanwezig"; alleen een expliciete
				// niet-aanwezige status telt als afwezigheid.
				const absentRecords = records.filter((r: any) => r.status !== 'present');
				trainingAbsences = absentRecords.length;
				trainingAbsentHours = round(absentRecords.reduce(
					(sum: number, record: any) => sum + (trainingHoursById.get(record.training) || TRAINING_HOURS),
					0
				));
			}
			if (matchCount > 0) {
				const idFilter = matches.map((m) => `match = "${m.id}"`).join(' || ');
				const records = await pb.collection('match_attendance').getFullList({
					filter: `player = "${playerId}" && (${idFilter})`,
				});
				matchAbsences = records.filter((r: any) => r.status !== 'present').length;
			}
		} catch (e) {
			console.error('Failed to load team trainings/matches for load report:', e);
		}
	}

	const teamNames: Record<string, string> = {};
	const teamIds = [...new Set((extras || []).map((e) => e.team).filter(Boolean))] as string[];
	for (const id of teamIds) {
		try {
			const team = await pb.collection('teams').getOne(id);
			teamNames[id] = team.name;
		} catch {
			// Team kan verwijderd zijn; dan valt hij terug op de vrije tekst.
		}
	}

	return buildPlayerLoad({
		month,
		trainingCount,
		trainingAbsences,
		trainingPlannedHours,
		trainingAbsentHours,
		matchCount,
		matchAbsences,
		extras: extras || [],
		teamNames,
	});
}

export function buildPlayerLoad(input: {
	month: MonthRange;
	trainingCount: number;
	trainingAbsences: number;
	trainingPlannedHours?: number;
	trainingAbsentHours?: number;
	matchCount: number;
	matchAbsences: number;
	extras: ExtraActivity[];
	teamNames?: Record<string, string>;
}): PlayerLoad {
	const trainingPlannedHours = input.trainingPlannedHours ?? input.trainingCount * TRAINING_HOURS;
	const trainingAbsentHours = input.trainingAbsentHours ?? input.trainingAbsences * TRAINING_HOURS;
	const trainingHours = trainingPlannedHours - trainingAbsentHours;
	const matchHours = (input.matchCount - input.matchAbsences) * MATCH_HOURS;

	const lines: LoadLine[] = [];
	if (input.trainingCount > 0) {
		lines.push({
			label: 'Teamtrainingen',
			detail: `${input.trainingCount} gepland, ${input.trainingAbsences} afwezig`,
			hours: round(trainingHours),
		});
	}
	if (input.matchCount > 0) {
		lines.push({
			label: 'Wedstrijden',
			detail: `${input.matchCount} gepland, ${input.matchAbsences} afwezig`,
			hours: round(matchHours),
		});
	}

	let extraHoursPerWeek = 0;
	let extraHours = 0;
	for (const extra of input.extras || []) {
		const hoursPerWeek = Number(extra.hours) || 0;
		extraHoursPerWeek += hoursPerWeek;
		const monthly = hoursPerWeek * WEEKS_PER_MONTH;
		extraHours += monthly;
		lines.push({
			label: extraActivityLabel(extra, input.teamNames),
			detail: extra.notes || `${round(hoursPerWeek)} u/wk`,
			hours: round(monthly),
		});
	}

	return {
		month: input.month,
		trainingCount: input.trainingCount,
		trainingAbsences: input.trainingAbsences,
		trainingHours: round(trainingHours),
		matchCount: input.matchCount,
		matchAbsences: input.matchAbsences,
		matchHours: round(matchHours),
		extraHoursPerWeek: round(extraHoursPerWeek),
		extraHours: round(extraHours),
		totalHours: round(trainingHours + matchHours + extraHours),
		lines,
	};
}
