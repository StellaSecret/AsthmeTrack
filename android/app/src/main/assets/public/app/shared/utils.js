// Shared utils for multi-condition
(function(root,factory){
  if(typeof module==='object'&&module.exports) module.exports=factory();
  else root.SharedUtils=factory();
})(typeof self!=='undefined'?self:this, function(){
  function nextId(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
  function uid(){ return nextId(); }
  return {nextId, uid};
});
