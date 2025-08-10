require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');

// --- Muhit o'zgaruvchilari ---
const TOKEN = process.env.TOKEN;
const MONGO_URL = process.env.MONGO_URL || process.env.MONGO_URI;
const ADMIN_IDS = process.env.ADMIN_IDS
  ? process.env.ADMIN_IDS.split(',').map(id => id.trim())
  : [];

if (!TOKEN || !MONGO_URL || ADMIN_IDS.length === 0) {
  console.error("❌ .env faylida TOKEN, MONGO_URL va ADMIN_IDS to‘g‘ri yozilganligini tekshiring.");
  process.exit(1);
}

// --- Bot yaratish ---
const bot = new TelegramBot(TOKEN, { polling: true });

// --- MongoDB ulanish ---
mongoose.connect(MONGO_URL).then(() => {
  console.log("✅ MongoDB ga ulanish muvaffaqiyatli!");
}).catch(err => {
  console.error("❌ MongoDB ulanish xatosi:", err);
  process.exit(1);
});

// --- Mongoose model ---
const groupSchema = new mongoose.Schema({
  chatId: { type: String, unique: true, required: true },
  title: { type: String, required: true }
});
const Group = mongoose.model('Group', groupSchema);

// --- Menyular ---
const userMenu = {
  reply_markup: {
    inline_keyboard: [
      [{ text: "📞 Telefon raqamni ko‘rsatish", callback_data: "show_phone" }],
      [{ text: "📩 Telegram kanalimiz", url: "https://t.me/garizlum" }]
    ]
  },
  parse_mode: 'Markdown'
};

const adminMenu = {
  reply_markup: {
    keyboard: [
      ["📋 Guruhlar ro‘yxati", "📢 Xabar yuborish"]
    ],
    resize_keyboard: true
  }
};

const adminStates = {};

// --- Guruhni bazaga saqlash funksiyasi ---
async function saveGroup(chatId, title) {
  if (!chatId) return;
  try {
    await Group.findOneAndUpdate(
      { chatId: chatId.toString() },
      { title: title || "No title" },
      { upsert: true, new: true }
    );
    console.log(`✅ Guruh saqlandi/yangilandi: ${title}`);
  } catch (err) {
    console.error("❌ Guruhni saqlashda xato:", err);
  }
}

// --- Guruhga bot qo‘shilganda ---
bot.on('my_chat_member', async (msg) => {
  const chat = msg.chat;
  const newStatus = msg.new_chat_member?.status;

  if ((chat.type === 'group' || chat.type === 'supergroup') && (newStatus === 'member' || newStatus === 'administrator')) {
    await saveGroup(chat.id, chat.title);
  }
});

// --- Foydalanuvchi /start buyrug‘i va xabarlar ---
bot.on('message', async (msg) => {
  try {
    const chatId = msg.chat.id.toString();
    const fromId = msg.from.id.toString();
    const text = msg.text || "";
    const isAdmin = ADMIN_IDS.includes(fromId);

    // Guruhdagi har qanday xabar orqali saqlash
    if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
      await saveGroup(chatId, msg.chat.title);
      return; // Guruhda boshqa logika ishlamasin
    }

    // Private chat
    if (msg.chat.type === 'private' && text === '/start') {
      if (isAdmin) {
        await bot.sendMessage(chatId, "👋 Salom Admin!", adminMenu);
        adminStates[chatId] = null;
      } else {
        await bot.sendMessage(chatId,
          `👋 Assalomu alaykum!\n\n` +
          `📢 Agar siz ham *reklama berib biznesingizni rivojlantirmoqchi* bo‘lsangiz, biz bilan bog‘laning!`,
          userMenu);
      }
      return;
    }

    // Admin xabar yuborish rejimi
    if (isAdmin && adminStates[chatId] === 'awaiting_broadcast_text') {
      const broadcastText = text.trim();
      if (!broadcastText) {
        await bot.sendMessage(chatId, "❗ Iltimos, bo‘sh xabar yubormang.");
        return;
      }
      const groups = await Group.find();
      if (groups.length === 0) {
        await bot.sendMessage(chatId, "❗ Guruhlar ro‘yxati bo‘sh.");
        adminStates[chatId] = null;
        return;
      }
      let successCount = 0;
      for (const g of groups) {
        try {
          await bot.sendMessage(g.chatId, broadcastText);
          successCount++;
        } catch {}
      }
      await bot.sendMessage(chatId, `✅ Xabar yuborildi.\n📤 Muvaffaqiyatli: ${successCount}/${groups.length}`);
      adminStates[chatId] = null;
      return;
    }

    // Admin menyusi
    if (isAdmin) {
      if (text === "📋 Guruhlar ro‘yxati") {
        const groups = await Group.find();
        if (groups.length === 0) {
          await bot.sendMessage(chatId, "📋 Guruhlar ro‘yxati bo‘sh.");
          return;
        }
        let listText = "📋 *Guruhlar ro‘yxati:*\n\n";
        groups.forEach(g => {
          listText += `🆔 ${g.chatId} — ${g.title}\n`;
        });
        await bot.sendMessage(chatId, listText, { parse_mode: 'Markdown' });
        return;
      }
      if (text === "📢 Xabar yuborish") {
        adminStates[chatId] = 'awaiting_broadcast_text';
        await bot.sendMessage(chatId, "✏️ Iltimos, barcha guruhlarga yuboriladigan xabar matnini kiriting:");
        return;
      }
    }

  } catch (error) {
    console.error("❌ Xato:", error);
  }
});

// --- Callback query ---
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id.toString();
  const data = query.data;
  if (data === "show_phone") {
    await bot.answerCallbackQuery(query.id, { text: "Telefon raqam: +998996186882" });
    await bot.sendMessage(chatId, "📞 Telefon raqam: +998996186882");
  }
});

// --- Guruhga yangi a’zo qo‘shilganda adminlarga xabar ---
bot.on('new_chat_members', async (msg) => {
  const chatId = msg.chat.id.toString();
  const chatTitle = msg.chat.title || "Guruh";
  const newMembers = msg.new_chat_members
    .map(m => `${m.first_name}${m.last_name ? ' ' + m.last_name : ''} (ID: ${m.id})`)
    .join(", ");

  const text =
    `👤 *Yangi a'zo qo‘shildi:*\n${newMembers}\n\n` +
    `📌 Guruh: ${chatTitle}\n` +
    `🆔 Guruh ID: ${chatId}`;

  for (const adminId of ADMIN_IDS) {
    try {
      await bot.sendMessage(adminId, text, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error(`❌ Adminga (${adminId}) xabar yuborishda xato:`, err);
    }
  }
});
