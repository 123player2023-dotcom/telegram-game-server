const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Telegraf } = require('telegraf');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // Раздача файлов игры (фронтенда) из корня проекта

const BOT_TOKEN = process.env.BOT_TOKEN || '8661865774:AAFXJxBonUS_3H69-KMM2FIypPLTAuRlbxQ';
const bot = new Telegraf(BOT_TOKEN);

// Приветствие при старте бота (/start) с картинкой по file_id и форматированием
bot.start(async (ctx) => {
    try {
        const welcomeText = 
`🎁  **Добро пожаловать в GiveGift!**

🤪  Готов испытать удачу и прокачать свой инвентарь? Здесь каждый кейс скрывает редкие подарки и ценные награды!

**Что тебя ждет внутри:**

📦  *Открытие кейсов* — выбивай уникальные подарки и собирай коллекции.

⚔️  *Онлайн-дуэли* — сражайся с другими игроками в реальном времени и забирай их куш!

⚡  *Апгрейд предметов* — рискуй, чтобы превратить обычный подарок в эксклюзивный артефакт.

🎁  **Твой первый подарок уже ждет!** Нажми кнопку ниже, чтобы забрать стартовый бонус и сделать первый запуск!`;

        await ctx.replyWithPhoto('AgACAgIAAxkBAAEjyEhq2j7rbOq6UDcEwkIjlMBq5hPirQACgR5rG-ds0UpLN9VnQklxpwEAAwIAA3kAAz0E', {
            caption: welcomeText,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🎮 Play', web_app: { url: 'https://telegram-game-server.onrender.com' } }]
                ]
            }
        });
    } catch (e) {
        console.error('Ошибка отправки приветствия:', e);
    }
});

// Обработка пре-чекаута Telegram Stars
bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true));

// Безопасная обработка успешного платежа
bot.on('successful_payment', async (ctx) => {
    try {
        const payment = ctx.update?.message?.successful_payment || ctx.message?.successful_payment;
        if (!payment) return;

        const payload = payment.invoice_payload; // формат: deposit_telegramId_timestamp
        const parts = payload.split('_');
        
        if (parts[0] === 'deposit') {
            const telegramId = String(parts[1]); // Приводим к строке
            const starsPaid = payment.total_amount; 

            let user = await UserModel.findOne({ telegramId });
            if (user) {
                user.stars += starsPaid;
                await user.save();
                
                // Уведомляем клиента через сокет об обновлении баланса
                io.sockets.sockets.forEach((socket) => {
                    if (socket.telegramId === telegramId) {
                        socket.emit('balance_updated', { stars: user.stars });
                    }
                });
                console.log(`⭐ Пользователю ${telegramId} зачислено ${starsPaid} звезд через Telegram Stars.`);
            }
        }
    } catch (e) {
        console.error('Ошибка обработки успешного платежа:', e);
    }
});

bot.launch().catch(err => console.error('Ошибка запуска Telegraf бота:', err));

const MONGO_URI = process.env.MONGO_URI;

let UserSchema = new mongoose.Schema({
    telegramId: { type: String, unique: true, required: true },
    username: String,
    stars: { type: Number, default: 0 },
    inventory: { type: Array, default: [] }
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
        console.log("⚠️ MONGO_URI не задан, используется хранение в памяти");
    }
}
connectDB();

app.post('/api/login', async (req, res) => {
    try {
        const { telegramId, username } = req.body;
        if (!telegramId) return res.status(400).json({ error: 'No telegramId' });

        const tIdStr = String(telegramId);
        let user = await UserModel.findOne({ telegramId: tIdStr });
        if (!user) {
            user = new UserModel({ telegramId: tIdStr, username: username || 'Игрок', stars: 0, inventory: [] });
            await user.save();
        } else if (username && user.username !== username) {
            user.username = username;
            await user.save();
        }
        res.json({ stars: user.stars, inventory: user.inventory });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/update-stars', async (req, res) => {
    try {
        const { telegramId, stars } = req.body;
        const tIdStr = String(telegramId);
        let user = await UserModel.findOne({ telegramId: tIdStr });
        if (user) {
            user.stars = stars;
            await user.save();
            res.json({ success: true, stars: user.stars });
        } else {
            res.status(404).json({ error: 'User not found' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/update-inventory', async (req, res) => {
    try {
        const { telegramId, inventory } = req.body;
        const tIdStr = String(telegramId);
        let user = await UserModel.findOne({ telegramId: tIdStr });
        if (user) {
            user.inventory = inventory;
            await user.save();
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'User not found' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/withdraw-gift', async (req, res) => {
    try {
        const { telegramId, itemIndex } = req.body;
        const tIdStr = String(telegramId);
        let user = await UserModel.findOne({ telegramId: tIdStr });
        
        if (!user || !user.inventory || user.inventory[itemIndex] === undefined) {
            return res.status(404).json({ success: false, error: 'Предмет не найден в инвентаре' });
        }

        const item = user.inventory[itemIndex];
        const now = Date.now();
        if (item.availableAt && now < new Date(item.availableAt).getTime()) {
            return res.status(400).json({ success: false, error: 'Не истек 5-минутный кулдаун вывода!' });
        }

        if (!item.giftId) {
            user.inventory.splice(itemIndex, 1);
            await user.save();
            return res.json({ success: true, inventory: user.inventory });
        }

        user.inventory.splice(itemIndex, 1);
        await user.save();

        try {
            await bot.telegram.callApi('sendGift', {
                user_id: parseInt(tIdStr),
                gift_id: item.giftId
            });
            return res.json({ success: true, inventory: user.inventory });
        } catch (tgError) {
            console.error('Ошибка Telegram API:', tgError?.response?.description || tgError.message);
            user.inventory.splice(itemIndex, 0, item);
            await user.save();

            let errReason = tgError?.response?.description || 'Ошибка Telegram при отправке подарка';
            if (errReason.includes('not enough stars')) {
                errReason = 'У бота на балансе недостаточно Telegram Stars!';
            }
            return res.json({ success: false, error: errReason, inventory: user.inventory });
        }
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
});

app.post('/api/create-invoice', async (req, res) => {
    try {
        const { telegramId, starsAmount } = req.body;
        if (!telegramId || !starsAmount) {
            return res.status(400).json({ error: 'Неверные параметры запроса' });
        }

        const prices = [{ label: `${starsAmount} Telegram Stars`, amount: parseInt(starsAmount) }];
        
        const invoicePromise = bot.telegram.createInvoiceLink({
            title: 'Пополнение баланса',
            description: `Пополнение баланса на ${starsAmount} ⭐ в игре`,
            payload: `deposit_${String(telegramId)}_${Date.now()}`,
            currency: 'XTR',
            prices: prices
        });

        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Telegram API timeout')), 10000)
        );

        const invoiceLink = await Promise.race([invoicePromise, timeoutPromise]);
        res.json({ invoiceLink });
    } catch (e) {
        console.error('Ошибка создания инвойса:', e.message);
        res.status(500).json({ error: 'Не удалось создать счет. Попробуйте еще раз.' });
    }
});

let duelQueue = [];
io.on('connection', (socket) => {
    socket.on('login_socket', (data) => {
        if (data && data.telegramId) {
            socket.telegramId = String(data.telegramId);
        }
    });

    socket.on('cancel_duel', () => {
        duelQueue = duelQueue.filter(item => item.socket.id !== socket.id);
    });

    socket.on('find_duel', async (data) => {
        const { telegramId, username, bet } = data;
        const tIdStr = String(telegramId);
        socket.telegramId = tIdStr;
        try {
            let user = await UserModel.findOne({ telegramId: tIdStr });
            if (!user || user.stars < bet) {
                socket.emit('duel_error', { error: 'Недостаточно звезд на балансе!' });
                return;
            }
            user.stars -= bet;
            await user.save();
            socket.emit('balance_updated', { stars: user.stars });

            duelQueue.push({ socket, telegramId: tIdStr, username, bet });
            if (duelQueue.length >= 2) {
                let p1 = duelQueue.shift();
                let p2 = duelQueue.shift();

                let p1Bet = p1.bet;
                let p2Bet = p2.bet;
                let p1WinChance = 0.5;

                if (p1Bet > p2Bet) {
                    let ratio = p1Bet / p2Bet;
                    p1WinChance = ratio >= 2 ? 0.75 : 0.60;
                } else if (p2Bet > p1Bet) {
                    let ratio = p2Bet / p1Bet;
                    p1WinChance = ratio >= 2 ? 0.25 : 0.40;
                }

                let p1Wins = Math.random() < p1WinChance;

                const cheapGifts = [
                    { name: "Сердце", icon: "💖", price: 15, giftId: "5170145012310081615" },
                    { name: "Мишка", icon: "🧸", price: 15, giftId: "5170233102089322756" }
                ];
                const mediumGifts = [
                    { name: "Подарочек", icon: "🎁", price: 25, giftId: "5170250947678437525" },
                    { name: "Букет", icon: "💐", price: 25, giftId: "5168103777563050263" }
                ];
                const expensiveGifts = [
                    { name: "Шампанское", icon: "🍾", price: 50, giftId: "6028601630662853006" },
                    { name: "Ракета", icon: "🚀", price: 50, giftId: "5170564780938756245" }
                ];

                let g1, g2;
                if (p1Wins) {
                    g1 = Math.random() < 0.7 ? expensiveGifts[Math.floor(Math.random() * expensiveGifts.length)] : mediumGifts[Math.floor(Math.random() * mediumGifts.length)];
                    g2 = Math.random() < 0.7 ? cheapGifts[Math.floor(Math.random() * cheapGifts.length)] : mediumGifts[Math.floor(Math.random() * mediumGifts.length)];
                } else {
                    g1 = Math.random() < 0.7 ? cheapGifts[Math.floor(Math.random() * cheapGifts.length)] : mediumGifts[Math.floor(Math.random() * mediumGifts.length)];
                    g2 = Math.random() < 0.7 ? expensiveGifts[Math.floor(Math.random() * expensiveGifts.length)] : mediumGifts[Math.floor(Math.random() * mediumGifts.length)];
                }

                p1.socket.emit('duel_started', { opponentName: p2.username, isWinner: p1Wins, myGift: g1, opponentGift: g2 });
                p2.socket.emit('duel_started', { opponentName: p1.username, isWinner: !p1Wins, myGift: g2, opponentGift: g1 });
            }
        } catch (e) {
            socket.emit('duel_error', { error: 'Ошибка сервера' });
        }
    });

    socket.on('disconnect', () => {
        duelQueue = duelQueue.filter(item => item.socket.id !== socket.id);
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
