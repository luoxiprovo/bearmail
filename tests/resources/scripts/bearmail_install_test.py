#!/usr/bin/env python3
"""Fixture tests for bearmail-install. No live DNS provider and no root."""

from __future__ import annotations

import hashlib
import json
import os
import runpy
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
INSTALLER = ROOT / "bearmail-install"
OPERATION = "8d0b6b6e-1c0a-4e0a-9c1a-6c0e5b7a1111"
DEPLOYMENT = "2f4c1a40-7b1e-4d3a-8f0a-91a0c0d0e222"
DNS_TOKEN = "dns-token-SECRET-123456"
DNS_USER = "dns-user-SECRET-123456"
SMTP_KEY = "smtp-key-SECRET-123456"
ADMIN_PASSWORD = "admin-pass-SECRET-123456"
DKIM_VALUE = "v=DKIM1; k=rsa; p=TESTKEY"
DKIM_HOST = "default._domainkey.example.com"

FAILURES = 0


def fail(message: str) -> None:
    global FAILURES
    FAILURES += 1
    print(f"FAIL: {message}", file=sys.stderr)


def check(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def write_json(path: Path, payload) -> None:
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    os.chmod(path, 0o600)


def release_dir(tmp: Path, release_id: str = "rel-1") -> tuple[Path, Path]:
    directory = tmp / release_id
    directory.mkdir()
    files = {
        "install.sh": b"#!/bin/sh\necho BearMail\n",
        "stalwart": b"#!/bin/sh\necho 'Stalwart Server v0.16.16'\n",
        "bearmail-webui.tar.gz": b"bearmail-webui-fixture\n",
        "mcp_install.sh": b"#!/bin/sh\necho mcp\n",
    }
    sums = []
    for name, content in files.items():
        path = directory / name
        path.write_bytes(content)
        path.chmod(0o755)
        sums.append(f"{hashlib.sha256(content).hexdigest()}  {name}")
    checksum = directory / "SHA256SUMS"
    checksum.write_text("\n".join(sums) + "\n", encoding="utf-8")
    return directory, checksum


def brevo_records() -> list[dict]:
    return [
        {"purpose": "brevo_code", "type": "TXT", "host": "@", "value": "brevo-code:4bc1566441c4131069853d135c5905ab"},
        {"purpose": "dkim", "type": "TXT", "host": "mail._domainkey", "value": "k=rsa;p=BREVOKEY"},
        {"purpose": "dmarc", "type": "TXT", "host": "_dmarc", "value": "v=DMARC1; p=none; rua=mailto:dmarc@example.com"},
    ]


def base_input(tmp: Path, directory: Path, checksum: Path, provider: str = "namecom") -> dict:
    if provider == "namecom":
        dns_secret = {"username": DNS_USER, "token": DNS_TOKEN}
    elif provider == "hostinger":
        dns_secret = {"token": DNS_TOKEN}
    else:
        dns_secret = {"token": DNS_TOKEN}
    dns_path = tmp / f"dns-{provider}.json"
    relay_path = tmp / "relay.json"
    admin_path = tmp / "admin.json"
    write_json(dns_path, dns_secret)
    write_json(relay_path, {"smtpKey": SMTP_KEY})
    write_json(admin_path, {"username": "admin@example.com", "password": ADMIN_PASSWORD})
    return {
        "schemaVersion": 1,
        "operationId": OPERATION,
        "deploymentId": DEPLOYMENT,
        "generation": 3,
        "mxCutoverAuthorized": True,
        "domain": "example.com",
        "mailHostname": "mail.example.com",
        "webmailHostname": "webmail.example.com",
        "publicIpv4": "203.0.113.10",
        "publicIpv6": None,
        "dataPath": "/var/lib/stalwart",
        "dns": {"provider": provider, "zone": "example.com", "credentialFile": str(dns_path)},
        "brevoDnsRecords": brevo_records(),
        "relay": {
            "host": "smtp-relay.brevo.com",
            "port": 587,
            "tls": "starttls-required",
            "login": "7xxx001@smtp-brevo.com",
            "credentialFile": str(relay_path),
        },
        "adminCredentialFile": str(admin_path),
        "mailboxQuotaBytes": 1073741824,
        "release": {"id": directory.name, "artifactDir": str(directory), "checksumFile": str(checksum)},
    }


def zone_records() -> list[dict]:
    return [
        {"type": "A", "host": "@", "value": "203.0.113.50"},
        {"type": "A", "host": "www", "value": "203.0.113.51"},
        {"type": "NS", "host": "@", "value": "ns1.example.net"},
        {"type": "TXT", "host": "@", "value": "google-site-verification=abc"},
        {"type": "TXT", "host": "@", "value": "v=spf1 mx -all"},
        {"type": "MX", "host": "@", "value": "old-mx.example.net", "priority": 10},
        {"type": "AAAA", "host": "mail", "value": "2001:db8::5"},
    ]


def apply_script() -> str:
    return r"""#!/bin/sh
set -eu
if [ -t 0 ]; then
    echo "stdin is a terminal" >&2
    exit 21
fi
if IFS= read -r _extra; then
    echo "stdin was not closed" >&2
    exit 22
fi
if [ -z "${BEARMAIL_NONINTERACTIVE_FILE:-}" ]; then
    echo "answer file was not provided" >&2
    exit 19
fi
printf '%s\n' "$BEARMAIL_NONINTERACTIVE_FILE" > "$BEARMAIL_NONINTERACTIVE_SEEN"
python3 - <<'PY'
import hashlib
import json
import os
import stat
import sys

path = os.environ["BEARMAIL_NONINTERACTIVE_FILE"]
info = os.lstat(path)
if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
    sys.exit(23)
if stat.S_IMODE(info.st_mode) != 0o600:
    sys.exit(24)
with open(path, encoding="utf-8") as handle:
    data = json.load(handle)
if set(data) != {"portal", "mailHostname", "domain", "smtpLogin", "smtpKey", "adminUsername", "adminPassword"}:
    sys.exit(25)
expected = {
    "portal": os.environ["EXPECT_PORTAL"],
    "mailHostname": os.environ["EXPECT_MAIL"],
    "domain": os.environ["EXPECT_DOMAIN"],
    "smtpLogin": os.environ["EXPECT_LOGIN"],
}
for key, value in expected.items():
    if data.get(key) != value:
        sys.exit(11)
digest = hashlib.sha256(data["smtpKey"].encode("utf-8")).hexdigest()
if digest != os.environ["EXPECT_SMTP_SHA256"]:
    sys.exit(16)
for value in os.environ.values():
    if data["smtpKey"] in value:
        sys.exit(18)
PY
if [ ! -s "$BEARMAIL_INSTALL_ENGINE_DKIM_FILE" ]; then
    printf '%s\n' '{"host":"default._domainkey.example.com","value":"v=DKIM1; k=rsa; p=TESTKEY"}' > "$BEARMAIL_INSTALL_ENGINE_DKIM_FILE"
fi
exit 0
"""


def touch_script() -> str:
    return """#!/bin/sh
set -eu
: > "$BEARMAIL_INSTALL_RAN"
exit 0
"""


def env_for(tmp: Path, fixture: Path, extra: dict | None = None) -> dict:
    state = tmp / "state"
    state.mkdir(exist_ok=True)
    environment = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": os.environ.get("HOME", "/tmp"),
        "BEARMAIL_INSTALL_TEST_HOOKS": "1",
        "BEARMAIL_INSTALL_ASSUME_MOUNT": "1",
        "BEARMAIL_INSTALL_DNS_FIXTURE": str(fixture),
        "BEARMAIL_INSTALL_RELAY_OK": "1",
        "BEARMAIL_INSTALL_SKIP_JMAP": "1",
        "BEARMAIL_INSTALL_STATE_DIR": str(state),
        "BEARMAIL_INSTALL_TLS": "issued",
        "BEARMAIL_INSTALL_APPLY_SCRIPT": str(tmp / "apply.sh"),
        "EXPECT_PORTAL": "webmail.example.com",
        "EXPECT_MAIL": "mail.example.com",
        "EXPECT_DOMAIN": "example.com",
        "EXPECT_LOGIN": "7xxx001@smtp-brevo.com",
        "EXPECT_SMTP_SHA256": hashlib.sha256(SMTP_KEY.encode()).hexdigest(),
        "BEARMAIL_NONINTERACTIVE_SEEN": str(tmp / "seen-path"),
        "BEARMAIL_INSTALL_RAN": str(tmp / "ran"),
    }
    if extra:
        environment.update(extra)
    return environment


def run_installer(args: list[str], environment: dict) -> subprocess.CompletedProcess:
    return subprocess.run(
        [str(INSTALLER), *args],
        env=environment,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        check=False,
        start_new_session=True,
    )


def load_zone(path: Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))["records"]


def prepare(tmp: Path, records: list[dict] | None = None, provider: str = "namecom", http_status: int = 200):
    directory, checksum = release_dir(tmp)
    fixture = tmp / "zone.json"
    write_json(fixture, {"httpStatus": http_status, "records": zone_records() if records is None else records})
    payload = base_input(tmp, directory, checksum, provider)
    infile = tmp / "input.json"
    outfile = tmp / "result.json"
    write_json(infile, payload)
    script = tmp / "apply.sh"
    script.write_text(apply_script(), encoding="utf-8")
    script.chmod(0o755)
    touched = tmp / "touch.sh"
    touched.write_text(touch_script(), encoding="utf-8")
    touched.chmod(0o755)
    return infile, outfile, fixture, payload


def assert_clean(proc: subprocess.CompletedProcess, result: Path, log: Path | None = None) -> None:
    blob = proc.stdout + proc.stderr
    if result.is_file():
        blob += result.read_text(encoding="utf-8")
    if log and log.is_file():
        blob += log.read_text(encoding="utf-8")
    for secret in (DNS_TOKEN, DNS_USER, SMTP_KEY, ADMIN_PASSWORD):
        check(secret not in blob, f"output contained a credential ({secret[:8]})")


def test_multiple_engine_dkim_keys() -> None:
    namespace = runpy.run_path(str(INSTALLER), run_name="bearmail_installer_test")
    rows = [
        {"type": "TXT", "host": "ed._domainkey", "value": "v=DKIM1; k=ed25519; p=EDKEY"},
        {"type": "TXT", "host": "rsa._domainkey", "value": "v=DKIM1; k=rsa; p=RSAKEY"},
    ]
    result = namespace["find_engine_dkim"](rows, {"dns": {"zone": "customer.com"}, "brevoDnsRecords": []})
    check(result == {"host": "rsa._domainkey.customer.com", "value": rows[1]["value"]}, "multiple engine keys select RSA deterministically")


def test_admin_account_alignment() -> None:
    namespace = runpy.run_path(str(INSTALLER), run_name="bearmail_installer_test")
    align = namespace["align_admin_password"]
    quota = namespace["apply_quota"]
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        reminder = tmp / ".bearmail-reminder"
        reminder.write_text("admin@customer.com\noriginal-password\n", encoding="utf-8")
        calls = []
        def call(config, user, password, method, arguments):
            calls.append((user, password, method, arguments))
            return {"ids": ["b"]} if method.endswith("/query") else {"updated": {"b": None}}
        align.__globals__["test_hooks"] = lambda: False
        align.__globals__["state_dir"] = lambda config: tmp
        align.__globals__["jmap_call"] = call
        config = {"domain": "customer.com", "mailboxQuotaBytes": 1024}
        secrets = {"adminUser": "admin@customer.com", "adminPassword": ADMIN_PASSWORD}
        align(config, secrets)
        check(calls[0] == ("admin@customer.com", "original-password", "x:Account/query", {"filter": {"name": "admin"}}), "administrator lookup uses the generated identity and Account API")
        check(calls[1][3] == {"update": {"b": {"credentials": {"0": {"@type": "Password", "secret": ADMIN_PASSWORD}}}}}, "password credentials use the engine map format")
        check(not reminder.exists(), "successful alignment removes the generated credential")
        quota(config, secrets)
        check(calls[-1][2:] == ("x:Account/set", {"update": {"b": {"quotas": {"maxDiskQuota": 1024}}}}), "quota uses Account API")
        calls.clear()
        align(config, secrets)
        check(len(calls) == 1 and calls[0][1] == ADMIN_PASSWORD, "rerun reuses the saved administrator credential")


def test_dry_run_and_stdin() -> None:
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        infile, outfile, fixture, _payload = prepare(tmp)
        before = fixture.read_text(encoding="utf-8")
        log = tmp / "writes.log"
        environment = env_for(tmp, fixture, {"BEARMAIL_INSTALL_DNS_WRITE_LOG": str(log)})
        proc = run_installer(["--dry-run", "--input", str(infile), "--result", str(outfile)], environment)
        check(proc.returncode == 0, f"dry-run exit {proc.returncode}: {proc.stderr}")
        check(not log.exists(), "dry-run wrote a DNS log")
        check(fixture.read_text(encoding="utf-8") == before, "dry-run changed the zone")
        result = json.loads(outfile.read_text(encoding="utf-8"))
        check(result["status"] == "dry_run", "dry-run status")
        check(result["generation"] == 3, "generation was not recorded")
        check(result["dns"]["previousMx"] == [{"priority": 10, "target": "old-mx.example.net"}], "previous MX")
        mx = [item for item in result["dns"]["published"] if item["type"] == "MX"]
        check(len(mx) == 1 and mx[0]["value"] == "10 mail.example.com" and mx[0]["state"] == "planned", "planned MX")
        check(all(item["state"] == "planned" for item in result["dns"]["published"]), "dry-run state")
        check(result["dns"]["minimumTtl"] == 300, "name.com TTL")
        check(stat.S_IMODE(outfile.stat().st_mode) == 0o600, "result mode")
        assert_clean(proc, outfile)


def test_apply_publish_and_secrets() -> None:
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        infile, outfile, fixture, _payload = prepare(tmp)
        log = tmp / "writes.log"
        capture = tmp / "relay.txt"
        environment = env_for(tmp, fixture, {
            "BEARMAIL_INSTALL_DNS_WRITE_LOG": str(log),
            "BEARMAIL_INSTALL_RELAY_CAPTURE": str(capture),
        })
        proc = run_installer(["--input", str(infile), "--result", str(outfile)], environment)
        check(proc.returncode == 0, f"apply exit {proc.returncode}: {proc.stderr} {proc.stdout}")
        result = json.loads(outfile.read_text(encoding="utf-8"))
        check(result["status"] == "succeeded", f"status {result['status']} {result.get('errorMessage')}")
        check(result["errorCode"] is None and result["retryable"] is False, "success flags")
        check(result["installedVersions"]["engine"] == "0.16.16", "engine version")
        check(result["installedVersions"]["adminUi"] == "bundled-with-engine", "admin UI version")
        check(result["serviceChecks"]["mcp"] == "loopback", "mcp check")
        check(result["dns"]["dmarcAction"] == "published", "absent DMARC should be published")
        check("include:spf.brevo.com" in result["dns"]["spf"], "SPF merge")
        check(result["dns"]["engineDkimValue"] == DKIM_VALUE, "engine DKIM value")
        zone = load_zone(fixture)
        check(sum(1 for item in zone if item["type"] == "MX") == 1, "one MX")
        check(any(item["type"] == "MX" and item["value"] == "mail.example.com" for item in zone), "new MX")
        check(any(item["type"] == "A" and item["host"] == "mail" and item["value"] == "203.0.113.10" for item in zone), "mail A")
        check(any(item["type"] == "A" and item["host"] == "webmail" and item["value"] == "203.0.113.10" for item in zone), "webmail A")
        check(any(item["type"] == "A" and item["host"] == "@" and item["value"] == "203.0.113.50" for item in zone), "apex A preserved")
        check(any(item["type"] == "A" and item["host"] == "www" and item["value"] == "203.0.113.51" for item in zone), "www A preserved")
        check(any(item["type"] == "NS" for item in zone), "NS preserved")
        check(any(item["type"] == "TXT" and item["value"] == "google-site-verification=abc" for item in zone), "unrelated TXT")
        check(not any(item["type"] == "AAAA" and item["host"] == "mail" for item in zone), "stale AAAA removed")
        check(sum(1 for item in zone if item["type"] == "TXT" and str(item["value"]).lower().startswith("v=spf1")) == 1, "one SPF")
        check(any(item["type"] == "TXT" and item["value"].startswith("brevo-code:") for item in zone), "brevo code")
        check(any(item["type"] == "TXT" and item["value"] == "k=rsa;p=BREVOKEY" for item in zone), "brevo DKIM")
        check(sum(1 for item in zone if item["value"] == DKIM_VALUE) == 1, "one engine DKIM")
        check(any(item["type"] == "TXT" and "p=none" in item["value"] for item in zone), "DMARC created")
        check(capture.read_text(encoding="utf-8").strip() == hashlib.sha256(SMTP_KEY.encode()).hexdigest(), "relay used the SMTP key")
        install_log = tmp / "state" / "bearmail-install.log"
        assert_clean(proc, outfile, install_log)
        seen = Path((tmp / "seen-path").read_text(encoding="utf-8").strip())
        check(seen.name == "bearmail-noninteractive.json", "answer file name")
        check(not seen.exists(), "answer file remained after install.sh exited")
        second_log = tmp / "second.log"
        environment["BEARMAIL_INSTALL_DNS_WRITE_LOG"] = str(second_log)
        again = run_installer(["--input", str(infile), "--result", str(outfile)], environment)
        check(again.returncode == 0, f"second apply exit {again.returncode}: {again.stderr}")
        check(not second_log.exists() or second_log.read_text(encoding="utf-8") == "", "second run wrote DNS")
        check(sum(1 for item in load_zone(fixture) if item["value"] == DKIM_VALUE) == 1, "DKIM rotated on retry")


def test_conflict_and_mx_flag() -> None:
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        infile, outfile, fixture, payload = prepare(tmp)
        environment = env_for(tmp, fixture)
        first = run_installer(["--input", str(infile), "--result", str(outfile)], environment)
        check(first.returncode == 0, f"setup apply exit {first.returncode}: {first.stderr}")
        before = fixture.read_text(encoding="utf-8")
        payload["domain"] = "other.example.com"
        payload["mailHostname"] = "mail.other.example.com"
        payload["webmailHostname"] = "webmail.other.example.com"
        write_json(infile, payload)
        log = tmp / "conflict.log"
        environment["BEARMAIL_INSTALL_DNS_WRITE_LOG"] = str(log)
        proc = run_installer(["--input", str(infile), "--result", str(outfile)], environment)
        check(proc.returncode == 1, f"conflict exit {proc.returncode}")
        result = json.loads(outfile.read_text(encoding="utf-8"))
        check(result["errorCode"] == "IDEMPOTENCY_CONFLICT", result.get("errorCode"))
        check(fixture.read_text(encoding="utf-8") == before, "conflict wrote DNS")
        check(not log.exists(), "conflict write log")
        payload["mxCutoverAuthorized"] = False
        payload["domain"] = "example.com"
        payload["mailHostname"] = "mail.example.com"
        payload["webmailHostname"] = "webmail.example.com"
        payload["operationId"] = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
        write_json(infile, payload)
        denied = run_installer(["--input", str(infile), "--result", str(outfile)], environment)
        check(denied.returncode == 1, "mx false exit")
        check(json.loads(outfile.read_text(encoding="utf-8"))["errorCode"] == "MX_NOT_AUTHORIZED", "mx code")
        check(fixture.read_text(encoding="utf-8") == before, "mx false wrote DNS")
        dry = run_installer(["--dry-run", "--input", str(infile), "--result", str(outfile)], environment)
        check(dry.returncode == 0, f"dry-run without MX auth exit {dry.returncode}: {dry.stderr}")
        planned = json.loads(outfile.read_text(encoding="utf-8"))
        check(any(item["type"] == "MX" and item["state"] == "planned" for item in planned["dns"]["published"]), "dry-run MX")


def test_dmarc_and_spf_conflicts() -> None:
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        records = zone_records()
        records.append({"type": "TXT", "host": "_dmarc", "value": "v=DMARC1; p=reject"})
        infile, outfile, fixture, _payload = prepare(tmp, records)
        environment = env_for(tmp, fixture)
        proc = run_installer(["--input", str(infile), "--result", str(outfile)], environment)
        check(proc.returncode == 0, f"dmarc preserve exit {proc.returncode}: {proc.stderr}")
        result = json.loads(outfile.read_text(encoding="utf-8"))
        check(result["dns"]["dmarcAction"] == "preserved", "dmarc action")
        zone = load_zone(fixture)
        check(any(item["value"] == "v=DMARC1; p=reject" for item in zone), "strict DMARC removed")
        check(not any(item["value"].startswith("v=DMARC1; p=none") for item in zone), "strict DMARC replaced")
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        records = [item for item in zone_records() if not str(item["value"]).lower().startswith("v=spf1")]
        records.extend([
            {"type": "TXT", "host": "@", "value": "v=spf1 a -all"},
            {"type": "TXT", "host": "@", "value": "v=spf1 mx -all"},
        ])
        infile, outfile, fixture, _payload = prepare(tmp, records)
        before = fixture.read_text(encoding="utf-8")
        environment = env_for(tmp, fixture, {"BEARMAIL_INSTALL_APPLY_SCRIPT": str(tmp / "touch.sh")})
        proc = run_installer(["--input", str(infile), "--result", str(outfile)], environment)
        check(proc.returncode == 1, f"spf conflict exit {proc.returncode}")
        check(json.loads(outfile.read_text(encoding="utf-8"))["errorCode"] == "DNS_RECORD_CONFLICT", "spf code")
        check(fixture.read_text(encoding="utf-8") == before, "spf conflict wrote DNS")
        check(not (tmp / "ran").exists(), "spf conflict started installation")


def test_artifacts_and_data_directory() -> None:
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        infile, outfile, fixture, payload = prepare(tmp)
        before = fixture.read_text(encoding="utf-8")
        artifact = Path(payload["release"]["artifactDir"]) / "install.sh"
        artifact.write_bytes(artifact.read_bytes() + b"\n")
        environment = env_for(tmp, fixture)
        proc = run_installer(["--input", str(infile), "--result", str(outfile)], environment)
        check(proc.returncode == 1, "bad checksum exit")
        check(json.loads(outfile.read_text(encoding="utf-8"))["errorCode"] == "ARTIFACT_CHECKSUM_MISMATCH", "checksum code")
        check(fixture.read_text(encoding="utf-8") == before, "bad checksum wrote DNS")
        (artifact.parent / "mcp_install.sh").unlink()
        missing = run_installer(["--input", str(infile), "--result", str(outfile)], environment)
        check(json.loads(outfile.read_text(encoding="utf-8"))["errorCode"] == "ARTIFACT_MISSING", "missing artifact")
    real_data = Path("/var/lib/stalwart")
    existed = real_data.exists()
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        data = tmp / "var" / "lib" / "stalwart"
        infile, outfile, fixture, _payload = prepare(tmp)
        environment = env_for(tmp, fixture, {"BEARMAIL_INSTALL_DATA_DIR": str(data)})
        del environment["BEARMAIL_INSTALL_ASSUME_MOUNT"]
        dry = run_installer(["--dry-run", "--input", str(infile), "--result", str(outfile)], environment)
        check(dry.returncode == 0, f"dry-run missing data dir {dry.returncode}: {dry.stderr}")
        check(not data.exists(), "dry-run created the data directory")
        proc = run_installer(["--input", str(infile), "--result", str(outfile)], environment)
        check(proc.returncode == 0, f"create data dir exit {proc.returncode}: {proc.stderr}")
        check(data.is_dir(), "applying run did not create the data directory")
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        data = tmp / "occupied"
        data.mkdir()
        (data / "existing-store").write_text("mail", encoding="utf-8")
        infile, outfile, fixture, _payload = prepare(tmp)
        environment = env_for(tmp, fixture, {"BEARMAIL_INSTALL_DATA_DIR": str(data)})
        del environment["BEARMAIL_INSTALL_ASSUME_MOUNT"]
        proc = run_installer(["--input", str(infile), "--result", str(outfile)], environment)
        check(proc.returncode == 1, f"nonempty exit {proc.returncode}: {proc.stderr}")
        check(json.loads(outfile.read_text(encoding="utf-8"))["errorCode"] == "NONEMPTY_DATA_REFUSED", "nonempty code")
        check((data / "existing-store").is_file(), "nonempty refusal removed existing mail")
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        blocked = tmp / "blocked"
        blocked.write_text("not a directory", encoding="utf-8")
        infile, outfile, fixture, _payload = prepare(tmp)
        environment = env_for(tmp, fixture, {"BEARMAIL_INSTALL_DATA_DIR": str(blocked)})
        del environment["BEARMAIL_INSTALL_ASSUME_MOUNT"]
        proc = run_installer(["--input", str(infile), "--result", str(outfile)], environment)
        check(proc.returncode == 1, f"blocked data path exit {proc.returncode}: {proc.stderr}")
        check(json.loads(outfile.read_text(encoding="utf-8"))["errorCode"] == "SERVICE_FAILED", "blocked data path code")
        check(blocked.is_file(), "blocked path was replaced")
    check(real_data.exists() == existed, "test created /var/lib/stalwart")


def test_provider_auth_and_crash() -> None:
    for provider in ("namecom", "hostinger", "godaddy"):
        with tempfile.TemporaryDirectory() as raw:
            tmp = Path(raw)
            infile, outfile, fixture, _payload = prepare(tmp, provider=provider, http_status=401)
            before = fixture.read_text(encoding="utf-8")
            proc = run_installer(["--input", str(infile), "--result", str(outfile)], env_for(tmp, fixture))
            check(proc.returncode == 1, f"{provider} auth exit {proc.returncode}")
            result = json.loads(outfile.read_text(encoding="utf-8"))
            check(result["errorCode"] == "DNS_AUTH_FAILED", f"{provider} code {result.get('errorCode')}")
            check(fixture.read_text(encoding="utf-8") == before, f"{provider} auth wrote DNS")
            assert_clean(proc, outfile)
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        infile, outfile, fixture, _payload = prepare(tmp, provider="godaddy")
        environment = env_for(tmp, fixture)
        proc = run_installer(["--dry-run", "--input", str(infile), "--result", str(outfile)], environment)
        check(proc.returncode == 0, f"godaddy dry-run {proc.returncode}: {proc.stderr}")
        check(json.loads(outfile.read_text(encoding="utf-8"))["dns"]["minimumTtl"] == 600, "godaddy TTL")
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        infile, outfile, fixture, _payload = prepare(tmp)
        environment = env_for(tmp, fixture, {"BEARMAIL_INSTALL_FAIL_AFTER": "mx"})
        first = run_installer(["--input", str(infile), "--result", str(outfile)], environment)
        check(first.returncode == 10, f"partial exit {first.returncode}: {first.stderr}")
        partial = json.loads(outfile.read_text(encoding="utf-8"))
        check(partial["status"] == "dns_partial" and partial["retryable"] is True, "partial status")
        environment.pop("BEARMAIL_INSTALL_FAIL_AFTER")
        second = run_installer(["--input", str(infile), "--result", str(outfile)], environment)
        check(second.returncode == 0, f"retry exit {second.returncode}: {second.stderr}")
        zone = load_zone(fixture)
        check(sum(1 for item in zone if item["type"] == "MX") == 1, "retry MX count")
        check(sum(1 for item in zone if item["value"] == DKIM_VALUE) == 1, "retry DKIM count")


def test_smtp_login_without_brevo_records() -> None:
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        infile, outfile, fixture, payload = prepare(tmp)
        payload.pop("brevoDnsRecords")
        write_json(infile, payload)
        environment = env_for(tmp, fixture)
        proc = run_installer(["--dry-run", "--input", str(infile), "--result", str(outfile)], environment)
        check(proc.returncode == 0, f"omit records exit {proc.returncode}: {proc.stderr}")
        result = json.loads(outfile.read_text(encoding="utf-8"))
        values = [item["value"] for item in result["dns"]["published"]]
        check(not any(str(value).startswith("brevo-code:") for value in values), "omitted input published a Brevo code")
        check(not any(value == "k=rsa;p=BREVOKEY" for value in values), "omitted input published Brevo DKIM")
        check(not any(str(value).startswith("v=DMARC1") for value in values), "omitted input invented DMARC")
        check(result["dns"]["dmarcAction"] == "preserved", "absent Brevo DMARC stays unpublished")
        check(any(item["type"] == "MX" for item in result["dns"]["published"]), "mail MX still planned")
        payload["brevoDnsRecords"] = []
        write_json(infile, payload)
        empty = run_installer(["--dry-run", "--input", str(infile), "--result", str(outfile)], environment)
        check(empty.returncode == 0, f"empty records exit {empty.returncode}: {empty.stderr}")
        payload["brevoDnsRecords"] = brevo_records()[:2]
        write_json(infile, payload)
        partial = run_installer(["--dry-run", "--input", str(infile), "--result", str(outfile)], environment)
        check(partial.returncode == 2, f"partial records exit {partial.returncode}")
        del payload["brevoDnsRecords"]
        payload["relay"]["login"] = " "
        write_json(infile, payload)
        missing_login = run_installer(["--input", str(infile), "--result", str(outfile)], environment)
        check(missing_login.returncode == 2, f"blank SMTP login exit {missing_login.returncode}")


def test_invalid_input() -> None:
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        infile, outfile, _fixture, payload = prepare(tmp)
        payload["extra"] = True
        write_json(infile, payload)
        proc = run_installer(["--input", str(infile), "--result", str(outfile)], env_for(tmp, tmp / "zone.json"))
        check(proc.returncode == 2, f"unknown field exit {proc.returncode}")
        check(json.loads(outfile.read_text(encoding="utf-8"))["errorCode"] == "INVALID_INPUT", "unknown field code")
        infile.write_text("{", encoding="utf-8")
        broken = run_installer(["--input", str(infile), "--result", str(outfile)], env_for(tmp, tmp / "zone.json"))
        check(broken.returncode == 2, "broken json exit")
        check(outfile.is_file(), "broken json skipped the result file")
        missing = run_installer(["--input", str(infile)], env_for(tmp, tmp / "zone.json"))
        check(missing.returncode == 2, "missing result flag")


def test_no_prompt_driver() -> None:
    source = INSTALLER.read_text(encoding="utf-8")
    check("import pty" not in source, "bearmail-install still imports pty")
    check("Select Domain name provider" not in source, "bearmail-install still matches the DNS menu")
    check("45 * 60" not in source, "the prompt timeout remains")
    install_sh = (ROOT / "install.sh").read_text(encoding="utf-8")
    check("BEARMAIL_NONINTERACTIVE_FILE" in install_sh, "install.sh has no noninteractive answer file")
    check("Noninteractive install reached an interactive prompt" in install_sh, "prompts do not fail closed")


def main() -> int:
    if not os.access(INSTALLER, os.X_OK):
        fail("bearmail-install is not executable")
    test_no_prompt_driver()
    test_multiple_engine_dkim_keys()
    test_admin_account_alignment()
    test_dry_run_and_stdin()
    test_apply_publish_and_secrets()
    test_conflict_and_mx_flag()
    test_dmarc_and_spf_conflicts()
    test_artifacts_and_data_directory()
    test_provider_auth_and_crash()
    test_smtp_login_without_brevo_records()
    test_invalid_input()
    if FAILURES:
        print(f"{FAILURES} failure(s)", file=sys.stderr)
        return 1
    print("bearmail_install_test: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
