import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { CodexAppServer } from "../src/server/codex-app-server.mjs";
const version = execFileSync("codex",["--version"],{encoding:"utf8",windowsHide:true}).trim();
const models = JSON.parse(execFileSync("codex",["debug","models"],{encoding:"utf8",windowsHide:true})).models;
const model = models.find(item=>item.slug&&item.visibility!=="hidden"&&item.supported_reasoning_levels?.length);
const cwd = await fs.mkdtemp(join(tmpdir(),"opensybau-live-control-"));
await fs.writeFile(join(cwd,"marker.txt"),"OBSERVABILITY_MARKER");
const events = [];
let output="", steer, complete, fail;
const completion = new Promise((resolve,reject)=>{complete=resolve;fail=reject;}); completion.catch(()=>{});
const client = new CodexAppServer("codex",{cwd,args:["--disable","multi_agent","--disable","multi_agent_v2"],onEvent(message){
  if (["turn/started","turn/completed","item/started","item/completed","thread/tokenUsage/updated"].includes(message.method)) events.push(message);
  if (message.method==="item/agentMessage/delta") output+=message.params.delta;
  if (message.method==="item/started" && message.params.item?.type==="commandExecution" && !steer) {
    steer=client.steer("After the command, reply STEER_OK only instead of ORIGINAL.",client.turnId,"live-steer-0001"); steer.catch(fail);
  }
  if(message.method==="turn/completed") message.params.turn.status==="completed"?complete():fail(new Error(message.params.turn.error?.message||message.params.turn.status));
},onRequest(message,instance){instance.respond(message.id,{decision:"decline"});}});
client.onDisconnect=fail;
const timer=setTimeout(()=>{fail(new Error("Live control timeout"));void client.close();},90000);
try {
  await client.initialize();
  const thread=await client.request("thread/start",{cwd,model:model.slug,sandbox:"read-only",approvalPolicy:"never",ephemeral:true,config:process.platform==="win32"?{"windows.sandbox":"unelevated"}:{}});
  client.threadId=thread.thread.id;
  await client.request("turn/start",{threadId:client.threadId,effort:model.supported_reasoning_levels[0].effort,input:[{type:"text",text:"You are a protocol integration test. Use exactly one terminal tool to read marker.txt in the current directory. Then reply ORIGINAL. Do not delegate, edit files or inspect other paths."}]});
  await completion;
  assert.ok(steer,"CLI must produce a real command event"); await steer;
  assert.match(output,/STEER_OK/);
  assert.ok(events.some(event=>event.method==="item/completed"&&event.params.item?.type==="commandExecution"&&event.params.item.exitCode===0));
  if(process.argv.includes("--capture")) {
    const fixture=JSON.stringify({version,model:model.slug,provenance:"captured-live-redacted",events},null,2).replaceAll(cwd.replaceAll("\\","\\\\"),"<WORKSPACE>").replaceAll(cwd.replaceAll("\\","/"),"<WORKSPACE>").replaceAll(homedir().replaceAll("\\","\\\\"),"<HOME>").replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,"<SESSION_ID>");
    await fs.mkdir(new URL("./fixtures/",import.meta.url),{recursive:true});
    await fs.writeFile(new URL("./fixtures/codex-app-server-live.json",import.meta.url),fixture+"\n");
  }
  console.log(`Real ${version} command stream, active-turn steering and completion passed.`);
} finally {clearTimeout(timer);client.onDisconnect=null;await client.close();await fs.rm(cwd,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
