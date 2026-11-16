import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { existsSync,mkdirSync,readdirSync,renameSync,statSync,unlinkSync } from 'node:fs';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {backupSchema} from '@classflow/shared/validation';
import {notices,tasks,handbook} from './schema.js';
import {presentationInput} from '@classflow/shared/presentations';

function inspectPresentations(file:string) {
  const sql=new Database(file,{readonly:true,fileMustExist:true});
  try {
    if(sql.pragma('user_version',{simple:true})!==1 || sql.pragma('integrity_check',{simple:true})!=='ok') throw new Error('课件快照损坏或版本不兼容');
    const digest=createHash('sha256');
    for(const row of sql.prepare('SELECT * FROM presentations ORDER BY id').iterate() as Iterable<Record<string,unknown>>) {
      presentationInput.parse({title:row.title,description:row.description,filename:row.filename,html:row.html});
      digest.update(JSON.stringify(row)+'\n');
    }
    return digest.digest('hex');
  } finally { sql.close(); }
}

function inspect(file:string) {
  const sql=new Database(file,{readonly:true,fileMustExist:true});
  try{
    const version = sql.pragma('user_version',{simple:true});
    if((version!==1 && version!==2) || sql.pragma('integrity_check',{simple:true})!=='ok' || (sql.pragma('foreign_key_check') as unknown[]).length)
      throw new Error('业务库版本、完整性或外键检查失败');
    const db=drizzle(sql);
    const copy={tasks:db.select().from(tasks).orderBy(tasks.id).all(),notices:db.select().from(notices).orderBy(notices.id).all(),...(version===2 ? {handbook:db.select().from(handbook).orderBy(handbook.id).all()} : {})};
    if(!backupSchema.safeParse({...copy,version,exportedAt:new Date().toISOString()}).success)throw new Error('业务数据校验失败');
    return {tasks:copy.tasks.length,notices:copy.notices.length,digest:createHash('sha256').update(JSON.stringify(copy)).digest('hex')};
  }finally{sql.close();}
}
async function copyDatabase(source:string,target:string) {
  const sql=new Database(source,{readonly:true,fileMustExist:true});
  try{await sql.backup(target);}finally{sql.close();}
}
const archiveName=/^classflow-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d\.\d{3}Z-[a-f0-9-]{36}\.sqlite$/;
export async function backupDatabase(directory:string,archives:string,keep:number,days:number){
  if(!Number.isSafeInteger(keep)||keep<1||!Number.isSafeInteger(days)||days<1)throw new Error('保留数量和天数必须为正整数');
  mkdirSync(archives,{recursive:true,mode:0o700});
  const name='classflow-'+new Date().toISOString().replaceAll(':','-')+'-'+randomUUID()+'.sqlite';
  const file=join(archives,name),temp=file+'.partial';
  let info;
  try{
    await copyDatabase(join(directory,'classflow.sqlite'),temp);
    info=inspect(temp);
    if(existsSync(join(directory,'presentations.sqlite'))) {
      await copyDatabase(join(directory,'presentations.sqlite'),file+'.presentations.partial');
      inspectPresentations(file+'.presentations.partial');
      renameSync(file+'.presentations.partial',file+'.presentations.sqlite');
    }
    renameSync(temp,file);
  }catch(error){
    for(const path of [temp,file+'.presentations.partial',file+'.presentations.sqlite']) {
      try{unlinkSync(path);}catch{/* 快照可能尚未创建。 */}
    }
    throw error;
  }
  const older=readdirSync(archives,{withFileTypes:true}).filter(e=>e.isFile()&&e.name!==name&&archiveName.test(e.name))
    .map(e=>e.name).sort().reverse();
  const cutoff=Date.now()-days*86400000;
  for(const [i,entry] of older.entries()){
    const path=join(archives,entry);
    if(i+1>=keep || statSync(path).mtimeMs<cutoff){unlinkSync(path);if(existsSync(path+'.presentations.sqlite'))unlinkSync(path+'.presentations.sqlite');}
  }
  return {name,...info};
}
export async function restoreFresh(source:string,target:string) {
  const expected=inspect(source);
  const companion=source+'.presentations.sqlite';
  const presentationDigest=existsSync(companion)?inspectPresentations(companion):null;
  // mkdir 的排他语义保护正在使用的旧库，也保护两个并发的恢复操作。
  mkdirSync(target,{mode:0o700});
  const destination=join(target,'classflow.sqlite');
  const temp=destination+'.partial';
  await copyDatabase(source,temp);
  const restored=inspect(temp);
  if(restored.digest!==expected.digest)throw new Error('恢复后的数据与备份不一致');
  if(presentationDigest){
    const restoredFile=join(target,'presentations.sqlite');
    await copyDatabase(companion,restoredFile+'.partial');
    if(inspectPresentations(restoredFile+'.partial')!==presentationDigest)throw new Error('课件恢复数据不一致');
    renameSync(restoredFile+'.partial',restoredFile);
  }
  renameSync(temp,destination);
  return restored;
}
