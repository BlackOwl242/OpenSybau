import { $, esc, fmtDate, icon, view } from "../../shared/state.js";
import {
  getActiveRemoteHost,
  getSavedRemoteHosts,
  isAndroidApkRuntime,
} from "../../shared/remote-host.js";

export function renderOrcaConnectBodyMarkup() {
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
  const modeBadge = isConnectedRemote
    ? { label: `ĐÃ KẾT NỐI TỪ XA${activeHost.latencyMs ? ` · ${activeHost.latencyMs}ms` : ""}`, cls: "is-online" }
    : info?.mode === "network"
      ? { label: "MẠNG LAN / TAILSCALE ĐANG BẬT", cls: "is-online" }
      : info?.mode === "loopback"
        ? { label: "CỤC BỘ (LOOPBACK 127.0.0.1)", cls: "is-local" }
        : { label: isApk ? "ANDROID APK · CHỜ KẾT NỐI" : "CHƯA KẾT NỐI MÁY CHỦ", cls: "is-offline" };

  const connectors = info?.connectorsSummary || [];
  const readyClis = connectors.filter((c) => c.available).map((c) => c.id.toUpperCase());

  const radarHeaderHtml = `<div class="orca-conn-radar">
    <div class="orca-conn-radar-main">
      <div class="orca-conn-pulse-ring ${modeBadge.cls}">
        <span class="orca-conn-pulse-core"></span>
        ${icon("globe", 18)}
      </div>
      <div class="orca-conn-radar-copy">
        <div class="orca-conn-radar-topline">
          <span class="orca-conn-status-pill ${modeBadge.cls}">${esc(modeBadge.label)}</span>
          ${info?.hostname ? `<span class="orca-conn-host-chip">${icon("terminal", 12)} <strong>${esc(info.hostname)}</strong> · ${esc(info.platform || "pc")}</span>` : ""}
          ${isConnectedRemote ? `<span class="orca-conn-host-chip">${icon("shield", 12)} Basic Auth</span>` : ""}
        </div>
        <h3>${isConnectedRemote ? `Đang điều khiển máy chủ ${esc(activeHost.name || activeHost.url)}` : info?.hostname ? `Trạm điều phối ${esc(info.hostname)} (${esc(info.primaryUrl || "127.0.0.1")})` : "Cổng kết nối thiết bị từ xa OpenSybau"}</h3>
        <p>${readyClis.length ? `CLI sẵn sàng: ${esc(readyClis.join(" · "))} · ${info?.activeWorktreesCount || 0} Git worktree · ${info?.runningTasksCount || 0} tiến trình đang chạy` : "Kết nối trực tiếp từ Android APK hoặc mạng nội bộ (LAN / Tailscale) tới máy tính chạy OpenSybau."}</p>
      </div>
    </div>
    <div class="orca-conn-tabs" role="tablist">
      <button type="button" class="orca-conn-tab ${tab === "host" ? "is-active" : ""}" data-action="orca-connect-tab" data-tab="host">
        ${icon("qr-code", 14)}
        <span>Mã QR & Phát sóng PC</span>
      </button>
      <button type="button" class="orca-conn-tab ${tab === "client" ? "is-active" : ""}" data-action="orca-connect-tab" data-tab="client">
        ${icon("smartphone", 14)}
        <span>Kết nối Máy chủ (${savedHosts.length})</span>
      </button>
    </div>
  </div>`;

  let bodyHtml = "";
  if (tab === "host") {
    const lanList = info?.lanAddresses || [];
    const launchers = info?.launchers || null;
    bodyHtml = `<div class="orca-conn-grid">
      <section class="orca-conn-card orca-conn-qr-card">
        <div class="orca-section-head">
          <span class="orca-section-label">QUÉT MÃ QR TỪ ANDROID APK</span>
          <span class="kb-tag-chip">${esc(info?.primaryUrl || "http://127.0.0.1:4173")}</span>
        </div>
        <div class="orca-conn-qr-stage">
          ${info?.qrSvg ? `<div class="orca-conn-qr-box">${info.qrSvg}</div>` : `<div class="orca-conn-qr-box is-empty">${icon("qr-code", 42)}<small>Khởi động máy chủ trên PC để tạo mã QR</small></div>`}
          <div class="orca-conn-qr-details">
            <strong>Ghép nối tức thì qua URI</strong>
            <p>Mở ứng dụng <strong>OpenSybau Android APK</strong> trên điện thoại (cùng Wi-Fi hoặc mạng Tailscale), quét mã QR bên cạnh hoặc sao chép chuỗi ghép nối dưới đây:</p>
            <div class="orca-inline-input-row">
              <input type="text" readonly value="${esc(info?.pairingUri || "")}" data-pairing-uri-input spellcheck="false">
              <button type="button" class="button primary small" data-action="copy-pairing-uri" data-uri="${esc(info?.pairingUri || "")}">${icon("copy", 12)}<span>Sao chép</span></button>
            </div>
            <div class="orca-conn-lan-list">
              <span class="orca-section-label">ĐỊA CHỈ MẠNG LAN / TAILSCALE PHÁT HIỆN ĐƯỢC (${lanList.length})</span>
              ${lanList.length ? `<div class="orca-conn-ip-pills">
                ${lanList.map((item) => `<button type="button" class="orca-conn-ip-pill" data-action="copy-lan-url" data-url="${esc(item.url)}" title="Sao chép ${esc(item.url)}">
                  <span class="orca-conn-ip-kind is-${esc(item.kind)}">${item.kind === "tailscale" ? "Tailscale" : "LAN"}</span>
                  <code>${esc(item.url)}</code>
                  ${icon("copy", 11)}
                </button>`).join("")}
              </div>` : `<p class="orca-muted-note">Không tìm thấy card mạng LAN ngoài loopback.</p>`}
            </div>
          </div>
        </div>
      </section>

      <section class="orca-conn-card">
        <div class="orca-section-head">
          <span class="orca-section-label">CHẾ ĐỘ MẠNG & BẢO MẬT (ZERO-TRUST LAN)</span>
          <span class="mc-badge is-${info?.mode === "network" ? "passed" : "advisory"}">${info?.mode === "network" ? "ĐANG MỞ MẠNG LAN" : "CHỈ CỤC BỘ (MẶC ĐỊNH)"}</span>
        </div>
        ${info?.mode === "network" ? `
          <p class="orca-muted-note">Máy chủ đang mở kết nối mạng an toàn với <strong>Basic Auth</strong> (tài khoản <code>${esc(info.accessUsername || "opensybau")}</code>) và danh sách Host cho phép: <code>${esc((info.allowedHosts || []).join(", "))}</code>.</p>
        ` : `
          <p class="orca-muted-note">Theo tiêu chuẩn bảo mật của OpenSybau, máy chủ mặc định chỉ lắng nghe trên <code>127.0.0.1</code>. Để cho phép điện thoại Android kết nối qua Wi-Fi / Tailscale, hãy chạy lệnh khởi động chế độ LAN an toàn dưới đây trên PC:</p>
          ${launchers ? `
            <div class="orca-conn-cmd-block">
              <header>
                <span>Windows PowerShell (Tự tạo mật khẩu 24 ký tự & Allowlist IP LAN)</span>
                <button type="button" class="button quiet small" data-action="copy-lan-command" data-cmd="${esc(launchers.powershell)}">${icon("copy", 12)}<span>Sao chép lệnh PowerShell</span></button>
              </header>
              <pre><code>${esc(launchers.powershell)}</code></pre>
            </div>
            <div class="orca-conn-cmd-block" style="margin-top:8px">
              <header>
                <span>Mật khẩu truy cập được tạo tự động (Dùng để nhập trên Android APK)</span>
                <button type="button" class="button quiet small" data-action="copy-lan-command" data-cmd="${esc(launchers.suggestedPassword)}">${icon("copy", 12)}<span>Sao chép mật khẩu</span></button>
              </header>
              <pre><code>Tài khoản: ${esc(info?.accessUsername || "opensybau")}   |   Mật khẩu: ${esc(launchers.suggestedPassword)}</code></pre>
            </div>
          ` : ""}
        `}
      </section>
    </div>`;
  } else {
    bodyHtml = `<div class="orca-conn-grid">
      <section class="orca-conn-card">
        <div class="orca-section-head">
          <span class="orca-section-label">GHÉP NỐI NHANH 1 CHẠM (QUICK PAIR / QR URI)</span>
          ${isConnectedRemote ? `<button type="button" class="button danger small" data-action="disconnect-remote-host">${icon("x", 12)}<span>Ngắt kết nối từ xa</span></button>` : ""}
        </div>
        <p class="orca-muted-note">Dán mã <code>opensybau://connect?...</code> hoặc địa chỉ IP máy tính (ví dụ <code>192.168.1.3:4173</code>) để tự động điền cấu hình máy chủ:</p>
        <div class="orca-inline-input-row" style="margin-top:6px">
          <input type="text" data-orca-quick-pair-input placeholder="opensybau://connect?host=http%3A%2F%2F192.168.1.3%3A4173&user=opensybau" value="${esc(draft.quickPair || "")}" autocomplete="off" spellcheck="false">
          <button type="button" class="button quiet small" data-action="paste-quick-pair" title="Dán từ Clipboard">${icon("clipboard", 12)}<span>Dán</span></button>
          <button type="button" class="button primary small" data-action="apply-quick-pair">${icon("zap", 12)}<span>Nạp mã</span></button>
        </div>

        ${savedHosts.length ? `
          <div class="orca-section-label" style="margin-top:14px">TRẠM MÁY CHỦ ĐÃ LƯU (${savedHosts.length})</div>
          <div class="orca-saved-hosts-list">
            ${savedHosts.map((item) => {
              const isCurrent = activeHost?.url && activeHost.url.toLowerCase() === item.url.toLowerCase();
              return `<div class="orca-saved-host-row ${isCurrent ? "is-active" : ""}">
                <div class="orca-saved-host-info">
                  <div class="orca-saved-host-title">
                    <span class="wb-task-dot is-${isCurrent ? "running" : "done"}"></span>
                    <strong>${esc(item.name || item.url)}</strong>
                    ${item.latencyMs ? `<span class="kb-tag-chip">${item.latencyMs}ms</span>` : ""}
                    ${isCurrent ? `<span class="kb-tag-chip is-active">Đang kết nối</span>` : ""}
                  </div>
                  <small><code>${esc(item.url)}</code> · Tài khoản: ${esc(item.username || "opensybau")} · ${fmtDate(item.lastConnectedAt)}</small>
                </div>
                <div class="orca-saved-host-actions">
                  ${isCurrent
                    ? `<button type="button" class="button quiet small" data-action="disconnect-remote-host">Ngắt</button>`
                    : `<button type="button" class="button primary small" data-action="connect-saved-host" data-id="${esc(item.id)}">${icon("zap", 12)}<span>Kết nối</span></button>`}
                  <button type="button" class="button quiet small" data-action="edit-saved-host" data-id="${esc(item.id)}" title="Nạp vào biểu mẫu">${icon("settings-2", 12)}</button>
                  <button type="button" class="icon-button" data-action="remove-saved-host" data-id="${esc(item.id)}" title="Xóa máy chủ đã lưu">${icon("delete", 13)}</button>
                </div>
              </div>`;
            }).join("")}
          </div>
        ` : ""}
      </section>

      <section class="orca-conn-card">
        <div class="orca-section-head">
          <span class="orca-section-label">CẤU HÌNH MÁY CHỦ & XÁC THỰC BASIC AUTH</span>
          ${probe ? `<span class="mc-badge is-${probe.ok ? "passed" : "blocking"}">${probe.ok ? `PING THÀNH CÔNG · ${probe.latencyMs}ms` : "LỖI KẾT NỐI"}</span>` : ""}
        </div>
        <div class="orca-conn-form-grid">
          <label>Tên gợi nhớ máy trạm
            <input type="text" data-orca-host-name value="${esc(draft.name || "")}" placeholder="Ví dụ: PC Workstation tại nhà" autocomplete="off">
          </label>
          <label>Địa chỉ Máy chủ (LAN IP / Tailscale / HTTPS)
            <input type="url" data-orca-host-url value="${esc(draft.url || "")}" placeholder="http://192.168.1.3:4173" autocomplete="off" spellcheck="false">
          </label>
          <label>Tên đăng nhập (WORKBENCH_ACCESS_USERNAME)
            <input type="text" data-orca-host-user value="${esc(draft.username || "opensybau")}" placeholder="opensybau" autocomplete="off" spellcheck="false">
          </label>
          <label>Mật khẩu truy cập (WORKBENCH_ACCESS_PASSWORD)
            <input type="password" data-orca-host-pass value="${esc(draft.password || "")}" placeholder="Nhập mật khẩu >= 16 ký tự của máy chủ…" autocomplete="new-password">
          </label>
        </div>
        ${probe ? `<div class="orca-conn-probe-banner ${probe.ok ? "is-ok" : "is-err"}">
          ${icon(probe.ok ? "check" : "alert-triangle", 14)}
          <span>${esc(probe.ok ? `Kết nối thông suốt tới ${probe.info?.hostname || probe.url} (${probe.latencyMs}ms). Nhấn "Lưu & Kết nối" để đồng bộ toàn bộ không gian làm việc.` : probe.error)}</span>
        </div>` : ""}
        <div class="orca-conn-form-actions">
          <button type="button" class="button quiet" data-action="test-orca-host-connection">${icon("refresh-cw", 13)}<span>Kiểm tra Ping & Xác thực</span></button>
          <button type="button" class="button primary" data-action="save-connect-orca-host">${icon("check", 13)}<span>Lưu & Kết nối Máy chủ</span></button>
        </div>
      </section>
    </div>`;
  }

  return `<div class="orca-connect-studio">${radarHeaderHtml}${bodyHtml}</div>`;
}

export async function openOrcaConnectModal({ api, showModal } = {}) {
  if (!view.connectionInfo && typeof api === "function") {
    try {
      view.connectionInfo = await api("/api/connection-info");
    } catch {}
  }
  const body = renderOrcaConnectBodyMarkup();
  showModal("Trung tâm Kết nối Đa thiết bị & Android APK", body, "Đóng", "dismiss");
  const modal = $("#overlay .modal");
  modal?.classList.add("orca-connect-modal");
}

export function refreshOrcaConnectModalIfOpen({ showModal } = {}) {
  if (!document.querySelector("#overlay .orca-connect-modal")) return;
  const body = renderOrcaConnectBodyMarkup();
  showModal("Trung tâm Kết nối Đa thiết bị & Android APK", body, "Đóng", "dismiss");
  $("#overlay .modal")?.classList.add("orca-connect-modal");
}
