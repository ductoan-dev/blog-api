const express = require("express");

const router = express.Router();
const commentController = require("@/controllers/comment.controller");
const checkAuth = require("@/middlewares/checkAuth");
const optionalAuth = require("@/middlewares/optionalAuth");

router.get("/", commentController.index);
router.get("/slug/:slug", commentController.getBySlug);
router.get("/id/:id", commentController.getOne);
router.get("/post/:postId", optionalAuth, commentController.getAllCommentsInPost);

router.post("/", checkAuth, commentController.create);
router.post("/:commentId/like", checkAuth, commentController.toggleLike);
// router.post(
//   "/:commentId/like",
//   checkAuth,
//   (req, res, next) => {
//     console.log("Params:", req.params); // ← Xem có commentId không
//     next();
//   },
//   commentController.toggleLike
// );

router.put("/:id", checkAuth, commentController.update);
router.delete("/:id", commentController.remove);

module.exports = router;
