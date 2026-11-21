import { Icon } from './Icon'
import { displayTime } from '../lib/reception'
export function HospitalDate({value}:{value:string}){
  return <span className="hospital-date-display"><Icon name="calendar" size={14}/><time dateTime={value}>{displayTime(value)}</time></span>
}
export function HospitalFilterPills({label,value,options,onChange,wide=false}:{label:string;value:string;options:[string,string][];onChange:(value:string)=>void;wide?:boolean}){
  return <div className={`hospital-filter-pills ${wide?'hospital-filter-wide':''}`}><span>{label}</span><div role="group" aria-label={label} data-options={options.length}>{options.map(([key,name])=><button type="button" key={key} className={`hospital-filter-pill tone-${key||'all'}`} aria-pressed={value===key} onClick={()=>onChange(key)}><i aria-hidden="true"/>{name}</button>)}</div></div>
}
