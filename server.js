require("module-alias/register");
require("dotenv").config();
const http = require("http");
const express = require("express");
const cors = require("cors");
const path = require("path");
const { Server } = require("socket.io");
const router = require("@/routes/api");
const app = express();

const errorHandler = require("@/middlewares/errors/errorHandler");
const notFoudHandler = require("@/middlewares/errors/notFoundHandler");

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use("/api/v1/uploads", express.static(path.join(__dirname, "uploads")));

app.use("/api/v1", router);

app.use(notFoudHandler);
app.use(errorHandler);

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
});

require("@/socket")(io);

// Host (Render...) cấp cổng qua biến PORT
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Nơi không có service worker riêng (Render free) thì chạy queue worker chung process.
// Local Docker đã có container worker riêng nên không bật biến này.
if (process.env.RUN_QUEUE_WORKER === "true") {
  require("@/workers/queueWorker");
}
