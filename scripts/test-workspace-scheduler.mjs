import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createTaskRunnerService } from "../src/server/task-runner.mjs";
import { workspaceLockKey } from "../src/server/fs-security.mjs";
const exec=promisify(execFile),root=await fs.mkdtemp(join(tmpdir(),"opensybau-scheduler-")),repo=join(root,"repo");
async function git(cwd,args){try{const {stdout,stderr}=await exec("git",args,{cwd,windowsHide:true});return {code:0,stdout,stderr};}catch(error){return {code:error.code||1,stdout:error.stdout||"",stderr:error.stderr||error.message};}}
const active=new Map(),running=new Map(),busy=new Set(),isolated=new Map();let stopped=false;
const shared=(id,ws="root",isolation=false)=>({id,workspaceId:ws,status:"queued",origin:"local",isolated:isolation,prompt:"Verify scheduler",config:{workflow:"chat-only",chatProvider:"codex",chatModel:"fixture",chatEffort:"fixture"},chatQueue:[],events:[],createdAt:new Date().toISOString()});
const state={settings:{maxConcurrent:3},tasks:[],workspaces:[]};
try {
  await exec("git",["init",repo],{windowsHide:true});await git(repo,["config","user.email","scheduler@local.test"]);await git(repo,["config","user.name","Scheduler Test"]);
  await fs.mkdir(join(repo,"sub"));await fs.writeFile(join(repo,"sub/index.txt"),"base");await git(repo,["add","."]);await git(repo,["commit","-m","test baseline"]);
  async function inspect(path){const head=await git(path,["rev-parse","HEAD"]),top=await git(path,["rev-parse","--show-toplevel"]);return {path,gitRoot:top.stdout.trim(),isGit:head.code===0,head:head.stdout.trim(),dirty:false};}
  state.workspaces=[{id:"root",path:repo,runtime:await inspect(repo)},{id:"sub",path:join(repo,"sub"),runtime:await inspect(join(repo,"sub"))}];
  const locks=new Map();async function repoLock(key,fn){const prior=locks.get(key)||Promise.resolve();let release;const next=new Promise(resolve=>release=resolve);locks.set(key,prior.then(()=>next));await prior;try{return await fn();}finally{release();}}
  const runner=createTaskRunnerService({taskDir:join(root,"tasks"),worktreeDir:join(root,"worktrees"),getState:()=>state,running,busyWorkspaces:busy,isolatedWorkspaces:isolated,isShuttingDown:()=>stopped,persist(){},publish(){},record(task,text,kind){task.events.push({text,kind});},safeError:error=>error.message,git,withGitRepoLock:repoLock,inspectWorkspace:inspect,relevantMemory:()=>[],autoDistillTaskMemory(){},
    skillCatalogService:{loadSkillCatalog:async()=>[],resolveSelectedSkills:async()=>[],selectTaskSkillsProgressive:()=>({scoredCandidates:[],skillIds:[],progressiveSkills:[]}),stageAntigravitySkillBundles:async()=>[],stageAntigravitySkills:async()=>[]},
    promptService:{makeInitialChatPrompt:()=>"fixture",makeChatPrompt:()=>"fixture",makePrompt:()=>"fixture"},
    stageRunner:{assertTaskActive(){},areTaskDependenciesMet:()=>true,runTaskQaCheck:async()=>{},spawnStage:(task,_provider,_stage,cwd)=>new Promise(resolve=>active.set(task.id,{cwd,finish:()=>{active.delete(task.id);resolve("verified");}}))},
  });
  async function until(predicate){const end=Date.now()+10000;while(!predicate()){assert.ok(Date.now()<end,JSON.stringify(state.tasks.map(task=>({id:task.id,status:task.status,error:task.error}))));await new Promise(resolve=>setTimeout(resolve,20));}}
  state.tasks=[shared("shared-1"),shared("shared-2","sub"),shared("isolated-1","root",true),shared("isolated-2","root",true)];runner.pump();
  await until(()=>active.size===3);
  assert.ok(active.has("shared-1"));assert.equal(state.tasks[1].status,"queued");
  const dirs=[...active.values()].map(item=>resolve(item.cwd));assert.equal(new Set(dirs).size,3);assert.ok(dirs.includes(resolve(repo)));
  assert.equal(busy.has(workspaceLockKey(repo)),true);
  active.get("shared-1").finish();await until(()=>active.has("shared-2"));assert.equal(active.size,3);
  assert.equal(active.get("shared-2").cwd,join(repo,"sub"));
  for(const entry of [...active.values()])entry.finish();await until(()=>state.tasks.every(task=>task.status==="done")&&running.size===0);
  assert.equal(busy.size,0);assert.equal(isolated.size,0);assert.ok(state.tasks.every(task=>task.origin==="local"&&task.executionPath&&task.events.length));
  for(const task of state.tasks.filter(task=>task.isolated))await runner.discardTaskWorktree(task);
  console.log("Real scheduler and Git: shared repository/subdirectory serialization, two concurrent isolated worktrees, provenance and lock cleanup passed.");
} finally {stopped=true;for(const entry of active.values())entry.finish();await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
