import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync,mkdtempSync,rmSync,existsSync,writeFileSync,utimesSync } from 'node:fs';
import { join,resolve } from 'node:path';
import {openRepository} from '../apps/api/src/repository.js';
import {backupDatabase,restoreFresh} from '../apps/api/src/snapshot.js';
import Database from 'better-sqlite3';

test('SQLite 在线快照、保留策略、独立恢复、拒绝损坏和覆盖',async t=>{
  const qa=resolve('data/qa');mkdirSync(qa,{recursive:true});const root=mkdtempSync(join(qa,'drill-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const live=join(root,'live'),archives=join(root,'archive');
  const repo=openRepository(live);
  try{
    const n=repo.createNotice({source:'验收',original:'核对名单',notes:'',receivedAt:new Date().toISOString()});
    repo.saveTask({title:'核对名单',description:'',category:'材料',priority:'中',status:'待办',dueDate:'2026-11-12',dueTime:null,assignee:'',sourceNoticeId:n.id,visibility:'私人'});
    const first=await backupDatabase(live,archives,2,3);
    utimesSync(join(archives,first.name),new Date(0),new Date(0));
    const second=await backupDatabase(live,archives,2,3);
    assert.ok(!existsSync(join(archives,first.name)));
    const third=await backupDatabase(live,archives,1,3);
    assert.ok(!existsSync(join(archives,second.name)));
    const src=join(archives,third.name),target=join(root,'restored');
    assert.deepEqual(await restoreFresh(src,target),{tasks:1,notices:1,digest:third.digest});
    const copy=openRepository(target);
    try{assert.deepEqual(copy.workspace(),repo.workspace());}finally{copy.close();}
    await assert.rejects(restoreFresh(src,live),/EEXIST/);
    writeFileSync(join(root,'bad.sqlite'),'damaged');
    await assert.rejects(restoreFresh(join(root,'bad.sqlite'),join(root,'bad-restore')));
    const db=new Database(src);db.pragma('foreign_keys=OFF');db.prepare("UPDATE tasks SET sourceNoticeId='missing'").run();db.close();
    await assert.rejects(restoreFresh(src,join(root,'broken-link')),/外键/);
    assert.equal(repo.workspace().tasks.length,1);
  }finally{repo.close();}
});
