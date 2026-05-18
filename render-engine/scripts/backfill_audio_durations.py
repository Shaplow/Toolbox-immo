"""
Backfill MediaAsset.duration for all audio assets that don't have one yet.

ffprobe can probe remote HTTPS URLs directly — no file download needed.

Usage (depuis le container toolbox-render) :
    python scripts/backfill_audio_durations.py

DATABASE_URL est déjà injecté dans l'environnement du container via docker-compose.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys

import psycopg2
import psycopg2.extras


DATABASE_URL = os.environ.get("DATABASE_URL", "")
if not DATABASE_URL:
    sys.exit("DATABASE_URL not set")

# Assets stored before R2 were saved with relative paths (/uploads/...).
# The web container serves them at this base URL (accessible within Docker network).
WEB_BASE_URL = os.environ.get("WEB_BASE_URL", "http://web:3000")


def probe_duration(url: str) -> float | None:
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "json",
                url,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            return None
        data = json.loads(result.stdout)
        raw = data.get("format", {}).get("duration")
        if raw is None:
            return None
        d = float(raw)
        return d if d > 0 else None
    except Exception:
        return None


def main() -> None:
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    cur.execute(
        """
        SELECT ma.id, ma.url, ma.filename
        FROM "MediaAsset" ma
        JOIN "MediaLibrary" ml ON ml.id = ma."libraryId"
        WHERE ma.duration IS NULL
          AND ml.type = 'audio'
        ORDER BY ma."createdAt"
        """
    )
    assets = cur.fetchall()

    if not assets:
        print("All audio assets already have a duration.")
        conn.close()
        return

    print(f"Found {len(assets)} audio asset(s) with no duration. Probing...\n")

    ok = 0
    failed = 0

    for asset in assets:
        url = asset["url"]
        # Relative paths are served by the web container
        if url.startswith("/"):
            url = WEB_BASE_URL + url
        duration = probe_duration(url)
        if duration is not None:
            cur.execute(
                'UPDATE "MediaAsset" SET duration = %s WHERE id = %s',
                (duration, asset["id"]),
            )
            conn.commit()
            print(f"  ✓  {asset['filename']}  →  {duration:.1f}s")
            ok += 1
        else:
            print(f"  ✗  {asset['filename']}  →  probe failed")
            failed += 1

    conn.close()
    print(f"\nDone. {ok} updated, {failed} failed.")


if __name__ == "__main__":
    main()
