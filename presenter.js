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

                if (slideData.widget === 'live-price') {
                    slideHTML += `
                        <div class="live-dashboard">
                            <div class="live-metric live-metric-primary">
                                <span class="live-label">BTC / USD</span>
                                <span class="live-value" id="live-price">—</span>
                            </div>
                            <div class="live-metric-row">
                                <div class="live-metric">
                                    <span class="live-label">Block Height</span>
                                    <span class="live-value-sm" id="live-height">—</span>
                                </div>
                                <div class="live-metric">
                                    <span class="live-label">Fastest Fee</span>
                                    <span class="live-value-sm" id="live-fee">—</span>
                                </div>
                            </div>
                            <span class="live-status" id="live-status">Connecting to mempool.space…</span>
                        </div>
                    `;
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

                if (slideData.links && Array.isArray(slideData.links)) {
                    slideHTML += `<div class="slide-links-row">`;
                    slideData.links.forEach(lnk => {
                        slideHTML += `
                            <a href="${lnk.url}" target="_blank" rel="noopener noreferrer" class="slide-link">
                                ${lnk.label || 'Open Link'}
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M7 17L17 7M17 7H7M17 7v10"/>
                                </svg>
                            </a>
                        `;
                    });
                    slideHTML += `</div>`;
                }

                slideHTML += '</div>';
                slide.innerHTML = slideHTML;
                container.appendChild(slide);

                // Determine URL for QR code
                const qrUrl = slideData.link || slideData.videoUrl || (slideData.links && slideData.links[0] && slideData.links[0].url) || topic.url || null;
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

    // === Live Dashboard widget (Phase 1 — live price/height/fee from mempool.space) ===
    // Read-only public API; needs internet, degrades gracefully offline so the rest works on file://.
    function initLiveDashboard() {
        const priceEl = document.getElementById('live-price');
        if (!priceEl) return; // no dashboard slide in this week's deck
        const heightEl = document.getElementById('live-height');
        const feeEl = document.getElementById('live-fee');
        const statusEl = document.getElementById('live-status');
        const fmtUSD = (n) => '$' + Math.round(n).toLocaleString('en-US');

        async function refresh() {
            try {
                const [priceRes, heightRes, feeRes] = await Promise.all([
                    fetch('https://mempool.space/api/v1/prices'),
                    fetch('https://mempool.space/api/blocks/tip/height'),
                    fetch('https://mempool.space/api/v1/fees/recommended')
                ]);
                const price = await priceRes.json();
                const height = await heightRes.text();
                const fee = await feeRes.json();
                if (price && price.USD) priceEl.textContent = fmtUSD(price.USD);
                if (height) heightEl.textContent = parseInt(height, 10).toLocaleString('en-US');
                if (fee && fee.fastestFee) feeEl.textContent = fee.fastestFee + ' sat/vB';
                if (statusEl) statusEl.textContent = 'Live · mempool.space · refreshes every 20s';
            } catch (e) {
                if (statusEl) statusEl.textContent = 'Offline — open the dashboards below for live data';
            }
        }
        refresh();
        setInterval(refresh, 20000);
    }

    // === Inline fallback data for file:// protocol ===
    // Keep in sync with weeks/2026-W24.json
    const INLINE_WEEKS = {
        "2026-W26": {
            "week": "2026-W26",
            "date": "2026-06-24",
            "title": "Two August Forks, Bitcoin Mortgages & Illinois's Crypto Tax",
            "subtitle": "This week in Bitcoin & Nostr news",
            "timerMinutes": 20,
            "topics": [
                {
                    "id": "market",
                    "title": "Live Dashboard & Market",
                    "description": "Where Bitcoin sits live, and why it's a rough day near two-week lows",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Live Dashboard",
                            "body": "Before the headlines — here's where Bitcoin sits right now. Open the full dashboards below:",
                            "widget": "live-price",
                            "links": [
                                {
                                    "url": "https://bitcoin.clarkmoody.com/dashboard/",
                                    "label": "Clark Moody Dashboard"
                                },
                                {
                                    "url": "https://mempool.space",
                                    "label": "mempool.space"
                                }
                            ]
                        },
                        {
                            "heading": "A Rough Day: Near Two-Week Lows",
                            "body": "Bitcoin is back near two-week lows. After the US-Iran peace deal was formally signed June 19, the geopolitical 'safe-haven' bid faded — and a more hawkish Fed isn't helping.",
                            "bullets": [
                                "The June 19 peace signing in Switzerland reopened the Strait of Hormuz — good for the world, but it removed the risk premium that had lifted BTC",
                                "ETF demand is still soft: after one inflow day on June 12, outflows resumed — about 19 of the last 22 trading days were negative",
                                "A more hawkish Fed (rate hikes later this year) is pressuring risk assets broadly",
                                "Zoom out: Bitcoin is still down roughly $43,000 from a year ago"
                            ],
                            "link": "https://finance.yahoo.com/personal-finance/investing/article/bitcoin-and-ethereum-prices-today-wednesday-june-24-2026-opened-at-lowest-levels-in-about-two-weeks-125349040.html",
                            "linkLabel": "Read the Market Recap"
                        }
                    ]
                },
                {
                    "id": "bip-110-watch",
                    "title": "BIP-110 Watch: Signaling Begins",
                    "description": "Our standing tracker — miner signaling appears for the first time, still tiny",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "BIP-110 Watch: Signaling Has Begun",
                            "body": "Our standing tracker on the data-limit soft fork. This week it crossed from talk into action — miner signaling has appeared in the data for the first time, though it's still a rounding error.",
                            "bullets": [
                                "Miner signaling: ~0.31% of blocks (up from ~0% last week) — far below the 55% activation bar",
                                "Node support: 2.38% (583 of ~24,481 nodes); Bitcoin Knots remains the implementation",
                                "Only ~5 EH/s of the network's ~940 EH/s is signaling",
                                "Flag day approaches: block 961,632, around August 2026"
                            ],
                            "link": "https://bip110monitor.com/",
                            "linkLabel": "Live Signaling Monitor"
                        },
                        {
                            "heading": "Where We Stand",
                            "bullets": [
                                "The camps, recap: Core (raised OP_RETURN limits) vs Knots/BIP-110 (restrict data) vs Super Testnet's URSF-110 (reject the soft fork)",
                                "Our position: sound money is the reason to be wary — a 55% UASF that can freeze miniscript funds and risk a chain split is the wrong vehicle. We're with Super",
                                "And August just got crowded — Paul Sztorc's hard fork lands days after the BIP-110 flag day (next topic)"
                            ]
                        }
                    ]
                },
                {
                    "id": "sztorc-fork",
                    "title": "Paul Sztorc's August Hard Fork",
                    "description": "A 1:1 airdrop fork that would reassign Satoshi's coins — critics call it theft",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Paul Sztorc's August Hard Fork",
                            "body": "Drivechain creator Paul Sztorc (BIP-300) plans a hard fork around block 964,000 in August: a new SHA-256d chain that begins as a near-copy of Bitcoin, activates Drivechains, and airdrops 1:1 to BTC holders at the fork block. He's dubbed it 'eCash' — no relation to Cashu/Fedimint Chaumian ecash.",
                            "link": "https://unchainedcrypto.com/bitcoin-developer-paul-sztorc-plans-august-hard-fork-dubbed-ecash-with-a-plan-to-reassign-satoshi-nakamotos-coins/",
                            "linkLabel": "Read the Plan"
                        },
                        {
                            "heading": "Why It's Controversial",
                            "bullets": [
                                "The flashpoint: a plan to reassign Satoshi Nakamoto's dormant coins — critics are calling it theft",
                                "It lands right beside the BIP-110 flag day — two protocol events on nearly the same August timetable",
                                "Critics warn it could fracture consensus and set a precedent for tampering with old coins",
                                "A 1:1 airdrop sounds like 'free money' — but touching it has real risks (see this week's Quick Tip)"
                            ],
                            "link": "https://www.coindesk.com/tech/2026/04/27/a-long-time-developer-wants-to-fork-bitcoin-and-reassign-satoshi-coins-the-community-is-calling-it-a-theft",
                            "linkLabel": "The 'Theft' Debate"
                        }
                    ]
                },
                {
                    "id": "bitcoin-mortgages",
                    "title": "Bitcoin Hits the Mortgage Market",
                    "description": "First Fannie Mae-backed Bitcoin-collateral mortgages close — including a $4.2M Florida home",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Bitcoin Hits the Mortgage Market",
                            "body": "Bitcoin just entered the U.S. housing system. Better and Coinbase closed the first Fannie Mae-backed mortgages using Bitcoin as collateral — letting buyers borrow against their BTC for a down payment without selling it.",
                            "bullets": [
                                "The first close went to a Michigan couple; a $4.2M Florida home followed — and closed in just 23 days",
                                "Structure: a standard Fannie conforming mortgage plus a separate Bitcoin-collateral loan for the down payment",
                                "Collateral ratio ~2.5:1 (pledge ~$250K in BTC for a $100K down payment); routine price swings don't trigger margin calls",
                                "Enabled by the FHFA directing Fannie/Freddie to recognize crypto held on exchanges; BTC + USDC, nationwide rollout this summer"
                            ],
                            "link": "https://www.housingwire.com/articles/fannie-mae-bitcoin-mortgage/",
                            "linkLabel": "Read the Details"
                        },
                        {
                            "heading": "Why It Matters + Discussion",
                            "bullets": [
                                "This is Bitcoin plugging directly into the largest asset class on earth — U.S. housing",
                                "The pitch: keep your stack and buy the house, avoiding a taxable sale and keeping the upside",
                                "The catch: fall ~60 days behind on payments and the Bitcoin can be liquidated — leverage cuts both ways",
                                "For the legacy-finance crowd: is collateralized BTC the on-ramp that finally normalizes it?"
                            ]
                        }
                    ]
                },
                {
                    "id": "illinois-tax",
                    "title": "Illinois Taxes Crypto — A First",
                    "description": "First state to directly tax crypto transactions: a 0.2% levy on gross value",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Illinois Taxes Crypto — A First",
                            "body": "Illinois became the first state to put a direct tax on crypto transactions. Gov. Pritzker signed it into the $56B state budget on June 16 — the Digital Asset Tax Act, a 0.2% 'privilege tax' on digital-asset activity, charged on the gross value moved, not on profits.",
                            "link": "https://www.coindesk.com/policy/2026/06/17/crypto-industry-aghast-at-illinois-new-tax-on-holding-or-transferring-digital-assets-in-state-budget",
                            "linkLabel": "Read the Coverage"
                        },
                        {
                            "heading": "The Fine Print + Discussion",
                            "bullets": [
                                "It targets brokers/custodians based in Illinois or serving IL residents (with $100K+ gross receipts) — not literally your P2P self-custody sends, but costs get passed to users",
                                "Illinois doesn't tax stocks, bonds, or derivatives this way — the Crypto Council calls it 'the most punitive digital asset tax in the country'",
                                "Set to take effect in 2027; projected to raise about $60M a year",
                                "A tax on moving your own money — a precedent other states copy, or an outlier that gets challenged?"
                            ]
                        }
                    ]
                },
                {
                    "id": "sparrow-apple",
                    "title": "Sparrow Wallet vs. Apple",
                    "description": "Apple threatens to terminate Sparrow's developer account — macOS installs at risk June 30",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Sparrow Wallet vs. Apple",
                            "body": "A wallet many of us run is in trouble on macOS. Sparrow's developer, Craig Raw, said on June 22 that Apple flagged his developer account for termination by June 30 — which would break notarized installs and updates on Mac.",
                            "link": "https://cryptobriefing.com/sparrow-wallet-macos-apple-termination/",
                            "linkLabel": "Read What Happened"
                        },
                        {
                            "heading": "The Irony + What To Do",
                            "bullets": [
                                "The trigger: Raw submitted an app to warn users about a dozen-plus fake 'Sparrow' apps stealing funds — Apple labeled his warning 'dishonest activity'",
                                "If the account is terminated: new Mac users must clear Gatekeeper hurdles to install, and existing users stop getting updates",
                                "Windows and Linux are unaffected",
                                "Takeaway: only download Sparrow from sparrowwallet.com and verify the release — open-source self-custody vs platform gatekeeping in a nutshell"
                            ],
                            "link": "https://sparrowwallet.com/download/",
                            "linkLabel": "Official Download + Verify"
                        }
                    ]
                },
                {
                    "id": "nostr-zapstore",
                    "title": "Nostr: Zapstore & the OpenSats Wave",
                    "description": "A Nostr-native app store you can't de-platform, plus Amethyst's big release",
                    "type": "tool",
                    "accent": "nostr",
                    "slides": [
                        {
                            "heading": "Nostr: Zapstore & the OpenSats Wave",
                            "body": "A standout in the Nostr ecosystem: Zapstore — an app store built ON Nostr, where developers publish releases as signed Nostr events and users verify the binaries before installing. Permissionless software distribution — a pointed contrast to this week's Sparrow-vs-Apple story.",
                            "link": "https://opensats.org/projects/zapstore",
                            "linkLabel": "Zapstore (OpenSats)"
                        },
                        {
                            "heading": "Also Shipping + Discussion",
                            "bullets": [
                                "Amethyst shipped a big release: Kotlin Multiplatform migration, desktop builds for Linux and Windows, and an iOS port in development",
                                "OpenSats has now directed over $27M (~31 billion sats) to 319 free-and-open-source grantees across 32+ countries",
                                "The throughline: Nostr as an app-distribution layer no Apple or Google can de-platform",
                                "Discussion: could a Zapstore-style model have spared Sparrow's Mac users?"
                            ],
                            "link": "https://opensats.org/projects/amethyst",
                            "linkLabel": "Amethyst"
                        }
                    ]
                },
                {
                    "id": "builder-spotlight",
                    "title": "Builder Spotlight: Super Testnet's spam_tester",
                    "description": "Our first weekly Builder Spotlight — an interactive Core-vs-Knots spam experiment",
                    "type": "tool",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Builder Spotlight: Super Testnet's spam_tester",
                            "body": "Kicking off our new weekly Builder Spotlight with Super Testnet. His latest tool, spam_tester, is an interactive web app that gives empirical data on how Bitcoin Core vs Bitcoin Knots handle inscription 'spam' — the exact fight at the heart of the BIP-110 debate.",
                            "link": "https://github.com/supertestnet/spam_tester",
                            "linkLabel": "Try spam_tester"
                        },
                        {
                            "heading": "Why We Love It",
                            "bullets": [
                                "It targets 100-400kb data transactions — the range Core treats as standard but Knots rejects as nonstandard — and lets you see the resource difference",
                                "Empirical, not ideological: the point is you can prove that spam filters reduce strain on node resources",
                                "Intellectual honesty on display: Super publicly corrected his own RAM claim in Oct 2025 after re-reading the code (Knots' extrapool keeps the txs anyway)",
                                "Classic Super: clean, front-end, hands-on. Follow his work at github.com/supertestnet"
                            ],
                            "link": "https://github.com/supertestnet?tab=repositories",
                            "linkLabel": "Super's Repositories"
                        }
                    ]
                },
                {
                    "id": "quick-tip",
                    "title": "Quick Tip of the Week",
                    "description": "How to safely handle a fork airdrop without losing your real coins",
                    "type": "tool",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Quick Tip: Surviving a Fork Airdrop",
                            "body": "With Sztorc's hard fork promising a 1:1 'free coin' airdrop in August, here's the self-custody rule: the danger isn't the fork — it's the rush to claim. Scam 'claim' tools will ask for your seed phrase or private keys. Never paste them anywhere. Wait for replay protection, and if you ever do claim forkcoins, move your real BTC to a fresh wallet first. Free coins are never worth a drained wallet."
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
        },
        "2026-W25": {
            "week": "2026-W25",
            "date": "2026-06-17",
            "title": "BIP-110's Fork Fight, the Rebound & a Record Difficulty Drop",
            "subtitle": "This week in Bitcoin & Nostr news",
            "timerMinutes": 20,
            "topics": [
                {
                    "id": "market-rebound",
                    "title": "The Ceasefire Rebound",
                    "description": "BTC dipped below $60K, then snapped back above $65K on a US-Iran ceasefire",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "The Ceasefire Rebound",
                            "body": "After last week's slide, Bitcoin briefly fell below $60,000 — its lowest since November 2024 — then snapped back to around $65-66K. The trigger was geopolitical: a US-Iran ceasefire deal flipped markets risk-on, with oil falling and equities rallying.",
                            "link": "https://finance.yahoo.com/personal-finance/investing/article/bitcoin-and-ethereum-prices-today-monday-june-15-2026-prices-rising-after-us-iran-agree-to-ceasefire-deal-114616600.html",
                            "linkLabel": "Read the Market Recap"
                        },
                        {
                            "heading": "What Turned It Around",
                            "bullets": [
                                "US-Iran ceasefire deal → risk appetite returned across markets",
                                "Oil fell, equities rallied, and SpaceX debuted +19% on its first Nasdaq trading day",
                                "Resolves last week's cliffhanger — the sub-$60K low and the CPI report we flagged",
                                "Perspective: even after the bounce, BTC sits roughly $48,800 below where it traded a year ago"
                            ],
                            "link": "https://fortune.com/article/price-of-bitcoin-06-15-2026/",
                            "linkLabel": "Price Snapshot"
                        },
                        {
                            "heading": "Discussion Points",
                            "bullets": [
                                "Was the sub-$60K print the bottom, or just a relief rally on geopolitics?",
                                "How much is Bitcoin now a macro 'risk asset' that moves on ceasefires and CPI prints?",
                                "If a war headline can move it 10%, how 'uncorrelated' is it really?"
                            ]
                        }
                    ]
                },
                {
                    "id": "etf-flip",
                    "title": "The ETF Outflows Reverse",
                    "description": "Last week's record exodus flipped to inflows — the streak finally broke",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "The ETF Outflows Reverse",
                            "body": "The sequel to last week's 'ETF Exodus': the bleeding stopped. On June 12, US spot Bitcoin ETFs took in $85.85 million — breaking a four-week outflow streak that had drained roughly $5.4 billion. BlackRock's IBIT led the turnaround with about $57.7M (~1,350 BTC).",
                            "link": "https://news.bitcoin.com/bitcoin-etf-inflows-ethereum-outflows-june-2026/",
                            "linkLabel": "Read the Flows Breakdown"
                        },
                        {
                            "heading": "Why It Matters + Discussion",
                            "bullets": [
                                "None of the 12 funds saw outflows that day — a clean break from the prior week's $1.72B exit",
                                "IBIT again drove the action, both down (last week) and up (this week)",
                                "The flip tracks the ceasefire risk-on move — ETF flows increasingly mirror macro sentiment",
                                "Real question: institutional conviction returning, or a one-day dead-cat bounce?"
                            ]
                        }
                    ]
                },
                {
                    "id": "difficulty-drop",
                    "title": "A Historic 10% Difficulty Drop",
                    "description": "Second-biggest drop of 2026 as miners power down — exactly as we predicted",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "A Historic 10% Difficulty Drop",
                            "body": "We called this one last week. On June 14 (block 953,568), mining difficulty fell 10.09% — from 138.96T to 124.93T, the lowest since July 2025. It was the second-biggest drop of 2026 and the 11th-largest in Bitcoin's history.",
                            "link": "https://cryptobriefing.com/bitcoin-mining-difficulty-drops-10-percent/",
                            "linkLabel": "Read the Coverage"
                        },
                        {
                            "heading": "The Miner Squeeze",
                            "bullets": [
                                "Miners powered off inefficient rigs as BTC fell ~15% in June, dragging hashrate down",
                                "The adjustment lifted output-per-hashrate ~11%; hashprice recovered to about $32.31/PH/s/day",
                                "But estimated average cost to mine a coin (~$84,300) sits well above the ~$63K price",
                                "Translation: many miners are underwater — the classic bear-market shakeout"
                            ],
                            "link": "https://crypto.news/bitcoin-mining-difficulty-just-had-its-11th-biggest-drop-ever/",
                            "linkLabel": "The 11th-Biggest Drop Ever"
                        },
                        {
                            "heading": "Discussion Points",
                            "bullets": [
                                "Who survives mining at these prices — and who gets bought for pennies?",
                                "Difficulty dropping is relief for whoever keeps hashing: the strong get stronger",
                                "Does cheap-power consolidation worry anyone, or is it just healthy natural selection?"
                            ]
                        }
                    ]
                },
                {
                    "id": "bip-110-watch",
                    "title": "BIP-110 Watch: The Soft-Fork Fight",
                    "description": "Our new standing weekly tracker — the data-limit UASF dividing Bitcoin, and where we stand",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "BIP-110 Watch: The Data-Limit Soft Fork",
                            "body": "New standing segment. BIP-110 — the 'Reduced Data Temporary Softfork' (introduced December 2025 by pseudonymous dev Dathon Ohm) — would cap transaction output scriptPubKeys at 34 bytes and OP_RETURN at 83 bytes for about a year, aiming to curb Ordinals/Runes 'spam.' It's the OP_RETURN war escalated into an actual activation attempt.",
                            "link": "https://bip110.org/",
                            "linkLabel": "BIP-110 Project Site"
                        },
                        {
                            "heading": "The Three Camps",
                            "bullets": [
                                "Bitcoin Core — raised the OP_RETURN limit (83 → 100,000 bytes in v30); 'don't filter, let the fee market decide'",
                                "Knots + BIP-110 — restrict the data, 'keep Bitcoin for money' (the Luke Dashjr camp)",
                                "Super Testnet's URSF-110 ('User Rejected Soft Fork') — a tool that REJECTS BIP-110-signaling blocks via invalidateblock; he opposes BIP-110 (it can freeze miniscript funds using OP_IF in Taproot, and a forced 55% activation risks a chain split that backfires on the anti-spam goal)",
                                "ProductionReady (Jimmy Song & Samson Mow) — funding a conservative third node client to break Core's monopoly on the reference implementation"
                            ],
                            "link": "https://github.com/supertestnet/URSF-110",
                            "linkLabel": "Super Testnet's URSF-110"
                        },
                        {
                            "heading": "By the Numbers + Where We Stand",
                            "bullets": [
                                "Support is tiny: ~2.38% of nodes (583 of ~24,481) run BIP-110, and 0.00% of blocks are signaling",
                                "Context: Knots runs ~22-25% of nodes, but few enabled BIP-110 — and miners aren't signaling at all",
                                "Activation needs 55% of blocks (vs the 95% norm); flag day is block 961,632 (~Aug 2026). Adam Back warns a contested activation could split the chain by fall; Jameson Lopp doubts data filters even work",
                                "Where we stand: sound money is the REASON to be wary — BIP-110 can freeze real funds and a rushed UASF risks a fork that backfires. We're with Super's URSF-110."
                            ],
                            "link": "https://bip110monitor.com/",
                            "linkLabel": "Live Signaling Monitor"
                        }
                    ]
                },
                {
                    "id": "clarity-act",
                    "title": "CLARITY Act: The Ethics Snag",
                    "description": "The market-structure bill is on the calendar but stuck on an ethics provision",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "CLARITY Act: The Ethics Snag",
                            "body": "The Digital Asset Market CLARITY Act sits on the Senate calendar (Calendar No. 423) after clearing the Banking Committee 15-9. It would hand the CFTC exclusive jurisdiction over digital-commodity spot markets like Bitcoin's, with the SEC keeping investment contracts — but floor support is hung up on an ethics provision about government officials' crypto ties.",
                            "link": "https://www.coindesk.com/news-analysis/2026/06/02/clarity-act-survival-depends-on-the-u-s-senate-getting-a-lot-of-non-crypto-work-done",
                            "linkLabel": "Where It Stands"
                        },
                        {
                            "heading": "The Clock + Discussion",
                            "bullets": [
                                "Still needs 60 floor votes, reconciliation with the Senate Ag Committee, then the House",
                                "Roughly eight weeks remain before the summer break — and midterm politics loom after",
                                "Does a market-structure bill survive an election-year Congress, or slip to 2027?",
                                "Is clear CFTC jurisdiction over spot Bitcoin a win worth the wait?"
                            ]
                        }
                    ]
                },
                {
                    "id": "strategic-reserve",
                    "title": "Strategic Bitcoin Reserve: Weeks Away?",
                    "description": "White House signals an announcement soon; the bill drops its 1M-BTC target",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Strategic Bitcoin Reserve: Weeks Away?",
                            "body": "Patrick Witt of the President's Council of Advisors for Digital Assets told Consensus Miami an announcement on the reserve is coming 'in the next few weeks.' Meanwhile the latest reserve bill quietly dropped its 1-million-BTC purchase target, while keeping the 20-year lockup and quarterly proof-of-reserve mandates.",
                            "link": "https://www.theblock.co/post/402264/new-strategic-bitcoin-reserve-bill-drops-btc-purchase-target-adds-lockup",
                            "linkLabel": "Read the Bill Changes"
                        },
                        {
                            "heading": "The Stakes + Discussion",
                            "bullets": [
                                "If the BITCOIN Act passes, Treasury's first official purchase is estimated for Q4 2026 — the first sovereign to actively accumulate",
                                "The US already holds an estimated ~328,000 BTC, mostly from forfeitures",
                                "Does dropping the 1M-BTC target gut the ambition, or make it actually passable?",
                                "Quarterly proof-of-reserve from a government — a precedent we'd want every nation to copy?"
                            ]
                        }
                    ]
                },
                {
                    "id": "nostr-signing",
                    "title": "Nostr: Zaps + the Remote-Signing Era",
                    "description": "NIP-57 updated this week; the ecosystem moves off pasting your nsec",
                    "type": "tool",
                    "accent": "nostr",
                    "slides": [
                        {
                            "heading": "Nostr: Zaps Spec Updated + Remote Signing",
                            "body": "NIP-57 — the spec that defines Lightning zaps — was updated this week (June 13). The bigger 2026 shift: Nostr has moved away from pasting your private key (nsec) into every app, toward remote signing where your key stays locked in one place.",
                            "link": "https://nips.nostr.com/57",
                            "linkLabel": "NIP-57 (Zaps)"
                        },
                        {
                            "heading": "How It Works + Discussion",
                            "bullets": [
                                "NIP-46 'bunkers' keep your nsec in a dedicated app (like Amber on Android); other clients get a temporary, revocable session key",
                                "NIP-47 (Nostr Wallet Connect) lets apps request Lightning payments directly — seamless zapping, no invoice copy-paste",
                                "Clients like Damus, Primal, and Amethyst now build around delegated signing",
                                "Is key management the real adoption hurdle for Nostr — and is remote signing the fix?"
                            ],
                            "link": "https://nips.nostr.com/46",
                            "linkLabel": "NIP-46 (Remote Signing)"
                        }
                    ]
                },
                {
                    "id": "ecash",
                    "title": "Ecash Grows Up: Cashu & Fedimint",
                    "description": "Chaumian ecash over Lightning keeps maturing — private, instant, bearer Bitcoin",
                    "type": "tool",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Ecash Grows Up: Cashu & Fedimint",
                            "body": "Chaumian ecash — private, instant, bearer tokens backed by Bitcoin over Lightning — keeps maturing. Cashu's Nutshell 0.20.0 (Q1 2026) added improved P2PK/HTLC validation; Keyset V2 derivation is rolling out, Bolt12 support for cashu.me is close, and security audits are a stated priority.",
                            "link": "https://opensats.org/projects/cashu",
                            "linkLabel": "Cashu (OpenSats)"
                        },
                        {
                            "heading": "The Tradeoff + Discussion",
                            "bullets": [
                                "Cashu uses a single mint; Fedimint spreads custody across a federation of guardians",
                                "The deal: you trust a mint/federation in exchange for instant, private, no-account payments",
                                "It's the privacy renaissance pairing with Lightning — exactly the 'invisible' UX newcomers need",
                                "Is custodial-but-private ecash the right on-ramp for everyday Bitcoin, or a step backward on self-custody?"
                            ],
                            "link": "https://blog.bitfinex.com/education/cashu-chaumian-e-cash-mints-over-lightning/",
                            "linkLabel": "How Cashu Works"
                        }
                    ]
                },
                {
                    "id": "quick-tip",
                    "title": "Quick Tip of the Week",
                    "description": "Stop pasting your nsec — use a remote signer",
                    "type": "tool",
                    "accent": "nostr",
                    "slides": [
                        {
                            "heading": "Quick Tip: Stop Pasting Your nsec",
                            "body": "If you're on Nostr, stop pasting your private key (nsec) into every web app — each one is a place it can leak. Instead, use a remote signer: keep your nsec in one dedicated app (Amber on Android) or an NIP-46 bunker, and let other clients sign through it with a temporary, revocable key. Same login everywhere, far smaller attack surface.",
                            "link": "https://soapbox.pub/blog/managing-nostr-keys/",
                            "linkLabel": "Managing Your Nostr Keys"
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
        },
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
            initLiveDashboard();

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
