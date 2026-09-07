const cloud = require('wx-server-sdk');
const tcb = require('@cloudbase/node-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const DEFAULT_ENV_ID = 'cloud1-6gsz1a2qfbb4e404';
const STATUS_TEXT = { draft: '待确认', confirmed: '已确认' };

async function ownedRecording(recordId, openId) {
  const result = await db.collection('recordings').where({ recordId, ownerOpenId: openId }).limit(1).get();
  if (!result.data.length) throw new Error('RECORDING_NOT_FOUND');
  return result.data[0];
}

async function ownedWork(workId, openId) {
  const result = await db.collection('works').where({ _id: workId, ownerOpenId: openId }).limit(1).get();
  if (!result.data.length) throw new Error('WORK_NOT_FOUND');
  return result.data[0];
}

function parseModelText(text, fallbackTitle) {
  const cleaned = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const data = JSON.parse(cleaned);
    return {
      title: String(data.title || fallbackTitle || '一段珍贵的回忆').slice(0, 80),
      summary: String(data.summary || '').slice(0, 300),
      content: String(data.content || '').slice(0, 20000),
      uncertainties: Array.isArray(data.uncertainties) ? data.uncertainties.map(item => String(item).slice(0, 200)).slice(0, 10) : [],
    };
  } catch (error) {
    return { title: fallbackTitle || '一段珍贵的回忆', summary: cleaned.slice(0, 120), content: cleaned.slice(0, 20000), uncertainties: [] };
  }
}

function publicWork(work, includeSource = false) {
  const result = {
    id: work._id, title: work.title, summary: work.summary || '', content: work.content || '',
    uncertainties: work.uncertainties || [], status: work.status, statusText: STATUS_TEXT[work.status] || '草稿',
  };
  if (includeSource) result.sourceTranscript = work.sourceTranscript || '';
  return result;
}

function safeErrorDetail(error) {
  let responseData = '';
  try {
    if (error && error.response && error.response.data) {
      responseData = typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data);
    }
  } catch (ignored) {}
  const parts = [error && error.code, error && error.name, error && error.message, responseData]
    .filter(Boolean)
    .map(value => String(value).replace(/[\r\n]+/g, ' ').slice(0, 300));
  return parts.join(' | ') || 'UNKNOWN_AI_ERROR';
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function generateWithRetry(model, request) {
  const delays = [0, 1200, 3500];
  let lastError;
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt]) await wait(delays[attempt]);
    try {
      return await model.generateText(request);
    } catch (error) {
      lastError = error;
      const status = Number(error && (error.status || error.code || (error.response && error.response.status)));
      if (status !== 429 || attempt === delays.length - 1) throw error;
      console.warn(`[generateStory] model busy, retry ${attempt + 1}`);
    }
  }
  throw lastError;
}

async function generate(event, openId) {
  const recording = await ownedRecording(event.recordId, openId);
  const transcript = String(recording.transcriptRaw || '').trim();
  if (!transcript || recording.transcriptStatus !== 'completed') return { success: false, code: 'TRANSCRIPT_NOT_READY', message: '原始转写尚未完成' };
  const existing = await db.collection('works').where({ ownerOpenId: openId, recordingId: recording.recordId }).limit(1).get();
  if (existing.data.length && !event.regenerate) return { success: true, reused: true, work: publicWork(existing.data[0]) };

  const envId = process.env.CLOUDBASE_ENV_ID || DEFAULT_ENV_ID;
  const modelId = process.env.STORY_MODEL_ID || 'hy3';
  const app = tcb.init({ env: envId, timeout: 60000 });
  const model = app.ai().createModel('cloudbase');
  const prompt = `你是家庭口述史编辑。请只根据原始讲述整理一篇温暖、克制、真实的中文故事草稿。\n规则：\n1. 不得新增原文没有的人物、时间、地点、事件或观点。\n2. 删除口头重复和无意义语气词，但保留有感情、有画面感的细节。\n3. 信息不足时不要补写，把需要讲述人核对的内容放入 uncertainties。\n4. 这不是文学扩写，正文尽量保持讲述人的语气。\n5. 只输出合法 JSON，不要 Markdown。格式：{"title":"不超过30字","summary":"不超过80字","content":"故事正文","uncertainties":["待核对事项"]}\n\n引导问题：${String(recording.question || '').slice(0, 200)}\n原始讲述：${transcript.slice(0, 24000)}`;

  let generated;
  try {
    generated = await generateWithRetry(model, { model: modelId, messages: [{ role: 'user', content: prompt }] });
  } catch (error) {
    console.error('[generateStory] model error', error);
    const detail = safeErrorDetail(error);
    return {
      success: false,
      code: 'AI_NOT_READY',
      message: `AI 调用失败：${detail}`,
    };
  }
  const story = parseModelText(generated.text, recording.question);
  if (!story.content) return { success: false, code: 'EMPTY_MODEL_RESULT', message: '模型没有返回有效故事，请稍后重试' };
  const data = {
    ownerOpenId: openId, recordingId: recording.recordId, recordingDatabaseId: recording._id,
    title: story.title, summary: story.summary, content: story.content, uncertainties: story.uncertainties,
    sourceTranscript: transcript.slice(0, 30000), question: recording.question || '', status: 'draft',
    modelProvider: 'cloudbase', modelId, tokenUsage: generated.usage || {}, createdAt: db.serverDate(), updatedAt: db.serverDate(),
  };
  const created = await db.collection('works').add({ data });
  return { success: true, work: publicWork({ _id: created._id, ...data }) };
}

async function list(openId) {
  const result = await db.collection('works').where({ ownerOpenId: openId }).orderBy('updatedAt', 'desc').limit(50).get();
  return { success: true, works: result.data.map(item => publicWork(item)) };
}

async function get(event, openId) {
  const work = await ownedWork(event.workId, openId);
  return { success: true, work: publicWork(work, true) };
}

async function save(event, openId) {
  const work = await ownedWork(event.workId, openId);
  const title = String(event.title || '').trim().slice(0, 80);
  const content = String(event.content || '').trim().slice(0, 20000);
  if (!title || !content) return { success: false, code: 'INVALID_WORK', message: '标题和正文不能为空' };
  const status = event.confirm ? 'confirmed' : 'draft';
  await db.collection('works').doc(work._id).update({ data: { title, content, status, confirmedAt: event.confirm ? db.serverDate() : work.confirmedAt || null, updatedAt: db.serverDate() } });
  return { success: true, work: publicWork({ ...work, title, content, status }, true) };
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) throw new Error('OPENID_NOT_FOUND');
  if (event.action === 'generate') return generate(event, OPENID);
  if (event.action === 'list') return list(OPENID);
  if (event.action === 'get') return get(event, OPENID);
  if (event.action === 'save') return save(event, OPENID);
  throw new Error('INVALID_ACTION');
};
