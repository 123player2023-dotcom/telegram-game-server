const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Telegraf } = require('telegraf');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const BOT_TOKEN = process.env.BOT_TOKEN || '8661865774:AAFXJxBonUS_3H69-KMM2FIypPLTAuRlbxQ';
const bot = new Telegraf(BOT_TOKEN);

const WEBHOOK_PATH = `/bot${BOT_TOKEN}`;
app.use(bot.webhookCallback(WEBHOOK_PATH));

const MONGO_URI = process.env.MONGO_URI;

let UserSchema = new mongoose.Schema({
    telegramId: { type: String, unique: true, required: true },
    username: String,
    avatarUrl: { type: String, default: '' },
    stars: { type: Number, default: 0 },
    inventory: { type: Array, default: [] },
    lastFreeCaseTime: { type: Number, default: 0 },
    paidCaseCount: { type: Number, default: 0 }
});
let UserModel = mongoose.model('User', UserSchema);

async function connectDB() {
    if (MONGO_URI) {
        try {
            await mongoose.connect(MONGO_URI);
            console.log("🟢 Подключено к MongoDB Atlas");
        } catch (err) {
            console.error("🔴 Ошибка подключения к MongoDB:", err);
        }
    } else {
        console.log("⚠️ MONGO_URI не задан. Используется локальная память/тестовый режим.");
    }
}
connectDB();

bot.start(async (ctx) => {
    try {
        const welcomeText = 
`🎁  **Добро пожаловать в GiveGift!**

🤪  Готов испытать удачу и прокачать свой инвентарь? Здесь каждый кейс скрывает редкие подарки и ценные награды!

**Что тебя ждет внутри:**

📦  *Открытие кейсов* — выбивай уникальные подарки и собирай коллекции.

⚔️  *Онлайн-дуэли* — сражайся с другими игроками в реальном времени и забирай их куш!

⚡  *Апгрейд предметов* — рискуй, чтобы превратить обычный подарок в эксклюзивный артефакт.`;

        await ctx.replyWithPhoto('https://images.unsplash.com/photo-1513151233558-d860c5398176?q=80&w=1000&auto=format&fit=crop', {
            caption: welcomeText,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🎮 Играть', web_app: { url: 'https://telegram-game-server.onrender.com' } }]
                ]
            }
        });
    } catch (e) {
        console.error('Ошибка отправки приветствия:', e);
    }
});

bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true));

bot.on('successful_payment', async (ctx) => {
    try {
        const payment = ctx.update?.message?.successful_payment || ctx.message?.successful_payment;
        if (!payment) return;

        const payload = payment.invoice_payload;
        const parts = payload.split('_');
        
        if (parts[0] === 'deposit') {
            const telegramId = String(parts[1]);
            const starsPaid = payment.total_amount; 

            let user = await UserModel.findOne({ telegramId });
            if (user) {
                user.stars += starsPaid;
                await user.save();
                
                io.sockets.sockets.forEach((socket) => {
                    if (socket.telegramId === telegramId) {
                        socket.emit('balance_updated', { stars: user.stars });
                    }
                });
            }
        }
    } catch (e) {
        console.error('Ошибка обработки платежа:', e);
    }
});

const giftsData = [
    { name: "Ничего", icon: "❌", price: 0, giftId: null },
    { name: "Сердце", icon: "💖", price: 15, giftId: "5170145012310081615" },
    { name: "Мишка", icon: "🧸", price: 15, giftId: "5170233102089322756" },
    { name: "Подарочек", icon: "🎁", price: 25, giftId: "5170250947678437525" },
    { name: "Букет", icon: "💐", price: 25, giftId: "5168103777563050263" },
    { name: "Шампанское", icon: "🍾", price: 50, giftId: "6028601630662853006" },
    { name: "Ракета", icon: "🚀", price: 50, giftId: "5170564780938756245" },
    { name: "Бриллиант", icon: "💎", price: 100, giftId: "5170521118301225164" },
    { name: "Кольцо", icon: "💍", price: 100, giftId: "5170690322832818290" },
    { name: "Звезды 150", icon: "🌟", price: 150, giftId: null },
    { name: "Звезды 200", icon: "✨", price: 200, giftId: null },
    { name: "Звезды 250", icon: "💫", price: 250, giftId: null },
    { name: "Звезды 300", icon: "👑", price: 300, giftId: null }
];

function getPaidRandomItem(paidCount) {
    const rand = Math.random() * 100;
    if (paidCount < 2) {
        if (rand < 15) return giftsData[0];
        if (rand < 40) return giftsData[3];
        if (rand < 70) return giftsData[5];
        return giftsData[8];
    } else {
        if (rand < 50) return giftsData[0];
        if (rand < 62.5) return giftsData[1];
        if (rand < 75) return giftsData[2];
        if (rand < 90) return giftsData[4];
        return giftsData[8];
    }
}

function getFreeRandomItem() {
    const rand = Math.random() * 100;
    if (rand < 85) return giftsData[0];
    if (rand < 93) return giftsData[1];
    return giftsData[2];
}

app.post('/api/login', async (req, res) => {
    try {
        const { telegramId, username, avatarUrl } = req.body;
        if (!telegramId) return res.status(400).json({ error: 'No telegramId' });

        const tIdStr = String(telegramId);
        let user = await UserModel.findOne({ telegramId: tIdStr });
        if (!user) {
            user = new UserModel({ 
                telegramId: tIdStr, 
                username: username || 'Игрок', 
                avatarUrl: avatarUrl || '',
                stars: 100, 
                inventory: [], 
                lastFreeCaseTime: 0, 
                paidCaseCount: 0 
            });
            await user.save();
        } else {
            let updated = false;
            if (username && user.username !== username) { user.username = username; updated = true; }
            if (avatarUrl && user.avatarUrl !== avatarUrl) { user.avatarUrl = avatarUrl; updated = true; }
            if (updated) await user.save();
        }
        res.json({ 
            stars: user.stars, 
            inventory: user.inventory, 
            lastFreeCaseTime: user.lastFreeCaseTime,
            avatarUrl: user.avatarUrl
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/open-case', async (req, res) => {
    try {
        const { telegramId, mode } = req.body;
        const tIdStr = String(telegramId);
        let user = await UserModel.findOne({ telegramId: tIdStr });
        if (!user) return res.status(404).json({ error: 'User not found' });

        let cost = 25;
        if (mode === 'paid50') cost = 50;
        else if (mode === 'paid100') cost = 100;
        else if (mode === 'free') cost = 0;

        let winningItem;
        if (mode === 'free') {
            const now = Date.now();
            if (now - user.lastFreeCaseTime < 24 * 60 * 60 * 1000) {
                return res.status(400).json({ error: 'Кулдаун бесплатного кейса не истек!' });
            }
            user.lastFreeCaseTime = now;
            winningItem = getFreeRandomItem();
        } else {
            if (user.stars < cost) return res.status(400).json({ error: 'Недостаточно звезд!' });
            user.stars -= cost;
            user.paidCaseCount += 1;
            winningItem = getPaidRandomItem(user.paidCaseCount);
        }

        const uniqueId = Date.now() + Math.random();
        const lockoutTime = Date.now() + 5 * 60 * 1000;
        if (winningItem.price > 0) {
            user.inventory.push({ ...winningItem, uniqueId, numericPrice: winningItem.price, availableAt: new Date(lockoutTime) });
        }
        await user.save();

        res.json({ success: true, stars: user.stars, inventory: user.inventory, winningItem, lastFreeCaseTime: user.lastFreeCaseTime });
    } catch (e) {
        res.status(500).json({ error: 'Внутренняя ошибка' });
    }
});

app.post('/api/update-stars', async (req, res) => {
    try {
        const { telegramId, stars } = req.body;
        let user = await UserModel.findOne({ telegramId: String(telegramId) });
        if (user) { user.stars = stars; await user.save(); res.json({ success: true, stars: user.stars }); }
        else res.status(404).json({ error: 'User not found' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/update-inventory', async (req, res) => {
    try {
        const { telegramId, inventory } = req.body;
        let user = await UserModel.findOne({ telegramId: String(telegramId) });
        if (user) { user.inventory = inventory; await user.save(); res.json({ success: true }); }
        else res.status(404).json({ error: 'User not found' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/withdraw-gift', async (req, res) => {
    try {
        const { telegramId, itemIndex } = req.body;
        let user = await UserModel.findOne({ telegramId: String(telegramId) });
        if (!user || !user.inventory || user.inventory[itemIndex] === undefined) {
            return res.status(404).json({ success: false, error: 'Предмет не найден' });
        }
        const item = user.inventory[itemIndex];
        user.inventory.splice(itemIndex, 1);
        await user.save();

        try {
            if (item.giftId) {
                await bot.telegram.callApi('sendGift', { user_id: parseInt(telegramId), gift_id: item.giftId });
            }
            return res.json({ success: true, inventory: user.inventory });
        } catch (tgError) {
            user.inventory.splice(itemIndex, 0, item);
            await user.save();
            return res.json({ success: false, error: 'Ошибка отправки подарка в Telegram', inventory: user.inventory });
        }
    } catch (e) { res.status(500).json({ success: false, error: 'Ошибка сервера' }); }
});

app.post('/api/create-invoice', async (req, res) => {
    try {
        const { telegramId, starsAmount } = req.body;
        const invoiceLink = await bot.telegram.createInvoiceLink({
            title: 'Пополнение баланса',
            description: `Пополнение на ${starsAmount} ⭐`,
            payload: `deposit_${String(telegramId)}_${Date.now()}`,
            currency: 'XTR',
            prices: [{ label: `${starsAmount} Telegram Stars`, amount: parseInt(starsAmount) }]
        });
        res.json({ invoiceLink });
    } catch (e) {
        res.status(500).json({ error: 'Не удалось создать счет' });
    }
});

let duelQueue = [];
io.on('connection', (socket) => {
    socket.on('find_duel', async (data) => {
        const { telegramId, username, bet } = data;
        let user = await UserModel.findOne({ telegramId: String(telegramId) });
        if (!user || user.stars < bet) {
            socket.emit('duel_error', { error: 'Недостаточно звезд!' });
            return;
        }
        user.stars -= bet;
        await user.save();
        socket.emit('balance_updated', { stars: user.stars });

        duelQueue.push({ socket, telegramId: String(telegramId), username, bet });
        if (duelQueue.length >= 2) {
            let p1 = duelQueue.shift();
            let p2 = duelQueue.shift();
            let p1Wins = Math.random() < 0.5;
            let gift = { name: "Подарочек", icon: "🎁", price: 25, giftId: "5170250947678437525" };

            p1.socket.emit('duel_started', { opponentName: p2.username, isWinner: p1Wins, myGift: gift, opponentGift: gift });
            p2.socket.emit('duel_started', { opponentName: p1.username, isWinner: !p1Wins, myGift: gift, opponentGift: gift });
        }
    });
    socket.on('cancel_duel', () => {
        duelQueue = duelQueue.filter(item => item.socket.id !== socket.id);
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    try {
        await bot.telegram.setWebhook(`https://telegram-game-server.onrender.com${WEBHOOK_PATH}`);
    } catch (err) {}
});
