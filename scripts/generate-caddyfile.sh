#!/bin/sh
# Generates Caddyfile based on environment variables
# Usage: DOMAIN=setbaas.nl ENABLE_SSL=true ./generate-caddyfile.sh > /etc/caddy/Caddyfile

DOMAIN="${DOMAIN:-localhost}"
ENABLE_SSL="${ENABLE_SSL:-false}"

if [ "$ENABLE_SSL" = "true" ]; then
cat <<EOF
# SetBaas — HTTPS via Let's Encrypt
${DOMAIN} {
    # SvelteKit API routes (must be before PocketBase catch-all)
    handle /api/nevobo* {
        reverse_proxy frontend:3000
    }
    handle /api/ai* {
        reverse_proxy frontend:3000
    }
    handle /api/invite* {
        reverse_proxy frontend:3000
    }
    handle /api/backups* {
        reverse_proxy frontend:3000
    }
    handle /api/notify* {
        reverse_proxy frontend:3000
    }
    # PocketBase API
    handle /api/* {
        reverse_proxy pocketbase:8090
    }
    handle /_/* {
        reverse_proxy pocketbase:8090
    }
    # Frontend (SvelteKit)
    handle {
        reverse_proxy frontend:3000
    }
}
www.${DOMAIN} {
    redir https://${DOMAIN}{uri} permanent
}

# Import additional site configurations
import /etc/caddy/conf.d/*.caddy
EOF
else
cat <<EOF
# SetBaas — HTTP only
:80 {
    # SvelteKit API routes (must be before PocketBase catch-all)
    handle /api/nevobo* {
        reverse_proxy frontend:3000
    }
    handle /api/ai* {
        reverse_proxy frontend:3000
    }
    handle /api/invite* {
        reverse_proxy frontend:3000
    }
    handle /api/backups* {
        reverse_proxy frontend:3000
    }
    handle /api/notify* {
        reverse_proxy frontend:3000
    }
    # PocketBase API
    handle /api/* {
        reverse_proxy pocketbase:8090
    }
    handle /_/* {
        reverse_proxy pocketbase:8090
    }
    # Frontend (SvelteKit)
    handle {
        reverse_proxy frontend:3000
    }
}

# Import additional site configurations
import /etc/caddy/conf.d/*.caddy
EOF
fi
