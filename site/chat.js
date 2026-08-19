// Set this to the deployed Worker URL after `wrangler deploy` (see README.md).
const CHAT_ENDPOINT = 'http://127.0.0.1:8787/chat';

const chatBody = document.getElementById('chatBody');
const chatInput = document.getElementById('chatInput');
const chatSend = document.getElementById('chatSend');
const statusText = document.getElementById('statusText');
const debugToggle = document.getElementById('debugToggle');
const debugStats = document.getElementById('debugStats');
const debugMessages = document.getElementById('debugMessages');
const debugTokens = document.getElementById('debugTokens');

let apiMessages = [];
let sessionTokensIn = 0;
let sessionTokensOut = 0;
let sessionTurns = 0;
let sending = false;

function addBubble(text, kind) {
    const div = document.createElement('div');
    div.className = `msg msg--${kind}`;
    div.textContent = text;
    chatBody.appendChild(div);
    chatBody.scrollTop = chatBody.scrollHeight;
    return div;
}

function showTyping() {
    const div = document.createElement('div');
    div.className = 'typing';
    div.innerHTML = '<span></span><span></span><span></span>';
    chatBody.appendChild(div);
    chatBody.scrollTop = chatBody.scrollHeight;
    return div;
}

function updateDebugPanel() {
    debugMessages.textContent = `turns: ${sessionTurns}`;
    debugTokens.textContent = `tokens: ${sessionTokensIn} in / ${sessionTokensOut} out`;
}

async function sendMessage() {
    const text = chatInput.value.trim();
    if (!text || sending) return;

    sending = true;
    chatSend.disabled = true;
    chatInput.value = '';
    addBubble(text, 'user');
    apiMessages.push({ role: 'user', content: text });

    const typing = showTyping();
    statusText.textContent = 'Waiting for reply…';

    try {
        const res = await fetch(CHAT_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: apiMessages }),
        });

        typing.remove();

        if (res.status === 429) {
            const body = await res.json().catch(() => ({}));
            addBubble(body.message || "Too many messages right now — please wait a moment and try again.", 'error');
            statusText.textContent = 'Rate limited';
            return;
        }
        if (!res.ok) {
            addBubble(`Something went wrong (HTTP ${res.status}). Try again.`, 'error');
            statusText.textContent = 'Error';
            return;
        }

        const data = await res.json();

        if (data.capped || data.tokenCapped) {
            addBubble(data.reply, 'bot');
            statusText.textContent = data.tokenCapped ? 'Daily token cap reached' : 'Conversation length limit reached';
            return;
        }

        apiMessages = data.messages;
        addBubble(data.reply, 'bot');

        sessionTurns += 1;
        if (data.usage) {
            sessionTokensIn += data.usage.input_tokens || 0;
            sessionTokensOut += data.usage.output_tokens || 0;
        }
        updateDebugPanel();
        statusText.textContent = 'Ready';
    } catch (err) {
        typing.remove();
        addBubble('Network error — is the Worker running/deployed and CHAT_ENDPOINT set correctly?', 'error');
        statusText.textContent = 'Network error';
    } finally {
        sending = false;
        chatSend.disabled = false;
        chatInput.focus();
    }
}

chatSend.addEventListener('click', sendMessage);
chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
});

debugToggle.addEventListener('click', () => {
    const visible = debugStats.classList.toggle('is-visible');
    debugToggle.textContent = visible ? 'Hide usage debug' : 'Show usage debug';
});

addBubble("👋 Hi! I'm the AI assistant for Shaka Plumbing. How can I help — quote, booking, or a question?", 'bot');
