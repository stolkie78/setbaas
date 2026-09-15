<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { getMatches } from '$lib/pocketbase';
	import { pb } from '$lib/pocketbase';
	import { page } from '$app/stores';
	import type { Match } from '$lib/types';
	import { selectedTeamId, selectedSeasonId, matchesSortOrder } from '$lib/stores/context';
	import { contextFilter } from '$lib/stores/context';
	import { getMatchScore, getMatchSets, getMatchOutcome, formatSetScore, getMatchStatus, isMatchFinished } from '$lib/utils/match';
	import { ArrowDownUp, Plus } from 'lucide-svelte';

	let matches: Match[] = [];
	let loading = true;
	let statusFilter: 'all' | 'open' | 'played' = 'all';

	$: {
		const urlFilter = $page.url.searchParams.get('status');
		if (urlFilter === 'played') {
			statusFilter = 'played';
		} else if (urlFilter === 'open' || urlFilter === 'upcoming') {
			statusFilter = 'open';
		}
	}

	$: sortedMatches = [...matches].sort((a, b) => {
		const diff = new Date(a.date).getTime() - new Date(b.date).getTime();
		return $matchesSortOrder === 'asc' ? diff : -diff;
	});
	$: openMatches = sortedMatches.filter(m => getMatchStatus(m) === 'open');
	$: playedMatches = sortedMatches.filter(m => getMatchStatus(m) === 'played');
	$: filteredMatches = statusFilter === 'all'
		? sortedMatches
		: statusFilter === 'open'
			? openMatches
			: playedMatches;

	function toggleSort() {
		matchesSortOrder.set($matchesSortOrder === 'desc' ? 'asc' : 'desc');
	}

	onMount(async () => {
		try {
			const filter = contextFilter($selectedTeamId, $selectedSeasonId);
			matches = await pb.collection('matches').getFullList<Match>({
				sort: '-date',
				filter: filter || undefined,
				expand: 'created_by',
			});
		} catch (e) {
			console.error('Failed to load matches:', e);
		} finally {
			loading = false;
		}
	});
</script>

<svelte:head>
	<title>Wedstrijden - SetBaas</title>
</svelte:head>

<div class="space-y-4">
	<div class="flex justify-between items-center">
		<h2 class="text-xl font-bold text-gray-800 dark:text-gray-200">Wedstrijden</h2>
		<div class="flex gap-2">
			<a href="{base}/matches/import" class="btn-secondary text-sm">📥 Nevobo</a>
			<button
				class="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 transition-colors hover:bg-gray-100 hover:text-primary-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-primary-400"
				on:click={toggleSort}
				title={$matchesSortOrder === 'desc' ? 'Nieuwste eerst — klik voor oudste eerst' : 'Oudste eerst — klik voor nieuwste eerst'}
				aria-label={$matchesSortOrder === 'desc' ? 'Sorteer wedstrijden: nieuwste eerst' : 'Sorteer wedstrijden: oudste eerst'}
			>
				<ArrowDownUp size={22} />
			</button>
			<a
				href="{base}/matches/new"
				class="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary-600 text-white transition-colors hover:bg-primary-700"
				title="Nieuwe wedstrijd"
				aria-label="Nieuwe wedstrijd"
			>
				<Plus size={24} />
			</a>
		</div>
	</div>

	<!-- Filter tabs -->
	<div class="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
		<button
			class="flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors {statusFilter === 'all' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'}"
			on:click={() => statusFilter = 'all'}>
			Alles ({matches.length})
		</button>
		<button
			class="flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors {statusFilter === 'open' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'}"
			on:click={() => statusFilter = 'open'}>
			Open ({openMatches.length})
		</button>
		<button
			class="flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors {statusFilter === 'played' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'}"
			on:click={() => statusFilter = 'played'}>
			Gespeeld ({playedMatches.length})
		</button>
	</div>

	{#if loading}
		<div class="flex justify-center py-8">
			<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
		</div>
	{:else if filteredMatches.length === 0}
		<div class="card text-center py-8 text-gray-500 dark:text-gray-400 dark:text-gray-500">
			
			<p>Nog geen wedstrijden geregistreerd</p>
		</div>
	{:else}
		<div class="grid grid-cols-1 md:grid-cols-2 gap-2">
			{#each filteredMatches as match}
				{@const score = getMatchScore(match)}
				{@const won = score.played && score.ourSets > score.theirSets}
				{@const lost = score.played && score.ourSets < score.theirSets}
				<div class="card">
					<div class="flex justify-between items-start">
						<div>
							<div class="flex items-center gap-2">
								<span class="font-semibold">{match.opponent}</span>
								<span class="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400">
									{match.home_away === 'home' ? 'Thuis' : 'Uit'}
								</span>
								{#if getMatchStatus(match) === 'played'}
									<span class="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400">Gespeeld</span>
								{:else if isMatchFinished(match)}
									<span class="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400">In te vullen</span>
								{:else}
									<span class="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400">Open</span>
								{/if}
							</div>
							<span class="text-xs text-gray-400 dark:text-gray-500">
								{new Date(match.date).toLocaleDateString('nl-NL', {
									weekday: 'short', day: 'numeric', month: 'short'
								})}
							</span>
						</div>
						<div class="flex items-center gap-2">
							{#if score.played}
								<span class="text-lg font-bold {won ? 'text-green-600' : lost ? 'text-red-600' : 'text-gray-600 dark:text-gray-300'}">
									{score.ourSets} - {score.theirSets}
								</span>
							{/if}
							<a href="{base}/matches/{match.id}/edit" class="px-2 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 hover:text-primary-600 transition-colors text-xs font-medium whitespace-nowrap">
								Bewerken
							</a>
						</div>
					</div>
					<!-- Set scores -->
					{#if match.set_scores && Array.isArray(match.set_scores) && match.set_scores.length > 0}
						<div class="flex gap-2 mt-1.5">
							{#each getMatchSets(match) as set}
								{#if set.home !== null && set.away !== null}
									<span class="text-xs px-1.5 py-0.5 rounded font-mono {set.wonByUs === true ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400' : set.wonByUs === false ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}">
										{formatSetScore(set)}
									</span>
								{/if}
							{/each}
						</div>
					{/if}
					{#if match.general_notes}
						<p class="text-sm text-gray-600 dark:text-gray-400 mt-2 line-clamp-2">{match.general_notes}</p>
					{/if}
					{#if match.expand?.created_by}
						<p class="text-xs text-gray-400 dark:text-gray-500 mt-1">Aangemaakt door {match.expand.created_by.name || match.expand.created_by.email}</p>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
