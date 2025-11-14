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
animate   = False
scroll    = False
period_ms = 1000
step_px   = 1
align     = "center"  # left|center|right
loop_scroll = True    # when scrolling, loop forever by default; set to False for one pass
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
            elif k in {"loop", "scroll_loop"}:
                loop_scroll = v.lower() in {"1", "true", "yes"}
            elif k in {"once", "scroll_once"}:
                loop_scroll = not (v.lower() in {"1", "true", "yes"})

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
    # Render band to its natural width so long text isn't clipped
    tmp = Image.new("1", (1, 1), 0)
    d = ImageDraw.Draw(tmp)

    # Measure total width with tracking
    widths = [glyph_width(ch, d) for ch in text]
    total = sum(widths) + TRACKING * max(0, len(text) - 1)
    total = max(0, total)

    # Always start from x=0 to allow full-width scrolling
    x = 0
    band = Image.new("1", (max(1, total), 8), 0)
    d = ImageDraw.Draw(band)
    for i, ch in enumerate(text):
        d.text((x, 0), ch, font=font, fill=1, stroke_width=STROKE, stroke_fill=1)
        x += widths[i] + TRACKING
    return band

mask_top = render_band_with_tracking(line1, 0)
mask_bot = render_band_with_tracking(line2, 8)

# Base canvas width is max of panel width and text widths
BASE_W = max(WIDTH, mask_top.width, mask_bot.width)
final = Image.new("RGB", (BASE_W, HEIGHT), (0, 0, 0))
# Paste using sources that match each mask's width
src_top = Image.new("RGB", (mask_top.width, 8), COLOR_TOP)
final.paste(src_top, (0, 0), mask_top.convert("L"))
src_bot = Image.new("RGB", (mask_bot.width, 8), COLOR_BOTTOM)
final.paste(src_bot, (0, 8), mask_bot.convert("L"))

out = "/tmp/two_line.png"
final.save(out, optimize=False)

async def stream_scroll(address, base_img, step, period_ms, loop=True):
    if BleakClient is None or ipx_cmd is None:
        raise RuntimeError("Manual scroll requires bleak and commands modules.")
    # Tile horizontally for seamless loop (base width + panel width)
    base_w = base_img.width
    if loop:
        tiled = Image.new("RGB", (base_w + WIDTH, HEIGHT), (0, 0, 0))
        tiled.paste(base_img, (0, 0))
        tiled.paste(base_img, (base_w, 0))
        range_end = base_w
    else:
        # Single pass: add blank padding so text fully exits the panel once
        tiled = Image.new("RGB", (base_w + WIDTH, HEIGHT), (0, 0, 0))
        tiled.paste(base_img, (0, 0))
        range_end = base_w + WIDTH

    async with BleakClient(address) as client:
        keep_running = True
        while keep_running:
            for left in range(0, range_end, step):
                frame = tiled.crop((left, 0, left + WIDTH, HEIGHT))
                buf = BytesIO()
                frame.save(buf, format="PNG", optimize=False)
                png_hex = buf.getvalue().hex()
                payload = ipx_cmd.send_png(png_hex)
                await client.write_gatt_char("0000fa02-0000-1000-8000-00805f9b34fb", payload)
                await asyncio.sleep(max(1, period_ms) / 1000.0)
            if not loop:
                keep_running = False

if scroll:
    # Manual BLE scrolling: one-pixel (configurable) left movement every X ms
    asyncio.run(stream_scroll(uuid, final, step_px, period_ms, loop_scroll))
    sys.exit(0)

if animate:
    # Single-direction (leftward) seamless scroll by tiling horizontally and cropping
    # Use provided step/period if available
    step = max(1, step_px)  # pixels per frame (lower = slower, higher = faster)
    tiled = Image.new("RGB", (BASE_W + WIDTH, HEIGHT), (0, 0, 0))
    tiled.paste(final, (0, 0))
    tiled.paste(final, (BASE_W, 0))

    frames = [tiled.crop((left, 0, left + WIDTH, HEIGHT)) for left in range(0, BASE_W, step)]

    gif_out = "/tmp/two_line.gif"
    # Use period_ms as frame duration when animating
    frame_ms = max(10, period_ms)
    frames[0].save(gif_out, save_all=True, append_images=frames[1:], duration=frame_ms, loop=0, optimize=False, format="GIF")
    # mode=0 attempts forward-only playback on device
    cmd = f'python3 ipixelcli.py -a "{uuid}" -c send_animation path_or_hex={gif_out} mode=0'
else:
    cmd = f'python3 ipixelcli.py -a "{uuid}" -c send_png path_or_hex={out}'

print(cmd)
subprocess.run(shlex.split(cmd), check=True)