#!/usr/bin/env sh
# Test Mailjet SMTP AUTH only (no Stalwart, no message send).
#
# Usage (interactive, keys are not echoed):
#   sh tests/resources/scripts/mailjet_auth_test.sh
#
# Or:
#   MAILJET_API_KEY='...' MAILJET_SECRET_KEY='...' \
#     sh tests/resources/scripts/mailjet_auth_test.sh
#
# Optional:
#   MAILJET_HOST  (default: in-v3.mailjet.com)
#   MAILJET_PORT  (default: 587)

set -eu

HOST="${MAILJET_HOST:-in-v3.mailjet.com}"
PORT="${MAILJET_PORT:-587}"

if ! command -v python3 >/dev/null 2>&1; then
    printf 'Need python3.\n' >&2
    exit 1
fi

if [ -z "${MAILJET_API_KEY:-}" ] || [ -z "${MAILJET_SECRET_KEY:-}" ]; then
    if ! (exec 3<> /dev/tty) 2>/dev/null; then
        printf 'An interactive terminal is required, or set MAILJET_API_KEY and MAILJET_SECRET_KEY.\n' >&2
        exit 1
    fi
    exec 3<> /dev/tty
    if [ -z "${MAILJET_API_KEY:-}" ]; then
        printf 'Mailjet API key (SMTP username): ' >&3
        IFS= read -r MAILJET_API_KEY <&3 || exit 1
    fi
    if [ -z "${MAILJET_SECRET_KEY:-}" ]; then
        printf 'Mailjet secret key (SMTP password): ' >&3
        _saved="$(stty -g <&3)"
        stty -echo <&3
        IFS= read -r MAILJET_SECRET_KEY <&3 || { stty "$_saved" <&3; printf '\n' >&3; exit 1; }
        stty "$_saved" <&3
        printf '\n' >&3
    fi
fi

if [ -z "$MAILJET_API_KEY" ] || [ -z "$MAILJET_SECRET_KEY" ]; then
    printf 'API key and secret key are required.\n' >&2
    exit 1
fi

export MAILJET_HOST="$HOST" MAILJET_PORT="$PORT"
export MAILJET_API_KEY MAILJET_SECRET_KEY

python3 - <<'PY'
import os, smtplib, ssl, sys

host = os.environ["MAILJET_HOST"]
port = int(os.environ["MAILJET_PORT"])
user = os.environ["MAILJET_API_KEY"]
password = os.environ["MAILJET_SECRET_KEY"]
# Keep the exact installer/Stalwart values; only strip a trailing CR from paste.
user = user.replace("\r", "")
password = password.replace("\r", "")

print(f"Connecting {host}:{port} ...")
try:
    if port == 465:
        smtp = smtplib.SMTP_SSL(host, port, timeout=20, context=ssl.create_default_context())
    else:
        smtp = smtplib.SMTP(host, port, timeout=20)
        smtp.ehlo()
        smtp.starttls(context=ssl.create_default_context())
        smtp.ehlo()
    smtp.login(user, password)
    smtp.quit()
except smtplib.SMTPAuthenticationError as err:
    code = err.smtp_code
    detail = " ".join(part.decode("utf-8", "replace") if isinstance(part, bytes) else str(part)
                      for part in (err.smtp_error if isinstance(err.smtp_error, tuple) else (err.smtp_error,)))
    print(f"AUTH FAILED  SMTP {code}  {detail.strip()[:200]}")
    print("Use the API Key and Secret Key from https://app.mailjet.com/account/relay")
    print("(not the Mailjet website login). If the secret was lost, reset it there.")
    sys.exit(2)
except (smtplib.SMTPException, OSError, TimeoutError) as err:
    print(f"CONNECTION/SMTP FAILED  {type(err).__name__}: {err}")
    sys.exit(1)
else:
    print("AUTH OK  Mailjet accepted these SMTP credentials.")
    sys.exit(0)
PY
