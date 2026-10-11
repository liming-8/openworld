"""把"修复前 / 修复后"在同一机位下的截图拼成对照图"""
from PIL import Image, ImageDraw, ImageFont

ART = r"C:/Users/32286/WorkBuddy/2026-10-10-12-59-02/openworld/_test/artifact"

CROP = (258, 246, 1080, 594)          # 统一裁剪，避开左上状态栏、突出地表
IW = CROP[2] - CROP[0]
IH = CROP[3] - CROP[1]

BG = (24, 26, 31)
CARD = (33, 36, 43)
TXT = (232, 236, 244)
DIM = (150, 158, 172)
RED = (232, 104, 104)          # 修复前
GREEN = (96, 196, 148)         # 修复后

F = "C:/Windows/Fonts/msyh.ttc"
f_title = ImageFont.truetype(F, 30)
f_sub = ImageFont.truetype(F, 17)
f_cap = ImageFont.truetype(F, 19)
f_small = ImageFont.truetype(F, 15)

M = 26
TITLE_H = 92
CAP_H = 40
GAP = 16
FOOT_H = 62

W = M * 2 + IW * 2 + GAP
H = TITLE_H + (CAP_H + IH) * 2 + GAP + FOOT_H

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

# ---- 标题 ----
d.text((M, 20), "岩石建模修复对照 · 云脊山脉 (X715 Y56 Z288)", font=f_title, fill=TXT)
d.text((M, 58), "同一机位、同一时间、同一角色；唯一变量是 props.js 里的岩石几何体生成方式",
       font=f_sub, fill=DIM)

ROWS = [
    ("正对山脊（相机 yaw = π/2）", "repro.png", "after-B.png", "修复前", "修复后"),
    ("侧看山脊（相机 yaw = 0.628）", "probe.png", "after-A.png", "修复前", "修复后"),
]

for r, (_label, before, after, bl, al) in enumerate(ROWS):
    y = TITLE_H + r * (CAP_H + IH + GAP)

    # 行标题
    d.text((M, y + 8), _label, font=f_cap, fill=TXT)
    y2 = y + CAP_H

    for c, (fn, tag, col) in enumerate([(before, bl, RED), (after, al, GREEN)]):
        x = M + c * (IW + GAP)
        src = Image.open(f"{ART}/{fn}").convert("RGB").crop(CROP)
        img.paste(src, (x, y2))
        # 角标
        d.rectangle((x, y2, x + 92, y2 + 28), fill=col)
        d.text((x + 12, y2 + 4), tag, font=f_small, fill=(255, 255, 255))
        d.rectangle((x, y2, x + IW - 1, y2 + IH - 1), outline=(70, 76, 88), width=1)

# ---- 底部结论 ----
fy = TITLE_H + (CAP_H + IH) * 2 + GAP + 12
d.text((M, fy),
       "修复前：同一个空间顶点被复制成 5 份，却被按下标给了 5 个不同的偏移 —— 面片互相撕开，岩石碎成一堆飘着的三角板。"
       "boulder 有 720 条边是裂口，最长裂缝 2.96 米。",
       font=f_small, fill=(216, 176, 168))
d.text((M, fy + 24),
       "修复后：改用顶点的空间方向当随机种子，同一位置的所有副本位移完全一致 —— 边界边 720 → 0，几何体完全封闭；"
       "同时把过宽的岩簇收窄（boulder 跨度 13.9 m → 4.8 m）。",
       font=f_small, fill=(168, 212, 190))

img.save(f"{ART}/rock-fix-before-after.png")
print("已生成", f"{ART}/rock-fix-before-after.png", img.size)
