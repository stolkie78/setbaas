<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { pb } from '$lib/pocketbase';
	import { getContextPlayers } from '$lib/pocketbase';
	import type { Player, MatchPlayerStats, PlayerPosition } from '$lib/types';
	import { POSITION_LABELS } from '$lib/types';
	import { selectedTeamId, selectedSeasonId } from '$lib/stores/context';
	import { getMatchScore, getMatchStatus } from '$lib/utils/match';

	let loading = true;
	let players: Player[] = [];

	// Per player, per position: total points
	let playerPositionStats: {
		player: Player;
		positions: Record<string, number>;
		totalPoints: number;
	}[] = [];

	// All positions that have been used
	let usedPositions: PlayerPosition[] = [];
	let maxPositionPoints = 1;
	let scoredMatchCount = 0;

	onMount(async () => {
		try {
			players = await getContextPlayers($selectedTeamId, $selectedSeasonId);

			// Get all match_player_stats, optionally filtered by team/season via their match
			const allStats = await pb.collection('match_player_stats').getFullList<MatchPlayerStats>({
				expand: 'player,match',
			});

			// Filter by team/season context
			const teamId = $selectedTeamId;
			const seasonId = $selectedSeasonId;
			const playerIds = new Set(players.map(player => player.id));
			const filtered = allStats.filter(s => {
				const match = s.expand?.match;
				if (!match) return false;
				if (!playerIds.has(s.player)) return false;
				if (teamId && match.team !== teamId) return false;
				if (seasonId && match.season !== seasonId) return false;
				if (getMatchStatus(match) !== 'played') return false;
				if (!getMatchScore(match).played) return false;
				return true;
			});
			scoredMatchCount = new Set(filtered.map(stat => stat.match)).size;

			// Aggregate
			const posSet = new Set<PlayerPosition>();
			const playerMap: Record<string, Record<string, number>> = {};

			for (const stat of filtered) {
				if (!stat.position_points || !Array.isArray(stat.position_points)) continue;
				if (!playerMap[stat.player]) playerMap[stat.player] = {};

				for (const pp of stat.position_points) {
					const pos = pp.position as PlayerPosition;
					const pts = pp.points || 0;
					posSet.add(pos);
					playerMap[stat.player][pos] = (playerMap[stat.player][pos] || 0) + pts;
				}
			}

			usedPositions = Array.from(posSet).sort();

			playerPositionStats = players
				.map(player => {
					const positions = playerMap[player.id] || {};
					const totalPoints = Object.values(positions).reduce((s, p) => s + p, 0);
					return { player, positions, totalPoints };
				})
				.filter(s => s.totalPoints > 0)
				.sort((a, b) => b.totalPoints - a.totalPoints);

			maxPositionPoints = Math.max(
				...playerPositionStats.flatMap(stat => Object.values(stat.positions)),
				1
			);
		} catch (e) {
			console.error('Failed to load position points:', e);
		} finally {
			loading = false;
		}
	});
</script>

<svelte:head>
	<title>Punten per positie - SetBaas</title>
</svelte:head>

{#if loading}
	<div class="flex justify-center py-12">
		<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
	</div>
{:else}
	<div class="space-y-4">
		<a href="{base}/reports" class="text-primary-600 text-sm">← Rapportages</a>
		<h2 class="text-xl font-bold text-gray-800 dark:text-gray-200">🎯 Punten per positie</h2>
		<p class="text-sm text-gray-500 dark:text-gray-400">
			Telt alleen gespeelde wedstrijden met ingevulde score binnen het geselecteerde team en seizoen.
			{#if scoredMatchCount > 0}
				Gebaseerd op {scoredMatchCount} wedstrijd{scoredMatchCount === 1 ? '' : 'en'}.
			{/if}
		</p>

		{#if playerPositionStats.length === 0}
			<div class="card text-center py-8 text-gray-500 dark:text-gray-400">
				<p>Nog geen wedstrijddata met punten per positie.</p>
			</div>
		{:else}
			{#each playerPositionStats as stat}
				<div class="card">
					<div class="flex items-center justify-between mb-2">
						<span class="font-semibold text-sm">{stat.player.name}</span>
						<span class="text-lg font-bold text-primary-600">{stat.totalPoints} pt</span>
					</div>

					<!-- Per-position bars -->
					<div class="space-y-1.5">
						{#each usedPositions as pos}
							{@const pts = stat.positions[pos] || 0}
							{#if pts > 0}
								<div class="flex items-center gap-2">
									<span class="text-xs text-gray-500 dark:text-gray-400 w-28 truncate">
										{POSITION_LABELS[pos] || pos}
									</span>
									<div class="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-4 overflow-hidden">
										<div
											class="h-full rounded-full bg-gradient-to-r from-primary-400 to-primary-600 flex items-center justify-end pr-1.5 transition-all duration-500"
											style="width: {Math.max((pts / maxPositionPoints) * 100, 15)}%"
										>
											<span class="text-[10px] font-bold text-white">{pts}</span>
										</div>
									</div>
								</div>
							{/if}
						{/each}
					</div>
				</div>
			{/each}
		{/if}
	</div>
{/if}
