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

// Upload có giới hạn dung lượng + định dạng (ảnh/video chèn trong bài viết)
const createMediaUpload = ({ maxSize, mimeTypes, invalidTypeMessage }) =>
  multer({
    storage,
    limits: { fileSize: maxSize },
    fileFilter: function (req, file, cb) {
      if (mimeTypes.includes(file.mimetype)) return cb(null, true);

      const error = new Error(invalidTypeMessage);
      error.status = 400;
      cb(error);
    },
  });

const videoUpload = createMediaUpload({
  maxSize: 100 * 1024 * 1024, // 100MB
  mimeTypes: ["video/mp4", "video/webm", "video/ogg", "video/quicktime"],
  invalidTypeMessage: "Chỉ hỗ trợ video MP4, WebM, OGG hoặc MOV",
});

const imageUpload = createMediaUpload({
  maxSize: 10 * 1024 * 1024, // 10MB
  mimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  invalidTypeMessage: "Chỉ hỗ trợ ảnh JPG, PNG, GIF hoặc WebP",
});

module.exports = upload;
module.exports.videoUpload = videoUpload;
module.exports.imageUpload = imageUpload;
