import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import https from 'node:https';
import process from 'node:process';
import console from 'node:console';
import { setTimeout as delay } from 'node:timers/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const cwd=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const project='classflow-qa-'+randomBytes(6).toString('hex');
const origin='https://localhost:19443';
const env={...process.env,CLASSFLOW_IMAGE:process.env.CLASSFLOW_QA_IMAGE??'classflow:stage2-qa',CLASSFLOW_ORIGIN:origin,
  CLASSFLOW_LOOPBACK_PORT:'19318',CLASSFLOW_QA_TLS_PORT:'19443',CLASSFLOW_DATA_SLOT:'live',CLASSFLOW_TRUST_PROXY:''};
function docker(args,input) {
  const p=spawnSync('docker',args,{cwd,env,encoding:'utf8',input,windowsHide:true,timeout:240000});
  if(p.status!==0)throw new Error((p.stderr||p.error?.message||'Docker failed').slice(-2000));
  return p.stdout.trim();
}
const compose=(args,input)=>docker(['compose','-p',project,'-f','compose.yaml','-f','deploy/qa.compose.yaml',...args],input);
const appExec=(args,input)=>compose(['exec','-T','app',...args],input);
const password=randomBytes(32).toString('base64url');
let ca,cookie='',browser;
function request(path,method='GET',data){
  return new Promise((resolve,reject)=>{
    const body=data===undefined?undefined:JSON.stringify(data);
    const req=https.request(origin+path,{ca,family:4,method,timeout:5000,headers:{origin,cookie,'x-classflow-request':'1',...(body?{'content-type':'application/json'}:{})}},res=>{
      let text='';res.setEncoding('utf8');res.on('data',b=>text+=b);
      res.on('end',()=>resolve({status:res.statusCode,text,headers:res.headers}));
    });req.on('timeout',()=>req.destroy(new Error('HTTPS timed out')));req.on('error',reject);req.end(body);
  });
}
async function ready() {
  let last='';
  for(let i=0;i<55;i++){
    try {const response=await request('/healthz');if(response.status===200 && JSON.parse(response.text).ok)return;last=String(response.status);}
    catch(e){last=e.message;}
    await delay(1000);
  }
  throw new Error('HTTPS 健康检查失败 '+last);
}
try{
  assert.equal(docker(['ps','-aq','--filter','label=com.docker.compose.project='+project]),'');
  compose(['up','-d','--no-build','--wait','--wait-timeout','100']);
  for(let i=0;i<25;i++){
    try{ca=compose(['exec','-T','tls','cat','/data/caddy/pki/authorities/local/root.crt']);break;}catch{await delay(500);}
  }
  assert.ok(ca);await ready();
  const id=compose(['ps','-q','app']);
  const inspect=JSON.parse(docker(['inspect',id]))[0];
  assert.equal(inspect.State.Health.Status,'healthy');assert.equal(inspect.Config.User,'node');
  assert.equal(inspect.NetworkSettings.Ports['4318/tcp'][0].HostIp,'127.0.0.1');
  appExec(['node','-e',"const fs=require('fs'); for(const p of ['node_modules/typescript','node_modules/@playwright/test','node_modules/vite','/app/.env','/app/tests','/app/data'])if(fs.existsSync(p))process.exit(1);"]);
  assert.equal((await request('/api/backup')).status,401);
  assert.match((await request('/')).text,/ClassFlow/);
  appExec(['node','apps/api/dist/admin.js','init','qa','--password-stdin'],password+'\n');
  const login=async()=>{
    const res=await request('/api/auth/login','POST',{username:'qa',password});
    assert.equal(res.status,200,res.text);const header=res.headers['set-cookie'][0];
    assert.match(header,/Secure/);assert.match(header,/HttpOnly/);cookie=header.split(';')[0];
  };
  await login();
  const n=await request('/api/notices','POST',{source:'HTTPS 验收',original:'提交材料并安排会议。',notes:'内部',receivedAt:new Date().toISOString()});
  assert.equal(n.status,201,n.text);
  for(const title of ['提交材料','安排会议']){
    const t=await request('/api/tasks','POST',{title,description:'',category:'其他',priority:'中',status:'待办',dueDate:'2026-11-15',dueTime:null,assignee:'',sourceNoticeId:JSON.parse(n.text).id,visibility:'私人'});
    assert.equal(t.status,201,t.text);
  }
  const snapshot=async()=>{const res=await request('/api/workspace');assert.equal(res.status,200,res.text);return JSON.parse(res.text);};
  const initial=await snapshot();
  // 使用独立临时 CA。上面的 HTTPS 客户端已独立验证证书链和主机名。
  browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined});
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:390,height:844}});
  const page=await context.newPage();
  await page.goto(origin);await page.getByLabel('管理员账号').fill('qa');await page.getByLabel('密码',{exact:true}).fill(password);
  await page.getByRole('button',{name:'登录',exact:true}).click();
  await page.getByRole('heading',{name:'截止待办'}).waitFor();
  await page.getByRole('button',{name:'退出',exact:true}).click();await page.getByLabel('管理员账号').waitFor();
  await browser.close();browser=undefined;
  const archive=JSON.parse(appExec(['node','apps/api/dist/backup-cli.js','create']));
  assert.equal(archive.tasks,2);assert.equal(archive.notices,1);
  const file='/var/backups/classflow/'+archive.name;
  appExec(['node','-e',"if((require('fs').statSync(process.argv[1]).mode & 0o077)!==0)process.exit(1)",file]);
  const restore=JSON.parse(appExec(['node','apps/api/dist/backup-cli.js','restore',file,'/var/lib/classflow/drill']));
  assert.equal(restore.digest,archive.digest);
  // 让应用进程异常退出，验证 Docker 自己的重启策略。避免 Docker 手动 stop/kill 的特殊语义。
  await delay(10500);
  appExec(['node','-e',"const fs=require('fs');const pid=fs.readdirSync('/proc').find(p=>/^\\d+$/.test(p)&&p!==String(process.pid)&&fs.readFileSync('/proc/'+p+'/cmdline','utf8').startsWith('node\\0apps/api/dist/server.js'));if(!pid)throw Error('PID missing');process.kill(Number(pid),'SIGKILL')"]);
  await ready();assert.deepEqual(await snapshot(),initial);
  assert.ok(Number(docker(['inspect','--format','{{.RestartCount}}',id]))>=1);
  compose(['up','-d','--no-build','--force-recreate','--wait','app']);await ready();
  assert.notEqual(compose(['ps','-q','app']),id);assert.deepEqual(await snapshot(),initial);
  env.CLASSFLOW_DATA_SLOT='drill';compose(['up','-d','--no-build','--force-recreate','--wait','app']);await ready();
  assert.equal((await request('/api/workspace')).status,401);
  appExec(['node','apps/api/dist/admin.js','init','qa','--password-stdin'],password+'\n');
  await login();assert.deepEqual(await snapshot(),initial);
  console.log('PASS HTTPS trust, production mobile login, isolated ports, health, non-root, clean runtime, online backup, crash restart, container recreation and separate restore',JSON.stringify({tasks:restore.tasks,notices:restore.notices}));
} finally{
  await browser?.close();
  // 仅回收本次生成的唯一 QA 项目和测试卷。
  compose(['down','--volumes']);
}
