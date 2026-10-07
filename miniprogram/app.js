// 小程序入口：这里只放全局数据和最简单的初始化
App({
  globalData: {
    version: '1.0.0',
    // 准星数据在 pages/index 里按需加载，不放在这里，避免冷启动变慢
  },

  onLaunch: function () {
    // 目前没有需要预热的东西：数据全在本地，不联网、不请求接口
  }
});
