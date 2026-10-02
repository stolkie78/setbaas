<script lang="ts">
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import {
		getQuestionnairesForPlayer,
		submitQuestionnaireResponse,
		getMyMessages,
		markMessageRead,
		deleteMessage,
		refreshUnreadMessageCount,
		setMailOptOut,
		pb,
		type Message,
	} from '$lib/pocketbase';
	import { linkedPlayer, rolesLoaded } from '$lib/stores/role';
	import { selectedTeamId } from '$lib/stores/context';
	import type { Questionnaire, QuestionnaireResponse } from '$lib/types';
	import QuestionnaireAnswerForm from '$lib/components/QuestionnaireAnswerForm.svelte';

	let items: { questionnaire: Questionnaire; response: QuestionnaireResponse | null }[] = [];
	let loading = true;
	let loadedContext = '';
	let openId: string | null = null;
	let saving = false;

	let messages: Message[] = [];
	let messagesLoading = true;
	let openMessageId: string | null = null;

	onMount(loadMessages);

	// Messages are e-mailed too unless the user opted out.
	let mailEnabled = !((pb.authStore as any).model?.mail_opt_out);
	let savingMailPref = false;

	async function toggleMail() {
		const userId = (pb.authStore as any).model?.id;
		if (!userId) return;
		savingMailPref = true;
		const next = !mailEnabled;
		try {
			await setMailOptOut(userId, !next);
			mailEnabled = next;
		} catch (e) {
			console.error('Failed to save mail preference:', e);
			alert('Opslaan mislukt');
		} finally {
			savingMailPref = false;
		}
	}

	async function loadMessages() {
		messagesLoading = true;
		try {
			messages = await getMyMessages();
			await refreshUnreadMessageCount();
		} catch (e) {
			console.error('Failed to load messages:', e);
			messages = [];
		} finally {
			messagesLoading = false;
		}
	}

	async function toggleMessage(message: Message) {
		openMessageId = openMessageId === message.id ? null : message.id;
		if (openMessageId && !message.read) {
			try {
				await markMessageRead(message.id, true);
				messages = messages.map((m) => (m.id === message.id ? { ...m, read: true } : m));
			} catch (e) {
				console.error('Failed to mark message read:', e);
			}
		}
	}

	async function markUnread(message: Message) {
		try {
			await markMessageRead(message.id, false);
			messages = messages.map((m) => (m.id === message.id ? { ...m, read: false } : m));
			openMessageId = null;
		} catch (e) {
			console.error('Failed to mark message unread:', e);
		}
	}

	async function removeMessage(message: Message) {
		if (!confirm('Bericht verwijderen?')) return;
		try {
			await deleteMessage(message.id);
			messages = messages.filter((m) => m.id !== message.id);
		} catch (e) {
			console.error('Failed to delete message:', e);
			alert('Verwijderen mislukt');
		}
	}

	async function markAllRead() {
		const unread = messages.filter((m) => !m.read);
		await Promise.allSettled(unread.map((m) => markMessageRead(m.id, true)));
		messages = messages.map((m) => ({ ...m, read: true }));
	}

	function formatDate(iso: string) {
		return new Date(iso.replace(' ', 'T')).toLocaleString('nl-NL', {
			weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
		});
	}

	// Links are stored as absolute URLs (they are e-mailed too); inside the app
	// navigate relative so it also works behind a different host name.
	function appLink(link: string) {
		try {
			const url = new URL(link, window.location.origin);
			return url.origin === window.location.origin ? url.pathname + url.search : link;
		} catch {
			return link;
		}
	}

	const KIND_ICON: Record<Message['kind'], string> = {
		absence: '🚫',
		attendance_restored: '✅',
		system: 'ℹ️',
	};

	$: unreadMessages = messages.filter((m) => !m.read).length;

	$: playerId = $linkedPlayer?.id;

	// Both the player link and active team are resolved asynchronously by the
	// layout. Refetch when either part of that context becomes available.
	$: context = $rolesLoaded && playerId && $selectedTeamId
		? `${playerId}:${$selectedTeamId}`
		: '';
	$: if (context && context !== loadedContext) {
		loadedContext = context;
		load(playerId, $selectedTeamId);
	}
	$: if ($rolesLoaded && !playerId) loading = false;

	async function load(currentPlayerId = playerId, teamId = $selectedTeamId) {
		if (!currentPlayerId || !teamId) return;
		loading = true;
		try {
			items = await getQuestionnairesForPlayer(teamId, currentPlayerId);
		} catch (e) {
			console.error('Failed to load inbox:', e);
		} finally {
			loading = false;
		}
	}

	async function submit(questionnaireId: string, answers: Record<string, string | number>) {
		if (!playerId) return;
		saving = true;
		try {
			await submitQuestionnaireResponse({ questionnaire: questionnaireId, player: playerId, answers });
			openId = null;
			await load();
		} catch (e) {
			console.error('Failed to submit response:', e);
			alert('Fout bij versturen antwoord');
		} finally {
			saving = false;
		}
	}

	$: pending = items.filter((i) => !i.response && i.questionnaire.status === 'active');
	$: answered = items.filter((i) => i.response);
</script>

<svelte:head>
	<title>Inbox - SetBaas</title>
</svelte:head>

<div class="space-y-6">
	<div class="card py-4 text-center">
		<p class="text-lg font-bold text-gray-800 dark:text-gray-200">📬 Inbox</p>
		<p class="text-sm text-gray-500 dark:text-gray-400">Berichten en vragenlijsten.</p>
	</div>

	<div>
		<div class="flex items-center justify-between mb-3">
			<h2 class="text-lg font-bold text-gray-800 dark:text-gray-200">✉️ Berichten{unreadMessages ? ` (${unreadMessages} nieuw)` : ''}</h2>
			{#if unreadMessages > 1}
				<button class="text-xs text-primary-600 dark:text-primary-400 hover:underline" on:click={markAllRead}>
					Alles gelezen
				</button>
			{/if}
		</div>
		{#if messagesLoading}
			<div class="flex justify-center py-6">
				<div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
			</div>
		{:else if messages.length === 0}
			<p class="text-sm text-gray-400">Geen berichten</p>
		{:else}
			<div class="space-y-2">
				{#each messages as message (message.id)}
					<div class="card !p-0 overflow-hidden {message.read ? '' : 'border-l-4 border-l-primary-500'}">
						<button class="w-full text-left px-4 py-3 flex items-start gap-3" on:click={() => toggleMessage(message)}>
							<span class="text-lg leading-6">{KIND_ICON[message.kind] || '✉️'}</span>
							<span class="flex-1 min-w-0">
								<span class="block truncate {message.read ? 'text-gray-700 dark:text-gray-300' : 'font-semibold text-gray-900 dark:text-white'}">
									{message.subject}
								</span>
								<span class="block text-xs text-gray-500 dark:text-gray-400">{formatDate(message.created)}</span>
							</span>
						</button>
						{#if openMessageId === message.id}
							<div class="px-4 pb-3 space-y-3">
								{#if message.body}
									<p class="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line">{message.body}</p>
								{/if}
								<div class="flex flex-wrap items-center gap-3 text-sm">
									{#if message.link}
										<a class="btn-primary text-xs px-3 py-2" href={appLink(message.link)}>Bekijken</a>
									{/if}
									<button class="text-gray-500 dark:text-gray-400 hover:underline" on:click={() => markUnread(message)}>
										Markeer als ongelezen
									</button>
									<button class="text-red-600 dark:text-red-400 hover:underline" on:click={() => removeMessage(message)}>
										Verwijderen
									</button>
								</div>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
		<label class="flex items-center gap-2 mt-3 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
			<input type="checkbox" checked={mailEnabled} disabled={savingMailPref} on:change={toggleMail} />
			Stuur nieuwe berichten ook naar mijn e-mail
		</label>
	</div>

	{#if loading}
		<div class="flex justify-center py-12">
			<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
		</div>
	{:else if $linkedPlayer}
		<div>
			<h2 class="text-lg font-bold text-gray-800 dark:text-gray-200 mb-3">🆕 Nieuwe vragenlijsten ({pending.length})</h2>
			{#if pending.length === 0}
				<p class="text-sm text-gray-400">Geen nieuwe vragenlijsten</p>
			{:else}
				<div class="space-y-3">
					{#each pending as item (item.questionnaire.id)}
						<div class="card space-y-2">
							<div class="flex justify-between items-center">
								<p class="font-semibold text-gray-800 dark:text-gray-200">{item.questionnaire.name}</p>
								{#if openId !== item.questionnaire.id}
									<button class="btn-primary text-xs px-3 py-2" on:click={() => (openId = item.questionnaire.id)}>
										Beantwoorden
									</button>
								{/if}
							</div>
							{#if openId === item.questionnaire.id}
								<QuestionnaireAnswerForm
									questions={item.questionnaire.questions || []}
									saving={saving}
									on:submit={(e) => submit(item.questionnaire.id, e.detail)}
								/>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<div>
			<h2 class="text-lg font-bold text-gray-800 dark:text-gray-200 mb-3">✅ Beantwoord ({answered.length})</h2>
			{#if answered.length === 0}
				<p class="text-sm text-gray-400">Nog niets beantwoord</p>
			{:else}
				<div class="space-y-3">
					{#each answered as item (item.questionnaire.id)}
						<div class="card space-y-2">
							<p class="font-semibold text-gray-800 dark:text-gray-200">{item.questionnaire.name}</p>
							<QuestionnaireAnswerForm
								questions={item.questionnaire.questions || []}
								answers={item.response?.answers || {}}
								readonly
							/>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>
