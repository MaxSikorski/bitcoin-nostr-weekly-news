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
    const slideCreditContact = document.getElementById('slide-credit-contact');

    // === Branding / contact — every site-specific value comes from config.js ===
    const CFG = window.SITE_CONFIG || {};
    const CONTACT_EMAIL = (CFG.contactEmail || []).join('@');   // assembled at runtime so scrapers don't harvest it
    const MAIL = CFG.mail || {};
    const CONNECT = CFG.connect || { links: [] };
    function mailtoFor(subject, body) {
        return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    }
    const WORK_WITH_MAILTO = mailtoFor(MAIL.workWithSubject || '', MAIL.workWithBody || '');

    // === Telemetry beacons (engine-level, 2026-09-17 — admin-dashboard-plan §3a) ===
    // Dormant unless config.js sets telemetry.url (Max's private collector). A beacon is
    // an anonymous counter tick: {site, kind, week, topic} — no ids, no durations, nothing
    // per-person. Sent at most once per kind+target per pageview; every failure is silent.
    const TELEMETRY = CFG.telemetry || {};
    const beaconSent = {};
    function beacon(kind, week, topic) {
        if (!TELEMETRY.url || !navigator.sendBeacon) return;
        const key = kind + ':' + (week || '') + ':' + (topic || '');
        if (beaconSent[key]) return;
        beaconSent[key] = true;
        try {
            navigator.sendBeacon(TELEMETRY.url, JSON.stringify({
                site: TELEMETRY.site || '', kind: kind, week: week || '', topic: topic || ''
            }));
        } catch (e) { /* telemetry must never break the deck */ }
    }

    // === Likes (engine-level, 2026-09-10 — issue #6 second half) ===
    // Dormant unless config.js sets likes.adapter, or the page runs with ?likesDemo=1.
    // v1 ships the 'mock' adapter only (localStorage, seeded counts) so the UI can be demoed
    // before the Nostr backend exists; the 'nostr' adapter replaces load/like/unlike later
    // (relay URL comes from SITE_CONFIG.likes.relay — see future features/like-button-plan.md).
    const LIKES_CFG = CFG.likes || {};
    const likesDemo = new URLSearchParams(window.location.search).get('likesDemo') === '1';
    const likesAdapter = likesDemo ? 'mock' : (LIKES_CFG.adapter || null);
    let likesStore = null;
    if (likesAdapter === 'mock') {
        likesStore = {
            _key(weekId) { return 'likes:mock:' + weekId; },
            _read(weekId) {
                try { return JSON.parse(localStorage.getItem(this._key(weekId))) || {}; }
                catch (e) { return {}; }
            },
            _write(weekId, counts) {
                try { localStorage.setItem(this._key(weekId), JSON.stringify(counts)); } catch (e) {}
            },
            _seed(topicId) {
                // Deterministic fake count per topic so the demo looks alive (3–24).
                let h = 0;
                for (let i = 0; i < topicId.length; i++) h = ((h << 5) - h + topicId.charCodeAt(i)) | 0;
                return 3 + (Math.abs(h) % 22);
            },
            load(weekId, topicIds) {
                const stored = this._read(weekId);
                const counts = {};
                topicIds.forEach(id => { counts[id] = (id in stored) ? stored[id] : this._seed(id); });
                return Promise.resolve(counts);
            },
            like(weekId, topicId, current) {
                const stored = this._read(weekId);
                stored[topicId] = current + 1;
                this._write(weekId, stored);
                return Promise.resolve(stored[topicId]);
            },
            unlike(weekId, topicId, current) {
                const stored = this._read(weekId);
                stored[topicId] = Math.max(0, current - 1);
                this._write(weekId, stored);
                return Promise.resolve(stored[topicId]);
            }
        };
    } else if (likesAdapter === 'nostr' && LIKES_CFG.relay && LIKES_CFG.sitePubkey &&
               window.WebSocket && window.crypto && window.crypto.subtle &&
               typeof BigInt !== 'undefined') {
        likesStore = createNostrLikesStore();
    }

    // === Likes 'nostr' adapter (2026-09-17 — the backend half of issue #6) ===
    // A like = a NIP-25 kind-7 reaction to this site's per-topic ANCHOR event (the relay
    // requires reactions to reference a real event), published to SITE_CONFIG.likes.relay.
    // Anchors are kind-1 events from likes.sitePubkey, tagged ["t","<prefix>:<week>:<topic>"],
    // published by tools/likes_admin.py. Unlike = NIP-09 deletion of your own reaction.
    // The relay requires NIP-42 auth even to read, and the event pubkey must match the
    // authenticated key — so every visitor gets a persistent throwaway key (localStorage),
    // and a NIP-07 extension user is offered their real key on first like (the extension
    // shows its own consent prompt; declining falls back to the throwaway for good).
    // Every failure path resolves to "hearts stay dormant" — never an error state.
    function createNostrLikesStore() {
        const RELAY = LIKES_CFG.relay;
        const SITE_PK = String(LIKES_CFG.sitePubkey).toLowerCase();
        const PREFIX = LIKES_CFG.tagPrefix || 'likes';

        // --- secp256k1 + BIP-340 Schnorr over BigInt (sha256 via WebCrypto) ---
        const CP = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F');
        const CN = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
        const GP = [BigInt('0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798'),
                    BigInt('0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8')];
        function pmod(a, m) { const r = a % m; return r < 0n ? r + m : r; }
        function powmod(b, e, m) {
            let r = 1n; b = pmod(b, m);
            while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; }
            return r;
        }
        function inv(a, m) { return powmod(a, m - 2n, m); }
        function ptAdd(a, b) {
            if (!a) return b;
            if (!b) return a;
            if (a[0] === b[0] && pmod(a[1] + b[1], CP) === 0n) return null;
            let lam;
            if (a[0] === b[0] && a[1] === b[1]) lam = pmod(3n * a[0] * a[0] * inv(2n * a[1], CP), CP);
            else lam = pmod((b[1] - a[1]) * inv(pmod(b[0] - a[0], CP), CP), CP);
            const x = pmod(lam * lam - a[0] - b[0], CP);
            return [x, pmod(lam * (a[0] - x) - a[1], CP)];
        }
        function ptMul(k, p) {
            let r = null; p = p || GP;
            while (k > 0n) { if (k & 1n) r = ptAdd(r, p); p = ptAdd(p, p); k >>= 1n; }
            return r;
        }
        function bytesToHex(u8) {
            let s = '';
            for (let i = 0; i < u8.length; i++) s += u8[i].toString(16).padStart(2, '0');
            return s;
        }
        function hexToBytes(hex) {
            const u8 = new Uint8Array(hex.length / 2);
            for (let i = 0; i < u8.length; i++) u8[i] = parseInt(hex.substr(i * 2, 2), 16);
            return u8;
        }
        function bigTo32(b) { return hexToBytes(b.toString(16).padStart(64, '0')); }
        function bytesToBig(u8) { return BigInt('0x' + (bytesToHex(u8) || '0')); }
        function concatBytes() {
            let len = 0;
            for (const a of arguments) len += a.length;
            const out = new Uint8Array(len);
            let o = 0;
            for (const a of arguments) { out.set(a, o); o += a.length; }
            return out;
        }
        async function sha256(u8) {
            return new Uint8Array(await crypto.subtle.digest('SHA-256', u8));
        }
        async function taggedHash(tag, msg) {
            const t = await sha256(new TextEncoder().encode(tag));
            return sha256(concatBytes(t, t, msg));
        }
        async function schnorrSign(msg32, d, pub32) {
            const aux = crypto.getRandomValues(new Uint8Array(32));
            const t = d ^ bytesToBig(await taggedHash('BIP0340/aux', aux));
            const k0 = pmod(bytesToBig(await taggedHash('BIP0340/nonce',
                concatBytes(bigTo32(t), pub32, msg32))), CN);
            if (k0 === 0n) throw new Error('nonce');
            const R = ptMul(k0, null);
            const k = (R[1] & 1n) === 0n ? k0 : CN - k0;
            const e = pmod(bytesToBig(await taggedHash('BIP0340/challenge',
                concatBytes(bigTo32(R[0]), pub32, msg32))), CN);
            return concatBytes(bigTo32(R[0]), bigTo32(pmod(k + e * d, CN)));
        }

        // --- identity: persistent throwaway key, or the visitor's NIP-07 extension ---
        const KEY_SK = 'likes:nostr:sk';
        const KEY_IDENT = 'likes:nostr:ident';   // 'nip07' | 'throwaway' | unset (undecided)
        function evtsKey(weekId) { return 'likes:nostr:evts:' + weekId; }
        function readEvts(weekId) {
            try { return JSON.parse(localStorage.getItem(evtsKey(weekId))) || {}; }
            catch (e) { return {}; }
        }
        function writeEvts(weekId, map) {
            try { localStorage.setItem(evtsKey(weekId), JSON.stringify(map)); } catch (e) {}
        }
        function getPref(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
        function setPref(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

        function throwawaySigner() {
            let skHex = getPref(KEY_SK);
            if (!skHex || skHex.length !== 64) {
                skHex = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
                setPref(KEY_SK, skHex);
            }
            const sk0 = pmod(bytesToBig(hexToBytes(skHex)), CN - 1n) + 1n;
            const p0 = ptMul(sk0, null);
            const d = (p0[1] & 1n) === 0n ? sk0 : CN - sk0;
            const pub32 = bigTo32(p0[0]);
            return {
                pubkey: bytesToHex(pub32),
                async signEvent(ev) {
                    const ser = JSON.stringify([0, this.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]);
                    const id = bytesToHex(await sha256(new TextEncoder().encode(ser)));
                    const sig = bytesToHex(await schnorrSign(hexToBytes(id), d, pub32));
                    return Object.assign({ id: id, pubkey: this.pubkey, sig: sig }, ev);
                }
            };
        }
        async function nip07Signer() {
            const pubkey = await window.nostr.getPublicKey();
            return {
                pubkey: pubkey,
                async signEvent(ev) { return window.nostr.signEvent(ev); }
            };
        }

        // --- one authenticated WebSocket session, rebuilt if the identity upgrades ---
        let session = null;   // Promise<{ws, signer}> | null
        function resetSession() {
            if (session) session.then(s => { try { s.ws.close(); } catch (e) {} }).catch(() => {});
            session = null;
        }
        function ensureSession() {
            if (session) return session;
            session = (async () => {
                const signer = getPref(KEY_IDENT) === 'nip07' && window.nostr
                    ? await nip07Signer() : throwawaySigner();
                const ws = new WebSocket(RELAY);
                const listeners = [];   // transient routers; each returns true when done
                ws.onmessage = (m) => {
                    let msg;
                    try { msg = JSON.parse(m.data); } catch (e) { return; }
                    for (let i = listeners.length - 1; i >= 0; i--) {
                        if (listeners[i](msg)) listeners.splice(i, 1);
                    }
                };
                function expect(match, timeoutMs) {
                    return new Promise((resolve, reject) => {
                        const timer = setTimeout(() => reject(new Error('relay timeout')), timeoutMs);
                        listeners.push((msg) => {
                            const hit = match(msg);
                            if (hit !== undefined) { clearTimeout(timer); resolve(hit); return true; }
                            return false;
                        });
                    });
                }
                await new Promise((resolve, reject) => {
                    const timer = setTimeout(() => reject(new Error('connect timeout')), 8000);
                    ws.onopen = () => { clearTimeout(timer); resolve(); };
                    ws.onerror = () => { clearTimeout(timer); reject(new Error('ws error')); };
                });
                const challengeWait = expect(msg => msg[0] === 'AUTH' ? msg[1] : undefined, 6000);
                ws.send(JSON.stringify(['REQ', 'hello', { kinds: [7], limit: 1 }]));
                const challenge = await challengeWait;
                const authEv = await signer.signEvent({
                    kind: 22242, created_at: Math.floor(Date.now() / 1000),
                    tags: [['relay', RELAY], ['challenge', challenge]], content: ''
                });
                const okWait = expect(msg =>
                    msg[0] === 'OK' && msg[1] === authEv.id ? !!msg[2] : undefined, 6000);
                ws.send(JSON.stringify(['AUTH', authEv]));
                if (!(await okWait)) throw new Error('auth rejected');
                return { ws: ws, signer: signer, expect: expect };
            })();
            session.catch(() => { session = null; });
            return session;
        }

        function fetchEvents(s, filter, timeoutMs) {
            return new Promise((resolve) => {
                const sub = 's' + Math.random().toString(36).slice(2, 10);
                const events = [];
                const finish = () => { try { s.ws.send(JSON.stringify(['CLOSE', sub])); } catch (e) {} resolve(events); };
                const timer = setTimeout(finish, timeoutMs);
                s.expect((msg) => {
                    if (msg[1] !== sub) return undefined;
                    if (msg[0] === 'EVENT') { events.push(msg[2]); return undefined; }
                    if (msg[0] === 'EOSE' || msg[0] === 'CLOSED') { clearTimeout(timer); return true; }
                    return undefined;
                }, timeoutMs + 500).then(finish, finish);
                s.ws.send(JSON.stringify(['REQ', sub, filter]));
            });
        }
        async function publish(s, ev) {
            // Fire and confirm loosely: the relay sometimes never OKs a kind 7 that it
            // stored anyway (verified against Buzz 2026-09-17), so a timeout is not a failure.
            s.ws.send(JSON.stringify(['EVENT', ev]));
            try { await s.expect(msg => msg[0] === 'OK' && msg[1] === ev.id ? true : undefined, 3000); }
            catch (e) { /* assume delivered */ }
        }

        // On the first-ever like, a NIP-07 extension user gets one chance to use their
        // real key (that's what badge awards attach to). The extension prompts; a decline
        // locks in the throwaway so they're never nagged again.
        async function maybeUpgradeIdentity() {
            if (getPref(KEY_IDENT) || !window.nostr) return;
            try {
                await window.nostr.getPublicKey();
                setPref(KEY_IDENT, 'nip07');
                resetSession();
            } catch (e) {
                setPref(KEY_IDENT, 'throwaway');
            }
        }

        const anchorIds = {};   // topicId -> anchor event id (per loaded week)

        return {
            load(weekId, topicIds) {
                return (async () => {
                    const s = await ensureSession();
                    const slugs = topicIds.map(id => PREFIX + ':' + weekId + ':' + id);
                    const anchors = await fetchEvents(s,
                        { authors: [SITE_PK], kinds: [1], '#t': slugs }, 8000);
                    const slugToTopic = {};
                    topicIds.forEach((id, i) => { slugToTopic[slugs[i]] = id; });
                    const idToTopic = {};
                    anchors.forEach(ev => {
                        (ev.tags || []).forEach(tag => {
                            if (tag[0] === 't' && tag[1] in slugToTopic) {
                                anchorIds[slugToTopic[tag[1]]] = ev.id;
                                idToTopic[ev.id] = slugToTopic[tag[1]];
                            }
                        });
                    });
                    const ids = Object.keys(idToTopic);
                    if (!ids.length) throw new Error('no anchors');   // hearts stay dormant
                    const reactions = await fetchEvents(s, { kinds: [7], '#e': ids }, 8000);
                    const byTopic = {};   // topicId -> Set of pubkeys
                    const mine = {};      // topicId -> own reaction event id
                    reactions.forEach(ev => {
                        (ev.tags || []).forEach(tag => {
                            if (tag[0] === 'e' && tag[1] in idToTopic) {
                                const topic = idToTopic[tag[1]];
                                (byTopic[topic] = byTopic[topic] || new Set()).add(ev.pubkey);
                                if (ev.pubkey === s.signer.pubkey) mine[topic] = ev.id;
                            }
                        });
                    });
                    // Reconcile this browser's liked-state with what the relay actually has.
                    const liked = {};
                    Object.keys(mine).forEach(t => { liked[t] = true; });
                    writeLiked(weekId, liked);
                    writeEvts(weekId, mine);
                    const counts = {};
                    topicIds.forEach(id => { counts[id] = byTopic[id] ? byTopic[id].size : 0; });
                    return counts;
                })();
            },
            like(weekId, topicId, current) {
                return (async () => {
                    await maybeUpgradeIdentity();
                    const s = await ensureSession();
                    const anchor = anchorIds[topicId];
                    if (!anchor) throw new Error('no anchor');
                    const ev = await s.signer.signEvent({
                        kind: 7, created_at: Math.floor(Date.now() / 1000),
                        tags: [['e', anchor], ['p', SITE_PK],
                               ['t', PREFIX + ':' + weekId + ':' + topicId]],
                        content: '+'
                    });
                    await publish(s, ev);
                    const evts = readEvts(weekId);
                    evts[topicId] = ev.id;
                    writeEvts(weekId, evts);
                    return current + 1;
                })();
            },
            unlike(weekId, topicId, current) {
                return (async () => {
                    const s = await ensureSession();
                    const evts = readEvts(weekId);
                    if (!evts[topicId]) return Math.max(0, current - 1);
                    const ev = await s.signer.signEvent({
                        kind: 5, created_at: Math.floor(Date.now() / 1000),
                        tags: [['e', evts[topicId]]], content: ''
                    });
                    await publish(s, ev);
                    delete evts[topicId];
                    writeEvts(weekId, evts);
                    return Math.max(0, current - 1);
                })();
            }
        };
    }
    function likedKey(weekId) { return 'likes:liked:' + weekId; }
    function readLiked(weekId) {
        try { return JSON.parse(localStorage.getItem(likedKey(weekId))) || {}; }
        catch (e) { return {}; }
    }
    function writeLiked(weekId, map) {
        try { localStorage.setItem(likedKey(weekId), JSON.stringify(map)); } catch (e) {}
    }
    function contactMailto(topicTitle) {
        const fill = (s) => (s || '').replace('{topic}', topicTitle || '');
        return topicTitle
            ? mailtoFor(fill(MAIL.topicSubject), fill(MAIL.topicBody))
            : mailtoFor(MAIL.generalSubject || '', MAIL.generalBody || '');
    }

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
                <p class="slide-body" style="max-width: 480px; margin: 0 auto 40px;">${data.subtitle || CFG.deckSubtitle || ''}</p>
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

                if (slideData.widget === 'bip110-live') {
                    slideHTML += `
                        <div class="live-dashboard">
                            <div class="live-metric live-metric-primary">
                                <span class="live-label">Blocks to Flag Day</span>
                                <span class="live-value" id="bip110-countdown">—</span>
                            </div>
                            <div class="live-metric-row">
                                <div class="live-metric">
                                    <span class="live-label">Signaling This Period</span>
                                    <span class="live-value-sm" id="bip110-signaling">—</span>
                                </div>
                                <div class="live-metric">
                                    <span class="live-label">Block Height</span>
                                    <span class="live-value-sm" id="bip110-height">—</span>
                                </div>
                            </div>
                            <div class="live-metric-row">
                                <div class="live-metric">
                                    <span class="live-label">Lock-in Needs</span>
                                    <span class="live-value-sm" id="bip110-needed">—</span>
                                </div>
                                <div class="live-metric">
                                    <span class="live-label">Max Still Possible</span>
                                    <span class="live-value-sm" id="bip110-possible">—</span>
                                </div>
                            </div>
                            <span class="live-status" id="bip110-status">Connecting to bip110monitor.com…</span>
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
                                    data-embed="${embedUrl}"
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

                // Affiliate buttons (per-topic) + shop link — data from recommendations.js
                const affIds = slideData.products || (slideData.product ? [slideData.product] : []);
                let affHTML = '';
                if (affIds.length && Array.isArray(window.PRODUCTS)) {
                    affIds.forEach(pid => {
                        const p = window.PRODUCTS.find(x => x.id === pid);
                        if (p && p.amazonUrl) {
                            affHTML += `
                                <a href="${p.amazonUrl}" target="_blank" rel="noopener noreferrer sponsored" class="slide-affiliate">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
                                        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
                                    </svg>
                                    Buy on Amazon${p.name ? ' — ' + p.name : ''}
                                </a>`;
                        }
                    });
                }
                if (slideData.shop) {
                    const shopCat = (typeof slideData.shop === 'string') ? slideData.shop : '';
                    const shopHref = 'recommendations.html' + (shopCat ? ('#' + encodeURIComponent(shopCat)) : '');
                    affHTML += `
                        <a href="${shopHref}" class="slide-affiliate slide-affiliate-shop">
                            Shop my picks
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M5 12h14M13 6l6 6-6 6"/>
                            </svg>
                        </a>`;
                }
                if (affHTML) {
                    slideHTML += `<div class="slide-affiliate-group">${affHTML}<span class="affiliate-note">${window.AFFILIATE_DISCLOSURE || 'Some links may be affiliate links.'}</span></div>`;
                }

                // Share (engine-level, 2026-08-13 — community request, GitHub issue #6):
                // every topic's FIRST slide carries a quiet share affordance; S opens the sheet.
                // Likes (2026-09-10, issue #6 second half): heart sits beside Share, only when a
                // likes adapter is active — otherwise this block renders exactly as before.
                if (slideIndex === 0) {
                    if (likesStore) {
                        slideHTML += `
                            <button type="button" class="slide-like-btn" data-topic-id="${topic.id}" aria-label="Like this topic" title="Like this topic">
                                <svg class="like-heart" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                                </svg>
                                <span class="like-count"></span>
                            </button>
                        `;
                    }
                    slideHTML += `
                        <button type="button" class="slide-share-btn" data-topic-id="${topic.id}" aria-label="Share this topic" title="Share this topic (S)">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                                <line x1="8.59" y1="10.49" x2="15.42" y2="6.51"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                            </svg>
                            <span>Share</span>
                        </button>
                    `;
                }

                slideHTML += '</div>';
                slide.innerHTML = slideHTML;

                // Curtain Reveal (opt-in): hide this slide behind a glass curtain until clicked
                if (slideData.reveal) {
                    slide.classList.add('reveal-armed');
                    slide.dataset.revealConfig = JSON.stringify(slideData.reveal === true ? {} : slideData.reveal);
                    slide.insertAdjacentHTML('beforeend', revealCurtainHTML(slideData.reveal));
                }

                container.appendChild(slide);

                // Determine URL for QR code
                const qrUrl = slideData.link || slideData.videoUrl || (slideData.links && slideData.links[0] && slideData.links[0].url) || topic.url || null;
                slides.push({
                    type: 'topic',
                    el: slide,
                    topicId: topic.id,
                    topicIndex: topicIndex,
                    slideIndex: slideIndex,
                    topicTitle: topic.title,
                    url: qrUrl,
                    accent: topic.accent || null
                });
            });
        });

        // === Closing slide: Connect with Max (engine-level — appears on every deck) ===
        const connectSlide = createSlide('connect');
        connectSlide.innerHTML = `
            <div class="slide-content" style="text-align: center;">
                <p class="slide-topic-badge">Connect</p>
                <h2 class="slide-heading">Connect with ${CFG.hostName || ''}</h2>
                <p class="slide-body" style="max-width: 580px; margin: 0 auto 32px;">${CONNECT.blurbHtml || ''}</p>
                <div class="connect-links">
                    ${(CONNECT.links || []).map(l => `<a class="connect-link" href="${l.href}" target="_blank" rel="noopener noreferrer">${l.label}</a>`).join('')}
                    <a class="connect-link" href="${WORK_WITH_MAILTO}">${CONNECT.workWithLabel || 'Work With Me'}</a>
                </div>
            </div>
        `;
        container.appendChild(connectSlide);
        slides.push({ type: 'connect', el: connectSlide, topicId: null, topicIndex: null, topicTitle: null, url: CONNECT.qrHref || null, accent: null });

        return slides;
    }

    function createSlide(type) {
        const slide = document.createElement('div');
        slide.className = 'slide';
        slide.dataset.type = type;
        return slide;
    }

    // === Video control: halt playback when leaving a slide ===
    function stopSlideVideos(slideEl) {
        if (!slideEl) return;
        slideEl.querySelectorAll('iframe[data-embed]').forEach(f => {
            f.src = 'about:blank'; // blanking the source stops audio/video immediately
        });
    }

    function restoreSlideVideos(slideEl) {
        if (!slideEl) return;
        slideEl.querySelectorAll('iframe[data-embed]').forEach(f => {
            if (f.src.indexOf(f.dataset.embed) === -1) {
                f.src = f.dataset.embed; // reload the player so it's ready to play again
            }
        });
    }

    // === Curtain Reveal — opt-in per slide via a "reveal" key (true | {kicker, label, confetti}) ===
    // A one-shot theatrical unveil: the slide hides behind a glass curtain with a single
    // button; clicking parts the curtain and staggers the content in. Reloading re-arms it.
    // Shared opt-in feature; dormant unless a slide opts in.
    function revealCurtainHTML(reveal) {
        const cfg = (typeof reveal === 'object' && reveal !== null) ? reveal : {};
        const kicker = cfg.kicker || 'Builder Spotlight';
        const label = cfg.label || 'Unveil';
        return `
            <div class="slide-reveal-curtain">
                <div class="slide-reveal-panel slide-reveal-panel-left"></div>
                <div class="slide-reveal-panel slide-reveal-panel-right"></div>
                <div class="slide-reveal-seam"></div>
                <div class="slide-reveal-center">
                    <p class="slide-reveal-kicker">${kicker}</p>
                    <button type="button" class="slide-reveal-btn">${label}</button>
                </div>
            </div>
        `;
    }

    function playReveal(slideEl) {
        if (!slideEl || slideEl.dataset.revealed === 'true') return;
        slideEl.dataset.revealed = 'true';
        const curtain = slideEl.querySelector('.slide-reveal-curtain');
        const content = slideEl.querySelector('.slide-content');
        if (!curtain || !content) return;

        let cfg = {};
        try { cfg = JSON.parse(slideEl.dataset.revealConfig || '{}'); } catch (e) { /* defaults */ }

        const left = curtain.querySelector('.slide-reveal-panel-left');
        const right = curtain.querySelector('.slide-reveal-panel-right');
        const seam = curtain.querySelector('.slide-reveal-seam');
        const center = curtain.querySelector('.slide-reveal-center');
        const heading = content.querySelector('.slide-heading');
        const inner = content.querySelectorAll('.slide-topic-badge, .slide-heading, .slide-body, .slide-bullets li, .slide-link, .video-container, .slide-image-container, .slide-affiliate-group');

        // Light sweep: sits under the parting panels, over the content
        const sweep = document.createElement('div');
        sweep.className = 'slide-reveal-sweep';
        slideEl.appendChild(sweep);

        gsap.set(inner, { opacity: 0, y: 26 });
        slideEl.classList.remove('reveal-armed'); // content column back; children start hidden

        const tl = gsap.timeline({
            onComplete: () => { curtain.remove(); sweep.remove(); }
        });
        tl.to(center, { opacity: 0, y: -14, duration: 0.35, ease: 'power2.in' }, 0)
          .to(seam, { opacity: 0.5, duration: 0.25, ease: 'power2.out' }, 0.1)
          .to(seam, { opacity: 0, duration: 0.6, ease: 'power2.out' }, 0.45)
          .to(left, { xPercent: -103, duration: 1.15, ease: 'power4.inOut' }, 0.3)
          .to(right, { xPercent: 103, duration: 1.15, ease: 'power4.inOut' }, 0.3)
          .fromTo(sweep, { xPercent: -120 }, { xPercent: 120, duration: 1.0, ease: 'power2.out' }, 0.85)
          .to(inner, { opacity: 1, y: 0, duration: 0.9, ease: 'power4.out', stagger: 0.1 }, 0.9);
        // The heading lands with a pop, not just a fade
        if (heading) {
            tl.fromTo(heading, { scale: 0.92 }, { scale: 1, duration: 0.8, ease: 'back.out(1.7)', clearProps: 'scale' }, 1.0);
        }
        // Settle body copy at the engine's resting opacity
        content.querySelectorAll('.slide-body, .slide-bullets li').forEach(el => {
            tl.to(el, { opacity: 0.85, duration: 0.5, ease: 'power2.out' }, 1.9);
        });
        // Celebration extra — opt-in via the reveal config
        if (cfg.confetti) tl.add(() => spawnRevealConfetti(slideEl), 1.05);
    }

    // Multicolor confetti burst — the ONE sanctioned color exception (Max's call, 2026-07-16):
    // everything else stays monochrome; the confetti alone gets party colors.
    const REVEAL_CONFETTI_COLORS = [
        '#ff3b30', // red
        '#ff9500', // orange
        '#ffcc00', // yellow
        '#34c759', // green
        '#14b8a6', // teal
        '#007aff', // blue
        '#af52de', // purple
        '#ff2d55'  // pink
    ];

    function spawnRevealConfetti(slideEl) {
        const box = document.createElement('div');
        box.className = 'slide-reveal-confetti';
        slideEl.appendChild(box);
        const W = slideEl.clientWidth, H = slideEl.clientHeight;
        const COUNT = 80;
        for (let i = 0; i < COUNT; i++) {
            const p = document.createElement('div');
            p.className = 'slide-reveal-confetti-piece';
            const strip = Math.random() < 0.5;
            const s = 5 + Math.random() * 6;
            p.style.width = s + 'px';
            p.style.height = (strip ? s * 2.4 : s) + 'px';
            p.style.background = REVEAL_CONFETTI_COLORS[Math.floor(Math.random() * REVEAL_CONFETTI_COLORS.length)];
            p.style.opacity = String(0.85 + Math.random() * 0.15); // full color, slight depth
            box.appendChild(p);
            const x0 = W / 2, y0 = H * 0.62;
            const drift = (Math.random() - 0.5) * W * 0.9;
            const rise = H * (0.25 + Math.random() * 0.45);
            const d1 = 0.55 + Math.random() * 0.35;
            const d2 = 0.9 + Math.random() * 0.6;
            gsap.set(p, { x: x0, y: y0, rotation: Math.random() * 360 });
            gsap.timeline({ onComplete: () => p.remove() })
                .to(p, { x: x0 + drift * 0.6, y: y0 - rise, rotation: '+=' + (180 + Math.random() * 360), duration: d1, ease: 'power2.out' })
                .to(p, { x: x0 + drift, y: y0 + H * 0.25, rotation: '+=' + (180 + Math.random() * 360), duration: d2, ease: 'power1.in' })
                .to(p, { opacity: 0, duration: 0.35 }, '-=0.35');
        }
        gsap.delayedCall(3.2, () => box.remove());
    }

    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.slide-reveal-btn');
        if (btn) playReveal(btn.closest('.slide'));
    });

    // === Navigation ===
    function goToSlide(index, direction) {
        if (index < 0 || index >= slides.length || index === currentSlide) return;

        if (slides[index].topicId) {
            beacon('view-topic', weekData && weekData.week, slides[index].topicId);
        }
        const prevSlideEl = slides[currentSlide].el;
        const nextSlideEl = slides[index].el;
        const dir = direction || (index > currentSlide ? 1 : -1);

        // Stop any video on the slide we're leaving; ready the one we're entering
        stopSlideVideos(prevSlideEl);
        restoreSlideVideos(nextSlideEl);

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
        const innerElements = nextSlideEl.querySelectorAll('.slide-topic-badge, .slide-heading, .slide-body, .slide-bullets li, .slide-link, .video-container, .topic-card, .connect-links, .slide-share-btn, .slide-like-btn');
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
            nextSlideEl.querySelectorAll('.slide-share-btn').forEach(el => {
                gsap.to(el, { opacity: 0.35, duration: 0.6, ease: 'power4.out', delay: 0.3 });
            });
            nextSlideEl.querySelectorAll('.slide-like-btn').forEach(el => {
                gsap.to(el, { opacity: el.classList.contains('liked') ? 0.9 : 0.45, duration: 0.6, ease: 'power4.out', delay: 0.3 });
            });
        }

        currentSlide = index;
        updateControls();
        updateQR();
        updateTOCHighlight();
        updateSlideCredit();
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

        // Topic accent — colors come from config.js; no key = monochrome
        const accent = slides[currentSlide].accent;
        const accentColor = (CFG.accents || {})[accent];
        progressBar.style.background = accentColor || '';
        progressBar.style.opacity = accentColor ? '0.9' : '';
    }

    // === Slide credit: per-topic contact link (byline is static in week.html) ===
    function updateSlideCredit() {
        if (!slideCreditContact) return;
        const s = slides[currentSlide];
        slideCreditContact.href = contactMailto(s && s.topicTitle ? s.topicTitle : null);
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
            beacon('share-qr', weekData && weekData.week,
                slides[currentSlide] ? slides[currentSlide].topicId : null);
            qrToggleBtn.classList.add('active');
            updateQR();
        } else {
            qrToggleBtn.classList.remove('active');
            qrOverlay.classList.remove('visible');
        }
    }

    // === Share (engine-level) — per-topic deep links + share sheet (S) ===
    // Added 2026-08-13 (community request — GitHub issue #6). Links are built from
    // window.location, so they follow the site wherever it lives: GitHub Pages today,
    // the Vercel mirror, or a future custom domain — no hardcoded host anywhere.
    let shareOpen = false;
    let shareSheet = null, shareOverlay = null;
    let lastShareTopic = null;   // context for the share beacons

    function shareUrlFor(topicId) {
        const params = new URLSearchParams(window.location.search);
        const week = params.get('week') || (weekData && weekData.week) || '';
        let url = `${window.location.origin}${window.location.pathname}?week=${encodeURIComponent(week)}`;
        if (topicId) url += `&topic=${encodeURIComponent(topicId)}`;
        return url;
    }

    function buildShareSheet() {
        shareOverlay = document.createElement('div');
        shareOverlay.className = 'share-overlay';
        shareSheet = document.createElement('div');
        shareSheet.className = 'share-sheet';
        shareSheet.setAttribute('role', 'dialog');
        shareSheet.setAttribute('aria-label', 'Share');
        shareSheet.innerHTML = `
            <button type="button" class="share-close" aria-label="Close share">&times;</button>
            <p class="share-title">Share</p>
            <p class="share-topic-title"></p>
            <div class="share-main">
                <div class="share-qr">
                    <canvas></canvas>
                    <p class="share-qr-label">Scan to open</p>
                </div>
                <div class="share-right">
                    <div class="share-link-row">
                        <span class="share-link-text"></span>
                        <button type="button" class="share-copy-btn">Copy Link</button>
                    </div>
                    <div class="share-targets"></div>
                </div>
            </div>
        `;
        document.body.appendChild(shareOverlay);
        document.body.appendChild(shareSheet);
        shareOverlay.addEventListener('click', closeShare);
        shareSheet.querySelector('.share-close').addEventListener('click', closeShare);
        shareSheet.querySelector('.share-copy-btn').addEventListener('click', (e) => {
            copyShareLink(e.currentTarget.dataset.url || '', e.currentTarget);
        });
    }

    function copyShareLink(url, btn) {
        beacon('share-copy', weekData && weekData.week, lastShareTopic);
        const done = () => {
            btn.textContent = 'Copied ✓';
            setTimeout(() => { btn.textContent = 'Copy Link'; }, 1600);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(done).catch(() => fallbackCopy(url, done));
        } else {
            fallbackCopy(url, done);
        }
    }

    function fallbackCopy(text, done) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) { /* best effort */ }
        ta.remove();
        done();
    }

    function buildShareTargets(container, url, title) {
        const eUrl = encodeURIComponent(url);
        const eTitle = encodeURIComponent(title);
        let html = '';
        if (navigator.share) {
            html += `<button type="button" class="share-target" data-native="true">Share…</button>`;
        }
        html += `
            <a class="share-target" href="mailto:?subject=${eTitle}&body=${eTitle}%0A%0A${eUrl}">Email</a>
            <a class="share-target" href="https://twitter.com/intent/tweet?text=${eTitle}&url=${eUrl}" target="_blank" rel="noopener noreferrer">X</a>
            <a class="share-target" href="https://www.facebook.com/sharer/sharer.php?u=${eUrl}" target="_blank" rel="noopener noreferrer">Facebook</a>
            <a class="share-target" href="https://www.linkedin.com/sharing/share-offsite/?url=${eUrl}" target="_blank" rel="noopener noreferrer">LinkedIn</a>
            <a class="share-target" href="https://www.reddit.com/submit?url=${eUrl}&title=${eTitle}" target="_blank" rel="noopener noreferrer">Reddit</a>
            <a class="share-target" href="https://wa.me/?text=${eTitle}%20${eUrl}" target="_blank" rel="noopener noreferrer">WhatsApp</a>
        `;
        container.innerHTML = html;
        const nativeBtn = container.querySelector('[data-native]');
        if (nativeBtn) {
            nativeBtn.addEventListener('click', () => {
                beacon('share-native', weekData && weekData.week, lastShareTopic);
                navigator.share({ title: title, url: url }).catch(() => { /* user closed the native sheet */ });
            });
        }
    }

    function openShare(topicId) {
        if (!shareSheet) buildShareSheet();
        // No explicit topic → share the current slide's topic; on title/overview/finale, the week
        if (topicId === undefined || topicId === null || topicId === '') {
            topicId = slides[currentSlide] ? slides[currentSlide].topicId : null;
        }
        const slideMeta = topicId ? slides.find(s => s.topicId === topicId) : null;
        const topicTitle = slideMeta ? slideMeta.topicTitle : null;
        const url = shareUrlFor(topicId);
        lastShareTopic = topicId || null;
        beacon('share-open', weekData && weekData.week, lastShareTopic);
        const shareTitle = topicTitle ? `${topicTitle} — ${CFG.weeklyName || ''}` : `${weekData ? weekData.title : CFG.weeklyName || ''}`;

        shareSheet.querySelector('.share-topic-title').textContent = topicTitle || (weekData ? weekData.title : '');
        shareSheet.querySelector('.share-link-text').textContent = url.replace(/^https?:\/\//, '');
        shareSheet.querySelector('.share-copy-btn').dataset.url = url;
        generateQR(url, shareSheet.querySelector('.share-qr canvas'), 132);
        buildShareTargets(shareSheet.querySelector('.share-targets'), url, shareTitle);

        shareOpen = true;
        shareOverlay.classList.add('open');
        shareSheet.classList.add('open');
    }

    function closeShare() {
        if (!shareOpen) return;
        shareOpen = false;
        shareOverlay.classList.remove('open');
        shareSheet.classList.remove('open');
    }

    function toggleShare() {
        if (shareOpen) closeShare();
        else openShare();
    }

    // === Search palette selection (presenter, F) ===
    function selectSearchResult(entry) {
        if (!weekData || entry.week !== weekData.week) return false;
        const index = slides.findIndex(slide => slide.topicId === entry.topicId && slide.slideIndex === entry.slideIndex);
        if (index < 0) return false;
        goToSlide(index);
        return true;
    }

    function toggleSearch() {
        if (!window.DeckSearch) return;
        if (!window.DeckSearch.isOpen()) {
            if (shareOpen) closeShare();
            if (tocOpen) closeTOC();
            if (qrVisible) {
                qrVisible = false;
                qrToggleBtn.classList.remove('active');
                qrOverlay.classList.remove('visible');
            }
        }
        window.DeckSearch.togglePalette({ onSelect: selectSearchResult });
    }

    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.slide-share-btn');
        if (btn) openShare(btn.dataset.topicId);
    });

    // === Likes — hydration + interaction (no-op when no adapter is active) ===
    const likeCounts = {};   // topicId -> count (hydrated once per deck)
    let likesWeekId = null;

    // Count display (Max, 2026-09-10): plain through 999; 1,000–99,999 as K with one
    // decimal ("1K", "1.1K", "45.2K"); 100,000+ as whole K ("100K", "101K").
    function formatLikeCount(n) {
        if (n < 1000) return String(n);
        if (n < 100000) {
            const v = Math.floor(n / 100) / 10;
            return (v % 1 === 0 ? String(v) : v.toFixed(1)) + 'K';
        }
        return Math.floor(n / 1000) + 'K';
    }

    function renderLikeBtn(btn, count, liked) {
        btn.classList.toggle('liked', liked);
        const countEl = btn.querySelector('.like-count');
        if (countEl) countEl.textContent = count > 0 ? formatLikeCount(count) : '';
    }

    function initLikes(data) {
        if (!likesStore) return;
        likesWeekId = data.week;
        const topicIds = (data.topics || []).map(t => t.id);
        likesStore.load(likesWeekId, topicIds).then(counts => {
            Object.assign(likeCounts, counts);
            // The nostr adapter rewrites the liked map from relay truth during load —
            // re-read it so a like made on another day (or lost localStorage) reconciles.
            const likedNow = readLiked(likesWeekId);
            document.querySelectorAll('.slide-like-btn').forEach(btn => {
                const id = btn.dataset.topicId;
                renderLikeBtn(btn, likeCounts[id] || 0, !!likedNow[id]);
            });
            document.body.classList.add('likes-live');   // hearts appear only once hydrated
        }).catch(() => { /* adapter unreachable → hearts stay dormant, no errors */ });
    }

    function sparkleBurst(btn) {
        // Light glimmer: a few tiny dots + stars radiating from the heart, then gone.
        const PARTICLES = 7;
        for (let i = 0; i < PARTICLES; i++) {
            const p = document.createElement('span');
            p.className = 'like-sparkle' + (i % 3 === 0 ? ' like-sparkle-star' : '');
            const angle = (Math.PI * 2 * i) / PARTICLES + (Math.random() - 0.5) * 0.6;
            const dist = 18 + Math.random() * 14;
            p.style.setProperty('--sx', (Math.cos(angle) * dist).toFixed(1) + 'px');
            p.style.setProperty('--sy', (Math.sin(angle) * dist).toFixed(1) + 'px');
            p.style.animationDelay = (Math.random() * 80) + 'ms';
            if (p.classList.contains('like-sparkle-star')) p.textContent = '✦';
            btn.appendChild(p);
            p.addEventListener('animationend', () => p.remove());
        }
    }

    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.slide-like-btn');
        if (!btn || !likesStore || !likesWeekId) return;
        const id = btn.dataset.topicId;
        const liked = readLiked(likesWeekId);
        const current = likeCounts[id] || 0;
        if (liked[id]) {
            // Unlike: quiet — outline returns, count steps down, no celebration.
            delete liked[id];
            likeCounts[id] = Math.max(0, current - 1);
            renderLikeBtn(btn, likeCounts[id], false);
            likesStore.unlike(likesWeekId, id, current).catch(() => {});
        } else {
            liked[id] = true;
            likeCounts[id] = current + 1;
            renderLikeBtn(btn, likeCounts[id], true);
            btn.classList.remove('like-pop');
            void btn.offsetWidth;   // restart the pop animation on rapid re-like
            btn.classList.add('like-pop');
            sparkleBurst(btn);
            likesStore.like(likesWeekId, id, current).catch(() => {});
        }
        writeLiked(likesWeekId, liked);
    });

    // === TOC ===
    function buildTOC(data) {
        tocList.innerHTML = '';

        // Week reference in the popout (Max, 2026-09-10): search can land you in any deck —
        // the TOC says which one. Meetup date since 2026-09-23 (Max): "· September 23 · 2026";
        // falls back to the week id if a deck has no date.
        const tocWeekEl = document.getElementById('toc-week');
        if (tocWeekEl && data.date) {
            const d = new Date(`${data.date}T12:00:00`);
            const monthDay = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
            tocWeekEl.textContent = `· ${monthDay} · ${d.getFullYear()}`;
        } else if (tocWeekEl && data.week) {
            const m = data.week.match(/^(\d{4})-W(\d{2})$/);
            tocWeekEl.textContent = m ? `· Week ${parseInt(m[2], 10)} · ${m[1]}` : `· ${data.week}`;
        }

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

        // Search palette open but focus left its field: a shortcut closes the palette first, then acts
        if (window.DeckSearch && window.DeckSearch.isOpen()) {
            if (e.key === 'Escape') return; // the palette handles its own Escape
            window.DeckSearch.closePalette();
        }

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
                if (window.DeckSearch && window.DeckSearch.isOpen()) {
                    window.DeckSearch.closePalette();
                } else if (shareOpen) {
                    closeShare();
                } else if (tocOpen) {
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
            case 's':
            case 'S':
                e.preventDefault();
                toggleShare();
                break;
            case 'f':
            case 'F':
                e.preventDefault();
                toggleSearch();
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

    // === Touch / Swipe Navigation (tablets & phones) ===
    let touchStartX = 0, touchStartY = 0, touchTracking = false;
    const SWIPE_THRESHOLD = 50; // minimum horizontal travel in px

    presentation.addEventListener('touchstart', (e) => {
        // Single-finger only, and not while an overlay is open
        if (e.touches.length !== 1 || tocOpen || qrVisible || shareOpen || (window.DeckSearch && window.DeckSearch.isOpen())) { touchTracking = false; return; }
        touchTracking = true;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    }, { passive: true });

    presentation.addEventListener('touchend', (e) => {
        if (!touchTracking) return;
        touchTracking = false;
        const t = e.changedTouches[0];
        const dx = t.clientX - touchStartX;
        const dy = t.clientY - touchStartY;
        // Only treat clearly-horizontal swipes as navigation (ignore vertical scrolls)
        if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy) * 1.5) {
            if (dx < 0) nextSlide();   // swipe left → next slide
            else prevSlide();          // swipe right → previous slide
        }
    }, { passive: true });

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

    // === BIP-110 live widget (W32 — flag-day countdown + signaling from bip110monitor.com) ===
    // Read-only public API (CORS *); needs internet, degrades gracefully offline like live-price.
    function initBip110Dashboard() {
        const countdownEl = document.getElementById('bip110-countdown');
        if (!countdownEl) return; // no BIP-110 dashboard slide in this week's deck
        const signalingEl = document.getElementById('bip110-signaling');
        const heightEl = document.getElementById('bip110-height');
        const neededEl = document.getElementById('bip110-needed');
        const possibleEl = document.getElementById('bip110-possible');
        const statusEl = document.getElementById('bip110-status');
        const FLAG_DAY_HEIGHT = 961632; // BIP-110 consensus constant — mandatory signaling begins
        const LOCK_IN_BLOCKS = 1109;    // 55% of a 2,016-block period
        const fmt = (n) => n.toLocaleString('en-US');

        async function refresh() {
            try {
                const res = await fetch('https://bip110monitor.com/api');
                const d = await res.json();
                const toFlagDay = Math.max(0, FLAG_DAY_HEIGHT - d.tip);
                countdownEl.textContent = toFlagDay > 0 ? fmt(toFlagDay) : 'FLAG DAY';
                signalingEl.textContent = `${fmt(d.signalingCount)} / ${fmt(d.totalBlocks)} · ${d.pct}%`;
                heightEl.textContent = fmt(d.tip);
                neededEl.textContent = fmt(LOCK_IN_BLOCKS);
                const maxPossible = d.signalingCount + Math.max(0, d.periodEnd - d.tip);
                possibleEl.textContent = fmt(maxPossible);
                if (statusEl) {
                    const days = (toFlagDay * 10 / 60 / 24).toFixed(1);
                    const verdict = maxPossible < LOCK_IN_BLOCKS ? ' · voluntary lock-in impossible' : '';
                    statusEl.textContent = toFlagDay > 0
                        ? `Live · bip110monitor.com · ~${days} days at 10 min/block${verdict}`
                        : 'Live · bip110monitor.com · mandatory signaling window is open';
                }
            } catch (e) {
                if (statusEl) statusEl.textContent = 'Offline — open bip110monitor.com for live data';
            }
        }
        refresh();
        setInterval(refresh, 20000);
    }

    // === Initialize ===
    function init() {
        if (CFG.liveAccent) {
            document.documentElement.style.setProperty('--live-accent', CFG.liveAccent);
        }
        const params = new URLSearchParams(window.location.search);
        const weekId = params.get('week');

        if (!weekId) {
            window.location.href = 'index.html';
            return;
        }

        function loadPresentation(data) {
            weekData = data;

            // Update page title
            document.title = `${data.title} — ${CFG.siteName || ''}`;

            // Set timer from data
            if (data.timerMinutes) {
                timerSeconds = data.timerMinutes * 60;
            }
            updateTimerDisplay();

            // Build slides and TOC
            buildSlides(data);
            buildTOC(data);
            initLikes(data);
            beacon('view-deck', data.week);
            initLiveDashboard();
            initBip110Dashboard();

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
            updateSlideCredit();

            // Start button
            const startBtn = document.getElementById('start-btn');
            if (startBtn) {
                startBtn.addEventListener('click', () => {
                    goToSlide(overviewSlideIndex, 1);
                });
            }

            // Show keyboard hints briefly
            setTimeout(showKeyboardHints, 2000);

            // Deep link (share/search feature): ?topic=<id> lands on that topic's first slide,
            // or on its zero-based ?slide=<n> when that slide exists.
            // A shared link shouldn't start the meetup timer — suppress autostart for the jump.
            const topicParam = params.get('topic');
            if (topicParam) {
                const requestedSlide = Number.parseInt(params.get('slide'), 10);
                let idx = Number.isInteger(requestedSlide)
                    ? slides.findIndex(s => s.topicId === topicParam && s.slideIndex === requestedSlide)
                    : -1;
                if (idx < 0) idx = slides.findIndex(s => s.topicId === topicParam);
                if (idx > 0) {
                    const wasStarted = timerStarted;
                    timerStarted = true;
                    goToSlide(idx, 1);
                    timerStarted = wasStarted;
                }
            }
        }

        function loadExtraScripts(done) {
            const extraScripts = CFG.extraScripts || [];
            let index = 0;
            function next() {
                if (index >= extraScripts.length) {
                    done();
                    return;
                }
                const src = extraScripts[index++];
                const script = document.createElement('script');
                script.src = src;
                script.onload = next;
                script.onerror = () => {
                    console.warn('Failed to load extra script:', src);
                    next();
                };
                document.head.appendChild(script);
            }
            next();
        }

        function start() {
            // Try fetch first (GitHub Pages / HTTP), fall back to inline data (file://)
            fetch(`weeks/${weekId}.json`)
                .then(res => {
                    if (!res.ok) throw new Error(`Week ${weekId} not found`);
                    return res.json();
                })
                .then(data => loadPresentation(data))
                .catch(err => {
                    // Fall back to inline data
                    const inlineWeeks = window.INLINE_WEEKS || {};
                    if (inlineWeeks[weekId]) {
                        console.log('Using inline data (file:// mode)');
                        loadPresentation(inlineWeeks[weekId]);
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

        loadExtraScripts(start);
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
        toggleSearch,
        resetTimer
    };

    // === Image Lightbox (click a slide photo to expand it) ===
    (function setupImageLightbox() {
        const overlay = document.createElement('div');
        overlay.className = 'image-lightbox';
        overlay.innerHTML = '<img class="image-lightbox-img" alt="">';
        document.body.appendChild(overlay);
        const lightboxImg = overlay.querySelector('.image-lightbox-img');

        function openLightbox(src, alt) {
            lightboxImg.src = src;
            lightboxImg.alt = alt || '';
            overlay.classList.add('visible');
        }
        function closeLightbox() {
            overlay.classList.remove('visible');
        }

        // Open when a slide photo (single image or gallery item) is clicked
        document.addEventListener('click', (e) => {
            const img = e.target.closest('.slide-image-container img, .slide-gallery-item img');
            if (img) {
                e.preventDefault();
                openLightbox(img.currentSrc || img.src, img.alt);
            }
        });

        // Click anywhere off the image (the dimmed backdrop) to close
        overlay.addEventListener('click', (e) => {
            if (e.target !== lightboxImg) closeLightbox();
        });

        // Escape also closes it (runs before the presenter's own Escape handler)
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && overlay.classList.contains('visible')) {
                e.stopImmediatePropagation();
                e.preventDefault();
                closeLightbox();
            }
        }, true);
    })();

    init();

})();
