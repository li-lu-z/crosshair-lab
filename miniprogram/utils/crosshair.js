/*
 * 准星核心逻辑：扁平状态 ↔ 嵌套配置、分享码生成、预览几何。
 * 这批逻辑和网页版保持一致，改一边记得同步另一边。
 */
var COLORS = require('./colors.js');

var PRESET_COLORS = COLORS.PRESET_COLORS;
var DEFAULT_STATE = COLORS.DEFAULT_STATE;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/* 分享码里的数字：1 就写 1，0.5 就写 0.5，不补多余的零 */
function num(n) {
  return String(Math.round(n * 1000) / 1000);
}

/* #RRGGBB 转 rgba()：这样线条和轮廓的透明度可以分别控制 */
function hexToRgba(hex, alpha) {
  var h = String(hex || '#FFFFFF').replace('#', '');
  if (h.length === 3) {
    h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
  }
  var r = parseInt(h.slice(0, 2), 16) || 0;
  var g = parseInt(h.slice(2, 4), 16) || 0;
  var b = parseInt(h.slice(4, 6), 16) || 0;
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

function colorHex(flat) {
  if (flat.useCustomColor) return flat.customColor;
  var preset = PRESET_COLORS[flat.colorIndex] || PRESET_COLORS[0];
  return preset.hex;
}

/* 界面用的扁平结构 → 算法用的嵌套结构 */
function toConfig(flat) {
  return {
    colorIndex: flat.colorIndex,
    useCustomColor: flat.useCustomColor,
    customColor: flat.customColor,
    outlines: flat.outlines,
    outlineOpacity: flat.outlineOpacity,
    outlineThickness: flat.outlineThickness,
    centerDot: flat.centerDot,
    dotThickness: flat.dotThickness,
    dotOpacity: flat.dotOpacity,
    overrideFiringOffset: flat.overrideFiringOffset,
    inner: {
      show: flat.innerShow,
      opacity: flat.innerOpacity,
      length: flat.innerLength,
      thickness: flat.innerThickness,
      offset: flat.innerOffset,
      moveError: flat.innerMoveError,
      fireError: flat.innerFireError
    },
    outer: {
      show: flat.outerShow,
      opacity: flat.outerOpacity,
      length: flat.outerLength,
      thickness: flat.outerThickness,
      offset: flat.outerOffset,
      moveError: flat.outerMoveError,
      fireError: flat.outerFireError
    }
  };
}

/* 反过来：预设里的嵌套结构 → 界面用的扁平结构 */
function fromConfig(cfg) {
  var inner = cfg.inner || {};
  var outer = cfg.outer || {};
  return {
    colorIndex: typeof cfg.colorIndex === 'number' ? cfg.colorIndex : 0,
    useCustomColor: !!cfg.useCustomColor,
    customColor: cfg.customColor || '#00FFD1',
    outlines: !!cfg.outlines,
    outlineOpacity: typeof cfg.outlineOpacity === 'number' ? cfg.outlineOpacity : 0.5,
    outlineThickness: typeof cfg.outlineThickness === 'number' ? cfg.outlineThickness : 1,
    centerDot: !!cfg.centerDot,
    dotThickness: typeof cfg.dotThickness === 'number' ? cfg.dotThickness : 2,
    dotOpacity: typeof cfg.dotOpacity === 'number' ? cfg.dotOpacity : 1,
    overrideFiringOffset: !!cfg.overrideFiringOffset,
    innerShow: inner.show !== false,
    innerOpacity: typeof inner.opacity === 'number' ? inner.opacity : 1,
    innerLength: typeof inner.length === 'number' ? inner.length : 6,
    innerThickness: typeof inner.thickness === 'number' ? inner.thickness : 2,
    innerOffset: typeof inner.offset === 'number' ? inner.offset : 3,
    innerMoveError: !!inner.moveError,
    innerFireError: !!inner.fireError,
    outerShow: !!outer.show,
    outerOpacity: typeof outer.opacity === 'number' ? outer.opacity : 1,
    outerLength: typeof outer.length === 'number' ? outer.length : 2,
    outerThickness: typeof outer.thickness === 'number' ? outer.thickness : 2,
    outerOffset: typeof outer.offset === 'number' ? outer.offset : 10,
    outerMoveError: !!outer.moveError,
    outerFireError: !!outer.fireError
  };
}

/* 默认（游戏原生那支白色细十字）的扁平状态 */
function defaultFlat() {
  return fromConfig(DEFAULT_STATE);
}

/*
 * 生成准星分享码。
 * 字段含义：c 颜色 / h 轮廓 / t 轮廓厚度 / o 轮廓不透明度 / d 中心点 /
 * z 中心点厚度 / a 中心点不透明度 / m 覆盖射击误差偏移；
 * 内线前缀 0、外线前缀 1，后面跟 b 显示、t 厚度、l 长度、o 偏移、a 不透明度、
 * m 移动误差、f 射击误差，s / e 是两种误差的倍率。
 */
function buildCode(cfg) {
  var parts = [];
  function put(key, value) { parts.push(key, num(value)); }
  function flag(key, on) { parts.push(key, on ? '1' : '0'); }

  parts.push('0', 's', '1', 'P');

  if (cfg.useCustomColor) {
    parts.push('c', '8', 'u', String(cfg.customColor).replace('#', '').toUpperCase() + 'FF');
  } else if (cfg.colorIndex !== 0) {
    parts.push('c', String(cfg.colorIndex));
  }

  flag('h', cfg.outlines);
  put('t', cfg.outlineThickness);
  put('o', cfg.outlineOpacity);
  flag('d', cfg.centerDot);
  put('z', cfg.dotThickness);
  put('a', cfg.dotOpacity);
  flag('m', cfg.overrideFiringOffset);

  [['0', cfg.inner], ['1', cfg.outer]].forEach(function (pair) {
    var prefix = pair[0];
    var group = pair[1];
    flag(prefix + 'b', group.show);
    put(prefix + 't', group.thickness);
    put(prefix + 'l', group.length);
    put(prefix + 'o', group.offset);
    put(prefix + 'a', group.opacity);
    flag(prefix + 'm', group.moveError);
    parts.push(prefix + 's', '1');
    flag(prefix + 'f', group.fireError);
    parts.push(prefix + 'e', '1');
  });

  return parts.join(';');
}

/*
 * 把准星换算成一堆绝对定位的小方块（小程序里没有 SVG，用定位的 view 最稳，
 * 几十个缩略图同时存在也不会像 canvas 那样吃性能）。
 * box：预览区边长（px）；pxPerUnit：1 个游戏单位等于多少 px；spread：是否叠加误差扩散。
 */
function crosshairViews(cfg, box, pxPerUnit, spread) {
  var cx = box / 2;
  var cy = box / 2;
  var color = cfg.useCustomColor ? cfg.customColor : (PRESET_COLORS[cfg.colorIndex] || PRESET_COLORS[0]).hex;
  var outline = cfg.outlines ? cfg.outlineThickness * pxPerUnit : 0;
  var shadow = outline > 0
    ? 'box-shadow:0 0 0 ' + round2(Math.max(1, outline)) + 'px rgba(0,0,0,' + cfg.outlineOpacity + ');'
    : '';
  var lines = [];

  function rect(x, y, w, h, alpha) {
    return 'position:absolute;' +
      'left:' + round2(x) + 'px;' +
      'top:' + round2(y) + 'px;' +
      'width:' + round2(w) + 'px;' +
      'height:' + round2(h) + 'px;' +
      'background:' + hexToRgba(color, alpha) + ';' +
      shadow;
  }

  /* 每块都带上 id，WXML 里用 wx:key="id" 复用节点，滑动时才不会整体重绘 */
  function push(x, y, w, h, alpha) {
    lines.push({ id: lines.length, style: rect(x, y, w, h, alpha) });
  }

  [cfg.inner, cfg.outer].forEach(function (group) {
    if (!group || !group.show) return;
    var thickness = Math.max(0, group.thickness) * pxPerUnit;
    var length = Math.max(0, group.length) * pxPerUnit;
    if (thickness <= 0 || length <= 0) return;

    var extra = 0;
    if (spread) {
      if (group.fireError) extra += 6;
      if (group.moveError) extra += 5;
    }
    var offset = Math.max(0, group.offset + extra) * pxPerUnit;
    var half = thickness / 2;

    push(cx - half, cy - offset - length, thickness, length, group.opacity);
    push(cx - half, cy + offset, thickness, length, group.opacity);
    push(cx - offset - length, cy - half, length, thickness, group.opacity);
    push(cx + offset, cy - half, length, thickness, group.opacity);
  });

  var dot = null;
  if (cfg.centerDot && cfg.dotThickness > 0) {
    var size = cfg.dotThickness * pxPerUnit;
    dot = { id: 'dot', style: rect(cx - size / 2, cy - size / 2, size, size, cfg.dotOpacity) };
  }

  return { lines: lines, dot: dot, color: color };
}

/* 缩略图固定用「60 个游戏单位铺满」的缩放，这样卡片之间的大小关系可以直接比较 */
function thumbViews(cfg, box) {
  return crosshairViews(cfg, box, box / 60, false).lines;
}

module.exports = {
  PRESET_COLORS: PRESET_COLORS,
  DEFAULT_STATE: DEFAULT_STATE,
  clamp: clamp,
  colorHex: colorHex,
  toConfig: toConfig,
  fromConfig: fromConfig,
  defaultFlat: defaultFlat,
  buildCode: buildCode,
  crosshairViews: crosshairViews,
  thumbViews: thumbViews
};
