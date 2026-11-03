"""N722BD livery for the exterior model (data/ext, PAD Learjet 60 'N838' textures).

    python3 tools/livery.py data/ext

Writes <texture>_N722BD.webp next to each source texture; js/render.js prefers them when present.

Paint: a 2017 sales listing for N722BD (aircraft.com) describes the exterior as "overall white with gold and brown
stripes". The stripe layout here is the PAD model's own cheat line recoloured (gold with brown edges), so it is an
approximation of the real scheme, not a copy of it. Black paint becomes white; grey metal (leading edges, nacelle lips)
and the unused texture background are left alone.

Registration: the first box is the left side of the fin, the second the right side (mesh UVs; checked in the renderer
with colour-coded boxes). Both are stored unmirrored so they read left-to-right; the PAD texture stores its N838RC
mirrored.
"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

BOXES = [(864, 136, 946, 157), (72, 872, 152, 893)]          # learjet_fuse registration boxes (1024x1024)
FONTS = ['/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf', '/System/Library/Fonts/Helvetica.ttc',
         '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf']
WHITE, GOLD, BROWN, LETTER = np.array([236, 236, 232]), np.array([196, 156, 74]), np.array([96, 62, 38]), (28, 28, 30, 255)
PAINTED = ['learjet_fuse', 'LWING', 'RWING', 'Elevator', 'engineL60']

def font(size):
    for f in FONTS:
        try: return ImageFont.truetype(f, size)
        except OSError: pass
    return ImageFont.load_default()

def repaint(im, stripes):
    a = np.array(im).astype(np.float32); rgb = a[:, :, :3]; lum = rgb.mean(2)
    sat = rgb.max(2) - rgb.min(2)
    paint = (lum < 60) & (sat < 30)                                # black paint (keeps its panel-line shading as a tint)
    out = rgb.copy()
    shade = np.clip(lum / 60.0, 0, 1)[..., None]
    out[paint] = (WHITE * (0.86 + 0.14 * shade))[paint]
    if stripes:
        line = (lum > 110) & (sat < 30)
        # the cheat line: thin light pixels with paint just above and below. Fit a smooth curve through them on each
        # fuselage side view and paint a constant-width gold band with brown edges along it.
        up = np.zeros_like(line); dn = np.zeros_like(line)
        for k in range(1, 8): up |= np.roll(paint, k, 0); dn |= np.roll(paint, -k, 0)
        line &= up & dn
        H = line.shape[0]
        for y0, y1 in [(0, int(H * 0.3)), (int(H * 0.7), H)]:
            ys, xs = np.nonzero(line[y0:y1]); ys = ys + y0
            if len(xs) < 50: continue
            keep = np.ones(len(xs), bool)
            for _ in range(4):
                c = np.polyfit(xs[keep], ys[keep], 3); r = np.abs(np.polyval(c, xs) - ys); keep = r < max(4., np.percentile(r[keep], 70))
            x0, x1 = int(np.percentile(xs[keep], 1)), int(np.percentile(xs[keep], 99))
            for x in range(x0, x1 + 1):
                yc = np.polyval(c, x)
                for y in range(int(yc - 7), int(yc + 8)):
                    if not (0 <= y < H) or not (paint[y, x] or line[y, x]): continue
                    out[y, x] = GOLD if abs(y - yc) <= 3.5 else BROWN if abs(y - yc) <= 6.5 else out[y, x]
    a[:, :, :3] = out
    return Image.fromarray(a.clip(0, 255).astype(np.uint8), 'RGBA')

def registration(im, reg='N722BD'):
    for (x0, y0, x1, y1) in BOXES:
        w, h = x1 - x0, y1 - y0
        ImageDraw.Draw(im).rectangle((x0 - 2, y0 - 2, x1 + 2, y1 + 2), fill=tuple(int(v) for v in WHITE) + (255,))
        tile = Image.new('RGBA', (w * 4, h * 4), (0, 0, 0, 0)); d = ImageDraw.Draw(tile)
        f = font(int(h * 4 * 1.12)); bb = d.textbbox((0, 0), reg, font=f)
        d.text(((w * 4 - (bb[2] - bb[0])) / 2 - bb[0], (h * 4 - (bb[3] - bb[1])) / 2 - bb[1]), reg, font=f, fill=LETTER)
        im.alpha_composite(tile.resize((w, h), Image.LANCZOS), (x0, y0))
    return im

def main(d):
    for n in PAINTED:
        src = os.path.join(d, n + '.webp')
        if not os.path.exists(src): continue
        im = repaint(Image.open(src).convert('RGBA'), stripes=(n == 'learjet_fuse'))
        if n == 'learjet_fuse': im = registration(im)
        im.save(os.path.join(d, n + '_N722BD.webp'), quality=90, method=6)
        print('wrote', n + '_N722BD.webp')

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'data/ext')
