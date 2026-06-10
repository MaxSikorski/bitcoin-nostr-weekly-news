/* ============================================================
   Presenter Engine — Slide navigation, timer, QR, TOC
   ============================================================ */

(function () {
    'use strict';

    // === State ===
    let weekData = null;
    let slides = [];
    let currentSlide = 0;
    let timerInterval = null;
    let timerSeconds = 20 * 60; // countdown from 20:00
    let timerRunning = false;
    let timerStarted = false;
    let qrVisible = false;
    let tocOpen = false;
    let overviewSlideIndex = 1; // index of the overview slide

    // === DOM Elements ===
    const presentation = document.getElementById('presentation');
    const loadingState = document.getElementById('loading-state');
    const progressBar = document.getElementById('progress-bar');
    const slideCounter = document.getElementById('slide-counter');
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const timerDisplay = document.getElementById('timer-display');
    const tocOverlay = document.getElementById('toc-overlay');
    const tocSidebar = document.getElementById('toc-sidebar');
    const tocList = document.getElementById('toc-list');
    const tocClose = document.getElementById('toc-close');
    const tocToggleBtn = document.getElementById('toc-toggle-btn');
    const qrOverlay = document.getElementById('qr-overlay');
    const qrCanvas = document.getElementById('qr-canvas');
    const qrLabel = document.getElementById('qr-label');
    const qrToggleBtn = document.getElementById('qr-toggle-btn');
    const presenterControls = document.getElementById('presenter-controls');
    const keyboardHints = document.getElementById('keyboard-hints');

    // === Utility: Extract YouTube embed URL ===
    function getYouTubeEmbedUrl(url) {
        if (!url) return null;
        let videoId = null;
        let startTime = '';

        // Handle youtu.be short URLs
        const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
        if (shortMatch) {
            videoId = shortMatch[1];
        }

        // Handle youtube.com URLs
        const longMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
        if (longMatch) {
            videoId = longMatch[1];
        }

        if (!videoId) return null;

        // Extract timestamp
        const timeMatch = url.match(/[?&]t=(\d+)/);
        if (timeMatch) {
            startTime = `&start=${timeMatch[1]}`;
        }

        return `https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1${startTime}`;
    }

    // === Utility: Simple QR Code Generator ===
    // Minimal QR code generator (alphanumeric, for URLs)
    // Using a canvas-based approach with the QR algorithm
    function generateQR(text, canvas, size) {
        if (!canvas || !text) return;

        // Use a simple encoding: render as a visual code-like pattern
        // For a real QR code, we'll use a lightweight inline implementation
        const ctx = canvas.getContext('2d');
        canvas.width = size;
        canvas.height = size;

        // Generate QR matrix using the embedded micro-library
        const qr = QREncoder.encode(text);
        const modules = qr.modules;
        const moduleCount = qr.moduleCount;
        const cellSize = size / moduleCount;

        // Background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);

        // Modules
        ctx.fillStyle = '#000000';
        for (let row = 0; row < moduleCount; row++) {
            for (let col = 0; col < moduleCount; col++) {
                if (modules[row][col]) {
                    ctx.fillRect(
                        Math.round(col * cellSize),
                        Math.round(row * cellSize),
                        Math.ceil(cellSize),
                        Math.ceil(cellSize)
                    );
                }
            }
        }
    }

    // === Minimal QR Code Encoder ===
    // Embedded lightweight QR code encoder (Mode: Byte, EC Level: L)
    const QREncoder = (function () {
        // QR Code generator adapted for minimal size
        // Supports up to ~150 chars at EC level L

        const MODE_BYTE = 4;
        const EC_LEVEL_L = 1;

        // Pre-computed for versions 1-10
        const VERSION_CAPACITY = [0, 17, 32, 53, 78, 106, 134, 154, 192, 230, 271];
        const VERSION_SIZE = [0, 21, 25, 29, 33, 37, 41, 45, 49, 53, 57];
        const EC_CODEWORDS = [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18];
        const NUM_EC_BLOCKS = [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4];

        // Galois field tables
        const GF_EXP = new Array(256);
        const GF_LOG = new Array(256);

        (function initGF() {
            let x = 1;
            for (let i = 0; i < 255; i++) {
                GF_EXP[i] = x;
                GF_LOG[x] = i;
                x = x * 2;
                if (x >= 256) x ^= 0x11d;
            }
            GF_EXP[255] = GF_EXP[0];
        })();

        function gfMul(a, b) {
            if (a === 0 || b === 0) return 0;
            return GF_EXP[(GF_LOG[a] + GF_LOG[b]) % 255];
        }

        function polyMul(p1, p2) {
            const result = new Array(p1.length + p2.length - 1).fill(0);
            for (let i = 0; i < p1.length; i++) {
                for (let j = 0; j < p2.length; j++) {
                    result[i + j] ^= gfMul(p1[i], p2[j]);
                }
            }
            return result;
        }

        function getGeneratorPoly(degree) {
            let gen = [1];
            for (let i = 0; i < degree; i++) {
                gen = polyMul(gen, [1, GF_EXP[i]]);
            }
            return gen;
        }

        function rsEncode(data, ecLength) {
            const gen = getGeneratorPoly(ecLength);
            const padded = new Array(data.length + ecLength).fill(0);
            for (let i = 0; i < data.length; i++) padded[i] = data[i];

            for (let i = 0; i < data.length; i++) {
                const coef = padded[i];
                if (coef !== 0) {
                    for (let j = 0; j < gen.length; j++) {
                        padded[i + j] ^= gfMul(gen[j], coef);
                    }
                }
            }

            return padded.slice(data.length);
        }

        function getVersion(dataLength) {
            for (let v = 1; v <= 10; v++) {
                const capacity = VERSION_CAPACITY[v] - EC_CODEWORDS[v] * NUM_EC_BLOCKS[v];
                if (dataLength + 3 <= capacity) return v; // +3 for mode and length indicators
            }
            return 10; // max supported
        }

        function encode(text) {
            const data = [];
            for (let i = 0; i < text.length; i++) {
                data.push(text.charCodeAt(i));
            }

            const version = getVersion(data.length);
            const size = VERSION_SIZE[version];
            const ecPerBlock = EC_CODEWORDS[version];
            const numBlocks = NUM_EC_BLOCKS[version];
            const totalDataCW = VERSION_CAPACITY[version] - ecPerBlock * numBlocks;

            // Build data stream
            const bitStream = [];

            // Mode indicator (byte mode = 0100)
            bitStream.push(0, 1, 0, 0);

            // Character count (8 bits for versions 1-9, 16 for 10+)
            const countBits = version <= 9 ? 8 : 16;
            for (let i = countBits - 1; i >= 0; i--) {
                bitStream.push((data.length >> i) & 1);
            }

            // Data
            for (let i = 0; i < data.length; i++) {
                for (let b = 7; b >= 0; b--) {
                    bitStream.push((data[i] >> b) & 1);
                }
            }

            // Terminator
            const maxBits = totalDataCW * 8;
            for (let i = 0; i < 4 && bitStream.length < maxBits; i++) {
                bitStream.push(0);
            }

            // Pad to byte boundary
            while (bitStream.length % 8 !== 0 && bitStream.length < maxBits) {
                bitStream.push(0);
            }

            // Pad codewords
            const padBytes = [0xEC, 0x11];
            let padIdx = 0;
            while (bitStream.length < maxBits) {
                for (let b = 7; b >= 0; b--) {
                    bitStream.push((padBytes[padIdx] >> b) & 1);
                }
                padIdx = (padIdx + 1) % 2;
            }

            // Convert to bytes
            const dataCodewords = [];
            for (let i = 0; i < bitStream.length; i += 8) {
                let byte = 0;
                for (let b = 0; b < 8; b++) {
                    byte = (byte << 1) | (bitStream[i + b] || 0);
                }
                dataCodewords.push(byte);
            }

            // RS error correction
            const blockSize = Math.floor(totalDataCW / numBlocks);
            const allCodewords = [];

            for (let b = 0; b < numBlocks; b++) {
                const start = b * blockSize;
                const blockData = dataCodewords.slice(start, start + blockSize);
                const ec = rsEncode(blockData, ecPerBlock);
                allCodewords.push({ data: blockData, ec: ec });
            }

            // Interleave
            const finalData = [];
            const maxDataLen = Math.max(...allCodewords.map(b => b.data.length));
            for (let i = 0; i < maxDataLen; i++) {
                for (let b = 0; b < numBlocks; b++) {
                    if (i < allCodewords[b].data.length) finalData.push(allCodewords[b].data[i]);
                }
            }
            for (let i = 0; i < ecPerBlock; i++) {
                for (let b = 0; b < numBlocks; b++) {
                    finalData.push(allCodewords[b].ec[i]);
                }
            }

            // Create module matrix
            const modules = Array.from({ length: size }, () => new Array(size).fill(null));
            const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

            // Place finder patterns
            function placeFinder(row, col) {
                for (let r = -1; r <= 7; r++) {
                    for (let c = -1; c <= 7; c++) {
                        const mr = row + r, mc = col + c;
                        if (mr < 0 || mr >= size || mc < 0 || mc >= size) continue;
                        if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
                            const isOuter = r === 0 || r === 6 || c === 0 || c === 6;
                            const isInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
                            modules[mr][mc] = isOuter || isInner;
                        } else {
                            modules[mr][mc] = false;
                        }
                        reserved[mr][mc] = true;
                    }
                }
            }

            placeFinder(0, 0);
            placeFinder(0, size - 7);
            placeFinder(size - 7, 0);

            // Timing patterns
            for (let i = 8; i < size - 8; i++) {
                if (!reserved[6][i]) {
                    modules[6][i] = i % 2 === 0;
                    reserved[6][i] = true;
                }
                if (!reserved[i][6]) {
                    modules[i][6] = i % 2 === 0;
                    reserved[i][6] = true;
                }
            }

            // Dark module
            modules[size - 8][8] = true;
            reserved[size - 8][8] = true;

            // Reserve format info areas
            for (let i = 0; i < 9; i++) {
                if (i < size) { reserved[8][i] = true; reserved[i][8] = true; }
            }
            for (let i = 0; i < 8; i++) {
                reserved[8][size - 1 - i] = true;
                reserved[size - 1 - i][8] = true;
            }

            // Alignment pattern (for version >= 2)
            if (version >= 2) {
                const alignPos = size - 7; // simplified for small versions
                for (let r = -2; r <= 2; r++) {
                    for (let c = -2; c <= 2; c++) {
                        const mr = alignPos + r, mc = alignPos + c;
                        if (mr >= 0 && mr < size && mc >= 0 && mc < size && !reserved[mr][mc]) {
                            const isOuter = Math.abs(r) === 2 || Math.abs(c) === 2;
                            const isCenter = r === 0 && c === 0;
                            modules[mr][mc] = isOuter || isCenter;
                            reserved[mr][mc] = true;
                        }
                    }
                }
            }

            // Place data
            const finalBits = [];
            for (let i = 0; i < finalData.length; i++) {
                for (let b = 7; b >= 0; b--) {
                    finalBits.push((finalData[i] >> b) & 1);
                }
            }

            let bitIndex = 0;
            let upward = true;

            for (let col = size - 1; col >= 0; col -= 2) {
                if (col === 6) col = 5; // skip timing column
                const rows = upward ? Array.from({ length: size }, (_, i) => size - 1 - i) : Array.from({ length: size }, (_, i) => i);

                for (const row of rows) {
                    for (let c = 0; c < 2; c++) {
                        const actualCol = col - c;
                        if (actualCol < 0 || reserved[row][actualCol]) continue;
                        modules[row][actualCol] = bitIndex < finalBits.length ? finalBits[bitIndex++] === 1 : false;
                    }
                }
                upward = !upward;
            }

            // Apply mask (pattern 0: (row + col) % 2 === 0)
            for (let r = 0; r < size; r++) {
                for (let c = 0; c < size; c++) {
                    if (!reserved[r][c]) {
                        if ((r + c) % 2 === 0) {
                            modules[r][c] = !modules[r][c];
                        }
                    }
                }
            }

            // Place format info (mask 0, EC level L)
            // Pre-computed format string for EC-L, mask 0: 111011111000100
            const formatBits = [1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0];

            // Around top-left finder
            for (let i = 0; i < 6; i++) modules[8][i] = formatBits[i] === 1;
            modules[8][7] = formatBits[6] === 1;
            modules[8][8] = formatBits[7] === 1;
            modules[7][8] = formatBits[8] === 1;
            for (let i = 0; i < 6; i++) modules[5 - i][8] = formatBits[9 + i] === 1;

            // Around other finders
            for (let i = 0; i < 7; i++) modules[size - 1 - i][8] = formatBits[i] === 1;
            for (let i = 0; i < 8; i++) modules[8][size - 8 + i] = formatBits[7 + i] === 1;

            return { modules, moduleCount: size };
        }

        return { encode };
    })();

    // === Build Slides from JSON ===
    function buildSlides(data) {
        slides = [];
        const container = presentation;
        container.innerHTML = '';

        // Slide 0: Hero
        const heroSlide = createSlide('hero');
        const dateObj = new Date(data.date + 'T12:00:00');
        const formattedDate = dateObj.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        heroSlide.innerHTML = `
            <div class="slide-content" style="text-align: center;">
                <p class="slide-topic-badge">${formattedDate}</p>
                <h1 class="slide-heading" style="font-size: clamp(2.5rem, 5vw, 4rem); margin-bottom: 16px;">${data.title}</h1>
                <p class="slide-body" style="max-width: 480px; margin: 0 auto 40px;">${data.subtitle || 'Weekly Bitcoin & Nostr news and discussion'}</p>
                <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
                    <button class="btn primary-btn" id="start-btn">Start Presentation</button>
                    <span class="btn secondary-btn" style="cursor: default; opacity: 0.5; pointer-events: none;">${data.topics.length} Topics</span>
                </div>
            </div>
        `;
        container.appendChild(heroSlide);
        slides.push({ type: 'hero', el: heroSlide, topicId: null, url: null, accent: null });

        // Slide 1: Topic Overview
        const overviewSlide = createSlide('overview');
        let overviewHTML = `
            <div class="slide-content">
                <p class="slide-topic-badge">Overview</p>
                <h2 class="slide-heading" style="margin-bottom: 32px;">Today's Topics</h2>
                <div class="overview-grid">
        `;

        data.topics.forEach((topic, i) => {
            const typeIcons = {
                video: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
                tool: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>',
                discussion: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>'
            };

            overviewHTML += `
                <button class="topic-card" data-topic-index="${i}" onclick="window.Presenter.goToTopic(${i})">
                    <div class="topic-card-info">
                        <p class="topic-card-number">Topic ${i + 1}</p>
                        <h3 class="topic-card-title">${topic.title}</h3>
                        <p class="topic-card-desc">${topic.description}</p>
                    </div>
                    <svg class="topic-card-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M9 18l6-6-6-6"/>
                    </svg>
                </button>
            `;
        });

        overviewHTML += '</div></div>';
        overviewSlide.innerHTML = overviewHTML;
        container.appendChild(overviewSlide);
        slides.push({ type: 'overview', el: overviewSlide, topicId: null, url: null, accent: null });
        overviewSlideIndex = 1;

        // Topic slides
        data.topics.forEach((topic, topicIndex) => {
            topic.slides.forEach((slideData, slideIndex) => {
                const slide = createSlide('topic');
                let slideHTML = `<div class="slide-content">`;
                slideHTML += `<p class="slide-topic-badge">Topic ${topicIndex + 1}${topic.slides.length > 1 ? ` — ${slideIndex + 1} of ${topic.slides.length}` : ''}</p>`;
                slideHTML += `<h2 class="slide-heading">${slideData.heading}</h2>`;

                if (slideData.body) {
                    slideHTML += `<p class="slide-body">${slideData.body}</p>`;
                }

                if (slideData.videoUrl) {
                    const embedUrl = getYouTubeEmbedUrl(slideData.videoUrl);
                    if (embedUrl) {
                        slideHTML += `
                            <div class="video-container">
                                <iframe 
                                    src="${embedUrl}" 
                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                                    allowfullscreen
                                    loading="lazy"
                                    title="${slideData.videoTitle || slideData.heading}">
                                </iframe>
                            </div>
                        `;
                    }
                }

                if (slideData.imageUrl) {
                    slideHTML += `
                        <div class="slide-image-container">
                            <img src="${slideData.imageUrl}" alt="${slideData.heading}" loading="lazy">
                        </div>
                    `;
                }

                if (slideData.imageUrls && Array.isArray(slideData.imageUrls)) {
                    slideHTML += `<div class="slide-gallery-container">`;
                    slideData.imageUrls.forEach(url => {
                        slideHTML += `
                            <div class="slide-gallery-item">
                                <img src="${url}" alt="${slideData.heading}" loading="lazy">
                            </div>
                        `;
                    });
                    slideHTML += `</div>`;
                }

                if (slideData.bullets) {
                    slideHTML += '<ul class="slide-bullets">';
                    slideData.bullets.forEach(bullet => {
                        slideHTML += `<li>${bullet}</li>`;
                    });
                    slideHTML += '</ul>';
                }

                if (slideData.link) {
                    slideHTML += `
                        <a href="${slideData.link}" target="_blank" rel="noopener noreferrer" class="slide-link">
                            ${slideData.linkLabel || 'Open Link'}
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M7 17L17 7M17 7H7M17 7v10"/>
                            </svg>
                        </a>
                    `;
                }

                slideHTML += '</div>';
                slide.innerHTML = slideHTML;
                container.appendChild(slide);

                // Determine URL for QR code
                const qrUrl = slideData.link || slideData.videoUrl || topic.url || null;
                slides.push({
                    type: 'topic',
                    el: slide,
                    topicId: topic.id,
                    topicIndex: topicIndex,
                    url: qrUrl,
                    accent: topic.accent || null
                });
            });
        });

        return slides;
    }

    function createSlide(type) {
        const slide = document.createElement('div');
        slide.className = 'slide';
        slide.dataset.type = type;
        return slide;
    }

    // === Navigation ===
    function goToSlide(index, direction) {
        if (index < 0 || index >= slides.length || index === currentSlide) return;

        const prevSlideEl = slides[currentSlide].el;
        const nextSlideEl = slides[index].el;
        const dir = direction || (index > currentSlide ? 1 : -1);

        // Start timer on first navigation away from hero
        if (!timerStarted && currentSlide === 0 && index > 0) {
            startTimer();
            timerStarted = true;
        }

        // Animate out
        gsap.to(prevSlideEl, {
            opacity: 0,
            y: dir * -30,
            duration: 0.4,
            ease: 'power4.out',
            onComplete: () => {
                prevSlideEl.classList.remove('active');
                prevSlideEl.style.transform = '';
            }
        });

        // Animate in
        gsap.set(nextSlideEl, { opacity: 0, y: dir * 30 });
        nextSlideEl.classList.add('active');
        gsap.to(nextSlideEl, {
            opacity: 1,
            y: 0,
            duration: 0.6,
            ease: 'power4.out',
            delay: 0.1
        });

        // Animate inner elements stagger
        const innerElements = nextSlideEl.querySelectorAll('.slide-topic-badge, .slide-heading, .slide-body, .slide-bullets li, .slide-link, .video-container, .topic-card');
        if (innerElements.length > 0) {
            gsap.set(innerElements, { opacity: 0, y: 15 });
            gsap.to(innerElements, {
                opacity: 1,
                y: 0,
                duration: 0.6,
                ease: 'power4.out',
                stagger: 0.06,
                delay: 0.2
            });

            // Fix opacity for specific elements after animation
            nextSlideEl.querySelectorAll('.slide-body').forEach(el => {
                gsap.to(el, { opacity: 0.85, duration: 0.6, ease: 'power4.out', delay: 0.3 });
            });
            nextSlideEl.querySelectorAll('.slide-bullets li').forEach(el => {
                gsap.to(el, { opacity: 0.85, duration: 0.6, ease: 'power4.out', delay: 0.3 });
            });
        }

        currentSlide = index;
        updateControls();
        updateQR();
        updateTOCHighlight();
    }

    function nextSlide() {
        if (currentSlide < slides.length - 1) {
            goToSlide(currentSlide + 1, 1);
        }
    }

    function prevSlide() {
        if (currentSlide > 0) {
            goToSlide(currentSlide - 1, -1);
        }
    }

    function goToOverview() {
        goToSlide(overviewSlideIndex);
    }

    function goToTopic(topicIndex) {
        // Find the first slide for this topic
        const slideIdx = slides.findIndex(s => s.topicIndex === topicIndex);
        if (slideIdx >= 0) {
            goToSlide(slideIdx, 1);
        }
    }

    function updateControls() {
        // Slide counter
        slideCounter.textContent = `${currentSlide + 1} / ${slides.length}`;

        // Nav buttons
        prevBtn.disabled = currentSlide === 0;
        nextBtn.disabled = currentSlide === slides.length - 1;

        // Progress bar
        const progress = slides.length > 1 ? (currentSlide / (slides.length - 1)) * 100 : 0;
        progressBar.style.width = `${progress}%`;

        // Topic accent (bitcoin = orange, nostr = purple, otherwise monochrome)
        const accent = slides[currentSlide].accent;
        progressBar.classList.toggle('accent-bitcoin', accent === 'bitcoin');
        progressBar.classList.toggle('accent-nostr', accent === 'nostr');
    }

    // === Timer ===
    function startTimer() {
        if (timerRunning) return;
        timerRunning = true;
        timerInterval = setInterval(() => {
            timerSeconds--;
            if (timerSeconds <= 0) {
                timerSeconds = 0;
                clearInterval(timerInterval);
                timerRunning = false;
            }
            updateTimerDisplay();
        }, 1000);
    }

    function pauseTimer() {
        clearInterval(timerInterval);
        timerRunning = false;
    }

    function resetTimer() {
        pauseTimer();
        timerSeconds = (weekData && weekData.timerMinutes ? weekData.timerMinutes : 20) * 60;
        timerStarted = false;
        updateTimerDisplay();
    }

    function updateTimerDisplay() {
        const mins = Math.floor(timerSeconds / 60);
        const secs = timerSeconds % 60;
        timerDisplay.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

        // Visual warnings
        timerDisplay.classList.remove('warning', 'critical');
        if (timerSeconds <= 0) {
            timerDisplay.classList.add('critical');
        } else if (timerSeconds <= 5 * 60) { // Last 5 minutes
            timerDisplay.classList.add('warning');
        }
    }

    // === QR Code ===
    function updateQR() {
        if (!qrVisible) return;
        const slideData = slides[currentSlide];
        if (slideData && slideData.url) {
            generateQR(slideData.url, qrCanvas, 140);
            qrLabel.textContent = 'Scan to open';
            qrOverlay.classList.add('visible');
        } else {
            qrOverlay.classList.remove('visible');
        }
    }

    function toggleQR() {
        qrVisible = !qrVisible;
        if (qrVisible) {
            qrToggleBtn.classList.add('active');
            updateQR();
        } else {
            qrToggleBtn.classList.remove('active');
            qrOverlay.classList.remove('visible');
        }
    }

    // === TOC ===
    function buildTOC(data) {
        tocList.innerHTML = '';

        // Overview item
        const overviewItem = document.createElement('button');
        overviewItem.className = 'toc-item';
        overviewItem.innerHTML = `
            <span class="toc-item-number">—</span>
            <span class="toc-item-title">Overview</span>
        `;
        overviewItem.addEventListener('click', () => {
            closeTOC();
            goToSlide(overviewSlideIndex);
        });
        tocList.appendChild(overviewItem);

        data.topics.forEach((topic, i) => {
            const item = document.createElement('button');
            item.className = 'toc-item';
            item.dataset.topicIndex = i;
            item.innerHTML = `
                <span class="toc-item-number">${String(i + 1).padStart(2, '0')}</span>
                <span class="toc-item-title">${topic.title}</span>
            `;
            item.addEventListener('click', () => {
                closeTOC();
                goToTopic(i);
            });
            tocList.appendChild(item);
        });
    }

    function openTOC() {
        tocOpen = true;
        tocOverlay.classList.add('open');
        tocSidebar.classList.add('open');
        tocToggleBtn.classList.add('active');
        updateTOCHighlight();
    }

    function closeTOC() {
        tocOpen = false;
        tocOverlay.classList.remove('open');
        tocSidebar.classList.remove('open');
        tocToggleBtn.classList.remove('active');
    }

    function toggleTOC() {
        if (tocOpen) closeTOC();
        else openTOC();
    }

    function updateTOCHighlight() {
        const items = tocList.querySelectorAll('.toc-item');
        const currentTopicIndex = slides[currentSlide]?.topicIndex;

        items.forEach(item => {
            item.classList.remove('active');
            const idx = item.dataset.topicIndex;
            if (idx !== undefined && parseInt(idx) === currentTopicIndex) {
                item.classList.add('active');
            }
            // Highlight overview
            if (idx === undefined && currentSlide === overviewSlideIndex) {
                item.classList.add('active');
            }
        });
    }

    // === Keyboard Navigation ===
    document.addEventListener('keydown', (e) => {
        // Ignore when typing in inputs
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        switch (e.key) {
            case 'ArrowRight':
            case 'ArrowDown':
            case ' ':
                e.preventDefault();
                nextSlide();
                break;
            case 'ArrowLeft':
            case 'ArrowUp':
                e.preventDefault();
                prevSlide();
                break;
            case 'Escape':
                e.preventDefault();
                if (tocOpen) {
                    closeTOC();
                } else {
                    goToOverview();
                }
                break;
            case 't':
            case 'T':
                e.preventDefault();
                toggleTOC();
                break;
            case 'q':
            case 'Q':
                e.preventDefault();
                toggleQR();
                break;
            case 'r':
            case 'R':
                e.preventDefault();
                resetTimer();
                break;
        }

        // Number keys 1-9: jump to topic
        const num = parseInt(e.key);
        if (!isNaN(num) && num >= 1 && num <= 9) {
            e.preventDefault();
            goToTopic(num - 1);
        }
    });

    // === Click Handlers ===
    prevBtn.addEventListener('click', prevSlide);
    nextBtn.addEventListener('click', nextSlide);
    tocToggleBtn.addEventListener('click', toggleTOC);
    tocClose.addEventListener('click', closeTOC);
    tocOverlay.addEventListener('click', closeTOC);
    qrToggleBtn.addEventListener('click', toggleQR);

    timerDisplay.addEventListener('click', () => {
        if (timerRunning) {
            pauseTimer();
        } else {
            startTimer();
        }
    });

    timerDisplay.addEventListener('dblclick', (e) => {
        e.preventDefault();
        resetTimer();
    });

    // === Keyboard Hints ===
    function showKeyboardHints() {
        keyboardHints.classList.add('visible');
        setTimeout(() => {
            keyboardHints.classList.remove('visible');
        }, 4000);
    }

    // === Inline fallback data for file:// protocol ===
    // Keep in sync with weeks/2026-W24.json
    const INLINE_WEEKS = {
        "2026-W24": {
            "week": "2026-W24",
            "date": "2026-06-10",
            "title": "ETF Exodus, Strategy's Dip Buy & the Reserve Bill",
            "subtitle": "This week in Bitcoin & Nostr news",
            "timerMinutes": 20,
            "topics": [
                {
                    "id": "market-pulse",
                    "title": "Bitcoin's Ugliest Week in Months",
                    "description": "Worst week since February — $61.5K, $1.1B in liquidations, and longtime holders selling",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Bitcoin's Ugliest Week in Months",
                            "body": "Bitcoin is trading near $61,500 after its worst week in months — down roughly 17% over the past seven days. The drop through $64,000 triggered about $1.1 billion in liquidations, and longtime high-conviction holders have started selling into weakness.",
                            "link": "https://www.cnbc.com/2026/06/04/bitcoin-is-weathering-its-ugliest-week-in-months-as-narrative-fades-and-liquidity-rotates.html",
                            "linkLabel": "Read CNBC's Breakdown"
                        },
                        {
                            "heading": "What's Driving It",
                            "bullets": [
                                "Liquidity rotation: capital is chasing momentum in AI and semiconductor trades, leaving Bitcoin without a fresh narrative",
                                "Long-term holders are distributing — CNBC reports 'high-conviction holders are turning into sellers' as price hit new lows",
                                "Macro jitters: this week's CPI report could decide whether the $60K–$63K range holds",
                                "Perspective check: Bitcoin sits about $48,800 below where it traded at this time last year"
                            ],
                            "link": "https://www.cnbc.com/2026/06/03/bitcoins-high-conviction-holders-are-selling-as-price-hits-new-lows.html",
                            "linkLabel": "Who's Selling"
                        },
                        {
                            "heading": "Discussion Points",
                            "bullets": [
                                "Is this a cyclical flush or the start of a deeper bear?",
                                "Does Bitcoin need a 'narrative' at all — or is that a trader's framing for what holders just call an opportunity?",
                                "Side note: Sam Bankman-Fried is reportedly seeking a pardon from President Trump — what would that say about crypto's standing in Washington?"
                            ]
                        }
                    ]
                },
                {
                    "id": "etf-outflows",
                    "title": "The ETF Exodus",
                    "description": "$1.72B left U.S. spot Bitcoin ETFs in a week — the biggest exit since February 2025",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "ETF Exodus: $1.72B Out in One Week",
                            "body": "U.S. spot Bitcoin ETFs posted $1.72 billion in net outflows for the week ending June 6 — the largest weekly exit since February 2025, and the fourth straight week of withdrawals. The four-week bleed totals roughly $5.4 billion.",
                            "link": "https://www.coindesk.com/markets/2026/06/05/bitcoin-and-ether-etfs-end-record-multi-billion-outflow-streak",
                            "linkLabel": "How the Streak Ended"
                        },
                        {
                            "heading": "Inside the Numbers",
                            "bullets": [
                                "BlackRock's IBIT led the outflows, shedding about $1.34B on the week — its worst week since launching in January 2024",
                                "A record multi-day outflow streak finally snapped on June 5 with the first net inflows in weeks",
                                "Analysts point to rising Treasury yields, shifting Fed rate expectations, and profit-taking after the long rally",
                                "One analyst take: the multi-billion-dollar bleed 'looks more cyclical than structural'"
                            ],
                            "link": "https://www.investing.com/analysis/bitcoins-34-billion-etf-bleed-looks-more-cyclical-than-structural-200681474",
                            "linkLabel": "The Cyclical Case"
                        },
                        {
                            "heading": "Discussion Points",
                            "bullets": [
                                "ETFs were the 2024–25 demand engine — what happens to price when that engine runs in reverse?",
                                "Did Wall Street adoption make Bitcoin stronger, or just turn it into another momentum trade?",
                                "Would a streak of inflows flip sentiment as fast as the outflows broke it?"
                            ]
                        }
                    ]
                },
                {
                    "id": "strategy",
                    "title": "Strategy Sells… Then Buys the Dip",
                    "description": "First sale since 2022, then a $101M buy — and a cost basis now underwater",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Strategy Sells… Then Buys the Dip",
                            "body": "Michael Saylor's Strategy disclosed its first Bitcoin sale since 2022 — just 32 BTC for about $2.5 million in late May — then turned around and bought 1,550 BTC for roughly $101 million between June 1 and 7. The treasury now stands at 845,256 BTC.",
                            "link": "https://www.coindesk.com/markets/2026/06/01/strategy-sold-32-btc-for-usd2-5-million-in-late-may-filing-shows",
                            "linkLabel": "Read the Filing Coverage"
                        },
                        {
                            "heading": "The Numbers",
                            "bullets": [
                                "845,256 BTC held — about 4% of the entire 21 million supply, acquired for $33.1 billion total",
                                "Average purchase price: $66,385 — with Bitcoin at $61.5K, Strategy is underwater on its cost basis",
                                "The buy was funded with at-the-market equity sales: about 1.41 million shares for roughly $181M net",
                                "Cash reserve raised by $100M to $1B; co-CEO Phong Le: 'Rumors otherwise are just rumors'"
                            ],
                            "link": "https://bitbo.io/treasuries/microstrategy",
                            "linkLabel": "Track Strategy's Holdings"
                        },
                        {
                            "heading": "Discussion Points",
                            "bullets": [
                                "Why sell 32 BTC at all? Housekeeping, a signal, or a trial balloon to test the market's reaction?",
                                "Strategy is now below its average cost — does the 'sell shares, buy Bitcoin' flywheel work in reverse?",
                                "One company holding 4% of all Bitcoin: systemic risk, or proof of conviction?"
                            ]
                        }
                    ]
                },
                {
                    "id": "clarity-act",
                    "title": "CLARITY Act: On the Senate Calendar",
                    "description": "The market-structure bill cleared committee — now it faces a 60-vote wall and a shrinking calendar",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "CLARITY Act: On the Senate Calendar",
                            "body": "The Digital Asset Market CLARITY Act — the big crypto market-structure bill — cleared the Senate Banking Committee 15–9 on May 14 and was placed on the Senate legislative calendar June 1. It would give the CFTC exclusive jurisdiction over 'digital commodity' spot markets like Bitcoin's, with the SEC keeping investment contracts.",
                            "link": "https://www.coindesk.com/news-analysis/2026/06/02/clarity-act-survival-depends-on-the-u-s-senate-getting-a-lot-of-non-crypto-work-done",
                            "linkLabel": "Where Things Stand"
                        },
                        {
                            "heading": "The Roadblocks",
                            "bullets": [
                                "Two Democrats (Gallego, Alsobrooks) joined all Republicans in committee — but the floor takes 60 votes to clear the filibuster",
                                "The Banking Committee version still has to merge with the Senate Agriculture Committee's framework",
                                "Roughly eight weeks remain on the Senate calendar before the summer break",
                                "61 crypto industry leaders sent a letter urging the Senate to keep developer protections intact"
                            ],
                            "link": "https://bitcoinmagazine.com/news/crypto-leaders-urge-to-pass-clarity-act",
                            "linkLabel": "Read About the Industry Letter"
                        },
                        {
                            "heading": "Why We Care + Discussion",
                            "bullets": [
                                "Clear CFTC jurisdiction over spot Bitcoin could end a decade of regulator turf wars",
                                "Developer protections decide whether writing open-source Bitcoin software carries legal risk",
                                "If it slips past the summer break, does a market-structure bill survive an election-year Congress at all?"
                            ]
                        }
                    ]
                },
                {
                    "id": "stablecoin-rules",
                    "title": "Stablecoin Rules Get Real",
                    "description": "GENIUS Act deadlines hit — the comment window closed June 9, full rules land July 18",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Stablecoin Rules Get Real",
                            "body": "The GENIUS Act — the federal stablecoin law signed last July — hit a key milestone this week: June 9 was the deadline for public comments on the FinCEN–OFAC anti-money-laundering rules. The full regulatory framework takes effect July 18.",
                            "link": "https://crypto.news/genius-act-deadline-puts-stablecoin-issuers-on-notice/",
                            "linkLabel": "Read the Deadline Rundown"
                        },
                        {
                            "heading": "The State of Stablecoins",
                            "bullets": [
                                "Total stablecoin supply now exceeds $240 billion — Tether's USDT holds about 67% market share, Circle's USDC about 27%",
                                "New York's DFS proposed aligning its state framework with Treasury's GENIUS Act certification rules",
                                "From July 18, issuers face full federal AML obligations, reserve requirements, and audits"
                            ],
                            "link": "https://home.treasury.gov/news/press-releases/sb0435",
                            "linkLabel": "Treasury's Proposed Rule"
                        },
                        {
                            "heading": "Why It Matters for Bitcoin + Discussion",
                            "bullets": [
                                "Stablecoins are the on-ramp and trading pair for most Bitcoin volume — regulated rails change how money reaches BTC",
                                "Regulated digital dollars: a gateway to Bitcoin, or a state-approved competitor to it?",
                                "Does Tether's offshore dominance survive a fully certified U.S. regime?"
                            ]
                        }
                    ]
                },
                {
                    "id": "reserve-bill",
                    "title": "Strategic Bitcoin Reserve: The Fine Print",
                    "description": "H.R. 8957's full text: a 20-year lockup and proof-of-reserve for the U.S. stash",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Strategic Bitcoin Reserve: The Fine Print Arrives",
                            "body": "Congress finally got a detailed look at the Strategic Bitcoin Reserve. The full text of the bipartisan American Reserve Modernization Act (H.R. 8957) — introduced by Rep. Nick Begich (R-AK) and Rep. Jared Golden (D-ME) with more than 20 co-sponsors — was published this week.",
                            "link": "https://bitcoinmagazine.com/news/full-of-strategic-bitcoin-reserve-bill",
                            "linkLabel": "Read the Full-Text Breakdown"
                        },
                        {
                            "heading": "What's in the Bill",
                            "bullets": [
                                "A mandatory 20-year hold: reserve BTC can't be sold, swapped, auctioned, or encumbered — for any purpose",
                                "After 20 years, at most 10% can be offloaded in any two-year window, subject to Congressional review",
                                "Quarterly public proof-of-reserve attestations, independent third-party audits, and Comptroller General oversight",
                                "The U.S. government already holds an estimated ~328,000 BTC — the largest known state holder"
                            ]
                        },
                        {
                            "heading": "Signals from the Administration + Discussion",
                            "bullets": [
                                "Treasury Secretary Bessent told a Senate committee June 3 the reserve is proceeding with 'deliberate speed'",
                                "A White House adviser has teased a reserve update 'in the next few weeks'",
                                "Does a 20-year lockup make the reserve credible — or just easy for a future Congress to repeal?",
                                "Quarterly proof-of-reserve from a government: a precedent we want every nation to copy?"
                            ],
                            "link": "https://www.thestreet.com/crypto/markets/treasury-secretary-bessent-reveals-new-information-on-bitcoin-reserve",
                            "linkLabel": "Bessent's Testimony"
                        }
                    ]
                },
                {
                    "id": "mining-difficulty",
                    "title": "Difficulty Drop Incoming as Miners Chase AI",
                    "description": "A ~9% difficulty drop is coming as public miners pivot rigs toward AI",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Difficulty Drop Incoming",
                            "body": "Mining difficulty is set to fall roughly 9% around June 13–14 — from 138.96T to about 123.9T — as squeezed miners power down or redirect capacity. Network hashrate sits near 962 EH/s after recently touching the 1 zettahash milestone.",
                            "link": "https://www.coinwarz.com/mining/bitcoin/difficulty-chart",
                            "linkLabel": "Live Difficulty Chart"
                        },
                        {
                            "heading": "The AI Pivot",
                            "bullets": [
                                "Bitcoin recorded its first Q1 hashrate decline in six years — partly from miners diverting power to AI workloads",
                                "Industry projections: listed miners could earn ~70% of revenue from AI and HPC by the end of 2026, up from ~30% today",
                                "With BTC near $61K, margins favor large operators with cheap power; transaction fees are only 10–15% of miner income"
                            ],
                            "link": "https://cryptonews.net/news/mining/32977167/",
                            "linkLabel": "Why Miners Are Becoming AI Data Centers"
                        },
                        {
                            "heading": "Discussion Points",
                            "bullets": [
                                "Is the AI pivot bullish (miners stay solvent) or bearish (security budget drifts away from the network)?",
                                "A 9% difficulty drop is relief for whoever keeps hashing — who's left mining at these prices?",
                                "Does miner consolidation around cheap power worry anyone here?"
                            ]
                        }
                    ]
                },
                {
                    "id": "nostr-vpn",
                    "title": "Satoshi's First Collaborator Ships a Nostr VPN",
                    "description": "Martti Malmi releases a Tailscale-style VPN where your npub is the login",
                    "type": "tool",
                    "accent": "nostr",
                    "slides": [
                        {
                            "heading": "A Nostr VPN from a Bitcoin OG",
                            "body": "Martti Malmi — 'Sirius,' who worked directly with Satoshi from 2009–2011 and co-ran Bitcoin.org — released a privacy-focused, Tailscale-style VPN built on Nostr. Your Nostr public key replaces email logins entirely: no accounts, no third parties.",
                            "link": "https://cointelegraph.com/news/bitcoin-developer-privacy-focused-nostr-vpn-public-keys",
                            "linkLabel": "Read the Coverage"
                        },
                        {
                            "heading": "How It Works",
                            "bullets": [
                                "Nostr public keys handle identity and signaling between your devices — the same cryptography that secures Bitcoin",
                                "Direct peer-to-peer connections, with Nostr-relay multihop routing as the fallback when P2P fails",
                                "A multiplatform interface for managing VPN settings across devices, inspired by Tailscale",
                                "The same trust-minimization logic as Bitcoin — applied to internet privacy instead of money"
                            ]
                        },
                        {
                            "heading": "Elsewhere on Nostr + Discussion",
                            "bullets": [
                                "Damus shipped 'Damus Labs' features — live-streaming and offline note-loading",
                                "Primal added Remote Login: sign into other Nostr clients without ever exposing your private key",
                                "OpenSats' Nostr Fund continues funding work on accessibility, security, and decentralization",
                                "Is identity — keys instead of accounts — Nostr's real killer app, beyond social media?"
                            ]
                        }
                    ]
                },
                {
                    "id": "quick-tip",
                    "title": "Quick Tip of the Week",
                    "description": "The mempool is nearly empty — do your on-chain housekeeping while fees are cheap",
                    "type": "tool",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Quick Tip: Housekeeping While Fees Are Low",
                            "body": "The mempool is nearly empty right now — low-priority transactions are clearing at around 1 sat/vB or less. That makes this the cheap window for on-chain housekeeping: consolidate your small UTXOs, open or rebalance Lightning channels, and move coins to cold storage. Check live fees before you send.",
                            "link": "https://mempool.space/",
                            "linkLabel": "Check Live Fees on mempool.space"
                        }
                    ]
                },
                {
                    "id": "community-news",
                    "title": "Community News & Topics",
                    "description": "Share what you're interested in talking about!",
                    "type": "text",
                    "slides": [
                        {
                            "heading": "Next Week's Meetup",
                            "body": "Find something you're interested in talking about? Share it here and we'll cover it in next week's meetup!",
                            "link": "https://github.com/MaxSikorski/bitcoin-nostr-weekly-news/issues",
                            "linkLabel": "Submit a Topic"
                        }
                    ]
                }
            ]
        }
    };

    // === Initialize ===
    function init() {
        const params = new URLSearchParams(window.location.search);
        const weekId = params.get('week');

        if (!weekId) {
            window.location.href = 'index.html';
            return;
        }

        function loadPresentation(data) {
            weekData = data;

            // Update page title
            document.title = `${data.title} — Bitcoin Meetup`;

            // Set timer from data
            if (data.timerMinutes) {
                timerSeconds = data.timerMinutes * 60;
            }
            updateTimerDisplay();

            // Build slides and TOC
            buildSlides(data);
            buildTOC(data);

            // Show first slide
            loadingState.style.display = 'none';
            presentation.style.display = 'block';
            presenterControls.style.display = 'flex';

            slides[0].el.classList.add('active');
            gsap.set(slides[0].el, { opacity: 1 });

            // Animate hero elements in
            const heroElements = slides[0].el.querySelectorAll('.slide-topic-badge, .slide-heading, .slide-body, [style*="display: flex"]');
            gsap.set(heroElements, { opacity: 0, y: 30 });
            gsap.to(heroElements, {
                opacity: 1,
                y: 0,
                duration: 1.2,
                ease: 'power4.out',
                stagger: 0.12,
                delay: 0.3
            });

            // Fix subtitle opacity
            const subtitles = slides[0].el.querySelectorAll('.slide-body');
            gsap.to(subtitles, { opacity: 0.85, duration: 1.2, ease: 'power4.out', delay: 0.5 });

            updateControls();

            // Start button
            const startBtn = document.getElementById('start-btn');
            if (startBtn) {
                startBtn.addEventListener('click', () => {
                    goToSlide(overviewSlideIndex, 1);
                });
            }

            // Show keyboard hints briefly
            setTimeout(showKeyboardHints, 2000);
        }

        // Try fetch first (GitHub Pages / HTTP), fall back to inline data (file://)
        fetch(`weeks/${weekId}.json`)
            .then(res => {
                if (!res.ok) throw new Error(`Week ${weekId} not found`);
                return res.json();
            })
            .then(data => loadPresentation(data))
            .catch(err => {
                // Fall back to inline data
                if (INLINE_WEEKS[weekId]) {
                    console.log('Using inline data (file:// mode)');
                    loadPresentation(INLINE_WEEKS[weekId]);
                } else {
                    console.error('Failed to load presentation:', err);
                    loadingState.innerHTML = `
                        <div style="text-align: center;">
                            <p style="opacity: 0.5; margin-bottom: 16px;">Could not load presentation</p>
                            <a href="index.html" class="btn secondary-btn">Back to Archive</a>
                        </div>
                    `;
                }
            });
    }

    // Expose public API
    window.Presenter = {
        goToSlide,
        goToTopic,
        nextSlide,
        prevSlide,
        goToOverview,
        toggleTOC,
        toggleQR,
        resetTimer
    };

    init();

})();
