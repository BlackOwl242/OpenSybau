import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { join, resolve, basename } from "node:path";
import { view } from "../src/shared/state.js";
import { THEMES } from "../src/shared/themes.js";
import { renderOrcaRightDockMarkup } from "../src/features/workbench/right-dock.js";
import { settingsPage } from "../src/features/workbench/pages/settings-page.js";
import { within } from "../src/server/fs-security.mjs";
const chrome=process.env.CHROME_PATH||"C:/Program Files/Google/Chrome/Application/chrome.exe";
globalThis.window={opensybauDesktop:{supportsCliInstall:true},location:{hostname:"127.0.0.1"},matchMedia:()=>({matches:false})};
await fs.access(chrome);
const output=resolve(".runtime/observability-ui");await fs.mkdir(output,{recursive:true});
const profile=await fs.mkdtemp(join(output,"chrome-"));
const assets=resolve("dist/assets");const names=await fs.readdir(assets);const css=names.find(name=>/^index-.*\.css$/.test(name));assert.ok(css,"Build first");
const fixture=JSON.parse(await fs.readFile(new URL("./fixtures/codex-app-server-live.json",import.meta.url),"utf8"));
const command=fixture.events.find(event=>event.method==="item/completed"&&event.params.item?.type==="commandExecution")?.params.item;
const task={id:"visual-regression",workspaceId:"workspace",title:"Observability regression fixture",status:"running",phase:"build",updatedAt:"2026-11-12T10:00:00Z",createdAt:"2026-11-12T09:00:00Z",config:{chatProvider:"codex",roles:{plan:{provider:"codex"},build:{provider:"codex"},review:{provider:"codex"}}},plan:"# Plan\nInspect and verify.",artifacts:["src/example.js"],commandActivities:[{id:command.id,command:command.command,status:"completed",source:"codex-app-server",output:command.aggregatedOutput}],subagents:Array.from({length:24},(_,i)=>({id:`sub-${i}`,role:`Worker ${i+1}`,harness:i%2?"claude":"codex",status:i<2?"running":i===2?"unknown":"completed",lastActivity:"Reading source and verifying behavior",updatedAt:"2026-11-12T10:00:00Z"}))};
view.state={tasks:[task],workspaces:[{id:"workspace",name:"Regression workspace",path:"D:/fixture"}],settings:{maxConcurrent:2,defaults:{roles:{}},schedules:[]}};
task.terminalHistory=[{id:"managed-fixture",source:"opensybau",command:"npm test",status:"running",cancellable:true}];
task.liveControl={provider:"codex",threadId:"root",turnId:"turn"};
task.pendingApprovals=[{id:1,turnId:"turn",command:"Print approval marker"}];
view.connectors={};view.providers=[];view.skills=[];view.selected=task.id;view.page="chat";
view.taskSubagentDetailCache={[task.id]:{updatedAt:task.updatedAt,subagents:task.subagents.map(sub=>({...sub,events:[{at:task.updatedAt,toolName:"Read",text:"Reading source file",status:"done"}],filesTouched:["src/example.js"]}))}};
view.selectedDockSubagentId="sub-0";
view.customizationInventory={workspace:{entries:[{name:"AGENTS.md",source:"AGENTS.md",kind:"rules",scope:"workspace",providers:["codex"],trusted:false,tokenEstimate:120},{name:"SKILL.md",source:".agents/skills/test/SKILL.md",kind:"skills",scope:"workspace",providers:["codex"],trusted:false,tokenEstimate:80}]}};
const fragments={};for(const tab of ["overview","subagents","customizations","docs","terminal"]){view.chatDrawerTab=tab;fragments[tab]=`<div class="wb-app-shell" style="display:flex;justify-content:flex-end;width:100vw;height:100vh"><aside class="orca-right-dock">${renderOrcaRightDockMarkup()}</aside></div>`;}
view.page="settings";view.settingsSection="api";fragments.settings=`<main class="wb-page-content" style="padding:16px;max-width:1100px;margin:auto">${settingsPage()}</main>`;
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,"http://127.0.0.1");
  if(url.pathname.startsWith("/assets/")&&names.includes(basename(url.pathname))){res.setHeader("Content-Type",url.pathname.endsWith(".css")?"text/css":"font/woff2");res.end(await fs.readFile(join(assets,basename(url.pathname))));return;}
  const theme=THEMES.find(item=>item.id===url.searchParams.get("theme"))||THEMES[0];const tab=url.searchParams.get("tab")||"overview";
  res.setHeader("Content-Type","text/html; charset=utf-8");res.end(`<!doctype html><html data-theme="${theme.id}" data-color-scheme="${theme.scheme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/assets/${css}"></head><body>${fragments[tab]}</body></html>`);
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));const base=`http://127.0.0.1:${server.address().port}`;
const child=spawn(chrome,["--headless=new","--no-sandbox","--disable-gpu","--remote-debugging-port=0",`--user-data-dir=${profile}`,"about:blank"],{windowsHide:true,stdio:["ignore","ignore","pipe"]});
let ws;
try {
  const debug=await new Promise((yes,no)=>{let logs="";const timer=setTimeout(()=>no(new Error("Chrome timeout")),15000);child.stderr.on("data",chunk=>{logs+=chunk;const match=logs.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);yes(match[1]);}});child.once("error",no);});
  const host=new URL(debug).host;const targets=await(await fetch(`http://${host}/json`)).json();ws=new WebSocket(targets.find(item=>item.type==="page").webSocketDebuggerUrl);
  await new Promise((yes,no)=>{ws.addEventListener("open",yes,{once:true});ws.addEventListener("error",no,{once:true});});
  let seq=0;const pending=new Map();ws.addEventListener("message",event=>{const data=JSON.parse(event.data);if(data.id){const callback=pending.get(data.id);if(callback){pending.delete(data.id);data.error?callback.reject(new Error(data.error.message)):callback.resolve(data.result);}}});
  const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  await cdp("Page.enable");const results=[];
  function measureContrast(){
    const canvas=document.createElement("canvas");canvas.width=canvas.height=1;const ctx=canvas.getContext("2d",{willReadFrequently:true});
    function rgba(color){ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].map((n,i)=>i===3?n/255:n);}
    const blend=(fg,bg)=>fg.slice(0,3).map((n,i)=>n*fg[3]+bg[i]*(1-fg[3]));
    function bg(e){if(!e)return [255,255,255];return blend(rgba(getComputedStyle(e).backgroundColor),bg(e.parentElement));}
    const lum=c=>c.map(n=>n/255).map(n=>n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4).reduce((sum,n,i)=>sum+n*[0.2126,0.7152,0.0722][i],0);
    return [...document.querySelectorAll(".orca-muted-note,.dock-overview-row,.dock-subagent-label,.orca-section-label,.dock-subagent-head-main small,.dock-subagent-ev code")].filter(e=>e.getClientRects().length&&e.textContent.trim()).map(e=>{const background=bg(e),foreground=blend(rgba(getComputedStyle(e).color),background),a=lum(background),b=lum(foreground);return {text:e.textContent.slice(0,50),ratio:(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)};});
  }
  for(const theme of THEMES)for(const width of [1280,375])for(const tab of Object.keys(fragments)){
    await cdp("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width===375});
    await cdp("Page.navigate",{url:`${base}/?theme=${theme.id}&tab=${tab}`});
    for(let i=0;i<100;i++){const ready=await cdp("Runtime.evaluate",{expression:"document.readyState==='complete'",returnByValue:true});if(ready.result.value)break;await new Promise(resolve=>setTimeout(resolve,10));}
    await cdp("Runtime.evaluate",{expression:"document.fonts.ready",awaitPromise:true});
    const evaluated=await cdp("Runtime.evaluate",{returnByValue:true,expression:`(()=>{const dock=document.querySelector('.orca-right-dock');const tabs=document.querySelector('.orca-dock-tabs');return {overflow:document.documentElement.scrollWidth>innerWidth+1,dockWidth:dock?.getBoundingClientRect().width,tabsReachable:!tabs||tabs.scrollWidth>=tabs.clientWidth,text:document.body.innerText.length,colors:[...document.querySelectorAll('.orca-muted-note,.dock-overview-row,.dock-subagent-label,.orca-tree-label')].filter(e=>e.getClientRects().length).map(e=>({text:e.textContent.slice(0,40),color:getComputedStyle(e).color,bg:getComputedStyle(dock||document.body).backgroundColor}))}})()`});
    const result={theme:theme.id,width,tab,...evaluated.result.value};results.push(result);
    const contrast=await cdp("Runtime.evaluate",{expression:`(${measureContrast.toString()})()`,returnByValue:true});result.contrast=contrast.result.value;
    assert.equal(result.overflow,false,JSON.stringify(result));assert.ok(result.text>50);if(tab!=="settings")assert.ok(result.dockWidth>200&&result.dockWidth<=Math.min(width,620));
    if(tab==="overview"){
      const commandWidth=await cdp("Runtime.evaluate",{expression:"document.querySelector('.dock-overview summary .orca-tree-label').getBoundingClientRect().width",returnByValue:true});assert.ok(commandWidth.result.value>80,"Command labels must not collapse to the status-dot grid column");
    }
    if(["obsidian","sakura-light"].includes(theme.id)&&tab==="subagents"){
      const shot=await cdp("Page.captureScreenshot",{format:"png"});await fs.writeFile(join(output,`${theme.id}-${width}.png`),Buffer.from(shot.data,"base64"));
    }
  }
  await fs.writeFile(join(output,"layout-results.json"),JSON.stringify(results,null,2));
  const lowContrast=results.flatMap(result=>(result.contrast||[]).filter(item=>item.ratio<4.5).map(item=>({theme:result.theme,width:result.width,tab:result.tab,...item})));
  assert.equal(lowContrast.length,0,JSON.stringify(lowContrast.slice(0,12),null,2));
  console.log(`${results.length} browser layouts passed across ${THEMES.length} themes, desktop and 375 px; screenshots: ${output}`);
} finally {ws?.close();child.kill();await new Promise(resolve=>server.close(resolve));assert.ok(within(output,profile)&&profile!==output);await fs.rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200}).catch(()=>{});}
