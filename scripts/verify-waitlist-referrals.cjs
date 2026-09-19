// Run with REDIS_SERVER and REDIS_CLI paths (or binaries on PATH).
// Isolated loopback Redis: never reads or writes the production database.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {spawn, execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {createHash} = require('node:crypto');
const exec = promisify(execFile);
const w = require('../src/cloud/waitlist.cjs');
const hash = x=>createHash('sha256').update(x).digest('hex');
(async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'aspen-referrals-'));
 const socket=path.join(dir,'redis.sock');
 const probe=require('node:net').createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const redis=spawn(process.env.REDIS_SERVER||'redis-server',['--port',String(port),'--bind','127.0.0.1','--save','','--appendonly','no','--dir',dir],{stdio:['ignore','pipe','pipe']});
 let logs='';redis.stdout.on('data',d=>logs+=d);redis.stderr.on('data',d=>logs+=d);
 let startError;redis.on('error',e=>{startError=e});
 const originalFetch=global.fetch, oldUrl=process.env.KV_REST_API_URL,oldToken=process.env.KV_REST_API_TOKEN;
 try{
  const cmd=async(...args)=>JSON.parse((await exec(process.env.REDIS_CLI||'redis-cli',['-h','127.0.0.1','-p',String(port),'--json',...args.map(String)],{maxBuffer:1024*1024})).stdout);
  for(let n=0;n<100;n++){if(startError)throw startError;if(redis.exitCode!==null)throw Error(logs);try{if(await cmd('PING')==='PONG')break;}catch{}await new Promise(r=>setTimeout(r,50));}
  assert.equal(await cmd('PING'),'PONG');
  process.env.KV_REST_API_URL='http://isolated-redis.invalid';process.env.KV_REST_API_TOKEN='test-only';
  global.fetch=async(url,options)=>{assert.equal(url,'http://isolated-redis.invalid');const result=await cmd(...JSON.parse(options.body));return {ok:true,json:async()=>({result})}};
  const members='{aspen:waitlist:v1}:members',order='{aspen:waitlist:v1}:order';
  const legacyReceipt=w.newReceipt(),legacyId=hash('legacy@example.com');
  await cmd('HSET',members,legacyId,JSON.stringify({email:'legacy@example.com',receiptHash:hash(legacyReceipt)}));
  await cmd('ZADD',order,Date.now()-86400000,legacyId);
  const alice=w.newReceipt();await w.join('alice@gmail.com','test',alice);let a=await w.status(alice);assert.equal(a.position,2);assert.equal(a.referrals,0);
  const bob=w.newReceipt();await Promise.all(Array.from({length:12},()=>w.join('bob@example.com','test',bob,a.code)));
  a=await w.status(alice);assert.equal(a.referrals,1);assert.equal(a.position,1);
  assert.equal((await w.list()).total,3);
  await w.join('a.lice+test@googlemail.com','test',w.newReceipt(),a.code);assert.equal((await w.status(alice)).referrals,1);
  await w.join('bob+test@example.com','test',w.newReceipt(),a.code);assert.equal((await w.status(alice)).referrals,1);
  await Promise.all(['c','d','e'].map(x=>w.join(x+'@example.com','test',w.newReceipt(),a.code)));
  assert.equal((await w.status(alice)).referrals,4);
  assert.equal(await w.status(w.newReceipt()),null);assert.equal(await w.status(a.code),null);
  assert.equal(await w.remove('bob@example.com',w.newReceipt()),false);assert.equal((await w.status(alice)).referrals,4);
  assert.equal(await w.remove('bob@example.com',bob),true);assert.equal((await w.status(alice)).referrals,3);assert.equal(await w.status(bob),null);
  await w.join('bob@example.com','test',bob,a.code);assert.equal((await w.status(alice)).referrals,4);
  const contacts=(await w.list()).contacts;assert.equal(contacts[0].email,'alice@gmail.com');assert.equal(contacts[0].position,1);assert.equal(contacts[0].referrals,4);assert.ok(!JSON.stringify(contacts).includes('receiptHash'));
  assert.equal(await w.remove('alice@gmail.com',alice),true);assert.equal(await w.status(alice),null);
  const anew=w.newReceipt();await w.join('alice@gmail.com','test',anew);assert.equal((await w.status(anew)).referrals,0);
  await w.remove('bob@example.com',bob);assert.equal((await w.status(anew)).referrals,0);
  await w.join('old-link@example.com','test',w.newReceipt(),a.code);assert.equal((await w.status(anew)).referrals,0);
  assert.equal(await w.remove('legacy@example.com',legacyReceipt),true);
  // The old member and all new users live in one actual priority queue.
  assert.ok((await w.list()).contacts.every((c,i)=>c.position===i+1));
  console.log('PASS: real Redis atomic ranking, concurrent dedupe, self/alias exclusion, revocation, undo/rejoin, legacy compatibility, private capabilities and admin priority.');
 }finally{
  global.fetch=originalFetch;if(oldUrl===undefined)delete process.env.KV_REST_API_URL;else process.env.KV_REST_API_URL=oldUrl;if(oldToken===undefined)delete process.env.KV_REST_API_TOKEN;else process.env.KV_REST_API_TOKEN=oldToken;
  redis.kill('SIGTERM');await new Promise(r=>redis.exitCode!==null?r():redis.once('exit',r));await fs.rm(dir,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1});
