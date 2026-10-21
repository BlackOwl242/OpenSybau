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
    url: activeHost?.url || info?.primaryUrl || "192.168.1.3:4173",
    username: activeHost?.username || info?.accessUsername || "opensybau",
    password: activeHost?.password || "",
    quickPair: "",
  };

  const isConnectedRemote = Boolean(activeHost?.url);
  const lanList = info?.lanAddresses || [];
  const currentPassword = view.connectionPasswordDraft ?? info?.accessPassword ?? info?.launchers?.suggestedPassword ?? "";
  const hasSavedPassword = Boolean(info?.authRequired || info?.accessPassword);

  const hostPaneHtml = `<div class="device-connect-pane">
    <div class="device-password-box">
      <div class="device-password-head">
        <div>
          <strong>1. Tạo mật khẩu kết nối</strong>
          <small>${hasSavedPassword ? "Đã bật mật khẩu bảo vệ. Điện thoại dùng mật khẩu này (hoặc quét mã QR bên dưới) để kết nối." : "Nhập mật khẩu bạn muốn dùng hoặc bấm Tạo tự động rồi bấm Lưu để mở kết nối cho điện thoại."}</small>
        </div>
      </div>
      <div class="device-input-action-row">
        <input
          type="text"
          data-connection-password-input
          value="${esc(currentPassword)}"
          placeholder="Nhập mật khẩu (tối thiểu 6 ký tự)…"
          autocomplete="off"
          spellcheck="false"
        >
        <button type="button" class="button quiet" data-action="generate-connection-password">
          ${icon("sparkles", 13)} Tạo tự động
        </button>
        <button type="button" class="button primary" data-action="save-connection-password">
          ${icon("check", 13)} Lưu mật khẩu
        </button>
      </div>
    </div>

    <div class="device-qr-panel">
      <div class="device-qr-thumb">
        ${info?.qrSvg || `<div class="device-qr-placeholder">${icon("qr-code", 28)}</div>`}
      </div>
      <div class="device-qr-body">
        <div class="device-qr-step-title">
          <strong>2. Quét mã QR hoặc sao chép mã sang điện thoại</strong>
          <small>Mở ứng dụng OpenSybau trên điện thoại (cùng mạng Wi-Fi) và dán mã kết nối dưới đây.</small>
        </div>
        <label>Mã kết nối nhanh (đã kèm địa chỉ IP & mật khẩu)
          <div class="device-input-action-row">
            <input type="text" readonly value="${esc(info?.pairingUri || "")}" data-pairing-uri-input spellcheck="false" placeholder="opensybau://connect?...">
            <button type="button" class="button primary" data-action="copy-pairing-uri" data-uri="${esc(info?.pairingUri || "")}">${icon("copy", 13)} Sao chép mã</button>
            <button type="button" class="button quiet" data-action="refresh-connection-info" title="Làm mới địa chỉ mạng">${icon("refresh-cw", 13)}</button>
          </div>
        </label>
        ${lanList.length ? `<div class="device-lan-chips">
          <span class="device-lan-label">Địa chỉ IP máy tính này:</span>
          ${lanList.map((item) => `<button type="button" class="button quiet small device-lan-chip" data-action="copy-lan-url" data-url="${esc(item.url)}" title="Sao chép ${esc(item.url)}">
            <code>${esc(item.url.replace(/^https?:\/\//, ""))}</code>
            ${icon("copy", 11)}
          </button>`).join("")}
        </div>` : `<p class="form-note">Máy tính chưa kết nối mạng Wi-Fi / LAN.</p>`}
      </div>
    </div>
  </div>`;

  const savedHostsHtml = savedHosts.length
    ? `<div class="provider-setup-list">${savedHosts.map((item) => {
        const isCurrent = activeHost?.url && activeHost.url.toLowerCase() === item.url.toLowerCase();
        return `<div class="provider-setup-row">
          <span class="provider-status-dot ${isCurrent ? "ready" : ""}"></span>
          <div>
            <strong>${esc(item.name || item.url)}</strong>
            <small>${esc(item.url.replace(/^https?:\/\//, ""))}${isCurrent ? " · Đang kết nối" : ""} · ${fmtDate(item.lastConnectedAt)}</small>
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
    : "";

  const clientPaneHtml = `<div class="device-connect-pane">
    <div class="device-quick-pair-box">
      <label>Cách 1: Dán mã kết nối nhanh từ máy tính
        <div class="device-input-action-row">
          <input type="text" data-orca-quick-pair-input placeholder="Dán mã opensybau://connect?... vào đây" value="${esc(draft.quickPair || "")}" autocomplete="off" spellcheck="false">
          <button type="button" class="button quiet" data-action="paste-quick-pair">${icon("clipboard", 13)} Dán</button>
          <button type="button" class="button primary" data-action="apply-quick-pair">${icon("check", 13)} Kết nối ngay</button>
        </div>
      </label>
    </div>

    ${savedHostsHtml}

    <div class="device-host-form">
      <div class="device-form-head">
        <strong>Cách 2: Nhập địa chỉ IP máy tính & mật khẩu</strong>
      </div>
      <div class="modal-grid-2">
        <label>Địa chỉ IP máy tính
          <input type="text" data-orca-host-url value="${esc(draft.url || "")}" placeholder="Ví dụ: 192.168.1.3:4173" autocomplete="off" spellcheck="false">
        </label>
        <label>Mật khẩu kết nối
          <input type="text" data-orca-host-pass value="${esc(draft.password || "")}" placeholder="Nhập mật khẩu đã tạo trên máy tính" autocomplete="off" spellcheck="false">
        </label>
      </div>
      <details class="device-advanced-details">
        <summary>Tùy chọn thêm (Tên gợi nhớ & tài khoản)</summary>
        <div class="modal-grid-2">
          <label>Tên gợi nhớ máy tính
            <input type="text" data-orca-host-name value="${esc(draft.name || "")}" placeholder="Ví dụ: Máy tính ở nhà" autocomplete="off">
          </label>
          <label>Tài khoản (mặc định: opensybau)
            <input type="text" data-orca-host-user value="${esc(draft.username || "opensybau")}" placeholder="opensybau" autocomplete="off" spellcheck="false">
          </label>
        </div>
      </details>
      ${probe ? `<p class="${probe.ok ? "form-note" : "provider-config-error"}">${esc(probe.ok ? `Kết nối thành công tới ${probe.info?.hostname || probe.url} (${probe.latencyMs}ms).` : probe.error)}</p>` : ""}
      <footer class="settings-actions device-form-actions">
        ${isConnectedRemote ? `<button type="button" class="button danger" data-action="disconnect-remote-host">Ngắt kết nối hiện tại</button>` : ""}
        <button type="button" class="button quiet" data-action="test-orca-host-connection">${icon("refresh-cw", 13)} Kiểm tra thử</button>
        <button type="button" class="button primary" data-action="save-connect-orca-host">${icon("check", 13)} Lưu & Kết nối</button>
      </footer>
    </div>
  </div>`;

  return `<section class="settings-card device-connect-card" id="settings-devices" ${hidden ? "hidden" : ""}>
    <header>
      <div>
        <h2>Kết nối điện thoại</h2>
        <p>Tạo mật khẩu trên máy tính rồi quét mã hoặc nhập IP trên điện thoại để điều khiển từ xa.</p>
      </div>
      <div class="device-card-head-right">
        <div class="device-mode-switch" role="tablist" aria-label="Chế độ kết nối thiết bị">
          <button type="button" class="device-mode-btn ${tab === "host" ? "is-active" : ""}" data-action="orca-connect-tab" data-tab="host">Trên máy tính này</button>
          <button type="button" class="device-mode-btn ${tab === "client" ? "is-active" : ""}" data-action="orca-connect-tab" data-tab="client">Kết nối sang máy khác${savedHosts.length ? ` (${savedHosts.length})` : ""}</button>
        </div>
      </div>
    </header>
    ${tab === "host" ? hostPaneHtml : clientPaneHtml}
  </section>`;
}
