const fs = require("fs");
const multer = require("multer");
const path = require("path");
const slugify = require("slugify");

const UPLOAD_DIR = "uploads/";

// Thư mục bị .dockerignore loại khỏi image -> tự tạo khi chạy trên server mới
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Cấu hình nơi lưu trữ
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIR); // thư mục lưu file
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    // Bỏ dấu/khoảng trắng để URL file không cần encode
    const basename =
      slugify(path.basename(file.originalname, ext), { lower: true, strict: true }) || "file";
    cb(null, `${basename}-${Date.now()}${ext}`);
  },
});

const upload = multer({ storage });

const VIDEO_MAX_SIZE = 100 * 1024 * 1024; // 100MB
const VIDEO_MIME_TYPES = ["video/mp4", "video/webm", "video/ogg", "video/quicktime"];

const videoUpload = multer({
  storage,
  limits: { fileSize: VIDEO_MAX_SIZE },
  fileFilter: function (req, file, cb) {
    if (VIDEO_MIME_TYPES.includes(file.mimetype)) return cb(null, true);

    const error = new Error("Chỉ hỗ trợ video MP4, WebM, OGG hoặc MOV");
    error.status = 400;
    cb(error);
  },
});

module.exports = upload;
module.exports.videoUpload = videoUpload;
