(function(root){
  'use strict';
  // Solicitar ambulancia (paciente). Paridad con Patient/PatientAmbulanceView.swift + PatientAmbulanceModel.swift.
  // Reglas compartidas: HospitalCore.ambulance. Servidor: my_ambulance_context, submit_my_ambulance_request y
  // cancel_my_ambulance_request (supabase/ambulancia-paciente.sql). El paciente solo solicita y cancela antes del despacho;
  // asignar, despachar y cambiar el estado de la única ambulancia es exclusivo de administración.
  const rules=()=>root.HospitalCore.ambulance;
  const zone='America/El_Salvador';
  const stamp=value=>{const d=new Date(value);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('es-SV',{timeZone:zone,day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'}).format(d):'Sin registrar';};
  const clock=value=>new Intl.DateTimeFormat('es-SV',{timeZone:zone,hour:'numeric',minute:'2-digit'}).format(value);
  const blankDraft=()=>({phone:'',alternatePhone:'',pickup:'',reference:'',reason:'',situation:'',notes:'',latitude:null,longitude:null,accuracy:null});
  const newKey=()=>root.crypto.randomUUID();

  class HospitalPatientAmbulance {
    // Ejemplo LOCAL del modo diseño, identificado como tal; nunca se envía ni se muestra como dato real.
    static example(){const now=Date.now(),iso=offset=>new Date(now-offset).toISOString();return{person:{full_name:'Paciente de ejemplo',phone:'7000-0000'},unit_available:true,server_time:iso(0),
      requests:[{id:'5a000000-0000-4000-8000-000000000001',status:'despachada',requested_at:iso(25*60000),updated_at:iso(4*60000),assigned_at:iso(15*60000),departed_at:iso(4*60000),arrived_at:null,completed_at:null,
        contact_phone:'7000-0000',pickup_location:'Dirección de ejemplo, colonia de ejemplo',pickup_reference:'Referencia de ejemplo',reason:'Traslado de ejemplo',situation:null,pickup_notes:null,unit_code:'AMB-001',decision_reason:null},
        {id:'5a000000-0000-4000-8000-000000000002',status:'finalizada',requested_at:iso(9*86400000),updated_at:iso(9*86400000-3600000),assigned_at:iso(9*86400000-600000),departed_at:iso(9*86400000-900000),arrived_at:iso(9*86400000-1800000),completed_at:iso(9*86400000-3600000),
        contact_phone:'7000-0000',pickup_location:'Dirección anterior de ejemplo',reason:'Alta de ejemplo',unit_code:'AMB-001'}]};}
    constructor(ui){this.ui=ui;this.clear();}
    clear(){this.context=null;this.error=null;this.notice=null;this.confirmation=null;this.saving=false;this.draft=blankDraft();this.key=newKey();
      this.cancelDraft=null;this.locating=false;this.locationError=null;this.lastSync=null;this.phoneSeeded=false;}
    get active(){return rules().split(this.context?.requests).active;}
    get problem(){return rules().validate(this.draft);}
    // Solo se refresca solo con una solicitud activa y sin escritura en curso (no interrumpe al paciente mientras escribe).
    shouldPoll(){return !!this.active&&!this.saving&&this.cancelDraft===null;}
    describe(error){if(error?.status===404||error?.code==='PGRST202')return 'El servicio de ambulancia aún no está activado en el servidor del hospital (migración pendiente). Mientras tanto, comunícate directamente con el hospital.';if(error?.status===401)return 'La sesión no es válida. Inicia sesión de nuevo.';if(['22023','42501'].includes(error?.code)&&error.message)return error.message;
      if(!error?.status)return 'No se pudo conectar con el hospital. Revisa tu conexión.';return 'No se pudo completar la operación. Inténtalo de nuevo.';}
    async load(api,{design=false}={}){
      if(design){this.context=HospitalPatientAmbulance.example();this.lastSync=new Date();this.error=null;return;}
      try{const value=await api.ambulanceRPC('my_ambulance_context');if(!value||!Array.isArray(value.requests))throw new Error('Respuesta inválida');
        this.context=value;this.lastSync=new Date();this.error=null;
        if(!this.phoneSeeded&&!this.draft.phone&&value.person?.phone){this.draft.phone=value.person.phone;}this.phoneSeeded=true;}
      // Sin conexión se conserva el último estado conocido, marcado como no actualizado; al reconectar se vuelve a leer del servidor.
      catch(error){this.error=this.context?'No se pudo actualizar. Se muestra el último estado recibido a las '+(this.lastSync?clock(this.lastSync):'—')+'.':this.describe(error);}
    }
    async submit(api,{design=false}={}){
      if(this.saving||this.problem||this.active)return;
      if(design){this.confirmation='Modo diseño · No se envió ninguna solicitud real.';this.draft={...blankDraft(),phone:this.draft.phone};return;}
      this.saving=true;this.notice=null;this.confirmation=null;
      try{await api.ambulanceRPC('submit_my_ambulance_request',rules().submission(this.draft,this.key));
        this.key=newKey();this.draft={...blankDraft(),phone:this.draft.phone};this.locationError=null;
        this.confirmation='Solicitud enviada al hospital. Queda pendiente de revisión: todavía no hay una ambulancia asignada.';}
      // Una respuesta perdida puede ocultar un envío confirmado: se conserva la clave (el servidor devuelve la misma solicitud).
      catch(error){this.notice=this.describe(error)+(error?.status?'':' Puedes reintentar: se conserva el identificador para evitar duplicados.');}
      finally{this.saving=false;}
      await this.load(api);
    }
    async cancel(api,{design=false}={}){
      const active=this.active,problem=rules().cancelProblem(this.cancelDraft);if(!active||problem||this.saving)return;
      if(design){this.cancelDraft=null;this.confirmation='Modo diseño · No se canceló ninguna solicitud real.';return;}
      this.saving=true;this.notice=null;
      try{await api.ambulanceRPC('cancel_my_ambulance_request',{p_request:active.id,p_reason:this.cancelDraft.trim()});this.cancelDraft=null;this.confirmation='Solicitud cancelada. El hospital ya ve la cancelación.';}
      catch(error){this.notice=this.describe(error);}
      finally{this.saving=false;}
      await this.load(api);
    }
    // Ubicación: solo cuando el paciente pulsa el botón; si la deniega puede seguir escribiendo la dirección.
    locate(done){
      const geo=root.navigator?.geolocation;if(!geo){this.locationError=rules().locationFailed;done();return;}
      this.locating=true;this.locationError=null;done();
      geo.getCurrentPosition(position=>{const c=position.coords;this.draft.latitude=c.latitude;this.draft.longitude=c.longitude;this.draft.accuracy=Number.isFinite(c.accuracy)?c.accuracy:null;this.locating=false;done();},
        error=>{this.locating=false;this.locationError=error?.code===1?rules().locationDenied:rules().locationFailed;done();},
        {enableHighAccuracy:true,timeout:15000,maximumAge:60000});
    }

    render(parent,{design=false,busy=false,live=false,actions}){
      const{el,button}=this.ui,A=rules(),active=this.active;
      const hero=el('section',null,'req-hero amb-hero');const top=el('div',null,'req-hero-top');top.append(el('small','AMBULANCIA DEL HOSPITAL'),el('span','🚑','amb-hero-icon'));
      hero.append(top,el('h2','Solicitar ambulancia'),el('p','Solicita asistencia de transporte médico y consulta el estado de tu solicitud.'));parent.append(hero);
      const warning=el('div',null,'req-notice amb-warning');warning.setAttribute('role','note');warning.append(el('span','!','req-notice-icon'));
      const warningText=el('div');warningText.append(el('p',A.warning));
      if(A.emergencyPhone){const call=el('a','Llamar a emergencias · '+A.emergencyPhone,'amb-call');call.href='tel:'+A.emergencyPhone.replace(/[^0-9+]/g,'');warningText.append(call);}
      warning.append(warningText);parent.append(warning);
      if(design)parent.append(el('p','Datos de ejemplo · No corresponden a una solicitud real','patient-history-notice'));
      if(this.confirmation){const ok=el('p',this.confirmation,'amb-confirmation');ok.setAttribute('role','status');parent.append(ok);}
      if(this.notice){const bad=el('p',this.notice,'amb-error');bad.setAttribute('role','alert');parent.append(bad);}
      if(this.error){const bad=el('p',this.error,'amb-error');bad.setAttribute('role','alert');parent.append(bad);}
      if(!this.context){
        const card=el('article',null,'sched-card');card.append(el('strong',busy?'Cargando tu información…':'No pudimos cargar la información de ambulancia.'));
        if(!busy)card.append(button('Reintentar',actions.refresh,'module-action'));parent.append(card);return;
      }
      if(active)this.tracking(parent,active,{busy,live,actions});else this.form(parent,{busy,actions});
      const previous=A.split(this.context.requests).previous;
      if(previous.length){
        parent.append(el('h3','Solicitudes anteriores','amb-section-title'));
        for(const row of previous.slice(0,5)){const s=A.stage(row),item=el('article',null,'amb-previous');
          const head=el('div',null,'amb-previous-head');head.append(el('strong',A.code(row.id)),el('span',s.label,'amb-badge is-'+s.key));
          item.append(head,el('p',stamp(row.requested_at)),el('p',row.pickup_location||'','amb-previous-place'));if(row.decision_reason)item.append(el('p','Motivo: '+row.decision_reason,'amb-previous-place'));parent.append(item);}
      }
    }
    tracking(parent,row,{busy,live,actions}){
      const{el,button}=this.ui,A=rules(),s=A.stage(row);
      const card=el('section',null,'sched-card amb-track');card.setAttribute('aria-live','polite');
      const head=el('header',null,'amb-track-head');const id=el('div');id.append(el('small','Solicitud '+A.code(row.id)),el('h2',s.title));head.append(id,el('span',s.label,'amb-badge is-'+s.key));
      card.append(head,el('p',s.message,'amb-track-message'));
      const steps=el('ol',null,'amb-steps');
      for(const step of A.timeline(row)){const li=el('li',null,step.at?'is-done':'is-pending');li.append(el('span',null,'amb-dot'));const t=el('div');t.append(el('strong',step.label),el('small',step.at?stamp(step.at):'Pendiente'));li.append(t);steps.append(li);}
      card.append(steps);
      const facts=el('dl',null,'amb-facts');const fact=(label,value)=>{if(!value)return;const d=el('div');d.append(el('dt',label),el('dd',value));facts.append(d);};
      fact('Enviada',stamp(row.requested_at));fact('Dirección de recogida',row.pickup_location);fact('Punto de referencia',row.pickup_reference);
      if(row.pickup_latitude!=null&&row.pickup_longitude!=null)fact('Ubicación compartida',Number(row.pickup_latitude).toFixed(5)+', '+Number(row.pickup_longitude).toFixed(5)+(row.pickup_accuracy_m!=null?' · ±'+Math.round(row.pickup_accuracy_m)+' m':''));
      fact('Motivo',row.reason);fact('Teléfono de contacto',[row.contact_phone,row.alternate_phone].filter(Boolean).join(' · '));fact('Unidad',row.unit_code);fact('Destino confirmado',row.destination);
      fact('Última actualización',stamp(row.updated_at||row.requested_at));card.append(facts);
      card.append(el('p',live?'Esta pantalla se actualiza automáticamente cuando el hospital cambia el estado.':'Se actualiza cada 30 segundos mientras esta pantalla está abierta'+(this.lastSync?' · Última consulta: '+clock(this.lastSync):'.'),'amb-sync'));
      const buttons=el('div',null,'amb-actions');buttons.append(button('Actualizar estado',actions.refresh,'module-action'));
      if(s.cancellable&&this.cancelDraft===null)buttons.append(button('Cancelar solicitud',()=>{this.cancelDraft='';actions.repaint();},'text-button amb-cancel'));
      card.append(buttons);
      if(row.status==='despachada')card.append(el('p','La ambulancia ya fue asignada. Para cancelar, comunícate con el hospital: el personal autorizado gestionará la cancelación.','amb-sync'));
      if(this.cancelDraft!==null){
        const form=el('form',null,'amb-cancel-form');form.noValidate=true;const label=el('label',null,'module-field');label.append(el('span','Motivo de la cancelación'));
        const area=el('textarea');area.value=this.cancelDraft;area.maxLength=500;area.rows=3;area.setAttribute('aria-label','Motivo de la cancelación');label.append(area);form.append(label);
        const hint=el('p',null,'amb-hint');const confirm=el('button',this.saving?'Cancelando…':'Confirmar cancelación','primary');confirm.type='submit';
        const refresh=()=>{const p=A.cancelProblem(this.cancelDraft);hint.textContent=this.cancelDraft&&p?p:'';hint.hidden=!(this.cancelDraft&&p);confirm.disabled=busy||this.saving||!!p;};
        area.addEventListener('input',()=>{this.cancelDraft=area.value;refresh();});
        const back=button('Volver',()=>{this.cancelDraft=null;actions.repaint();},'text-button');back.type='button';
        form.append(hint,confirm,back);refresh();form.addEventListener('submit',event=>{event.preventDefault();actions.cancel();});card.append(form);
      }
      parent.append(card);
    }
    form(parent,{busy,actions}){
      const{el,button}=this.ui,A=rules(),d=this.draft,disabled=busy||this.saving;
      if(this.context.unit_available===false)parent.append(el('p',A.unitBusyNote,'amb-unit-note'));
      const form=el('form',null,'amb-form');form.noValidate=true;
      const section=(n,title,note)=>{const card=el('section',null,'sched-card');const head=el('header',null,'req-step-head');head.append(el('span',String(n),'req-step-number'));const t=el('div');t.append(el('h2',title),el('p',note));head.append(t);card.append(head);form.append(card);return card;};
      const field=(parent,key,label,{type='text',area=false,max,auto,mode,placeholder}={})=>{
        const wrap=el('label',null,'module-field');wrap.append(el('span',label));const input=el(area?'textarea':'input');if(!area)input.type=type;else input.rows=3;
        input.value=d[key]||'';if(max)input.maxLength=max;if(auto)input.autocomplete=auto;if(mode)input.inputMode=mode;if(placeholder)input.placeholder=placeholder;input.disabled=disabled;input.setAttribute('aria-label',label);
        input.addEventListener('input',()=>{d[key]=input.value;this.confirmation=null;validity();});wrap.append(input);parent.append(wrap);return input;};
      const person=section(1,'Paciente','Tus datos se toman de tu cuenta.');
      const name=el('div',null,'amb-identity');name.append(el('small','Nombre del paciente'),el('strong',this.context.person?.full_name||'Completa tu nombre en Perfil'));person.append(name);
      field(person,'phone','Teléfono de contacto',{type:'tel',max:30,auto:'tel',mode:'tel',placeholder:'0000-0000'});
      field(person,'alternatePhone','Teléfono alternativo (opcional)',{type:'tel',max:30,mode:'tel'});
      const place=section(2,'Ubicación de recogida','Escribe la dirección; compartir tu ubicación es opcional.');
      field(place,'pickup','Dirección',{area:true,max:1000,auto:'street-address',placeholder:'Calle, número, colonia, municipio'});
      field(place,'reference','Punto de referencia (opcional)',{max:500,placeholder:'Ej.: frente al parque, portón negro'});
      const location=el('div',null,'amb-location');
      if(d.latitude!=null){location.append(el('p','Ubicación compartida: '+Number(d.latitude).toFixed(5)+', '+Number(d.longitude).toFixed(5)+(d.accuracy!=null?' · ±'+Math.round(d.accuracy)+' m':''),'amb-location-ok'));
        location.append(button('Quitar ubicación',()=>{d.latitude=d.longitude=d.accuracy=null;actions.repaint();},'text-button'));}
      else location.append(button(this.locating?'Obteniendo ubicación…':'Usar mi ubicación actual',()=>this.locate(actions.repaint),'module-action amb-locate'));
      if(this.locationError)location.append(el('p',this.locationError,'amb-hint'));place.append(location);
      const info=section(3,'Información de la solicitud','Describe brevemente lo necesario para la recogida.');
      field(info,'reason','Motivo de la solicitud',{max:500,placeholder:'Ej.: traslado al hospital'});
      field(info,'situation','Descripción breve de la situación (opcional)',{area:true,max:2000});
      field(info,'notes','Información adicional para la recogida (opcional)',{area:true,max:1000,placeholder:'Ej.: segundo piso, sin ascensor'});
      const hint=el('p',null,'amb-hint');hint.setAttribute('aria-live','polite');
      const submit=el('button',this.saving?'Enviando solicitud…':'Solicitar ambulancia','primary amb-submit');submit.type='submit';
      const validity=()=>{const p=this.problem,touched=Object.entries(d).some(([k,v])=>k!=='phone'&&v);hint.textContent=p&&touched?p.message:'';hint.hidden=!(p&&touched);submit.disabled=disabled||!!p;};
      form.append(hint,submit,el('p','Enviar la solicitud no asigna la ambulancia: el hospital la revisa y te informa cada cambio de estado.','amb-sync'));
      form.addEventListener('submit',event=>{event.preventDefault();if(!this.problem)actions.submit();});validity();parent.append(form);
    }
  }
  root.HospitalPatientAmbulance=HospitalPatientAmbulance;
})(typeof window!=='undefined'?window:globalThis);
