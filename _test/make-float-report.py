"""把"角色悬空"的修复前后对照拼成一张可读的报告图。"""
from PIL import Image, ImageDraw, ImageFont

A = r"C:\Users\32286\WorkBuddy\2026-10-10-12-59-02\openworld\_test\artifact"
OUT = A + r"\float-fix-report.png"

SANS = "C:/Windows/Fonts/msyh.ttc"
BOLD = "C:/Windows/Fonts/msyhbd.ttc"
F_TITLE = ImageFont.truetype(BOLD, 34)
F_SUB = ImageFont.truetype(SANS, 19)
F_TAG = ImageFont.truetype(BOLD, 24)
F_CAP = ImageFont.truetype(SANS, 18)
F_FOOT = ImageFont.truetype(SANS, 18)
F_NUM = ImageFont.truetype(BOLD, 20)

PAD = 22
GAP = 18
PANEL_W = 618
IMG_H = 348          # 618 / (1280/720) ≈ 347.6
HEAD_H = 104
TAG_H = 40
CAP_H = 92
FOOT_H = 74

W = PAD * 2 + PANEL_W * 2 + GAP
H = PAD + HEAD_H + TAG_H + IMG_H + CAP_H + FOOT_H + PAD

BG = (22, 24, 28)
CARD = (32, 35, 41)
WHITE = (238, 240, 244)
DIM = (150, 156, 168)
RED = (232, 96, 88)
GREEN = (108, 208, 140)
LINE = (54, 58, 68)

canvas = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(canvas)

# ── 标题 ──
y = PAD + 2
d.text((PAD, y), "角色「走路悬空」修复对照", font=F_TITLE, fill=WHITE)
y += 46
d.text((PAD, y),
       "同一地点 X1261 Z-136（烫金流沙）· 同一相机位姿 · 唯一差别是角色贴的是哪个高度 —— 因此两张图除角色位置外完全重合",
       font=F_SUB, fill=DIM)

y = PAD + HEAD_H
for i, (name, tag, tagcol, cap, num) in enumerate([
    ("fin-before.png", "修复前", RED,
     "角色贴的是解析高度 height() = 4.58 米，而画出来的沙丘面只有 2.37 米。\n"
     "角色虚浮在沙面上方 2.21 米 —— 影子落在脚下方很远处，状态一直是「下落」。",
     "离地 +2.21 m"),
    ("fin-after.png", "修复后", GREEN,
     "角色改用与地形网格逐点一致的 meshHeight() = 2.37 米，脚直接踩在沙面上。\n"
     "影子回到脚边，脚底与地面的偏差实测为 0.0000 米。",
     "离地 0.0000 m"),
]):
    x = PAD + i * (PANEL_W + GAP)
    # 标签
    d.text((x, y), tag, font=F_TAG, fill=tagcol)
    tw = d.textlength(num, font=F_NUM)
    d.text((x + PANEL_W - tw, y + 4), num, font=F_NUM, fill=tagcol)
    d.line([(x, y + TAG_H - 10), (x + PANEL_W, y + TAG_H - 10)], fill=LINE, width=2)

    im = Image.open(f"{A}\\{name}").convert("RGB").resize((PANEL_W, IMG_H), Image.LANCZOS)
    canvas.paste(im, (x, y + TAG_H))

    cy = y + TAG_H + IMG_H + 12
    for ln in cap.split("\n"):
        d.text((x, cy), ln, font=F_CAP, fill=DIM)
        cy += 26

# ── 页脚：实测数据 ──
fy = H - PAD - FOOT_H
d.line([(PAD, fy - 12), (W - PAD, fy - 12)], fill=LINE, width=2)
d.text((PAD, fy + 2), "实测（_test/diag-float.mjs · 从角色上方射线命中真实渲染网格）", font=F_FOOT, fill=WHITE)
d.text((PAD, fy + 30),
       "修复前 浮 +2.30 m / 陷 −1.85 m        修复后 |meshHeight − 渲染网格| = 0.0000 m        平地直走离地间隙 0.000 m",
       font=F_FOOT, fill=DIM)
d.text((PAD, fy + 52),
       "回归 _test/verify.mjs：陷入地形 0 帧 · 角色被地形遮挡 0 帧 · 运行时报错 0 条",
       font=F_FOOT, fill=DIM)

canvas.save(OUT)
print("saved", OUT, canvas.size)
