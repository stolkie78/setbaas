<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { pb, getContextPlayers, updateTraining, getTrainingAttendance, createTrainingAttendance, updateTrainingAttendance, deleteTrainingAttendance, getTrainingTemplates, getTeamAccessForTeam } from '$lib/pocketbase';
	import type { Player, Training, TrainingAttendance, AttendanceStatus, TrainingTemplate } from '$lib/types';
	import type { TeamAccess } from '$lib/pocketbase';
	import { TRAINING_TYPE_LABELS } from '$lib/types';
	import { selectedTeamId, selectedSeasonId, selectedClubId, currentClub } from '$lib/stores/context';
	import MarkdownEditor from '$lib/components/MarkdownEditor.svelte';
	import { generateWithAI as callAI, loadClubAISettings } from '$lib/ai/client';

	$: returnTo = $page.url.searchParams.get('returnTo') || `${base}/trainings`;

	let aiPrompt = '';
	let aiEnabled = false;
	let aiGenerating = false;
	let aiError = '';
	let currentPeriod: any = null;
	let recentTrainings: any[] = [];

	async function generateWithAI() {
		if (!aiPrompt.trim()) return;
		aiGenerating = true;
		aiError = '';
		try {
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
				team: training?.team || $selectedTeamId,
			});
		} catch (e) { aiError = e instanceof Error ? e.message : String(e); }
		finally { aiGenerating = false; }
	}

	let training: Training | null = null;
	let players: Player[] = [];
	let templates: TrainingTemplate[] = [];
	let existingAttendance: TrainingAttendance[] = [];
	let loading = true;
	let saving = false;

	// Training form
	let trainingDate = '';
	let trainingTime = '17:30';
	let durationMinutes = 90;
	let trainingLocation = '';
	let overallRating = 7;
	let generalComments = '';
	let selectedTemplate = '';
	let trainingStatus: 'open' | 'active' | 'closed' = 'closed';

	// Training content (markdown)
	let formContent = '';

	// Trainers
	let trainerMembers: TeamAccess[] = [];
	let selectedTrainers: string[] = [];

	// Per-player attendance & rating
	let playerData: Record<string, {
		id?: string; // existing attendance record id
		status: AttendanceStatus;
		rating: number;
		notes: string;
		happiness: number;
		fitness: number;
	}> = {};

	const HAPPINESS_EMOJIS = ['😢', '😕', '😐', '😊', '🤩'];
	const HAPPINESS_LABELS = ['Baal', 'Meh', 'Oké', 'Blij', 'Super!'];
	const FITNESS_EMOJIS = ['🥱', '😴', '💪', '🔥', '⚡'];
	const FITNESS_LABELS = ['Moe', 'Sloom', 'Goed', 'Fit', 'Top!'];

	onMount(async () => {
		try {
			if ($selectedClubId) {
				aiEnabled = await loadClubAISettings($selectedClubId)
					.then((settings) => settings.hasKey)
					.catch(() => false);
			}

			const id = $page.params.id;
			training = await pb.collection('trainings').getOne<Training>(id, { expand: 'created_by' });

			trainingDate = training.date.slice(0, 10);
			trainingTime = training.date.slice(11, 16) || '17:30';
			overallRating = training.overall_rating || 7;
			generalComments = training.general_comments || '';
			selectedTemplate = training.template || '';
			trainingStatus = (training.status as 'open' | 'active' | 'closed') || 'closed';
			formContent = training.content || '';
			durationMinutes = training.duration_minutes || 90;
			trainingLocation = training.location || '';
			selectedTrainers = Array.isArray(training.trainer) ? training.trainer : training.trainer ? [training.trainer] : [];

			// Load trainers
			if ($selectedTeamId) {
				try {
					const allAccess = await getTeamAccessForTeam($selectedTeamId);
					trainerMembers = allAccess.filter(a => a.is_trainer);
				} catch (e) { /* ignore */ }
			}

			// Load templates
			templates = await getTrainingTemplates();

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

			// Load existing attendance
			existingAttendance = await getTrainingAttendance(id);

			// Initialize player data
			for (const p of players) {
				const existing = existingAttendance.find(a => a.player === p.id);
				if (existing) {
					playerData[p.id] = {
						id: existing.id,
						status: existing.status as AttendanceStatus,
						rating: existing.player_rating || 7,
						notes: existing.player_notes || '',
						happiness: existing.happiness || 0,
						fitness: existing.fitness || 0,
					};
				} else {
					playerData[p.id] = { status: 'present', rating: 7, notes: '', happiness: 0, fitness: 0 };
				}
			}
		} catch (e) {
			console.error('Failed to load training:', e);
		} finally {
			loading = false;
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
		if (!training) return;
		saving = true;
		try {
			// Update training
			await updateTraining(training.id, {
				date: new Date(`${trainingDate}T${trainingTime}`).toISOString(),
				overall_rating: trainingStatus === 'closed' ? overallRating : undefined,
				general_comments: generalComments || undefined,
				template: selectedTemplate || undefined,
				status: trainingStatus,
				content: formContent || undefined,
				trainer: selectedTrainers,
				duration_minutes: durationMinutes || undefined,
				location: trainingLocation.trim() || undefined,
			});

			// Update/create attendance records
			{
				const promises = players.map(async (p) => {
					const pd = playerData[p.id];
					const data = {
						training: training!.id,
						player: p.id,
						status: pd.status,
						player_rating: pd.status === 'present' ? pd.rating : undefined,
						player_notes: pd.notes || undefined,
						happiness: pd.happiness || undefined,
						fitness: pd.fitness || undefined,
					};

					if (pd.id) {
						return updateTrainingAttendance(pd.id, data);
					} else {
						return createTrainingAttendance(data);
					}
				});
				await Promise.all(promises);
			}

			goto(returnTo);
		} catch (e) {
			console.error('Failed to update training:', e);
			alert('Fout bij bijwerken training');
		} finally {
			saving = false;
		}
	}

	async function handleDelete() {
		if (!training) return;
		if (!confirm('Weet je zeker dat je deze training wilt verwijderen?')) return;
		try {
			// Delete attendance first
			for (const a of existingAttendance) {
				await deleteTrainingAttendance(a.id);
			}
			await pb.collection('trainings').delete(training.id);
			goto(returnTo);
		} catch (e) {
			console.error('Failed to delete training:', e);
			alert('Fout bij verwijderen');
		}
	}
</script>

<svelte:head>
	<title>Bewerk Training - SetBaas</title>
</svelte:head>

{#if loading}
	<div class="flex justify-center py-12">
		<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
	</div>
{:else if training}
	<form class="space-y-4" on:submit|preventDefault={handleSubmit}>
		<div class="flex justify-between items-center">
			<h2 class="text-xl font-bold text-gray-800 dark:text-gray-200">Bewerk Training</h2>
			<button type="button" class="text-red-500 hover:text-red-700 text-sm font-semibold" on:click={handleDelete}>
				Verwijderen
			</button>
		</div>

		{#if training?.expand?.created_by}
			<p class="text-xs text-gray-400 dark:text-gray-500">Aangemaakt door {training.expand.created_by.name || training.expand.created_by.email}</p>
		{/if}

		<div class="card space-y-4">
			<!-- Status toggle -->
			<div>
				<label class="label">Status</label>
				<div class="flex rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
					<button type="button"
						class="flex-1 py-3 text-sm font-semibold transition-colors {trainingStatus === 'open' ? 'bg-amber-500 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300'}"
						on:click={() => (trainingStatus = 'open')}>
						Gepland
					</button>
					<button type="button"
						class="flex-1 py-3 text-sm font-semibold transition-colors {trainingStatus === 'active' ? 'bg-green-500 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300'}"
						on:click={() => (trainingStatus = 'active')}>
						Actief
					</button>
					<button type="button"
						class="flex-1 py-3 text-sm font-semibold transition-colors {trainingStatus === 'closed' ? 'bg-green-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300'}"
						on:click={() => (trainingStatus = 'closed')}>
						Afgerond
					</button>
				</div>
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
					<label class="label">Template</label>
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

			{#if trainingStatus === 'closed'}
				<div>
					<label class="label">Algemene score: {overallRating}/10</label>
					<input type="range" min="1" max="10" step="1" bind:value={overallRating} class="w-full h-3 accent-primary-600" />
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
					{#if pd}
						<button type="button"
							class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all active:scale-95 {
								pd.status === 'present'
									? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
									: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
							}"
							on:click={() => { playerData[player.id].status = pd.status === 'present' ? 'absent' : 'present'; playerData = playerData; }}>
							{player.name}
						</button>
					{/if}
				{/each}
			</div>
		</div>

		<!-- Check-in (gevoel & fitheid) -->
		<div class="card space-y-3">
			<h3 class="font-semibold text-gray-800 dark:text-gray-200">😊 Check-in</h3>
			{#each players.filter(p => playerData[p.id]?.status === 'present') as player (player.id)}
				{@const pd = playerData[player.id]}
				{#if pd}
					<div class="p-2 rounded-lg bg-gray-50 dark:bg-gray-800 space-y-2">
						<span class="text-sm font-medium truncate block">{player.name}</span>
						<div class="flex flex-wrap items-center gap-4">
							<div class="flex items-center gap-1">
								<span class="text-xs text-gray-400 mr-1">Gevoel</span>
								{#each HAPPINESS_EMOJIS as emoji, i}
									<button type="button"
										class="text-xl p-1 rounded-lg {pd.happiness === i + 1 ? 'bg-amber-100 dark:bg-amber-900/40 ring-2 ring-amber-400' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}"
										title={HAPPINESS_LABELS[i]}
										on:click={() => { playerData[player.id].happiness = playerData[player.id].happiness === i + 1 ? 0 : i + 1; playerData = playerData; }}>
										{emoji}
									</button>
								{/each}
							</div>
							<div class="flex items-center gap-1">
								<span class="text-xs text-gray-400 mr-1">Fitheid</span>
								{#each FITNESS_EMOJIS as emoji, i}
									<button type="button"
										class="text-xl p-1 rounded-lg {pd.fitness === i + 1 ? 'bg-blue-100 dark:bg-blue-900/40 ring-2 ring-blue-400' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}"
										title={FITNESS_LABELS[i]}
										on:click={() => { playerData[player.id].fitness = playerData[player.id].fitness === i + 1 ? 0 : i + 1; playerData = playerData; }}>
										{emoji}
									</button>
								{/each}
							</div>
						</div>
					</div>
				{/if}
			{/each}
		</div>

		{#if trainingStatus === 'closed'}
			<!-- Scores (alleen bij afgeronde training) -->
			<div class="card space-y-3">
				<h3 class="font-semibold text-gray-800 dark:text-gray-200">📊 Scores</h3>
				{#each players.filter(p => playerData[p.id]?.status === 'present') as player (player.id)}
					{@const pd = playerData[player.id]}
					{#if pd}
						<div class="flex items-center gap-3 p-2 rounded-lg bg-gray-50 dark:bg-gray-800">
							<span class="flex-1 text-sm font-medium truncate">{player.name}</span>
							<input type="number" min="1" max="10"
								class="w-12 text-center rounded-lg border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white py-1 text-sm font-bold"
								bind:value={playerData[player.id].rating} />
							<span class="text-xs text-gray-400">/10</span>
						</div>
						<input type="text"
							class="w-full text-xs rounded-lg border border-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-white px-3 py-2 -mt-1"
							placeholder="Notities voor {player.name}..."
							bind:value={playerData[player.id].notes} />
					{/if}
				{/each}
			</div>
		{/if}

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
						<p class="text-xs text-purple-600 dark:text-purple-400">ℹ️ De periodiseringsdoelen worden automatisch meegestuurd als context.</p>
					{/if}
					<div class="flex gap-2">
						<input class="input flex-1" type="text" bind:value={aiPrompt}
							placeholder="bijv. Focus op bovenhands spel, 90 min"
							on:keydown={(e) => e.key === 'Enter' && generateWithAI()} />
						<button type="button" class="btn-primary text-sm whitespace-nowrap"
							disabled={aiGenerating || !aiPrompt.trim()} on:click={generateWithAI}>
							{aiGenerating ? 'Genereren...' : 'Genereer'}
						</button>
					</div>
					{#if aiError}<p class="text-xs text-red-500">{aiError}</p>{/if}
				</div>
			{/if}

			<MarkdownEditor bind:value={formContent} placeholder="Beschrijf de training... (gebruik kopjes voor fases, bijv. ## Warm-up)" />
			<div>
				<label class="label">Opmerkingen</label>
				<textarea class="input" rows="2" bind:value={generalComments} placeholder="Extra aandachtspunten..."></textarea>
			</div>
		</div>

		<button type="submit" class="btn-primary w-full text-lg py-4" disabled={saving}>
			{saving ? 'Opslaan...' : 'Wijzigingen opslaan'}
		</button>
		<a href={returnTo} class="btn-secondary w-full text-center">Annuleren</a>
	</form>
{:else}
	<p class="text-center text-gray-500 py-8">Training niet gevonden</p>
{/if}
