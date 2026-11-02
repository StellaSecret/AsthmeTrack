// Multi-condition registry
(function(root, factory){
  if(typeof module==='object' && module.exports){ module.exports = factory(); }
  else { root.ConditionRegistry = factory(); }
})(typeof self!=='undefined'?self:this, function(){
  const conditions = {};
  function register(id, def){ conditions[id]=def; }
  function get(id){ return conditions[id]; }
  function all(){ return Object.values(conditions); }
  function listIds(){ return Object.keys(conditions); }
  return {register, get, all, listIds};
});
