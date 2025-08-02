# 🌐 Real-time Chat Application

A modern, real-time chat application built with Flask, Socket.IO, and ngrok for public internet access.

## ✨ Features

- **Real-time messaging** - Instant message delivery
- **Typing indicators** - See when someone is typing
- **Message reactions** - React with emojis (👍, 😂, 😊, 🔥, 😮, 😢, 🎉, ❤️)
- **Message editing & deletion** - Edit or delete your own messages
- **User profiles** - Customize your username, avatar, and status
- **Multiple servers & channels** - Organize conversations
- **Message pinning** - Pin important messages
- **Online/offline status** - See who's currently active
- **Public internet access** - Share with friends anywhere in the world

## 🚀 Quick Start

### Option 1: Public Internet Access (Recommended)
```bash
python start_chat.py
```
This will create a public URL that friends can access from anywhere!

### Option 2: Local Network Only
```bash
python app_simple.py
```
This runs without ngrok - only for friends on the same WiFi network.

### Option 3: Windows Double-Click
Just double-click `start_chat.bat` file!

## 🌍 Sharing with Friends

### Public Internet Access (Anywhere)
When you start the app with `python start_chat.py`, you'll see:
```
🌐 Your chat app is now accessible from anywhere!
📱 Public URL: https://abc123.ngrok.io
🔗 Share this link with your friends!
```

**Share this URL with your friends anywhere in the world!**

### Local Network Access (Same WiFi)
If using `python app_simple.py`, friends on the same WiFi can use:
```
http://192.168.71.243:5000
```

## 📱 How Friends Join

1. **Send them the public URL** (e.g., `https://abc123.ngrok.io`)
2. **They open the link** in their browser
3. **They automatically get a random username and avatar**
4. **They can customize their profile** by clicking the 👤 button
5. **Start chatting!**

## 🛠️ Installation

### Prerequisites
- Python 3.7+
- pip

### Install Dependencies
```bash
pip install flask flask-socketio eventlet pyngrok
```

## 🔧 Configuration

### Port Configuration
The app runs on port 5000 by default. To change it:
1. Edit `app.py` line: `socketio.run(app, debug=True, host='0.0.0.0', port=5000)`
2. Change `port=5000` to your desired port

### Custom Domain (Advanced)
For a permanent URL, you can:
1. Sign up for a free ngrok account
2. Get your authtoken
3. Configure ngrok with: `ngrok config add-authtoken YOUR_TOKEN`

## 🎯 Usage Guide

### For You (Host)
1. Run `python start_chat.py` (for public access)
2. Copy the public URL
3. Share with friends
4. Keep the terminal running

### For Your Friends
1. Click the link you shared
2. Customize profile (optional)
3. Start chatting!

## 🔒 Security Notes

- **No authentication required** - Anyone with the link can join
- **Messages are stored locally** - No cloud storage
- **Public URL** - Anyone can access if they have the link

## 🐛 Troubleshooting

### ngrok Issues
- **"ngrok error"** - Try running `python app_simple.py` instead for local-only access
- **URL not working** - Check if the terminal shows any error messages
- **Friends can't connect** - Make sure you're sharing the correct URL

### Port Issues
- **"Port already in use"** - Kill existing processes or change the port
- **Firewall blocking** - Allow Python/Flask through your firewall

### General Issues
- **Messages not sending** - Check browser console for errors
- **Typing indicators not working** - Refresh the page
- **Reactions not showing** - Make sure you're in the same channel

## 📞 Support

If you encounter issues:
1. Check the terminal for error messages
2. Try refreshing the browser
3. Restart the server
4. Check that all dependencies are installed

## 🎉 Current Status

✅ **Server is running** on port 5000  
✅ **Local access**: http://localhost:5000  
✅ **Network access**: http://192.168.71.243:5000  
✅ **Public access**: Available via ngrok  

## 🎉 Enjoy Your Chat!

Your friends can now join your chat from anywhere in the world! The app includes all modern chat features like typing indicators, reactions, and real-time messaging.
