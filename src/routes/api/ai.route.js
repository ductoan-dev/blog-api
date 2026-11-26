const express = require("express");
const controller = require("@/controllers/ai.controller");
const rateLimit = require("@/middlewares/aiRateLimit");
const { validateInput } = require("@/service/aiChat.service");
const router = express.Router();

router.get("/suggestions", controller.suggestions);
router.post("/chat", (req, res, next) => {
  try { req.aiInput = validateInput(req.body); next(); } catch (error) { next(error); }
}, rateLimit, controller.chat);
router.post("/jobs/index", controller.index);
router.get("/jobs/dispatch", controller.reconcile);
router.use(controller.errorHandler);

module.exports = router;
