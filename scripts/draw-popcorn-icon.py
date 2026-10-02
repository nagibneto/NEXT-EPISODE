"""
Desenha o ícone de pipoca da aba "Para você" (assets/images/tabIcons/popcorn*.png).

Os pacotes de ícone do app não têm uma pipoca que leia como pipoca, e o
react-native-svg não está instalado, então o ícone é um PNG monocromático
pintado pela cor da aba (tintColor). Gera @1x/@2x/@3x e um preview.png.

Uso: python scripts/draw-popcorn-icon.py assets/images/tabIcons
(depois renomeie tab-popcorn*.png para popcorn*.png e apague o preview.png)
"""
from PIL import Image, ImageDraw
import sys, math
S = 1300
GAP = 32

m = Image.new('L', (S, S), 0)
d = ImageDraw.Draw(m)

def circle(cx, cy, r, v):
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=v)

def kernel(cx, cy, r, rot=0.0, lobes=4):
    """Grão estourado: um miolo com gomos em volta, formato de nuvem irregular."""
    parts = [(cx, cy, r * 0.62)]
    for i in range(lobes):
        ang = rot + i * 2 * math.pi / lobes
        rr = r * (0.50 + 0.10 * ((i * 7) % 3) / 2)
        parts.append((cx + math.cos(ang) * r * 0.48, cy + math.sin(ang) * r * 0.48, rr))
    for x, y, rr in parts:
        circle(x, y, rr + GAP, 0)
    for x, y, rr in parts:
        circle(x, y, rr, 255)

# De trás para a frente; alturas e tamanhos variados para não virar um domo.
kernels = [
    (690, 175, 125, 0.5, 4),
    (470, 225, 120, 1.2, 5),
    (880, 300, 120, 0.2, 4),
    (290, 360, 115, 0.9, 4),
    (1040, 450, 105, 1.6, 4),
    (175, 500, 100, 0.3, 4),
    (590, 385, 135, 0.0, 5),
    (800, 470, 115, 2.0, 4),
    (395, 485, 115, 1.4, 4),
]
for k in kernels:
    kernel(*k)

rim_top, rim_bot = 560, 655
d.rounded_rectangle((110 - GAP, rim_top - GAP, 1130 + GAP, rim_bot + GAP), radius=60, fill=0)
d.rounded_rectangle((110, rim_top, 1130, rim_bot), radius=46, fill=255)

top_y, bot_y = rim_bot + GAP, 1260
tl, tr, bl, br = 175, 1065, 320, 920
d.polygon([(tl, top_y), (tr, top_y), (br, bot_y), (bl, bot_y)], fill=255)

N = 5
for i in range(1, N):
    t = i / N
    xt = tl + (tr - tl) * t
    xb = bl + (br - bl) * t
    d.line([(xt, top_y - 2), (xb, bot_y + 2)], fill=0, width=GAP + 4)

bbox = m.getbbox()
m = m.crop(bbox)
w, h = m.size
side = int(max(w, h) / 0.94)
sq = Image.new('L', (side, side), 0)
sq.paste(m, ((side - w) // 2, (side - h) // 2))

out = sys.argv[1]
for name, px in [('tab-popcorn.png', 28), ('tab-popcorn@2x.png', 56), ('tab-popcorn@3x.png', 84)]:
    a = sq.resize((px, px), Image.LANCZOS)
    img = Image.new('RGBA', (px, px), (0, 0, 0, 0))
    img.putalpha(a)
    img.save(f'{out}/{name}')

prev = Image.new('RGB', (520, 160), (18, 18, 18))
for i, color in enumerate([(142, 142, 147), (92, 158, 255)]):
    a = sq.resize((84, 84), Image.LANCZOS)
    prev.paste(Image.new('RGB', (84, 84), color), (60 + i * 160, 38), a)
small = sq.resize((28, 28), Image.LANCZOS).resize((84, 84), Image.NEAREST)
prev.paste(Image.new('RGB', (84, 84), (92, 158, 255)), (380, 38), small)
prev.resize((1040, 320), Image.LANCZOS).save(f'{out}/preview.png')
