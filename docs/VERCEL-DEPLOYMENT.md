# Vercel production

- Blog: https://blog-ui-rose.vercel.app
- AI API: https://blog-ai-api-eta.vercel.app
- API blog hiện có: https://blog-api-19ba.onrender.com/api/v1
- Frontend project: `blog-ui`.
- AI project: `blog-ai-api`, Node.js 22 LTS, Function tối đa 180 giây.

Frontend dùng API Render hiện có cho bài viết, tài khoản và Messenger. Request
`/api/v1/ai/*` được Vercel rewrite sang AI API, nên trình duyệt gọi AI cùng origin.
API AI và Render dùng cùng database Neon production. Không dùng database `.env`
local để triển khai production, và không nhập các bài demo local vào production.

Migration `20261126000000_add_ai_rag` đã được áp dụng, thêm pgvector và bốn bảng
AI. Bài viết production hiện có được giữ nguyên và đã lập chỉ mục bằng Gemini.
Tại thời điểm triển khai, production có một bài công khai; corpus local 17 bài
được giữ riêng.

## Biến môi trường

Vercel lưu `DATABASE_URL`, `GEMINI_API_KEY`, `CRON_SECRET`, `AI_RATE_LIMIT_SALT`
dưới dạng Secrets. Không ghi giá trị vào repo hoặc lệnh shell.

AI project còn có `AI_ENABLED=true`, `AI_PROVIDER=gemini`, `AI_SYNC_ON_CHAT=true`,
`AI_CHAT_MODEL=gemini-3.5-flash-lite`, `AI_EMBEDDING_MODEL=gemini-embedding-001`
và các giới hạn lượt hỏi. Frontend có `VITE_AI_API_URL=/api/v1/ai`; API key AI
không nằm trong frontend.

## Đồng bộ bài viết

Trước khi trả lời, AI kiểm tra các bài công khai đã xuất bản và lập chỉ mục cho
một bài thay đổi nếu cần. Điều này hỗ trợ backend Render hiện tại ngay cả khi
backend đó chưa phát event lập chỉ mục. Các job còn lại được xử lý bằng
`waitUntil` có giới hạn và giữ trạng thái trong database để retry.

Vercel Cron gọi `/api/v1/ai/jobs/dispatch` hằng ngày lúc 00:00 UTC (07:00 giờ
Việt Nam), dùng `CRON_SECRET` để phục hồi job. Khi backend chính được cập nhật
với hook AI và có cấu hình tương ứng, publish/edit có thể lập chỉ mục ngay qua
cùng service; QStash là tùy chọn cho nhu cầu queue lớn hơn.

## Deploy tiếp

Trong `blog-api` hoặc `blog-ui`, các thư mục đã liên kết đúng project:

```powershell
vercel.cmd deploy --prod --yes
```

Muốn kiểm tra trước khi chuyển domain frontend:

```powershell
vercel.cmd deploy --prod --skip-domain --yes
vercel.cmd curl /api/v1/ai/suggestions --deployment https://YOUR-DEPLOYMENT.vercel.app
vercel.cmd promote https://YOUR-DEPLOYMENT.vercel.app --yes
```

Giữ Deployment Protection bật. `vercel curl` dùng cơ chế xác thực của CLI cho
deployment được bảo vệ. Gói upload loại trừ `.env*`, backup, `.vercel` và
`node_modules` bằng `.vercelignore`. Build API chỉ generate Prisma client;
migration production phải là bước riêng đã kiểm tra.

Các file source mới cần được commit khi bạn dùng GitHub auto-deploy, để lần
push sau giữ đúng phiên bản đã xuất bản qua CLI.

## Thiết lập agent Vercel

Đã làm theo https://vercel.com/get-started.md:

- Vercel CLI 67.0.0 cài toàn cục, đăng nhập tài khoản `ductoan-dev`.
- Plugin `vercel@openai-curated` đã cài và bật cho Codex ở phạm vi người dùng.
- MCP shared endpoint `https://mcp.vercel.com` đã có trong cấu hình Codex.
- OAuth MCP chưa hoàn tất: CLI báo `Authorization server response missing
  required issuer: expected https://vercel.com`. Chưa xác nhận được
  `list_teams` qua MCP. Các deployment ở trên dùng CLI đã xác thực.
- Giữ nguyên cơ chế xác nhận thao tác MCP; không tắt xác nhận để xử lý lỗi OAuth.
