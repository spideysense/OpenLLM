import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../api/waitlist.js';
import admin from '../../api/admin-stats.js';
const { list } = require('../../src/cloud/waitlist.cjs');

function response() {
  return { headers: {}, code: 200, data: null, setHeader(k,v){this.headers[k]=v;}, status(code){this.code=code;return this;}, json(data){this.data=data;return this;} };
}
const request = (body={}, extra={}) => ({ method:'POST', headers:{origin:'https://www.runonaspen.com','content-type':'application/json','x-forwarded-for':'192.0.2.15'}, body:{email:'person@example.com',consent:true,...body}, ...extra });
const result = value => ({ok:true,json:async()=>({result:value})});
let fetchMock;
beforeEach(()=>{
  vi.stubEnv('KV_REST_API_URL','https://database.example'); vi.stubEnv('KV_REST_API_TOKEN','test-token'); vi.stubEnv('ADMIN_PASSWORD','private-admin-password');
  fetchMock=vi.fn().mockResolvedValue(result(1));vi.stubGlobal('fetch',fetchMock);
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});

describe('durable waitlist boundary',()=>{
  it('stores consent and normalized email, without storing raw IP or receipt',async()=>{
    const res=response();await handler(request({email:'  Person@Example.com ',source:'launch-campaign'}),res);
    expect(res.code).toBe(200);expect(res.data.ok).toBe(true);expect(res.data.receipt).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const commands=fetchMock.mock.calls.map(([,options])=>JSON.parse(options.body));
    expect(commands).toHaveLength(2);
    const record=JSON.parse(commands[1][9]);
    expect(record).toMatchObject({email:'person@example.com',source:'launch-campaign',verified:false,consentVersion:'launch-early-access-v1'});
    expect(Date.parse(record.consentAt)).not.toBeNaN();expect(record.receiptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(commands)).not.toContain('192.0.2.15');expect(JSON.stringify(commands)).not.toContain(res.data.receipt);
    expect(fetchMock.mock.calls[1][1].signal).toBeDefined();expect(res.headers['Cache-Control']).toBe('no-store');
  });
  it.each(['not-an-email','person@example','<script>@example.com','a..b@example.com','.a@example.com','a.@example.com','x'.repeat(65)+'@example.com'])('rejects invalid email %s before storage',async email=>{
    const res=response();await handler(request({email}),res);expect(res.code).toBe(400);expect(fetchMock).not.toHaveBeenCalled();
  });
  it('requires affirmative consent and a first-party JSON request',async()=>{
    for(const req of [request({consent:false}),request({consent:'true'}),request({}, {headers:{origin:'https://evil.example','content-type':'application/json'}}),request({}, {headers:{origin:'https://www.runonaspen.com','content-type':'text/plain'}})]){
      const res=response();await handler(req,res);expect([400,403,415]).toContain(res.code);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('allows both canonical first-party origins',async()=>{
    for(const origin of ['https://runonaspen.com','https://www.runonaspen.com']){const req=request();req.headers.origin=origin;const res=response();await handler(req,res);expect(res.code).toBe(200);}
  });
  it('never exposes whether an address is already registered',async()=>{
    fetchMock.mockResolvedValueOnce(result(1)).mockResolvedValueOnce(result(0));
    const res=response();await handler(request(),res);expect(res.code).toBe(200);expect(Object.keys(res.data)).toEqual(['ok','receipt']);expect(res.data.ok).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)[1]).toContain('HEXISTS');
  });
  it('rate limits across instances before attempting a write',async()=>{
    fetchMock.mockResolvedValue(result(4));const res=response();await handler(request(),res);
    expect(res.code).toBe(429);expect(res.headers['Retry-After']).toBe('3600');expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each(['network','provider','malformed','unacknowledged'])('does not claim success when storage fails: %s',async failure=>{
    fetchMock.mockResolvedValueOnce(result(1));
    if(failure==='network')fetchMock.mockRejectedValueOnce(new Error('private provider detail'));
    if(failure==='provider')fetchMock.mockResolvedValueOnce({ok:true,json:async()=>({error:'private provider detail'})});
    if(failure==='malformed')fetchMock.mockResolvedValueOnce({ok:true,json:async()=>({})});
    if(failure==='unacknowledged')fetchMock.mockResolvedValueOnce(result(null));
    const res=response();await handler(request(),res);expect(res.code).toBe(503);expect(res.data.ok).toBeUndefined();expect(JSON.stringify(res.data)).not.toContain('private provider detail');
  });
  it('fails closed without configured persistent storage',async()=>{
    vi.stubEnv('KV_REST_API_URL','');vi.stubEnv('UPSTASH_REDIS_REST_URL','');
    const res=response();await handler(request(),res);expect(res.code).toBe(503);expect(fetchMock).not.toHaveBeenCalled();
  });
  it('does not collect honeypot submissions',async()=>{
    const res=response();await handler(request({website:'https://spam.example'}),res);expect(res.code).toBe(200);expect(fetchMock).not.toHaveBeenCalled();
  });
  it('requires an undo receipt and acknowledges actual deletion',async()=>{
    const missing=response();await handler(request({}, {method:'DELETE'}),missing);expect(missing.code).toBe(400);expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(result(1)).mockResolvedValueOnce(result(0));
    const wrong=response();await handler(request({receipt:'A'.repeat(43)},{method:'DELETE'}),wrong);expect(wrong.data.removed).toBe(false);
    fetchMock.mockResolvedValueOnce(result(2)).mockResolvedValueOnce(result(1));
    const correct=response();await handler(request({receipt:'B'.repeat(43)},{method:'DELETE'}),correct);expect(correct.data.removed).toBe(true);
    const command=JSON.parse(fetchMock.mock.calls[3][1].body);expect(command[1]).toContain('record.receiptHash ~= ARGV[2]');expect(command[9]).not.toBe('B'.repeat(43));
  });
  it('requires a private capability for position and returns no personal data', async()=>{
    let res=response(); await handler(request({receipt:'invalid'},{method:'PATCH'}),res); expect(res.code).toBe(400); expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(result(1)).mockResolvedValueOnce(result(JSON.stringify({position:3,referrals:2,code:'abcdefghijklmnop'})));
    res=response();await handler(request({receipt:'A'.repeat(43)},{method:'PATCH'}),res);expect(res.data.waitlist).toEqual({position:3,referrals:2,code:'abcdefghijklmnop'});expect(JSON.stringify(res.data)).not.toContain('person@example.com');
    fetchMock.mockResolvedValueOnce(result(1)).mockResolvedValueOnce(result(''));
    res=response();await handler(request({receipt:'B'.repeat(43)},{method:'PATCH'}),res);expect(res.data).toEqual({ok:true,waitlist:null});
  });
  it('passes only validated public referral codes into the atomic signup',async()=>{
    for(const ref of ['abcdefghijklmnop', '<script>bad</script>']){
      fetchMock.mockClear(); const res=response();await handler(request({ref}),res);expect(res.code).toBe(200);
      const cmd=JSON.parse(fetchMock.mock.calls[1][1].body);expect(cmd[11]).toBe(ref.length===16?ref:'');expect(cmd[12]).toBe(7*86400000);
    }
  });
  it('does not permit public GET listing',async()=>{
    const res=response();await handler(request({}, {method:'GET'}),res);expect(res.code).toBe(405);expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('private waitlist administration',()=>{
  it('checks the admin password before reading contacts',async()=>{
    const res=response();await admin({method:'POST',body:{action:'waitlist',password:'wrong'}},res);expect(res.code).toBe(401);expect(fetchMock).not.toHaveBeenCalled();
  });
  it('returns contacts only after authentication and strips undo secrets',async()=>{
    fetchMock.mockResolvedValueOnce(result(1)).mockResolvedValueOnce(result(['id'])).mockResolvedValueOnce(result([JSON.stringify({email:'person@example.com',receiptHash:'private-secret',verified:false})]));
    const res=response();await admin({method:'POST',body:{action:'waitlist',password:'private-admin-password'}},res);
    expect(res.code).toBe(200);expect(res.data.total).toBe(1);expect(res.data.contacts[0]).toMatchObject({email:'person@example.com',verified:false});expect(JSON.stringify(res.data)).not.toContain('private-secret');
  });
  it('handles empty lists and rejects invalid page offsets',async()=>{
    fetchMock.mockResolvedValueOnce(result(0)).mockResolvedValueOnce(result([]));expect(await list()).toEqual({total:0,contacts:[],nextOffset:null});
    fetchMock.mockClear();const res=response();await admin({method:'POST',body:{action:'waitlist',password:'private-admin-password',offset:-1}},res);expect(res.code).toBe(400);expect(fetchMock).not.toHaveBeenCalled();
  });
});
