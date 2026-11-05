#!/usr/bin/python3
"""Read-only SMART samples for node_exporter's textfile collector.

Inventory comes from cached sysfs metadata, never smartctl --scan/open.
ATA uses an explicit device type and stops on unsupported power-state checks.
Unknown rotational devices, USB bridges and RAID mappings are not probed.
The timer runs independently of browsers; all cache writes stay in /run.
"""

import json
import math
import os
from pathlib import Path
import re
import subprocess
import time

CACHE_DIR = Path("/run/tiller-node-exporter")
DEVICE_NAME = re.compile(r"(?:sd[a-z]+|nvme[0-9]+n[0-9]+)\Z")


def read(path):
    try:
        return path.read_text().strip()
    except OSError:
        return ""


def inventory(root=Path("/sys/block")):
    devices = []
    for entry in sorted(root.iterdir()):
        if not DEVICE_NAME.fullmatch(entry.name):
            continue
        vendor = read(entry / "device/vendor")
        model = read(entry / "device/model") or entry.name
        identity = read(entry / "device/serial") or read(entry / "device/wwid") or read(entry / "wwid")
        real = str(entry.resolve())
        kind = None
        if "/usb" not in real and "/virtual/" not in real:
            if entry.name.startswith("nvme"):
                kind = "nvme"
            elif vendor == "ATA":
                kind = "sat"
        devices.append({"device": "/dev/" + entry.name, "model": model, "identity": identity, "kind": kind})
    return devices


def finite(value, low, high):
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and low <= value <= high:
        return value
    return None


def sample(device, previous, now, run=subprocess.run):
    # A reused /dev name must never inherit the previous physical disk's health.
    old = previous if isinstance(previous, dict) and device["identity"] and previous.get("identity") == device["identity"] else {}
    item = {**old, **device, "state": "unsupported", "checked": now}
    if not device["kind"]:
        return item
    args = ["/usr/sbin/smartctl", "-j", "-H", "-A", "-i", "-d", device["kind"]]
    if device["kind"] == "nvme":
        # Identify Controller temperature thresholds are emitted by -c.
        args += ["-c"]
    if device["kind"] == "sat":
        args += ["-n", "standby,3,5"]
    args.append(device["device"])
    try:
        result = run(args, capture_output=True, text=True, timeout=10, check=False)
        if result.returncode in (3, 5) and device["kind"] == "sat":
            item["state"] = "sleeping" if result.returncode == 3 else "unsupported"
            return item
        data = json.loads(result.stdout)
        if result.returncode & 7:
            item["state"] = "error"
            return item
        passed = data.get("smart_status", {}).get("passed")
        temperature = finite(data.get("temperature", {}).get("current"), -50, 150)
        used = finite(data.get("nvme_smart_health_information_log", {}).get("percentage_used"), 0, 1000)
        if not isinstance(passed, bool) and temperature is None and used is None:
            return item
        # Valid new samples replace missing fields instead of retaining stale
        # temperatures under a new timestamp. Health-failure exit bits are data.
        item = {**device, "model": data.get("model_name") or device["model"], "state": "online", "checked": now, "sampled": now}
        if isinstance(passed, bool):
            item["passed"] = passed
        if temperature is not None:
            item["temperature"] = temperature
        if device["kind"] == "nvme":
            thresholds = data.get("nvme_composite_temperature_threshold")
            if isinstance(thresholds, dict):
                warning = finite(thresholds.get("warning"), 1, 200)
                critical = finite(thresholds.get("critical"), 1, 200)
                if critical is not None:
                    item["temperature_critical"] = critical
                if warning is not None and (critical is None or warning <= critical):
                    item["temperature_warning"] = warning
        if used is not None:
            item["life"] = max(0, 100 - used)
        return item
    except (OSError, ValueError, TypeError, AttributeError, subprocess.TimeoutExpired):
        item["state"] = "error"
        return item


def label(value):
    return str(value).replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def metrics(items, now):
    lines = ["node_tiller_smart_collector_version 2", f"node_tiller_smart_collection_timestamp_seconds {now}"]
    for item in items:
        device = label(item["device"])
        lines.append(f'node_tiller_smart_disk_info{{device="{device}",model="{label(item["model"])}",state="{item["state"]}"}} 1')
        for key, metric in (("sampled", "sample_timestamp_seconds"), ("temperature", "temperature_celsius"), ("temperature_warning", "temperature_warning_celsius"), ("temperature_critical", "temperature_critical_celsius"), ("life", "life_remaining_percent"), ("passed", "health_passed")):
            if key in item:
                value = int(item[key]) if isinstance(item[key], bool) else item[key]
                lines.append(f'node_tiller_smart_disk_{metric}{{device="{device}"}} {value}')
    return "\n".join(lines) + "\n"


def atomic(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(value)
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)


def main():
    os.umask(0o077)
    CACHE_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    previous = {}
    try:
        previous = json.loads((CACHE_DIR / "smart.json").read_text())
    except (OSError, ValueError):
        pass
    if not isinstance(previous, dict):
        previous = {}
    started = time.monotonic()
    now = int(time.time())
    result = []
    for device in inventory():
        if time.monotonic() - started > 160:
            result.append({**device, "state": "error", "checked": now})
        else:
            result.append(sample(device, previous.get(device["device"], {}), now))
    atomic(CACHE_DIR / "smart.json", json.dumps({item["device"]: item for item in result}))
    atomic(CACHE_DIR / "smart.prom", metrics(result, now))


if __name__ == "__main__":
    main()
