# InfraKit Studio — streaming Ansible callback plugin (ANSIBLE_MODULE_PLAN AN0).
#
# Emits one compact JSON object per line to the file named in
# $INFRAKIT_EVENT_FILE, so the Go backend can render a live play -> task ->
# host tree without scraping stdout. This file is SHIPPED WITH THE BACKEND
# and pointed at via ANSIBLE_CALLBACK_PLUGINS — it is not a Python dependency
# of the Go binary.
#
# CALLBACK_TYPE = 'notification' so it coexists with whatever stdout callback
# the user has configured. CALLBACK_NEEDS_ENABLED so it never activates by
# accident outside InfraKit.

from __future__ import annotations

import json
import os

from ansible.plugins.callback import CallbackBase


def _dump(v):
    """Best-effort JSON-safe copy of a task result's data."""
    try:
        json.dumps(v)
        return v
    except Exception:
        return str(v)


class CallbackModule(CallbackBase):
    CALLBACK_VERSION = 2.0
    CALLBACK_TYPE = "notification"
    CALLBACK_NAME = "infrakit_events"
    CALLBACK_NEEDS_ENABLED = True

    def __init__(self):
        super().__init__()
        self._fh = None
        path = os.environ.get("INFRAKIT_EVENT_FILE")
        if path:
            try:
                self._fh = open(path, "a", buffering=1, encoding="utf-8")
            except Exception:
                self._fh = None

    def _emit(self, obj):
        if not self._fh:
            return
        try:
            self._fh.write(json.dumps(obj, default=str, separators=(",", ":")) + "\n")
        except Exception:
            pass

    # ---- lifecycle ----------------------------------------------------

    def v2_playbook_on_start(self, playbook):
        self._emit({"e": "playbook_start", "playbook": getattr(playbook, "_file_name", "")})

    def v2_playbook_on_play_start(self, play):
        hosts = []
        try:
            hosts = list(play.get_variable_manager()._inventory.get_hosts(play.hosts))
            hosts = [str(h) for h in hosts]
        except Exception:
            pass
        self._emit({"e": "play_start", "play": play.get_name(), "hosts": hosts})

    def v2_playbook_on_task_start(self, task, is_conditional):
        self._emit(
            {
                "e": "task_start",
                "task": task.get_name(),
                "action": task.action,
                "uuid": str(task._uuid),
            }
        )

    def v2_playbook_on_handler_task_start(self, task):
        self._emit({"e": "task_start", "task": task.get_name(), "action": task.action, "handler": True})

    # ---- per-host results -------------------------------------------

    def _host_result(self, kind, result, extra=None):
        obj = {
            "e": kind,
            "host": result._host.get_name(),
            "task": result._task.get_name(),
            "changed": bool(result._result.get("changed", False)),
        }
        r = result._result
        for k in ("msg", "stdout", "stderr", "rc", "item", "results", "diff", "reason"):
            if k in r:
                obj[k] = _dump(r[k])
        if extra:
            obj.update(extra)
        self._emit(obj)

    def v2_runner_on_ok(self, result):
        self._host_result("runner_ok", result)

    def v2_runner_on_failed(self, result, ignore_errors=False):
        self._host_result("runner_failed", result, {"ignored": bool(ignore_errors)})

    def v2_runner_on_skipped(self, result):
        self._host_result("runner_skipped", result)

    def v2_runner_on_unreachable(self, result):
        self._host_result("runner_unreachable", result)

    def v2_runner_item_on_ok(self, result):
        self._host_result("item_ok", result)

    def v2_runner_item_on_failed(self, result):
        self._host_result("item_failed", result)

    def v2_runner_retry(self, result):
        r = result._result
        self._emit(
            {
                "e": "retry",
                "host": result._host.get_name(),
                "task": result._task.get_name(),
                "attempts": r.get("attempts"),
                "retries": r.get("retries"),
            }
        )

    # ---- recap ------------------------------------------------------

    def v2_playbook_on_stats(self, stats):
        recap = {}
        for host in sorted(stats.processed.keys()):
            s = stats.summarize(host)
            recap[host] = {
                "ok": s["ok"],
                "changed": s["changed"],
                "failures": s["failures"],
                "unreachable": s["unreachable"],
                "skipped": s["skipped"],
                "rescued": s.get("rescued", 0),
                "ignored": s.get("ignored", 0),
            }
        self._emit({"e": "stats", "hosts": recap})
        if self._fh:
            try:
                self._fh.flush()
            except Exception:
                pass
