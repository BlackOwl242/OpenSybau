const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } });
  try {
    await win.loadURL("about:blank");
    const source = fs.readFileSync(path.join(__dirname, "../src/shared/dom-patch.js"), "utf8")
      .replace('import morphdom from "morphdom";', `const morphdom = require(${JSON.stringify(require.resolve("morphdom"))});`)
      .replace("export function patchHtml", "function patchHtml");
    const localization = fs.readFileSync(path.join(__dirname, "../src/shared/i18n.js"), "utf8").replaceAll("export function", "function");
    const result = await win.webContents.executeJavaScript(`(async () => {
      ${source}
      ${localization}
      const assert = require('node:assert/strict');
      const root = document.createElement('main'); document.body.append(root);
      const pane = (id, status) => '<section class="multi-chat-pane" data-task-id="' + id + '"><div class="chat-thread" style="height:60px;overflow:auto"><div style="height:400px">' + status + '</div></div><form data-form="task-chat" data-id="' + id + '"><textarea name="message"></textarea><details class="codex-pop-menu" data-pop-id="model"><summary>Model</summary><div class="codex-pop-scroll" style="height:20px;overflow:auto"><div style="height:100px">Choices</div></div></details><button type="submit">Send</button></form></section>';
      const frame = '<iframe id="preview" src="about:blank" title="Preview"></iframe>';
      patchHtml(root, pane('one', 'before') + pane('two', 'before') + frame);
      const iframe = root.querySelector('iframe');
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(iframe.contentDocument.readyState, 'complete');
      const frameWindow = iframe.contentWindow;
      const firstPane = root.querySelector('[data-task-id="one"]');
      const secondPane = root.querySelector('[data-task-id="two"]');
      const input = secondPane.querySelector('textarea'); input.value = 'Unsent draft'; input.focus(); input.setSelectionRange(3, 8);
      const details = firstPane.querySelector('details'); details.open = true;
      firstPane.querySelector('.chat-thread').scrollTop = 37;
      secondPane.querySelector('.chat-thread').scrollTop = 71;
      let frameLoads = 0; iframe.addEventListener('load', () => frameLoads++);
      for (let i = 0; i < 50; i++) patchHtml(root, pane('one', 'updated ' + i) + pane('two', 'updated ' + i) + frame, { background: true });
      await new Promise(resolve => setTimeout(resolve, 80));
      assert.equal(frameLoads, 0, 'Background events must not reload the preview');
      assert.strictEqual(root.querySelector('iframe'), iframe, 'Preview node must survive task updates');
      assert.strictEqual(iframe.contentWindow, frameWindow);
      assert.strictEqual(document.activeElement, input);
      assert.equal(input.value, 'Unsent draft'); assert.equal(input.selectionStart, 3); assert.equal(input.selectionEnd, 8);
      assert.equal(details.open, true);
      assert.equal(firstPane.querySelector('.chat-thread').scrollTop, 37);
      assert.equal(secondPane.querySelector('.chat-thread').scrollTop, 71);
      // Reordering panes must keep each draft with its original task.
      patchHtml(root, pane('two', 'reordered') + pane('one', 'reordered') + frame, { background: true });
      await new Promise(resolve => setTimeout(resolve, 80));
      assert.equal(frameLoads, 0, 'Reordering other panes must not reload the preview');
      assert.strictEqual(root.firstElementChild, secondPane); assert.equal(input.value, 'Unsent draft');
      // A foreground send deliberately clears the composer, even when the HTML
      // attributes themselves have not changed since the last server update.
      patchHtml(root, pane('two', 'reordered') + pane('one', 'reordered') + frame);
      assert.equal(input.value, '');
      await new Promise(resolve => setTimeout(resolve, 80));
      assert.equal(frameLoads, 0, 'A live update must not reload an open preview');
      root.innerHTML = '<form class="multi-chat-create-form"><textarea>Server default</textarea></form><p>old</p>';
      const modalInput = root.querySelector('textarea'); modalInput.value = 'Draft in modal';
      patchHtml(root, '<form class="multi-chat-create-form"><textarea>Server default</textarea></form><p>new</p>', { background: true });
      assert.strictEqual(root.querySelector('textarea'), modalInput); assert.equal(modalInput.value, 'Draft in modal'); assert.equal(root.querySelector('p').textContent, 'new');
      root.innerHTML = '<button title="Làm mới">Lưu trữ</button><div class="chat-message-content">Lưu trữ</div>';
      localizeDom(root, 'en');
      assert.equal(root.querySelector('button').textContent, 'Archive');
      assert.equal(root.querySelector('button').title, 'Refresh');
      assert.equal(root.querySelector('.chat-message-content').textContent, 'Lưu trữ');
      const stopLocalization = observeLocalization(root);
      const added = document.createElement('button'); added.textContent = 'Archive'; root.append(added);
      await new Promise(resolve => setTimeout(resolve, 0));
      assert.equal(added.textContent, 'Lưu trữ', 'New labels must still be localized without scanning unchanged content');
      stopLocalization();
      return 'DOM checks passed: 50 updates, pane reorder, drafts, focus/caret, dropdown state, independent scroll positions, explicit send reset, and no iframe reload.';
    })()`);
    console.log(result);
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
