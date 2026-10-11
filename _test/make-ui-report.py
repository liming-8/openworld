"""把三条试玩反馈的"修复前 / 修复后"拼成一张报告图。"""
from PIL import Image, ImageDraw, ImageFont

V = r"C:\Users\32286\WorkBuddy\2026-10-10-12-59-02\openworld\_test\verify"
USER_SHOT = r"C:\Users\32286\.workbuddy\clipboard-images\clipboard-2026-10-11T04-35-46-340Z-a8dcd28c.jpg"
OUT = V + r"\ui-fix-report.png"

SANS = "C:/Windows/Fonts/msyh.ttc"
BOLD = "C:/Windows/Fonts/msyhbd.ttc"
F_TITLE = ImageFont.truetype(BOLD, 36)
F_SUB = ImageFont.truetype(SANS, 19)
F_ROW = ImageFont.truetype(BOLD, 23)
F_TAG = ImageFont.truetype(BOLD, 19)
F_CAP = ImageFont.truetype(SANS, 17)
F_FOOT = ImageFont.truetype(SANS, 17)

W = 1420
PAD = 30
GAP = 18
COLW = (W - PAD * 2 - GAP) // 2
IMGH = 236
CAPH = 76
TAGH = 32
ROWH = 34 + TAGH + IMGH + CAPH
HEAD = 118
FOOT = 62
H = PAD + HEAD + ROWH * 3 + FOOT + PAD

BG = (22, 24, 28)
CARD = (31, 34, 40)
BOX = (16, 18, 22)
WHITE = (238, 240, 244)
DIM = (152, 158, 170)
RED = (232, 96, 88)
GREEN = (108, 208, 140)
AMBER = (226, 160, 60)
LINE = (54, 58, 68)
DASH = (72, 78, 90)

canvas = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(canvas)


def fit(src, w, h):
    """等比缩放并居中放到 w×h 的图框里"""
    im = src.copy()
    sc = min(w / im.width, h / im.height)
    nw, nh = max(1, int(im.width * sc)), max(1, int(im.height * sc))
    im = im.resize((nw, nh), Image.LANCZOS)
    box = Image.new("RGB", (w, h), BOX)
    box.paste(im, ((w - nw) // 2, (h - nh) // 2))
    return box


def dashed_rect(dr, xy, color, dash=8, gap=6, width=2):
    x0, y0, x1, y1 = xy
    for x in range(x0, x1, dash + gap):
        dr.line([(x, y0), (min(x + dash, x1), y0)], fill=color, width=width)
        dr.line([(x, y1), (min(x + dash, x1), y1)], fill=color, width=width)
    for y in range(y0, y1, dash + gap):
        dr.line([(x0, y), (x0, min(y + dash, y1))], fill=color, width=width)
        dr.line([(x1, y), (x1, min(y + dash, y1))], fill=color, width=width)


def wrap_cjk(text, font, maxw, dr):
    """按像素宽度折行（中文没有空格，只能逐字量）"""
    lines, cur = [], ""
    for ch in text:
        if dr.textlength(cur + ch, font=font) > maxw and cur:
            lines.append(cur)
            cur = ch
        else:
            cur += ch
    if cur:
        lines.append(cur)
    return lines


# ── 标题 ──
y = PAD
d.text((PAD, y), "世界地图 / HUD 三处修正", font=F_TITLE, fill=WHITE)
d.text((PAD, y + 48),
       "对应试玩反馈的第 1、2、3 条 · 改后由 _test/ui-check.mjs 逐项实测（26 项断言全部通过，运行时报错 0 条）",
       font=F_SUB, fill=DIM)

# ── 素材 ──
user = Image.open(USER_SHOT).convert("RGB")
# 用宽幅裁切，才能把面板填满（fit 是等比缩放的）
before_map = user.crop((30, 330, 1030, 690))
before_legend = user.crop((150, 1100, 950, 1174))
after_full = Image.open(f"{V}/ui-map.png").convert("RGB")
after_map = after_full.crop((392, 244, 884, 420))
after_legend = after_full.crop((400, 604, 880, 648))
after_hud = Image.open(f"{V}/ui-loot.png").convert("RGB").crop((0, 470, 330, 720))

rows = [
    ("① 地图上好像没有传送点", "把「只画已激活锚点」改成全部画出来",
     ("img", before_map, "修复前：锚点生成很稀疏（区域 5.5% 概率），还没点亮过任何一个时，地图上一个锚点都不显示"),
     ("img", after_map, "修复后：已激活＝蓝色实心菱形＋虚线圈，未激活＝暗色空心菱形；点击空心锚点提示「需走过去按 E 点亮」")),
    ("② 开宝箱的原石 / 摩拉看不到收集了多少", "数值原本只弹一条提示就丢了，现在存进 state 并常驻显示",
     ("none", None, "修复前：右上角只闪一下「原石 ×N · 摩拉 ×N」，关掉提示就再也查不到了，存档里也没有这两个字段"),
     ("img", after_hud, "修复后：HUD 左下角新增「收集物」区块，原石 / 摩拉 常驻计数并写入存档")),
    ("③ 地图图标是三角形，图例却画成圆形", "图例形状改为与 canvas 实际绘制一一对应",
     ("img", before_legend, "修复前：地图上「当前位置」是红色三角，图例却是个红色圆点"),
     ("img", after_legend, "修复后：图例 ▲ 三角；顺带把「传送锚点」也从圆角盾形改成菱形，和地图一致")),
]

for i, (title, sub, before, after) in enumerate(rows):
    ry = PAD + HEAD + i * ROWH
    d.text((PAD, ry), title, font=F_ROW, fill=WHITE)
    tw = d.textlength(title, font=F_ROW)
    d.text((PAD + tw + 14, ry + 4), "— " + sub, font=F_CAP, fill=DIM)

    for j, (kind, src, cap) in enumerate((before, after)):
        x = PAD + j * (COLW + GAP)
        ty = ry + 34
        py = ty + TAGH

        # 标签放在图框上方，别压住画面
        tag = "修复前" if j == 0 else "修复后"
        col = RED if j == 0 else GREEN
        d.rectangle([x, ty + 3, x + 74, ty + 27], fill=col)
        d.text((x + 9, ty + 6), tag, font=F_TAG, fill=(18, 20, 24))
        if j == 1:
            d.line([(x + 92, ty + 15), (x + COLW, ty + 15)], fill=LINE, width=1)

        if kind == "img":
            canvas.paste(fit(src, COLW, IMGH), (x, py))
        else:
            box = Image.new("RGB", (COLW, IMGH), BOX)
            bd = ImageDraw.Draw(box)
            dashed_rect(bd, (2, 2, COLW - 3, IMGH - 3), DASH)
            bd.text((26, IMGH // 2 - 34), "（此处本来什么都没有）", font=F_TAG, fill=RED)
            bd.text((26, IMGH // 2 - 2), "开箱时只弹一条 3 秒就消失的提示，", font=F_CAP, fill=DIM)
            bd.text((26, IMGH // 2 + 22), "界面上再无任何位置可以查到累计有多少。", font=F_CAP, fill=DIM)
            bd.text((26, IMGH // 2 + 46), "存档里也没有这两个字段。", font=F_CAP, fill=DIM)
            canvas.paste(box, (x, py))

        # 说明文字（自动折行）
        cy = py + IMGH + 8
        for ln in wrap_cjk(cap, F_CAP, COLW - 6, d)[:3]:
            d.text((x, cy), ln, font=F_CAP, fill=DIM)
            cy += 24

# ── 页脚 ──
fy = H - PAD - FOOT + 8
d.line([(PAD, fy - 14), (W - PAD, fy - 14)], fill=LINE, width=2)
d.text((PAD, fy), "验证要点（_test/ui-check.mjs）", font=F_TAG, fill=WHITE)
d.text((PAD, fy + 28),
       "未激活锚点也进入地图数据 · 区域卸载后已激活锚点仍在（写进存档 waypoints）· 开箱是累加不是覆盖 · 读档后原石/摩拉/锚点数量一致 · 老存档无 waypoints 字段可从 id 反推坐标",
       font=F_FOOT, fill=DIM)

canvas.save(OUT)
print("saved", OUT, canvas.size)
