import * as P from 'file:///C:/Users/32286/WorkBuddy/2026-10-10-12-59-02/openworld/js/props.js';

function dims(geo) {
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  const b = geo.boundingBox;
  return {
    span: Math.max(b.max.x - b.min.x, b.max.z - b.min.z),
    h: b.max.y - b.min.y,
    top: b.max.y, bottom: b.min.y,
    visible: b.max.y - 0.1,          // 摆放时 y = 地形高度 - 0.1
  };
}
console.log('尺寸标定：摆放时 y = 地形高度 - 0.1，所以"地面上可见高度" = top - 0.1\n');
console.log('size    detail | 水平跨度  总高   可见高  入土深');
for (const [size, detail, tag] of [
  [2.6, 1, 'boulder 现用'], [2.2, 1, ''], [1.8, 1, ''], [1.5, 1, ''], [1.3, 1, ''], [1.1, 1, ''],
  [1.15, 0, 'rock 现用'], [0.95, 0, ''], [0.8, 0, ''], [0.65, 0, ''],
]) {
  const d = dims(P.makeRockCluster({ size, count: 3, detail, seedish: detail ? 1.7 : 0 }));
  console.log(
    String(size).padEnd(6), String(detail).padEnd(6), '|',
    d.span.toFixed(2).padStart(7), d.h.toFixed(2).padStart(6), d.visible.toFixed(2).padStart(7),
    (-d.bottom).toFixed(2).padStart(7), ' ', tag);
}
console.log('\n目标： boulder 可见高≈3.0m 跨度≈5m ; rock 可见高≈1.4m 跨度≈2.5m');
console.log('参照： 人物 1.8m，箱子约 0.9m');
