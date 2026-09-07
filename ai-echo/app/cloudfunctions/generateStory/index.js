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
    const chapters = Array.isArray(data.chapters) ? data.chapters.map((item, index) => ({
      id: index,
      title: String((item && item.title) || `第 ${index + 1} 章`).slice(0, 60),
      content: String((item && item.content) || '').slice(0, 8000),
    })).filter(item => item.content).slice(0, 12) : [];
    const content = String(data.content || chapters.map(item => `${item.title}\n${item.content}`).join('\n\n')).slice(0, 30000);
    return {
      title: String(data.title || fallbackTitle || '一段珍贵的回忆').slice(0, 80),
      summary: String(data.summary || '').slice(0, 300),
      content,
      chapters,
      timeline: Array.isArray(data.timeline) ? data.timeline.map(item => ({
        time: String((item && item.time) || '时间待核实').slice(0, 60),
        event: String((item && item.event) || '').slice(0, 300),
        certainty: ['confirmed', 'approximate', 'uncertain'].includes(item && item.certainty) ? item.certainty : 'uncertain',
      })).filter(item => item.event).slice(0, 40) : [],
      people: Array.isArray(data.people) ? data.people.map(item => ({
        name: String((item && item.name) || '姓名待核实').slice(0, 60),
        relation: String((item && item.relation) || '').slice(0, 100),
        note: String((item && item.note) || '').slice(0, 300),
      })).slice(0, 40) : [],
      artifacts: Array.isArray(data.artifacts) ? data.artifacts.map(item => ({
        name: String((item && item.name) || '实物线索').slice(0, 80),
        context: String((item && item.context) || '').slice(0, 300),
        verification: String((item && item.verification) || '').slice(0, 200),
      })).slice(0, 40) : [],
      uncertainties: Array.isArray(data.uncertainties) ? data.uncertainties.map(item => String(item).slice(0, 200)).slice(0, 10) : [],
      nextQuestions: Array.isArray(data.nextQuestions) ? data.nextQuestions.map(item => String(item).slice(0, 200)).slice(0, 15) : [],
    };
  } catch (error) {
    return { title: fallbackTitle || '一段珍贵的回忆', summary: cleaned.slice(0, 120), content: cleaned.slice(0, 30000), chapters: [], timeline: [], people: [], artifacts: [], uncertainties: [], nextQuestions: [] };
  }
}

function publicWork(work, includeSource = false) {
  const result = {
    id: work._id, title: work.title, summary: work.summary || '', content: work.content || '',
    chapters: work.chapters || [], timeline: work.timeline || [], people: work.people || [], artifacts: work.artifacts || [],
    uncertainties: work.uncertainties || [], nextQuestions: work.nextQuestions || [],
    status: work.status, statusText: STATUS_TEXT[work.status] || '草稿',
  };
  if (includeSource) {
    result.sourceTranscript = work.sourceTranscript || '';
    result.supplements = work.supplements || [];
    result.reviews = work.reviews || [];
  }
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
  const prompt = `你是家庭口述史编辑。请只根据原始讲述，整理一份真实、克制、便于家人阅读和继续核实的人物故事档案。\n规则：\n1. 不得新增原文没有的人物、时间、地点、事件、因果或观点，不得包装成传奇。\n2. 删除无意义重复，但保留讲述者有个性的语言、方言和有画面感的细节。\n3. 原文冲突、模糊或仅为转述的内容必须使用“约、据回忆、可能、尚待核实”等措辞；凡列入 uncertainties 的事实，正文绝对不能写成确定事实。\n4. 团队成果不得改写成个人功劳；农历、公历、证件日期必须保留区别。\n5. 正文按人生阶段形成 4—10 个自然章节，每章有短标题，避免把长文压缩成人物简介。\n6. timeline 的 certainty 只能是 confirmed、approximate、uncertain。\n7. artifacts 提取照片、证件、信件和实物，并说明核实方向。\n8. nextQuestions 要具体、可在下一次访谈中直接提问，优先解决矛盾并寻找交叉来源。\n9. 只输出合法 JSON，不要 Markdown。格式：{"title":"不超过30字","summary":"不超过100字","chapters":[{"title":"章节名","content":"正文"}],"timeline":[{"time":"时间","event":"事件","certainty":"confirmed|approximate|uncertain"}],"people":[{"name":"姓名","relation":"与主人公关系","note":"关键信息"}],"artifacts":[{"name":"实物名称","context":"相关经历","verification":"核实建议"}],"uncertainties":["待核实事项"],"nextQuestions":["下一轮访谈问题"]}\n\n引导问题：${String(recording.question || '').slice(0, 200)}\n原始讲述：${transcript.slice(0, 24000)}`;

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
    title: story.title, summary: story.summary, content: story.content, chapters: story.chapters,
    timeline: story.timeline, people: story.people, artifacts: story.artifacts,
    uncertainties: story.uncertainties, nextQuestions: story.nextQuestions,
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
  const chapters = event.flattenChapters ? [] : (work.chapters || []);
  await db.collection('works').doc(work._id).update({ data: { title, content, chapters, status, confirmedAt: event.confirm ? db.serverDate() : work.confirmedAt || null, updatedAt: db.serverDate() } });
  return { success: true, work: publicWork({ ...work, title, content, chapters, status }, true) };
}

async function saveChapter(event, openId) {
  const work = await ownedWork(event.workId, openId);
  const chapters = Array.isArray(work.chapters) ? work.chapters.map(item => ({ ...item })) : [];
  const chapterIndex = Number(event.chapterIndex);
  const chapterContent = String(event.content || '').trim().slice(0, 8000);
  if (!Number.isInteger(chapterIndex) || !chapters[chapterIndex] || !chapterContent) {
    return { success: false, code: 'INVALID_CHAPTER', message: '章节内容不能为空' };
  }
  chapters[chapterIndex].content = chapterContent;
  const content = chapters.map(item => `${item.title}\n${item.content}`).join('\n\n').slice(0, 30000);
  await db.collection('works').doc(work._id).update({ data: {
    chapters, content, status: 'draft', updatedAt: db.serverDate(),
  } });
  return { success: true, work: publicWork({ ...work, chapters, content, status: 'draft' }, true) };
}

async function addSupplement(event, openId) {
  const work = await ownedWork(event.workId, openId);
  const text = String(event.text || '').trim().slice(0, 1000);
  const chapterIndex = Number(event.chapterIndex);
  if (!text) return { success: false, code: 'INVALID_SUPPLEMENT', message: '补充内容不能为空' };
  const supplements = Array.isArray(work.supplements) ? work.supplements.slice(-49) : [];
  supplements.push({
    id: `supplement_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    chapterIndex: Number.isInteger(chapterIndex) ? chapterIndex : 0,
    chapterTitle: String(event.chapterTitle || '').slice(0, 60),
    text,
    status: 'pending',
    createdAt: new Date().toISOString(),
  });
  await db.collection('works').doc(work._id).update({ data: { supplements, updatedAt: db.serverDate() } });
  return { success: true, supplementCount: supplements.length };
}

async function deleteSupplement(event, openId) {
  const work = await ownedWork(event.workId, openId);
  const supplements = Array.isArray(work.supplements) ? work.supplements.slice() : [];
  const index = Number(event.index);
  if (!Number.isInteger(index) || !supplements[index]) {
    return { success: false, code: 'SUPPLEMENT_NOT_FOUND', message: '补充内容不存在' };
  }
  supplements.splice(index, 1);
  await db.collection('works').doc(work._id).update({ data: { supplements, updatedAt: db.serverDate() } });
  return { success: true, supplements };
}

async function saveReview(event, openId) {
  const work = await ownedWork(event.workId, openId);
  const kind = event.kind === 'question' ? 'question' : 'fact';
  const index = Number(event.index);
  const status = ['confirmed', 'corrected', 'unknown', 'answered', 'dismissed'].includes(event.status) ? event.status : '';
  if (!Number.isInteger(index) || index < 0 || !status) {
    return { success: false, code: 'INVALID_REVIEW', message: '校订内容无效' };
  }
  const reviews = Array.isArray(work.reviews) ? work.reviews.slice() : [];
  const review = { kind, index, status, answer: String(event.answer || '').trim().slice(0, 1000), updatedAt: new Date().toISOString() };
  const existingIndex = reviews.findIndex(item => item.kind === kind && Number(item.index) === index);
  if (existingIndex >= 0) reviews[existingIndex] = review;
  else reviews.push(review);
  await db.collection('works').doc(work._id).update({ data: { reviews, updatedAt: db.serverDate() } });
  return { success: true, reviews };
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) throw new Error('OPENID_NOT_FOUND');
  if (event.action === 'generate') return generate(event, OPENID);
  if (event.action === 'list') return list(OPENID);
  if (event.action === 'get') return get(event, OPENID);
  if (event.action === 'save') return save(event, OPENID);
  if (event.action === 'saveChapter') return saveChapter(event, OPENID);
  if (event.action === 'addSupplement') return addSupplement(event, OPENID);
  if (event.action === 'deleteSupplement') return deleteSupplement(event, OPENID);
  if (event.action === 'saveReview') return saveReview(event, OPENID);
  throw new Error('INVALID_ACTION');
};
