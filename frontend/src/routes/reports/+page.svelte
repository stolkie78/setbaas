<script lang="ts">
	const reports = [
		{
			href: '/reports/competencies',
			title: 'Competenties',
			description: 'Gemiddelde scores per competentie of per speler met voortgangsindicatie.',
		},
		{
			href: '/reports/attendance',
			title: 'Trainingsaanwezigheid',
			description: 'Overzicht van aan- en afwezigheid per speler over afgeronde trainingen.',
		},
		{
			href: '/reports/match-attendance',
			title: 'Wedstrijdaanwezigheid',
			description: 'Overzicht van aan- en afwezigheid per speler over gespeelde wedstrijden.',
		},
		{
			href: '/reports/trainer-attendance',
			title: 'Trainers & opkomst per dag',
			description: 'Aantal trainingen, percentages en tijd per trainer, plus opkomst per trainingsdag.',
		},
		{
			href: '/reports/wellness',
			title: 'Welzijn & Fitheid',
			description: 'Happiness en fitheid per speler binnen het geselecteerde team en seizoen.',
		},
		{
			href: '/reports/position-points',
			title: 'Punten per positie',
			description: 'Hoeveel punten elke speler per positie heeft gescoord over alle wedstrijden.',
		},
		{
			href: '/reports/sets',
			title: 'Sets gewonnen & verloren',
			description: 'Overzicht van gewonnen en verloren sets over het seizoen.',
		},
		{
			href: '/reports/load',
			title: 'Belastingsoverzicht',
			description: 'Uren per week per speler uit trainingen, wedstrijden en extra activiteiten naast het eigen team.',
		},
	];
</script>

<svelte:head>
	<title>Rapportages - SetBaas</title>
</svelte:head>

<div class="space-y-4">
	<h2 class="text-xl font-bold text-gray-800 dark:text-gray-200">Rapportages</h2>

	<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
		{#each reports as report}
			<a href={report.href} class="card flex items-center gap-4 hover:shadow-md transition-shadow">
				<div class="flex-1">
					<h3 class="font-semibold text-gray-800 dark:text-gray-200">{report.title}</h3>
					<p class="text-sm text-gray-500 dark:text-gray-400">{report.description}</p>
				</div>
				<svg class="w-5 h-5 text-gray-300 dark:text-gray-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
				</svg>
			</a>
		{/each}
	</div>
</div>
