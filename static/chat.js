console.log("✅ chat.js loaded");

let messageEventCount = 0;
let socketConnectCount = 0;
let pinnedMessages = [];

const socket = io();
console.log('[DEBUG] Socket connection established');
socketConnectCount++;

socket.on('connect', () => {
  socketConnectCount++;
  console.log(`[DEBUG] Socket connected (${socketConnectCount} times):`, socket.id);
  // On connect, join the last selected server
  if (currentServer) {
    console.log(`[DEBUG] Emitting join_server for server: ${currentServer}`);
    socket.emit('join_server', { server: currentServer });
  }
  // Also immediately join the last known channel (if any) to ensure server-side session is ready for sending
  if (currentServer && currentChannel) {
    console.log(`[DEBUG] Emitting join_channel on connect for channel: ${currentChannel}`);
    socket.emit('join_channel', { server: currentServer, channel: currentChannel });
  }
});

// Redirect to Set Profile if server requires login
socket.on('require_login', () => {
  try { window.location.assign('/login'); } catch (e) { window.location.href = '/login'; }
});

// DOM elements
const serverSidebar = document.getElementById('server-sidebar');
const channelList = document.getElementById('channel-list');
const chatHeader = document.getElementById('chat-header');
const messagesDiv = document.getElementById('messages');
const chatForm = document.getElementById('chat-form');
const messageInput = document.getElementById('message-input');
const typingIndicator = document.getElementById('typing-indicator');
const userListDiv = document.getElementById('user-list');
const addServerBtn = document.getElementById('add-server');
const profileBtn = document.getElementById('profile-btn');
let logoutBtn = document.getElementById('logout-btn');
if (!logoutBtn) {
  logoutBtn = document.createElement('button');
  logoutBtn.id = 'logout-btn';
  logoutBtn.title = 'Logout';
  logoutBtn.textContent = '⎋';
  logoutBtn.style.cssText = 'position:fixed;top:1rem;right:4.5rem;z-index:10;background:#f04747;color:#fff;border:none;border-radius:50%;width:48px;height:48px;font-size:1.25rem;cursor:pointer;';
  document.body.appendChild(logoutBtn);
}
logoutBtn.onclick = () => {
  // Use a simple navigation to hit server-side logout route, which clears session and redirects
  window.location.assign('/logout');
};
const profileModal = document.getElementById('profile-modal');
const profileNickname = document.getElementById('profile-nickname');
const profileAvatar = document.getElementById('profile-avatar');
const profileStatus = document.getElementById('profile-status');
const profileSave = document.getElementById('profile-save');
const profileCancel = document.getElementById('profile-cancel');
const pinnedBar = document.getElementById('pinned-bar');
const addServerModal = document.getElementById('add-server-modal');
const addServerName = document.getElementById('add-server-name');
const addServerPassword = document.getElementById('add-server-password');
const addServerDesc = document.getElementById('add-server-desc');
const addServerSave = document.getElementById('add-server-save');
const addServerCancel = document.getElementById('add-server-cancel');
const addChannelModal = document.getElementById('add-channel-modal');
const addChannelName = document.getElementById('add-channel-name');
const addChannelSave = document.getElementById('add-channel-save');
const addChannelCancel = document.getElementById('add-channel-cancel');

const clearChatBtn = document.getElementById('clear-chat-btn');
const emojiBtn = document.getElementById('emoji-btn');
const emojiPicker = document.getElementById('emoji-picker');
const uploadBtn = document.getElementById('upload-btn');
const fileInput = document.getElementById('file-input');
const attachmentPreview = document.getElementById('attachment-preview');

clearChatBtn.addEventListener('click', () => {
  if (!currentServer || !currentChannel) {
    alert('Please select a server and channel before clearing chat.');
    return;
  }
  // Optimistically clear UI immediately while requesting server
  const key = getCurrentChannelKey();
  if (key) {
    optimisticClears.add(key);
  }
  // Clear visible UI instantly, but keep cache until server confirms
  messagesDiv.innerHTML = '';
  typingIndicator.style.display = 'none';
  pinnedBar.innerHTML = '';
  // Mark last clear intent for potential retry after owner auth
  lastClearRequested = true;
  // Send request to server
  socket.emit('clear_chat', { server: currentServer, channel: currentChannel });
});

// Show a toast when permission is denied for owner-only actions
socket.on('permission_denied', (data = {}) => {
  const msg = data.message || "You don't have permission to perform this action.";
  showToast(msg);
  // If clear_chat was denied, restore messages from cache immediately
  if (data.action === 'clear_chat') {
    const key = getCurrentChannelKey();
    if (key && optimisticClears.has(key)) {
      optimisticClears.delete(key);
      const restore = getMessageHistoryForCurrentChannel();
      renderMessages(restore);
    }
    showToast('Tip: Right-click the server icon and choose "Unlock Admin" to enter the password.');
    // Do not auto-prompt; let user use the context menu
    pendingOwnerAction = null;
    pendingOwnerServer = null;
  } else if (data.action === 'delete_server') {
    showToast('Tip: Right-click the server icon and choose "Unlock Admin" to enter the password.');
    // Do not auto-prompt; let user use the context menu
    pendingOwnerAction = null;
    pendingOwnerServer = null;
  } else {
    // No auto-auth flow for other actions
    pendingOwnerAction = null;
    pendingOwnerServer = null;
  }
});

socket.on('owner_auth_ok', ({ server }) => {
  showToast('Owner authentication successful');
  if (pendingOwnerServer && server === pendingOwnerServer) {
    const action = pendingOwnerAction;
    const target = pendingOwnerServer;
    // Clear pending state first to avoid cascading retries
    pendingOwnerAction = null;
    pendingOwnerServer = null;
    if (action === 'clear_chat') {
      lastClearRequested = false;
      socket.emit('clear_chat', { server: target, channel: currentChannel });
    } else if (action === 'delete_server') {
      lastDeletionServer = null;
      socket.emit('delete_server', { server: target });
    }
  }
});

socket.on('chat_cleared', (payload = {}) => {
  // Clear chat UI and message history for the specified scope (fallback to current)
  const server = payload.server || currentServer;
  const channel = payload.channel || currentChannel;
  if (!server || !channel) return;
  const key = `${server}:${channel}`;
  if (optimisticClears.has(key)) optimisticClears.delete(key);
  // Clear stored history for that channel
  clearMessageHistoryFor(server, channel);
  // If this is the active channel, re-render empty and clear pinned bar immediately
  if (server === currentServer && channel === currentChannel) {
    pinnedBar.innerHTML = '';
    renderMessages([]);
  }
});

let myUsername = '';
let myAvatar = '';
let currentServer = localStorage.getItem('currentServer') || null;
let currentChannel = localStorage.getItem('currentChannel') || null;
let typingTimeout = null;
let myStatus = '';
let pendingAttachments = []; // [{url, name, type, mime?, size}, ...]

// Buffer to hold messages received before session info is set
let messageBuffer = [];
let sessionReady = false;
// Infinite scroll / rendering flags
let suppressAutoScroll = false;
let renderFullHistory = false;
let isLoadingHistory = false;
let noMoreHistory = false;
let pendingJumpTarget = null;
let optimisticClears = new Set();
let lastDeletionServer = null;
let lastClearRequested = false;
let pendingOwnerAction = null; // 'clear_chat' | 'delete_server'
let pendingOwnerServer = null;

// Last-read tracking per channel and UI helpers
const LAST_READ_KEY = 'lastReadByChannelV1';
function getLastReadForCurrentChannel() {
  try {
    const key = getCurrentChannelKey();
    if (!key) return null;
    const map = JSON.parse(localStorage.getItem(LAST_READ_KEY) || '{}');
    return map[key] || null;
  } catch { return null; }
}
function setLastReadForCurrentChannel(ts) {
  try {
    const key = getCurrentChannelKey();
    if (!key || !ts) return;
    const map = JSON.parse(localStorage.getItem(LAST_READ_KEY) || '{}');
    const prev = map[key] ? new Date(map[key]).getTime() : 0;
    const cur = new Date(ts).getTime();
    if (cur >= prev) {
      map[key] = ts;
      localStorage.setItem(LAST_READ_KEY, JSON.stringify(map));
    }
  } catch {}
}

// Jump-to-present button
const chatSectionRoot = document.querySelector('.chat-section');
let jumpBtn = document.getElementById('jump-to-present');
if (!jumpBtn) {
  jumpBtn = document.createElement('button');
  jumpBtn.id = 'jump-to-present';
  jumpBtn.textContent = 'Jump to present';
  jumpBtn.style.cssText = 'position:absolute; right:16px; bottom:80px; z-index:50; display:none; background:#5865f2; color:#fff; border:none; border-radius:16px; padding:8px 12px; cursor:pointer; opacity:0.95;';
  chatSectionRoot?.appendChild(jumpBtn);
}
jumpBtn?.addEventListener('click', () => {
  suppressAutoScroll = false;
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
  const current = getMessageHistoryForCurrentChannel();
  if (current && current.length) {
    const last = current[current.length - 1];
    if (last && last.timestamp) setLastReadForCurrentChannel(last.timestamp);
  }
  jumpBtn.style.display = 'none';
});

// Drag-over highlight overlay
let dropOverlay = document.getElementById('drop-overlay');
if (!dropOverlay) {
  dropOverlay = document.createElement('div');
  dropOverlay.id = 'drop-overlay';
  dropOverlay.style.cssText = 'position:absolute; inset:0; background:rgba(88,101,242,0.15); border:2px dashed #5865f2; display:none; z-index:40;';
  chatSectionRoot?.appendChild(dropOverlay);
}

// Simple image lightbox
let lightbox = document.getElementById('lightbox');
if (!lightbox) {
  lightbox = document.createElement('div');
  lightbox.id = 'lightbox';
  lightbox.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.85); display:none; align-items:center; justify-content:center; z-index:1000;';
  const img = document.createElement('img');
  img.style.cssText = 'max-width:90vw; max-height:90vh; border-radius:8px; box-shadow:0 8px 32px rgba(0,0,0,0.5)';
  lightbox.appendChild(img);
  document.body.appendChild(lightbox);
  lightbox.addEventListener('click', () => { lightbox.style.display = 'none'; });
}
function openLightbox(url, name) {
  const img = lightbox.querySelector('img');
  img.src = url;
  img.alt = name || '';
  lightbox.style.display = 'flex';
}

// Fast-switch optimizations: persist per-channel history and last channel per server
const HISTORY_KEY = 'messageHistoryV1';
const LAST_CHANNELS_KEY = 'lastChannelsByServer';

function loadPersistedHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        messageHistory = parsed;
      }
    }
  } catch (e) {
    // ignore
  }
}

function persistHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(messageHistory));
  } catch (e) {
    // ignore
  }
}

function getLastChannelForServer(server) {
  try {
    const map = JSON.parse(localStorage.getItem(LAST_CHANNELS_KEY) || '{}');
    return map[server] || null;
  } catch (e) {
    return null;
  }
}

function setLastChannelForServer(server, channel) {
  try {
    const map = JSON.parse(localStorage.getItem(LAST_CHANNELS_KEY) || '{}');
    map[server] = channel;
    localStorage.setItem(LAST_CHANNELS_KEY, JSON.stringify(map));
  } catch (e) {
    // ignore
  }
}

// Render performance tuning
const MAX_RENDERED_MESSAGES = 100; // render the most recent N messages for instant switching
let userStatusMap = new Map(); // cache user status for O(1) lookups when rendering
// Reactions map must be defined before any initial rendering occurs
let messageReactions = {};

// Reply state management
let currentReply = null; // { msgId, username, avatar, text }

function startReply(msgId, username, avatar, text) {
  currentReply = { msgId, username, avatar, text };
  showReplyPreview();
  messageInput.focus();
}

function cancelReply() {
  currentReply = null;
  hideReplyPreview();
}

function showReplyPreview() {
  if (!currentReply) return;
  
  // Remove existing reply preview
  const existingPreview = document.getElementById('reply-preview');
  if (existingPreview) {
    existingPreview.remove();
  }
  
  // Create reply preview element
  const preview = document.createElement('div');
  preview.id = 'reply-preview';
  preview.className = 'reply-preview';
  preview.style.cssText = `
    background: rgba(88, 101, 242, 0.1);
    border-left: 3px solid #5865f2;
    padding: 0.5rem;
    margin: 0.5rem 0;
    border-radius: 3px;
    font-size: 0.9em;
    display: flex;
    align-items: center;
    justify-content: space-between;
  `;
  
  const replyText = currentReply.text.length > 50 
    ? currentReply.text.substring(0, 50) + '...'
    : currentReply.text;
  
  const content = document.createElement('div');
  content.innerHTML = `↳ Replying to <b>${currentReply.username}</b>: "${replyText}"`;
  
  const cancelBtn = document.createElement('button');
  cancelBtn.innerHTML = '✕';
  cancelBtn.style.cssText = `
    background: none;
    border: none;
    color: #aaa;
    cursor: pointer;
    font-size: 1.2em;
    padding: 0;
    margin-left: 0.5rem;
  `;
  cancelBtn.onclick = cancelReply;
  cancelBtn.title = 'Cancel reply';
  
  preview.appendChild(content);
  preview.appendChild(cancelBtn);
  
  // Insert before chat form
  chatForm.parentNode.insertBefore(preview, chatForm);
}

function hideReplyPreview() {
  const preview = document.getElementById('reply-preview');
  if (preview) {
    preview.remove();
  }
}

function renderChannels(channels) {
  channelList.innerHTML = '';
  channels.forEach(channel => {
    const div = document.createElement('div');
    div.className = 'channel' + (channel === currentChannel ? ' selected' : '');
    div.textContent = `# ${channel}`;
  div.onclick = () => {
    if (currentChannel !== channel) {
      currentChannel = channel;
      localStorage.setItem('currentChannel', currentChannel);
      setLastChannelForServer(currentServer, currentChannel);
      socket.emit('join_channel', { server: currentServer, channel });
      renderChannels(channels);
      chatHeader.textContent = `${currentServer} / #${channel}`;
      chatForm.style.display = '';
      // Immediately render any cached messages for this channel
      const existing = getMessageHistoryForCurrentChannel();
      renderMessages(existing);
      // Clear typing indicators when switching channels
      typingUsers.clear();
      updateTypingIndicator();
    }
  };
    channelList.appendChild(div);
  });
  // Add channel creation
  const addChannel = document.createElement('div');
  addChannel.className = 'channel';
  addChannel.style.color = '#5865f2';
  addChannel.textContent = '+ Add Channel';
  addChannel.onclick = () => {
    addChannelName.value = '';
    addChannelModal.style.display = 'flex';
    setTimeout(() => addChannelName.focus(), 100);
  };
  channelList.appendChild(addChannel);
}

function renderUserList(users) {
  userListDiv.innerHTML = '';
  users.forEach(user => {
    const div = document.createElement('div');
    div.className = 'user';
    const statusDot = document.createElement('span');
    statusDot.style.display = 'inline-block';
    statusDot.style.width = '10px';
    statusDot.style.height = '10px';
    statusDot.style.borderRadius = '50%';
    statusDot.style.marginRight = '0.5em';
    statusDot.style.background = user.online ? '#43b581' : '#747f8d';
    statusDot.title = user.online ? 'Online' : (user.last_seen ? 'Last seen: ' + formatTimestamp(user.last_seen) : 'Offline');
    div.appendChild(statusDot);
    div.innerHTML += `<span class="avatar" title="${user.status || ''}">${user.avatar}</span> <span title="${user.status || ''}">${user.username}</span>`;
    if (user.status) {
      div.title = user.status;
    }
    if (!user.online && user.last_seen) {
      div.title += (div.title ? ' | ' : '') + 'Last seen: ' + formatTimestamp(user.last_seen);
    }
    userListDiv.appendChild(div);
  });
}

  
// --- Socket.IO Events ---

socket.on('server_deleted', ({ server }) => {
  console.log('Server deleted:', server);

  // Remove server from sidebar
  const serverElement = document.querySelector(`[data-server-name="${server}"]`);
  if (serverElement) {
    serverElement.remove();
  }
});
function highlightMentions(text) {
  return renderMarkdown(String(text || ''));
}

socket.on('session', data => {
  myUsername = data.username;
  myAvatar = data.avatar;
  myStatus = data.status || '';
  sessionReady = true;
  // Render buffered messages now that session info is available
  if (messageBuffer.length > 0) {
    // Route buffered messages to their respective server/channel histories
    messageBuffer.forEach(m => {
      const targetServer = m.server || currentServer;
      const targetChannel = m.channel || currentChannel;
      const selfMsg = m.username === myUsername && m.avatar === myAvatar;
      const targetMsgs = getMessageHistoryFor(targetServer, targetChannel);
      const existingIndex = targetMsgs.findIndex(msg => msg.id === m.id || (selfMsg && msg.id === m.tempId));
      if (existingIndex !== -1) {
        targetMsgs.splice(existingIndex, 1);
      }
      const messageObj = {
        username: m.username,
        avatar: m.avatar,
        text: m.msg,
        self: selfMsg,
        id: m.id,
        timestamp: m.timestamp,
        status: m.status || '',
        reactions: m.reactions || {}
      };
      if (Array.isArray(m.attachments)) {
        messageObj.attachments = m.attachments;
      }
      if (m.attachment_url) {
        messageObj.attachment = {
          url: m.attachment_url,
          name: m.attachment_name,
          type: m.attachment_type,
          size: m.attachment_size
        };
      }
      // Add reply/thread data if present
      if (m.reply_to_id && m.reply_to_text && m.reply_to_username && m.reply_to_avatar) {
        messageObj.replyTo = {
          id: m.reply_to_id,
          text: m.reply_to_text,
          username: m.reply_to_username,
          avatar: m.reply_to_avatar
        };
      }
      if (m.thread_id) {
        messageObj.threadId = m.thread_id;
      }
      targetMsgs.push(messageObj);
      setMessageHistoryFor(targetServer, targetChannel, targetMsgs);
    });
    // After routing, render the active channel from its own history
    const cur = getMessageHistoryForCurrentChannel();
    renderMessages(cur);
    messageBuffer = [];
  }
});

socket.on('connect', () => {
  console.log('🔌 Connected to Socket.IO server');
});

console.log('[DEBUG] Waiting for server_list...');
socket.on('server_list', data => {
  console.log('[RECEIVED] server_list:', data.servers);
  renderServers(data.servers);
  // Automatically select the last selected server if available, else first server
  if (currentServer && data.servers.includes(currentServer)) {
    // Emit join_server only if not already emitted on connect
    // This avoids duplicate join_server emits
    // So do nothing here
  } else if (data.servers.length > 0) {
    currentServer = data.servers[0];
    localStorage.setItem('currentServer', currentServer);
    console.log(`[DEBUG] Emitting join_server for new server: ${currentServer}`);
    socket.emit('join_server', { server: currentServer });
  }
});

socket.on('channel_list', data => {
  renderChannels(data.channels);
  // Automatically select the last selected channel if available, else first channel
  if (currentChannel && data.channels.includes(currentChannel)) {
    chatHeader.textContent = `${currentServer} / #${currentChannel}`;
    chatForm.style.display = '';
    // Immediately render any cached messages for this channel
    const existing = getMessageHistoryForCurrentChannel();
    renderMessages(existing);
    console.log(`[DEBUG] Emitting join_channel for channel: ${currentChannel}`);
    socket.emit('join_channel', { server: currentServer, channel: currentChannel });
  } else if (data.channels.length > 0) {
    currentChannel = data.channels[0];
    localStorage.setItem('currentChannel', currentChannel);
    chatHeader.textContent = `${currentServer} / #${currentChannel}`;
    chatForm.style.display = '';
    // Immediately render any cached messages for this channel
    const existing = getMessageHistoryForCurrentChannel();
    renderMessages(existing);
    console.log(`[DEBUG] Emitting join_channel for new channel: ${currentChannel}`);
    socket.emit('join_channel', { server: currentServer, channel: currentChannel });
  }
});

let messageIdSet = new Set();

socket.on('joined_channel', data => {
  chatHeader.textContent = `${currentServer} / #${data.channel}`;
  chatForm.style.display = '';
  // Clear message history and id set before loading new messages
  // Only clear message history if switching channels
  if (data.channel !== currentChannel) {
    clearMessageHistoryForCurrentChannel();
    messageIdSet.clear();
  }
  // Render messages for the joined channel from messageHistory
  const currentMessages = getMessageHistoryForCurrentChannel();
  renderMessages(currentMessages);
});

let typingUsers = new Set();

socket.on('typing', data => {
  if (data.user && data.user !== myUsername) {
    typingUsers.add(data.user);
    updateTypingIndicator();
  }
});

socket.on('stop_typing', data => {
  if (data.user && data.user !== myUsername) {
    typingUsers.delete(data.user);
    updateTypingIndicator();
  }
});

function updateTypingIndicator() {
  if (typingUsers.size === 0) {
    typingIndicator.style.display = 'none';
    typingIndicator.innerHTML = '';
  } else if (typingUsers.size === 1) {
    const user = Array.from(typingUsers)[0];
    typingIndicator.innerHTML = `<span class="typing-user">${user}</span> is typing<span class="typing-dots">...</span>`;
    typingIndicator.style.display = 'block';
  } else if (typingUsers.size === 2) {
    const users = Array.from(typingUsers);
    typingIndicator.innerHTML = `<span class="typing-user">${users[0]}</span> and <span class="typing-user">${users[1]}</span> are typing<span class="typing-dots">...</span>`;
    typingIndicator.style.display = 'block';
  } else {
    const users = Array.from(typingUsers);
    const firstUser = users[0];
    const othersCount = users.length - 1;
    typingIndicator.innerHTML = `<span class="typing-user">${firstUser}</span> and ${othersCount} others are typing<span class="typing-dots">...</span>`;
    typingIndicator.style.display = 'block';
  }
}

// Store the latest user list for status lookup in messages
let latestUserList = [];
socket.on('user_list', data => {
  latestUserList = data.users;
  // Build a fast lookup map for statuses
  userStatusMap = new Map(data.users.map(u => [u.username + '|' + u.avatar, { online: u.online, last_seen: u.last_seen }]));
  renderUserList(data.users);
});

function getUserStatus(username, avatar) {
  const rec = userStatusMap.get(username + '|' + avatar);
  return rec ? { online: rec.online, last_seen: rec.last_seen } : { online: false, last_seen: null };
}

socket.on('profile_updated', data => {
  myUsername = data.username;
  myAvatar = data.avatar;
  myStatus = data.status || '';
});

// --- UI Events ---
let isSendingMessage = false;

chatForm.addEventListener('submit', function (e) {
  console.log('[DEBUG] Form submit event triggered');
  e.preventDefault();

  if (isSendingMessage) {
    console.log('[DEBUG] Message send in progress, ignoring duplicate submit');
    return;
  }

  const msg = messageInput.value.trim();
  if (!currentServer || !currentChannel) {
    alert('Please select a server and channel before sending a message.');
    return;
  }
  if (!msg && (!pendingAttachments || pendingAttachments.length === 0)) {
    // Nothing to send
    return;
  }

  isSendingMessage = true;

  // Generate a temporary unique id for the message
  const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Add to local history immediately
  const currentMessages = getMessageHistoryForCurrentChannel();

  // Remove any existing message with same tempId (shouldn’t normally happen)
  const existingIndex = currentMessages.findIndex(m => m.id === tempId);
  if (existingIndex !== -1) {
    currentMessages.splice(existingIndex, 1);
  }

  currentMessages.push({
    username: myUsername,
    avatar: myAvatar,
    text: msg,
    self: true,
    id: tempId,
    timestamp: new Date().toISOString(),
    status: '',
    reactions: {},
    attachment: (pendingAttachments && pendingAttachments[0]) ? { ...pendingAttachments[0] } : null,
    attachments: Array.isArray(pendingAttachments) ? [...pendingAttachments] : []
  });

  setMessageHistoryForCurrentChannel(currentMessages);
  renderMessages(currentMessages);

  // Build message object to send to server
  const messageData = {
    msg,
    username: myUsername,
    avatar: myAvatar,
    server: currentServer,
    channel: currentChannel,
    tempId: tempId
  };
  if (pendingAttachments && pendingAttachments.length) {
    messageData.attachments = pendingAttachments;
  }

  if (currentReply) {
    messageData.reply_to = currentReply.msgId;
  }

  // Safety timeout in case server never acknowledges
  const sendTimeout = setTimeout(() => {
    console.warn('[DEBUG] Message ack not received, resetting state');
    isSendingMessage = false;
  }, 3000);

  // Send to server
  socket.emit('message', messageData, () => {
    clearTimeout(sendTimeout); // prevent fallback reset
    isSendingMessage = false;
  });

  // Clear input, reply, and pending attachment
  messageInput.value = '';
  cancelReply();
  pendingAttachments = [];
  renderAttachmentPreview();
});





messageInput.addEventListener('input', function() {
  if (currentServer && currentChannel) {
    socket.emit('typing', {});
    
    // Clear existing timeout
    if (typingTimeout) {
      clearTimeout(typingTimeout);
    }
    
    // Set new timeout to stop typing indicator
    typingTimeout = setTimeout(() => {
      socket.emit('stop_typing', {});
    }, 1000);
  }
});

// Stop typing when input loses focus
messageInput.addEventListener('blur', function() {
  if (typingTimeout) {
    clearTimeout(typingTimeout);
    socket.emit('stop_typing', {});
  }
});

// --- Upload / Attachment handling ---
function renderAttachmentPreview() {
  if (Array.isArray(pendingAttachments) && pendingAttachments.length > 0) {
    attachmentPreview.style.display = 'block';
    const items = pendingAttachments.map((att, idx) => {
      const sizeStr = typeof att.size === 'number' ? ` · ${formatBytes(att.size)}` : '';
      if (att.type === 'image') {
        return `
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">
            <img src="${att.url}" alt="${escapeHTML(att.name || 'image')}" style="max-height:80px; max-width:120px; border-radius:6px; border:1px solid #23272a;" />
            <div style="color:#fff;">
              <div>${escapeHTML(att.name || 'image')}${sizeStr}</div>
              <a href="${att.url}" target="_blank" style="color:#8be9fd;">Open</a>
            </div>
            <button class="btn remove-attachment" data-index="${idx}" type="button" style="background:#444;">Remove</button>
          </div>`;
      } else {
        return `
          <div style="display:flex; align-items:center; gap:10px; color:#fff; margin-bottom:6px;">
            <span>📎</span>
            <a href="${att.url}" target="_blank" style="color:#8be9fd;">${escapeHTML(att.name || 'file')}</a>
            <span style="color:#b9bbbe;">${sizeStr}</span>
            <button class="btn remove-attachment" data-index="${idx}" type="button" style="background:#444; margin-left:8px;">Remove</button>
          </div>`;
      }
    }).join('');
    attachmentPreview.innerHTML = items;
    attachmentPreview.querySelectorAll('.remove-attachment').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.getAttribute('data-index'));
        if (!isNaN(i)) {
          pendingAttachments.splice(i, 1);
          renderAttachmentPreview();
        }
      });
    });
  } else {
    attachmentPreview.style.display = 'none';
    attachmentPreview.innerHTML = '';
  }
}

uploadBtn?.addEventListener('click', () => fileInput?.click());
fileInput?.setAttribute('multiple', 'multiple');
fileInput?.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  try {
    const uploads = files.map(async (file) => {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/upload', { method: 'POST', body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Upload failed');
        return null;
      }
      const data = await res.json();
      return { url: data.url, name: data.name, type: data.type, mime: data.mime, size: data.size };
    });
    const results = await Promise.all(uploads);
    results.filter(Boolean).forEach(att => pendingAttachments.push(att));
    renderAttachmentPreview();
  } catch (err) {
    console.error('Upload error', err);
    showToast('Upload error');
  } finally {
    fileInput.value = '';
  }
});

// Drag & drop uploads
const chatSection = document.querySelector('.chat-section');
if (chatSection) {
  ['dragenter','dragover','dragleave','drop'].forEach(ev => {
    chatSection.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (ev === 'dragenter' || ev === 'dragover') dropOverlay.style.display = 'block';
      if (ev === 'dragleave' || ev === 'drop') dropOverlay.style.display = 'none';
    });
  });
  chatSection.addEventListener('drop', async (e) => {
    try {
      const files = Array.from(e.dataTransfer.files || []);
      if (!files.length) return;
      const uploads = files.map(async (file) => {
        const fd = new FormData(); fd.append('file', file);
        const res = await fetch('/upload', { method: 'POST', body: fd });
        if (!res.ok) { const err = await res.json().catch(()=>({})); showToast(err.error || 'Upload failed'); return null; }
        const data = await res.json();
        return { url: data.url, name: data.name, type: data.type, mime: data.mime, size: data.size };
      });
      const results = await Promise.all(uploads);
      results.filter(Boolean).forEach(att => pendingAttachments.push(att));
      renderAttachmentPreview();
    } catch (err) { console.error('Drop upload error', err); }
  });
}

// Clipboard paste image upload
window.addEventListener('paste', async (e) => {
  try {
    const items = Array.from(e.clipboardData?.items || []);
    const files = items.filter(it => it.kind === 'file').map(it => it.getAsFile()).filter(Boolean);
    if (!files.length) return;
    const uploads = files.map(async (file) => {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch('/upload', { method: 'POST', body: fd });
      if (!res.ok) { const err = await res.json().catch(()=>({})); showToast(err.error || 'Upload failed'); return null; }
      const data = await res.json();
      return { url: data.url, name: data.name, type: data.type, mime: data.mime, size: data.size };
    });
    const results = await Promise.all(uploads);
    results.filter(Boolean).forEach(att => pendingAttachments.push(att));
    renderAttachmentPreview();
  } catch (err) { console.error('Paste upload error', err); }
});

addServerBtn.onclick = () => {
  addServerName.value = '';
  addServerModal.style.display = 'flex';
  setTimeout(() => addServerName.focus(), 100);
};
addServerCancel.onclick = () => {
  addServerModal.style.display = 'none';
};
addServerSave.onclick = () => {
  const name = (addServerName?.value || '').trim();
  if (!name) { addServerName?.focus(); return; }
  // Collect password from field if present, else prompt
  let pwd = (addServerPassword?.value || '').trim();
  if (!pwd) {
    const prompted = prompt('Set a server password (required to manage the server):');
    // If user cancelled, abort without creating server
    if (prompted === null) {
      if (addServerPassword) addServerPassword.focus();
      return;
    }
    pwd = String(prompted).trim();
    if (!pwd) {
      showToast('Server password is required');
      if (addServerPassword) addServerPassword.focus();
      return;
    }
  }
  const desc = (addServerDesc?.value || '').trim();

  console.log("Emitting create_server event with server name:", name);
  socket.emit('create_server', { server: name, password: pwd, description: desc });
  addServerModal.style.display = 'none';

  // Optimistically add/select the new server immediately
  currentServer = name;
  localStorage.setItem('currentServer', currentServer);
  currentChannel = 'general';
  localStorage.setItem('currentChannel', currentChannel);
  setLastChannelForServer(currentServer, currentChannel);

  // Build a new server list from DOM + new server
  const existingServers = Array.from(document.querySelectorAll('#server-sidebar .server[data-server-name]'))
    .map(el => el.getAttribute('data-server-name'));
  const newList = [...existingServers.filter(s => s !== name), name];
  renderServers(newList);

  // Render channels immediately (general + Add Channel)
  renderChannels(['general']);
  chatHeader.textContent = `${currentServer} / #${currentChannel}`;
  chatForm.style.display = '';
  userListDiv.innerHTML = '';
  pinnedBar.innerHTML = '';

  // Clear messages UI and set empty history for the new channel
  setMessageHistoryFor(currentServer, currentChannel, []);
  renderMessages([]);

  // Tell the server our new selection so it can sync history/users
  socket.emit('join_server', { server: currentServer });
  socket.emit('join_channel', { server: currentServer, channel: currentChannel });
};
// Removed duplicate server_list listener to avoid double-processing and delays after updates
addServerName.onkeydown = (e) => {
  if (e.key === 'Enter') addServerSave.onclick();
  if (e.key === 'Escape') addServerCancel.onclick();
};

addChannelCancel.onclick = () => {
  addChannelModal.style.display = 'none';
};
addChannelSave.onclick = () => {
  const name = addChannelName.value.trim();
  if (name && currentServer) {
    socket.emit('create_channel', { server: currentServer, channel: name });
    addChannelModal.style.display = 'none';
  } else {
    addChannelName.focus();
  }
};
addChannelName.onkeydown = (e) => {
  if (e.key === 'Enter') addChannelSave.onclick();
  if (e.key === 'Escape') addChannelCancel.onclick();
};

// --- Emoji Picker ---
const EMOJI_SET = [
  // Smileys & Emotion
  '😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊','🙂','🙃','😋','😎','🤩','🥳','😍','😘','😗','😙','😚','🥰','🤗','🤔','🤨','😐','😑','😶','🙄','😏','😣','😥','😮','🤐','😯','😪','😫','🥱','😴','😌','😛','😜','🤪','😝','🤤','😒','😓','😔','😕','☹️','🙁','😖','😞','😟','😤','😢','��','😦','😧','😨','😩','🤯','😱','😳','🥵','🥶','😰','😥','😓','🤥','🤫','🤭','🫢','🫣','🫠','🤗','🤔',
  // Hand gestures
  '👍','👎','👊','✊','🤛','🤜','👋','🤚','🖐','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👏','🙌','👐','🤲','🙏','💪','🫶',
  // Hearts & symbols of love
  '❤️','🧡','💛','💚','💙','💜','🤎','🖤','🤍','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟',
  // Animals & Nature
  '🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐽','🐸','🐵','🐔','🐧','🐦','🐤','🐣','🐥','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🪲','🐢','🐍','🦎','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🐊','🐅','🐆','🦓','🦍','🦧','🐘','🦛','🦏','🐪','🐫','🦒','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🐐','🦌','🦝','🦨','🦡','🦦','🦥',
  // Food & Drink
  '🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🫒','🥦','🥬','🥒','🌶','🫑','🌽','🥕','🧄','🧅','🥔','🍠','🥐','🍞','🥖','🧇','🥞','🧀','����','🍖','🥩','🥓','🍔','🍟','🍕','🌭','🥪','🌮','🌯','🥙','🧆','🍝','🍜','🍲','🍛','🍣','🍱','🍚','🍘','🍥','🥠','🍢','🍡','🍧','🍨','🍦','🎂','🍰','🧁','🥧','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🥛','🍼','☕','🍵','🧉','🧋','🥤','🍺','🍻','🍷','🥂','🥃','🍸','🍹','🍾',
  // Activities & Sports
  '⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🏓','🏸','🥅','🥊','🥋','🎽','🛹','🛼','⛳','🏌️‍♂️','🎯','🪁','🏆','🏅','🎖','🥇','🥈','🥉',
  // Travel & Places
  '🚗','🚕','🚙','🚌','🚎','🏎','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🛵','🏍','🛴','🚲','✈️','🛫','🛬','🚀','🛸','🚁','⛵','🚤','🛥','🛳','🚢','🗺️','🗽','🗼','🏰','🏯','🏟','🎡','🎢','🎠',
  // Objects
  '💡','🔌','🔋','🪫','🔦','🕯️','🧯','🧹','🧺','🧻','🪣','🧼','🧽','🧴','🛁','🛀','🛏','🛋','🚪','🪟','🖼','🪞','🪑','🧭','⌛','⏳','⏰','⏱','⏲','🕰️','📱','💻','⌨️','🖱️','🖨️','🧮','💽','💾','📼','📷','📸','🎥','🎬','📺',
  // Symbols
  '✅','☑️','✔️','❌','❎','⚠️','❗','❓','❕','❔','⛔','🚫','🔞','♻️','🔁','🔂','🔄','⏸','⏯','⏹','⏺','⏭','⏮','⏫','⏬','▶️','⏩','◀️','⏪','🔼','🔽','⬆️','⬇️','↗️','↘️','➡️','⬅️','🔔','🔕','🎵','🎶'
];

// Emoji categories and picker rendering with tabs
const EMOJI_CATEGORIES = {
  'Smileys & Emotion': ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥸','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🤭','🤫','🤥','😶','😐','😑','😬','🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','🤐','🥴','🤢','🤮','🤧','😷','🤒','🤕','🤑','🤠','😈','👿','👹','👺','💀','☠️','👻','👽','👾','🤖','🎃','😺','😸','😹','😻','😼','😽','🙀','😿','😾','🙈','🙉','🙊'],
  'Hand gestures': ['👋','🤚','🖐','✋','🖖','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','🫵','🫱','🫲','🫸','🫷','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','🫶','✍️','💅','🤳'],
  'Hearts & Love': ['❤️','🩷','🧡','💛','💚','💙','💜','🤎','🖤','🤍','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟'],
  'Animals & Nature': ['🐵','🐒','🦍','🦧','🐶','🐕','🦮','🐕‍🦺','🐩','🐺','🦊','🐱','🐈','🐈‍⬛','🦁','🐯','🐅','🐆','🐴','🐎','🦄','🦓','🦬','🐂','🐃','🐄','🐖','🐗','🐽','🐏','🐑','🐐','🐪','🐫','🦙','🦒','🐘','🦣','🦏','🦛','🐭','🐁','🐀','🐹','🐰','🐇','🐿️','🦫','🦔','🦇','🐻','🐻‍❄️','🐨','🐼','🦥','🦦','🦨','🦘','🦡','🐾','🦃','🐔','🐓','🐣','🐤','🐥','🐦','🐧','🕊️','🦅','🦆','🦢','🦉','🦤','🪶','🦩','🦚','🦜','🐸','🐊','🐢','🦎','🐍','🐲','🐉','🦕','🦖','🐳','🐋','🐬','🦭','🐟','🐠','🐡','🦈','🐙','🐚','🪸','🪼','🐌','🦋','🐛','🐜','🐝','🪲','🐞','🦗','🪳','🕷️','🕸️','🦂','🦟','🪰','🪱','🦠','💐','🌸','💮','🏵️','🌹','🥀','🌺','🌻','🌼','🌷','🪻','🌱','🪴','🌲','🌳','🌴','🌵','🌾','🌿','☘️','🍀','🍁','🍂','🍃','🪹','🪺','🍄','🌑','🌒','🌓','🌔','🌕','🌖','🌗','🌘','🌙','🌚','🌛','🌜','🌡️','☀️','🌝','🌞','⭐','🌟','🌠','🌌','☁️','⛅','🌤️','🌥️','🌦️','🌧️','🌨️','🌩️','🌪️','🌫️','🌬️','🌀','🌈','☂️','🌂','☔','⛱️'],
  'Food & Drink': ['🍇','🍈','🍉','🍊','🍋','🍌','🍍','🥭','🍎','🍏','🍐','🍑','🍒','🍓','🫐','🥝','🍅','🫒','🥥','🥑','🍆','🥔','🥕','🌽','🌶️','🫑','🥒','🥬','🥦','🧄','🧅','🥜','🫘','🌰','🫚','🍄','🥯','🥨','🥖','🥐','🍞','🥞','🧇','🧀','🍖','🍗','🥩','🥓','🍔','🍟','🍕','🌭','🥪','🌮','🌯','🫔','🥙','🧆','🥚','🍳','🥘','🍲','🥣','🫕','🥫','🍿','🧈','🧂','🥗','🍱','🍘','🍙','🍚','🍛','🍜','🍝','🍠','🍢','🍣','🍤','🍥','🥮','🍡','🥟','🥠','🥡','🦀','🦞','🦐','🦑','🦪','🍦','🍧','🍨','🍩','🍪','🎂','🍰','🧁','🥧','🍫','🍬','🍭','🍮','🍯','🍼','🥛','☕','🍵','🫖','🍶','🍾','🍷','🍸','🍹','🍺','🍻','🥂','🥃','🫗','🥤','🧋','🧃','🧉','🧊','🥢','🍴','🥄','🔪','🏺','🧂'],
  'Activities & Sports': ['🎃','🎄','🎆','🎇','🧨','✨','🎈','🎉','🎊','🥳','🎋','🎍','🎎','🎏','🎐','🎑','🎀','🎁','🎫','🏆','🏅','🥇','🥈','🥉','⚽','⚾','🥎','🏀','🏐','🏈','🏉','🎾','🥏','🎳','🏏','🏑','🏒','🥍','🏓','🏸','🥊','🥋','🥅','⛳','⛸️','🥌','🎿','🛷','🥌','🎯','🥏','🎱','🪀','🏓','🎮','🎰','🎲','🧩','♟️','🎭','🎨','🖼️','🎼','🎤','🎧','🎷','🎸','🎹','🎺','🎻','🥁','🪘','🪇','🪈','🪕','🎬','🏹','🎯','🎳','🪁','🎴','🀄','🎭','🎨','🎡','🎢','🎠','🎪','🪆','♥️','♦️','♣️','♠️'],
  'Travel & Places': ['🌍','🌎','🌏','🌐','🗺️','🧭','🏔️','⛰️','🌋','🗻','🏕️','🏖️','🏜️','🏝️','🏞️','🏟️','🏛️','🏗️','🧱','🏘️','🏚️','🏠','🏡','🏢','🏣','🏤','🏥','🏦','🏨','🏩','🏪','🏫','🏬','🏭','🏯','🏰','💒','🗼','🗽','⛪','🕌','🛕','🕍','⛩️','🕋','⛲','⛺','🌁','🌃','🏙️','🌄','🌅','🌆','🌇','🌉','♨️','🎠','🎡','🎢','💈','🎪','🚂','🚃','🚄','🚅','🚆','🚇','🚈','🚉','🚊','🚝','🚞','🚋','🚌','🚍','🚎','🚐','🚑','🚒','🚓','🚔','🚕','🚖','🚗','🚘','🚙','🚚','🚛','🚜','🏎️','🏍️','🛵','🦽','🦼','🛺','🚲','🛴','🛹','🛼','🚏','🛣️','🛤️','🛢️','⛽','🚨','🚥','🚦','🛑','🚧','⚓','🛟','⛵','🛶','🚤','🛳️','⛴️','🛥️','🚢','✈️','🛩️','🛫','🛬','🪂','💺','🚁','🚟','🚠','🚡','🛰️','🚀','🛸','🪐','🌌','🌠','🌌','🪨','🗿'],
  'Objects': ['⌚','⏰','⏱️','⏲️','🕰️','🧭','⌛','⏳','📱','📲','☎️','📞','📟','📠','🔋','🔌','💻','🖥️','🖨️','⌨️','🖱️','🖲️','💽','💾','💿','📀','🎥','🎞️','📽️','🎬','📺','📷','📸','📹','📼','🔍','🔎','🔬','🔭','📡','💡','🔦','🏮','📔','📕','📖','📗','📘','📙','📚','📓','📒','📃','📜','📄','📰','🗞️','📑','🔖','🏷️','💰','🪙','💴','💵','💶','💷','💳','🧾','✉️','📧','📨','📩','📤','📥','📦','📫','📪','📬','📭','📮','✏️','✒️','🖋️','🖊️','🖌️','🖍️','📝','💼','📁','📂','🗂️','📅','📆','🗒️','🗓️','📇','📈','📉','📊','📌','📍','📎','🖇️','📏','📐','✂️','🗃️','🗄️','🗑️','🔒','🔓','🔏','🔐','🔑','🗝️','🔨','🪓','⛏️','⚒️','🛠️','🗡️','⚔️','💣','🪃','🏹','🛡️','🪚','🔧','🪛','🔩','⚙️','🗜️','⚖️','🦯','🔗','⛓️','🪝','🧰','🧲','🪜','⚗️','🧪','🧫','🧬','🔬','🔭','📡','💉','🩸','💊','🩹','🩺','🚪','🪞','🪟','🛏️','🛋️','🪑','🚽','🪠','🚿','🛁','🪤','🧴','🧷','🧹','🧺','🧻','🪣','🧼','🪥','🧽','🧯','🛒','🚬','⚰️','🪦','⚱️','🧿','🪬','🛐','🕯️','🛋️','🪑','🔮','🧿','📿','💈','⚗️','🔭','🔬','🕳️'],
};
let emojiActiveCategory = 'Smileys & Emotion';
// Display titles for categories
const EMOJI_CATEGORY_TITLES = {
  'Smileys & Emotion': 'Smileys & people',
  'Hand gestures': 'Hand gestures',
  'Hearts & Love': 'Hearts & love',
  'Animals & Nature': 'Animals',
  'Food & Drink': 'Food & drink',
  'Activities & Sports': 'Activities',
  'Travel & Places': 'Travel',
  'Objects': 'Objects',
  'Symbols': 'Symbols'
};
// Icons for bottom category bar
const EMOJI_CATEGORY_ICONS = {
  'Smileys & Emotion': '😀',
  'Animals & Nature': '🐻',
  'Activities & Sports': '⚽',
  'Travel & Places': '🚗',
  'Objects': '💡',
  'Food & Drink': '🍔',
  'Hearts & Love': '❤️',
  'Symbols': '🔔'
};

function getRecentEmojis() {
  try { return JSON.parse(localStorage.getItem('emojiRecent') || '[]'); } catch { return []; }
}
function addRecentEmoji(e) {
  try {
    let rec = getRecentEmojis();
    rec = [e, ...rec.filter(x => x !== e)].slice(0, 24);
    localStorage.setItem('emojiRecent', JSON.stringify(rec));
  } catch {}
}

function renderEmojiGrid(category, gridEl, searchTerm) {
  gridEl.innerHTML = '';
  let list = [];
  if (searchTerm && searchTerm.trim()) {
    const term = searchTerm.trim();
    const all = Object.values(EMOJI_CATEGORIES).flat();
    list = all.filter(e => e.includes(term)).slice(0, 200);
  } else if (category === 'Recent') {
    list = getRecentEmojis();
  } else {
    list = EMOJI_CATEGORIES[category] || [];
  }
  list.forEach(e => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = e;
    btn.title = e;
    btn.style.fontSize = '28px';
    btn.style.width = '100%';
    btn.style.height = '100%';
    btn.style.display = 'flex';
    btn.style.alignItems = 'center';
    btn.style.justifyContent = 'center';
    btn.style.borderRadius = '50%';
    btn.style.background = 'transparent';
    btn.style.border = 'none';
    btn.style.cursor = 'pointer';
    btn.onmouseenter = () => btn.style.background = '#111';
    btn.onmouseleave = () => btn.style.background = 'transparent';
    btn.onclick = () => {
      // Insert emoji into the message input at the current cursor position
      try {
        const start = typeof messageInput.selectionStart === 'number' ? messageInput.selectionStart : messageInput.value.length;
        const end = typeof messageInput.selectionEnd === 'number' ? messageInput.selectionEnd : messageInput.value.length;
        const before = messageInput.value.substring(0, start);
        const after = messageInput.value.substring(end);
        messageInput.value = before + e + after;
        const caret = start + e.length;
        messageInput.setSelectionRange(caret, caret);
      } catch (err) {
        // Fallback: append to the end if selection APIs are unavailable
        messageInput.value = (messageInput.value || '') + e;
      }
      addRecentEmoji(e);
      // Focus input and trigger input event to update typing indicator
      messageInput.focus();
      const inputEvt = new Event('input', { bubbles: true });
      messageInput.dispatchEvent(inputEvt);
      // Keep the emoji picker open so the user can pick more emojis; they will send manually
    };
    gridEl.appendChild(btn);
  });
}

function buildEmojiPicker() {
  emojiPicker.innerHTML = '';
  emojiPicker.style.display = 'flex';
  emojiPicker.style.flexDirection = 'column';
  // Panel layout: Search top, title, grid middle, category bar bottom
  const searchWrap = document.createElement('div');
  searchWrap.style.cssText = 'margin:0 0 6px 0;';
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search emoji';
  searchInput.style.cssText = 'width:100%;padding:6px;border-radius:6px;border:1px solid #222;background:#111;color:#fff;';
  searchWrap.appendChild(searchInput);
  emojiPicker.appendChild(searchWrap);

  const title = document.createElement('div');
  title.style.color = '#fff';
  title.style.fontWeight = '600';
  title.style.fontSize = '14px';
  title.style.margin = '0 0 8px 2px';
  title.textContent = EMOJI_CATEGORY_TITLES[emojiActiveCategory] || emojiActiveCategory;
  emojiPicker.appendChild(title);

  const grid = document.createElement('div');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = 'repeat(4, 1fr)';
  grid.style.gridAutoRows = '56px';
  grid.style.gap = '8px';
  grid.style.padding = '4px 2px';
  grid.style.width = '100%';
  grid.style.flex = '1 1 auto';
  grid.style.overflowY = 'scroll';
  grid.style.overflowX = 'hidden';
  grid.style.paddingRight = '6px';
  grid.style.scrollbarGutter = 'stable';
  grid.style.background = '#000';
  emojiPicker.appendChild(grid);
  renderEmojiGrid(emojiActiveCategory, grid, '');

  // Search behavior
  searchInput.addEventListener('input', () => {
    renderEmojiGrid(emojiActiveCategory, grid, searchInput.value);
  });

  const bar = document.createElement('div');
  bar.style.display = 'flex';
  bar.style.alignItems = 'center';
  bar.style.justifyContent = 'space-evenly';
  bar.style.flexWrap = 'nowrap';
  bar.style.gap = '8px';
  bar.style.height = '48px';
  bar.style.borderTop = '1px solid #222';
  bar.style.marginTop = '8px';
  bar.style.background = '#111';
  bar.style.padding = '6px 8px';
  const order = ['Recent','Smileys & Emotion','Animals & Nature','Activities & Sports','Travel & Places','Objects','Food & Drink','Hearts & Love','Symbols'];
  order.forEach(cat => {
    if (!EMOJI_CATEGORIES[cat]) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = EMOJI_CATEGORY_ICONS[cat] || '❓';
    btn.title = EMOJI_CATEGORY_TITLES[cat] || cat;
    btn.style.fontSize = '20px';
    btn.style.width = '36px';
    btn.style.height = '36px';
    btn.style.lineHeight = '36px';
    btn.style.textAlign = 'center';
    btn.style.borderRadius = '8px';
    btn.style.background = (cat === emojiActiveCategory) ? '#111' : 'transparent';
    btn.style.color = '#fff';
    btn.style.border = '1px solid #222';
    btn.style.cursor = 'pointer';
    btn.onmouseenter = () => btn.style.background = '#111';
    btn.onmouseleave = () => btn.style.background = (cat === emojiActiveCategory) ? '#111' : 'transparent';
    btn.onclick = () => {
      emojiActiveCategory = cat;
      title.textContent = EMOJI_CATEGORY_TITLES[emojiActiveCategory] || emojiActiveCategory;
      renderEmojiGrid(emojiActiveCategory, grid, searchInput.value);
      // refresh bar selection state
      Array.from(bar.children).forEach(b => {
        const isActive = (b.title === (EMOJI_CATEGORY_TITLES[emojiActiveCategory] || emojiActiveCategory));
        b.style.background = isActive ? '#111' : 'transparent';
      });
    };
    bar.appendChild(btn);
  });
  emojiPicker.appendChild(bar);
}

function showEmojiPicker() {
  if (emojiPicker.style.display === 'none') {
    buildEmojiPicker();
    // Responsive sizing to prevent overflow
    const vw = Math.min(window.innerWidth, document.documentElement.clientWidth || window.innerWidth);
    const vh = Math.min(window.innerHeight, document.documentElement.clientHeight || window.innerHeight);
    const targetW = Math.min(420, vw - 32);
    const targetH = Math.min(360, vh - 120);
    emojiPicker.style.width = targetW + 'px';
    emojiPicker.style.height = targetH + 'px';
    emojiPicker.style.display = 'flex';
    positionEmojiPicker();
    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', onDocClickCloseEmoji);
    }, 0);
  }
}

function hideEmojiPicker() {
  emojiPicker.style.display = 'none';
  document.removeEventListener('click', onDocClickCloseEmoji);
}

function onDocClickCloseEmoji(e) {
  const within = emojiPicker.contains(e.target) || emojiBtn.contains(e.target);
  if (!within) hideEmojiPicker();
}

function positionEmojiPicker() {
  try {
    const rect = emojiBtn.getBoundingClientRect();
    const container = document.querySelector('.chat-section');
    const containerRect = container.getBoundingClientRect();
    const pickerRect = emojiPicker.getBoundingClientRect();

    // Default left aligned with emoji button
    let left = rect.left - containerRect.left;
    // Clamp within container
    const maxLeft = containerRect.width - pickerRect.width - 8;
    if (left > maxLeft) left = Math.max(8, maxLeft);
    if (left < 8) left = 8;
    emojiPicker.style.left = `${left}px`;

    // Place above the button
    let bottom = containerRect.bottom - rect.top + 8;
    // Clamp bottom to keep inside container
    const maxBottom = containerRect.height - 60; // keep margin from header
    if (bottom > maxBottom) bottom = maxBottom;
    if (bottom < 56) bottom = 56;
    emojiPicker.style.bottom = `${bottom}px`;
  } catch {}
}

emojiBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  const isVisible = emojiPicker.style.display === 'block' || emojiPicker.style.display === 'flex';
  if (isVisible) hideEmojiPicker();
  else showEmojiPicker();
});

// Animated transitions for modals
function showModal(modal) {
  modal.style.display = 'flex';
  modal.classList.add('fade-in');
  setTimeout(() => modal.classList.remove('fade-in'), 400);
}
function hideModal(modal) {
  modal.style.display = 'none';
}
profileBtn.onclick = () => {
  profileNickname.value = myUsername;
  profileAvatar.value = myAvatar;
  profileStatus.value = myStatus;
  showModal(profileModal);
};
profileCancel.onclick = () => {
  hideModal(profileModal);
};
profileSave.onclick = () => {
  const username = profileNickname.value.trim() || myUsername;
  const avatar = profileAvatar.value.trim() || myAvatar;
  const status = profileStatus.value.trim();
  socket.emit('update_profile', { username, avatar, status });
  hideModal(profileModal);
};

// --- Message Rendering ---
function editMessage(msgId, div, oldMsg) {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = oldMsg;
  input.style.flex = '1';
  div.querySelector('.msg-text').replaceWith(input);
  input.focus();

  // Remove previous event handlers to allow multiple edits
  input.onblur = null;
  input.onkeydown = null;

  input.onblur = input.onkeydown = (e) => {
    if (e.type === 'blur' || (e.type === 'keydown' && e.key === 'Enter')) {
      const newMsg = input.value.trim();
      if (newMsg && newMsg !== oldMsg) {
        socket.emit('edit_message', { id: msgId, text: newMsg });
        // Update messageHistory immediately to reflect change in UI
        const currentMessages = getMessageHistoryForCurrentChannel();
        const index = currentMessages.findIndex(msg => msg.id === msgId);
        if (index !== -1) {
          currentMessages[index].text = newMsg;
          setMessageHistoryForCurrentChannel(currentMessages);
          renderMessages(currentMessages);
        }
      }
      input.replaceWith(document.createTextNode(newMsg || oldMsg));
    }
  };
}

function deleteMessage(msgId) {
  if (confirm('Delete this message?')) {
    // Immediately remove message from UI for better UX
    const currentMessages = getMessageHistoryForCurrentChannel();
    const index = currentMessages.findIndex(msg => msg.id === msgId);
    if (index !== -1) {
      currentMessages.splice(index, 1);
      setMessageHistoryForCurrentChannel(currentMessages);
      renderMessages(currentMessages);
    }
    socket.emit('delete_message', { id: msgId });
  }
}

function copyText(msg) {
  // Check if the Clipboard API is available and we have permissions
  if (navigator.clipboard && window.isSecureContext) {
    // Use modern Clipboard API
    navigator.clipboard.writeText(msg).then(
      () => {
        console.log('[DEBUG] Message copied to clipboard successfully');
        showToast('Message copied to clipboard!');
      },
      (err) => {
        console.error('[ERROR] Failed to copy message:', err);
        fallbackCopyText(msg);
      }
    );
  } else {
    // Fallback for older browsers or insecure contexts
    fallbackCopyText(msg);
  }
}

// Fallback copy function using the older method
function fallbackCopyText(msg) {
  try {
    // Create a temporary textarea element
    const textArea = document.createElement('textarea');
    textArea.value = msg;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    textArea.style.top = '-9999px';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    // Try to copy using the older execCommand method
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    
    if (successful) {
      console.log('[DEBUG] Message copied to clipboard using fallback method');
      showToast('Message copied to clipboard!');
    } else {
      console.error('[ERROR] Fallback copy method failed');
      showToast('Failed to copy message. Please try selecting and copying manually.');
    }
  } catch (err) {
    console.error('[ERROR] Copy operation failed:', err);
    showToast('Copy not supported. Please select and copy the text manually.');
  }
}

// Message grouping
function renderMessages(messageList) {
  const key = getCurrentChannelKey();
  if (key && optimisticClears.has(key)) {
    messagesDiv.replaceChildren();
    return;
  }
  const list = renderFullHistory
    ? (messageList || [])
    : (messageList && messageList.length > MAX_RENDERED_MESSAGES
      ? messageList.slice(-MAX_RENDERED_MESSAGES)
      : (messageList || []));
  const frag = document.createDocumentFragment();
  let lastUser = null;
  let groupDiv = null;
  let dividerInserted = false;
  const lastRead = getLastReadForCurrentChannel();
  const lastReadMs = lastRead ? new Date(lastRead).getTime() : 0;

  list.forEach((msg) => {
    const isSameUser = lastUser && msg.username === lastUser.username && msg.avatar === lastUser.avatar;
    if (!isSameUser) {
      groupDiv = document.createElement('div');
      groupDiv.className = 'chat-message-group';
      frag.appendChild(groupDiv);
    }
    // Insert unread divider before first message newer than lastRead
    if (!dividerInserted && lastReadMs && msg.timestamp && new Date(msg.timestamp).getTime() > lastReadMs) {
      const divider = document.createElement('div');
      divider.className = 'unread-divider';
      divider.style.cssText = 'text-align:center;color:#b9bbbe;margin:8px 0;position:relative;';
      divider.innerHTML = '<span style="background:#313338;padding:2px 8px;border-radius:12px;border:1px solid #444;">New messages</span>';
      if (groupDiv) groupDiv.appendChild(divider);
      dividerInserted = true;
    }
    const messageDiv = createMessageDiv(msg.username, msg.avatar, msg.text, msg.self, msg.id, msg.timestamp, msg.status, msg.reactions, msg.replyTo, msg.threadId, msg.attachments || msg.attachment);
    if (groupDiv) groupDiv.appendChild(messageDiv);
    lastUser = msg;
  });
  messagesDiv.replaceChildren(frag);
  if (!suppressAutoScroll) {
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }
  // Reset flags after a render pass
  suppressAutoScroll = false;
  renderFullHistory = false;
}

// Store messages for grouping
// Store messages per channel for grouping
let messageHistory = {};
loadPersistedHistory();
// On initial load, render instantly from cache if available
const _initialMsgs = getMessageHistoryForCurrentChannel();
if (_initialMsgs && _initialMsgs.length) {
  renderMessages(_initialMsgs);
}

function getCurrentChannelKey() {
  return currentServer && currentChannel ? `${currentServer}:${currentChannel}` : null;
}

function getMessageHistoryForCurrentChannel() {
  const key = getCurrentChannelKey();
  if (!key) return [];
  if (!messageHistory[key]) messageHistory[key] = [];
  return messageHistory[key];
}

function setMessageHistoryForCurrentChannel(messages) {
  const key = getCurrentChannelKey();
  if (!key) return;
  messageHistory[key] = messages;
  persistHistory();
}

function getMessageHistoryFor(server, channel) {
  const key = server && channel ? `${server}:${channel}` : null;
  if (!key) return [];
  if (!messageHistory[key]) messageHistory[key] = [];
  return messageHistory[key];
}
function setMessageHistoryFor(server, channel, messages) {
  const key = server && channel ? `${server}:${channel}` : null;
  if (!key) return;
  messageHistory[key] = messages;
  persistHistory();
}
function clearMessageHistoryFor(server, channel) {
  const key = server && channel ? `${server}:${channel}` : null;
  if (!key) return;
  messageHistory[key] = [];
  persistHistory();
}

function clearMessageHistoryForCurrentChannel() {
  const key = getCurrentChannelKey();
  if (!key) return;
  messageHistory[key] = [];
  persistHistory();
}

socket.on('message', data => {
  console.log('[DEBUG] Received message:', data);
  if (!sessionReady) {
    // Buffer messages until session info is ready
    messageBuffer.push(data);
    return;
  }
  const self = data.username === myUsername && data.avatar === myAvatar;

  const targetServer = data.server || currentServer;
  const targetChannel = data.channel || currentChannel;
  const isForCurrent = (targetServer === currentServer && targetChannel === currentChannel);

  // Get or init target message list
  const targetKey = (targetServer && targetChannel) ? `${targetServer}:${targetChannel}` : getCurrentChannelKey();
  if (targetKey && !messageHistory[targetKey]) messageHistory[targetKey] = [];
  const targetMessages = targetKey ? messageHistory[targetKey] : getMessageHistoryForCurrentChannel();

  // Remove any message with the same id or tempId to prevent duplicates (within target)
  const existingIndex = targetMessages.findIndex(msg => msg.id === data.id || (self && msg.id === data.tempId));
  if (existingIndex !== -1) {
    targetMessages.splice(existingIndex, 1);
  }

  // Add message (build once, then push)
  const messageObj = {
    username: data.username,
    avatar: data.avatar,
    text: data.msg,
    self,
    id: data.id,
    timestamp: data.timestamp,
    status: data.status || '',
    reactions: data.reactions || {}
  };
  if (Array.isArray(data.attachments)) {
    messageObj.attachments = data.attachments;
  }
  if (data.attachment_url) {
    messageObj.attachment = {
      url: data.attachment_url,
      name: data.attachment_name,
      type: data.attachment_type,
      size: data.attachment_size
    };
  }
  // Add reply/thread data if present
  if (data.reply_to_id && data.reply_to_text && data.reply_to_username && data.reply_to_avatar) {
    messageObj.replyTo = {
      id: data.reply_to_id,
      text: data.reply_to_text,
      username: data.reply_to_username,
      avatar: data.reply_to_avatar
    };
  }
  if (data.thread_id) {
    messageObj.threadId = data.thread_id;
  }
  // Desktop notify on mention/reply
  if (!self) maybeNotify(data);

  // Update last read if new message is for current channel and near bottom or own message
  if (isForCurrent) {
    const nearBottom = (messagesDiv.scrollHeight - messagesDiv.scrollTop - messagesDiv.clientHeight) < 60;
    if (nearBottom || messageObj.self) {
      if (messageObj.timestamp) setLastReadForCurrentChannel(messageObj.timestamp);
    }
  }

  targetMessages.push(messageObj);
  if (targetKey) {
    messageHistory[targetKey] = targetMessages;
    persistHistory();
  }

  if (isForCurrent) {
    renderMessages(targetMessages);
  }
});

socket.on('message_update', data => {
  // Update or remove the specific message in messageHistory and re-render messages
  const currentMessages = getMessageHistoryForCurrentChannel();
  const index = currentMessages.findIndex(msg => msg.id === data.id);
  if (index !== -1) {
    if (data.msg === undefined || data.msg === null) {
      // Message deleted, remove from messageHistory
      currentMessages.splice(index, 1);
    } else {
      // Update message properties
      currentMessages[index].text = data.msg || currentMessages[index].text;
      currentMessages[index].timestamp = data.timestamp || currentMessages[index].timestamp;
      currentMessages[index].username = data.username || currentMessages[index].username;
      currentMessages[index].avatar = data.avatar || currentMessages[index].avatar;
      currentMessages[index].reactions = data.reactions || currentMessages[index].reactions || {};
    }
    setMessageHistoryForCurrentChannel(currentMessages);
    renderMessages(currentMessages);
  }
});

socket.on('reactions_update', data => {
  console.log('Reactions update received:', data);
  messageReactions[data.message_id] = data.reactions;
  
  // Update the message in messageHistory with the new reactions
  const currentMessages = getMessageHistoryForCurrentChannel();
  const messageIndex = currentMessages.findIndex(msg => String(msg.id) === String(data.message_id));
  if (messageIndex !== -1) {
    currentMessages[messageIndex].reactions = data.reactions;
    setMessageHistoryForCurrentChannel(currentMessages);
    // Re-render messages to update reactions
    renderMessages(currentMessages);
  } else {
    console.log('Message not found in current channel for reaction update:', data.message_id);
  }
});

// Default emoji options for reactions
const DEFAULT_REACTIONS = ['👍', '😂', '😊', '🔥', '😮', '😢', '🎉', '❤️'];

// Track reactions for each message

function createReactionsBar(msgId, reactions) {
  const bar = document.createElement('div');
  bar.className = 'reactions-bar';
  
  // Always show the bar, even if empty
  const reactionEntries = Object.entries(reactions || {});
  
  // Render each reaction with count and tooltip of users
  reactionEntries.forEach(([emoji, users]) => {
    const btn = document.createElement('button');
    btn.className = 'reaction-btn';
    btn.textContent = `${emoji} ${users.length}`;
    // Tooltip: show usernames/avatars
    btn.title = users.map(u => `${u.avatar} ${u.username}`).join(', ');
    // Highlight if I have reacted
    if (hasReacted(users)) {
      btn.classList.add('selected');
    }
    btn.onclick = () => {
      if (hasReacted(users)) {
        socket.emit('remove_reaction', { message_id: msgId, emoji });
        // Immediately remove from UI
        const currentMessages = getMessageHistoryForCurrentChannel();
        const messageIndex = currentMessages.findIndex(msg => String(msg.id) === String(msgId));
        if (messageIndex !== -1 && currentMessages[messageIndex].reactions && currentMessages[messageIndex].reactions[emoji]) {
          currentMessages[messageIndex].reactions[emoji] = currentMessages[messageIndex].reactions[emoji].filter(
            u => !(u.username === myUsername && u.avatar === myAvatar)
          );
          // Remove emoji if no users left
          if (currentMessages[messageIndex].reactions[emoji].length === 0) {
            delete currentMessages[messageIndex].reactions[emoji];
          }
          setMessageHistoryForCurrentChannel(currentMessages);
          renderMessages(currentMessages);
        }
      } else {
        socket.emit('add_reaction', { message_id: msgId, emoji });
        // Immediately add to UI
        const currentMessages = getMessageHistoryForCurrentChannel();
        const messageIndex = currentMessages.findIndex(msg => String(msg.id) === String(msgId));
        if (messageIndex !== -1) {
          if (!currentMessages[messageIndex].reactions) {
            currentMessages[messageIndex].reactions = {};
          }
          if (!currentMessages[messageIndex].reactions[emoji]) {
            currentMessages[messageIndex].reactions[emoji] = [];
          }
          const userReaction = {
            username: myUsername,
            avatar: myAvatar
          };
          currentMessages[messageIndex].reactions[emoji].push(userReaction);
          setMessageHistoryForCurrentChannel(currentMessages);
          renderMessages(currentMessages);
        }
      }
    };
    bar.appendChild(btn);
  });

  return bar;
}

function hasReacted(users) {
  return users && users.some(u => u.username === myUsername && u.avatar === myAvatar);
}

function showReactionPicker(msgId, actionsElement) {
  // Remove any existing reaction picker
  const existingPicker = document.querySelector('.reaction-picker');
  if (existingPicker) {
    existingPicker.remove();
  }

  // Create reaction picker
  const picker = document.createElement('div');
  picker.className = 'reaction-picker';

  // Add default reaction buttons
  DEFAULT_REACTIONS.forEach(emoji => {
    const btn = document.createElement('button');
    btn.textContent = emoji;
    btn.onclick = () => {
      socket.emit('add_reaction', { message_id: msgId, emoji });
      picker.remove();
      
      // Immediately update the UI to show the reaction
      const currentMessages = getMessageHistoryForCurrentChannel();
      const messageIndex = currentMessages.findIndex(msg => String(msg.id) === String(msgId));
      if (messageIndex !== -1) {
        // Initialize reactions if not exists
        if (!currentMessages[messageIndex].reactions) {
          currentMessages[messageIndex].reactions = {};
        }
        if (!currentMessages[messageIndex].reactions[emoji]) {
          currentMessages[messageIndex].reactions[emoji] = [];
        }
        // Add current user to the reaction
        const userReaction = {
          username: myUsername,
          avatar: myAvatar
        };
        currentMessages[messageIndex].reactions[emoji].push(userReaction);
        setMessageHistoryForCurrentChannel(currentMessages);
        renderMessages(currentMessages);
      }
    };
    picker.appendChild(btn);
  });

  // Position the picker near the reaction button
  const reactBtn = actionsElement.querySelector('.msg-react');
  const rect = reactBtn.getBoundingClientRect();
  picker.style.top = `${rect.bottom + 5}px`;
  picker.style.left = `${rect.left}px`;

  // Add to body
  document.body.appendChild(picker);

  // Close picker when clicking outside
  const closePicker = (e) => {
    if (!picker.contains(e.target) && !reactBtn.contains(e.target)) {
      picker.remove();
      document.removeEventListener('click', closePicker);
    }
  };
  
  // Delay adding the event listener to avoid immediate closure
  setTimeout(() => {
    document.addEventListener('click', closePicker);
  }, 100);
}

// Update createMessageDiv to render reactions bar
function createMessageDiv(username, avatar, msg, self = false, msgId = null, timestamp = null, status = '', reactions = [], replyTo = null, threadId = null, attachment = null) {
  const div = document.createElement('div');
  div.style.display = 'flex';
  div.style.alignItems = 'center';
  div.style.gap = '0.5rem';
  div.className = 'chat-message';
  if (msgId !== null && msgId !== undefined) {
    div.setAttribute('data-msg-id', String(msgId));
  }

  // If this is a reply, show a compact inline indicator above the message
  if (replyTo) {
    const inline = document.createElement('div');
    inline.className = 'reply-inline';
    inline.style.cssText = `
      margin-bottom: 0.35em;
      font-size: 0.9em;
      color: #b9bbbe;
    `;

    // Build: ↳ Replying to <b><i>username</i></b>: "message"
    const arrow = document.createElement('span');
    arrow.style.fontStyle = 'italic';
    arrow.textContent = '↳ Replying to ';

    const nameBold = document.createElement('b');
    const nameIt = document.createElement('i');
    nameIt.textContent = replyTo.username;
    nameBold.appendChild(nameIt);

    const colonSpace = document.createTextNode(': ');
    const quoteOpen = document.createTextNode('"');

    const messageSpan = document.createElement('span');
    const previewText = replyTo.text.length > 80 ? replyTo.text.substring(0, 80) + '...' : replyTo.text;
    messageSpan.textContent = previewText;

    const quoteClose = document.createTextNode('"');

    inline.appendChild(arrow);
    inline.appendChild(nameBold);
    inline.appendChild(colonSpace);
    inline.appendChild(quoteOpen);
    inline.appendChild(messageSpan);
    inline.appendChild(quoteClose);

    inline.style.cursor = 'pointer';
    inline.title = 'Jump to message';
    inline.addEventListener('click', (e) => {
      e.stopPropagation();
      if (replyTo && replyTo.id != null) {
        jumpToMessage(replyTo.id);
      }
    });
    div.appendChild(inline);
  }
  
  // Create the main message content container
  const messageContent = document.createElement('div');
  messageContent.style.cssText = `
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
  `;

  // Status dot
  const { online, last_seen } = getUserStatus(username, avatar);
  const statusDot = document.createElement('span');
  statusDot.style.display = 'inline-block';
  statusDot.style.width = '10px';
  statusDot.style.height = '10px';
  statusDot.style.borderRadius = '50%';
  statusDot.style.marginRight = '0.2em';
  statusDot.style.background = online ? '#43b581' : '#747f8d';
  statusDot.title = online ? 'Online' : (last_seen ? 'Last seen: ' + formatTimestamp(last_seen) : 'Offline');
  div.appendChild(statusDot);
  // Highlight mentions
  const highlightedMsg = highlightMentions(msg);
  div.innerHTML += `<span class="avatar" title="${status}">${avatar}</span> <b${self ? ' style="color:#8be9fd"' : ''} title="${status}">${username}</b>: <span class="msg-text">${highlightedMsg}</span>`;
  if (timestamp) {
    const timeSpan = document.createElement('span');
    timeSpan.style.fontSize = '0.8em';
    timeSpan.style.color = '#aaa';
    timeSpan.style.marginLeft = '0.5em';
    timeSpan.textContent = formatTimestamp(timestamp);
    timeSpan.style.display = 'none';
    div.addEventListener('mouseenter', () => { timeSpan.style.display = 'inline'; });
    div.addEventListener('mouseleave', () => { timeSpan.style.display = 'none'; });
    div.appendChild(timeSpan);
  }
  // Attachment rendering (single or multiple)
  let attachmentsArr = [];
  if (Array.isArray(attachment)) attachmentsArr = attachment;
  else if (attachment && attachment.url) attachmentsArr = [attachment];
  attachmentsArr.forEach(att => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:block; margin-left: 2em; margin-top: 0.25em;';
    if (att.type === 'image') {
      const a = document.createElement('a'); a.href = att.url; a.target = '_blank';
      const img = document.createElement('img'); img.src = att.url; img.alt = att.name || '';
      img.style.cssText = 'max-width: 360px; max-height: 260px; border-radius: 6px; border: 1px solid #23272a; display:block; cursor:zoom-in;';
      a.appendChild(img); wrap.appendChild(a);
      a.addEventListener('click', (ev) => { ev.preventDefault(); openLightbox(att.url, att.name); });
      const meta = document.createElement('div'); meta.style.cssText = 'color:#b9bbbe; font-size: 0.85em; margin-top: 0.25em;';
      meta.textContent = `${att.name || 'image'}${att.size ? ' · ' + formatBytes(att.size) : ''}`;
      wrap.appendChild(meta);
    } else {
      const link = document.createElement('a'); link.href = att.url; link.target = '_blank'; link.style.cssText = 'color:#8be9fd;';
      link.textContent = att.name || 'file';
      const size = document.createElement('span'); size.style.cssText = 'color:#b9bbbe; margin-left: 6px;';
      size.textContent = att.size ? `(${formatBytes(att.size)})` : '';
      wrap.appendChild(document.createTextNode('📎 ')); wrap.appendChild(link); wrap.appendChild(size);
    }
    div.appendChild(wrap);
  });
  // Pin/unpin button
  if (msgId) {
    // Disable pin button for temporary message IDs starting with "temp-"
    if (typeof msgId === 'string' && msgId.startsWith('temp-')) {
      // Do not show pin button for temporary messages
    } else {
      const isPinned = pinnedMessages.some(m => m.id === msgId);
      const pinBtn = document.createElement('button');
      pinBtn.className = 'pin-btn' + (isPinned ? ' pinned' : '');
      pinBtn.title = isPinned ? 'Unpin message' : 'Pin message';
      pinBtn.innerHTML = '📌';
      pinBtn.onclick = () => {
        if (isPinned) {
          socket.emit('unpin_message', { message_id: msgId });
        } else {
          socket.emit('pin_message', { message_id: msgId });
        }
      };
      div.appendChild(pinBtn);
    }
  }
  // Toast notification if this message mentions me (and not my own message)
  if (!self && myUsername && msg.toLowerCase().includes('@' + myUsername.toLowerCase())) {
    showToast(`You were mentioned by ${username}`);
  }
  if (msgId) {
    const actions = document.createElement('span');
    actions.className = 'msg-actions';
    actions.style.marginLeft = '0.5em';
    if (self) {
      actions.innerHTML = `
        <button class='msg-btn msg-edit' title='Edit'>✏️</button>
        <button class='msg-btn msg-delete' title='Delete'>🗑️</button>
        <button class='msg-btn msg-copy' title='Copy'>📋</button>
        <button class='msg-btn msg-react' title='React'>😊</button>
        <button class='msg-btn msg-reply' title='Reply'>↩️</button>
      `;
      actions.querySelector('.msg-edit').onclick = () => editMessage(msgId, div, msg);
      actions.querySelector('.msg-delete').onclick = () => deleteMessage(msgId);
      actions.querySelector('.msg-copy').onclick = () => copyText(msg);
      actions.querySelector('.msg-react').onclick = () => showReactionPicker(msgId, actions);
      actions.querySelector('.msg-reply').onclick = () => startReply(msgId, username, avatar, msg);
    } else {
      actions.innerHTML = `
        <button class='msg-btn msg-copy' title='Copy'>📋</button>
        <button class='msg-btn msg-react' title='React'>😊</button>
        <button class='msg-btn msg-reply' title='Reply'>↩️</button>
      `;
      actions.querySelector('.msg-copy').onclick = () => copyText(msg);
      actions.querySelector('.msg-react').onclick = () => showReactionPicker(msgId, actions);
      actions.querySelector('.msg-reply').onclick = () => startReply(msgId, username, avatar, msg);
    }
    div.appendChild(actions);
  }
  // Reactions bar
  if (msgId) {
    const messageReactionsData = messageReactions[msgId] || reactions || {};
    const reactionsBar = createReactionsBar(msgId, messageReactionsData);
    div.appendChild(reactionsBar);
  }
  return div;
}

// Show user avatars in sidebar for each server (if available)
function renderServers(servers) {
  serverSidebar.querySelectorAll('.server:not(.add-server)').forEach(e => e.remove());

  // Remove existing context menu if any
  const existingMenu = document.getElementById('server-context-menu');
  if (existingMenu) {
    existingMenu.remove();
  }

  servers.forEach(server => {
    const div = document.createElement('div');
    div.className = 'server' + (server === currentServer ? ' selected' : '');
    div.setAttribute('data-server-name', server);  // Add this attribute for deletion selector

    // Use the first letter of the server name in uppercase as the avatar
    const avatar = server.charAt(0).toUpperCase();

    // Only show the avatar (first letter) inside the circle icon
    div.innerHTML = `<span class='avatar'>${avatar}</span>`;

    div.title = server;

    div.onclick = () => {
      if (currentServer !== server) {
        currentServer = server;
        localStorage.setItem('currentServer', currentServer);

        // Try to restore last channel for this server immediately
        const remembered = getLastChannelForServer(server);
        if (remembered) {
          currentChannel = remembered;
          localStorage.setItem('currentChannel', currentChannel);
        } else {
          currentChannel = null;
          localStorage.removeItem('currentChannel');
        }

        socket.emit('join_server', { server });
        renderServers(servers);

        if (currentChannel) {
          chatHeader.textContent = `${currentServer} / #${currentChannel}`;
          chatForm.style.display = '';
          // Instantly render cached messages for this server/channel
          const existing = getMessageHistoryForCurrentChannel();
          renderMessages(existing);
          // Also proactively join channel to start receiving realtime + history
          socket.emit('join_channel', { server, channel: currentChannel });
        } else {
          chatHeader.textContent = 'Select a channel';
          chatForm.style.display = 'none';
          channelList.innerHTML = '';
          userListDiv.innerHTML = '';
        }

        // Clear typing indicators when switching servers
        typingUsers.clear();
        updateTypingIndicator();
      }
    };

    // Add context menu event for right click
    div.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // Remove any existing context menu
      const oldMenu = document.getElementById('server-context-menu');
      if (oldMenu) oldMenu.remove();

      // Create context menu div
      const menu = document.createElement('div');
      menu.id = 'server-context-menu';
      menu.style.position = 'fixed';
      menu.style.top = `${e.clientY}px`;
      menu.style.left = `${e.clientX}px`;
      menu.style.background = '#2f3136';
      menu.style.border = '1px solid #23272a';
      menu.style.borderRadius = '6px';
      menu.style.padding = '0.5rem 0';
      menu.style.zIndex = '1000';
      menu.style.minWidth = '120px';
      menu.style.color = '#fff';
      menu.style.fontSize = '0.9rem';
      menu.style.boxShadow = '0 2px 10px rgba(0,0,0,0.5)';

      // Add Unlock Admin option
      const unlockOption = document.createElement('div');
      unlockOption.textContent = 'Unlock Admin';
      unlockOption.style.padding = '0.5rem 1rem';
      unlockOption.style.cursor = 'pointer';
      unlockOption.onmouseenter = () => unlockOption.style.background = '#5865f2';
      unlockOption.onmouseleave = () => unlockOption.style.background = 'transparent';
      unlockOption.onclick = () => {
        // Clear any pending action to avoid unintended retries
        pendingOwnerAction = null;
        pendingOwnerServer = null;
        const pwd = prompt(`Enter password for "${server}" to unlock admin access:`);
        if (pwd && pwd.trim()) {
          socket.emit('authenticate_owner', { server, password: pwd.trim() });
        }
        menu.remove();
      };
      menu.appendChild(unlockOption);

      // Add Delete option
      const deleteOption = document.createElement('div');
      deleteOption.textContent = 'Delete Server';
      deleteOption.style.padding = '0.5rem 1rem';
      deleteOption.style.cursor = 'pointer';
      deleteOption.onmouseenter = () => deleteOption.style.background = '#5865f2';
      deleteOption.onmouseleave = () => deleteOption.style.background = 'transparent';
      deleteOption.onclick = () => {
        if (confirm(`Are you sure you want to delete the server "${server}"?`)) {
          // Track intent for potential retry after password auth
          lastDeletionServer = server;
          // Request server deletion; do not change UI until server confirms via 'server_deleted'
          socket.emit('delete_server', { server });
          // The UI will stay unchanged for non-owners and a permission toast will show.
          // Owners will see removal upon receiving 'server_deleted'.
          menu.remove();
        }
      };
      menu.appendChild(deleteOption);

      // Append menu to body
      document.body.appendChild(menu);

      // Remove menu on click elsewhere
      const removeMenu = (event) => {
        if (!menu.contains(event.target)) {
          menu.remove();
          document.removeEventListener('click', removeMenu);
        }
      };
      document.addEventListener('click', removeMenu);
    });

    serverSidebar.insertBefore(div, addServerBtn);
  });
}

function formatTimestamp(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleString();
}

function formatBytes(bytes) {
  try {
    const sizes = ['B','KB','MB','GB','TB'];
    if (bytes === 0) return '0 B';
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1);
    const val = bytes / Math.pow(1024, i);
    return `${val.toFixed(val >= 100 ? 0 : val >= 10 ? 1 : 2)} ${sizes[i]}`;
  } catch { return bytes + ' B'; }
}

function escapeHTML(str) {
  return String(str).replace(/[&<>'"]/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '\'': '&#39;',
    '"': '&quot;'
  }[ch]));
}

function renderMarkdown(text) {
  try {
    let s = escapeHTML(String(text || ''));
    // Code blocks ```...```
    s = s.replace(/```([\s\S]*?)```/g, (m, p1) => `<pre><code>${p1}</code></pre>`);
    // Inline code `code`
    s = s.replace(/`([^`]+)`/g, (m, p1) => `<code>${p1}</code>`);
    // Bold **text**
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italic *text*
    s = s.replace(/(^|\W)\*([^*]+)\*/g, '$1<em>$2</em>');
    // Linkify http(s) URLs
    s = s.replace(/(https?:\/\/[^\s<]+)/g, (m) => `<a href="${m}" target="_blank" rel="noopener noreferrer">${m}</a>`);
    // Mentions
    s = s.replace(/@([A-Za-z0-9_]+)/g, '<span class="mention">@$1</span>');
    return s;
  } catch { return escapeHTML(text); }
}

function maybeNotify(data) {
  try {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      Notification.requestPermission().catch(()=>{});
    }
    if (Notification.permission !== 'granted') return;
    const lower = String(data.msg || '').toLowerCase();
    const mentioned = myUsername && lower.includes('@' + String(myUsername).toLowerCase());
    const replied = data.reply_to_username && data.reply_to_username === myUsername;
    if (!mentioned && !replied) return;
    const title = `${currentServer || ''} / #${currentChannel || ''}`.trim();
    const body = `${data.username}: ${data.msg || ''}`;
    new Notification(title || 'New message', { body });
  } catch {}
}

function showToast(message) {
  // Create toast element if it doesn't exist
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  
  toast.textContent = message;
  toast.classList.add('show');
  
  // Hide after 3 seconds
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// Infinite scroll: load older messages when scrolled to top
messagesDiv.addEventListener('scroll', () => {
  try {
    if (messagesDiv.scrollTop <= 40 && !isLoadingHistory && !noMoreHistory) {
      const currentMessages = getMessageHistoryForCurrentChannel();
      if (!currentMessages || currentMessages.length === 0) return;
      const oldestId = currentMessages[0]?.id;
      if (!oldestId) return;
      isLoadingHistory = true;
      const prevHeight = messagesDiv.scrollHeight;
      socket.emit('load_history', { before_id: oldestId, limit: 50 });
      // Response handled in 'history'
    }
    // Toggle jump-to-present button & update last read if near bottom
    const nearBottom = (messagesDiv.scrollHeight - messagesDiv.scrollTop - messagesDiv.clientHeight) < 60;
    if (jumpBtn) jumpBtn.style.display = nearBottom ? 'none' : 'block';
    if (nearBottom) {
      const current = getMessageHistoryForCurrentChannel();
      if (current && current.length) {
        const last = current[current.length - 1];
        if (last && last.timestamp) setLastReadForCurrentChannel(last.timestamp);
      }
    }
  } catch {}
});

socket.on('history', (data) => {
  try {
    const items = Array.isArray(data?.items) ? data.items : [];
    const targetServer = data?.server || currentServer;
    const targetChannel = data?.channel || currentChannel;
    const isCurrent = (targetServer === currentServer && targetChannel === currentChannel);
    if (items.length === 0) {
      if (isCurrent) {
        noMoreHistory = true;
      }
      isLoadingHistory = false;
      return;
    }
    // Merge without duplicates and prepend
    const current = getMessageHistoryFor(targetServer, targetChannel);
    const existing = new Set((current || []).map(m => String(m.id)));
    const toPrepend = [];
    items.forEach(it => {
      const idStr = String(it.id);
      if (existing.has(idStr)) return;
      const msg = {
        username: it.username,
        avatar: it.avatar,
        text: it.msg,
        self: (it.username === myUsername && it.avatar === myAvatar),
        id: it.id,
        timestamp: it.timestamp,
        status: '',
        reactions: {}
      };
      if (it.reply_to_id && it.reply_to_text && it.reply_to_username && it.reply_to_avatar) {
        msg.replyTo = {
          id: it.reply_to_id,
          text: it.reply_to_text,
          username: it.reply_to_username,
          avatar: it.reply_to_avatar
        };
      }
      if (it.attachment_url) {
        msg.attachment = {
          url: it.attachment_url,
          name: it.attachment_name,
          type: it.attachment_type,
          size: it.attachment_size
        };
      }
      toPrepend.push(msg);
    });
    if (toPrepend.length === 0) {
      isLoadingHistory = false;
      return;
    }
    const updated = [...toPrepend, ...(current || [])];
    setMessageHistoryFor(targetServer, targetChannel, updated);
    if (!isCurrent) {
      isLoadingHistory = false;
      return;
    }
    const prevHeight = messagesDiv.scrollHeight;
    suppressAutoScroll = true;
    renderFullHistory = true;
    renderMessages(updated);
    // Maintain scroll position after prepending
    const newHeight = messagesDiv.scrollHeight;
    messagesDiv.scrollTop = newHeight - prevHeight;

    // If we were trying to jump to a message, attempt now
    if (pendingJumpTarget != null) {
      const el = messagesDiv.querySelector(`.chat-message[data-msg-id="${pendingJumpTarget}"]`);
      if (el) {
        jumpToMessage(pendingJumpTarget);
        pendingJumpTarget = null;
      } else {
        // Not found yet; if items came in, try another page automatically
        const oldestNow = updated[0]?.id;
        if (oldestNow && !noMoreHistory) {
          socket.emit('load_history', { before_id: oldestNow, limit: 100 });
        } else {
          pendingJumpTarget = null;
        }
      }
    }
  } catch (e) {
    console.error('history handling error', e);
  } finally {
    isLoadingHistory = false;
  }
});

function jumpToMessage(id) {
  try {
    const el = messagesDiv.querySelector(`.chat-message[data-msg-id="${id}"]`);
    if (el) {
      el.scrollIntoView({ block: 'center' });
      const orig = el.style.background;
      el.style.transition = 'background 0.6s ease';
      el.style.background = 'rgba(88,101,242,0.25)';
      setTimeout(() => {
        el.style.background = orig || 'transparent';
      }, 800);
    } else {
      // Not in DOM; try loading more history
      const current = getMessageHistoryForCurrentChannel();
      const oldestId = current && current[0] && current[0].id;
      if (oldestId && !isLoadingHistory && !noMoreHistory) {
        pendingJumpTarget = id;
        isLoadingHistory = true;
        socket.emit('load_history', { before_id: oldestId, limit: 100 });
      }
    }
  } catch {}
}

socket.on('pinned_messages', data => {
  // Only update if in the current channel
  if (data.server === currentServer && data.channel === currentChannel) {
    pinnedMessages = data.messages;
    renderPinnedBar();
  }
});

function renderPinnedBar() {
  pinnedBar.innerHTML = '';
  if (!pinnedMessages.length) return;
  const header = document.createElement('div');
  header.style.fontWeight = 'bold';
  header.style.marginBottom = '0.5em';
  header.style.color = '#fff';
  header.textContent = 'Pinned Messages';
  pinnedBar.appendChild(header);
  pinnedMessages.forEach(msg => {
    const div = document.createElement('div');
    div.className = 'pinned-msg';
    div.innerHTML = `<span class='avatar'>${msg.avatar}</span> <b>${msg.username}</b>: <span>${escapeHTML(msg.text)}</span>`;
    if (msg.timestamp) {
      const timeSpan = document.createElement('span');
      timeSpan.style.fontSize = '0.8em';
      timeSpan.style.color = '#aaa';
      timeSpan.style.marginLeft = '0.5em';
      timeSpan.textContent = formatTimestamp(msg.timestamp);
      div.appendChild(timeSpan);
    }
    const unpinBtn = document.createElement('button');
    unpinBtn.className = 'pin-btn pinned';
    unpinBtn.title = 'Unpin message';
    unpinBtn.innerHTML = '📌';
    unpinBtn.onclick = () => socket.emit('unpin_message', { message_id: msg.id });
    div.appendChild(unpinBtn);
    pinnedBar.appendChild(div);
  });
}
