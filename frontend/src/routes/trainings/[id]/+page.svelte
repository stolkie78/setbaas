<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { page } from '$app/stores';
	import { pb, getTrainingAttendance, updateTrainingAttendance } from '$lib/pocketbase';
	import type { Training, TrainingAttendance } from '$lib/types';
	import { ATTENDANCE_LABELS, ATTENDANCE_STYLES } from '$lib/types';
	import { marked } from 'marked';
	import { CircleCheck, FileDown, Pencil } from 'lucide-svelte';

	const HAPPINESS_EMOJIS = ['😢', '😕', '😐', '😊', '🤩'];
	const HAPPINESS_LABELS = ['Baal', 'Meh', 'Oké', 'Blij', 'Super!'];
	const FITNESS_EMOJIS = ['🥱', '😴', '💪', '🔥', '⚡'];
	const FITNESS_LABELS = ['Moe', 'Sloom', 'Goed', 'Fit', 'Top!'];

	let training: Training | null = null;
	let attendance: TrainingAttendance[] = [];
	let loading = true;
	let editingCheckinId: string | null = null;
	let savingCheckin = false;

	$: presentCount = attendance.filter(a => a.status === 'present').length;
	$: checkedInAttendance = attendance.filter(a => a.status === 'present' && (a.happiness || a.fitness));
	$: reflectionAttendance = attendance.filter(a => a.checkout_selected);

	onMount(async () => {
		try {
			training = await pb.collection('trainings').getOne<Training>($page.params.id);
			attendance = await getTrainingAttendance(training.id);
		} catch (e) {
			training = null;
		}
		loading = false;
	});

	function exportPDF() {
		window.print();
	}

	function startEditCheckin(attendanceId: string) {
		editingCheckinId = editingCheckinId === attendanceId ? null : attendanceId;
	}

	async function saveCheckin(att: TrainingAttendance, happiness: number, fitness: number) {
		savingCheckin = true;
		try {
			const updated = await updateTrainingAttendance(att.id, { happiness, fitness });
			attendance = attendance.map(a => a.id === att.id ? { ...a, ...updated } : a);
			editingCheckinId = null;
		} catch (e) {
			console.error('Failed to update check-in:', e);
			alert('Fout bij bijwerken check-in');
		}
		savingCheckin = false;
	}
</script>

<svelte:head>
	<title>Training - SetBaas</title>
	<style>
		@media print {
			nav, header, .no-print, button, a.btn-primary { display: none !important; }
			body { background: white !important; color: black !important; }
			.card { border: none !important; box-shadow: none !important; padding: 0 !important; }
			.dark\:prose-invert { color: black !important; }
			.print-header { display: block !important; }
		}
	</style>
</svelte:head>

{#if loading}
	<div class="flex justify-center py-12">
		<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
	</div>
{:else if !training}
	<p class="text-center text-gray-500 py-8">Training niet gevonden</p>
{:else}
	<div class="max-w-2xl mx-auto space-y-4">
		<div class="flex justify-between items-center">
			<h1 class="text-xl font-bold text-gray-900 dark:text-gray-100">
				Training {new Date(training.date).toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
			</h1>
			<div class="flex gap-2 no-print">
				{#if training.status === 'active'}
					<a
						href="{base}/trainings/{training.id}/checkout"
						class="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary-600 text-white transition-colors hover:bg-primary-700"
						title="Training afronden"
						aria-label="Training afronden"
					>
						<CircleCheck size={22} />
					</a>
				{/if}
				<button
					on:click={exportPDF}
					class="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 transition-colors hover:bg-gray-100 hover:text-primary-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-primary-400"
					title="Downloaden als PDF"
					aria-label="Downloaden als PDF"
				>
					<FileDown size={22} />
				</button>
				<a
					href="{base}/trainings/{training.id}/edit?returnTo={base}/trainings/{training.id}"
					class="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 transition-colors hover:bg-gray-100 hover:text-primary-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-primary-400"
					title="Training bewerken"
					aria-label="Training bewerken"
				>
					<Pencil size={22} />
				</a>
			</div>
		</div>

		{#if training.overall_rating}
			<div class="flex items-center gap-2">
				<span class="text-sm text-gray-500">Beoordeling:</span>
				<span class="text-lg font-bold {
					training.overall_rating >= 7 ? 'text-green-600' :
					training.overall_rating >= 5 ? 'text-yellow-600' : 'text-red-600'
				}">{training.overall_rating}/10</span>
			</div>
		{/if}

		<!-- Aanwezigheid -->
		<div class="card">
			<div class="flex justify-between items-center mb-3">
				<h2 class="font-semibold text-gray-900 dark:text-gray-100">👥 Aanwezigheid</h2>
				<span class="text-sm font-medium {presentCount > 0 ? 'text-green-600' : 'text-gray-400'}">
					{presentCount}/{attendance.length} aanwezig
				</span>
			</div>
			{#if attendance.length === 0}
				<p class="text-sm text-gray-500 italic">Nog geen aanwezigheid geregistreerd.</p>
			{:else}
				<div class="flex flex-wrap gap-2">
					{#each attendance as att}
						{@const player = att.expand?.player}
						{@const styles = ATTENDANCE_STYLES[att.status]}
						<span class="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm {styles.badge}" title={att.reason || ''}>
							<span class="w-1.5 h-1.5 rounded-full {styles.dot}"></span>
							{player ? player.name : '...'}
							<span class="text-xs opacity-75">({ATTENDANCE_LABELS[att.status]})</span>
						</span>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Check-in overzicht -->
		{#if checkedInAttendance.length > 0}
			<div class="card space-y-3">
				<h2 class="font-semibold text-gray-900 dark:text-gray-100">😊 Check-in overzicht</h2>
				<div class="space-y-2">
					{#each checkedInAttendance as att}
						{@const player = att.expand?.player}
						<div class="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
							<div class="flex items-center justify-between gap-2">
								<span class="font-medium text-gray-800 dark:text-gray-200">{player ? player.name : '...'}</span>
								<div class="flex items-center gap-3">
									{#if att.happiness}<span class="text-xl" title="Gevoel">{HAPPINESS_EMOJIS[att.happiness - 1]}</span>{/if}
									{#if att.fitness}<span class="text-xl" title="Fitheid">{FITNESS_EMOJIS[att.fitness - 1]}</span>{/if}
									<button class="no-print text-xs text-primary-600 hover:text-primary-700 font-medium" on:click={() => startEditCheckin(att.id)}>
										{editingCheckinId === att.id ? 'Sluit' : 'Wijzig'}
									</button>
								</div>
							</div>
							{#if editingCheckinId === att.id}
								{@const editHappiness = att.happiness || 0}
								{@const editFitness = att.fitness || 0}
								<div class="mt-3 space-y-3 no-print">
									<div>
										<p class="text-xs font-semibold text-gray-500 mb-1">Gevoel</p>
										<div class="flex gap-1">
											{#each HAPPINESS_EMOJIS as emoji, i}
												<button type="button"
													class="text-2xl p-1.5 rounded-lg {editHappiness === i + 1 ? 'bg-amber-100 dark:bg-amber-900/40 ring-2 ring-amber-400' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}"
													title={HAPPINESS_LABELS[i]}
													disabled={savingCheckin}
													on:click={() => saveCheckin(att, i + 1, editFitness || att.fitness || 1)}>
													{emoji}
												</button>
											{/each}
										</div>
									</div>
									<div>
										<p class="text-xs font-semibold text-gray-500 mb-1">Fitheid</p>
										<div class="flex gap-1">
											{#each FITNESS_EMOJIS as emoji, i}
												<button type="button"
													class="text-2xl p-1.5 rounded-lg {editFitness === i + 1 ? 'bg-blue-100 dark:bg-blue-900/40 ring-2 ring-blue-400' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}"
													title={FITNESS_LABELS[i]}
													disabled={savingCheckin}
													on:click={() => saveCheckin(att, editHappiness || att.happiness || 1, i + 1)}>
													{emoji}
												</button>
											{/each}
										</div>
									</div>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Check-out reflectie -->
		{#if reflectionAttendance.length > 0}
			<div class="card space-y-3">
				<h2 class="font-semibold text-gray-900 dark:text-gray-100">💬 Reflectie</h2>
				{#if training.checkout_question}
					<p class="text-sm text-gray-600 dark:text-gray-400 italic">"{training.checkout_question}"</p>
				{/if}
				<div class="space-y-2">
					{#each reflectionAttendance as att}
						{@const player = att.expand?.player}
						<div class="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
							<p class="font-medium text-gray-800 dark:text-gray-200">{player ? player.name : '...'}</p>
							<p class="text-sm text-gray-600 dark:text-gray-400 mt-1">
								{att.checkout_answer || '— geen antwoord gegeven —'}
							</p>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Resultaten (voor gesloten trainingen) -->
		{#if training.status === 'closed' && (training.overall_rating || training.general_comments)}
			<div class="card space-y-3">
				<h2 class="font-semibold text-gray-900 dark:text-gray-100">📊 Resultaten</h2>
				{#if training.overall_rating}
					<div class="flex items-center gap-2">
						<span class="text-sm text-gray-600 dark:text-gray-400">Score:</span>
						<span class="text-lg font-bold {
							training.overall_rating >= 7 ? 'text-green-600' :
							training.overall_rating >= 5 ? 'text-yellow-600' : 'text-red-600'
						}">{training.overall_rating}/10</span>
					</div>
				{/if}
				{#if training.general_comments}
					<div>
						<span class="text-sm text-gray-600 dark:text-gray-400 block mb-1">Opmerkingen:</span>
						<p class="text-gray-800 dark:text-gray-200">{training.general_comments}</p>
					</div>
				{/if}
				<!-- Per-speler scores -->
				{#if attendance.some(a => a.player_rating)}
					<div class="mt-2">
						<span class="text-sm text-gray-600 dark:text-gray-400 block mb-2">Spelersscores:</span>
						<div class="flex flex-wrap gap-2">
							{#each attendance.filter(a => a.player_rating) as att}
								{@const player = att.expand?.player}
								<span class="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm bg-gray-100 dark:bg-gray-800">
									{player ? player.name : '...'}
									<span class="font-bold {
										(att.player_rating || 0) >= 7 ? 'text-green-600' :
										(att.player_rating || 0) >= 5 ? 'text-yellow-600' : 'text-red-600'
									}">{att.player_rating}/10</span>
								</span>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		{/if}

		{#if training.content}
			<div class="card prose prose-sm dark:prose-invert max-w-none">
				{@html marked(training.content, { breaks: true })}
			</div>
		{:else}
			<p class="text-gray-500 italic">Geen inhoud — klik op Bewerken om een training samen te stellen.</p>
		{/if}
	</div>
{/if}
