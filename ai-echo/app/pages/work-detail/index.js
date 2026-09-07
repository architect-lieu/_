function buildReviewItems(work) {
  const reviews = work.reviews || [];
  const find = (kind, index) => reviews.find(item => item.kind === kind && Number(item.index) === index) || {};
  return {
    factItems: (work.uncertainties || []).map((text, index) => {
      const review = find('fact', index);
      const resultText = review.status === 'confirmed'
        ? '已确认'
        : review.status === 'corrected'
          ? `已更正：${review.answer || ''}`
          : review.status === 'unknown' ? '暂不确定' : '';
      return { text, index, ...review, resultText };
    }),
    questionItems: (work.nextQuestions || []).map((text, index) => {
      const review = find('question', index);
      const resultText = review.status === 'answered' ? review.answer || '' : review.status === 'dismissed' ? '已忽略' : '';
      return { text, index, ...review, resultText };
    }),
  };
}

Page({
  data: {
    id: '', work: null, loading: true, editing: false, saving: false, editTitle: '', editContent: '',
    activeTab: 'story', sourceExpanded: false,
    currentChapter: 0,
    currentChapterData: null,
    chapterProgress: 0,
    catalogOpen: false,
    readerFont: 'medium',
    readerTheme: 'paper',
    readerEditing: false,
    chapterEditContent: '',
    savingChapter: false,
    sourcePreview: '',
    supplementOpen: false,
    supplementText: '',
    supplementCount: 0,
    chapterSupplementCount: 0,
    savingSupplement: false,
    reviewSection: 'facts',
    factItems: [],
    questionItems: [],
    reviewEditorOpen: false,
    reviewEditorKind: 'fact',
    reviewEditorIndex: 0,
    reviewEditorTitle: '',
    reviewDraft: '',
    savingReview: false,
    tabs: [
      { id: 'story', label: '正文' }, { id: 'timeline', label: '时间线' },
      { id: 'clues', label: '人物线索' }, { id: 'verify', label: '校订' },
    ],
  },
  onLoad(options) { this.setData({ id: options.id || '' }); this.load(); },
  async call(data) {
    const response = await wx.cloud.callFunction({ name: 'generateStory', data });
    if (!response.result || !response.result.success) throw new Error((response.result && response.result.message) || '请求失败');
    return response.result;
  },
  async load() {
    try {
      const result = await this.call({ action: 'get', workId: this.data.id });
      const preference = wx.getStorageSync(`reader_${this.data.id}`) || {};
      const chapters = result.work.chapters || [];
      const supplements = result.work.supplements || [];
      const reviewItems = buildReviewItems(result.work);
      const chapter = Math.min(Math.max(Number(preference.chapter || 0), 0), Math.max(chapters.length - 1, 0));
      this.setData({
        work: result.work,
        currentChapter: chapter,
        currentChapterData: chapters[chapter] || null,
        chapterProgress: chapters.length ? Math.round(((chapter + 1) / chapters.length) * 100) : 0,
        readerFont: preference.font || 'medium',
        readerTheme: preference.theme || 'paper',
        sourcePreview: String(result.work.sourceTranscript || '').slice(0, 180),
        supplementCount: supplements.length,
        chapterSupplementCount: supplements.filter(item => Number(item.chapterIndex) === chapter).length,
        factItems: reviewItems.factItems,
        questionItems: reviewItems.questionItems,
      });
    }
    catch (error) { wx.showModal({ title: '故事加载失败', content: error.message || '请稍后重试', showCancel: false }); }
    finally { this.setData({ loading: false }); }
  },
  beginEdit() { const { work } = this.data; this.setData({ editing: true, editTitle: work.title, editContent: work.content }); },
  cancelEdit() { this.setData({ editing: false }); },
  titleInput(event) { this.setData({ editTitle: event.detail.value }); },
  contentInput(event) { this.setData({ editContent: event.detail.value }); },
  selectTab(event) { this.setData({ activeTab: event.currentTarget.dataset.tab }); },
  setChapter(index) {
    if (this.data.readerEditing) {
      wx.showToast({ title: '请先保存或取消修改', icon: 'none' });
      return;
    }
    const chapters = (this.data.work && this.data.work.chapters) || [];
    if (!chapters.length) return;
    const chapter = Math.min(Math.max(Number(index), 0), chapters.length - 1);
    this.setData({
      currentChapter: chapter,
      currentChapterData: chapters[chapter],
      chapterProgress: Math.round(((chapter + 1) / chapters.length) * 100),
      catalogOpen: false,
      chapterSupplementCount: ((this.data.work && this.data.work.supplements) || []).filter(item => Number(item.chapterIndex) === chapter).length,
    });
    this.saveReaderPreference({ chapter });
    wx.pageScrollTo({ scrollTop: 0, duration: 180 });
  },
  previousChapter() { this.setChapter(this.data.currentChapter - 1); },
  nextChapter() { this.setChapter(this.data.currentChapter + 1); },
  openCatalog() { this.setData({ catalogOpen: true }); },
  closeCatalog() { this.setData({ catalogOpen: false }); },
  chooseChapter(event) { this.setChapter(event.currentTarget.dataset.index); },
  changeFont(event) {
    const readerFont = event.currentTarget.dataset.font;
    this.setData({ readerFont });
    this.saveReaderPreference({ font: readerFont });
  },
  changeTheme(event) {
    const readerTheme = event.currentTarget.dataset.theme;
    this.setData({ readerTheme });
    this.saveReaderPreference({ theme: readerTheme });
  },
  saveReaderPreference(patch) {
    const key = `reader_${this.data.id}`;
    wx.setStorageSync(key, { ...(wx.getStorageSync(key) || {}), ...patch });
  },
  selectReviewSection(event) { this.setData({ reviewSection: event.currentTarget.dataset.section }); },
  async submitReview(kind, index, status, answer = '') {
    this.setData({ savingReview: true });
    try {
      const result = await this.call({ action: 'saveReview', workId: this.data.id, kind, index, status, answer });
      const work = { ...this.data.work, reviews: result.reviews || [] };
      const reviewItems = buildReviewItems(work);
      this.setData({ work, ...reviewItems, reviewEditorOpen: false, reviewDraft: '' });
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (error) {
      wx.showModal({ title: '保存失败', content: error.message || '请稍后重试', showCancel: false });
    } finally {
      this.setData({ savingReview: false });
    }
  },
  confirmFact(event) { this.submitReview('fact', Number(event.currentTarget.dataset.index), 'confirmed'); },
  unknownFact(event) { this.submitReview('fact', Number(event.currentTarget.dataset.index), 'unknown'); },
  dismissQuestion(event) { this.submitReview('question', Number(event.currentTarget.dataset.index), 'dismissed'); },
  openReviewEditor(event) {
    const kind = event.currentTarget.dataset.kind;
    const index = Number(event.currentTarget.dataset.index);
    const items = kind === 'question' ? this.data.questionItems : this.data.factItems;
    const item = items.find(value => value.index === index) || {};
    this.setData({
      reviewEditorOpen: true, reviewEditorKind: kind, reviewEditorIndex: index,
      reviewEditorTitle: item.text || '', reviewDraft: item.answer || '',
    });
  },
  closeReviewEditor() { this.setData({ reviewEditorOpen: false, reviewDraft: '' }); },
  reviewInput(event) { this.setData({ reviewDraft: event.detail.value }); },
  saveReviewAnswer() {
    const answer = this.data.reviewDraft.trim();
    if (!answer) {
      wx.showToast({ title: '请填写内容', icon: 'none' });
      return;
    }
    this.submitReview(
      this.data.reviewEditorKind,
      this.data.reviewEditorIndex,
      this.data.reviewEditorKind === 'question' ? 'answered' : 'corrected',
      answer,
    );
  },
  enterReaderEdit() {
    if (!this.data.currentChapterData) return;
    this.setData({ readerEditing: true, chapterEditContent: this.data.currentChapterData.content || '' });
  },
  toggleReaderEdit(event) {
    if (event.detail.value) this.enterReaderEdit();
    else this.cancelReaderEdit();
  },
  cancelReaderEdit() { this.setData({ readerEditing: false, chapterEditContent: '' }); },
  chapterContentInput(event) { this.setData({ chapterEditContent: event.detail.value }); },
  async saveCurrentChapter() {
    const content = this.data.chapterEditContent.trim();
    if (!content) {
      wx.showToast({ title: '章节内容不能为空', icon: 'none' });
      return;
    }
    this.setData({ savingChapter: true });
    try {
      const result = await this.call({
        action: 'saveChapter', workId: this.data.id,
        chapterIndex: this.data.currentChapter, content,
      });
      const chapter = result.work.chapters[this.data.currentChapter];
      this.setData({
        work: result.work, currentChapterData: chapter,
        readerEditing: false, chapterEditContent: '',
      });
      wx.showToast({ title: '本章已保存', icon: 'success' });
    } catch (error) {
      wx.showModal({ title: '保存失败', content: error.message || '请稍后重试', showCancel: false });
    } finally {
      this.setData({ savingChapter: false });
    }
  },
  toggleSource() { this.setData({ sourceExpanded: !this.data.sourceExpanded }); },
  openSupplement() { this.setData({ supplementOpen: true, supplementText: '' }); },
  closeSupplement() { this.setData({ supplementOpen: false, supplementText: '' }); },
  supplementInput(event) { this.setData({ supplementText: event.detail.value }); },
  async saveSupplement() {
    const text = this.data.supplementText.trim();
    if (!text) {
      wx.showToast({ title: '请填写内容', icon: 'none' });
      return;
    }
    this.setData({ savingSupplement: true });
    try {
      const result = await this.call({
        action: 'addSupplement', workId: this.data.id,
        chapterIndex: this.data.currentChapter,
        chapterTitle: this.data.currentChapterData ? this.data.currentChapterData.title : '',
        text,
      });
      const supplement = {
        chapterIndex: this.data.currentChapter,
        chapterTitle: this.data.currentChapterData ? this.data.currentChapterData.title : '',
        text,
        status: 'pending',
      };
      const work = { ...this.data.work, supplements: [...(this.data.work.supplements || []), supplement] };
      this.setData({
        work, supplementOpen: false, supplementText: '',
        supplementCount: result.supplementCount || 0,
        chapterSupplementCount: this.data.chapterSupplementCount + 1,
      });
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (error) {
      wx.showModal({ title: '保存失败', content: error.message || '请稍后重试', showCancel: false });
    } finally {
      this.setData({ savingSupplement: false });
    }
  },
  async deleteSupplement(event) {
    const index = Number(event.currentTarget.dataset.index);
    const confirmation = await wx.showModal({ title: '删除补充', content: '确定删除？' });
    if (!confirmation.confirm) return;
    try {
      const result = await this.call({ action: 'deleteSupplement', workId: this.data.id, index });
      const supplements = result.supplements || [];
      const work = { ...this.data.work, supplements };
      this.setData({
        work, supplementCount: supplements.length,
        chapterSupplementCount: supplements.filter(item => Number(item.chapterIndex) === this.data.currentChapter).length,
      });
      wx.showToast({ title: '已删除', icon: 'success' });
    } catch (error) {
      wx.showModal({ title: '删除失败', content: error.message || '请稍后重试', showCancel: false });
    }
  },
  noop() {},
  async saveEdit() {
    if (!this.data.editTitle.trim() || !this.data.editContent.trim()) { wx.showToast({ title: '标题和正文不能为空', icon: 'none' }); return; }
    this.setData({ saving: true });
    try {
      const result = await this.call({
        action: 'save', workId: this.data.id, title: this.data.editTitle, content: this.data.editContent,
        confirm: false, flattenChapters: this.data.editContent !== this.data.work.content,
      });
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
