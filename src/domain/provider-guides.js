export const cliProviderGuides = [
  {
    id: "codex",
    name: "Codex CLI",
    summary: "OpenSybau tự dò Codex CLI. Đăng nhập bằng tài khoản ChatGPT trong cửa sổ terminal; không cần OpenAI API key.",
    installHelp: "Cài Codex CLI theo hướng dẫn chính thức của OpenAI trên máy chạy OpenSybau, rồi quay lại đây và quét lại.",
    loginCommand: "codex login",
    loginHelp: "Mở trình duyệt để đăng nhập ChatGPT. Khi hoàn tất, quay lại OpenSybau và quét lại.",
    url: "https://developers.openai.com/codex/cli",
  },
  {
    id: "antigravity",
    name: "Antigravity CLI",
    summary: "OpenSybau tự dò agy CLI. Chạy lần đầu sẽ mở quy trình chọn cách xác thực của Google.",
    installHelp: "Cài Antigravity CLI theo hướng dẫn chính thức của Google trên máy chạy OpenSybau, rồi quay lại đây và quét lại.",
    loginCommand: "agy",
    loginHelp: "Làm theo lời nhắc đăng nhập trong CLI. Hỗ trợ đăng nhập Google hoặc cấu hình Gemini API key theo tài liệu Google.",
    url: "https://antigravity.google/docs/cli/install",
  },
  {
    id: "claude",
    name: "Claude Code CLI",
    summary: "OpenSybau tự dò Claude Code. Đăng nhập bằng tài khoản Anthropic hoặc Claude Console.",
    installHelp: "Chưa tìm thấy Claude Code trên máy. Cài bằng hướng dẫn chính thức rồi bấm Quét lại; nếu đã cài nhưng đường dẫn không có trong PATH, chọn file CLI thủ công.",
    loginCommand: "claude auth login",
    loginHelp: "Mở trình duyệt để đăng nhập Claude hoặc Claude Console. Có thể dùng Console mà không cần tự tạo API key.",
    url: "https://code.claude.com/docs/en/setup",
    authUrl: "https://code.claude.com/docs/en/authentication",
  },
];

export function cliConnectionStatus(connector) {
  if (connector?.available) return { label: "Sẵn sàng", tone: "ready", action: "refresh" };
  if (!connector?.installed) return { label: "Chưa cài", tone: "missing", action: "install" };
  if (connector.authenticated === false) return { label: "Cần đăng nhập", tone: "needs-action", action: "login" };
  return { label: "Cần kiểm tra", tone: "needs-action", action: "refresh" };
}
