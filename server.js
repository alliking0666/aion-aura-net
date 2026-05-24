require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const http = require("http");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEB_APP_URL = process.env.WEB_APP_URL || "https://aion-aura-net.onrender.com";

app.use(cors({ origin: "*" }));
app.use(helmet());
app.use(express.json({ limit: "10mb" }));app.use("/app", express.static(path.join(__dirname, "frontend")));

app.get("/app", (req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "index.html"));
});

function loadJson(relativePath, fallback = {}) {
  try {
    return require(path.join(__dirname, relativePath));
  } catch (error) {
    console.log(`Config not found: ${relativePath}`);
    return fallback;
  }
}

const appConfig = loadJson("./config/app.json");
const features = loadJson("./config/features.json");
const theme = loadJson("./config/theme.json");
const permissions = loadJson("./config/permissions.json");
const security = loadJson("./config/security.json");
const media = loadJson("./config/media.json");
const pwa = loadJson("./config/pwa.json");
const telegramConfig = loadJson("./config/telegram.json");
const webrtcConfig = loadJson("./config/webrtc.json");

const languages = loadJson("./data/languages.json");
const genders = loadJson("./data/genders.json");
const ages = loadJson("./data/ages.json");
const interests = loadJson("./data/interests.json");
const chatModes = loadJson("./data/chatModes.json");
const statusMessages = loadJson("./data/statusMessages.json");

app.get("/", (req, res) => {
  res.json({
    status: "online",
    app: "AION AURA NET",
    version: "1.0.0"
  });
});

app.get("/api/config", (req, res) => {
  res.json({
    appConfig,
    features,
    theme,
    permissions,
    security,
    media,
    pwa,
    telegramConfig,
    webrtcConfig
  });
});

app.get("/api/welcome", (req, res) => {
  res.json({
    app: "AION AURA NET",
    message: "Anonymous random chat for text, voice and video.",
    languages,
    genders,
    ages,
    interests,
    chatModes
  });
});

app.get("/api/interests", (req, res) => {
  res.json(interests);
});

app.get("/api/filters", (req, res) => {
  res.json({
    languages,
    genders,
    ages,
    interests,
    chatModes
  });
});

app.post("/api/report", (req, res) => {
  res.json({
    ok: true,
    message: "Report received"
  });
});const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const queues = {
  text: [],
  voice: [],
  video: []
};

const partners = new Map();

function removeFromQueues(socketId) {
  Object.keys(queues).forEach((mode) => {
    queues[mode] = queues[mode].filter(
      (user) => user.socketId !== socketId
    );
  });
}

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.on("join_queue", (payload = {}) => {
    const mode = payload.mode || "text";

    if (!queues[mode]) {
      socket.emit("error_message", "Unknown chat mode");
      return;
    }

    removeFromQueues(socket.id);

    const queue = queues[mode];

    const partnerIndex = queue.findIndex(
      (user) => user.socketId !== socket.id
    );

    if (partnerIndex !== -1) {
      const partner = queue.splice(partnerIndex, 1)[0];

      partners.set(socket.id, partner.socketId);
      partners.set(partner.socketId, socket.id);

      socket.emit("partner_found", {
        partnerId: partner.socketId,
        mode
      });

      io.to(partner.socketId).emit("partner_found", {
        partnerId: socket.id,
        mode
      });

    } else {
      queue.push({
        socketId: socket.id,
        filters: payload.filters || {},
        joinedAt: Date.now()
      });

      socket.emit("searching", {
        message:
          statusMessages.statusMessages?.searching ||
          "Searching for random partner..."
      });
    }
  });

  socket.on("leave_queue", () => {
    removeFromQueues(socket.id);

    socket.emit("queue_left", {
      ok: true
    });
  });

  socket.on("send_message", (data = {}) => {
    const partnerId =
      data.to || partners.get(socket.id);

    if (!partnerId) return;

    io.to(partnerId).emit("receive_message", {
      from: socket.id,
      message: data.message,
      media: data.media || null,
      time: Date.now()
    });
  });

  socket.on("typing", () => {
    const partnerId = partners.get(socket.id);

    if (partnerId) {
      io.to(partnerId).emit("typing_status", {
        from: socket.id
      });
    }
  });

  socket.on("webrtc_offer", (data = {}) => {
    const partnerId =
      data.to || partners.get(socket.id);

    if (partnerId) {
      io.to(partnerId).emit("webrtc_offer", {
        from: socket.id,
        offer: data.offer
      });
    }
  });

  socket.on("webrtc_answer", (data = {}) => {
    const partnerId =
      data.to || partners.get(socket.id);

    if (partnerId) {
      io.to(partnerId).emit("webrtc_answer", {
        from: socket.id,
        answer: data.answer
      });
    }
  });

  socket.on("webrtc_ice_candidate", (data = {}) => {
    const partnerId =
      data.to || partners.get(socket.id);

    if (partnerId) {
      io.to(partnerId).emit("webrtc_ice_candidate", {
        from: socket.id,
        candidate: data.candidate
      });
    }
  });  socket.on("next_partner", () => {
    const partnerId = partners.get(socket.id);

    if (partnerId) {
      io.to(partnerId).emit("partner_disconnected", {
        reason: "Partner skipped"
      });

      partners.delete(partnerId);
      partners.delete(socket.id);
    }

    removeFromQueues(socket.id);
  });

  socket.on("end_chat", () => {
    const partnerId = partners.get(socket.id);

    if (partnerId) {
      io.to(partnerId).emit("partner_disconnected", {
        reason: "Partner ended chat"
      });

      partners.delete(partnerId);
      partners.delete(socket.id);
    }

    removeFromQueues(socket.id);
  });

  socket.on("disconnect", () => {
    const partnerId = partners.get(socket.id);

    if (partnerId) {
      io.to(partnerId).emit("partner_disconnected", {
        reason: "Partner disconnected"
      });

      partners.delete(partnerId);
      partners.delete(socket.id);
    }

    removeFromQueues(socket.id);

    console.log("Socket disconnected:", socket.id);
  });
});

function startTelegramBot() {
  if (!TELEGRAM_BOT_TOKEN) {
    console.log("Telegram bot disabled: TELEGRAM_BOT_TOKEN missing");
    return;
  }

  const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, {
    polling: true
  });

  bot.onText(/\/start/, async (msg) => {
    await bot.sendMessage(
      msg.chat.id,
      "💜 Добро пожаловать в AION AURA NET\n\nАнонимный рандомный чат:\n💬 Текст\n🎙 Голос\n🎥 Видео\n\nВыберите язык:",
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🇷🇺 Русский", callback_data: "lang_ru" },
              { text: "🇬🇧 English", callback_data: "lang_en" }
            ],
            [
              { text: "🇩🇪 Deutsch", callback_data: "lang_de" },
              { text: "🇺🇦 Українська", callback_data: "lang_uk" }
            ],
            [
              {
                text: "🚀 Open AION AURA",
                web_app: {
                  url: WEB_APP_URL
                }
              }
            ]
          ]
        }
      }
    );
  });

  bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;

    if (query.data && query.data.startsWith("lang_")) {
      await bot.sendMessage(
        chatId,
        "✅ Язык выбран. Откройте AION AURA Mini App:",
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "🚀 Open AION AURA",
                  web_app: {
                    url: WEB_APP_URL
                  }
                }
              ]
            ]
          }
        }
      );
    }

    await bot.answerCallbackQuery(query.id);
  });

  console.log("Telegram bot started");
}

startTelegramBot();

server.listen(PORT, () => {
  console.log(`AION AURA NET server running on port ${PORT}`);
});