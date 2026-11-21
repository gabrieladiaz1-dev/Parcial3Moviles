(function(root){
  'use strict';
  // Componentes de presentación compartidos por paciente y médico (paridad iOS: Design/ClinicalCardViews.swift).
  // Solo dibujan lo que entregan los presentadores HospitalCore.clinicalCards / prescriptionLine; no consultan datos ni deciden
  // permisos. Cada rol conserva sus acciones en su propio módulo.
  const zone='America/El_Salvador';
  const stamp=value=>{const d=new Date(value);return value&&Number.isFinite(d.getTime())?new Intl.DateTimeFormat('es-SV',{timeZone:zone,day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'}).format(d):null;};
  class HospitalClinicalCards {
    constructor(ui){this.ui=ui;}
    // Tarjeta de un medicamento con el estilo de «Mis recetas». Campos ausentes: «No registrado» (sin inventar valores).
    medicine(parent,m,{state=null,stateClass='is-unknown'}={}){
      const{el}=this.ui,card=el('article',null,'patient-rx-card');
      if(state)card.append(el('span',state,'patient-rx-state '+stateClass));
      const title=el('div',null,'patient-rx-title'),icon=el('span','◇');icon.setAttribute('aria-hidden','true');title.append(icon,el('h3',m.name));card.append(title);
      if(m.unstructured){card.append(el('p','Detalle registrado (formato anterior del servidor).','cc-note'));parent.append(card);return card;}
      const rows=[['Concentración',m.strength],['Dosis',m.dose],['Cada',m.frequency],['Vía',m.route],['Durante',m.duration],['Cantidad',m.quantity]];
      for(const[label,text]of rows){if(label==='Concentración'&&!m.strength)continue;const line=el('div',null,'patient-rx-line');line.append(el('strong',label+':'),el('span',text||'No registrado'));card.append(line);}
      const obs=el('div',null,'patient-rx-observations');obs.append(el('strong','Indicaciones:'),el('p',m.observations||'Sin indicaciones adicionales.'));card.append(obs);
      parent.append(card);return card;
    }
    // Receta resumida (identificador, fecha, médico, estado, nº de medicamentos) con «Ver receta» desplegable.
    prescription(parent,rx,{open,toggle}){
      const{el,button}=this.ui,view=root.HospitalCore.clinicalCards.prescription(rx);
      const card=el('article',null,'cc-card cc-rx');const head=el('header',null,'cc-head');const t=el('div',null,'cc-title');
      t.append(el('small','RECETA'),el('h4',view.code));head.append(el('span','℞','cc-icon'),t,el('span',view.status.label,'cc-badge is-'+view.status.tone));card.append(head);
      const facts=el('dl',null,'cc-facts');const fact=(k,v)=>{if(!v)return;const d=el('div');d.append(el('dt',k),el('dd',v));facts.append(d);};
      fact('Fecha',stamp(view.issuedAt));fact('Médico',view.doctor);fact('Medicamentos',view.count?String(view.count):'Sin medicamentos registrados');card.append(facts);
      const action=button(open?'Ocultar receta':'Ver receta',toggle,'module-action cc-toggle');action.setAttribute('aria-expanded',String(!!open));card.append(action);
      if(open){const box=el('div',null,'cc-detail');for(const m of view.medicines)this.medicine(box,m);if(!view.medicines.length)box.append(el('p','La receta no tiene medicamentos registrados.','cc-note'));card.append(box);}
      parent.append(card);return card;
    }
    // Orden de laboratorio con «Ver resultado»: parámetros reales o, si solo hay texto, la observación del laboratorio.
    labOrder(parent,order,{open,toggle,showPatient=true}){
      const{el,button}=this.ui,view=root.HospitalCore.clinicalCards.labOrder(order);
      const card=el('article',null,'cc-card cc-lab'+(view.published?' is-published':''));const head=el('header',null,'cc-head');const t=el('div',null,'cc-title');
      t.append(el('small','LABORATORIO'),el('h4',view.test));head.append(el('span',view.published?'✓':'⚗','cc-icon'),t,el('span',view.status.label,'cc-badge is-'+view.status.tone));card.append(head);
      const facts=el('dl',null,'cc-facts');const fact=(k,v)=>{if(!v)return;const d=el('div');d.append(el('dt',k),el('dd',v));facts.append(d);};
      if(showPatient)fact('Paciente',view.patient);fact('Solicitado',stamp(view.requestedAt));fact('Publicado',stamp(view.publishedAt));if(showPatient)fact('Expediente',view.record);card.append(facts);
      if(view.reason){const r=el('div',null,'cc-reason');r.append(el('strong','Motivo e indicaciones'),el('p',view.reason));card.append(r);}
      if(!view.published){card.append(el('p','El laboratorio está procesando la orden o aún no ha publicado un resultado validado.','cc-note'));parent.append(card);return card;}
      const action=button(open?'Ocultar resultado':'Ver resultado',toggle,'module-action cc-toggle');action.setAttribute('aria-expanded',String(!!open));card.append(action);
      if(open){
        const box=el('section',null,'cc-detail cc-result');box.setAttribute('aria-label','Resultado de '+view.test);
        if(view.parameters.length){box.append(el('h5','Parámetros analizados'));
          for(const p of view.parameters){const row=el('div',null,'cc-param');const name=el('div',null,'cc-param-name');name.append(el('strong',p.label));if(p.reference)name.append(el('small','Referencia: '+p.reference));
            const value=el('div',null,'cc-param-value');value.append(el('strong',p.value==null?'No informado':p.value),p.unit?el('small',p.unit):el('small',''));row.append(name,value);
            if(p.observation)row.append(el('p','Observación: '+p.observation,'cc-param-note'));box.append(row);}}
        if(view.observation){const o=el('div',null,'cc-observation');o.append(el('strong',view.parameters.length?'Comentario del laboratorio':'Observación del laboratorio'),el('p',view.observation));box.append(o);}
        if(!view.parameters.length&&!view.observation)box.append(el('p','El laboratorio publicó el resultado sin valores ni observaciones.','cc-note'));
        box.append(el('p','✓ Resultado validado y publicado por el laboratorio'+(stamp(view.completedAt)?' · completado el '+stamp(view.completedAt):'')+'.','cc-validation'));
        card.append(box);
      }
      parent.append(card);return card;
    }
  }
  root.HospitalClinicalCards=HospitalClinicalCards;
})(typeof window!=='undefined'?window:globalThis);
