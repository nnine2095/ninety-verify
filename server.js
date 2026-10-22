const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

const validTokens = new Map();

// 1. API สร้าง Link พร้อมบันทึก Credential ของอีเมลแยกรายลิงก์
app.post('/api/generate-link', (req, res) => {
    const tokenId = crypto.randomBytes(8).toString('hex');
    const themeConfig = {
        emailUser: req.body.emailUser || process.env.EMAIL_USER || '',
        emailPass: req.body.emailPass || process.env.EMAIL_PASS || '',
        metaTitle: req.body.metaTitle || 'Verification Center',
        metaDesc: req.body.metaDesc || 'ระบบรับรหัสยืนยันตัวตนชั่วคราว',
        screenTv: req.body.screenTv || '-',
        pin: req.body.pin || '-',
        mail: req.body.mail || '-',
        bgType: req.body.bgType || 'color',
        bgColor: req.body.bgColor || '#0f0f0f',
        bgImage: req.body.bgImage || '',
        logoUrl: req.body.logoUrl || '',
        mainColor: req.body.mainColor || '#ff0d19',
        textColor: req.body.textColor || '#ffffff',
        musicUrl: req.body.musicUrl || ''
    };
    
    validTokens.set(tokenId, themeConfig);
    const oneTimeUrl = `${req.protocol}://${req.get('host')}/view/${tokenId}`;
    res.json({ url: oneTimeUrl, token: tokenId });
});

// 2. API ดึงค่าธีมและโปรไฟล์
app.get('/api/theme/:token', (req, res) => {
    const { token } = req.params;
    if (!validTokens.has(token)) {
        return res.status(404).json({ error: 'Token invalid' });
    }
    const config = { ...validTokens.get(token) };
    delete config.emailPass; // ซ่อน Password ไม่ให้ฝั่ง Client เห็น
    res.json(config);
});

// 3. หน้าเปิดดูรหัส (ฉีด Open Graph Meta Tags)
app.get('/view/:token', (req, res) => {
    const { token } = req.params;
    if (!validTokens.has(token)) {
        return res.send(`
            <!DOCTYPE html>
            <html lang="th">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>ลิงก์หมดอายุ</title>
                <link href="https://fonts.googleapis.com/css2?family=Prompt:wght@400;600&display=swap" rel="stylesheet">
                <style>
                    body { font-family: 'Prompt', sans-serif; background-color: #141414; color: #fff; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; text-align: center; }
                    .card { background: #222; padding: 40px 20px; border-radius: 16px; border: 1px solid #333; max-width: 400px; width: 90%; }
                    h1 { color: #E50914; font-size: 24px; margin-bottom: 10px; }
                    p { color: #aaa; font-size: 15px; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h1>❌ ลิงก์นี้หมดอายุแล้ว</h1>
                    <p>ลิงก์นี้ถูกใช้งานไปแล้ว หรือไม่ถูกต้อง<br>กรุณาขอลิงก์ใหม่จากผู้ดูแลระบบ</p>
                </div>
            </body>
            </html>
        `);
    }

    const config = validTokens.get(token);
    let html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

    html = html.replace(/{{META_TITLE}}/g, config.metaTitle);
    html = html.replace(/{{META_DESC}}/g, config.metaDesc);

    res.send(html);
});

// 4. API ทำลาย Token
app.post('/api/invalidate-token', (req, res) => {
    const { token } = req.body;
    if (validTokens.has(token)) {
        validTokens.delete(token);
        return res.json({ success: true });
    }
    res.status(400).json({ error: 'Token invalid' });
});

// 5. API ดึงอีเมลผ่าน IMAP (อ่านตามข้อมูล Credential ของ Token นั้นๆ)
app.get('/api/emails/:token', async (req, res) => {
    const { token } = req.params;
    if (!validTokens.has(token)) {
        return res.status(404).json({ error: 'Token invalid' });
    }

    const config = validTokens.get(token);
    const emailUser = config.emailUser || process.env.EMAIL_USER;
    const emailPass = config.emailPass || process.env.EMAIL_PASS;

    if (!emailUser || !emailPass) {
        return res.status(400).json({ error: 'ไม่ได้ตั้งค่าข้อมูลอีเมล' });
    }

    const client = new ImapFlow({
        host: 'imap.gmail.com',
        port: 993,
        secure: true,
        auth: {
            user: emailUser,
            pass: emailPass
        },
        logger: false
    });

    try {
        await client.connect();
        let lock = await client.getMailboxLock('INBOX');

        try {
            let message = await client.fetchOne('*', { source: true });
            if (message) {
                const parsed = await simpleParser(message.source);
                res.json([{
                    subject: parsed.subject || '',
                    body: parsed.text || parsed.html || '',
                    date: parsed.date
                }]);
            } else {
                res.json([]);
            }
        } finally {
            lock.release();
        }

        await client.logout();
    } catch (err) {
        console.error('IMAP Error:', err);
        res.status(500).json({ error: 'ไม่สามารถเชื่อมต่ออีเมลได้' });
    }
});

// 6. หน้า Admin Dashboard (เพิ่มส่วนกรอก Email & App Password)
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="th">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Admin Dashboard & Link Generator</title>
            <link href="https://fonts.googleapis.com/css2?family=Prompt:wght@400;600;700&display=swap" rel="stylesheet">
            <style>
                * { box-sizing: border-box; margin: 0; padding: 0; }
                body { font-family: 'Prompt', sans-serif; background: #0f0f0f; color: #fff; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px; }
                .card {