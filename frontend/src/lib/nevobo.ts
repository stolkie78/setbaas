// Nevobo API helper for fetching match schedules
// All requests go through /api/nevobo proxy to avoid CORS issues
import { base } from '$app/paths';

async function nevoboFetch(path: string): Promise<Response> {
	return fetch(`${base}/api/nevobo?path=${encodeURIComponent(path)}`);
}

export interface NevoboSetstand {
	set: number;
	/** Points for teams[0] (the home team on the scoresheet) */
	puntenA: number | null;
	/** Points for teams[1] (the away team on the scoresheet) */
	puntenB: number | null;
}

export interface NevoboMatch {
	uuid: string;
	code: string;
	datum: string;
	tijdstip: string;
	sporthal: string;
	poule: string;
	teams: string[];
	status: { waarde: string; omschrijving: string };
	urlDwf?: string;
	setstanden?: NevoboSetstand[];
	/** Final set score as [teams[0], teams[1]], e.g. [1, 3] */
	eindstand?: number[];
	/** Human readable result, e.g. "1-3  (14-25, 25-23, 17-25, 14-25)" */
	volledigeUitslag?: string;
}

/** Normalised Nevobo result, always home-first (scoresheet order). */
export interface NevoboResult {
	homeSets: number;
	awaySets: number;
	sets: { set: number; home: number | null; away: number | null }[];
}

function toNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Extract the result of a Nevobo match, if it has been played.
 * Nevobo reports points as puntenA/puntenB and the final score as
 * eindstand [A, B], where A = teams[0] (home) and B = teams[1] (away).
 */
export function getNevoboResult(match: NevoboMatch): NevoboResult | null {
	const sets = (match.setstanden ?? [])
		.map((s, i) => ({
			set: toNumber(s?.set) ?? i + 1,
			home: toNumber(s?.puntenA),
			away: toNumber(s?.puntenB),
		}))
		.filter((s) => s.home !== null || s.away !== null)
		.sort((a, b) => a.set - b.set);

	const eindstandHome = toNumber(match.eindstand?.[0]);
	const eindstandAway = toNumber(match.eindstand?.[1]);

	if (eindstandHome !== null && eindstandAway !== null) {
		return { homeSets: eindstandHome, awaySets: eindstandAway, sets };
	}

	// Fall back on counting the sets when Nevobo omits the final score.
	const decided = sets.filter((s) => s.home !== null && s.away !== null && s.home !== s.away);
	if (decided.length === 0) return null;

	const homeSets = decided.filter((s) => (s.home as number) > (s.away as number)).length;
	return { homeSets, awaySets: decided.length - homeSets, sets };
}

/** "1 - 3" in scoresheet order, or '' when the match has no result yet. */
export function formatNevoboResult(match: NevoboMatch): string {
	const result = getNevoboResult(match);
	return result ? `${result.homeSets} - ${result.awaySets}` : '';
}

export interface NevoboTeam {
	uuid: string;
	naam: string;
	seizoen: string;
	vereniging: string;
	volgnummer: number;
}

export interface NevoboPouleIndeling {
	team: string;
	omschrijving: string;
	indelingsletter: string;
}

/** The three parts that identify a team in the Nevobo API. */
export interface NevoboTeamRef {
	code: string;
	teamType: string;
	teamNumber: number;
}

/**
 * Parse a volleybal.nl team URL into its Nevobo parts.
 * Expected shape: https://www.volleybal.nl/competitie/vereniging/{code}/{type}/{number}
 */
export function parseNevoboTeamUrl(url?: string | null): NevoboTeamRef | null {
	if (!url) return null;
	const match = url.trim().match(/\/vereniging\/([^/?#]+)\/([^/?#]+)\/(\d+)/i);
	if (!match) return null;

	const number = parseInt(match[3], 10);
	if (!Number.isFinite(number) || number < 1) return null;

	return { code: match[1].toLowerCase(), teamType: match[2].toLowerCase(), teamNumber: number };
}

/**
 * Get matches for a team using the Nevobo team IRI filter
 * @param code - Verenigingscode (e.g. CKL9N3N)
 * @param teamType - Team type slug (e.g. meiden-b, heren, dames)
 * @param teamNumber - Team number (e.g. 1)
 */
export async function getTeamMatches(
	code: string,
	teamType: string,
	teamNumber: number
): Promise<NevoboMatch[]> {
	const path = `/competitie/wedstrijden?team=${encodeURIComponent(`/competitie/teams/${code.toLowerCase()}/${teamType}/${teamNumber}`)}`;
	const res = await nevoboFetch(path);
	if (!res.ok) return [];
	return res.json();
}

/**
 * Resolve a pouleindeling IRI to get the team name
 */
export async function resolvePouleIndeling(iri: string): Promise<string> {
	try {
		const res = await nevoboFetch(iri);
		if (!res.ok) return '?';
		const data: NevoboPouleIndeling = await res.json();
		return data.omschrijving || '?';
	} catch {
		return '?';
	}
}

/**
 * Resolve sporthal name from IRI
 */
export async function resolveSporthal(iri: string): Promise<string> {
	if (!iri) return '';
	try {
		const res = await nevoboFetch(iri);
		if (!res.ok) return '';
		const data = await res.json();
		return data.naam || '';
	} catch {
		return '';
	}
}

/**
 * Get team info by code/type/number
 */
export async function getTeamInfo(code: string, teamType: string, teamNumber: number): Promise<NevoboTeam | null> {
	try {
		const res = await nevoboFetch(`/competitie/teams/${code.toLowerCase()}/${teamType}/${teamNumber}`);
		if (!res.ok) return null;
		return res.json();
	} catch {
		return null;
	}
}
