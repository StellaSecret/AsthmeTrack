// Hypertension condition definition
(function(root, factory){
  if(typeof module==='object' && module.exports){ module.exports = factory(root.ConditionRegistry); }
  else { root.HypertensionCondition = factory(root.ConditionRegistry); }
})(typeof self!=='undefined'?self:this, function(Registry){
  const def = {
    id: 'hypertension',
    name: 'Hypertension',
    nameFr: 'Hypertension',
    color: '#f97316',
    icon: 'heart',
    fields: [
      {key:'systolic', type:'number', label:'Systolique', required:true},
      {key:'diastolic', type:'number', label:'Diastolique', required:true},
      {key:'pulse', type:'number', label:'Pouls'},
      {key:'position', type:'select', options:['assis','couché','debout'], label:'Position'},
      {key:'comment', type:'text', label:'Commentaire'}
    ],
    validate(entry){
      const e=entry||{};
      if(e.systolic==null||e.diastolic==null) return {ok:false, msg:'bp_required'};
      const s=Number(e.systolic), d=Number(e.diastolic);
      if(isNaN(s)||s<50||s>250||isNaN(d)||d<30||d>150) return {ok:false, msg:'bp_range'};
      return {ok:true};
    },
    getCategory(s,d){
      s=Number(s); d=Number(d);
      if(s>=180||d>=120) return 'crisis';
      if(s>=140||d>=90) return 'stage2';
      if(s>=130||d>=80) return 'stage1';
      if(s>=120&&d<80) return 'elevated';
      return 'normal';
    }
  };
  if(Registry) Registry.register('hypertension', def);
  return def;
});
