<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { getContextPlayers } from '$lib/pocketbase';
	import { pb } from '$lib/pocketbase';
	import type { Player, Training, TrainingAttendance } from '$lib/types';
	import { contextFilter, selectedTeamId, selectedSeasonId } from '$lib/stores/context';

	let players: Player[] = [];
	let trainings: Training[] = [];
	let attendanceMap: Record<string, Record<string, TrainingAttendance>> = {};
	let loading = true;

	// Stats per player
	let playerStats: {
		player: Player;
		total: number;
		present: number;
		absent: number;
		sick: number;
		injured: number;
		percentage: number;
	}[] = [];

	onMount(async () => {
		try {
			[players, trainings] = await Promise.all([
				getContextPlayers($selectedTeamId, $selectedSeasonId),
				pb.collection('trainings').getFullList<Training>({
					filter: `${contextFilter($selectedTeamId, $selectedSeasonId)} && status = "closed"`,
					sort: '-date',
				}),
			]);

			const allAttendance = await pb.collection('training_attendance').getFullList<TrainingAttendance>({
				expand: 'player,training',
				sort: 'training',
			});

			// Build a set of closed training IDs for filtering
			const closedIds = new Set(trainings.map(t => t.id));

			for (const att of allAttendance) {
				if (!closedIds.has(att.training)) continue;
				if (!attendanceMap[att.player]) attendanceMap[att.player] = {};
				attendanceMap[att.player][att.training] = att;
			}

			playerStats = players.map((player) => {
				const records = Object.values(attendanceMap[player.id] || {});
				const present = records.filter((r) => r.status === 'present').length;
				const absent = records.filter((r) => r.status === 'absent').length;
				const sick = records.filter((r) => r.status === 'sick').length;
				const injured = records.filter((r) => r.status === 'injured').length;
				const total = trainings.length;
				const percentage = total > 0 ? Math.round((present / total) * 100) : 0;

				return { player, total, present, absent, sick, injured, percentage };
			}).sort((a, b) => b.percentage - a.percentage);
		} catch (e) {
			console.error('Failed to load attendance data:', e);
		} finally {
			loading = false;
		}
	});

	function statusColor(pct: number): string {
		if (pct >= 80) return 'text-green-600';
		if (pct >= 60) return 'text-yellow-600';
		return 'text-red-600';
	}

	function barColor(pct: number): string {
		if (pct >= 80) return 'bg-green-500';
		if (pct >= 60) return 'bg-yellow-500';
		return 'bg-red-500';
	}
</script>

<svelte:head>
	<title>Trainingsaanwezigheid - SetBaas</title>
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

		<h2 class="text-xl font-bold text-gray-800 dark:text-gray-200">Trainingsaanwezigheid</h2>

		<!-- Summary -->
		<div class="card">
			<div class="grid grid-cols-2 gap-3 text-center">
				<div>
					<div class="text-2xl font-bold text-primary-600">{trainings.length}</div>
					<div class="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500">Afgeronde trainingen</div>
				</div>
				<div>
					<div class="text-2xl font-bold text-green-600">
						{playerStats.length > 0
							? Math.round(playerStats.reduce((s, p) => s + p.percentage, 0) / playerStats.length)
							: 0}%
					</div>
					<div class="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500">Gem. opkomst</div>
				</div>
			</div>
		</div>

		{#if trainings.length === 0}
			<div class="card text-center py-8 text-gray-500 dark:text-gray-400 dark:text-gray-500">
				<p>Nog geen trainingen geregistreerd om te rapporteren.</p>
			</div>
		{:else}
			<!-- Per-player breakdown -->
			<div class="space-y-2">
				{#each playerStats as stat}
					<div class="card">
						<div class="flex items-center gap-3 mb-2">
							<span class="font-semibold text-sm flex-1 truncate">{stat.player.name}</span>
							<span class="text-lg font-bold {statusColor(stat.percentage)}">
								{stat.percentage}%
							</span>
						</div>

						<!-- Progress bar -->
						<div class="w-full bg-gray-100 rounded-full h-2.5 mb-2">
							<div
								class="h-2.5 rounded-full transition-all duration-500 {barColor(stat.percentage)}"
								style="width: {stat.percentage}%"
							></div>
						</div>

						<!-- Detail counts -->
						<div class="flex gap-3 text-xs flex-wrap">
							<span class="flex items-center gap-1">
								<span class="w-2 h-2 rounded-full bg-green-500 inline-block"></span>
								Aanwezig: {stat.present}
							</span>
							<span class="flex items-center gap-1">
								<span class="w-2 h-2 rounded-full bg-red-500 inline-block"></span>
								Afwezig: {stat.absent}
							</span>
							<span class="flex items-center gap-1">
								<span class="w-2 h-2 rounded-full bg-yellow-500 inline-block"></span>
								Ziek: {stat.sick}
							</span>
							<span class="flex items-center gap-1">
								<span class="w-2 h-2 rounded-full bg-orange-500 inline-block"></span>
								Geblesseerd: {stat.injured}
							</span>
						</div>

						{#if stat.present + stat.absent + stat.sick + stat.injured < stat.total}
							<div class="text-xs text-gray-400 mt-1">
								({stat.total - stat.present - stat.absent - stat.sick - stat.injured} training(en) niet geregistreerd)
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}
