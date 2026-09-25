import './register-ts-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const { computeVelocitySignals, createVelocityLookup } = await import('../lib/order-velocity.ts');
const { evaluateRisk } = await import('../lib/risk-engine.ts');
const end = Date.parse('2026-09-25T12:00:00Z');
const order = (id, minutesAgo = 0, extra = {}) => ({ tenantId:'t', storeId:'s', shopifyOrderId:String(id), createdAt:new Date(end-minutesAgo*60000).toISOString(), email:'buyer@example.com', ip:'192.0.2.1', phone:'0500000000', amount:200, giftCardValue:0, ...extra });
const condition = (field='orders_by_email', value=3, windowMinutes=60) => ({ id:'c', field, operator:'gt', value, windowMinutes });
const rule = (c) => ({ id:'r',label:'Rule',description:'',category:'velocity',enabled:true,logic:'all',conditions:[c],action:{severity:'high',openCase:true,emailOwner:true},matches:0 });
const signals = (velocity, amount=200) => ({ ...velocity, orderAmount:amount, averageOrderValue:200, giftCardValue:0,giftCardBaseline:0,linkedGiftCard:false,paymentFailures:0,billingShippingMismatch:false,shopifyRisk:'none',employeeMatch:false,refundAfterFulfillment:false,blacklist:{email:false,phone:false,address:false,ip:false,customer:false} });
const check = (history, c=condition(), current=history.at(-1)) => evaluateRisk(signals(computeVelocitySignals(current,history,[c])),new Date(end),[rule(c)]);

test('hour threshold: exactly three purchases is allowed, fourth triggers',()=>{
  const rows=[order(1,30),order(2,20),order(3,10)];
  assert.equal(check(rows).score,0);
  assert.equal(check([...rows,order(4)]).severity,'high');
});
test('daily threshold: five is allowed, sixth triggers independently of hour count',()=>{
  const rows=[800,600,400,200,100,0].map((m,i)=>order(i,m));
  assert.equal(check(rows.slice(0,5),condition('orders_by_email',5,1440)).score,0);
  assert.equal(check(rows,condition('orders_by_email',5,1440)).severity,'high');
  assert.equal(check(rows).score,0);
});
test('seven purchases spread across a month never trigger velocity',()=>{
  const rows=[28,20,14,10,7,3,0].map((d,i)=>order(i,d*1440));
  for(const current of rows) {
    assert.equal(check(rows,condition(),current).score,0);
    assert.equal(check(rows,condition('orders_by_email',5,1440),current).score,0);
  }
});
test('future orders are excluded during replay; lower boundary is exclusive',()=>{
  const current=order('now');
  const result=computeVelocitySignals(current,[order('hour',60),order('inside',59.99),order('future',-1),order('day',1440),current],[condition(),condition('orders_by_email',5,1440)]);
  assert.equal(result.ordersByEmailLastHour,2);
  assert.equal(result.conditionValues['orders_by_email:1440'],3);
});
test('current order and updates count once, regardless of input ordering',()=>{
  const current=order('current');
  const history=[order('old',10),order('old',10),current,current,order('next',-10)];
  assert.equal(computeVelocitySignals(current,history,[]).ordersByEmailLastHour,2);
  assert.deepEqual(computeVelocitySignals(current,history,[]),computeVelocitySignals(current,history.toReversed(),[]));
});
test('tenant and store boundaries isolate email and IP counts',()=>{
  const current=order(1);
  const rows=[current,order(2,1,{tenantId:'other'}),order(3,1,{storeId:'other'})];
  const v=computeVelocitySignals(current,rows,[]);
  assert.equal(v.ordersByEmailLastHour,1);assert.equal(v.ordersByIpLastTwoHours,1);
});
test('zero purchases, missing identity and shared PayPlus email cannot form a velocity cluster',()=>{
  const current=order(1);
  const v=computeVelocitySignals(current,[order(2,1,{amount:0}),order(3,1,{amount:-20})],[]);
  assert.equal(v.ordersByEmailLastHour,1);
  assert.equal(computeVelocitySignals(order(4,0,{amount:0}),[current],[]).ordersByEmailLastHour,0);
  assert.equal(computeVelocitySignals(order(5,0,{email:'general-customer@payplus.co.il',ip:''}),[],[]).ordersByEmailLastHour,0);
  assert.equal(computeVelocitySignals(order(6,0,{email:'',ip:''}),[],[]).ordersByIpLastTwoHours,0);
});
test('IP detects changed emails and phone distinct identities are not overcounted',()=>{
  const rows=[order(1,30),order(2,20,{email:'two@example.com'}),order(3,10,{email:'two@example.com'}),order(4,0,{email:'three@example.com'})];
  assert.equal(check(rows,condition('orders_by_ip',3,60)).severity,'high');
  const v=computeVelocitySignals(rows.at(-1),rows,[]);
  assert.equal(v.emailsByIpLastTwoHours,3);assert.equal(v.identitiesByPhoneLastDay,3);
});
test('custom 15-minute windows do not reuse stale hourly counts',()=>{
  const rows=[order(1,40),order(2,30),order(3,20),order(4)];
  assert.equal(check(rows).severity,'high');
  assert.equal(check(rows,condition('orders_by_email',3,15)).score,0);
});
test('strict amount threshold is per order: 1500 allowed, 1500.01 triggers',()=>{
  const r=rule({id:'amount',field:'order_amount',operator:'gt',value:1500});
  const v=computeVelocitySignals(order(1),[],[]);
  assert.equal(evaluateRisk(signals(v,1500),new Date(end),[r]).score,0);
  assert.equal(evaluateRisk(signals(v,1500.01),new Date(end),[r]).severity,'high');
  assert.equal(evaluateRisk(signals(v,500),new Date(end),[r]).score,0);
});
test('evidence reports actual matching count and its time window',()=>{
  const result=check([order(1,30),order(2,20),order(3,10),order(4)]);
  assert.match(result.evidence[0].description,/נמצאו 4/);
  assert.match(result.evidence[0].description,/60/);
  assert.match(result.evidence[0].description,/יותר מ־3/);
});
test('invalid timestamp never fabricates velocity',()=>{
  assert.equal(computeVelocitySignals(order(1,0,{createdAt:'invalid'}),[order(2)],[]).ordersByEmailLastHour,0);
});
test('batch lookup matches full history for every order and custom window',()=>{
  const rows=Array.from({length:70},(_,i)=>order(i,(i-10)*63,{storeId:i%4===0?'other':'s'}));
  const conditions=[condition(),condition('orders_by_email',5,1440),condition('orders_by_ip',3,3000)];
  const lookup=createVelocityLookup(rows,conditions);
  for(const row of rows)assert.deepEqual(lookup(row),computeVelocitySignals(row,rows,conditions));
});
