<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { getContextPlayers } from '$lib/pocketbase';
	import type { Player } from '$lib/types';
	import { selectedTeamId, selectedSeasonId } from '$lib/stores/context';
	import { fetchPlayerLoad, getMonthRange, type PlayerLoad } from '$lib/utils/load';

	let players: Player[] = [];
	let loads: { player: Player; load: PlayerLoad }[] = [];
	let loading = true;
	let monthOffset = 0;

	$: monthLabel = getMonthRange(monthOffset).label;

	onMount(loadReport);

	async function loadReport() {
		loading = true;
		try {
			players = await getContextPlayers($selectedTeamId, $selectedSeasonId, { activeOnly: true });

			loads = await Promise.all(
				players.map(async (player) => ({
					player,
					load: await fetchPlayerLoad(player.id, player.extra_activities || [], {
						teamId: $selectedTeamId,
						seasonId: $selectedSeasonId,
						monthOffset,
					}),
				}))
			);
			loads.sort((a, b) => b.load.totalHours - a.load.totalHours);
		} catch (e) {
			console.error('Failed to load player load report:', e);
		} finally {
			loading = false;
		}
	}

	function changeMonth(delta: number) {
		monthOffset += delta;
		loadReport();
	}

	function levelLabel(hours: number): string {
		if (hours >= 32) return 'hoog';
		if (hours >= 20) return 'gemiddeld';
		return 'laag';
	}

	function levelColor(hours: number): string {
		if (hours >= 32) return 'text-red-600 dark:text-red-400';
		if (hours >= 20) return 'text-amber-600 dark:text-amber-400';
		return 'text-emerald-600 dark:text-emerald-400';
	}

	function barColor(hours: number): string {
		if (hours >= 32) return 'bg-red-500';
		if (hours >= 20) return 'bg-amber-500';
		return 'bg-emerald-500';
	}

	const MAX_HOURS = 40;

	$: avgHours = loads.length > 0
		? Math.round((loads.reduce((s, l) => s + l.load.totalHours, 0) / loads.length) * 10) / 10
		: 0;
</script>

<svelte:head>
	<title>Belastingsoverzicht - SetBaas</title>
</svelte:head>

{#if loading}
	<div class="flex justify-center py-12">
		<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
	</div>
{:else}
	<div class="space-y-4">
		<div class="flex items-center gap-2">
			<a href="{base}/reports" class="text-primary-600 text-sm">← Rapportages</a>
		</div>

		<h2 class="text-xl font-bold text-gray-800 dark:text-gray-200">Belastingsoverzicht</h2>
		<p class="text-sm text-gray-500 dark:text-gray-400">
			Geplande uren van trainingen en wedstrijden van het team, min gemelde afwezigheid, plus
			extra activiteiten die per speler zijn ingesteld.
		</p>

		<div class="flex items-center justify-center gap-3">
			<button type="button" class="px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700" on:click={() => changeMonth(-1)}>
				‹
			</button>
			<span class="font-medium text-gray-700 dark:text-gray-300 capitalize">{monthLabel}</span>
			<button type="button" class="px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700" on:click={() => changeMonth(1)}>
				›
			</button>
		</div>

		<!-- Summary -->
		<div class="card">
			<div class="grid grid-cols-2 gap-3 text-center">
				<div>
					<div class="text-2xl font-bold text-primary-600">{loads.length}</div>
					<div class="text-xs text-gray-500 dark:text-gray-400">Spelers</div>
				</div>
				<div>
					<div class="text-2xl font-bold text-green-600">{avgHours}</div>
					<div class="text-xs text-gray-500 dark:text-gray-400">Gem. uur per maand</div>
				</div>
			</div>
		</div>

		{#if players.length === 0}
			<div class="card text-center py-8 text-gray-500 dark:text-gray-400">
				<p>Geen spelers gevonden voor dit team en seizoen.</p>
			</div>
		{:else}
			<div class="space-y-2">
				{#each loads as { player, load }}
					<div class="card space-y-1.5">
						<div class="flex items-center justify-between">
							<a href="{base}/players/{player.id}" class="font-medium text-gray-800 dark:text-gray-200 hover:text-primary-600">
								{player.name}
							</a>
							<span class="font-semibold {levelColor(load.totalHours)}">
								{load.totalHours} u ({levelLabel(load.totalHours)})
							</span>
						</div>
						<div class="w-full h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
							<div
								class="h-full {barColor(load.totalHours)} rounded-full"
								style="width: {Math.min(100, (load.totalHours / MAX_HOURS) * 100)}%"
							></div>
						</div>
						{#if load.lines.length > 0}
							<p class="text-xs text-gray-500 dark:text-gray-400">
								{load.lines.map((l) => `${l.label}: ${l.hours} u`).join(' · ')}
							</p>
						{:else}
							<p class="text-xs text-gray-400">Geen trainingen, wedstrijden of extra activiteiten</p>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}
