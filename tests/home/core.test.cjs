const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHomeServer } = require('../../src/home/server');
const { Vault } = require('../../src/home/store');
const { fitCandidates } = require('../../src/home/intelligence');
const { localAddress, visibleDevices } = require('../../src/home/integrations');

async function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aspen-home-test-'));
  let lastContext;
  const home=await createHomeServer({port:0,dataDir:dir,intelligence:{inspectModels:async()=>({mode:'local'}),answer:async(_m,c)=>{lastContext=c;return {text:'Local answer'};}},haRequest:async()=>[]});
  t.after(async()=>{await home.close();fs.rmSync(dir,{recursive:true,force:true});});
  let cookie;
  async function req(route,body,opts={}) {
    const headers={Origin:home.origin,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),...opts.headers};
    const res=await fetch(home.origin+'/v1/home/'+route,{method:opts.method||(body?'POST':'GET'),headers,...(body?{body:JSON.stringify(body)}:{})});
    if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];
    return {status:res.status,body:await res.json(),res};
  }
  assert.equal((await req('setup',{bootstrap:'wrong-secret',name:'Owner',homeName:'Test home',password:'a long private password'})).status,403);
  const setup=await req('setup',{bootstrap:home.bootstrap,name:'Owner',homeName:'Test home',password:'a long private password'});
  assert.equal(setup.status,200);
  return {home,dir,req,getCookie:()=>cookie,setCookie:c=>cookie=c,context:()=>lastContext};
}
test('first-run claiming requires a bootstrap secret and cannot be repeated',async t=>{
  const f=await fixture(t);
  assert.equal((await f.req('setup',{bootstrap:f.home.bootstrap,name:'Intruder',homeName:'Other',password:'another long password'})).status,409);
  f.setCookie(null);
  assert.equal((await f.req('state')).status,401);
  assert.equal((await f.req('login',{name:'Owner',password:'bad'})).status,401);
  assert.equal((await f.req('login',{name:'Owner',password:'a long private password'})).status,200);
});
test('private memory never reaches another member or a shared room client',async t=>{
  const f=await fixture(t),ownerCookie=f.getCookie();
  await f.req('memories',{text:'Private appointment',visibility:'private'});
  await f.req('memories',{text:'Shared grocery preference',visibility:'household'});
  const invite=(await f.req('invites',{role:'adult'})).body;
  f.setCookie(null);
  assert.equal((await f.req('join',{invite:invite.invite,name:'Adult',password:'a second long password'})).status,200);
  let s=(await f.req('state')).body;
  assert.deepEqual(s.memories.map(m=>m.text),['Shared grocery preference']);
  assert.equal((await f.req('join',{invite:invite.invite,name:'Again',password:'a second long password'})).status,403);
  await f.req('chat',{message:'What do you know?'});
  assert.deepEqual(f.context().memories,['Shared grocery preference']);
  f.setCookie(ownerCookie);
  const room=(await f.req('state')).body.rooms[0].id;
  const pair=(await f.req('clients',{name:'Kitchen pod',type:'pod',roomId:room,scopes:['home:read','chat:ask']})).body;
  const paired=(await f.req('pair',{code:pair.code})).body;
  assert.ok(paired.token);
  const headers={Authorization:'Bearer '+paired.token};
  s=(await f.req('state',undefined,{headers})).body;
  assert.deepEqual(s.memories.map(m=>m.text),['Shared grocery preference']);
  await f.req('chat',{message:'Tell me Owner’s private notes',memberId:'Owner'},{headers});
  assert.deepEqual(f.context().memories,['Shared grocery preference']);
  assert.equal((await f.req('memories',{text:'Injected',visibility:'household'},{headers})).status,403);
  assert.equal((await f.req('tasks',{title:'Not permitted'},{headers})).status,403);
  assert.equal((await f.req('pair',{code:pair.code})).status,403);
  await f.req('clients',{id:paired.client.id},{method:'DELETE'});
  assert.equal((await f.req('state',undefined,{headers})).status,401);
});
test('children cannot install apps, invite adults, or control devices',async t=>{
  const f=await fixture(t);
  const invite=(await f.req('invites',{role:'child'})).body;
  f.setCookie(null);await f.req('join',{invite:invite.invite,name:'Child',password:'a child long password'});
  assert.equal((await f.req('apps',{id:'energy',install:true})).status,403);
  assert.equal((await f.req('invites',{role:'adult'})).status,403);
  assert.equal((await f.req('devices/action',{id:'light.hall',action:'turn_on'})).status,403);
  assert.equal((await f.req('tasks',{title:'Pack school bag',visibility:'private'})).status,200);
});
test('pairing codes, invitations, and browser sessions expire',async t=>{
  const f=await fixture(t);
  const invite=(await f.req('invites',{role:'adult'})).body.invite;
  const code=(await f.req('clients',{name:'Family screen',type:'screen',scopes:['home:read']})).body.code;
  const now=Date.now;
  try {
    const start=now();
    Date.now=()=>start+6*60000;
    assert.equal((await f.req('pair',{code})).status,403);
    Date.now=()=>start+16*60000;
    assert.equal((await f.req('join',{invite,name:'Late guest',password:'a late long password'})).status,403);
    Date.now=()=>start+13*3600000;
    assert.equal((await f.req('state')).status,401);
  } finally { Date.now=now; }
});
test('removing Butler preserves tasks and stops task mutations until it is reinstalled',async t=>{
  const f=await fixture(t);
  const task=(await f.req('tasks',{title:'Keep this reminder'})).body.task;
  await f.req('apps',{id:'butler',install:false});
  assert.equal((await f.req('tasks',{id:task.id,done:true},{method:'PATCH'})).status,409);
  assert.equal((await f.req('tasks',{title:'New task'})).status,409);
  await f.req('apps',{id:'butler',install:true});
  assert.equal((await f.req('tasks',{id:task.id,done:true},{method:'PATCH'})).status,200);
  assert.equal((await f.req('state')).body.tasks[0].done,true);
});
test('room clients cannot act in another room or execute unsafe device actions',async t=>{
  const f=await fixture(t),rooms=(await f.req('state')).body.rooms;
  f.home.vault.state.devices=[{id:'light.other',kind:'light',roomId:rooms[1].id,enabled:true},{id:'lock.door',kind:'lock',roomId:rooms[0].id,enabled:true}];
  const code=(await f.req('clients',{name:'Room robot',type:'robot',roomId:rooms[0].id,scopes:['devices:control']})).body.code;
  const paired=(await f.req('pair',{code})).body;
  const headers={Authorization:'Bearer '+paired.token};
  assert.equal((await f.req('devices/action',{id:'light.other',action:'turn_on'},{headers})).status,403);
  assert.equal((await f.req('devices/action',{id:'lock.door',action:'unlock'},{headers})).status,400);
  assert.equal((await f.req('clients',{name:'Unsafe robot',type:'robot',scopes:['devices:control']})).status,400);
});
test('browser requests reject cross-origin writes and invalid hosts',async t=>{
  const f=await fixture(t);
  assert.equal((await f.req('tasks',{title:'Attack'},{headers:{Origin:'https://untrusted.example'}})).status,403);
  const rebinding=await new Promise((resolve,reject)=>{ const r=require('node:http').get(f.home.origin+'/v1/home/status',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});r.on('error',reject); });
  assert.equal(rebinding,403);
  const res=await fetch(f.home.origin+'/v1/home/tasks',{method:'POST',headers:{Cookie:f.getCookie(),'Content-Type':'application/json'},body:JSON.stringify({title:'Missing origin'})});
  assert.equal(res.status,403);
  const page=await fetch(f.home.origin+'/');
  assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.match(page.headers.get('permissions-policy'),/microphone=\(\)/);
});
test('local state survives restart, secrets are not stored in plaintext, and logout revokes a session',async t=>{
  const f=await fixture(t);
  await f.req('tasks',{title:'Offline grocery list',visibility:'private'});
  await f.req('memories',{text:'A very private fact',visibility:'private'});
  const disk=fs.readFileSync(path.join(f.dir,'household.vault'),'utf8');
  assert.ok(!disk.includes('A very private fact'));
  assert.ok(!disk.includes('a long private password'));
  const reopened=new Vault(f.dir);
  assert.equal(reopened.state.tasks[0].title,'Offline grocery list');
  assert.equal(reopened.state.memories[0].text,'A very private fact');
  const cookie=f.getCookie();await f.req('logout',{});f.setCookie(cookie);
  assert.equal((await f.req('state')).status,401);
});
test('device discovery excludes locks and unsafe network addresses',()=>{
  assert.equal(localAddress('169.254.169.254'),false);
  assert.equal(localAddress('8.8.8.8'),false);
  assert.equal(localAddress('192.168.1.2'),true);
  assert.equal(localAddress('127.0.0.1'),true);
  const result=visibleDevices([{entity_id:'lock.front',state:'locked'},{entity_id:'light.kitchen',state:'off',attributes:{friendly_name:'Kitchen'}}]);
  assert.equal(result.length,1);assert.equal(result[0].enabled,false);
});
test('model selection reserves memory and rejects oversized and embedding-only models',()=>{
  const candidates=fitCandidates([{name:'large',size:15e9},{name:'small',size:2e9},{name:'embed:small',size:1e9}],16e9,10e9);
  assert.deepEqual(candidates.map(m=>m.name),['small']);
  assert.deepEqual(fitCandidates([{name:'small',size:2e9}],16e9,1e9),[]);
});

test('local plans require owner approval, stay private, validate atomically and cannot be replayed',async t=>{
  const {draftPlan}=require('../../src/home/plans');
  assert.deepEqual(await draftPlan('Pack lunch',{answer:async()=>({text:'{"tasks":[{"title":"Pack lunch","tool":"send_email"}]}'})}),[{title:'Pack lunch'}]);
  await assert.rejects(draftPlan('bad',{answer:async()=>({text:'I sent an email.'})}),{status:422});
  await assert.rejects(draftPlan('bad',{answer:async()=>({status:'unavailable',text:'Set up local intelligence.'})}),{status:409});
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aspen-plan-test-'));
  const home=await createHomeServer({port:0,dataDir:dir,intelligence:{answer:async()=>({text:'{"tasks":[{"title":"Pack lunch"},{"title":"School pickup at 12:30"}]}'})}});
  t.after(async()=>{await home.close();fs.rmSync(dir,{recursive:true,force:true});});
  let cookie='';
  const req=async(route,body)=>{const res=await fetch(home.origin+'/v1/home/'+route,{method:body?'POST':'GET',headers:{Origin:home.origin,Cookie:cookie,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];return {status:res.status,body:await res.json()};};
  await req('setup',{bootstrap:home.bootstrap,name:'Alex',homeName:'Plan home',password:'a long private password'});
  const ownerCookie=cookie;
  const draft=(await req('plans/draft',{source:'School pickup tomorrow at 12:30. Pack lunch.'})).body;
  assert.equal((await req('state')).body.tasks.length,0,'drafting must not execute');
  const invite=(await req('invites',{role:'adult'})).body;
  cookie='';await req('join',{invite:invite.invite,name:'Sam',password:'a second long password'});
  const otherCookie=cookie;
  assert.equal((await req('plans/approve',{id:draft.id,tasks:draft.tasks})).status,409,'another member cannot approve this draft');
  cookie=ownerCookie;
  assert.equal((await req('plans/approve',{id:draft.id,tasks:[{title:'Valid'},{title:''}]})).status,400);
  assert.equal((await req('state')).body.tasks.length,0,'invalid batch cannot partially save');
  const approved=await req('plans/approve',{id:draft.id,tasks:draft.tasks});
  assert.equal(approved.status,200);assert.equal(approved.body.tasks.length,2);assert.ok(approved.body.tasks.every(t=>t.visibility==='private'));
  assert.equal((await req('plans/approve',{id:draft.id,tasks:draft.tasks})).status,409,'approval is one-use');
  cookie=otherCookie;assert.equal((await req('state')).body.tasks.length,0);
  assert.ok(!fs.readFileSync(path.join(dir,'household.vault'),'utf8').includes('Pack lunch'));
  cookie=ownerCookie;
  const pair=(await req('clients',{name:'Shared screen',type:'screen',scopes:['chat:ask','tasks:write']})).body;
  const paired=(await req('pair',{code:pair.code})).body;
  const denied=await fetch(home.origin+'/v1/home/plans/draft',{method:'POST',headers:{Authorization:'Bearer '+paired.token,'Content-Type':'application/json'},body:JSON.stringify({source:'Pack lunch'})});
  assert.equal(denied.status,403,'shared screens cannot create private member plans');
  const expired=(await req('plans/draft',{source:'Pack lunch.'})).body;
  const now=Date.now;try{const start=now();Date.now=()=>start+11*60000;assert.equal((await req('plans/approve',{id:expired.id,tasks:expired.tasks})).status,409);}finally{Date.now=now;}
});
