Page({
  data: { id: '', work: null, loading: true, editing: false, saving: false, editTitle: '', editContent: '' },
  onLoad(options) { this.setData({ id: options.id || '' }); this.load(); },
  async call(data) {
    const response = await wx.cloud.callFunction({ name: 'generateStory', data });
    if (!response.result || !response.result.success) throw new Error((response.result && response.result.message) || '请求失败');
    return response.result;
  },
  async load() {
    try { const result = await this.call({ action: 'get', workId: this.data.id }); this.setData({ work: result.work }); }
    catch (error) { wx.showModal({ title: '故事加载失败', content: error.message || '请稍后重试', showCancel: false }); }
    finally { this.setData({ loading: false }); }
  },
  beginEdit() { const { work } = this.data; this.setData({ editing: true, editTitle: work.title, editContent: work.content }); },
  cancelEdit() { this.setData({ editing: false }); },
  titleInput(event) { this.setData({ editTitle: event.detail.value }); },
  contentInput(event) { this.setData({ editContent: event.detail.value }); },
  async saveEdit() {
    if (!this.data.editTitle.trim() || !this.data.editContent.trim()) { wx.showToast({ title: '标题和正文不能为空', icon: 'none' }); return; }
    this.setData({ saving: true });
    try {
      const result = await this.call({ action: 'save', workId: this.data.id, title: this.data.editTitle, content: this.data.editContent, confirm: false });
      this.setData({ work: result.work, editing: false }); wx.showToast({ title: '草稿已保存', icon: 'success' });
    } catch (error) { wx.showModal({ title: '保存失败', content: error.message, showCancel: false }); }
    finally { this.setData({ saving: false }); }
  },
  async confirmWork() {
    const result = await wx.showModal({ title: '确认故事内容', content: '请确认人物、时间和经历与真实讲述一致。确认后仍可继续修改。', confirmText: '确认无误' });
    if (!result.confirm) return;
    this.setData({ saving: true });
    try {
      const saved = await this.call({ action: 'save', workId: this.data.id, title: this.data.work.title, content: this.data.work.content, confirm: true });
      this.setData({ work: saved.work }); wx.showToast({ title: '故事已确认', icon: 'success' });
    } catch (error) { wx.showModal({ title: '确认失败', content: error.message, showCancel: false }); }
    finally { this.setData({ saving: false }); }
  },
});
