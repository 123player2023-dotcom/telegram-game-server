const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

app.get('/', (req, res) => {
    res.send('Server is running');
});

// Простая база данных в памяти для хранения профилей пользователей
const usersDB = {};

// Эндпоинт для авторизации и первичного получения данных пользователя (теперь старт с 0 звезд)
app.post('/api/login', (req, res) => {
    const { telegramId, username } = req.body;

    if (!telegramId) {
        return res.status(400).json({ error: 'Telegram ID обязателен' });
    }

    if (!usersDB[telegramId]) {
        usersDB[telegramId] = {
            telegramId: telegramId,
            username: username || 'Игрок',
            stars: 0, // Убраны начальные 25 звезд
            inventory: [],
            createdAt: Date.now()
        };
        console.log(`Создан новый пользователь с 0 звезд: ${telegramId} (${username})`);
    } else if (username && usersDB[telegramId].username !== username) {
        usersDB[telegramId].username = username;
    }

    res.json(usersDB[telegramId]);
});

// Эндпоинт для сохранения текущего баланса звезд пользователя
app.post('/api/update-stars', (req, res) => {
    const { telegramId, stars } = req.body;

    if (!telegramId || stars === undefined) {
        return res.status(400).json({ error: 'Telegram ID и количество звезд обязательные' });
    }

    if (usersDB[telegramId]) {
        usersDB[telegramId].stars = stars;
        return res.json({ success: true, stars: usersDB[telegramId].stars });
    } else {
        usersDB[telegramId] = {
            telegramId: telegramId,
            username: 'Игрок',
            stars: stars,
            inventory: [],
            createdAt: Date.now()
        };
        return res.json({ success: true, stars: usersDB[telegramId].stars });
    }
});

// Эндпоинт для сохранения инвентаря пользователя
app.post('/api/update-inventory', (req, res) => {
    const { telegramId, inventory } = req.body;

    if (!telegramId || !Array.isArray(inventory)) {
        return res.status(400).json({ error: 'Telegram ID и инвентарь обязательные' });
    }

    if (usersDB[telegramId]) {
        usersDB[telegramId].inventory = inventory;
        return res.json({ success: true, inventory: usersDB[telegramId].inventory });
    } else {
        usersDB[telegramId] = {
            telegramId: telegramId,
            username: 'Игрок',
            stars: 0, // Стартовый баланс 0 звезд
            inventory: inventory,
            createdAt: Date.now()
        };
        return res.json({ success: true, inventory: usersDB[telegramId].inventory });
    }
});

// ==========================================
// ТОКЕН НОВОГО БОТА
// ==========================================
const BOT_TOKEN = '8661865774:AAFKJ3kSDPKA_dlSXxKmzNwvdJT7u9gUtxY';

app.post('/api/create-invoice', async (req, res) => {
    const { telegramId, starsAmount } = req.body;

    if (!telegramId || !starsAmount) {
        return res.status(400).json({ error: 'Не указан Telegram ID или сумма звезд' });
    }

    const title = `Пополнение баланса на ${starsAmount} ⭐`;
    const description = `Покупка игровой валюты в Gift Case Game`;
    const payload = JSON.stringify({ telegramId, starsAmount });
    const currency = 'XTR'; // Официальная валюта Telegram Stars
    const prices = [{ label: `${starsAmount} Звезд`, amount: parseInt(starsAmount) }];

    try {
        const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/createInvoiceLink`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title,
                description,
                payload,
                currency,
                prices
            })
        });

        const data = await response.json();
        if (data.ok) {
            res.json({ invoiceLink: data.result });
        } else {
            console.error('Telegram API Error:', data);
            res.status(400).json({ error: data.description || 'Ошибка создания счета в Telegram' });
        }
    } catch (e) {
        console.error('Invoice creation error:', e);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Список подарков для дуэлей
const giftsData = [
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

let waitingPlayer = null;
let queueTimer = null;

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('find_duel', (playerData) => {
        if (waitingPlayer && waitingPlayer.socketId !== socket.id) {
            clearTimeout(queueTimer);
            const player1 = waitingPlayer;
            const player2 = { socketId: socket.id, ...playerData };
            waitingPlayer = null;

            const gift1 = giftsData[Math.floor(Math.random() * giftsData.length)];
            const gift2 = giftsData[Math.floor(Math.random() * giftsData.length)];

            let p1Wins = false;
            if (gift1.price > gift2.price) {
                p1Wins = true;
            } else if (gift1.price < gift2.price) {
                p1Wins = false;
            } else {
                p1Wins = Math.random() < 0.5;
            }

            io.to(player1.socketId).emit('duel_started', {
                opponentName: player2.username,
                isWinner: p1Wins,
                myGift: gift1,
                opponentGift: gift2
            });

            io.to(player2.socketId).emit('duel_started', {
                opponentName: player1.username,
                isWinner: !p1Wins,
                myGift: gift2,
                opponentGift: gift1
            });

        } else {
            waitingPlayer = { socketId: socket.id, ...playerData };

            queueTimer = setTimeout(() => {
                if (waitingPlayer && waitingPlayer.socketId === socket.id) {
                    const myGift = giftsData[Math.floor(Math.random() * giftsData.length)];
                    const botGift = giftsData[Math.floor(Math.random() * giftsData.length)];

                    let isWinner = false;
                    if (myGift.price > botGift.price) {
                        isWinner = true;
                    } else if (myGift.price < botGift.price) {
                        isWinner = false;
                    } else {
                        isWinner = Math.random() < 0.5;
                    }

                    socket.emit('duel_started', {
                        opponentName: "Бот Артём 🤖",
                        isWinner: isWinner,
                        myGift: myGift,
                        opponentGift: botGift
                    });

                    waitingPlayer = null;
                }
            }, 10000);
        }
    });

    socket.on('disconnect', () => {
        if (waitingPlayer && waitingPlayer.socketId === socket.id) {
            clearTimeout(queueTimer);
            waitingPlayer = null;
        }
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
