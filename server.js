const express = require('express');
const cors = require('cors');
const { Telegraf } = require('telegraf');
const http = require('http');
const { Server } = require('socket.io');

// Укажите ваш токен бота от BotFather
const BOT_TOKEN = process.env.BOT_TOKEN || 'ВАШ_ТОКЕН_БОТА';
const bot = new Telegraf(BOT_TOKEN);

const app = express();
app.use(express.json());
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// База данных в памяти
let usersDB = {};

// Очередь для поиска PvP дуэлей
let duelQueue = [];

io.on('connection', (socket) => {
    console.log('Игрок подключился по сокету:', socket.id);

    socket.on('find_duel', (data) => {
        const { username, bet } = data;
        console.log(`Игрок ${username} встал в очередь дуэли со ставкой ${bet}⭐`);

        const existingIndex = duelQueue.findIndex(item => item.bet === bet && item.socketId !== socket.id);

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
            duelQueue.push({
                socketId: socket.id,
                username: username,
                bet: bet
            });

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

                    const myG = giftsList[Math.floor(Math.random() * giftsList.length)];
                    const botG = giftsList[Math.floor(Math.random() * giftsList.length)];

                    io.to(socket.id).emit('duel_started', {
                        opponentName: botName,
                        isWinner: isBotWinner,
                        myGift: myG,
                        opponentGift: botG
                    });
                }
            }, 5000);
        }
    });

    socket.on('disconnect', () => {
        duelQueue = duelQueue.filter(item => item.socketId !== socket.id);
        console.log('Игрок отключился:', socket.id);
    });
});

// Правильный метод bot.start() для Telegraf
bot.start(async (ctx) => {
    const chatId = ctx.chat.id;
    const welcomeText = 
`🎁 Добро пожаловать в GiveGift!
Готов испытать удачу и прокачать свой инвентарь? Здесь каждый кейс скрывает редкие подарки и ценные награды!

Что тебя ждет внутри:
📦 <b>Открытие кейсов</b> — выбивай уникальные подарки и собирай коллекции.
⚔️ <b>Онлайн-дуэли</b> — сражайся с другими игроками в реальном времени и забирай их куш!
⚡ <b>Апгрейд предметов</b> — рискуй, чтобы превратить обычный подарок в эксклюзивный артефакт.

🎁 Твой первый подарок уже ждет! Нажми кнопку ниже, чтобы забрать стартовый бонус и сделать первый запуск!`;

    try {
        await ctx.replyWithPhoto('https://raw.githubusercontent.com/123player2023-dotcom/telegram-game/main/preview.jpg', {
            caption: welcomeText,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🎮 Играть", web_app: { url: "https://123player2023-dotcom.github.io/telegram-game/" } }]
                ]
            }
        });
    } catch (e) {
        await ctx.reply(welcomeText, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🎮 Играть", web_app: { url: "https://123player2023-dotcom.github.io/telegram-game/" } }]
                ]
            }
        });
    }
});

// 1. Авторизация / Вход пользователя
app.post('/api/login', (req, res) => {
    const { telegramId, username } = req.body;
    if (!usersDB[telegramId]) {
        usersDB[telegramId] = {
            stars: 0,
            inventory: [],
            username: username || 'Игрок'
        };
    } else {
        if (username) usersDB[telegramId].username = username;
    }
    res.json({
        stars: usersDB[telegramId].stars,
        inventory: usersDB[telegramId].inventory
    });
});

// 2. Обновление баланса звезд
app.post('/api/update-stars', (req, res) => {
    const { telegramId, stars } = req.body;
    if (usersDB[telegramId]) {
        usersDB[telegramId].stars = stars;
        return res.json({ success: true, stars: usersDB[telegramId].stars });
    }
    res.status(404).json({ error: 'User not found' });
});

// 3. Обновление инвентаря
app.post('/api/update-inventory', (req, res) => {
    const { telegramId, inventory } = req.body;
    if (usersDB[telegramId]) {
        usersDB[telegramId].inventory = inventory;
        return res.json({ success: true });
    }
    res.status(404).json({ error: 'User not found' });
});

// 4. Создание счета для оплаты через Telegram Stars
app.post('/api/create-invoice', async (req, res) => {
    const { telegramId, starsAmount } = req.body;
    try {
        const invoiceLink = await bot.telegram.createInvoiceLink({
            title: `Пополнение ${starsAmount} ⭐`,
            description: `Покупка ${starsAmount} Telegram Stars в игре`,
            payload: JSON.stringify({ userId: telegramId, stars: parseInt(starsAmount) }),
            provider_token: "", 
            currency: "XTR",     
            prices: [{ label: `${starsAmount} Stars`, amount: parseInt(starsAmount) }]
        });
        res.json({ invoiceLink });
    } catch (e) {
        console.error('Ошибка создания инвойса:', e);
        res.status(500).json({ error: 'Не удалось создать платеж' });
    }
});

// 5. Вывод подарка
app.post('/api/withdraw-gift', (req, res) => {
    const { telegramId, itemIndex } = req.body;
    if (!usersDB[telegramId]) return res.status(404).json({ error: 'User not found' });
    
    let user = usersDB[telegramId];
    if (itemIndex >= 0 && itemIndex < user.inventory.length) {
        user.inventory.splice(itemIndex, 1);
        return res.json({ success: true, inventory: user.inventory });
    }
    res.status(400).json({ error: 'Invalid item index' });
});

// Обработчики платежей Telegram Stars
bot.on('pre_checkout_query', async (ctx) => {
    try {
        await ctx.answerPreCheckoutQuery(true);
    } catch (e) {
        console.error('Pre-checkout error:', e);
    }
});

bot.on('successful_payment', async (ctx) => {
    try {
        const payment = ctx.message.successful_payment;
        const payload = JSON.parse(payment.invoice_payload);
        const userId = payload.userId;
        const addedStars = payload.stars;

        if (usersDB[userId]) {
            usersDB[userId].stars += addedStars;
        } else {
            usersDB[userId] = { stars: addedStars, inventory: [] };
        }

        console.log(`Пользователь ${userId} успешно пополнил баланс на ${addedStars} ⭐`);
    } catch (e) {
        console.error('Payment processing error:', e);
    }
});

bot.launch();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});
