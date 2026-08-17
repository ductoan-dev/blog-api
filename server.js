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

server.listen(3000, () => {
  console.log("Server running on port 3000");
});
