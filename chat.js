document.addEventListener('DOMContentLoaded', () => {
const chatWindow = document.getElementById('chat-window');
const promptInput = document.getElementById('prompt-input');
const sendBtn = document.getElementById('send-btn');
const uploadBtn = document.getElementById('upload-btn');
const imageUpload = document.getElementById('image-upload');
const modelSelect = document.getElementById('model-select');
const statusText = document.getElementById('status-text');

let currentBase64Image = null;
let isCoolingDown = false;
let lastPrompt = null; // Store for auto-retry

// Sanitization function to prevent XSS
function sanitizeInput(input) {
const div = document.createElement('div');
div.textContent = input;
return div.innerHTML;
}

// Toggle Upload Button Visibility based on Model
modelSelect.addEventListener('change', () => {
const selectedModel = modelSelect.value;
if (selectedModel === 'gemini') {
uploadBtn.style.display = 'block';
promptInput.placeholder = 'Type message or upload an image...';
} else if (selectedModel === 'flux') {
uploadBtn.style.display = 'none';
promptInput.placeholder = 'Describe the image you want to generate...';
} else {
uploadBtn.style.display = 'none';
promptInput.placeholder = 'Type your message here...';
}
currentBase64Image = null; // Reset
statusText.textContent = '';
});

// Handle Image Selection with validation
uploadBtn.addEventListener('click', () => imageUpload.click());
imageUpload.addEventListener('change', (e) => {
const file = e.target.files[0];
if (file) {
// Validate image size (4MB limit)
if (file.size > 4 * 1024 * 1024) {
statusText.textContent = 'Error: Image must be under 4MB';
statusText.style.color = '#ff6b6b';
imageUpload.value = ''; // Reset
return;
}
// Validate image type
if (!file.type.startsWith('image/')) {
statusText.textContent = 'Error: File must be an image';
statusText.style.color = '#ff6b6b';
imageUpload.value = '';
return;
}

const reader = new FileReader();
reader.onload = function(evt) {
currentBase64Image = evt.target.result.split(',')[1];
statusText.textContent = `Image attached: ${file.name}`;
statusText.style.color = '#4CAF50';
};
reader.readAsDataURL(file);
}
});

// Handle Send with validation and cooldown
sendBtn.addEventListener('click', handleSend);
promptInput.addEventListener('keypress', (e) => {
if (e.key === 'Enter') handleSend();
});

async function handleSend() {
if (isCoolingDown) {
statusText.textContent = 'Please wait 3 seconds...';
statusText.style.color = '#ff6b6b';
return;
}

const prompt = promptInput.value.trim();
const model = modelSelect.value;

if (!prompt && !currentBase64Image) {
statusText.textContent = 'Please enter a message';
statusText.style.color = '#ff6b6b';
return;
}

// Validate prompt length
if (prompt.length > 2000) {
statusText.textContent = 'Error: Message too long (max 2000 chars)';
statusText.style.color = '#ff6b6b';
return;
}

// Sanitize prompt
const sanitizedPrompt = sanitizeInput(prompt);

// Display user message
appendUserMessage(sanitizedPrompt, currentBase64Image);
clearInputs();

// Show processing message
const loadingMessage = appendBotMessage('Processing...');

try {
const response = await fetch('/api/ai-proxy', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({
model: model,
prompt: sanitizedPrompt,
base64Image: currentBase64Image
})
});

if (!response.ok) {
throw new Error(`Server Error: ${response.status}`);
}

const data = await response.json();
chatWindow.removeChild(loadingMessage.parentElement);

if (data.error) {
// Map to friendly error messages
let friendlyMsg = data.error;
if (data.error.includes('quota') || data.error.includes('limit')) {
friendlyMsg = 'API limit reached. Try again in a minute.';
} else if (data.error.includes('token') || data.error.includes('key')) {
friendlyMsg = 'Service temporarily unavailable. Please try later.';
} else if (data.error.includes('loading')) {
friendlyMsg = 'Model is waking up... wait 20s and retry.';
// Auto-retry for Flux cold start
lastPrompt = { model: model, prompt: sanitizedPrompt, base64Image: currentBase64Image };
setTimeout(() => {
appendBotMessage('Retrying...', true);
autoRetry();
}, 20000);
}
appendBotMessage(`Error: ${friendlyMsg}`, true);
} else if (data.base64Image) {
appendImageResult(data.base64Image);
} else {
appendBotMessage(data.response || 'No response received.');
}
} catch (error) {
chatWindow.removeChild(loadingMessage.parentElement);
appendBotMessage(`Connection Failed: ${error.message}`, true);
} finally {
// Apply cooldown
isCoolingDown = true;
setTimeout(() => { 
isCoolingDown = false; 
statusText.textContent = '';
statusText.style.color = '#888';
}, 3000);
}
}

// Auto-retry function for Flux cold start
async function autoRetry() {
if (!lastPrompt) return;
const loadingMessage = appendBotMessage('Processing (retry)...');
try {
const response = await fetch('/api/ai-proxy', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify(lastPrompt)
});
const data = await response.json();
chatWindow.removeChild(loadingMessage.parentElement);
if (data.base64Image) {
appendImageResult(data.base64Image);
} else {
appendBotMessage('Still loading. Please try manually in 30 seconds.', true);
}
} catch (error) {
chatWindow.removeChild(loadingMessage.parentElement);
appendBotMessage('Retry failed. Please try again later.', true);
}
lastPrompt = null;
}

function appendUserMessage(text, base64Image = null) {
const msgDiv = document.createElement('div');
msgDiv.className = 'user-message';

if (base64Image) {
const container = document.createElement('div');
container.className = 'user-message-image-container';
const img = document.createElement('img');
img.src = `data:image/jpeg;base64,${base64Image}`;
img.className = 'user-uploaded-image';
img.alt = 'User uploaded image';
container.appendChild(img);
const p = document.createElement('p');
p.textContent = text;
container.appendChild(p);
msgDiv.appendChild(container);
} else {
msgDiv.textContent = text;
}

chatWindow.appendChild(msgDiv);
chatWindow.scrollTop = chatWindow.scrollHeight;
}

function appendBotMessage(text, isError = false) {
const msgDiv = document.createElement('div');
msgDiv.className = isError ? 'bot-message error' : 'bot-message';
msgDiv.innerHTML = isError ? `<span style="color:#ff6b6b">${text}</span>` : text.replace(/\n/g, '<br>');
chatWindow.appendChild(msgDiv);
chatWindow.scrollTop = chatWindow.scrollHeight;
return msgDiv;
}

function appendImageResult(base64Image) {
const msgDiv = document.createElement('div');
msgDiv.className = 'bot-message';
const img = document.createElement('img');
img.src = `data:image/jpeg;base64,${base64Image}`;
img.alt = 'Generated AI Image';
img.loading = 'lazy'; // Performance improvement
msgDiv.appendChild(img);
chatWindow.appendChild(msgDiv);
chatWindow.scrollTop = chatWindow.scrollHeight;
}

function clearInputs() {
promptInput.value = '';
currentBase64Image = null;
imageUpload.value = '';
statusText.textContent = '';
statusText.style.color = '#888';
}
});
