const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const fs = require('fs');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// 1. เชื่อมต่อ MongoDB (ดึง URL จาก Environment Variable: MONGODB_URI)
const MONGODB_URI = process.env.MONGODB_URI;
if (MONGODB_URI) {
    mongoose.connect(MONGODB_URI)
        .then(() => console.log('MongoDB Connected successfully'))
        .catch(err => console.error('MongoDB Connection Error:', err));
} else {
    console.warn('⚠️ Warning: MONGODB_URI environment variable is missing.');
}

// Schema สำหรับบันทึก Token
const tokenSchema = new mongoose.Schema({
    tokenId: { type: String, required: true, unique: true },
    emailUser: String,
    emailPass: String,
    metaTitle: String,
    metaDesc: String,
    screenTv: String,
    pin: String,
    mail: String,
    bgType: String,
    bgColor: String,
    bgImage: String,
    logoUrl: String,
    mainColor: String,
    textColor: String,
    musicUrl: String,
  createdAt: { type: Date, default: Date.now, expires: 86400 } // กำหนดเป็น 604,800 วินาที (เท่ากับ 7 วันพอดี)

const TokenModel = mongoose.model('Token', tokenSchema);

// 2. API สร้าง Link บันทึกลง MongoDB
app.post('/api/generate-link', async (req, res) => {
    try {
        const tokenId = crypto.randomBytes(8).toString('hex');
        const themeConfig = {
            tokenId: tokenId,
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

        await TokenModel.create(themeConfig);
        const oneTimeUrl = `${req.protocol}://${req.get('host')}/view/${tokenId}`;
        res.json({ url: oneTimeUrl, token: tokenId });
    } catch (err) {
        console.error('Save Token Error:', err);
        res.status(500).json({ error: 'ไม่สามารถสร้างลิงก์ได้' });
    }
});

// 3. API ดึงค่าธีมและโปรไฟล์
app.get('/api/theme/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const configDoc = await TokenModel.findOne({ tokenId: token });
        if (!configDoc) {
            return res.status(404).json({ error: 'Token invalid' });
        }
        const config = configDoc.toObject();
        delete config.emailPass;
        res.json(config);
    } catch (err) {
        res.status(500).json({ error: 'เกิดข้อผิดพลาดในการดึงข้อมูล' });
    }
});

// 4. หน้าเปิดดูรหัส
app.get('/view/:token', async (req, res) => {
    const { token } = req.params;
    const config = await TokenModel.findOne({ tokenId: token });
    if (!config) {
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

    let html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    html = html.replace(/{{META_TITLE}}/g, config.metaTitle);
    html = html.replace(/{{META_DESC}}/g, config.metaDesc);

    res.send(html);
});

// 5. API ทำลาย Token เมื่อคัดลอกรหัสแล้ว
app.post('/api/invalidate-token', async (req, res) => {
    try {
        const { token } = req.body;
        const result = await TokenModel.deleteOne({ tokenId: token });
        if (result.deletedCount > 0) {
            return res.json({ success: true });
        }
        res.status(400).json({ error: 'Token invalid' });
    } catch (err) {
        res.status(500).json({ error: 'เกิดข้อผิดพลาดในการลบ Token' });
    }
});

// 6. API ดึงอีเมลผ่าน IMAP
app.get('/api/emails/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const config = await TokenModel.findOne({ tokenId: token });
        if (!config) {
            return res.status(404).json({ error: 'Token invalid' });
        }

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

// 7. หน้า Admin Dashboard
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
                input[type="text"], input[type="password"], input[type="url"], input[type="file"], select { width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #444; background: #111; color: #fff; font-size: 13px; font-family: 'Prompt'; }
                .row-group { display: flex; gap: 10px; }
                .row-group div { flex: 1; }
                input[type="color"] { width: 100%; height: 38px; border-radius: 8px; border: 1px solid #444; background: #111; cursor: pointer; }
                .btn { background: #E50914; color: #fff; border: none; padding: 12px; font-size: 15px; border-radius: 8px; cursor: pointer; font-family: 'Prompt'; font-weight: 600; width: 100%; margin-top: 15px; transition: all 0.2s; }
                .btn:hover { background: #f40612; }
                .btn-copy { background: #333; margin-top: 10px; display: none; }
                .btn-copy.success { background: #2e7d32; }
                #link-output { text-align: center; font-size: 13px; margin-top: 12px; display: none; }
            </style>
        </head>
        <body>
            <div class="card">
                <h2>🎨 ปรับแต่งข้อมูล & สร้าง Link</h2>
                
                <div class="section-title">📧 ตั้งค่าอีเมลสำหรับดึงรหัส (Email Credentials)</div>
                <div class="form-group">
                    <label>Gmail ผู้ส่งรหัส (Email User)</label>
                    <input type="text" id="emailUser" placeholder="เช่น target-account@gmail.com" onchange="saveToLocalStorage()">
                </div>
                <div class="form-group">
                    <label>Gmail App Password (16 หลัก)</label>
                    <input type="password" id="emailPass" placeholder="xxxx xxxx xxxx xxxx" onchange="saveToLocalStorage()">
                </div>

                <div class="section-title">1. ข้อความพรีวิวเวลาแชร์ลิงก์ (Preview Text)</div>
                <div class="form-group">
                    <label>ชื่อหัวข้อลิงก์ (Title)</label>
                    <input type="text" id="metaTitle" value="Verification Center" placeholder="เช่น Verification Center" onchange="saveToLocalStorage()">
                </div>
                <div class="form-group">
                    <label>ข้อความอธิบายใต้ลิงก์ (Description)</label>
                    <input type="text" id="metaDesc" value="ระบบรับรหัสยืนยันตัวตนชั่วคราว" placeholder="เช่น คลิกเพื่อรับรหัสยืนยัน" onchange="saveToLocalStorage()">
                </div>

                <div class="section-title">2. ข้อมูลลูกค้าสำหรับหน้าแรก</div>
                <div class="row-group">
                    <div class="form-group">
                        <label>Screen</label>
                        <input type="text" id="screenTv" placeholder="เช่น จอ 1" onchange="saveToLocalStorage()">
                    </div>
                    <div class="form-group">
                        <label>PIN</label>
                        <input type="text" id="pin" placeholder="เช่น 1234" onchange="saveToLocalStorage()">
                    </div>
                </div>
                <div class="form-group">
                    <label>Mail (อีเมลแสดงผลหน้าเว็บ)</label>
                    <input type="text" id="mail" placeholder="user@gmail.com" onchange="saveToLocalStorage()">
                </div>

                <div class="section-title">3. ตกแต่งพื้นหลัง & รูปภาพ (เลือกจากในเครื่อง)</div>
                <div class="form-group">
                    <label>รูปแบบพื้นหลัง</label>
                    <select id="bgType" onchange="toggleBgInputs(); saveToLocalStorage();">
                        <option value="color">สีพื้นหลัง (Solid Color)</option>
                        <option value="image">รูปภาพพื้นหลัง (อัปโหลดจากเครื่อง)</option>
                    </select>
                </div>
                <div class="form-group" id="group-bgColor">
                    <label>สีพื้นหลัง</label>
                    <input type="color" id="bgColor" value="#0f0f0f" onchange="saveToLocalStorage()">
                </div>
                <div class="form-group" id="group-bgImage" style="display: none;">
                    <label>เลือกรูปภาพพื้นหลัง</label>
                    <input type="file" id="bgImageFile" accept="image/*" onchange="saveImagesToLocalStorage()">
                </div>
                <div class="form-group">
                    <label>เลือกรูปโลโก้ / รูปหัวข้อ (ถ้ามี)</label>
                    <input type="file" id="logoFile" accept="image/*" onchange="saveImagesToLocalStorage()">
                </div>

                <div class="section-title">4. ธีมสี & เพลงประกอบ</div>
                <div class="row-group">
                    <div class="form-group">
                        <label>สีปุ่ม / ไฮไลท์</label>
                        <input type="color" id="mainColor" value="#ff0d19" onchange="saveToLocalStorage()">
                    </div>
                    <div class="form-group">
                        <label>สีข้อความ</label>
                        <input type="color" id="textColor" value="#ffffff" onchange="saveToLocalStorage()">
                    </div>
                </div>
                <div class="form-group">
                    <label>URL เพลงประกอบ (.mp3)</label>
                    <input type="url" id="musicUrl" placeholder="https://example.com/song.mp3" onchange="saveToLocalStorage()">
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

                function saveToLocalStorage() {
                    const data = {
                        emailUser: document.getElementById('emailUser').value,
                        emailPass: document.getElementById('emailPass').value,
                        metaTitle: document.getElementById('metaTitle').value,
                        metaDesc: document.getElementById('metaDesc').value,
                        screenTv: document.getElementById('screenTv').value,
                        pin: document.getElementById('pin').value,
                        mail: document.getElementById('mail').value,
                        bgType: document.getElementById('bgType').value,
                        bgColor: document.getElementById('bgColor').value,
                        mainColor: document.getElementById('mainColor').value,
                        textColor: document.getElementById('textColor').value,
                        musicUrl: document.getElementById('musicUrl').value
                    };
                    localStorage.setItem('admin_form_config', JSON.stringify(data));
                }

                async function saveImagesToLocalStorage() {
                    const bgFile = document.getElementById('bgImageFile').files[0];
                    const logoFile = document.getElementById('logoFile').files[0];

                    if (bgFile) {
                        const bgBase64 = await fileToBase64(bgFile);
                        localStorage.setItem('admin_saved_bg', bgBase64);
                    }
                    if (logoFile) {
                        const logoBase64 = await fileToBase64(logoFile);
                        localStorage.setItem('admin_saved_logo', logoBase64);
                    }
                    saveToLocalStorage();
                }

                function loadFromLocalStorage() {
                    const saved = localStorage.getItem('admin_form_config');
                    if (saved) {
                        const data = JSON.parse(saved);
                        if (data.emailUser) document.getElementById('emailUser').value = data.emailUser;
                        if (data.emailPass) document.getElementById('emailPass').value = data.emailPass;
                        if (data.metaTitle) document.getElementById('metaTitle').value = data.metaTitle;
                        if (data.metaDesc) document.getElementById('metaDesc').value = data.metaDesc;
                        if (data.screenTv) document.getElementById('screenTv').value = data.screenTv;
                        if (data.pin) document.getElementById('pin').value = data.pin;
                        if (data.mail) document.getElementById('mail').value = data.mail;
                        if (data.bgType) document.getElementById('bgType').value = data.bgType;
                        if (data.bgColor) document.getElementById('bgColor').value = data.bgColor;
                        if (data.mainColor) document.getElementById('mainColor').value = data.mainColor;
                        if (data.textColor) document.getElementById('textColor').value = data.textColor;
                        if (data.musicUrl) document.getElementById('musicUrl').value = data.musicUrl;

                        toggleBgInputs();
                    }
                }

                async function generateCustomLink() {
                    saveToLocalStorage();

                    const bgFile = document.getElementById('bgImageFile').files[0];
                    const logoFile = document.getElementById('logoFile').files[0];

                    let bgImageData = bgFile ? await fileToBase64(bgFile) : (localStorage.getItem('admin_saved_bg') || '');
                    let logoData = logoFile ? await fileToBase64(logoFile) : (localStorage.getItem('admin_saved_logo') || '');

                    const themeConfig = {
                        emailUser: document.getElementById('emailUser').value,
                        emailPass: document.getElementById('emailPass').value,
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

                loadFromLocalStorage();
            </script>
        </body>
        </html>
    `);
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});