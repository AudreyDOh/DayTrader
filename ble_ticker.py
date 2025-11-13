#!/usr/bin/env python3
import os
import time
import json
import argparse
import subprocess
from urllib.request import urlopen, Request

def fetch_messages(url: str):
    req = Request(url, headers={'User-Agent': 'ble-ticker/1.0'})
    with urlopen(req, timeout=10) as resp:
        data = resp.read().decode('utf-8', errors='ignore')
        payload = json.loads(data)
        return payload.get('messages', [])

def send_line(ipixel_path: str, mac: str, line: str, python_exec: str, speed: int, color: str, animation: int):
    # Ensure quotes are passed safely
    cmd = [
        python_exec, ipixel_path,
        '-a', mac,
        '-c', 'send_text', line,
        f'animation={animation}',
        f'speed={speed}',
        f'color={color}'
    ]
    subprocess.run(cmd, check=True)

def main():
    parser = argparse.ArgumentParser(description='Push LED ticker two-line messages to iPixel over BLE.')
    parser.add_argument('--mac', default=os.environ.get('BLE_MAC', ''), help='BLE MAC/Address for the display')
    parser.add_argument('--url', default=os.environ.get('TICKER_URL', 'http://localhost:3000/api/ticker'), help='Ticker API URL')
    parser.add_argument('--ipixel', default=os.environ.get('IPIXEL_PATH', 'vendor/iPixel-CLI/ipixelcli.py'), help='Path to ipixelcli.py')
    parser.add_argument('--python', default=os.environ.get('PYTHON_EXEC', 'python3'), help='Python executable to run iPixel CLI')
    parser.add_argument('--speed', type=int, default=int(os.environ.get('IPIXEL_SPEED', '10')), help='Text animation speed (0-100)')
    parser.add_argument('--color', default=os.environ.get('IPIXEL_COLOR', 'ffffff'), help='Hex color (without #)')
    parser.add_argument('--animation', type=int, default=int(os.environ.get('IPIXEL_ANIMATION', '1')), help='Animation style (0-7)')
    parser.add_argument('--interval', type=int, default=int(os.environ.get('TICKER_INTERVAL', '60')), help='Poll interval seconds')
    parser.add_argument('--once', action='store_true', help='Send once and exit')
    args = parser.parse_args()

    if not args.mac:
        raise SystemExit('Missing --mac (or set BLE_MAC env)')

    while True:
        try:
            messages = fetch_messages(args.url)
            if messages:
                text = messages[0]
                lines = (text or '').split('\n')
                # Ensure exactly two lines (pad or trim)
                if len(lines) == 1:
                    lines.append('')
                elif len(lines) > 2:
                    lines = lines[:2]
                # Send line 1 then line 2
                send_line(args.ipixel, args.mac, lines[0], args.python, args.speed, args.color, args.animation)
                time.sleep(0.5)
                send_line(args.ipixel, args.mac, lines[1], args.python, args.speed, args.color, args.animation)
        except Exception as e:
            print('Error:', e)

        if args.once:
            break
        time.sleep(args.interval)

if __name__ == '__main__':
    main()


