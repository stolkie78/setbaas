<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import {
		availableRoles,
		currentRole,
		selectRole,
		APP_ROLE_LABELS,
		APP_ROLE_DESCRIPTIONS,
		type AppRole,
	} from '$lib/stores/role';
	import { authUser } from '$lib/stores/auth';
	import { ClipboardList, User, Users } from 'lucide-svelte';

	// When dismissible, this is a deliberate role switch rather than the
	// mandatory question right after login, so it may be closed unanswered.
	export let dismissible = false;

	const dispatch = createEventDispatcher<{ close: void }>();

	function choose(role: AppRole) {
		selectRole(role);
		dispatch('close');
	}
</script>

<!--
	Shown immediately after login when someone holds more than one role on the
	club. The app stays blocked behind this overlay until a role is picked,
	because the dashboard and navigation differ per role.
-->
<div class="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
	<div class="card w-full max-w-md space-y-4">
		<div class="text-center relative">
			{#if dismissible}
				<button
					class="absolute -top-1 -right-1 p-2 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
					aria-label="Sluiten"
					on:click={() => dispatch('close')}
				>
					<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			{/if}
			<img src="/logo.svg" alt="SetBaas" class="h-14 w-14 mx-auto mb-2" />
			<h2 class="text-xl font-bold text-gray-900 dark:text-gray-100">
				{#if dismissible}
					Wisselen van rol
				{:else}
					Hoi{$authUser?.name ? ` ${$authUser.name}` : ''}! In welke rol ben je nu?
				{/if}
			</h2>
			<p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
				{#if dismissible}
					Kies in welke rol je verder wilt.
				{:else}
					Je kunt later altijd wisselen via het menu.
				{/if}
			</p>
		</div>

		<div class="space-y-2">
			{#each $availableRoles as role}
				<button
					class="w-full text-left rounded-xl border-2 px-4 py-3.5 transition-colors touch-target
						{$currentRole === role
							? 'border-primary-500 bg-primary-50 dark:border-primary-400 dark:bg-primary-900/20'
							: 'border-gray-200 dark:border-gray-700 hover:border-primary-500 dark:hover:border-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20'}"
					on:click={() => choose(role)}
				>
					<span class="flex items-center gap-3">
						<span class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0
							{$currentRole === role
								? 'bg-primary-500 text-white dark:bg-primary-500'
								: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'}">
							{#if role === 'coach'}
								<ClipboardList class="w-5 h-5" />
							{:else if role === 'player'}
								<User class="w-5 h-5" />
							{:else if role === 'parent'}
								<Users class="w-5 h-5" />
							{/if}
						</span>
						<span class="flex-1">
							<span class="block font-semibold text-gray-900 dark:text-gray-100">
								{APP_ROLE_LABELS[role]}
							</span>
							<span class="block text-sm text-gray-500 dark:text-gray-400">
								{APP_ROLE_DESCRIPTIONS[role]}
							</span>
						</span>
						{#if $currentRole === role}
							<span class="text-primary-600 dark:text-primary-400 font-bold">✓</span>
						{/if}
					</span>
				</button>
			{/each}
		</div>
	</div>
</div>
