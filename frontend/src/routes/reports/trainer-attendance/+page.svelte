<script lang="ts">
	import { browser } from '$app/environment';
	import { base } from '$app/paths';
	import { pb } from '$lib/pocketbase';
	import type { Training, TrainingAttendance } from '$lib/types';
	import { contextFilter, selectedSeasonId, selectedTeamId } from '$lib/stores/context';

	interface TrainerStat {
		id: string;
		name: string;
		trainingCount: number;
		trainingSharePct: number;
		totalMinutes: number;
		totalHoursFormatted: string;
		timeSharePct: number;
		presentCount: number;
		totalAttendanceRecords: number;
		attendancePercentage: number;
		avgPlayersPresent: number;
		avgPlayersTotal: number;
	}

	interface DayStat {
		dayName: string;
		dayIndex: number;
		trainingCount: number;
		presentCount: number;
		totalCount: number;
		percentage: number;
	}

	interface TrainingDetail {
		id: string;
		date: string;
		formattedDate: string;
		weekday: string;
		durationMinutes: number;
		trainers: string[];
		present: number;
		absent: number;
		sick: number;
		school: number;
		late: number;
		injured: number;
		total: number;
		percentage: number;
	}

	let loading = true;
	let loadSequence = 0;

	let totalTrainingsCount = 0;
	let totalTeamMinutes = 0;
	let totalTeamHoursFormatted = '0u';
	let overallAttendancePct = 0;
	let avgPlayersPerTraining = 0;

	let trainerStats: TrainerStat[] = [];
	let dayStats: DayStat[] = [];
	let trainingDetails: TrainingDetail[] = [];

	$: if (browser) {
		loadData($selectedTeamId, $selectedSeasonId);
	}

	function formatMinutesToHours(minutes: number): string {
		const hours = Math.floor(minutes / 60);
		const mins = minutes % 60;
		if (mins === 0) return `${hours}u`;
		return `${hours}u ${mins}m`;
	}

	function formatDutchDate(dateStr: string): { full: string; weekday: string } {
		const d = new Date(dateStr.replace(' ', 'T'));
		const weekday = d.toLocaleDateString('nl-NL', { weekday: 'long' });
		const formattedWeekday = weekday.charAt(0).toUpperCase() + weekday.slice(1);
		const formattedDate = d.toLocaleDateString('nl-NL', {
			day: 'numeric',
			month: 'long',
			year: 'numeric',
		});
		return {
			weekday: formattedWeekday,
			full: `${formattedWeekday} ${formattedDate}`,
		};
	}

	async function loadData(teamId: string, seasonId: string) {
		const seq = ++loadSequence;
		loading = true;

		try {
			const filter = `${contextFilter(teamId, seasonId)} && status = "closed"`;
			const trainings = await pb.collection('trainings').getFullList<Training>({
				filter: filter || undefined,
				sort: '-date',
				expand: 'trainer',
			});

			if (seq !== loadSequence) return;

			totalTrainingsCount = trainings.length;
			totalTeamMinutes = trainings.reduce((sum, t) => sum + (Number(t.duration_minutes) || 90), 0);
			totalTeamHoursFormatted = formatMinutesToHours(totalTeamMinutes);

			const trainingIds = new Set(trainings.map(t => t.id));

			const allAttendance = await pb.collection('training_attendance').getFullList<TrainingAttendance>({
				fields: 'training,status',
			});

			if (seq !== loadSequence) return;

			// Map attendance records by training
			const attendanceByTraining: Record<string, {
				present: number;
				absent: number;
				sick: number;
				school: number;
				late: number;
				injured: number;
				total: number;
			}> = {};

			let grandPresent = 0;
			let grandTotal = 0;

			for (const att of allAttendance) {
				if (!trainingIds.has(att.training)) continue;
				if (!attendanceByTraining[att.training]) {
					attendanceByTraining[att.training] = {
						present: 0,
						absent: 0,
						sick: 0,
						school: 0,
						late: 0,
						injured: 0,
						total: 0,
					};
				}
				const slot = attendanceByTraining[att.training];
				slot.total++;
				grandTotal++;

				if (att.status === 'present') {
					slot.present++;
					grandPresent++;
				} else if (att.status === 'absent') {
					slot.absent++;
				} else if (att.status === 'sick') {
					slot.sick++;
				} else if (att.status === 'school') {
					slot.school++;
				} else if (att.status === 'late') {
					slot.late++;
				} else if (att.status === 'injured') {
					slot.injured++;
				}
			}

			overallAttendancePct = grandTotal > 0 ? Math.round((grandPresent / grandTotal) * 100) : 0;
			avgPlayersPerTraining = totalTrainingsCount > 0
				? Math.round((grandPresent / totalTrainingsCount) * 10) / 10
				: 0;

			// 1. Build Training Details per Session
			trainingDetails = trainings.map(t => {
				const dateInfo = formatDutchDate(t.date);
				const duration = Number(t.duration_minutes) || 90;
				const trainerNames = t.expand?.trainer?.length
					? t.expand.trainer.map(tr => tr.name || tr.email || 'Trainer')
					: ['Geen trainer gekoppeld'];
				const att = attendanceByTraining[t.id] || {
					present: 0,
					absent: 0,
					sick: 0,
					school: 0,
					late: 0,
					injured: 0,
					total: 0,
				};
				const percentage = att.total > 0 ? Math.round((att.present / att.total) * 100) : 0;

				return {
					id: t.id,
					date: t.date,
					formattedDate: dateInfo.full,
					weekday: dateInfo.weekday,
					durationMinutes: duration,
					trainers: trainerNames,
					present: att.present,
					absent: att.absent,
					sick: att.sick,
					school: att.school,
					late: att.late,
					injured: att.injured,
					total: att.total,
					percentage,
				};
			});

			// 2. Build Trainer Stats
			const byTrainer: Record<string, {
				id: string;
				name: string;
				trainingIds: Set<string>;
				totalMinutes: number;
				present: number;
				total: number;
			}> = {};

			for (const t of trainings) {
				const duration = Number(t.duration_minutes) || 90;
				const att = attendanceByTraining[t.id] || { present: 0, total: 0 };
				const trainers = t.expand?.trainer?.length
					? t.expand.trainer.map(tr => ({ id: tr.id, name: tr.name || tr.email || 'Trainer' }))
					: [{ id: 'unassigned', name: 'Geen trainer gekoppeld' }];

				for (const tr of trainers) {
					if (!byTrainer[tr.id]) {
						byTrainer[tr.id] = {
							id: tr.id,
							name: tr.name,
							trainingIds: new Set<string>(),
							totalMinutes: 0,
							present: 0,
							total: 0,
						};
					}
					byTrainer[tr.id].trainingIds.add(t.id);
					byTrainer[tr.id].totalMinutes += duration;
					byTrainer[tr.id].present += att.present;
					byTrainer[tr.id].total += att.total;
				}
			}

			trainerStats = Object.values(byTrainer)
				.map(st => {
					const count = st.trainingIds.size;
					const sharePct = totalTrainingsCount > 0 ? Math.round((count / totalTrainingsCount) * 100) : 0;
					const timeShare = totalTeamMinutes > 0 ? Math.round((st.totalMinutes / totalTeamMinutes) * 100) : 0;
					const attendancePct = st.total > 0 ? Math.round((st.present / st.total) * 100) : 0;
					const avgPresent = count > 0 ? Math.round((st.present / count) * 10) / 10 : 0;
					const avgTotal = count > 0 ? Math.round((st.total / count) * 10) / 10 : 0;

					return {
						id: st.id,
						name: st.name,
						trainingCount: count,
						trainingSharePct: sharePct,
						totalMinutes: st.totalMinutes,
						totalHoursFormatted: formatMinutesToHours(st.totalMinutes),
						timeSharePct: timeShare,
						presentCount: st.present,
						totalAttendanceRecords: st.total,
						attendancePercentage: attendancePct,
						avgPlayersPresent: avgPresent,
						avgPlayersTotal: avgTotal,
					};
				})
				.sort((a, b) => b.trainingCount - a.trainingCount || b.attendancePercentage - a.attendancePercentage);

			// 3. Build Attendance Per Day of the Week (Maandag..Zondag)
			const daysMap: Record<number, { dayName: string; dayIndex: number; count: number; present: number; total: number }> = {};
			const dayNames = ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag'];

			for (const t of trainings) {
				const d = new Date(t.date.replace(' ', 'T'));
				const dayIdx = d.getDay();
				const att = attendanceByTraining[t.id] || { present: 0, total: 0 };

				if (!daysMap[dayIdx]) {
					daysMap[dayIdx] = {
						dayName: dayNames[dayIdx],
						dayIndex: dayIdx,
						count: 0,
						present: 0,
						total: 0,
					};
				}
				daysMap[dayIdx].count++;
				daysMap[dayIdx].present += att.present;
				daysMap[dayIdx].total += att.total;
			}

			// Sort by weekday (Maandag t/m Zondag)
			const weekdayOrder = [1, 2, 3, 4, 5, 6, 0];
			dayStats = weekdayOrder
				.filter(idx => daysMap[idx] && daysMap[idx].count > 0)
				.map(idx => {
					const item = daysMap[idx];
					const pct = item.total > 0 ? Math.round((item.present / item.total) * 100) : 0;
					return {
						dayName: item.dayName,
						dayIndex: item.dayIndex,
						trainingCount: item.count,
						presentCount: item.present,
						totalCount: item.total,
						percentage: pct,
					};
				});

		} catch (error) {
			console.error('Failed to load trainer attendance report data:', error);
		} finally {
			if (seq === loadSequence) {
				loading = false;
			}
		}
	}

	function statusColor(pct: number): string {
		if (pct >= 80) return 'text-green-600 dark:text-green-400';
		if (pct >= 60) return 'text-yellow-600 dark:text-yellow-400';
		return 'text-red-600 dark:text-red-400';
	}

	function barColor(pct: number): string {
		if (pct >= 80) return 'bg-green-500';
		if (pct >= 60) return 'bg-yellow-500';
		return 'bg-red-500';
	}
</script>

<svelte:head>
	<title>Trainers & Opkomst per dag - SetBaas</title>
</svelte:head>

{#if loading}
	<div class="flex justify-center py-12">
		<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
	</div>
{:else}
	<div class="space-y-6">
		<div>
			<a href="{base}/reports" class="text-primary-600 text-sm hover:underline">← Rapportages</a>
			<h2 class="text-xl font-bold text-gray-800 dark:text-gray-200 mt-1">Trainingsinzet & Opkomst per dag</h2>
			<p class="text-sm text-gray-500 dark:text-gray-400">
				Inzicht in aantal trainingen, percentages en tijd per trainer, plus de opkomst per trainingsdag en sessie.
			</p>
		</div>

		<!-- KPI Summary Cards -->
		<div class="grid grid-cols-2 md:grid-cols-4 gap-3">
			<div class="card text-center p-3">
				<div class="text-2xl font-bold text-primary-600">{totalTrainingsCount}</div>
				<div class="text-xs text-gray-500 dark:text-gray-400 font-medium">Afgeronde trainingen</div>
			</div>
			<div class="card text-center p-3">
				<div class="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{totalTeamHoursFormatted}</div>
				<div class="text-xs text-gray-500 dark:text-gray-400 font-medium">Totale trainingstijd</div>
			</div>
			<div class="card text-center p-3">
				<div class="text-2xl font-bold {statusColor(overallAttendancePct)}">{overallAttendancePct}%</div>
				<div class="text-xs text-gray-500 dark:text-gray-400 font-medium">Gem. spelersopkomst</div>
			</div>
			<div class="card text-center p-3">
				<div class="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{avgPlayersPerTraining}</div>
				<div class="text-xs text-gray-500 dark:text-gray-400 font-medium">Gem. aanwezigen / training</div>
			</div>
		</div>

		{#if totalTrainingsCount === 0}
			<div class="card text-center py-8 text-gray-500 dark:text-gray-400">
				<p>Nog geen afgeronde trainingen geregistreerd voor dit team en seizoen.</p>
			</div>
		{:else}
			<!-- Section 1: Per Trainer Breakdown -->
			<div class="space-y-3">
				<h3 class="text-lg font-bold text-gray-800 dark:text-gray-200">
					Trainers: aantal, aandeel, tijd & opkomst
				</h3>

				<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
					{#each trainerStats as stat}
						<div class="card p-4 space-y-3">
							<div class="flex items-center justify-between gap-2 border-b border-gray-100 dark:border-gray-800 pb-2">
								<div class="min-w-0">
									<h4 class="font-bold text-gray-800 dark:text-gray-200 text-base truncate">{stat.name}</h4>
									<p class="text-xs text-gray-500 dark:text-gray-400">
										{stat.trainingCount} van {totalTrainingsCount} trainingen gegeven
									</p>
								</div>
								<div class="text-right flex-shrink-0">
									<span class="text-xs px-2 py-0.5 rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 font-semibold">
										{stat.trainingSharePct}% van trainingen
									</span>
								</div>
							</div>

							<!-- Metric Badges -->
							<div class="grid grid-cols-3 gap-2 text-center text-xs">
								<div class="bg-gray-50 dark:bg-gray-800/60 p-2 rounded-lg">
									<div class="font-bold text-gray-800 dark:text-gray-200 text-sm">{stat.trainingCount}x</div>
									<div class="text-gray-500 dark:text-gray-400 text-[11px]">Aantal</div>
								</div>
								<div class="bg-gray-50 dark:bg-gray-800/60 p-2 rounded-lg">
									<div class="font-bold text-indigo-600 dark:text-indigo-400 text-sm">{stat.totalHoursFormatted}</div>
									<div class="text-gray-500 dark:text-gray-400 text-[11px]">Tijd ({stat.timeSharePct}%)</div>
								</div>
								<div class="bg-gray-50 dark:bg-gray-800/60 p-2 rounded-lg">
									<div class="font-bold text-sm {statusColor(stat.attendancePercentage)}">{stat.attendancePercentage}%</div>
									<div class="text-gray-500 dark:text-gray-400 text-[11px]">Opkomst</div>
								</div>
							</div>

							<!-- Opkomst Progress -->
							<div>
								<div class="flex justify-between text-xs mb-1 text-gray-600 dark:text-gray-400">
									<span>Spelersopkomst bij deze trainer:</span>
									<span class="font-semibold">{stat.avgPlayersPresent} van {stat.avgPlayersTotal} spelers gem.</span>
								</div>
								<div class="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-2">
									<div
										class="h-2 rounded-full transition-all duration-500 {barColor(stat.attendancePercentage)}"
										style="width: {stat.attendancePercentage}%"
									></div>
								</div>
							</div>
						</div>
					{/each}
				</div>
			</div>

			<!-- Section 2: Opkomst per dag van de week -->
			<div class="space-y-3">
				<h3 class="text-lg font-bold text-gray-800 dark:text-gray-200">
					Opkomst per dag van de week
				</h3>

				<div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
					{#each dayStats as d}
						<div class="card p-3">
							<div class="flex items-center justify-between mb-1">
								<span class="font-semibold text-gray-800 dark:text-gray-200">{d.dayName}</span>
								<span class="text-base font-bold {statusColor(d.percentage)}">{d.percentage}%</span>
							</div>
							<p class="text-xs text-gray-500 dark:text-gray-400 mb-2">
								{d.trainingCount} training{d.trainingCount === 1 ? '' : 'en'} · {d.presentCount}/{d.totalCount} spelersaanwezigheden
							</p>
							<div class="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-2">
								<div
									class="h-2 rounded-full transition-all duration-500 {barColor(d.percentage)}"
									style="width: {d.percentage}%"
								></div>
							</div>
						</div>
					{/each}
				</div>
			</div>

			<!-- Section 3: Detail per afgeronde trainingssessie -->
			<div class="space-y-3">
				<h3 class="text-lg font-bold text-gray-800 dark:text-gray-200">
					Opkomst per afzonderlijke trainingssessie
				</h3>

				<div class="space-y-2">
					{#each trainingDetails as item}
						<div class="card p-3 hover:shadow-sm transition-shadow">
							<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
								<div>
									<div class="flex items-center gap-2 flex-wrap">
										<span class="font-bold text-gray-800 dark:text-gray-200 text-sm">
											{item.formattedDate}
										</span>
										<span class="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
											⏱ {item.durationMinutes} min
										</span>
									</div>
									<p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
										Trainer(s): <span class="font-medium text-gray-700 dark:text-gray-300">{item.trainers.join(', ')}</span>
									</p>
								</div>
								<div class="flex items-center gap-3">
									<div class="text-right">
										<div class="text-base font-bold {statusColor(item.percentage)}">
											{item.percentage}%
										</div>
										<div class="text-[11px] text-gray-500 dark:text-gray-400">
											{item.present} van {item.total} aanwezig
										</div>
									</div>
								</div>
							</div>

							<!-- Bar -->
							<div class="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-2 mb-2">
								<div
									class="h-2 rounded-full transition-all duration-500 {barColor(item.percentage)}"
									style="width: {item.percentage}%"
								></div>
							</div>

							<!-- Status tags -->
							<div class="flex gap-2 text-xs flex-wrap">
								<span class="inline-flex items-center gap-1 text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/40 px-2 py-0.5 rounded">
									<span class="w-1.5 h-1.5 rounded-full bg-green-500"></span>
									Aanwezig: {item.present}
								</span>
								{#if item.absent > 0}
									<span class="inline-flex items-center gap-1 text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/40 px-2 py-0.5 rounded">
										<span class="w-1.5 h-1.5 rounded-full bg-red-500"></span>
										Afwezig: {item.absent}
									</span>
								{/if}
								{#if item.sick > 0}
									<span class="inline-flex items-center gap-1 text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950/40 px-2 py-0.5 rounded">
										<span class="w-1.5 h-1.5 rounded-full bg-yellow-500"></span>
										Ziek: {item.sick}
									</span>
								{/if}
								{#if item.school > 0}
									<span class="inline-flex items-center gap-1 text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 rounded">
										<span class="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
										School: {item.school}
									</span>
								{/if}
								{#if item.late > 0}
									<span class="inline-flex items-center gap-1 text-purple-700 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/40 px-2 py-0.5 rounded">
										<span class="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
										Laat: {item.late}
									</span>
								{/if}
								{#if item.injured > 0}
									<span class="inline-flex items-center gap-1 text-orange-700 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/40 px-2 py-0.5 rounded">
										<span class="w-1.5 h-1.5 rounded-full bg-orange-500"></span>
										Geblesseerd: {item.injured}
									</span>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	</div>
{/if}
