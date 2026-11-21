#!/usr/bin/env python3
"""Failure-boundary and caller-port regression checks; no servers are started."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("verify.py")


def load_runner():
    spec = importlib.util.spec_from_file_location("invitation_verify", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class VerifierTests(unittest.TestCase):
    def test_caller_ports_are_preserved(self):
        with patch.dict(os.environ, {"PUBLIC_PORT": "4533", "NEXT_INTERNAL_PORT": "5533"}):
            runner = load_runner()
        self.assertEqual(runner.ENV["PUBLIC_PORT"], "4533")
        self.assertEqual(runner.ENV["NEXT_INTERNAL_PORT"], "5533")

    def test_only_unset_ports_receive_defaults(self):
        with patch.dict(os.environ, {"PATH": os.environ["PATH"]}, clear=True):
            runner = load_runner()
        self.assertEqual(runner.ENV["PUBLIC_PORT"], "4133")
        self.assertEqual(runner.ENV["NEXT_INTERNAL_PORT"], "5133")

    def test_failure_tails_and_printed_commands_are_redacted(self):
        runner = load_runner()
        secret = "A" * 43
        raw = f"navigation failed: https://localhost:4533/r/public#s={secret}\nkey: {secret}\n#s=short\n"
        result = subprocess.CompletedProcess("mock", 1, stdout=raw)
        with tempfile.TemporaryDirectory() as directory:
            runner.EVIDENCE = Path(directory)
            stdout = io.StringIO()
            with patch.object(runner.subprocess, "run", return_value=result), patch.object(sys, "argv", ["verify.py", "failure-test"]), contextlib.redirect_stdout(stdout):
                with self.assertRaises(SystemExit) as failure:
                    runner.run("failure", f"echo https://localhost:4533/r/public#s={secret}")
            self.assertEqual(failure.exception.code, 1)
            texts = [stdout.getvalue(), *[p.read_text() for p in Path(directory).iterdir()]]
            self.assertTrue(all(secret not in text and "#s=short" not in text for text in texts))
            self.assertTrue(all("redacted" in text for text in texts))
            self.assertEqual(json.loads((Path(directory) / "failure-test-commands.json").read_text())[0]["exit"], 1)

    def test_browser_mode_uses_inherited_ports_everywhere(self):
        with patch.dict(os.environ, {"PUBLIC_PORT": "4533", "NEXT_INTERNAL_PORT": "5533"}):
            runner = load_runner()
        server = unittest.mock.Mock(pid=123)
        server.poll.return_value = None
        readiness = subprocess.CompletedProcess("curl", 0)
        with tempfile.TemporaryDirectory() as directory:
            runner.EVIDENCE = Path(directory)
            with patch.object(sys, "argv", ["verify.py", "browser"]), patch.object(runner.subprocess, "Popen", return_value=server) as spawn, patch.object(runner.subprocess, "run", return_value=readiness) as curl, patch.object(runner, "run") as commands, patch.object(runner.os, "killpg"), contextlib.redirect_stdout(io.StringIO()):
                runner.main()
            self.assertEqual(spawn.call_args.kwargs["env"]["PUBLIC_PORT"], "4533")
            self.assertEqual(spawn.call_args.kwargs["env"]["NEXT_INTERNAL_PORT"], "5533")
            self.assertIn("https://localhost:4533", curl.call_args.args[0])
            self.assertTrue(all("4133" not in call.args[1] and "5133" not in call.args[1] for call in commands.call_args_list))
            evidence = (Path(directory) / "dev-https.txt").read_text()
            self.assertIn("PUBLIC_PORT=4533 NEXT_INTERNAL_PORT=5533", evidence)


if __name__ == "__main__":
    unittest.main()
