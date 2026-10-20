// Owner-authenticated maintenance; never print credentials or customer data.
import {mkdir,writeFile} from 'node:fs/promises';
process.loadEnvFile('.env.local');
const base='https://fraud-systems.vercel.app';
const login=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:process.env.DASHBOARD_PASSWORD}),signal:AbortSignal.timeout(25000)});
if(!login.ok)throw Error(`LOGIN_${login.status}`);
const cookie=login.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
async function request(path,body){
 const start=Date.now();
 const response=await fetch(base+path,{method:body?'POST':'GET',headers:{Cookie:cookie,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(body?.action==='initialize-partitions'?240000:90000)});
 if(!response.ok)throw Error(`REQUEST_${response.status}:${path}`);
 const data=await response.json();
 console.log(JSON.stringify({path,status:response.status,durationMs:Date.now()-start}));
 return data;
}
if(process.argv.includes('--backup')){
 const result=await request('/api/admin/recovery?activeOnly=1');
 await mkdir('.data/recovery',{recursive:true});
 for(const source of result.sources){
  const file=`.data/recovery/cutover-${source.source}-${Date.now()}.enc.json`;
  await writeFile(file,JSON.stringify(source.payload),{mode:0o600});
  console.log(JSON.stringify({saved:file,source:source.source,orders:source.summary.orders,cases:source.summary.cases,employees:source.summary.employees?.length,decryptable:source.summary.decryptable!==false}));
 }
}else if(process.argv.includes('--migrate')){
 console.log(JSON.stringify(await request('/api/admin/recovery',{action:'initialize-partitions'})));
}else{
 console.log(JSON.stringify(await request('/api/diagnostics/persistence')));
 const data=await request('/api/tenants/tenant-primary/snapshot');
 console.log(JSON.stringify({stores:data.stores?.length,cases:data.cases?.length,employees:data.employees?.length,chargebacks:data.chargebacks?.length,storeStatus:data.stores?.map(s=>({id:s.id,lastOrderAt:s.lastOrderAt,lastSyncAt:s.lastSyncAt}))}));
}
