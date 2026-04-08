const express = require("express");

const router = express.Router();
const userController = require("@/controllers/user.controller");
const checkAuth = require("@/middlewares/checkAuth");
const upload = require("@/middlewares/upload");

router.get("/follow/:userId", checkAuth, userController.checkFollowing);

router.get("/:username", checkAuth, userController.getUserByUsername);
router.post("/follow/:userId", checkAuth, userController.toggleFollow);
router.put(
  "/edit-profile",
  checkAuth,
  upload.fields([
    { name: "avatar", maxCount: 1 },
    { name: "cover_image", maxCount: 1 },
  ]),
  userController.editProfile
);
router.post("/settings", checkAuth, userController.settings);

module.exports = router;
