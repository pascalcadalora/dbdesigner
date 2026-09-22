import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base=process.env.SCHEMA_TEST_URL||'http://127.0.0.1:3080';
const id=randomUUID(),tableId=randomUUID(),columnId=randomUUID();
const project={version:1,id,revision:0,name:'API smoke test',dialect:'postgres',snap:true,viewport:{x:60,y:40,zoom:.85},tables:[{id:tableId,name:'customers',x:80,y:100,color:'#6d5ce7',note:'smoke test',columns:[{id:columnId,name:'id',type:'int',primaryKey:true,nullable:false,unique:false,defaultValue:''}]}],relations:[]};
async function request(path,method='GET',body){return fetch(base+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});}
let revision=0;
try{
  assert.equal((await request('/api/health')).status,200);
  let response=await request(`/api/projects/${id}`,'PUT',project);assert.equal(response.status,200);let saved=await response.json();revision=saved.revision;assert.equal(revision,1);
  assert.equal((await request(`/api/projects/${id}`,'PUT',project)).status,409,'stale revision must conflict');
  response=await request(`/api/projects/${id}`);assert.equal(response.status,200);saved=await response.json();assert.equal(saved.tables[0].x,80);assert.equal(saved.viewport.zoom,.85);
  assert.equal(saved.tables[0].columns[0].displayName,'');assert.equal(saved.tables[0].columns[0].systemGenerated,false);
  assert.ok((await (await request('/api/projects')).json()).some(p=>p.id===id));
  saved.name='API smoke test updated';Object.assign(saved.tables[0].columns[0],{displayName:'Nomor Faktur',description:'Nomor faktur internal.',systemGenerated:true,generationPattern:'{SEQ:5}/INV/{MM}/{YYYY}'});response=await request(`/api/projects/${id}`,'PUT',saved);assert.equal(response.status,200);saved=await response.json();revision=saved.revision;assert.equal(revision,2);
  const reopened=await (await request(`/api/projects/${id}`)).json();assert.deepEqual(reopened.tables[0].columns[0],saved.tables[0].columns[0]);
  for(const pattern of ['','{INDEX}/INV','{SEQ:0}','{SEQ:10}','{SEQ}\nINV']){const bad=structuredClone(saved);bad.tables[0].columns[0].generationPattern=pattern;assert.equal((await request(`/api/projects/${id}`,'PUT',bad)).status,400);}
  const invalid=structuredClone(saved);invalid.tables[0].columns[0].nullable=true;assert.equal((await request(`/api/projects/${id}`,'PUT',invalid)).status,400);
  const duplicate=structuredClone(saved);duplicate.tables.push({...duplicate.tables[0],id:randomUUID()});assert.equal((await request(`/api/projects/${id}`,'PUT',duplicate)).status,400);
  const dangling=structuredClone(saved);dangling.relations.push({id:randomUUID(),fromTable:tableId,fromColumn:columnId,toTable:randomUUID(),toColumn:randomUUID(),kind:'one-to-many'});assert.equal((await request(`/api/projects/${id}`,'PUT',dangling)).status,400);
  assert.equal((await request(`/api/projects/${id}?revision=1`,'DELETE')).status,409);
  assert.equal((await request('/api/projects/not-a-guid')).status,404);
  console.log('API smoke passed: health, CRUD, JSON round-trip, revisions, invalid keys, duplicates, dangling relations, route validation.');
}finally{
  if(revision){const result=await request(`/api/projects/${id}?revision=${revision}`,'DELETE');assert.equal(result.status,204);assert.equal((await request(`/api/projects/${id}`)).status,404);console.log('Test project soft-deleted in PostgreSQL and removed from the active list.');}
}
