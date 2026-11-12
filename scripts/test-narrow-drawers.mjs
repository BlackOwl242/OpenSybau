import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { within } from "../src/server/fs-security.mjs";

const baseDir=resolve(".runtime"); await fs.mkdir(baseDir,{recursive:true});
const testDir=await fs.mkdtemp(join(baseDir,"drawer-e2e-")),profile=join(testDir,"chrome");
const workspace=join(testDir,"workspace");await fs.mkdir(workspace);await fs.writeFile(join(workspace,"example.js"),"export const marker = 1;\n");
process.env.WORKBENCH_DATA_DIR=join(testDir,"data");process.env.WORKBENCH_HOST="127.0.0.1";process.env.WORKBENCH_PORT="0";process.env.WORKBENCH_MODE="production";process.env.WORKBENCH_ALLOW_NETWORK="false";
const {startWorkbench,stopWorkbench}=await import("../server.mjs");
let chrome,ws;
try {
  const server=await startWorkbench(); const url=`http://127.0.0.1:${server.port}`;
  const registered=await fetch(`${url}/api/workspaces`,{method:"POST",headers:{"Content-Type":"application/json",Origin:url},body:JSON.stringify({path:workspace})});assert.equal(registered.status,201);
  chrome=spawn(process.env.CHROME_PATH||"C:/Program Files/Google/Chrome/Application/chrome.exe",["--headless=new","--no-sandbox","--disable-gpu","--remote-debugging-port=0",`--user-data-dir=${profile}`,"about:blank"],{windowsHide:true,stdio:["ignore","ignore","pipe"]});
  const debug=await new Promise((ok,fail)=>{let log="";const timer=setTimeout(()=>fail(Error("Chrome did not start")),15000);chrome.stderr.on("data",chunk=>{log+=chunk;const m=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);ok(m[1]);}});chrome.once("error",fail);});
  const tabs=await(await fetch(`http://${new URL(debug).host}/json`)).json();ws=new WebSocket(tabs.find(tab=>tab.type==="page").webSocketDebuggerUrl);await new Promise((ok,fail)=>{ws.addEventListener("open",ok,{once:true});ws.addEventListener("error",fail,{once:true});});
  let seq=0;const pending=new Map();ws.addEventListener("message",event=>{const data=JSON.parse(event.data),p=pending.get(data.id);if(p){pending.delete(data.id);data.error?p.reject(Error(data.error.message)):p.resolve(data.result);}});
  const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async(expression)=>{const r=await cdp("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;};
  const waitFor=async(expression)=>{for(let i=0;i<600;i++){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,50));}const screenshot=await cdp('Page.captureScreenshot',{format:'png'});await fs.writeFile(join(baseDir,'drawer-timeout.png'),Buffer.from(screenshot.data,'base64'));throw Error(`Timed out waiting for ${expression}`);};
  const click=async(selector)=>{const rect=await evaluate(`(()=>{let e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;let r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);return {x,y,hit:hit===e||e.contains(hit),outer:hit?.outerHTML.slice(0,180)}})()`);assert.ok(rect?.hit,`${selector} is covered: ${JSON.stringify(rect)}`);await cdp("Input.dispatchMouseEvent",{type:"mousePressed",x:rect.x,y:rect.y,button:"left",clickCount:1});await cdp("Input.dispatchMouseEvent",{type:"mouseReleased",x:rect.x,y:rect.y,button:"left",clickCount:1});};
  await cdp("Page.enable");await cdp("Page.addScriptToEvaluateOnNewDocument",{source:`window.opensybauDesktop={isDesktop:true};localStorage.setItem('opensybau.setup-v3','done');localStorage.setItem('opensybau.desktop-setup-v2','done');`});
  await cdp("Emulation.setDeviceMetricsOverride",{width:1600,height:900,deviceScaleFactor:1,mobile:false});await cdp("Page.navigate",{url});
  await waitFor("!!document.querySelector('.wb-topbar [data-action=toggle-chat-drawer]') || !!document.querySelector('.orca-right-dock')");
  if(!await evaluate("!!document.querySelector('.orca-right-dock')"))await click('.wb-topbar [data-action=toggle-chat-drawer]');
  await waitFor("!!document.querySelector('[data-right-dock-resizer]')");
  const drag=await evaluate(`(()=>{const e=document.querySelector('[data-right-dock-resizer]'),r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+100,width:document.querySelector('.orca-right-dock').getBoundingClientRect().width}})()`);
  await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:drag.x,y:drag.y});await cdp('Input.dispatchMouseEvent',{type:'mousePressed',x:drag.x,y:drag.y,button:'left',buttons:1,clickCount:1});await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:drag.x-90,y:drag.y,button:'left',buttons:1});await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x:drag.x-90,y:drag.y,button:'left',clickCount:1});
  assert.ok((await evaluate("document.querySelector('.orca-right-dock').getBoundingClientRect().width"))>drag.width+50,'right dock did not resize');
  const tabsScroll=await evaluate(`(()=>{const bar=document.querySelector('.orca-dock-tabs');window.__testDockTabs=bar.innerHTML;for(let i=0;i<20;i++)bar.appendChild(bar.firstElementChild.cloneNode(true));bar.scrollLeft=bar.scrollWidth;return {overflowX:getComputedStyle(bar).overflowX,overflowY:getComputedStyle(bar).overflowY,scrollbar:getComputedStyle(bar).scrollbarWidth,left:bar.scrollLeft,max:bar.scrollWidth-bar.clientWidth}})()`);
  assert.equal(tabsScroll.overflowX,'auto');assert.equal(tabsScroll.overflowY,'hidden');assert.notEqual(tabsScroll.scrollbar,'none');assert.ok(tabsScroll.max>0&&tabsScroll.left>0,JSON.stringify(tabsScroll));
  const scrollShot=await cdp("Page.captureScreenshot",{format:"png"});await fs.writeFile(join(baseDir,"dock-scrollbar-check.png"),Buffer.from(scrollShot.data,"base64"));await evaluate("document.querySelector('.orca-dock-tabs').innerHTML=window.__testDockTabs");
  await click('.orca-dock-tab[data-tab="terminal"]');await waitFor("!!document.querySelector('[data-action=open-live-url]')");
  await click('.orca-right-dock [data-action=open-live-url]');await waitFor("!!document.querySelector('[data-stage-split-resizer]') && !!document.querySelector('iframe.orca-live-frame')");
  const split=await evaluate(`(()=>{const r=document.querySelector('[data-stage-split-resizer]').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+100,before:document.querySelector('.orca-stage-pane.is-primary').getBoundingClientRect().width}})()`);
  await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:split.x,y:split.y});await cdp('Input.dispatchMouseEvent',{type:'mousePressed',x:split.x,y:split.y,button:'left',buttons:1,clickCount:1});await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:split.x+100,y:split.y,button:'left',buttons:1});await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x:split.x+100,y:split.y,button:'left',clickCount:1});
  assert.ok((await evaluate("document.querySelector('.orca-stage-pane.is-primary').getBoundingClientRect().width"))>split.before+40,'chat/preview split did not resize across iframe');
  for(const width of [375,700]) {
    await cdp("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:false});await cdp("Page.navigate",{url});
    await waitFor("!!document.querySelector('.wb-sidebar-toggle-btn') && !!document.querySelector('.wb-window-chrome-right [data-action=toggle-chat-drawer]') && !document.querySelector('.desktop-setup-dialog')");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.wb-window-chrome-right [data-action=new-chat]')).display"),"none");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.wb-window-chrome-right .wb-theme-menu')).display"),"none");
    await waitFor("!!document.querySelector('.home-composer-dock [data-pop-id=home-model]')");
    assert.equal(await evaluate("document.documentElement.classList.contains('mobile-companion')"),false);
    assert.equal(await evaluate("!!document.querySelector('.mp-home-companion')"),false);
    const composer=await evaluate(`(()=>{const sels=['.composer-add-wrap','[data-pop-id=home-model]','[data-pop-id=home-effort]','.home-submit'];return sels.map(s=>{const r=document.querySelector(s).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})})()`);
    const send=composer.at(-1);assert.ok(composer.every(r=>r.left>=0&&r.right<=width+1));
    for(const r of composer.slice(0,-1))assert.ok(r.right<=send.left||send.right<=r.left||r.bottom<=send.top||send.bottom<=r.top,JSON.stringify(composer));
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.home-composer-dock')).position"),"fixed");
    await click('[data-pop-id="home-model"] > summary');await waitFor("!!document.querySelector('[data-pop-id=home-model][open]')");
    const menuBounds=await evaluate(`(()=>({menu:document.querySelector('[data-pop-id=home-model] .codex-pop-card').getBoundingClientRect().bottom,dock:document.querySelector('.home-composer-dock').getBoundingClientRect().top}))()`);
    assert.ok(menuBounds.menu<=menuBounds.dock+1,JSON.stringify(menuBounds));
    await click('[data-pop-id="home-model"] .codex-pop-item.is-selected');await waitFor("!document.querySelector('[data-pop-id=home-model][open]')");
    for(const theme of ["obsidian","sakura-light"]) {
      await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      // Start each scenario with the left drawer closed and open the right drawer.
      if(await evaluate("!!document.querySelector('.wb-context-sidebar.is-mobile-open')")) await click(".wb-sidebar-toggle-btn");
      if(!await evaluate("!!document.querySelector('.orca-right-dock')")) await click(".wb-window-chrome-right [data-action=toggle-chat-drawer]");
      await waitFor("!!document.querySelector('.orca-right-dock')");
      assert.match(await evaluate("getComputedStyle(document.querySelector('.orca-right-dock')).backgroundColor"),/^rgb\(/);
      if(width===375&&theme==="obsidian"){const screenshot=await cdp("Page.captureScreenshot",{format:"png"});await fs.writeFile(join(baseDir,"drawer-right-check.png"),Buffer.from(screenshot.data,"base64"));}
      await click(".orca-dock-tabs button");
      await click(".wb-sidebar-toggle-btn");await waitFor("!!document.querySelector('.wb-context-sidebar.is-mobile-open') && document.querySelector('.wb-context-sidebar').getBoundingClientRect().left >= -1");
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.orca-right-dock')).visibility"),"hidden");
      assert.match(await evaluate("getComputedStyle(document.querySelector('.wb-context-sidebar')).backgroundColor"),/^rgb\(/);
      if(width===375&&theme==="obsidian"){const screenshot=await cdp("Page.captureScreenshot",{format:"png"});await fs.writeFile(join(baseDir,"drawer-left-check.png"),Buffer.from(screenshot.data,"base64"));}
      await click(".wb-window-chrome-right [data-action=toggle-chat-drawer]");
      await waitFor("!document.querySelector('.wb-context-sidebar.is-mobile-open') && getComputedStyle(document.querySelector('.orca-right-dock')).visibility==='visible'");
      await click(".wb-window-chrome-right [data-action=toggle-language]");
      await click(".orca-dock-toggle");await waitFor("!document.querySelector('.orca-right-dock')");
      await click(".wb-sidebar-toggle-btn");await waitFor("!!document.querySelector('.wb-context-sidebar.is-mobile-open') && document.querySelector('.wb-context-sidebar').getBoundingClientRect().left >= -1");
      await click(".wb-sidebar-close");await waitFor("!document.querySelector('.wb-context-sidebar.is-mobile-open')");
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.wb-context-sidebar')).boxShadow"),"none");
    }
    await waitFor("document.querySelector('.wb-context-sidebar').getBoundingClientRect().right <= 0");
    await click('.wb-mobile-nav [data-page="tasks"]');await waitFor("!!document.querySelector('.task-filter-toolbar')");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.wb-main')).borderTopLeftRadius"),"0px");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.wb-mobile-chrome-title')).webkitAppRegion"),"drag");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.wb-sidebar-toggle-btn')).webkitAppRegion"),"no-drag");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.task-overview-stats')).gridTemplateColumns.split(' ').length"),2);
    for(const key of ["all","running","queued","done","failed","cancelled"]){await click(`.task-filter-toolbar [data-filter="${key}"]`);await waitFor(`document.querySelector('.task-filter-toolbar [data-filter="${key}"]')?.getAttribute('aria-pressed')==='true'`);}
    await click('.wb-mobile-nav [data-page="chat"]');await waitFor("!!document.querySelector('.home-composer-dock')");
  }
  await cdp("Emulation.setDeviceMetricsOverride",{width:375,height:900,deviceScaleFactor:1,mobile:false});await cdp("Page.navigate",{url});
  await waitFor("!!document.querySelector('.wb-window-chrome-right [data-action=toggle-chat-drawer]')");
  if(!await evaluate("!!document.querySelector('.orca-right-dock')"))await click(".wb-window-chrome-right [data-action=toggle-chat-drawer]");
  await waitFor("!!document.querySelector('[data-action=preview-drawer-file][data-path=\"example.js\"]')");
  await click('[data-action=preview-drawer-file][data-path="example.js"]');
  await waitFor("!!document.querySelector('.orca-file-viewer') && !document.querySelector('.orca-right-dock')");
  await click(".orca-viewer-toolbar .codex-open-menu-trigger");await click('.orca-viewer-toolbar [data-action="stage-tab-mode"][data-mode="edit"]');
  await waitFor("!!document.querySelector('[data-stage-file-editor]')");
  await evaluate(`(()=>{const e=document.querySelector('[data-stage-file-editor]');e.value=${JSON.stringify("export const marker = 2;\n")};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await click('.orca-viewer-toolbar [data-action="save-stage-file"]');
  for(let i=0;i<100&&(await fs.readFile(join(workspace,"example.js"),"utf8"))!=="export const marker = 2;\n";i++)await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(await fs.readFile(join(workspace,"example.js"),"utf8"),"export const marker = 2;\n");
  console.log("Actual app: opaque drawers, title controls, tabs, sidebar switching and opening/editing/saving a real workspace file passed.");
} finally {
  ws?.close();chrome?.kill();await stopWorkbench();assert.ok(within(baseDir,testDir)&&testDir!==baseDir);await fs.rm(testDir,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
