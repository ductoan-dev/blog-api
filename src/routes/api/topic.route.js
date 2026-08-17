const express = require("express");

const router = express.Router();
const topicController = require("@/controllers/topic.comtroller");
const checkAuth = require("@/middlewares/checkAuth");

router.get("/", topicController.index);
router.get("/slug/:slug", topicController.getBySlug);
router.get("/id/:id", topicController.getOne);

router.post("/", checkAuth, topicController.create);
router.put("/:id", checkAuth, topicController.update);
router.delete("/:id", checkAuth, topicController.remove);

module.exports = router;
