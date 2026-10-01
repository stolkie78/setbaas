<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { pb } from '$lib/pocketbase';
	import { getTeamMatches, resolvePouleIndeling, resolveSporthal, getNevoboResult, parseNevoboTeamUrl, NevoboProxyError } from '$lib/nevobo';
	import type { NevoboMatch, NevoboTeamRef } from '$lib/nevobo';
	import type { Team } from '$lib/types';
	import { selectedTeamId, selectedSeasonId } from '$lib/stores/context';
	import { authUser } from '$lib/stores/auth';

	let team: Team | null = null;
	let teamLoading = true;
	let loading = false;
	let importing = false;
	let matches: (NevoboMatch & { resolved?: { home: string; away: string; sporthal: string }; selected: boolean })[] = [];
	let error = '';
	let importCount = 0;
	let updateCount = 0;

	/** The Nevobo team is derived from the URL configured on the team. */
	let teamRef: NevoboTeamRef | null = null;

	$: nevoboUrl = team?.nevobo_url?.trim() || '';

	onMount(async () => {
		try {
			if (!$selectedTeamId) return;
			team = await pb.collection('teams').getOne<Team>($selectedTeamId, { expand: 'club' });
			teamRef = parseNevoboTeamUrl(team.nevobo_url);
		} catch (e) {
			error = `Fout bij laden team: ${e}`;
		} finally {
			teamLoading = false;
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

		const code = teamRef?.code ?? '';
		return code.length > 0 && n.includes(code);
	}

	async function fetchMatches() {
		if (!teamRef) return;

		loading = true;
		error = '';
		matches = [];

		try {
			const nevoboMatches = await getTeamMatches(teamRef.code, teamRef.teamType, teamRef.teamNumber);

			if (nevoboMatches.length === 0) {
				error = 'Geen wedstrijden gevonden voor dit team. Controleer de Nevobo URL bij Instellingen.';
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
			error = e instanceof NevoboProxyError ? e.message : `Fout bij ophalen: ${e}`;
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

	<!-- Nevobo config comes from the team settings; this page only reads it -->
	<div class="card space-y-4">
		<h3 class="font-semibold text-gray-800 dark:text-gray-200">Nevobo koppeling</h3>

		{#if teamLoading}
			<p class="text-sm text-gray-500 dark:text-gray-400">Teamgegevens laden...</p>
		{:else if !$selectedTeamId}
			<p class="text-sm text-gray-500 dark:text-gray-400">
				Selecteer eerst een team om het wedstrijdschema op te halen.
			</p>
		{:else if !nevoboUrl}
			<p class="text-sm text-gray-500 dark:text-gray-400">
				Er is nog geen Nevobo URL ingesteld voor <span class="font-medium">{team?.name}</span>.
				Stel deze in bij <a href="{base}/config" class="text-primary-600 underline">Instellingen</a>.
			</p>
		{:else}
			<div>
				<span class="label">Nevobo URL van {team?.name}</span>
				<a
					href={nevoboUrl}
					target="_blank"
					rel="noopener noreferrer"
					class="block text-sm text-primary-600 underline break-all"
				>
					{nevoboUrl} ↗
				</a>
			</div>

			{#if !teamRef}
				<p class="text-sm text-amber-700 dark:text-amber-400">
					Deze URL heeft niet de verwachte vorm
					<code class="text-xs">.../competitie/vereniging/&lbrace;code&rbrace;/&lbrace;type&rbrace;/&lbrace;nummer&rbrace;</code>.
					Pas hem aan bij <a href="{base}/config" class="underline">Instellingen</a>.
				</p>
			{/if}

			<div class="flex flex-wrap gap-2">
				<button class="btn-primary" on:click={fetchMatches} disabled={loading || !teamRef}>
					{loading ? 'Ophalen...' : '🔄 Wedstrijdschema ophalen'}
				</button>
				<a href="{base}/config" class="btn-secondary">URL wijzigen</a>
			</div>
		{/if}
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
