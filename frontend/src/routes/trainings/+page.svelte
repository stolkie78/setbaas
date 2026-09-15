<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { page } from '$app/stores';
	import { getTrainingAttendance, pb } from '$lib/pocketbase';
	import { marked } from 'marked';
	import type { Training, TrainingAttendance } from '$lib/types';
	import { ATTENDANCE_LABELS } from '$lib/types';
	import { selectedTeamId, selectedSeasonId, trainingsSortOrder } from '$lib/stores/context';
	import { contextFilter } from '$lib/stores/context';
	import { ArrowDownUp, MapPin, Plus } from 'lucide-svelte';

	const HAPPINESS_EMOJIS = ['', '😢', '😕', '😐', '😊', '🤩'];
	const FITNESS_EMOJIS = ['', '🥱', '😴', '💪', '🔥', '⚡'];

	let trainings: Training[] = [];
	let loading = true;
	let expandedId: string | null = null;
	let lightboxTraining: Training | null = null;
	let lightboxAttendance: TrainingAttendance[] = [];
	let lightboxLoading = false;
	let lightboxError = '';
	let statusFilter: 'all' | 'open' | 'closed' = 'all';

	const statusLabels = {
		open: 'Gepland',
		active: 'Actief',
		closed: 'Afgerond',
	};

	// Read initial filter from URL query param
	$: {
		const urlFilter = $page.url.searchParams.get('status');
		if (urlFilter === 'open' || urlFilter === 'closed') {
			statusFilter = urlFilter;
		}
	}

	$: sortedTrainings = [...trainings].sort((a, b) => {
		const diff = new Date(a.date).getTime() - new Date(b.date).getTime();
		return $trainingsSortOrder === 'asc' ? diff : -diff;
	});
	$: filteredTrainings = statusFilter === 'all'
		? sortedTrainings
		: sortedTrainings.filter(t => statusFilter === 'open' ? (t.status === 'open' || t.status === 'active') : t.status === 'closed');

	function toggleSort() {
		trainingsSortOrder.set($trainingsSortOrder === 'desc' ? 'asc' : 'desc');
	}

	onMount(async () => {
		try {
			const filter = contextFilter($selectedTeamId, $selectedSeasonId);
			trainings = await pb.collection('trainings').getFullList<Training>({
				sort: 'date',
				filter: filter || undefined,
				expand: 'template,created_by,trainer',
			});
		} catch (e) {
			console.error('Failed to load trainings:', e);
		} finally {
			loading = false;
		}
	});

	function toggleExpand(id: string) {
		expandedId = expandedId === id ? null : id;
	}

	async function openTraining(training: Training) {
		lightboxTraining = training;
		lightboxAttendance = [];
		lightboxError = '';
		lightboxLoading = true;
		try {
			lightboxAttendance = await getTrainingAttendance(training.id);
		} catch (error) {
			console.error('Failed to load training attendance:', error);
			lightboxError = 'De aanwezigheid en spelersscores konden niet worden geladen.';
		} finally {
			lightboxLoading = false;
		}
	}

	function closeTraining() {
		lightboxTraining = null;
		lightboxAttendance = [];
		lightboxError = '';
	}
</script>

<svelte:head>
	<title>Trainingen - SetBaas</title>
</svelte:head>

<div class="space-y-4">
	<div class="flex justify-between items-center">
		<h2 class="text-xl font-bold text-gray-800 dark:text-gray-200">Trainingen</h2>
		<div class="flex gap-2">
			<button
				class="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 transition-colors hover:bg-gray-100 hover:text-primary-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-primary-400"
				on:click={toggleSort}
				title={$trainingsSortOrder === 'desc' ? 'Nieuwste eerst — klik voor oudste eerst' : 'Oudste eerst — klik voor nieuwste eerst'}
				aria-label={$trainingsSortOrder === 'desc' ? 'Sorteer trainingen: nieuwste eerst' : 'Sorteer trainingen: oudste eerst'}
			>
				<ArrowDownUp size={22} />
			</button>
			<a
				href="{base}/trainings/new"
				class="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary-600 text-white transition-colors hover:bg-primary-700"
				title="Nieuwe training"
				aria-label="Nieuwe training"
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
			Alles ({trainings.length})
		</button>
		<button
			class="flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors {statusFilter === 'open' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'}"
			on:click={() => statusFilter = 'open'}>
			Gepland ({trainings.filter(t => t.status === 'open' || t.status === 'active').length})
		</button>
		<button
			class="flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors {statusFilter === 'closed' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'}"
			on:click={() => statusFilter = 'closed'}>
			Afgerond ({trainings.filter(t => t.status === 'closed').length})
		</button>
	</div>

	{#if loading}
		<div class="flex justify-center py-8">
			<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
		</div>
	{:else if trainings.length === 0}
		<div class="card text-center py-8 text-gray-500 dark:text-gray-400">
			<p>Nog geen trainingen geregistreerd</p>
		</div>
	{:else}
		<div class="grid grid-cols-1 md:grid-cols-2 gap-2">
			{#each filteredTrainings as training}
				<div class="card">
					<div class="flex justify-between items-center">
						<div class="flex items-center gap-2">
							{#if training.status === 'open'}
								<span class="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0"></span>
							{:else if training.status === 'active'}
								<span class="w-2 h-2 rounded-full bg-green-500 animate-pulse flex-shrink-0"></span>
							{:else}
								<span class="w-2 h-2 rounded-full bg-green-500 flex-shrink-0"></span>
							{/if}
							<div>
								<span class="font-semibold text-sm">
									{new Date(training.date).toLocaleDateString('nl-NL', {
										weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
									})}
								</span>
								<span class="text-xs text-gray-400 ml-2">
									{new Date(training.date).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', hour12: false })}
								</span>
								{#if training.expand?.template}
									<span class="text-xs text-primary-600 dark:text-primary-400 ml-2">{training.expand.template.name}</span>
								{/if}
							</div>
						</div>
						<div class="flex items-center gap-2">
							{#if training.overall_rating}
								<span class="inline-flex items-center px-2.5 py-1 rounded-full text-sm font-bold {
									training.overall_rating >= 7 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
									training.overall_rating >= 5 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
									'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
								}">
									{training.overall_rating}/10
								</span>
							{/if}
							<button
								type="button"
								class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-primary-600 transition-colors text-sm"
								title="Bekijk training"
								on:click={() => openTraining(training)}
							>
								Bekijk
							</button>
							<a href="{base}/trainings/{training.id}/edit" class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-primary-600 transition-colors text-sm" title="Bewerken">
								Bewerk
							</a>
						</div>
					</div>
					{#if training.general_comments && expandedId !== training.id}
						<p class="text-sm text-gray-600 dark:text-gray-400 mt-2 line-clamp-2">{training.general_comments}</p>
					{/if}
					{#if training.location}
						<p class="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 mt-1.5">
							<MapPin size={13} class="text-gray-400 flex-shrink-0" />
							{training.location}
						</p>
					{/if}
					{#if training.expand?.created_by}
						<p class="text-xs text-gray-400 dark:text-gray-500 mt-1">Aangemaakt door {training.expand.created_by.name || training.expand.created_by.email}</p>
					{/if}

					</div>
			{/each}
		</div>
	{/if}
</div>

<!-- Lightbox modal -->
{#if lightboxTraining}
	<!-- svelte-ignore a11y-click-events-have-key-events -->
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" on:click={closeTraining}>
		<div
			class="bg-white dark:bg-gray-900 w-full h-full md:w-[90%] md:h-[90%] md:rounded-2xl shadow-2xl flex flex-col overflow-hidden"
			on:click|stopPropagation
		>
			<!-- Header -->
			<div class="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
				<div>
					<h2 class="text-lg font-bold text-gray-800 dark:text-gray-100">
						{new Date(lightboxTraining.date).toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
					</h2>
					<p class="text-sm text-gray-500 dark:text-gray-400">
						{new Date(lightboxTraining.date).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', hour12: false })}
						· {statusLabels[lightboxTraining.status || 'open']}
					</p>
				</div>
				<div class="flex items-center gap-2">
					{#if lightboxTraining.status === 'open'}
						<a href="{base}/trainings/{lightboxTraining.id}/checkin" class="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition-colors">
							Start Training
						</a>
					{:else if lightboxTraining.status === 'active'}
						<a href="{base}/trainings/{lightboxTraining.id}/checkout" class="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition-colors">
							Afronden
						</a>
					{/if}
					<button
						class="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 transition-colors flex items-center gap-2"
						on:click={() => { window.print(); }}
					>
						Print / PDF
					</button>
					<button
						class="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 transition-colors text-xl"
						on:click={closeTraining}
					>
						✕
					</button>
				</div>
			</div>
			<!-- Content -->
			<div class="flex-1 overflow-y-auto px-6 py-6 md:px-12 md:py-8">
				<div class="grid grid-cols-2 {lightboxTraining.location ? 'lg:grid-cols-5' : 'lg:grid-cols-4'} gap-3 mb-6">
					<div class="rounded-xl bg-gray-50 dark:bg-gray-800 p-3">
						<p class="text-xs text-gray-500 dark:text-gray-400">Status</p>
						<p class="font-semibold text-gray-900 dark:text-gray-100">{statusLabels[lightboxTraining.status || 'open']}</p>
					</div>
					<div class="rounded-xl bg-gray-50 dark:bg-gray-800 p-3">
						<p class="text-xs text-gray-500 dark:text-gray-400">Template</p>
						<p class="font-semibold text-gray-900 dark:text-gray-100">{lightboxTraining.expand?.template?.name || 'Geen template'}</p>
					</div>
					<div class="rounded-xl bg-gray-50 dark:bg-gray-800 p-3">
						<p class="text-xs text-gray-500 dark:text-gray-400">Trainer</p>
						<p class="font-semibold text-gray-900 dark:text-gray-100">
							{lightboxTraining.expand?.trainer?.map(trainer => trainer.name || trainer.email).join(', ') || 'Niet toegewezen'}
						</p>
					</div>
					{#if lightboxTraining.location}
						<div class="rounded-xl bg-gray-50 dark:bg-gray-800 p-3">
							<p class="text-xs text-gray-500 dark:text-gray-400">Sporthal / Locatie</p>
							<p class="font-semibold text-gray-900 dark:text-gray-100">{lightboxTraining.location}</p>
						</div>
					{/if}
					<div class="rounded-xl bg-gray-50 dark:bg-gray-800 p-3">
						<p class="text-xs text-gray-500 dark:text-gray-400">Trainingsscore</p>
						<p class="font-semibold text-gray-900 dark:text-gray-100">
							{lightboxTraining.overall_rating ? `${lightboxTraining.overall_rating}/10` : 'Niet beoordeeld'}
						</p>
					</div>
				</div>

				{#if lightboxTraining.expand?.created_by}
					<p class="text-sm text-gray-500 dark:text-gray-400 mb-6">
						Aangemaakt door {lightboxTraining.expand.created_by.name || lightboxTraining.expand.created_by.email}
					</p>
				{/if}

				<section class="mb-8">
					<h3 class="text-lg font-bold text-gray-900 dark:text-gray-100 mb-3">Training</h3>
					{#if lightboxTraining.content}
						<div class="prose prose-lg dark:prose-invert max-w-none print:prose-sm">
							{@html marked(lightboxTraining.content, { breaks: true })}
						</div>
					{:else}
						<p class="text-sm text-gray-500 dark:text-gray-400 italic">Geen trainingsinhoud vastgelegd.</p>
					{/if}
				</section>

				<section class="border-t border-gray-200 dark:border-gray-700 pt-6">
					<div class="flex items-center justify-between gap-3 mb-3">
						<h3 class="text-lg font-bold text-gray-900 dark:text-gray-100">Aanwezigheid en spelersinformatie</h3>
						{#if !lightboxLoading}
							<span class="text-sm font-semibold text-green-600">
								{lightboxAttendance.filter(item => item.status === 'present').length}/{lightboxAttendance.length} aanwezig
							</span>
						{/if}
					</div>

					{#if lightboxLoading}
						<p class="text-sm text-gray-500 dark:text-gray-400">Spelersinformatie laden...</p>
					{:else if lightboxError}
						<p class="text-sm text-red-600 dark:text-red-400">{lightboxError}</p>
					{:else if lightboxAttendance.length === 0}
						<p class="text-sm text-gray-500 dark:text-gray-400 italic">Geen aanwezigheid geregistreerd.</p>
					{:else}
						<div class="space-y-2">
							{#each lightboxAttendance as attendance}
								<div class="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
									<div class="flex flex-wrap items-center justify-between gap-2">
										<p class="font-semibold text-gray-900 dark:text-gray-100">
											{attendance.expand?.player?.name || 'Onbekende speler'}
										</p>
										<div class="flex flex-wrap items-center gap-2 text-xs">
											<span class="rounded-full px-2 py-1 {
												attendance.status === 'present'
													? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
													: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
											}">
												{ATTENDANCE_LABELS[attendance.status]}
											</span>
											{#if attendance.player_rating}
												<span class="font-semibold text-gray-700 dark:text-gray-300">{attendance.player_rating}/10</span>
											{/if}
										</div>
									</div>
									{#if attendance.happiness || attendance.fitness || attendance.player_notes}
										<div class="mt-2 text-sm text-gray-600 dark:text-gray-400 space-y-1">
											{#if attendance.happiness || attendance.fitness}
												<p class="flex items-center gap-3">
													{#if attendance.happiness}<span>{HAPPINESS_EMOJIS[attendance.happiness]} <span class="text-xs text-gray-400">gevoel</span></span>{/if}
													{#if attendance.fitness}<span>{FITNESS_EMOJIS[attendance.fitness]} <span class="text-xs text-gray-400">fitheid</span></span>{/if}
												</p>
											{/if}
											{#if attendance.player_notes}<p>Notities: {attendance.player_notes}</p>{/if}
										</div>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</section>

				{#if lightboxTraining.general_comments}
					<div class="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
						<h3 class="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">Opmerkingen</h3>
						<p class="text-gray-700 dark:text-gray-300 whitespace-pre-line">{lightboxTraining.general_comments}</p>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	@media print {
		:global(nav), :global(header), :global(.hamburger), :global([data-sidebar]) {
			display: none !important;
		}
	}
</style>
