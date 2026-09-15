<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { pb, getContextPlayers, getCompetencies } from '$lib/pocketbase';
	import type { Player, Competency, PlayerCompetency } from '$lib/types';
	import { CATEGORY_LABELS } from '$lib/types';
	import { selectedTeamId, selectedSeasonId } from '$lib/stores/context';
	import { Plus } from 'lucide-svelte';

	let players: Player[] = [];
	let competencies: Competency[] = [];
	let allScores: PlayerCompetency[] = [];
	let loading = true;

	// View mode
	let viewMode: 'competency' | 'player' | 'timeline' = 'competency';

	onMount(async () => {
		try {
			[players, competencies, allScores] = await Promise.all([
				getContextPlayers($selectedTeamId, $selectedSeasonId, { activeOnly: true }),
				getCompetencies(),
				pb.collection('player_competencies').getFullList<PlayerCompetency>({
					sort: 'date',
					expand: 'player,competency,created_by',
				}),
			]);
			const playerIds = new Set(players.map(player => player.id));
			allScores = allScores.filter(score => playerIds.has(score.player));
		} catch (e) {
			console.error('Failed to load data:', e);
		} finally {
			loading = false;
		}
	});

	// Get latest score per player per competency
	function getLatestScore(playerId: string, compId: string): number | null {
		const playerScores = allScores.filter(s => s.player === playerId && s.competency === compId);
		if (playerScores.length === 0) return null;
		return playerScores[playerScores.length - 1].rating;
	}

	// Get all scores over time for a player+competency
	function getScoreHistory(playerId: string, compId: string): { date: string; rating: number }[] {
		return allScores
			.filter(s => s.player === playerId && s.competency === compId)
			.map(s => ({ date: s.date, rating: s.rating }));
	}

	// Get unique measurement dates
	$: measurementDates = [...new Set(allScores.map(s => s.date.slice(0, 10)))].sort();

	// Get score at a specific date
	function getScoreAtDate(playerId: string, compId: string, date: string): number | null {
		const score = allScores.find(s => s.player === playerId && s.competency === compId && s.date.slice(0, 10) === date);
		return score ? score.rating : null;
	}

	// Get average score for a competency across all players
	function getCompAverage(compId: string): number | null {
		const scores = players
			.map(p => getLatestScore(p.id, compId))
			.filter((s): s is number => s !== null);
		if (scores.length === 0) return null;
		return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
	}

	// Get average score for a player across all competencies
	function getPlayerAverage(playerId: string): number | null {
		const scores = competencies
			.map(c => getLatestScore(playerId, c.id))
			.filter((s): s is number => s !== null);
		if (scores.length === 0) return null;
		return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
	}

	// Compute delta (last - previous)
	function getDelta(playerId: string, compId: string): number | null {
		const history = getScoreHistory(playerId, compId);
		if (history.length < 2) return null;
		return history[history.length - 1].rating - history[history.length - 2].rating;
	}

	function scoreColor(score: number | null): string {
		if (score === null) return 'bg-gray-100 dark:bg-gray-800 text-gray-400';
		if (score >= 8) return 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400';
		if (score >= 6) return 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400';
		if (score >= 4) return 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400';
		return 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400';
	}

	function deltaIndicator(delta: number | null): string {
		if (delta === null) return '';
		if (delta > 0) return `↑${delta}`;
		if (delta < 0) return `↓${Math.abs(delta)}`;
		return '=';
	}

	function deltaColor(delta: number | null): string {
		if (delta === null) return 'text-gray-400';
		if (delta > 0) return 'text-green-600 dark:text-green-400';
		if (delta < 0) return 'text-red-600 dark:text-red-400';
		return 'text-gray-400';
	}

	function barWidth(score: number | null, max: number = 10): string {
		if (score === null) return '0%';
		return `${(score / max) * 100}%`;
	}
</script>

<svelte:head>
	<title>Competentie Rapport - SetBaas</title>
</svelte:head>

<div class="space-y-4">
	<div class="flex justify-between items-center">
		<div>
			<a href="{base}/reports" class="text-primary-600 text-sm hover:underline">← Rapportages</a>
			<h2 class="text-xl font-bold text-gray-800 dark:text-gray-200 mt-1">Competenties</h2>
		</div>
		<div class="flex gap-2">
			<a
				href="{base}/competencies/new"
				class="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary-600 text-white transition-colors hover:bg-primary-700"
				title="Nieuwe meting"
				aria-label="Nieuwe meting"
			>
				<Plus size={24} />
			</a>
		</div>
	</div>

	<!-- View toggle -->
	<div class="flex rounded-xl overflow-hidden border border-gray-300 dark:border-gray-600">
		<button
			class="flex-1 py-2.5 text-xs font-semibold transition-colors {viewMode === 'competency' ? 'bg-primary-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300'}"
			on:click={() => (viewMode = 'competency')}>
			Per competentie
		</button>
		<button
			class="flex-1 py-2.5 text-xs font-semibold transition-colors {viewMode === 'player' ? 'bg-primary-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300'}"
			on:click={() => (viewMode = 'player')}>
			Per speler
		</button>
		<button
			class="flex-1 py-2.5 text-xs font-semibold transition-colors {viewMode === 'timeline' ? 'bg-primary-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300'}"
			on:click={() => (viewMode = 'timeline')}>
			Tijdlijn
		</button>
	</div>

	{#if loading}
		<div class="flex justify-center py-8">
			<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
		</div>
	{:else if competencies.length === 0}
		<div class="card text-center py-8 text-gray-500 dark:text-gray-400">
			
			<p>Nog geen competenties aangemaakt. Ga naar Config om ze toe te voegen.</p>
		</div>
	{:else if allScores.length === 0}
		<div class="card text-center py-8 text-gray-500 dark:text-gray-400">
			
			<p>Nog geen scores ingevoerd.</p>
			<a href="{base}/competencies/new" class="btn-primary mt-4 inline-block">Eerste meting starten</a>
		</div>

	<!-- Per Competency View -->
	{:else if viewMode === 'competency'}
		<div class="space-y-3">
			{#each competencies as comp}
				{@const avg = getCompAverage(comp.id)}
				<div class="card">
					<div class="flex justify-between items-center mb-2">
						<div>
							<span class="font-semibold text-sm">{comp.name}</span>
							<span class="text-xs text-gray-400 ml-2">{CATEGORY_LABELS[comp.category]}</span>
						</div>
						{#if avg !== null}
							<span class="text-sm font-bold px-2 py-0.5 rounded-full {scoreColor(avg)}">
								Gem: {avg}
							</span>
						{/if}
					</div>
					<div class="space-y-1.5">
						{#each players as player}
							{@const score = getLatestScore(player.id, comp.id)}
							{@const delta = getDelta(player.id, comp.id)}
							<div class="flex items-center gap-2">
								<span class="text-xs w-24 truncate text-gray-600 dark:text-gray-300">{player.name}</span>
								<div class="flex-1 h-5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
									<div
										class="h-full rounded-full transition-all {score !== null && score >= 7 ? 'bg-green-500' : score !== null && score >= 5 ? 'bg-blue-500' : score !== null ? 'bg-yellow-500' : 'bg-gray-300'}"
										style="width: {barWidth(score)}"
									></div>
								</div>
								<span class="text-xs font-bold w-6 text-right">{score !== null ? score : '—'}</span>
								{#if delta !== null}
									<span class="text-[10px] font-bold w-6 {deltaColor(delta)}">{deltaIndicator(delta)}</span>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/each}
		</div>

	<!-- Per Player View -->
	{:else if viewMode === 'player'}
		<div class="space-y-3">
			{#each players as player}
				{@const avg = getPlayerAverage(player.id)}
				<div class="card">
					<div class="flex justify-between items-center mb-2">
						<span class="font-semibold text-sm">{player.name}</span>
						{#if avg !== null}
							<span class="text-sm font-bold px-2 py-0.5 rounded-full {scoreColor(avg)}">
								Gem: {avg}
							</span>
						{/if}
					</div>
					<div class="space-y-1.5">
						{#each competencies as comp}
							{@const score = getLatestScore(player.id, comp.id)}
							{@const delta = getDelta(player.id, comp.id)}
							<div class="flex items-center gap-2">
								<span class="text-xs w-24 truncate text-gray-600 dark:text-gray-300">{comp.name}</span>
								<div class="flex-1 h-5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
									<div
										class="h-full rounded-full transition-all {score !== null && score >= 7 ? 'bg-green-500' : score !== null && score >= 5 ? 'bg-blue-500' : score !== null ? 'bg-yellow-500' : 'bg-gray-300'}"
										style="width: {barWidth(score)}"
									></div>
								</div>
								<span class="text-xs font-bold w-6 text-right">{score !== null ? score : '—'}</span>
								{#if delta !== null}
									<span class="text-[10px] font-bold w-6 {deltaColor(delta)}">{deltaIndicator(delta)}</span>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/each}
		</div>

	<!-- Timeline View -->
	{:else if viewMode === 'timeline'}
		{#if measurementDates.length === 0}
			<div class="card text-center py-8 text-gray-500 dark:text-gray-400">
				<p>Nog geen metingen. Voer minimaal 2 metingen in om voortgang te zien.</p>
			</div>
		{:else}
			<div class="text-xs text-gray-500 dark:text-gray-400 mb-2">
				{measurementDates.length} meting(en): {measurementDates.map(d => new Date(d).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })).join(' → ')}
			</div>

			{#each players as player}
				<div class="card">
					<h3 class="font-semibold text-sm mb-3">{player.name}</h3>
					<div class="overflow-x-auto">
						<table class="w-full text-xs">
							<thead>
								<tr class="border-b border-gray-100 dark:border-gray-700">
									<th class="text-left py-1.5 pr-2 font-medium text-gray-500 dark:text-gray-400">Competentie</th>
									{#each measurementDates as date}
										<th class="text-center py-1.5 px-1 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
											{new Date(date).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}
										</th>
									{/each}
									<th class="text-center py-1.5 px-1 font-medium text-gray-500 dark:text-gray-400">Δ</th>
								</tr>
							</thead>
							<tbody>
								{#each competencies as comp}
									{@const delta = getDelta(player.id, comp.id)}
									<tr class="border-b border-gray-50 dark:border-gray-800 last:border-0">
										<td class="py-1.5 pr-2 text-gray-700 dark:text-gray-300">{comp.name}</td>
										{#each measurementDates as date}
											{@const score = getScoreAtDate(player.id, comp.id, date)}
											<td class="text-center py-1.5 px-1">
												{#if score !== null}
													<span class="inline-block w-6 h-6 leading-6 rounded-md text-[10px] font-bold {scoreColor(score)}">
														{score}
													</span>
												{:else}
													<span class="text-gray-300 dark:text-gray-600">—</span>
												{/if}
											</td>
										{/each}
										<td class="text-center py-1.5 px-1">
											{#if delta !== null}
												<span class="font-bold {deltaColor(delta)}">{deltaIndicator(delta)}</span>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			{/each}
		{/if}
	{/if}
</div>
