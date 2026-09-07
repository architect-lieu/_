const plans = {
  trial: { title:'回音故事卡', price:'99', subtitle:'用一次讲述，留下一个完整片段', items:['一次 30—45 分钟轻访谈','交付 1—2 页电子故事卡','一次文字事实确认','可抵扣后续正式服务'] },
  digital: { title:'数字回音录', price:'699', subtitle:'适合先持续记录，再决定是否成书', items:['回音十二问讲述引导','故事整理与基础编辑','电子故事集交付','家庭成员共同确认'] },
  book: { title:'父母人生书', price:'2,999', subtitle:'把声音、照片和一生经历装订成册', items:['真人深度访谈','AI 整理与人工编辑','照片与人生时间线','排版、校对与实体成书'] },
};
Page({
  data:{ plan: plans.book, planId:'book', paying:false },
  onLoad(options){ const planId=plans[options.id]?options.id:'book'; this.setData({planId,plan:plans[planId]}); },
  async consult(){
    if(this.data.paying) return;
    this.setData({paying:true});
    try {
      const result=await wx.cloud.callFunction({name:'orderCenter',data:{action:'create',planId:this.data.planId}});
      const data=result.result || {};
      if(!data.success){
        if(data.code==='PAYMENT_NOT_CONFIGURED'){
          wx.showModal({title:'订单已保存',content:'用户与订单功能已经可用；微信支付商户配置完成后即可付款。',confirmText:'查看订单',success:r=>{if(r.confirm)wx.navigateTo({url:'/pages/orders/index'});}});
          return;
        }
        throw new Error(data.message || 'CREATE_ORDER_FAILED');
      }
      await wx.requestPayment(data.payment);
      wx.showToast({title:'支付成功',icon:'success'});
      wx.navigateTo({url:'/pages/orders/index'});
    } catch(error) {
      const message=(error && (error.errMsg || error.message)) || '请稍后重试';
      if(message.indexOf('cancel')<0) wx.showModal({title:'暂未完成',content:message,showCancel:false});
    } finally {this.setData({paying:false});}
  }
});
