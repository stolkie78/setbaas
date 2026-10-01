#!/usr/bin/env bash
# SetBaas Deploy Script
#
# One entry point for every environment. Ends with a running, verified stack.
#
# Usage:
#   ./scripts/deploy.sh <test|demo|prod> [command] [options]
#
# Commands:
#   deploy    (default) build, start and verify the environment
#   down      stop and remove the environment's containers
#   status    show container status and the recorded deploy state
#   logs      follow the logs
#   seed      load demo data (test only, destructive)
#   clean     remove the environment's database (test only, destructive)
#
# Options:
#   --setup           force schema setup/migrations, even if nothing changed
#   --skip-setup      never run schema setup
#   --pull            git pull before deploying
#   --no-pull         skip git pull
#   --no-backup       skip the pre-deploy backup
#   --no-build        reuse the existing frontend image
#   -y, --yes         do not ask for confirmation on destructive actions
#   -h, --help        show this help
#
# Schema setup runs automatically on a clean install, on a release update
# (frontend/package.json version change) and when setup-collections.sh changed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

STATE_DIR="$ROOT_DIR/.deploy-state"

# === Output helpers ===
step()  { echo ""; echo "➜ $*"; }
info()  { echo "  $*"; }
ok()    { echo "  ✅ $*"; }
warn()  { echo "  ⚠ $*"; }
die()   { echo "❌ $*" >&2; exit 1; }

usage() {
    awk 'NR>1 && /^#/ {sub(/^# ?/, ""); print; next} NR>1 {exit}' "${BASH_SOURCE[0]}"
    exit "${1:-0}"
}

# === Argument parsing ===
ENVIRONMENT=""
COMMAND="deploy"
FORCE_SETUP=false
SKIP_SETUP=false
DO_PULL=""
DO_BACKUP=""
DO_BUILD=true
ASSUME_YES=false

while [ $# -gt 0 ]; do
    case "$1" in
        test|demo|prod)        ENVIRONMENT="$1" ;;
        production)            ENVIRONMENT="prod" ;;
        deploy|down|status|logs|seed|clean) COMMAND="$1" ;;
        up)                    COMMAND="deploy" ;;
        --setup|--force-setup) FORCE_SETUP=true ;;
        --skip-setup)          SKIP_SETUP=true ;;
        --pull)                DO_PULL=true ;;
        --no-pull)             DO_PULL=false ;;
        --no-backup)           DO_BACKUP=false ;;
        --backup)              DO_BACKUP=true ;;
        --no-build)            DO_BUILD=false ;;
        -y|--yes)              ASSUME_YES=true ;;
        -h|--help)             usage 0 ;;
        *) echo "❌ Onbekend argument: $1" >&2; usage 1 ;;
    esac
    shift
done

[ -n "$ENVIRONMENT" ] || { echo "❌ Geef een omgeving op: test, demo of prod" >&2; usage 1; }

# === Environment configuration ===
case "$ENVIRONMENT" in
    test)
        COMPOSE_FILE="docker-compose.test.yml"
        COMPOSE_PROJECT="setbaas-test"
        ENV_FILE=".env.test"
        ENV_EXAMPLE=".env.test.example"
        PB_DATA_KIND="volume"
        PB_DATA_REF="setbaas-test_pb_test_data"
        DEFAULT_PULL=false
        DEFAULT_BACKUP=false
        ;;
    demo)
        COMPOSE_FILE="docker-compose.demo.yml"
        COMPOSE_PROJECT="setbaas-demo"
        ENV_FILE=".env.demo"
        ENV_EXAMPLE=".env.production.example"
        PB_DATA_KIND="path"
        PB_DATA_REF="$ROOT_DIR/pb_data_demo/data.db"
        DEFAULT_PULL=true
        DEFAULT_BACKUP=true
        ;;
    prod)
        COMPOSE_FILE="docker-compose.prod.yml"
        # Keep the historic (directory-based) project name for prod so existing
        # deployments keep ownership of their containers.
        COMPOSE_PROJECT=""
        ENV_FILE=".env"
        ENV_EXAMPLE=".env.production.example"
        PB_DATA_KIND="path"
        PB_DATA_REF="$ROOT_DIR/pb_data/data.db"
        DEFAULT_PULL=true
        DEFAULT_BACKUP=true
        ;;
esac

[ -n "$DO_PULL" ]   || DO_PULL="$DEFAULT_PULL"
[ -n "$DO_BACKUP" ] || DO_BACKUP="$DEFAULT_BACKUP"

[ -f "$COMPOSE_FILE" ] || die "Compose bestand ontbreekt: $COMPOSE_FILE"
if [ ! -f "$ENV_FILE" ]; then
    die "$ENV_FILE ontbreekt. Maak het aan met: cp $ENV_EXAMPLE $ENV_FILE"
fi

# Load the environment file into this shell (for seeding, health checks, etc.)
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

VERSION=$(grep '"version"' frontend/package.json | head -1 | grep -o '[0-9]\+\.[0-9]\+\.[0-9]\+')

# docker compose wrapper with the right file, project and env file
dc() {
    if [ -n "$COMPOSE_PROJECT" ]; then
        docker compose --env-file "$ENV_FILE" -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" "$@"
    else
        docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
    fi
}

confirm() {
    [ "$ASSUME_YES" = true ] && return 0
    read -r -p "  $1 [y/N] " answer
    case "$answer" in [yY]|[yY][eE][sS]) return 0 ;; *) return 1 ;; esac
}

# === Deploy state (used to decide whether setup must run) ===
STATE_FILE="$STATE_DIR/$ENVIRONMENT.env"

sha_of() {
    if command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$1" | cut -d' ' -f1
    else
        sha256sum "$1" | cut -d' ' -f1
    fi
}

SETUP_SHA=$(sha_of "$ROOT_DIR/scripts/setup-collections.sh")

read_state() {
    STATE_VERSION=""
    STATE_SETUP_SHA=""
    if [ -f "$STATE_FILE" ]; then
        # shellcheck disable=SC1090
        source "$STATE_FILE"
    fi
}

write_state() {
    mkdir -p "$STATE_DIR"
    cat > "$STATE_FILE" <<EOF
# SetBaas deploy state for '$ENVIRONMENT' — generated by scripts/deploy.sh
STATE_VERSION="$VERSION"
STATE_SETUP_SHA="$SETUP_SHA"
STATE_DEPLOYED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
STATE_GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
EOF
}

pb_data_exists() {
    if [ "$PB_DATA_KIND" = "volume" ]; then
        docker volume inspect "$PB_DATA_REF" >/dev/null 2>&1
    else
        [ -s "$PB_DATA_REF" ]
    fi
}

# Decides whether schema setup/migrations must run. Sets SETUP_REASON.
needs_setup() {
    SETUP_REASON=""
    if [ "$SKIP_SETUP" = true ]; then
        return 1
    fi
    if [ "$FORCE_SETUP" = true ]; then
        SETUP_REASON="handmatig geforceerd (--setup)"
        return 0
    fi
    if ! pb_data_exists; then
        SETUP_REASON="clean install (nog geen PocketBase database)"
        return 0
    fi
    read_state
    if [ -z "$STATE_VERSION" ]; then
        SETUP_REASON="clean install (geen deploy state gevonden)"
        return 0
    fi
    if [ "$STATE_VERSION" != "$VERSION" ]; then
        SETUP_REASON="release update ($STATE_VERSION → $VERSION)"
        return 0
    fi
    if [ "$STATE_SETUP_SHA" != "$SETUP_SHA" ]; then
        SETUP_REASON="setup-collections.sh is gewijzigd"
        return 0
    fi
    return 1
}

wait_for_health() {
    for i in $(seq 1 30); do
        if dc exec -T frontend wget -q --spider http://127.0.0.1:3000 2>/dev/null \
            && dc exec -T pocketbase wget -q --spider http://127.0.0.1:8090/api/health 2>/dev/null; then
            return 0
        fi
        [ "$i" = "1" ] && info "Wachten tot de services bereikbaar zijn..."
        sleep 2
    done
    return 1
}

site_url() {
    case "$ENVIRONMENT" in
        test) echo "http://localhost:${TEST_HTTP_PORT:-3000}" ;;
        *)    echo "${SITE_URL:-onbekend}" ;;
    esac
}

# === Commands ===
cmd_down() {
    step "Omgeving '$ENVIRONMENT' stoppen..."
    dc down
    ok "Gestopt"
}

cmd_status() {
    step "Containers ($ENVIRONMENT)"
    dc ps
    step "Deploy state"
    if [ -f "$STATE_FILE" ]; then
        sed 's/^/  /' "$STATE_FILE"
    else
        info "Nog geen deploy state — de volgende deploy telt als clean install."
    fi
    info "Huidige app versie: $VERSION"
    if pb_data_exists; then
        info "PocketBase data: aanwezig ($PB_DATA_REF)"
    else
        info "PocketBase data: leeg ($PB_DATA_REF)"
    fi
}

cmd_logs() {
    dc logs -f
}

cmd_clean() {
    [ "$ENVIRONMENT" = "test" ] || die "'clean' is alleen toegestaan voor de test omgeving"
    step "Test database wissen..."
    confirm "Dit verwijdert ALLE test data. Doorgaan?" || die "Afgebroken"
    dc down -v
    rm -f "$STATE_FILE"
    ok "Test data verwijderd — de volgende deploy is een clean install"
}

cmd_seed() {
    [ "$ENVIRONMENT" = "test" ] || die "'seed' is alleen toegestaan voor de test omgeving"
    command -v node >/dev/null 2>&1 || die "node is nodig om te seeden"
    step "Demo data laden..."
    confirm "Dit overschrijft de bestaande test data. Doorgaan?" || die "Afgebroken"
    PB_URL="http://localhost:${TEST_PB_PORT:-8090}" node scripts/seed-test-data.mjs
    ok "Demo data geladen"
}

cmd_deploy() {
    echo "🏐 SetBaas deploy — omgeving: $ENVIRONMENT (v$VERSION)"
    info "Compose: $COMPOSE_FILE   Env: $ENV_FILE"

    [ -n "${PB_ADMIN_EMAIL:-}" ] && [ -n "${PB_ADMIN_PASSWORD:-}" ] \
        || die "PB_ADMIN_EMAIL en PB_ADMIN_PASSWORD moeten gezet zijn in $ENV_FILE"

    # Determine before anything starts, so a fresh database is detected correctly.
    if needs_setup; then
        RUN_SETUP=true
    else
        RUN_SETUP=false
    fi

    if [ "$DO_PULL" = true ]; then
        step "Stap 1: Code ophalen..."
        git fetch --tags --quiet
        git pull --ff-only
    else
        step "Stap 1: Code ophalen overgeslagen"
    fi

    if [ "$DO_BACKUP" = true ]; then
        step "Stap 2: Backup maken..."
        if dc ps --services --filter status=running 2>/dev/null | grep -q pocketbase; then
            SETBAAS_COMPOSE_FILE="$COMPOSE_FILE" \
            SETBAAS_COMPOSE_PROJECT="$COMPOSE_PROJECT" \
                "$SCRIPT_DIR/backup.sh"
        else
            warn "PocketBase draait niet, backup overgeslagen"
        fi
    else
        step "Stap 2: Backup overgeslagen"
    fi

    step "Stap 3: Build en start..."
    if [ "$DO_BUILD" = true ]; then
        dc build frontend
    else
        info "Build overgeslagen (--no-build)"
    fi
    dc up -d

    step "Stap 4: Database setup (schema migraties)..."
    if [ "$RUN_SETUP" = true ]; then
        info "Reden: $SETUP_REASON"
        dc --profile setup run --rm pb-setup
        ok "Schema setup voltooid"
    elif [ "$SKIP_SETUP" = true ]; then
        info "Overgeslagen (--skip-setup)"
    else
        info "Niets gewijzigd — setup overgeslagen (forceer met --setup)"
    fi

    step "Stap 5: Services controleren..."
    if ! wait_for_health; then
        dc ps
        die "Deploy mislukt: services zijn niet bereikbaar"
    fi
    ok "Frontend en PocketBase zijn bereikbaar"

    write_state

    echo ""
    echo "✅ Deploy compleet! SetBaas v${VERSION} draait op '$ENVIRONMENT'."
    echo "   App:        $(site_url)"
    if [ "$ENVIRONMENT" = "test" ]; then
        echo "   PocketBase: http://localhost:${TEST_PB_PORT:-8090}/_/"
        echo "   Demo data:  ./scripts/deploy.sh test seed"
    fi
}

case "$COMMAND" in
    deploy) cmd_deploy ;;
    down)   cmd_down ;;
    status) cmd_status ;;
    logs)   cmd_logs ;;
    seed)   cmd_seed ;;
    clean)  cmd_clean ;;
esac
