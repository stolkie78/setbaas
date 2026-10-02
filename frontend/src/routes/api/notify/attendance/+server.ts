import type { RequestHandler } from './$types';
import { base } from '$app/paths';
import { getAdminToken, pbUrl } from '$lib/server/pbAdmin';
import { jsonError } from '$lib/server/clubAuth';
import { deliverMessage, type Recipient } from '$lib/server/messages';

const ID_RE = /^[a-z0-9]{15}$/;

const STATUS_LABELS: Record<string, string> = {
	present: 'Aanwezig',
	sick: 'Ziek',
	school: 'School',
	absent: 'Afwezig',
	late: 'Later',
	injured: 'Geblesseerd'
};

// Changes for events that are already well underway or finished are not news.
const PAST_GRACE_MS = 2 * 60 * 60 * 1000;

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function adminGet(adminToken: string, path: string, params: Record<string, string> = {}) {
	const url = new URL(`${pbUrl()}/api/collections/${path}`);
	for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
	const res = await fetch(url, { headers: { Authorization: adminToken } });
	if (!res.ok) return null;
	return res.json();
}

async function listAll(adminToken: string, collection: string, filter: string) {
	const data = await adminGet(adminToken, `${collection}/records`, { filter, perPage: '200' });
	return (data?.items ?? []) as any[];
}

function formatWhen(date: string): string {
	return new Date(date.replace(' ', 'T')).toLocaleString('nl-NL', {
		timeZone: 'Europe/Amsterdam',
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		hour: '2-digit',
		minute: '2-digit'
	});
}

/**
 * The trainers linked to the event (training.trainer / match.coach). When none
 * are set, fall back to the trainers of the team: club_access trainers whose
 * default team is this team, plus legacy team_access trainers.
 */
async function findTrainers(adminToken: string, event: any, type: 'training' | 'match', team: any): Promise<string[]> {
	const direct: string[] = (type === 'training' ? event.trainer : event.coach) ?? [];
	if (direct.length > 0) return direct;

	const ids = new Set<string>();
	if (team?.club) {
		const clubTrainers = await listAll(
			adminToken,
			'club_access',
			`club = "${team.club}" && is_trainer = true && default_team = "${team.id}"`
		);
		clubTrainers.forEach((a) => ids.add(a.user));
	}
	if (team?.id) {
		const teamTrainers = await listAll(adminToken, 'team_access', `team = "${team.id}" && is_trainer = true`);
		teamTrainers.forEach((a) => ids.add(a.user));
	}
	return [...ids];
}

/**
 * Called by the player dashboard after a player (or their parent) changed
 * their own attendance. Reads the stored status itself — the browser only says
 * *which* record changed — and notifies the trainers when it turned into an
 * absence, or when an earlier absence was withdrawn.
 */
export const POST: RequestHandler = async ({ request, url }) => {
	const authHeader = request.headers.get('Authorization');
	if (!authHeader) return jsonError('Niet ingelogd', 401);

	const { type, eventId, playerId } = await request.json().catch(() => ({}));
	if ((type !== 'training' && type !== 'match') || !ID_RE.test(eventId ?? '') || !ID_RE.test(playerId ?? '')) {
		return jsonError('Ongeldig verzoek', 400);
	}

	const me = await fetch(`${pbUrl()}/api/collections/users/auth-refresh`, {
		method: 'POST',
		headers: { Authorization: authHeader }
	});
	if (!me.ok) return jsonError('Niet ingelogd', 401);
	const caller = (await me.json())?.record;
	if (!caller?.id) return jsonError('Niet ingelogd', 401);

	let adminToken: string;
	try {
		adminToken = await getAdminToken();
	} catch (e) {
		return jsonError(`${e}`, 500);
	}

	const player = await adminGet(adminToken, `players/records/${playerId}`);
	if (!player) return jsonError('Speler niet gevonden', 404);
	const isSelf = player.user_id === caller.id;
	const isParent = (player.parent_users ?? []).includes(caller.id);
	if (!isSelf && !isParent) return jsonError('Geen toegang', 403);

	const eventCollection = type === 'training' ? 'trainings' : 'matches';
	const event = await adminGet(adminToken, `${eventCollection}/records/${eventId}`);
	if (!event) return jsonError('Niet gevonden', 404);
	if (new Date(event.date.replace(' ', 'T')).getTime() < Date.now() - PAST_GRACE_MS) {
		return json({ notified: 0, reason: 'past' });
	}

	const attendance = (
		await listAll(adminToken, `${type}_attendance`, `player = "${playerId}" && ${type} = "${eventId}"`)
	)[0];
	const status: string = attendance?.status || 'present';
	const reason: string = (attendance?.reason || '').trim();

	const ref = `${type}:${eventId}:${playerId}`;
	const last = await adminGet(adminToken, 'messages/records', {
		filter: `ref = "${ref}"`,
		sort: '-created',
		perPage: '1'
	});
	const lastStatus: string | undefined = last?.items?.[0]?.ref_status;

	let kind: 'absence' | 'attendance_restored';
	if (status !== 'present') {
		if (lastStatus === status) return json({ notified: 0, reason: 'unchanged' });
		kind = 'absence';
	} else {
		// Only worth a message when the trainers were told about an absence before.
		if (!lastStatus || lastStatus === 'present') return json({ notified: 0, reason: 'unchanged' });
		kind = 'attendance_restored';
	}

	const team = event.team ? await adminGet(adminToken, `teams/records/${event.team}`) : null;
	const trainerIds = (await findTrainers(adminToken, event, type, team)).filter(
		(id) => ID_RE.test(id) && id !== caller.id
	);
	if (trainerIds.length === 0) return json({ notified: 0, reason: 'no_trainers' });

	const recipients: Recipient[] = await listAll(
		adminToken,
		'users',
		trainerIds.map((id) => `id = "${id}"`).join(' || ')
	);

	const eventLabel = type === 'training' ? 'training' : `wedstrijd tegen ${event.opponent || 'onbekend'}`;
	const when = formatWhen(event.date);
	const teamName = team?.name ? ` (${team.name})` : '';
	const actor = isSelf ? '' : `\nDoorgegeven door ${caller.name || caller.email} (ouder).`;
	const statusLabel = STATUS_LABELS[status] ?? status;
	const subject =
		kind === 'absence'
			? `Afmelding ${player.name}: ${statusLabel} bij ${eventLabel} op ${when}`
			: `${player.name} is er toch bij: ${eventLabel} op ${when}`;
	const body =
		kind === 'absence'
			? `${player.name} heeft zich afgemeld voor de ${eventLabel}${teamName} op ${when}.\nStatus: ${statusLabel}${reason ? `\nReden: ${reason}` : ''}${actor}`
			: `${player.name} heeft de eerdere afmelding ingetrokken en is weer aanwezig bij de ${eventLabel}${teamName} op ${when}.${actor}`;

	const link = `${url.origin}${base}/${eventCollection}/${eventId}`;

	const result = await deliverMessage(adminToken, recipients, {
		kind,
		subject,
		body,
		link,
		sender: caller.id,
		club: team?.club || undefined,
		team: event.team || undefined,
		player: playerId,
		training: type === 'training' ? eventId : undefined,
		match: type === 'match' ? eventId : undefined,
		ref,
		ref_status: status
	});

	return json({ notified: result.delivered, emailed: result.emailed });
};
