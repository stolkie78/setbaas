<script lang="ts">
	import { page } from '$app/stores';
	import { base } from '$app/paths';
	import { confirmPasswordReset } from '$lib/pocketbase';

	const MIN_LENGTH = 8;

	let password = '';
	let passwordConfirm = '';
	let loading = false;
	let error = '';
	let done = false;

	async function submit() {
		error = '';
		if (password.length < MIN_LENGTH) {
			error = `Gebruik minimaal ${MIN_LENGTH} tekens.`;
			return;
		}
		if (password !== passwordConfirm) {
			error = 'De wachtwoorden komen niet overeen.';
			return;
		}
		loading = true;
		try {
			await confirmPasswordReset($page.params.token ?? '', password);
			done = true;
		} catch (e: any) {
			console.error('Password reset failed:', e);
			error = 'De link is ongeldig of verlopen. Vraag een nieuwe resetlink aan.';
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>Nieuw wachtwoord - SetBaas</title>
</svelte:head>

<div class="flex flex-col items-center justify-center min-h-[70vh] px-4">
	<div class="card w-full max-w-sm space-y-5 py-8">
		<div class="text-center">
			<img src="/logo.svg" alt="SetBaas" class="h-16 w-16 mx-auto rounded-2xl" />
			<h1 class="text-xl font-bold text-gray-800 dark:text-gray-200 mt-3">Nieuw wachtwoord</h1>
		</div>

		{#if done}
			<div class="bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-sm rounded-xl px-4 py-3">
				Je wachtwoord is gewijzigd. Je kunt nu inloggen.
			</div>
			<a href="{base}/login" class="btn-primary w-full py-3 text-center block">Naar inloggen</a>
		{:else}
			{#if error}
				<div class="bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-sm rounded-xl px-4 py-3">
					{error}
				</div>
			{/if}
			<form class="space-y-3" on:submit|preventDefault={submit}>
				<div>
					<label class="label" for="reset-pass">Nieuw wachtwoord</label>
					<input id="reset-pass" class="input" type="password" bind:value={password} required
						minlength={MIN_LENGTH} autocomplete="new-password" />
				</div>
				<div>
					<label class="label" for="reset-pass2">Herhaal wachtwoord</label>
					<input id="reset-pass2" class="input" type="password" bind:value={passwordConfirm} required
						minlength={MIN_LENGTH} autocomplete="new-password" />
				</div>
				<button type="submit" class="btn-primary w-full py-3" disabled={loading}>
					{loading ? 'Opslaan...' : 'Wachtwoord opslaan'}
				</button>
			</form>
			<p class="text-center">
				<a href="{base}/login" class="text-sm text-primary-600 dark:text-primary-400 hover:underline">Terug naar inloggen</a>
			</p>
		{/if}
	</div>
</div>
