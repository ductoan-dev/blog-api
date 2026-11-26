# Chatbot RAG — chạy và kiểm tra local

Tích hợp theo cấu trúc hiện có: Express controller/route/service, Prisma,
React/Vite và SCSS Modules. Hướng dẫn này dành cho local; trạng thái production
và cách triển khai nằm trong [VERCEL-DEPLOYMENT.md](./VERCEL-DEPLOYMENT.md).

## 1. Nhà cung cấp AI

- **Gemini** tạo cả câu trả lời và vector bằng một `GEMINI_API_KEY`.
  Tạo key tại https://aistudio.google.com/apikey. Free tier có quota tùy project/model;
  ứng dụng không tự đổi sang provider khác khi hết quota.
- Có thể dùng OpenAI bằng `AI_PROVIDER=openai` và `OPENAI_API_KEY`.
  OpenAI cần API credit khả dụng; tạo key không tự cấp credit. Lỗi hết credit
  được hiển thị riêng với lỗi giới hạn tốc độ.
- Không đưa key vào `VITE_*`, frontend hoặc Git. Chỉ thêm key vào
  `blog-api/.env.ai.local` trên máy của bạn.

File mẫu đang chọn Gemini: `gemini-3.5-flash-lite` và `gemini-embedding-001` (1536 chiều).
Nếu chọn OpenAI, dùng `gpt-4.1-mini` và `text-embedding-3-small`.
Có thể đổi model chat/base URL/key qua cấu hình. Thay model embedding cần backfill
lại; chỉ mục thuộc model cũ tự động bị loại khỏi kết quả.

## 2. Chuẩn bị lần đầu

Yêu cầu Node.js 20+ và Docker Desktop đang chạy. Chạy trong `blog-api`:

```powershell
npm install
Copy-Item .env.ai.local.example .env.ai.local
docker compose -p blog-ai-local -f docker-compose.ai-local.yml up -d --wait
npm run ai:local -- generate
npm run ai:local -- migrate
npm run ai:local -- seed
```

Chỉ copy file ví dụ khi chưa có `.env.ai.local`, để tránh ghi đè key đã nhập.
Các bước migration và seed đã được thực hiện trên máy trong lần triển khai này.
Database local nằm ở `127.0.0.1:5434/blog_ai_local`, hoàn toàn riêng với `.env`
hiện tại. Script `ai:local` từ chối URL database không phải loopback và không
dispatch job tới QStash. Lệnh seed chỉ tạo/cập nhật ba bài mẫu local.

Thêm key vào `.env.ai.local` (file `.example` chỉ là mẫu, không được nạp khi chạy):

```dotenv
AI_PROVIDER=gemini
GEMINI_API_KEY=your-gemini-key
AI_CHAT_MODEL=gemini-3.5-flash-lite
AI_EMBEDDING_MODEL=gemini-embedding-001
```

Trong `blog-ui`, tạo `.env.ai.local` (đã tạo sẵn ở máy này):

```dotenv
VITE_BASE_URL=http://localhost:3001/api/v1
VITE_AI_API_URL=http://localhost:3001/api/v1/ai
```

Hai file local được Git ignore. Cấu hình Vercel/frontend production hiện tại không
bị đổi URL API. `npm run dev:ai` mới sử dụng cấu hình frontend này.

## 3. Chạy

Terminal thứ nhất, trong `blog-api`:

```powershell
npm run ai:local -- backfill
npm run ai:local -- serve
```

Backend chạy trên `http://localhost:3001`. Khi có key của provider đã chọn, local server tự lấy
từng job pending mỗi 3 giây; bài mới/sửa được xử lý qua cùng service với HTTP job.
Đợi chỉ mục hoàn tất rồi hỏi chatbot. Kiểm tra tiến độ bằng terminal khác:

```powershell
npm run ai:local -- status
```

Thử trực tiếp một câu hỏi qua cùng service RAG (có gọi API thật):

```powershell
npm run ai:local -- ask "useEffect dùng để làm gì?"
```

Có thể xử lý tối đa 20 job một lượt bằng `npm run ai:local -- work` khi server đang
tắt. Job lỗi được retry có backoff, tối đa 5 lần. `backfill` có thể reset job để
thử lại sau khi sửa key/quota. Backfill không tạo lại embedding nếu nội dung và
model chưa đổi.

Terminal thứ hai, trong `blog-ui`:

```powershell
npm install
npm run dev:ai
```

Mở `http://127.0.0.1:5174`, bấm **Hỏi AI** ở góc phải. Cổng 5174 dành riêng cho
bản AI local để tránh trùng Vite hiện có trên cổng 5173. Nếu chưa có key, trạng thái
hiển thị chưa sẵn sàng; ứng dụng không giả lập câu trả lời trong chế độ sử dụng.
Sau khi nhập key, khởi động lại backend.

## 4. Các câu hỏi để thử

1. “useEffect dùng để làm gì?” → nguồn bài *Hiểu useEffect trong React*.
2. “Giải thích kỹ hơn về cleanup” → giữ ngữ cảnh câu hỏi trước.
3. “Prisma quản lý thay đổi database thế nào?” → bài PostgreSQL/Prisma.
4. “RAG tạo câu trả lời từ bài viết như thế nào?” → bài RAG.
5. “Giá vàng hôm nay?” → báo thiếu nội dung trong blog.
6. Mở liên kết dẫn nguồn để kiểm tra nội dung bài.
7. Sửa nội dung bài, chuyển riêng tư/nháp hoặc xóa bài → không được trả dữ liệu
   cũ; đổi slug → liên kết dùng slug mới.

Ngưỡng tìm kiếm mặc định `AI_MIN_SIMILARITY=0.45` cần được đánh giá với dữ liệu thật.
Việc kiểm tra mã nguồn dẫn đảm bảo mã tồn tại, không thay thế đánh giá nội dung
câu trả lời của model. Chưa đánh giá chất lượng tiếng Việt với API thật khi chưa
có key.

## 5. Kiểm thử tự động không tốn quota AI

Chạy trong `blog-api`, tạo database test một lần:

```powershell
docker exec blog-ai-postgres-local createdb -U blog_ai blog_ai_test
npm run ai:local -- test:migrate
npm run test:ai
npm run ai:local -- test:base
```

Nếu database test đã tồn tại, bỏ qua lệnh `createdb`. AI tests chỉ chạy trên
`blog_ai_test` của PostgreSQL local, mock provider để không gửi nội dung lên API.
Không chạy `test:ai` và `test:base` đồng thời vì cùng dùng database test này.
`npm test` vẫn giữ cấu hình test cũ của dự án; các bài test AI được tách riêng.

Trong `blog-ui`:

```powershell
npm run test:ai
npm run build
```

Test gồm chia đoạn HTML/code/tiếng Việt, vector, retrieval SQL, quyền truy cập,
nội dung lỗi thời, sửa bài trong khi tạo embedding, job trùng/retry, chữ ký raw
body, dẫn nguồn, quota đồng thời, payload OpenAI/Gemini và tương tác widget.

## 6. Chuẩn bị cho Vercel sau khi duyệt local

Production đã được cấu hình theo [VERCEL-DEPLOYMENT.md](./VERCEL-DEPLOYMENT.md).
Danh sách dưới đây là tham khảo kiến trúc ban đầu; deployment hiện dùng
`waitUntil`, kiểm tra thay đổi trước chat và cron recovery thay cho QStash bắt buộc.

- Giữ frontend Vercel hiện có. Tạo project API AI với root directory `blog-api`,
  dùng entrypoint `api/ai.js` và `vercel.json`. Entrypoint này chỉ nạp HTTP AI,
  không khởi động Socket.IO hay vòng lặp worker hiện có.
- Bật pgvector trên PostgreSQL hosting và áp migration qua một bước phát hành
  được kiểm soát. Build Vercel chỉ generate Prisma client, không migrate database.
- Cấu hình `DATABASE_URL` dùng pooling phù hợp nhà cung cấp, `CLIENT_URL` là origin
  frontend, `AI_ENABLED=true`, `AI_PROVIDER=gemini`, `GEMINI_API_KEY` và các model/hạn mức như file ví dụ.
- Frontend đặt `VITE_AI_API_URL=https://YOUR-AI-API.vercel.app/api/v1/ai`.
  Không thay `VITE_BASE_URL` nếu backend hiện tại vẫn chạy ở hosting cũ.
- Cấu hình `QSTASH_TOKEN`, hai signing key và `AI_INDEX_JOB_URL` trỏ tới
  `https://YOUR-AI-API.vercel.app/api/v1/ai/jobs/index`.
- Backend hiện tại cũng cần `AI_ENABLED`, cấu hình QStash/job URL và Prisma client
  mới để hook đăng/sửa bài ghi outbox và phát job. Các dịch vụ dùng cùng database.
- Recovery endpoint `GET /api/v1/ai/jobs/dispatch` yêu cầu
  `Authorization: Bearer <CRON_SECRET>` (hoặc `AI_JOB_SECRET`). Lên lịch gọi định
  kỳ bằng QStash hoặc scheduler phù hợp gói hosting để phục hồi dispatch lỗi.
- Job xử lý một bài/request, lease 2 phút, Function tối đa 60 giây; script local
  không chạy trên Vercel. Reconciliation tự phục hồi tối đa 10 bài mỗi lượt trong
  1.000 bài đầu; backfill corpus lớn dùng phân trang như lệnh local và cần được
  chuẩn bị riêng trong lần phát hành production.
- Quota chat lưu trong database, mặc định 5 câu/phút/IP và 100 câu/ngày toàn site.
  Các giới hạn này giúp hạn chế sử dụng, không phải giới hạn tiền từ nhà cung cấp.
  Recovery endpoint cũng dọn bộ đếm quá 2 ngày.

Không bật worker `RUN_QUEUE_WORKER` của server cũ trong project AI Vercel.

## 7. Dừng local

Nhấn Ctrl+C trong các terminal backend/frontend. Nếu không cần database nữa:

```powershell
docker compose -p blog-ai-local -f docker-compose.ai-local.yml stop
```

Không dùng `down -v` nếu muốn giữ bài viết và chỉ mục local.

## Lỗi 404 khi gọi chat trên cổng 3000

Container `blog-api` chạy từ image đã build có thể chưa chứa route AI mới. Restart
container không cập nhật mã nguồn trong image. Backend AI local dùng cổng 3001.

`npm run dev` đọc `blog-ui/.env.local`, còn `npm run dev:ai` đọc thêm
`blog-ui/.env.ai.local`. Để trỏ riêng AI về backend mới khi dùng lệnh dev thường,
đặt `VITE_AI_API_URL=http://localhost:3001/api/v1/ai` trong `.env.local` và
khởi động lại Vite nếu chưa tự nạp lại cấu hình.

Blog và AI phải dùng cùng tập dữ liệu. Trên máy này, dữ liệu thực tế từ Docker
đã được sao chép vào pgvector local; cả `VITE_BASE_URL` và `VITE_AI_API_URL`
đều trỏ tới backend 3001. `npm run dev` (5173) hoặc `npm run dev:ai` (5174)
đều đọc cùng database, nên liên kết nguồn mở được bài thật.

## Dùng dữ liệu Docker thật thay cho bài mẫu

Chỉ chạy khi database đích còn trống hoặc chỉ có ba bài demo:

```powershell
npm run ai:local -- import-docker
npm run ai:local -- backfill
npm run ai:local -- work
```

Lệnh import chỉ đọc `blog-postgres/blog`, sao chép sang `blog_ai_local` tại cổng
5434 bằng transaction; từ chối ghi đè dữ liệu đích không phải demo. Backup đích
được giữ trong `.local-backups/` (Git ignore). Database Docker gốc không bị đổi.
Lệnh cũng giữ khóa xác thực local của API gốc để các phiên đang đăng nhập có thể
dùng bản sao. Khởi động lại backend 3001 sau khi import.

Sau bước này, đăng/sửa bài qua frontend 3001 sẽ cập nhật chỉ mục tự động. Không
chạy lệnh `seed` nếu chỉ muốn chatbot sử dụng bài thật; lệnh đó thêm bài demo.
