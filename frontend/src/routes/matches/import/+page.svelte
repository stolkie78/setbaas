<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { pb } from '$lib/pocketbase';
	import { getTeamMatches, resolvePouleIndeling, resolveSporthal, getNevoboResult, NEVOBO_TEAM_TYPES } from '$lib/nevobo';
	import type { NevoboMatch } from '$lib/nevobo';
	import type { Team } from '$lib/types';
	import { selectedTeamId, selectedSeasonId } from '$lib/stores/context';
	import { authUser } from '$lib/stores/auth';

	let team: Team | null = null;
	let loading = false;
	let importing = false;
	let matches: (NevoboMatch & { resolved?: { home: string; away: string; sporthal: string }; selected: boolean })[] = [];
	let error = '';
	let importCount = 0;
	let updateCount = 0;

	// Manual config if team doesn't have nevobo settings
	let manualCode = '';
	let manualType = 'meiden-b';
	let manualNumber = 1;



	onMount(async () => {
		if ($selectedTeamId) {
			team = await pb.collection('teams').getOne<Team>($selectedTeamId, { expand: 'club' });
			// Parse nevobo_url if available: https://www.volleybal.nl/competitie/vereniging/{code}/{type}/{number}
			if (team.nevobo_url) {
				const match = team.nevobo_url.match(/\/vereniging\/([^/]+)\/([^/]+)\/(\d+)/);
				if (match) {
					manualCode = match[1];
					manualType = match[2];
					manualNumber = parseInt(match[3]);
				}
			} else if (team.nevobo_code) {
				manualCode = team.nevobo_code;
				manualType = team.nevobo_team_type || 'hs';
				manualNumber = team.nevobo_team_number || 1;
			}
		}
	});

	// Recognise our own club/team in a Nevobo team name (e.g. "Zovoc MB 1").
	function isOurTeam(name?: string): boolean {
		if (!name) return false;
		const n = name.toLowerCase();
		const clubName = (team?.expand as { club?: { name?: string } } | undefined)?.club?.name;
		const candidates = [clubName, team?.name].filter(Boolean) as string[];

		for (const candidate of candidates) {
			const token = candidate.toLowerCase().split(/\s+/)[0];
			if (token && n.includes(token)) return true;
		}

		const code = manualCode.trim().toLowerCase();
		return code.length > 0 && n.includes(code);
	}

	async function fetchMatches() {
		if (!manualCode.trim()) {
			error = 'Vul een Nevobo verenigingscode in';
			return;
		}
		loading = true;
		error = '';
		matches = [];

		try {
			const nevoboMatches = await getTeamMatches(manualCode, manualType, manualNumber);

			if (nevoboMatches.length === 0) {
				error = 'Geen wedstrijden gevonden voor dit team. Controleer de code en het type.';
				return;
			}

			// Resolve team names and sporthal for each match
			matches = await Promise.all(
				nevoboMatches.map(async (m) => {
					let home = 'Team A';
					let away = 'Team B';
					let sporthal = '';

					if (m.teams?.length >= 2) {
						[home, away] = await Promise.all([
							resolvePouleIndeling(m.teams[0]),
							resolvePouleIndeling(m.teams[1]),
						]);
					}
					if (m.sporthal) {
						sporthal = await resolveSporthal(m.sporthal);
					}

					return { ...m, resolved: { home, away, sporthal }, selected: true };
				})
			);
		} catch (e) {
			error = `Fout bij ophalen: ${e}`;
		} finally {
			loading = false;
		}
	}

	async function importSelected() {
		importing = true;
		importCount = 0;
		updateCount = 0;

		try {
			const selected = matches.filter(m => m.selected);

			// Fetch existing matches with nevobo_uuid to detect duplicates
			const existingMatches = await pb.collection('matches').getFullList({
				filter: `team = "${$selectedTeamId}"`,
				fields: 'id,nevobo_uuid'
			});
			const existingByUuid = new Map(
				existingMatches.filter(m => m.nevobo_uuid).map(m => [m.nevobo_uuid, m.id])
			);

			for (const m of selected) {
				const dateStr = m.tijdstip || m.datum;
				const isHomeOurs = isOurTeam(m.resolved?.home);
				const opponent = isHomeOurs ? m.resolved?.away : m.resolved?.home;

				const nevoboData: Record<string, unknown> = {
					date: new Date(dateStr).toISOString(),
					opponent: opponent || 'Onbekend',
					home_away: isHomeOurs ? 'home' : 'away',
					location: m.resolved?.sporthal || '',
					nevobo_uuid: m.uuid,
					nevobo_code: m.code,
				};

				// Import scores if match has been played
				// Scores are stored home-first (scoresheet order), matching Nevobo's A/B teams.
				const result = getNevoboResult(m);
				if (result) {
					nevoboData.score_team = result.homeSets;
					nevoboData.score_opponent = result.awaySets;
					if (result.sets.length > 0) {
						nevoboData.set_scores = result.sets.map((s) => ({
							set: s.set,
							team: s.home,
							opponent: s.away,
						}));
					}
					nevoboData.status = 'played';
				}

				const existingId = existingByUuid.get(m.uuid);
				if (existingId) {
					// Update only Nevobo-sourced fields, preserve user data
					await pb.collection('matches').update(existingId, nevoboData);
					updateCount++;
				} else {
					await pb.collection('matches').create({
						// Imported results are already final; the rest still has to be played
						status: 'open',
						...nevoboData,
						team: $selectedTeamId || undefined,
						season: $selectedSeasonId || undefined,
						created_by: $authUser?.id || undefined,
					});
					importCount++;
				}
			}

			// Save nevobo config to team if changed
			if (team && $selectedTeamId) {
				await pb.collection('teams').update($selectedTeamId, {
					nevobo_code: manualCode.toUpperCase(),
					nevobo_team_type: manualType,
					nevobo_team_number: manualNumber,
				});
			}

			goto(`${base}/matches`);
		} catch (e) {
			error = `Fout bij importeren: ${e}`;
		} finally {
			importing = false;
		}
	}

	function toggleAll(checked: boolean) {
		matches = matches.map(m => ({ ...m, selected: checked }));
	}
</script>

<svelte:head>
	<title>Nevobo Import - SetBaas</title>
</svelte:head>

<div class="space-y-4">
	<div class="flex justify-between items-center">
		<h2 class="text-xl font-bold text-gray-800 dark:text-gray-200">Wedstrijden Importeren</h2>
		<a href="{base}/matches" class="btn-secondary text-sm">← Terug</a>
	</div>

	<!-- Nevobo Config -->
	<div class="card space-y-4">
		<h3 class="font-semibold text-gray-800 dark:text-gray-200">Nevobo Configuratie</h3>
		<p class="text-sm text-gray-500 dark:text-gray-400">
			Vul de Nevobo verenigingscode in (bijv. CKM1H25) en selecteer het teamtype.
			Je vindt de code op <a href="https://www.nevobo.nl" target="_blank" class="text-primary-600 underline">nevobo.nl</a> bij je vereniging.
		</p>

		<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
			<div>
				<label class="label">Verenigingscode *</label>
				<input type="text" class="input" bind:value={manualCode} placeholder="bijv. CKM1H25" />
			</div>
			<div>
				<label class="label">Team type</label>
				<select class="input" bind:value={manualType}>
					{#each NEVOBO_TEAM_TYPES as t}
						<option value={t.value}>{t.label}</option>
					{/each}
				</select>
			</div>
			<div>
				<label class="label">Nummer</label>
				<input type="number" class="input" bind:value={manualNumber} min="1" max="20" />
			</div>
		</div>

		<button class="btn-primary" on:click={fetchMatches} disabled={loading}>
			{loading ? 'Ophalen...' : '🔄 Wedstrijdschema ophalen'}
		</button>
	</div>

	{#if error}
		<div class="card bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
			{error}
		</div>
	{/if}

	<!-- Results -->
	{#if matches.length > 0}
		<div class="card space-y-3">
			<div class="flex justify-between items-center">
				<h3 class="font-semibold text-gray-800 dark:text-gray-200">
					{matches.length} wedstrijden gevonden
				</h3>
				<div class="flex gap-2">
					<button class="text-xs text-primary-600" on:click={() => toggleAll(true)}>Alles selecteren</button>
					<button class="text-xs text-gray-500" on:click={() => toggleAll(false)}>Deselecteer</button>
				</div>
			</div>

			<div class="space-y-2 max-h-[60vh] overflow-y-auto">
				{#each matches as match, i}
					{@const result = getNevoboResult(match)}
					<label class="flex items-start gap-3 p-3 rounded-xl border border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
						<input type="checkbox" bind:checked={matches[i].selected} class="mt-1" />
						<div class="flex-1 min-w-0">
							<div class="font-medium text-sm">
								{match.resolved?.home || '?'} vs {match.resolved?.away || '?'}
							</div>
							<div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
								{new Date(match.tijdstip || match.datum).toLocaleDateString('nl-NL', {
									weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
								})}
								{#if match.tijdstip}
									— {new Date(match.tijdstip).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', hour12: false })}
								{/if}
							</div>
							{#if match.resolved?.sporthal}
								<div class="text-xs text-gray-400 mt-0.5">📍 {match.resolved.sporthal}</div>
							{/if}
							{#if result && result.sets.length > 0}
								<div class="flex flex-wrap gap-1 mt-1.5">
									{#each result.sets as set}
										<span class="text-xs px-1.5 py-0.5 rounded font-mono bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
											{set.home ?? '?'}-{set.away ?? '?'}
										</span>
									{/each}
								</div>
							{/if}
						</div>
						<div class="flex flex-col items-end gap-1">
							<span class="text-xs px-2 py-0.5 rounded-full {
								match.status?.waarde === 'gespeeld' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
								: match.status?.waarde === 'definitief' ? 'bg-green-100 text-green-700'
								: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
							}">
								{match.status?.omschrijving || 'Concept'}
							</span>
							{#if result}
								<span class="text-base font-bold text-gray-800 dark:text-gray-200 whitespace-nowrap">
									{result.homeSets} - {result.awaySets}
								</span>
							{/if}
						</div>
					</label>
				{/each}
			</div>

			<button
				class="btn-primary w-full text-lg py-4"
				on:click={importSelected}
				disabled={importing || matches.filter(m => m.selected).length === 0}
			>
				{#if importing}
					Importeren... ({importCount + updateCount}/{matches.filter(m => m.selected).length})
				{:else}
					📥 {matches.filter(m => m.selected).length} wedstrijden importeren / bijwerken
				{/if}
			</button>
		</div>
	{/if}
</div>
