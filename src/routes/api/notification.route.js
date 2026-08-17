const express = require("express");
const router = express.Router();
const notificationController = require("@/controllers/notification.controller");
const checkAuth = require("@/middlewares/checkAuth");

router.get("/", checkAuth, notificationController.getAll);
router.patch("/:id/read", checkAuth, notificationController.markRead);
router.patch("/read-all", checkAuth, notificationController.markAllRead);

module.exports = router;
