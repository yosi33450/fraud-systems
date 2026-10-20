import './register-ts-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const {partitionState,assembleState,stateFingerprint,PARTITION_MARKER}=await import('../lib/state-partitions.ts');
const {PartitionedPersistence}=await import('../lib/partitioned-persistence.ts');
const {exportOperationalState}=await import('../lib/operational-store.ts');

function fixture() {
  const state=exportOperationalState();
  state.orders=Array.from({length:13000},(_,i)=>({tenantId:'t',storeId:'s',shopifyOrderId:String(i),createdAt:'2026-10-19T08:00:00Z',total:i,customerEmail:`test-${i}@example.invalid`}));
  return state;
}
function harness(state) {
  let revision=0,collide, fail=false, readRows=0, writtenBytes=0;
  const encrypt=value=>({ciphertext:JSON.stringify(value),iv:String(++revision),auth_tag:'test'});
  const decrypt=row=>JSON.parse(row.ciphertext);
  const rows=new Map([...partitionState(state)].map(([id,value])=>[id,{id,...encrypt(value)}]));
  rows.set(PARTITION_MARKER,{id:PARTITION_MARKER,...encrypt({version:2})});
  const transport={encrypt,decrypt,async rpc(name,args){
    if(fail)throw Error('SIMULATED_OUTAGE');
    if(name==='shopshield_read_parts'){
      const result=[...rows.values()].filter(row=>args.known[row.id]!==row.iv);readRows+=result.length;return structuredClone(result);
    }
    if(name==='shopshield_read_dirty_parts')return structuredClone(args.ids.map(id=>rows.get(id)));
    if(name==='shopshield_commit_parts'){
      if(collide){const fn=collide;collide=undefined;fn(rows,encrypt);}
      if(args.changes.some(c=>rows.get(c.id).iv!==c.expected_iv))return false;
      // Validation is complete before any write.
      for(const {expected_iv,...row} of args.changes){rows.set(row.id,row);writtenBytes+=JSON.stringify(row).length;}
      return true;
    }
    throw Error('UNEXPECTED_RPC');
  }};
  return {store:new PartitionedPersistence(transport),rows,transport,
    get readRows(){return readRows;},get writtenBytes(){return writtenBytes;},
    set collision(fn){collide=fn;},set fail(value){fail=value;}};
}
test('partition migration retains every record and field, including optional old fields',()=>{
  const input=fixture();
  input.employees=[{id:'employee',name:'Test',secondaryAddress:'secondary'}];
  input.futureField={untouched:true};
  delete input.giftCards;
  const output=assembleState(partitionState(input));
  assert.equal(stateFingerprint(output),stateFingerprint(input));
  assert.equal(output.orders.length,13000);
  assert.deepEqual(output.employees,input.employees);
  assert.deepEqual(output.futureField,input.futureField);
  const incomplete=partitionState(input);incomplete.delete('op2-orders-050');
  assert.throws(()=>assembleState(incomplete),/PARTITION_MISSING/);
});
test('one order update writes a small bucket, not all 13000 orders; repeated reads return no unchanged payload',async()=>{
  const input=fixture(),h=harness(input);
  const base=await h.store.load(), local=structuredClone(base);
  const readCount=h.readRows;
  await h.store.load();assert.equal(h.readRows,readCount);
  local.orders.find(o=>o.shopifyOrderId==='100').total=999;
  await h.store.save(base,local);
  assert.ok(h.writtenBytes<50000,`wrote ${h.writtenBytes} bytes`);
  assert.equal((await h.store.load()).orders.find(o=>o.shopifyOrderId==='100').total,999);
  const writes=h.writtenBytes;
  await h.store.save(local,local);assert.equal(h.writtenBytes,writes);
});
test('concurrent independent records survive a revision collision; outage does not poison the queue',async()=>{
  const input=fixture(),h=harness(input);
  const base=await h.store.load(),local=structuredClone(base);
  local.employees.push({id:'local',name:'Local'});
  h.collision=(rows,encrypt)=>{
    const row=rows.get('op2-field-employees');
    rows.set(row.id,{id:row.id,...encrypt([...JSON.parse(row.ciphertext),{id:'remote',name:'Remote'}])});
  };
  await h.store.save(base,local);
  assert.deepEqual((await h.store.load()).employees.map(e=>e.id).sort(),['local','remote']);
  h.fail=true;await assert.rejects(h.store.load(),/SIMULATED_OUTAGE/);
  h.fail=false;assert.equal((await h.store.load()).orders.length,13000);
});
test('conflicting manual edits do not silently overwrite each other',async()=>{
  const input=fixture();input.employees=[{id:'e',name:'Original'}];
  const h=harness(input),base=await h.store.load(),local=structuredClone(base);
  local.employees[0].name='Local edit';
  h.rows.set('op2-field-employees',{id:'op2-field-employees',...h.transport.encrypt([{id:'e',name:'Remote edit'}])});
  await assert.rejects(h.store.save(base,local),/PERSISTENCE_CONCURRENT_EDIT/);
  assert.equal((await h.store.load()).employees[0].name,'Remote edit');
});
