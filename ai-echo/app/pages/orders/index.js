Page({
  data:{orders:[],loading:true},
  onShow(){this.load();},
  async load(){
    this.setData({loading:true});
    try{
      const result=await wx.cloud.callFunction({name:'orderCenter',data:{action:'list'}});
      if(!result.result || !result.result.success) throw new Error('LOAD_ORDERS_FAILED');
      this.setData({orders:result.result.orders || []});
    }catch(error){wx.showToast({title:'订单加载失败',icon:'none'});}finally{this.setData({loading:false});}
  }
});
