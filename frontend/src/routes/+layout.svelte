<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { getClubs, getTeams, getSeasons, getClubAccessForUser, grantClubAccess } from '$lib/pocketbase';
	import { pb } from '$lib/pocketbase';
	import {
		selectedClubId,
		selectedTeamId,
		selectedSeasonId,
		clubs as clubsStore,
		teams as teamsStore,
		seasons as seasonsStore,
		teamsInClub,
	} from '$lib/stores/context';
	import { authUser, isAuthenticated, isPlatformAdmin, AUTH_ENABLED } from '$lib/stores/auth';
	import {
		permission,
		canEdit,
		isAdmin,
		currentRole,
		availableRoles,
		needsRoleChoice,
		isPlayer,
		loadUserRoles,
		clearUserRoles,
		userClubAccess,
		defaultTeamId,
		APP_ROLE_LABELS,
		APP_ROLE_ICONS,
		PERMISSION_LABELS,
	} from '$lib/stores/role';
	import RoleSelectDialog from '$lib/components/RoleSelectDialog.svelte';
	import { ClipboardList, User, Users } from 'lucide-svelte';
	import type { Club, Team, Season } from '$lib/types';
	import { version } from '../../package.json';

	let darkMode = true;
	let showContextPicker = false;
	let menuOpen = false;
	let roleSwitcherOpen = false;
	let localClubs: Club[] = [];
	let localTeams: Team[] = [];
	let localSeasons: Season[] = [];
	let authReady = false;

	onMount(async () => {
		const saved = localStorage.getItem('darkMode');
		darkMode = saved !== null ? saved === 'true' : true;
		applyTheme();

		// Mark auth as ready - pb.authStore is already loaded from localStorage at this point
		authReady = true;

		const isPublicPath = $page.url.pathname === '/login' || $page.url.pathname === '/auth-debug' || $page.url.pathname.startsWith('/invite');
		if (AUTH_ENABLED && !pb.authStore.isValid && !isPublicPath) {
			goto(`${base}/login`);
			return;
		}

		try {
			const allTeams = await getTeams();
			const allClubs = await getClubs();
			localSeasons = await getSeasons();

			let access: import('$lib/pocketbase').ClubAccess[] = [];

			// If auth is enabled, filter clubs & teams by user access
			if (AUTH_ENABLED && pb.authStore.isValid) {
				const model = (pb.authStore as any).record || (pb.authStore as any).model;
				if (model) {
					const userId = model.id;
					access = await getClubAccessForUser(userId);

					if (access.length === 0 && allClubs.length > 0) {
						// First user: auto-grant admin on every existing club
						for (const club of allClubs) {
							await grantClubAccess({ user: userId, club: club.id, role: 'admin' });
						}
						access = await getClubAccessForUser(userId);
					}

					// Filter to accessible clubs/teams only
					const accessibleClubIds = new Set(access.map(a => a.club));
					localClubs = allClubs.filter(c => accessibleClubIds.has(c.id));
					localTeams = allTeams.filter(t => !t.club || accessibleClubIds.has(t.club));
				} else {
					localClubs = allClubs;
					localTeams = allTeams;
				}
			} else {
				localClubs = allClubs;
				localTeams = allTeams;
			}

			clubsStore.set(localClubs);
			teamsStore.set(localTeams);
			seasonsStore.set(localSeasons);

			// Keep the club selection valid, but never override a club the user picked.
			// Prefer a club with an explicit default_team when picking the initial one.
			if (!localClubs.some((c) => c.id === $selectedClubId)) {
				const withDefault = access.find(a => a.default_team);
				$selectedClubId = withDefault?.club || localTeams.find((t) => t.club)?.club || localClubs[0]?.id || '';
			}

			const selectableTeams = teamsInClub(localTeams, $selectedClubId);
			if (!selectableTeams.some((t) => t.id === $selectedTeamId)) {
				const clubAccessForSelected = access.find(a => a.club === $selectedClubId);
				const preferredTeam = clubAccessForSelected?.default_team;
				$selectedTeamId = (preferredTeam && selectableTeams.some((t) => t.id === preferredTeam))
					? preferredTeam
					: (selectableTeams[0]?.id || '');
			}
			if (!$selectedSeasonId && localSeasons.length > 0) {
				$selectedSeasonId = localSeasons[0].id;
			}

			// Load user roles after clubs/teams are ready
			if (AUTH_ENABLED && pb.authStore.isValid) {
				await loadUserRoles();
			}
		} catch (e) {
			console.error('Failed to load teams/seasons:', e);
		}
	});

	$: if (browser && authReady && AUTH_ENABLED && !$isAuthenticated && $page.url.pathname !== '/login' && $page.url.pathname !== '/auth-debug' && !$page.url.pathname.startsWith('/invite')) {
		goto(`${base}/login`);
	}

	// Close menu on navigation
	$: if ($page.url.pathname) {
		menuOpen = false;
	}

	function handleLogout() {
		clearUserRoles();
		authUser.logout();
		goto(`${base}/login`);
	}

	function toggleDarkMode() {
		darkMode = !darkMode;
		localStorage.setItem('darkMode', String(darkMode));
		applyTheme();
	}

	function applyTheme() {
		if (browser) {
			document.documentElement.classList.toggle('dark', darkMode);
		}
	}

	$: visibleTeams = teamsInClub(localTeams, $selectedClubId);

	function handleClubChange() {
		// visibleTeams is still the previous club's list at this point
		const teamsForClub = teamsInClub(localTeams, $selectedClubId);
		const clubAccessForSelected = $userClubAccess.find(a => a.club === $selectedClubId);
		const preferredTeam = clubAccessForSelected?.default_team;
		$selectedTeamId = (preferredTeam && teamsForClub.some((t) => t.id === preferredTeam))
			? preferredTeam
			: (teamsForClub[0]?.id || '');
	}

	$: currentClubName = localClubs.find((c) => c.id === $selectedClubId)?.name || 'Club';
	$: currentTeamName = localTeams.find((t) => t.id === $selectedTeamId)?.name || 'Team';
	$: currentSeasonName = localSeasons.find((s) => s.id === $selectedSeasonId)?.name || 'Seizoen';

	// Navigation is driven by two things: the permission decides whether an
	// item is allowed at all, the active role decides which set of items is
	// relevant. A playing admin therefore sees the full coach navigation in
	// the coach role and the stripped player navigation in the player role.
	const coachNavItems = [
		{ href: '/', label: 'Dashboard', permissions: ['admin', 'user', 'viewer'] },
		{ href: '/players', label: 'Team', permissions: ['admin', 'user', 'viewer'] },
		{ href: '/trainings', label: 'Trainingen', permissions: ['admin', 'user', 'viewer'] },
		{ href: '/matches', label: 'Wedstrijden', permissions: ['admin', 'user', 'viewer'] },
		{ href: '/periodisering', label: 'Periodisering', permissions: ['admin', 'user', 'viewer'] },
		{ href: '/reports', label: 'Rapporten', permissions: ['admin', 'user', 'viewer'] },
		{ href: '/config', label: 'Configuratie', permissions: ['admin'] },
	];

	$: playerNavItems = [
		{ href: '/', label: '🏐 Mijn dashboard' },
		{ href: '/inbox', label: '📬 Inbox' },
		{ href: '/profile', label: '👤 Mijn profiel' },
	];

	$: navItems = [
		...($currentRole === 'player'
			? playerNavItems
			: $currentRole === 'parent'
				? [{ href: '/', label: '👨‍👩‍👦 Mijn dashboard' }]
				: [
						...coachNavItems.filter(
							(item) => !$permission || item.permissions.includes($permission)
						),
						// A coach who also plays keeps a shortcut to their own player view
						// without having to switch roles.
						...($isPlayer ? [{ href: '/me', label: '🏐 Mijn training' }] : []),
						...($isPlayer ? [{ href: '/inbox', label: '📬 Inbox' }] : []),
					]),
		...($isPlatformAdmin ? [{ href: '/platform-admin', label: 'Clubs beheren' }] : []),
	];

	// Players and parents get a stripped-down header: no app navigation or
	// context picker, just their own landing page. They keep a way to switch
	// role when they hold more than one.
	$: isStrippedView = $currentRole === 'player' || $currentRole === 'parent';
</script>

<svelte:head>
	<script>
		if (localStorage.getItem('darkMode') !== 'false') {
			document.documentElement.classList.add('dark');
		}
	</script>
</svelte:head>

<div class="min-h-screen">
	{#if !$isAuthenticated && $page.url.pathname !== '/login'}
		<div class="flex justify-center items-center min-h-screen">
			<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
		</div>
	{:else if $page.url.pathname === '/login'}
		<main class="px-4 py-6 max-w-lg md:max-w-xl mx-auto">
			<slot />
		</main>
	{:else}
	<!-- Header -->
	<header class="sticky top-0 z-50 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
		<div class="flex items-center justify-between px-5 py-3 max-w-2xl md:max-w-4xl lg:max-w-5xl mx-auto">
			<!-- Left: Logo + Title -->
			<a href="{base}/" class="flex items-center gap-3">
				<img src="/logo.svg" alt="SetBaas" class="h-12 w-12" />
				<div class="leading-tight">
					<span class="text-xl font-bold text-gray-900 dark:text-white tracking-tight">SetBaas</span>
					{#if !isStrippedView}
						<span class="block text-sm font-medium text-gray-600 dark:text-gray-300">{currentClubName} · {currentTeamName}</span>
						<span class="block text-[11px] text-gray-500 dark:text-gray-400">{currentSeasonName}</span>
					{/if}
				</div>
			</a>

			<!-- Right: Actions -->
			<div class="flex items-center gap-2">
				<button
					on:click={toggleDarkMode}
					class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-500 dark:text-gray-400"
					aria-label="Toggle dark mode"
				>
					<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						{#if darkMode}
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
						{:else}
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
						{/if}
					</svg>
				</button>

				{#if isStrippedView}
					<!-- Simplified actions for players/parents: no hamburger or app-nav -->
					{#if $availableRoles.length > 1}
						<button
							on:click={() => (roleSwitcherOpen = true)}
							class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-700 dark:text-gray-300"
							aria-label="Wissel van rol"
							title="Wissel van rol"
						>
							<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4M16 17H4m0 0l4 4m-4-4l4-4" />
							</svg>
						</button>
					{/if}
					{#if $currentRole === 'player'}
						<a href="{base}/inbox"
							class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-700 dark:text-gray-300"
							aria-label="Inbox"
						>
							<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
							</svg>
						</a>
						<a href="{base}/profile"
							class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-700 dark:text-gray-300"
							aria-label="Mijn profiel"
						>
							<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
							</svg>
						</a>
					{/if}
					{#if AUTH_ENABLED}
						<button
							on:click={handleLogout}
							class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-700 dark:text-gray-300"
							aria-label="Uitloggen"
						>
							<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
							</svg>
						</button>
					{/if}
				{:else}
				<!-- Hamburger -->
				<button
					on:click={() => (menuOpen = !menuOpen)}
					class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-700 dark:text-gray-300"
					aria-label="Menu"
				>
					<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						{#if menuOpen}
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
						{:else}
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
						{/if}
					</svg>
				</button>
				{/if}
			</div>
		</div>
	</header>

	<!-- Slide-down menu -->
	{#if menuOpen}
		<!-- Backdrop -->
		<div class="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" on:click={() => (menuOpen = false)} on:keydown={() => {}}></div>

		<!-- Menu panel -->
		<nav class="fixed top-0 right-0 z-50 w-72 h-full bg-white dark:bg-gray-900 shadow-2xl border-l border-gray-200 dark:border-gray-800 overflow-y-auto flex flex-col">
			<div class="p-6 flex-1">
				<!-- Close button -->
				<div class="flex justify-between items-center mb-6">
					<div class="flex items-center gap-2">
						<img src="/logo.svg" alt="SetBaas" class="h-8 w-8" />
						<span class="text-lg font-bold text-gray-900 dark:text-white tracking-tight">SetBaas</span>
					</div>
					<button on:click={() => (menuOpen = false)} class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500">
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>

				<!-- Nav links -->
				<div class="space-y-1 mb-8">
					{#each navItems as item}
						<a
							href={item.href}
							class="block px-4 py-3 rounded-xl text-base font-medium transition-colors
								{$page.url.pathname === item.href || ($page.url.pathname.startsWith(item.href) && item.href !== '/')
									? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-400'
									: 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'}"
						>
							{item.label}
						</a>
					{/each}
				</div>

				<!-- Context picker -->
				<div class="border-t border-gray-200 dark:border-gray-700 pt-6 space-y-4">
					<p class="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Context</p>
					<div>
						<label class="text-sm font-medium text-gray-600 dark:text-gray-400 block mb-1.5">Club</label>
						<select class="input" bind:value={$selectedClubId} on:change={handleClubChange}>
							{#each localClubs as club}
								<option value={club.id}>{club.name}</option>
							{/each}
						</select>
					</div>
					<div>
						<label class="text-sm font-medium text-gray-600 dark:text-gray-400 block mb-1.5">Team</label>
						<select class="input" bind:value={$selectedTeamId} disabled={visibleTeams.length === 0}>
							{#each visibleTeams as team}
								<option value={team.id}>{team.name}</option>
							{/each}
						</select>
						{#if visibleTeams.length === 0}
							<p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
								{currentClubName} heeft nog geen teams
							</p>
						{/if}
					</div>
					<div>
						<label class="text-sm font-medium text-gray-600 dark:text-gray-400 block mb-1.5">Seizoen</label>
						<select class="input" bind:value={$selectedSeasonId}>
							{#each localSeasons as season}
								<option value={season.id}>{season.name}</option>
							{/each}
						</select>
					</div>
				</div>

				<!-- Logout -->
				{#if AUTH_ENABLED}
					<div class="border-t border-gray-200 dark:border-gray-700 pt-6 mt-6">
						{#if $authUser}
							<div class="flex items-center gap-3 mb-4">
								<div class="w-9 h-9 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-primary-700 dark:text-primary-400 font-bold text-sm">
									{($authUser.name || $authUser.email || '?').charAt(0).toUpperCase()}
								</div>
								<div class="min-w-0 flex-1">
									<span class="text-sm font-medium text-gray-800 dark:text-gray-200 block truncate">{$authUser.name || '—'}</span>
									<span class="text-xs text-gray-400 dark:text-gray-500 block truncate">{$authUser.email}</span>
								{#if $permission}
									<span class="inline-block mt-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full
										{$permission === 'admin' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' :
										 $permission === 'user' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' :
										 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'}"
									>{PERMISSION_LABELS[$permission]}</span>
								{/if}
								</div>
							</div>
						{/if}
						{#if $currentRole}
							<div class="mb-4">
								<p class="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5">Rol</p>
								<div class="flex items-center justify-between gap-2">
									<span class="flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-gray-200">
										<span class="w-6 h-6 rounded-lg bg-primary-100 dark:bg-primary-900/40 text-primary-600 dark:text-primary-400 flex items-center justify-center shrink-0">
											{#if $currentRole === 'coach'}
												<ClipboardList class="w-3.5 h-3.5" />
											{:else if $currentRole === 'player'}
												<User class="w-3.5 h-3.5" />
											{:else if $currentRole === 'parent'}
												<Users class="w-3.5 h-3.5" />
											{/if}
										</span>
										<span>{APP_ROLE_LABELS[$currentRole]}</span>
									</span>
									{#if $availableRoles.length > 1}
										<button
											class="text-sm font-medium text-primary-600 hover:text-primary-800 dark:hover:text-primary-400"
											on:click={() => { menuOpen = false; roleSwitcherOpen = true; }}
										>
											Wisselen
										</button>
									{/if}
								</div>
							</div>
						{/if}
						<button on:click={handleLogout} class="w-full btn-secondary">
							Uitloggen
						</button>
					</div>
				{/if}
			</div>

			<!-- Version footer -->
			<div class="p-6 pt-0">
				<div class="border-t border-gray-200 dark:border-gray-700 pt-4 text-center">
					<span class="text-xs text-gray-400 dark:text-gray-600">SetBaas v{version}</span>
				</div>
			</div>
		</nav>
	{/if}

	<!-- Main content -->
	<main class="px-5 py-6 max-w-2xl md:max-w-4xl lg:max-w-5xl mx-auto">
		<slot />
	</main>

	<!-- Role selection: mandatory right after login when someone holds more
	     than one role, and available on demand as a switcher afterwards. -->
	{#if $needsRoleChoice}
		<RoleSelectDialog />
	{:else if roleSwitcherOpen}
		<RoleSelectDialog dismissible on:close={() => (roleSwitcherOpen = false)} />
	{/if}
	{/if}
</div>
