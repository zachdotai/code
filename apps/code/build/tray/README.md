# Tray icons

Pre-rendered icons used by the system tray on Windows and Linux. On macOS the
count is shown via `Tray.setTitle()` so only `badge-0.png` is needed.

Files:

- `badge-0.png` — base icon, shown when no agents are running.
- `badge-1.png` … `badge-9.png` — base icon with the digit overlaid in a badge.
- `badge-9plus.png` — base icon with "9+" overlaid for ten or more.

If a specific badge variant is missing the tray falls back to `badge-0.png` so
the count is still discoverable via the tooltip while the assets are being
designed.
