<script lang="ts">
	import { getTeamDocuments, createTeamDocument, deleteTeamDocument, downloadTeamDocument } from '$lib/pocketbase';
	import { authUser } from '$lib/stores/auth';
	import { canEdit } from '$lib/stores/role';
	import type { TeamDocument } from '$lib/types';
	import { TEAM_DOCUMENT_ACCEPT, TEAM_DOCUMENT_MAX_SIZE } from '$lib/types';

	export let teamId: string;
	export let manage = false;

	let documents: TeamDocument[] = [];
	let loading = false;
	let error = '';
	let loadedTeam = '';
	let request = 0;
	let showForm = false;
	let saving = false;
	let busyId = '';
	let name = '';
	let description = '';
	let files: FileList | null = null;

	$: if (teamId !== loadedTeam) {
		loadedTeam = teamId;
		documents = [];
		error = '';
		showForm = false;
		load(teamId);
	}

	async function load(currentTeam: string) {
		const currentRequest = ++request;
		if (!currentTeam) {
			loading = false;
			return;
		}
		loading = true;
		error = '';
		try {
			const result = await getTeamDocuments(currentTeam);
			if (currentRequest === request) documents = result;
		} catch (e) {
			console.error('Failed to load team documents:', e);
			if (currentRequest === request) error = 'Documenten konden niet worden geladen. Probeer het opnieuw.';
		} finally {
			if (currentRequest === request) loading = false;
		}
	}

	function openForm() {
		name = '';
		description = '';
		files = null;
		error = '';
		showForm = true;
	}

	async function upload() {
		const file = files?.[0];
		if (!file || !name.trim() || !teamId || saving || !$canEdit) return;
		if (file.size > TEAM_DOCUMENT_MAX_SIZE) {
			error = 'Het bestand mag maximaal 20 MB groot zijn.';
			return;
		}
		const extension = '.' + file.name.split('.').pop()?.toLowerCase();
		if (!TEAM_DOCUMENT_ACCEPT.split(',').includes(extension)) {
			error = 'Kies een PDF, Office-document, tekstbestand of afbeelding (JPG, PNG of WebP).';
			return;
		}
		const currentTeam = teamId;
		saving = true;
		error = '';
		try {
			const data = new FormData();
			data.append('team', currentTeam);
			data.append('name', name.trim());
			data.append('description', description.trim());
			data.append('file', file);
			if ($authUser) data.append('created_by', $authUser.id);
			await createTeamDocument(data);
			if (currentTeam === teamId) {
				showForm = false;
				await load(currentTeam);
			}
		} catch (e) {
			console.error('Failed to upload team document:', e);
			if (currentTeam === teamId) error = 'Document uploaden is mislukt. Controleer het bestand en probeer opnieuw.';
		} finally {
			saving = false;
		}
	}

	async function remove(document: TeamDocument) {
		if (busyId || !$canEdit || !confirm(`Document "${document.name}" verwijderen?`)) return;
		busyId = document.id;
		error = '';
		try {
			await deleteTeamDocument(document.id);
			if (document.team === teamId) await load(teamId);
		} catch (e) {
			console.error('Failed to delete team document:', e);
			if (document.team === teamId) error = 'Document verwijderen is mislukt. Probeer het opnieuw.';
		} finally {
			busyId = '';
		}
	}

	async function download(document: TeamDocument) {
		if (busyId) return;
		busyId = document.id;
		error = '';
		try {
			await downloadTeamDocument(document);
		} catch (e) {
			console.error('Failed to download team document:', e);
			if (document.team === teamId) error = 'Document downloaden is mislukt. Probeer het opnieuw.';
		} finally {
			busyId = '';
		}
	}
</script>

<section class="card space-y-3">
	<div class="flex items-center justify-between gap-3">
		<h2 class="text-lg font-bold text-gray-800 dark:text-gray-200">Documenten</h2>
		{#if manage && $canEdit}
			<button class="btn-primary text-sm" disabled={!teamId || saving} on:click={openForm}>+ Document</button>
		{/if}
	</div>
	{#if error}
		<p role="alert" class="text-sm text-red-600 dark:text-red-400">{error}</p>
		<button class="btn-secondary text-sm" on:click={() => load(teamId)}>Opnieuw laden</button>
	{/if}
	{#if showForm && manage && $canEdit}
		<form class="space-y-3" on:submit|preventDefault={upload}>
			<div>
				<label class="label" for="document-name">Naam *</label>
				<input id="document-name" class="input" bind:value={name} required disabled={saving} />
			</div>
			<div>
				<label class="label" for="document-description">Omschrijving</label>
				<textarea id="document-description" class="input" bind:value={description} rows="2" disabled={saving}></textarea>
			</div>
			<div>
				<label class="label" for="document-file">Bestand *</label>
				<input id="document-file" class="input" type="file" accept={TEAM_DOCUMENT_ACCEPT} bind:files required disabled={saving} />
				<p class="text-xs text-gray-500 dark:text-gray-400 mt-1">PDF, Office, tekst of afbeelding. Maximaal 20 MB. Direct beschikbaar voor het team.</p>
			</div>
			<div class="flex gap-2">
				<button class="btn-secondary" type="button" disabled={saving} on:click={() => showForm = false}>Annuleren</button>
				<button class="btn-primary" type="submit" disabled={saving || !name.trim() || !files?.[0]}>{saving ? 'Uploaden...' : 'Uploaden en delen'}</button>
			</div>
		</form>
	{/if}
	{#if loading}
		<p class="text-sm text-gray-500 dark:text-gray-400">Documenten laden...</p>
	{:else if !teamId}
		<p class="text-sm text-gray-500 dark:text-gray-400">Kies eerst een team.</p>
	{:else if !error && documents.length === 0}
		<p class="text-sm text-gray-500 dark:text-gray-400">Nog geen documenten gedeeld met dit team.</p>
	{:else}
		{#each documents as document (document.id)}
			<div class="flex items-center justify-between gap-3 border-t border-gray-200 dark:border-gray-700 pt-3">
				<div class="min-w-0 flex-1">
					<p class="font-semibold text-gray-800 dark:text-gray-200 break-words">{document.name}</p>
					{#if document.description}
						<p class="text-sm text-gray-500 dark:text-gray-400 whitespace-pre-line break-words">{document.description}</p>
					{/if}
				</div>
				<div class="flex flex-wrap justify-end gap-2">
					<button class="btn-secondary text-sm" disabled={!!busyId} on:click={() => download(document)}>Downloaden</button>
					{#if manage && $canEdit}
						<button class="btn-secondary text-sm text-red-600" disabled={!!busyId} on:click={() => remove(document)}>Verwijderen</button>
					{/if}
				</div>
			</div>
		{/each}
	{/if}
</section>
