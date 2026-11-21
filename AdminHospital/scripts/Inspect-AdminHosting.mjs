// Read-only public deployment metadata. Does not read local Git/OAuth credentials.
const repos=['gabrieladiaz1-dev/AdminHospital','centDV/Hospital-IOS-Frontend']
for(const repo of repos) {
 const endpoints=['','/actions/workflows','/pages','/deployments?per_page=3']
 const results=await Promise.all(endpoints.map(async suffix=>{
  const response=await fetch(`https://api.github.com/repos/${repo}${suffix}`,{headers:{Accept:'application/vnd.github+json','User-Agent':'Hospital-Admin-Hosting-Check'},signal:AbortSignal.timeout(20000)})
  const data=await response.json()
  if(!response.ok)return {endpoint:suffix||'repository',status:response.status}
  if(!suffix)return {endpoint:'repository',status:200,homepage:data.homepage,defaultBranch:data.default_branch,private:data.private}
  if(suffix==='/actions/workflows')return {endpoint:suffix,workflows:data.workflows?.map(w=>({name:w.name,path:w.path,state:w.state}))}
  if(suffix==='/pages')return {endpoint:suffix,url:data.html_url,buildType:data.build_type}
  const deployments=[]
  for(const d of data) {
   const r=await fetch(d.statuses_url,{headers:{Accept:'application/vnd.github+json','User-Agent':'Hospital-Admin-Hosting-Check'},signal:AbortSignal.timeout(20000)})
   const statuses=await r.json()
   deployments.push({environment:d.environment,creator:d.creator?.login,statuses:Array.isArray(statuses)?statuses.slice(0,2).map(s=>({state:s.state,url:s.environment_url,target:s.target_url})):[]})
  }
  return {endpoint:suffix,deployments}
 }))
 console.log(JSON.stringify({repo,results}))
}
