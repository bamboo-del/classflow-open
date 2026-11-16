import {appendFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {dataDirectory} from './config.js';
import {backupDatabase,restoreFresh} from './snapshot.js';

process.umask(0o077);
const [command,source,target,...extra]=process.argv.slice(2);
const directory=dataDirectory(),archives=process.env.CLASSFLOW_BACKUP_DIR??join(directory,'archives');
try{
  let result;
  if(command==='create' && !source)result=await backupDatabase(directory,archives,Number(process.env.CLASSFLOW_BACKUP_KEEP??14),Number(process.env.CLASSFLOW_BACKUP_DAYS??30));
  else if(command==='restore' && source && target && !extra.length)result=await restoreFresh(source,target);
  else throw new Error('用法：backup-cli create 或 restore <快照路径> <不存在的新目录>');
  console.log(JSON.stringify(result));
}catch(e){
  const msg=new Date().toISOString()+' '+command+' 失败：'+(e instanceof Error?e.message:'未知错误');
  console.error(msg);
  try{mkdirSync(archives,{recursive:true,mode:0o700});appendFileSync(join(archives,'backup-failures.log'),msg+'\n',{mode:0o600});}catch{/* 磁盘或权限故障由调度器保留标准错误。 */}
  process.exitCode=1;
}
