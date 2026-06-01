#!/usr/bin/env sh
# manage-firebase.sh — Manage Firestore rules and room data for Einsatzplaner.
#
# Run from the firebase/ directory (or from anywhere; the script cd's to its
# own directory so firebase.json is always found).
#
# Usage:
#   ./firebase/manage-firebase.sh <PROJECT_ID> <command> [args...]
#
# Commands:
#   help                       Show this help text.
#   deploy / deploy-rules      Deploy Firestore security rules.
#   list-rooms                 List all room codes stored in Firestore.
#   export-room  <ROOM_CODE>   Export a single room to a local JSON file.
#   import-room  <FILE>        Import a previously-exported room JSON file.
#   delete-room  <ROOM_CODE>   Delete all data under a room (irreversible!).
#
# Requirements:
#   npm install -g firebase-tools
#   firebase login
#
# For export/import, the Firebase Admin REST API is used via curl and Python 3.
# The access token is obtained via get-firebase-token.js (bundled next to this
# script), which reads the stored refresh_token from firebase-tools and
# exchanges it for a fresh access_token.
#
set -e

# Always run relative to this script's directory so firebase.json is found.
cd "$(dirname "$0")" || exit 1

# ── Helpers ──────────────────────────────────────────────────────────────────

die() { echo "Error: $*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "'$1' not found. Install it first."
}

# Print an access token for the currently logged-in Firebase / Google account.
firebase_token() {
  # get-firebase-token.js lives next to this script and refreshes the token
  # via the OAuth2 endpoint using the refresh_token stored by firebase-tools.
  _tok=$(node "$(dirname "$0")/get-firebase-token.js" 2>/dev/null)
  if [ -n "$_tok" ]; then echo "$_tok"; return 0; fi
  # Fallback for environments that have gcloud.
  _tok=$(gcloud auth print-access-token 2>/dev/null)
  if [ -n "$_tok" ]; then echo "$_tok"; return 0; fi
  die "Could not obtain access token. Run 'firebase login' or 'gcloud auth login'."
}

# Firestore REST base URL.
fs_url() {
  echo "https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents"
}

# ── Argument parsing ─────────────────────────────────────────────────────────

PROJECT="${1}"
COMMAND="${2}"
ARG1="${3}"

# Handle help without requiring PROJECT_ID
if [ "${PROJECT}" = "help" ] || [ "${PROJECT}" = "-h" ] || [ "${PROJECT}" = "--help" ]; then
  COMMAND="help"
  PROJECT=""
fi

[ -z "${PROJECT}" ] && [ "${COMMAND}" != "help" ] && { echo "Usage: $0 <firebase-project-id> <command> [args...]"; echo "Run '$0 help' for full usage."; exit 1; }
[ -z "${COMMAND}" ] && { echo "Usage: $0 <firebase-project-id> <command> [args...]"; echo "Run '$0 help' for full usage."; exit 1; }

# ── Commands ─────────────────────────────────────────────────────────────────

case "${COMMAND}" in

  deploy|deploy-rules)
    echo "Deploying Firestore rules to project: ${PROJECT}"
    firebase deploy \
      --only firestore:rules \
      --project "${PROJECT}" \
      --non-interactive
    echo "Done. Rules deployed."
    ;;

  list-rooms)
    require_cmd curl
    require_cmd python3
    echo "Listing rooms in project: ${PROJECT}"
    TOKEN=$(firebase_token)
    URL="$(fs_url)/rooms?pageSize=300"
    RESP=$(curl -sf -H "Authorization: Bearer ${TOKEN}" "${URL}") \
      || die "Firestore request failed."
    # Extract room code field names from the JSON.
    echo "${RESP}" | python3 -c "
import sys, json
data = json.load(sys.stdin)
docs = data.get('documents', [])
if not docs:
    print('  (no rooms found)')
else:
    for d in docs:
        # name ends in /rooms/<roomCode>
        print('  ' + d['name'].split('/')[-1])
print(f'Total: {len(docs)} room(s).')
"
    ;;

  export-room)
    require_cmd curl
    require_cmd python3
    [ -z "${ARG1}" ] && die "Usage: $0 <PROJECT_ID> export-room <ROOM_CODE>"
    ROOM="${ARG1}"
    OUTFILE="room-export-${ROOM}.json"
    echo "Exporting room ${ROOM} from project ${PROJECT} -> ${OUTFILE}"
    TOKEN=$(firebase_token)
    BASE="$(fs_url)"

    python3 - "${BASE}" "${TOKEN}" "${ROOM}" "${OUTFILE}" <<'PYEOF'
import sys, json
from urllib.request import urlopen, Request
from urllib.error import HTTPError

base, token, room, outfile = sys.argv[1:]
headers = {"Authorization": f"Bearer {token}"}

def get_all(url):
    docs = []
    while url:
        req = Request(url, headers=headers)
        try:
            with urlopen(req) as r:
                data = json.load(r)
        except HTTPError as e:
            sys.exit(f"HTTP {e.code} fetching {url}")
        docs.extend(data.get("documents", []))
        url = data.get("nextPageToken") and (url.split("?")[0] + "?pageSize=300&pageToken=" + data["nextPageToken"])
    return docs

# Collect meta, events, and activity for every year under this room.
result = {"room": room, "plans": {}}
plans_url = f"{base}/rooms/{room}/plans?pageSize=100"
plan_docs = get_all(plans_url)
for pd in plan_docs:
    year = pd["name"].split("/")[-1]
    plan_data = {"meta": None, "events": [], "activity": []}
    for coll in ("meta", "events", "activity"):
        coll_url = f"{base}/rooms/{room}/plans/{year}/{coll}?pageSize=500"
        plan_data[coll] = get_all(coll_url)
    result["plans"][year] = plan_data

with open(outfile, "w") as f:
    json.dump(result, f, indent=2)
print(f"Exported {len(result['plans'])} year(s) to {outfile}")
PYEOF
    ;;

  import-room)
    require_cmd curl
    require_cmd python3
    [ -z "${ARG1}" ] && die "Usage: $0 <PROJECT_ID> import-room <FILE>"
    INFILE="${ARG1}"
    [ -f "${INFILE}" ] || die "File not found: ${INFILE}"
    echo "Importing room data from ${INFILE} into project ${PROJECT}"
    TOKEN=$(firebase_token)
    BASE="$(fs_url)"

    python3 - "${BASE}" "${TOKEN}" "${INFILE}" <<'PYEOF'
import sys, json
from urllib.request import urlopen, Request
from urllib.error import HTTPError

base, token, infile = sys.argv[1:]
headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

with open(infile) as f:
    data = json.load(f)

room = data["room"]
total = 0
for year, plan in data["plans"].items():
    for coll in ("meta", "events", "activity"):
        for doc in plan.get(coll, []):
            # doc["name"] is the full resource path — extract the document ID.
            doc_id = doc["name"].split("/")[-1]
            url = f"{base}/rooms/{room}/plans/{year}/{coll}/{doc_id}"
            body = json.dumps({"fields": doc.get("fields", {})}).encode()
            req = Request(url, data=body, headers=headers, method="PATCH")
            try:
                with urlopen(req):
                    pass
                total += 1
            except HTTPError as e:
                print(f"  Warning: HTTP {e.code} writing {url}", file=sys.stderr)
print(f"Imported {total} document(s) for room {room}.")
PYEOF
    ;;

  delete-room)
    require_cmd firebase
    [ -z "${ARG1}" ] && die "Usage: $0 <PROJECT_ID> delete-room <ROOM_CODE>"
    ROOM="${ARG1}"
    echo "WARNING: This will permanently delete ALL data under room '${ROOM}'."
    printf "Type the room code to confirm: "
    read -r CONFIRM
    [ "${CONFIRM}" = "${ROOM}" ] || die "Confirmation did not match. Aborting."
    echo "Deleting room ${ROOM} from project ${PROJECT}..."
    # firebase firestore:delete recursively removes a document tree.
    firebase firestore:delete \
      --project "${PROJECT}" \
      --recursive \
      --yes \
      "/rooms/${ROOM}"
    echo "Room ${ROOM} deleted."
    ;;

  help|-h|--help)
    cat <<'EOF'
manage-firebase.sh — Manage Firestore rules and room data for Einsatzplaner

Usage:
  ./firebase/manage-firebase.sh <PROJECT_ID> <command> [args...]

Commands:
  help                       Show this help text.
  deploy / deploy-rules      Deploy Firestore security rules to the project.
  list-rooms                 List all room codes stored in Firestore.
  export-room  <ROOM_CODE>   Export a single room's plans to a JSON backup file.
  import-room  <FILE>        Restore a room from a previously-exported JSON file.
  delete-room  <ROOM_CODE>   Permanently delete all data under a room.

Examples:
  ./firebase/manage-firebase.sh my-project-id deploy
  ./firebase/manage-firebase.sh my-project-id list-rooms
  ./firebase/manage-firebase.sh my-project-id export-room xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  ./firebase/manage-firebase.sh my-project-id import-room room-export-xxxx.json
  ./firebase/manage-firebase.sh my-project-id delete-room xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

Requirements:
  npm install -g firebase-tools
  firebase login
  python3 (for export/import)
EOF
    ;;

  *)
    echo "Unknown command: ${COMMAND}" >&2
    echo "Run '$0 help' for usage." >&2
    exit 1
    ;;
esac
