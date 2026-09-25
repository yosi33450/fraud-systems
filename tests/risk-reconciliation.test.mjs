import './register-ts-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const api=await import('../lib/operational-store.ts');
const empty=api.exportOperationalState();
function setup() {
  api.restoreOperationalState(empty);
  return api.connectShopifyStore({tenantId:'test',name:'Test only',domain:'test.myshopify.com',accessToken:'test',clientSecret:'test',expiresIn:10000});
}
function ingest(store,id,minutes,amount=100,extra={}) {
  return api.ingestShopifyOrder({storeId:store.id,webhookId:`test-${id}-${Math.random()}`,topic:'HISTORICAL_SYNC',payload:{id:String(id),name:`#${id}`,created_at:new Date(Date.parse('2026-09-25T12:00:00Z')+minutes*60000).toISOString(),email:'buyer@example.com',total_price:amount,...extra}});
}
test('replaying historical orders excludes future orders and does not duplicate cases',()=>{
  const store=setup();
  for(let n=0;n<4;n++) ingest(store,n,n*10);
  let snapshot=api.exportOperationalState();
  assert.equal(snapshot.cases.length,1);assert.equal(snapshot.cases[0].orderNumber,'#3');
  for(let n=3;n>=0;n--) ingest(store,n,n*10);
  snapshot=api.exportOperationalState();
  assert.equal(snapshot.orders.length,4);assert.equal(snapshot.cases.length,1);
  assert.equal(snapshot.cases[0].signals.ordersByEmailLastHour,4);
});
test('rule changes recompute saved history and clear stale scores, never delete orders',()=>{
  const store=setup();for(let n=0;n<4;n++)ingest(store,n,n*10);
  api.updateRule('test','recommended-email-velocity',{conditions:[{id:'v',field:'orders_by_email',operator:'gt',value:5,windowMinutes:60}]});
  const r=api.reevaluateOpenCases('test');
  assert.equal(r.resolved,1);assert.equal(r.active,0);
  assert.equal(r.cases[0].resolution.source,'automatic-rule-change');assert.equal(r.cases[0].score,0);
  assert.equal(api.exportOperationalState().orders.length,4);
});
test('manual resolved, false-positive and confirmed fraud are not reclassified by policy or replay',()=>{
  for(const status of ['resolved','false-positive','fraud']) {
    const store=setup();const created=ingest(store,1,0,2000).case;
    api.decideCase('test',created.id,status);
    const before=api.exportOperationalState().cases[0];
    api.repairVelocityPolicy('test');ingest(store,1,0,500);
    assert.deepEqual(api.exportOperationalState().cases[0],before);
  }
});
test('policy applies once, adds daily rules and does not overwrite later merchant edits',()=>{
  setup();const first=api.repairVelocityPolicy('test');assert.equal(first.alreadyApplied,false);
  const rules=new Map(api.exportOperationalState().rulesByTenant).get('test');
  for(const id of ['recommended-email-velocity','recommended-ip-velocity'])assert.deepEqual(rules.find(r=>r.id===id).conditions[0],{id:id.includes('email')?'email-velocity':'ip-velocity',field:id.includes('email')?'orders_by_email':'orders_by_ip',operator:'gt',value:3,windowMinutes:60});
  assert.equal(rules.filter(r=>r.id.includes('daily-velocity')).length,2);
  api.updateRule('test','recommended-order-spike',{conditions:[{id:'a',field:'order_amount',operator:'gt',value:2500}]});
  assert.equal(api.repairVelocityPolicy('test').alreadyApplied,true);
  assert.equal(new Map(api.exportOperationalState().rulesByTenant).get('test').find(r=>r.id==='recommended-order-spike').conditions[0].value,2500);
});
test('a stored stale signal cannot sustain a false alert',()=>{
  const store=setup();const c=ingest(store,1,0,2000).case;
  const state=api.exportOperationalState();state.cases[0].amount=200;state.cases[0].signals.orderAmount=200;
  state.cases[0].signals.ordersByEmailLastHour=70;state.orders[0].amount=200;
  api.restoreOperationalState(state);
  assert.equal(api.repairVelocityPolicy('test').active,0);
  assert.equal(api.exportOperationalState().cases.find(a=>a.id===c.id).signals.ordersByEmailLastHour,1);
});
test('a replay can reduce risk and remove stale evidence rather than retaining max score',()=>{
  const store=setup();ingest(store,1,0,20000);ingest(store,1,0,2000);
  const c=api.exportOperationalState().cases[0];
  assert.equal(c.severity,'medium');assert.equal(c.evidence.length,1);
  ingest(store,1,0,200);
  assert.equal(api.exportOperationalState().cases[0].resolution.source,'automatic-rule-change');
});
test('new daily policy detects previously unflagged stored purchases for factual Shopify replay',()=>{
  const store=setup();api.updateRule('test','recommended-email-daily-velocity',{enabled:false});
  for(let n=0;n<6;n++)ingest(store,n,n*120);
  assert.equal(api.exportOperationalState().cases.length,0);
  api.repairVelocityPolicy('test');
  assert.deepEqual(api.pendingVelocityPolicyOrders('test'),[{storeId:store.id,orderId:'5'}]);
  ingest(store,5,600);
  assert.equal(api.exportOperationalState().cases.length,1);
  assert.deepEqual(api.pendingVelocityPolicyOrders('test'),[]);
});
test('linked gift-card alert closes with its false source, but genuine purchase risk preserves the link',()=>{
  const store=setup();ingest(store,'buy',0,2000);
  const date='2026-09-25T12:00:00Z';
  const evidence={tenantId:'test',storeId:store.id,customer:'Test',createdAt:date,checkedAt:date,unidentifiedTransactions:0,complete:true};
  api.recordGiftCardOrderEvidence({...evidence,orderId:'buy',orderNumber:'#buy',email:'buyer@example.com',giftCardUnits:1,issued:[{giftCardId:'gid://shopify/GiftCard/1',eventId:'event',issuedAt:date,lastCharacters:'1234'}],uses:[]});
  api.recordGiftCardOrderEvidence({...evidence,orderId:'use',orderNumber:'#use',email:'recipient@example.com',giftCardUnits:0,issued:[],uses:[{giftCardId:'gid://shopify/GiftCard/1',transactionId:'txn',amount:100,currency:'ILS',processedAt:date,kind:'SALE',lastCharacters:'1234'}]});
  ingest(store,'use',10,100,{email:'recipient@example.com'});
  assert.equal(api.reevaluateOpenCases('test').active,2);
  assert.equal(api.exportOperationalState().cases.find(c=>c.orderNumber==='#use').signals.linkedGiftCard,true);
  api.updateRule('test','recommended-order-spike',{conditions:[{id:'amount',field:'order_amount',operator:'gt',value:3000}]});
  assert.equal(api.reevaluateOpenCases('test').active,0);
});
