const express = require('express');
const cors = require('cors');
const { Telegraf } = require('telegraf');

// Укажите ваш токен бота от BotFather
const BOT_TOKEN = process.env.BOT_TOKEN || 'ВАШ_ТОКЕН_БОТА';
const bot = new Telegraf(BOT_TOKEN);

const app = express();
app.use(express.json());
app.use(cors());

// База данных в памяти
let usersDB = {};

// 1. Авторизация / Вход пользователя
app.post('/api/login', (req, res) => {
    const { telegramId, username } = req.body;
    if (!usersDB[telegramId]) {
        usersDB[telegramId] = {
            stars: 0, // Стартовый баланс 0
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
            provider_token: "", // ДЛЯ ЗВЕЗД ОБЯЗАТЕЛЬНО ПУСТАЯ СТРОКА!
            currency: "XTR",     // Валюта Telegram Stars
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

// ==========================================
// ОБЯЗАТЕЛЬНЫЕ ОБРАБОТЧИКИ TELEGRAM STARS (ЧТОБЫ ОКНО НЕ ВИСЕЛО)
// ==========================================

// Подтверждение предварительного запроса платежа от Telegram
bot.on('pre_checkout_query', async (ctx) => {
    try {
        await ctx.answerPreCheckoutQuery(true);
    } catch (e) {
        console.error('Pre-checkout error:', e);
    }
});

// Обработка успешной оплаты и начисление звезд на баланс игрока
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
app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});
