const fs = require("fs");
const { put } = require("@vercel/blob");

// Trên 5MB thì upload theo từng phần (nhanh và ổn định hơn với video)
const MULTIPART_THRESHOLD = 5 * 1024 * 1024;

/**
 * Chạy sau multer. Khi có BLOB_READ_WRITE_TOKEN (production), đẩy file vừa
 * nhận lên Vercel Blob và thay `file.path` bằng URL công khai, để service lưu
 * URL vào DB như cũ. Ổ đĩa server deploy không giữ file lâu dài.
 * Không có token (local) thì giữ nguyên file trong uploads/.
 */
async function persistUploads(req, res, next) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return next();

  const files = req.file ? [req.file] : Object.values(req.files || {}).flat();

  try {
    await Promise.all(
      files.map(async (file) => {
        const blob = await put(`uploads/${file.filename}`, fs.createReadStream(file.path), {
          access: "public",
          contentType: file.mimetype,
          multipart: file.size > MULTIPART_THRESHOLD,
        });

        await fs.promises.unlink(file.path);
        file.path = blob.url;
      })
    );
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = persistUploads;
