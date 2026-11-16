import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createApp } from '../apps/api/src/app.js';
import { provision, signIn, client, browserHeaders } from './auth-fixture.js';
import { backupDatabase, restoreFresh } from '../apps/api/src/snapshot.js';
import { openPresentations } from '../apps/api/src/presentations-store.js';

test('private HTML: CRUD, source isolation, restart, paired snapshot and restore', async () => {
  const root=resolve('data/qa'); mkdirSync(root,{recursive:true});
  const dir=mkdtempSync(join(root,'presentations-'));
  const credentials=await provision(dir);
  let raw=createApp(dir);
  let app=client(raw,await signIn(raw,credentials));
  try {
    assert.equal((await raw.inject({url:'/api/presentations',headers:browserHeaders})).statusCode,401);
    const workspace=(await app.inject('/api/workspace')).body;
    const input={title:'测试课件',description:'验证持久化',filename:'水利.html',html:'<!doctype html><html><body>教学内容<script>document.body.dataset.ready="yes"</script></body></html>'};
    const saved=await app.inject({method:'POST',url:'/api/presentations',payload:input});
    assert.equal(saved.statusCode,201);
    const id=saved.json().id;
    const content=await app.inject('/api/presentations/'+id+'/content');
    assert.equal(content.body,input.html);
    assert.match(String(content.headers['content-security-policy']),/sandbox allow-scripts;/);
    assert.doesNotMatch(String(content.headers['content-security-policy']),/allow-same-origin/);
    assert.equal((await app.inject('/api/presentations/'+id+'/download')).body,input.html);
    assert.equal((await app.inject({method:'POST',url:'/api/presentations',payload:{...input,filename:'../bad.html'}})).statusCode,400);
    assert.equal((await app.inject({method:'POST',url:'/api/presentations',payload:{...input,html:'not html'}})).statusCode,400);
    await app.close(); raw=createApp(dir); app=client(raw,await signIn(raw,credentials));
    assert.equal((await app.inject('/api/presentations')).json().length,1);
    assert.equal((await app.inject('/api/workspace')).body,workspace);
    assert.equal((await app.inject({method:'PUT',url:'/api/presentations/'+id,payload:{...input,title:'新版'}})).statusCode,200);
    const archive=await backupDatabase(dir,join(dir,'archives'),2,30);
    await restoreFresh(join(dir,'archives',archive.name),join(dir,'restored'));
    const restored=openPresentations(join(dir,'restored'));
    try { assert.equal(restored.get(id).title,'新版'); assert.equal(restored.get(id).html,input.html); } finally { restored.close(); }
    assert.equal((await app.inject({method:'DELETE',url:'/api/presentations/'+id})).statusCode,204);
    assert.equal((await app.inject('/api/presentations/'+id+'/content')).statusCode,404);
    assert.equal((await app.inject('/api/workspace')).body,workspace);
  } finally { await app.close(); }
});
