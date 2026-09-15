<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { pb } from '$lib/pocketbase';
	import type { Match } from '$lib/types';
	import { selectedTeamId, selectedSeasonId } from '$lib/stores/context';
	import { contextFilter } from '$lib/stores/context';
	import { getMatchScore, getMatchSets, getMatchStatus } from '$lib/utils/match';

	let loading = true;
	let matches: Match[] = [];

	let totalSetsWon = 0;
	let totalSetsLost = 0;
	let totalMatchesWon = 0;
	let totalMatchesLost = 0;
	let totalMatchesDraw = 0;
	let scoredMatchCount = 0;

	// Per-match breakdown
	let matchStats: {
		match: Match;
		setsWon: number;
		setsLost: number;
		outcome: 'won' | 'lost' | 'draw';
	}[] = [];

	onMount(async () => {
		try {
			const filter = contextFilter($selectedTeamId, $selectedSeasonId);
			matches = await pb.collection('matches').getFullList<Match>({
				sort: '-date',
				filter: filter || undefined,
			});

			for (const match of matches) {
				if (getMatchStatus(match) !== 'played') continue;

				const score = getMatchScore(match);
				if (!score.played) continue;

				const sWon = score.ourSets;
				const sLost = score.theirSets;

				totalSetsWon += sWon;
				totalSetsLost += sLost;
				scoredMatchCount++;

				const outcome = sWon > sLost ? 'won' : sLost > sWon ? 'lost' : 'draw';
				if (sWon > sLost) totalMatchesWon++;
				else if (sLost > sWon) totalMatchesLost++;
				else totalMatchesDraw++;

				matchStats.push({ match, setsWon: sWon, setsLost: sLost, outcome });
			}
		} catch (e) {
			console.error('Failed to load sets data:', e);
		} finally {
			loading = false;
		}
	});

	$: totalSets = totalSetsWon + totalSetsLost;
	$: winPercentage = totalSets > 0 ? Math.round((totalSetsWon / totalSets) * 100) : 0;

	function formatOwnSetScore(set: { ours: number | null; theirs: number | null }) {
		return `${set.ours ?? '?'}-${set.theirs ?? '?'}`;
	}
</script>

<svelte:head>
	<title>Sets overzicht - SetBaas</title>
</svelte:head>

{#if loading}
	<div class="flex justify-center py-12">
		<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
	</div>
{:else}
	<div class="space-y-4">
		<a href="{base}/reports" class="text-primary-600 text-sm">← Rapportages</a>
		<h2 class="text-xl font-bold text-gray-800 dark:text-gray-200">🏅 Sets gewonnen & verloren</h2>

		{#if matches.length === 0}
			<div class="card text-center py-8 text-gray-500 dark:text-gray-400">
				<p>Nog geen wedstrijden geregistreerd.</p>
			</div>
		{:else if scoredMatchCount === 0}
			<div class="card text-center py-8 text-gray-500 dark:text-gray-400">
				<p>Nog geen gespeelde wedstrijden met ingevulde setstanden.</p>
			</div>
		{:else}
			<!-- Summary -->
			<div class="card">
				<p class="text-xs text-gray-500 dark:text-gray-400 mb-3">
					Alle scores worden getoond vanuit ons perspectief: <strong>wij - tegenstander</strong>.
				</p>
				<div class="grid grid-cols-3 gap-3 text-center mb-3">
					<div>
						<div class="text-2xl font-bold text-green-600">{totalMatchesWon}</div>
						<div class="text-xs text-gray-500 dark:text-gray-400">Gewonnen</div>
					</div>
					<div>
						<div class="text-2xl font-bold text-red-600">{totalMatchesLost}</div>
						<div class="text-xs text-gray-500 dark:text-gray-400">Verloren</div>
					</div>
					<div>
						<div class="text-2xl font-bold text-gray-600 dark:text-gray-300">{totalMatchesDraw}</div>
						<div class="text-xs text-gray-500 dark:text-gray-400">Gelijk</div>
					</div>
				</div>

				<!-- Sets bar -->
				<div class="mb-2">
					<div class="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
						<span>Sets gewonnen: {totalSetsWon}</span>
						<span>Sets verloren: {totalSetsLost}</span>
					</div>
					<div class="flex h-4 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-700">
						{#if totalSets > 0}
							<div
								class="h-full bg-green-500 transition-all duration-500"
								style="width: {(totalSetsWon / totalSets) * 100}%"
							></div>
							<div
								class="h-full bg-red-500 transition-all duration-500"
								style="width: {(totalSetsLost / totalSets) * 100}%"
							></div>
						{/if}
					</div>
					<div class="text-center text-xs text-gray-500 dark:text-gray-400 mt-1">
						Set winpercentage: <span class="font-bold {winPercentage >= 50 ? 'text-green-600' : 'text-red-600'}">{winPercentage}%</span>
					</div>
				</div>
			</div>

			<!-- Per-match breakdown -->
			<div class="space-y-2">
				{#each matchStats as ms}
					<div class="card flex items-center justify-between">
						<div>
							<div class="flex items-center gap-2">
								<span class="text-sm font-semibold">{ms.match.opponent}</span>
								<span class="text-xs px-1 py-0.5 rounded {ms.match.home_away === 'home' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}">
									{ms.match.home_away === 'home' ? 'T' : 'U'}
								</span>
							</div>
							<span class="text-xs text-gray-400 dark:text-gray-500">
								{new Date(ms.match.date).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}
							</span>
						</div>
						<div class="text-right">
							<span class="text-lg font-bold {ms.outcome === 'won' ? 'text-green-600' : ms.outcome === 'lost' ? 'text-red-600' : 'text-gray-600 dark:text-gray-300'}">
								{ms.setsWon} - {ms.setsLost}
							</span>
							<!-- Show set details -->
							{#if ms.match.set_scores && Array.isArray(ms.match.set_scores)}
								<div class="flex gap-1 justify-end mt-0.5">
									{#each getMatchSets(ms.match) as set}
										{#if set.wonByUs !== null}
											<span class="text-[10px] px-1 rounded {set.wonByUs ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'} font-mono">
												{formatOwnSetScore(set)}
											</span>
										{/if}
									{/each}
								</div>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}
