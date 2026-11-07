"""Ephemeral OANDA practice-only research launcher.

Asks for a token in the local console without echo or storing it in files.
The token is held only in the launched Python process environment. It can
grant trading access at the provider: keep your real-money token out of this.
"""
from __future__ import annotations
import getpass
import os

def main():
    print("Trader Research — OANDA Practice Candle Reader")
    print("Only OANDA fxPractice is enabled. No account trades or orders are sent.")
    print("Use a dedicated PRACTICE account token, never a live-money token.")
    existing = os.environ.get("OANDA_PRACTICE_TOKEN", "")
    if not existing:
        token = getpass.getpass("Paste your OANDA PRACTICE token (input hidden): ").strip()
        if not token:
            raise SystemExit("No token supplied. Use Start-Trader-Research.cmd for offline-only research.")
        if "\n" in token or "\r" in token or len(token) > 4096:
            raise SystemExit("Invalid practice token format")
        os.environ["OANDA_PRACTICE_TOKEN"] = token
    import workspace_server
    workspace_server.main()

if __name__ == "__main__":
    main()
