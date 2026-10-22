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

// 1. API สร้าง Link พร้อมบันทึกข้อมูล Custom Meta Preview
app.post('/api/generate-link', (req, res) => {
    const tokenId = crypto.randomBytes(8).toString('hex');
    const themeConfig = {
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
    res.json(validTokens.get(token));
});

// 3. หน้าเปิดดูรหัส (ฉีด Open Graph Meta Tags ตามที่ตั้งไว้ใน Admin)
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

    // แทนที่ค่า Meta Tag สำหรับการพรีวิวลิงก์เวลาแชร์
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

// 5. API ดึงอีเมลผ่าน IMAP
app.get('/api/emails', async (req, res) => {
    const client = new ImapFlow({
        host: 'imap.gmail.com',
        port: 993,
        secure: true,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
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

// 6. หน้า Admin Dashboard (เพิ่มส่วนตั้งค่าพรีวิวลิงก์แชท)
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
                .card { background: #1c1c1c; padding: 30px; border-radius: 16px; border: 1px solid #333; max-width: 500px; width: 100%; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
                h2 { color: #E50914; margin-bottom: 20px; text-align: center; font-size: 22px; }
                .section-title { font-size: 14px; color: #E50914; font-weight: 600; margin: 15px 0 10px 0; border-bottom: 1px solid #333; padding-bottom: 5px; }
                .form-group { margin-bottom: 12px; text-align: left; }
                label { display: block; font-size: 13px; color: #ccc; margin-bottom: 5px; }
                input[type="text"], input[type="url"], input[type="file"], select { width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #444; background: #111; color: #fff; font-size: 13px; font-family: 'Prompt'; }
                .row-group { display: flex; gap: 10px; }
                .row-group div { flex: 1; }
                input[type="color"] { width: 100%; height: 38px; border-radius: 8px; border: 1px solid #444; background: #111; cursor: pointer; }
                .btn { background: #E50914; color: #fff; border: none; padding: 12px; font-size: 15px; border-radius: 8px; cursor: pointer; font-family: 'Prompt'; font-weight: 600; width: 100%; margin-top: 15px; transition: all 0.2s; }
                .btn:hover { background: #f40612; }
                .btn-copy { background: #333; margin-top: 10px; display: none; }
                .btn-copy.success { background: #2e7d32; }
                #link-output { text-align: center; font-size: 13px; margin-top: 12px; display: none; }
                .file-hint { font-size: 11px; color: #888; margin-top: 3px; }
            </style>
        </head>
        <body>
            <div class="card">
                <h2>🎨 ปรับแต่งข้อมูล & สร้าง Link</h2>
                
                <div class="section-title">1. ข้อความพรีวิวเวลาแชร์ลิงก์ (Preview Text)</div>
                <div class="form-group">
                    <label>ชื่อหัวข้อลิงก์ (Title)</label>
                    <input type="text" id="metaTitle" value="Verification Center" placeholder="เช่น Verification Center">
                </div>
                <div class="form-group">
                    <label>ข้อความอธิบายใต้ลิงก์ (Description)</label>
                    <input type="text" id="metaDesc" value="ระบบรับรหัสยืนยันตัวตนชั่วคราว" placeholder="เช่น คลิกเพื่อรับรหัสยืนยัน">
                </div>

                <div class="section-title">2. ข้อมูลลูกค้าสำหรับหน้าแรก</div>
                <div class="row-group">
                    <div class="form-group">
                        <label>Screen</label>
                        <input type="text" id="screenTv" placeholder="เช่น จอ 1">
                    </div>
                    <div class="form-group">
                        <label>PIN</label>
                        <input type="text" id="pin" placeholder="เช่น 1234">
                    </div>
                </div>
                <div class="form-group">
                    <label>Mail (อีเมลผู้ใช้)</label>
                    <input type="text" id="mail" placeholder="user@gmail.com">
                </div>

                <div class="section-title">3. ตกแต่งพื้นหลัง & รูปภาพ (เลือกจากในเครื่อง)</div>
                <div class="form-group">
                    <label>รูปแบบพื้นหลัง</label>
                    <select id="bgType" onchange="toggleBgInputs()">
                        <option value="color">สีพื้นหลัง (Solid Color)</option>
                        <option value="image">รูปภาพพื้นหลัง (อัปโหลดจากเครื่อง)</option>
                    </select>
                </div>
                <div class="form-group" id="group-bgColor">
                    <label>สีพื้นหลัง</label>
                    <input type="color" id="bgColor" value="#0f0f0f">
                </div>
                <div class="form-group" id="group-bgImage" style="display: none;">
                    <label>เลือกรูปภาพพื้นหลัง</label>
                    <input type="file" id="bgImageFile" accept="image/*">
                </div>
                <div class="form-group">
                    <label>เลือกรูปโลโก้ / รูปหัวข้อ (ถ้ามี)</label>
                    <input type="file" id="logoFile" accept="image/*">
                </div>

                <div class="section-title">4. ธีมสี & เพลงประกอบ</div>
                <div class="row-group">
                    <div class="form-group">
                        <label>สีปุ่ม / ไฮไลท์</label>
                        <input type="color" id="mainColor" value="#ff0d19">
                    </div>
                    <div class="form-group">
                        <label>สีข้อความ</label>
                        <input type="color" id="textColor" value="#ffffff">
                    </div>
                </div>
                <div class="form-group">
                    <label>URL เพลงประกอบ (.mp3)</label>
                    <input type="url" id="musicUrl" placeholder="https://example.com/song.mp3">
                </div>

                <button class="btn" onclick="generateCustomLink()">กดสร้าง One-Time Link</button>
                
                <input type="text" id="link-output" readonly onclick="this.select()">
                <button id="btn-copy-link" class="btn btn-copy" onclick="copyGeneratedLink()">คัดลอกลิงก์</button>
            </div>

            <script>
                function toggleBgInputs() {
                    const type = document.getElementById('bgType').value;
                    if (type === 'image') {
                        document.getElementById('group-bgColor').style.display = 'none';
                        document.getElementById('group-bgImage').style.display = 'block';
                    } else {
                        document.getElementById('group-bgColor').style.display = 'block';
                        document.getElementById('group-bgImage').style.display = 'none';
                    }
                }

                function fileToBase64(file) {
                    return new Promise((resolve, reject) => {
                        if (!file) resolve('');
                        const reader = new FileReader();
                        reader.readAsDataURL(file);
                        reader.onload = () => resolve(reader.result);
                        reader.onerror = error => reject(error);
                    });
                }

                async function generateCustomLink() {
                    const bgFile = document.getElementById('bgImageFile').files[0];
                    const logoFile = document.getElementById('logoFile').files[0];

                    const bgImageData = await fileToBase64(bgFile);
                    const logoData = await fileToBase64(logoFile);

                    const themeConfig = {
                        metaTitle: document.getElementById('metaTitle').value,
                        metaDesc: document.getElementById('metaDesc').value,
                        screenTv: document.getElementById('screenTv').value,
                        pin: document.getElementById('pin').value,
                        mail: document.getElementById('mail').value,
                        bgType: document.getElementById('bgType').value,
                        bgColor: document.getElementById('bgColor').value,
                        bgImage: bgImageData,
                        logoUrl: logoData,
                        mainColor: document.getElementById('mainColor').value,
                        textColor: document.getElementById('textColor').value,
                        musicUrl: document.getElementById('musicUrl').value
                    };

                    const res = await fetch('/api/generate-link', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(themeConfig)
                    });
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

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});