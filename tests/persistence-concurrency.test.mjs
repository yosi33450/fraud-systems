import './register-ts-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
process.env.STATE_ENCRYPTION_KEY='unit-test-encryption-key-at-least-32';
process.env.PERSISTENCE_BACKEND='supabase';
process.env.SUPABASE_URL='https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY='test-only';
const {hydrateOperationalState,persistOperationalState,encryptPrivateData,decryptPrivateData}=await import('../lib/persistence.server.ts');
const {exportOperationalState,restoreOperationalState}=await import('../lib/operational-store.ts');
test('CAS collision retries and keeps records written by another server',async()=>{
 const originalFetch=globalThis.fetch;
 let remote=encryptPrivateData(exportOperationalState()),patches=0;
 globalThis.fetch=async(url,options)=>{
  if(String(url).includes('recovery-global')) return Response.json([{iv:'backup',updated_at:new Date().toISOString()}]);
  if(options.method==='PATCH'){
   patches++;
   if(patches===1){const s=decryptPrivateData(remote);s.employees.push({id:'other-server',tenantId:'t',name:'Test'});remote=encryptPrivateData(s);return Response.json([]);}
   assert.equal(new URL(url).searchParams.get('iv'),`eq.${remote.iv}`);
   remote=JSON.parse(options.body);return Response.json([{id:'global'}]);
  }
  return Response.json([remote]);
 };
 try{
  await hydrateOperationalState({refresh:true,force:true});
  const local=exportOperationalState();local.orders.push({tenantId:'t',storeId:'s',shopifyOrderId:'order-1'});restoreOperationalState(local);
  await persistOperationalState();
  assert.equal(patches,2);
  assert.equal(decryptPrivateData(remote).employees[0].id,'other-server');
  assert.equal(decryptPrivateData(remote).orders[0].shopifyOrderId,'order-1');
 }finally{globalThis.fetch=originalFetch;}
});
