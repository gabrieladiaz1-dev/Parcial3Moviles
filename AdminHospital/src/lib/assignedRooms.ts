import type { PlanningData } from './planning'
import { journeyOverlaps } from './recurringJourney.ts'
import { clock, hospitalDate, weekday } from './planningDates.ts'
export function assignedRooms(data: PlanningData, today: string, now: number) {
  return data.rooms.map(room=>{
    const doctors=new Map<string,{id:string;name:string;hours:Map<string,Set<number>>}>()
    const add=(id:string,start:string,end:string,days:number[])=>{
      const staff=data.staff.find(p=>p.id===id)
      if(!staff||staff.category!=='doctor')return
      let doctor=doctors.get(id)
      if(!doctor){doctor={id,name:`${staff.first_name??''} ${staff.last_name??''}`.trim()||staff.employee_code,hours:new Map()};doctors.set(id,doctor)}
      const key=`${start.slice(0,5)}|${end.slice(0,5)}`
      const chosen=doctor.hours.get(key)??new Set<number>();days.forEach(d=>chosen.add(d));doctor.hours.set(key,chosen)
    }
    const rules=(data.recurring_journeys??[]).filter(j=>j.consulting_room_id===room.id&&journeyOverlaps(j,today,null))
    // A split weekly schedule displays the doctor once. Superseded configurations
    // are used only while they are still effective, never alongside their replacement.
    for(const staffId of new Set(rules.map(j=>j.staff_id))){
      for(let day=0;day<7;day++){
        const candidates=rules.filter(j=>j.staff_id===staffId&&j.weekdays.includes(day))
        const current=candidates.filter(j=>j.valid_from<=today).sort((a,b)=>b.valid_from.localeCompare(a.valid_from))[0]
        const chosen=current??candidates.sort((a,b)=>a.valid_from.localeCompare(b.valid_from))[0]
        if(chosen)add(staffId,chosen.start_time,chosen.end_time,[day])
      }
    }
    for(const c of data.saved_consultations??data.consultations){
      if(!c.recurring_id&&c.active&&c.consulting_room_id===room.id&&Date.parse(c.ends_at)>now&&!rules.some(j=>j.staff_id===c.doctor_id))add(c.doctor_id,clock(c.starts_at),clock(c.ends_at),[weekday(hospitalDate(c.starts_at))])
    }
    return {id:room.id,code:room.code,active:room.active,floor:data.floors.find(f=>f.id===room.floor_id)?.name??'Piso sin asignar',doctors:[...doctors.values()].map(d=>({...d,hours:[...d.hours].map(([range,days])=>({start:range.split('|')[0],end:range.split('|')[1],days:[1,2,3,4,5,6,0].filter(day=>days.has(day))}))}))}
  })
}
