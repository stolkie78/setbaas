<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { pb, getContextPlayers } from '$lib/pocketbase';
	import type { Match, MatchAttendance, Player } from '$lib/types';
	import { contextFilter, selectedSeasonId, selectedTeamId } from '$lib/stores/context';
	import { getMatchStatus } from '$lib/utils/match';

	let players: Player[] = [];
	let matches: Match[] = [];
	let loading = true;

	let playerStats: {
		player: Player;
		total: number;
		present: number;
		absent: number;
		sick: number;
		school: number;
		late: number;
		injured: number;
		percentage: number;
	}[] = [];

	onMount(async () => {
		try {
			const [loadedPlayers, loadedMatches] = await Promise.all([
				getContextPlayers($selectedTeamId, $selectedSeasonId),
				pb.collection('matches').getFullList<Match>({
					filter: contextFilter($selectedTeamId, $selectedSeasonId) || undefined,
					sort: '-date',
				}),
			]);

			players = loadedPlayers;
			matches = loadedMatches.filter(match => getMatchStatus(match) === 'played');
			const matchIds = new Set(matches.map(match => match.id));

			const allAttendance = await pb.collection('match_attendance').getFullList<MatchAttendance>({
				expand: 'player,match',
				sort: 'match',
			});

			const attendanceByPlayer: Record<string, MatchAttendance[]> = {};
			for (const attendance of allAttendance) {
				if (!matchIds.has(attendance.match)) continue;
				if (!attendanceByPlayer[attendance.player]) attendanceByPlayer[attendance.player] = [];
				attendanceByPlayer[attendance.player].push(attendance);
			}

			playerStats = players.map((player) => {
				const records = attendanceByPlayer[player.id] || [];
				const present = records.filter(record => record.status === 'present').length;
				const absent = records.filter(record => record.status === 'absent').length;
				const sick = records.filter(record => record.status === 'sick').length;
				const school = records.filter(record => record.status === 'school').length;
				const late = records.filter(record => record.status === 'late').length;
				const injured = records.filter(record => record.status === 'injured').length;
				const total = matches.length;
				const percentage = total > 0 ? Math.round((present / total) * 100) : 0;
				return { player, total, present, absent, sick, school, late, injured, percentage };
			}).sort((a, b) => b.percentage - a.percentage);
		} catch (error) {
			console.error('Failed to load match attendance report:', error);
		} finally {
			loading = false;
		}
	});

	function statusColor(percentage: number): string {
		if (percentage >= 80) return 'text-green-600';
		if (percentage >= 60) return 'text-yellow-600';
		return 'text-red-600';
	}

	function barColor(percentage: number): string {
		if (percentage >= 80) return 'bg-green-500';
		if (percentage >= 60) return 'bg-yellow-500';
		return 'bg-red-500';
	}
</script>

<svelte:head>
	<title>Wedstrijdaanwezigheid - SetBaas</title>
</svelte:head>

{#if loading}
	<div class="flex justify-center py-12">
		<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
	</div>
{:else}
	<div class="space-y-4">
		<a href="{base}/reports" class="text-primary-600 text-sm">← Rapportages</a>

		<h2 class="text-xl font-bold text-gray-800 dark:text-gray-200">Wedstrijdaanwezigheid</h2>
		<p class="text-sm text-gray-500 dark:text-gray-400">
			Aanwezigheid per speler over gespeelde wedstrijden binnen het geselecteerde team en seizoen.
		</p>

		<div class="card">
			<div class="grid grid-cols-2 gap-3 text-center">
				<div>
					<div class="text-2xl font-bold text-primary-600">{matches.length}</div>
					<div class="text-xs text-gray-500 dark:text-gray-400">Gespeelde wedstrijden</div>
				</div>
				<div>
					<div class="text-2xl font-bold text-green-600">
						{playerStats.length > 0
							? Math.round(playerStats.reduce((sum, stat) => sum + stat.percentage, 0) / playerStats.length)
							: 0}%
					</div>
					<div class="text-xs text-gray-500 dark:text-gray-400">Gem. opkomst</div>
				</div>
			</div>
		</div>

		{#if matches.length === 0}
			<div class="card text-center py-8 text-gray-500 dark:text-gray-400">
				<p>Nog geen gespeelde wedstrijden om te rapporteren.</p>
			</div>
		{:else}
			<div class="space-y-2">
				{#each playerStats as stat}
					<div class="card">
						<div class="flex items-center gap-3 mb-2">
							<span class="font-semibold text-sm flex-1 truncate">{stat.player.name}</span>
							<span class="text-lg font-bold {statusColor(stat.percentage)}">{stat.percentage}%</span>
						</div>

						<div class="w-full bg-gray-100 rounded-full h-2.5 mb-2">
							<div
								class="h-2.5 rounded-full transition-all duration-500 {barColor(stat.percentage)}"
								style="width: {stat.percentage}%"
							></div>
						</div>

						<div class="flex gap-3 text-xs flex-wrap">
							<span>Aanwezig: {stat.present}</span>
							<span>Afwezig: {stat.absent}</span>
							<span>Ziek: {stat.sick}</span>
							<span>School: {stat.school}</span>
							<span>Laat: {stat.late}</span>
							<span>Geblesseerd: {stat.injured}</span>
						</div>

						{#if stat.present + stat.absent + stat.sick + stat.school + stat.late + stat.injured < stat.total}
							<div class="text-xs text-gray-400 mt-1">
								({stat.total - stat.present - stat.absent - stat.sick - stat.school - stat.late - stat.injured} wedstrijd(en) niet geregistreerd)
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}
