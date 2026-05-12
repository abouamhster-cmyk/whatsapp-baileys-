import makeWASocket, { DisconnectReason, useMultiFileAuthState } from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import express from "express";
import axios from "axios";
import "dotenv/config";
import fs from "fs";

const BACKEND_URL = process.env.BACKEND_URL || "https://sovereign-bridge.onrender.com";
const PORT = process.env.PORT || 3001;

let sock = null;
let isConnected = false;
let lastQR = null;

const app = express();
app.use(express.json());
app.use(express.static("public"));

// Endpoint pour obtenir le QR code
app.get("/api/qr", (req, res) => {
    if (lastQR) {
        res.json({ qr: lastQR, connected: isConnected });
    } else {
        res.json({ qr: null, connected: isConnected, message: "QR code pas encore généré" });
    }
});

// Endpoint pour envoyer des messages
app.post("/api/send", async (req, res) => {
    const { to, message } = req.body;
    if (!sock || !isConnected) {
        return res.json({ success: false, error: "WhatsApp non connecté" });
    }
    try {
        await sock.sendMessage(to, { text: message });
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

app.get("/api/status", (req, res) => {
    res.json({ connected: isConnected });
});

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState("auth_info");
    
    sock = makeWASocket({
        auth: state,
        browser: ["Sovereign WhatsApp", "Chrome", "120.0.0"]
    });

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            // Convertir le QR code en base64 pour l'envoyer au backend
            lastQR = qr;
            const qrBuffer = await QRCode.toBuffer(qr);
            const qrBase64 = qrBuffer.toString('base64');
            
            console.log("📱 QR Code généré ! Va sur /api/qr pour le voir");
            
            // Option: Envoyer au backend pour stockage
            try {
                await axios.post(`${BACKEND_URL}/api/whatsapp-baileys/qr`, {
                    qr: qrBase64,
                    timestamp: new Date().toISOString()
                });
            } catch (e) {}
        }
        
        if (connection === "close") {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log("❌ Déconnecté, reconnexion...");
            if (shouldReconnect) setTimeout(connectToWhatsApp, 5000);
        } else if (connection === "open") {
            isConnected = true;
            lastQR = null;
            console.log("✅ WhatsApp connecté !");
        }
    });

    sock.ev.on("creds.update", saveCreds);

    // Réception des messages
    sock.ev.on("messages.upsert", async ({ messages: newMessages }) => {
        for (const msg of newMessages) {
            if (msg.key.fromMe) continue;
            
            let text = "";
            if (msg.message?.conversation) text = msg.message.conversation;
            else if (msg.message?.extendedTextMessage?.text) text = msg.message.extendedTextMessage.text;
            else continue;
            
            const sender = msg.key.remoteJid;
            const senderName = msg.pushName || "Inconnu";
            
            console.log(`💬 [${senderName}]: ${text}`);
            
            // Envoyer au backend
            try {
                await axios.post(`${BACKEND_URL}/api/whatsapp-baileys/message`, {
                    from: sender,
                    from_name: senderName,
                    message: text
                });
            } catch (e) {
                console.log("Erreur envoi backend:", e.message);
            }
        }
    });
}

// Créer un dossier public pour afficher le QR
if (!fs.existsSync("public")) fs.mkdirSync("public");
fs.writeFileSync("public/index.html", `
<!DOCTYPE html>
<html>
<head><title>WhatsApp Baileys</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="background:#1a1a2e; color:#fff; text-align:center; padding:20px;">
    <h1>📱 WhatsApp Baileys</h1>
    <div id="qr"></div>
    <p id="status">Chargement...</p>
    <script>
        function fetchQR() {
            fetch('/api/qr')
                .then(res => res.json())
                .then(data => {
                    if (data.connected) {
                        document.getElementById('status').innerHTML = '✅ WhatsApp connecté !';
                        document.getElementById('qr').innerHTML = '';
                    } else if (data.qr) {
                        document.getElementById('status').innerHTML = '📱 Scannez le QR code avec WhatsApp';
                        document.getElementById('qr').innerHTML = '<img src="' + data.qr + '" />';
                    } else {
                        document.getElementById('status').innerHTML = '⏳ En attente du QR code...';
                    }
                });
        }
        fetchQR();
        setInterval(fetchQR, 3000);
    </script>
</body>
</html>
`);

app.listen(PORT, () => {
    console.log(`🚀 Service WhatsApp démarré sur le port ${PORT}`);
    console.log(`📱 Va sur https://ton-service.onrender.com pour scanner le QR code`);
    connectToWhatsApp();
});
