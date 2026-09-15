<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import {
		getCompetencies,
		createCompetency,
		updateCompetency,
		deleteCompetency,
		getClubs,
		createClub,
		updateClub,
		deleteClub,
		getTeams,
		getSeasons,
		createTeam,
		updateTeam,
		deleteTeam,
		createSeason,
		getClubAccessForClub,
		grantClubAccess,
		revokeClubAccess,
		updateClubAccess,
		findUserByEmail,
		createUserAsAdmin,
		createTraining,
		createTrainingAttendance,
		getContextPlayers,
		pb,
	} from '$lib/pocketbase';
	import type { ClubAccess } from '$lib/pocketbase';
	import { clubs as clubsStore, teams as teamsStore, seasons as seasonsStore, selectedClubId, selectedTeamId, selectedSeasonId, currentClub } from '$lib/stores/context';
	import { userClubAccess, isAdmin } from '$lib/stores/role';
	import { isPlatformAdmin } from '$lib/stores/auth';
	import type { Club, Competency, CompetencyCategory, Team, Season } from '$lib/types';
	import { CATEGORY_LABELS } from '$lib/types';
	import { MapPin, Plus, Trash2 } from 'lucide-svelte';

	import { AI_MODELS, DEFAULT_SYSTEM_PROMPT } from '$lib/stores/ai';
	import { loadClubAISettings, saveClubAISettings } from '$lib/ai/client';
	import { version } from '../../../package.json';

	// Tab state
	let activeTab: 'competencies' | 'teams' | 'templates' | 'access' | 'ai' | 'schedule' | 'system' = 'competencies';

	// === Training Schedule Generator ===
	let scheduleDays: number[] = []; // 0=zo, 1=ma, ..., 6=za
	let scheduleTime = '17:30';
	let scheduleLocation = '';
	let scheduleStart = '';
	let scheduleEnd = '';
	let scheduleGenerating = false;
	let scheduleResult = '';
	let scheduleTrainerPerDay: Record<number, string> = {}; // dayOfWeek → userId

	const DAY_LABELS = ['Zo', 'Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za'];

	$: trainerMembers = accessList.filter(a => a.is_trainer);

	async function handleToggleRole(access: any, field: 'is_trainer' | 'is_player' | 'is_parent', value: boolean) {
		try {
			await updateClubAccess(access.id, { [field]: value });
		} catch (e) { alert('Fout: ' + e); await loadAccess(); }
	}

	function toggleScheduleDay(day: number) {
		if (scheduleDays.includes(day)) {
			scheduleDays = scheduleDays.filter(d => d !== day);
		} else {
			scheduleDays = [...scheduleDays, day].sort();
		}
	}

	$: schedulePreviewCount = (() => {
		if (!scheduleStart || !scheduleEnd || scheduleDays.length === 0) return 0;
		let count = 0;
		const start = new Date(scheduleStart);
		const end = new Date(scheduleEnd);
		for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
			if (scheduleDays.includes(d.getDay())) count++;
		}
		return count;
	})();

	async function generateSchedule() {
		if (!scheduleStart || !scheduleEnd || scheduleDays.length === 0 || !$selectedTeamId || !$selectedSeasonId) return;
		if (!confirm(`${schedulePreviewCount} trainingen aanmaken?`)) return;

		scheduleGenerating = true;
		scheduleResult = '';
		try {
			// Get current roster of active players for default attendance
			const teamPlayers = await getContextPlayers($selectedTeamId, $selectedSeasonId, { activeOnly: true });

			const start = new Date(scheduleStart);
			const end = new Date(scheduleEnd);
			let created = 0;

			for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
				if (!scheduleDays.includes(d.getDay())) continue;
				const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${scheduleTime}:00`;
				const trainerId = scheduleTrainerPerDay[d.getDay()] || undefined;
				const training = await createTraining({
					date: dateStr,
					team: $selectedTeamId,
					season: $selectedSeasonId,
					status: 'open',
					content: '',
					location: scheduleLocation.trim() || undefined,
					...(trainerId ? { trainer: [trainerId] } : {}),
				});

				// Auto-create attendance (present) for all players on the roster
				if (teamPlayers.length > 0) {
					await Promise.all(
						teamPlayers.map(p =>
							createTrainingAttendance({
								training: training.id,
								player: p.id,
								status: 'present',
							}).catch(() => null)
						)
					);
				}

				created++;
			}
			scheduleResult = `✅ ${created} trainingen aangemaakt met standaard aanwezigheid voor ${teamPlayers.length} speler(s)!`;
		} catch (e) {
			scheduleResult = `❌ Fout: ${e}`;
		} finally {
			scheduleGenerating = false;
		}
	}

	// === Bulk delete non-completed trainings ===
	let bulkDeleting = false;
	let bulkDeleteResult = '';

	async function bulkDeletePlannedTrainings() {
		const filter = [`status != "closed"`];
		if ($selectedTeamId) filter.push(`team = "${$selectedTeamId}"`);
		if ($selectedSeasonId) filter.push(`season = "${$selectedSeasonId}"`);

		const planned = await pb.collection('trainings').getFullList({ filter: filter.join(' && '), fields: 'id' });
		if (planned.length === 0) {
			bulkDeleteResult = '⚠️ Geen geplande/actieve trainingen gevonden.';
			return;
		}
		if (!confirm(`⚠️ ${planned.length} niet-afgeronde trainingen verwijderen? Dit kan niet ongedaan worden!`)) return;

		bulkDeleting = true;
		bulkDeleteResult = '';
		try {
			// Delete attendance records first
			for (const t of planned) {
				const att = await pb.collection('training_attendance').getFullList({ filter: `training = "${t.id}"`, fields: 'id' });
				await Promise.all(att.map(a => pb.collection('training_attendance').delete(a.id)));
			}
			await Promise.all(planned.map(t => pb.collection('trainings').delete(t.id)));
			bulkDeleteResult = `✅ ${planned.length} trainingen verwijderd.`;
		} catch (e) {
			bulkDeleteResult = `❌ Fout: ${e}`;
		} finally {
			bulkDeleting = false;
		}
	}

	// === AI Config (per club, sleutel blijft server-side) ===
	let aiProvider: 'openai' | 'gemini' = 'openai';
	let aiApiKey = '';
	let aiModel = '';
	let aiSystemPrompt = '';
	let aiHasKey = false;
	let aiLoading = false;
	let aiSaving = false;
	let aiError = '';
	let aiSaved = false;
	let aiLoadedClub = '';

	async function loadAIConfig(club: string) {
		aiLoading = true;
		aiError = '';
		try {
			const settings = await loadClubAISettings(club);
			aiProvider = settings.provider;
			aiModel = settings.model;
			aiSystemPrompt = settings.systemPrompt;
			aiHasKey = settings.hasKey;
			aiApiKey = '';
			aiLoadedClub = club;
		} catch (e) {
			aiError = e instanceof Error ? e.message : String(e);
		} finally {
			aiLoading = false;
		}
	}

	$: if (activeTab === 'ai' && $selectedClubId && $selectedClubId !== aiLoadedClub && !aiLoading) {
		loadAIConfig($selectedClubId);
	}

	async function saveAIConfig() {
		if (!$selectedClubId) return;
		aiSaving = true;
		aiError = '';
		aiSaved = false;
		try {
			await saveClubAISettings($selectedClubId, {
				provider: aiProvider,
				model: aiModel,
				systemPrompt: aiSystemPrompt,
				// Alleen meesturen als de gebruiker iets heeft ingevuld; leeg laten
				// betekent "houd de bestaande sleutel".
				...(aiApiKey ? { apiKey: aiApiKey } : {})
			});
			if (aiApiKey) {
				aiHasKey = true;
				aiApiKey = '';
			}
			aiSaved = true;
			setTimeout(() => (aiSaved = false), 2500);
		} catch (e) {
			aiError = e instanceof Error ? e.message : String(e);
		} finally {
			aiSaving = false;
		}
	}

	async function clearAIKey() {
		if (!$selectedClubId) return;
		if (!confirm('API key verwijderen? AI-functies zijn daarna uitgeschakeld voor deze club.')) return;
		aiSaving = true;
		try {
			await saveClubAISettings($selectedClubId, {
				provider: aiProvider,
				model: aiModel,
				systemPrompt: aiSystemPrompt,
				apiKey: ''
			});
			aiHasKey = false;
			aiApiKey = '';
		} catch (e) {
			aiError = e instanceof Error ? e.message : String(e);
		} finally {
			aiSaving = false;
		}
	}

	// === Competencies ===
	let competencies: Competency[] = [];
	let loadingComp = true;
	let showCompForm = false;
	let editingComp: Competency | null = null;

	let compName = '';
	let compCategory: CompetencyCategory = 'technical';
	let savingComp = false;

	const allCategories = Object.entries(CATEGORY_LABELS) as [CompetencyCategory, string][];

	onMount(async () => {
		await Promise.all([loadCompetencies(), loadTeamsSeasons()]);
	});

	// Keep the access list in sync whenever the selected club changes,
	// regardless of which tab is active.
	$: if ($selectedClubId) loadAccess();

	async function loadCompetencies() {
		loadingComp = true;
		try {
			competencies = await getCompetencies();
		} catch (e) {
			console.error('Failed to load competencies:', e);
		} finally {
			loadingComp = false;
		}
	}

	function startEditComp(comp: Competency) {
		editingComp = comp;
		compName = comp.name;
		compCategory = comp.category;
		showCompForm = true;
	}

	function resetCompForm() {
		editingComp = null;
		compName = '';
		compCategory = 'technical';
		showCompForm = false;
	}

	async function handleCompSubmit() {
		if (!compName.trim()) return;
		savingComp = true;
		try {
			if (editingComp) {
				await updateCompetency(editingComp.id, { name: compName.trim(), category: compCategory });
			} else {
				await createCompetency({ name: compName.trim(), category: compCategory });
			}
			resetCompForm();
			await loadCompetencies();
		} catch (e) {
			console.error('Failed to save competency:', e);
			alert('Fout bij opslaan competentie');
		} finally {
			savingComp = false;
		}
	}

	async function handleDeleteComp(comp: Competency) {
		if (!confirm(`"${comp.name}" verwijderen? Gekoppelde scores worden ook verwijderd.`)) return;
		try {
			await deleteCompetency(comp.id);
			await loadCompetencies();
		} catch (e) {
			console.error('Failed to delete competency:', e);
			alert('Fout bij verwijderen (mogelijk zijn er nog scores aan gekoppeld)');
		}
	}

	// === Clubs, Teams & Seasons ===
	let clubs: Club[] = [];
	let teams: Team[] = [];
	let seasons: Season[] = [];
	let loadingTeams = true;

	// A club_access "admin" role is required to manage a club's teams/members
	// here — being admin of one club must not grant management rights over
	// every other club, even though the global $permission flag treats "admin
	// anywhere" as admin (used only for showing/hiding nav items).
	$: myAdminClubIds = new Set($userClubAccess.filter((a) => a.role === 'admin').map((a) => a.club));
	$: manageableClubs = clubs.filter((c) => myAdminClubIds.has(c.id));

	let newClubName = '';
	let savingClub = false;
	let newTeamNameByClub: Record<string, string> = {};
	let savingTeam = false;
	let newStartYear = new Date().getFullYear();
	let newEndYear = new Date().getFullYear() + 1;
	let savingSeason = false;

	async function loadTeamsSeasons() {
		loadingTeams = true;
		try {
			[clubs, teams, seasons] = await Promise.all([getClubs(), getTeams(), getSeasons()]);
			clubsStore.set(clubs);
			teamsStore.set(teams);
			seasonsStore.set(seasons);
		} catch (e) {
			console.error('Failed to load teams/seasons:', e);
		} finally {
			loadingTeams = false;
		}
	}

	let newLocationByClub: Record<string, string> = {};
	let savingLocationByClub: Record<string, boolean> = {};

	async function handleAddLocation(club: Club) {
		const locName = (newLocationByClub[club.id] || '').trim();
		if (!locName) return;
		const existing = Array.isArray(club.locations) ? [...club.locations] : [];
		if (existing.includes(locName)) {
			alert('Deze locatie bestaat al voor deze club');
			return;
		}
		const next = [...existing, locName];
		savingLocationByClub = { ...savingLocationByClub, [club.id]: true };
		try {
			await updateClub(club.id, { locations: next });
			newLocationByClub = { ...newLocationByClub, [club.id]: '' };
			await loadTeamsSeasons();
		} catch (e) {
			console.error('Failed to add location:', e);
			alert('Fout bij toevoegen locatie');
		} finally {
			savingLocationByClub = { ...savingLocationByClub, [club.id]: false };
		}
	}

	async function handleRemoveLocation(club: Club, locIndex: number) {
		const existing = Array.isArray(club.locations) ? [...club.locations] : [];
		const next = existing.filter((_, i) => i !== locIndex);
		try {
			await updateClub(club.id, { locations: next });
			await loadTeamsSeasons();
		} catch (e) {
			console.error('Failed to remove location:', e);
			alert('Fout bij verwijderen locatie');
		}
	}

	async function handleAddClub() {
		if (!newClubName.trim()) return;
		savingClub = true;
		try {
			await createClub({ name: newClubName.trim() });
			newClubName = '';
			await loadTeamsSeasons();
		} catch (e) {
			console.error('Failed to create club:', e);
			alert('Fout bij aanmaken club');
		} finally {
			savingClub = false;
		}
	}

	async function handleRenameClub(club: Club, newName: string) {
		if (!newName.trim() || newName.trim() === club.name) return;
		try {
			await updateClub(club.id, { name: newName.trim() });
			await loadTeamsSeasons();
		} catch (e) {
			console.error('Failed to rename club:', e);
			alert('Fout bij hernoemen club');
		}
	}

	async function handleDeleteClub(club: Club) {
		const clubTeamCount = teams.filter((t) => t.club === club.id).length;
		if (clubTeamCount > 0) {
			alert(`Verwijder eerst alle ${clubTeamCount} team(s) onder "${club.name}" voordat je de club verwijdert.`);
			return;
		}
		if (!confirm(`Club "${club.name}" verwijderen? Alle gekoppelde toegangsrechten worden ook verwijderd.`)) return;
		try {
			await deleteClub(club.id);
			await loadTeamsSeasons();
		} catch (e) {
			console.error('Failed to delete club:', e);
			alert('Fout bij verwijderen club');
		}
	}

	async function handleRenameTeam(team: Team, newName: string) {
		if (!newName.trim() || newName.trim() === team.name) return;
		try {
			await updateTeam(team.id, { name: newName.trim() });
			await loadTeamsSeasons();
		} catch (e) {
			console.error('Failed to rename team:', e);
			alert('Fout bij hernoemen team');
		}
	}

	async function handleDeleteTeam(team: Team) {
		if (!confirm(`Team "${team.name}" verwijderen? Trainingen, wedstrijden en spelerskoppelingen van dit team blijven bestaan maar verliezen hun teamkoppeling. Dit kan niet ongedaan worden.`)) return;
		try {
			await deleteTeam(team.id);
			await loadTeamsSeasons();
		} catch (e) {
			console.error('Failed to delete team:', e);
			alert('Fout bij verwijderen team');
		}
	}

	async function saveTeamClub(team: Team, clubId: string) {
		try {
			await updateTeam(team.id, { club: clubId || undefined });
			await loadTeamsSeasons();
		} catch (e) {
			console.error('Failed to save team club:', e);
			alert('Fout bij koppelen club');
		}
	}

	async function handleAddTeam(clubId: string) {
		const name = (newTeamNameByClub[clubId] || '').trim();
		if (!name) return;
		savingTeam = true;
		try {
			await createTeam(name, clubId || undefined);
			newTeamNameByClub = { ...newTeamNameByClub, [clubId]: '' };
			await loadTeamsSeasons();
		} catch (e) {
			console.error('Failed to create team:', e);
			alert('Fout bij aanmaken team');
		} finally {
			savingTeam = false;
		}
	}

	async function saveTeamNevoboUrl(team: Team, url: string) {
		try {
			await pb.collection('teams').update(team.id, { nevobo_url: url });
		} catch (e) {
			console.error('Failed to save nevobo_url:', e);
			alert('Fout bij opslaan URL');
		}
	}

	// Teams kunnen een eigen AI-prompt hebben die de clubprompt overschrijft.
	let openTeamPrompt: string | null = null;
	let teamPromptSaved: string | null = null;

	async function saveTeamPrompt(team: Team, prompt: string) {
		if ((team.ai_system_prompt || '') === prompt) return;
		try {
			await pb.collection('teams').update(team.id, { ai_system_prompt: prompt });
			team.ai_system_prompt = prompt;
			teamPromptSaved = team.id;
			setTimeout(() => (teamPromptSaved = null), 2000);
		} catch (e) {
			console.error('Failed to save ai_system_prompt:', e);
			alert('Fout bij opslaan AI-prompt');
		}
	}

	async function handleAddSeason() {
		savingSeason = true;
		try {
			await createSeason({
				name: `${newStartYear}-${newEndYear}`,
				start_year: newStartYear,
				end_year: newEndYear,
			});
			await loadTeamsSeasons();
		} catch (e) {
			console.error('Failed to create season:', e);
			alert('Fout bij aanmaken seizoen');
		} finally {
			savingSeason = false;
		}
	}

	// === Club Access ===
	let accessList: ClubAccess[] = [];
	let loadingAccess = false;
	let addMemberName = '';
	let addMemberEmail = '';
	let addMemberRole = 'user';
	let addMemberError = '';
	let addMemberSuccess = '';
	let addingMember = false;

	$: clubTeams = teams.filter((t) => t.club === $selectedClubId);

	async function handleAddMember() {
		if (!addMemberName.trim() || !addMemberEmail.trim() || !$selectedClubId) return;
		addMemberError = '';
		addMemberSuccess = '';
		addingMember = true;
		try {
			let user = await findUserByEmail(addMemberEmail.trim());
			if (user) {
				const existing = accessList.find(a => a.user === user!.id);
				if (existing) {
					addMemberError = 'Deze gebruiker heeft al toegang tot deze club.';
					return;
				}
			} else {
				user = await createUserAsAdmin({ name: addMemberName.trim(), email: addMemberEmail.trim() });
			}
			await grantClubAccess({ user: user.id, club: $selectedClubId, role: addMemberRole });
			const isGmail = addMemberEmail.trim().toLowerCase().endsWith('@gmail.com');
			addMemberSuccess = isGmail
				? `✅ ${addMemberName} toegevoegd — kan inloggen met Google`
				: `✅ ${addMemberName} toegevoegd als lid`;
			addMemberName = '';
			addMemberEmail = '';
			await loadAccess();
		} catch (e: any) {
			addMemberError = e?.message || 'Fout bij toevoegen lid';
		} finally {
			addingMember = false;
		}
	}

	let inviteEmail = '';
	let inviteRole = 'user';
	let inviteError = '';
	let inviting = false;

	const ROLE_LABELS: Record<string, string> = {
		admin: 'Admin',
		user: 'Gebruiker',
		viewer: 'Lezer',
	};

	async function loadAccess() {
		if (!$selectedClubId) return;
		loadingAccess = true;
		try {
			accessList = await getClubAccessForClub($selectedClubId);
		} catch (e) {
			console.error('Failed to load access:', e);
		} finally {
			loadingAccess = false;
		}
	}

	let inviteSuccess = '';
	let inviteLink = '';

	async function handleInvite() {
		if (!inviteEmail.trim() || !$selectedClubId) return;
		inviteError = '';
		inviteSuccess = '';
		inviteLink = '';
		inviting = true;
		try {
			// First check if user already exists and has access
			const user = await findUserByEmail(inviteEmail.trim());
			if (user) {
				const existing = accessList.find(a => a.user === user.id);
				if (existing) {
					inviteError = 'Deze gebruiker heeft al toegang tot deze club.';
					return;
				}
				// User exists, grant directly
				await grantClubAccess({ user: user.id, club: $selectedClubId, role: inviteRole });
				inviteEmail = '';
				inviteSuccess = 'Toegang direct verleend (gebruiker bestaat al).';
				await loadAccess();
				return;
			}

			// User doesn't exist — send invitation email
			const clubObj = clubs.find(c => c.id === $selectedClubId);
			const res = await fetch(`${base}/api/invite`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					email: inviteEmail.trim(),
					club: $selectedClubId,
					clubName: clubObj?.name || 'Club',
					role: inviteRole,
					invitedBy: pb.authStore.record?.id,
					siteUrl: window.location.origin
				})
			});
			const data = await res.json();
			if (!res.ok) {
				inviteError = data.error || 'Fout bij uitnodigen';
			} else if (data.emailSent) {
				inviteSuccess = `✉️ Uitnodiging verstuurd naar ${inviteEmail}`;
				inviteEmail = '';
			} else {
				inviteSuccess = data.message || 'Uitnodiging aangemaakt';
				inviteLink = data.inviteLink || '';
				inviteEmail = '';
			}
		} catch (e: any) {
			inviteError = e?.message || 'Fout bij uitnodigen';
		} finally {
			inviting = false;
		}
	}

	async function handleRoleChange(access: ClubAccess, newRole: string) {
		try {
			await updateClubAccess(access.id, { role: newRole });
			await loadAccess();
		} catch (e) {
			alert('Fout bij wijzigen rol');
		}
	}

	async function handleDefaultTeamChange(access: ClubAccess, teamId: string) {
		try {
			await updateClubAccess(access.id, { default_team: teamId || undefined });
			await loadAccess();
		} catch (e) {
			alert('Fout bij wijzigen standaard team');
		}
	}

	async function handleRevoke(access: ClubAccess) {
		const name = access.expand?.user?.name || access.expand?.user?.email || '?';
		if (!confirm(`Toegang voor ${name} intrekken?`)) return;
		try {
			await revokeClubAccess(access.id);
			await loadAccess();
		} catch (e) {
			alert('Fout bij intrekken toegang');
		}
	}

	async function handleNameChange(access: ClubAccess, newName: string) {
		if (!access.user || !newName.trim()) return;
		try {
			await pb.collection('users').update(access.user, { name: newName.trim() });
			await loadAccess();
		} catch (e) {
			alert('Fout bij wijzigen naam');
		}
	}
</script>

<svelte:head>
	<title>Configuratie - SetBaas</title>
</svelte:head>

<div class="space-y-4">
	<h2 class="text-xl font-bold text-gray-800 dark:text-gray-200">Configuratie</h2>

	<!-- Tab bar -->
	<div class="flex overflow-x-auto border-b border-gray-200 dark:border-gray-700">
		<button
			class="px-4 py-3 text-sm font-semibold whitespace-nowrap transition-colors {
				activeTab === 'competencies'
					? 'text-primary-600 border-b-2 border-primary-600'
					: 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
			}"
			on:click={() => (activeTab = 'competencies')}>
			Competenties
		</button>
		<button
			class="px-4 py-3 text-sm font-semibold whitespace-nowrap transition-colors {
				activeTab === 'teams'
					? 'text-primary-600 border-b-2 border-primary-600'
					: 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
			}"
			on:click={() => (activeTab = 'teams')}>
			Clubs & Teams
		</button>
		<button
			class="px-4 py-3 text-sm font-semibold whitespace-nowrap transition-colors {
				activeTab === 'templates'
					? 'text-primary-600 border-b-2 border-primary-600'
					: 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
			}"
			on:click={() => (activeTab = 'templates')}>
			Templates
		</button>
		<button
			class="px-4 py-3 text-sm font-semibold whitespace-nowrap transition-colors {
				activeTab === 'access'
					? 'text-primary-600 border-b-2 border-primary-600'
					: 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
			}"
			on:click={() => { activeTab = 'access'; loadAccess(); }}>
			Toegang
		</button>
		<button
			class="pb-2 text-sm font-medium transition-colors {
				activeTab === 'ai'
					? 'text-primary-600 border-b-2 border-primary-600'
					: 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
			}"
			on:click={() => { activeTab = 'ai'; }}>
			AI
		</button>
		<button
			class="px-3 py-2 text-sm font-medium whitespace-nowrap {
				activeTab === 'schedule'
					? 'text-primary-600 border-b-2 border-primary-600'
					: 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
			}"
			on:click={() => { activeTab = 'schedule'; loadAccess(); }}>
			Schema
		</button>
		<button
			class="px-3 py-2 text-sm font-medium whitespace-nowrap {
				activeTab === 'system'
					? 'text-primary-600 border-b-2 border-primary-600'
					: 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
			}"
			on:click={() => { activeTab = 'system'; }}>
			Systeem
		</button>
	</div>

	<!-- Competencies Tab -->
	{#if activeTab === 'competencies'}
		<div class="space-y-3">
			<div class="flex justify-between items-center">
				<p class="text-sm text-gray-500 dark:text-gray-400">Beheer competenties voor spelerbeoordeling</p>
				<button class="btn-primary text-sm" on:click={() => { resetCompForm(); showCompForm = !showCompForm; }}>
					{showCompForm ? '✕ Sluiten' : '+ Competentie'}
				</button>
			</div>

			<!-- Add/Edit form -->
			{#if showCompForm}
				<form class="card space-y-3" on:submit|preventDefault={handleCompSubmit}>
					<h3 class="font-semibold text-sm text-gray-700 dark:text-gray-300">
						{editingComp ? 'Competentie bewerken' : 'Nieuwe competentie'}
					</h3>
					<div>
						<label class="label" for="comp-name">Naam *</label>
						<input id="comp-name" class="input" type="text" bind:value={compName} required placeholder="bijv. Bovenhands, Blok, Opslag..." />
					</div>
					<div>
						<label class="label" for="comp-cat">Categorie</label>
						<select id="comp-cat" class="input" bind:value={compCategory}>
							{#each allCategories as [value, label]}
								<option {value}>{label}</option>
							{/each}
						</select>
					</div>
					<div class="flex gap-2">
						<button type="submit" class="btn-primary flex-1" disabled={savingComp}>
							{savingComp ? 'Opslaan...' : editingComp ? '✓ Bijwerken' : '✓ Toevoegen'}
						</button>
						{#if editingComp}
							<button type="button" class="btn-secondary" on:click={resetCompForm}>Annuleren</button>
						{/if}
					</div>
				</form>
			{/if}

			<!-- Competency list -->
			{#if loadingComp}
				<div class="flex justify-center py-8">
					<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
				</div>
			{:else if competencies.length === 0}
				<div class="card text-center py-8 text-gray-500 dark:text-gray-400">
					
					<p>Nog geen competenties toegevoegd</p>
				</div>
			{:else}
				{#each allCategories as [catKey, catLabel]}
					{@const catComps = competencies.filter(c => c.category === catKey)}
					{#if catComps.length > 0}
						<div class="card">
							<h3 class="text-xs font-bold uppercase text-gray-400 dark:text-gray-500 mb-2">{catLabel}</h3>
							<div class="space-y-1.5">
								{#each catComps as comp}
									<div class="flex items-center justify-between py-1.5 border-b border-gray-50 dark:border-gray-700 last:border-0">
										<span class="text-sm font-medium text-gray-700 dark:text-gray-300">{comp.name}</span>
										<div class="flex items-center gap-1">
											<button
												class="px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 hover:text-primary-600 transition-colors text-xs font-medium"
												on:click={() => startEditComp(comp)}>
												Bewerken
											</button>
											<button
												class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-red-500 transition-colors text-xs"
												on:click={() => handleDeleteComp(comp)}
												title="Verwijderen">
												🗑️
											</button>
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				{/each}
			{/if}
		</div>

	<!-- Teams & Seasons Tab -->
	{:else if activeTab === 'teams'}
		<div class="space-y-4">
			<!-- New club form -->
			<form class="card flex gap-2" on:submit|preventDefault={handleAddClub}>
				<input class="input flex-1" type="text" bind:value={newClubName} placeholder="Nieuwe club..." />
				<button type="submit" class="btn-primary text-sm" disabled={savingClub}>+ Club</button>
			</form>

			{#if manageableClubs.length === 0}
				<div class="card text-center py-8 text-gray-500 dark:text-gray-400 space-y-2">
					<p>Je bent nog geen admin van een club, dus er zijn geen teams om te beheren.</p>
					{#if $isPlatformAdmin}
						<a href="{base}/platform-admin" class="text-primary-600 hover:underline text-sm">Ga naar Clubs beheren</a>
					{/if}
				</div>
			{/if}

			<!-- Clubs with nested teams (only clubs you administer) -->
			{#each manageableClubs as club (club.id)}
				<div class="card space-y-3">
					<div class="flex items-center gap-2">
						<input
							class="text-lg font-semibold text-gray-800 dark:text-gray-200 bg-transparent border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-primary-500 focus:outline-none flex-1"
							value={club.name}
							on:blur={(e) => handleRenameClub(club, e.currentTarget.value)}
							on:keydown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
						/>
						<button class="text-xs text-red-500 hover:underline whitespace-nowrap" on:click={() => handleDeleteClub(club)}>
							Verwijder club
						</button>
					</div>

					<!-- Club standard locations -->
					<div class="p-3 bg-gray-50 dark:bg-gray-800/60 rounded-lg space-y-2 border border-gray-100 dark:border-gray-700">
						<div class="flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-gray-300">
							<MapPin class="w-3.5 h-3.5 text-primary-500" />
							<span>Standaard trainingszalen / sporthallen ({club.locations?.length || 0})</span>
						</div>
						{#if club.locations && club.locations.length > 0}
							<div class="flex flex-wrap gap-1.5 pt-1">
								{#each club.locations as loc, idx}
									<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-600 shadow-sm">
										<MapPin class="w-3 h-3 text-primary-500" />
										<span>{loc}</span>
										<button
											type="button"
											class="text-gray-400 hover:text-red-500 ml-0.5"
											title="Verwijder zaal"
											on:click={() => handleRemoveLocation(club, idx)}
										>
											×
										</button>
									</span>
								{/each}
							</div>
						{:else}
							<p class="text-xs text-gray-400 italic">Nog geen standaard trainingszalen ingesteld voor deze club.</p>
						{/if}
						<form class="flex gap-2 pt-1" on:submit|preventDefault={() => handleAddLocation(club)}>
							<input
								class="input flex-1 text-xs"
								type="text"
								value={newLocationByClub[club.id] || ''}
								on:input={(e) => (newLocationByClub = { ...newLocationByClub, [club.id]: e.currentTarget.value })}
								placeholder="Nieuwe sporthal/zaal (bijv. Sporthal De Veur - Zaal 1)..."
							/>
							<button type="submit" class="btn-secondary text-xs px-2.5 py-1" disabled={savingLocationByClub[club.id]}>
								+ Zaal
							</button>
						</form>
					</div>

					{#each teams.filter((t) => t.club === club.id) as team (team.id)}
						<div class="p-3 border border-gray-100 dark:border-gray-700 rounded-lg space-y-2 ml-2">
							<div class="flex items-center gap-2">
								<input
									class="text-sm font-medium text-gray-800 dark:text-gray-200 bg-transparent border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-primary-500 focus:outline-none flex-1"
									value={team.name}
									on:blur={(e) => handleRenameTeam(team, e.currentTarget.value)}
									on:keydown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
								/>
								<button class="text-xs text-red-500 hover:underline whitespace-nowrap" on:click={() => handleDeleteTeam(team)}>
									Verwijder
								</button>
							</div>
							<div class="flex gap-2 items-center">
								<input
									class="input text-xs flex-1"
									type="url"
									placeholder="Nevobo URL (bijv. https://www.volleybal.nl/competitie/...)"
									value={team.nevobo_url || ''}
									on:blur={(e) => saveTeamNevoboUrl(team, e.currentTarget.value)}
								/>
								{#if team.nevobo_url}
									<a href={team.nevobo_url} target="_blank" class="text-blue-400 text-xs hover:underline">↗</a>
								{/if}
							</div>
							<div>
								<button
									type="button"
									class="text-xs text-primary-500 hover:underline"
									on:click={() => (openTeamPrompt = openTeamPrompt === team.id ? null : team.id)}
								>
									{openTeamPrompt === team.id ? '▾' : '▸'} AI-prompt voor dit team
									{#if team.ai_system_prompt}<span class="text-gray-400">(aangepast)</span>{/if}
								</button>
								{#if openTeamPrompt === team.id}
									<textarea
										class="input text-xs font-mono mt-2"
										rows="6"
										value={team.ai_system_prompt || ''}
										placeholder="Leeg = de systeem prompt van de club gebruiken"
										on:blur={(e) => saveTeamPrompt(team, e.currentTarget.value)}
									></textarea>
									<p class="text-xs text-gray-400 mt-1">
										Overschrijft de clubprompt bij het genereren van trainingen voor dit team.
										{#if teamPromptSaved === team.id}<span class="text-green-500">Opgeslagen</span>{/if}
									</p>
								{/if}
							</div>
						</div>
					{/each}

					<form class="flex gap-2 ml-2" on:submit|preventDefault={() => handleAddTeam(club.id)}>
						<input
							class="input flex-1 text-sm"
							type="text"
							value={newTeamNameByClub[club.id] || ''}
							on:input={(e) => (newTeamNameByClub = { ...newTeamNameByClub, [club.id]: e.currentTarget.value })}
							placeholder="Nieuw team in {club.name}..."
						/>
						<button type="submit" class="btn-primary text-sm" disabled={savingTeam}>+ Team</button>
					</form>
				</div>
			{/each}

			<!-- Teams without a club (legacy / unassigned) -->
			{#if teams.some((t) => !t.club)}
				<div class="card space-y-3">
					<h3 class="font-semibold text-gray-800 dark:text-gray-200">Teams zonder club</h3>
					{#each teams.filter((t) => !t.club) as team (team.id)}
						<div class="p-3 border border-gray-100 dark:border-gray-700 rounded-lg space-y-2">
							<span class="text-sm font-medium">{team.name}</span>
							<div class="flex gap-2 items-center">
								<label class="text-xs text-gray-500 dark:text-gray-400 w-10" for="club-{team.id}">Club</label>
								<select
									id="club-{team.id}"
									class="input text-xs flex-1"
									value={team.club || ''}
									on:change={(e) => saveTeamClub(team, e.currentTarget.value)}
								>
									<option value="">— geen club —</option>
									{#each manageableClubs as club}
										<option value={club.id}>{club.name}</option>
									{/each}
								</select>
								<button class="text-xs text-red-500 hover:underline whitespace-nowrap" on:click={() => handleDeleteTeam(team)}>
									Verwijder
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}

			<!-- Seasons -->
			<div class="card space-y-3">
				<h3 class="font-semibold text-gray-800 dark:text-gray-200">Seizoenen</h3>
				{#if seasons.length > 0}
					<div class="space-y-1">
						{#each seasons as season}
							<div class="flex items-center gap-2 py-1.5 border-b border-gray-50 dark:border-gray-700 last:border-0">
								<span class="text-sm font-medium flex-1">{season.name}</span>
							</div>
						{/each}
					</div>
				{/if}
				<form class="flex gap-2 items-end" on:submit|preventDefault={handleAddSeason}>
					<div class="flex-1">
						<label class="label text-xs">Van</label>
						<input class="input" type="number" bind:value={newStartYear} min="2020" max="2040" />
					</div>
					<div class="flex-1">
						<label class="label text-xs">Tot</label>
						<input class="input" type="number" bind:value={newEndYear} min="2020" max="2040" />
					</div>
					<button type="submit" class="btn-primary text-sm" disabled={savingSeason}>+</button>
				</form>
			</div>
		</div>

	<!-- Templates Tab -->
	{:else if activeTab === 'templates'}
		<div class="space-y-3">
			<div class="flex justify-between items-center">
				<p class="text-sm text-gray-500 dark:text-gray-400">Herbruikbare trainingstemplates voor snelle planning</p>
				<a href="{base}/config/templates" class="btn-primary text-sm">Beheren</a>
			</div>
		</div>

	<!-- Access Tab -->
	{:else if activeTab === 'access'}
		<div class="space-y-4">
			<div class="card space-y-2">
				<label class="label text-xs" for="access-club-select">Club</label>
				<select id="access-club-select" class="input" bind:value={$selectedClubId}>
					{#each manageableClubs as club}
						<option value={club.id}>{club.name}</option>
					{/each}
				</select>
			</div>
			{#if manageableClubs.length === 0}
				<p class="card text-sm text-gray-500 dark:text-gray-400">
					Je bent nog geen admin van een club, dus je kunt hier nog geen toegang beheren.
					{#if $isPlatformAdmin}
						Ga naar <a href="{base}/platform-admin" class="underline">Clubs beheren</a> om jezelf als admin toe te wijzen aan een club.
					{/if}
				</p>
			{:else}
			<p class="text-sm text-gray-500 dark:text-gray-400">
				Beheer wie toegang heeft tot <strong>{manageableClubs.find(c => c.id === $selectedClubId)?.name || 'de geselecteerde club'}</strong> (en daarmee tot alle teams eronder).
			</p>

			<!-- Add member form -->
			<form class="card space-y-3" on:submit|preventDefault={handleAddMember}>
				<h3 class="font-semibold text-gray-800 dark:text-gray-200">➕ Lid toevoegen</h3>
				<div class="flex flex-col sm:flex-row gap-2">
					<input
						class="input flex-1"
						type="text"
						bind:value={addMemberName}
						placeholder="Naam..."
						required
					/>
					<input
						class="input flex-1"
						type="email"
						bind:value={addMemberEmail}
						placeholder="E-mailadres..."
						required
					/>
					<select class="input w-28" bind:value={addMemberRole}>
						<option value="admin">Admin</option>
						<option value="user">Gebruiker</option>
						<option value="viewer">Lezer</option>
					</select>
					<button type="submit" class="btn-primary text-sm whitespace-nowrap" disabled={addingMember}>
						{addingMember ? '...' : 'Toevoegen'}
					</button>
				</div>
				<p class="text-xs text-gray-400 dark:text-gray-500">Gmail-adressen kunnen inloggen met Google OAuth. Overige accounts worden aangemaakt met een random wachtwoord.</p>
				{#if addMemberError}
					<p class="text-sm text-red-500 dark:text-red-400">{addMemberError}</p>
				{/if}
				{#if addMemberSuccess}
					<p class="text-sm text-green-600 dark:text-green-400">{addMemberSuccess}</p>
				{/if}
			</form>

			<!-- Invite form -->
			<form class="card space-y-3" on:submit|preventDefault={handleInvite}>
				<h3 class="font-semibold text-gray-800 dark:text-gray-200">✉️ Uitnodigen</h3>
				<div class="flex gap-2">
					<input
						class="input flex-1"
						type="email"
						bind:value={inviteEmail}
						placeholder="E-mailadres..."
						required
					/>
					<select class="input w-28" bind:value={inviteRole}>
						<option value="admin">Admin</option>
						<option value="user">Gebruiker</option>
						<option value="viewer">Lezer</option>
					</select>
					<button type="submit" class="btn-primary text-sm" disabled={inviting}>
						{inviting ? '...' : 'Toevoegen'}
					</button>
				</div>
				{#if inviteError}
					<p class="text-sm text-red-500 dark:text-red-400">{inviteError}</p>
				{/if}
				{#if inviteSuccess}
					<p class="text-sm text-green-600 dark:text-green-400">{inviteSuccess}</p>
				{/if}
				{#if inviteLink}
					<div class="p-2 bg-gray-100 dark:bg-gray-800 rounded text-xs break-all">
						<span class="text-gray-500">Link:</span>
						<a href={inviteLink} class="text-primary-600 hover:underline">{inviteLink}</a>
						<button class="ml-2 text-primary-600" on:click={() => navigator.clipboard.writeText(inviteLink)}>📋 Kopieer</button>
					</div>
				{/if}
			</form>

			<!-- Access list -->
			{#if loadingAccess}
				<div class="flex justify-center py-4">
					<div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
				</div>
			{:else if accessList.length === 0}
				<div class="card text-center py-8 text-gray-500 dark:text-gray-400">
					Nog geen gebruikers met toegang
				</div>
			{:else}
				<div class="card">
					<h3 class="font-semibold text-gray-800 dark:text-gray-200 mb-3">Clubleden</h3>
					<div class="space-y-2">
						{#each accessList as access}
							<div class="flex flex-col gap-2 py-3 border-b border-gray-50 dark:border-gray-700 last:border-0">
								<div class="flex items-center gap-3">
									<div class="flex-1 min-w-0">
										<input
											class="text-sm font-medium text-gray-800 dark:text-gray-200 bg-transparent border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-primary-500 focus:outline-none w-full truncate"
											value={access.expand?.user?.name || ''}
											placeholder="Naam..."
											on:blur={(e) => handleNameChange(access, e.currentTarget.value)}
											on:keydown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
										/>
										<span class="text-xs text-gray-400 dark:text-gray-500 block truncate">
											{access.expand?.user?.email || ''}
										</span>
									</div>
									<div class="flex items-center gap-3">
										<label class="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
											<input type="checkbox" class="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
												checked={access.is_trainer}
												on:change={() => { access.is_trainer = !access.is_trainer; handleToggleRole(access, 'is_trainer', access.is_trainer); }} />
											Trainer
										</label>
										<label class="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
											<input type="checkbox" class="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
												checked={access.is_player}
												on:change={() => { access.is_player = !access.is_player; handleToggleRole(access, 'is_player', access.is_player); }} />
											Speler
										</label>
										<label class="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
											<input type="checkbox" class="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
												checked={access.is_parent}
												on:change={() => { access.is_parent = !access.is_parent; handleToggleRole(access, 'is_parent', access.is_parent); }} />
											Ouder
										</label>
									</div>
									<select
										class="input w-24 py-1 text-xs"
										value={access.role}
										on:change={(e) => handleRoleChange(access, e.currentTarget.value)}>
										<option value="admin">Admin</option>
										<option value="user">Gebruiker</option>
										<option value="viewer">Lezer</option>
									</select>
									<button
										class="text-xs text-red-500 hover:underline"
										on:click={() => handleRevoke(access)}>
										Verwijder
									</button>
								</div>
								{#if clubTeams.length > 1}
									<div class="flex items-center gap-2 pl-1">
										<label class="text-xs text-gray-500 dark:text-gray-400" for="default-team-{access.id}">Standaard team</label>
										<select
											id="default-team-{access.id}"
											class="input w-40 py-1 text-xs"
											value={access.default_team || ''}
											on:change={(e) => handleDefaultTeamChange(access, e.currentTarget.value)}>
											<option value="">— eerste beschikbare —</option>
											{#each clubTeams as t}
												<option value={t.id}>{t.name}</option>
											{/each}
										</select>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/if}
			{/if}
		</div>
	{:else if activeTab === 'ai'}
		<div class="space-y-4">
			<div class="card space-y-4">
				<h3 class="font-semibold text-gray-800 dark:text-gray-200">AI Configuratie</h3>
				<p class="text-sm text-gray-500 dark:text-gray-400">
					Koppel een AI-model om automatisch trainingsplannen te genereren. De instellingen gelden voor de
					hele club en de API key wordt veilig op de server bewaard — hij verlaat je browser nooit meer.
				</p>

				{#if !$selectedClubId}
					<div class="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg text-sm text-amber-700 dark:text-amber-300">
						Selecteer eerst een club.
					</div>
				{:else if aiLoading}
					<p class="text-sm text-gray-500 dark:text-gray-400">Laden...</p>
				{:else}
					{#if aiError}
						<div class="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-sm text-red-700 dark:text-red-300">
							{aiError}
						</div>
					{/if}

					<div>
						<label class="label" for="ai-provider">Provider</label>
						<select id="ai-provider" class="input" bind:value={aiProvider} on:change={() => (aiModel = '')}>
							<option value="openai">OpenAI (GPT)</option>
							<option value="gemini">Google Gemini</option>
						</select>
					</div>

					<div>
						<label class="label" for="ai-key">API Key</label>
						<input
							id="ai-key"
							class="input"
							type="password"
							autocomplete="off"
							bind:value={aiApiKey}
							placeholder={aiHasKey ? '•••••••• (opgeslagen — vul in om te vervangen)' : aiProvider === 'openai' ? 'sk-...' : 'AIza...'}
						/>
						<p class="text-xs text-gray-400 mt-1">
							{#if aiProvider === 'openai'}
								Maak een key aan op <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" class="text-primary-500 hover:underline">platform.openai.com</a>
							{:else}
								Maak een key aan op <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" class="text-primary-500 hover:underline">aistudio.google.com</a>
							{/if}
							— de club betaalt zelf voor het gebruik.
						</p>
						{#if aiHasKey}
							<button type="button" class="text-xs text-red-500 mt-1 hover:underline" on:click={clearAIKey}>
								API key verwijderen
							</button>
						{/if}
					</div>

					<div>
						<label class="label" for="ai-model">Model</label>
						<select id="ai-model" class="input" bind:value={aiModel}>
							<option value="">Standaard</option>
							{#each AI_MODELS[aiProvider] as m}
								<option value={m.value}>{m.label}</option>
							{/each}
						</select>
					</div>

					{#if aiHasKey}
						<div class="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg text-sm text-green-700 dark:text-green-300">
							✅ AI is geconfigureerd — je ziet een "Genereer met AI" knop bij het aanmaken van trainingen.
						</div>
					{:else}
						<div class="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm text-gray-600 dark:text-gray-400">
							Nog geen API key ingesteld. AI-functies zijn uitgeschakeld voor deze club.
						</div>
					{/if}

					<div>
						<label class="label" for="ai-prompt">Systeem prompt van de club</label>
						<textarea
							id="ai-prompt"
							class="input text-xs font-mono"
							rows="10"
							bind:value={aiSystemPrompt}
							placeholder={DEFAULT_SYSTEM_PROMPT}
						></textarea>
						<p class="text-xs text-gray-400 mt-1">
							Laat leeg voor de standaardprompt. Een team kan hier bij <strong>Team</strong> een eigen
							prompt overheen zetten.
						</p>
						{#if aiSystemPrompt}
							<button type="button" class="text-xs text-primary-500 mt-1 hover:underline" on:click={() => (aiSystemPrompt = '')}>
								Reset naar standaard
							</button>
						{/if}
					</div>

					<div class="flex items-center gap-3">
						<button type="button" class="btn-primary" on:click={saveAIConfig} disabled={aiSaving}>
							{aiSaving ? 'Opslaan...' : 'Opslaan'}
						</button>
						{#if aiSaved}
							<span class="text-sm text-green-600 dark:text-green-400">✅ Opgeslagen</span>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	{:else if activeTab === 'schedule'}
		<div class="space-y-4">
			<div class="card">
				<h3 class="font-semibold text-gray-800 dark:text-gray-200 mb-1">📅 Trainingsschema Generator</h3>
				<p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
					Maak in één keer trainingen aan voor het hele seizoen op vaste dagen en tijden.
				</p>

				<!-- Days -->
				<div class="mb-4">
					<label class="label">Trainingsdagen</label>
					<div class="flex gap-2 flex-wrap">
						{#each DAY_LABELS as label, i}
							<button
								type="button"
								class="px-4 py-2 rounded-lg text-sm font-medium transition-all
									{scheduleDays.includes(i)
										? 'bg-primary-600 text-white'
										: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'}"
								on:click={() => toggleScheduleDay(i)}
							>
								{label}
							</button>
						{/each}
					</div>
				</div>

				<!-- Time & Location -->
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
					<div>
						<label class="label" for="schedule-time">Starttijd</label>
						<input id="schedule-time" type="time" class="input w-32" bind:value={scheduleTime} />
					</div>
					<div>
						<label class="label" for="schedule-location">Sporthal / locatie</label>
						{#if $currentClub?.locations && $currentClub.locations.length > 0}
							<div class="space-y-1.5">
								<select
									class="input"
									on:change={(e) => {
										if (e.currentTarget.value === '__custom__') {
											scheduleLocation = '';
										} else if (e.currentTarget.value) {
											scheduleLocation = e.currentTarget.value;
										}
									}}
									value={$currentClub.locations.includes(scheduleLocation) ? scheduleLocation : (scheduleLocation ? '__custom__' : '')}
								>
									<option value="">— Kies standaard zaal —</option>
									{#each $currentClub.locations as loc}
										<option value={loc}>{loc}</option>
									{/each}
									<option value="__custom__">✏️ Vrije invoer / andere zaal...</option>
								</select>
								{#if !scheduleLocation || !$currentClub.locations.includes(scheduleLocation)}
									<input
										id="schedule-location"
										type="text"
										class="input"
										placeholder="Bijv. Sporthal De Veur"
										bind:value={scheduleLocation}
									/>
								{/if}
							</div>
						{:else}
							<input id="schedule-location" type="text" class="input" placeholder="Bijv. Sporthal De Veur" bind:value={scheduleLocation} />
						{/if}
					</div>
				</div>

				<!-- Trainer per dag -->
				{#if scheduleDays.length > 0 && trainerMembers.length > 0}
					<div class="mb-4">
						<label class="label">Trainer per dag</label>
						<div class="space-y-2">
							{#each scheduleDays as day}
								<div class="flex items-center gap-3">
									<span class="text-sm font-medium text-gray-700 dark:text-gray-300 w-12">{DAY_LABELS[day]}</span>
									<select class="input flex-1 py-1.5 text-sm" bind:value={scheduleTrainerPerDay[day]}>
										<option value="">— Geen trainer —</option>
										{#each trainerMembers as tm}
											<option value={tm.user}>{tm.expand?.user?.name || tm.expand?.user?.email}</option>
										{/each}
									</select>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Date range -->
				<div class="grid grid-cols-2 gap-3 mb-4">
					<div>
						<label class="label" for="schedule-start">Van</label>
						<input id="schedule-start" type="date" class="input" bind:value={scheduleStart} />
					</div>
					<div>
						<label class="label" for="schedule-end">Tot</label>
						<input id="schedule-end" type="date" class="input" bind:value={scheduleEnd} />
					</div>
				</div>

				<!-- Preview -->
				{#if schedulePreviewCount > 0}
					<div class="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 mb-4">
						<p class="text-sm text-blue-700 dark:text-blue-300">
							<strong>{schedulePreviewCount}</strong> trainingen worden aangemaakt
							op {scheduleDays.map(d => DAY_LABELS[d]).join(' & ')} om {scheduleTime}
						</p>
					</div>
				{/if}

				<!-- Generate -->
				<button
					class="btn-primary w-full"
					disabled={scheduleGenerating || schedulePreviewCount === 0}
					on:click={generateSchedule}
				>
					{scheduleGenerating ? '⏳ Bezig...' : `📅 ${schedulePreviewCount} trainingen aanmaken`}
				</button>

				{#if scheduleResult}
					<p class="mt-3 text-sm {scheduleResult.startsWith('✅') ? 'text-green-600' : 'text-red-500'}">
						{scheduleResult}
					</p>
				{/if}
			</div>

			<!-- Bulk delete -->
			<div class="card border-red-200 dark:border-red-800">
				<h3 class="font-semibold text-red-600 dark:text-red-400 mb-1">🗑️ Geplande trainingen verwijderen</h3>
				<p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
					Verwijder alle niet-afgeronde trainingen (gepland + actief) voor het huidige team/seizoen. Handig om een fout schema te corrigeren.
				</p>
				<button
					class="w-full py-3 rounded-xl text-sm font-bold bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50 transition-colors"
					disabled={bulkDeleting}
					on:click={bulkDeletePlannedTrainings}
				>
					{bulkDeleting ? '⏳ Bezig met verwijderen...' : '🗑️ Alle niet-afgeronde trainingen verwijderen'}
				</button>
				{#if bulkDeleteResult}
					<p class="mt-3 text-sm {bulkDeleteResult.startsWith('✅') ? 'text-green-600' : bulkDeleteResult.startsWith('⚠') ? 'text-yellow-600' : 'text-red-500'}">
						{bulkDeleteResult}
					</p>
				{/if}
			</div>
		</div>
	{:else if activeTab === 'system'}
		<div class="space-y-4">
			<div class="card">
				<h3 class="font-semibold text-gray-800 dark:text-gray-200 mb-1">🧹 Cache & Opslag</h3>
				<p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
					Wis lokale gegevens als de app niet goed werkt na een update. Je wordt uitgelogd.
				</p>

				<div class="space-y-3">
					<button
						class="w-full py-3 rounded-xl text-sm font-bold bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:hover:bg-amber-900/50 transition-colors"
						on:click={() => {
							if (!confirm('LocalStorage wissen? Je wordt uitgelogd.')) return;
							localStorage.clear();
							window.location.href = '/login';
						}}
					>
						🗑️ LocalStorage wissen
					</button>

					<button
						class="w-full py-3 rounded-xl text-sm font-bold bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50 transition-colors"
						on:click={async () => {
							if (!confirm('Alle caches wissen en herladen? Je wordt uitgelogd.')) return;
							localStorage.clear();
							sessionStorage.clear();
							if ('caches' in window) {
								const names = await caches.keys();
								await Promise.all(names.map(n => caches.delete(n)));
							}
							window.location.href = '/login';
						}}
					>
						💣 Alles wissen (cache + storage + reload)
					</button>
				</div>
			</div>

			<div class="card">
				<h3 class="font-semibold text-gray-800 dark:text-gray-200 mb-2">📱 App Info</h3>
				<div class="text-sm text-gray-500 dark:text-gray-400 space-y-1">
					<p><strong>Versie:</strong> {version}</p>
					<p><strong>Browser:</strong> {typeof navigator !== 'undefined' ? navigator.userAgent.split(' ').slice(-2).join(' ') : '—'}</p>
					<p><strong>LocalStorage items:</strong> {typeof localStorage !== 'undefined' ? localStorage.length : 0}</p>
				</div>
			</div>
		</div>
	{/if}
</div>
