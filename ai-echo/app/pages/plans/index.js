Page({
  data: { plans: [
    { id:'trial', badge:'先体验', name:'回音故事卡', price:'99', unit:'元起', desc:'一次轻访谈，交付 1—2 页故事卡', tone:'peach' },
    { id:'digital', badge:'轻量记录', name:'数字回音录', price:'699', unit:'元起', desc:'持续讲述，逐步整理为电子故事集', tone:'blue' },
    { id:'book', badge:'推荐', name:'父母人生书', price:'2,999', unit:'元起', desc:'深度访谈、编辑核实、排版与实体成书', tone:'gold' }
  ]},
  open(e) { wx.navigateTo({ url: `/pages/plan-detail/index?id=${e.currentTarget.dataset.id}` }); }
});
