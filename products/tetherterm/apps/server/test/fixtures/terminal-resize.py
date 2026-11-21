import os
import signal
import sys

assert os.isatty(0) and os.isatty(1)
assert os.tcgetpgrp(0) == os.getpgrp() == os.getpid()
assert os.getsid(0) == os.getpid()


def report(label):
    size = os.get_terminal_size(0)
    print(f"{label}={size.columns}x{size.lines}", flush=True)


def resized(signum, frame):
    assert signum == signal.SIGWINCH
    report("SIGWINCH")


signal.signal(signal.SIGWINCH, resized)
report("INITIAL")
print("READY", flush=True)
for line in sys.stdin:
    command = line.strip()
    if command == "exit":
        sys.exit(7)
    report(command)
