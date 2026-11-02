// Asthma condition definition
(function(root, factory){
  if(typeof module==='object' && module.exports){ module.exports = factory(root.ConditionRegistry, root.AsthmeTrackLogic); }
  else { root.AsthmaCondition = factory(root.ConditionRegistry, root.AsthmeTrackLogic); }
})(typeof self!=='undefined'?self:this, function(Registry, Logic){
  const def = {
    id: 'asthma',
    name: 'Asthma',
    nameFr: 'Asthme',
    color: '#4f9cf9',
    icon: 'lungs',
    fields: [
      {key:'dep', type:'number', label:'DEP', required:true},
      {key:'spo2', type:'number', label:'SpO₂'},
      {key:'easyhaler', type:'number', label:'Easyhaler'},
      {key:'comment', type:'text', label:'Commentaire'}
    ],
    validate(entry){
      const e=entry||{};
      if(e.dep==null || e.dep==='') return {ok:false, msg:'dep_required'};
      const d=Number(e.dep);
      if(isNaN(d)||d<50||d>900) return {ok:false, msg:'dep_range'};
      if(e.spo2!=null && e.spo2!==''){
        const s=Number(e.spo2);
        if(isNaN(s)||s<70||s>100) return {ok:false, msg:'spo2_range'};
      }
      return {ok:true};
    },
    getZone(entry, bestDEP){
      if(!entry.dep || !bestDEP) return null;
      return Logic ? Logic.depZone(entry.dep, bestDEP) : null;
    }
  };
  if(Registry) Registry.register('asthma', def);
  return def;
});
