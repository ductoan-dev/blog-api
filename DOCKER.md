# Docker

Hướng dẫn chạy `blog-api` bằng Docker Compose.

## Cấu trúc

`docker-compose.yml` gồm 3 service:

| Service | Vai trò | Port |
|---|---|---|
| `postgres` | Database, dữ liệu lưu vào Docker volume `blog_postgres_data` (không mất khi restart container) | `5433` (host) → `5432` (container) |
| `api` | Chạy `node server.js` | `3000` |
| `worker` | Chạy `node src/workers/queueWorker.js` (xử lý job queue, ví dụ email verify) | không expose port |

`Dockerfile` build 2 stage: stage `deps` cài native toolchain (python3/make/g++) để build `bcrypt`, stage runtime chỉ cài `openssl` (Prisma cần để engine detect đúng bản libssl) rồi copy `node_modules` đã build từ stage `deps` sang — giữ image cuối gọn.

## Lệnh dùng hằng ngày

```bash
cd blog-api

# Khởi động toàn bộ (build lần đầu nếu chưa có image)
docker compose up -d --build

# Xem trạng thái
docker compose ps

# Xem log
docker compose logs -f api        # log riêng api
docker compose logs -f worker     # log riêng worker
docker compose logs -f            # tất cả

# Dừng (giữ nguyên dữ liệu database)
docker compose down

# Dừng + xoá luôn dữ liệu database (reset sạch)
docker compose down -v
```

## Lần đầu chạy trên máy mới (hoặc sau `down -v`)

Database mới tinh chưa có bảng nào, cần chạy migration + seed **1 lần**:

```bash
docker compose up -d
docker compose exec api npx prisma migrate deploy   # tạo bảng theo prisma/migrations/
docker compose exec api npm run seed                 # seed dữ liệu mẫu (3 user, 15 post...)
```

## Khi sửa code

Image Docker **không tự cập nhật** khi bạn sửa file — source code được `COPY` vào image lúc build, không mount volume. Sau khi sửa code:

```bash
docker compose up -d --build api worker
```

(Nếu chỉ đổi code không đổi `package.json`, build sẽ nhanh nhờ cache layer `deps`.)

## Khi thêm migration mới (đổi `prisma/schema.prisma`)

```bash
# Tạo migration mới — chạy trên máy (native), không phải trong container,
# vì lệnh này cần ghi file mới vào prisma/migrations/
npx prisma migrate dev --name ten_migration

# Rebuild image với schema mới, rồi áp migration vào DB trong container
docker compose up -d --build api worker
docker compose exec api npx prisma migrate deploy
```

## Kết nối pgAdmin4 vào Postgres trong Docker

Đăng ký server mới trong pgAdmin4 (không sửa server có sẵn):

- Host: `localhost`
- Port: `5433`
- Username: `postgres`
- Password: `postgres`
- Maintenance database: `postgres` (sẽ thấy database `blog` bên trong)

## Lưu ý quan trọng

- File `.env` **không được build vào image** (đã liệt trong `.dockerignore`) — nó được nạp vào lúc container chạy thông qua `env_file` trong `docker-compose.yml`. Sửa `.env` xong chỉ cần `docker compose up -d` lại, **không cần rebuild**.
- `docker-compose.yml` tự set `DATABASE_URL` trỏ vào service `postgres` nội bộ (`postgres:5432`) — khác với giá trị trong `.env` (trỏ `localhost:5433`, dùng khi chạy `node server.js` trực tiếp trên máy, không qua Docker). Hai cách chạy (native vs Docker) dùng 2 connection string khác nhau, đừng nhầm lẫn.
- Thư mục `uploads/` được mount ra ngoài (`./uploads:/app/uploads`) nên ảnh upload không mất khi container `api` bị xoá/tạo lại.
- Nếu cổng `3000` hoặc `5433` đang bị chiếm bởi tiến trình khác trên máy (ví dụ đang chạy `node server.js` native song song), `docker compose up` sẽ báo lỗi bind port — cần tắt tiến trình đó hoặc đổi port mapping trong `docker-compose.yml`.
