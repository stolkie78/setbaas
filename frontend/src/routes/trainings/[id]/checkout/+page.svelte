<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { page } from '$app/stores';
	import { pb, getTrainingAttendance, getContextPlayers, getTeamTrainerOptions, updateTrainingAttendance, updateTraining } from '$lib/pocketbase';
	import type { TrainerOption } from '$lib/pocketbase';
	import type { Training, TrainingAttendance, Player, AttendanceStatus } from '$lib/types';
	import { generateWithAI as callAI, loadClubAISettings } from '$lib/ai/client';
	import { selectedClubId } from '$lib/stores/context';
	import AttendanceStatusSwitcher from '$lib/components/AttendanceStatusSwitcher.svelte';

	const REFLECTION_SYSTEM_PROMPT = `Je bent een ervaren volleybalcoach-assistent gespecialiseerd in jeugdvolleybal. Bedenk één korte, simpele reflectievraag (Nederlands, max 15 woorden) die een trainer aan een paar jeugdspeelsters kan stellen direct na afloop van een training. De vraag moet uitnodigen tot een kort, persoonlijk antwoord over hun ervaring, gevoel of leerpunt van de training. Geef ALLEEN de vraag terug, zonder aanhalingstekens, opsomming of uitleg.`;

	const REFLECTION_QUESTIONS = [
		'Wat vond je het leukste onderdeel van de training?',
		'Wat heb je vandaag geleerd?',
		'Wat kun je de volgende training beter doen?',
		'Waar ben je trots op na deze training?',
		'Wat was het lastigste moment van de training?',
	];

	type WizardStep = 'attendance' | 'rating' | 'trainer' | 'reflection' | 'done';

	let training: Training | null = null;
	let players: Player[] = [];
	let attendance: Record<string, TrainingAttendance> = {};
	let loading = true;
	let saving = false;
	let step: WizardStep = 'attendance';

	// Attendance toggles
	let playerStatus: Record<string, AttendanceStatus> = {};
	let playerReason: Record<string, string> = {};

	// Scores
	let overallRating = 7;
	let generalComments = '';

	// Per-player scores
	let playerRatings: Record<string, number> = {};
	let playerNotes: Record<string, string> = {};

	// Trainer
	let trainerMembers: TrainerOption[] = [];
	let selectedTrainers: string[] = [];

	// Reflection
	let reflectionQuestion = '';
	let reflectionPlayerIds: string[] = [];
	let reflectionAnswers: Record<string, string> = {};
	let aiQuestionLoading = false;
	let aiEnabled = false;

	$: presentCount = Object.values(playerStatus).filter(s => s === 'present').length;
	$: presentPlayers = players.filter(p => playerStatus[p.id] === 'present');

	onMount(async () => {
		try {
			if ($selectedClubId) {
				aiEnabled = await loadClubAISettings($selectedClubId)
					.then((settings) => settings.hasKey)
					.catch(() => false);
			}

			training = await pb.collection('trainings').getOne<Training>($page.params.id);
			players = await getContextPlayers(training.team || '', training.season || '', { activeOnly: true });
			const att = await getTrainingAttendance($page.params.id);

			for (const a of att) {
				attendance[a.player] = a;
				playerStatus[a.player] = a.status;
				playerReason[a.player] = a.reason || '';
				playerRatings[a.player] = a.player_rating || 7;
				playerNotes[a.player] = a.player_notes || '';
				if (a.checkout_selected) {
					reflectionPlayerIds.push(a.player);
					reflectionAnswers[a.player] = a.checkout_answer || '';
				}
			}
			// Players without attendance default to present
			for (const p of players) {
				if (!playerStatus[p.id]) playerStatus[p.id] = 'present';
				if (!playerReason[p.id]) playerReason[p.id] = '';
				if (!playerRatings[p.id]) playerRatings[p.id] = 7;
				if (!playerNotes[p.id]) playerNotes[p.id] = '';
			}
			playerStatus = playerStatus;
			playerReason = playerReason;
			reflectionPlayerIds = reflectionPlayerIds;

			overallRating = training.overall_rating || 7;
			generalComments = training.general_comments || '';
			selectedTrainers = Array.isArray(training.trainer) ? training.trainer : training.trainer ? [training.trainer] : [];
			reflectionQuestion = training.checkout_question || '';

			if (training.team) {
				try {
					trainerMembers = await getTeamTrainerOptions(training.team, selectedTrainers);
				} catch (e) { /* ignore */ }
			}
		} catch (e) {
			console.error(e);
		}
		loading = false;
	});

	function pickRandomPlayers(): string[] {
		const pool = [...presentPlayers];
		const count = Math.min(pool.length, Math.max(2, Math.min(4, pool.length)));
		const picked: string[] = [];
		while (picked.length < count && pool.length > 0) {
			const idx = Math.floor(Math.random() * pool.length);
			picked.push(pool.splice(idx, 1)[0].id);
		}
		return picked;
	}

	function pickRandomStandardQuestion(): string {
		return REFLECTION_QUESTIONS[Math.floor(Math.random() * REFLECTION_QUESTIONS.length)];
	}

	async function generateAIQuestion(): Promise<string | null> {
		if (!aiEnabled || !training) return null;
		aiQuestionLoading = true;
		try {
			let prompt = 'Bedenk een reflectievraag voor spelers na afloop van een volleybaltraining.';
			if (training.overall_rating) prompt += `\nTrainingsscore van de trainer: ${training.overall_rating}/10.`;
			if (training.general_comments) prompt += `\nOpmerkingen van de trainer: ${training.general_comments}`;
			if (training.content) prompt += `\nInhoud van de training (fragment): ${training.content.slice(0, 400)}`;

			const content = await callAI({
				prompt,
				club: $selectedClubId,
				team: training.team,
				systemPrompt: REFLECTION_SYSTEM_PROMPT,
				timeoutMs: 30000,
			});
			if (!content) return null;
			// Strip stray quotes/markdown the model might add
			return content.trim().replace(/^["'*#\s]+|["'*\s]+$/g, '');
		} catch (e) {
			console.error('AI reflection question failed, falling back to standard question:', e);
			return null;
		} finally {
			aiQuestionLoading = false;
		}
	}

	async function pickReflectionQuestion() {
		const aiQuestion = await generateAIQuestion();
		reflectionQuestion = aiQuestion || pickRandomStandardQuestion();
	}

	function goToReflection() {
		if (reflectionPlayerIds.length === 0) {
			reflectionPlayerIds = pickRandomPlayers();
		}
		// Show a standard question immediately so the UI isn't empty, then let AI replace it if configured.
		if (!reflectionQuestion) {
			reflectionQuestion = pickRandomStandardQuestion();
		}
		step = 'reflection';
		if (aiEnabled) {
			pickReflectionQuestion();
		}
	}

	function reshufflePlayers() {
		reflectionPlayerIds = pickRandomPlayers();
	}

	function reshuffleQuestion() {
		if (aiEnabled) {
			pickReflectionQuestion();
		} else {
			reflectionQuestion = pickRandomStandardQuestion();
		}
	}

	function toggleReflectionPlayer(playerId: string) {
		if (reflectionPlayerIds.includes(playerId)) {
			reflectionPlayerIds = reflectionPlayerIds.filter(id => id !== playerId);
		} else if (reflectionPlayerIds.length < 4) {
			reflectionPlayerIds = [...reflectionPlayerIds, playerId];
		}
	}

	async function finishTraining() {
		if (!training) return;
		saving = true;
		try {
			// Save attendance + per-player scores + reflection
			for (const p of players) {
				const existing = attendance[p.id];
				const isSelected = reflectionPlayerIds.includes(p.id);
				const data: any = {
					status: playerStatus[p.id],
					reason: playerReason[p.id] || undefined,
					player_rating: playerRatings[p.id] || undefined,
					player_notes: playerNotes[p.id] || undefined,
					checkout_selected: isSelected,
					checkout_answer: isSelected ? (reflectionAnswers[p.id] || '') : undefined,
				};
				if (existing) {
					await updateTrainingAttendance(existing.id, data);
				}
			}

			// Update training: rating, comments, trainer, reflection question, close
			await updateTraining(training.id, {
				overall_rating: overallRating,
				general_comments: generalComments,
				trainer: selectedTrainers,
				checkout_question: reflectionPlayerIds.length > 0 ? reflectionQuestion : undefined,
				status: 'closed',
			});

			goto(`${base}/`);
		} catch (e) {
			console.error(e);
			alert('Fout bij afronden training');
		}
		saving = false;
	}
</script>

<svelte:head>
	<title>Training afronden - SetBaas</title>
</svelte:head>

{#if loading}
	<div class="flex justify-center items-center min-h-[60vh]">
		<div class="animate-spin rounded-full h-12 w-12 border-b-3 border-primary-600"></div>
	</div>
{:else if !training}
	<p class="text-center text-gray-500 py-12 text-lg">Training niet gevonden</p>
{:else}
	<div class="max-w-lg mx-auto px-4 py-6 space-y-6">
		<div class="text-center">
			<h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">⏹️ Training afronden</h1>
			<p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
				{new Date(training.date).toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' })}
			</p>
		</div>

		<!-- Step indicator -->
		<div class="flex items-center justify-center gap-1 text-xs font-medium text-gray-400 flex-wrap">
			<span class={step === 'attendance' ? 'text-primary-600 font-bold' : ''}>Aanwezigheid</span>
			<span>›</span>
			<span class={step === 'rating' ? 'text-primary-600 font-bold' : ''}>Beoordeling</span>
			<span>›</span>
			<span class={step === 'trainer' ? 'text-primary-600 font-bold' : ''}>Trainer</span>
			<span>›</span>
			<span class={step === 'reflection' ? 'text-primary-600 font-bold' : ''}>Reflectie</span>
		</div>

		<!-- STEP: Aanwezigheid -->
		{#if step === 'attendance'}
			<div class="card !p-5 space-y-3">
				<div class="flex justify-between items-center">
					<h2 class="font-bold text-gray-900 dark:text-gray-100">👥 Aanwezigheid</h2>
					<span class="text-sm font-medium text-green-600">{presentCount}/{players.length}</span>
				</div>
				<div class="space-y-2">
					{#each players as player}
						<AttendanceStatusSwitcher
							label={player.name}
							sublabel={player.jersey_number ? `#${player.jersey_number}` : undefined}
							status={playerStatus[player.id]}
							reason={playerReason[player.id] || ''}
							on:change={(e) => { playerStatus[player.id] = e.detail; playerStatus = playerStatus; }}
							on:reason={(e) => { playerReason[player.id] = e.detail; playerReason = playerReason; }}
						/>
					{/each}
				</div>
			</div>
			<button on:click={() => step = 'rating'}
				class="w-full py-4 rounded-2xl text-lg font-bold bg-gradient-to-r from-primary-500 to-primary-600 text-white shadow-lg hover:shadow-xl active:scale-95 transition-all">
				Volgende: Beoordeling
			</button>

		<!-- STEP: Beoordeling -->
		{:else if step === 'rating'}
			<div class="card !p-5 space-y-4">
				<h2 class="font-bold text-gray-900 dark:text-gray-100">⭐ Beoordeling</h2>

				<div>
					<label class="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-2">
						Trainingsscore: <span class="text-lg font-bold {
							overallRating >= 7 ? 'text-green-600' : overallRating >= 5 ? 'text-yellow-600' : 'text-red-600'
						}">{overallRating}/10</span>
					</label>
					<input type="range" min="1" max="10" bind:value={overallRating}
						class="w-full h-3 rounded-full appearance-none cursor-pointer accent-primary-600" />
					<div class="flex justify-between text-xs text-gray-400 mt-1">
						<span>1</span><span>5</span><span>10</span>
					</div>
				</div>

				<div>
					<label class="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">Opmerkingen</label>
					<textarea
						bind:value={generalComments}
						rows="3"
						class="input w-full"
						placeholder="Hoe ging de training? Tips, aandachtspunten..."
					></textarea>
				</div>
			</div>

			<!-- Per-speler scores (alleen present) -->
			{#if presentPlayers.length > 0}
				<div class="card !p-5 space-y-3">
					<h2 class="font-bold text-gray-900 dark:text-gray-100">📊 Spelersscores</h2>
					<p class="text-xs text-gray-500">Optioneel — geef individuele scores</p>
					{#each presentPlayers as player}
						<div class="flex items-center gap-3 p-2 rounded-lg bg-gray-50 dark:bg-gray-800">
							<span class="text-sm font-medium text-gray-800 dark:text-gray-200 w-20 truncate">{player.name}</span>
							<input type="range" min="1" max="10" bind:value={playerRatings[player.id]}
								class="flex-1 h-2 rounded-full appearance-none cursor-pointer accent-primary-600" />
							<span class="text-sm font-bold w-8 text-center {
								playerRatings[player.id] >= 7 ? 'text-green-600' : playerRatings[player.id] >= 5 ? 'text-yellow-600' : 'text-red-600'
							}">{playerRatings[player.id]}</span>
						</div>
					{/each}
				</div>
			{/if}

			<div class="flex gap-2">
				<button on:click={() => step = 'attendance'} class="btn-secondary flex-1">Terug</button>
				<button on:click={() => step = 'trainer'}
					class="flex-[2] py-4 rounded-2xl text-lg font-bold bg-gradient-to-r from-primary-500 to-primary-600 text-white shadow-lg hover:shadow-xl active:scale-95 transition-all">
					Volgende: Trainer
				</button>
			</div>

		<!-- STEP: Trainer -->
		{:else if step === 'trainer'}
			<div class="card !p-5 space-y-3">
				<h2 class="font-bold text-gray-900 dark:text-gray-100">🧑‍🏫 Wie gaf deze training?</h2>
				{#if trainerMembers.length === 0}
					<p class="text-sm text-gray-500 italic">Geen trainers gevonden voor dit team.</p>
				{:else}
					<div class="flex flex-wrap gap-2">
						{#each trainerMembers as tm}
							<button type="button"
								class="px-3 py-2 rounded-xl text-sm font-medium transition-all
									{selectedTrainers.includes(tm.user)
										? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300 ring-2 ring-primary-400'
										: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'}"
								on:click={() => {
									if (selectedTrainers.includes(tm.user)) selectedTrainers = selectedTrainers.filter(id => id !== tm.user);
									else selectedTrainers = [...selectedTrainers, tm.user];
								}}>
								{tm.expand?.user?.name || tm.expand?.user?.email}
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<div class="flex gap-2">
				<button on:click={() => step = 'rating'} class="btn-secondary flex-1">Terug</button>
				<button on:click={goToReflection}
					class="flex-[2] py-4 rounded-2xl text-lg font-bold bg-gradient-to-r from-primary-500 to-primary-600 text-white shadow-lg hover:shadow-xl active:scale-95 transition-all">
					Volgende: Reflectie
				</button>
			</div>

		<!-- STEP: Reflectie -->
		{:else if step === 'reflection'}
			<div class="card !p-5 space-y-4">
				<div class="flex justify-between items-center">
					<h2 class="font-bold text-gray-900 dark:text-gray-100">💬 Reflectie</h2>
					<button type="button" class="text-xs text-primary-600 hover:text-primary-700 font-medium disabled:opacity-50" on:click={reshuffleQuestion} disabled={aiQuestionLoading}>
						{aiQuestionLoading ? '🤖 AI denkt na...' : aiEnabled ? '🤖 Nieuwe AI-vraag' : '🔀 Andere vraag'}
					</button>
				</div>

				{#if presentPlayers.length === 0}
					<p class="text-sm text-gray-500 italic">Geen aanwezige spelers om te bevragen.</p>
				{:else}
					<div>
						<label class="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">Reflectievraag</label>
						<textarea bind:value={reflectionQuestion} rows="2" class="input w-full" class:opacity-50={aiQuestionLoading} disabled={aiQuestionLoading}></textarea>
						{#if aiEnabled}
							<p class="text-xs text-gray-400 mt-1">🤖 AI-gegenereerd op basis van deze training — pas gerust aan.</p>
						{/if}
					</div>

					<div>
						<div class="flex justify-between items-center mb-2">
							<label class="text-sm font-medium text-gray-700 dark:text-gray-300">Wie beantwoordt de vraag? (2-4 spelers)</label>
							<button type="button" class="text-xs text-primary-600 hover:text-primary-700 font-medium" on:click={reshufflePlayers}>
								🎲 Nieuwe selectie
							</button>
						</div>
						<div class="flex flex-wrap gap-2">
							{#each presentPlayers as player}
								<button type="button"
									class="px-3 py-1.5 rounded-full text-sm font-medium transition-all
										{reflectionPlayerIds.includes(player.id)
											? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 ring-2 ring-amber-400'
											: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'}"
									on:click={() => toggleReflectionPlayer(player.id)}>
									{player.name}
								</button>
							{/each}
						</div>
					</div>

					{#if reflectionPlayerIds.length > 0}
						<div class="space-y-3 pt-2 border-t border-gray-200 dark:border-gray-700">
							{#each presentPlayers.filter(p => reflectionPlayerIds.includes(p.id)) as player}
								<div>
									<label class="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">{player.name}</label>
									<textarea bind:value={reflectionAnswers[player.id]} rows="2" class="input w-full" placeholder="Antwoord (optioneel)..."></textarea>
								</div>
							{/each}
						</div>
					{/if}
				{/if}
			</div>

			<div class="flex gap-2">
				<button on:click={() => step = 'trainer'} class="btn-secondary flex-1">Terug</button>
				<button
					on:click={finishTraining}
					class="flex-[2] py-5 rounded-2xl text-xl font-bold bg-gradient-to-r from-red-500 to-red-600 text-white shadow-lg hover:shadow-xl active:scale-95 transition-all"
					disabled={saving}
				>
					{saving ? 'Opslaan...' : 'Training afronden'}
				</button>
			</div>
		{/if}

		<a href="{base}/trainings/{training.id}" class="block text-center text-sm text-gray-400 hover:text-primary-600">
			Terug zonder afronden
		</a>
	</div>
{/if}
