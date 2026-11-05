import json
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest

import hardware_smart as smart


class SmartCollectorTests(unittest.TestCase):
    def setUp(self):
        self.disk = {"device": "/dev/sda", "model": "Disk", "identity": "serial-a", "kind": "sat"}
        self.previous = {**self.disk, "sampled": 100, "passed": True, "temperature": 34}

    def runner(self, status, data=None):
        calls = []
        def run(args, **kwargs):
            calls.append(args)
            self.assertEqual(kwargs["timeout"], 10)
            return SimpleNamespace(returncode=status, stdout=json.dumps(data or {}))
        return run, calls

    def test_sleep_and_unknown_power_modes_never_retry_without_guard(self):
        for status, state in [(3, "sleeping"), (5, "unsupported")]:
            with self.subTest(state=state):
                run, calls = self.runner(status)
                result = smart.sample(self.disk, self.previous, 200, run)
                self.assertEqual(result["state"], state)
                self.assertEqual(result["sampled"], 100)
                self.assertEqual(result["temperature"], 34)
                self.assertEqual(len(calls), 1)
                self.assertEqual(calls[0], ["/usr/sbin/smartctl", "-j", "-H", "-A", "-i", "-d", "sat", "-n", "standby,3,5", "/dev/sda"])

    def test_unsupported_devices_are_not_opened(self):
        run, calls = self.runner(0)
        result = smart.sample({**self.disk, "kind": None}, {}, 200, run)
        self.assertEqual(result["state"], "unsupported")
        self.assertEqual(calls, [])

    def test_health_failure_is_a_valid_sample_not_a_command_failure(self):
        run, _ = self.runner(8, {"smart_status": {"passed": False}, "temperature": {"current": 52}})
        result = smart.sample(self.disk, self.previous, 200, run)
        self.assertFalse(result["passed"])
        self.assertEqual(result["sampled"], 200)
        self.assertEqual(result["state"], "online")

    def test_replaced_disk_cannot_inherit_old_health(self):
        run, _ = self.runner(3)
        result = smart.sample({**self.disk, "identity": "serial-b"}, self.previous, 200, run)
        self.assertNotIn("passed", result)
        self.assertNotIn("temperature", result)

    def test_nvme_and_missing_values(self):
        run, calls = self.runner(0, {"smart_status": {"passed": True}, "temperature": {"current": float("nan")}, "nvme_smart_health_information_log": {"percentage_used": 105}})
        result = smart.sample({**self.disk, "device": "/dev/nvme0n1", "kind": "nvme"}, self.previous, 200, run)
        self.assertNotIn("-n", calls[0])
        self.assertEqual(result["life"], 0)
        self.assertNotIn("temperature", result)
        self.assertEqual(result["sampled"], 200)

    def test_timeout_keeps_last_successful_sample(self):
        def timeout(*args, **kwargs):
            raise subprocess.TimeoutExpired("smartctl", 10)
        result = smart.sample(self.disk, self.previous, 200, timeout)
        self.assertEqual(result["state"], "error")
        self.assertEqual(result["sampled"], 100)

    def test_nvme_thresholds_are_read_once_and_exported_in_celsius(self):
        run, calls = self.runner(0, {"temperature": {"current": 81}, "nvme_composite_temperature_threshold": {"warning": 82, "critical": 90}})
        disk = {**self.disk, "device": "/dev/nvme0n1", "kind": "nvme"}
        result = smart.sample(disk, {}, 200, run)
        self.assertEqual(calls, [["/usr/sbin/smartctl", "-j", "-H", "-A", "-i", "-d", "nvme", "-c", "/dev/nvme0n1"]])
        self.assertEqual(result["temperature_warning"], 82)
        self.assertEqual(result["temperature_critical"], 90)
        metrics = smart.metrics([result], 200)
        self.assertIn('node_tiller_smart_collector_version 2', metrics)
        self.assertIn('node_tiller_smart_disk_temperature_warning_celsius{device="/dev/nvme0n1"} 82', metrics)
        self.assertIn('node_tiller_smart_disk_temperature_critical_celsius{device="/dev/nvme0n1"} 90', metrics)

    def test_nvme_thresholds_allow_partial_reports_and_discard_invalid_values(self):
        disk = {**self.disk, "device": "/dev/nvme0n1", "kind": "nvme"}
        for thresholds, expected in [
            ({"warning": 82}, {"temperature_warning": 82}),
            ({"critical": 90}, {"temperature_critical": 90}),
            ({"warning": 90, "critical": 80}, {"temperature_critical": 80}),
            ({"warning": 80, "critical": 80}, {"temperature_warning": 80, "temperature_critical": 80}),
            ({"warning": 0, "critical": 0}, {}),
            ({"warning": -1, "critical": 65535}, {}),
            ({"warning": True, "critical": "90"}, {}),
            ({"warning": float("nan"), "critical": float("inf")}, {}),
            (None, {}), ([], {}), ({}, {}),
        ]:
            with self.subTest(thresholds=thresholds):
                run, _ = self.runner(0, {"smart_status": {"passed": True}, "nvme_composite_temperature_threshold": thresholds})
                previous = {**disk, "temperature_warning": 70, "temperature_critical": 80}
                result = smart.sample(disk, previous, 200, run)
                self.assertTrue(result["passed"])
                self.assertEqual({key: result[key] for key in ("temperature_warning", "temperature_critical") if key in result}, expected)

    def test_nvme_error_preserves_thresholds_only_for_same_physical_device(self):
        disk = {**self.disk, "device": "/dev/nvme0n1", "kind": "nvme"}
        previous = {**disk, "temperature_warning": 82, "temperature_critical": 90}
        run, _ = self.runner(2)
        self.assertEqual(smart.sample(disk, previous, 200, run)["temperature_warning"], 82)
        replacement = smart.sample({**disk, "identity": "replacement"}, previous, 200, run)
        self.assertNotIn("temperature_warning", replacement)
        self.assertNotIn("temperature_critical", replacement)

    def test_inventory_uses_metadata_and_excludes_unknown_and_usb(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            for name, vendor in [("sda", "ATA"), ("sdb", "SEAGATE"), ("nvme0n1", ""), ("loop0", ""), ("dm-0", "")]:
                (root / name / "device").mkdir(parents=True)
                (root / name / "device/vendor").write_text(vendor)
            items = smart.inventory(root)
            self.assertEqual({d["device"]: d["kind"] for d in items}, {"/dev/sda": "sat", "/dev/sdb": None, "/dev/nvme0n1": "nvme"})
            (root / "usb1/sdc/device").mkdir(parents=True)
            (root / "usb1/sdc/device/vendor").write_text("ATA")
            (root / "sdc").symlink_to(root / "usb1/sdc")
            usb = next(d for d in smart.inventory(root) if d["device"] == "/dev/sdc")
            self.assertIsNone(usb["kind"])

    def test_metrics_preserve_sample_time_and_escape_labels(self):
        text = smart.metrics([{**self.previous, "state": "sleeping", "model": 'Disk "A"\ncache'}], 200)
        self.assertIn('state="sleeping"', text)
        self.assertIn('model="Disk \\"A\\"\\ncache"'.replace('\\\\"', '\\"'), text)
        self.assertIn('node_tiller_smart_disk_sample_timestamp_seconds{device="/dev/sda"} 100', text)
        self.assertIn('node_tiller_smart_collection_timestamp_seconds 200', text)


if __name__ == "__main__":
    unittest.main()
