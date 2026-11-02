const navTabs = document.querySelectorAll('.nav-tab');
const panels = document.querySelectorAll('.tab-panel');
const menuToggle = document.querySelector('.menu-toggle');
const navLinks = document.querySelector('.nav-links');
const topbar = document.querySelector('.topbar');

function updateTopbar() {
  if (!topbar) return;

  const isCompact = topbar.classList.contains('is-compact');
  if (!isCompact && window.scrollY > 40) {
    topbar.classList.add('is-compact');
  } else if (isCompact && window.scrollY < 12) {
    topbar.classList.remove('is-compact');
  }
}

window.addEventListener('scroll', updateTopbar, { passive: true });
updateTopbar();

function setActiveTab(targetId) {
  stopReading();
  navTabs.forEach((tab) => {
    const isActive = tab.dataset.target === targetId;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
  });

  panels.forEach((panel) => {
    panel.classList.toggle('active', panel.id === targetId);
  });

  if (window.innerWidth <= 650) {
    navLinks.classList.remove('open');
    menuToggle.setAttribute('aria-expanded', 'false');
  }

  if (voiceStatus) {
    const activeTab = [...navTabs].find((tab) => tab.dataset.target === targetId);
    voiceStatus.textContent = `Selected ${activeTab?.textContent || 'page'} section. Press the green button to hear it.`;
  }
}

navTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    setActiveTab(tab.dataset.target);
    const target = document.getElementById(tab.dataset.target);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

document.querySelectorAll('[data-target]').forEach((button) => {
  if (button.classList.contains('nav-tab')) return;
  button.addEventListener('click', () => {
    const targetId = button.dataset.target;
    if (!targetId) return;
    setActiveTab(targetId);
    const target = document.getElementById(targetId);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

document.querySelectorAll('a[href="#admissions"]').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    setActiveTab('admissions');
    document.getElementById('application-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

document.querySelectorAll('a[href="#contact"], a[href^="https://www.google.com/maps/"]').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    setActiveTab('contact');
    document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

if (menuToggle && navLinks) {
  menuToggle.addEventListener('click', () => {
    const isOpen = navLinks.classList.toggle('open');
    menuToggle.setAttribute('aria-expanded', String(isOpen));
    menuToggle.setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu');
  });
}

const counters = document.querySelectorAll('.count');
const revealEls = document.querySelectorAll('.reveal');

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
    }
  });
}, { threshold: 0.15 });

revealEls.forEach((element) => revealObserver.observe(element));

const countObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    const el = entry.target;
    const target = Number(el.dataset.target || 0);
    const suffix = target >= 100 ? '%' : '';
    const start = performance.now();
    const duration = 1500;

    const updateCount = (timestamp) => {
      const progress = Math.min((timestamp - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = Math.round(target * eased);
      el.textContent = `${value}${suffix}`;
      if (progress < 1) {
        requestAnimationFrame(updateCount);
      } else {
        el.textContent = `${target}${suffix}`;
      }
    };

    requestAnimationFrame(updateCount);
    countObserver.unobserve(el);
  });
}, { threshold: 0.6 });

counters.forEach((counter) => countObserver.observe(counter));

function validateField(input) {
  const value = input.value.trim();
  if (input.type === 'email') {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }
  return value.length > 0;
}

function setStatus(el, message, type) {
  if (!el) return;
  el.textContent = message;
  el.classList.remove('success', 'error');
  if (type) {
    el.classList.add(type);
  }
}

async function submitForm(form, type, successMessage) {
  const status = form.querySelector('.form-status');
  const button = form.querySelector('button[type="submit"]');
  const fields = [...form.querySelectorAll('input:not([name="website"]), select, textarea')];
  const honeypot = form.elements.namedItem('website');
  let valid = true;

  fields.forEach((field) => {
    if (!validateField(field)) {
      valid = false;
    }
    field.classList.toggle('invalid', !validateField(field));
  });

  if (!valid) {
    setStatus(status, 'Please complete all required fields with valid information.', 'error');
    return;
  }

  button.disabled = true;
  setStatus(status, 'Sending your message securely...', '');

  try {
    const response = await fetch('/api/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        fields: Object.fromEntries(new FormData(form).entries()),
      }),
    });
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/json')) {
      throw new Error('The school submission service is not available on this website.');
    }
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Your message could not be sent.');
    }

    setStatus(status, successMessage, 'success');
    form.reset();
  } catch (error) {
    const message = error instanceof TypeError
      ? 'Could not reach the school submission service. Check your internet connection and try again.'
      : error instanceof Error ? error.message : 'Your message could not be sent.';
    setStatus(status, `${message} Please try again or contact the school by phone.`, 'error');
  } finally {
    button.disabled = false;
  }

  if (honeypot) honeypot.value = '';
}

document.getElementById('enquiry-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  submitForm(event.currentTarget, 'admission', 'Thank you. Your admissions enquiry has been received by the school.');
});

document.getElementById('contact-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  submitForm(event.currentTarget, 'contact', 'Thank you. Your message has been received by the school.');
});

document.getElementById('complaint-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  submitForm(event.currentTarget, 'complaint', 'Thank you. Your complaint has been received by the school.');
});

const readButton = document.getElementById('read-section');
const pauseButton = document.getElementById('pause-reading');
const stopButton = document.getElementById('stop-reading');
const voiceStatus = document.getElementById('voice-status');
let activeUtterance = null;
let speechChunks = [];
let currentSpeechChunk = 0;
let activeCharIndex = 0;
let speechState = 'idle';

function setVoiceControls() {
  const isActive = speechState === 'playing' || speechState === 'paused';
  pauseButton.disabled = !isActive;
  pauseButton.textContent = speechState === 'paused' ? 'Resume' : 'Pause';
  stopButton.disabled = !isActive;
}

function splitSpeechText(text, maxLength = 160) {
  const chunks = [];
  let chunk = '';

  text.split(/\s+/).forEach((word) => {
    if (chunk && `${chunk} ${word}`.length > maxLength) {
      chunks.push(chunk);
      chunk = word;
    } else {
      chunk = chunk ? `${chunk} ${word}` : word;
    }
  });

  if (chunk) chunks.push(chunk);
  return chunks;
}

function speakNextChunk() {
  if (speechState !== 'playing') return;
  if (currentSpeechChunk >= speechChunks.length) {
    speechState = 'idle';
    activeUtterance = null;
    setVoiceControls();
    voiceStatus.textContent = 'Finished reading this section.';
    return;
  }

  const utterance = new SpeechSynthesisUtterance(speechChunks[currentSpeechChunk]);
  const englishVoices = window.speechSynthesis.getVoices()
    .filter((voice) => /^en([_-]|$)/i.test(voice.lang));
  utterance.voice = englishVoices.find((voice) => voice.default) || englishVoices[0] || null;
  utterance.rate = 0.9;
  activeCharIndex = 0;
  activeUtterance = utterance;

  utterance.onstart = () => {
    if (activeUtterance !== utterance || speechState !== 'playing') return;
    voiceStatus.textContent = 'Reading this section aloud.';
    setVoiceControls();
  };
  utterance.onboundary = (event) => {
    if (activeUtterance === utterance && Number.isInteger(event.charIndex)) {
      activeCharIndex = event.charIndex;
    }
  };
  utterance.onend = () => {
    if (activeUtterance !== utterance || speechState !== 'playing') return;
    activeUtterance = null;
    currentSpeechChunk += 1;
    speakNextChunk();
  };
  utterance.onerror = (event) => {
    if (activeUtterance !== utterance || speechState !== 'playing') return;
    activeUtterance = null;
    speechState = 'idle';
    speechChunks = [];
    setVoiceControls();
    voiceStatus.textContent = `Read aloud failed (${event.error}). Check that your device audio is on and try again.`;
  };

  window.speechSynthesis.speak(utterance);
}

function stopReading() {
  speechState = 'idle';
  activeUtterance = null;
  speechChunks = [];
  currentSpeechChunk = 0;
  activeCharIndex = 0;
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  setVoiceControls();
}

if (readButton && voiceStatus) {
  readButton.addEventListener('click', () => {
    if (!('speechSynthesis' in window)) {
      voiceStatus.textContent = 'Read aloud is not supported by this browser. Try a current version of Chrome or Edge.';
      return;
    }

    const activePanel = document.querySelector('.tab-panel.active');
    if (!activePanel) return;

    const content = activePanel.cloneNode(true);
    content.querySelectorAll('[data-voice-ignore], .form-status').forEach((element) => element.remove());
    const fieldDescriptions = [...activePanel.querySelectorAll('input:not([name="website"]), textarea')]
      .map((field) => {
        const label = field.labels?.[0]?.childNodes[0]?.textContent?.trim() || '';
        const hint = field.placeholder ? ` ${field.placeholder}` : '';
        return `${label}.${hint}`;
      });
    const text = `${content.innerText || content.textContent} ${fieldDescriptions.join(' ')}`.replace(/\s+/g, ' ').trim();

    stopReading();
    speechChunks = splitSpeechText(text);
    currentSpeechChunk = 0;
    speechState = 'playing';
    voiceStatus.textContent = 'Starting read aloud...';
    setVoiceControls();
    speakNextChunk();
  });
}

pauseButton?.addEventListener('click', () => {
  if (!('speechSynthesis' in window)) return;
  if (speechState === 'paused') {
    speechState = 'playing';
    pauseButton.textContent = 'Pause';
    voiceStatus.textContent = 'Reading this section aloud.';
    setVoiceControls();
    speakNextChunk();
    return;
  }

  if (speechState !== 'playing') return;
  if (activeUtterance) {
    const remainingText = activeUtterance.text.slice(activeCharIndex).trimStart();
    if (remainingText) speechChunks[currentSpeechChunk] = remainingText;
    activeUtterance = null;
    window.speechSynthesis.cancel();
  }
  speechState = 'paused';
  voiceStatus.textContent = 'Reading paused.';
  setVoiceControls();
});

stopButton?.addEventListener('click', () => {
  stopReading();
  voiceStatus.textContent = 'Reading stopped.';
});
