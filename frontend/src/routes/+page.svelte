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
		Eye,
		MapPin,
		Pencil,
		Play,
		UserRound,
		Users,
	} from 'lucide-svelte';

	let players: Player[] = [];
	let trainings: Training[] = [];
	let matches: Match[] = [];
	let loading = true;
	let lightboxTraining: Training | null = null;
	type DashboardFilter = 'all' | 'training' | 'match';
	let dashboardFilter: DashboardFilter = 'all';
	const dashboardFilters: { value: DashboardFilter; label: string }[] = [
		{ value: 'all', label: 'Alles' },
		{ value: 'training', label: 'Trainingen' },
		{ value: 'match', label: 'Wedstrijden' },
	];

	type DashboardTimelineItem =
		| { type: 'training'; record: Training; active: boolean }
		| { type: 'match'; record: Match; active: false };

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
	$: timelineItems = ([
		...(activeTraining ? [{ type: 'training' as const, record: activeTraining, active: true }] : []),
		...openTrainings.map(record => ({ type: 'training' as const, record, active: false })),
		...upcomingMatches.map(record => ({ type: 'match' as const, record, active: false })),
	] as DashboardTimelineItem[])
		.filter(item => dashboardFilter === 'all' || item.type === dashboardFilter)
		.sort((a, b) => new Date(a.record.date).getTime() - new Date(b.record.date).getTime());

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

		<!-- Combined timeline -->
		<section class="card">
			<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-5">
				<div>
					<h2 class="flex items-center gap-2 font-semibold text-gray-900 dark:text-gray-100">
						<CalendarDays size={20} class="text-primary-600 dark:text-primary-400" />
						Tijdlijn
					</h2>
					<p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Trainingen en wedstrijden op volgorde van datum.</p>
				</div>
				<div class="inline-flex w-full rounded-xl bg-gray-100 p-1 dark:bg-gray-800 sm:w-auto" aria-label="Filter tijdlijn">
					{#each dashboardFilters as option}
						<button
							type="button"
							aria-pressed={dashboardFilter === option.value}
							on:click={() => (dashboardFilter = option.value)}
							class="flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors sm:flex-none {dashboardFilter === option.value ? 'bg-white text-primary-700 shadow-sm dark:bg-gray-700 dark:text-primary-300' : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'}"
						>
							{option.label}
						</button>
					{/each}
				</div>
			</div>

			<div class="mb-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm">
				{#if dashboardFilter !== 'match'}
					<a href="{base}/trainings" class="text-primary-600 hover:underline">Alle trainingen</a>
				{/if}
				{#if dashboardFilter !== 'training'}
					<a href="{base}/matches" class="text-primary-600 hover:underline">Alle wedstrijden</a>
				{/if}
			</div>

			{#if timelineItems.length > 0}
				<div class="ml-2 space-y-4 border-l-2 border-gray-200 pl-5 dark:border-gray-700">
					{#each timelineItems as item (item.type + item.record.id)}
						{@const eventDate = new Date(item.record.date)}
						<div class="relative rounded-xl border p-4 {item.active ? 'border-green-400 bg-green-50/70 dark:border-green-700 dark:bg-green-900/20' : item.type === 'training' ? 'border-blue-200 bg-blue-50/40 dark:border-blue-900 dark:bg-blue-900/10' : 'border-cyan-200 bg-cyan-50/40 dark:border-cyan-900 dark:bg-cyan-900/10'}">
							<span class="absolute -left-[1.72rem] top-5 h-3 w-3 rounded-full border-2 border-white {item.active ? 'bg-green-500' : item.type === 'training' ? 'bg-blue-500' : 'bg-cyan-500'} dark:border-gray-900"></span>
							<div class="flex flex-wrap items-start justify-between gap-2">
								<div class="min-w-0">
									<div>
										{#if item.type === 'training'}
											<span class="inline-block rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-blue-700 dark:bg-blue-900/60 dark:text-blue-300">Training</span>
										{:else}
											<span class="inline-block rounded-full bg-cyan-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-cyan-700 dark:bg-cyan-900/60 dark:text-cyan-300">Wedstrijd</span>
										{/if}
									</div>
									<div class="mt-1.5 flex flex-wrap items-center gap-2">
										{#if item.type === 'training'}
											<a href="{base}/trainings/{item.record.id}" class="font-semibold text-gray-900 hover:text-primary-600 dark:text-gray-100">
												{eventDate.toLocaleDateString('nl-NL', { weekday: 'long' })}
											</a>
											{#if item.active}
												<span class="rounded-full bg-green-500 px-2 py-0.5 text-[10px] font-bold text-white">LIVE</span>
											{/if}
											{@const att = attendanceCounts[item.record.id]}
											{#if att}
												<span class="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300">
													<Users size={13} /> {att.present}/{att.total}
												</span>
											{/if}
										{:else}
											<a href="{base}/matches/{item.record.id}" class="font-semibold text-gray-900 hover:text-primary-600 dark:text-gray-100">
												{item.record.opponent}
											</a>
											<span class="text-xs text-gray-500 dark:text-gray-400">{item.record.home_away === 'home' ? '(Thuis)' : '(Uit)'}</span>
											{@const mAtt = matchAttendanceCounts[item.record.id]}
											{#if mAtt}
												<span class="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300">
													<Users size={13} /> {mAtt.present}/{mAtt.total}
												</span>
											{/if}
										{/if}
									</div>
									<div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
										<span class="inline-flex items-center gap-1">
											<CalendarDays size={15} />
											{eventDate.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })}
										</span>
										<span class="inline-flex items-center gap-1">
											<Clock size={15} />
											{eventDate.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', hour12: false })}
										</span>
										{#if item.type === 'training' && item.record.expand?.trainer?.length}
											<span class="inline-flex items-center gap-1"><UserRound size={14} /> {item.record.expand.trainer.map(t => t.name).join(', ')}</span>
										{:else if item.type === 'match' && item.record.expand?.coach?.length}
											<span class="inline-flex items-center gap-1"><UserRound size={14} /> {item.record.expand.coach.map(c => c.name).join(', ')}</span>
										{/if}
										{#if item.record.location}
											<span class="inline-flex items-center gap-1"><MapPin size={14} /> {item.record.location}</span>
										{/if}
									</div>
								</div>
								{#if $canEdit}
									<a
										href={item.type === 'training' ? `${base}/trainings/${item.record.id}/edit?returnTo=${base}/` : `${base}/matches/${item.record.id}/edit?returnTo=${base}/`}
										class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-white hover:text-primary-600 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-primary-400"
										title={item.type === 'training' ? 'Training bewerken' : 'Wedstrijd bewerken'}
										aria-label={item.type === 'training' ? 'Training bewerken' : 'Wedstrijd bewerken'}
									>
										<Pencil size={15} />
									</a>
								{/if}
							</div>

							{#if item.type === 'training'}
								<div class="mt-3 grid gap-3 {$canEdit ? 'grid-cols-2' : 'grid-cols-1'}">
									{#if item.record.content}
										<button on:click={() => lightboxTraining = item.record} class="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-3 text-sm font-semibold text-white hover:bg-blue-700">
											Bekijken <Eye size={18} />
										</button>
									{:else}
										<a href="{base}/trainings/{item.record.id}" class="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-3 text-sm font-semibold text-white hover:bg-blue-700">
											Bekijken <Eye size={18} />
										</a>
									{/if}
									{#if $canEdit}
										<a href="{base}/trainings/{item.record.id}/{item.active ? 'checkout' : 'checkin'}" class="inline-flex w-full items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold text-white {item.active ? 'bg-red-600 hover:bg-red-700' : item.record.content?.trim() ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-500 hover:bg-gray-600'}">
											{item.active ? 'Afronden' : 'Start'}
											{#if item.active}<CircleCheck size={18} />{:else}<Play size={18} />{/if}
										</a>
									{/if}
								</div>
							{:else if $canEdit}
								<a href="{base}/matches/{item.record.id}/edit?mode=scores&returnTo={base}/" class="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold text-white {isMatchFinished(item.record) ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-500 hover:bg-gray-600'}">
									Scores <ClipboardPenLine size={18} />
								</a>
							{/if}
						</div>
					{/each}
				</div>
			{:else}
				<p class="rounded-xl bg-gray-50 px-4 py-8 text-center text-sm text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
					{dashboardFilter === 'training' ? 'Geen aankomende trainingen.' : dashboardFilter === 'match' ? 'Geen aankomende wedstrijden.' : 'Geen aankomende trainingen of wedstrijden.'}
				</p>
			{/if}

			{#if (closedTrainingCount > 0 && dashboardFilter !== 'match') || (playedMatchCount > 0 && dashboardFilter !== 'training')}
				<div class="mt-5 flex flex-wrap justify-center gap-x-6 gap-y-2 border-t border-gray-200 pt-4 text-sm dark:border-gray-700">
					{#if closedTrainingCount > 0 && dashboardFilter !== 'match'}
						<a href="{base}/trainings?status=closed" class="inline-flex items-center gap-1.5 text-gray-500 hover:text-primary-600 dark:text-gray-400 dark:hover:text-primary-400">
							<CircleCheck size={15} /> Afgerond ({closedTrainingCount}) →
						</a>
					{/if}
					{#if playedMatchCount > 0 && dashboardFilter !== 'training'}
						<a href="{base}/matches?status=played" class="inline-flex items-center gap-1.5 text-gray-500 hover:text-primary-600 dark:text-gray-400 dark:hover:text-primary-400">
							<CircleCheck size={15} /> Gespeeld ({playedMatchCount}) →
						</a>
					{/if}
				</div>
			{/if}
		</section>
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
					<button class="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 transition-colors" on:click={() => lightboxTraining && printTraining(lightboxTraining)}>
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
