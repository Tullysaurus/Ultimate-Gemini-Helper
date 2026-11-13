"""UGH Desktop: hotkey-driven screen assistant HUD for Windows.

Run:  python main.py
"""

import multiprocessing

if __name__ == "__main__":
    # The calculator tools run in a child process; in the frozen exe that child re-runs this
    # executable, and freeze_support() turns it into the worker instead of a second app.
    multiprocessing.freeze_support()
    from ugh_desktop.app import main

    raise SystemExit(main())
