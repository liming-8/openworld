from PIL import Image, ImageDraw, ImageFont
import os

SRC = r"C:\Users\32286\WorkBuddy\2026-10-10-12-59-02\openworld\_test\artifact\sweep"
OUT = r"C:\Users\32286\WorkBuddy\2026-10-10-12-59-02\openworld\_test\artifact\sweep-sheet.png"

n = 8
cols, rows = 4, 2
CW, CH = 640, 640
LBL = 34
FONT = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 22)

sheet = Image.new("RGB", (cols * CW, rows * (CH + LBL)), (18, 18, 20))
d = ImageDraw.Draw(sheet)

for i in range(n):
    p = os.path.join(SRC, f"yaw-{i}.png")
    if not os.path.exists(p):
        continue
    im = Image.open(p).convert("RGB")
    r, c = divmod(i, cols)
    x, y = c * CW, r * (CH + LBL)
    sheet.paste(im, (x, y + LBL))
    d.text((x + 10, y + 6), f"yaw {i}  ({i*45}deg)", font=FONT, fill=(240, 240, 240))

sheet.save(OUT)
print("saved", OUT, sheet.size)
