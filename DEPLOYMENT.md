# SetBaas Deployment & Beheer

Deze handleiding en checklist zijn leidend voor het beheer en de productie-deploys van **SetBaas** (voorheen TeamTracker / SideLine). Volg de stappen altijd zorgvuldig in deze volgorde.

## Spelregels

1. **Nooit deployen zonder geldige backup**
   - Maak eerst een backup met `./scripts/backup.sh`.
   - De backup moet groter zijn dan een paar MB.
   - De backup moet `pb_data/data.db` bevatten.

2. **Nooit PocketBase-data overschrijven zonder expliciete bevestiging**
   - Restore alleen als expliciet is bevestigd welke backup teruggezet moet worden.
   - Bewaar de oude data eerst als backup of als `pb_data.old`.

3. **Altijd vanuit de repo-root van SetBaas werken**

   ```bash
   cd /home/giedo/setbaas
   ```

4. **Altijd de juiste Compose-file gebruiken**
   - Productie: `docker-compose.prod.yml`
   - Lokaal/test: `docker-compose.yml`
   - Niet gokken op basis van de huidige map.

5. **Alleen fast-forward pull op productie**

   ```bash
   git pull --ff-only
   ```

6. **Frontend altijd rebuilden**

   ```bash
   docker compose -f docker-compose.prod.yml build frontend
   docker compose -f docker-compose.prod.yml up -d
   ```

7. **PocketBase alleen recreaten als dat nodig is**
   - Bij gewone frontend/UI-releases: PocketBase niet onnodig vervangen.
   - Bij database-, restore- of volume-aanpassingen: eerst extra backup en expliciet plan.

8. **Release pas klaar noemen als alles is gecontroleerd**
   - Git tag bestaat.
   - Code staat op `main`.
   - Productie draait op https://setbaas.nl.
   - Healthcheck is goed (`http://localhost:8090/api/health` of via reverse proxy).
   - Backup werkt na deploy nog steeds.

9. **Nooit tags overschrijven, verplaatsen of hergebruiken (Immutable Tags)**
   - Overschrijf, delete of force-push **nooit** een bestaande Git tag (`git tag -f`, `git push --delete`, etc.).
   - Is een tag eenmaal aangemaakt of gepusht? Dan is die versie definitief.
   - Moet er een fix of wijziging mee? Bump **altijd** naar een nieuw versienummer in `frontend/package.json` (bijv. van `v4.4.0` naar `v4.4.1`) en maak een nieuwe tag aan.

10. **Bij twijfel stoppen en vragen**
   - Vooral bij database, restore, volumes, secrets, DNS/SSL en OAuth.

11. ** Caddy draait als aparte service op de productie machine **
   - Pas de Caddyfiles aan in de repo waar nodig en vermeldt de acties die nodig zijn om op product te kunnen releasen indien nodig
   - De caddy instantie kijkt in $HOME/caddy/conf.d/*.caddy files
   - Naming is [domainname].caddy dus setbaas.nl.caddy in dit geval
   - Het caddy docker network heet: caddy-net

## Snelle deploy via script

Je kunt op de server ook direct het geautomatiseerde deploy-script draaien:

```bash
cd /home/giedo/setbaas
./scripts/deploy.sh
```

Dit script:
1. Maakt en verifieert automatisch een backup met `./scripts/backup.sh`
2. Haalt de nieuwste code op via `git fetch --tags && git pull --ff-only`
3. Bouwt de frontend opnieuw en herstart de services (`docker-compose.prod.yml`)
4. Voert de database-setup uit (indien nodig)
5. Doet een healthcheck op frontend en PocketBase

---

## Handmatige productie-deploy checklist

### 1. Voorcontrole

```bash
cd /home/giedo/setbaas

git status
git log -1 --oneline
docker compose -f docker-compose.prod.yml ps
```

Ga alleen verder als de productie-worktree geen onverwachte lokale wijzigingen heeft.

### 2. Backup maken en controleren

```bash
./scripts/backup.sh
```

Controleer de nieuwste backup:

```bash
LATEST_BACKUP="$(ls -1t backups/setbaas_backup_*.tar.gz | head -1)"
du -h "$LATEST_BACKUP"
tar -tzf "$LATEST_BACKUP" | grep 'pb_data/data.db'
```

Ga alleen verder als:

- de backup meerdere MB's groot is;
- `pb_data/data.db` in het archief staat;
- PocketBase daarna weer gezond is.

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8090/api/health
```

### 3. Code ophalen

```bash
git fetch --tags
git pull --ff-only
```

Controleer de gewenste versie/tag:

```bash
git log -1 --oneline
git tag --sort=-version:refname | head -5
```

### 4. Build en deploy

```bash
docker compose -f docker-compose.prod.yml build frontend
docker compose -f docker-compose.prod.yml up -d
```

### 5. Na-deploy controles

```bash
docker compose -f docker-compose.prod.yml ps
curl -I https://setbaas.nl
docker compose -f docker-compose.prod.yml logs --tail=100
```

Controleer ook PocketBase:

```bash
docker compose -f docker-compose.prod.yml exec pocketbase ls -lah /pb_data
docker compose -f docker-compose.prod.yml exec pocketbase test -s /pb_data/data.db && echo "data.db OK"
```

### 6. Backupflow na deploy testen

Maak na de deploy nog één testbackup naar een tijdelijke map:

```bash
rm -rf /tmp/setbaas-backup-test
mkdir -p /tmp/setbaas-backup-test
./scripts/backup.sh /tmp/setbaas-backup-test

TEST_BACKUP="$(ls -1t /tmp/setbaas-backup-test/setbaas_backup_*.tar.gz | head -1)"
du -h "$TEST_BACKUP"
tar -tzf "$TEST_BACKUP" | grep 'pb_data/data.db'
rm -rf /tmp/setbaas-backup-test
```

Als dit lukt, is de productie-backupflow betrouwbaar.

## Restore op productie

Restore is destructief. Voer dit alleen uit na expliciete bevestiging.

```bash
cd /home/giedo/setbaas

docker compose -f docker-compose.prod.yml down

mkdir -p /tmp/setbaas-restore
tar -xzf backups/setbaas_backup_YYYYMMDD_HHMMSS.tar.gz -C /tmp/setbaas-restore

docker compose -f docker-compose.prod.yml up -d pocketbase
docker compose -f docker-compose.prod.yml cp /tmp/setbaas-restore/pb_data/. pocketbase:/pb_data/

docker compose -f docker-compose.prod.yml restart pocketbase
docker compose -f docker-compose.prod.yml up -d

rm -rf /tmp/setbaas-restore
```

Controleer daarna:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs pocketbase --tail=50
docker compose -f docker-compose.prod.yml exec pocketbase test -s /pb_data/data.db && echo "data.db OK"
```

## Belangrijke PocketBase-dataregel

PocketBase-data hoort in deze applicatie op `/pb_data` te staan. Backups van een lege `./pb_data` hostmap of `/pb/pb_data` zijn niet betrouwbaar.

Het backupscript detecteert daarom het echte datapad en weigert een backup zonder `pb_data/data.db`.
