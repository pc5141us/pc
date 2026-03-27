const API_BASE = "/api/moakt";

document.addEventListener('DOMContentLoaded', () => {
    const emailInput = document.getElementById('email-address');
    const copyBtn = document.getElementById('copy-btn');
    const newEmailBtn = document.getElementById('new-email-btn');
    const customPrefixInput = document.getElementById('custom-prefix');
    const domainSelect = document.getElementById('domain-select');
    const createCustomBtn = document.getElementById('create-custom-btn');
    const copyMessage = document.getElementById('copy-message');
    const messagesList = document.getElementById('messages-list');
    const unreadCount = document.getElementById('unread-count');
    const refreshBtn = document.getElementById('refresh-btn');

    // Modal elements
    const modal = document.getElementById('message-modal');
    const closeModal = document.getElementById('close-modal');
    const modalSubject = document.getElementById('modal-subject');
    const modalSender = document.getElementById('modal-sender');
    const modalDate = document.getElementById('modal-date');
    const modalBody = document.getElementById('modal-body');

    // Persistence Check
    let currentEmail = localStorage.getItem('domamail_proxy_email') || '';
    let currentSessionId = localStorage.getItem('domamail_proxy_sessionId') || '';
    let inboxInterval = null;
    let loadedMessageIds = new Set();


    // Play a notification sound
    function playNotificationSound() {
        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (audioCtx.state === 'suspended') audioCtx.resume();
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            oscillator.type = 'sine';
            oscillator.frequency.value = 880;
            gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
            gainNode.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.05);
            gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.2);
            oscillator.start(audioCtx.currentTime);
            oscillator.stop(audioCtx.currentTime + 0.2);
        } catch (e) {
            console.error('Audio play failed', e);
        }
    }

    // Load Domains into Select
    async function loadDomains() {
        const customDomains = [
            'bareed.ws', 'tmail.ws', 'moakt.ws', 'moakt.co', 'disbox.org',
            'tmails.net', 'tmpmail.net', 'tmpmail.org', 'disbox.net',
            'moakt.cc', 'tmpbox.net', 'tmpeml.com', 'teml.net'
        ];
        domainSelect.innerHTML = '';
        customDomains.forEach(domain => {
            const option = document.createElement('option');
            option.value = domain;
            option.textContent = domain;
            domainSelect.appendChild(option);
        });
    }
    loadDomains();

    // Create Account (Random or Custom)
    async function setupAccount(username, domain) {
        try {
            if (emailInput) emailInput.value = 'جاري الإنشاء...';
            const response = await fetch(`${API_BASE}/new`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ address: username ? `${username}@${domain}` : null })
            });

            const data = await response.json();
            if (!data.success) throw new Error(data.error);

            currentEmail = data.email;
            currentSessionId = data.sessionId;
            localStorage.setItem('domamail_proxy_email', currentEmail);
            localStorage.setItem('domamail_proxy_sessionId', currentSessionId);

            if (emailInput) {
                emailInput.value = currentEmail;
                emailInput.style.color = 'var(--primary-color)';
            }

            // Clear Inbox UI
            messagesList.innerHTML = `
                <div class="empty-state">
                    <div class="loader"></div>
                    <p>في انتظار رسائل جديدة...</p>
                    <small style="color:var(--primary-color);">🟢 متصل: ${currentEmail}</small>
                </div>
            `;
            unreadCount.textContent = '0';
            loadedMessageIds.clear();

            if (inboxInterval) clearInterval(inboxInterval);
            fetchInbox(true);
            inboxInterval = setInterval(() => fetchInbox(false), 2000);

        } catch (error) {
            console.error('Setup Error:', error);
            if (emailInput) emailInput.value = 'فشل الاتصال بالخادم ❌';
        }
    }

    // Fetch Inbox
    async function fetchInbox(isInitial = false) {
        if (!currentSessionId) return;
        try {
            const response = await fetch(`${API_BASE}/inbox/${currentSessionId}`);
            if (!response.ok) {
                if (response.status === 404) {
                    if (emailInput) emailInput.value = 'انتهت الجلسة ⚠️ أعد الإنشاء';
                }
                return;
            }

            const data = await response.json();
            const messages = data['hydra:member'] || [];
            unreadCount.textContent = messages.length;
            if (messages.length > 0) {
                const emptyState = messagesList.querySelector('.empty-state');
                if (emptyState) messagesList.innerHTML = '';
            }

            if (messages.length === 0) return;

            let newMessagesHTML = '';
            let hasNewMessage = false;

            messages.forEach(msg => {
                const pseudoId = (msg.id || '') + (msg.subject || '');
                if (pseudoId && !loadedMessageIds.has(pseudoId)) {
                    hasNewMessage = true;
                    loadedMessageIds.add(pseudoId);

                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = msg.body || '';
                    const previewText = tempDiv.textContent || tempDiv.innerText || '...';
                    const shortPreview = previewText.substring(0, 80).trim() + (previewText.length > 80 ? '...' : '');

                    const formattedDate = new Date(msg.createdAt).toLocaleString('ar-EG');
                    newMessagesHTML = `
                        <div class="message-item" data-path="${msg.id}" data-id="${pseudoId}">
                            <div class="msg-header">
                                <span>من: <strong style="color:var(--primary-color)">${msg.from.address}</strong></span>
                                <span style="font-size: 0.75rem; color:#aaa;">${formattedDate}</span>
                            </div>
                            <div class="msg-subject">${msg.subject || 'بدون موضوع'}</div>
                            <div class="msg-preview" style="margin-top:4px; font-size:0.8rem; color:#888; line-height:1.4;">
                                ${shortPreview}
                            </div>
                        </div>
                    ` + newMessagesHTML;
                }
            });

            if (newMessagesHTML) {
                messagesList.insertAdjacentHTML('afterbegin', newMessagesHTML);
            }
            if (hasNewMessage && !isInitial) playNotificationSound();
        } catch (error) {
            console.error('Inbox Error:', error);
        }
    }

    // Open/View Message Content
    async function openMessage(msgPath) {
        try {
            modalBody.innerHTML = '<div class="loader" style="margin:20px auto"></div>';
            modalSubject.textContent = 'جاري التحميل...';
            modal.style.display = 'flex';

            const response = await fetch(`${API_BASE}/message/${currentSessionId}?msgPath=${encodeURIComponent(msgPath)}`);
            const data = await response.json();

            modalSubject.textContent = data.subject || 'بدون موضوع';
            modalSender.textContent = data.sender || 'غير معروف';
            modalBody.innerHTML = data.body || 'لا يوجد محتوى لهذه الرسالة';
        } catch (error) {
            modalBody.innerHTML = '<p style="color:red">فشل في تحميل محتوى الرسالة ❌</p>';
        }
    }

    // Event Listeners
    newEmailBtn.addEventListener('click', () => {
        const options = domainSelect.options;
        const randomIndex = Math.floor(Math.random() * options.length);
        const randomDomain = options[randomIndex].value;
        const randomPrefix = Math.random().toString(36).substring(2, 10);
        setupAccount(randomPrefix, randomDomain);
    });

    createCustomBtn.addEventListener('click', () => {
        const prefix = customPrefixInput.value.trim();
        const domain = domainSelect.value;
        if (prefix) setupAccount(prefix, domain);
        else alert('الرجاء إدخال الاسم المطلوب');
    });

    copyBtn.addEventListener('click', () => {
        if (!currentEmail) return;
        navigator.clipboard.writeText(currentEmail);
        copyMessage.style.display = 'block';
        setTimeout(() => copyMessage.style.display = 'none', 2000);
    });

    refreshBtn.addEventListener('click', () => fetchInbox(false));

    messagesList.addEventListener('click', (e) => {
        const item = e.target.closest('.message-item');
        if (item) {
            const msgPath = item.getAttribute('data-path');
            openMessage(msgPath);
        }
    });

    closeModal.addEventListener('click', () => modal.style.display = 'none');
    window.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

    // Initial Load / Restoration
    if (currentEmail && currentSessionId) {
        emailInput.value = currentEmail;
        messagesList.innerHTML = `
            <div class="empty-state">
                <div class="loader"></div>
                <p>جاري استعادة الاتصال بـ ${currentEmail}...</p>
            </div>
        `;
        fetchInbox(true);
        inboxInterval = setInterval(() => fetchInbox(false), 2000);
    }
});
