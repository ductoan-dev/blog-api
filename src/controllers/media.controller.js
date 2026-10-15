const response = require("@/utils/response");

// Trả về path (local) hoặc URL Vercel Blob (production) của file vừa upload
const uploadMedia = async (req, res) => {
  if (!req.file) {
    return response.error(res, 400, "Vui lòng chọn file");
  }

  response.succsess(res, 201, {
    path: req.file.path.replace(/\\/g, "/"),
    mimetype: req.file.mimetype,
    size: req.file.size,
  });
};

module.exports = {
  uploadMedia,
};
