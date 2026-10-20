const express = require('express');
const cors = require('cors');
const { Telegraf } = require('telegraf');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose'); // 1. Подключаем Mongoose

const BOT_TOKEN = process.env.BOT_TOKEN || '8661865774:AAFXJxBonUS_3H69-KMM2FIypPLTAuRlbxQ';
const bot = new Telegraf(BOT_TOKEN);

const app = express();
app.use(express.json());
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// 2. Подключение к MongoDB (строку подключения лучше хранить в переменных окружения Render: MONGO_URI)
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://ваш_логин:пароль@cluster.mongodb.net/givegift?retryWrites=true&w=majority';

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Успешно подключено к MongoDB'))
    .catch(err => console.error('❌ Ошибка подключения к MongoDB:', err));

// 3. Создаем схему пользователя для базы данных
const userSchema = new mongoose.Schema({
    telegramId: { type: String, required: true, unique: true },
    username: { type: String, default: 'Игрок' },
    stars: { type: Number, default: 0 },
    inventory: { type: Array, default: [] }
});

const User = mongoose.model('User', userSchema);

// Очередь для PvP дуэлей остається в памяти (это временное состояние сессии поиска)
let duelQueue = [];

io.on('connection', (socket) => {
    console.log('Игрок подключился по сокету:', socket.id);

    socket.on('find_duel', async (data) => {
        const { username, bet } = data;
        const parsedBet = parseInt(bet);
        if (isNaN(parsedBet) || parsedBet < 25) return;

        console.log(`Игрок ${username} встал в очередь дуэли со ставкой ${parsedBet}⭐`);
        const existingIndex = duelQueue.findIndex(item => item.bet === parsedBet && item.socketId !== socket.id);

        if (existingIndex !== -1) {
            const opponent = duelQueue.splice(existingIndex, 1)[0];
            const isFirstWinner = Math.random() < 0.5;

            const giftsList = [
                { name: "Ничего", icon: "❌", price: 0 },
                { name: "Сердце", icon: "💖", price: 15 },
                { name: "Мишка", icon: "🧸", price: 15 },
                { name: "Подарочек", icon: "🎁", price: 25 },
                { name: "Букет", icon: "💐", price: 25 },
                { name: "Шампанское", icon: "🍾", price: 50 },
                { name: "Ракета", icon: "🚀", price: 50 },
                { name: "Бриллиант", icon: "💎", price: 100 },
                { name: "Кольцо", icon: "💍", price: 100 }
            ];

            const gift1 = giftsList[Math.floor(Math.random() * giftsList.length)];
            let gift2 = giftsList[Math.floor(Math.random() * giftsList.length)];
            if (gift1.name === gift2.name) {
                gift2 = giftsList[(giftsList.indexOf(gift1) + 1) % giftsList.length];
            }

            io.to(socket.id).emit('duel_started', {
                opponentName: opponent.username,
                isWinner: isFirstWinner,
                myGift: isFirstWinner ? (gift1.price >= gift2.price ? gift1 : gift2) : (gift1.price < gift2.price ? gift1 : gift2),
                opponentGift: isFirstWinner ? (gift1.price < gift2.price ? gift1 : gift2) : (gift1.price >= gift2.price ? gift1 : gift2)
            });

            io.to(opponent.socketId).emit('duel_started', {
                opponentName: username,
                isWinner: !isFirstWinner,
                myGift: !isFirstWinner ? (gift1.price >= gift2.price ? gift1 : gift2) : (gift1.price < gift2.price ? gift1 : gift2),
                opponentGift: !isFirstWinner ? (gift1.price < gift2.price ? gift1 : gift2) : (gift1.price >= gift2.price ? gift1 : gift2)
            });
        } else {
            duelQueue.push({ socketId: socket.id, username: username, bet: parsedBet });
            setTimeout(() => {
                const inQueue = duelQueue.find(item => item.socketId === socket.id);
                if (inQueue) {
                    duelQueue = duelQueue.filter(item => item.socketId !== socket.id);
                    const botNames = ["CryptoKing", "StarLord", "LuckyUser", "GiftMaster", "TonWinner"];
                    const botName = botNames[Math.floor(Math.random() * botNames.length)];
                    const isBotWinner = Math.random() < 0.5;

                    const giftsList = [
                        { name: "Ничего", icon: "❌", price: 0 },
                        { name: "Сердце", icon: "💖", price: 15 },
                        { name: "Мишка", icon: "🧸", price: 15 },
                        { name: "Подарочек", icon: "🎁", price: 25 },
                        { name: "Букет", icon: "💐", price: 25 },
                        { name: "Шампанское", icon: "🍾", price: 50 },
                        { name: "Ракета", icon: "🚀", price: 50 }
                    ];

                    io.to(socket.id).emit('duel_started', {
                        opponentName: botName,
                        isWinner: isBotWinner,
                        myGift: giftsList[Math.floor(Math.random() * giftsList.length)],
                        opponentGift: giftsList[Math.floor(Math.random() * giftsList.length)]
                    });
                }
            }, 5000);
        }
    });

    socket.on('disconnect', () => {
        duelQueue = duelQueue.filter(item => item.socketId !== socket.id);
    });
});

// Команда /start
bot.start(async (ctx) => {
    const welcomeText = `🎁 Добро пожаловать в GiveGift!\nИспытай удачу и прокачай свой инвентарь...`;
    try {
        await ctx.replyWithPhoto('https://raw.githubusercontent.com/123player2023-dotcom/telegram-game/main/preview.jpg', {
            caption: welcomeText,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: "🎮 Играть", web_app: { url: "https://123player2023-dotcom.github.io/telegram-game/" } }]] }
        });
    } catch (e) {
        await ctx.reply(welcomeText, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: "🎮 Играть", web_app: { url: "https://123player2023-dotcom.github.io/telegram-game/" } }]] }
        });
    }
});

// 1. Авторизация / Вход через БД
app.post('/api/login', async (req, res) => {
    const { telegramId, username } = req.body;
    if (!telegramId) return res.status(400).json({ error: 'Invalid telegramId' });

    try {
        let user = await User.findOne({ telegramId });
        if (!user) {
            user = new User({ telegramId, username: username || 'Игрок', stars: 0, inventory: [] });
            await user.save();
        } else if (username && user.username !== username) {
            user.username = username;
            await user.save();
        }
        res.json({ stars: user.stars, inventory: user.inventory });
    } catch (e) {
        res.status(500).json({ error: 'Database error' });
    }
});

// 2. Обновление баланса в БД
app.post('/api/update-stars', async (req, res) => {
    const { telegramId, stars } = req.body;
    const parsedStars = parseInt(stars);
    if (isNaN(parsedStars) || parsedStars < 0) return res.status(400).json({ error: 'Invalid value' });

    try {
        const user = await User.findOneAndUpdate({ telegramId }, { stars: parsedStars }, { new: true });
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ success: true, stars: user.stars });
    } catch (e) {
        res.status(500).json({ error: 'Database error' });
    }
});

// 3. Обновление инвентаря в БД
app.post('/api/update-inventory', async (req, res) => {
    const { telegramId, inventory } = req.body;
    if (!Array.isArray(inventory)) return res.status(400).json({ error: 'Invalid inventory' });

    try {
        const user = await User.findOneAndUpdate({ telegramId }, { inventory }, { new: true });
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Database error' });
    }
});

// 4. Создание инвойса
app.post('/api/create-invoice', async (req, res) => {
    const { telegramId, starsAmount } = req.body;
    const amount = parseInt(starsAmount);
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

    try {
        const invoiceLink = await bot.telegram.createInvoiceLink({
            title: `Пополнение ${amount} ⭐`,
            description: `Покупка ${amount} Telegram Stars в игре`,
            payload: JSON.stringify({ userId: telegramId, stars: amount }),
            provider_token: "",
            currency: "XTR",
            prices: [{ label: `${amount} Stars`, amount: amount }]
        });
        res.json({ invoiceLink });
    } catch (e) {
        res.status(500).json({ error: 'Не удалось создать платеж' });
    }
});

// 5. Вывод подарка (удаление из инвентаря БД)
app.post('/api/withdraw-gift', async (req, res) => {
    const { telegramId, itemIndex } = req.body;
    try {
        const user = await User.findOne({ telegramId });
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (itemIndex >= 0 && itemIndex < user.inventory.length) {
            user.inventory.splice(itemIndex, 1);
            await user.save();
            return res.json({ success: true, inventory: user.inventory });
        }
        res.status(400).json({ error: 'Invalid item index' });
    } catch (e) {
        res.status(500).json({ error: 'Database error' });
    }
});

bot.on('pre_checkout_query', async (ctx) => {
    try { await ctx.answerPreCheckoutQuery(true); } catch (e) {}
});

bot.on('successful_payment', async (ctx) => {
    try {
        const payment = ctx.message.successful_payment;
        const payload = JSON.parse(payment.invoice_payload);
        const userId = payload.userId;
        const addedStars = payload.stars;

        await User.findOneAndUpdate(
            { telegramId: userId },
            { $inc: { stars: addedStars } },
            { upsert: true }
        );
        console.log(`Пользователь ${userId} пополнил баланс на ${addedStars} ⭐ через БД`);
    } catch (e) {
        console.error('Payment error:', e);
    }
});

bot.launch();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});
