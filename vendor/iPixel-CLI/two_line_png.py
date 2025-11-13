# two_line_png.py
import sys, subprocess, shlex, asyncio
from io import BytesIO
from PIL import Image, ImageDraw, ImageFont, ImageChops

# Optional import for manual BLE streaming
try:
    from bleak import BleakClient
    import commands as ipx_cmd
except Exception:
    BleakClient = None
    ipx_cmd = None

if len(sys.argv) < 2:
    print("Usage: python3 two_line_png.py <BLE-UUID> [LINE1] [LINE2] [animation=1] [scroll=1 period_ms=1000 step=1 align=right]")
    sys.exit(1)

uuid  = sys.argv[1]
line1 = sys.argv[2] if len(sys.argv) > 2 else "AAPL 195.42  MSFT 418.11"
line2 = sys.argv[3] if len(sys.argv) > 3 else "GOOG 185.70  NVDA 899.22"

# Optional key=value extras
animate = False
scroll   = False
period_ms = 1000
step_px   = 1
align     = "center"  # left|center|right
if len(sys.argv) > 4:
    for extra in sys.argv[4:]:
        if "=" in extra:
            key, val = extra.split("=", 1)
            k = key.lower()
            v = val.strip()
            if k in {"animation", "animate"}:
                animate = v.lower() in {"1", "true", "yes"}
            elif k in {"scroll", "manual_scroll"}:
                scroll = v.lower() in {"1", "true", "yes"}
            elif k in {"period_ms", "delay_ms", "interval_ms"}:
                try:
                    period_ms = max(1, int(v))
                except Exception:
                    pass
            elif k in {"step", "step_px"}:
                try:
                    step_px = max(1, int(v))
                except Exception:
                    pass
            elif k in {"align", "start"}:  # start=right as shorthand
                vv = v.lower()
                if vv in {"left", "center", "right"}:
                    align = vv
                elif vv in {"r", "l", "c"}:
                    align = {"r": "right", "l": "left", "c": "center"}[vv]

# Panel
WIDTH, HEIGHT = 144, 16

# Font + styling
PREFERRED_FONT = "font/PixelOperator8.ttf"  # your TTF
FONT_SIZE  = 8
STROKE     = 0     # 0..2 (thicker)
TRACKING   = -1    # negative = tighter; try -2 if needed
COLOR_TOP    = (255, 0, 0)   # red
COLOR_BOTTOM = (0, 255, 0)   # green

def load_font():
    try:
        return ImageFont.truetype(PREFERRED_FONT, FONT_SIZE)
    except Exception:
        for p in [
            "/System/Library/Fonts/Supplemental/Andale Mono.ttf",
            "/System/Library/Fonts/Menlo.ttc",
        ]:
            try:
                return ImageFont.truetype(p, FONT_SIZE)
            except Exception:
                pass
        return ImageFont.load_default()

font = load_font()

def glyph_width(ch, draw):
    # Prefer font.getbbox; fallback to textlength (helps for spaces)
    try:
        box = font.getbbox(ch, stroke_width=STROKE)
        w = max(0, box[2] - box[0])
        if w == 0:
            w = int(draw.textlength(ch, font=font))
        return w
    except Exception:
        return int(draw.textlength(ch, font=font))

def render_band_with_tracking(text, top):
    mask = Image.new("1", (WIDTH, HEIGHT), 0)
    d = ImageDraw.Draw(mask)

    # Measure total width with tracking
    widths = [glyph_width(ch, d) for ch in text]
    total = sum(widths) + TRACKING * max(0, len(text) - 1)
    total = max(0, total)

    if align == "left":
        x = 0
    elif align == "right":
        x = max(0, WIDTH - total)
    else:
        x = max(0, (WIDTH - total) // 2)
    for i, ch in enumerate(text):
        d.text((x, top), ch, font=font, fill=1, stroke_width=STROKE, stroke_fill=1)
        x += widths[i] + TRACKING

    return mask.crop((0, top, WIDTH, top + 8))

mask_top = render_band_with_tracking(line1, 0)
mask_bot = render_band_with_tracking(line2, 8)

final = Image.new("RGB", (WIDTH, HEIGHT), (0, 0, 0))
final.paste(Image.new("RGB", (WIDTH, 8), COLOR_TOP), (0, 0), mask_top.convert("L"))
final.paste(Image.new("RGB", (WIDTH, 8), COLOR_BOTTOM), (0, 8), mask_bot.convert("L"))

out = "/tmp/two_line.png"
final.save(out, optimize=False)

async def stream_scroll(address, base_img, step, period_ms):
    if BleakClient is None or ipx_cmd is None:
        raise RuntimeError("Manual scroll requires bleak and commands modules.")
    # Tile horizontally for seamless loop
    tiled = Image.new("RGB", (WIDTH * 2, HEIGHT), (0, 0, 0))
    tiled.paste(base_img, (0, 0))
    tiled.paste(base_img, (WIDTH, 0))

    async with BleakClient(address) as client:
        while True:
            for left in range(0, WIDTH, step):
                frame = tiled.crop((left, 0, left + WIDTH, HEIGHT))
                buf = BytesIO()
                frame.save(buf, format="PNG", optimize=False)
                png_hex = buf.getvalue().hex()
                payload = ipx_cmd.send_png(png_hex)
                await client.write_gatt_char("0000fa02-0000-1000-8000-00805f9b34fb", payload)
                await asyncio.sleep(max(1, period_ms) / 1000.0)

if scroll:
    # Manual BLE scrolling: one-pixel (configurable) left movement every X ms
    asyncio.run(stream_scroll(uuid, final, step_px, period_ms))
    sys.exit(0)

if animate:
    # Single-direction (leftward) seamless scroll by tiling horizontally and cropping
    step = 2  # pixels per frame (lower = slower, higher = faster)
    tiled = Image.new("RGB", (WIDTH * 2, HEIGHT), (0, 0, 0))
    tiled.paste(final, (0, 0))
    tiled.paste(final, (WIDTH, 0))

    frames = [tiled.crop((left, 0, left + WIDTH, HEIGHT)) for left in range(0, WIDTH, step)]

    gif_out = "/tmp/two_line.gif"
    frames[0].save(gif_out, save_all=True, append_images=frames[1:], duration=80, loop=0, optimize=False, format="GIF")
    # mode=0 attempts forward-only playback on device
    cmd = f'python3 ipixelcli.py -a "{uuid}" -c send_animation path_or_hex={gif_out} mode=0'
else:
    cmd = f'python3 ipixelcli.py -a "{uuid}" -c send_png path_or_hex={out}'

print(cmd)
subprocess.run(shlex.split(cmd), check=True)