#!/usr/bin/env python3
import argparse
import json
import os
import re
import shutil
import stat
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ALLOWED_PAYLOAD_IDS = {
    "gpu_diagnostics_v1",
    "cpu_memory_diagnostics_v1",
    "gams_chat_v1",
}

ALLOWED_TEMPLATES = {
    "cpu_memory_diagnostics_v1",
    "gpu_diagnostics_v1",
    "gams_chat_v1_scaffold",
}

FORBIDDEN_FIELDS = {
    "command",
    "shellCommand",
    "remoteCommand",
    "sshCommand",
    "script",
    "scriptText",
    "jobScript",
    "yoloCommand",
    "password",
    "passphrase",
    "otp",
    "privateKey",
    "sshPrivateKey",
    "launchToken",
    "relayToken",
    "jobReportToken",
    "workloadToken",
    "token",
    "knownHosts",
    "known_hosts",
    "hostKey",
    "hostKeyAlias",
    "sshHost",
    "sshPort",
    "host",
    "port",
    "Authorization",
    "authorization",
}

SAFE_RESOURCE_RE = re.compile(r"^[A-Za-z0-9_@%+=:.,/-]{0,128}$")
SESSION_RE = re.compile(r"^sess_[A-Za-z0-9_-]{8,128}$")
HPC_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
PROFILE_RE = re.compile(r"^[A-Za-z0-9_.-]{1,96}$")
JOB_NAME_RE = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")
TIME_RE = re.compile(r"^(?:[0-9]{1,2}-)?[0-9]{1,2}:[0-5][0-9]:[0-5][0-9]$")
MEMORY_RE = re.compile(r"^[1-9][0-9]{0,5}(?:K|M|G|T)$", re.IGNORECASE)


class LauncherIntentError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def fail(code, message):
    raise LauncherIntentError(code, message)


def load_json(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def walk_forbidden(value, prefix=""):
    if isinstance(value, list):
        for index, item in enumerate(value):
            walk_forbidden(item, f"{prefix}[{index}]")
        return
    if not isinstance(value, dict):
        return
    for key, nested in value.items():
        if key in FORBIDDEN_FIELDS:
            fail("forbidden_field", f"forbidden field {prefix}{key}")
        walk_forbidden(nested, f"{prefix}{key}.")


def parse_time(value, name):
    if not isinstance(value, str):
        fail(f"invalid_{name}", f"{name} must be an ISO timestamp")
    normalized = value.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(normalized)
    except ValueError:
        fail(f"invalid_{name}", f"{name} must be an ISO timestamp")


def validate_intent(intent, session_id):
    if not isinstance(intent, dict):
        fail("invalid_intent", "session intent must be an object")
    walk_forbidden(intent)
    if intent.get("type") != "slaif.sessionIntent":
        fail("invalid_intent_type", "invalid session intent type")
    if intent.get("version") != 1:
        fail("invalid_intent_version", "invalid session intent version")
    if intent.get("sessionId") != session_id or not SESSION_RE.match(session_id):
        fail("invalid_session_id", "invalid session id")
    hpc = intent.get("hpc")
    if not isinstance(hpc, str) or not HPC_RE.match(hpc):
        fail("invalid_hpc", "invalid hpc alias")
    payload_id = intent.get("payloadId")
    if payload_id not in ALLOWED_PAYLOAD_IDS:
        fail("invalid_payload_id", "invalid payloadId")
    created_at = parse_time(intent.get("createdAt"), "createdAt")
    expires_at = parse_time(intent.get("expiresAt"), "expiresAt")
    if expires_at <= created_at:
        fail("invalid_expiry", "session intent expiry is invalid")
    if expires_at <= datetime.now(timezone.utc):
        fail("expired_intent", "session intent has expired")
    launcher = intent.get("launcher")
    if not isinstance(launcher, dict) or launcher.get("mode") != "normal":
        fail("invalid_launcher_mode", "launcher mode must be normal")
    return {
        "sessionId": session_id,
        "hpc": hpc.lower(),
        "payloadId": payload_id,
        "expiresAt": intent["expiresAt"],
    }


def safe_optional(value, name):
    if value in (None, ""):
        return ""
    if not isinstance(value, str) or not SAFE_RESOURCE_RE.match(value):
        fail(f"invalid_{name}", f"unsafe {name}")
    return value


def positive_int(value, name, max_value):
    if not isinstance(value, int) or value < 1 or value > max_value:
        fail(f"invalid_{name}", f"invalid {name}")
    return value


def validate_profile(profile):
    if not isinstance(profile, dict):
        fail("invalid_profile", "Slurm profile must be an object")
    walk_forbidden(profile)
    if not isinstance(profile.get("profileId"), str) or not PROFILE_RE.match(profile["profileId"]):
        fail("invalid_profile_id", "invalid profileId")
    payload_id = profile.get("payloadId")
    if payload_id not in ALLOWED_PAYLOAD_IDS:
        fail("invalid_payload_id", "invalid profile payloadId")
    if profile.get("scheduler") != "slurm":
        fail("invalid_scheduler", "scheduler must be slurm")
    if not isinstance(profile.get("jobName"), str) or not JOB_NAME_RE.match(profile["jobName"]):
        fail("invalid_job_name", "invalid jobName")
    if not isinstance(profile.get("timeLimit"), str) or not TIME_RE.match(profile["timeLimit"]):
        fail("invalid_time_limit", "invalid timeLimit")
    if not isinstance(profile.get("memory"), str) or not MEMORY_RE.match(profile["memory"]):
        fail("invalid_memory", "invalid memory")
    template = profile.get("template")
    if template not in ALLOWED_TEMPLATES:
        fail("invalid_template", "invalid template")
    if payload_id == "gams_chat_v1" and template != "gams_chat_v1_scaffold":
        fail("invalid_template", "gams_chat_v1 must use scaffold template")
    normalized = {
        "profileId": profile["profileId"],
        "payloadId": payload_id,
        "scheduler": "slurm",
        "jobName": profile["jobName"],
        "timeLimit": profile["timeLimit"],
        "cpusPerTask": positive_int(profile.get("cpusPerTask"), "cpusPerTask", 256),
        "memory": profile["memory"].upper(),
        "partition": safe_optional(profile.get("partition", ""), "partition"),
        "account": safe_optional(profile.get("account", ""), "account"),
        "qos": safe_optional(profile.get("qos", ""), "qos"),
        "gres": safe_optional(profile.get("gres", ""), "gres"),
        "gpus": None,
        "maxOutputBytes": positive_int(profile.get("maxOutputBytes"), "maxOutputBytes", 1048576),
        "template": template,
    }
    if profile.get("gpus") not in (None, ""):
        normalized["gpus"] = positive_int(profile["gpus"], "gpus", 64)
    return normalized


def resolve_profile(catalog, payload_id):
    if not isinstance(catalog, dict) or catalog.get("type") != "slaif.slurmProfileCatalog" or catalog.get("version") != 1:
        fail("invalid_profile_catalog", "invalid Slurm profile catalog")
    walk_forbidden(catalog)
    profiles = catalog.get("profiles")
    if not isinstance(profiles, dict) or not profiles:
        fail("invalid_profiles", "profiles must be a non-empty object")
    for key, value in profiles.items():
        profile = validate_profile(value)
        if key not in (profile["payloadId"], profile["profileId"]):
            fail("invalid_profile_key", "profile key must match payloadId or profileId")
        if profile["payloadId"] == payload_id:
            return profile
    fail("missing_profile", "missing Slurm profile for payloadId")


def ensure_work_dir(work_dir):
    path = Path(work_dir).expanduser()
    home = Path.home().resolve()
    resolved = path.resolve()
    allow_unsafe = os.environ.get("SLAIF_LAUNCHER_ALLOW_UNSAFE_WORK_DIR") == "1"
    if not allow_unsafe and not str(resolved).startswith(f"{home}{os.sep}"):
        fail("unsafe_work_dir", "work-dir must be under the user home")
    resolved.mkdir(parents=True, exist_ok=True)
    os.chmod(resolved, 0o700)
    return resolved


def render_script(template_dir, profile, intent, work_dir):
    template_path = Path(template_dir) / f"{profile['template']}.sh"
    if not template_path.is_file():
        fail("missing_template", "repository-owned template not found")
    body = template_path.read_text(encoding="utf-8")
    script_path = work_dir / f"{intent['sessionId']}-{profile['payloadId']}.sbatch.sh"
    content = "\n".join([
        "#!/bin/sh",
        "set -eu",
        f"export SLAIF_SESSION_ID={json.dumps(intent['sessionId'])}",
        f"export SLAIF_PAYLOAD_ID={json.dumps(profile['payloadId'])}",
        f"export SLAIF_WORK_DIR={json.dumps(str(work_dir))}",
        "",
        body,
        "",
    ])
    script_path.write_text(content, encoding="utf-8")
    script_path.chmod(script_path.stat().st_mode | stat.S_IXUSR)
    return script_path


def build_sbatch_args(profile, script_path):
    args = [
        "sbatch",
        "--job-name", profile["jobName"],
        "--time", profile["timeLimit"],
        "--cpus-per-task", str(profile["cpusPerTask"]),
        "--mem", profile["memory"],
        "--output", f"{script_path}.out",
        "--error", f"{script_path}.err",
    ]
    if profile["account"]:
        args.extend(["--account", profile["account"]])
    if profile["partition"]:
        args.extend(["--partition", profile["partition"]])
    if profile["qos"]:
        args.extend(["--qos", profile["qos"]])
    if profile["gres"]:
        args.extend(["--gres", profile["gres"]])
    if profile["gpus"] is not None:
        args.extend(["--gpus", str(profile["gpus"])])
    args.append(str(script_path))
    return args


def main():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--session", required=True)
    parser.add_argument("--intent-file", required=True)
    parser.add_argument("--profile-file", required=True)
    parser.add_argument("--work-dir", required=True)
    parser.add_argument("--template-dir", required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not SESSION_RE.match(args.session):
        fail("invalid_session_id", "invalid session id")
    intent = validate_intent(load_json(args.intent_file), args.session)
    profile = resolve_profile(load_json(args.profile_file), intent["payloadId"])
    work_dir = ensure_work_dir(args.work_dir)
    script_path = render_script(args.template_dir, profile, intent, work_dir)
    sbatch_args = build_sbatch_args(profile, script_path)

    if args.dry_run:
        print(json.dumps({
            "type": "slaif.launcherDryRun",
            "version": 1,
            "sessionId": intent["sessionId"],
            "hpc": intent["hpc"],
            "payloadId": intent["payloadId"],
            "profileId": profile["profileId"],
            "template": profile["template"],
            "scriptPath": str(script_path),
            "sbatchArgc": len(sbatch_args) - 1,
        }, sort_keys=True))
        return 0

    if shutil.which("sbatch") is None:
        fail("missing_sbatch", "sbatch not found")
    result = subprocess.run(sbatch_args, check=False, text=True, capture_output=True)
    if result.stdout:
        sys.stdout.write(result.stdout)
    if result.stderr:
        sys.stderr.write(result.stderr)
    if result.returncode != 0:
        return result.returncode
    if not re.search(r"^Submitted batch job [0-9]+$", result.stdout or "", re.MULTILINE):
        fail("missing_scheduler_output", "sbatch did not print canonical scheduler output")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except LauncherIntentError as error:
        print(f"slaif launcher intent failed: {error.code}: {error}", file=sys.stderr)
        sys.exit(4)
