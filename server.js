const express = require('express');
const cors = require('cors');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser'); // 📍 นำเครื่องมือแกะเนื้อหาอีเมลมาใช้

const app = express();
app.use(cors());

async function fetchEmails() {
    const client = new ImapFlow({
        host: 'imap.gmail.com',
        port: 993,
        secure: true,
        auth: {
            user: 'fornx80@gmail.com',
            pass: 'iunwfdjbkwitzsha'
        },
        logger: false
    });

    const emails = [];

    try {
        await client.connect();
        let lock = await client.getMailboxLock('INBOX');
        try {
            let uids = await client.search({ from: 'netflix.com' });

            if (uids.length > 0) {
                let latestUids = uids.slice(-5); 
                let fetchQuery = latestUids.join(',');

                // 📍 เพิ่ม source: true เพื่อดึงเนื้อหาจดหมายมาด้วย
                for await (let msg of client.fetch(fetchQuery, { envelope: true, source: true })) {
                    
                    // แกะเนื้อหาจดหมายให้อ่านเป็นตัวหนังสือ
                    let parsed = await simpleParser(msg.source);
                    
                    emails.push({
                        id: msg.uid,
                        subject: msg.envelope.subject || '',
                        from: msg.envelope.from[0].address,
                        date: msg.envelope.date,
                        body: parsed.text || '' // 📍 เก็บเนื้อหาจดหมายส่งไปให้หน้าเว็บ
                    });
                }
            }
        } finally {
            lock.release();
        }
        await client.logout();
    } catch (err) {
        console.error("Error fetching emails:", err);
    }
    
    return emails.reverse(); 
}

app.get('/api/emails', async (req, res) => {
    const emails = await fetchEmails();
    res.json(emails);
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Backend Server รันอยู่บน http://localhost:${PORT}`);
});