"""把"角色悬空"的同机位对照图拼成一张"""
from PIL import Image, ImageDraw, ImageFont

ART = r"C:/Users/32286/WorkBuddy/2026-10-10-12-59-02/openworld/_test/artifact"

CROP = (300, 170, 860, 560)          # 两张图用同一个裁剪框
IW, IH = CROP[2] - CROP[0], CROP[3] - CROP[1]

BG, TXT, DIM = (24, 26, 31), (232, 236, 244), (150, 158, 172)
RED, GREEN = (226, 98, 98), (86, 190, 140)

F = "C:/Windows/Fonts/msyh.ttc"
f_title = ImageFont.truetype(F, 30)
f_sub = ImageFont.truetype(F, 17)
f_cap = ImageFont.truetype(F, 19)
f_small = ImageFont.truetype(F, 15)

M, TITLE_H, CAP_H, GAP, FOOT_H = 26, 92, 40, 16, 70
W = M * 2 + IW * 2 + GAP
H = TITLE_H + CAP_H + IH + GAP + FOOT_H

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

d.text((M, 18), "角色「走路悬空」修复对照", font=f_title, fill=TXT)
d.text((M, 56), "同一地点 (X1261 Z-136)、同一相机位姿；唯一差别是角色贴地时用的是哪个高度",
       font=f_sub, fill=DIM)

y2 = TITLE_H + CAP_H
d.text((M, TITLE_H + 8), "修复前", font=f_cap, fill=RED)
d.text((M + IW + GAP, TITLE_H + 8), "修复后", font=f_cap, fill=GREEN)

for c, fn in enumerate(["float-before.png", "float-after.png"]):
    x = M + c * (IW + GAP)
    src = Image.open(f"{ART}/{fn}").convert("RGB").crop(CROP)
    img.paste(src, (x, y2))
    d.rectangle((x, y2, x + IW - 1, y2 + IH - 1), outline=(70, 76, 88), width=1)

fy = y2 + IH + 12
d.text((M, fy),
       "修复前：角色贴的是 height() 解析高度（4.58 米），而画出来的地面只有 2.37 米 —— 角色虚浮在沙丘上方 2.21 米，投影落在脚下很远的地方。",
       font=f_small, fill=(226, 176, 168))
d.text((M, fy + 24),
       "修复后：角色改用与地形网格逐点一致的 meshHeight()，脚直接踩在沙面上，投影就在脚边。实测两者偏差 0.0000 米。",
       font=f_small, fill=(168, 212, 190))

img.save(f"{ART}/float-fix-before-after.png")
print("已生成", f"{ART}/float-fix-before-after.png", img.size)
