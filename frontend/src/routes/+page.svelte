<script lang="ts">
	import { base } from '$app/paths';
	import { getContextPlayers } from '$lib/pocketbase';
	import { pb } from '$lib/pocketbase';
	import type { Player, Training, Match, TrainingAttendance, MatchAttendance } from '$lib/types';
	import { getMatchStatus, isMatchFinished } from '$lib/utils/match';
	import { currentClub, currentSeason, currentTeam, selectedTeamId, selectedSeasonId } from '$lib/stores/context';
	import { contextFilter } from '$lib/stores/context';
	import { currentRole, canEdit } from '$lib/stores/role';
	import { marked } from 'marked';
	import PlayerDashboard from '$lib/components/PlayerDashboard.svelte';
	import ParentDashboard from '$lib/components/ParentDashboard.svelte';
	import { browser } from '$app/environment';
	import {
		CalendarDays,
		CircleCheck,
		ClipboardPenLine,
		Clock,
		Building2,
		Dumbbell,
		Eye,
		MapPin,
		Pencil,
		Play,
		UserRound,
		Users,
		Volleyball,
	} from 'lucide-svelte';

	let players: Player[] = [];
	let trainings: Training[] = [];
	let matches: Match[] = [];
	let loading = true;
	let lightboxTraining: Training | null = null;

	// Attendance per training: { trainingId: { present: N, total: N } }
	let attendanceCounts: Record<string, { present: number; total: number }> = {};
	// Attendance per match: { matchId: { present: N, total: N } }
	let matchAttendanceCounts: Record<string, { present: number; total: number }> = {};

	function printTraining(training: Training) {
		const date = new Date(training.date).toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
		const html = `<!DOCTYPE html><html><head><title>Training ${date}</title><style>body{font-family:sans-serif;max-width:700px;margin:0 auto;padding:20px}h1{font-size:1.3em;border-bottom:2px solid #2563eb;padding-bottom:8px}h2{font-size:1.1em;margin-top:16px}</style></head><body><h1>🏐 Training ${date}</h1>${marked(training.content || '', { breaks: true })}</body></html>`;
		const w = window.open('', '_blank');
		if (w) { w.document.write(html); w.document.close(); w.print(); }
	}

	// Matches whose record still has to be completed
	$: upcomingMatches = matches
		.filter(m => getMatchStatus(m) === 'open')
		.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
		.slice(0, 5);

	$: playedMatchCount = matches.filter(m => getMatchStatus(m) === 'played').length;
	$: plannedMatchCount = matches.filter(m => getMatchStatus(m) === 'open').length;

	$: activeTraining = trainings.find(t => t.status === 'active') || null;

	$: openTrainings = trainings
		.filter(t => t.status === 'open')
		.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
		.slice(0, 5);

	$: closedTrainingCount = trainings.filter(t => t.status === 'closed').length;
	$: plannedTrainingCount = trainings.filter(t => t.status === 'open' || t.status === 'active').length;

	// Reactive: reload when context stores change (fixes empty data after login)
	$: if (browser) loadDashboard($selectedTeamId, $selectedSeasonId);

	async function loadDashboard(_teamId: string | null, _seasonId: string | null) {
		const teamId = _teamId ?? '';
		const seasonId = _seasonId ?? '';
		try {
			const filter = contextFilter(teamId, seasonId);
			[players, trainings, matches] = await Promise.all([
				getContextPlayers(teamId, seasonId, { activeOnly: true }),
				pb.collection('trainings').getFullList<Training>({ sort: '-date', filter: filter || undefined, expand: 'trainer' }),
				pb.collection('matches').getFullList<Match>({ sort: '-date', filter: filter || undefined, expand: 'coach' }),
			]);

			// Load attendance counts for all trainings
			attendanceCounts = {};
			const allAttendance = await pb.collection('training_attendance').getFullList<TrainingAttendance>({ fields: 'training,status' });
			for (const a of allAttendance) {
				if (!attendanceCounts[a.training]) attendanceCounts[a.training] = { present: 0, total: 0 };
				attendanceCounts[a.training].total++;
				if (a.status === 'present') attendanceCounts[a.training].present++;
			}
			attendanceCounts = attendanceCounts;

			// Load attendance counts for all matches
			matchAttendanceCounts = {};
			const allMatchAttendance = await pb.collection('match_attendance').getFullList<MatchAttendance>({ fields: 'match,status' });
			for (const a of allMatchAttendance) {
				if (!matchAttendanceCounts[a.match]) matchAttendanceCounts[a.match] = { present: 0, total: 0 };
				matchAttendanceCounts[a.match].total++;
				if (a.status === 'present') matchAttendanceCounts[a.match].present++;
			}
			matchAttendanceCounts = matchAttendanceCounts;
		} catch (e) {
			console.error('Failed to load dashboard data:', e);
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>SetBaas - Dashboard</title>
</svelte:head>

{#if $currentRole === 'player'}
	<PlayerDashboard />
{:else if $currentRole === 'parent'}
	<ParentDashboard />
{:else if loading}
	<div class="flex justify-center py-12">
		<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
	</div>
{:else}
	<div class="space-y-6">
		<!-- Team context -->
		<div class="card w-full">
			<div class="grid grid-cols-2 gap-5 md:grid-cols-4 md:divide-x md:divide-gray-200 md:dark:divide-gray-700">
				<div class="min-w-0">
					<div class="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
						<Building2 size={15} />
						Club
					</div>
					<div class="truncate text-xl font-bold text-gray-900 dark:text-gray-100 md:text-2xl">
						{$currentClub?.name || 'Geen club'}
					</div>
				</div>
				<div class="min-w-0 md:pl-5">
					<div class="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Team</div>
					<div class="truncate text-xl font-bold text-gray-900 dark:text-gray-100 md:text-2xl">
						{$currentTeam?.name || 'Geen team'}
					</div>
				</div>
				<div class="min-w-0 md:pl-5">
					<div class="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Seizoen</div>
					<div class="truncate text-xl font-bold text-gray-900 dark:text-gray-100 md:text-2xl">
						{$currentSeason?.name || 'Geen seizoen'}
					</div>
				</div>
				<div class="min-w-0 md:pl-5">
					<div class="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
						<Users size={15} />
						Spelers
					</div>
					<div class="text-xl font-bold text-primary-600 md:text-2xl">{players.length}</div>
				</div>
			</div>
		</div>

		<!-- Quick Stats -->
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
			<div class="card text-center py-6">
				<div class="grid grid-cols-2 divide-x divide-gray-200 dark:divide-gray-700">
					<div>
						<div class="text-3xl md:text-4xl font-bold text-green-600">{closedTrainingCount}</div>
						<div class="text-xs text-gray-500 dark:text-gray-400 mt-1">Afgerond</div>
					</div>
					<div>
						<div class="text-3xl md:text-4xl font-bold text-amber-600">{plannedTrainingCount}</div>
						<div class="text-xs text-gray-500 dark:text-gray-400 mt-1">Gepland</div>
					</div>
				</div>
				<div class="text-sm font-medium text-gray-700 dark:text-gray-300 mt-3">Trainingen</div>
			</div>
			<div class="card text-center py-6">
				<div class="grid grid-cols-2 divide-x divide-gray-200 dark:divide-gray-700">
					<div>
						<div class="text-3xl md:text-4xl font-bold text-green-600">{playedMatchCount}</div>
						<div class="text-xs text-gray-500 dark:text-gray-400 mt-1">Gespeeld</div>
					</div>
					<div>
						<div class="text-3xl md:text-4xl font-bold text-amber-600">{plannedMatchCount}</div>
						<div class="text-xs text-gray-500 dark:text-gray-400 mt-1">Gepland</div>
					</div>
				</div>
				<div class="text-sm font-medium text-gray-700 dark:text-gray-300 mt-3">Wedstrijden</div>
			</div>
		</div>

		<!-- Quick Actions -->
		{#if $canEdit}
			<div class="grid grid-cols-2 gap-3">
				<a href="{base}/trainings/new" class="btn-primary text-center text-base py-4">
					Nieuwe training
				</a>
				<a href="{base}/matches/new" class="btn-primary text-center text-base py-4">
					Nieuwe wedstrijd
				</a>
			</div>
		{/if}

		<!-- Trainingen + Wedstrijden: side by side on tablet+ -->
		<div class="grid grid-cols-1 md:grid-cols-2 gap-6">

		<!-- Trainingen -->
		{#if activeTraining || openTrainings.length > 0 || closedTrainingCount > 0}
			<div class="card">
				<div class="flex justify-between items-center mb-4">
					<h2 class="flex items-center gap-2 font-semibold text-gray-900 dark:text-gray-100">
						<Dumbbell size={20} strokeWidth={2} class="text-primary-600 dark:text-primary-400" />
						Trainingen
					</h2>
					<a href="{base}/trainings" class="text-sm text-primary-600 hover:underline">Alles</a>
				</div>
				<div class="space-y-3">
					<!-- Actieve training -->
					{#if activeTraining}
						{@const att = attendanceCounts[activeTraining.id]}
						<div class="rounded-xl border-2 border-green-500 bg-green-50 dark:bg-green-900/20 p-4 relative overflow-hidden">
							<div class="absolute top-0 right-0 px-2 py-0.5 bg-green-500 text-white text-[10px] font-bold rounded-bl-lg">LIVE</div>
							<div>
								<div>
									<a href="{base}/trainings/{activeTraining.id}" class="text-sm font-semibold text-green-700 dark:text-green-400 hover:text-green-800 dark:hover:text-green-300 capitalize">
										{new Date(activeTraining.date).toLocaleDateString('nl-NL', { weekday: 'long' })}
									</a>
									{#if att}
										<span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-800 dark:text-green-300 ml-2">
											<Users size={14} />
											{att.present}/{att.total}
										</span>
									{/if}
									{#if $canEdit}
										<a
											href="{base}/trainings/{activeTraining.id}/edit?returnTo={base}/"
											class="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-lg text-green-700 transition-colors hover:bg-green-100 hover:text-green-900 dark:text-green-400 dark:hover:bg-green-800/60 dark:hover:text-green-200"
											title="Training bewerken"
											aria-label="Training bewerken"
										>
											<Pencil size={15} />
										</a>
									{/if}
								</div>
							</div>
							<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600 dark:text-gray-300 mt-1">
								<span class="inline-flex items-center gap-1 text-sm font-semibold text-green-700 dark:text-green-400">
									<CalendarDays size={16} />
									{new Date(activeTraining.date).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })}
								</span>
								<span class="inline-flex items-center gap-1 text-sm font-semibold text-green-700 dark:text-green-400">
									<Clock size={16} />
									{new Date(activeTraining.date).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', hour12: false })}
								</span>
								{#if activeTraining.expand?.trainer && activeTraining.expand.trainer.length > 0}
									<span class="inline-flex items-center gap-1">
										<UserRound size={15} />
										{activeTraining.expand.trainer.map(t => t.name).join(', ')}
									</span>
								{/if}
								{#if activeTraining.location}
									<span class="inline-flex items-center gap-1">
										<MapPin size={15} />
										{activeTraining.location}
									</span>
								{/if}
							</div>
							<div class="grid gap-4 mt-3 {$canEdit ? 'grid-cols-2' : 'grid-cols-1'}">
								{#if activeTraining.content}
									<button
										on:click={() => lightboxTraining = activeTraining}
										class="inline-flex w-full items-center justify-center gap-3 rounded-xl bg-blue-600 px-3 py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-blue-700"
									>
										Bekijken
										<Eye size={20} />
									</button>
								{:else}
									<a
										href="{base}/trainings/{activeTraining.id}"
										class="inline-flex w-full items-center justify-center gap-3 rounded-xl bg-blue-600 px-3 py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-blue-700"
									>
										Bekijken
										<Eye size={20} />
									</a>
								{/if}
								{#if $canEdit}
									<a
										href="{base}/trainings/{activeTraining.id}/checkout"
										class="inline-flex w-full items-center justify-center gap-3 rounded-xl bg-red-600 px-3 py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-red-700"
									>
										Afronden
										<CircleCheck size={20} />
									</a>
								{/if}
							</div>
						</div>
					{/if}

					<!-- Geplande trainingen -->
					{#each openTrainings as training, i}
						{@const att = attendanceCounts[training.id]}
						{@const isNext = i === 0}
						{@const isPrepared = Boolean(training.content?.trim())}
						<div class="rounded-xl p-4 {isNext ? 'border-2 border-primary-500 dark:border-primary-400 bg-primary-50/50 dark:bg-primary-900/15 ring-1 ring-primary-200 dark:ring-primary-800' : 'border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/10'}">
							<div>
								<div>
									<a href="{base}/trainings/{training.id}" class="text-sm font-medium text-gray-800 dark:text-gray-200 hover:text-primary-600 capitalize">
										{new Date(training.date).toLocaleDateString('nl-NL', { weekday: 'long' })}
									</a>
									{#if att}
										<span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 ml-2">
											<Users size={14} />
											{att.present}/{att.total}
										</span>
									{/if}
									{#if $canEdit}
										<a
											href="{base}/trainings/{training.id}/edit?returnTo={base}/"
											class="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-primary-600 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-primary-400"
											title="Training bewerken"
											aria-label="Training bewerken"
										>
											<Pencil size={15} />
										</a>
									{/if}
								</div>
							</div>
							<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400 mt-1">
								<span class="inline-flex items-center gap-1">
									<CalendarDays size={16} />
									{new Date(training.date).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })}
								</span>
								<span class="inline-flex items-center gap-1">
									<Clock size={16} />
									{new Date(training.date).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', hour12: false })}
								</span>
								{#if training.expand?.trainer && training.expand.trainer.length > 0}
									<span class="inline-flex items-center gap-1">
										<UserRound size={15} />
										{training.expand.trainer.map(t => t.name).join(', ')}
									</span>
								{/if}
								{#if training.location}
									<span class="inline-flex items-center gap-1">
										<MapPin size={15} />
										{training.location}
									</span>
								{/if}
							</div>
							<div class="grid gap-4 mt-3 {$canEdit ? 'grid-cols-2' : 'grid-cols-1'}">
								{#if training.content}
									<button
										on:click={() => lightboxTraining = training}
										class="inline-flex w-full items-center justify-center gap-3 rounded-xl px-3 py-3 text-center text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors"
									>
										Bekijken
										<Eye size={20} />
									</button>
								{:else}
									<a
										href="{base}/trainings/{training.id}"
										class="inline-flex w-full items-center justify-center gap-3 rounded-xl px-3 py-3 text-center text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors"
									>
										Bekijken
										<Eye size={20} />
									</a>
								{/if}
								{#if $canEdit}
								<a
									href="{base}/trainings/{training.id}/checkin"
									class="inline-flex w-full items-center justify-center gap-3 rounded-xl px-3 py-3 text-center text-sm font-semibold text-white transition-colors {
										isPrepared
											? 'bg-red-600 hover:bg-red-700'
											: 'bg-gray-500 hover:bg-gray-600'
									}"
								>
									Start
									<Play size={20} />
								</a>
								{/if}
							</div>
						</div>
					{/each}

					<!-- Link naar afgeronde trainingen -->
					{#if closedTrainingCount > 0}
						<a href="{base}/trainings?status=closed" class="block text-center text-sm text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 pt-1">
							<span class="inline-flex items-center justify-center gap-1.5">
								<CircleCheck size={16} />
								Afgerond ({closedTrainingCount}) →
							</span>
						</a>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Wedstrijden -->
		{#if upcomingMatches.length > 0 || playedMatchCount > 0}
			<div class="card !border-cyan-200 dark:!border-cyan-800/60 !bg-cyan-50/30 dark:!bg-cyan-900/10">
				<div class="flex justify-between items-center mb-4">
					<h2 class="flex items-center gap-2 font-semibold text-gray-900 dark:text-gray-100">
						<Volleyball size={20} strokeWidth={2} class="text-cyan-600 dark:text-cyan-400" />
						Wedstrijden
					</h2>
					<a href="{base}/matches" class="text-sm text-primary-600 hover:underline">Alles</a>
				</div>
				<div class="space-y-3">
					<!-- Komende wedstrijden -->
					{#each upcomingMatches as match, i}
						{@const isNext = i === 0}
						{@const mAtt = matchAttendanceCounts[match.id]}
						<div class="rounded-xl p-4 {isNext ? 'border-2 border-primary-500 dark:border-primary-400 bg-primary-50/50 dark:bg-primary-900/15 ring-1 ring-primary-200 dark:ring-primary-800' : 'border border-cyan-200 dark:border-cyan-800 bg-cyan-50/50 dark:bg-cyan-900/10'}">
							<div>
								<div>
									<a href="{base}/matches/{match.id}" class="text-sm font-medium text-gray-800 dark:text-gray-200 hover:text-primary-600">
										{match.opponent}
									</a>
									<span class="text-xs text-gray-400 ml-1">{match.home_away === 'home' ? '(Thuis)' : '(Uit)'}</span>
									{#if mAtt}
										<span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 ml-2">
											<Users size={14} />
											{mAtt.present}/{mAtt.total}
										</span>
									{/if}
									{#if $canEdit}
										<a
											href="{base}/matches/{match.id}/edit?returnTo={base}/"
											class="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-primary-600 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-primary-400"
											title="Wedstrijd bewerken"
											aria-label="Wedstrijd bewerken"
										>
											<Pencil size={15} />
										</a>
									{/if}
								</div>
							</div>
							<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400 mt-1">
								<span class="inline-flex items-center gap-1">
									<CalendarDays size={16} />
									{new Date(match.date).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })}
								</span>
								<span class="inline-flex items-center gap-1">
									<Clock size={16} />
									{new Date(match.date).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', hour12: false })}
								</span>
								{#if match.expand?.coach && match.expand.coach.length > 0}
									<span class="inline-flex items-center gap-1">
										<UserRound size={15} />
										{match.expand.coach.map(c => c.name).join(', ')}
									</span>
								{/if}
								{#if match.location}
									<span class="inline-flex items-center gap-1">
										<MapPin size={15} />
										{match.location}
									</span>
								{/if}
							</div>
							<div class="mt-3">
								{#if $canEdit}
								<a
									href="{base}/matches/{match.id}/edit?mode=scores&returnTo={base}/"
									class="inline-flex w-full items-center justify-center gap-3 rounded-xl px-3 py-3 text-center text-sm font-semibold text-white transition-colors {
										isMatchFinished(match)
											? 'bg-red-600 hover:bg-red-700'
											: 'bg-gray-500 hover:bg-gray-600'
									}"
								>
									Scores
									<ClipboardPenLine size={20} />
								</a>
								{/if}
							</div>
						</div>
					{/each}

					<!-- Gespeeld link -->
					{#if playedMatchCount > 0}
						<a href="{base}/matches?status=played" class="block text-center text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors pt-1">
							<span class="inline-flex items-center justify-center gap-1.5">
								<CircleCheck size={16} />
								Gespeeld ({playedMatchCount}) →
							</span>
						</a>
					{/if}
				</div>
			</div>
		{/if}
		</div><!-- end grid -->
	</div>
{/if}

<!-- Training lightbox -->
{#if lightboxTraining}
	<!-- svelte-ignore a11y-click-events-have-key-events -->
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" on:click={() => lightboxTraining = null}>
		<div class="bg-white dark:bg-gray-900 w-full h-full md:w-[90%] md:h-[90%] md:rounded-2xl shadow-2xl flex flex-col overflow-hidden" on:click|stopPropagation>
			<div class="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
				<div>
					<h2 class="text-lg font-bold text-gray-800 dark:text-gray-100">
						{new Date(lightboxTraining.date).toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
					</h2>
					{#if lightboxTraining.expand?.trainer?.length}
						<p class="text-sm text-gray-500 dark:text-gray-400">
							🧑‍🏫 {lightboxTraining.expand.trainer.map(t => t.name || t.email).join(', ')}
						</p>
					{/if}
				</div>
				<div class="flex items-center gap-2">
					<button class="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 transition-colors" on:click={() => printTraining(lightboxTraining)}>
						🖨️ Print / PDF
					</button>
					<button class="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 transition-colors text-xl" on:click={() => lightboxTraining = null}>
						✕
					</button>
				</div>
			</div>
			<div class="flex-1 overflow-y-auto px-6 py-6 md:px-12 md:py-8">
				<div class="prose prose-lg dark:prose-invert max-w-none">
					{@html marked(lightboxTraining.content || '', { breaks: true })}
				</div>
				{#if lightboxTraining.general_comments}
					<div class="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
						<p class="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Opmerkingen</p>
						<p class="text-gray-700 dark:text-gray-300">{lightboxTraining.general_comments}</p>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
