<script lang="ts">
	import { base } from '$app/paths';
	import {
		getQuestionnaires,
		createQuestionnaire,
		updateQuestionnaire,
		deleteQuestionnaire,
		getQuestionnaireResponses,
		getContextPlayers,
	} from '$lib/pocketbase';
	import type { Questionnaire, QuestionnaireQuestion, Player } from '$lib/types';
	import { QUESTIONNAIRE_STATUS_LABELS } from '$lib/types';
	import { selectedTeamId, selectedSeasonId } from '$lib/stores/context';
	import { authUser } from '$lib/stores/auth';
	import QuestionnaireBuilder from '$lib/components/QuestionnaireBuilder.svelte';

	let questionnaires: Questionnaire[] = [];
	let responseCounts: Record<string, number> = {};
	let players: Player[] = [];
	let loading = true;
	let showForm = false;
	let saving = false;

	let formName = '';
	let formQuestions: QuestionnaireQuestion[] = [];
	let loadedContext = '';

	// The layout resolves a club's team and season asynchronously after login.
	// Load only once that context is complete, and refresh if it changes.
	$: context = $selectedTeamId && $selectedSeasonId
		? `${$selectedTeamId}:${$selectedSeasonId}`
		: '';
	$: if (context && context !== loadedContext) {
		loadedContext = context;
		load($selectedTeamId, $selectedSeasonId);
	}

	async function load(teamId = $selectedTeamId, seasonId = $selectedSeasonId) {
		loading = true;
		try {
			[questionnaires, players] = await Promise.all([
				getQuestionnaires(teamId),
				getContextPlayers(teamId, seasonId),
			]);
			const counts: Record<string, number> = {};
			await Promise.all(
				questionnaires.map(async (q) => {
					const responses = await getQuestionnaireResponses(q.id);
					counts[q.id] = responses.length;
				})
			);
			responseCounts = counts;
		} catch (e) {
			console.error('Failed to load questionnaires:', e);
		} finally {
			loading = false;
		}
	}

	function openForm() {
		formName = '';
		formQuestions = [];
		showForm = true;
	}

	async function saveQuestionnaire(activate: boolean) {
		if (!formName.trim() || formQuestions.length === 0) return;
		saving = true;
		try {
			await createQuestionnaire({
				team: $selectedTeamId,
				name: formName.trim(),
				status: activate ? 'active' : 'draft',
				questions: formQuestions,
				created_by: $authUser?.id,
			});
			showForm = false;
			await load();
		} catch (e) {
			console.error('Failed to create questionnaire:', e);
			alert('Fout bij opslaan vragenlijst');
		} finally {
			saving = false;
		}
	}

	async function toggleStatus(q: Questionnaire) {
		const next = q.status === 'active' ? 'closed' : 'active';
		try {
			await updateQuestionnaire(q.id, { status: next });
			await load();
		} catch (e) {
			console.error('Failed to update questionnaire status:', e);
		}
	}

	async function remove(q: Questionnaire) {
		if (!confirm(`Vragenlijst "${q.name}" verwijderen? Alle antwoorden gaan verloren.`)) return;
		try {
			await deleteQuestionnaire(q.id);
			await load();
		} catch (e) {
			console.error('Failed to delete questionnaire:', e);
		}
	}
</script>

<svelte:head>
	<title>Vragenlijsten - SetBaas</title>
</svelte:head>

<div class="space-y-4">
	<!-- Sub-nav -->
	<div class="flex gap-2 border-b border-gray-200 dark:border-gray-700">
		<a href="{base}/players" class="px-3 py-2 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">
			Spelers
		</a>
		<a href="{base}/players/questionnaires" class="px-3 py-2 text-sm font-medium text-primary-600 border-b-2 border-primary-600">
			Vragenlijsten
		</a>
		<a href="{base}/players/documents" class="px-3 py-2 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">
			Documenten
		</a>
	</div>

	<div class="flex justify-between items-center">
		<h1 class="text-xl font-bold text-gray-800 dark:text-gray-200">📋 Vragenlijsten</h1>
		<button class="btn-primary text-sm px-3 py-2" on:click={openForm}>+ Nieuw</button>
	</div>

	{#if showForm}
		<div class="card space-y-3">
			<h2 class="font-semibold text-gray-800 dark:text-gray-200">Nieuwe vragenlijst</h2>
			<input class="input" type="text" placeholder="Naam (bv. Sfeer-check november)" bind:value={formName} />
			<QuestionnaireBuilder bind:questions={formQuestions} />
			<div class="flex gap-2">
				<button class="btn-secondary flex-1" disabled={saving} on:click={() => (showForm = false)}>Annuleren</button>
				<button class="btn-secondary flex-1" disabled={saving || !formName.trim() || formQuestions.length === 0} on:click={() => saveQuestionnaire(false)}>
					Opslaan als concept
				</button>
				<button class="btn-primary flex-1" disabled={saving || !formName.trim() || formQuestions.length === 0} on:click={() => saveQuestionnaire(true)}>
					Opslaan en activeren
				</button>
			</div>
		</div>
	{/if}

	{#if loading}
		<div class="flex justify-center py-12">
			<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
		</div>
	{:else if questionnaires.length === 0}
		<div class="card text-center py-8">
			<p class="text-gray-500 dark:text-gray-400">Nog geen vragenlijsten aangemaakt.</p>
		</div>
	{:else}
		<div class="space-y-2">
			{#each questionnaires as q}
				<div class="card flex items-center justify-between gap-3">
					<a href="{base}/players/questionnaires/{q.id}" class="flex-1 min-w-0">
						<p class="font-semibold text-gray-800 dark:text-gray-200 truncate">{q.name}</p>
						<p class="text-xs text-gray-500 dark:text-gray-400">
							{q.questions?.length || 0} vragen · {responseCounts[q.id] ?? 0}/{players.length} beantwoord
						</p>
					</a>
					<span class="text-xs px-2 py-0.5 rounded-full font-medium {
						q.status === 'active' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' :
						q.status === 'closed' ? 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300' :
						'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400'
					}">
						{QUESTIONNAIRE_STATUS_LABELS[q.status]}
					</span>
					<button class="btn-secondary text-xs px-2 py-1.5" on:click={() => toggleStatus(q)}>
						{q.status === 'active' ? 'Sluiten' : q.status === 'draft' ? 'Activeren' : 'Heropenen'}
					</button>
					<button class="p-2 text-gray-400 hover:text-red-600" title="Verwijderen" on:click={() => remove(q)}>🗑</button>
				</div>
			{/each}
		</div>
	{/if}
</div>
