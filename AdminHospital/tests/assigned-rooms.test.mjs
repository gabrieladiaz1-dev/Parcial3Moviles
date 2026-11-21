import test from 'node:test'
import assert from 'node:assert/strict'
import {assignedRooms} from '../src/lib/assignedRooms.ts'
test('consultorios: incluye disponibles e inactivos, doctor único y horarios vigentes sin historial repetido',()=>{
 const rule={staff_id:'doctor',consulting_room_id:'room',weekdays:[1,2,3,4,5],start_time:'08:00:00',end_time:'16:00:00',valid_from:'2026-01-01',valid_until:null,closed_on:null,active:true}
 const data={rooms:[{id:'room',code:'CONS-01',active:true,floor_id:2},{id:'empty',code:'CONS-02',active:true},{id:'inactive',code:'CONS-03',active:false}],floors:[{id:2,name:'Segunda planta'}],staff:[{id:'doctor',category:'doctor',first_name:'Doctor',last_name:'Prueba'}],consultations:[],recurring_journeys:[{...rule,id:'old',closed_on:'2026-11-01',active:false},{...rule,id:'week',valid_from:'2026-11-01'},{...rule,id:'sat',weekdays:[6],end_time:'12:00:00',valid_from:'2026-11-01'}]}
 const rooms=assignedRooms(data,'2026-11-19',Date.parse('2026-11-19T12:00:00-06:00'))
 assert.equal(rooms.length,3);assert.equal(rooms[0].floor,'Segunda planta');assert.equal(rooms[0].doctors.length,1)
 assert.equal(rooms[1].doctors.length,0);assert.equal(rooms[1].active,true);assert.equal(rooms[2].active,false)
 assert.equal(rooms[0].doctors[0].name,'Doctor Prueba');assert.equal(rooms[0].doctors[0].hours.length,2)
 assert.deepEqual(rooms[0].doctors[0].hours.find(h=>h.end==='12:00').days,[6])
})
