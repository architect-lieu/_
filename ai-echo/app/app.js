const cloudConfig = require('./config/cloud');

App({
  onLaunch() {
    if (cloudConfig.envId && wx.cloud) {
      wx.cloud.init({ env: cloudConfig.envId, traceUser: true });
      this.globalData.cloudReady = true;
    }
  },
  globalData: {
    privacyAccepted: false,
    cloudReady: false,
    user: null,
  },
});
