<script lang="ts">
	import { base } from '$app/paths';
	import { selectedTeamId } from '$lib/stores/context';
	import TeamDocuments from '$lib/components/TeamDocuments.svelte';
</script>

<svelte:head>
	<title>Documenten - SetBaas</title>
</svelte:head>

<div class="space-y-4">
	<div class="flex gap-2 border-b border-gray-200 dark:border-gray-700">
		<a href="{base}/players" class="px-3 py-2 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">Spelers</a>
		<a href="{base}/players/questionnaires" class="px-3 py-2 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">Vragenlijsten</a>
		<a href="{base}/players/documents" aria-current="page" class="px-3 py-2 text-sm font-medium text-primary-600 border-b-2 border-primary-600">Documenten</a>
	</div>
	<TeamDocuments teamId={$selectedTeamId} manage />
</div>
