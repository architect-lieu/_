const cloud=require('wx-server-sdk');
cloud.init({env:cloud.DYNAMIC_CURRENT_ENV});
const db=cloud.database();

exports.main=async(event)=>{
  if(event.return_code!=='SUCCESS' || event.result_code!=='SUCCESS') return {errcode:0};
  const number=event.out_trade_no;
  if(!number) return {errcode:0};
  const found=await db.collection('orders').where({orderNo:number}).limit(1).get();
  const order=found.data[0];
  if(!order || order.status==='paid') return {errcode:0};
  if(Number(event.total_fee)!==Number(order.amount)) return {errcode:1,errmsg:'AMOUNT_MISMATCH'};
  await db.collection('orders').doc(order._id).update({data:{status:'paid',transactionId:event.transaction_id || '',paidAt:db.serverDate(),updatedAt:db.serverDate()}});
  return {errcode:0};
};
