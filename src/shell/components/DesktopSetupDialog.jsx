import { h } from "preact";
import { Icon } from "../../shared/ui/Icon.jsx";
import { cliConnectionStatus, cliProviderGuides } from "../../domain/provider-guides.js";

export function DesktopSetupDialog({ connectors, installingProvider = "" }) {
  if (!connectors) return null;
  const configuredApis = Object.entries(connectors).filter(([, connector]) => connector?.kind === "api" && connector.available);
  const readyCount = cliProviderGuides.filter(({ id }) => connectors[id]?.available).length + configuredApis.length;
  const missing = cliProviderGuides.filter(({ id }) => !connectors[id]?.available);
  const supportsInstall = Boolean(window.opensybauDesktop?.supportsCliInstall);

  return <div class="desktop-setup-backdrop" role="presentation">
    <section class="desktop-setup-dialog app-dialog-shell" role="dialog" aria-modal="true" aria-labelledby="desktop-setup-title">
      <header class="desktop-setup-heading app-dialog-header">
        <span class="desktop-setup-mark"><Icon name="workflow" size={21} /></span>
        <div><div class="desktop-setup-eyebrow">OPENSYBAU · THIẾT LẬP</div><h2 id="desktop-setup-title">Kết nối AI cho workspace</h2></div>
        <button class="wb-top-icon" type="button" data-action="dismiss-desktop-setup" aria-label="Đóng hướng dẫn">×</button>
      </header>
      <div class="app-dialog-content desktop-setup-content">
      <p class="desktop-setup-intro">OpenSybau tự tìm CLI đã có. Chọn một trong ba CLI bên dưới để cài trực tiếp; bạn cũng có thể cài nhiều hơn một. Sau khi cài hoặc đăng nhập, bấm Quét lại.</p>
      <div class="desktop-setup-agent-list">
        {cliProviderGuides.map((agent) => {
          const connector = connectors[agent.id];
          const status = cliConnectionStatus(connector);
          const detail = status.tone === "ready"
            ? `${connector.models.length} model${connector.models.length === 1 ? "" : "s"}${connector.version && connector.version !== "unavailable" ? ` · ${connector.version}` : ""}`
            : status.tone === "missing" ? connector?.error || agent.installHelp : connector?.installed && connector?.error ? connector.error : agent.summary;
          return <article class={`desktop-setup-agent ${status.tone === "ready" ? "is-ready" : "is-missing"}`} key={agent.id}>
            <span class="desktop-setup-agent-icon"><Icon name={status.tone === "ready" ? "check" : "square-terminal"} size={17} /></span>
            <div class="desktop-setup-agent-copy"><strong>{agent.name}</strong><span>{detail}</span>{status.tone !== "ready" && <small class={`cli-guide-status ${status.tone}`}>{status.label}</small>}</div>
            {status.tone === "ready" ? <span class="desktop-setup-status">Sẵn sàng</span> : status.tone === "missing" ? supportsInstall ? <button class="button quiet desktop-setup-install" type="button" data-action="provider-cli-install" data-id={agent.id} disabled={Boolean(installingProvider)}>{installingProvider === agent.id ? "Đang cài đặt…" : "Cài CLI"}</button> : <a class="button quiet desktop-setup-install" href={agent.url} target="_blank" rel="noreferrer">Hướng dẫn cài</a> : <div class="desktop-setup-agent-actions">{status.action === "refresh" ? <button class="button quiet desktop-setup-install" type="button" data-action="provider-cli-refresh">Quét lại</button> : <button class="button quiet desktop-setup-install" type="button" data-action="provider-cli-login" data-id={agent.id}>Mở terminal đăng nhập</button>}</div>}
          </article>;
        })}
      </div>
      {configuredApis.length > 0 && <p class="desktop-setup-api-ready"><Icon name="check" size={15} /> API đã cấu hình: {configuredApis.map(([, item]) => item.name).join(", ")}</p>}
      <div class="desktop-setup-note">
        <strong>{readyCount ? `${readyCount} provider sẵn sàng` : "Chưa có provider nào sẵn sàng"}</strong>
        <span>{readyCount ? "Bạn có thể bắt đầu ngay. Khi cần, thêm CLI, API hoặc model local trong Cài đặt." : "Máy này chưa có kết nối sẵn. Bạn có thể cài một CLI hoặc thêm OpenAI, Gemini, Claude API hay model local trong Cài đặt."}</span>
      </div>
      {(missing.length > 0 || configuredApis.length === 0) && <p class="desktop-setup-footnote">OpenSybau chỉ chạy bộ cài chính thức của nhà cung cấp sau khi bạn xác nhận. Nút đăng nhập mở terminal trên máy chạy OpenSybau; sau khi đăng nhập, bấm Quét lại. CLI không cần API key riêng.</p>}
      </div>
      <footer class="desktop-setup-actions app-dialog-footer">
        <button type="button" class="button quiet" data-action="desktop-open-settings"><Icon name="settings-2" size={15} /> Mở cài đặt</button>
        <button type="button" class="button quiet" data-action="refresh"><Icon name="refresh-cw" size={15} /> Quét lại</button>
        <button type="button" class="button primary" data-action="dismiss-desktop-setup">{readyCount ? "Bắt đầu sử dụng" : "Tiếp tục thiết lập sau"}</button>
      </footer>
    </section>
  </div>;
}
