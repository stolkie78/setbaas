# 🏐 SetBaas — Volleybal Team Management PWA

Een Progressive Web App voor het beheren van je volleybalteam: spelers, trainingen, wedstrijden en competentie-ontwikkeling. Gebouwd voor coaches die hun team professioneel willen managen vanaf telefoon, tablet of laptop.

**Live:** [setbaas.nl](https://setbaas.nl) | **Versie:** 4.3.1

## Tech Stack

| Component | Technologie |
|-----------|-------------|
| **Frontend** | SvelteKit + Tailwind CSS |
| **Backend** | PocketBase (SQLite + Auth + File Storage + REST API) |
| **Reverse Proxy** | Caddy (automatisch HTTPS) |
| **Deployment** | Docker Compose |
| **AI** | OpenAI GPT / Google Gemini (optioneel) |

## Features

### 🏐 Training Lifecycle
- **Training Start Wizard** — 3-stappen flow: Aanwezigheid → Check-in → Start Training
- **Aanwezigheid** — Trainer markeert per speler: ✅ Aanwezig / ❌ Afwezig / 🤒 Ziek / 🤕 Geblesseerd
- **Happiness & Fitness Check-in** — Spelers geven emoji-scores aan (tablet-friendly): 😢→🤩 en 🥱→⚡
- **Actieve training** — LIVE badge op dashboard, bekijk training content, afronden met één klik
- **Training statussen** — Gepland → Actief → Afgerond (volledige lifecycle)
- **Training voorbereiden** — Gerichte dashboardflow met periodisering, templates, AI en Markdown-editor
- **Training afronden** — Checkout met aanwezigheid, trainingsscore, opmerkingen en spelersscores
- **Volledig trainingsoverzicht** — Bekijk metadata, inhoud, aanwezigheid, welzijn en scores in één lightbox
- **Skip check-in** — Snel starten als er geen tijd is, zonder valse data
- **Trainingsschema Generator** — Bulk trainingen aanmaken voor hele seizoen op vaste dagen/tijden
- **Bulk delete** — Alle geplande trainingen verwijderen bij een fout schema
- **AI Training Generator** — Genereer trainingsplannen met GPT of Gemini, context-aware met periodisering en vorige trainingen
- **Templates** — Herbruikbare trainingssjablonen
- **Markdown editor** — Rich text beschrijving met preview, kopjes, lijsten
- **PDF Export** — Training exporteren als PDF vanuit dashboard of detailpagina

### 👤 Spelersbeheer
- **Profiel** — Foto, positie(s), rugnummer (tot 999), status (actief/inactief)
- **Competenties** — 4x per seizoen meetbaar, categorieën: Technisch/Tactisch/Fysiek/Mentaal
- **Email koppeling** — Spelers automatisch gekoppeld aan gebruikersaccount via email
- **Cascade delete** — Verwijderen van speler ruimt alle gerelateerde data op
- **Vragenlijsten** — Coaches maken en versturen named vragenlijsten met open tekst-, meerkeuze- en schaalvragen; antwoorden zijn per speler zichtbaar in het teamoverzicht en spelersprofiel
- **Inbox** — Spelers beantwoorden actieve vragenlijsten vanuit hun eigen Inbox en zien daar ook eerdere antwoorden terug

### 🏆 Wedstrijden
- **Wedstrijdbeheer** — Per-set lineups (positie 1-6), spelsysteem, wissels, timeouts
- **Nevobo Import** — Automatisch wedstrijdschema ophalen van volleybal.nl
- **Set scores** — Setstanden in wedstrijdformulier-volgorde (thuisteam eerst), winst/verlies automatisch vanuit thuis/uit
- **Wedstrijdstatus** — Open → Gespeeld, wedstrijd afronden zodra de uitslag compleet is
- **Dashboardkaarten** — Zelfde opzet als trainingen; grijze knop 'Bijwerken' vooraf, rode knop 'Invullen' vanaf 2 uur na aanvang

### 📊 Rapportages
- **Trainingsaanwezigheid** — Per speler: aanwezig/afwezig/ziek/geblesseerd (alleen afgeronde trainingen)
- **Welzijn & Fitheid** — Happiness en fitness per speler en geselecteerd team/seizoen, met trends, gemiddelden en tijdlijn
- **Competenties** — Gemiddelde scores per competentie of per speler met voortgang
- **Punten per positie** — Gescoorde punten per speler per positie over alle wedstrijden
- **Sets gewonnen & verloren** — Seizoensoverzicht

### 🔐 Gebruikers & Rollen
- **Google OAuth + email/password** login
- **Clubs** — Club → team → seizoen structuur, teams gekoppeld aan een club
- **Multi-team** — Meerdere teams binnen één installatie, teamkeuze gefilterd op club
- **Rollen** — Admin (alles), Coach (team beheer), Speler (eigen dashboard)
- **Trainers** — Trainer profiel met voorkeursdag, automatisch gekoppeld bij planning
- **Speler dashboard** — Beschikbaarheid voor trainingen en wedstrijden
- **Email uitnodigingen** — Nodig teamleden uit via email (SMTP) of deelbare link
- **Seizoenen** — Meerdere seizoenen met periodisering

### 📱 Platform
- **PWA** — Installeerbaar op mobiel als app
- **Responsive** — Geoptimaliseerd voor telefoon, tablet en desktop
- **Dark mode** — Standaard aan
- **24-uurs tijdformat** — Consistent door de hele app
- **Systeem config** — Clear cache/localStorage bij problemen na updates
- **Backup & deploy scripts** — Automatische backup, databasesetup en healthchecks voor elke deployment

---

## Lokale Ontwikkeling

### Vereisten

- Docker & Docker Compose

### Starten

```bash
# Clone
git clone https://github.com/stolkie78/sideline.git
cd sideline

# Configuratie
cp .env.example .env
nano .env
# Minimaal invullen: PB_ADMIN_EMAIL + PB_ADMIN_PASSWORD

# Start (eerste keer)
docker compose up -d --build
docker compose --profile setup run --rm pb-setup

# Daarna:
docker compose up -d
```

De app draait op:
- **Frontend:** http://localhost:3000
- **PocketBase Admin:** http://localhost:8090/_/

---

## Productie Deployment

### Vereisten

- Linux server met Docker + Docker Compose
- Domein met DNS A-record naar je server
- Poort 80 + 443 open

### Deployment

```bash
# 1. Clone op de server
git clone https://github.com/stolkie78/sideline.git setbaas
cd setbaas

# 2. Configureer
cp .env.example .env
nano .env
# Invullen:
#   DOMAIN=setbaas.nl
#   ENABLE_SSL=true
#   SITE_URL=https://setbaas.nl
#   PB_ADMIN_EMAIL=admin@setbaas.nl
#   PB_ADMIN_PASSWORD=<sterk wachtwoord>
#   GOOGLE_CLIENT_ID=<van Google Cloud Console>
#   GOOGLE_CLIENT_SECRET=<van Google Cloud Console>

# 3. Start + setup
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml --profile setup run --rm pb-setup

# 4. Updates deployen
./scripts/deploy.sh
```

### HTTPS & Meerdere Domeinen / Apps

Caddy regelt automatisch Let's Encrypt certificaten:
- Poort 80 + 443 moeten open staan
- DNS A-record moet naar het server IP wijzen
- `www.setbaas.nl` → automatisch redirect naar `setbaas.nl`

#### Extra domeinen / applicaties toevoegen
Plaats een `.caddy` bestand in `caddy/conf.d/` om extra hostnames en applicaties te rerouten via Caddy.

Voorbeeld (`caddy/conf.d/andereapp.caddy`):
```caddy
andereapp.voorbeeld.nl {
    reverse_proxy container_naam:8080
}
```
Na het toevoegen herstart je Caddy met:
```bash
docker compose -f docker-compose.prod.yml restart caddy
```

### Google OAuth

Redirect URIs in [Google Cloud Console](https://console.cloud.google.com/apis/credentials):
```
https://setbaas.nl/api/oauth2-redirect
https://www.setbaas.nl/api/oauth2-redirect
```

---

## Backup & Restore

### Backup maken

```bash
# Op de server:
./scripts/backup.sh

# Of naar specifieke locatie:
./scripts/backup.sh /mnt/backups

# Backup downloaden naar lokale machine:
scp user@server:/path/to/setbaas/backups/setbaas_backup_*.tar.gz ~/backups/
```

Het script:
- Kopieert de PocketBase database + uploads uit de Docker container
- Maakt een gecomprimeerd `.tar.gz` archief met timestamp
- Behoudt de laatste 7 backups, oudere worden automatisch opgeruimd

### Deploy met automatische backup

```bash
./scripts/deploy.sh
# Maakt een backup, haalt code op, bouwt, voert databasesetup uit
# en controleert of frontend en PocketBase bereikbaar zijn
```

### Automatische backup (cron)

```bash
# Op de server:
crontab -e
# Voeg toe (dagelijks om 3:00):
0 3 * * * cd /path/to/setbaas && ./scripts/backup.sh >> /var/log/setbaas-backup.log 2>&1
```

### Restore

```bash
# 1. Stop de containers
docker compose -f docker-compose.prod.yml down

# 2. Pak de backup uit
mkdir -p /tmp/restore
tar -xzf backups/setbaas_backup_YYYYMMDD_HHMMSS.tar.gz -C /tmp/restore

# 3. Kopieer database terug
docker compose -f docker-compose.prod.yml up -d pocketbase
docker compose -f docker-compose.prod.yml cp /tmp/restore/pb_data/. pocketbase:/pb_data/

# 4. Herstart
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d

# 5. Opruimen
rm -rf /tmp/restore
```

---

## Email Uitnodigingen (SMTP)

Om uitnodigingen per email te versturen, configureer SMTP in `.env`:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=jouw@gmail.com
SMTP_PASS=<app-password>
SMTP_FROM=noreply@setbaas.nl
```

> **Tip:** Gebruik een [Google App Password](https://myaccount.google.com/apppasswords) voor Gmail.

Zonder SMTP worden uitnodigingen aangemaakt met een deelbare link die je handmatig kunt kopiëren.

---

## AI Configuratie

1. Ga naar **Configuratie → AI** in de app
2. Kies provider: **OpenAI (GPT)** of **Google Gemini**
3. Vul je API key in
4. Kies een model (optioneel)

| Provider | Model | Omschrijving |
|----------|-------|-------------|
| OpenAI | `gpt-4o-mini` | Snel en goedkoop |
| OpenAI | `gpt-4o` | Beste kwaliteit |
| Gemini | `gemini-3.6-flash` | Snel (standaard) |

De AI gebruikt automatisch:
- **Periodiseringsdoelen** van de huidige periode als context
- **Laatste 3 trainingen** ter referentie (vermijdt herhaling)

---

## Environment Variables

| Variable | Beschrijving | Voorbeeld |
|----------|-------------|-----------|
| `DOMAIN` | Productie domein | `setbaas.nl` |
| `ENABLE_SSL` | HTTPS via Let's Encrypt | `true` / `false` |
| `SITE_URL` | Volledige site URL | `https://setbaas.nl` |
| `HTTP_PORT` | HTTP poort (standaard 80) | `80` |
| `PB_ADMIN_EMAIL` | PocketBase admin email | `admin@setbaas.nl` |
| `PB_ADMIN_PASSWORD` | PocketBase admin wachtwoord | (secret) |
| `OWNER_EMAIL` | Krijgt bij elke setup automatisch admin-rechten op alle teams (optioneel) | `jouw@gmail.com` |
| `SETBAAS_ADMIN_EMAIL` | Built-in platform-beheerder account (optioneel): kan alleen nieuwe clubs aanmaken en de eerste admin per club toewijzen — verder géén toegang tot teamdata | `admin@setbaas.nl` |
| `SETBAAS_ADMIN_PASSWORD` | Wachtwoord voor bovenstaand account | (secret) |
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID | `*.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | Google OAuth Client Secret | (secret) |
| `SMTP_HOST` | SMTP server | `smtp.gmail.com` |
| `SMTP_PORT` | SMTP poort | `587` |
| `SMTP_USER` | SMTP gebruiker | `jouw@gmail.com` |
| `SMTP_PASS` | SMTP wachtwoord | (secret) |
| `SMTP_FROM` | Afzender email | `noreply@setbaas.nl` |

---

## Architectuur

```
┌─────────────────────────────────────────────┐
│  Caddy (reverse proxy, auto HTTPS)          │
│  :80 / :443                                 │
├─────────────────────────────────────────────┤
│  /api/nevobo  → Frontend (:3000)           │
│  /api/ai      → Frontend (:3000)           │
│  /api/invite  → Frontend (:3000)           │
│  /api/*       → PocketBase (:8090)         │
│  /_/*         → PocketBase (:8090)         │
│  /*           → Frontend (:3000)           │
└─────────────────────────────────────────────┘
```

### Datastructuur

```
Club (Zovoc, ZVH)
└── Team (Zovoc MB1)
    └── Seizoen (2026-2027)
        ├── Spelers
        ├── Trainingen
        └── Wedstrijden
```

Clubs worden aangemaakt en gekoppeld via **Config → Clubs & Teams**. Club, team en
seizoen kies je in het menu onder *Context*; de teamlijst is gefilterd op de gekozen club.

`scripts/setup-collections.sh` maakt de `clubs` collectie aan, voegt het `club`-veld toe aan
`teams`, seedt de clubs Zovoc en ZVH en koppelt bestaande teams zonder club aan Zovoc. Het
script is idempotent en verwijdert geen bestaande velden of data, dus je kunt het veilig
opnieuw draaien bij een upgrade.

Spelers hangen via `team_players` aan een team + seizoen. Alle overzichten en
rapportages tonen alleen de selectie van het gekozen team, dus een lege club laat een
lege applicatie zien in plaats van de spelers van een andere club.

Zet `OWNER_EMAIL` in je `.env` om dat account bij elke setup admin-rechten op alle teams
te geven.

Toegang wordt geregeld via `club_access`: elke gebruiker heeft per club een rol
(`admin`/`user`/`viewer`), plus optionele vlaggen (trainer/speler/ouder). Admin op één
club geeft geen rechten op andere clubs — Configuratie scoped dit clientside op
`manageableClubs` (de clubs waar de ingelogde gebruiker zelf `admin` is). Zet
`SETBAAS_ADMIN_EMAIL`/`SETBAAS_ADMIN_PASSWORD` in je `.env` voor een built-in
platform-beheerder-account dat op `/platform-admin` nieuwe clubs kan aanmaken en de
eerste admin per club kan toewijzen — daarna beheert die admin zijn club zelf verder
via Configuratie → Toegang (leden toevoegen/uitnodigen, rollen wijzigen, teams
hernoemen/verwijderen).

Wedstrijden hebben een `status` (`open` of `played`). Bestaande wedstrijden zonder status
krijgen er automatisch een op basis van hun datum: alles in het verleden wordt `played`, de
rest `open`.

---

## Versiegeschiedenis

| Versie | Datum | Beschrijving |
|--------|-------|-------------|
| **v4.3.1** | 2026-09-15 | Backup/restore patch: PocketBase-volumes zijn gecorrigeerd naar **/pb_data**, het filesystem-backupscript detecteert het echte datapad, stopt PocketBase kort voor een consistente kopie en weigert lege backups. De app-backupdownload is betrouwbaarder gemaakt voor browsers en restore-uploads ondersteunen nu grotere backupbestanden via een expliciete 100 MB bodylimiet. |
| **v4.3.0** | 2026-09-15 | Dashboardvernieuwing met **Lucide-iconen**, een paginabrede teamkaart voor club/team/seizoen/spelersaantal en uitgesplitste statistieken voor geplande en afgeronde trainingen en wedstrijden. Trainings- en wedstrijdacties zijn compacter gemaakt met icon-only knoppen. Wedstrijden hebben nu een volledig bewerkformulier én een aparte **Scores**-workflow voor setstanden, punten per speler en opmerkingen. |
| **v4.2.1** | 2026-09-13 | De trainingsduur (in minuten) kan nu worden ingevuld bij het aanmaken en bewerken van een training. |
| **v4.2.0** | 2026-09-11 | Nieuwe **Backup & herstel**-functie voor platformbeheerders: op de platform-adminpagina kun je nu handmatig een volledige backup maken (SQLite + alle geüploade bestanden als zip), bestaande backups downloaden of verwijderen, en een externe zip terugzetten om te herstellen na een crash. Handig om periodiek een externe backup te maken naar bijvoorbeeld je eigen NAS. |
| **v4.1.3** | 2026-09-10 | Kleine dashboard-patch: de live trainingskaart toont nu alleen **Bekijken** en **Afronden**. **Bekijken** is blauw, **Afronden** is rood, en beide knoppen zijn gelijk verdeeld over de kaartbreedte. |
| **v4.1.2** | 2026-09-10 | Kleine dashboard-patch: de knoppen **Bekijken** en **Start** in geplande trainingskaarten zijn nu gelijk verdeeld over de breedte van de kaart, met ruimere tussenruimte. |
| **v4.1.1** | 2026-09-10 | Kleine dashboard-patch: de knop **Bewerken** is verwijderd uit de geplande trainingskaarten. De kaart toont nu alleen nog **Bekijken** en **Start**, zodat de snelle acties rustiger en duidelijker zijn. |
| **v4.1.0** | 2026-09-09 | Het **belastingsoverzicht** rekent nu per kalendermaand in plaats van een gemiddelde over 8 weken: de geplande uren van teamtrainingen en -wedstrijden, min de uren van trainingen/wedstrijden waarbij de speler afwezig was gemeld. Een wedstrijd telt voortaan voor **1,5 uur** (was 2 uur). Het overzicht op het spelersdashboard, de spelerspagina en de rapportage heeft nu een maand-navigatie (‹ ›). Spelers kunnen vanaf hun eigen dashboard zelf een **extra wekelijkse training** toevoegen naast de vaste, door de coach ingestelde belasting — deze telt automatisch mee, los van wat de coach in het spelersprofiel heeft ingevuld. |
| **v4.0.1** | 2026-09-09 | Bij het voorbereiden van een training ziet de AI nu ook de **posities** van de aanwezige speelsters (bijv. "2x Setter, 4x Buitenaanvaller"), naast het aantal aanwezigen — dit wordt meegegeven aan de systeem prompt in plaats van de gebruikersvraag, zodat het los blijft van wat de trainer zelf intypt. Het **Belastingsoverzicht** is ook toegevoegd als rapportage: alle spelers van het team op een rij met hun uren per week, gesorteerd van hoog naar laag. |
| **v4.0.0** | 2026-09-09 | De AI-instellingen zijn verhuisd van de browser naar de club. Provider, model, systeem prompt en de API key worden nu per club op de server bewaard; de key verlaat de server niet meer en is alleen door een clubbeheerder in te stellen, zodat elke club zijn eigen sleutel regelt en betaalt. Een team kan onder **Clubs & Teams** een eigen AI-prompt instellen die de clubprompt overschrijft. Bij het voorbereiden van een training kijkt de AI nu ook naar de **aanwezigheid**, zodat de oefeningen passen bij het werkelijke aantal speelsters. Op het spelersprofiel is een lijst **Extra belasting** toegevoegd voor trainingen en wedstrijden naast het eigen team, met uren per week. Die uren komen samen met de teamtrainingen en wedstrijden terug in een nieuw **belastingsoverzicht** op de spelerspagina en op het spelersdashboard. |
| **v3.7.2** | 2026-09-09 | De uitslagen op het spelersdashboard gebruiken nu dezelfde scoreberekening als de rest van de app. De opgeslagen score staat altijd met de thuisspelende ploeg vooraan, waardoor een gewonnen uitwedstrijd ten onrechte als verloren werd getoond. De uitslag wordt nu vanuit het eigen team gerekend, met de setstanden als leidende bron. |
| **v3.7.1** | 2026-09-09 | Op het spelersdashboard staan **Trainingen**, **Wedstrijden** en **Uitslagen** nu elk in één grote kaart, met de losse aanwezigheidskaartjes als subkaarten daarbinnen. De kleurstelling volgt die van het coachdashboard, zodat beide schermen dezelfde opbouw hebben. |
| **v3.7.0** | 2026-09-09 | Het spelersdashboard toont nu standaard de eerstvolgende vijf trainingen en wedstrijden in plaats van alleen de eerste, met de knop **Bekijken** direct in de statusregel van de trainingskaart. Nieuw zijn een blok **Uitslagen** (laatste uitslag, uit te klappen naar het hele seizoen, met gewonnen/verloren-markering) en **Mijn statistieken** met het aantal gespeelde wedstrijden, de totaal gescoorde punten, de trainingsopkomst en een verdeling van punten per positie. Op het coachdashboard heeft elke trainingskaart nu drie duidelijke knoppen: **Bekijken**, **Bewerken** (dezelfde bewerkpagina als in de trainingslijst) en **Start**. Verder zijn overal de potlood- en oogicoontjes vervangen door de leesbare teksten *Bewerken* en *Bekijken*. |
| **v3.6.0** | 2026-09-08 | Rechten en rollen zijn nu twee losse begrippen. **Rechten** bepalen wat je mag: een **Beheerder** mag alles inclusief Configuratie en het spelersbestand, een **Gebruiker** vult trainingen, wedstrijden en competenties per speler in maar beheert geen spelers of instellingen, en een **Lezer** kan alleen kijken. **Rollen** bepalen alleen wat je ziet: een **Coach** komt op het teamdashboard, een **Speler** op het eigen spelersdashboard en voor **Ouder** staat een lege plek klaar. Wie meerdere rollen heeft, kiest direct na het inloggen in welke rol hij zit en kan daarna altijd wisselen via het menu (of het wisselknopje in de spelersweergave). Belangrijk: de rechten worden nu ook echt door PocketBase afgedwongen via API-regels, niet alleen door knoppen te verbergen — schermen als `/config` en `/trainings/new` zijn niet langer bereikbaar door de URL in te typen, en een lezer kan via de API geen spelers, trainingen of wedstrijden meer aanmaken. Een speler houdt wel altijd het recht om zijn eigen aanwezigheid en vragenlijstantwoorden op te slaan. Uitnodigingen worden voortaan server-side afgehandeld, zodat niemand zichzelf beheerdersrechten op een club kan toekennen. |
| **v3.5.0** | 2026-09-08 | Nieuwe teamvragenlijsten: onder **Team → Vragenlijsten** maken coaches een benoemde vragenlijst met open tekst-, meerkeuze- en schaalvragen, als concept of direct actief voor het hele team. Coaches zien per speler wie antwoordde en wat het antwoord was, zowel in de vragenlijst als op het spelersprofiel. Spelers krijgen een nieuwe **Inbox** met openstaande en eerder beantwoorde vragenlijsten; het eigen dashboard toont een opvallende kaart zodra er iets nieuws klaarstaat. De navigatienaam **Spelers** is gewijzigd naar **Team**. Privéberichten kunnen later in dezelfde Inbox worden toegevoegd. Daarnaast laden alle nieuwe vragenlijstschermen pas nadat de asynchrone team-/seizoenscontext is bepaald, en gebruiken ze geen niet-bestaand PocketBase-veld `created` meer voor sortering, zodat een nieuwe browser- of loginsessie de lijst niet leeg laat lijken. |
| **v3.4.1** | 2026-09-08 | Detailpagina's van training en wedstrijd tonen de aanwezigheid nu correct met alle 6 statussen: `trainings/[id]` toonde voorheen altijd een simpele ✅/❌-pil (alles niet-Aanwezig werd als ❌ getoond, ongeacht Ziek/School/Afwezig/Later/Geblesseerd); `matches/[id]` had een handmatige, onvolledige kleurmapping die School/Later/Geblesseerd verkeerd (oranje i.p.v. eigen kleur) inkleurde. Beide gebruiken nu de gedeelde `ATTENDANCE_STYLES`/`ATTENDANCE_LABELS` als enige bron van waarheid voor kleur en label, plus een tooltip met de opgegeven reden waar aanwezig |
| **v3.4.0** | 2026-09-08 | Beschikbaarheid en aanwezigheid samengevoegd tot één systeem: de aparte `player_availability`-collectie/`AvailabilityStatusSwitcher` (Beschikbaar/Niet beschikbaar/Onzeker) is verwijderd — spelers zetten hun eigen (voorlopige) status voortaan rechtstreeks in dezelfde `training_attendance`/`match_attendance`-records en dezelfde 6 statussen (Aanwezig/Ziek/School/Afwezig/Later/Geblesseerd) die de trainer gebruikt bij check-in/check-out, met dezelfde `AttendanceStatusSwitcher`. Eén bron van waarheid: wat een speler vooraf invult zie je als trainer direct terug tijdens het inchecken, en de trainer kan het achteraf gewoon bijstellen. `match_attendance` heeft nu ook de volledige statusset + een `reason`-veld (was eerder alleen op `training_attendance`). Bestaande `player_availability`-testdata is gemigreerd naar de nieuwe collecties; de collectie wordt niet meer aangemaakt bij nieuwe installaties |
| **v3.3.1** | 2026-09-08 | Spelerdashboard: eigen beschikbaarheid voor een training/wedstrijd is nu één grote tap-to-cycle statusknop (`AvailabilityStatusSwitcher`) i.p.v. drie losse knoppen — de datum (en bij wedstrijden de tegenstander) staat nu direct in de knop zelf, dus geen apart "Mijn beschikbaarheid"-label meer nodig. Bij Niet beschikbaar/Onzeker verschijnt een optioneel tekstveld voor een reden. Daarnaast een reactiviteitsfix: klikken op de status paste de data al direct in PocketBase aan, maar de UI toonde de nieuwe status pas na een page refresh — Svelte's dependency-tracking zag niet dat de statuslookup-functies intern van de `availability`-array afhingen omdat die alleen impliciet (via closure) werd gelezen; `availability` wordt nu expliciet als argument doorgegeven zodat de UI meteen bijwerkt |
| **v3.3.0** | 2026-09-08 | Nieuwe herbruikbare `AttendanceStatusSwitcher` (tap-to-cycle): standaard groen "Aanwezig", door te tikken cyclen door Ziek → School → Afwezig → Later → Geblesseerd → terug naar Aanwezig; bij Afwezig/Later verschijnt een tekstveld voor een reden. Toegepast in zowel de training check-in ("Wie is er?") als check-out ("Aanwezigheid")-stap, met nieuw `reason`-veld op `training_attendance`. Spelerdashboard toont nu standaard alleen de eerstvolgende training en wedstrijd, met een uitklap-knop om de rest van het hele seizoen te tonen zodat spelers hun beschikbaarheid voor elke toekomstige training/wedstrijd kunnen bijwerken, niet alleen de eerstvolgende 4 |
| **v3.2.2** | 2026-09-08 | Fix: spelerdashboard (`/`, `/me`) toonde toch nog geen komende trainingen/wedstrijden ondanks de v3.2.1-fix — twee onderliggende oorzaken opgelost: (1) `getAvailabilityForPlayer()` sorteerde op een niet-bestaand `created`-veld op de `player_availability`-collectie, waardoor PocketBase de hele aanvraag met een generieke 400 afwees en de gecombineerde `Promise.all` (incl. trainingen/wedstrijden) faalde; (2) het spelerdashboard laadde zijn data op `onMount`, wat kon rennen vóórdat de asynchrone rol/spelerkoppeling (`loadUserRoles()`) in de layout klaar was — hierdoor werd soms heel even het gewone coach-dashboard getoond (met échte data) dat na een fractie van een seconde verving door een leeg spelerdashboard. Nieuwe `rolesLoaded`-store zorgt dat het spelerdashboard pas beslist of er wel/geen speler gekoppeld is nadat de rolcheck daadwerkelijk is afgerond |
| **v3.2.1** | 2026-09-08 | Fix: spelerdashboard (`/`, `/me`) toonde geen komende trainingen/wedstrijden voor spelers wiens eerstvolgende training toevallig als "gesloten" gemarkeerd stond — filter aangescherpt naar alle niet-gesloten trainingen (open + actief) vanaf vandaag, gesorteerd op datum zodat de eerstvolgende training bovenaan staat; maximaal 4 trainingen en 4 wedstrijden |
| **v3.2.0** | 2026-09-08 | Speler-eigen profiel: nieuwe pagina `/profile` waar spelers hun foto en een vrij "Over mij"-tekstveld (nieuw `bio`-veld op spelers) zelf kunnen bijwerken. Spelers die nog geen gekoppeld spelersprofiel hebben kunnen zichzelf nu ook zelf koppelen door hun club/team te kiezen en zichzelf aan te wijzen uit de lijst met nog niet-gekoppelde teamleden — hoeft niet meer via de coach. Header voor pure spelers (rol "Lezer") is vereenvoudigd: geen hamburgermenu/context-picker meer, alleen donker-modus, profielicoon en uitloggen. Gebruikers met de "Speler"-vlag krijgen in het volledige menu een "👤 Mijn profiel"-item |
| **v3.1.0** | 2026-09-08 | Spelerlandingspagina: gekoppelde spelers zien nu maximaal 4 komende trainingen met datum/trainer, kunnen de training-inhoud (markdown) bekijken in een lightbox en hun beschikbaarheid (beschikbaar/onzeker/niet beschikbaar) direct bijwerken. Nieuw: gebruikers met de "Speler"-vlag (`is_player` in Toegang) krijgen — los van hun rol (admin/coach/lezer) — een "🏐 Mijn training"-item in het menu naar `/me` met dezelfde pagina, zodat bv. een spelende coach zowel het coach-dashboard als zijn eigen beschikbaarheid kan bijhouden |
| **v3.0.4** | 2026-09-07 | Trainingen bewerken: check-in waardes (gevoel & fitheid emoji's) van aanwezige spelers zijn nu ook op de bewerkpagina in te zien en achteraf aan te passen |
| **v3.0.3** | 2026-09-07 | Fix: check-in overzicht (stap "Start" in de check-in wizard) bleef leeg na het inchecken van spelers — de lokale cache werd niet bijgewerkt met de opgeslagen gevoel/fitheid-waarden, waardoor de overview-check faalde ondanks dat de data wel goed in de database stond |
| **v3.0.2** | 2026-09-07 | Trainingen-lijst: overbodige ▶️ start-knop verwijderd (contextueel Start/Afronden staat al in detailpagina en overzicht-modal); check-in overzicht met emoji's op trainingsdetailpagina + bewerkbaar achteraf; nieuwe check-out reflectieflow (trainer kiezen, 2-4 spelers + reflectievraag) met AI-gegenereerde vraag op basis van de training (valt terug op standaardvragen zonder AI-config) |
| **v3.0.1** | 2026-09-07 | Fix: PWA-installatie op tablet/telefoon toonde nog het oude logo als app-icon — alle icon-bestanden (favicon, apple-touch-icon, manifest icon-192/512, enz.) opnieuw gegenereerd vanuit het huidige logo |
| **v3.0.0** | 2026-09-06 | 🎉 Stable release: club-based multi-tenant beheer (clubs, teams, toegang), platform-admin bootstrap-flow, header toont club + team + seizoen |
| **v2.9.2** | 2026-09-06 | Docs: club_access/platform-admin/manageableClubs beschreven, env-var-tabel aangevuld met OWNER_EMAIL en SETBAAS_ADMIN_EMAIL/PASSWORD |
| **v2.9.1** | 2026-09-06 | Fix: Google OAuth-login zet emailVisibility=true (loste 'undefined' e-mail op platform-admin-pagina op); Access-tab club-selector gescoped op manageableClubs |
| **v2.9.0** | 2026-09-06 | Platform-admin-pagina toont admins per club en staat clubverwijdering toe (alleen door club-admin zelf); CLUB_ADMIN_EMAIL/PASSWORD hernoemd naar SETBAAS_ADMIN_EMAIL/PASSWORD |
| **v2.8.5** | 2026-09-06 | Fix: club zonder team liet nog steeds een andere club's spelers zien (fallback in getContextPlayers verwijderd); nieuwe speler wordt nu direct gekoppeld aan het gekozen team/seizoen |
| **v2.8.4** | 2026-09-06 | Beveiligingsfix: alle collecties vereisen nu een ingelogde gebruiker (lezen/schrijven), behalve de team-naam en uitnodigingslink die de invite-flow nodig heeft |
| **v2.8.3** | 2026-09-05 | Fix: setup voegt nieuwe velden nu wel toe aan bestaande collecties, waardoor teams.club en matches.status eindelijk in productie landen |
| **v2.8.2** | 2026-09-05 | Fix: teamkeuze toont alleen teams van de gekozen club, met melding wanneer een club nog geen teams heeft |
| **v2.8.1** | 2026-09-05 | Spelers, rapportages en teamkeuze strikt gescoped op club → team → seizoen, teams gekoppeld aan de juiste club en OWNER_EMAIL voor admin-rechten |
| **v2.8.0** | 2026-09-05 | Wedstrijdstatus open/gespeeld met bijpassende filters en dashboardknop die pas na afloop op 'Invullen' springt |
| **v2.7.0** | 2026-09-05 | Clublaag (club → team → seizoen) met Zovoc en ZVH, setstanden thuis-eerst met correcte winst/verlies, en dashboardkaarten gelijkgetrokken |
| **v2.6.1** | 2026-09-03 | Dashboardactieknoppen vernieuwd, volledige training-lightbox, formuliericonen opgeschoond, welzijnsrapport hersteld en deploy-healthchecks toegevoegd |
| **v2.6.0** | 2026-09-03 | Aparte trainingsvoorbereiding vanaf het dashboard met Markdown-editor, periodisering, templates en AI |
| **v2.5.4** | 2026-09-01 | Fix: Annuleren-knop gebruikt ook returnTo navigatie |
| **v2.5.3** | 2026-09-01 | Smart return-navigatie na opslaan (dashboard → dashboard, lijst → lijst, detail → detail) |
| **v2.5.2** | 2026-09-01 | Checkout page (scores/opmerkingen/afronden), vereenvoudigde aanwezigheid (✅/❌ pills) |
| **v2.5.1** | 2026-09-01 | Training lightbox op dashboard (bekijken + print/PDF), inline expand verwijderd |
| **v2.5.0** | 2026-09-01 | Wedstrijd aanwezigheid (match_attendance), training lightbox met print/PDF, setup-script field merge, aanwezigheid bovenaan detail pagina's |
| **v2.4.21** | 2026-09-01 | Lid toevoegen, permissierollen (Admin/Gebruiker/Lezer), inline naam bewerken, auto-aanwezigheid nieuwe spelers, setup-script field merge |
| **v2.4.20** | 2026-09-01 | Lid toevoegen (admin), permissierollen (Admin/Gebruiker/Lezer), inline naam bewerken, PB API rules voor team_access en users |
| **v2.4.10** | 2026-09-01 | Teamrollen (trainer/speler/ouder checkboxes), trainer/coach multi-select op trainingen en wedstrijden, namen op dashboard, 24-uurs datumvelden, schema generator met trainer per dag |
| **v2.4.1** | 2026-09-01 | Trainers: trainer/coach toewijzing aan trainingen en wedstrijden, trainers config tab met voorkeursdag, auto-toewijzing bij batch planning |
| **v2.4.0** | 2026-09-01 | Dashboard UX: uniforme kaartjes (weekdag naam trainingen), max 5 wedstrijden met "Gespeeld" link + filter tabs op wedstrijden pagina, groene start knop, cyan wedstrijden card |
| **v2.3.4** | 2026-09-01 | Trainingen filter tabs (Alles/Gepland/Afgerond) met deep link vanuit dashboard |
| **v2.3.3** | 2026-09-01 | Responsive layout: bredere container op tablet/desktop, 2-kolom grid voor trainingen/wedstrijden/spelers/rapporten |
| **v2.3.2** | 2026-09-01 | Dashboard: 5 geplande trainingen, afgerond als link met aantal, uitslagen in grijze card |
| **v2.3.1** | 2026-09-01 | "VOLGENDE →" highlight op eerstvolgende geplande training en wedstrijd |
| **v2.3** | 2026-09-01 | Dashboard cards-in-cards layout: trainingen (actief/gepland/afgerond) en wedstrijden (komend/uitslagen) als geneste kaarten |
| **v2.2** | 2026-09-01 | Dashboard herindeling: gecombineerde trainingen- en wedstrijdensecties, komende wedstrijden met blauwe highlight, stats en quick actions bovenaan |
| **v2.1** | 2026-09-01 | Dark mode fixes spelers/competenties, shirtnummer max 999, komende wedstrijden bovenaan dashboard, prod PB schema sync |
| **v2.0.1** | 2026-09-01 | Fix: dark mode kleuren spelers/competenties, shirtnummer max 999, PB jersey_number onlyInt |
| **v2.0** | 2026-09-01 | 🎉 Training Start Wizard (3 stappen), actieve training met LIVE badge, afronden vanuit dashboard, skip check-in, bulk delete trainingen, 24-uurs tijd, systeem config tab, reactive dashboard na login |
| v1.9.1 | 2026-09-01 | Fix: dashboard data na login, systeem config tab |
| v1.9 | 2026-09-01 | Active training status, bulk delete, 24h tijdformat, skip check-in |
| v1.8.2 | 2026-09-01 | SetBaas logo als favicon |
| v1.8.1 | 2026-09-01 | Fix: speler verwijderen met gerelateerde records |
| v1.8 | 2026-09-01 | Happiness/fitness check-in, welzijn rapport, aanwezigheid op geplande trainingen, "Open" → "Gepland" |
| v1.7 | 2026-08-31 | Trainingsschema generator, deploy script met backup |
| v1.6 | 2026-08-31 | Multi-team rollen (admin/coach/speler), speler dashboard, beschikbaarheid, AI context |
| v1.5 | 2026-08-31 | Nieuw SetBaas logo, versie in menu, branding update |
| v1.4 | 2026-08-30 | Email uitnodigingssysteem, PDF export, Gemini 3.6 |
| v1.3 | 2026-08-30 | Dashboard: open/afgerond trainingen gescheiden |
| v1.2 | 2026-08-30 | Dashboard: open status op geplande trainingen |
| v1.1 | 2026-08-30 | Periodisering in training formulier + AI context |
| v1.0 | 2026-08-29 | Eerste productie release |

---

## Licentie

Private project.
