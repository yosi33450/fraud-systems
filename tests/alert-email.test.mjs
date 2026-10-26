import './register-ts-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAlertEmail} from '../lib/alert-email.ts';
const base = {orderNumber:'123',storeName:'Test',customer:'Customer',email:'test@example.invalid',amount:0,severity:'high',reason:'התאמה למאגר',evidence:[{source:'network',label:'התאמה למאגר',description:'נמצא מזהה תואם'}]};
test('network explanation names only matched identifiers and does not assert fraud',()=>{
 const result=buildAlertEmail({...base,signals:{blacklist:{ip:true,email:false}},context:{ip:'192.0.2.1'}},'https://example.invalid');
 assert.match(result.text,/כתובת IP: 192.0.2.1/);
 assert.doesNotMatch(result.text,/אימייל: test/);
 assert.match(result.text,/אינה מזהה אדם בוודאות/);
 assert.match(result.text,/0 ₪/);
 assert.match(result.text,/לא התקבל מועד/);
});
test('missing match metadata is not invented',()=>{
 const result=buildAlertEmail(base,'https://example.invalid');
 assert.match(result.text,/לא נשמר פירוט של סוג המזהה/);
 assert.doesNotMatch(result.text,/אימייל: test/);
});
test('behavior evidence keeps real counts and window; html escapes inputs',()=>{
 const result=buildAlertEmail({...base,customer:'<img src=x>',reason:'ריבוי הזמנות',occurredAt:'2026-10-26T08:00:00Z',evidence:[{source:'behavior',label:'ריבוי הזמנות',description:'נמצאו 3 הזמנות ב־24 שעות. הסף: יותר מ־2.'}]},'https://example.invalid');
 assert.match(result.text,/3 הזמנות ב־24 שעות/);
 assert.match(result.html,/&lt;img src=x&gt;/);
 assert.doesNotMatch(result.html,/<img src=x>/);
 assert.doesNotMatch(result.text,/לא נשמר פירוט של סוג/);
});
test('test messages explicitly identify synthetic data',()=>{
 const result=buildAlertEmail({...base,evidence:[]},'https://example.invalid',true);
 assert.match(result.text,/הודעת בדיקה בלבד/);
 assert.match(result.text,/אין צורך לטפל בהזמנה/);
});
