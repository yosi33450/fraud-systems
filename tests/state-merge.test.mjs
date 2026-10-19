import './register-ts-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeStateChanges as merge} from '../lib/state-merge.ts';
test('stale sync cannot remove newer employees or alerts',()=>{
 const base={employees:[],cases:[{id:'old',status:'new'}],orders:[]};
 const local={...base,orders:[{id:'order'}]};
 const remote={...base,employees:[{id:'employee'}],cases:[...base.cases,{id:'today'}]};
 assert.deepEqual(merge(base,local,remote),{...remote,orders:local.orders});
});
test('manual decisions are preserved when stale writer adds another case',()=>{
 const b=[{id:'a',status:'new'}],l=[...b,{id:'b',status:'new'}],r=[{id:'a',status:'closed'}];
 assert.deepEqual(merge(b,l,r),[...r,l[1]]);
});
test('explicit deletion is retained but unknown records are not removed',()=>{
 assert.deepEqual(merge([{id:'a'}],[],[{id:'a'},{id:'b'}]),[{id:'b'}]);
});
test('conflicting decisions fail closed',()=>{
 assert.throws(()=>merge({status:'new'},{status:'fraud'},{status:'safe'}),/CONCURRENT_EDIT/);
});
test('settings tuples merge independent fields',()=>{
 assert.deepEqual(merge([['tenant',{a:1,b:1}]],[['tenant',{a:2,b:1}]],[['tenant',{a:1,b:2}]]),[['tenant',{a:2,b:2}]]);
});
test('independent Shopify orders survive simultaneous syncs',()=>{
 const a={tenantId:'t',storeId:'s',shopifyOrderId:'1'},b={...a,shopifyOrderId:'2'};
 assert.deepEqual(merge([], [a], [b]),[b,a]);
});
