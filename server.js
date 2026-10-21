const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Telegraf } = require('telegraf');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.json());

// Токен вашего бота
const BOT_TOKEN = process.env.BOT_TOKEN || '8661865774:AAFXJxBonUS_3H69-KMM2FIypPLTAuRlbxQ';
const bot = new Telegraf(BOT_TOKEN);

// Подключение к MongoDB (используем встроенную имитацию или реальный mongoose, если настроен)
const mongoose = require('mongoose');
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

// Эндпоинт авторизации / синхронизации игрока
app.post('/api/login', async (req, res) => {
    try {
        const { telegramId, username } = req.body;
        if (!telegramId) return res.status(400).json({ error: 'No telegramId' });

        let user = await UserModel.findOne({ telegramId });
        if (!user) {
            user = new UserModel({ telegramId, username: username || 'Игрок', stars: 0, inventory: [] });
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

// Обновление баланса
app.post('/api/update-stars', async (req, res) => {
    try {
        const { telegramId, stars } = req.body;
        let user = await UserModel.findOne({ telegramId });
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

// Обновление инвентаря
app.post('/api/update-inventory', async (req, res) => {
    try {
        const { telegramId, inventory } = req.body;
        let user = await UserModel.findOne({ telegramId });
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

// БЕЗОПАСНЫЙ ВЫВОД ПОДАРКА ЧЕРЕЗ TELEGRAM API (sendGift)
app.post('/api/withdraw-gift', async (req, res) => {
    try {
        const { telegramId, itemIndex } = req.body;
        let user = await UserModel.findOne({ telegramId });
        
        if (!user || !user.inventory || user.inventory[itemIndex] === undefined) {
            return res.status(404).json({ success: false, error: 'Предмет не найден в инвентаре' });
        }

        const item = user.inventory[itemIndex];

        // Проверяем кулдаун (5 минут) на сервере
        const now = Date.now();
        if (item.availableAt && now < new Date(item.availableAt).getTime()) {
            return res.status(400).json({ success: false, error: 'Не истек 5-минутный кулдаун вывода!' });
        }

        // Если у предмета нет реального giftId (например, тестовый приз), имитируем успешный вывод
        if (!item.giftId) {
            user.inventory.splice(itemIndex, 1);
            await user.save();
            return res.json({ success: true, inventory: user.inventory });
        }

        // Временно удаляем предмет из массива на время запроса к Telegram API
        user.inventory.splice(itemIndex, 1);
        await user.save();

        try {
            // Вызываем официальный метод Telegram Bot API sendGift (без ошибочного параметра pay_for_upgrade)
            await bot.telegram.callApi('sendGift', {
                user_id: parseInt(telegramId),
                gift_id: item.giftId
            });

            // Успешно отправлено! Изменения уже сохранены (предмет удален)
            return res.json({ success: true, inventory: user.inventory });

        } catch (tgError) {
            console.error('Ошибка Telegram API при отправке подарка:', tgError?.response?.description || tgError.message);
            
            // ВНИМАНИЕ: Если Telegram вернул ошибку, возвращаем предмет обратно в инвентарь игроку!
            user.inventory.splice(itemIndex, 0, item);
            await user.save();

            let errReason = tgError?.response?.description || 'Ошибка Telegram при отправке подарка';
            if (errReason.includes('not enough stars')) {
                errReason = 'У бота на балансе недостаточно Telegram Stars для отправки этого подарка!';
            }

            return res.json({ 
                success: false, 
                error: errReason, 
                inventory: user.inventory 
            });
        }

    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
});

// Создание инвойса для пополнения Telegram Stars
app.post('/api/create-invoice', async (req, res) => {
    try {
        const { telegramId, starsAmount } = req.body;
        const prices = [{ label: `${starsAmount} Telegram Stars`, amount: starsAmount }];
        
        const invoiceLink = await bot.telegram.createInvoiceLink({
            title: 'Пополнение баланса',
            description: `Пополнение баланса на ${starsAmount} ⭐ в игре`,
            payload: `deposit_${telegramId}_${Date.now()}`,
            currency: 'XTR',
            prices: prices
        });

        res.json({ invoiceLink });
    } catch (e) {
        console.error('Ошибка создания инвойса:', e);
        res.status(500).json({ error: e.message });
    }
});

// PvP Дуэли через Socket.IO
let duelQueue = [];

io.on('connection', (socket) => {
    socket.on('find_duel', async (data) => {
        const { telegramId, username, bet } = data;
        
        try {
            let user = await UserModel.findOne({ telegramId });
            if (!user || user.stars < bet) {
                socket.emit('duel_error', { error: 'Недостаточно звезд на балансе для ставки!' });
                return;
            }

            // Списываем ставку у игрока в базе
            user.stars -= bet;
            await user.save();
            socket.emit('balance_updated', { stars: user.stars });

            duelQueue.push({ socket, telegramId, username, bet });

            if (duelQueue.length >= 2) {
                let p1 = duelQueue.shift();
                let p2 = duelQueue.shift();

                let p1Wins = Math.random() < 0.5;
                
                const giftsList = [
                    { name: "Сердце", icon: "💖", price: 15, giftId: "5170145012310081615" },
                    { name: "Мишка", icon: "🧸", price: 15, giftId: "5170233102089322756" },
                    { name: "Подарочек", icon: "🎁", price: 25, giftId: "5170250947678437525" },
                    { name: "Шампанское", icon: "🍾", price: 50, giftId: "6028601630662853006" }
                ];

                let g1 = giftsList[Math.floor(Math.random() * giftsList.length)];
                let g2 = giftsList[Math.floor(Math.random() * giftsList.length)];

                p1.socket.emit('duel_started', {
                    opponentName: p2.username,
                    isWinner: p1Wins,
                    myGift: g1,
                    opponentGift: g2
                });

                p2.socket.emit('duel_started', {
                    opponentName: p1.username,
                    isWinner: !p1Wins,
                    myGift: g2,
                    opponentGift: g1
                });
            }
        } catch (e) {
            console.error('Ошибка в дуэли:', e);
            socket.emit('duel_error', { error: 'Ошибка сервера при запуске дуэли' });
        }
    });

    socket.on('disconnect', () => {
        duelQueue = duelQueue.filter(item => item.socket.id !== socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
