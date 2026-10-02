<script lang="ts">
	import { pb, getFileUrl } from '$lib/pocketbase';
	import { authUser } from '$lib/stores/auth';
	import { currentRole, rolesLoaded } from '$lib/stores/role';
	import type {
		AttendanceStatus,
		Match,
		MatchAttendance,
		Player,
		TeamPlayer,
		Training,
		TrainingAttendance,
	} from '$lib/types';
	import { POSITION_LABELS } from '$lib/types';
	import { getMatchOutcome, getMatchScore, getMatchStatus } from '$lib/utils/match';
	import { CalendarDays, Clock, MapPin } from 'lucide-svelte';

	interface ParentEvent {
		id: string;
		type: 'training' | 'match';
		date: string;
		title: string;
		location?: string;
		attendance?: AttendanceStatus;
	}

	interface ParentPlayerData {
		player: Player;
		teamNames: string[];
		upcoming: ParentEvent[];
		recentMatches: Match[];
		trainingAttendance: AttendanceSummary;
		matchAttendance: AttendanceSummary;
	}

	interface AttendanceSummary {
		attended: number;
		total: number;
		percentage: number | null;
	}

	let children: ParentPlayerData[] = [];
	let loading = true;
	let loadError = '';
	let loadedUserId = '';

	function attendanceLabel(status?: AttendanceStatus): string {
		if (!status) return 'Nog niet doorgegeven';
		if (status === 'present') return 'Aanwezig';
		if (status === 'late') return 'Later';
		return 'Afwezig gemeld';
	}

	function attendanceSummary(total: number, attended: number): AttendanceSummary {
		return {
			attended,
			total,
			percentage: total > 0 ? Math.round((attended / total) * 100) : null,
		};
	}

	$: if ($rolesLoaded && $currentRole === 'parent' && $authUser?.id && $authUser.id !== loadedUserId) {
		loadedUserId = $authUser.id;
		loadParentDashboard($authUser.id);
	}

	async function loadParentDashboard(userId: string) {
		loading = true;
		loadError = '';
		children = [];

		try {
			const linkedPlayers = await pb.collection('players').getFullList<Player>({
				filter: `parent_users.id ?= "${userId}"`,
				sort: 'name',
				fields: 'id,name,photo,position,jersey_number',
			});

			if (linkedPlayers.length === 0) return;

			const playerIds = linkedPlayers.map((player) => player.id);
			const rosterFilter = playerIds.map((id) => `player = "${id}"`).join(' || ');
			const roster = await pb.collection('team_players').getFullList<TeamPlayer>({
				filter: rosterFilter,
				expand: 'team,season',
			});

			const trainingAttendanceByPlayer = new Map<string, Map<string, AttendanceStatus>>();
			const matchAttendanceByPlayer = new Map<string, Map<string, AttendanceStatus>>();
			await Promise.all(linkedPlayers.map(async (player) => {
				const [trainingAttendance, matchAttendance] = await Promise.all([
					pb.collection('training_attendance').getFullList<TrainingAttendance>({
						filter: `player = "${player.id}"`,
						fields: 'id,player,training,status',
					}),
					pb.collection('match_attendance').getFullList<MatchAttendance>({
						filter: `player = "${player.id}"`,
						fields: 'id,player,match,status',
					}),
				]);
				trainingAttendanceByPlayer.set(
					player.id,
					new Map(trainingAttendance.map((item) => [item.training, item.status])),
				);
				matchAttendanceByPlayer.set(
					player.id,
					new Map(matchAttendance.map((item) => [item.match, item.status])),
				);
			}));

			const today = new Date().toISOString().slice(0, 10);
			const data = await Promise.all(linkedPlayers.map(async (player) => {
				const assignments = roster.filter((item) => item.player === player.id);
				const teamNames = [...new Set(assignments.map((item) => item.expand?.team?.name).filter((name): name is string => !!name))];
				const pairs = [...new Map(assignments.map((item) => [
					`${item.team}:${item.season}`,
					{ team: item.team, season: item.season },
				])).values()];

				const teamEvents = await Promise.all(pairs.map(async ({ team, season }) => {
					const scope = [`team = "${team}"`, `season = "${season}"`].join(' && ');
					const [trainings, matches, closedTrainings, previousMatches] = await Promise.all([
						pb.collection('trainings').getFullList<Training>({
							filter: `${scope} && date >= "${today}" && status != "closed"`,
							sort: 'date',
							fields: 'id,date,location',
						}),
						pb.collection('matches').getFullList<Match>({
							filter: `${scope} && date >= "${today}"`,
							sort: 'date',
							fields: 'id,date,opponent,location,home_away,status,score_team,score_opponent,set_scores',
						}),
						pb.collection('trainings').getFullList<Training>({
							filter: `${scope} && status = "closed"`,
							fields: 'id',
						}),
						pb.collection('matches').getFullList<Match>({
							filter: `${scope} && date < "${today}"`,
							sort: '-date',
							fields: 'id,date,opponent,home_away,status,score_team,score_opponent,set_scores',
						}),
					]);

					return { trainings, matches, closedTrainings, previousMatches };
				}));

				const trainingAttendance = trainingAttendanceByPlayer.get(player.id) || new Map();
				const matchAttendance = matchAttendanceByPlayer.get(player.id) || new Map();
				const pastTrainings = [...new Map(
					teamEvents.flatMap(({ closedTrainings }) => closedTrainings).map((training) => [training.id, training]),
				).values()];
				const playedMatches = [...new Map(
					teamEvents.flatMap(({ previousMatches }) => previousMatches)
						.filter((match) => getMatchStatus(match) === 'played')
						.map((match) => [match.id, match]),
				).values()];
				const trainingAttendanceSummary = attendanceSummary(
					pastTrainings.length,
					pastTrainings.filter((training) => trainingAttendance.get(training.id) === 'present').length,
				);
				const matchAttendanceSummary = attendanceSummary(
					playedMatches.length,
					playedMatches.filter((match) => matchAttendance.get(match.id) === 'present').length,
				);
				const upcoming: ParentEvent[] = teamEvents.flatMap(({ trainings, matches }) => [
					...trainings.map((training) => ({
						id: training.id,
						type: 'training' as const,
						date: training.date,
						title: 'Training',
						location: training.location,
						attendance: trainingAttendance.get(training.id),
					})),
					...matches.map((match) => ({
						id: match.id,
						type: 'match' as const,
						date: match.date,
						title: `${match.opponent} (${match.home_away === 'home' ? 'thuis' : 'uit'})`,
						location: match.location,
						attendance: matchAttendance.get(match.id),
					})),
				]).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).slice(0, 6);

				const recentMatches = playedMatches
					.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
					.slice(0, 3);

				return {
					player,
					teamNames,
					upcoming,
					recentMatches,
					trainingAttendance: trainingAttendanceSummary,
					matchAttendance: matchAttendanceSummary,
				};
			}));

			children = data;
		} catch (error) {
			console.error('Failed to load parent dashboard:', error);
			loadError = 'De gegevens konden niet worden geladen. Probeer de pagina opnieuw te laden.';
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>SetBaas - Ouderdashboard</title>
</svelte:head>

<div class="space-y-5">
	<div>
		<h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">Ouderdashboard</h1>
		<p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
			Informatie over de spelers die aan jouw account zijn gekoppeld.
		</p>
	</div>

	{#if loading}
		<div class="flex justify-center py-12">
			<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
		</div>
	{:else if loadError}
		<div class="card text-center py-8 text-red-600 dark:text-red-400">{loadError}</div>
	{:else if children.length === 0}
		<div class="card text-center py-10">
			<p class="text-4xl mb-3">👨‍👩‍👧</p>
			<h2 class="font-semibold text-gray-900 dark:text-gray-100">Nog geen speler gekoppeld</h2>
			<p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
				Vraag de clubbeheerder om jouw ouderaccount aan een of meer spelers te koppelen.
			</p>
		</div>
	{:else}
		{#each children as child (child.player.id)}
			<section class="card space-y-4">
				<div class="flex items-center gap-3">
					<div class="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-100 dark:bg-primary-900/40">
						{#if child.player.photo}
							<img src={getFileUrl(child.player, child.player.photo)} alt={child.player.name} class="h-full w-full object-cover" />
						{:else}
							<span class="text-xl font-bold text-primary-600 dark:text-primary-400">{child.player.name.charAt(0).toUpperCase()}</span>
						{/if}
					</div>
					<div class="min-w-0 flex-1">
						<h2 class="truncate text-lg font-semibold text-gray-900 dark:text-gray-100">{child.player.name}</h2>
						<p class="text-sm text-gray-500 dark:text-gray-400">
							{#if child.player.jersey_number}#{child.player.jersey_number} · {/if}
							{(child.player.position || []).map((position) => POSITION_LABELS[position] || position).join(', ') || 'Speler'}
						</p>
						{#if child.teamNames.length > 0}
							<p class="text-xs text-gray-400 dark:text-gray-500">{child.teamNames.join(', ')}</p>
						{/if}
					</div>
				</div>

				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
					{#each [
						{ label: 'Trainingsaanwezigheid', summary: child.trainingAttendance },
						{ label: 'Wedstrijdaanwezigheid', summary: child.matchAttendance },
					] as item (item.label)}
						<div class="rounded-xl bg-gray-50 p-4 dark:bg-gray-800/60">
							<div class="text-sm font-medium text-gray-600 dark:text-gray-300">{item.label}</div>
							{#if item.summary.percentage === null}
								<p class="mt-2 text-sm text-gray-500 dark:text-gray-400">Nog geen afgeronde activiteiten</p>
							{:else}
								<div class="mt-1 flex items-baseline justify-between gap-2">
									<span class="text-2xl font-bold text-primary-600 dark:text-primary-400">{item.summary.percentage}%</span>
									<span class="text-xs text-gray-500 dark:text-gray-400">
										{item.summary.attended} van {item.summary.total} aanwezig
									</span>
								</div>
								<div class="mt-2 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
									<div
										class="h-full rounded-full bg-primary-500"
										style={`width: ${item.summary.percentage}%`}
									></div>
								</div>
							{/if}
						</div>
					{/each}
				</div>

				<div class="border-t border-gray-100 pt-4 dark:border-gray-700">
					<h3 class="mb-3 font-semibold text-gray-800 dark:text-gray-200">Komende activiteiten</h3>
					{#if child.upcoming.length === 0}
						<p class="text-sm text-gray-500 dark:text-gray-400">Er zijn nog geen komende trainingen of wedstrijden gepland.</p>
					{:else}
						<div class="space-y-3">
							{#each child.upcoming as event (event.type + event.id)}
								<div class="rounded-xl bg-gray-50 p-3 dark:bg-gray-800/60">
									<div class="flex flex-wrap items-start justify-between gap-2">
										<div class="font-medium text-gray-900 dark:text-gray-100">{event.title}</div>
										{#if event.attendance}
											<span class="rounded-full bg-primary-100 px-2 py-0.5 text-xs text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
												{attendanceLabel(event.attendance)}
											</span>
										{:else}
											<span class="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300">Nog niet doorgegeven</span>
										{/if}
									</div>
									<div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
										<span class="inline-flex items-center gap-1">
											<CalendarDays size={14} />
											{new Date(event.date).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })}
										</span>
										<span class="inline-flex items-center gap-1">
											<Clock size={14} />
											{new Date(event.date).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', hour12: false })}
										</span>
										{#if event.location}
											<span class="inline-flex items-center gap-1"><MapPin size={14} /> {event.location}</span>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>

				{#if child.recentMatches.length > 0}
					<div class="border-t border-gray-100 pt-4 dark:border-gray-700">
						<h3 class="mb-3 font-semibold text-gray-800 dark:text-gray-200">Recente uitslagen</h3>
						<div class="space-y-2">
							{#each child.recentMatches as match (match.id)}
								{@const outcome = getMatchOutcome(match)}
								{@const score = getMatchScore(match)}
								<div class="flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-800/60">
									<div class="min-w-0">
										<p class="truncate text-sm font-medium text-gray-800 dark:text-gray-200">{match.opponent}</p>
										<p class="text-xs text-gray-500 dark:text-gray-400">
											{new Date(match.date).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}
											· {match.home_away === 'home' ? 'Thuis' : 'Uit'}
										</p>
									</div>
									<span class="shrink-0 font-semibold {outcome === 'won' ? 'text-green-600 dark:text-green-400' : outcome === 'lost' ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-300'}">
										{score.ourSets} - {score.theirSets}
									</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			</section>
		{/each}
	{/if}
</div>
