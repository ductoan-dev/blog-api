const express = require("express");

const router = express.Router();
const mediaController = require("@/controllers/media.controller");
const checkAuth = require("@/middlewares/checkAuth");
const { videoUpload } = require("@/middlewares/upload");
const persistUploads = require("@/middlewares/persistUploads");

// checkAuth chạy trước multer để không lưu file của request chưa đăng nhập
router.post("/video", checkAuth, videoUpload.single("video"), persistUploads, mediaController.uploadVideo);

module.exports = router;
