<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { getContextPlayers, createMatch, createMatchPlayerStats, getTeamAccessForTeam } from '$lib/pocketbase';
	import type { Player, PlayerPosition, SetScore, GameSystem, SetLineup, SetGameSystem, Substitution, Timeout } from '$lib/types';
	import type { TeamAccess } from '$lib/pocketbase';
	import { POSITION_LABELS, GAME_SYSTEM_LABELS, COURT_POSITION_LABELS } from '$lib/types';
	import { selectedTeamId, selectedSeasonId } from '$lib/stores/context';
	import { authUser } from '$lib/stores/auth';

	let players: Player[] = [];
	let loading = true;
	let saving = false;

	// Match form
	let matchDate = new Date().toISOString().slice(0, 10);
	let matchTime = '19:30';
	let opponent = '';
	let location = '';
	let homeAway: 'home' | 'away' = 'home';
	let generalNotes = '';

	// Coaches
	let coachMembers: TeamAccess[] = [];
	let selectedCoaches: string[] = [];

	// Set scores
	let setScores: SetScore[] = [
		{ team: null, opponent: null },
		{ team: null, opponent: null },
		{ team: null, opponent: null },
	];

	// Per-set lineup: positions 1-6 -> player ID
	let setLineups: Record<number, Record<string, string>> = {};
	// Per-set game system
	let setGameSystems: Record<number, GameSystem> = {};
	// Substitutions
	let substitutions: Substitution[] = [];
	// Timeouts
	let timeouts: Timeout[] = [];

	// Per set per player: { position, points }
	let perSetData: Record<string, Record<number, { position: string; points: number }>> = {};
	let playerNotes: Record<string, string> = {};

	const allPositions = Object.entries(POSITION_LABELS) as [PlayerPosition, string][];
	const courtPositions = ['1', '2', '3', '4', '5', '6'];
	const gameSystems = Object.entries(GAME_SYSTEM_LABELS);

	// Lineup (selected player IDs)
	let lineup: string[] = [];

	// Tabs: 0 = Opstelling, 1..N = Set 1..N
	let activeTab = 0;

	function initSetData() {
		for (let s = 1; s <= setScores.length; s++) {
			if (!setLineups[s]) setLineups[s] = {};
			if (!setGameSystems[s]) setGameSystems[s] = '';
		}
	}

	function addSet() {
		if (setScores.length < 5) {
			setScores = [...setScores, { team: null, opponent: null }];
			const s = setScores.length;
			setLineups[s] = { ...setLineups[setScores.length - 1] }; // Copy previous lineup
			setGameSystems[s] = setGameSystems[setScores.length - 1] || '';
			for (const pid of lineup) {
				if (!perSetData[pid]) perSetData[pid] = {};
				const defaultPos = (players.find(p => p.id === pid)?.position || [])[0] || '';
				perSetData[pid][s] = { position: defaultPos, points: 0 };
			}
			perSetData = perSetData;
			setLineups = setLineups;
		}
	}

	function removeSet() {
		if (setScores.length > 1) {
			const removing = setScores.length;
			setScores = setScores.slice(0, -1);
			delete setLineups[removing];
			delete setGameSystems[removing];
			substitutions = substitutions.filter(s => s.set !== removing);
			timeouts = timeouts.filter(t => t.set !== removing);
			for (const pid of lineup) {
				if (perSetData[pid]) delete perSetData[pid][removing];
			}
			perSetData = perSetData;
			if (activeTab > setScores.length) activeTab = setScores.length;
		}
	}

	// Set scores are stored home-first (scoresheet order): scoreTeam = home sets, scoreOpponent = away sets.
	$: scoreTeam = setScores.filter(s => s.team !== null && s.opponent !== null && (s.team ?? 0) > (s.opponent ?? 0)).length;
	$: scoreOpponent = setScores.filter(s => s.team !== null && s.opponent !== null && (s.opponent ?? 0) > (s.team ?? 0)).length;
	$: ourSets = homeAway === 'home' ? scoreTeam : scoreOpponent;
	$: theirSets = homeAway === 'home' ? scoreOpponent : scoreTeam;
	$: homeLabel = homeAway === 'home' ? 'Wij' : (opponent || 'Tegenstander');
	$: awayLabel = homeAway === 'home' ? (opponent || 'Tegenstander') : 'Wij';

	function toggleLineup(playerId: string) {
		if (lineup.includes(playerId)) {
			lineup = lineup.filter(id => id !== playerId);
		} else {
			lineup = [...lineup, playerId];
			if (!perSetData[playerId]) perSetData[playerId] = {};
			for (let s = 1; s <= setScores.length; s++) {
				if (!perSetData[playerId][s]) {
					const defaultPos = (players.find(p => p.id === playerId)?.position || [])[0] || '';
					perSetData[playerId][s] = { position: defaultPos, points: 0 };
				}
			}
			perSetData = perSetData;
		}
	}

	// Substitution helpers
	function addSubstitution(setNum: number) {
		substitutions = [...substitutions, { set: setNum, playerIn: '', playerOut: '', atScore: '' }];
	}

	function removeSubstitution(idx: number) {
		substitutions = substitutions.filter((_, i) => i !== idx);
	}

	// Timeout helpers
	function addTimeout(setNum: number) {
		timeouts = [...timeouts, { set: setNum, team: 'own', atScore: '' }];
	}

	function removeTimeout(idx: number) {
		timeouts = timeouts.filter((_, i) => i !== idx);
	}

	// Get subs for a specific set
	function subsForSet(setNum: number): { sub: Substitution; idx: number }[] {
		return substitutions.map((sub, idx) => ({ sub, idx })).filter(s => s.sub.set === setNum);
	}

	// Get timeouts for a specific set
	function tosForSet(setNum: number): { to: Timeout; idx: number }[] {
		return timeouts.map((to, idx) => ({ to, idx })).filter(t => t.to.set === setNum);
	}

	onMount(async () => {
		try {
			players = await getContextPlayers($selectedTeamId, $selectedSeasonId, { activeOnly: true });
			lineup = players.map(p => p.id);
			for (const p of players) {
				playerNotes[p.id] = '';
				perSetData[p.id] = {};
				const defaultPos = (p.position || [])[0] || '';
				for (let s = 1; s <= setScores.length; s++) {
					perSetData[p.id][s] = { position: defaultPos, points: 0 };
				}
			}
			initSetData();
		} catch (e) {
			console.error('Failed to load players:', e);
		} finally {
			loading = false;
		}

		// Load coaches
		if ($selectedTeamId) {
			try {
				const allAccess = await getTeamAccessForTeam($selectedTeamId);
				coachMembers = allAccess.filter(a => a.is_trainer);
			} catch (e) { /* ignore */ }
		}
	});

	function setFullSet(playerId: string, setNum: number) {
		const sd = perSetData[playerId][setNum];
		sd.points = sd.points === 25 ? 0 : 25;
		perSetData = perSetData;
	}

	function playerTotal(pid: string): number {
		const data = perSetData[pid] || {};
		return Object.values(data).reduce((s, d) => s + (d.points || 0), 0);
	}

	// Get player name by id
	function playerName(pid: string): string {
		return players.find(p => p.id === pid)?.name || '?';
	}

	async function handleSubmit() {
		if (!opponent.trim()) return;
		saving = true;
		try {
			const filledSets = setScores.filter(s => s.team !== null || s.opponent !== null);

			// Build lineups array
			const lineupsArr = Object.entries(setLineups)
				.filter(([_, pos]) => Object.values(pos).some(v => v))
				.map(([set, positions]) => ({ set: parseInt(set), positions }));

			const systemsArr = Object.entries(setGameSystems)
				.filter(([_, sys]) => sys)
				.map(([set, system]) => ({ set: parseInt(set), system }));

			const match = await createMatch({
				date: new Date(`${matchDate}T${matchTime}`).toISOString(),
				opponent: opponent.trim(),
				location: location.trim() || undefined,
				home_away: homeAway,
				status: 'open',
				score_team: scoreTeam || undefined,
				score_opponent: scoreOpponent || undefined,
				set_scores: filledSets.length > 0 ? filledSets : undefined,
				general_notes: generalNotes || undefined,
				team: $selectedTeamId || undefined,
				season: $selectedSeasonId || undefined,
				lineups: lineupsArr.length > 0 ? lineupsArr : undefined,
				game_system: systemsArr.length > 0 ? systemsArr : undefined,
				substitutions: substitutions.filter(s => s.playerIn && s.playerOut).length > 0
					? substitutions.filter(s => s.playerIn && s.playerOut)
					: undefined,
				timeouts: timeouts.length > 0 ? timeouts : undefined,
				created_by: $authUser?.id || undefined,
				coach: selectedCoaches.length > 0 ? selectedCoaches : undefined,
			});

			const promises = lineup.map(pid => {
				const setData = perSetData[pid] || {};
				const posPoints: { set: number; position: string; points: number }[] = [];
				for (const [setStr, data] of Object.entries(setData)) {
					if (data.position && data.points > 0) {
						posPoints.push({ set: parseInt(setStr), position: data.position, points: data.points });
					}
				}
				return createMatchPlayerStats({
					match: match.id,
					player: pid,
					position_points: posPoints.length > 0 ? posPoints : undefined,
					notes: playerNotes[pid] || undefined,
				});
			});
			await Promise.all(promises);
			goto(`${base}/matches`);
		} catch (e) {
			console.error('Failed to save match:', e);
			alert('Fout bij opslaan wedstrijd');
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>Nieuwe Wedstrijd - SetBaas</title>
</svelte:head>

{#if loading}
	<div class="flex justify-center py-12">
		<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
	</div>
{:else}
	<form class="space-y-4" on:submit|preventDefault={handleSubmit}>
		<h2 class="text-xl font-bold text-gray-800 dark:text-gray-200">Nieuwe Wedstrijd</h2>

		<!-- Match details -->
		<div class="card space-y-3">
			<div>
				<label class="label" for="opponent">Tegenstander *</label>
				<input id="opponent" class="input" type="text" bind:value={opponent} required placeholder="Naam tegenstander" />
			</div>

			<div class="grid grid-cols-2 gap-3">
				<div>
					<label class="label" for="date">Datum & Tijd</label>
					<div class="flex gap-2">
						<input id="date" class="input flex-1" type="date" bind:value={matchDate} required />
						<input class="input w-28" type="time" bind:value={matchTime} required />
					</div>
				</div>
				<div>
					<label class="label">Thuis / uit</label>
					<div class="flex rounded-xl overflow-hidden border border-gray-300 dark:border-gray-600">
						<button type="button"
							class="flex-1 py-3 text-sm font-semibold transition-colors {homeAway === 'home' ? 'bg-primary-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300'}"
							on:click={() => (homeAway = 'home')}>Thuis</button>
						<button type="button"
							class="flex-1 py-3 text-sm font-semibold transition-colors {homeAway === 'away' ? 'bg-primary-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300'}"
							on:click={() => (homeAway = 'away')}>Uit</button>
					</div>
				</div>

				<div>
					<label class="label" for="location">Zaal / locatie</label>
					<input id="location" class="input" type="text" bind:value={location} placeholder="Naam of adres van de sporthal" />
				</div>
			</div>

			<!-- Coach checkboxes -->
			{#if coachMembers.length > 0}
				<div>
					<label class="label">Coach(es)</label>
					<div class="flex flex-wrap gap-3">
						{#each coachMembers as tm}
							<label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
								<input type="checkbox" class="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
									checked={selectedCoaches.includes(tm.user)}
									on:change={(e) => {
										if (e.currentTarget.checked) selectedCoaches = [...selectedCoaches, tm.user];
										else selectedCoaches = selectedCoaches.filter(id => id !== tm.user);
									}} />
								{tm.expand?.user?.name || tm.expand?.user?.email}
							</label>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Set Scores -->
			<div>
				<label class="label">Setstanden <span class="font-normal text-xs text-gray-500">(thuisteam eerst)</span></label>
				<div class="flex items-center gap-2 mb-1 text-xs text-gray-500 dark:text-gray-400">
					<span class="w-10"></span>
					<span class="w-14 text-center truncate" title={homeLabel}>{homeLabel}</span>
					<span class="w-3"></span>
					<span class="w-14 text-center truncate" title={awayLabel}>{awayLabel}</span>
				</div>
				<div class="space-y-2">
					{#each setScores as set, i}
						<div class="flex items-center gap-2">
							<span class="text-xs text-gray-500 dark:text-gray-400 w-10">Set {i + 1}</span>
							<input type="number" min="0" max="50"
								class="w-14 text-center rounded-lg border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white py-1.5 text-sm font-bold"
								bind:value={setScores[i].team} placeholder="—" />
							<span class="text-gray-400 dark:text-gray-500 font-bold text-sm">-</span>
							<input type="number" min="0" max="50"
								class="w-14 text-center rounded-lg border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white py-1.5 text-sm font-bold"
								bind:value={setScores[i].opponent} placeholder="—" />
						</div>
					{/each}
				</div>
				<div class="flex gap-2 mt-2">
					{#if setScores.length < 5}
						<button type="button" class="text-xs text-primary-600 hover:underline" on:click={addSet}>+ Set</button>
					{/if}
					{#if setScores.length > 1}
						<button type="button" class="text-xs text-red-500 hover:underline" on:click={removeSet}>− Set</button>
					{/if}
				</div>
				{#if scoreTeam > 0 || scoreOpponent > 0}
					<div class="text-sm mt-1">
						Einduitslag: <span class="font-bold text-lg {ourSets > theirSets ? 'text-green-600' : ourSets < theirSets ? 'text-red-600' : ''}">{ourSets} - {theirSets}</span>
						<span class="text-xs text-gray-500">({ourSets > theirSets ? 'gewonnen' : ourSets < theirSets ? 'verloren' : 'gelijk'} · formulier: {scoreTeam} - {scoreOpponent})</span>
					</div>
				{/if}
			</div>

			<div>
				<label class="label" for="notes">Opmerkingen</label>
				<textarea id="notes" class="input" rows="2" bind:value={generalNotes} placeholder="Wedstrijdnotities..."></textarea>
			</div>
		</div>

		<!-- Tabs: Opstelling + per Set -->
		<div class="card p-0 overflow-hidden">
			<div class="flex overflow-x-auto border-b border-gray-200 dark:border-gray-700">
				<button type="button"
					class="px-4 py-3 text-sm font-semibold whitespace-nowrap transition-colors {
						activeTab === 0
							? 'text-primary-600 border-b-2 border-primary-600 bg-primary-50 dark:bg-primary-900/20'
							: 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
					}"
					on:click={() => (activeTab = 0)}>
					Selectie
				</button>
				{#each setScores as _, i}
					<button type="button"
						class="px-4 py-3 text-sm font-semibold whitespace-nowrap transition-colors {
							activeTab === i + 1
								? 'text-primary-600 border-b-2 border-primary-600 bg-primary-50 dark:bg-primary-900/20'
								: 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
						}"
						on:click={() => (activeTab = i + 1)}>
						Set {i + 1}
					</button>
				{/each}
			</div>

			<div class="p-4">
				<!-- TAB: Selectie -->
				{#if activeTab === 0}
					<div class="space-y-2">
						<p class="text-xs text-gray-500 dark:text-gray-400 mb-2">Selecteer spelers die meespelen:</p>
						{#each players as player (player.id)}
							{@const inLineup = lineup.includes(player.id)}
							<div class="flex items-center gap-3 py-1.5">
								<button type="button"
									class="touch-target w-14 py-2 rounded-lg text-xs font-semibold {
										inLineup
											? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400'
											: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
									}"
									on:click={() => toggleLineup(player.id)}>
									{inLineup ? '✓ Ja' : '✕ Nee'}
								</button>
								<span class="flex-1 font-medium text-sm truncate">{player.name}</span>
								<span class="text-xs text-gray-400 dark:text-gray-500">
									{(player.position || []).map(p => POSITION_LABELS[p]).join(', ')}
								</span>
							</div>
						{/each}
					</div>

				<!-- TAB: Set N -->
				{:else}
					{@const setNum = activeTab}
					<div class="space-y-5">

						<!-- Spelsysteem -->
						<div>
							<label class="label">Spelsysteem</label>
							<div class="flex flex-wrap gap-2">
								{#each gameSystems as [value, label]}
									<button type="button"
										class="px-3 py-2 rounded-lg text-xs font-semibold transition-colors {
											setGameSystems[setNum] === value
												? 'bg-primary-600 text-white'
												: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
										}"
										on:click={() => {
											setGameSystems[setNum] = setGameSystems[setNum] === value ? '' : value;
											setGameSystems = setGameSystems;
										}}>
										{value}
									</button>
								{/each}
							</div>
						</div>

						<!-- Startopstelling positie 1-6 -->
						<div>
							<label class="label">Startopstelling</label>
							<div class="grid grid-cols-1 gap-2">
								{#each courtPositions as pos}
									<div class="flex items-center gap-2">
										<span class="text-xs font-semibold text-gray-500 dark:text-gray-400 w-20">
											{COURT_POSITION_LABELS[pos]}
										</span>
										<select
											class="input flex-1 py-2 text-sm"
											bind:value={setLineups[setNum][pos]}
											on:change={() => { setLineups = setLineups; }}>
											<option value="">— Kies speler —</option>
											{#each lineup as pid}
												{@const player = players.find(p => p.id === pid)}
												{#if player}
													<option value={pid}>{player.name}</option>
												{/if}
											{/each}
										</select>
									</div>
								{/each}
							</div>
							{#if setNum > 1}
								<button type="button" class="text-xs text-primary-600 hover:underline mt-2"
									on:click={() => {
										setLineups[setNum] = { ...setLineups[setNum - 1] };
										setLineups = setLineups;
									}}>
									Kopieer van Set {setNum - 1}
								</button>
							{/if}
						</div>

						<!-- Punten per speler -->
						<div>
							<label class="label">Punten per speler</label>
							<div class="space-y-2">
								{#each lineup as pid (pid)}
									{@const player = players.find(p => p.id === pid)}
									{@const sd = perSetData[pid]?.[setNum]}
									{#if player && sd}
										<div class="border border-gray-100 dark:border-gray-700 rounded-xl p-3">
											<div class="flex items-center gap-2 mb-2">
												<span class="font-medium text-sm flex-1 truncate">{player.name}</span>
												<span class="text-xs font-bold text-primary-600 dark:text-primary-400">
													{playerTotal(pid)} pt totaal
												</span>
											</div>

											<div class="flex flex-wrap gap-1.5 mb-2">
												{#each allPositions as [value, label]}
													<button type="button"
														class="px-2 py-1 rounded-lg text-xs font-medium transition-colors {
															sd.position === value
																? 'bg-primary-600 text-white'
																: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
														}"
														on:click={() => {
															perSetData[pid][setNum].position = sd.position === value ? '' : value;
															perSetData = perSetData;
														}}>
														{label}
													</button>
												{/each}
											</div>

											{#if sd.position}
												<div class="flex items-center gap-2 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-1.5">
													<span class="text-xs text-gray-500 dark:text-gray-400 flex-1">
														Punten als {POSITION_LABELS[sd.position] || sd.position}:
													</span>
													<label class="flex items-center gap-1 cursor-pointer">
														<input type="checkbox" checked={sd.points === 25}
															on:change={() => setFullSet(pid, setNum)}
															class="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary-600 dark:bg-gray-700" />
														<span class="text-[10px] text-gray-400">set</span>
													</label>
													<input type="number" min="0" max="100"
														class="w-16 text-center rounded-lg border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white py-1 text-sm font-bold"
														bind:value={perSetData[pid][setNum].points} />
													<span class="text-xs text-gray-400">pt</span>
												</div>
											{/if}
										</div>
									{/if}
								{/each}
							</div>
						</div>

						<!-- Wissels -->
						<div>
							<div class="flex justify-between items-center mb-2">
								<label class="label mb-0">Wissels</label>
								<button type="button" class="text-xs text-primary-600 hover:underline" on:click={() => addSubstitution(setNum)}>
									+ Wissel
								</button>
							</div>
							{#each subsForSet(setNum) as { sub, idx } (idx)}
								<div class="flex items-center gap-2 mb-2">
									<select class="input flex-1 py-2 text-sm" bind:value={substitutions[idx].playerOut}>
										<option value="">Uit →</option>
										{#each lineup as pid}
											<option value={pid}>{playerName(pid)}</option>
										{/each}
									</select>
									<select class="input flex-1 py-2 text-sm" bind:value={substitutions[idx].playerIn}>
										<option value="">→ In</option>
										{#each players as p}
											<option value={p.id}>{p.name}</option>
										{/each}
									</select>
									<input type="text" class="input w-16 py-2 text-sm text-center" placeholder="Stand"
										bind:value={substitutions[idx].atScore} />
									<button type="button" class="text-red-500 text-xs hover:underline" on:click={() => removeSubstitution(idx)}>✕</button>
								</div>
							{/each}
							{#if subsForSet(setNum).length === 0}
								<p class="text-xs text-gray-400 dark:text-gray-500">Geen wissels</p>
							{/if}
						</div>

						<!-- Timeouts -->
						<div>
							<div class="flex justify-between items-center mb-2">
								<label class="label mb-0">Timeouts</label>
								<button type="button" class="text-xs text-primary-600 hover:underline" on:click={() => addTimeout(setNum)}>
									+ Timeout
								</button>
							</div>
							{#each tosForSet(setNum) as { to, idx } (idx)}
								<div class="flex items-center gap-2 mb-2">
									<div class="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600 flex-1">
										<button type="button"
											class="flex-1 py-2 text-xs font-semibold {
												timeouts[idx].team === 'own' ? 'bg-primary-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300'
											}"
											on:click={() => { timeouts[idx].team = 'own'; timeouts = timeouts; }}>
											Eigen
										</button>
										<button type="button"
											class="flex-1 py-2 text-xs font-semibold {
												timeouts[idx].team === 'opponent' ? 'bg-red-500 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300'
											}"
											on:click={() => { timeouts[idx].team = 'opponent'; timeouts = timeouts; }}>
											Tegenstander
										</button>
									</div>
									<input type="text" class="input w-16 py-2 text-sm text-center" placeholder="Stand"
										bind:value={timeouts[idx].atScore} />
									<button type="button" class="text-red-500 text-xs hover:underline" on:click={() => removeTimeout(idx)}>✕</button>
								</div>
							{/each}
							{#if tosForSet(setNum).length === 0}
								<p class="text-xs text-gray-400 dark:text-gray-500">Geen timeouts</p>
							{/if}
						</div>

						{#if lineup.length === 0}
							<p class="text-sm text-gray-400 text-center py-4">
								Ga eerst naar het Selectie-tabje om spelers te selecteren.
							</p>
						{/if}
					</div>
				{/if}
			</div>
		</div>

		<!-- Submit -->
		<button type="submit" class="btn-primary w-full text-lg py-4" disabled={saving}>
			{saving ? 'Opslaan...' : 'Wedstrijd Opslaan'}
		</button>

		<a href="{base}/matches" class="btn-secondary w-full text-center">Annuleren</a>
	</form>
{/if}
