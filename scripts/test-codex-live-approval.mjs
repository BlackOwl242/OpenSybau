import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { CodexAppServer } from "../src/server/codex-app-server.mjs";
import { CliApprovalQueue } from "../src/server/cli-approval-queue.mjs";
const models=JSON.parse(execFileSync("codex",["debug","models"],{encoding:"utf8",windowsHide:true})).models;
const model=models.find(item=>item.slug&&item.visibility!=="hidden"&&item.supported_reasoning_levels?.length);
const cwd=await fs.mkdtemp(join(tmpdir(),"opensybau-approval-live-"));
try{for(const decision of ["decline","accept"]){
  let finish,fail,requests=0;const completion=new Promise((resolve,reject)=>{finish=resolve;fail=reject;});completion.catch(()=>{});const task={pendingApprovals:[]};
  const client=new CodexAppServer("codex",{cwd,args:["--disable","multi_agent","--disable","multi_agent_v2"],onEvent(message){if(message.method==="turn/completed")finish();},onRequest(message){
    if(message.method==="item/commandExecution/requestApproval"){
      requests++;assert.equal(client.approvals.add(message),true);assert.equal(client.approvals.resolve(message.id,message.params.turnId,decision),true);
    }else{client.child.stdin.write(JSON.stringify({id:message.id,error:{code:-32601,message:"Unsupported test request"}})+"\n");}
  }});
  client.approvals=new CliApprovalQueue(task,client);client.onDisconnect=fail;const timer=setTimeout(()=>{fail(new Error("Approval test timeout"));void client.close();},60000);
  try{
    await client.initialize();const {thread}=await client.request("thread/start",{cwd,model:model.slug,sandbox:"read-only",approvalPolicy:"on-request",ephemeral:true,config:process.platform==="win32"?{"windows.sandbox":"unelevated"}:{}});client.threadId=thread.id;
    await client.request("turn/start",{threadId:thread.id,effort:model.supported_reasoning_levels[0].effort,input:[{type:"text",text:"This is an approval protocol test. Invoke exactly one terminal command to print APPROVAL_TEST, explicitly setting sandbox_permissions to require_escalated and giving an approval justification. Do not read or edit any file, delegate, or retry a denied command. After the decision, reply DONE. The command must only print the test marker."}]});
    await completion;assert.equal(requests,1,`Expected one real approval request for ${decision}`);assert.equal(task.pendingApprovals.length,0);
    console.log(`Real Codex approval request → ${decision} → completed turn passed.`);
  }finally{clearTimeout(timer);client.onDisconnect=null;await client.close();client.approvals.close();}
}}finally{await fs.rm(cwd,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
