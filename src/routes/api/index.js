const express = require("express");

const authRouter = require("./auth.route");
const userRouter = require("./user.route");

const postRouter = require("./post.route");
const topicRouter = require("./topic.route");
const commentRouter = require("./comment.route");
const likeRouter = require("./like.route");
const bookmarkRouter = require("./booknmark.route");
const messengerRouter = require("./messenger.route");
const notificationRouter = require("./notification.route");
const { me } = require("@/controllers/auth.controller");


const router = express.Router();

// auth
router.use("/auth", authRouter);
router.use("/posts", postRouter);
router.use("/profile", userRouter);
router.use("/topics", topicRouter);
router.use("/comments", commentRouter);
router.use("/users", userRouter);
router.use("/likes", likeRouter);
router.use("/bookmarks", bookmarkRouter);


// messenger
router.use("/messenger", messengerRouter);
router.use("/notifications", notificationRouter);
module.exports = router;
