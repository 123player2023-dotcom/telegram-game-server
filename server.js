const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors({ origin: "*" }));

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

// Инициализация базы данных SQLite
const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Ошибка подключения к базы данных SQLite:', err.message);
    } else {
        console.log('Успешно подключено к базе данных SQLite');
    }
});

// Создаем таблицу пользователей
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            telegramId TEXT PRIMARY KEY,
            username TEXT,
            stars INTEGER DEFAULT 25,
            inventory TEXT DEFAULT '[]'
        )
    `);
});

app.get('/', (req, res) => {
    res.send('Server is running');
});

// Защищенная авторизация и выгрузка данных
app.post('/api/login', (req, res) => {
    const { telegramId, username } = req.body;

    if (!telegramId) {
        return res.status(400).json({ error: 'Telegram ID обязателен' });
    }

    db.get('SELECT * FROM users WHERE telegramId = ?', [telegramId.toString()], (err, row) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Ошибка базы данных' });
        }

        if (row) {
            let inventoryArr = [];
            try {
                inventoryArr = JSON.parse(row.inventory);
            } catch (e) {
                inventoryArr = [];
            }
            return res.json({
                telegramId: row.telegramId,
                username: row.username,
                stars: row.stars,
                inventory: inventoryArr
            });
        } else {
            const defaultStars = 25;
            const defaultInventory = JSON.stringify([]);

            db.run(
                'INSERT INTO users (telegramId, username, stars, inventory) VALUES (?, ?, ?, ?)',
                [telegramId.toString(), username || 'Игрок', defaultStars, defaultInventory],
                function (insertErr) {
                    if (insertErr) {
                        console.error(insertErr);
                        return res.status(500).json({ error: 'Ошибка создания пользователя' });
                    }
                    return res.json({
                        telegramId: telegramId.toString(),
                        username: username || 'Игрок',
                        stars: defaultStars,
                        inventory: []
                    });
                }
            );
        }
    });
});

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
            }, 3000);
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
