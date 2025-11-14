#!/usr/bin/env python3
import os
import time
import json
import argparse
import subprocess
from urllib.request import urlopen, Request
from typing import Dict
from datetime import datetime

def fetch_messages(url: str):
    req = Request(url, headers={'User-Agent': 'ble-ticker/1.0'})
    with urlopen(req, timeout=10) as resp:
        data = resp.read().decode('utf-8', errors='ignore')
        payload = json.loads(data)
        return payload.get('messages', [])

def send_line(ipixel_path: str, mac: str, line: str, python_exec: str, speed: int, color: str, animation: int):
    # Ensure quotes are passed safely
    ipixel_abs = os.path.abspath(ipixel_path)
    ipixel_dir = os.path.dirname(ipixel_abs) or '.'
    ipixel_file = os.path.basename(ipixel_abs)
    cmd = [
        python_exec, ipixel_file,
        '-a', mac,
        '-c', 'send_text', line,
        f'animation={animation}',
        f'speed={speed}',
        f'color={color}'
    ]
    # Run with working directory set to the iPixel-CLI folder so relative 'font/' resolves
    subprocess.run(cmd, check=True, cwd=ipixel_dir)

def send_two_line_png(ipixel_path: str, mac: str, line1: str, line2: str, python_exec: str, png_opts: Dict[str, str]):
    # Run vendor/iPixel-CLI/two_line_png.py with proper CWD so font paths resolve
    ipixel_abs = os.path.abspath(ipixel_path)
    ipixel_dir = os.path.dirname(ipixel_abs) or '.'
    two_line_py = os.path.join(ipixel_dir, 'two_line_png.py')
    extras = []
    # Recognized options in two_line_png.py: animation/animate, scroll, period_ms, step, align
    if png_opts.get('animate'):
        extras.append('animate=1')
    if png_opts.get('scroll'):
        extras.append('scroll=1')
        # Support single-pass scroll by disabling loop in two_line_png
        if png_opts.get('once'):
            extras.append('scroll_once=1')
    if 'period_ms' in png_opts and png_opts['period_ms']:
        extras.append(f"period_ms={png_opts['period_ms']}")
    if 'step' in png_opts and png_opts['step']:
        extras.append(f"step={png_opts['step']}")
    if 'align' in png_opts and png_opts['align']:
        extras.append(f"align={png_opts['align']}")
    cmd = [python_exec, two_line_py, mac, line1, line2] + extras
    subprocess.run(cmd, check=True, cwd=ipixel_dir)

def main():
    parser = argparse.ArgumentParser(description='Push LED ticker two-line messages to iPixel over BLE.')
    parser.add_argument('--mac', default=os.environ.get('BLE_MAC', '410B2C35-FBEB-A20E-CB42-C690C2A28E2D'), help='BLE MAC/Address for the display')
    parser.add_argument('--url', default=os.environ.get('TICKER_URL', 'http://localhost:3000/api/ticker'), help='Ticker API URL')
    parser.add_argument('--ipixel', default=os.environ.get('IPIXEL_PATH', 'vendor/iPixel-CLI/ipixelcli.py'), help='Path to ipixelcli.py')
    parser.add_argument('--python', default=os.environ.get('PYTHON_EXEC', 'python3'), help='Python executable to run iPixel CLI')
    parser.add_argument('--speed', type=int, default=int(os.environ.get('IPIXEL_SPEED', '10')), help='Text animation speed (0-100)')
    parser.add_argument('--color', default=os.environ.get('IPIXEL_COLOR', 'ffffff'), help='Hex color (without #)')
    parser.add_argument('--animation', type=int, default=int(os.environ.get('IPIXEL_ANIMATION', '1')), help='Animation style (0-7)')
    parser.add_argument('--interval', type=int, default=int(os.environ.get('TICKER_INTERVAL', '60')), help='Poll interval seconds')
    parser.add_argument('--once', action='store_true', help='Send once and exit')
    parser.add_argument('--mode', choices=['text', 'png'], default=os.environ.get('IPIXEL_MODE', 'png'), help='Send as text or rendered PNG')
    # PNG-specific options
    parser.add_argument('--animate', action='store_true', default=os.environ.get('PNG_ANIMATE', 'false').lower() in ('1','true','yes'), help='Enable GIF scroll animation')
    parser.add_argument('--scroll', action='store_true', default=os.environ.get('PNG_SCROLL', 'false').lower() in ('1','true','yes'), help='Enable manual BLE scroll (requires bleak)')
    parser.add_argument('--scroll_once', action='store_true', default=os.environ.get('PNG_SCROLL_ONCE', 'false').lower() in ('1','true','yes'), help='When scrolling, perform one pass then return')
    parser.add_argument('--period_ms', type=int, default=int(os.environ.get('PNG_PERIOD_MS', '40')), help='Frame/scroll period in ms')
    parser.add_argument('--step', type=int, default=int(os.environ.get('PNG_STEP', '1')), help='Scroll step in pixels')
    parser.add_argument('--align', choices=['left','center','right'], default=os.environ.get('PNG_ALIGN', 'center'), help='Text alignment for PNG')
    # Logging
    parser.add_argument('--verbose', action='store_true', help='Enable verbose console logging')
    parser.add_argument('--log-file', default=os.environ.get('BLE_LOG_FILE', ''), help='Append debug logs to this file')
    parser.add_argument('--log-plain', action='store_true', default=os.environ.get('BLE_LOG_PLAIN', 'false').lower() in ('1','true','yes'), help='Log only the human-readable line (omit LED sensor formatting)')
    parser.add_argument('--dedupe', action='store_true', default=os.environ.get('BLE_DEDUPE', 'false').lower() in ('1','true','yes'), help='Skip sending duplicate plain-text messages back-to-back')
    args = parser.parse_args()

    if not args.mac:
        raise SystemExit('Missing --mac (or set BLE_MAC env)')

    # Default PNG mode to animated GIF (returns control so we can rotate messages)
    if args.mode == 'png' and not args.animate and not args.scroll:
        args.animate = True

    # Sanitize MAC/address in case a leading '-' was accidentally added
    mac = (args.mac or '').strip()
    if mac.startswith('-'):
        mac = mac.lstrip('-')

    def log(msg: str):
        ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        line = f"[{ts}] {msg}"
        if args.verbose:
            print(line, flush=True)
        if args.log_file:
            try:
                with open(args.log_file, 'a', encoding='utf-8') as f:
                    f.write(line + '\n')
            except Exception:
                pass

    log(f"Starting BLE sender | url={args.url} mode={args.mode} scroll={args.scroll} animate={args.animate} mac={mac}")

    last_plain = None
    while True:
        try:
            messages = fetch_messages(args.url)
            if messages:
                # Rotate through all messages so both phases are shown (decision/order/position/exit)
                for idx, text in enumerate(messages):
                    lines = (text or '').split('\n')
                    # Ensure exactly two lines (pad or trim)
                    if len(lines) == 1:
                        lines.append('')
                    elif len(lines) > 2:
                        lines = lines[:2]
                    log(f"Fetched message[{idx}] | line1='{lines[0]}' line2='{lines[1]}'")
                    plain_line = lines[1] if len(lines) > 1 else lines[0]
                    if args.log_plain:
                        log(f"Plain: {plain_line}")

                    if args.dedupe and idx == 0 and plain_line == last_plain:
                        log("Duplicate message detected on first message, skipping cycle.")
                        continue
                    if args.mode == 'png':
                        png_opts = {
                            'animate': bool(args.animate),
                            'scroll': bool(args.scroll),
                            'once': bool(args.scroll_once),
                            'period_ms': str(args.period_ms),
                            'step': str(args.step),
                            'align': args.align
                        }
                        if args.scroll:
                            log("Sending PNG manual scroll...")
                            send_two_line_png(args.ipixel, mac, lines[0], lines[1], args.python, png_opts)
                            log("PNG scroll done")
                        else:
                            log("Sending PNG animate (gif)...")
                            send_two_line_png(args.ipixel, mac, lines[0], lines[1], args.python, png_opts)
                            log("PNG animate sent OK")
                    else:
                        # Send line 1 then line 2 (if not PNG mode)
                        log(f"Sending TEXT line 1...")
                        send_line(args.ipixel, mac, lines[0], args.python, args.speed, args.color, args.animation)
                        time.sleep(0.5)
                        log(f"Sending TEXT line 2...")
                        send_line(args.ipixel, mac, lines[1], args.python, args.speed, args.color, args.animation)
                    if idx == 0:
                        last_plain = plain_line
        except Exception as e:
            log(f"Error: {e}")

        if args.once:
            break
        time.sleep(args.interval)

if __name__ == '__main__':
    main()


