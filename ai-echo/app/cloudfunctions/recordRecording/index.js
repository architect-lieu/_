const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (event.action === 'importTranscript') {
    const recordId = String(event.recordId || '');
    const transcript = String(event.transcript || '').trim();
    if (!OPENID || !recordId || transcript.length < 100 || transcript.length > 30000) {
      return { success: false, code: 'INVALID_TRANSCRIPT', message: '测试文本应为 100—30000 个字符' };
    }
    const existing = await db.collection('recordings').where({ recordId, ownerOpenId: OPENID }).limit(1).get();
    if (existing.data.length) return { success: true, reused: true, recordId };
    const result = await db.collection('recordings').add({ data: {
      recordId, ownerOpenId: OPENID, fileID: '', question: String(event.question || '').slice(0, 200),
      duration: 0, fileSizeText: `${transcript.length} 字`, status: 'imported', sourceType: 'text_import',
      transcriptStatus: 'completed', transcriptRaw: transcript, transcriptDetail: [],
      createdAt: db.serverDate(), updatedAt: db.serverDate(),
    } });
    return { success: true, recordId, databaseId: result._id };
  }
  const { recordId, fileID, question, duration, fileSizeText } = event;
  if (!OPENID || !recordId || !fileID) throw new Error('INVALID_RECORDING_DATA');

  const existing = await db.collection('recordings').where({ recordId, ownerOpenId: OPENID }).limit(1).get();
  if (existing.data.length) {
    return { success: true, reused: true, recordId, databaseId: existing.data[0]._id };
  }

  const recording = {
    recordId,
    ownerOpenId: OPENID,
    fileID,
    question: String(question || '').slice(0, 200),
    duration: Number(duration || 0),
    fileSizeText: String(fileSizeText || '').slice(0, 30),
    status: 'uploaded',
    transcriptStatus: 'pending',
    createdAt: db.serverDate(),
    updatedAt: db.serverDate(),
  };
  const result = await db.collection('recordings').add({ data: recording });
  return { success: true, recordId, databaseId: result._id };
};
