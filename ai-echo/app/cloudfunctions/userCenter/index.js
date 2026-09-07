const cloud = require('wx-server-sdk');
cloud.init({env:cloud.DYNAMIC_CURRENT_ENV});
const db=cloud.database();

async function findUser(openId){
  const result=await db.collection('users').where({openId}).limit(1).get();
  return result.data[0] || null;
}

exports.main=async(event)=>{
  const {OPENID,APPID,UNIONID}=cloud.getWXContext();
  if(!OPENID) throw new Error('OPENID_NOT_FOUND');
  let user=await findUser(OPENID);
  if(!user && event.action==='login'){
    const data={openId:OPENID,appId:APPID,unionId:UNIONID || '',status:'active',createdAt:db.serverDate(),lastLoginAt:db.serverDate()};
    const created=await db.collection('users').add({data});
    user={_id:created._id,...data};
  }else if(user && event.action==='login'){
    await db.collection('users').doc(user._id).update({data:{lastLoginAt:db.serverDate()}});
  }
  if(!user) return {success:false,code:'NOT_LOGGED_IN'};
  const [orders,recordings]=await Promise.all([
    db.collection('orders').where({ownerOpenId:OPENID}).count().catch(()=>({total:0})),
    db.collection('recordings').where({ownerOpenId:OPENID}).count().catch(()=>({total:0})),
  ]);
  return {success:true,user:{id:user._id,status:user.status},counts:{orders:orders.total,recordings:recordings.total}};
};
