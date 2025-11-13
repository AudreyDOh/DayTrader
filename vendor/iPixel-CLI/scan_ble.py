#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import asyncio
from bleak import BleakScanner


async def main():
    devices = await BleakScanner.discover(timeout=10.0)
    if not devices:
        print("No BLE devices found. Ensure Bluetooth is on and the panel is powered.")
        return
    for d in devices:
        print(f"name={d.name!r} address={d.address}")


if __name__ == "__main__":
    asyncio.run(main())




