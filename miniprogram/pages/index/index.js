/*
 * 首页：准星预览 + 参数调节 + 预设库
 *
 * 设计说明：
 * - 界面状态用「扁平对象」flat 保存（如 innerLength），WXML 里可以直接 flat[item.key] 绑定；
 *   需要算分享码或画预览时，再用 C.toConfig 转成嵌套结构。
 * - 预览没有用 canvas，而是用绝对定位的 view 拼出来：小程序里没有 SVG，
 *   而几十张缩略图如果都用 canvas 会明显卡顿，用 view 反而更稳。
 */
var C = require('../../utils/crosshair.js');
var COLORS = require('../../utils/colors.js');
var PRESETS = require('../../utils/presets.js');

var PAGE_SIZE = 30;
var THUMB_BOX = 64;

/* 控制面板定义：数据驱动生成，避免在 WXML 里重复写二十个滑块 */
var PANELS = [
  {
    id: 'outline',
    title: '轮廓',
    note: '给线条加一圈黑边，亮背景和烟里更容易看清',
    toggle: 'outlines',
    toggleLabel: '启用',
    fields: [
      { key: 'outlineThickness', label: '轮廓厚度', min: 1, max: 10, step: 1 },
      { key: 'outlineOpacity', label: '轮廓不透明度', min: 0.1, max: 1, step: 0.05, percent: true }
    ]
  },
  {
    id: 'dot',
    title: '中心点',
    note: '正中心的小方块，遮挡面积最小',
    toggle: 'centerDot',
    toggleLabel: '启用',
    fields: [
      { key: 'dotThickness', label: '中心点厚度', min: 1, max: 10, step: 1 },
      { key: 'dotOpacity', label: '中心点不透明度', min: 0.1, max: 1, step: 0.05, percent: true }
    ]
  },
  {
    id: 'inner',
    title: '内线',
    note: '主十字，偏移越大中间空隙越大',
    toggle: 'innerShow',
    toggleLabel: '显示',
    fields: [
      { key: 'innerLength', label: '长度', min: 0, max: 20, step: 1 },
      { key: 'innerThickness', label: '厚度', min: 0, max: 10, step: 1 },
      { key: 'innerOffset', label: '偏移', min: 0, max: 20, step: 1 },
      { key: 'innerOpacity', label: '不透明度', min: 0.1, max: 1, step: 0.05, percent: true }
    ],
    switches: [
      { key: 'innerMoveError', label: '移动误差' },
      { key: 'innerFireError', label: '射击误差' }
    ]
  },
  {
    id: 'outer',
    title: '外线',
    note: '外圈短横，常用来提示连发时的扩散范围',
    toggle: 'outerShow',
    toggleLabel: '显示',
    fields: [
      { key: 'outerLength', label: '长度', min: 0, max: 20, step: 1 },
      { key: 'outerThickness', label: '厚度', min: 0, max: 10, step: 1 },
      { key: 'outerOffset', label: '偏移', min: 0, max: 40, step: 1 },
      { key: 'outerOpacity', label: '不透明度', min: 0.05, max: 1, step: 0.05, percent: true }
    ],
    switches: [
      { key: 'outerMoveError', label: '移动误差' },
      { key: 'outerFireError', label: '射击误差' }
    ]
  },
  {
    id: 'adv',
    title: '高级',
    note: '开火时直接用你设置的偏移值，而不是游戏默认的扩散表现',
    switches: [
      { key: 'overrideFiringOffset', label: '覆盖射击误差偏移' }
    ]
  }
];

/* 三种预览背景 */
var SCENES = {
  dark: { bg: '#0d1720', target: false },
  light: { bg: '#c7cfd4', target: false },
  range: { bg: '#152330', target: true }
};

Page({
  data: {
    flat: {},
    display: {},
    panels: PANELS,
    colors: COLORS.PRESET_COLORS,
    cats: [],
    cat: 'all',
    query: '',
    code: '',
    scene: SCENES.dark,
    sceneKey: 'dark',
    lines: [],
    dot: null,
    spreading: false,
    list: [],
    total: 0,
    shown: 0,
    hasMore: false,
    resultText: '',
    copyTip: false
  },

  onLoad: function () {
    var that = this;

    /* 预估预览区边长：屏幕宽 - 页面左右内边距 - 卡片左右内边距（都是 24rpx） */
    var info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    var unit = info.windowWidth / 750;
    this.stageSize = Math.max(200, Math.floor(info.windowWidth - unit * 96));

    /* 分类按钮上的数量直接统计出来，和实际数据永远一致 */
    var cats = COLORS.PRESET_CATS.map(function (cat) {
      var count = cat.id === 'all'
        ? PRESETS.length
        : PRESETS.filter(function (p) { return p.cat === cat.id; }).length;
      return { id: cat.id, name: cat.name, count: count };
    });

    this.setData({
      flat: C.defaultFlat(),
      cats: cats,
      total: PRESETS.length
    }, function () {
      that.renderList(true);
      that.update();
    });
  },

  onReady: function () {
    var that = this;
    /* 真正量一次预览区尺寸，比估算准 */
    wx.createSelectorQuery()
      .select('.stage')
      .boundingClientRect(function (rect) {
        if (rect && rect.width) {
          that.stageSize = rect.width;
          that.renderPreview();
        }
      })
      .exec();
  },

  /* ---------- 预览与分享码 ---------- */

  renderPreview: function () {
    if (!this.stageSize) return;
    var cfg = C.toConfig(this.data.flat);
    /* 160 个游戏单位铺满预览区，和网页版的比例一致 */
    var views = C.crosshairViews(cfg, this.stageSize, this.stageSize / 160, this.data.spreading);
    this.setData({ lines: views.lines, dot: views.dot });
  },

  update: function () {
    var flat = this.data.flat;
    var display = {};
    PANELS.forEach(function (panel) {
      (panel.fields || []).forEach(function (field) {
        var value = flat[field.key];
        display[field.key] = field.percent ? Math.round(value * 100) + '%' : String(value);
      });
    });
    this.setData({
      display: display,
      code: C.buildCode(C.toConfig(flat))
    });
    this.renderPreview();
  },

  /* ---------- 控件事件 ---------- */

  onSlide: function (event) {
    var key = event.currentTarget.dataset.key;
    var flat = this.data.flat;
    flat[key] = event.detail.value;
    this.setData({ flat: flat });
    this.update();
  },

  onSwitch: function (event) {
    var key = event.currentTarget.dataset.key;
    var flat = this.data.flat;
    flat[key] = event.detail.value;
    this.setData({ flat: flat });
    this.update();
  },

  onColor: function (event) {
    var index = Number(event.currentTarget.dataset.index);
    var flat = this.data.flat;
    flat.colorIndex = index;
    flat.useCustomColor = false;
    this.setData({ flat: flat });
    this.update();
  },

  onScene: function (event) {
    var key = event.currentTarget.dataset.key;
    this.setData({ sceneKey: key, scene: SCENES[key] });
  },

  onSpread: function (event) {
    this.setData({ spreading: event.detail.value });
    this.renderPreview();
  },

  /* 模拟开火：把扩散状态打开一小会儿再关掉，用来感受开火时的准星变化 */
  onFire: function () {
    var that = this;
    this.setData({ spreading: true });
    this.renderPreview();
    setTimeout(function () {
      that.setData({ spreading: false });
      that.renderPreview();
    }, 420);
  },

  onRandom: function () {
    function randInt(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }
    function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

    var flat = C.defaultFlat();
    flat.colorIndex = randInt(0, 7);
    flat.useCustomColor = false;
    flat.outlines = Math.random() > 0.35;
    flat.outlineOpacity = pick([0.5, 0.75, 1]);
    flat.outlineThickness = pick([1, 1, 2]);
    flat.centerDot = Math.random() > 0.5;
    flat.dotThickness = randInt(1, 3);
    flat.dotOpacity = 1;
    flat.innerShow = Math.random() > 0.15;
    flat.innerOpacity = pick([0.8, 1]);
    flat.innerLength = randInt(1, 6);
    flat.innerThickness = randInt(1, 3);
    flat.innerOffset = randInt(0, 4);
    flat.innerMoveError = false;
    flat.innerFireError = false;
    flat.outerShow = Math.random() > 0.6;
    flat.outerOpacity = pick([0.3, 0.5, 0.8]);
    flat.outerLength = randInt(1, 3);
    flat.outerThickness = randInt(1, 3);
    flat.outerOffset = randInt(6, 14);
    flat.outerMoveError = false;
    flat.outerFireError = false;

    this.setData({ flat: flat });
    this.update();
    this.toast('随机生成完成');
  },

  onReset: function () {
    this.setData({ flat: C.defaultFlat() });
    this.update();
    this.toast('已恢复游戏默认');
  },

  onCopy: function () {
    var that = this;
    wx.setClipboardData({
      data: this.data.code,
      success: function () { that.toast('分享码已复制'); },
      fail: function () { that.toast('复制失败，请长按选中'); }
    });
  },

  /* ---------- 预设列表 ---------- */

  renderList: function (reset) {
    if (reset) this.shown = PAGE_SIZE;

    var cat = this.data.cat;
    var query = (this.data.query || '').trim().toLowerCase();

    var filtered = PRESETS.filter(function (preset) {
      if (cat !== 'all' && preset.cat !== cat) return false;
      if (!query) return true;
      var text = (preset.name + ' ' + preset.desc + ' ' + preset.cat).toLowerCase();
      return query.split(/\s+/).every(function (word) {
        return !word || text.indexOf(word) >= 0;
      });
    });

    this.filtered = filtered;

    var batch = filtered.slice(0, this.shown).map(function (preset) {
      return {
        name: preset.name,
        desc: preset.desc,
        code: preset.code,
        thumb: C.thumbViews(preset.cfg, THUMB_BOX)
      };
    });

    this.setData({
      list: batch,
      total: filtered.length,
      shown: batch.length,
      hasMore: batch.length < filtered.length,
      resultText: filtered.length
        ? ('已显示 ' + batch.length + ' / ' + filtered.length + ' 支')
        : '没有匹配的准星，换个关键词试试'
    });
  },

  onSearch: function (event) {
    this.setData({ query: event.detail.value });
    this.renderList(true);
  },

  onCat: function (event) {
    this.setData({ cat: event.currentTarget.dataset.id });
    this.renderList(true);
  },

  onMore: function () {
    this.shown += PAGE_SIZE;
    this.renderList(false);
  },

  onApply: function (event) {
    var index = Number(event.currentTarget.dataset.index);
    var preset = this.filtered && this.filtered[index];
    if (!preset) return;
    this.setData({ flat: C.fromConfig(preset.cfg) });
    this.update();
    this.toast('已应用：' + preset.name);
    wx.pageScrollTo({ scrollTop: 0, duration: 260 });
  },

  onCopyPreset: function (event) {
    var index = Number(event.currentTarget.dataset.index);
    var preset = this.filtered && this.filtered[index];
    if (!preset) return;
    var that = this;
    wx.setClipboardData({
      data: preset.code,
      success: function () { that.toast('已复制该预设的分享码'); }
    });
  },

  /* ---------- 轻提示 ---------- */

  toast: function (text) {
    var that = this;
    this.setData({ copyTip: text });
    clearTimeout(this.tipTimer);
    this.tipTimer = setTimeout(function () {
      that.setData({ copyTip: false });
    }, 1600);
  },

  /* ---------- 分享 ---------- */

  onShareAppMessage: function () {
    return {
      title: '准星实验室 · 300+ 支无畏契约准星，实时预览还能生成分享码',
      path: '/pages/index/index'
    };
  },

  onShareTimeline: function () {
    return {
      title: '准星实验室 · 300+ 支无畏契约准星实时预览'
    };
  }
});
