const app = getApp();

Page({
  data:{ user:null, loading:false, counts:{orders:0,recordings:0}, menus:[{icon:'▤',title:'我的订单'},{icon:'✉',title:'联系合作'},{icon:'◌',title:'意见反馈'},{icon:'⌖',title:'关于我们'},{icon:'▧',title:'隐私政策'}]},
  onShow(){ this.loadUser(); },
  async loadUser(){
    if(!app.globalData.cloudReady) return;
    this.setData({loading:true});
    try {
      const result = await wx.cloud.callFunction({name:'userCenter',data:{action:'me'}});
      if(result.result && result.result.success){
        app.globalData.user=result.result.user;
        this.setData({user:result.result.user,counts:result.result.counts || this.data.counts});
      }
    } catch(e) {} finally { this.setData({loading:false}); }
  },
  login(){ wx.navigateTo({url:'/pages/login/index'}); },
  tapMenu(e){ const i=e.currentTarget.dataset.index; if(i===0){wx.navigateTo({url:'/pages/orders/index'});}else if(i===4){wx.navigateTo({url:'/pages/privacy/index'});}else{wx.showToast({title:'界面已预留',icon:'none'});} }
});
