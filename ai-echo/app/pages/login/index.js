const app = getApp();

Page({
  data:{ agreed:false, loading:false },
  toggle(){this.setData({agreed:!this.data.agreed});},
  async login(){
    if(!this.data.agreed){wx.showToast({title:'请先同意隐私政策',icon:'none'});return;}
    if(!app.globalData.cloudReady){wx.showToast({title:'云服务尚未就绪',icon:'none'});return;}
    this.setData({loading:true});
    try {
      const result = await wx.cloud.callFunction({name:'userCenter',data:{action:'login'}});
      if(!result.result || !result.result.success) throw new Error('LOGIN_FAILED');
      app.globalData.user = result.result.user;
      wx.showToast({title:'登录成功',icon:'success'});
      setTimeout(() => wx.navigateBack({delta:1,fail:()=>wx.switchTab({url:'/pages/profile/index'})}), 500);
    } catch (error) {
      wx.showModal({title:'登录失败',content:(error && error.errMsg) || error.message || '请稍后重试',showCancel:false});
    } finally { this.setData({loading:false}); }
  },
  privacy(){wx.navigateTo({url:'/pages/privacy/index'});}
});
