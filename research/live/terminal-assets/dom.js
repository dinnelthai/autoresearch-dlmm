'use strict';
// Shared DOM rendering and input helpers.
const $=id=>document.getElementById(id);
const fmt=n=>typeof n==='number'&&Number.isFinite(n)?n.toLocaleString('en-US',{maximumSignificantDigits:8}):'—';
const put=(id,x)=>{$(id).textContent=x??'—'};
const number=id=>{const e=$(id),v=e.value;if(!v.trim()||!Number.isFinite(Number(v))||!e.validity.valid)throw Error('请检查 '+(e.closest('label')?.querySelector('span')?.textContent??id));return Number(v)};
const amount=id=>{const v=$(id).value.trim();if(!/^\d+(\.\d+)?$/.test(v)||v.length>40)throw Error('金额必须是普通非负十进制');return v};
function cell(tr,t){const td=document.createElement('td');td.textContent=t;tr.append(td);return td}
