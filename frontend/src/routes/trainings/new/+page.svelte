<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { getContextPlayers, createTraining, createTrainingAttendance, getTrainingTemplates, getTeamAccessForTeam } from '$lib/pocketbase';
	import { pb } from '$lib/pocketbase';
	import type { Player, AttendanceStatus, TrainingTemplate } from '$lib/types';
	import type { TeamAccess } from '$lib/pocketbase';
	import { TRAINING_TYPE_LABELS } from '$lib/types';
	import { selectedTeamId, selectedSeasonId, selectedClubId, currentClub } from '$lib/stores/context';
	import { authUser } from '$lib/stores/auth';
	import MarkdownEditor from '$lib/components/MarkdownEditor.svelte';
	import { generateWithAI as callAI, loadClubAISettings } from '$lib/ai/client';

	let aiPrompt = '';
	let aiEnabled = false;
	let aiGenerating = false;
	let aiError = '';

	// Current periodization
	let currentPeriod: any = null;
	let recentTrainings: any[] = [];

	async function generateWithAI() {
		if (!aiPrompt.trim()) return;
		aiGenerating = true;
		aiError = '';
		try {
			// Build context with periodization goals
			let fullPrompt = aiPrompt;
			if (currentPeriod) {
				const goals = [];
				if (currentPeriod.goals_technical) goals.push(`Technisch: ${currentPeriod.goals_technical}`);
				if (currentPeriod.goals_tactical) goals.push(`Tactisch: ${currentPeriod.goals_tactical}`);
				if (currentPeriod.goals_physical) goals.push(`Fysiek: ${currentPeriod.goals_physical}`);
				if (currentPeriod.goals_mental) goals.push(`Mentaal: ${currentPeriod.goals_mental}`);
				if (goals.length > 0) {
					fullPrompt += `\n\nHuidige periodisering: "${currentPeriod.name}" (fase: ${currentPeriod.phase || 'onbekend'})\nDoelen voor deze periode:\n${goals.join('\n')}`;
				}
			}

			// Add recent training context
			if (recentTrainings.length > 0) {
				const summaries = recentTrainings.map((t, i) => {
					const date = new Date(t.date).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
					const content = (t.content || '').slice(0, 500);
					return `Training ${i + 1} (${date}):\n${content}`;
				});
				fullPrompt += `\n\n--- Vorige trainingen (ter referentie, vermijd herhaling) ---\n${summaries.join('\n\n')}`;
			}

			formContent = await callAI({
				prompt: fullPrompt,
				club: $selectedClubId,
				team: $selectedTeamId,
			});
		} catch (e) {
			aiError = e instanceof Error ? e.message : String(e);
		} finally {
			aiGenerating = false;
		}
	}

	let players: Player[] = [];
	let templates: TrainingTemplate[] = [];
	let loading = true;
	let saving = false;

	// Training form
	let trainingDate = new Date().toISOString().slice(0, 10);
	let trainingTime = '17:30';
	let durationMinutes = 90;
	let trainingLocation = '';
	let overallRating = 7;
	let generalComments = '';
	let selectedTemplate = '';
	let trainingStatus: 'open' | 'active' | 'closed' = 'open';

	// Training content (markdown)
	let formContent = '';

	// Trainers
	let trainerMembers: TeamAccess[] = [];
	let selectedTrainers: string[] = [];

	// Per-player attendance & rating
	let playerData: Record<string, {
		status: AttendanceStatus;
		rating: number;
		notes: string;
	}> = {};

	onMount(async () => {
		try {
			// Load templates (global, not filtered by team/season)
			templates = await getTrainingTemplates();

			if ($selectedClubId) {
				aiEnabled = await loadClubAISettings($selectedClubId)
					.then((settings) => settings.hasKey)
					.catch(() => false);
			}

			// Load current periodization period
			const today = new Date().toISOString().slice(0, 10);
			try {
				const periods = await pb.collection('season_periods').getFullList({
					filter: `start_date <= "${today}" && end_date >= "${today}"${$selectedTeamId ? ` && team = "${$selectedTeamId}"` : ''}`,
					sort: '-start_date'
				});
				if (periods.length > 0) currentPeriod = periods[0];
			} catch (e) { /* no periods configured */ }

			// Load last 3 trainings for AI context
			try {
				const filter = $selectedTeamId ? `team = "${$selectedTeamId}"` : '';
				recentTrainings = await pb.collection('trainings').getFullList({
					sort: '-date',
					filter: filter || undefined,
					limit: 3,
				});
			} catch (e) { /* ignore */ }

			players = await getContextPlayers($selectedTeamId, $selectedSeasonId, { activeOnly: true });
			// Initialize player data
			for (const p of players) {
				playerData[p.id] = { status: 'present', rating: 7, notes: '' };
			}
		} catch (e) {
			console.error('Failed to load players:', e);
		} finally {
			loading = false;
		}

		// Load trainers
		if ($selectedTeamId) {
			try {
				const allAccess = await getTeamAccessForTeam($selectedTeamId);
				trainerMembers = allAccess.filter(a => a.is_trainer);
			} catch (e) { /* ignore */ }
		}
	});

	function applyTemplate() {
		const t = templates.find(tp => tp.id === selectedTemplate);
		if (t) {
			formContent = t.content || '';
			if (t.notes) generalComments = t.notes;
		}
	}

	async function handleSubmit() {
		saving = true;
		try {
			// 1. Create training
			const training = await createTraining({
				date: new Date(`${trainingDate}T${trainingTime}`).toISOString(),
				overall_rating: trainingStatus === 'closed' ? overallRating : undefined,
				general_comments: generalComments || undefined,
				team: $selectedTeamId || undefined,
				season: $selectedSeasonId || undefined,
				template: selectedTemplate || undefined,
				status: trainingStatus,
				content: formContent || undefined,
				created_by: $authUser?.id || undefined,
				trainer: selectedTrainers.length > 0 ? selectedTrainers : undefined,
				duration_minutes: durationMinutes || undefined,
				location: trainingLocation.trim() || undefined,
			});

			// 2. Create attendance records
			{
				const promises = players.map((p) => {
					const pd = playerData[p.id];
					return createTrainingAttendance({
						training: training.id,
						player: p.id,
						status: pd.status,
						player_rating: pd.status === 'present' ? pd.rating : undefined,
						player_notes: pd.notes || undefined,
					});
				});
				await Promise.all(promises);
			}

			goto(`${base}/trainings`);
		} catch (e) {
			console.error('Failed to save training:', e);
			alert('Fout bij opslaan training');
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>Nieuwe Training - SetBaas</title>
</svelte:head>

{#if loading}
	<div class="flex justify-center py-12">
		<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
	</div>
{:else}
	<form class="space-y-4" on:submit|preventDefault={handleSubmit}>
		<h2 class="text-xl font-bold text-gray-800 dark:text-gray-200">Nieuwe Training</h2>

		<!-- Training details -->
		<div class="card space-y-4">
			<!-- Status toggle -->
			<div>
				<label class="label">Status</label>
				<div class="flex rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
					<button type="button"
						class="flex-1 py-3 text-sm font-semibold transition-colors {trainingStatus === 'open' ? 'bg-amber-500 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300'}"
						on:click={() => (trainingStatus = 'open')}>
						Gepland (voorbereid)
					</button>
					<button type="button"
						class="flex-1 py-3 text-sm font-semibold transition-colors {trainingStatus === 'closed' ? 'bg-green-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300'}"
						on:click={() => (trainingStatus = 'closed')}>
						Afgerond
					</button>
				</div>
				<p class="text-xs text-gray-400 mt-1">
					{trainingStatus === 'open' ? 'Training staat klaar — scores invullen kan later.' : 'Training is afgelopen — vul scores en aanwezigheid in.'}
				</p>
			</div>

			<div>
				<label class="label" for="date">Datum & Tijd</label>
				<div class="flex gap-2">
					<input id="date" class="input flex-1" type="date" bind:value={trainingDate} required />
					<input class="input w-28" type="time" bind:value={trainingTime} required />
				</div>
			</div>

			<div>
				<label class="label" for="duration">Duur (minuten)</label>
				<input id="duration" class="input w-28" type="number" min="0" max="480" step="5" bind:value={durationMinutes} />
			</div>

			<div>
				<label class="label" for="location">Sporthal / locatie</label>
				{#if $currentClub?.locations && $currentClub.locations.length > 0}
					<div class="space-y-1.5">
						<select
							class="input"
							on:change={(e) => {
								if (e.currentTarget.value === '__custom__') {
									trainingLocation = '';
								} else if (e.currentTarget.value) {
									trainingLocation = e.currentTarget.value;
								}
							}}
							value={$currentClub.locations.includes(trainingLocation) ? trainingLocation : (trainingLocation ? '__custom__' : '')}
						>
							<option value="">— Kies standaard zaal —</option>
							{#each $currentClub.locations as loc}
								<option value={loc}>{loc}</option>
							{/each}
							<option value="__custom__">✏️ Vrije invoer / andere zaal...</option>
						</select>
						{#if !trainingLocation || !$currentClub.locations.includes(trainingLocation)}
							<input
								id="location"
								class="input"
								type="text"
								placeholder="Locatie naam (bijv. Sporthal De Veur / Veld 2)"
								bind:value={trainingLocation}
							/>
						{/if}
					</div>
				{:else}
					<input id="location" class="input" type="text" placeholder="Bijv. Sporthal De Veur / Veld 2" bind:value={trainingLocation} />
				{/if}
			</div>

			<!-- Trainer checkboxes -->
			{#if trainerMembers.length > 0}
				<div>
					<label class="label">Trainer(s)</label>
					<div class="flex flex-wrap gap-3">
						{#each trainerMembers as tm}
							<label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
								<input type="checkbox" class="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
									checked={selectedTrainers.includes(tm.user)}
									on:change={(e) => {
										if (e.currentTarget.checked) selectedTrainers = [...selectedTrainers, tm.user];
										else selectedTrainers = selectedTrainers.filter(id => id !== tm.user);
									}} />
								{tm.expand?.user?.name || tm.expand?.user?.email}
							</label>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Template selector -->
			{#if templates.length > 0 && trainingStatus === 'open'}
				<div>
					<label class="label">Training template</label>
					<div class="flex gap-2">
						<select class="input flex-1" bind:value={selectedTemplate}>
							<option value="">— Geen template —</option>
							{#each templates as t}
								<option value={t.id}>{t.name} ({TRAINING_TYPE_LABELS[t.type]})</option>
							{/each}
						</select>
						<button type="button" class="btn-secondary text-sm px-3" on:click={applyTemplate} disabled={!selectedTemplate}>
							Toepassen
						</button>
					</div>
				</div>
			{/if}

			<!-- Score only when closed -->
			{#if trainingStatus === 'closed'}
				<div>
					<label class="label">Algemene score: {overallRating}/10</label>
					<input
						type="range" min="1" max="10" step="1"
						bind:value={overallRating}
						class="w-full h-3 accent-primary-600"
					/>
				</div>
			{/if}
		</div>

		<!-- Player Attendance -->
		<div class="card">
			<div class="flex justify-between items-center mb-3">
				<h3 class="font-semibold text-gray-800 dark:text-gray-200">👥 Aanwezigheid</h3>
				<span class="text-sm font-medium text-green-600">
					{Object.values(playerData).filter(p => p.status === 'present').length}/{players.length}
				</span>
			</div>
			<div class="flex flex-wrap gap-2">
				{#each players as player (player.id)}
					{@const pd = playerData[player.id]}
					<button type="button"
						class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all active:scale-95 {
							pd.status === 'present'
								? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
								: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
						}"
						on:click={() => { playerData[player.id].status = pd.status === 'present' ? 'absent' : 'present'; playerData = playerData; }}>
						{player.name}
					</button>
				{/each}
			</div>
		</div>

		<!-- Training content -->
		<div class="card space-y-4">
			<h3 class="font-semibold text-gray-800 dark:text-gray-200">Training Beschrijving</h3>

			<!-- Current Periodization -->
			{#if currentPeriod}
				<div class="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
					<div class="flex items-center gap-2 mb-2">
						<span class="text-sm font-semibold text-blue-700 dark:text-blue-300">📅 Huidige periode: {currentPeriod.name}</span>
						{#if currentPeriod.phase}
							<span class="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-800 text-blue-600 dark:text-blue-300">{currentPeriod.phase}</span>
						{/if}
					</div>
					<div class="grid grid-cols-2 gap-1 text-xs text-gray-600 dark:text-gray-400">
						{#if currentPeriod.goals_technical}<p>🎯 <strong>Technisch:</strong> {currentPeriod.goals_technical}</p>{/if}
						{#if currentPeriod.goals_tactical}<p>🧠 <strong>Tactisch:</strong> {currentPeriod.goals_tactical}</p>{/if}
						{#if currentPeriod.goals_physical}<p>💪 <strong>Fysiek:</strong> {currentPeriod.goals_physical}</p>{/if}
						{#if currentPeriod.goals_mental}<p>🧘 <strong>Mentaal:</strong> {currentPeriod.goals_mental}</p>{/if}
					</div>
				</div>
			{/if}

			<!-- AI Generate -->
			{#if aiEnabled}
				<div class="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg space-y-2">
					<label class="label text-purple-700 dark:text-purple-300">🤖 Genereer met AI</label>
					{#if currentPeriod}
						<p class="text-xs text-purple-600 dark:text-purple-400">ℹ️ De periodiseringsdoelen worden automatisch meegestuurd als context voor de AI.</p>
					{/if}
					<div class="flex gap-2">
						<input
							class="input flex-1"
							type="text"
							bind:value={aiPrompt}
							placeholder="bijv. Training voor meiden B, focus op bovenhands spel en verdediging, 90 min"
							on:keydown={(e) => e.key === 'Enter' && generateWithAI()}
						/>
						<button
							type="button"
							class="btn-primary text-sm whitespace-nowrap"
							disabled={aiGenerating || !aiPrompt.trim()}
							on:click={generateWithAI}
						>
							{aiGenerating ? 'Genereren...' : 'Genereer'}
						</button>
					</div>
					{#if aiError}
						<p class="text-xs text-red-500">{aiError}</p>
					{/if}
				</div>
			{:else}
				<a href="{base}/config" class="text-xs text-gray-400 hover:text-primary-500">
					💡 Configureer een AI-model in Configuratie → AI om trainingen te genereren
				</a>
			{/if}

			<MarkdownEditor bind:value={formContent} placeholder="Beschrijf de training... (gebruik kopjes voor fases, bijv. ## Warm-up)" />
			<div>
				<label class="label">Opmerkingen</label>
				<textarea class="input" rows="2" bind:value={generalComments} placeholder="Extra aandachtspunten..."></textarea>
			</div>
		</div>

		<!-- Submit -->
		<button type="submit" class="btn-primary w-full text-lg py-4" disabled={saving}>
			{saving ? 'Opslaan...' : trainingStatus === 'open' ? 'Training klaarzetten' : 'Training Opslaan'}
		</button>

		<a href="{base}/trainings" class="btn-secondary w-full text-center">Annuleren</a>
	</form>
{/if}
