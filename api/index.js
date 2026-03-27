const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const tough = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');
const fs = require('fs');
const path = require('path');

const app = express();
// ALLOW ALL IN PRODUCTION BUT YOU CAN RESTRICT IT LATER
app.use(cors({ origin: '*' }));
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SESSIONS_FILE = path.join('/tmp', 'sessions.json');
const logStream = fs.createWriteStream(path.join('/tmp', 'server.log'), { flags: 'a' });

const log = (msg) => {
    const timestamp = new Date().toISOString();
    logStream.write(`[${timestamp}] ${msg}\n`);
    console.log(msg);
};

let sessions = new Map();
const messageCache = new Map();

// Helper to save sessions to disk
function saveSessions() {
    try {
        const data = {};
        sessions.forEach((val, key) => {
            data[key] = {
                email: val.email,
                cookies: val.client.defaults.jar.toJSON()
            };
        });
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data));
    } catch(e) { log("Save failed: " + e.message); }
}

// Helper to load sessions from disk
function loadSessions() {
    try {
        if (fs.existsSync(SESSIONS_FILE)) {
            const data = JSON.parse(fs.readFileSync(SESSIONS_FILE));
            for (const key in data) {
                const jar = tough.CookieJar.fromJSON(data[key].cookies);
                const client = createClient(jar);
                sessions.set(key, { client, email: data[key].email });
            }
            log(`Reloaded ${sessions.size} persistent sessions.`);
        }
    } catch (e) { log("Load failed: " + e.message); }
}

function createClient(existingJar = null) {
    const jar = existingJar || new tough.CookieJar();
    return wrapper(axios.create({
        jar,
        withCredentials: true,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'ar,en-US;q=0.7,en;q=0.3',
            'Referer': 'https://moakt.com/ar'
        }
    }));
}

async function scrapeMessageBody(client, msgPath) {
    if (messageCache.has(msgPath)) return messageCache.get(msgPath);
    try {
        const fullUrl = msgPath.startsWith('http') ? msgPath : `https://moakt.com${msgPath}`;
        const res = await client.get(fullUrl);
        const $ = cheerio.load(res.data);
        const body = $('.message_body').html() || $('#message_body').html() || $('.message-content').html() || $('.mail_message_content').html() || 'لا يوجد محتوى';
        const result = {
            body,
            sender: $('.sender').last().text().trim() || '...',
            subject: $('.subject').last().text().trim() || '...'
        };
        messageCache.set(msgPath, result);
        return result;
    } catch (e) { return { body: 'ERR', sender: '...', subject: '...' }; }
}

// HEALTH CHECK FOR DEPLOYMENT
app.get('/', (req, res) => res.send('🚀 Doma Mail Proxy is Running'));

app.post('/api/moakt/new', async (req, res) => {
    try {
        log("Creating production session...");
        const client = createClient();
        await client.get('https://moakt.com/ar');
        let params = new URLSearchParams();
        if (req.body.address) {
            const [user, dom] = req.body.address.split('@');
            params.append('username', user);
            params.append('domain', dom);
            params.append('setemail', '1');
        } else params.append('random', '1');
        
        const postRes = await client.post('https://moakt.com/ar/inbox', params.toString(), {
            maxRedirects: 5, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const $ = cheerio.load(postRes.data);
        let email = $('#email-address').text().trim() || $('.email-address').text().trim();
        if (!email) {
            const inboxRes = await client.get('https://moakt.com/ar/inbox');
            const $i = cheerio.load(inboxRes.data);
            email = $i('#email-address').text().trim() || $i('.email-address').text().trim();
        }
        if (!email) throw new Error("Moakt creation failed");
        const sessionId = Date.now().toString();
        sessions.set(sessionId, { client, email });
        saveSessions();
        res.json({ success: true, email, sessionId });
    } catch (error) {
        log("DEPLOY SESSION FAIL: " + error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/moakt/inbox/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    if (!sessions.has(sessionId)) return res.status(404).json({ error: 'Expired' });
    const { client } = sessions.get(sessionId);
    try {
        const inboxRes = await client.get('https://moakt.com/ar/inbox');
        const $ = cheerio.load(inboxRes.data);
        const messagePromises = [];
        $('a').each((i, el) => {
            const href = $(el).attr('href') || '';
            if (href.includes('/email/') && !href.includes('/delete')) {
                const row = $(el).closest('tr');
                if (row.find('td').length >= 2) {
                    messagePromises.push((async () => {
                        try {
                            const info = await scrapeMessageBody(client, href);
                            return {
                                id: href,
                                subject: $(el).text().trim() || 'بدون موضوع',
                                from: { address: row.find('td').eq(1).text().trim() || 'Unknown' },
                                body: info.body,
                                createdAt: new Date().toISOString()
                            };
                        } catch(e) { return null; }
                    })());
                }
            }
        });
        const messages = (await Promise.all(messagePromises)).filter(m => m !== null);
        res.json({ 'hydra:member': messages });
    } catch (error) { log("INBX ERR:" + error.message); res.status(500).json({ error: error.message }); }
});

app.get('/api/moakt/message/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const { msgPath } = req.query;
    if (!sessions.has(sessionId)) return res.status(404).json({ error: 'Lost' });
    const { client } = sessions.get(sessionId);
    try {
        const info = await scrapeMessageBody(client, msgPath);
        res.json(info);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

loadSessions();

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => { log(`🚀 Local Proxy Ready on Port ${PORT}`); });
}

module.exports = app;
