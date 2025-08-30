# 🌐 Discord-like Anonymous Chat Application

A feature-rich, real-time chat application inspired by Discord, built with Flask, Socket.IO, and ngrok for seamless public internet access. Perfect for anonymous group chats, team collaborations, or casual conversations with friends.

## 🎯 Key Features

### 💬 Real-time Communication
- **Instant Messaging**: Real-time message delivery with Socket.IO
- **Typing Indicators**: See when others are typing in real-time
- **Online Status**: Live user presence tracking
- **Message History**: Persistent message storage with SQLite

### 🎨 User Experience
- **Anonymous Profiles**: Random username and avatar generation
- **Profile Customization**: Edit username, avatar emoji, and status
- **Dark/Light Themes**: Built-in theme support
- **Responsive Design**: Works seamlessly on desktop and mobile

### 🔧 Advanced Features
- **Multiple Servers**: Create and manage different chat communities
- **Channel System**: Organize conversations with dedicated channels
- **Message Reactions**: React with emojis (👍, 😂, 😊, 🔥, 😮, 😢, 🎉, ❤️)
- **Message Management**: Edit and delete your own messages
- **Message Pinning**: Pin important messages for quick reference
- **Emoji Picker**: Built-in emoji selector with categories
- **Message Copy**: Copy message text with one click
- **Reply System**: Reply to specific messages

### 🌐 Deployment Options
- **Local Network**: Share with friends on the same WiFi
- **Public Access**: ngrok integration for global accessibility
- **No Setup Required**: Friends can join instantly with just a link

## 🏗️ Architecture Overview

### Backend Technology Stack
- **Python 3.7+** - Core programming language
- **Flask 2.3.3** - Lightweight web framework
- **Flask-SocketIO** - Real-time bidirectional communication
- **SQLite3** - Embedded database for message persistence
- **Eventlet** - Asynchronous networking for high concurrency
- **Pyngrok** - Secure public URL tunneling

### Frontend Technology Stack
- **HTML5** - Semantic markup and structure
- **CSS3** - Modern styling with CSS variables and responsive design
- **Vanilla JavaScript (ES6+)** - No framework dependencies
- **Socket.IO Client 4.7.4** - Real-time client-side communication
- **Local Storage API** - Client-side message caching

### Database Schema
- **Users Table**: User profiles, online status, and session management
- **Servers Table**: Server names and metadata
- **Channels Table**: Channel organization within servers
- **Messages Table**: Complete message history with timestamps
- **Reactions Table**: Message reaction tracking
- **Pinned Messages**: Important message bookmarks

## 🚀 Quick Start Guide

### Prerequisites
- Python 3.7 or higher
- pip (Python package manager)

### Installation Steps

1. **Clone or download the project**
   ```bash
   # If you have git installed
   git clone <your-repo-url>
   cd anonymous-feedback-app
   ```

2. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

3. **Choose your deployment method:**

### Option 1: Public Internet Access (Recommended)
```bash
python start_chat.py
```
- Creates a public URL via ngrok
- Share with friends anywhere in the world
- Automatic ngrok tunnel management

### Option 2: Local Network Only
```bash
python app_simple.py
```
- Runs on local network only
- Faster startup, no external dependencies
- Access via `http://[your-local-ip]:5000`

### Option 3: Windows Easy Start
```bash
# Just double-click:
start_chat.bat
```
- One-click startup for Windows users
- Automatic dependency checking
- Console window for monitoring

## 📱 User Guide

### For Hosts (Setting Up the Chat)
1. **Start the server** using one of the methods above
2. **Copy the provided URL** (public or local)
3. **Share the link** with your friends
4. **Keep the terminal running** to maintain the chat session

### For Participants (Joining the Chat)
1. **Click the shared link** in any modern browser
2. **Set your profile** (optional - click the 👤 button)
   - Choose a nickname (max 32 characters)
   - Select an avatar emoji from the dropdown
   - Add a custom status message
3. **Explore servers and channels**
   - Join existing servers or create new ones
   - Navigate between different channels
4. **Start chatting!**
   - Type messages in the input field
   - Use emoji reactions on messages
   - Pin important messages
   - See who's online in the user list

### Advanced Features Usage

#### Creating Servers and Channels
- Click the **+** button in the server sidebar to create a new server
- Click **"+ Add Channel"** in the channel list to create new channels
- Right-click on servers for context menu options (including delete)

#### Message Interactions
- **React to messages**: Click the 😊 button on any message
- **Reply to messages**: Click the ↩️ button to start a reply
- **Edit messages**: Click ✏️ on your own messages (desktop hover)
- **Delete messages**: Click 🗑️ on your own messages
- **Copy messages**: Click 📋 to copy message text
- **Pin messages**: Click 📌 to pin important messages

#### User Management
- View online/offline status with color-coded indicators
- See user avatars and custom status messages
- Monitor typing indicators in real-time

## 🔧 Configuration Options

### Port Configuration
Edit `app.py` line 580 to change the default port:
```python
socketio.run(app, debug=True, host='0.0.0.0', port=5000)  # Change 5000 to your preferred port
```

### Custom ngrok Configuration
For persistent URLs and advanced ngrok features:
1. Sign up for a free ngrok account at https://ngrok.com/
2. Get your authtoken from the dashboard
3. Configure ngrok:
   ```bash
   ngrok config add-authtoken YOUR_AUTH_TOKEN
   ```

### Database Management
The application uses SQLite with automatic schema migration. Key database files:
- `chat.db` - Main database with all chat data
- Automatic backups are recommended for important conversations

## 🛡️ Security & Privacy

### Current Security Model
- **Open Access**: Anyone with the link can join (no password protection)
- **Local Storage**: Messages stored only on the host machine
- **Temporary Sessions**: User sessions expire on browser close
- **No User Registration**: Completely anonymous by design

### Privacy Considerations
- ⚠️ **Public URLs are accessible to anyone** with the link
- ⚠️ **Messages are not encrypted** in transit (use HTTPS for production)
- ⚠️ **No message moderation** tools included
- ✅ **No personal data collection** or tracking
- ✅ **Self-hosted solution** with full data control

### Recommended Usage
- **Ideal for**: Friends, small teams, temporary discussions
- **Not recommended for**: Sensitive conversations, large public groups
- **Best practices**: Regenerate URLs frequently, educate users about privacy

## 🐛 Troubleshooting Common Issues

### Connection Problems
- **"Cannot connect to server"**: Ensure the host machine is running the server
- **"ngrok tunnel failed"**: Try `python app_simple.py` for local-only access
- **Firewall issues**: Allow Python through your firewall on port 5000

### Performance Issues
- **Slow message delivery**: Check network connectivity, reduce number of simultaneous users
- **High CPU usage**: Consider reducing the `MAX_RENDERED_MESSAGES` in chat.js (default: 100)
- **Database locks**: Ensure only one instance is running per database file

### Feature-Specific Issues
- **Reactions not working**: Refresh the page, ensure you're in the same channel
- **Typing indicators stuck**: The indicator automatically clears after 1 second of inactivity
- **Messages not persisting**: Check that the `chat.db` file has write permissions

### Browser Compatibility
- **Supported**: Chrome 60+, Firefox 55+, Safari 12+, Edge 79+
- **Required**: WebSocket support, ES6+ JavaScript, CSS Grid/Flexbox
- **Mobile**: Fully responsive design works on iOS and Android

## 📊 Performance Optimization

### Client-Side Caching
- Messages are cached in localStorage for instant channel switching
- Maximum 100 messages rendered per channel for performance
- Efficient DOM rendering with message grouping

### Server-Side Optimizations
- Eventlet for asynchronous Socket.IO handling
- SQLite connection pooling and efficient queries
- Message batching and efficient broadcast patterns

### Scaling Considerations
- Current design supports 10-50 concurrent users comfortably
- For larger groups, consider:
  - PostgreSQL instead of SQLite
  - Redis for Socket.IO scaling
  - Load balancing multiple instances

## 🔮 Future Enhancements

### Planned Features
- [ ] **File sharing** and image upload support
- [ ] **Voice channels** with WebRTC integration
- [ ] **Message search** and filtering
- [ ] **User roles** and permissions system
- [ ] **Message formatting** (bold, italics, code blocks)
- [ ] **Export conversations** to various formats
- [ ] **Theme customization** with color picker
- [ ] **Push notifications** for mentions

### Technical Improvements
- [ ] **Database encryption** for message privacy
- [ ] **Rate limiting** to prevent abuse
- [ ] **Message compression** for large conversations
- [ ] **Automated backups** and restore functionality
- [ ] **Docker containerization** for easy deployment

## 🤝 Contributing

This project welcomes contributions! Here's how you can help:

### Reporting Issues
- Check existing issues before creating new ones
- Include detailed reproduction steps
- Provide browser console logs if available

### Feature Requests
- Describe the use case clearly
- Consider if it fits the project's anonymous chat focus
- Suggest implementation approach if possible

### Code Contributions
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is provided as-is for educational and personal use. Please respect the privacy of your chat participants and use responsibly.

## 🆘 Getting Help

If you need assistance:
1. **Check this README** first for solutions
2. **Review the terminal output** for error messages
3. **Examine browser console** (F12) for client-side issues
4. **Ensure all dependencies** are properly installed

For persistent issues, consider:
- Restarting the server and browser
- Checking firewall and network settings
- Verifying Python and package versions

---

## 🎉 Happy Chatting!

Your feature-rich, anonymous chat application is ready to use. Share the link with friends and start building your chat community today!

✨ **Pro Tip**: Use the profile customization to make your chat experience personal and recognizable to your friends!
