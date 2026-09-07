const cloud=require('wx-server-sdk');
cloud.init({env:cloud.DYNAMIC_CURRENT_ENV});
const db=cloud.database();

const PRODUCTS={
  trial:{name:'回音故事卡',amount:9900},
  digital:{name:'数字回音录',amount:69900},
  book:{name:'父母人生书',amount:299900},
};
const STATUS_TEXT={pending:'待支付',paid:'已支付',cancelled:'已取消',refunded:'已退款'};
const orderNo=()=>`AE${Date.now()}${Math.random().toString().slice(2,8)}`;

async function create(event,openId){
  const product=PRODUCTS[event.planId];
  if(!product) return {success:false,code:'INVALID_PRODUCT',message:'商品不存在'};
  const number=orderNo();
  await db.collection('orders').add({data:{orderNo:number,ownerOpenId:openId,planId:event.planId,productName:product.name,amount:product.amount,currency:'CNY',status:'pending',createdAt:db.serverDate(),updatedAt:db.serverDate()}});
  const subMchId=process.env.WXPAY_SUB_MCH_ID;
  const envId=process.env.WXPAY_ENV_ID;
  const callback=process.env.WXPAY_CALLBACK_FUNCTION || 'payCallback';
  if(!subMchId || !envId) return {success:false,code:'PAYMENT_NOT_CONFIGURED',orderNo:number};
  try{
    const result=await cloud.cloudPay.unifiedOrder({body:product.name,outTradeNo:number,spbillCreateIp:'127.0.0.1',subMchId,totalFee:product.amount,envId,functionName:callback});
    return {success:true,orderNo:number,payment:result.payment};
  }catch(error){
    await db.collection('orders').where({orderNo:number,ownerOpenId:openId}).update({data:{status:'payment_error',paymentError:String(error.message || error).slice(0,300),updatedAt:db.serverDate()}});
    throw error;
  }
}

async function list(openId){
  const result=await db.collection('orders').where({ownerOpenId:openId}).orderBy('createdAt','desc').limit(50).get();
  return {success:true,orders:result.data.map(item=>({orderNo:item.orderNo,productName:item.productName,status:item.status,statusText:STATUS_TEXT[item.status] || '处理中',amountYuan:(item.amount/100).toFixed(2),createdAtText:item.createdAt && item.createdAt.toLocaleString?item.createdAt.toLocaleString('zh-CN'):'刚刚'}))};
}

exports.main=async(event)=>{
  const {OPENID}=cloud.getWXContext();
  if(!OPENID) throw new Error('OPENID_NOT_FOUND');
  if(event.action==='create') return create(event,OPENID);
  if(event.action==='list') return list(OPENID);
  throw new Error('INVALID_ACTION');
};
