<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { pb } from '$lib/pocketbase';
	import type { Training, TrainingAttendance } from '$lib/types';
	import { contextFilter, selectedSeasonId, selectedTeamId } from '$lib/stores/context';

	interface TrainerInfo {
		id: string;
		name: string;
	}

	let loading = true;
	let trainings: Training[] = [];
	let trainerStats: {
		trainer: TrainerInfo;
		trainingCount: number;
		present: number;
		total: number;
		percentage: number;
	}[] = [];

	onMount(async () => {
		try {
			trainings = await pb.collection('trainings').getFullList<Training>({
				filter: `${contextFilter($selectedTeamId, $selectedSeasonId)} && status = "closed"`,
				sort: '-date',
				expand: 'trainer',
			});

			const trainingIds = new Set(trainings.map(training => training.id));
			const allAttendance = await pb.collection('training_attendance').getFullList<TrainingAttendance>({
				fields: 'training,status',
			});

			const attendanceByTraining: Record<string, { present: number; total: number }> = {};
			for (const attendance of allAttendance) {
				if (!trainingIds.has(attendance.training)) continue;
				if (!attendanceByTraining[attendance.training]) {
					attendanceByTraining[attendance.training] = { present: 0, total: 0 };
				}
				attendanceByTraining[attendance.training].total++;
				if (attendance.status === 'present') attendanceByTraining[attendance.training].present++;
			}

			const byTrainer: Record<string, {
				trainer: TrainerInfo;
				trainingIds: Set<string>;
				present: number;
				total: number;
			}> = {};

			for (const training of trainings) {
				const trainers = training.expand?.trainer?.length
					? training.expand.trainer.map(trainer => ({
						id: trainer.id,
						name: trainer.name || trainer.email || 'Trainer',
					}))
					: [{ id: 'unassigned', name: 'Geen trainer gekoppeld' }];
				const attendance = attendanceByTraining[training.id] || { present: 0, total: 0 };

				for (const trainer of trainers) {
					if (!byTrainer[trainer.id]) {
						byTrainer[trainer.id] = {
							trainer,
							trainingIds: new Set<string>(),
							present: 0,
							total: 0,
						};
					}
					byTrainer[trainer.id].trainingIds.add(training.id);
					byTrainer[trainer.id].present += attendance.present;
					byTrainer[trainer.id].total += attendance.total;
				}
			}

			trainerStats = Object.values(byTrainer)
				.map(stat => ({
					trainer: stat.trainer,
					trainingCount: stat.trainingIds.size,
					present: stat.present,
					total: stat.total,
					percentage: stat.total > 0 ? Math.round((stat.present / stat.total) * 100) : 0,
				}))
				.sort((a, b) => b.percentage - a.percentage || b.trainingCount - a.trainingCount);
		} catch (error) {
			console.error('Failed to load trainer attendance report:', error);
		} finally {
			loading = false;
		}
	});

	function statusColor(percentage: number): string {
		if (percentage >= 80) return 'text-green-600';
		if (percentage >= 60) return 'text-yellow-600';
		return 'text-red-600';
	}
</script>

<svelte:head>
	<title>Aanwezigheid per trainer - SetBaas</title>
</svelte:head>

{#if loading}
	<div class="flex justify-center py-12">
		<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
	</div>
{:else}
	<div class="space-y-4">
		<a href="{base}/reports" class="text-primary-600 text-sm">← Rapportages</a>

		<h2 class="text-xl font-bold text-gray-800 dark:text-gray-200">🧑‍🏫 Aanwezigheid per trainer</h2>
		<p class="text-sm text-gray-500 dark:text-gray-400">
			Gemiddelde spelersopkomst per trainer over afgeronde trainingen binnen het geselecteerde team en seizoen.
			Bij trainingen met meerdere trainers telt dezelfde training mee voor elke gekoppelde trainer.
		</p>

		{#if trainings.length === 0}
			<div class="card text-center py-8 text-gray-500 dark:text-gray-400">
				<p>Nog geen afgeronde trainingen om te rapporteren.</p>
			</div>
		{:else if trainerStats.length === 0}
			<div class="card text-center py-8 text-gray-500 dark:text-gray-400">
				<p>Nog geen trainerdata beschikbaar.</p>
			</div>
		{:else}
			<div class="space-y-2">
				{#each trainerStats as stat}
					<div class="card">
						<div class="flex items-center justify-between gap-3">
							<div class="min-w-0">
								<p class="font-semibold text-gray-800 dark:text-gray-200 truncate">{stat.trainer.name}</p>
								<p class="text-xs text-gray-500 dark:text-gray-400">
									{stat.trainingCount} training{stat.trainingCount === 1 ? '' : 'en'} ·
									{stat.present}/{stat.total} spelers aanwezig
								</p>
							</div>
							<div class="text-2xl font-bold {statusColor(stat.percentage)}">
								{stat.percentage}%
							</div>
						</div>
						<div class="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
							<div class="h-full rounded-full bg-primary-500" style="width: {stat.percentage}%"></div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}
