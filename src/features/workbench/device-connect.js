import { esc, fmtDate, icon, view } from "../../shared/state.js";
import {
  getActiveRemoteHost,
  getSavedRemoteHosts,
  isAndroidApkRuntime,
} from "../../shared/remote-host.js";

export function renderDeviceConnectSettingsSection({ hidden = false } = {}) {
  const info = view.connectionInfo || null;
  const activeHost = getActiveRemoteHost();
  const savedHosts = getSavedRemoteHosts();
  const isApk = isAndroidApkRuntime();
  const tab = view.orcaConnectTab || (isApk || activeHost ? "client" : "host");
  const probe = view.orcaConnectProbeResult || null;
  const draft = view.orcaConnectDraft || {
    name: activeHost?.name || info?.hostname || "",
    url: activeHost?.url || info?.primaryUrl || "http://192.168.1.3:4173",
    username: activeHost?.username || info?.accessUsername || "opensybau",
    password: activeHost?.password || "",
    quickPair: "",
  };

  const isConnectedRemote = Boolean(activeHost?.url);
  const statusPill = isConnectedRemote
    ? { label: `Từ xa · ${activeHost.name || activeHost.url}`, cls: "status-running" }
    : info?.mode === "network"
      ? { label: "Mạng LAN đang mở", cls: "status-running" }
      : { label: "Cục bộ · 127.0.0.1", cls: "status-done" };

  const connectors = info?.connectorsSummary || [];
  const readyClis = connectors.filter((c) => c.available).map((c) => c.id);
  const lanList = info?.lanAddresses || [];
  const launchers = info?.launchers || null;

  const hostPaneHtml = `<div class="device-connect-pane">
    <div class="cli-guide-list">
      <article class="cli-guide-row">
        <span class="cli-guide-icon">${icon("globe", 16)}</span>
        <div>
          <strong>${esc(info?.hostname ? `Máy trạm ${info.hostname}` : "Máy chủ cục bộ")} <span class="cli-guide-status ${info?.mode === "network" ? "ready" : "needs-action"}">${info?.mode === "network" ? "Mạng LAN & Basic Auth" : "Chỉ cục bộ (Loopback)"}</span></strong>
          <small>Địa chỉ chính: <code>${esc(info?.primaryUrl || "http://127.0.0.1:4173")}</code>${readyClis.length ? ` · CLI sẵn sàng: ${esc(readyClis.join(", "))}` : ""}</small>
        </div>
        <div class="cli-guide-actions">
          <button class="button quiet small" type="button" data-action="refresh-connection-info">${icon("refresh-cw", 13)} Làm mới</button>
          <button class="button primary small" type="button" data-action="copy-pairing-uri" data-uri="${esc(info?.pairingUri || "")}">${icon("copy", 13)} Sao chép URI</button>
        </div>
      </article>
    </div>

    <div class="device-qr-panel">
      <div class="device-qr-thumb">
        ${info?.qrSvg || `<div class="device-qr-placeholder">${icon("qr-code", 28)}</div>`}
      </div>
      <div class="device-qr-body">
        <label>Chuỗi ghép nối nhanh (Android APK / thiết bị khác)
          <div class="device-input-action-row">
            <input type="text" readonly value="${esc(info?.pairingUri || "")}" data-pairing-uri-input spellcheck="false" placeholder="opensybau://connect?...">
            <button type="button" class="button quiet" data-action="copy-pairing-uri" data-uri="${esc(info?.pairingUri || "")}">${icon("copy", 13)} Sao chép</button>
          </div>
          <small>Mở OpenSybau trên điện thoại Android (cùng mạng Wi-Fi hoặc Tailscale) để quét mã QR bên trái hoặc dán chuỗi ghép nối này.</small>
        </label>
        ${lanList.length ? `<div class="device-lan-chips">
          <span class="device-lan-label">Địa chỉ mạng phát hiện trên máy:</span>
          ${lanList.map((item) => `<button type="button" class="button quiet small device-lan-chip" data-action="copy-lan-url" data-url="${esc(item.url)}" title="Sao chép ${esc(item.url)}">
            <span>${item.kind === "tailscale" ? "Tailscale" : "LAN"}</span>
            <code>${esc(item.url.replace(/^https?:\/\//, ""))}</code>
            ${icon("copy", 11)}
          </button>`).join("")}
        </div>` : `<p class="form-note">Chưa phát hiện địa chỉ mạng LAN ngoài loopback (127.0.0.1).</p>`}
      </div>
    </div>

    <details class="provider-env-help" ${info?.mode === "network" ? "" : "open"}>
      <summary>Hướng dẫn bật truy cập mạng LAN / Tailscale an toàn (Basic Auth)</summary>
      ${info?.mode === "network" ? `
        <p>Máy chủ hiện đang cho phép kết nối mạng với tài khoản Basic Auth <code>${esc(info.accessUsername || "opensybau")}</code> và danh sách host được duyệt: <code>${esc((info.allowedHosts || []).join(", "))}</code>.</p>
      ` : `
        <p>Mặc định OpenSybau chỉ lắng nghe trên <code>127.0.0.1</code> để đảm bảo an toàn. Khi cần điều khiển từ điện thoại hoặc máy khác trong mạng LAN/Tailscale, hãy khởi động server ở chế độ Production kèm danh sách IP cho phép và mật khẩu tối thiểu 16 ký tự.</p>
        ${launchers ? `
          <div class="device-cmd-row">
            <div>
              <strong>Lệnh khởi động PowerShell (đã điền sẵn IP LAN & mật khẩu ngẫu nhiên)</strong>
              <code class="device-cmd-preview">${esc(launchers.powershell)}</code>
            </div>
            <button type="button" class="button quiet small" data-action="copy-lan-command" data-cmd="${esc(launchers.powershell)}">${icon("copy", 13)} Sao chép lệnh</button>
          </div>
          <div class="device-cmd-row">
            <div>
              <strong>Thông tin đăng nhập trên thiết bị từ xa</strong>
              <code class="device-cmd-preview">Tài khoản: ${esc(info?.accessUsername || "opensybau")} · Mật khẩu: ${esc(launchers.suggestedPassword)}</code>
            </div>
            <button type="button" class="button quiet small" data-action="copy-lan-command" data-cmd="${esc(launchers.suggestedPassword)}">${icon("copy", 13)} Sao chép mật khẩu</button>
          </div>
        ` : ""}
      `}
    </details>
  </div>`;

  const savedHostsHtml = savedHosts.length
    ? `<div class="provider-setup-list">${savedHosts.map((item) => {
        const isCurrent = activeHost?.url && activeHost.url.toLowerCase() === item.url.toLowerCase();
        return `<div class="provider-setup-row">
          <span class="provider-status-dot ${isCurrent ? "ready" : ""}"></span>
          <div>
            <strong>${esc(item.name || item.url)} <span class="provider-protocol">${isCurrent ? "Đang kết nối" : "Đã lưu"}${item.latencyMs ? ` · ${item.latencyMs}ms` : ""}</span></strong>
            <small>${esc(item.url)} · Tài khoản: ${esc(item.username || "opensybau")} · ${fmtDate(item.lastConnectedAt)}</small>
          </div>
          <div class="provider-row-actions">
            ${isCurrent
              ? `<button class="button quiet small" type="button" data-action="disconnect-remote-host">Ngắt kết nối</button>`
              : `<button class="button primary small" type="button" data-action="connect-saved-host" data-id="${esc(item.id)}">Kết nối</button>`}
            <button class="button quiet small" type="button" data-action="edit-saved-host" data-id="${esc(item.id)}">Sửa</button>
            <button class="button quiet small" type="button" data-action="remove-saved-host" data-id="${esc(item.id)}">Xóa</button>
          </div>
        </div>`;
      }).join("")}</div>`
    : `<div class="provider-empty-state"><strong>Chưa có máy chủ từ xa nào được lưu</strong><p>Dán mã ghép nối nhanh hoặc nhập địa chỉ IP LAN / Tailscale của máy trạm bên dưới để kết nối.</p></div>`;

  const clientPaneHtml = `<div class="device-connect-pane">
    <div class="device-quick-pair-box">
      <label>Ghép nối nhanh bằng mã URI hoặc địa chỉ IP
        <div class="device-input-action-row">
          <input type="text" data-orca-quick-pair-input placeholder="opensybau://connect?host=http%3A%2F%2F192.168.1.3%3A4173&user=opensybau" value="${esc(draft.quickPair || "")}" autocomplete="off" spellcheck="false">
          <button type="button" class="button quiet" data-action="paste-quick-pair">${icon("clipboard", 13)} Dán</button>
          <button type="button" class="button primary" data-action="apply-quick-pair">Nạp cấu hình</button>
        </div>
        <small>Dán chuỗi <code>opensybau://connect?...</code> sao chép từ máy chủ PC để tự động điền thông tin bên dưới.</small>
      </label>
    </div>

    ${savedHostsHtml}

    <div class="device-host-form">
      <div class="modal-grid-2">
        <label>Tên gợi nhớ máy chủ
          <input type="text" data-orca-host-name value="${esc(draft.name || "")}" placeholder="Ví dụ: Máy trạm PC tại nhà" autocomplete="off">
        </label>
        <label>Địa chỉ máy chủ (LAN IP / Tailscale / HTTPS)
          <input type="url" data-orca-host-url value="${esc(draft.url || "")}" placeholder="http://192.168.1.3:4173" autocomplete="off" spellcheck="false">
        </label>
      </div>
      <div class="modal-grid-2">
        <label>Tài khoản Basic Auth
          <input type="text" data-orca-host-user value="${esc(draft.username || "opensybau")}" placeholder="opensybau" autocomplete="off" spellcheck="false">
        </label>
        <label>Mật khẩu truy cập
          <input type="password" data-orca-host-pass value="${esc(draft.password || "")}" placeholder="Mật khẩu máy chủ (>= 16 ký tự)" autocomplete="new-password">
        </label>
      </div>
      ${probe ? `<p class="${probe.ok ? "form-note" : "provider-config-error"}">${esc(probe.ok ? `Kết nối thành công tới ${probe.info?.hostname || probe.url} (${probe.latencyMs}ms). Chọn "Lưu & Kết nối" để áp dụng.` : probe.error)}</p>` : ""}
      <footer class="settings-actions device-form-actions">
        ${isConnectedRemote ? `<button type="button" class="button danger" data-action="disconnect-remote-host">Ngắt kết nối hiện tại</button>` : ""}
        <button type="button" class="button quiet" data-action="test-orca-host-connection">${icon("refresh-cw", 13)} Kiểm tra kết nối</button>
        <button type="button" class="button primary" data-action="save-connect-orca-host">${icon("check", 13)} Lưu & Kết nối</button>
      </footer>
    </div>
  </div>`;

  return `<section class="settings-card device-connect-card" id="settings-devices" ${hidden ? "hidden" : ""}>
    <header>
      <div>
        <h2>Kết nối thiết bị & Máy trạm từ xa</h2>
        <p>Chia sẻ máy trạm hiện tại qua mạng LAN / Tailscale cho ứng dụng di động hoặc kết nối tới một máy chủ OpenSybau khác.</p>
      </div>
      <div class="device-card-head-right">
        <span class="pill ${statusPill.cls}"><i></i>${esc(statusPill.label)}</span>
        <div class="device-mode-switch" role="tablist" aria-label="Chế độ kết nối thiết bị">
          <button type="button" class="device-mode-btn ${tab === "host" ? "is-active" : ""}" data-action="orca-connect-tab" data-tab="host">Máy tính này (Host)</button>
          <button type="button" class="device-mode-btn ${tab === "client" ? "is-active" : ""}" data-action="orca-connect-tab" data-tab="client">Máy chủ từ xa (${savedHosts.length})</button>
        </div>
      </div>
    </header>
    ${tab === "host" ? hostPaneHtml : clientPaneHtml}
  </section>`;
}
