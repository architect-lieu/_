const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
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
