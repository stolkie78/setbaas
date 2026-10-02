<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { getPlayer, updatePlayer, deletePlayer, getFileUrl, getClubAccessForClub } from '$lib/pocketbase';
	import type { ClubAccess } from '$lib/pocketbase';
	import type { Player, PlayerPosition, ExtraActivity, ExtraActivityType, Team } from '$lib/types';
	import { POSITION_LABELS, STATUS_LABELS, EXTRA_ACTIVITY_LABELS } from '$lib/types';
	import { teams as teamsStore, selectedClubId } from '$lib/stores/context';
	import { isAdmin, rolesLoaded } from '$lib/stores/role';

	let player: Player | null = null;
	let loading = true;
	let saving = false;

	// Form state
	let formName = '';
	let formPositions: PlayerPosition[] = [];
	let formStatus = 'active';
	let formJersey = '';
	let formEmail = '';
	let formPhoto: FileList | null = null;
	let formExtras: ExtraActivity[] = [];
	let parentAccounts: ClubAccess[] = [];
	let selectedParentIds: string[] = [];
	let parentAccountsClubId = '';

	$: clubTeams = ($teamsStore || []).filter((t: Team) => !$selectedClubId || t.club === $selectedClubId);
	const extraTypes = Object.entries(EXTRA_ACTIVITY_LABELS) as [ExtraActivityType, string][];

	$: if (player && $rolesLoaded && $isAdmin && $selectedClubId && parentAccountsClubId !== $selectedClubId) {
		parentAccountsClubId = $selectedClubId;
		loadParentAccounts($selectedClubId);
	}

	async function loadParentAccounts(clubId: string) {
		try {
			const access = await getClubAccessForClub(clubId);
			parentAccounts = access.filter((member) => member.is_parent);
		} catch (error) {
			console.error('Failed to load parent accounts:', error);
		}
	}

	function addExtra() {
		formExtras = [...formExtras, { type: 'training', team: '', team_name: '', hours: undefined, notes: '' }];
	}

	function removeExtra(index: number) {
		formExtras = formExtras.filter((_, i) => i !== index);
	}

	const allPositions = Object.entries(POSITION_LABELS) as [PlayerPosition, string][];

	function togglePosition(pos: PlayerPosition) {
		if (formPositions.includes(pos)) {
			formPositions = formPositions.filter(p => p !== pos);
		} else {
			formPositions = [...formPositions, pos];
		}
	}

	onMount(async () => {
		try {
			const id = $page.params.id;
			if (!id) return;
			player = await getPlayer(id);
			formName = player.name;
			formPositions = player.position || [];
			formStatus = player.status || 'active';
			// 0 betekent "geen rugnummer"; als tekst zou het het min=1-veld ongeldig maken.
			formJersey = player.jersey_number ? String(player.jersey_number) : '';
			formEmail = player.email || '';
			formExtras = Array.isArray(player.extra_activities) ? [...player.extra_activities] : [];
			selectedParentIds = Array.isArray(player.parent_users) ? [...player.parent_users] : [];
		} catch (e) {
			console.error('Failed to load player:', e);
		} finally {
			loading = false;
		}
	});

	async function handleSubmit() {
		if (!formName.trim() || !player) return;
		saving = true;

		try {
			const data = new FormData();
			data.append('name', formName.trim());
			for (const pos of formPositions) {
				data.append('position', pos);
			}
			if (formPositions.length === 0) {
				data.append('position', '');
			}
			data.append('status', formStatus);
			if (formJersey) data.append('jersey_number', formJersey);
			data.append('email', formEmail.trim());
			if (formPhoto && formPhoto[0]) data.append('photo', formPhoto[0]);

			// JSON-veld: leeg maken als er niets is ingevuld, zodat het rapport niets telt.
			const cleanedExtras = formExtras
				.filter((a) => a.team || a.team_name?.trim() || a.hours || a.notes?.trim())
				.map((a) => ({
					type: a.type,
					team: a.team || undefined,
					team_name: a.team_name?.trim() || undefined,
					hours: a.hours ? Number(a.hours) : undefined,
					notes: a.notes?.trim() || undefined
				}));
			data.append('extra_activities', JSON.stringify(cleanedExtras));
			const parentIdsToSave = [...new Set(selectedParentIds)];
			for (const parentId of parentIdsToSave) {
				data.append('parent_users', parentId);
			}
			if (parentIdsToSave.length === 0) {
				data.append('parent_users', '');
			}

			await updatePlayer(player.id, data);
			goto(`${base}/players/${player.id}`);
		} catch (e) {
			console.error('Failed to update player:', e);
			alert('Fout bij bijwerken speler');
		} finally {
			saving = false;
		}
	}

	async function handleDelete() {
		if (!player) return;
		if (!confirm(`Weet je zeker dat je ${player.name} wilt verwijderen?`)) return;
		try {
			await deletePlayer(player.id);
			goto(`${base}/players`);
		} catch (e) {
			console.error('Failed to delete player:', e);
			alert('Fout bij verwijderen (mogelijk zijn er nog gekoppelde gegevens)');
		}
	}
</script>

<svelte:head>
	<title>Bewerk Speler - SetBaas</title>
</svelte:head>

{#if loading}
	<div class="flex justify-center py-12">
		<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
	</div>
{:else if player}
	<form class="space-y-4" on:submit|preventDefault={handleSubmit}>
		<div class="flex justify-between items-center">
			<h2 class="text-xl font-bold text-gray-800 dark:text-gray-200">Bewerk Speler</h2>
			<button type="button" class="text-red-500 hover:text-red-700 text-sm font-semibold" on:click={handleDelete}>
				🗑️ Verwijderen
			</button>
		</div>

		<div class="card space-y-3">
			<!-- Current photo -->
			{#if player.photo}
				<div class="flex items-center gap-3">
					<img src={getFileUrl(player, player.photo)} alt={player.name}
						class="w-16 h-16 rounded-full object-cover" />
					<span class="text-xs text-gray-500 dark:text-gray-400">Huidige foto</span>
				</div>
			{/if}

			<div>
				<label class="label" for="name">Naam *</label>
				<input id="name" class="input" type="text" bind:value={formName} required placeholder="Volledige naam" />
			</div>

			<div>
				<label class="label" for="email">Email (voor login als teamlid)</label>
				<input id="email" class="input" type="email" bind:value={formEmail} placeholder="speler@email.com" />
				{#if player?.user_id}
					<p class="text-xs text-green-600 dark:text-green-400 mt-1">✓ Gekoppeld aan gebruikersaccount</p>
				{/if}
			</div>

			<div class="grid grid-cols-2 gap-3">
				<div>
					<label class="label">Positie(s)</label>
					<div class="space-y-1.5">
						{#each allPositions as [value, label]}
							<label class="flex items-center gap-2 cursor-pointer">
								<input
									type="checkbox"
									checked={formPositions.includes(value)}
									on:change={() => togglePosition(value)}
									class="w-5 h-5 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500 dark:bg-gray-800"
								/>
								<span class="text-sm">{label}</span>
							</label>
						{/each}
					</div>
				</div>
				<div class="space-y-3">
					<div>
						<label class="label" for="jersey">Rugnummer</label>
						<input id="jersey" class="input" type="number" bind:value={formJersey} min="1" max="999" />
					</div>
					<div>
						<label class="label" for="status">Status</label>
						<select id="status" class="input" bind:value={formStatus}>
							{#each Object.entries(STATUS_LABELS) as [value, label]}
								<option {value}>{label}</option>
							{/each}
						</select>
					</div>
				</div>
			</div>

			<div>
				<label class="label" for="photo">Nieuwe foto</label>
				<input id="photo" class="input" type="file" accept="image/*" bind:files={formPhoto} />
			</div>
		</div>

		{#if $isAdmin}
			<div class="card space-y-3">
				<div>
					<h3 class="font-semibold text-gray-800 dark:text-gray-200">Ouderaccounts</h3>
					<p class="text-sm text-gray-500 dark:text-gray-400">
						Deze accounts kunnen de gegevens van deze speler in hun ouderdashboard bekijken.
						Een ouder kan aan meerdere spelers gekoppeld zijn.
					</p>
				</div>
				{#if parentAccounts.length === 0}
					<p class="text-sm text-gray-500 dark:text-gray-400">
						Er zijn nog geen ouderaccounts aan deze club gekoppeld. Voeg eerst een clublid toe en geef het de rol Ouder.
					</p>
				{:else}
					<div class="space-y-2">
						{#each parentAccounts as parent}
							<label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
								<input
									type="checkbox"
									value={parent.user}
									bind:group={selectedParentIds}
									class="rounded border-gray-300 text-primary-600 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800"
								/>
								<span>{parent.expand?.user?.name || parent.expand?.user?.email || 'Ouderaccount'}</span>
								{#if parent.expand?.user?.email}
									<span class="text-xs text-gray-500 dark:text-gray-400">({parent.expand.user.email})</span>
								{/if}
							</label>
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		<div class="card space-y-3">
			<div>
				<h3 class="font-semibold text-gray-800 dark:text-gray-200">Extra belasting</h3>
				<p class="text-xs text-gray-500 dark:text-gray-400">
					Trainingen of wedstrijden naast het eigen team, bijvoorbeeld invallen bij een ander team.
					Deze uren tellen mee in het belastingsoverzicht.
				</p>
			</div>

			{#each formExtras as extra, i}
				<div class="p-3 border border-gray-100 dark:border-gray-700 rounded-lg space-y-2">
					<div class="flex items-center gap-2">
						<select class="input text-sm flex-1" bind:value={extra.type}>
							{#each extraTypes as [value, label]}
								<option {value}>{label}</option>
							{/each}
						</select>
						<input
							class="input text-sm w-28"
							type="number"
							step="0.5"
							min="0"
							max="40"
							placeholder="uren/wk"
							bind:value={extra.hours}
						/>
						<button type="button" class="text-red-500 text-sm hover:underline" on:click={() => removeExtra(i)}>
							Verwijder
						</button>
					</div>
					<div class="grid grid-cols-2 gap-2">
						<select class="input text-sm" bind:value={extra.team}>
							<option value="">— ander/extern team —</option>
							{#each clubTeams as t}
								<option value={t.id}>{t.name}</option>
							{/each}
						</select>
						<input
							class="input text-sm"
							type="text"
							placeholder="Teamnaam (extern)"
							bind:value={extra.team_name}
							disabled={!!extra.team}
						/>
					</div>
					<input class="input text-sm" type="text" placeholder="Toelichting (optioneel)" bind:value={extra.notes} />
				</div>
			{/each}

			<button type="button" class="btn-secondary w-full text-sm" on:click={addExtra}>+ Extra activiteit</button>
		</div>

		<button type="submit" class="btn-primary w-full" disabled={saving}>
			{saving ? 'Opslaan...' : '✓ Wijzigingen opslaan'}
		</button>
		<a href="{base}/players/{player.id}" class="btn-secondary w-full text-center">Annuleren</a>
	</form>
{:else}
	<p class="text-center text-gray-500 py-8">Speler niet gevonden</p>
{/if}
