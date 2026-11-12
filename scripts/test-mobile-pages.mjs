import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { within } from "../src/server/fs-security.mjs";
const base=resolve(".runtime");await fs.mkdir(base,{recursive:true});const dir=await fs.mkdtemp(join(base,"mobile-pages-"));
const workspace=join(dir,"workspace");await fs.mkdir(workspace);await fs.writeFile(join(workspace,"example.js"),"export const test = true;\n");
process.env.WORKBENCH_DATA_DIR=join(dir,"data");process.env.WORKBENCH_HOST="127.0.0.1";process.env.WORKBENCH_PORT="0";process.env.WORKBENCH_MODE="production";process.env.WORKBENCH_ALLOW_NETWORK="false";
const {startWorkbench,stopWorkbench}=await import("../server.mjs");let browser,ws;
try {
  const server=await startWorkbench(),url=`http://127.0.0.1:${server.port}`;
  const register=await fetch(`${url}/api/workspaces`,{method:"POST",headers:{"Content-Type":"application/json",Origin:url},body:JSON.stringify({path:workspace})});assert.equal(register.status,201);
  browser=spawn(process.env.CHROME_PATH||"C:/Program Files/Google/Chrome/Application/chrome.exe",["--headless=new","--no-sandbox","--disable-gpu","--remote-debugging-port=0",`--user-data-dir=${join(dir,"chrome")}`,"about:blank"],{windowsHide:true,stdio:["ignore","ignore","pipe"]});
  const debug=await new Promise((ok,fail)=>{let log="";const timer=setTimeout(()=>fail(Error("Chrome timeout")),15000);browser.stderr.on("data",c=>{log+=c;const m=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);ok(m[1]);}});browser.once("error",fail);});
  const tabs=await(await fetch(`http://${new URL(debug).host}/json`)).json();ws=new WebSocket(tabs.find(t=>t.type==="page").webSocketDebuggerUrl);await new Promise((ok,fail)=>{ws.addEventListener("open",ok,{once:true});ws.addEventListener("error",fail,{once:true});});
  let id=0;const pending=new Map();ws.addEventListener("message",e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
  const cdp=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
  const evalJs=async(expression)=>{const r=await cdp("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;};
  const wait=async(expression)=>{for(let n=0;n<200;n++){if(await evalJs(expression))return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error(`Missing ${expression}`);};
  const click=async(selector)=>{const r=await evalJs(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;e.scrollIntoView({block:'nearest',inline:'nearest'});const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,h=document.elementFromPoint(x,y);return {x,y,hit:h===e||e.contains(h),element:h?.outerHTML.slice(0,120)}})()`);assert.ok(r?.hit,`${selector}: ${JSON.stringify(r)}`);for(const type of ["mousePressed","mouseReleased"])await cdp("Input.dispatchMouseEvent",{type,x:r.x,y:r.y,button:"left",clickCount:1});};
  await cdp("Page.enable");await cdp("Page.addScriptToEvaluateOnNewDocument",{source:"localStorage.setItem('opensybau.setup-v3','done');localStorage.setItem('opensybau.desktop-setup-v2','done');"});
  await cdp("Emulation.setUserAgentOverride",{userAgent:"Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",platform:"Android"});
  for(const {width,height} of [{width:320,height:600},{width:375,height:850},{width:430,height:850}]){
    await cdp("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile:true});await cdp("Page.navigate",{url});await wait("document.documentElement.classList.contains('mobile-companion') && !!document.querySelector('.wb-mobile-nav') && !!document.querySelector('.home-composer') && Number(getComputedStyle(document.querySelector('.wb-boot-splash')).opacity) < 0.01");
    assert.equal(await evalJs("getComputedStyle(document.querySelector('.wb-window-chrome-right [data-action=new-chat]')).display"),"none");
    assert.equal(await evalJs("getComputedStyle(document.querySelector('.wb-window-chrome-right .wb-theme-menu')).display"),"none");
    const composer=await evalJs(`(()=>{const sels=['.composer-add-wrap','[data-pop-id=home-model]','[data-pop-id=home-effort]','.home-submit'];return sels.map(s=>{const e=document.querySelector(s),r=e?.getBoundingClientRect();return {s,left:r?.left,right:r?.right,top:r?.top,bottom:r?.bottom,visible:!!e?.getClientRects().length}})})()`);
    assert.ok(composer.every(r=>r.visible&&r.left>=0&&r.right<=width+1),JSON.stringify(composer));
    const send=composer.at(-1);for(const r of composer.slice(0,-1))assert.ok(r.right<=send.left||send.right<=r.left||r.bottom<=send.top||send.bottom<=r.top,JSON.stringify(composer));
    const dock=await evalJs(`(()=>{const d=document.querySelector('.home-composer-dock').getBoundingClientRect(),n=document.querySelector('.wb-mobile-nav').getBoundingClientRect();return {top:d.top,bottom:d.bottom,nav:n.top,position:getComputedStyle(document.querySelector('.home-composer-dock')).position}})()`);
    assert.equal(dock.position,"fixed");assert.ok(dock.bottom<=dock.nav&&dock.nav-dock.bottom<20,JSON.stringify(dock));
    await evalJs("document.querySelector('.wb-stage-column').scrollTop=10000");
    assert.ok(Math.abs((await evalJs("document.querySelector('.home-composer-dock').getBoundingClientRect().bottom"))-dock.bottom)<1,"composer moved on scroll");
    const contentBottom=await evalJs("document.querySelector('.mp-home-companion')?.getBoundingClientRect().bottom ?? 0");
    assert.ok(contentBottom<=dock.top+1,`home content hidden behind composer: ${contentBottom} > ${dock.top}`);
    for(const name of ["home-mode","home-model","home-effort"]){
      await click(`[data-pop-id="${name}"] > summary`);await wait(`!!document.querySelector('[data-pop-id="${name}"][open]')`);
      const menu=await evalJs(`(()=>{const e=document.querySelector('[data-pop-id="${name}"] .codex-pop-card'),r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})()`);
      assert.ok(menu.left>=0&&menu.right<=width+1&&menu.top>=0&&menu.bottom<=height,`${name}: ${JSON.stringify(menu)}`);
      assert.ok(menu.bottom<=dock.top+1,`${name} covers composer: ${JSON.stringify({menu,dock})}`);
      if(name==="home-effort"||name==="home-model"){
        const scroll=await evalJs(`(()=>{const card=document.querySelector('[data-pop-id="${name}"] .codex-pop-card'),list=card.querySelector('.codex-pop-scroll');list.scrollTop=list.scrollHeight;return {outer:getComputedStyle(card).overflowY,inner:getComputedStyle(list).overflowY,scrollTop:list.scrollTop,scrollHeight:list.scrollHeight,clientHeight:list.clientHeight}})()`);
        assert.equal(scroll.outer,"hidden");assert.equal(scroll.inner,"auto");if(scroll.scrollHeight>scroll.clientHeight)assert.ok(scroll.scrollTop>0,JSON.stringify(scroll));
        await evalJs(`document.querySelector('[data-pop-id="${name}"] .codex-pop-scroll').scrollTop=0`);
      }
      assert.equal(await evalJs(`(()=>{const e=document.querySelector('.home-composer textarea'),r=e.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===e})()`),true,`${name} blocks input`);
      if(width===375&&["home-model","home-effort"].includes(name)){const img=await cdp("Page.captureScreenshot",{format:"png"});await fs.writeFile(join(base,`mobile-${name}-menu-375.png`),Buffer.from(img.data,"base64"));}
      await click(`[data-pop-id="${name}"] .codex-pop-item.is-selected`);await wait(`!document.querySelector('[data-pop-id="${name}"][open]')`);
    }
    for(const selector of ['.home-composer .composer-add','[data-pop-id="home-permission"]','[data-pop-id="home-subagents"]']){
      await click(`${selector} > summary`);await wait(`!!document.querySelector(${JSON.stringify(`${selector}[open]`)})`);
      const popup=await evalJs(`(()=>{const e=document.querySelector(${JSON.stringify(`${selector} > :is(.composer-add-menu,.codex-pop-card)`)}),r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})()`);
      assert.ok(popup.left>=0&&popup.right<=width+1&&popup.top>=0&&popup.bottom<=dock.top+1,`${selector} covers composer: ${JSON.stringify(popup)}`);
      await click(`${selector} > summary`);await wait(`!document.querySelector(${JSON.stringify(`${selector}[open]`)})`);
    }
    for(const page of ["tasks","flows","workspaces","knowledge","skills","memory","settings","chat"]){
      if(["knowledge","skills","memory","settings"].includes(page)){await click('.wb-mobile-more-trigger');await click(`.wb-mobile-more-menu [data-page="${page}"]`);}else await click(`.wb-mobile-nav [data-page="${page}"]`);
      const title={chat:"Chat",tasks:"Công việc",flows:"Luồng",workspaces:"Dự án",knowledge:"Tri thức",skills:"Kỹ năng",memory:"Bộ nhớ",settings:"Cài đặt"}[page];
      await wait(["knowledge","skills","memory","settings"].includes(page)
        ? `document.querySelector('.wb-mobile-chrome-title strong')?.textContent === ${JSON.stringify(title)} && !document.querySelector('.wb-mobile-more-menu')`
        : `!!document.querySelector('.wb-mobile-nav [data-page="${page}"][aria-current=page]')`);
      const layout=await evalJs(`(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth,content:document.querySelector('#content')?.innerText.length||0,filters:[...document.querySelectorAll('.list-toolbar .filters .filter,.mc-filter-strip .filter')].filter(e=>e.getClientRects().length).map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right}})}))()`);
      assert.ok(layout.scroll<=layout.width+1,`${page} ${width}: ${JSON.stringify(layout)}`);assert.ok(layout.content>20,`${page} is empty`);assert.ok(layout.filters.every(f=>f.left>=0&&f.right<=width+1),`${page} filters clipped: ${JSON.stringify(layout.filters)}`);
      if(width===375&&["chat","tasks","flows"].includes(page)){const img=await cdp("Page.captureScreenshot",{format:"png"});await fs.writeFile(join(base,`mobile-${page}-375.png`),Buffer.from(img.data,"base64"));}
      if(page==="settings"){
        await click('.settings-mobile-nav [data-section="roles"]');await wait("!!document.querySelector('#settings-roles:not([hidden]) .agent-role-card')");
        const roleLayout=await evalJs(`(()=>[...document.querySelectorAll('#settings-roles .agent-role-card')].map(card=>{const c=card.getBoundingClientRect();return [...card.querySelectorAll('.agent-role-picker-field summary')].map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,cardLeft:c.left,cardRight:c.right,width:r.width}})}))()`);
        assert.equal(roleLayout.length,3);for(const row of roleLayout){assert.equal(row.length,3);assert.ok(row.every(r=>r.left>=r.cardLeft&&r.right<=r.cardRight+1&&r.width>100),JSON.stringify(row));assert.ok(Math.max(...row.map(r=>r.left))-Math.min(...row.map(r=>r.left))<1,JSON.stringify(row));}
        if(width===375){await evalJs("document.querySelector('#settings-roles .settings-role-grid').scrollIntoView({block:'start'})");const img=await cdp("Page.captureScreenshot",{format:"png"});await fs.writeFile(join(base,"mobile-settings-roles-375.png"),Buffer.from(img.data,"base64"));}
        if(await evalJs("!!document.querySelector('#settings-roles [data-pop-id=role-plan-model]:not([data-disabled])')")){
          await click('#settings-roles [data-pop-id=role-plan-model] > summary');await wait("!!document.querySelector('#settings-roles [data-pop-id=role-plan-model][open]')");
          await click('#settings-roles [data-pop-id=role-plan-model] .codex-pop-item.is-selected');await wait("!document.querySelector('#settings-roles [data-pop-id=role-plan-model][open]')");
        }
      }
      if(page==="tasks"||page==="flows"){
        const selector=page==="tasks"?'.list-toolbar .filters .filter':'.mc-filter-strip .filter';
        const count=await evalJs(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
        for(let n=0;n<count;n++){
          const target=`${selector}:nth-of-type(${n+1})`;await click(target);
          await wait(`document.querySelector(${JSON.stringify(target)})?.classList.contains('active')`);
        }
        await click(`${selector}:nth-of-type(1)`);
      }
      if(page==="tasks"){
        await click('[data-action="new-task"]');await wait("!!document.querySelector('.modal[role=dialog]')");
        const modal=await evalJs(`(()=>{const e=document.querySelector('.modal[role=dialog]'),r=e.getBoundingClientRect(),f=e.querySelector('.modal-actions').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,footerLeft:f.left,footerRight:f.right,footerTop:f.top,footerBottom:f.bottom}})()`);
        assert.ok(modal.left>=0&&modal.right<=width+1&&modal.top>=0&&modal.bottom<=height+1&&modal.footerLeft>=0&&modal.footerRight<=width+1&&modal.footerBottom<=height+1,`task dialog ${width}: ${JSON.stringify(modal)}`);
        await click('.modal-head [data-action="close-modal"]');await wait("!document.querySelector('.modal[role=dialog]')");
      }
    }
  }
  await cdp("Emulation.setUserAgentOverride",{userAgent:"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",platform:"Win32"});
  await cdp("Emulation.setDeviceMetricsOverride",{width:375,height:850,deviceScaleFactor:1,mobile:false});await cdp("Page.navigate",{url});
  await wait("!!document.querySelector('.home-composer') && Number(getComputedStyle(document.querySelector('.wb-boot-splash')).opacity) < 0.01");
  assert.equal(await evalJs("document.documentElement.classList.contains('mobile-companion')"),false,"narrow desktop browser classified as mobile");
  assert.equal(await evalJs("!!document.querySelector('.mp-home-companion')"),false,"narrow desktop shows PC pairing");
  await cdp("Emulation.setDeviceMetricsOverride",{width:960,height:850,deviceScaleFactor:1,mobile:false});
  assert.notEqual(await evalJs("getComputedStyle(document.querySelector('.wb-window-chrome-right .wb-theme-menu')).display"),"none");
  console.log("Mobile app: eight navigation pages, visible filters and non-overlapping composer passed at 320/375/430 px.");
} finally {ws?.close();browser?.kill();await stopWorkbench();assert.ok(within(base,dir)&&dir!==base);await fs.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
