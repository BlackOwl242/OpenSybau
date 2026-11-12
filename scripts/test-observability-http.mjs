import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { resolve, join } from "node:path";
import { within } from "../src/server/fs-security.mjs";
import { request as httpRequest } from "node:http";
const testPassword="opensybau-test-password-16",auth="Basic "+Buffer.from("opensybau:"+testPassword).toString("base64");
const fetch=(url,options={})=>globalThis.fetch(url,{...options,headers:{Authorization:auth,...options.headers}});
const parent=resolve(".runtime");await fs.mkdir(parent,{recursive:true});
const root=await fs.mkdtemp(join(parent,"observability-http-"));
const data=join(root,"data"),repo=join(root,"repo");
await fs.mkdir(data);await fs.mkdir(repo);await fs.writeFile(join(repo,"AGENTS.md"),"Use this registered test workspace only. Do not delegate.");
await fs.writeFile(join(repo,"marker.txt"),"HTTP_OBSERVABILITY_OK");
execFileSync("git",["init",repo],{windowsHide:true,stdio:"ignore"});
let child,base,stderr="";
async function start(){
  stderr="";
  child=spawn(process.execPath,["server.mjs"],{cwd:process.cwd(),windowsHide:true,stdio:["ignore","pipe","pipe"],env:{...process.env,WORKBENCH_DATA_DIR:data,WORKBENCH_PORT:"0",WORKBENCH_HOST:"127.0.0.1",WORKBENCH_MODE:"production",WORKBENCH_ALLOW_NETWORK:"false",WORKBENCH_ACCESS_USERNAME:"opensybau",WORKBENCH_ACCESS_PASSWORD:testPassword,WORKBENCH_ALLOWED_HOSTS:"",OPENSYBAU_DESKTOP:"0"}});
  child.stderr.on("data",chunk=>stderr+=chunk.toString());
  await new Promise((yes,no)=>{const timer=setTimeout(()=>no(new Error("Server startup timeout: "+stderr.slice(-1000))),20000);let output="";
    child.stdout.on("data",chunk=>{output+=chunk.toString();const match=output.match(/OpenSybau ready at (http:\/\/127.0.0.1:\d+)/);if(match){base=match[1];clearTimeout(timer);yes();}});
    child.once("exit",code=>{clearTimeout(timer);no(new Error(`Server exited ${code}: ${stderr.slice(-1000)}`));});
  });
}
async function stop(){if(!child||child.exitCode!==null)return; const closed=new Promise(resolve=>child.once("exit",resolve));child.kill();await closed;}
async function api(path,body){const response=await fetch(base+path,{method:body===undefined?"GET":"POST",headers:{Origin:base,"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});const value=await response.json();assert.equal(response.ok,true,`${response.status}: ${JSON.stringify(value)}`);return value;}
try {
  await start();const initial=await api("/api/state");assert.equal(initial.tasks.length,0);assert.equal(initial.workspaces.length,0);
  assert.equal((await globalThis.fetch(base+"/api/state")).status,401);
  const rejectedHost=await new Promise((resolve,reject)=>{const req=httpRequest(base+"/api/state",{headers:{Host:"192.168.44.55:4173",Authorization:auth}},response=>{response.resume();resolve(response.statusCode);});req.on("error",reject);req.end();});assert.equal(rejectedHost,403);
  assert.equal((await fetch(base+"/api/connection-config",{method:"POST",headers:{Origin:"https://untrusted.example","Content-Type":"application/json"},body:"{}"})).status,403);
  const oldEtag=(await fetch(base+"/api/state")).headers.get("etag");
  for(let i=0;i<2;i++){const controller=new AbortController();const stream=await fetch(base+"/api/events",{signal:controller.signal});const reader=stream.body.getReader();const chunk=await reader.read();assert.match(new TextDecoder().decode(chunk.value),/event: connected/);controller.abort();await reader.cancel().catch(()=>{});}
  const shortPassword=await fetch(base+"/api/connection-config",{method:"POST",headers:{Origin:base,"Content-Type":"application/json"},body:JSON.stringify({password:"short"})});assert.equal(shortPassword.status,400);
  const invalidHost=await fetch(base+"/api/connection-config",{method:"POST",headers:{Origin:base,"Content-Type":"application/json"},body:JSON.stringify({password:"test-password-long-enough",allowedHosts:["*"]})});assert.equal(invalidHost.status,400);
  const added=await api("/api/workspaces",{path:repo});const workspace=added.workspace;
  assert.ok(workspace.id);
  const inventory=await api(`/api/workspaces/${workspace.id}/customizations`);assert.ok(inventory.entries.some(item=>item.source==="AGENTS.md"));
  assert.equal((await fetch(base+"/api/workspaces/missing/customizations")).status,404);
  const unsafe=await fetch(`${base}/api/workspaces/${workspace.id}/file?path=${encodeURIComponent("../data/state.json")}`);assert.equal(unsafe.ok,false);
  const models=await api("/api/connectors");const model=models.codex.models.find(item=>item.efforts?.length);
  assert.ok(model,"A real installed Codex model is required for this opt-in live test");
  const created=await api("/api/tasks",{workspaceId:workspace.id,workflow:"chat-only",chatProvider:"codex",chatModel:model.id,chatEffort:model.efforts[0],codexTransport:"app-server",permissionPreset:"read-only",prompt:"Read marker.txt with exactly one terminal command. Reply only with its contents. Do not edit files or delegate."});
  let task;const deadline=Date.now()+90000;
  do{const state=await api("/api/state");task=state.tasks.find(item=>item.id===created.task.id);if(["done","failed","cancelled"].includes(task?.status))break;await new Promise(resolve=>setTimeout(resolve,200));}while(Date.now()<deadline);
  assert.equal(task.status,"done",task.error||"Live task timeout");assert.match(task.chatMessages.at(-1).content,/HTTP_OBSERVABILITY_OK/);
  assert.ok(task.commandActivities.some(item=>item.status==="completed"));
  assert.equal(task.stageMetrics.at(-1).transport,"app-server");
  const preview=await api(`/api/workspaces/${workspace.id}/file?path=marker.txt&taskId=${task.id}`);assert.match(JSON.stringify(preview),/HTTP_OBSERVABILITY_OK/);
  const taskId=task.id;
  const writable=await fetch(`${base}/api/tasks/${taskId}`,{method:"PATCH",headers:{Origin:base,"Content-Type":"application/json"},body:JSON.stringify({permissionPreset:"workspace-write"})});assert.equal(writable.ok,true);
  await fs.writeFile(join(repo,"package.json"),JSON.stringify({scripts:{test:"node wait.cjs"}}));
  await fs.writeFile(join(repo,"wait.cjs"),"process.stdout.write('waiting');setTimeout(()=>{},30000);");
  const qaPending=api(`/api/tasks/${taskId}/exec`,{command:"npm test"});qaPending.catch(()=>{});
  let job;const qaDeadline=Date.now()+10000;
  do{job=(await api("/api/state")).tasks.find(item=>item.id===taskId).terminalHistory?.[0];if(job?.cancellable)break;await new Promise(resolve=>setTimeout(resolve,50));}while(Date.now()<qaDeadline);
  assert.ok(job?.cancellable,"Managed QA process must expose a real cancellable job");
  await api(`/api/tasks/${taskId}/terminal/${job.id}/stop`,{});
  const cancelled=await qaPending;assert.equal(cancelled.result.status,"cancelled");assert.equal(cancelled.task.status,"done");
  const later=await api(`/api/tasks/${taskId}/exec`,{command:"git status"});assert.equal(later.result.status,"passed");
  await stop();
  // Crash-recovery fixture belongs only to this isolated test data directory.
  const stateFile=join(data,"state.json"),saved=JSON.parse(await fs.readFile(stateFile,"utf8"));
  saved.tasks.push({id:"interrupted-fixture",workspaceId:workspace.id,status:"running",config:{workflow:"chat-only"},liveControl:{turnId:"old"},pendingApprovals:[{id:1}],chatMessages:[{id:"uncertain",delivery:"steer",status:"sending",content:"do not replay"}],commandActivities:[{id:"in-flight",status:"running"}],terminalHistory:[{status:"running"}],subagents:[{id:"unfinished",status:"running"}]});
  await fs.writeFile(stateFile,JSON.stringify(saved));await start();
  const recovery=await api("/api/state"),restored=recovery.tasks.find(item=>item.id===taskId),interrupted=recovery.tasks.find(item=>item.id==="interrupted-fixture");
  assert.equal(restored.status,"done");assert.ok(restored.commandActivities.length);assert.equal(restored.liveControl,undefined);assert.equal(restored.pendingApprovals.length,0);
  assert.equal(interrupted.status,"failed");assert.equal(interrupted.liveControl,undefined);assert.equal(interrupted.pendingApprovals.length,0);assert.equal(interrupted.commandActivities[0].status,"unknown");assert.equal(interrupted.terminalHistory[0].status,"unknown");assert.equal(interrupted.subagents[0].status,"unknown");assert.equal(interrupted.chatMessages[0].status,"unknown");
  assert.notEqual((await fetch(base+"/api/state")).headers.get("etag"),oldEtag);
  console.log("Real HTTP task creation → Codex command stream → completion → safe preview → process restart and persisted recovery passed.");
} finally {await stop();assert.ok(within(parent,root)&&root!==parent);await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
