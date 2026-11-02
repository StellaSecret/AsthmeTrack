// Diabetes condition definition
(function(root, factory){
  if(typeof module==='object' && module.exports){ module.exports = factory(root.ConditionRegistry); }
  else { root.DiabetesCondition = factory(root.ConditionRegistry); }
})(typeof self!=='undefined'?self:this, function(Registry){
  const def = {
    id: 'diabetes',
    name: 'Diabetes',
    nameFr: 'Diabète',
    color: '#a78bfa',
    icon: 'drop',
    fields: [
      {key:'glucose', type:'number', label:'Glycémie', required:true},
      {key:'unit', type:'select', options:['mg/dL','mmol/L'], label:'Unité', default:'mg/dL'},
      {key:'context', type:'select', options:['à jeun','postprandial','aléatoire','avant repas','après repas'], label:'Contexte'},
      {key:'insulin', type:'number', label:'Insuline (UI)'},
      {key:'meals', type:'text', label:'Repas'},
      {key:'comment', type:'text', label:'Commentaire'}
    ],
    validate(entry){
      const e=entry||{};
      if(e.glucose==null) return {ok:false, msg:'glucose_required'};
      const g=Number(e.glucose);
      const unit=e.unit||'mg/dL';
      if(unit==='mg/dL'){ if(isNaN(g)||g<20||g>600) return {ok:false,msg:'glucose_range'}; }
      else { if(isNaN(g)||g<1.1||g>33.3) return {ok:false,msg:'glucose_range'}; }
      return {ok:true};
    }
  };
  if(Registry) Registry.register('diabetes', def);
  return def;
});
