/*
 * 从网页版里抽出预设数据，导出成小程序用的模块。
 * 网页版和小程序版共用同一份数据，避免两边数量对不上。
 * 用法：node work/export-presets.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'outputs', 'valorant-crosshair-lab.html'), 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];

function slice(from, to) {
  const a = script.indexOf(from);
  let b = script.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('slice failed -> ' + from);
  const commentStart = script.lastIndexOf('/*', b);
  if (commentStart > a) b = commentStart;
  return script.slice(a, b);
}

const constants = slice('var PRESET_COLORS', 'var SCALE = 2;');
const helpers = slice('function clone(obj)', '* 状态');
const codeFn = slice('function buildCode(cfg) {', '* 准星绘制');

const api = new Function(
  constants + helpers + codeFn +
  '\nreturn { PRESET_CATS: PRESET_CATS, PRESET_COLORS: PRESET_COLORS, DEFAULT_STATE: DEFAULT_STATE, buildAllPresets: buildAllPresets };'
)();

const presets = api.buildAllPresets().map(function (p) {
  return { cat: p.cat, name: p.name, desc: p.desc, code: p.code, cfg: p.cfg };
});

const outDir = path.join(root, 'miniprogram', 'utils');
fs.mkdirSync(outDir, { recursive: true });

const banner = '/* 本文件由 work/export-presets.js 自动生成，请勿手工修改。\n' +
  ' * 数据来源：网页版的预设生成器，共 ' + presets.length + ' 支准星。\n' +
  ' * 改数据请改网页版，然后重新运行导出脚本。\n' +
  ' */\n\n';

fs.writeFileSync(path.join(outDir, 'presets.js'),
  banner + 'module.exports = ' + JSON.stringify(presets) + ';\n', 'utf8');

fs.writeFileSync(path.join(outDir, 'colors.js'),
  banner +
  'var PRESET_COLORS = ' + JSON.stringify(api.PRESET_COLORS) + ';\n' +
  'var PRESET_CATS = ' + JSON.stringify(api.PRESET_CATS) + ';\n' +
  'var DEFAULT_STATE = ' + JSON.stringify(api.DEFAULT_STATE) + ';\n\n' +
  'module.exports = { PRESET_COLORS: PRESET_COLORS, PRESET_CATS: PRESET_CATS, DEFAULT_STATE: DEFAULT_STATE };\n',
  'utf8');

console.log('导出的准星数量: ' + presets.length);
console.log('分类统计: ' + api.PRESET_CATS.map(function (c) {
  return c.id + '=' + (c.id === 'all' ? presets.length : presets.filter(function (p) { return p.cat === c.id; }).length);
}).join(' '));
console.log('输出目录: ' + outDir);
console.log('presets.js 大小: ' + fs.statSync(path.join(outDir, 'presets.js')).size + ' 字节');
