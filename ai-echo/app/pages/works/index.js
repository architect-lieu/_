Page({
  data: { showPrivacy: true, loading: false, works: [] },
  onShow() { this.loadWorks(); },
  acceptPrivacy() { getApp().globalData.privacyAccepted = true; this.setData({ showPrivacy: false }); },
  rejectPrivacy() { wx.showToast({ title: '你可以先浏览，使用服务前需同意', icon: 'none' }); this.setData({ showPrivacy: false }); },
  openPrivacy() { wx.navigateTo({ url: '/pages/privacy/index' }); },
  startStory() { wx.switchTab({ url: '/pages/story/index' }); },
  async loadWorks() {
    if (!getApp().globalData.cloudReady) return;
    this.setData({ loading: true });
    try {
      const response = await wx.cloud.callFunction({ name: 'generateStory', data: { action: 'list' } });
      if (response.result && response.result.success) this.setData({ works: response.result.works || [] });
    } catch (error) { console.warn('[works] load failed', error); }
    finally { this.setData({ loading: false }); }
  },
  openWork(event) { wx.navigateTo({ url: `/pages/work-detail/index?id=${event.currentTarget.dataset.id}` }); },
});
