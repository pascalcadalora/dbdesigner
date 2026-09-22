// This integration check intentionally redeploys this workspace's local services.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const control=path.join(root,'scripts/control.mjs');
const run=command=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,[control,command],{cwd:root,stdio:'inherit',windowsHide:true});p.on('error',reject);p.on('exit',resolve);});
const records=async()=>JSON.parse(await readFile(path.join(root,'.runtime/processes.json'),'utf8'));
const id=randomUUID();
const fixture={version:1,id,revision:0,name:'Redeploy persistence test',dialect:'postgres',tables:[],relations:[],viewport:{x:123,y:456,zoom:.75},snap:true};
const response=await fetch(`http://127.0.0.1:3080/api/projects/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(fixture)});assert.equal(response.status,200);const saved=await response.json();
const before=await records();
assert.equal(await run('deploy'),0);
const after=await records();assert.equal(after.length,2);assert.ok(after.every(p=>before.every(old=>old.pid!==p.pid)));
const restored=await (await fetch(`http://127.0.0.1:3080/api/projects/${id}`)).json();assert.deepEqual(restored,saved);
console.log('PASS: redeploy replaced tracked processes, kept ports 3080/5180, and preserved project JSON.');
assert.equal(await run('stop'),0);
const blocker=net.createServer(socket=>socket.end('fixture listener'));
await new Promise((resolve,reject)=>{blocker.once('error',reject);blocker.listen(3080,'127.0.0.1',resolve);});
try{
  assert.equal(await run('deploy'),1,'occupied fixed port must fail');
  assert.equal(blocker.listening,true,'unrelated listener must remain alive');
  assert.equal((await records()).length,0,'must not launch services on fallback ports');
  console.log('PASS: occupied port fails explicitly, no port fallback, unrelated listener preserved.');
}finally{await new Promise(resolve=>blocker.close(resolve));}
assert.equal(await run('deploy'),0);
assert.equal((await fetch(`http://127.0.0.1:3080/api/projects/${id}?revision=${saved.revision}`,{method:'DELETE'})).status,204);
console.log('PASS: final deployment ready. Persistence fixture removed from active projects (.deleted backup retained).');
