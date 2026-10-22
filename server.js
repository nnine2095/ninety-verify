const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ----------------------------------------------------
// 1. ระบบจัดการ One-Time Link (ลิงก์ใช้ได้ครั้งเดียว)
// ----------------------------------------------------
const validTokens = new Set();

// API สำหรับสร้างลิงก์ชั่วคราวใหม่
app.get('/api/generate-link', (req, res) => {
    const tokenId = crypto.randomBytes(8).toString('hex');
    validTokens.add(tokenId);
    const oneTimeUrl = `${req.protocol}://${req.get('host')}/view/${tokenId}`;
    res.json({ url: oneTimeUrl, token: tokenId });
});

// ตรวจสอบ Token ก่อนแสดงหน้าเว็บ
// หน้าแรกสำหรับสร้างลิงก์ (Admin) พร้อมปุ่มคัดลอก
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="th">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Netflix Link Generator</title>
            <link href="https://fonts.googleapis.com/css2?family=Prompt:wght@400;600;700&display=swap" rel="stylesheet">
            <style>
                * { box-sizing: border-box; margin: 0; padding: 0; }
                body { font-family: 'Prompt', sans-serif; background: #141414; color: #fff; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px; }
                .card { background: #222; padding: 35px 25px; border-radius: 16px; border: 1px solid #333; text-align: center; max-width: 450px; width: 100%; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
                h2 { color: #E50914; margin-bottom: 20px; font-size: 24px; font-weight: 700; }
                .btn { background: #E50914; color: #fff; border: none; padding: 12px 20px; font-size: 16px; border-radius: 8px; cursor: pointer; font-family: 'Prompt'; font-weight: 600; width: 100%; transition: all 0.2s ease; }
                .btn:hover { background: #f40612; }
                .btn-copy { background: #333; margin-top: 10px; display: none; }
                .btn-copy:hover { background: #444; }
                .btn-copy.success { background: #2e7d32; }
                input { width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #444; background: #111; color: #fff; text-align: center; font-size: 14px; margin-top: 15px; display: none; }
            </style>
        </head>
        <body>
            <div class="card">
                <h2>สร้าง One-Time Link</h2>
                <button class="btn" onclick="generateLink()">กดสร้างลิงก์ใหม่</button>
                
                <input type="text" id="link-output" readonly onclick="this.select()">
                <button id="btn-copy-link" class="btn btn-copy" onclick="copyGeneratedLink()">คัดลอกลิงก์</button>
            </div>

            <script>
                async function generateLink() {
                    const res = await fetch('/api/generate-link');
                    const data = await res.json();
                    
                    const input = document.getElementById('link-output');
                    const copyBtn = document.getElementById('btn-copy-link');
                    
                    input.value = data.url;
                    input.style.display = 'block';
                    
                    copyBtn.style.display = 'block';
                    copyBtn.innerText = 'คัดลอกลิงก์';
                    copyBtn.classList.remove('success');
                }

                function copyGeneratedLink() {
                    const linkInput = document.getElementById('link-output');
                    navigator.clipboard.writeText(linkInput.value).then(() => {
                        const copyBtn = document.getElementById('btn-copy-link');
                        copyBtn.innerText = 'คัดลอกลิงก์เรียบร้อย! ✓';
                        copyBtn.classList.add('success');
                        setTimeout(() => {
                            copyBtn.innerText = 'คัดลอกลิงก์';
                            copyBtn.classList.remove('success');
                        }, 2000);
                    });
                }
            </script>
        </body>
        </html>
    `);
});
    res.sendFile(path.join(__dirname, 'index.html'));
});

// API ทำลาย Token เมื่อกดคัดลอกรหัส
app.post('/api/invalidate-token', (req, res) => {
    const { token } = req.body;
    if (validTokens.has(token)) {
        validTokens.delete(token);
        return res.json({ success: true, message: 'ทำลาย Token เรียบร้อย' });
    }
    res.status(400).json({ error: 'Token ไม่ถูกต้องหรือหมดอายุแล้ว' });
});

// ----------------------------------------------------
// 2. ระบบดึงอีเมลจาก Gmail ผ่าน IMAP
// ----------------------------------------------------
app.get('/api/emails', async (req, res) => {
    const client = new ImapFlow({
        host: 'imap.gmail.com',
        port: 993,
        secure: true,
        auth: {
            user: process.env.EMAIL_USER || 'อีเมลของคุณ@gmail.com',
            pass: process.env.EMAIL_PASS || 'รหัสผ่านแอปของคุณ'
        },
        logger: false
    });

    try {
        await client.connect();
        let lock = await client.getMailboxLock('INBOX');

        try {
            // ดึงอีเมลล่าสุด 1 ฉบับ
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

// หน้าแรกเปลี่ยนเป็นหน้าสำหรับสร้างลิงก์ (Admin)
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="th">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Netflix Link Generator</title>
            <link href="https://fonts.googleapis.com/css2?family=Prompt:wght@400;600&display=swap" rel="stylesheet">
            <style>
                body { font-family: 'Prompt', sans-serif; background: #141414; color: #fff; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
                .card { background: #222; padding: 30px; border-radius: 16px; border: 1px solid #333; text-align: center; max-width: 450px; width: 90%; }
                h2 { color: #E50914; margin-bottom: 20px; }
                button { background: #E50914; color: #fff; border: none; padding: 12px 24px; font-size: 16px; border-radius: 8px; cursor: pointer; font-family: 'Prompt'; font-weight: 600; width: 100%; margin-bottom: 15px; }
                button:hover { background: #f40612; }
                input { width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #444; background: #111; color: #fff; text-align: center; box-sizing: border-box; font-size: 14px; }
            </style>
        </head>
        <body>
            <div class="card">
                <h2>ระบบสร้าง One-Time Link</h2>
                <button onclick="generateLink()">กดสร้างลิงก์ใหม่</button>
                <input type="text" id="link-output" placeholder="ลิงก์จะปรากฏที่นี่..." readonly onclick="this.select()">
            </div>
            <script>
                async function generateLink() {
                    const res = await fetch('/api/generate-link');
                    const data = await res.json();
                    document.getElementById('link-output').value = data.url;
                }
            </script>
        </body>
        </html>
    `);
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});