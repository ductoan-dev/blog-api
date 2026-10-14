const response = require("@/utils/response");

const uploadVideo = async (req, res) => {
  if (!req.file) {
    return response.error(res, 400, "Vui lòng chọn file video");
  }

  response.succsess(res, 201, {
    path: req.file.path.replace(/\\/g, "/"),
    mimetype: req.file.mimetype,
    size: req.file.size,
  });
};

module.exports = {
  uploadVideo,
};
