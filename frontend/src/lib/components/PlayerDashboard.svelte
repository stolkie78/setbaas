<script lang="ts">
	import { pb, getAttendanceForPlayer, setPlayerAttendance, getPendingQuestionnaires, updatePlayerExtraActivities } from '$lib/pocketbase';
	import { linkedPlayer, rolesLoaded } from '$lib/stores/role';
	import { selectedTeamId, selectedSeasonId, contextFilter } from '$lib/stores/context';
	import type { Training, Match, TrainingAttendance, MatchAttendance, AttendanceStatus, Questionnaire, MatchPlayerStats, PlayerPosition, ExtraActivity } from '$lib/types';
	import { POSITION_LABELS } from '$lib/types';
	import { getMatchScore, getMatchOutcome } from '$lib/utils/match';
	import { marked } from 'marked';
	import { base } from '$app/paths';
	import AttendanceStatusSwitcher from '$lib/components/AttendanceStatusSwitcher.svelte';
	import LoadReport from '$lib/components/LoadReport.svelte';
	import { fetchPlayerLoad, type PlayerLoad } from '$lib/utils/load';
	import { EXTRA_ACTIVITY_LABELS } from '$lib/types';
	import type { ExtraActivityType } from '$lib/types';
	import { Plus, Pencil, Trash2, X } from 'lucide-svelte';

	let trainings: Training[] = [];
	let matches: Match[] = [];
	let trainingAttendance: TrainingAttendance[] = [];
	let matchAttendance: MatchAttendance[] = [];
	let pendingQuestionnaires: Questionnaire[] = [];
	let playedMatches: Match[] = [];
	let playerStats: MatchPlayerStats[] = [];
	let pastTrainingCount = 0;
	let loading = true;
	let submitting: Record<string, boolean> = {};
	let lightboxTraining: Training | null = null;
	let loadedContext = '';
	let showAllTrainings = false;
	let showAllMatches = false;
	let showAllResults = false;
	let playerLoad: PlayerLoad | null = null;
	let loadMonthOffset = 0;
	let savingExtra = false;

	// Self-service activity form state
	let showActivityForm = false;
	let editingIndex: number | null = null;
	let formType: ExtraActivityType = 'training';
	let formTeamName = '';
	let formHours = 1.5;
	let formNotes = '';
	let extraSaveMessage = '';
	let extraErrorMessage = '';

	$: playerId = $linkedPlayer?.id;

	// The player link and roster context both arrive asynchronously after
	// login. Query only after all IDs are available and reload on context
	// changes, so a fresh browser session cannot remain permanently empty.
	$: context = $rolesLoaded && playerId && $selectedTeamId && $selectedSeasonId
		? `${playerId}:${$selectedTeamId}:${$selectedSeasonId}`
		: '';
	$: if (context && context !== loadedContext) {
		loadedContext = context;
		loadData(playerId, $selectedTeamId, $selectedSeasonId);
	}
	$: if ($rolesLoaded && !playerId) loading = false;

	async function loadData(
		currentPlayerId = playerId,
		teamId = $selectedTeamId,
		seasonId = $selectedSeasonId
	) {
		if (!currentPlayerId || !teamId || !seasonId) return;
		loading = true;
		try {
			const filter = contextFilter(teamId, seasonId);
			const now = new Date().toISOString().slice(0, 10);

			const [t, m, att, pendingQ, played, stats, pastTrainings] = await Promise.all([
				pb.collection('trainings').getFullList<Training>({
					sort: 'date',
					// Any upcoming training that isn't finished yet (open or
					// currently active) — a training marked "closed" is done
					// and no longer needs a response.
					filter: [filter, `date >= "${now}"`, 'status != "closed"'].filter(Boolean).join(' && '),
				}),
				pb.collection('matches').getFullList<Match>({
					sort: 'date',
					filter: [filter, `date >= "${now}"`].filter(Boolean).join(' && '),
				}),
				getAttendanceForPlayer(currentPlayerId),
				getPendingQuestionnaires(teamId, currentPlayerId),
				pb.collection('matches').getFullList<Match>({
					sort: '-date',
					filter: [filter, `date < "${now}"`].filter(Boolean).join(' && '),
				}),
				pb.collection('match_player_stats').getFullList<MatchPlayerStats>({
					filter: `player = "${currentPlayerId}"`,
					expand: 'match',
				}),
				// Only trainings that already happened count towards turnout —
				// including upcoming ones would drag the percentage down.
				pb.collection('trainings').getFullList<Training>({
					fields: 'id',
					filter: [filter, `date < "${now}"`].filter(Boolean).join(' && '),
				}),
			]);

			trainings = t;
			matches = m;
			trainingAttendance = att.training;
			matchAttendance = att.match;
			pendingQuestionnaires = pendingQ;
			playedMatches = played;
			// Stats are fetched per player, so drop the ones belonging to
			// matches outside the current team/season.
			const playedIds = new Set(played.map((match) => match.id));
			playerStats = stats.filter((s) => playedIds.has(s.match));
			pastTrainingCount = pastTrainings.length;

			await loadPlayerLoad(currentPlayerId, teamId, seasonId);
		} catch (e) {
			console.error('Failed to load player dashboard:', e);
		} finally {
			loading = false;
		}
	}

	async function loadPlayerLoad(
		currentPlayerId = playerId,
		teamId = $selectedTeamId,
		seasonId = $selectedSeasonId,
		extrasOverride?: ExtraActivity[]
	) {
		if (!currentPlayerId || !teamId || !seasonId) return;
		const extras = extrasOverride !== undefined ? extrasOverride : ($linkedPlayer?.extra_activities || []);
		playerLoad = await fetchPlayerLoad(currentPlayerId, Array.isArray(extras) ? extras : [], {
			teamId,
			seasonId,
			monthOffset: loadMonthOffset,
		});
	}

	function changeLoadMonth(delta: number) {
		loadMonthOffset += delta;
		loadPlayerLoad();
	}

	function openAddActivity() {
		editingIndex = null;
		formType = 'training';
		formTeamName = '';
		formHours = 1.5;
		formNotes = '';
		extraErrorMessage = '';
		extraSaveMessage = '';
		showActivityForm = true;
	}

	function openEditActivity(index: number) {
		const extras = Array.isArray($linkedPlayer?.extra_activities) ? $linkedPlayer.extra_activities : [];
		const act = extras[index];
		if (!act) return;
		editingIndex = index;
		formType = act.type || 'training';
		formTeamName = act.team_name || '';
		formHours = Number(act.hours) || 1.5;
		formNotes = act.notes || '';
		extraErrorMessage = '';
		extraSaveMessage = '';
		showActivityForm = true;
	}

	function cancelActivityForm() {
		showActivityForm = false;
		editingIndex = null;
		extraErrorMessage = '';
	}

	async function saveActivityForm() {
		if (!playerId || savingExtra) return;
		if (!formHours || formHours <= 0) {
			extraErrorMessage = 'Vul een geldig aantal uren per week in (bijv. 1.5)';
			return;
		}

		savingExtra = true;
		extraErrorMessage = '';
		extraSaveMessage = '';

		try {
			const current = Array.isArray($linkedPlayer?.extra_activities) ? [...$linkedPlayer.extra_activities] : [];
			const item: ExtraActivity = {
				type: formType,
				team_name: formTeamName.trim() || undefined,
				hours: Number(formHours),
				notes: formNotes.trim() || undefined,
				source: 'player',
			};

			let next: ExtraActivity[];
			if (editingIndex !== null && editingIndex >= 0 && editingIndex < current.length) {
				current[editingIndex] = item;
				next = current;
			} else {
				next = [...current, item];
			}

			const updated = await updatePlayerExtraActivities(playerId, next);
			linkedPlayer.set(updated);
			await loadPlayerLoad(playerId, $selectedTeamId, $selectedSeasonId, updated.extra_activities);
			showActivityForm = false;
			editingIndex = null;
			extraSaveMessage = '✅ Extra activiteit opgeslagen';
			setTimeout(() => { extraSaveMessage = ''; }, 3000);
		} catch (e) {
			console.error('Failed to save activity:', e);
			extraErrorMessage = 'Fout bij opslaan: ' + (e instanceof Error ? e.message : String(e));
		} finally {
			savingExtra = false;
		}
	}

	async function removeActivity(index: number) {
		if (!playerId || savingExtra) return;
		if (!confirm('Weet je zeker dat je deze extra activiteit wilt verwijderen?')) return;
		savingExtra = true;
		try {
			const current = Array.isArray($linkedPlayer?.extra_activities) ? [...$linkedPlayer.extra_activities] : [];
			const next = current.filter((_, i) => i !== index);
			const updated = await updatePlayerExtraActivities(playerId, next);
			linkedPlayer.set(updated);
			await loadPlayerLoad(playerId, $selectedTeamId, $selectedSeasonId, updated.extra_activities);
			extraSaveMessage = '✅ Activiteit verwijderd';
			setTimeout(() => { extraSaveMessage = ''; }, 3000);
		} catch (e) {
			console.error('Failed to remove activity:', e);
			alert('Fout bij verwijderen: ' + (e instanceof Error ? e.message : String(e)));
		} finally {
			savingExtra = false;
		}
	}

	// `avail`/`match` params are passed explicitly (rather than read via
	// closure) so Svelte's dependency tracking for `{@const}` inside `{#each}`
	// recognizes the dependency and re-evaluates immediately after a status
	// change — reading the outer array only via closure does NOT trigger a
	// re-render until something else causes a refresh (e.g. a page reload).
	function getTrainingStatus(trainingId: string, records: TrainingAttendance[]): AttendanceStatus {
		return records.find(a => a.training === trainingId)?.status || 'present';
	}

	function getMatchStatus(matchId: string, records: MatchAttendance[]): AttendanceStatus {
		return records.find(a => a.match === matchId)?.status || 'present';
	}

	function getTrainingReason(trainingId: string, records: TrainingAttendance[]): string {
		return records.find(a => a.training === trainingId)?.reason || '';
	}

	function getMatchReason(matchId: string, records: MatchAttendance[]): string {
		return records.find(a => a.match === matchId)?.reason || '';
	}

	async function submitStatus(type: 'training' | 'match', id: string, status: AttendanceStatus, reason?: string) {
		if (!playerId) return;
		const key = `${type}-${id}`;
		submitting[key] = true;
		try {
			const existingReason = type === 'training' ? getTrainingReason(id, trainingAttendance) : getMatchReason(id, matchAttendance);
			const data: any = { player: playerId, status, reason: reason !== undefined ? reason : existingReason };
			if (type === 'training') data.training = id;
			else data.match = id;
			const result = await setPlayerAttendance(data);
			if (type === 'training') {
				const idx = trainingAttendance.findIndex(a => a.training === id);
				if (idx >= 0) trainingAttendance[idx] = result as TrainingAttendance;
				else trainingAttendance = [...trainingAttendance, result as TrainingAttendance];
			} else {
				const idx = matchAttendance.findIndex(a => a.match === id);
				if (idx >= 0) matchAttendance[idx] = result as MatchAttendance;
				else matchAttendance = [...matchAttendance, result as MatchAttendance];
			}
		} catch (e) {
			console.error('Failed to submit attendance:', e);
		} finally {
			submitting[key] = false;
			submitting = submitting; // trigger reactivity
		}
	}

	// Show the next few by default; the toggle expands to the whole season so
	// a player can fill in their attendance in one go.
	const PREVIEW_COUNT = 5;
	$: visibleTrainings = showAllTrainings ? trainings : trainings.slice(0, PREVIEW_COUNT);
	$: visibleMatches = showAllMatches ? matches : matches.slice(0, PREVIEW_COUNT);

	// === Season stats for the logged-in player ===

	$: results = playedMatches.filter((m) => getMatchScore(m).played);
	$: visibleResults = showAllResults ? results : results.slice(0, 1);

	// "Played" means actually being there — a match you missed shouldn't count
	// towards your own total.
	$: matchesPlayed = playedMatches.filter(
		(m) => matchAttendance.find((a) => a.match === m.id)?.status === 'present'
	).length;

	$: pointsByPosition = playerStats
		.flatMap((s) => s.position_points ?? [])
		.reduce<Record<string, number>>((acc, pp) => {
			acc[pp.position] = (acc[pp.position] || 0) + (pp.points || 0);
			return acc;
		}, {});

	$: totalPoints = Object.values(pointsByPosition).reduce((sum, p) => sum + p, 0);
	$: positionBreakdown = Object.entries(pointsByPosition)
		.filter(([, points]) => points > 0)
		.sort((a, b) => b[1] - a[1]) as [PlayerPosition, number][];

	// An unregistered past training counts as a miss: turnout is measured
	// against every training that took place, not just the ones marked.
	// Attendance also covers upcoming trainings, so filter on the actual date.
	$: trainingsAttended = trainingAttendance.filter((a) => {
		if (a.status !== 'present') return false;
		const date = a.expand?.training?.date;
		return date ? new Date(date) < new Date() : false;
	}).length;
	$: trainingTurnout = pastTrainingCount > 0
		? Math.round((Math.min(trainingsAttended, pastTrainingCount) / pastTrainingCount) * 100)
		: null;

	const OUTCOME_STYLES: Record<string, string> = {
		won: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
		lost: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
		draw: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
	};

	const OUTCOME_LABELS: Record<string, string> = { won: 'Gewonnen', lost: 'Verloren', draw: 'Gelijk' };

	function formatDate(date: string): string {
		return new Date(date).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' });
	}
</script>

<svelte:head>
	<title>SetBaas - Mijn Dashboard</title>
</svelte:head>

{#if loading}
	<div class="flex justify-center py-12">
		<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
	</div>
{:else if !$linkedPlayer}
	<div class="card text-center py-12">
		<p class="text-4xl mb-3">👋</p>
		<h2 class="text-xl font-bold text-gray-800 dark:text-gray-200">Welkom bij SetBaas</h2>
		<p class="text-gray-500 dark:text-gray-400 mt-2">Je account is nog niet gekoppeld aan een spelersprofiel.<br/>Neem contact op met je coach.</p>
	</div>
{:else}
	<div class="space-y-6">
		<!-- Welcome -->
		<div class="card py-4 text-center">
			<p class="text-lg font-bold text-gray-800 dark:text-gray-200">
				👋 Hoi {$linkedPlayer.name}!
			</p>
			<p class="text-sm text-gray-500 dark:text-gray-400">Geef je aanwezigheid op voor trainingen en wedstrijden.</p>
		</div>

		<!-- Pending Questionnaires -->
		{#if pendingQuestionnaires.length > 0}
			<a href="{base}/inbox" class="card flex items-center justify-between gap-3 bg-primary-50 dark:bg-primary-900/20 border-2 border-primary-300 dark:border-primary-700 hover:shadow-md transition-shadow">
				<div>
					<p class="font-semibold text-gray-800 dark:text-gray-200">📋 {pendingQuestionnaires.length} nieuwe vragenlijst{pendingQuestionnaires.length === 1 ? '' : 'en'}</p>
					<p class="text-sm text-gray-500 dark:text-gray-400">Bekijk je Inbox om te beantwoorden</p>
				</div>
				<span class="text-primary-600 dark:text-primary-400 text-xl">→</span>
			</a>
		{/if}

		<!-- Upcoming Trainings -->
		<div class="card !border-blue-200 dark:!border-blue-800/60 !bg-blue-50/30 dark:!bg-blue-900/10">
			<div class="flex items-center justify-between mb-3">
				<h2 class="text-lg font-bold text-gray-800 dark:text-gray-200">🏋️ Trainingen</h2>
				{#if trainings.length > PREVIEW_COUNT}
					<button
						class="text-xs font-medium text-primary-600 hover:text-primary-800 dark:hover:text-primary-400"
						on:click={() => showAllTrainings = !showAllTrainings}
					>
						{showAllTrainings ? '▲ Toon minder' : `▼ Toon alle (${trainings.length})`}
					</button>
				{/if}
			</div>
			{#if trainings.length === 0}
				<p class="text-sm text-gray-400">Geen komende trainingen</p>
			{:else}
				<div class="space-y-2">
					{#each visibleTrainings as training}
						{@const current = getTrainingStatus(training.id, trainingAttendance)}
						{@const key = `training-${training.id}`}
						<div class="rounded-xl border border-blue-200/70 dark:border-blue-800/50 bg-white dark:bg-gray-900 py-3 px-4">
							<AttendanceStatusSwitcher
								label={new Date(training.date).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })}
								sublabel={training.location ? `· ${training.location}` : undefined}
								status={current}
								reason={getTrainingReason(training.id, trainingAttendance)}
								on:change={(e) => submitStatus('training', training.id, e.detail)}
								on:reason={(e) => submitStatus('training', training.id, current, e.detail)}
							>
								<svelte:fragment slot="action">
									{#if training.content}
										<button
											class="text-xs font-medium whitespace-nowrap text-primary-600 hover:text-primary-800 dark:hover:text-primary-400"
											on:click={() => lightboxTraining = training}
										>
											Bekijken
										</button>
									{/if}
								</svelte:fragment>
							</AttendanceStatusSwitcher>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Upcoming Matches -->
		<div class="card !border-cyan-200 dark:!border-cyan-800/60 !bg-cyan-50/30 dark:!bg-cyan-900/10">
			<div class="flex items-center justify-between mb-3">
				<h2 class="text-lg font-bold text-gray-800 dark:text-gray-200">🏐 Wedstrijden</h2>
				{#if matches.length > PREVIEW_COUNT}
					<button
						class="text-xs font-medium text-primary-600 hover:text-primary-800 dark:hover:text-primary-400"
						on:click={() => showAllMatches = !showAllMatches}
					>
						{showAllMatches ? '▲ Toon minder' : `▼ Toon alle (${matches.length})`}
					</button>
				{/if}
			</div>
			{#if matches.length === 0}
				<p class="text-sm text-gray-400">Geen komende wedstrijden</p>
			{:else}
				<div class="space-y-2">
					{#each visibleMatches as match}
						{@const current = getMatchStatus(match.id, matchAttendance)}
						{@const key = `match-${match.id}`}
						<div class="rounded-xl border border-cyan-200/70 dark:border-cyan-800/50 bg-white dark:bg-gray-900 py-3 px-4">
							<AttendanceStatusSwitcher
								label={new Date(match.date).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })}
								sublabel={`vs ${match.opponent} (${match.home_away === 'home' ? 'Thuis' : 'Uit'})`}
								status={current}
								reason={getMatchReason(match.id, matchAttendance)}
								on:change={(e) => submitStatus('match', match.id, e.detail)}
								on:reason={(e) => submitStatus('match', match.id, current, e.detail)}
							/>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Results -->
		<div class="card !border-emerald-200 dark:!border-emerald-800/60 !bg-emerald-50/30 dark:!bg-emerald-900/10">
			<div class="flex items-center justify-between mb-3">
				<h2 class="text-lg font-bold text-gray-800 dark:text-gray-200">📋 Uitslagen</h2>
				{#if results.length > 1}
					<button
						class="text-xs font-medium text-primary-600 hover:text-primary-800 dark:hover:text-primary-400"
						on:click={() => showAllResults = !showAllResults}
					>
						{showAllResults ? '▲ Toon minder' : `▼ Alle uitslagen (${results.length})`}
					</button>
				{/if}
			</div>
			{#if results.length === 0}
				<p class="text-sm text-gray-400">Nog geen uitslagen</p>
			{:else}
				<div class="space-y-2">
					{#each visibleResults as match}
						{@const outcome = getMatchOutcome(match) ?? 'draw'}
						{@const score = getMatchScore(match)}
						<div class="rounded-xl border border-emerald-200/70 dark:border-emerald-800/50 bg-white dark:bg-gray-900 py-3 px-4 flex items-center gap-3">
							<div class="flex-1 min-w-0">
								<p class="font-medium text-gray-800 dark:text-gray-200 truncate">
									{match.opponent}
									<span class="text-xs text-gray-400 ml-1">{match.home_away === 'home' ? 'Thuis' : 'Uit'}</span>
								</p>
								<p class="text-xs text-gray-400">{formatDate(match.date)}</p>
							</div>
							<span class="font-bold text-gray-800 dark:text-gray-200 tabular-nums">
								{score.ourSets}–{score.theirSets}
							</span>
							<span class="text-xs font-semibold px-2 py-1 rounded-lg {OUTCOME_STYLES[outcome]}">
								{OUTCOME_LABELS[outcome]}
							</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Monthly load -->
		<LoadReport
			load={playerLoad}
			title="⚖️ Mijn belasting"
			showMonthNav
			onPrevMonth={() => changeLoadMonth(-1)}
			onNextMonth={() => changeLoadMonth(1)}
		/>

		<!-- Self-service: extra weekly activities on top of the team schedule -->
		<div class="card space-y-3">
			<div class="flex items-center justify-between">
				<div>
					<h3 class="font-semibold text-gray-800 dark:text-gray-200">Eigen extra belasting & activiteiten</h3>
					<p class="text-xs text-gray-500 dark:text-gray-400">
						Trainingen, wedstrijden of krachttraining naast dit team
					</p>
				</div>
				{#if !showActivityForm}
					<button
						type="button"
						class="btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5 disabled:opacity-50"
						disabled={savingExtra}
						on:click={openAddActivity}
					>
						<Plus size={15} />
						Activiteit toevoegen
					</button>
				{/if}
			</div>

			{#if extraSaveMessage}
				<div class="p-2.5 rounded-lg bg-green-50 dark:bg-green-900/20 text-xs font-medium text-green-700 dark:text-green-300">
					{extraSaveMessage}
				</div>
			{/if}

			<!-- Inline Add / Edit Form -->
			{#if showActivityForm}
				<div class="p-4 rounded-xl border border-primary-200 dark:border-primary-800/60 bg-primary-50/40 dark:bg-primary-900/15 space-y-3">
					<div class="flex items-center justify-between border-b border-primary-200 dark:border-primary-800/40 pb-2">
						<h4 class="text-sm font-semibold text-gray-800 dark:text-gray-200">
							{editingIndex !== null ? 'Activiteit bewerken' : 'Nieuwe activiteit toevoegen'}
						</h4>
						<button
							type="button"
							class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1"
							on:click={cancelActivityForm}
						>
							<X size={16} />
						</button>
					</div>

					<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
						<div>
							<label class="label text-xs" for="extra-type">Type activiteit</label>
							<select id="extra-type" class="input text-sm py-1.5" bind:value={formType}>
								<option value="training">Extra training</option>
								<option value="match">Extra wedstrijd (invallen)</option>
								<option value="strength">Krachttraining / fitness</option>
								<option value="other">Overig / Andere sport</option>
							</select>
						</div>

						<div>
							<label class="label text-xs" for="extra-team">Team / Omschrijving</label>
							<input
								id="extra-team"
								type="text"
								class="input text-sm py-1.5"
								placeholder="Bijv. Heren 2, Basic Fit, Beach..."
								bind:value={formTeamName}
							/>
						</div>

						<div>
							<label class="label text-xs" for="extra-hours">Uren per week</label>
							<div class="flex items-center gap-2">
								<input
									id="extra-hours"
									type="number"
									min="0.5"
									max="30"
									step="0.5"
									class="input text-sm py-1.5 w-24"
									bind:value={formHours}
									required
								/>
								<span class="text-xs text-gray-500">uur / week</span>
							</div>
						</div>

						<div>
							<label class="label text-xs" for="extra-notes">Notities (optioneel)</label>
							<input
								id="extra-notes"
								type="text"
								class="input text-sm py-1.5"
								placeholder="Bijv. Maandagavond"
								bind:value={formNotes}
							/>
						</div>
					</div>

					{#if extraErrorMessage}
						<p class="text-xs text-red-500 font-medium">{extraErrorMessage}</p>
					{/if}

					<div class="flex items-center justify-end gap-2 pt-1">
						<button
							type="button"
							class="btn-secondary text-xs py-1.5 px-3"
							on:click={cancelActivityForm}
							disabled={savingExtra}
						>
							Annuleren
						</button>
						<button
							type="button"
							class="btn-primary text-xs py-1.5 px-4 flex items-center gap-1.5"
							on:click={saveActivityForm}
							disabled={savingExtra}
						>
							{savingExtra ? 'Opslaan...' : 'Opslaan'}
						</button>
					</div>
				</div>
			{/if}

			<!-- Activities List -->
			{#if (!Array.isArray($linkedPlayer?.extra_activities) || $linkedPlayer.extra_activities.length === 0) && !showActivityForm}
				<div class="p-3 text-center bg-gray-50 dark:bg-gray-800/50 rounded-xl">
					<p class="text-sm text-gray-500 dark:text-gray-400">
						Nog geen eigen extra trainingen of sportactiviteiten toegevoegd.
					</p>
					<button
						type="button"
						class="mt-2 text-xs font-semibold text-primary-600 dark:text-primary-400 hover:underline"
						on:click={openAddActivity}
					>
						+ Voeg je eerste activiteit toe
					</button>
				</div>
			{:else}
				<div class="space-y-2">
					{#each ($linkedPlayer?.extra_activities || []) as activity, i}
						{@const isPlayerAdded = activity.source === 'player'}
						{@const typeLabel = EXTRA_ACTIVITY_LABELS[activity.type] || activity.type}
						<div class="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-xl gap-2 border border-gray-100 dark:border-gray-700/60">
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2 flex-wrap">
									<span class="text-sm font-semibold text-gray-800 dark:text-gray-200">
										{typeLabel}
									</span>
									{#if activity.team_name}
										<span class="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 font-medium">
											{activity.team_name}
										</span>
									{/if}
									{#if !isPlayerAdded}
										<span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
											Trainer
										</span>
									{/if}
								</div>
								{#if activity.notes}
									<p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{activity.notes}</p>
								{/if}
							</div>

							<div class="flex items-center gap-3 self-end sm:self-center">
								<div class="flex items-center gap-1.5 text-sm font-semibold text-gray-800 dark:text-gray-200">
									<span>{activity.hours ?? 0} u/wk</span>
									<span class="text-xs text-gray-400 font-normal">
										(ca. {Math.round((Number(activity.hours) || 0) * (52 / 12) * 10) / 10} u/mnd)
									</span>
								</div>

								{#if isPlayerAdded}
									<div class="flex items-center gap-1">
										<button
											type="button"
											class="p-1.5 rounded-lg text-gray-500 hover:text-primary-600 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
											title="Bewerken"
											aria-label="Activiteit bewerken"
											on:click={() => openEditActivity(i)}
											disabled={savingExtra}
										>
											<Pencil size={15} />
										</button>
										<button
											type="button"
											class="p-1.5 rounded-lg text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
											title="Verwijderen"
											aria-label="Activiteit verwijderen"
											on:click={() => removeActivity(i)}
											disabled={savingExtra}
										>
											<Trash2 size={15} />
										</button>
									</div>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>


		<!-- Personal season stats -->
		<div>
			<h2 class="text-lg font-bold text-gray-800 dark:text-gray-200 mb-3">📊 Mijn statistieken</h2>
			<div class="card space-y-4">
				<div class="grid grid-cols-3 gap-3 text-center">
					<div>
						<p class="text-2xl font-bold text-gray-800 dark:text-gray-200">{matchesPlayed}</p>
						<p class="text-xs text-gray-500 dark:text-gray-400">Wedstrijden</p>
					</div>
					<div>
						<p class="text-2xl font-bold text-gray-800 dark:text-gray-200">{totalPoints}</p>
						<p class="text-xs text-gray-500 dark:text-gray-400">Punten</p>
					</div>
					<div>
						<p class="text-2xl font-bold text-gray-800 dark:text-gray-200">
							{trainingTurnout === null ? '–' : `${trainingTurnout}%`}
						</p>
						<p class="text-xs text-gray-500 dark:text-gray-400">Opkomst</p>
					</div>
				</div>

				{#if trainingTurnout !== null}
					<div>
						<div class="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
							<span>Trainingsopkomst</span>
							<span>{trainingsAttended} van {pastTrainingCount}</span>
						</div>
						<div class="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
							<div class="h-full rounded-full bg-primary-500" style="width: {trainingTurnout}%"></div>
						</div>
					</div>
				{/if}

				<div>
					<p class="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">
						Punten per positie
					</p>
					{#if positionBreakdown.length === 0}
						<p class="text-sm text-gray-400">Nog geen punten geregistreerd</p>
					{:else}
						<div class="space-y-1.5">
							{#each positionBreakdown as [position, points]}
								<div class="flex items-center gap-3">
									<span class="text-sm text-gray-700 dark:text-gray-300 w-40 shrink-0 truncate">
										{POSITION_LABELS[position] ?? position}
									</span>
									<div class="flex-1 h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
										<div
											class="h-full rounded-full bg-primary-500"
											style="width: {totalPoints > 0 ? (points / totalPoints) * 100 : 0}%"
										></div>
									</div>
									<span class="text-sm font-semibold text-gray-800 dark:text-gray-200 tabular-nums w-8 text-right">
										{points}
									</span>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- Training content lightbox -->
{#if lightboxTraining}
	<!-- svelte-ignore a11y-click-events-have-key-events -->
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" on:click={() => lightboxTraining = null}>
		<div class="bg-white dark:bg-gray-900 w-full h-full md:w-[90%] md:h-[90%] md:rounded-2xl shadow-2xl flex flex-col overflow-hidden" on:click|stopPropagation>
			<div class="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
				<div>
					<h2 class="text-lg font-bold text-gray-800 dark:text-gray-100">
						{new Date(lightboxTraining.date).toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
					</h2>
					{#if lightboxTraining.location}
						<p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
							📍 {lightboxTraining.location}
						</p>
					{/if}
				</div>
				<button class="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 transition-colors text-xl" on:click={() => lightboxTraining = null}>
					✕
				</button>
			</div>
			<div class="flex-1 overflow-y-auto px-6 py-6 md:px-12 md:py-8">
				<div class="prose prose-lg dark:prose-invert max-w-none">
					{@html marked(lightboxTraining.content || '', { breaks: true })}
				</div>
			</div>
		</div>
	</div>
{/if}
