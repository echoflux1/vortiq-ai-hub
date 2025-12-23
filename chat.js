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

  // Sanitization function to prevent XSS
  function sanitizeInput(input) {
    const div = document.createElement('div');
    div.textContent = input;
    return div.innerHTML;
  }

  // Toggle Upload Button Visibility
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
    currentBase64Image = null;
    statusText.textContent = '';
  });

  // Handle Image Upload
  uploadBtn.addEventListener('click', () => imageUpload.click());
  imageUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 4 * 1024 * 1024) {
        statusText.textContent = 'Error: Image must be under 4MB';
        statusText.style.color = '#ff6b6b';
        imageUpload.value = '';
        return;
      }
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

  // Handle Send
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

    if (!prompt) {
      statusText.textContent = 'Please enter a message';
      statusText.style.color = '#ff6b6b';
      return;
    }

    if (prompt.length > 2000) {
      statusText.textContent = 'Error: Message too long (max 2000 chars)';
      statusText.style.color = '#ff6b6b';
      return;
    }

    const sanitizedPrompt = sanitizeInput(prompt);
    appendUserMessage(sanitizedPrompt, currentBase64Image);
    clearInputs();

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
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      chatWindow.removeChild(loadingMessage); // FIX: Remove the node itself, not parentElement

      if (data.error) {
        appendBotMessage(`Error: ${data.error}`, true);
      } else if (data.base64Image) {
        appendImageResult(data.base64Image);
      } else {
        appendBotMessage(data.response || 'No response received.');
      }

    } catch (error) {
      chatWindow.removeChild(loadingMessage); // FIX: Same here
      appendBotMessage(`Connection Failed: ${error.message}`, true);
    } finally {
      isCoolingDown = true;
      setTimeout(() => {
        isCoolingDown = false;
        statusText.textContent = '';
        statusText.style.color = '#888';
      }, 3000);
    }
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
    return msgDiv; // Returns the div itself
  }

  function appendImageResult(base64Image) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'bot-message';
    const img = document.createElement('img');
    img.src = `data:image/jpeg;base64,${base64Image}`;
    img.alt = 'Generated AI Image';
    img.loading = 'lazy';
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
