import 'dotenv/config';
import express from 'express';
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import qrcode from 'qrcode';
import cors from 'cors';
import os from 'os';
import fs from 'fs';

const app = express();
app.use(cors());
app.use(express.json());

let sock = null;
let qrCodeData = null;
let shouldReconnect = true;

// Endpoint untuk mendapatkan QR Code
app.get('/api/qr', async (req, res) => {
    if (qrCodeData) {
        const qrImage = await qrcode.toDataURL(qrCodeData);
        return res.json({ 
            success: true,
            qr: qrImage 
        });
    }
    
    if (sock?.user) {
        return res.json({ 
            success: false, 
            message: 'Already connected',
            connected: true 
        });
    }
    
    res.json({ 
        success: false, 
        message: 'QR not ready yet' 
    });
});

// Endpoint untuk kirim pesan
app.post('/api/send', async (req, res) => {
    try {
        const { phone, message } = req.body;
        
        if (!sock || !sock.user) {
            return res.status(400).json({ 
                success: false,
                error: 'WhatsApp not connected' 
            });
        }
        
        // Format nomor telepon
        const jid = phone.includes('@s.whatsapp.net') 
            ? phone 
            : `${phone}@s.whatsapp.net`;
        
        await sock.sendMessage(jid, { text: message });
        
        res.json({ 
            success: true,
            message: 'Message sent successfully' 
        });
    } catch (error) {
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// Endpoint untuk cek status koneksi
app.get('/api/status', (req, res) => {
    res.json({ 
        connected: sock?.user ? true : false,
        phoneNumber: sock?.user?.id,
        name: sock?.user?.name
    });
});

// Endpoint untuk logout - FIXED VERSION
app.post('/api/logout', async (req, res) => {
    try {
        shouldReconnect = false;
        
        if (sock) {
            await sock.logout();
            sock.ev.removeAllListeners();
            sock = null;
        }
        
        qrCodeData = null;
        
        const authPath = './auth';
        if (fs.existsSync(authPath)) {
            fs.rmSync(authPath, { recursive: true, force: true });
        }
        
        setTimeout(() => {
            shouldReconnect = true;
            connectWhatsApp(); 
        }, 1000);
        
        res.json({ 
            success: true,
            message: 'Logged out successfully' 
        });
    } catch (error) {
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});
async function connectWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth');
    
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrCodeData = qr;
            console.log(' QR Code generated, scan from /api/qr endpoint');
        }
        
        if (connection === 'open') {
            console.log(' WhatsApp Connected!');
            console.log(' Number:', sock.user.id);
            qrCodeData = null;
        }
        
        if (connection === 'close') {
            const reconnect = shouldReconnect && 
                lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            
            console.log(' Connection closed. Reconnecting:', reconnect);
            
            if (reconnect) {
                setTimeout(connectWhatsApp, 3000);
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);
    
    // Event untuk menerima pesan (optional)
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.key.fromMe && msg.message) {
            console.log(' Received message:', msg.message);
        }
    });
}

// Fungsi untuk dapatkan IP address lokal
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

// Start server
const PORT = process.env.PORT || 3001;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    const localIP = getLocalIP();
    
    console.log('WhatsApp Gateway API running');
    console.log(' Local:   http://localhost:' + PORT);
    console.log(' Network: http://' + localIP + ':' + PORT);
    console.log('');
    console.log(' Endpoints:');
    console.log('   GET  /api/qr     - Get QR Code');
    console.log('   POST /api/send   - Send message');
    console.log('   GET  /api/status - Check connection');
    console.log('   POST /api/logout - Logout');
    console.log('');
    console.log(' Akses dari device lain: http://' + localIP + ':' + PORT);
    
    connectWhatsApp();
});