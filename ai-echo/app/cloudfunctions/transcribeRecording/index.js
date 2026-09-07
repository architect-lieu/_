const cloud = require('wx-server-sdk');
const tencentcloud = require('tencentcloud-sdk-nodejs-asr');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const AsrClient = tencentcloud.asr.v20190614.Client;

function getAsrClient() {
  const secretId = process.env.TENCENTCLOUD_SECRETID;
  const secretKey = process.env.TENCENTCLOUD_SECRETKEY;
  const token = process.env.TENCENTCLOUD_SESSIONTOKEN;
  if (!secretId || !secretKey) throw new Error('ASR_RUNTIME_ROLE_NOT_CONFIGURED');
  return new AsrClient({
    credential: { secretId, secretKey, token },
    region: 'ap-guangzhou',
    profile: { httpProfile: { endpoint: 'asr.tencentcloudapi.com' } },
  });
}

async function findOwnedRecording(recordId, openId) {
  const result = await db.collection('recordings').where({ recordId, ownerOpenId: openId }).limit(1).get();
  if (!result.data.length) throw new Error('RECORDING_NOT_FOUND');
  return result.data[0];
}

async function start(recording) {
  if (recording.asrTaskId) {
    return { success: true, taskId: recording.asrTaskId, status: recording.transcriptStatus || 'processing' };
  }
  const tempResult = await cloud.getTempFileURL({ fileList: [recording.fileID] });
  const file = tempResult.fileList && tempResult.fileList[0];
  if (!file || !file.tempFileURL) throw new Error('AUDIO_TEMP_URL_FAILED');

  const client = getAsrClient();
  const response = await client.CreateRecTask({
    // 基础中文通用引擎：避免依赖需单独开通的大模型 ASR 产品。
    EngineModelType: '16k_zh',
    ChannelNum: 1,
    ResTextFormat: 3,
    SourceType: 0,
    Url: file.tempFileURL,
    ConvertNumMode: 1,
  });
  await db.collection('recordings').doc(recording._id).update({
    data: {
      asrTaskId: response.Data.TaskId,
      transcriptStatus: 'processing',
      transcriptError: '',
      updatedAt: db.serverDate(),
    },
  });
  return { success: true, taskId: response.Data.TaskId, status: 'processing' };
}

async function query(recording) {
  if (!recording.asrTaskId) return { success: false, status: 'not_started' };
  if (recording.transcriptStatus === 'completed' && recording.transcriptRaw) {
    return { success: true, status: 'completed', transcript: recording.transcriptRaw, cached: true };
  }
  const client = getAsrClient();
  const response = await client.DescribeTaskStatus({ TaskId: recording.asrTaskId });
  const data = response.Data || {};
  if (data.Status === 2) {
    await db.collection('recordings').doc(recording._id).update({
      data: {
        transcriptStatus: 'completed',
        transcriptRaw: data.Result || '',
        transcriptDetail: data.ResultDetail || [],
        updatedAt: db.serverDate(),
      },
    });
    return { success: true, status: 'completed', transcript: data.Result || '' };
  }
  if (data.Status === 3) {
    const message = data.ErrorMsg || '语音识别失败';
    await db.collection('recordings').doc(recording._id).update({
      data: { transcriptStatus: 'failed', transcriptError: message, updatedAt: db.serverDate() },
    });
    return { success: false, status: 'failed', message };
  }
  return { success: true, status: data.Status === 1 ? 'processing' : 'waiting' };
}

async function restore(event, openId) {
  let recording = null;
  if (event.recordId) {
    const exact = await db.collection('recordings').where({ recordId: event.recordId, ownerOpenId: openId }).limit(1).get();
    recording = exact.data[0] || null;
  }
  if (!recording) {
    const recent = await db.collection('recordings').where({ ownerOpenId: openId }).limit(20).get();
    const duration = Number(event.duration || 0);
    const matches = recent.data.filter(item =>
      (!event.question || item.question === event.question) &&
      (!duration || Math.abs(Number(item.duration || 0) - duration) <= 2)
    );
    recording = matches.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0] || null;
  }
  if (!recording) return { success: false, code: 'RECORDING_NOT_FOUND' };
  return {
    success: true,
    recording: {
      recordId: recording.recordId,
      fileID: recording.fileID,
      transcriptStatus: recording.transcriptStatus || 'pending',
      transcript: recording.transcriptRaw || '',
    },
  };
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) throw new Error('INVALID_REQUEST');
  if (event.action === 'restore') return restore(event, OPENID);
  if (!event.recordId) throw new Error('INVALID_REQUEST');
  const recording = await findOwnedRecording(event.recordId, OPENID);
  if (event.action === 'start') return start(recording);
  if (event.action === 'query') return query(recording);
  throw new Error('INVALID_ACTION');
};
