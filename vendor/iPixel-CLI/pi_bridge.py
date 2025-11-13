#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import time
import json
import hashlib
import subprocess
import shlex
from typing import Any, Dict, Optional

try:
    from dotenv import load_dotenv
except Exception:
    # optional; script still works if env is already provided
    def load_dotenv(*args, **kwargs):
        return False


def getenv_str(key: str, default: Optional[str] = None) -> Optional[str]:
    val = os.getenv(key, default)
    return val if (val is None or isinstance(val, str)) else str(val)


def getenv_int(key: str, default: int) -> int:
    try:
        return int(os.getenv(key, default))
    except Exception:
        return default


def getenv_bool(key: str, default: bool) -> bool:
    v = os.getenv(key)
    if v is None:
        return default
    return v.lower() in {"1", "true", "yes", "y", "on"}


def sha256_obj(obj: Any) -> str:
    data = json.dumps(obj, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def fetch_json(url: str, timeout: float = 5.0) -> Optional[Dict[str, Any]]:
    try:
        import requests
        resp = requests.get(url, timeout=timeout)
        if resp.status_code == 200:
            return resp.json()
        print(f"[WARN] GET {url} -> {resp.status_code}")
        return None
    except Exception as e:
        print(f"[ERROR] fetch_json: {e}")
        return None


def run_ipixel_command(address: str, command: str, params: Dict[str, Any]) -> int:
    """
    Execute ipixelcli.py with one command and key=value params.
    Example: run_ipixel_command(ADDR, "send_text", {"text": "Hello", "animation": 1, "speed": 70, "color": "ffffff"})
    """
    # ipixelcli expects -c <cmd> <k=v>...
    args = ["python3", "ipixelcli.py", "-a", address, "-c", command]
    for k, v in params.items():
        # booleans or numbers should be stringified without quotes
        args.append(f"{k}={v}")
    cmd = " ".join(shlex.quote(x) for x in args)
    print(f"[INFO] {cmd}")
    return subprocess.call(args)


def run_two_line(address: str, line1: str, line2: str, extras: Dict[str, Any]) -> int:
    """
    Use two_line_png.py for a two-line, colored message, with optional scrolling/animation.
    Extras may include: animate, scroll, period_ms, step, align
    """
    args = ["python3", "two_line_png.py", address, line1, line2]
    for k in ["animate", "animation", "scroll", "period_ms", "step", "align"]:
        if k in extras and extras[k] is not None:
            args.append(f"{k}={extras[k]}")
    print(f"[INFO] {' '.join(shlex.quote(x) for x in args)}")
    return subprocess.call(args)


def main():
    # Load .env if present
    load_dotenv()

    # Required
    ble_addr = getenv_str("LED_BLE_ADDR")
    if not ble_addr:
        print("[ERROR] Missing LED_BLE_ADDR in environment.")
        raise SystemExit(2)

    # One of the following should be set:
    # - PANEL_ENDPOINT returns consolidated payload (recommended)
    # - TWO_LINE_ENDPOINT returns { line1, line2, animate?, scroll?, period_ms?, step?, align? }
    panel_url = getenv_str("PANEL_ENDPOINT")
    two_line_url = getenv_str("TWO_LINE_ENDPOINT")

    if not panel_url and not two_line_url:
        print("[ERROR] Provide PANEL_ENDPOINT or TWO_LINE_ENDPOINT in environment.")
        raise SystemExit(2)

    poll_sec = max(1, getenv_int("POLL_INTERVAL_SEC", 5))
    quiet_redundant = getenv_bool("QUIET_REDUNDANT", True)  # skip re-sending identical payload

    last_hash: Optional[str] = None

    print("[INFO] Starting pi_bridge poller...")
    print(f"[INFO] BLE address: {ble_addr}")
    print(f"[INFO] Poll every {poll_sec}s")

    while True:
        try:
            payload: Optional[Dict[str, Any]] = None

            if two_line_url:
                payload = fetch_json(two_line_url)
                if payload is not None:
                    # Expect: { line1, line2, animate?, scroll?, period_ms?, step?, align? }
                    pl = {
                        "mode": "two_line",
                        "line1": payload.get("line1", ""),
                        "line2": payload.get("line2", ""),
                        "animate": payload.get("animate") or payload.get("animation"),
                        "scroll": payload.get("scroll"),
                        "period_ms": payload.get("period_ms"),
                        "step": payload.get("step"),
                        "align": payload.get("align"),
                    }
                    payload = pl
            elif panel_url:
                payload = fetch_json(panel_url)

            if payload is None:
                time.sleep(poll_sec)
                continue

            # de-duplicate
            cur_hash = sha256_obj(payload)
            if quiet_redundant and last_hash == cur_hash:
                time.sleep(poll_sec)
                continue

            mode = (payload.get("mode") or "text").lower()

            rc = 0
            if mode == "two_line":
                rc = run_two_line(
                    ble_addr,
                    str(payload.get("line1", ""))[:64],
                    str(payload.get("line2", ""))[:64],
                    {
                        "animate": payload.get("animate"),
                        "scroll": payload.get("scroll"),
                        "period_ms": payload.get("period_ms"),
                        "step": payload.get("step"),
                        "align": payload.get("align"),
                    },
                )
            elif mode == "text":
                # Expected fields: text, animation (0..7, int), speed (0..100, int), color (rrggbb), rainbow_mode (0..9), font, etc.
                text = str(payload.get("text", ""))[:100]
                params = {
                    "text": text,
                    "animation": int(payload.get("animation", 1)),
                    "speed": int(payload.get("speed", 70)),
                    "color": str(payload.get("color", "ffffff")),
                }
                # optional
                if "rainbow_mode" in payload:
                    params["rainbow_mode"] = int(payload["rainbow_mode"])
                if "save_slot" in payload:
                    params["save_slot"] = int(payload["save_slot"])
                if "font" in payload:
                    params["font"] = str(payload["font"])
                if "font_offset_x" in payload:
                    params["font_offset_x"] = int(payload["font_offset_x"])
                if "font_offset_y" in payload:
                    params["font_offset_y"] = int(payload["font_offset_y"])
                if "font_size" in payload:
                    params["font_size"] = int(payload["font_size"])

                rc = run_ipixel_command(ble_addr, "send_text", params)
            elif mode == "png":
                # Expected: png_path (absolute or repo path) OR png_hex
                path_or_hex = str(payload.get("png_path") or payload.get("png_hex") or "")
                if not path_or_hex:
                    print("[WARN] mode=png but no png_path or png_hex in payload")
                rc = run_ipixel_command(ble_addr, "send_png", {"path_or_hex": path_or_hex})
            elif mode == "animation" or mode == "gif":
                # Expected: gif_path or gif_hex, and optional mode byte (0..255)
                path_or_hex = str(payload.get("gif_path") or payload.get("gif_hex") or "")
                anim_mode = int(payload.get("mode", 1))
                rc = run_ipixel_command(ble_addr, "send_animation", {"path_or_hex": path_or_hex, "mode": anim_mode})
            elif mode == "brightness":
                rc = run_ipixel_command(ble_addr, "set_brightness", {"value": int(payload.get("value", 50))})
            elif mode == "clear":
                rc = run_ipixel_command(ble_addr, "clear", {})
            else:
                print(f"[WARN] Unknown mode: {mode}")

            if rc == 0:
                last_hash = cur_hash
            else:
                print(f"[WARN] Command exited with {rc}")
        except KeyboardInterrupt:
            print("[INFO] Stopping...")
            break
        except Exception as e:
            print(f"[ERROR] loop: {e}")
        finally:
            time.sleep(poll_sec)


if __name__ == "__main__":
    main()




