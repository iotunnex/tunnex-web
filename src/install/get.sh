#!/bin/sh
# Tunnex installer — served at https://get.tunnex.io
#
#   curl -fsSL https://get.tunnex.io | sh
#
# Verify first if you would rather (and you should):
#
#   curl -fsSL https://get.tunnex.io -o get.sh
#   curl -fsSL https://get.tunnex.io/SHA256SUMS -o SHA256SUMS
#   sha256sum -c SHA256SUMS --ignore-missing
#   less get.sh && sh get.sh
#
# Non-interactive (every default taken, nothing asked):
#
#   curl -fsSL https://get.tunnex.io | TUNNEX_PUBLIC_ADDR=vpn.acme.com sh -s -- --yes
#
# ⛔ IT ASKS EVERYTHING FIRST, SHOWS WHAT IT WILL DO, AND ONLY THEN TOUCHES THE MACHINE.
#
# The first version interleaved questions with work: resolve a release, ask, download, ask again. That shape
# leaves a half-configured directory when someone changes their mind at question four, and it never gives
# the operator a moment where the whole decision is visible before it is acted on. Every answer is collected
# up front, echoed back as a summary, confirmed once, and then the install runs with nothing left to ask.
#
# Idempotent: re-running against an existing ./tunnex REUSES the generated database password. A fresh one
# would not match the volume, and the stack would come up refusing its own credentials.
set -eu

# ── plumbing ────────────────────────────────────────────────────────────────────────────────────
die() { printf '\n  \033[31m✗\033[0m %s\n\n' "$*" >&2; exit 1; }

# ⛔ THE TERMINAL IS OPENED ONCE, ON FD 3, AND FAILING TO OPEN IT IS THE ONLY TTY TEST THAT MEANS ANYTHING.
#
# This used to test `[ -r /dev/tty ] && [ -t 1 ]` and then read from /dev/tty per question. On a real
# machine under `curl … | sh` that combination reported a usable terminal and then every read returned EOF,
# so the address loop printed its error four times in a second without a human ever being asked:
#
#     !! Not usable. Enter the bare DNS name or public IP — no http://, not localhost.
#     !! Not usable. Enter the bare DNS name or public IP — no http://, not localhost.
#
# Opening the descriptor IS the test, because it is the same operation the reads perform. If it fails there
# is no terminal, and the script says so and stops rather than pretending to ask.
HAVE_TTY=0
# ⚠ BRACES + REDIRECT ON THE GROUP: the shell reports a failed `exec` redirection ITSELF, so
# `exec 3</dev/tty 2>/dev/null` still leaked `/dev/tty: Device not configured` onto a clean run.
# ⛔ READ-WRITE (`3<>`), NOT READ-ONLY (`3<`). Prompts are WRITTEN to this descriptor and answers are READ
# from it, and a read-only fd fails EBADF on the first `printf … >&3` — which under `set -e` killed the
# script silently, exit 1, no message, immediately after printing the first prompt. The prompt appeared
# because it was the last thing that worked, which is what made it look like the read had failed.
if { exec 3<>/dev/tty; } 2>/dev/null; then HAVE_TTY=1; fi

ASSUME_YES=0
for arg in "$@"; do
	case "$arg" in
	--yes | -y) ASSUME_YES=1 ;;
	--help | -h)
		printf 'usage: sh get.sh [--yes]\n  --yes   accept every default, ask nothing (for automation)\n'
		exit 0
		;;
	*) die "unknown argument: $arg" ;;
	esac
done

no_tty_help() {
	die "no readable terminal, so the questions cannot be asked.

  Re-run non-interactively — every prompt has a default and --yes takes all of them:

      curl -fsSL https://get.tunnex.io | TUNNEX_PUBLIC_ADDR=vpn.acme.com sh -s -- --yes

  Override any default with an environment variable:
      TUNNEX_PUBLIC_ADDR   (required)  DNS name or public IP users and gateways reach
      TUNNEX_ADMIN_EMAIL               administrator email
      TUNNEX_POOL_CIDR                 WireGuard pool, default 10.99.0.0/16
      SMTP_HOST SMTP_PORT SMTP_FROM SMTP_USERNAME SMTP_PASSWORD"
}

# read_tty — one line from fd 3 into REPLY_RAW.
#
# ⛔ EOF RETURNS NON-ZERO AND IS NOT AN EMPTY ANSWER. Conflating the two is what turned an unanswerable
# prompt into an infinite loop: "" failed validation, the loop asked again, and nothing ever changed.
read_tty() {
	[ "$HAVE_TTY" = "1" ] || return 1
	IFS= read -r REPLY_RAW <&3 || return 1
	return 0
}

# ask PROMPT DEFAULT — free text; Enter accepts the default. Sets ANSWER.
ask() {
	_prompt="$1"
	_default="${2:-}"
	if [ "$ASSUME_YES" = "1" ] || [ "$HAVE_TTY" = "0" ]; then
		ANSWER="$_default"
		return 0
	fi
	if [ -n "$_default" ]; then
		printf '  %s \033[2m(%s)\033[0m ' "$_prompt" "$_default" >&3
	else
		printf '  %s ' "$_prompt" >&3
	fi
	read_tty || no_tty_help
	[ -n "$REPLY_RAW" ] || REPLY_RAW="$_default"
	ANSWER="$REPLY_RAW"
}

# choose PROMPT DEFAULT_INDEX LABEL... — a numbered menu. Sets CHOICE to the 1-based index.
#
# ⚠ NUMBERED, NOT ARROW KEYS. An arrow-key menu needs raw terminal mode, and raw mode under `curl … | sh`
# is exactly the kind of thing that works on the author's machine and hangs on a customer's. A digit works
# on every terminal, every shell, and over ssh.
choose() {
	_prompt="$1"
	_default="$2"
	shift 2
	if [ "$ASSUME_YES" = "1" ] || [ "$HAVE_TTY" = "0" ]; then
		CHOICE="$_default"
		return 0
	fi
	printf '  %s\n' "$_prompt" >&3
	_i=1
	for _opt in "$@"; do
		if [ "$_i" = "$_default" ]; then
			printf '    \033[1m%s)\033[0m %s \033[2m(default)\033[0m\n' "$_i" "$_opt" >&3
		else
			printf '    \033[1m%s)\033[0m %s\n' "$_i" "$_opt" >&3
		fi
		_i=$((_i + 1))
	done
	_max=$#
	_n=0
	while :; do
		printf '  › ' >&3
		read_tty || no_tty_help
		[ -n "$REPLY_RAW" ] || REPLY_RAW="$_default"
		case "$REPLY_RAW" in
		'' | *[!0-9]*) ;;
		*)
			if [ "$REPLY_RAW" -ge 1 ] && [ "$REPLY_RAW" -le "$_max" ]; then
				CHOICE="$REPLY_RAW"
				return 0
			fi
			;;
		esac
		_n=$((_n + 1))
		if [ "$_n" -ge 3 ]; then die "no valid choice after 3 attempts."; fi
		printf '    \033[33mEnter a number between 1 and %s.\033[0m\n' "$_max" >&3
	done
}

# ⛔ LOOPBACK IS REFUSED AT THE SOURCE. Email links and the WireGuard endpoint both derive from this value,
# so `localhost` produces a deployment that looks healthy on every screen and is unreachable from every
# device. A scheme or a path is refused too — this is a bare host, not a URL.
addr_ok() {
	case "$1" in
	"" | localhost | 127.* | 0.0.0.0 | ::1 | *://* | */*) return 1 ;;
	esac
	return 0
}
cidr_ok() {
	case "$1" in *.*.*.*/*) return 0 ;; esac
	return 1
}
email_ok() {
	case "$1" in *@*.*) return 0 ;; esac
	return 1
}

# ask_validated PROMPT DEFAULT VALIDATOR HINT — bounded, and every exit is an exit.
#
# ⛔ `if …; then` AND NOT `cmd && action`, THROUGHOUT THIS SCRIPT. Under `set -e` a bare `A && B` statement
# whose A FAILS makes the whole list fail, and the shell exits. That is fine when A failing is fatal and
# catastrophic when it is the normal case: `grep -qi mailpit && die` aborted the installer on every compose
# file that CORRECTLY had no Mailpit in it, and this validator exited the script on a operator's first typo
# instead of re-asking. The `&&` form is only safe where failure means stop.
ask_validated() {
	_p="$1" _d="$2" _v="$3" _hint="$4"
	_c=0
	while :; do
		ask "$_p" "$_d"
		if "$_v" "$ANSWER"; then return 0; fi
		_c=$((_c + 1))
		if [ "$_c" -ge 3 ] || [ "$HAVE_TTY" = "0" ] || [ "$ASSUME_YES" = "1" ]; then die "$_hint"; fi
		printf '    \033[33m%s\033[0m\n' "$_hint" >&3
	done
}

# ── 0. preflight ────────────────────────────────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || die "Docker is required. Install Docker Engine, then re-run."
docker compose version >/dev/null 2>&1 ||
	die "The Docker Compose v2 plugin is required (\`docker compose version\` must work)."
command -v curl >/dev/null 2>&1 || die "curl is required."

# ── 1. pin a real RELEASE — never :latest for a real deploy ─────────────────────────────────────
API="https://api.github.com/repos/iotunnex/tunnex"
RAW="https://raw.githubusercontent.com/iotunnex/tunnex"
VERSION="${TUNNEX_VERSION:-}"
if [ -z "$VERSION" ]; then
	VERSION="$(curl -fsSL "${API}/releases/latest" 2>/dev/null |
		grep -m1 '"tag_name"' | sed -E 's/.*"tag_name" *: *"([^"]+)".*/\1/')"
fi
[ -n "$VERSION" ] || die "could not resolve a released Tunnex version. Set TUNNEX_VERSION to pin one."

# ── the wordmark ────────────────────────────────────────────────────────────────────────────────
#
# ⭐ TUNN IN WHITE, EX IN RED — the same split the product's own logo uses, so the terminal and the
# dashboard are recognisably one thing. Each line is printed in two segments because the colour changes
# mid-glyph-row.
#
# ⚠ AND THERE IS AN ASCII FALLBACK, because box-drawing characters render as mojibake on a terminal that is
# not UTF-8 — which is the default on a bare VPS with LANG=C, i.e. exactly the machine this runs on. A
# banner that comes out as garbage is worse than one that is plain.
wordmark() {
	_r='\033[38;5;203m' # brand red
	_w='\033[97m'       # wordmark white
	_z='\033[0m'
	case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in
	*[Uu][Tt][Ff]*)
		printf "\n  ${_w}%s${_z}${_r}%s${_z}\n" '╺┳╸╻ ╻┏┓╻┏┓╻' '┏━╸╻ ╻'
		printf "  ${_w}%s${_z}${_r}%s${_z}\n" ' ┃ ┃ ┃┃┗┫┃┗┫' '┣╸ ┏╋┛'
		printf "  ${_w}%s${_z}${_r}%s${_z}\n" ' ╹ ┗━┛╹ ╹╹ ╹' '┗━╸╹ ╹'
		;;
	*)
		printf "\n  ${_w}%s${_z}${_r}%s${_z}\n" ' _____ _   _ _   _ ' ' _____ __  __'
		printf "  ${_w}%s${_z}${_r}%s${_z}\n" '|_   _| | | | \ | |' '| ____|\ \/ /'
		printf "  ${_w}%s${_z}${_r}%s${_z}\n" '  | | | | | |  \| |' '|  _|   \  / '
		printf "  ${_w}%s${_z}${_r}%s${_z}\n" '  | | | |_| | |\  |' '| |___  /  \ '
		printf "  ${_w}%s${_z}${_r}%s${_z}\n" '  |_|  \___/|_| \_|' '|_____|/_/\_\'
		;;
	esac
}

wordmark
printf '  \033[2mSelf-hosted Zero Trust VPN\033[0m \033[2m·\033[0m \033[2m%s\033[0m\n\n' "$VERSION"

[ "$HAVE_TTY" = "1" ] || [ "$ASSUME_YES" = "1" ] || no_tty_help

# ── 2. EVERY QUESTION, BEFORE ANY WORK ──────────────────────────────────────────────────────────
printf '  \033[1mDeployment\033[0m\n'

# ⚠ NO DEFAULT FOR THE ADDRESS, ON PURPOSE. Every other prompt can be guessed; this one cannot, and a wrong
# guess is invisible until a device fails to connect.
ADDR="${TUNNEX_PUBLIC_ADDR:-}"
if [ -n "$ADDR" ]; then
	addr_ok "$ADDR" || die "TUNNEX_PUBLIC_ADDR='${ADDR}' is not usable — bare DNS name or public IP only."
else
	ask_validated "Public hostname or IP users and gateways reach" "" addr_ok \
		"Enter a bare DNS name or public IP — no http://, no path, not localhost."
	ADDR="$ANSWER"
fi

# ⛔ THE POOL IS ASKED, NOT ASSUMED. It is the space every device gets a /32 from, and it must not collide
# with any LAN you intend to route — a collision surfaces later, as traffic that silently goes elsewhere.
ask_validated "WireGuard address pool" "${TUNNEX_POOL_CIDR:-10.99.0.0/16}" cidr_ok \
	"Enter a CIDR block, e.g. 10.99.0.0/16 — it must not overlap any LAN you will route."
POOL_CIDR="$ANSWER"

printf '\n  \033[1mAdministrator\033[0m\n'
ask_validated "Email for the first administrator" "${TUNNEX_ADMIN_EMAIL:-admin@${ADDR}}" email_ok \
	"Enter a valid email address."
ADMIN_EMAIL="$ANSWER"

printf '\n  \033[1mEmail delivery\033[0m\n'
printf '  \033[2mInvitations, password resets and email verification all need SMTP.\033[0m\n'

SMTP_HOST="${SMTP_HOST:-}"
SMTP_PORT="${SMTP_PORT:-587}"
SMTP_FROM="${SMTP_FROM:-}"
SMTP_USERNAME="${SMTP_USERNAME:-}"
SMTP_PASSWORD="${SMTP_PASSWORD:-}"

if [ -z "$SMTP_HOST" ]; then
	choose "Configure SMTP?" 2 \
		"Yes — set it up now" \
		"Skip — invitations will not be delivered (add it later in .env)"
	if [ "$CHOICE" = "1" ]; then
		ask_validated "SMTP host" "" addr_ok "Enter the server hostname, e.g. smtp.example.net."
		SMTP_HOST="$ANSWER"
		# ⚠ 587, NOT 465. Go's net/smtp dials plaintext and upgrades via STARTTLS; it has no implicit-TLS
		# path, so an SMTPS port hangs or errors. A standard-library property, not a setting.
		ask "SMTP port \033[2m(587 = STARTTLS; 465 is not supported)\033[0m" "587"
		SMTP_PORT="$ANSWER"
		ask_validated "Send mail as" "no-reply@${ADDR}" email_ok "Enter a valid email address."
		SMTP_FROM="$ANSWER"
		ask "SMTP username \033[2m(blank if none)\033[0m" ""
		SMTP_USERNAME="$ANSWER"
		if [ -n "$SMTP_USERNAME" ]; then
			ask "SMTP password" ""
			SMTP_PASSWORD="$ANSWER"
		fi
	fi
fi

# ── 3. THE SUMMARY — the one moment the whole decision is visible before anything happens ───────
printf '\n  \033[1mReady to install\033[0m\n'
printf '    Version          %s\n' "$VERSION"
printf '    Public address   %s\n' "$ADDR"
printf '    Dashboard        http://%s/\n' "$ADDR"
printf '    Administrator    %s\n' "$ADMIN_EMAIL"
printf '    Address pool     %s\n' "$POOL_CIDR"
if [ -n "$SMTP_HOST" ]; then
	printf '    Email            %s:%s as %s\n' "$SMTP_HOST" "$SMTP_PORT" "$SMTP_FROM"
else
	printf '    Email            \033[33mnot configured — invitations will not be delivered\033[0m\n'
fi
printf '    Directory        %s/tunnex\n\n' "$(pwd)"

if [ "$ASSUME_YES" = "0" ] && [ "$HAVE_TTY" = "1" ]; then
	choose "Proceed?" 1 "Install now" "Cancel"
	[ "$CHOICE" = "1" ] || die "Cancelled. Nothing was written."
fi

# ── 4. install ──────────────────────────────────────────────────────────────────────────────────
# step/ok — a progress line that is OVERWRITTEN by its own result, so the transcript reads as a checklist
# rather than a log. \033[K clears the rest of the line: without it the tail of a longer previous message
# survives underneath a shorter one.
step() { printf '  \033[2m…\033[0m %s\033[K\r' "$1"; }
ok() { printf '  \033[32m✓\033[0m %s\033[K\n' "$1"; }

printf '\n'
mkdir -p tunnex
cd tunnex

step "fetching the release manifest"
curl -fsSL "${RAW}/${VERSION}/deploy/tunnex.yml" -o tunnex.yml 2>/dev/null ||
	die "could not download deploy/tunnex.yml for ${VERSION}"

# ⛔ CONFIRM WHAT WE FETCHED IS A PRODUCTION COMPOSE FILE rather than trusting the tag. A dev compose file
# reaching a customer is a Mailpit that swallows every invitation and a non-production environment flag —
# both of which look fine and behave wrongly.
if grep -qi 'mailpit' tunnex.yml; then
	die "the fetched tunnex.yml references Mailpit — that is a development compose file. Refusing to install."
fi
grep -q 'TUNNEX_ENV: production' tunnex.yml ||
	die "the fetched tunnex.yml does not set TUNNEX_ENV: production. Refusing to install."
ok "release manifest verified — production, no Mailpit"

step "writing configuration"
PG_PASS=""
if [ -f .env ]; then
	PG_PASS="$(grep -E '^POSTGRES_PASSWORD=' .env | head -1 | cut -d= -f2- || true)"
fi
REUSED=""
if [ -n "$PG_PASS" ]; then REUSED=" (reused the existing database password)"; fi
[ -n "$PG_PASS" ] || PG_PASS="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"

umask 077
cat >.env <<EOF
# Written by the Tunnex installer. Edit values here; never hand-edit tunnex.yml.
TUNNEX_VERSION=${VERSION}
APP_BASE_URL=http://${ADDR}
TUNNEX_PUBLIC_ADDR=${ADDR}
TUNNEX_ADMIN_EMAIL=${ADMIN_EMAIL}
TUNNEX_POOL_CIDR=${POOL_CIDR}
POSTGRES_PASSWORD=${PG_PASS}
SMTP_HOST=${SMTP_HOST}
SMTP_PORT=${SMTP_PORT}
SMTP_FROM=${SMTP_FROM}
SMTP_USERNAME=${SMTP_USERNAME}
SMTP_PASSWORD=${SMTP_PASSWORD}
# ⛔ NEVER SET THIS ON A DEPLOYMENT — it tees message bodies to the log, and those bodies are working links.
MAIL_DEV_LOG=false
EOF
ok "configuration written${REUSED}"

step "pulling images — this takes a minute"
docker compose -f tunnex.yml pull >/dev/null 2>&1 || die "could not pull images."
ok "images pulled"

step "starting the stack"
docker compose -f tunnex.yml up -d --wait >/dev/null 2>&1 || die "the stack did not come up healthy."
ok "stack running"

# ── 5. THE FIRST-RUN CREDENTIAL, READ BACK AND SHOWN WHERE THE OPERATOR IS LOOKING ──────────────
#
# ⛔ THE STEP THAT WAS MISSING AND IT COST THE WHOLE INSTALL. The administrator credential is printed ONCE,
# to the API container's stdout — and `up -d` is detached, so it scrolled into a log the operator was never
# told to read. It exists as an argon2id hash and nowhere else, so this is the only moment it can be shown.
CREDS="$(docker compose -f tunnex.yml logs api 2>/dev/null |
	sed -n '/TUNNEX - FIRST RUN/,/^.*=\{20,\}$/p' | tail -n +2 || true)"

printf '\n'
if printf '%s' "$CREDS" | grep -q 'password'; then
	printf '  \033[1mYour administrator credential — shown once, copy it now\033[0m\n\n'
	printf '%s\n' "$CREDS"
else
	printf '  \033[33m⚠ Could not read the first-run credential from the API log.\033[0m\n\n'
	printf '  Retrieve it with:\n'
	printf '      cd %s && docker compose -f tunnex.yml logs api | grep -A8 "FIRST RUN"\n\n' "$(pwd)"
	printf '  If it is genuinely gone there is no recovery and no second admin —\n'
	printf '  reset with:  docker compose -f tunnex.yml down -v\n'
fi

# ── 6. hand-off ─────────────────────────────────────────────────────────────────────────────────
printf '\n  \033[1mNext\033[0m\n'
printf '    1. Open  http://%s/\n' "$ADDR"
printf '    2. Sign in with the credential above — you must set your own password immediately.\n'
printf '    3. Create your first organization.\n'
printf '    4. Gateways → Generate join token, then run the command it shows on your gateway host.\n'
if [ -z "$SMTP_HOST" ]; then
	printf '\n  \033[33mEmail is not configured.\033[0m Invitations are still created and the dashboard shows a\n'
	printf '  copyable link you can send yourself. Set SMTP_* in .env, then:\n'
	printf '      docker compose -f tunnex.yml up -d api\n'
fi
# ⭐ SIGNUP IS ALREADY SHUT, and saying so is the difference between an operator who thinks they must hurry
# and one who knows the deployment is already theirs.
printf '\n  \033[2mPublic signup is closed on this deployment — the administrator above is the only way in,\n'
printf '  and everyone else arrives by invitation or SSO.\033[0m\n\n'
