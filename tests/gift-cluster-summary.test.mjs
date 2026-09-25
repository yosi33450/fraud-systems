import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeGiftCluster } from '../lib/gift-cluster-summary.ts';

const alert = (id, storeId='s') => ({id,storeId,context:{shopifyOrderId:id},items:[]});
const order = (id, extra={}) => ({orderId:id,storeId:'s',giftCardUnits:0,uses:[],...extra});
const use = (transactionId, amount, kind='SALE', currency='ILS') => ({transactionId,amount,kind,currency});
test('purchase and redemption are separate, unrelated merchandise never counted as cards', () => {
 const cases=[alert('buy'),alert('use'),alert('merch')];
 const ledger={orders:[order('buy',{giftCardUnits:2,purchaseAmounts:[{amount:800,currency:'ILS'}]}),order('use',{uses:[use('t1',300),use('t2',100)]})],cards:[{storeId:'s',purchase:{orderId:'buy'},uses:[use('t1',300),use('t2',100)],purchaseConflict:false}]};
 const result=summarizeGiftCluster(cases,ledger);
 assert.deepEqual(result.purchased,[{amount:800,currency:'ILS'}]);
 assert.deepEqual(result.linkedRedeemed,[{amount:400,currency:'ILS'}]);
 assert.equal(result.other.length,1);
 assert.equal(result.redemptions.length,1);
});
test('only exact nonconflicting purchase IDs join uses; other tenants/stores never join',()=>{
 const ledger={orders:[order('buy',{giftCardUnits:1,purchaseAmounts:[{amount:100,currency:'ILS'}]})],cards:[
 {storeId:'other',purchase:{orderId:'buy'},uses:[use('t1',90)]},
 {storeId:'s',purchase:{orderId:'buy'},purchaseConflict:true,uses:[use('t2',80)]},
 {storeId:'s',uses:[use('t3',70)]},
 ]};
 assert.deepEqual(summarizeGiftCluster([alert('buy')],ledger).linkedRedeemed,[]);
});
test('deduplicates orders and transactions, separates refunds and currencies',()=>{
 const ledger={orders:[order('buy',{giftCardUnits:1,purchaseAmounts:[{amount:0.1,currency:'ILS'},{amount:0.2,currency:'ILS'},{amount:50,currency:'USD'}]}),order('use',{uses:[use('t1',20),use('r1',5,'REFUND')]})],cards:[{storeId:'s',purchase:{orderId:'buy'},uses:[use('t1',20),use('t1',20),use('r1',5,'REFUND')]}]};
 const result=summarizeGiftCluster([alert('buy'),alert('buy'),alert('use')],ledger);
 assert.deepEqual(result.purchased,[{amount:0.3,currency:'ILS'},{amount:50,currency:'USD'}]);
 assert.deepEqual(result.refunded,[{amount:5,currency:'ILS'}]);
 assert.deepEqual(result.linkedRedeemed,[{amount:20,currency:'ILS'}]);
});
test('does not guess missing purchase amounts from whole-order totals',()=>{
 const result=summarizeGiftCluster([{...alert('buy'),amount:999,signals:{giftCardValue:500}}]);
 assert.equal(result.missingPurchaseAmounts,1);
 assert.deepEqual(result.purchased,[]);
});
test('counts observed uses even if the redemption has no fraud alert',()=>{
 const result=summarizeGiftCluster([alert('buy')],{orders:[order('buy',{giftCardUnits:1,purchaseAmounts:[{amount:100,currency:'ILS'}]})],cards:[{storeId:'s',purchase:{orderId:'buy'},uses:[use('unflagged',40)]}]});
 assert.deepEqual(result.linkedRedeemed,[{amount:40,currency:'ILS'}]);
});
