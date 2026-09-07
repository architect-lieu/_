const MAX_DURATION = 10 * 60 * 1000;

const questions = [
  { topic: '童年与故乡', question: '你小时候住的地方，是什么样子？' },
  { topic: '父母与家庭', question: '小时候，家里谁对你的影响最大？' },
  { topic: '青春与选择', question: '年轻时，有哪个选择改变了后来的人生？' },
  { topic: '工作与时代', question: '你的第一份工作，是怎么开始的？' },
];

function formatTime(seconds) {
  const minute = Math.floor(seconds / 60).toString().padStart(2, '0');
  const second = (seconds % 60).toString().padStart(2, '0');
  return `${minute}:${second}`;
}

Page({
  data: {
    questions,
    bars: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    selected: 0,
    question: questions[0].question,
    status: 'idle',
    statusText: '准备好后，点击下方按钮开始',
    elapsed: 0,
    elapsedText: '00:00',
    durationText: '00:00',
    fileSizeText: '',
    tempFilePath: '',
    savedFilePath: '',
    localRecordId: '',
    isPlaying: false,
    uploadStatus: 'idle',
    uploadProgress: 0,
    cloudFileId: '',
    cloudRecordId: '',
    transcriptStatus: 'idle',
    transcript: '',
    storyStatus: 'idle',
    storyDraft: null,
  },

  onLoad() {
    this.recorder = wx.getRecorderManager();
    this.audio = wx.createInnerAudioContext();
    this.bindRecorderEvents();
    this.bindAudioEvents();
    this.restoreLatestRecording();
  },

  restoreLatestRecording() {
    const [latest] = wx.getStorageSync('local_recordings') || [];
    if (!latest || !latest.localPath) return;
    wx.getFileSystemManager().access({
      path: latest.localPath,
      success: () => {
        this.setData({
          status: 'saved',
          statusText: '已恢复最近一次本机录音，可以继续上传',
          question: latest.question || questions[0].question,
          elapsed: latest.duration || 0,
          elapsedText: formatTime(latest.duration || 0),
          durationText: formatTime(latest.duration || 0),
          fileSizeText: latest.fileSize || '',
          tempFilePath: latest.localPath,
          savedFilePath: latest.localPath,
          localRecordId: latest.id || '',
          uploadStatus: latest.cloudRecordId ? 'uploaded' : 'idle',
          uploadProgress: latest.cloudRecordId ? 100 : 0,
          cloudFileId: latest.cloudFileId || '',
          cloudRecordId: latest.cloudRecordId || '',
          transcriptStatus: latest.transcriptStatus || 'idle',
          transcript: latest.transcript || '',
        });
        this.audio.src = latest.localPath;
        this.restoreCloudState(latest);
      },
      fail: () => {},
    });
  },

  restoreCloudState(localRecord) {
    if (!getApp().globalData.cloudReady) return;
    wx.cloud.callFunction({
      name: 'transcribeRecording',
      data: {
        action: 'restore',
        recordId: localRecord.cloudRecordId || localRecord.id || '',
        question: localRecord.question || '',
        duration: localRecord.duration || 0,
      },
      success: ({ result }) => {
        if (!result || !result.success || !result.recording) return;
        const recording = result.recording;
        this.setData({
          uploadStatus: 'uploaded',
          uploadProgress: 100,
          cloudFileId: recording.fileID || this.data.cloudFileId,
          cloudRecordId: recording.recordId,
          transcriptStatus: recording.transcriptStatus || 'pending',
          transcript: recording.transcript || '',
          statusText: recording.transcriptStatus === 'completed' ? '已恢复云端转写结果' : '已恢复云端录音任务',
        }, () => {
          if (recording.transcriptStatus === 'processing' || recording.transcriptStatus === 'waiting') {
            this.asrPollCount = 0;
            this.pollTranscription();
          }
        });
        this.updateLocalRecording({
          cloudFileId: recording.fileID || '', cloudRecordId: recording.recordId,
          transcriptStatus: recording.transcriptStatus || 'pending', transcript: recording.transcript || '',
        });
      },
      fail: (error) => console.warn('[cloud] restore failed', error),
    });
  },

  updateLocalRecording(patch) {
    const records = wx.getStorageSync('local_recordings') || [];
    const index = records.findIndex(item =>
      (this.data.localRecordId && item.id === this.data.localRecordId) ||
      (this.data.savedFilePath && item.localPath === this.data.savedFilePath)
    );
    if (index < 0) return;
    records[index] = { ...records[index], ...patch };
    wx.setStorageSync('local_recordings', records);
  },

  onUnload() {
    this.clearTimer();
    this.clearStartTimeout();
    this.clearAsrPoll();
    if (this.data.status === 'recording' || this.data.status === 'paused') this.recorder.stop();
    if (this.audio) this.audio.destroy();
  },

  bindRecorderEvents() {
    // 开发者工具热重载时 RecorderManager 是全局单例，先移除旧页面监听，避免状态互相覆盖。
    ['offStart', 'offPause', 'offResume', 'offStop', 'offError'].forEach((name) => {
      if (typeof this.recorder[name] === 'function') this.recorder[name]();
    });
    this.recorder.onStart(() => {
      this.clearStartTimeout();
      console.info('[recorder] started');
      this.setData({ status: 'recording', statusText: '正在聆听你的故事…' });
      this.startTimer();
    });
    this.recorder.onPause(() => {
      this.clearTimer();
      this.setData({ status: 'paused', statusText: '录音已暂停' });
    });
    this.recorder.onResume(() => {
      this.setData({ status: 'recording', statusText: '继续录音中…' });
      this.startTimer();
    });
    this.recorder.onStop((result) => {
      this.clearTimer();
      this.clearStartTimeout();
      if (this.ignoreNextStop) {
        this.ignoreNextStop = false;
        console.info('[recorder] stale recording cleared');
        return;
      }
      const seconds = Math.max(1, Math.round(result.duration / 1000));
      this.setData({
        status: 'ready',
        statusText: '录音完成，可以先试听',
        tempFilePath: result.tempFilePath,
        savedFilePath: '',
        elapsed: seconds,
        elapsedText: formatTime(seconds),
        durationText: formatTime(seconds),
        fileSizeText: `${(result.fileSize / 1024 / 1024).toFixed(2)} MB`,
      });
      this.audio.src = result.tempFilePath;
    });
    this.recorder.onError((error) => {
      this.clearTimer();
      this.clearStartTimeout();
      this.setData({ status: 'idle', statusText: '录音失败，请重新尝试' });
      console.error('[recorder] error', error);
      wx.showModal({ title: '录音没有成功', content: error.errMsg || '请检查麦克风权限后重试', showCancel: false });
    });
  },

  bindAudioEvents() {
    this.audio.onPlay(() => this.setData({ isPlaying: true }));
    this.audio.onPause(() => this.setData({ isPlaying: false }));
    this.audio.onStop(() => this.setData({ isPlaying: false }));
    this.audio.onEnded(() => this.setData({ isPlaying: false }));
    this.audio.onError(() => {
      this.setData({ isPlaying: false });
      wx.showToast({ title: '试听失败，请重新录制', icon: 'none' });
    });
  },

  choose(e) {
    if (this.data.status === 'recording' || this.data.status === 'paused') {
      wx.showToast({ title: '请先结束本次录音', icon: 'none' });
      return;
    }
    const selected = Number(e.currentTarget.dataset.index);
    this.setData({ selected, question: questions[selected].question });
  },

  handleMainAction() {
    const { status } = this.data;
    if (status === 'recording') this.pauseRecording();
    else if (status === 'paused') this.resumeRecording();
    else if (status === 'starting') this.cancelStarting();
    else this.requestPermissionAndStart();
  },

  requestPermissionAndStart() {
    wx.getSetting({
      success: ({ authSetting }) => {
        if (authSetting['scope.record'] === true) {
          this.startRecording();
        } else if (authSetting['scope.record'] === false) {
          wx.showModal({
            title: '需要麦克风权限',
            content: '请在设置中允许使用麦克风，才能记录你的讲述。',
            confirmText: '去设置',
            success: ({ confirm }) => confirm && wx.openSetting(),
          });
        } else {
          wx.authorize({
            scope: 'scope.record',
            success: () => this.startRecording(),
            fail: () => wx.showToast({ title: '未获得麦克风权限', icon: 'none' }),
          });
        }
      },
    });
  },

  startRecording() {
    this.clearTimer();
    this.clearStartTimeout();
    if (this.audio) this.audio.stop();
    this.setData({
      status: 'starting',
      statusText: '正在准备麦克风…',
      elapsed: 0,
      elapsedText: '00:00',
      durationText: '00:00',
      fileSizeText: '',
      tempFilePath: '',
      savedFilePath: '',
      localRecordId: '',
      isPlaying: false,
      uploadStatus: 'idle',
      uploadProgress: 0,
      cloudFileId: '',
      cloudRecordId: '',
      transcriptStatus: 'idle',
      transcript: '',
      storyStatus: 'idle',
      storyDraft: null,
    });
    this.recorder.start({
      duration: MAX_DURATION,
      sampleRate: 16000,
      numberOfChannels: 1,
      encodeBitRate: 48000,
      format: 'mp3',
      frameSize: 50,
    });
    // 某些开发者工具版本不会返回 onStart/onError，不能让界面永久卡死。
    this.startTimeout = setTimeout(() => {
      if (this.data.status !== 'starting') return;
      this.forceResetRecorder();
      wx.showModal({
        title: '录音实例已复位',
        content: '检测到开发者工具中的旧录音实例未释放，已经主动清理。请重新点击一次录音。',
        showCancel: false,
      });
    }, 5000);
  },

  cancelStarting() {
    this.forceResetRecorder();
  },

  forceResetRecorder() {
    this.clearStartTimeout();
    this.clearTimer();
    this.ignoreNextStop = true;
    try { this.recorder.stop(); } catch (error) { console.warn('[recorder] reset while idle', error); }
    setTimeout(() => { this.ignoreNextStop = false; }, 500);
    this.setData({ status: 'idle', statusText: '录音环境已复位，请重新点击', elapsed: 0, elapsedText: '00:00' });
  },

  pauseRecording() { this.recorder.pause(); },
  resumeRecording() { this.recorder.resume(); },
  stopRecording() {
    this.setData({ statusText: '正在生成录音文件…' });
    this.recorder.stop();
  },

  startTimer() {
    this.clearTimer();
    this.timer = setInterval(() => {
      const elapsed = this.data.elapsed + 1;
      this.setData({ elapsed, elapsedText: formatTime(elapsed) });
    }, 1000);
  },
  clearTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  },
  clearStartTimeout() {
    if (this.startTimeout) clearTimeout(this.startTimeout);
    this.startTimeout = null;
  },

  togglePlayback() {
    if (!this.data.tempFilePath) return;
    if (this.data.isPlaying) this.audio.pause();
    else {
      this.audio.src = this.data.tempFilePath;
      this.audio.play();
    }
  },

  discard() {
    if (this.audio) this.audio.stop();
    const reset = () => this.setData({
      status: 'idle', statusText: '准备好后，点击下方按钮开始', elapsed: 0,
      elapsedText: '00:00', durationText: '00:00', fileSizeText: '', tempFilePath: '', savedFilePath: '', isPlaying: false,
      localRecordId: '', uploadStatus: 'idle', uploadProgress: 0, cloudFileId: '', cloudRecordId: '', transcriptStatus: 'idle', transcript: '', storyStatus: 'idle', storyDraft: null,
    });
    if (this.data.savedFilePath) {
      wx.getFileSystemManager().unlink({ filePath: this.data.savedFilePath, complete: reset });
    } else reset();
  },

  confirmRecording() {
    if (!this.data.tempFilePath) return;
    if (this.data.savedFilePath) {
      wx.showToast({ title: '本次讲述已保存', icon: 'success' });
      return;
    }
    wx.getFileSystemManager().saveFile({
      tempFilePath: this.data.tempFilePath,
      success: ({ savedFilePath }) => {
        const record = {
          id: `record_${Date.now()}`,
          question: this.data.question,
          duration: this.data.elapsed,
          fileSize: this.data.fileSizeText,
          localPath: savedFilePath,
          createdAt: new Date().toISOString(),
          status: 'local_saved',
        };
        const records = wx.getStorageSync('local_recordings') || [];
        wx.setStorageSync('local_recordings', [record, ...records].slice(0, 20));
        this.setData({ savedFilePath, localRecordId: record.id, status: 'saved', statusText: '已保存到本机，可以继续上传转写' });
        wx.showModal({
          title: '讲述保存成功',
          content: '录音已保存到当前设备。只有你主动点击后，才会上传并进行语音转文字。',
          showCancel: false,
        });
      },
      fail: () => wx.showToast({ title: '保存失败，请重试', icon: 'none' }),
    });
  },

  uploadToCloud() {
    if (!this.data.savedFilePath) {
      wx.showToast({ title: '请先保存本次录音', icon: 'none' });
      return;
    }
    if (!getApp().globalData.cloudReady) {
      wx.showModal({
        title: '云环境尚未配置',
        content: '本机录音仍然安全保留。开通 CloudBase 并填入环境 ID 后，即可测试私有上传。',
        showCancel: false,
      });
      return;
    }
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    // 已登记过的录音必须继续使用原云端编号，不能因旧版的本地编号不同而创建第二个 ASR 任务。
    const recordId = this.data.cloudRecordId || this.data.localRecordId || `record_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const cloudPath = `audio/${day}/${recordId}.mp3`;
    this.setData({ uploadStatus: 'uploading', uploadProgress: 0, statusText: '正在安全上传录音…' });
    const fail = (error, stage = '上传') => {
      console.error(`[cloud] ${stage}失败`, error);
      this.setData({ uploadStatus: 'failed', statusText: `${stage}未完成，本机录音仍然保留` });
      wx.showModal({ title: `${stage}失败`, content: error.errMsg || '请检查云环境和云函数后重试', showCancel: false });
    };
    const register = (fileID) => {
      this.updateLocalRecording({ cloudFileId: fileID, cloudRecordId: recordId });
      wx.cloud.callFunction({
        name: 'recordRecording',
        data: {
          recordId,
          fileID,
          question: this.data.question,
          duration: this.data.elapsed,
          fileSizeText: this.data.fileSizeText,
        },
        success: () => {
          this.setData({ uploadStatus: 'uploaded', uploadProgress: 100, cloudFileId: fileID, cloudRecordId: recordId, statusText: '录音已安全上传，等待转写' });
          this.updateLocalRecording({ cloudFileId: fileID, cloudRecordId: recordId, transcriptStatus: 'pending' });
          wx.showToast({ title: '云端保存成功', icon: 'success' });
        },
        fail: (error) => fail(error, '任务登记'),
      });
    };
    if (this.data.cloudFileId) {
      this.setData({ statusText: '录音已上传，正在恢复任务…' });
      register(this.data.cloudFileId);
      return;
    }
    const task = wx.cloud.uploadFile({
      cloudPath,
      filePath: this.data.savedFilePath,
      success: ({ fileID }) => {
        this.setData({ uploadProgress: 100, cloudFileId: fileID, statusText: '上传完成，正在登记任务…' });
        register(fileID);
      },
      fail: (error) => fail(error),
    });
    if (task && typeof task.onProgressUpdate === 'function') {
      task.onProgressUpdate(({ progress }) => this.setData({ uploadProgress: progress }));
    }
  },

  startTranscription() {
    if (this.data.transcriptStatus === 'completed' && this.data.transcript) {
      wx.showToast({ title: '已显示上次转写结果', icon: 'none' });
      return;
    }
    if (!this.data.cloudRecordId || this.data.transcriptStatus === 'processing') return;
    this.setData({ transcriptStatus: 'starting', statusText: '正在提交语音转写任务…' });
    wx.cloud.callFunction({
      name: 'transcribeRecording',
      data: { action: 'start', recordId: this.data.cloudRecordId },
      success: ({ result }) => {
        if (!result || !result.success) {
          this.handleTranscriptionError(result && result.message ? result.message : '转写任务创建失败');
          return;
        }
        this.asrPollCount = 0;
        this.setData({ transcriptStatus: 'processing', statusText: '正在把声音转成文字…' });
        this.pollTranscription();
      },
      fail: (error) => this.handleTranscriptionError(error.errMsg || '云函数调用失败'),
    });
  },

  pollTranscription() {
    this.clearAsrPoll();
    this.asrPollTimer = setTimeout(() => {
      wx.cloud.callFunction({
        name: 'transcribeRecording',
        data: { action: 'query', recordId: this.data.cloudRecordId },
        success: ({ result }) => {
          if (result && result.status === 'completed') {
            this.clearAsrPoll();
            this.setData({ transcriptStatus: 'completed', transcript: result.transcript || '（识别结果为空）', statusText: '语音转写完成' });
            this.updateLocalRecording({ transcriptStatus: 'completed', transcript: result.transcript || '' });
            return;
          }
          if (result && result.status === 'failed') {
            this.handleTranscriptionError(result.message || '语音识别失败');
            return;
          }
          this.asrPollCount += 1;
          if (this.asrPollCount >= 90) {
            this.setData({ transcriptStatus: 'waiting', statusText: '转写仍在云端处理，可以稍后再查询' });
            return;
          }
          this.pollTranscription();
        },
        fail: (error) => this.handleTranscriptionError(error.errMsg || '查询转写状态失败'),
      });
    }, 3000);
  },

  clearAsrPoll() {
    if (this.asrPollTimer) clearTimeout(this.asrPollTimer);
    this.asrPollTimer = null;
  },

  handleTranscriptionError(message) {
    this.clearAsrPoll();
    console.error('[asr]', message);
    this.setData({ transcriptStatus: 'failed', statusText: '语音转写未完成' });
    wx.showModal({ title: '转写失败', content: String(message), showCancel: false });
  },

  generateStory() {
    if (!this.data.cloudRecordId || this.data.storyStatus === 'generating') return;
    this.setData({ storyStatus: 'generating', statusText: '正在整理讲述中的珍贵细节…' });
    wx.cloud.callFunction({
      name: 'generateStory',
      data: { action: 'generate', recordId: this.data.cloudRecordId },
      success: ({ result }) => {
        if (!result || !result.success) {
          this.handleStoryError(result && result.message ? result.message : '故事整理失败');
          return;
        }
        this.setData({ storyStatus: 'completed', storyDraft: result.work, statusText: '故事草稿已经生成' });
        wx.showToast({ title: '故事草稿已生成', icon: 'success' });
      },
      fail: (error) => this.handleStoryError(error.errMsg || '云函数调用失败'),
    });
  },

  handleStoryError(message) {
    console.error('[story]', message);
    this.setData({ storyStatus: 'failed', statusText: '故事草稿暂未生成' });
    wx.showModal({ title: '暂时无法整理', content: String(message), showCancel: false });
  },

  openStoryDraft() {
    if (!this.data.storyDraft || !this.data.storyDraft.id) return;
    wx.navigateTo({ url: `/pages/work-detail/index?id=${this.data.storyDraft.id}` });
  },
});
