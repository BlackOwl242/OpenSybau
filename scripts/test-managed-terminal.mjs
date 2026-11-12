import assert from "node:assert/strict";
import { createTaskStageRunner } from "../src/server/task-stage-runner.mjs";

let finish;
const events = [];
const task = { id: "test", permissionPreset: "workspace-write" };
const runner = createTaskStageRunner({
  running: new Map(), isShuttingDown: () => false, getState: () => ({ tasks: [] }),
  record: (...args) => events.push(args), schedulePersist() {}, schedulePublish() {},
  run: () => new Promise((resolve) => { finish = resolve; }),
});
const pending = runner.runTaskQaCheck(task, process.cwd(), "git status");
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(task.terminalHistory[0].status, "running");
assert.equal(task.terminalHistory[0].source, "opensybau");
finish({ code: 0, stdout: "ok", stderr: "" });
await pending;
assert.equal(task.terminalHistory.length, 1);
assert.equal(task.terminalHistory[0].status, "passed");
assert.equal(task.terminalHistory[0].output, "ok");
console.log("Managed terminal lifecycle passed.");
let finishCancelled,kills=0;
const cancelledTask={id:"cancelled-command",permissionPreset:"workspace-write"};
const cancellableRunner=createTaskStageRunner({running:new Map(),isShuttingDown:()=>false,getState:()=>({tasks:[]}),record(){},schedulePersist(){},schedulePublish(){},killTree:()=>kills++,run:(_exe,_args,options)=>new Promise(resolve=>{finishCancelled=resolve;options.onSpawn({pid:123});})});
const command=cancellableRunner.runTaskQaCheck(cancelledTask,process.cwd(),"git status");
await new Promise(resolve=>setTimeout(resolve,10));
assert.equal(cancelledTask.terminalHistory[0].cancellable,true);
const commandId=cancelledTask.terminalHistory[0].id;
assert.equal(cancellableRunner.cancelManagedCommand("wrong-task",commandId),false);
assert.equal(cancellableRunner.cancelManagedCommand(cancelledTask.id,commandId),true);
assert.equal(cancellableRunner.cancelManagedCommand(cancelledTask.id,commandId),false);
assert.equal(kills,1);finishCancelled({code:-1,stdout:"",stderr:""});
assert.equal((await command).status,"cancelled");assert.equal(cancelledTask.terminalHistory[0].cancellable,false);
