#!/bin/bash
# setup-collections.sh — Idempotent PocketBase collection setup
# Run after PocketBase is healthy. Creates/updates all collections needed by SetBaas.
# Usage: ./scripts/setup-collections.sh [PB_URL] [ADMIN_EMAIL] [ADMIN_PASSWORD]

set -e

PB_URL="${1:-http://localhost:8090}"
ADMIN_EMAIL="${PB_ADMIN_EMAIL:-${2:-}}"
ADMIN_PASSWORD="${PB_ADMIN_PASSWORD:-${3:-}}"

if [ -z "$ADMIN_EMAIL" ] || [ -z "$ADMIN_PASSWORD" ]; then
  echo "❌ PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD must be set (via env or arguments)"
  exit 1
fi

echo "🏐 SetBaas — Setting up PocketBase collections at $PB_URL"

# Wait for PocketBase to be ready
for i in $(seq 1 30); do
  if curl -sf "$PB_URL/api/health" > /dev/null 2>&1; then
    break
  fi
  echo "  Waiting for PocketBase... ($i)"
  sleep 2
done

# Ensure superuser exists
# Method 1: Try docker exec (when running from host)
if command -v docker &> /dev/null && docker ps --filter name=setbaas-pb --format '{{.Names}}' 2>/dev/null | grep -q setbaas-pb; then
  docker exec setbaas-pb pocketbase superuser upsert "$ADMIN_EMAIL" "$ADMIN_PASSWORD" 2>/dev/null || true
fi

# Method 2: Try creating via API (works on fresh install when no superusers exist)
curl -sf "$PB_URL/api/collections/_superusers/records" \
  -X POST -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\",\"passwordConfirm\":\"$ADMIN_PASSWORD\"}" > /dev/null 2>&1 || true

# Authenticate
TOKEN=$(curl -sf "$PB_URL/api/collections/_superusers/auth-with-password" \
  -X POST -H "Content-Type: application/json" \
  -d "{\"identity\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
  | jq -r '.token')

if [ -z "$TOKEN" ]; then
  echo "❌ Failed to authenticate as superuser"
  exit 1
fi
echo "✅ Authenticated as $ADMIN_EMAIL"

# Update users collection API rules. Signing up stays open because the invite
# flow creates an account before logging in, but an account may only be changed
# or removed by its owner.
echo "→ Updating users collection API rules..."
curl -sf -X PATCH "$PB_URL/api/collections/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"viewRule":"@request.auth.id != \"\"","listRule":"@request.auth.id != \"\"","updateRule":"id = @request.auth.id","createRule":"","deleteRule":"id = @request.auth.id"}' > /dev/null 2>&1 && echo "  ✅ Users API rules updated" || echo "  ⚠️ Could not update users API rules"

# Add is_platform_admin flag to users. A platform admin is a narrow built-in
# role (not a superuser): they can only create new clubs and grant the first
# admin to a freshly created club. They cannot see or manage any other data.
echo "→ Ensuring is_platform_admin field on users collection..."
EXISTING_USER_FIELDS=$(curl -sf "$PB_URL/api/collections/users" -H "Authorization: Bearer $TOKEN" | jq -c '.fields')
HAS_PLATFORM_ADMIN_FIELD=$(echo "$EXISTING_USER_FIELDS" | jq 'any(.name == "is_platform_admin")')
if [ "$HAS_PLATFORM_ADMIN_FIELD" != "true" ]; then
  MERGED_USER_FIELDS=$(echo "$EXISTING_USER_FIELDS" | jq -c '. + [{"name":"is_platform_admin","type":"bool","required":false}]')
  curl -sf -X PATCH "$PB_URL/api/collections/users" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"fields\": $MERGED_USER_FIELDS}" > /dev/null \
    && echo "  ✅ is_platform_admin field added" || echo "  ⚠️ Could not add is_platform_admin field"
else
  echo "  ✅ is_platform_admin field exists"
fi

# Helper: create or update a collection
# Usage: ensure_collection '{"name":"...", "type":"...", "fields":[...], ...}'
ensure_collection() {
  local DEF="$1"
  local NAME=$(echo "$DEF" | jq -r '.name')
  local SECURED_DEF=$(echo "$DEF" | jq -c '
    .listRule = (if .listRule == "" then "@request.auth.id != \"\"" else .listRule end)
    | .viewRule = (if .viewRule == "" then "@request.auth.id != \"\"" else .viewRule end)
    | .createRule = (if .createRule == "" then "@request.auth.id != \"\"" else .createRule end)
    | .updateRule = (if .updateRule == "" then "@request.auth.id != \"\"" else .updateRule end)
    | .deleteRule = (if .deleteRule == "" then "@request.auth.id != \"\"" else .deleteRule end)
  ')

  # Check if collection exists
  local STATUS=$(curl -sf -o /dev/null -w "%{http_code}" "$PB_URL/api/collections/$NAME" \
    -H "Authorization: Bearer $TOKEN")

  if [ "$STATUS" = "200" ]; then
    # Collection exists — merge new fields (add missing ones, don't remove existing)
    local EXISTING_FIELDS=$(curl -sf "$PB_URL/api/collections/$NAME" \
      -H "Authorization: Bearer $TOKEN" | jq -c '.fields')
    local NEW_FIELDS=$(echo "$DEF" | jq -c '.fields')
    # jq only — the setup container has no python3, and a silent failure here
    # would leave existing collections without their new fields.
    local MERGED=$(jq -n --argjson existing "$EXISTING_FIELDS" --argjson new "$NEW_FIELDS" '
      ($existing | map(.name)) as $names
      | ($new | map(select((.name | IN($names[])) | not))) as $added
      | if ($added | length) > 0 then {fields: ($existing + $added)} else empty end
    ')
    if [ -n "$MERGED" ]; then
      curl -sf -X PATCH "$PB_URL/api/collections/$NAME" \
        -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
        -d "$MERGED" > /dev/null
      echo "  ✓ $NAME (updated with new fields)"
    else
      echo "  ✓ $NAME (exists, up to date)"
    fi
    # Update API rules if specified
    local RULES=$(echo "$SECURED_DEF" | jq -c '{listRule,viewRule,createRule,updateRule,deleteRule} | with_entries(select(.value != null))')
    if [ "$RULES" != "{}" ]; then
      curl -sf -X PATCH "$PB_URL/api/collections/$NAME" \
        -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
        -d "$RULES" > /dev/null 2>&1 \
        || echo "  ⚠️ Could not apply API rules for $NAME"
    fi
  else
    # Create new collection
    curl -sf "$PB_URL/api/collections" -X POST \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      -d "$SECURED_DEF" > /dev/null
    echo "  ✓ $NAME (created)"
  fi
}

# Helper to get collection ID by name (for relations)
get_col_id() {
  curl -sf "$PB_URL/api/collections/$1" -H "Authorization: Bearer $TOKEN" \
    | jq -r '.id'
}

# Helper: update the allowed `values` of an existing select field on a collection.
# ensure_collection() only adds brand-new field names; this patches the values
# array of a field that already exists (e.g. adding a new select option).
# Usage: ensure_select_values <collection_name> <field_name> ["a","b","c"]
ensure_select_values() {
  local NAME="$1"
  local FIELD_NAME="$2"
  local NEW_VALUES="$3"

  local FIELDS=$(curl -sf "$PB_URL/api/collections/$NAME" -H "Authorization: $TOKEN" | jq -c '.fields')
  if [ -z "$FIELDS" ] || [ "$FIELDS" = "null" ]; then
    echo "  ⚠️ Could not read fields for $NAME (skipping $FIELD_NAME values update)"
    return
  fi

  local UPDATED_FIELDS=$(echo "$FIELDS" | jq -c --arg fname "$FIELD_NAME" --argjson vals "$NEW_VALUES" 'map(if .name == $fname then .values = $vals else . end)')

  curl -sf -X PATCH "$PB_URL/api/collections/$NAME" \
    -H "Authorization: $TOKEN" -H "Content-Type: application/json" \
    -d "{\"fields\": $UPDATED_FIELDS}" > /dev/null \
    && echo "  ✅ $NAME.$FIELD_NAME values updated" \
    || echo "  ⚠️ Could not update $NAME.$FIELD_NAME values"
}

echo ""
echo "📦 Creating/updating collections..."

# === 0. Clubs ===
ensure_collection '{
  "name": "clubs",
  "type": "base",
  "fields": [
    {"name": "name", "type": "text", "required": true},
    {"name": "short_name", "type": "text", "required": false},
    {"name": "city", "type": "text", "required": false}
  ],
  "listRule": "@request.auth.id != \"\"",
  "viewRule": "@request.auth.id != \"\"",
  "createRule": "@request.auth.id != \"\"",
  "updateRule": "@request.auth.id != \"\"",
  "deleteRule": "@request.auth.id != \"\""
}'

CLUBS_ID=$(get_col_id "clubs")

# === 1. Teams ===
ensure_collection "{
  \"name\": \"teams\",
  \"type\": \"base\",
  \"fields\": [
    {\"name\": \"club\", \"type\": \"relation\", \"required\": false, \"collectionId\": \"$CLUBS_ID\", \"maxSelect\": 1},
    {\"name\": \"name\", \"type\": \"text\", \"required\": true},
    {\"name\": \"nevobo_code\", \"type\": \"text\", \"required\": false},
    {\"name\": \"nevobo_team_type\", \"type\": \"text\", \"required\": false},
    {\"name\": \"nevobo_team_number\", \"type\": \"number\", \"required\": false},
    {\"name\": \"nevobo_url\", \"type\": \"url\", \"required\": false},
    {\"name\": \"ai_system_prompt\", \"type\": \"text\", \"required\": false, \"max\": 8000}
  ],
  \"listRule\": \"@request.auth.id != \\\"\\\"\",
  \"viewRule\": \"id != \\\"\\\"\",
  \"createRule\": \"@request.auth.id != \\\"\\\"\",
  \"updateRule\": \"@request.auth.id != \\\"\\\"\",
  \"deleteRule\": \"@request.auth.id != \\\"\\\"\"
}"

# === 2. Seasons ===
ensure_collection '{
  "name": "seasons",
  "type": "base",
  "fields": [
    {"name": "name", "type": "text", "required": true},
    {"name": "start_year", "type": "number", "required": true},
    {"name": "end_year", "type": "number", "required": true}
  ],
  "listRule": "@request.auth.id != \"\"",
  "viewRule": "@request.auth.id != \"\"",
  "createRule": "@request.auth.id != \"\"",
  "updateRule": "@request.auth.id != \"\"",
  "deleteRule": "@request.auth.id != \"\""
}'

# === 3. Players ===
ensure_collection '{
  "name": "players",
  "type": "base",
  "fields": [
    {"name": "name", "type": "text", "required": true},
    {"name": "photo", "type": "file", "required": false, "maxSelect": 1, "maxSize": 5242880, "mimeTypes": ["image/jpeg","image/png","image/webp"], "thumbs": ["100x100","200x200"]},
    {"name": "position", "type": "select", "required": false, "values": ["setter","outside_hitter","opposite","middle_blocker","libero","defensive_specialist"], "maxSelect": 6},
    {"name": "status", "type": "select", "required": true, "values": ["active","injured","inactive"], "maxSelect": 1},
    {"name": "jersey_number", "type": "number", "required": false, "min": 1, "max": 999, "onlyInt": true},
    {"name": "email", "type": "email", "required": false},
    {"name": "user_id", "type": "relation", "required": false, "collectionId": "_pb_users_auth_", "maxSelect": 1},
    {"name": "bio", "type": "text", "required": false, "max": 300},
    {"name": "extra_activities", "type": "json", "required": false, "maxSize": 20000}
  ],
  "listRule": "@request.auth.id != \"\"",
  "viewRule": "@request.auth.id != \"\"",
  "createRule": "@request.auth.id != \"\"",
  "updateRule": "@request.auth.id != \"\"",
  "deleteRule": "@request.auth.id != \"\""
}'

# === 4. Competencies ===
ensure_collection '{
  "name": "competencies",
  "type": "base",
  "fields": [
    {"name": "name", "type": "text", "required": true},
    {"name": "category", "type": "select", "required": true, "values": ["technical","tactical","physical","mental"], "maxSelect": 1}
  ],
  "listRule": "@request.auth.id != \"\"",
  "viewRule": "@request.auth.id != \"\"",
  "createRule": "@request.auth.id != \"\"",
  "updateRule": "@request.auth.id != \"\"",
  "deleteRule": "@request.auth.id != \"\""
}'

# Get IDs for relations
TEAMS_ID=$(get_col_id "teams")
SEASONS_ID=$(get_col_id "seasons")
PLAYERS_ID=$(get_col_id "players")
COMPETENCIES_ID=$(get_col_id "competencies")

# === 4b. Club Access (multi-user, club-scoped) ===
# Replaces team_access: granting a role on a club gives access to every team
# under it. default_team lets someone with multiple teams in the same club
# pick which one loads by default.
ensure_collection "{
  \"name\": \"club_access\",
  \"type\": \"base\",
  \"fields\": [
    {\"name\": \"user\", \"type\": \"relation\", \"required\": true, \"collectionId\": \"_pb_users_auth_\", \"maxSelect\": 1},
    {\"name\": \"club\", \"type\": \"relation\", \"required\": true, \"collectionId\": \"$CLUBS_ID\", \"maxSelect\": 1},
    {\"name\": \"role\", \"type\": \"select\", \"required\": true, \"values\": [\"admin\",\"user\",\"viewer\"], \"maxSelect\": 1},
    {\"name\": \"default_team\", \"type\": \"relation\", \"required\": false, \"collectionId\": \"$TEAMS_ID\", \"maxSelect\": 1},
    {\"name\": \"is_trainer\", \"type\": \"bool\", \"required\": false},
    {\"name\": \"is_player\", \"type\": \"bool\", \"required\": false},
    {\"name\": \"is_parent\", \"type\": \"bool\", \"required\": false}
  ],
  \"listRule\": \"@request.auth.id != \\\"\\\"\",
  \"viewRule\": \"@request.auth.id != \\\"\\\"\",
  \"createRule\": \"@request.auth.id != \\\"\\\"\",
  \"updateRule\": \"@request.auth.id != \\\"\\\"\",
  \"deleteRule\": \"@request.auth.id != \\\"\\\"\"
}"
CLUB_ACCESS_ID=$(get_col_id "club_access")

# === 4c. Club AI Config ===
# Each club brings (and pays for) its own AI key. The key must never reach the
# browser, so this collection is superuser-only: the frontend reads and writes
# it exclusively through /api/ai/config, which checks club admin rights first.
ensure_collection "{
  \"name\": \"club_ai_config\",
  \"type\": \"base\",
  \"fields\": [
    {\"name\": \"club\", \"type\": \"relation\", \"required\": true, \"collectionId\": \"$CLUBS_ID\", \"maxSelect\": 1},
    {\"name\": \"provider\", \"type\": \"select\", \"required\": false, \"values\": [\"openai\",\"gemini\"], \"maxSelect\": 1},
    {\"name\": \"api_key\", \"type\": \"text\", \"required\": false, \"max\": 500},
    {\"name\": \"model\", \"type\": \"text\", \"required\": false},
    {\"name\": \"system_prompt\", \"type\": \"text\", \"required\": false, \"max\": 8000}
  ]
}"

# === 5. Player Competencies ===
ensure_collection "{
  \"name\": \"player_competencies\",
  \"type\": \"base\",
  \"fields\": [
    {\"name\": \"player\", \"type\": \"relation\", \"required\": true, \"collectionId\": \"$PLAYERS_ID\", \"maxSelect\": 1},
    {\"name\": \"competency\", \"type\": \"relation\", \"required\": true, \"collectionId\": \"$COMPETENCIES_ID\", \"maxSelect\": 1},
    {\"name\": \"rating\", \"type\": \"number\", \"required\": true},
    {\"name\": \"date\", \"type\": \"date\", \"required\": true},
    {\"name\": \"notes\", \"type\": \"text\", \"required\": false},
    {\"name\": \"created_by\", \"type\": \"relation\", \"required\": false, \"collectionId\": \"_pb_users_auth_\", \"maxSelect\": 1}
  ],
  \"listRule\": \"@request.auth.id != \\\"\\\"\",
  \"viewRule\": \"@request.auth.id != \\\"\\\"\",
  \"createRule\": \"@request.auth.id != \\\"\\\"\",
  \"updateRule\": \"@request.auth.id != \\\"\\\"\",
  \"deleteRule\": \"@request.auth.id != \\\"\\\"\"
}"

# === 6. Trainings ===
ensure_collection "{
  \"name\": \"trainings\",
  \"type\": \"base\",
  \"fields\": [
    {\"name\": \"date\", \"type\": \"date\", \"required\": true},
    {\"name\": \"overall_rating\", \"type\": \"number\", \"required\": false},
    {\"name\": \"general_comments\", \"type\": \"text\", \"required\": false},
    {\"name\": \"team\", \"type\": \"relation\", \"required\": false, \"collectionId\": \"$TEAMS_ID\", \"maxSelect\": 1},
    {\"name\": \"season\", \"type\": \"relation\", \"required\": false, \"collectionId\": \"$SEASONS_ID\", \"maxSelect\": 1},
    {\"name\": \"template\", \"type\": \"text\", \"required\": false},
    {\"name\": \"status\", \"type\": \"select\", \"required\": false, \"values\": [\"open\",\"active\",\"closed\"], \"maxSelect\": 1},
    {\"name\": \"content\", \"type\": \"editor\", \"required\": false},
    {\"name\": \"created_by\", \"type\": \"relation\", \"required\": false, \"collectionId\": \"_pb_users_auth_\", \"maxSelect\": 1},
    {\"name\": \"trainer\", \"type\": \"relation\", \"required\": false, \"collectionId\": \"_pb_users_auth_\", \"maxSelect\": 10},
    {\"name\": \"checkout_question\", \"type\": \"text\", \"required\": false},
    {\"name\": \"duration_minutes\", \"type\": \"number\", \"required\": false, \"onlyInt\": true, \"min\": 0, \"max\": 480},
    {\"name\": \"location\", \"type\": \"text\", \"required\": false}
  ],
  \"listRule\": \"@request.auth.id != \\\"\\\"\",
  \"viewRule\": \"@request.auth.id != \\\"\\\"\",
  \"createRule\": \"@request.auth.id != \\\"\\\"\",
  \"updateRule\": \"@request.auth.id != \\\"\\\"\",
  \"deleteRule\": \"@request.auth.id != \\\"\\\"\"
}"

TRAININGS_ID=$(get_col_id "trainings")

# === 7. Training Attendance ===
ensure_collection "{
  \"name\": \"training_attendance\",
  \"type\": \"base\",
  \"fields\": [
    {\"name\": \"training\", \"type\": \"relation\", \"required\": true, \"collectionId\": \"$TRAININGS_ID\", \"maxSelect\": 1},
    {\"name\": \"player\", \"type\": \"relation\", \"required\": true, \"collectionId\": \"$PLAYERS_ID\", \"maxSelect\": 1},
    {\"name\": \"status\", \"type\": \"select\", \"required\": true, \"values\": [\"present\",\"sick\",\"school\",\"absent\",\"late\",\"injured\"], \"maxSelect\": 1},
    {\"name\": \"reason\", \"type\": \"text\", \"required\": false},
    {\"name\": \"player_rating\", \"type\": \"number\", \"required\": false},
    {\"name\": \"player_notes\", \"type\": \"text\", \"required\": false},
    {\"name\": \"happiness\", \"type\": \"number\", \"required\": false},
    {\"name\": \"fitness\", \"type\": \"number\", \"required\": false},
    {\"name\": \"checkout_selected\", \"type\": \"bool\", \"required\": false},
    {\"name\": \"checkout_answer\", \"type\": \"text\", \"required\": false}
  ],
  \"listRule\": \"@request.auth.id != \\\"\\\"\",
  \"viewRule\": \"@request.auth.id != \\\"\\\"\",
  \"createRule\": \"@request.auth.id != \\\"\\\"\",
  \"updateRule\": \"@request.auth.id != \\\"\\\"\",
  \"deleteRule\": \"@request.auth.id != \\\"\\\"\"
}"

# Ensure existing installs (created before "school" was added) get the new status value.
ensure_select_values "training_attendance" "status" '["present","sick","school","absent","late","injured"]'

# === 8. Matches ===
ensure_collection "{
  \"name\": \"matches\",
  \"type\": \"base\",
  \"fields\": [
    {\"name\": \"date\", \"type\": \"date\", \"required\": true},
    {\"name\": \"opponent\", \"type\": \"text\", \"required\": true},
    {\"name\": \"status\", \"type\": \"select\", \"required\": false, \"values\": [\"open\",\"played\"], \"maxSelect\": 1},
    {\"name\": \"home_away\", \"type\": \"select\", \"required\": false, \"values\": [\"home\",\"away\"], \"maxSelect\": 1},
    {\"name\": \"score_team\", \"type\": \"number\", \"required\": false},
    {\"name\": \"score_opponent\", \"type\": \"number\", \"required\": false},
    {\"name\": \"set_scores\", \"type\": \"json\", \"required\": false},
    {\"name\": \"general_notes\", \"type\": \"text\", \"required\": false},
    {\"name\": \"team\", \"type\": \"relation\", \"required\": false, \"collectionId\": \"$TEAMS_ID\", \"maxSelect\": 1},
    {\"name\": \"season\", \"type\": \"relation\", \"required\": false, \"collectionId\": \"$SEASONS_ID\", \"maxSelect\": 1},
    {\"name\": \"lineups\", \"type\": \"json\", \"required\": false},
    {\"name\": \"game_system\", \"type\": \"json\", \"required\": false},
    {\"name\": \"substitutions\", \"type\": \"json\", \"required\": false},
    {\"name\": \"timeouts\", \"type\": \"json\", \"required\": false},
    {\"name\": \"created_by\", \"type\": \"relation\", \"required\": false, \"collectionId\": \"_pb_users_auth_\", \"maxSelect\": 1},
    {\"name\": \"location\", \"type\": \"text\", \"required\": false},
    {\"name\": \"nevobo_uuid\", \"type\": \"text\", \"required\": false},
    {\"name\": \"nevobo_code\", \"type\": \"text\", \"required\": false},
    {\"name\": \"coach\", \"type\": \"relation\", \"required\": false, \"collectionId\": \"_pb_users_auth_\", \"maxSelect\": 10}
  ],
  \"listRule\": \"@request.auth.id != \\\"\\\"\",
  \"viewRule\": \"@request.auth.id != \\\"\\\"\",
  \"createRule\": \"@request.auth.id != \\\"\\\"\",
  \"updateRule\": \"@request.auth.id != \\\"\\\"\",
  \"deleteRule\": \"@request.auth.id != \\\"\\\"\"
}"

MATCHES_ID=$(get_col_id "matches")

# === 9. Match Player Stats ===
ensure_collection "{
  \"name\": \"match_player_stats\",
  \"type\": \"base\",
  \"fields\": [
    {\"name\": \"match\", \"type\": \"relation\", \"required\": true, \"collectionId\": \"$MATCHES_ID\", \"maxSelect\": 1},
    {\"name\": \"player\", \"type\": \"relation\", \"required\": true, \"collectionId\": \"$PLAYERS_ID\", \"maxSelect\": 1},
    {\"name\": \"position_points\", \"type\": \"json\", \"required\": false},
    {\"name\": \"playing_time\", \"type\": \"number\", \"required\": false},
    {\"name\": \"notes\", \"type\": \"text\", \"required\": false}
  ],
  \"listRule\": \"@request.auth.id != \\\"\\\"\",
  \"viewRule\": \"@request.auth.id != \\\"\\\"\",
  \"createRule\": \"@request.auth.id != \\\"\\\"\",
  \"updateRule\": \"@request.auth.id != \\\"\\\"\",
  \"deleteRule\": \"@request.auth.id != \\\"\\\"\"
}"

# === 10. Team Players ===
ensure_collection "{
  \"name\": \"team_players\",
  \"type\": \"base\",
  \"fields\": [
    {\"name\": \"team\", \"type\": \"relation\", \"required\": true, \"collectionId\": \"$TEAMS_ID\", \"maxSelect\": 1},
    {\"name\": \"season\", \"type\": \"relation\", \"required\": true, \"collectionId\": \"$SEASONS_ID\", \"maxSelect\": 1},
    {\"name\": \"player\", \"type\": \"relation\", \"required\": true, \"collectionId\": \"$PLAYERS_ID\", \"maxSelect\": 1}
  ],
  \"listRule\": \"@request.auth.id != \\\"\\\"\",
  \"viewRule\": \"@request.auth.id != \\\"\\\"\",
  \"createRule\": \"@request.auth.id != \\\"\\\"\",
  \"updateRule\": \"@request.auth.id != \\\"\\\"\",
  \"deleteRule\": \"@request.auth.id != \\\"\\\"\"
}"

# === 10b. Match Attendance ===
MATCHES_ID=$(get_col_id "matches")
ensure_collection "{
  \"name\": \"match_attendance\",
  \"type\": \"base\",
  \"fields\": [
    {\"name\": \"match\", \"type\": \"relation\", \"required\": true, \"collectionId\": \"$MATCHES_ID\", \"maxSelect\": 1},
    {\"name\": \"player\", \"type\": \"relation\", \"required\": true, \"collectionId\": \"$PLAYERS_ID\", \"maxSelect\": 1},
    {\"name\": \"status\", \"type\": \"select\", \"required\": true, \"values\": [\"present\",\"sick\",\"school\",\"absent\",\"late\",\"injured\"], \"maxSelect\": 1},
    {\"name\": \"reason\", \"type\": \"text\", \"required\": false}
  ],
  \"listRule\": \"@request.auth.id != \\\"\\\"\",
  \"viewRule\": \"@request.auth.id != \\\"\\\"\",
  \"createRule\": \"@request.auth.id != \\\"\\\"\",
  \"updateRule\": \"@request.auth.id != \\\"\\\"\",
  \"deleteRule\": \"@request.auth.id != \\\"\\\"\"
}"

# Ensure existing installs (created before "school"/"late" were added) get the new status values.
ensure_select_values "match_attendance" "status" '["present","sick","school","absent","late","injured"]'

# === 10c. Questionnaires ===
# A coach-built questionnaire for a team: a name + a list of questions (text/
# choice/scale, stored as JSON since the question set is fully dynamic).
ensure_collection "{
  \"name\": \"questionnaires\",
  \"type\": \"base\",
  \"fields\": [
    {\"name\": \"team\", \"type\": \"relation\", \"required\": true, \"collectionId\": \"$TEAMS_ID\", \"maxSelect\": 1},
    {\"name\": \"name\", \"type\": \"text\", \"required\": true},
    {\"name\": \"status\", \"type\": \"select\", \"required\": true, \"values\": [\"draft\",\"active\",\"closed\"], \"maxSelect\": 1},
    {\"name\": \"questions\", \"type\": \"json\", \"required\": false},
    {\"name\": \"created_by\", \"type\": \"relation\", \"required\": false, \"collectionId\": \"_pb_users_auth_\", \"maxSelect\": 1}
  ],
  \"listRule\": \"@request.auth.id != \\\"\\\"\",
  \"viewRule\": \"@request.auth.id != \\\"\\\"\",
  \"createRule\": \"@request.auth.id != \\\"\\\"\",
  \"updateRule\": \"@request.auth.id != \\\"\\\"\",
  \"deleteRule\": \"@request.auth.id != \\\"\\\"\"
}"

QUESTIONNAIRES_ID=$(get_col_id "questionnaires")

# === 10d. Questionnaire Responses ===
# One record per player per questionnaire — answers keyed by question id.
# Players can only ever have one response per questionnaire (upserted).
ensure_collection "{
  \"name\": \"questionnaire_responses\",
  \"type\": \"base\",
  \"fields\": [
    {\"name\": \"questionnaire\", \"type\": \"relation\", \"required\": true, \"collectionId\": \"$QUESTIONNAIRES_ID\", \"maxSelect\": 1},
    {\"name\": \"player\", \"type\": \"relation\", \"required\": true, \"collectionId\": \"$PLAYERS_ID\", \"maxSelect\": 1},
    {\"name\": \"answers\", \"type\": \"json\", \"required\": false}
  ],
  \"listRule\": \"@request.auth.id != \\\"\\\"\",
  \"viewRule\": \"@request.auth.id != \\\"\\\"\",
  \"createRule\": \"@request.auth.id != \\\"\\\"\",
  \"updateRule\": \"@request.auth.id != \\\"\\\"\",
  \"deleteRule\": \"@request.auth.id != \\\"\\\"\"
}"

# === 11. Team Access ===
ensure_collection "{
  \"name\": \"team_access\",
  \"type\": \"base\",
  \"fields\": [
    {\"name\": \"user\", \"type\": \"relation\", \"required\": true, \"collectionId\": \"_pb_users_auth_\", \"maxSelect\": 1},
    {\"name\": \"team\", \"type\": \"relation\", \"required\": true, \"collectionId\": \"$TEAMS_ID\", \"maxSelect\": 1},
    {\"name\": \"role\", \"type\": \"select\", \"required\": true, \"values\": [\"admin\",\"user\",\"viewer\"], \"maxSelect\": 1},
    {\"name\": \"is_trainer\", \"type\": \"bool\", \"required\": false},
    {\"name\": \"is_player\", \"type\": \"bool\", \"required\": false},
    {\"name\": \"is_parent\", \"type\": \"bool\", \"required\": false}
  ],
  \"listRule\": \"@request.auth.id != \\\"\\\"\",
  \"viewRule\": \"@request.auth.id != \\\"\\\"\",
  \"createRule\": \"@request.auth.id != \\\"\\\"\",
  \"updateRule\": \"@request.auth.id != \\\"\\\"\",
  \"deleteRule\": \"@request.auth.id != \\\"\\\"\"
}"

# === 12. Training Templates ===
ensure_collection "{
  \"name\": \"training_templates\",
  \"type\": \"base\",
  \"fields\": [
    {\"name\": \"name\", \"type\": \"text\", \"required\": true},
    {\"name\": \"type\", \"type\": \"select\", \"required\": false, \"values\": [\"serve\",\"pass\",\"attack\",\"block\",\"defense\",\"setting\",\"all_round\",\"game\",\"conditioning\"], \"maxSelect\": 1},
    {\"name\": \"content\", \"type\": \"editor\", \"required\": false},
    {\"name\": \"notes\", \"type\": \"text\", \"required\": false},
    {\"name\": \"team\", \"type\": \"relation\", \"required\": false, \"collectionId\": \"$TEAMS_ID\", \"maxSelect\": 1},
    {\"name\": \"season\", \"type\": \"relation\", \"required\": false, \"collectionId\": \"$SEASONS_ID\", \"maxSelect\": 1}
  ],
  \"listRule\": \"@request.auth.id != \\\"\\\"\",
  \"viewRule\": \"@request.auth.id != \\\"\\\"\",
  \"createRule\": \"@request.auth.id != \\\"\\\"\",
  \"updateRule\": \"@request.auth.id != \\\"\\\"\",
  \"deleteRule\": \"@request.auth.id != \\\"\\\"\"
}"

# === 13. Training Plan ===
ensure_collection "{
  \"name\": \"training_plan\",
  \"type\": \"base\",
  \"fields\": [
    {\"name\": \"date\", \"type\": \"date\", \"required\": true},
    {\"name\": \"template\", \"type\": \"text\", \"required\": false},
    {\"name\": \"title\", \"type\": \"text\", \"required\": false},
    {\"name\": \"content\", \"type\": \"editor\", \"required\": false},
    {\"name\": \"notes\", \"type\": \"text\", \"required\": false},
    {\"name\": \"team\", \"type\": \"relation\", \"required\": false, \"collectionId\": \"$TEAMS_ID\", \"maxSelect\": 1},
    {\"name\": \"season\", \"type\": \"relation\", \"required\": false, \"collectionId\": \"$SEASONS_ID\", \"maxSelect\": 1}
  ],
  \"listRule\": \"@request.auth.id != \\\"\\\"\",
  \"viewRule\": \"@request.auth.id != \\\"\\\"\",
  \"createRule\": \"@request.auth.id != \\\"\\\"\",
  \"updateRule\": \"@request.auth.id != \\\"\\\"\",
  \"deleteRule\": \"@request.auth.id != \\\"\\\"\"
}"

# === 14. Season Periods (Periodization) ===
ensure_collection "{
  \"name\": \"season_periods\",
  \"type\": \"base\",
  \"fields\": [
    {\"name\": \"name\", \"type\": \"text\", \"required\": true},
    {\"name\": \"phase\", \"type\": \"select\", \"required\": false, \"values\": [\"preparation\",\"competition_1\",\"winter_break\",\"competition_2\",\"playoffs\",\"off_season\"], \"maxSelect\": 1},
    {\"name\": \"start_date\", \"type\": \"date\", \"required\": true},
    {\"name\": \"end_date\", \"type\": \"date\", \"required\": true},
    {\"name\": \"goals_technical\", \"type\": \"text\", \"required\": false},
    {\"name\": \"goals_tactical\", \"type\": \"text\", \"required\": false},
    {\"name\": \"goals_physical\", \"type\": \"text\", \"required\": false},
    {\"name\": \"goals_mental\", \"type\": \"text\", \"required\": false},
    {\"name\": \"notes\", \"type\": \"text\", \"required\": false},
    {\"name\": \"team\", \"type\": \"relation\", \"required\": false, \"collectionId\": \"$TEAMS_ID\", \"maxSelect\": 1},
    {\"name\": \"season\", \"type\": \"relation\", \"required\": false, \"collectionId\": \"$SEASONS_ID\", \"maxSelect\": 1}
  ],
  \"listRule\": \"@request.auth.id != \\\"\\\"\",
  \"viewRule\": \"@request.auth.id != \\\"\\\"\",
  \"createRule\": \"@request.auth.id != \\\"\\\"\",
  \"updateRule\": \"@request.auth.id != \\\"\\\"\",
  \"deleteRule\": \"@request.auth.id != \\\"\\\"\"
}"

# === 15. Invitations ===
ensure_collection "{
  \"name\": \"invitations\",
  \"type\": \"base\",
  \"fields\": [
    {\"name\": \"email\", \"type\": \"email\", \"required\": true},
    {\"name\": \"token\", \"type\": \"text\", \"required\": true},
    {\"name\": \"club\", \"type\": \"relation\", \"required\": true, \"collectionId\": \"$CLUBS_ID\", \"maxSelect\": 1},
    {\"name\": \"role\", \"type\": \"select\", \"required\": true, \"values\": [\"admin\",\"user\",\"viewer\"], \"maxSelect\": 1},
    {\"name\": \"status\", \"type\": \"select\", \"required\": true, \"values\": [\"pending\",\"accepted\",\"expired\"], \"maxSelect\": 1},
    {\"name\": \"invited_by\", \"type\": \"relation\", \"required\": false, \"collectionId\": \"_pb_users_auth_\", \"maxSelect\": 1},
    {\"name\": \"expires_at\", \"type\": \"date\", \"required\": true}
  ],
  \"listRule\": \"id != \\\"\\\"\",
  \"viewRule\": \"id != \\\"\\\"\",
  \"createRule\": \"@request.auth.id != \\\"\\\"\",
  \"updateRule\": \"@request.auth.id != \\\"\\\"\",
  \"deleteRule\": \"@request.auth.id != \\\"\\\"\"
}"

# Legacy installs required the (now removed from the definition above, but
# never dropped) "team" field and only allowed admin/coach/player as role
# values. Loosen "team" so it's no longer required and fix the role select so
# admin/user/viewer invites actually validate.
INVITATIONS_FIELDS=$(curl -sf "$PB_URL/api/collections/invitations" -H "Authorization: Bearer $TOKEN" | jq -c '.fields')
NEEDS_INVITATIONS_FIX=$(echo "$INVITATIONS_FIELDS" | jq '
  (map(select(.name == "team" and .required == true)) | length > 0)
  or (map(select(.name == "role")) | (.[0].values // []) != ["admin","user","viewer"])
')
if [ "$NEEDS_INVITATIONS_FIX" = "true" ]; then
  echo "  🔄 Fixing legacy invitations fields (team optional, role values)"
  FIXED_INVITATIONS_FIELDS=$(echo "$INVITATIONS_FIELDS" | jq -c '
    map(
      if .name == "team" then . + {"required": false}
      elif .name == "role" then . + {"values": ["admin","user","viewer"]}
      else . end
    )
  ')
  curl -sf -X PATCH "$PB_URL/api/collections/invitations" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"fields\": $FIXED_INVITATIONS_FIELDS}" > /dev/null \
    && echo "  ✓ invitations fields fixed" || echo "  ⚠️ Could not fix invitations fields"
fi

echo ""
echo "🔐 Configuring Google OAuth..."

# === 16. Player Availability (deprecated) ===
# player_availability was merged into training_attendance/match_attendance —
# players now write their own planned status directly into those collections
# using the same 6-status set the trainer uses. This collection is no longer
# provisioned for new installs. Existing installs that already have it are
# left untouched (harmless orphan) rather than dropped automatically.

# Set PocketBase application URL for OAuth redirects
SITE_URL="${SITE_URL:-}"
if [ -n "$SITE_URL" ]; then
  curl -sf "$PB_URL/api/settings" -X PATCH \
    -H "Authorization: $TOKEN" -H "Content-Type: application/json" \
    -d "{\"meta\": {\"appURL\": \"$SITE_URL\"}, \"trustedProxy\": {\"headers\": [\"X-Forwarded-For\", \"X-Forwarded-Proto\", \"X-Forwarded-Host\"], \"useLeftmostIP\": true}}" > /dev/null && echo "  ✓ App URL set to $SITE_URL (with trusted proxy)" || echo "  ⚠ Could not set app URL (older PB version?)"
fi

# Configure OAuth if env vars are set
GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-}"
GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET:-}"

if [ -n "$GOOGLE_CLIENT_ID" ] && [ -n "$GOOGLE_CLIENT_SECRET" ]; then
  # Enable OAuth2 on users collection via direct PATCH
  OAUTH_BODY=$(cat <<EOJSON
{
  "oauth2": {
    "enabled": true,
    "mappedFields": {"id": "", "name": "name", "avatarURL": "avatar"},
    "providers": [{"name": "google", "clientId": "$GOOGLE_CLIENT_ID", "clientSecret": "$GOOGLE_CLIENT_SECRET", "authURL": "", "tokenURL": "", "displayName": "Google", "pkce": null}]
  }
}
EOJSON
)
  curl -sf "$PB_URL/api/collections/users" -X PATCH \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "$OAUTH_BODY" > /dev/null && echo "  ✓ Google OAuth enabled" || echo "  ✗ OAuth configuration failed"
else
  echo "  ⚠ Skipped (set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars)"
fi

echo ""
echo "🏛  Seeding clubs..."

# Idempotent club creation; echoes the club id on stdout
ensure_club() {
  local NAME="$1"
  local SHORT="$2"
  local EXISTING=$(curl -sf --get "$PB_URL/api/collections/clubs/records" \
    --data-urlencode "filter=name='$NAME'" --data-urlencode "perPage=1" \
    -H "Authorization: Bearer $TOKEN" | jq -r '.items[0].id // empty')

  if [ -n "$EXISTING" ]; then
    echo "  ✓ Club '$NAME' exists ($EXISTING)" >&2
    echo "$EXISTING"
  else
    local CREATED=$(curl -sf "$PB_URL/api/collections/clubs/records" -X POST \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      -d "{\"name\":\"$NAME\",\"short_name\":\"$SHORT\"}" | jq -r '.id')
    echo "  ✓ Club '$NAME' created ($CREATED)" >&2
    echo "$CREATED"
  fi
}

ZOVOC_ID=$(ensure_club "Zovoc" "ZOVOC")
ZVH_ID=$(ensure_club "ZVH" "ZVH")

echo ""
echo "🏐 Seeding default team & season..."

# Create default team if none exists
TEAM_COUNT=$(curl -sf "$PB_URL/api/collections/teams/records?perPage=1" \
  -H "Authorization: Bearer $TOKEN" | jq -r ".totalItems // 0")

if [ "$TEAM_COUNT" = "0" ]; then
  TEAM_ID=$(curl -sf "$PB_URL/api/collections/teams/records" -X POST \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"name\":\"Zovoc MB1\",\"club\":\"$ZOVOC_ID\"}" | jq -r '.id')
  echo "  ✓ Team 'Zovoc MB1' created ($TEAM_ID)"
else
  echo "  ✓ Team exists (skipped)"
fi

# Link teams without a club, matching the club name against the team name
ORPHAN_TEAMS=$(curl -sf --get "$PB_URL/api/collections/teams/records" \
  --data-urlencode "filter=club=''" --data-urlencode "perPage=200" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.items[] | "\(.id)|\(.name)"')

if [ -n "$ORPHAN_TEAMS" ]; then
  echo "$ORPHAN_TEAMS" | while IFS='|' read -r T TNAME; do
    [ -z "$T" ] && continue
    CLUB_ID="$ZOVOC_ID"
    CLUB_NAME="Zovoc"
    case "$(echo "$TNAME" | tr '[:upper:]' '[:lower:]')" in
      zvh*) CLUB_ID="$ZVH_ID"; CLUB_NAME="ZVH" ;;
    esac
    [ -z "$CLUB_ID" ] && continue
    curl -sf -X PATCH "$PB_URL/api/collections/teams/records/$T" \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      -d "{\"club\":\"$CLUB_ID\"}" > /dev/null && echo "  ✓ Team '$TNAME' linked to $CLUB_NAME"
  done
else
  echo "  ✓ All teams already linked to a club"
fi

# Create default season if none exists
SEASON_COUNT=$(curl -sf "$PB_URL/api/collections/seasons/records?perPage=1" \
  -H "Authorization: Bearer $TOKEN" | jq -r ".totalItems // 0")

if [ "$SEASON_COUNT" = "0" ]; then
  curl -sf "$PB_URL/api/collections/seasons/records" -X POST \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"name":"2026-2027","start_year":2026,"end_year":2027}' > /dev/null
  echo "  ✓ Seizoen '2026-2027' created"
else
  echo "  ✓ Seizoen exists (skipped)"
fi

echo ""
echo "🔄 Migrating team_access naar club_access..."

# team_access granted a role per team. Access is now granted per club (which
# covers every team under it), so fold each user's team_access records into
# one club_access record per club they had any team access in, keeping the
# highest role and OR-ing the trainer/player/parent flags. Idempotent: a user
# who already has a club_access record for that club is left untouched.
TEAM_CLUB_MAP=$(curl -sf --get "$PB_URL/api/collections/teams/records" \
  --data-urlencode "perPage=200" -H "Authorization: Bearer $TOKEN" \
  | jq -c '[.items[] | select(.club != "") | {(.id): .club}] | add // {}')

ALL_TEAM_ACCESS=$(curl -sf --get "$PB_URL/api/collections/team_access/records" \
  --data-urlencode "perPage=500" -H "Authorization: Bearer $TOKEN" | jq -c '.items')

MIGRATIONS=$(jq -n --argjson teamClub "$TEAM_CLUB_MAP" --argjson access "$ALL_TEAM_ACCESS" '
  def roleRank: {"admin":3,"user":2,"viewer":1}[.] // 0;
  [$access[]
    | . as $a
    | ($teamClub[$a.team] // null) as $club
    | select($club != null)
    | {user: $a.user, club: $club, role: $a.role, is_trainer: ($a.is_trainer // false), is_player: ($a.is_player // false), is_parent: ($a.is_parent // false)}
  ]
  | group_by(.user + "|" + .club)
  | map({
      user: .[0].user,
      club: .[0].club,
      role: (reduce .[] as $x (""; if ($x.role | roleRank) > (. | roleRank) then $x.role else . end)),
      is_trainer: (map(.is_trainer) | any),
      is_player: (map(.is_player) | any),
      is_parent: (map(.is_parent) | any)
    })
')

MIGRATED_COUNT=0
while IFS= read -r ROW; do
  [ -z "$ROW" ] && continue
  U=$(echo "$ROW" | jq -r '.user')
  C=$(echo "$ROW" | jq -r '.club')
  EXISTING=$(curl -sf --get "$PB_URL/api/collections/club_access/records" \
    --data-urlencode "filter=user='$U' && club='$C'" --data-urlencode "perPage=1" \
    -H "Authorization: Bearer $TOKEN" | jq -r '.items[0].id // empty')
  if [ -z "$EXISTING" ]; then
    curl -sf "$PB_URL/api/collections/club_access/records" -X POST \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      -d "$ROW" > /dev/null && MIGRATED_COUNT=$((MIGRATED_COUNT + 1))
  fi
done < <(echo "$MIGRATIONS" | jq -c '.[]')
echo "  ✓ $MIGRATED_COUNT club_access record(s) migrated (idempotent, skips existing)"

OWNER_EMAIL="${OWNER_EMAIL:-}"
if [ -n "$OWNER_EMAIL" ]; then
  echo ""
  echo "👑 Granting admin access to $OWNER_EMAIL..."
  OWNER_ID=$(curl -sf --get "$PB_URL/api/collections/users/records" \
    --data-urlencode "filter=email='$OWNER_EMAIL'" --data-urlencode "perPage=1" \
    -H "Authorization: Bearer $TOKEN" | jq -r '.items[0].id // empty')

  if [ -z "$OWNER_ID" ]; then
    echo "  ⚠ User $OWNER_EMAIL not found, skipped"
  else
    ALL_CLUBS=$(curl -sf --get "$PB_URL/api/collections/clubs/records" \
      --data-urlencode "perPage=200" \
      -H "Authorization: Bearer $TOKEN" | jq -r '.items[] | "\(.id)|\(.name)"')

    echo "$ALL_CLUBS" | while IFS='|' read -r CID CNAME; do
      [ -z "$CID" ] && continue
      EXISTING=$(curl -sf --get "$PB_URL/api/collections/club_access/records" \
        --data-urlencode "filter=user='$OWNER_ID' && club='$CID'" --data-urlencode "perPage=1" \
        -H "Authorization: Bearer $TOKEN" | jq -r '.items[0].id // empty')

      if [ -z "$EXISTING" ]; then
        curl -sf "$PB_URL/api/collections/club_access/records" -X POST \
          -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
          -d "{\"user\":\"$OWNER_ID\",\"club\":\"$CID\",\"role\":\"admin\"}" > /dev/null \
          && echo "  ✓ Admin access on '$CNAME' granted"
      else
        curl -sf -X PATCH "$PB_URL/api/collections/club_access/records/$EXISTING" \
          -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
          -d '{"role":"admin"}' > /dev/null \
          && echo "  ✓ Admin access on '$CNAME' confirmed"
      fi
    done
  fi
fi

SETBAAS_ADMIN_EMAIL="${SETBAAS_ADMIN_EMAIL:-}"
SETBAAS_ADMIN_PASSWORD="${SETBAAS_ADMIN_PASSWORD:-}"
if [ -n "$SETBAAS_ADMIN_EMAIL" ] && [ -n "$SETBAAS_ADMIN_PASSWORD" ]; then
  echo ""
  echo "🛡️  Ensuring built-in setbaas-admin account ($SETBAAS_ADMIN_EMAIL)..."
  EXISTING_SETBAAS_ADMIN=$(curl -sf --get "$PB_URL/api/collections/users/records" \
    --data-urlencode "filter=email='$SETBAAS_ADMIN_EMAIL'" --data-urlencode "perPage=1" \
    -H "Authorization: Bearer $TOKEN" | jq -r '.items[0].id // empty')

  if [ -z "$EXISTING_SETBAAS_ADMIN" ]; then
    curl -sf "$PB_URL/api/collections/users/records" -X POST \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      -d "{\"email\":\"$SETBAAS_ADMIN_EMAIL\",\"password\":\"$SETBAAS_ADMIN_PASSWORD\",\"passwordConfirm\":\"$SETBAAS_ADMIN_PASSWORD\",\"name\":\"SetBaas Admin\",\"verified\":true,\"emailVisibility\":true,\"is_platform_admin\":true}" > /dev/null \
      && echo "  ✓ SetBaas admin account created" || echo "  ⚠️ Could not create setbaas-admin account"
  else
    curl -sf -X PATCH "$PB_URL/api/collections/users/records/$EXISTING_SETBAAS_ADMIN" \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      -d '{"is_platform_admin":true,"verified":true}' > /dev/null \
      && echo "  ✓ SetBaas admin account confirmed (flagged as platform admin)" || echo "  ⚠️ Could not update setbaas-admin account"
  fi
fi

echo ""
echo "🏁 Backfilling match status..."

# Matches without a status get one based on their date: anything in the past is
# considered played, everything else stays open.
backfill_match_status() {
  local FILTER="$1"
  local STATUS="$2"
  local IDS=$(curl -sf --get "$PB_URL/api/collections/matches/records" \
    --data-urlencode "filter=$FILTER" --data-urlencode "perPage=500" \
    -H "Authorization: Bearer $TOKEN" | jq -r '.items[]?.id')

  local COUNT=0
  for ID in $IDS; do
    curl -sf -X PATCH "$PB_URL/api/collections/matches/records/$ID" \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      -d "{\"status\":\"$STATUS\"}" > /dev/null && COUNT=$((COUNT + 1))
  done
  echo "$COUNT"
}

PLAYED_COUNT=$(backfill_match_status "status='' && date < @now" "played")
OPEN_COUNT=$(backfill_match_status "status='' && date >= @now" "open")
echo "  ✓ $PLAYED_COUNT gespeeld, $OPEN_COUNT open"


# =============================================================================
# API rules — enforce the permission model server side
# =============================================================================
# The app has two orthogonal concepts. "Permission" (club_access.role) says what
# you may do: admin = everything including configuration and the roster, user =
# record trainings/matches/competency scores, viewer = read only. "Role"
# (is_trainer/is_player/is_parent) only decides which dashboard you see and is
# deliberately NOT a permission.
#
# Hiding a button in the UI is not access control — without these rules any
# logged-in user can still write through the REST API directly.
#
# The checks start from the authenticated record via a back-relation
# (@request.auth.club_access_via_user). That correlation matters: the naive
# form "@collection.club_access.user ?= @request.auth.id &&
# @collection.club_access.role ?= \"admin\"" is UNSAFE, because PocketBase
# evaluates both conditions independently over the whole collection — so any
# user passes as soon as some admin row exists anywhere.
echo ""
echo "🔒 Applying permission rules..."

AUTHED='@request.auth.id != ""'
RULE_ADMIN='@request.auth.club_access_via_user.role ?= "admin"'
RULE_EDIT='@request.auth.club_access_via_user.role ?= "admin" || @request.auth.club_access_via_user.role ?= "user"'
# Players must always be able to maintain their own attendance and answers,
# even when their permission is "viewer".
RULE_EDIT_OR_SELF="$RULE_EDIT"' || player.user_id = @request.auth.id'

# Preflight: a syntactically invalid rule is rejected (safe), but an unsupported
# back-relation that is silently accepted and always evaluates false would lock
# everyone out. Verify on a scratch collection before touching anything real.
verify_rule_support() {
  local PROBE="_rule_probe_$$"
  curl -sf "$PB_URL/api/collections" -X POST \
    -H "Authorization: $TOKEN" -H "Content-Type: application/json" \
    -d "$(jq -n --arg n "$PROBE" '{name:$n, type:"base", fields:[{name:"dummy",type:"text"}]}')" \
    > /dev/null 2>&1 || return 1

  local CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$PB_URL/api/collections/$PROBE" \
    -H "Authorization: $TOKEN" -H "Content-Type: application/json" \
    -d "$(jq -n --arg r "$RULE_ADMIN" '{listRule:$r}')")

  curl -sf -X DELETE "$PB_URL/api/collections/$PROBE" \
    -H "Authorization: $TOKEN" > /dev/null 2>&1

  [ "$CODE" = "200" ]
}

# Usage: apply_rules <collection> <list> <view> <create> <update> <delete>
# Built with jq so the expressions never need manual JSON escaping.
apply_rules() {
  local NAME="$1"
  curl -sf -o /dev/null "$PB_URL/api/collections/$NAME" -H "Authorization: $TOKEN" || return 0
  local BODY=$(jq -n --arg l "$2" --arg v "$3" --arg c "$4" --arg u "$5" --arg d "$6" \
    '{listRule:$l, viewRule:$v, createRule:$c, updateRule:$u, deleteRule:$d}')
  if curl -sf -o /dev/null -X PATCH "$PB_URL/api/collections/$NAME" \
      -H "Authorization: $TOKEN" -H "Content-Type: application/json" -d "$BODY"; then
    echo "  ✓ $NAME"
  else
    echo "  ⚠️ Could not apply rules for $NAME"
  fi
}

if ! verify_rule_support; then
  echo "  ⚠️ This PocketBase build does not accept back-relation rules."
  echo "     Skipping — permissions stay enforced in the frontend only."
else
  # Configuration and the roster: admin writes, everyone reads.
  for COL in clubs teams seasons players competencies club_access team_access training_templates; do
    apply_rules "$COL" "$AUTHED" "$AUTHED" "$RULE_ADMIN" "$RULE_ADMIN" "$RULE_ADMIN"
  done

  # Day-to-day recording: admins and users write, viewers read.
  for COL in trainings training_plan matches match_player_stats team_players \
             player_competencies season_periods questionnaires; do
    apply_rules "$COL" "$AUTHED" "$AUTHED" "$RULE_EDIT" "$RULE_EDIT" "$RULE_EDIT"
  done

  # Invitations carry the role that will be granted, so they are admin-only in
  # every direction. Invitees never touch them directly: /api/invite/accept
  # looks the token up and grants club_access with superuser rights.
  apply_rules invitations "$RULE_ADMIN" "$RULE_ADMIN" "$RULE_ADMIN" "$RULE_ADMIN" "$RULE_ADMIN"

  # The AI key is club property and must never be listable from the browser.
  # Superuser-only: null rules. /api/ai/config is the single way in.
  if curl -sf -o /dev/null -X PATCH "$PB_URL/api/collections/club_ai_config" \
      -H "Authorization: $TOKEN" -H "Content-Type: application/json" \
      -d '{"listRule":null,"viewRule":null,"createRule":null,"updateRule":null,"deleteRule":null}'; then
    echo "  ✓ club_ai_config (superuser only)"
  else
    echo "  ⚠️ Could not lock down club_ai_config"
  fi

  # Own attendance and questionnaire answers stay writable for the player.
  for COL in training_attendance match_attendance questionnaire_responses; do
    apply_rules "$COL" "$AUTHED" "$AUTHED" "$RULE_EDIT_OR_SELF" "$RULE_EDIT_OR_SELF" "$RULE_EDIT_OR_SELF"
  done
fi

echo ""
echo "✅ Setup complete! All collections are ready."
