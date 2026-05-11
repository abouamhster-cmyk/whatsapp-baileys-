import makeWASocket, { DisconnectReason, useMultiFileAuthState } from "@whiskeysockets/baileys";
import QRCode from "qrcode-terminal";
import express from "express";
import axios from "axios";
import "dotenv/config";

const BACKEND_URL = process.env.BACKEND_URL || "https://sovereign-bridge.onrender.com";
const PORT = process.env.PORT || 3001;

let sock = null;
let isConnected = false;

const app = express();
app.use(express.json());

// Stockage des messages
const messages = [];

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");
  
  sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    browser: ["Sovereign WhatsApp", "Chrome", "120.0.0"]
  });

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) {
      console.log("📱 SCANNE CE QR CODE :");
      QRCode.generate(qr, { small: true });
    }
    
    if (connection === "close") {
      const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log("❌ Déconnecté, reconnexion...");
      if (shouldReconnect) connectToWhatsApp();
    } else if (connection === "open") {
      isConnected = true;
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
      
      // Sauvegarder
      messages.push({ sender, senderName, text, timestamp: new Date() });
      
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

// Endpoint pour envoyer des messages depuis le backend
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

// Endpoint pour vérifier le statut
app.get("/api/status", (req, res) => {
  res.json({ connected: isConnected, messagesCount: messages.length });
});

app.listen(PORT, () => {
  console.log(`🚀 Service WhatsApp Baileys démarré sur le port ${PORT}`);
  connectToWhatsApp();
});
