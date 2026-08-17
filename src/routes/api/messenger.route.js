const express = require("express");
const router = express.Router();
const messengerController = require("@/controllers/messenger.controller");
const checkAuth = require("@/middlewares/checkAuth");

router.get("/conversations", checkAuth, messengerController.getConversations);
router.post("/conversations/direct/:userId", checkAuth, messengerController.getOrCreateDirect);
router.get("/conversations/:conversationId/messages", checkAuth, messengerController.getMessages);
router.post("/conversations/:conversationId/messages", checkAuth, messengerController.sendMessage);

module.exports = router;
