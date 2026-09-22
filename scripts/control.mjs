import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, unlink, open } from 'node:fs/promises';
import { existsSync, openSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = path.join(root, '.runtime');
const runner = path.join(root, 'scripts/run-service.mjs');
const windows = process.platform === 'win32';
const command = ({'4':'deploy','7':'status','10':'install','11':'check','15':'stop'})[process.argv[2]] || process.argv[2] || 'status';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const npmCli = windows ? path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js') : null;
async function run(executable, args, cwd=root) {
  console.log(`> ${executable === process.execPath ? 'node' : executable} ${args.join(' ')}`);
  await new Promise((resolve,reject)=>{const p=spawn(executable,args,{cwd,stdio:'inherit',windowsHide:true,env:{...process.env,API_URL:'http://127.0.0.1:5180',NEXT_TELEMETRY_DISABLED:'1'}});p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(new Error(`Command gagal (${code}).`)));});
}
const npm = args => windows ? run(process.execPath,[npmCli,...args],path.join(root,'web')) : run('npm',args,path.join(root,'web'));
function commandLine(pid) {
  try {
    if (!Number.isInteger(pid) || pid <= 1) return '';
    return windows
      ? execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CommandLine`],{encoding:'utf8',windowsHide:true}).trim()
      : execFileSync('ps',['-p',String(pid),'-o','args='],{encoding:'utf8'}).trim();
  } catch { return ''; }
}
const owned = record => { const line=commandLine(record.pid); return line.includes(runner) && line.includes(record.token) && ['api','web'].includes(record.role); };
async function records() {try{return JSON.parse(await readFile(path.join(runtime,'processes.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return [];throw e;}}
async function stop() {
  const list=await records();
  for(const record of list){
    if(!owned(record)){if(commandLine(record.pid))console.log(`PID ${record.pid} bukan instance terverifikasi; tidak dihentikan.`);continue;}
    console.log(`Menghentikan ${record.role}, PID ${record.pid}…`);
    if(windows)execFileSync('taskkill.exe',['/PID',String(record.pid),'/T','/F'],{windowsHide:true,stdio:'pipe'});
    else { try{process.kill(-record.pid,'SIGTERM');}catch(e){if(e.code!=='ESRCH')throw e;} await delay(500); if(owned(record)){try{process.kill(-record.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}} }
  }
  await writeFile(path.join(runtime,'processes.json'),'[]');
  await delay(700);
}
async function portFree(port) {
  await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',()=>reject(new Error(`Port ${port} sudah dipakai proses lain/tidak tersedia. Deployment dihentikan; tidak pindah port dan tidak menghentikan aplikasi lain.`)));server.listen({host:'127.0.0.1',port,exclusive:true},()=>server.close(resolve));});
}
async function healthy(url) {try{return (await fetch(url,{signal:AbortSignal.timeout(2000)})).ok;}catch{return false;}}
async function waitReady(record,url) {
  for(let i=0;i<45;i++) {if(await healthy(url))return; if(!owned(record))throw new Error(`${record.role} berhenti saat startup. Periksa .runtime/${record.role}.log.`); await delay(700);}
  throw new Error(`${record.role} belum siap: ${url}. Periksa log.`);
}
async function start(role,list) {
  const log=openSync(path.join(runtime,`${role}.log`),'a');const token=randomUUID();
  const child=spawn(process.execPath,[runner,role,token],{cwd:root,detached:true,stdio:['ignore',log,log],windowsHide:true});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});closeSync(log);
  const record={pid:child.pid,role,token};list.push(record);await writeFile(path.join(runtime,'processes.json'),JSON.stringify(list,null,2));child.unref();return record;
}
async function install(){await npm(['ci','--no-audit','--no-fund']);await run('dotnet',['restore','api/SchemaStudio.Api.csproj']);}
async function deploy(){
  await stop();await portFree(3080);await portFree(5180);
  await install();
  await run('dotnet',['publish','api/SchemaStudio.Api.csproj','-c','Release','-o',path.join(runtime,'publish')]);
  await npm(['run','build']);
  // Re-check after build so another process cannot cause an unnoticed port fallback.
  await portFree(3080);await portFree(5180);
  const list=[];
  try{const api=await start('api',list);await waitReady(api,'http://127.0.0.1:5180/api/health');const web=await start('web',list);await waitReady(web,'http://127.0.0.1:3080');if(!await healthy('http://127.0.0.1:3080/api/health'))throw new Error('Proxy frontend ke API gagal.');}
  catch(e){await stop();throw e;}
  console.log('\nSchema Studio siap: http://127.0.0.1:3080\nAPI: http://127.0.0.1:5180\nLog: .runtime/api.log dan .runtime/web.log\nData tersimpan di api/App_Data (dipertahankan saat redeploy).');
}
await mkdir(runtime,{recursive:true});
let lock;
try{
  if(command!=='status'){
    const lockPath=path.join(runtime,'control.lock');
    try{lock=await open(lockPath,'wx');}catch(e){
      if(e.code!=='EEXIST')throw e;
      const old=Number(await readFile(lockPath,'utf8'));
      // Be conservative on PID reuse: an occupied PID never permits a parallel deploy.
      if(commandLine(old))throw new Error('Proses deploy/check lain masih berjalan (control.lock).');
      await unlink(lockPath);lock=await open(lockPath,'wx');
    }
    await lock.writeFile(String(process.pid));
  }
  switch(command){
    case 'deploy':await deploy();break;
    case 'stop':await stop();console.log('Instance Schema Studio dihentikan. Data tetap tersimpan.');break;
    case 'install':await install();break;
    case 'check':if(!existsSync(path.join(root,'web/node_modules')))await install();await run('dotnet',['build','api/SchemaStudio.Api.csproj']);await npm(['run','typecheck']);await npm(['run','lint']);await npm(['test']);break;
    case 'status':for(const record of await records())console.log(`${record.role}: PID ${record.pid} ${owned(record)?'running':'stopped'}`);console.log(`UI 3080: ${await healthy('http://127.0.0.1:3080')?'ready':'offline'}`);console.log(`API 5180: ${await healthy('http://127.0.0.1:5180/api/health')?'ready':'offline'}`);break;
    default:throw new Error('Gunakan deploy, stop, status, install, check (atau 4, 7, 10, 11, 15).');
  }
}catch(e){console.error(`ERROR: ${e.message}`);process.exitCode=1;}
finally{if(lock){await lock.close();await unlink(path.join(runtime,'control.lock'));}}
